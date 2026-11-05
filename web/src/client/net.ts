// 手機端的連線：開房、查房、WebSocket 進房、自動重連。
// 座位憑證存在 localStorage，重新整理或斷線後會自動回到同一個座位。
import type { ClientMsg, ServerMsg } from "../server/protocol";

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

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("開房失敗，請再試一次");
  return (await res.json()).code;
}

export async function roomInfo(code: string): Promise<{ exists: boolean; seats?: boolean[]; started?: boolean }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error("連不上伺服器");
  return res.json();
}

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private pingTimer: number | undefined;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};

  constructor(public readonly code: string, private name: string) {}

  open() {
    this.stopped = false;
    this.onStatus(this.retry === 0 ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: "hello", token: savedToken(this.code), name: this.name });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), 25000) as unknown as number;
    };
    ws.onmessage = ev => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "welcome") {
        this.retry = 0;
        store.set(tokenKey(this.code), m.token);
        store.set(LAST_ROOM_KEY, this.code);
        this.onStatus("open");
      }
      if (m.t === "full" || m.t === "gone") this.stopped = true;   // 不要一直重試
      this.onMessage(m);
    };
    ws.onclose = ev => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      if (this.stopped || ev.code === 4000) { this.onStatus("closed"); return; }   // 4000 = 被同座位的新分頁取代
      this.retry++;
      this.onStatus("reconnecting");
      setTimeout(() => { if (!this.stopped) this.open(); }, Math.min(8000, 400 * 2 ** Math.min(this.retry, 5)));
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
