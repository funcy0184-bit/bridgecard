// gameRoom.js（拳刃交鋒）— 一個 4 碼房號 = 一個 GameRoom Durable Object
//   · 權威伺服器：跑跟前端同一份 engine.js；瀏覽器只送按鍵，所有判定（猜拳、連打、彈反、翻滾、擊飛）都在這裡算
//   · 時間軸：房內計時器固定 1/120 秒推進引擎，各階段的切換都由伺服器時鐘決定；
//            每則 state 附 serverTime 與 phaseEndTime，前端依此對齊倒數條
//   · v3 規則（沒有走位）：猜拳 → 開牌停頓 PHASE_REVEAL → 連打／終結擇／判定窗；
//     平手累積 2 次（view.gauge／gaugeMax，公開）→ 五連斬拼刀 PHASE_CLASH_INPUT（3.5 秒）→ PHASE_CLASH_ANIM（五刀＋主招大招）
//       - 武器過熱：view.fighters[i].heat 公開同步給雙方（誰禁用哪招）
//       - 拼刀蓄力：第 1 次平手只「叮！」彈開（gauge 事件），集滿才拼刀；拼刀結算或有人落台歸零
//       - 拼刀預輸入：伺服器保密雙方 5 招序列，只廣播「填了幾格」（clash_input）與誰搶到先手（clash_first）；
//         填了什麼（clash_pick）只送給本人，view.clash.seq 對手那格是 null；3.5 秒到（沒填滿伺服器隨機補）或雙方都填完才進對砍、全公開
//       - 對砍時間軸、勝負、主招（clash_cut／clash_result／clash_finisher）全由伺服器決定，前端只播演出
//   · 隱藏資訊：每個座位只收 engine.viewFor(自己) ＋ 自己看得到的事件
//       - 猜拳前 1.3 秒：架式（stance 事件）即時轉發給對手播前搖
//       - 最後 0.5 秒藏招：只記錄、絕不轉發；對手畫面上的你永遠是「hidden」，直到鎖定結算（rps_result）一起公佈
//       - 終結擇：攻方選的手勢、蓄力起手都不送守方，判定窗亮起才公開
//   · 連打：攻方每一下按鍵都送上來，伺服器自己數「每 2 下追加 1 拳、上限 4 拳」，命中事件即時廣播給守方播火花與震動
//   · 判定窗延遲寬容：引擎 windowGrace = 80ms（畫面倒數仍是 0.5 秒，伺服器多收 80ms 內抵達的按鍵）
//   · 房內流程：lobby（READY）→ countdown（3 秒）→ playing ⇄ paused（斷線 15 秒）→ over（Rematch／離開）
//   · alarm()：房間閒置 30 分鐘後清掉，房號釋出
//
//   協定（JSON）
//     → { t: "join", token? }                 ← { t: "welcome", seat, token, room, serverTime }
//     → { t: "ready", on }                    ← { t: "lobby", status, seats, countdownEnd, winner, reason, pauseSeat, pauseUntil, serverTime }
//     → { t: "input", type, btn }             ← { t: "state", view, events, serverTime, phaseEndTime }
//     → { t: "rematch" } / { t: "leave" }     ← { t: "error", code, msg }
//     → { t: "ping", c }                      ← { t: "pong", c, s }
//     → { t: "emote", i }                     ← { t: "emote", seat, i }（固定 8 個表情、每人 1.5 秒一次）
//     → { t: "settings", guide }（只有房主）    ← lobby.settings
//   暱稱：join 時帶 name，伺服器清掉控制字元／零寬字元、最多 8 個字
import { DurableObject } from "cloudflare:workers";
import { Engine, PH, mulberry32 } from "../../../public/fist/src/engine.js";
import { CONFIG } from "../../../public/fist/src/config.js";

