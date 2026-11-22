// transport.js — 輸入與狀態廣播的統一介面
//   所有模式都只用兩個方法：
//     transport.sendInput({ seat, type: "down" | "up", btn: "L" | "M" | "R" })
//     transport.onStateUpdate(({ view, events }) => …)        // view = engine.viewFor(觀看者)，events = 這一幀的事件
//   · LocalTransport：本機跑 engine（同機雙人、教學）
//   · AITransport：本機跑 engine，第二個座位交給 AIPlayer（AI 只拿得到自己座位看得到的資料）
//   · WebSocketTransport：伺服器（fist-online）跑 engine，這裡只送按鍵、收畫面
import { CONFIG } from "./config.js";
import { Engine } from "./engine.js";
import { AIPlayer } from "./ai.js";

const STEP = 1 / 120;                                     // 固定步長

export class Transport {
  constructor() { this._subs = []; this._status = []; this.seat = -1; }
  onStateUpdate(cb) { this._subs.push(cb); return () => { this._subs = this._subs.filter(x => x !== cb); }; }
  onStatus(cb) { this._status.push(cb); return () => { this._status = this._status.filter(x => x !== cb); }; }
  publish(msg) { for (const cb of this._subs) cb(msg); }
  status(s) { for (const cb of this._status) cb(s); }
  sendInput(action) {}
  update(dt) {}
  close() { this._subs = []; this._status = []; }
}

export class LocalTransport extends Transport {
  /**
   * @param {object} o
   * @param {number} [o.viewer]  畫面以誰的角度看（-1＝同機雙人共用螢幕）
   * @param {Array} [o.bots]     本機電腦玩家（AIPlayer 或教學腳本），每個都有 seat、attach(port)、update(dt)
   */
  constructor({ setup, flow, viewer = -1, rng, bots = [] } = {}) {
    super();
    this.engine = new Engine({ setup, flow, rng });
    this.viewer = viewer; this.seat = viewer; this.bots = bots; this.acc = 0; this.paused = false;
    for (const bot of bots) bot.attach({ view: () => this.engine.viewFor(bot.seat), input: (type, btn) => this.engine.input(bot.seat, type, btn) });
  }
  sendInput({ seat, type, btn }) { this.engine.input(seat, type, btn); }
  update(dt) {
    if (this.paused) { this.publish({ view: this.engine.viewFor(this.viewer), events: [] }); return; }
    this.acc += Math.min(dt, 0.1);
    const events = [];
    while (this.acc >= STEP) {
      for (const bot of this.bots) bot.update(STEP);
      events.push(...this.engine.step(STEP));
      this.acc -= STEP;
    }
    // 不屬於這位觀看者的私密事件（例如藏招時對手換了什麼）不往外送
    const vis = events.filter(e => e.private === undefined || this.viewer === -1 || e.private === this.viewer);
    this.publish({ view: this.engine.viewFor(this.viewer), events: vis });
  }
}

export class AITransport extends LocalTransport {
  constructor({ difficulty = "mid", setup, rng } = {}) {
    super({ setup, rng, viewer: 0, bots: [new AIPlayer(1, difficulty, rng)] });
    this.difficulty = difficulty;
  }
  sendInput({ type, btn }) { this.engine.input(0, type, btn); }   // 玩家一律是 P1
}

// 線上：瀏覽器只送按鍵、收伺服器算好的畫面（伺服器 fist-online/worker/gameRoom.js 跑同一份 engine.js）
//   協定見 gameRoom.js 開頭。這裡多做三件事：
//     1. 時間對齊：ping/pong 估算來回延遲與時鐘差，倒數條用 phaseEndTime − 伺服器現在時間 算，不會因為封包間隔一頓一頓
//     2. 位置平滑：伺服器每秒送 30 張畫面，角色座標在兩張之間平滑追上
//     3. 斷線自動重連：帶同一個 token 回來就回到原座位（重整頁面也一樣，token 存 sessionStorage）
const store = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 無痕模式 */ } },
};
export function apiUrl(path) { return new URL(path, location.href).href; }
export async function createRoom() {
  const r = await fetch(apiUrl(CONFIG.net.apiPath), { method: "POST" });
  if (!r.ok) throw new Error(r.status === 503 ? "房間太多了，請稍後再試" : `建立房間失敗（${r.status}）`);
  const j = await r.json();
  if (!isRoomCode(j.room)) throw new Error("伺服器回傳的房號格式不對");
  return j.room;
}
export function inviteLink(room) { const u = new URL(location.href); u.search = ""; u.hash = ""; u.searchParams.set("room", room); return u.href; }

