// 手機端的連線（協定第 2 版）：開房、查房、WebSocket 進房、自動重連。
//   · 私人座位憑證只存在這支手機的 localStorage（不放網址、不寫進日誌）；重新整理或斷線後會自動回到同一個座位
//   · 會改變狀態的指令自動帶指令編號（cid）；牌局指令另外帶「我看到的狀態版本」（ver）。伺服器存檔成功才回 ack，不行就回 reject＋原因
//   · 斷線時不送指令（不會偷偷吃掉）；已經送出、還沒收到回覆的指令，重新連上後用同一個編號重送（伺服器不會重複生效）
//   · 重連：指數退避＋隨機抖動；切回前景或網路恢復時馬上重試；太久沒收到任何東西就當斷線重連
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../server/protocol";
import type { Command, Reply } from "./solo";
export type { Command, Reply };

const tokenKey = (code: string) => `hb-token-${code}`;
export const LAST_ROOM_KEY = "hb-last-room";

export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* 無痕模式 */ } },
};

export const savedToken = (code: string) => store.get(tokenKey(code));
export function forgetRoom(code: string) {
  store.del(tokenKey(code));
  if (store.get(LAST_ROOM_KEY) === code) store.del(LAST_ROOM_KEY);
}

async function errorText(res: Response, fallback: string) {
  try { const j = await res.json() as { error?: string }; if (j?.error) return j.error; } catch { /* 不是 JSON */ }
  return fallback;
}

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error(await errorText(res, "開桌沒成功，再試一次看看。"));
  return (await res.json()).code;
}

export interface RoomInfo { exists: boolean; seats?: boolean[]; started?: boolean; status?: string }
export async function roomInfo(code: string): Promise<RoomInfo> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(await errorText(res, "連不上伺服器，等一下再試試。"));
  return res.json();
}

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";
const GAME_CMDS = new Set(["play", "call", "next"]);
// 這些關閉代碼代表「不要再重連了」：被新分頁取代、自己離開、房間不在、坐滿、關了、版本不對、太頻繁
const FINAL_CLOSE = new Set([4000, 4001, 4404, 4409, 4410, 4426, 4429]);

export const newCid = () => [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, "0")).join("");

export class Connection {
  readonly solo = false;
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  private lastSeen = 0;
  private live = false;                                   // 收到 welcome 之後才算進房
  private inflight = new Map<string, { m: Command; done?: (r: Reply) => void }>();
  ver = 0;                                                // 最新的狀態版本（牌局指令帶這個）
  gid: string | null = null;                              // 這一場的編號
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};

  constructor(public readonly code: string, private name: string) {
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }

  get isOpen() { return this.live && this.ws?.readyState === WebSocket.OPEN; }

  open() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    this.onStatus(this.retry === 0 ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    this.live = false;
    ws.onopen = () => {
      this.lastSeen = Date.now();
      ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, token: savedToken(this.code), name: this.name } satisfies ClientMsg));
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        // 40 秒都沒收到任何東西（連 pong 都沒有）：這條連線多半死了，直接重連
        if (Date.now() - this.lastSeen > 40_000) { this.kick(); return; }
        this.raw({ t: "ping" });
      }, 15_000);
    };
    ws.onmessage = ev => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.track(m);
      if (m.t === "welcome") {
        this.retry = 0;
        this.live = true;
        store.set(tokenKey(this.code), m.token);
        store.set(LAST_ROOM_KEY, this.code);
        this.onStatus("open");
      }
      if (m.t === "full" || m.t === "gone" || m.t === "closed" || (m.t === "error" && (m.code === "VERSION" || m.code === "RATE"))) this.stopped = true;
      this.onMessage(m);
      // 進房、同步完：之前送出但不知道有沒有生效的指令，用同一個編號再送一次（生效過的伺服器會直接回原本的結果）
      if (m.t === "resync" && this.inflight.size) for (const [, x] of this.inflight) this.raw(x.m);
    };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      if (this.stopped || FINAL_CLOSE.has(ev.code)) { this.stop(); this.onStatus("closed"); return; }
      this.dropped();
    };
  }

  // 記住最新的狀態版本；指令的回覆交給等它的人
  private track(m: ServerMsg) {
    if (m.t === "event" || m.t === "state" || m.t === "ack" || m.t === "reject") { if (typeof m.ver === "number") this.ver = m.ver; }
    if ((m.t === "event" || m.t === "state") && m.gid) this.gid = m.gid;
    if (m.t === "resync" || m.t === "room") { this.ver = m.t === "resync" ? m.ver : m.r.ver; this.gid = m.r.gid; }
    if (m.t === "welcome") this.gid = m.gid;
    if ((m.t === "ack" || m.t === "reject") && m.cid) {
      const x = this.inflight.get(m.cid);
      this.inflight.delete(m.cid);
      x?.done?.(m.t === "ack" ? { ok: true, ver: m.ver } : { ok: false, code: m.code, msg: m.msg, ver: m.ver });
    }
  }

  private dropped() {
    clearInterval(this.pingTimer);
    this.live = false;
    this.retry++;
    this.onStatus("reconnecting");
    // 0.5、1、2、4、8 秒…最多 10 秒，再乘上 0.7～1.3 的隨機值（很多人同時斷線時不會一起擠回來）
    const base = Math.min(10_000, 500 * 2 ** Math.min(this.retry - 1, 5));
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => { if (!this.stopped) this.open(); }, base * (0.7 + Math.random() * 0.6));
  }

  // 測試用：模擬網路斷掉（跟真的斷線走同一條重連路線）
  simulateDrop() { this.kick(); }

  // 這條連線看起來死了：不等瀏覽器慢慢發現，直接當斷線處理
  private kick() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try { ws.close(); } catch { /* 已經關了 */ }
    this.dropped();
  }

  // 切回前景、網路恢復：正在等重試的話馬上重試
  private wake = () => {
    if (this.stopped || document.visibilityState === "hidden") return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      clearTimeout(this.retryTimer);
      this.retry = Math.max(1, this.retry);
      this.open();
    } else if (this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSeen > 20_000) this.raw({ t: "ping" });
  };

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(m)); return true; }
    return false;
  }

  // 不改變狀態的訊息（ping、sync、recap、emote）
  send(m: ClientMsg): boolean { return this.isOpen ? this.raw(m) : false; }

  // 會改變狀態的指令：帶指令編號（牌局指令再帶狀態版本、場次）；斷線中不送，回 null（畫面要告訴玩家）
  command(m: Command, done?: (r: Reply) => void): string | null {
    if (!this.isOpen) return null;
    const cid = newCid();
    const msg = { ...m, cid } as Command;
    if (GAME_CMDS.has(m.t)) Object.assign(msg, { ver: this.ver, gid: this.gid ?? undefined });
    this.inflight.set(cid, { m: msg, done });
    this.raw(msg);
    return cid;
  }

  private stop() {
    this.stopped = true;
    this.live = false;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
  }

  close() {
    this.stop();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* 已經關了 */ }
    this.inflight.clear();
  }
}