const N = CONFIG.net, STEP = 1 / N.tickHz;
const TICK_MS = 1000 / 60, BROADCAST_MS = 1000 / N.broadcastHz;
const MAX_MSG = 512, MSG_PER_SEC = 120;
const seatInit = () => ({ token: null, ws: null, ready: false, rematch: false, releaseTimer: null, name: "", lastEmote: 0 });
// 暱稱清洗：去控制字元、零寬與方向控制字元，最多 nameMax 個字；空的就用預設名
export function cleanName(raw, seat) {
  const s = String(raw ?? "").normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF<>]/g, "").replace(/\s+/g, " ").trim();
  const name = [...s].slice(0, CONFIG.profile.nameMax).join("").trim();
  return name || CONFIG.names[seat];
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.meta = null;
    this.seats = [seatInit(), seatInit()];
    this.conns = new Set();
    this.status = "lobby";                // lobby | countdown | playing | paused | over
    this.engine = null; this.loop = null; this.acc = 0; this.last = 0; this.lastSent = 0;
    this.countdownEnd = 0; this.countTimer = null;
    this.pauseSeat = -1; this.pauseUntil = 0; this.pauseTimer = null;
    this.winner = -1; this.reason = null;
    this.settings = { guide: CONFIG.guide.default };   // 房主設定：新手引導（雙方預設值）
  }

  // ---------------- HTTP ----------------
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/init") {                          // 建房：沒被佔用才給
      if (await this.ctx.storage.get("meta")) return new Response("taken", { status: 409 });
      this.meta = { code: url.searchParams.get("code"), createdAt: Date.now(), activeAt: Date.now() };
      await this.ctx.storage.put("meta", this.meta);
      await this.ctx.storage.setAlarm(Date.now() + N.roomIdleMin * 60e3);
      return new Response("ok");
    }
    if (url.pathname === "/ws") {
      this.meta ??= await this.ctx.storage.get("meta");
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      if (!this.meta) {                                      // 房號不存在：告訴前端，再關掉
        server.send(JSON.stringify({ t: "error", code: "no_room", msg: `找不到房間 ${url.searchParams.get("code")}，請確認房號或請朋友重新建立` }));
        server.close(4004, "no_room");
        return new Response(null, { status: 101, webSocket: client });
      }
      this.attach(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  // 閒置清房：沒人在線而且超過 30 分鐘沒動靜 → 刪掉，房號釋出
  async alarm() {
    const online = this.seats.some(s => s.ws);
    const idle = Date.now() - (this.meta?.activeAt ?? 0) > N.roomIdleMin * 60e3;
    if (!online && idle) { this.stopLoop(); await this.ctx.storage.deleteAll(); this.meta = null; return; }
    await this.ctx.storage.setAlarm(Date.now() + N.roomIdleMin * 60e3);
  }
  touch() { if (this.meta) { this.meta.activeAt = Date.now(); this.ctx.storage.put("meta", this.meta); } }

  // ---------------- 連線 ----------------
  attach(ws) {
    const conn = { ws, seat: -1, win: Date.now(), count: 0 };
    this.conns.add(conn);
    ws.addEventListener("message", ev => this.onMessage(conn, ev.data));
    const gone = () => this.onClose(conn);
    ws.addEventListener("close", gone);
    ws.addEventListener("error", gone);
  }
  send(ws, msg) { try { ws?.send(JSON.stringify(msg)); } catch { /* 對方已斷 */ } }
  sendSeat(seat, msg) { this.send(this.seats[seat].ws, msg); }
  broadcast(msg) { for (const s of this.seats) this.send(s.ws, msg); }

  onMessage(conn, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return;
    const now = Date.now();                                      // 簡單限流：每秒最多 120 則（狂按連打也用不到這麼多）
    if (now - conn.win > 1000) { conn.win = now; conn.count = 0; }
    if (++conn.count > MSG_PER_SEC) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "ping") { this.send(conn.ws, { t: "pong", c: m.c, s: Date.now() }); return; }
    if (m.t === "join") { this.join(conn, typeof m.token === "string" ? m.token : null, m.name); return; }
    const seat = conn.seat;
    if (seat < 0 || this.seats[seat].ws !== conn.ws) return;    // 還沒入座／已被同座位的新分頁取代
    if (m.t === "input") {
      if (this.status !== "playing") return;                    // 暫停、倒數、待機中的按鍵一律不收
      if ((m.type === "down" || m.type === "up") && (m.btn === "L" || m.btn === "M" || m.btn === "R")) this.engine.input(seat, m.type, m.btn);
    } else if (m.t === "ready") {
      if (this.status !== "lobby" && this.status !== "countdown") return;
      this.seats[seat].ready = !!m.on;
      if (!m.on && this.status === "countdown") this.cancelCountdown();
      this.lobbyChanged();
    } else if (m.t === "rematch") {
      if (this.status !== "over") return;
      this.seats[seat].rematch = true;
      this.lobbyChanged();
    } else if (m.t === "emote") {
      const s = this.seats[seat];
      if (!Number.isInteger(m.i) || m.i < 0 || m.i >= CONFIG.emotes.length || now - s.lastEmote < CONFIG.emoteGapMs) return;   // 只認固定表情、限流
      s.lastEmote = now;
      this.broadcast({ t: "emote", seat, i: m.i });
    } else if (m.t === "settings") {
      if (seat !== 0 || (this.status !== "lobby" && this.status !== "over")) return;   // 只有房主、只能在待機／結算時改
      if (typeof m.guide === "boolean") this.settings.guide = m.guide;
      this.lobbyChanged();
    } else if (m.t === "leave") {
      this.leave(seat);
      try { conn.ws.close(1000, "leave"); } catch { /* 已關 */ }
    }
  }

  join(conn, token, name) {
    if (conn.seat >= 0) return;
    let seat = token ? this.seats.findIndex(s => s.token === token) : -1;
    if (seat >= 0) {                                             // 同一位玩家回來（重整、斷線重連）：舊連線讓位
      const old = this.seats[seat].ws;
      if (old && old !== conn.ws) { this.seats[seat].ws = null; try { old.close(4000, "replaced"); } catch { /* 已關 */ } }
    } else {
      seat = this.seats.findIndex(s => !s.token);
      if (seat < 0) { this.send(conn.ws, { t: "error", code: "full", msg: "房間已滿（兩位玩家都在）" }); try { conn.ws.close(4009, "full"); } catch { /* 已關 */ } return; }
      this.seats[seat].token = crypto.randomUUID();
    }
    const s = this.seats[seat];
    s.name = cleanName(name, seat);
    clearTimeout(s.releaseTimer); s.releaseTimer = null;
    s.ws = conn.ws; conn.seat = seat;
    this.touch();
    this.send(conn.ws, { t: "welcome", seat, token: s.token, room: this.meta.code, serverTime: Date.now() });
    if (this.status === "paused" && this.pauseSeat === seat) this.resume();
    this.lobbyChanged();
    if (this.engine) this.sendState(seat, []);                  // 重連：立刻補一張目前畫面（無縫接續）
  }

  onClose(conn) {
    this.conns.delete(conn);
    const seat = conn.seat;
    if (seat < 0 || this.seats[seat].ws !== conn.ws) return;
    const s = this.seats[seat];
    s.ws = null; s.ready = false;
    if (this.status === "playing") this.pause(seat);
    else if (this.status === "paused") { /* 另一位也斷了：等計時器處理 */ }
    else {
      if (this.status === "countdown") this.cancelCountdown();
      s.rematch = false;
      s.releaseTimer = setTimeout(() => { if (!s.ws) { this.seats[seat] = seatInit(); this.lobbyChanged(); } }, N.reconnectSec * 1000);   // 15 秒內回來座位還在
    }
    this.lobbyChanged();
  }

  leave(seat) {
    const s = this.seats[seat];
    clearTimeout(s.releaseTimer);
    if (this.status === "playing" || this.status === "paused") this.finish(1 - seat, "leave");
    if (this.status === "countdown") this.cancelCountdown();
    this.seats[seat] = seatInit();
    for (const o of this.seats) o.rematch = false;
    if (this.status === "over") this.status = "lobby";
    this.lobbyChanged();
  }

  // ---------------- 房內流程 ----------------
  lobbyChanged() {
    const both = this.seats.every(s => s.ws);
    if (this.status === "lobby" && both && this.seats.every(s => s.ready)) this.startCountdown();
    else if (this.status === "over" && both && this.seats.every(s => s.rematch)) this.startCountdown();
    this.broadcast(this.lobbyMsg());
  }
  lobbyMsg() {
    return {
      t: "lobby", status: this.status, room: this.meta?.code, serverTime: Date.now(),
      seats: this.seats.map((s, i) => ({ taken: !!s.token, online: !!s.ws, ready: s.ready, rematch: s.rematch, name: s.token ? s.name || CONFIG.names[i] : "" })),
      settings: this.settings,
      countdownEnd: this.status === "countdown" ? this.countdownEnd : 0,
      winner: this.winner, reason: this.reason,
      pauseSeat: this.status === "paused" ? this.pauseSeat : -1, pauseUntil: this.status === "paused" ? this.pauseUntil : 0,
    };
  }
  startCountdown() {
    this.status = "countdown";
    this.countdownEnd = Date.now() + N.readyCountdownSec * 1000;
    clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => this.startMatch(), N.readyCountdownSec * 1000);
  }
  cancelCountdown() {
    clearTimeout(this.countTimer); this.countTimer = null;
    this.status = this.engine && this.winner >= 0 ? "over" : "lobby";
    this.countdownEnd = 0;
  }
  startMatch() {
    if (!this.seats.every(s => s.ws)) { this.cancelCountdown(); this.lobbyChanged(); return; }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.engine = new Engine({ rng: mulberry32(seed), windowGrace: N.windowGraceMs / 1000 });
    for (const s of this.seats) { s.ready = false; s.rematch = false; }
    this.status = "playing"; this.winner = -1; this.reason = null;
    this.broadcast(this.lobbyMsg());
    this.startLoop();
    for (const seat of [0, 1]) this.sendState(seat, []);
  }
  startLoop() {
    this.stopLoop();
    this.acc = 0; this.last = Date.now(); this.lastSent = 0;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }
  stopLoop() { clearInterval(this.loop); this.loop = null; }

  // 伺服器時鐘推進引擎：有事件就馬上送，沒事件也每 1/30 秒同步一次畫面
  tick() {
    if (this.status !== "playing") return;
    const now = Date.now();
    this.acc += Math.min(250, now - this.last) / 1000; this.last = now;
    const events = [];
    while (this.acc >= STEP) { events.push(...this.engine.step(STEP)); this.acc -= STEP; }
    if (events.length || now - this.lastSent >= BROADCAST_MS) { for (const seat of [0, 1]) this.sendState(seat, events); this.lastSent = now; }
    if (this.engine.phase === PH.GAMEOVER) this.finish(this.engine.winner, "ko");
  }
  sendState(seat, events) {
    const s = this.seats[seat];
    if (!s.ws || !this.engine) return;
    const view = this.engine.viewFor(seat), now = Date.now();
    const vis = events.filter(e => e.private === undefined || e.private === seat);   // 藏招／終結擇／蓄力：對手的私密事件絕不轉發
    this.send(s.ws, { t: "state", view, events: vis, serverTime: now, phaseEndTime: now + Math.max(0, view.dur - view.t) * 1000 });
  }

  pause(seat) {
    this.status = "paused"; this.pauseSeat = seat; this.pauseUntil = Date.now() + N.reconnectSec * 1000;
    this.stopLoop();
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this.pauseExpired(), N.reconnectSec * 1000);
  }
  resume() {
    clearTimeout(this.pauseTimer); this.pauseTimer = null;
    if (this.seats.every(s => s.ws)) { this.status = "playing"; this.pauseSeat = -1; this.pauseUntil = 0; this.startLoop(); }
    else { this.pauseSeat = this.seats.findIndex(s => !s.ws); this.pauseUntil = Date.now() + N.reconnectSec * 1000; this.pauseTimer = setTimeout(() => this.pauseExpired(), N.reconnectSec * 1000); }
  }
  pauseExpired() {
    if (this.status !== "paused") return;
    const stay = this.seats.findIndex(s => s.ws);
    this.finish(stay, "disconnect");                            // 超時：留在房內的人獲勝（兩人都不在就沒有勝者）
    this.seats.forEach((s, i) => { if (!s.ws) this.seats[i] = seatInit(); });
    this.lobbyChanged();
  }
  finish(winner, reason) {
    this.stopLoop();
    clearTimeout(this.pauseTimer); this.pauseTimer = null;
    this.winner = winner; this.reason = reason; this.status = "over"; this.pauseSeat = -1;
    if (this.engine && this.engine.phase !== PH.GAMEOVER) {     // 斷線／離開判勝：引擎直接進比賽結束
      this.engine.winner = winner;
      this.engine.go(PH.GAMEOVER, null, true);
      const ev = this.engine.step(0);
      for (const seat of [0, 1]) this.sendState(seat, ev);
    }
    this.touch();
    this.broadcast(this.lobbyMsg());
  }
}
