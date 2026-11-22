// transport.js — 輸入與狀態廣播的統一介面
//   所有模式都只用兩個方法：
//     transport.sendInput({ seat, type: "down" | "up", btn: "L" | "M" | "R" })
//     transport.onStateUpdate(({ view, events }) => …)        // view = engine.viewFor(觀看者)，events = 這一幀的事件
//   · LocalTransport：本機跑 engine（同機雙人、教學）
//   · AITransport：本機跑 engine，第二個座位交給 AIPlayer（AI 只拿得到自己座位看得到的資料）
//   · WebSocketTransport：伺服器跑 engine，這裡只送按鍵、收畫面（後端下一步補上）
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

// 線上：瀏覽器只送按鍵、收伺服器算好的畫面（伺服器跑同一份 engine.js）
//   協定（JSON）：
//     → { t: "join", room }                         ← { t: "welcome", seat }
//     → { t: "input", type, btn }                   ← { t: "state", view, events }
//     ← { t: "error", msg }、{ t: "peer", online }  （對手上線／離線）
export class WebSocketTransport extends Transport {
  constructor({ room, url } = {}) {
    super();
    this.room = room;
    this.url = url ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${CONFIG.net.path}${encodeURIComponent(room)}`;
    this.ws = null; this.open = false; this.lastView = null; this.queue = [];
    this.connect();
  }
  connect() {
    this.status({ state: "connecting", room: this.room });
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.status({ state: "error", msg: "無法建立連線" }); return; }
    this.ws = ws;
    ws.onopen = () => { this.open = true; ws.send(JSON.stringify({ t: "join", room: this.room })); this.status({ state: "open", room: this.room }); };
    ws.onmessage = m => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.t === "welcome") { this.seat = msg.seat; this.status({ state: "joined", seat: msg.seat, room: this.room }); }
      else if (msg.t === "state") { this.lastView = msg.view; this.queue.push(...(msg.events ?? [])); }
      else if (msg.t === "peer") this.status({ state: msg.online ? "peer_online" : "peer_offline" });
      else if (msg.t === "error") this.status({ state: "error", msg: msg.msg });
    };
    ws.onerror = () => this.status({ state: "error", msg: "連不上伺服器（線上對戰後端還沒上線）" });
    ws.onclose = () => { this.open = false; this.status({ state: "closed" }); };
  }
  sendInput({ type, btn }) { if (this.open) this.ws.send(JSON.stringify({ t: "input", type, btn })); }
  update() { if (this.lastView) this.publish({ view: this.lastView, events: this.queue.splice(0) }); }
  close() { super.close(); try { this.ws?.close(); } catch { /* 已關 */ } }
}

// 4 碼房號（去掉容易看錯的 0／O、1／I）
export function makeRoomCode(rng = Math.random) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: CONFIG.net.roomCodeLength }, () => A[Math.floor(rng() * A.length)]).join("");
}
export const isRoomCode = s => new RegExp(`^[A-Z2-9]{${CONFIG.net.roomCodeLength}}$`).test(s);