export class WebSocketTransport extends Transport {
  constructor({ room, url } = {}) {
    super();
    this.room = room;
    const u = new URL(CONFIG.net.wsPath + encodeURIComponent(room), location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.url = url ?? u.href;
    this.token = store.get("fist.token." + room);
    this.ws = null; this.open = false; this.closedByUser = false; this.fatal = false; this.retry = 0;
    this.target = null; this.disp = null; this.queue = []; this.lobby = null;
    this.offset = 0; this.rtt = null; this.pingTimer = null; this.pingSent = new Map();
    this.connect();
  }
  connect() {
    this.status({ state: this.retry ? "reconnecting" : "connecting", room: this.room, retry: this.retry });
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.status({ state: "error", msg: "無法建立連線" }); return; }
    this.ws = ws;
    ws.onopen = () => { this.open = true; this.retry = 0; this.raw({ t: "join", token: this.token }); this.ping(); setTimeout(() => this.ping(), 300); };
    ws.onmessage = m => { let msg; try { msg = JSON.parse(m.data); } catch { return; } this.onMsg(msg); };
    ws.onerror = () => {};
    ws.onclose = ev => {
      this.open = false; clearInterval(this.pingTimer); this.pingTimer = null;
      if (this.closedByUser) return;
      if (this.fatal) return;                                                    // 房號不存在／房間已滿：保留伺服器的錯誤訊息，不重連
      if (ev.code === 4000) { this.status({ state: "closed", code: ev.code }); return; }   // 4000：同座位在別的分頁開了
      if (this.retry === 0 && !this.lobby && !this.target) { this.status({ state: "error", msg: "連不上伺服器（線上對戰需要 fist-online 後端，見 README）" }); }
      this.retry++;
      const wait = Math.min(4000, 500 * 2 ** (this.retry - 1));
      this.status({ state: "reconnecting", retry: this.retry, wait });
      this.rt = setTimeout(() => this.connect(), wait);
    };
  }
  raw(o) { if (this.open) try { this.ws.send(JSON.stringify(o)); } catch { /* 斷線中 */ } }
  ping() {
    if (!this.pingTimer) this.pingTimer = setInterval(() => this.ping(), CONFIG.net.pingEveryMs);   // 每 15 秒心跳
    const c = Date.now(); this.raw({ t: "ping", c });
  }
  serverNow() { return Date.now() + this.offset; }
  onMsg(m) {
    if (m.t === "welcome") {
      this.seat = m.seat; this.token = m.token; store.set("fist.token." + this.room, m.token);
      this.offset = m.serverTime - Date.now();
      this.status({ state: "joined", seat: m.seat, room: this.room });
    } else if (m.t === "pong") {
      const now = Date.now(), rtt = now - m.c;
      if (this.rtt === null || rtt < this.rtt * 1.5) this.offset = m.s - (m.c + rtt / 2);   // 延遲突然暴增那次不拿來校時
      this.rtt = rtt;
      this.status({ state: "ping", rtt });
    } else if (m.t === "lobby") {
      this.lobby = m;
      this.status({ state: "lobby", lobby: m });
    } else if (m.t === "state") {
      this.target = m.view; this.targetAt = m.serverTime; this.phaseEndTime = m.phaseEndTime;
      if (!this.disp || m.view.phase !== this.disp.phase) this.disp = structuredClone(m.view);
      this.queue.push(...(m.events ?? []));
    } else if (m.t === "error") {
      if (m.code === "no_room" || m.code === "full") this.fatal = true;
      this.status({ state: "error", code: m.code, msg: m.msg });
    }
  }
  sendInput({ type, btn }) { this.raw({ t: "input", type, btn }); }
  setReady(on) { this.raw({ t: "ready", on }); }
  rematch() { this.raw({ t: "rematch" }); }
  leave() { this.raw({ t: "leave" }); this.closedByUser = true; setTimeout(() => this.close(), 50); }
  update(dt) {
    const T = this.target;
    if (!T) return;
    const paused = this.lobby?.status === "paused";
    // 畫面：大部分欄位直接用伺服器最新的；倒數依 phaseEndTime 對齊；座標平滑追上
    const d = this.disp, k = 1 - Math.exp(-30 * dt);
    const view = { ...T, fighters: T.fighters.map((f, i) => {
      const p = d.fighters[i];
      const far = Math.abs(f.x - p.x) > 60 || Math.abs(f.y - p.y) > 60;      // 重生、換位：直接跳過去
      p.x = far ? f.x : p.x + (f.x - p.x) * k; p.y = far ? f.y : p.y + (f.y - p.y) * k;
      return { ...f, x: p.x, y: p.y };
    }) };
    if (T.dur > 0 && !paused) view.t = Math.min(T.dur, Math.max(T.t, T.dur - (this.phaseEndTime - this.serverNow()) / 1000));
    d.phase = T.phase;
    this.publish({ view, events: this.queue.splice(0) });
  }
  close() { this.closedByUser = true; clearTimeout(this.rt); clearInterval(this.pingTimer); super.close(); try { this.ws?.close(); } catch { /* 已關 */ } }
}

// 4 碼房號（去掉容易看錯的 0／O、1／I）
export function makeRoomCode(rng = Math.random) {
  const A = CONFIG.net.codeAlphabet;
  return Array.from({ length: CONFIG.net.roomCodeLength }, () => A[Math.floor(rng() * A.length)]).join("");
}
export const isRoomCode = s => typeof s === "string" && new RegExp(`^[${CONFIG.net.codeAlphabet}]{${CONFIG.net.roomCodeLength}}$`).test(s);
