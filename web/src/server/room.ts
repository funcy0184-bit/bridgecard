// 一個房間 = 一個 Durable Object（雲端上唯一的權威）。
//   · 洗牌、發牌、判斷能不能出、誰贏這墩、計分、整場勝負：全部在這裡用正式規則引擎做；手機只送「我想做什麼」
//   · 每一支手機只收到自己座位看得到的東西（對手手牌、牌堆、別人摸到的暗牌都不送）
//   · 每次成功的操作先寫進 SQLite（同一個交易），寫成功才回覆、才廣播
//   · 斷線、重新整理、房間重新開機：都從存檔回到同一桌；對局中斷線先暫停，超過時限照中離規則判
import { DurableObject } from "cloudflare:workers";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { illegalReason } from "../game/explain";
import { Action as LSAction, LSEvent, LSState, LastStandGame } from "../laststand/engine";
import { deal } from "../laststand/rules";
import {
  ClientMsg, EMOTE_COUNT, EMOTE_WINDOW_MS, MODES, Notice, PROTOCOL_VERSION, RejectCode, RoomView, ServerMsg, TIMING, Timing,
  checkName, checkStake, checkVow, emoteAllowed,
} from "./protocol";
import {
  RoomMeta, canSeatNew, deadlines, finishMatch, forfeit, inMatch, join, leave, markOffline, markOnline, newRoom, seatOfToken, setMode, setName, setReady, setRematch, setStake, startMatch,
} from "./lobby";
import { RoomStore, randomId, randomToken, sha256 } from "./store";
import { RecordRow, highlights, pairStats } from "./records";
import type { Limiter } from "./limiter";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LIMITER: DurableObjectNamespace<Limiter>;
  ASSETS: Fetcher;
  // 只給本機測試用：把斷線時間軸縮短（正式環境不設定，用 protocol.ts 的預設值）
  NOTICE_MS?: string; CHOICE_MS?: string; FORFEIT_MS?: string; SEAT_HOLD_MS?: string; RESUME_KEEP_MS?: string; RECORD_KEEP_MS?: string;
}

interface Attachment { seat: number }
const cryptoRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const COMMAND_KEEP_MS = 24 * 3600_000;
const CLOSED_EMPTY_MS = 60_000;          // 兩人都離開、沒有戰績的房：一分鐘後清掉

export class Room extends DurableObject<Env> {
  private store: RoomStore;
  private meta: RoomMeta | null = null;
  private game: HoneymoonGame | null = null;
  private pending: { e: GameEvent; to: number }[] = [];
  private ls: LastStandGame | null = null;            // 梭了啦（跟經典牌局分開）
  private lsPending: { e: LSEvent; to: number }[] = [];
  private timing: Timing;
  private trickAt = 0;                   // 兩張牌都上桌：這個時間點結算這一墩
  private records: RecordRow[] | null = null;
  private emoteTimes: [number[], number[]] = [[], []];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStore(ctx.storage);
    const n = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
    this.timing = {
      ...TIMING,
      notice: n(env.NOTICE_MS, TIMING.notice), choice: n(env.CHOICE_MS, TIMING.choice), forfeit: n(env.FORFEIT_MS, TIMING.forfeit),
      seatHold: n(env.SEAT_HOLD_MS, TIMING.seatHold), resumeKeep: n(env.RESUME_KEEP_MS, TIMING.resumeKeep), recordKeep: n(env.RECORD_KEEP_MS, TIMING.recordKeep),
    };
    ctx.blockConcurrencyWhile(async () => {
      await this.store.migrate();
      this.meta = this.store.loadMeta();
      const saved = this.store.loadGame();
      if (saved?.kind === "laststand") this.attachLS(LastStandGame.restore(saved.snapshot as LSState));
      else if (saved) this.attach(HoneymoonGame.restore(saved.snapshot as GameSnapshot, cryptoRng));
      if (!this.meta) return;
      // 房間重新開機（部署、閒置被收走）：沒有連線的座位當作斷線，中離照存下來的斷線時間算
      const online = this.onlineSeats();
      let changed = false;
      this.meta.seats.forEach((s, i) => { if (s && !online[i] && s.offlineSince === null) changed = markOffline(this.meta!, i, Date.now()) || changed; });
      if (changed) this.store.commit({ meta: this.meta });
      if (this.game?.trickComplete) this.trickAt = Date.now() + this.timing.trickPause;
      await this.scheduleAlarm();
    });
  }

  private attach(g: HoneymoonGame) {
    this.game = g;
    g.on((e, to) => this.pending.push({ e, to }));
  }
  private attachLS(g: LastStandGame) {
    this.ls = g;
    g.on((e, to) => this.lsPending.push({ e, to }));
  }

  // ---------------- HTTP：建立房間、查房間、升級成 WebSocket ----------------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init" && req.method === "POST") {
      if (this.meta) return new Response("exists", { status: 409 });
      this.meta = newRoom(await req.text(), Date.now());
      this.store.commit({ meta: this.meta });
      await this.scheduleAlarm();
      return new Response("created", { status: 201 });
    }
    if (url.pathname === "/info") {
      const m = this.meta;
      // 邀請畫面用：房主的暱稱（顯示用）、玩法、哪些位子有人；沒有憑證、沒有牌局
      return Response.json(m ? { exists: true, status: m.status, seats: m.seats.map(s => !!s), started: m.status !== "WAITING" && m.status !== "READY",
        host: m.seats[m.host]?.name ?? "", mode: m.mode } : { exists: false });
    }
    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      if (!this.meta) { this.send(server, { t: "gone" }); server.close(4404, "room not found"); }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  // ---------------- WebSocket ----------------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.meta) { this.send(ws, { t: "gone" }); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { this.send(ws, { t: "error", msg: "看不懂的訊息" }); return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.t === "ping") { this.send(ws, { t: "pong" }); return; }
    if (msg.t === "hello") { await this.hello(ws, msg); return; }

    const seat = this.seatOf(ws);
    if (seat < 0) { this.send(ws, { t: "error", msg: "請先進房。" }); return; }
    if (msg.t === "emote") { this.emote(seat, msg.i); return; }
    if (msg.t === "sync") { this.resync(ws, seat); return; }
    if (msg.t === "recap") { this.recap(ws, seat, msg.gid); return; }

    // 同一個指令編號重送：回同一個結果，不重複生效
    const cid = typeof (msg as { cid?: unknown }).cid === "string" ? (msg as { cid: string }).cid.slice(0, 64) : undefined;
    if (cid) {
      const prev = this.store.command(cid);
      if (prev) {
        if (prev.ok) this.send(ws, { t: "ack", cid, ver: this.meta.ver });
        else { this.send(ws, { t: "reject", cid, code: prev.code as RejectCode, msg: prev.msg, ver: this.meta.ver }); if (prev.code === "STALE") this.resync(ws, seat); }
        return;
      }
    }

    switch (msg.t) {
      case "ready": this.onReady(ws, seat, cid, !!msg.ready); break;
      case "mode": this.onMode(ws, seat, cid, msg.mode); break;
      case "name": this.onName(ws, seat, cid, msg.name); break;
      case "stake": this.onStake(ws, seat, cid, msg.stake, msg.vow); break;
      case "ls": this.onLS(ws, seat, cid, msg); break;
      case "rematch": this.onRematch(ws, seat, cid, !!msg.ready); break;
      case "leave": this.onLeave(ws, seat, cid, !!msg.forfeit); break;
      case "play": case "call": case "next": this.onGame(ws, seat, cid, msg); break;
      default: this.send(ws, { t: "error", msg: "看不懂的指令" });
    }
  }

  async webSocketClose(ws: WebSocket) { this.dropped(ws); }
  async webSocketError(ws: WebSocket) { this.dropped(ws); }

  // 一條連線斷了：這個座位沒有別的連線，才算斷線（對局中 → 暫停，開始算中離時間）
  private dropped(ws: WebSocket) {
    const m = this.meta;
    const seat = this.seatOf(ws);
    if (!m || seat < 0) return;
    ws.serializeAttachment({ seat: -1 } satisfies Attachment);
    if (this.ctx.getWebSockets().some(o => o !== ws && this.seatOf(o) === seat)) return;
    if (markOffline(m, seat, Date.now())) {
      this.store.commit({ meta: m });
      this.broadcastRoom("disconnected", seat);
      void this.scheduleAlarm();
    }
  }

  private async hello(ws: WebSocket, msg: Extract<ClientMsg, { t: "hello" }>) {
    if (msg.v !== PROTOCOL_VERSION) {
      this.send(ws, { t: "error", code: "VERSION", msg: "遊戲更新了，重新整理一下頁面就好。" });
      ws.close(4426, "version");
      return;
    }
    // 先把需要等待的雜湊算好，後面全部同步做完（中間不讓別的訊息插進來）
    const th = typeof msg.token === "string" && msg.token ? await sha256(msg.token.slice(0, 128)) : null;
    const fresh = randomToken();
    const freshHash = await sha256(fresh);
    const m = this.meta;
    if (!m) { this.send(ws, { t: "gone" }); ws.close(4404, "gone"); return; }
    const now = Date.now();
    // 新的人要坐下：暱稱一定要合格（拿憑證回來的人沿用原本的暱稱，這次送來的名字不管）
    let name = "";
    if (seatOfToken(m, th) < 0 && canSeatNew(m)) {
      const v = checkName(msg.name);
      if (!v.ok) { this.send(ws, { t: "error", code: "NAME", msg: v.msg }); ws.close(4422, "name"); return; }
      name = v.name;
    }
    const r = join(m, th, { tokenHash: freshHash, pid: randomId() }, name, now);
    if (!r.ok) {
      if (r.code === "CLOSED") { this.send(ws, { t: "closed", msg: "這桌已經關了。" }); ws.close(4410, "closed"); }
      else { this.send(ws, { t: "full" }); ws.close(4409, "full"); }
      return;
    }
    const { seat, isNew } = r.value;
    ws.serializeAttachment({ seat } satisfies Attachment);
    // 同一個座位的舊連線（另一個分頁、舊手機）關掉：同一時間只有最新的那條能操作
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && this.seatOf(other) === seat) {
        other.serializeAttachment({ seat: -1 } satisfies Attachment);
        this.send(other, { t: "error", msg: "這個座位在別的分頁或裝置打開了，這裡先停下來。" });
        other.close(4000, "replaced");
      }
    }
    const back = markOnline(m, seat, now);
    m.lastActive = now;
    this.store.commit({ meta: m });
    this.send(ws, { t: "welcome", v: PROTOCOL_VERSION, seat, token: isNew ? fresh : msg.token!, code: m.code, gid: m.gid });
    this.resync(ws, seat);
    this.broadcastRoom(isNew ? "joined" : back ? "reconnected" : undefined, seat);
    await this.scheduleAlarm();
  }

  // ---------------- 房間指令 ----------------

  private onReady(ws: WebSocket, seat: number, cid: string | undefined, ready: boolean) {
    const m = this.meta!;
    const r = setReady(m, seat, ready);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    if (r.value.start) return this.beginMatch(ws, seat, cid);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    this.broadcastRoom("ready", seat);
  }

  private onMode(ws: WebSocket, seat: number, cid: string | undefined, mode: unknown) {
    const m = this.meta!;
    const r = setMode(m, seat, mode as RoomMeta["mode"]);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    if (r.value.changed) this.broadcastRoom("mode", seat);
  }

  // 改自己的暱稱（伺服器檢查、存檔，再同步給同桌）
  private onName(ws: WebSocket, seat: number, cid: string | undefined, raw: unknown) {
    const v = checkName(raw);
    if (!v.ok) return this.reject(ws, seat, cid, "NAME_INVALID", v.msg);
    const r = setName(this.meta!, seat, v.name);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    if (r.value.changed) this.broadcastRoom("name", seat);
  }

  // 梭了啦：賭局契約書（賭上之物＋選填的賽前豪言）。空白＝我最後的尊嚴；伺服器檢查、存檔，再同步給同桌
  private onStake(ws: WebSocket, seat: number, cid: string | undefined, raw: unknown, rawVow: unknown) {
    const v = checkStake(raw);
    if (!v.ok) return this.reject(ws, seat, cid, "STAKE_INVALID", v.msg);
    const w = checkVow(rawVow);
    if (!w.ok) return this.reject(ws, seat, cid, "STAKE_INVALID", w.msg);
    const r = setStake(this.meta!, seat, v.stake, w.vow);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    this.broadcastRoom("stake", seat);
  }

  private onRematch(ws: WebSocket, seat: number, cid: string | undefined, want: boolean) {
    const m = this.meta!;
    const r = setRematch(m, seat, want);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    if (r.value.start) return this.beginMatch(ws, seat, cid);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    this.broadcastRoom("rematch", seat);
  }

  private onLeave(ws: WebSocket, seat: number, cid: string | undefined, giveUp: boolean) {
    const m = this.meta!;
    if (giveUp) {
      // 認輸離開：照中離規則判自己負（已經結算過就不再算）
      const r = forfeit(m, seat, "forfeit");
      if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
      m.ver++;
      const record = this.recordRow(r.value.winner, "forfeit");
      this.commitRoom(seat, cid, record);
      this.ack(ws, cid);
      this.broadcastRoom("forfeit", seat);
      void this.scheduleAlarm();
      return;
    }
    const r = leave(m, seat);
    if (!r.ok) return this.reject(ws, seat, cid, r.code, r.msg);
    this.commitRoom(seat, cid);
    this.ack(ws, cid);
    ws.serializeAttachment({ seat: -1 } satisfies Attachment);
    this.broadcastRoom("left", seat);
    ws.close(4001, "left");
    void this.scheduleAlarm();
  }

  // ---------------- 牌局指令：伺服器驗證、更新權威狀態 ----------------

  private onGame(ws: WebSocket, seat: number, cid: string | undefined, msg: Extract<ClientMsg, { t: "play" | "call" | "next" }>) {
    const m = this.meta!, g = this.game;
    if (!g || m.mode !== "classic" || !(m.status === "IN_GAME" || m.status === "PAUSED")) return this.reject(ws, seat, cid, "BAD_STATE", "現在沒有進行中的牌局。");
    if (m.status === "PAUSED") return this.reject(ws, seat, cid, "PAUSED", `${m.seats[1 - seat]?.name || "對方"}連線中斷，牌局先暫停，等他回來。`);
    if ((msg.gid && msg.gid !== m.gid) || (typeof msg.ver === "number" && msg.ver !== m.ver))
      return this.reject(ws, seat, cid, "STALE", "牌桌已經更新了，幫你同步到最新。");
    if (msg.t === "next") {
      if (g.phase !== Phase.Finished) return this.reject(ws, seat, cid, "BAD_STATE", "這一局還沒打完。");
      if (g.matchWinner >= 0) return this.reject(ws, seat, cid, "BAD_STATE", "這一場打完了，按「再來一場」。");
      return this.apply(() => { g.startNew(); return true; }, { ws, seat, cid });
    }
    if (g.currentPlayer !== seat || g.trickComplete) return this.reject(ws, seat, cid, "NOT_YOUR_TURN", "還沒輪到你。");
    if (msg.t === "play") {
      if (!Number.isInteger(msg.card)) return this.reject(ws, seat, cid, "BAD_REQUEST", "看不懂這張牌。");
      const why = g.phase === Phase.Draw || g.phase === Phase.Play ? illegalReason(g.hands[seat], g.leadCard < 0 ? null : g.leadCard, msg.card) : "現在不是出牌的時候。";
      if (why || !g.hands[seat].includes(msg.card)) return this.reject(ws, seat, cid, "ILLEGAL", why ?? "你手上沒有這張牌。");
      return this.apply(() => g.playCard(seat, msg.card), { ws, seat, cid });
    }
    if (!Number.isInteger(msg.call) || !g.isLegalCall(seat, msg.call)) return this.reject(ws, seat, cid, "ILLEGAL", "這個叫牌現在不行（要比前面的高，或 Pass）。");
    return this.apply(() => g.makeCall(seat, msg.call), { ws, seat, cid });
  }

  // 執行一個牌局動作 → 事件編號 → 同一個交易存檔（失敗就整個退回）→ 回覆 → 依收件人分送事件與牌桌
  private apply(action: () => boolean, from?: { ws: WebSocket; seat: number; cid?: string }) {
    const m = this.meta!, g = this.game!;
    const before: GameSnapshot = g.snapshot();
    const metaBefore = JSON.stringify(m);
    this.pending = [];
    let ok = false;
    try { ok = action(); } catch { ok = false; }
    const evs = this.pending.filter(x => x.e.type !== "Illegal");
    this.pending = [];
    if (!ok) {
      this.attach(HoneymoonGame.restore(before, cryptoRng));
      if (from) this.reject(from.ws, from.seat, from.cid, "ILLEGAL", "這一步現在不行。");
      return;
    }
    m.ver++;
    m.lastActive = Date.now();
    const logged = evs.map(x => ({ eid: ++m.eid, to: x.to, e: x.e }));
    let record: RecordRow | undefined;
    const over = evs.find(x => x.e.type === "MatchOver");
    if (over && finishMatch(m, over.e.seat, "target")) record = this.recordRow(over.e.seat, "target");
    try {
      this.store.commit({ meta: m, snapshot: g.snapshot(), events: logged, command: from?.cid ? { cid: from.cid, seat: from.seat, ok: true } : undefined, record });
    } catch {
      // 存檔失敗：牌局和房間都回到這一步之前，告訴玩家再試一次
      this.attach(HoneymoonGame.restore(before, cryptoRng));
      this.meta = JSON.parse(metaBefore) as RoomMeta;
      if (from) this.send(from.ws, { t: "reject", cid: from.cid, code: "SAVE_FAILED", msg: "存檔失敗，再試一次。", ver: this.meta.ver });
      return;
    }
    if (record) this.records = null;
    if (from) this.ack(from.ws, from.cid);
    this.trickAt = g.trickComplete ? Date.now() + this.timing.trickPause : 0;
    this.broadcastGame(logged);
    if (record) this.broadcastRoom();
    void this.scheduleAlarm();
  }

  // ---------------- 梭了啦：牌局動作 ----------------
  private onLS(ws: WebSocket, seat: number, cid: string | undefined, msg: Extract<ClientMsg, { t: "ls" }>) {
    const m = this.meta!, g = this.ls;
    if (!g || m.mode !== "laststand" || !inMatch(m)) return this.reject(ws, seat, cid, "BAD_STATE", "現在沒有進行中的「梭了啦」牌局。");
    if (m.status === "PAUSED") return this.reject(ws, seat, cid, "PAUSED", `${m.seats[1 - seat]?.name || "對方"}連線中斷，牌局先暫停，等他回來。`);
    if ((msg.gid && msg.gid !== m.gid) || (typeof msg.ver === "number" && msg.ver !== m.ver))
      return this.reject(ws, seat, cid, "STALE", "牌桌已經更新了，幫你同步到最新。");
    if (!msg.a || typeof msg.a !== "object") return this.reject(ws, seat, cid, "BAD_REQUEST", "看不懂這個動作。");
    const before = g.snapshot();
    const metaBefore = JSON.stringify(m);
    this.lsPending = [];
    let r: ReturnType<LastStandGame["act"]>;
    try { r = g.act(seat, msg.a as LSAction); } catch { r = { ok: false, code: "BAD_REQUEST", msg: "看不懂這個動作。" }; }
    if (!r.ok) {
      this.lsPending = [];
      if (JSON.stringify(g.snapshot()) !== JSON.stringify(before)) this.attachLS(LastStandGame.restore(before));
      return this.reject(ws, seat, cid, r.code === "NOT_YOUR_TURN" ? "NOT_YOUR_TURN" : r.code === "BAD_REQUEST" ? "BAD_REQUEST" : "ILLEGAL", r.msg);
    }
    const evs = this.lsPending; this.lsPending = [];
    m.ver++;
    m.lastActive = Date.now();
    const logged = evs.map(x => ({ eid: ++m.eid, to: x.to, e: x.e }));
    let record: RecordRow | undefined;
    const res = g.s.result;
    if (res && finishMatch(m, res.winner, res.reason)) record = this.recordRow(res.winner, res.reason);
    try {
      this.store.commit({ meta: m, snapshot: g.snapshot(), kind: "laststand", events: logged, command: cid ? { cid, seat, ok: true } : undefined, record });
    } catch {
      this.attachLS(LastStandGame.restore(before));
      this.meta = JSON.parse(metaBefore) as RoomMeta;
      this.send(ws, { t: "reject", cid, code: "SAVE_FAILED", msg: "存檔失敗，再試一次。", ver: this.meta.ver });
      return;
    }
    if (record) this.records = null;
    this.ack(ws, cid);
    this.broadcastLS(logged);
    if (record) this.broadcastRoom();
    void this.scheduleAlarm();
  }

  // 梭了啦開新的一場：第一場擲硬幣決定第 1 墩宣戰權，再戰時交換
  private beginLS(ws: WebSocket, seat: number, cid: string | undefined) {
    const m = this.meta!;
    const coin: 0 | 1 = m.lsCoin === 0 ? 1 : m.lsCoin === 1 ? 0 : cryptoRng() < 0.5 ? 0 : 1;
    m.lsCoin = coin;
    this.lsPending = [];
    this.game = null;
    const { hands, directions } = deal(cryptoRng);
    const g = LastStandGame.setup({ hands, directions, coin }, (e, to) => this.lsPending.push({ e, to }));
    this.ls = g;
    const evs = this.lsPending; this.lsPending = [];
    m.ver++;
    m.lastActive = Date.now();
    const logged = evs.map(x => ({ eid: ++m.eid, to: x.to, e: x.e }));
    this.store.commit({ meta: m, snapshot: g.snapshot(), kind: "laststand", events: logged, command: cid ? { cid, seat, ok: true } : undefined });
    this.ack(ws, cid);
    this.broadcastRoom("started", seat);
    this.broadcastLS(logged);
    void this.scheduleAlarm();
  }

  private broadcastLS(logged: { eid: number; to: number; e: LSEvent }[]) {
    const m = this.meta!;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.seatOf(ws);
      if (seat < 0) continue;
      for (const x of logged) if (x.to < 0 || x.to === seat) this.send(ws, { t: "lsEvent", e: x.e, eid: x.eid, ver: m.ver, gid: m.gid ?? undefined });
      if (this.ls) this.send(ws, { t: "lsState", s: this.ls.viewFor(seat), ver: m.ver, gid: m.gid ?? undefined });
    }
  }

  // 開新的一場（兩人都準備、或兩人都按再來一場）
  private beginMatch(ws: WebSocket, seat: number, cid: string | undefined) {
    const m = this.meta!;
    startMatch(m, randomId());
    if (m.mode === "laststand") return this.beginLS(ws, seat, cid);
    this.ls = null;
    this.attach(new HoneymoonGame(cryptoRng));
    const g = this.game!;
    this.pending = [];
    g.startNewMatch();
    const evs = this.pending; this.pending = [];
    m.ver++;
    m.lastActive = Date.now();
    const logged = evs.map(x => ({ eid: ++m.eid, to: x.to, e: x.e }));
    this.store.commit({ meta: m, snapshot: g.snapshot(), events: logged, command: cid ? { cid, seat, ok: true } : undefined });
    this.ack(ws, cid);
    this.broadcastRoom("started", seat);
    this.broadcastGame(logged);
    void this.scheduleAlarm();
  }

  // ---------------- 鬧鐘：結算墩、中離、讓座、過期（只排一個鬧鐘，不每秒醒來） ----------------

  private hasRecords() { return this.recordList().length > 0; }

  private async scheduleAlarm() {
    const m = this.meta;
    if (!m) return;
    const d = deadlines(m, this.timing, this.hasRecords());
    const ts = [d.expireAt];
    if (m.status === "CLOSED" && !this.hasRecords()) ts.push(m.lastActive + CLOSED_EMPTY_MS);
    if (this.trickAt) ts.push(this.trickAt);
    if (d.forfeitAt !== null) ts.push(d.forfeitAt);
    if (d.releaseAt !== null) ts.push(d.releaseAt);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...ts)));
  }

  async alarm() {
    const m = this.meta;
    if (!m) return;
    const now = Date.now();
    // 1. 兩張牌都上桌：結算這一墩
    if (this.trickAt && now >= this.trickAt - 20 && this.game?.trickComplete) {
      const g = this.game;
      this.trickAt = 0;
      this.apply(() => { g.resolveTrick(); return true; });
    }
    const d = deadlines(m, this.timing, this.hasRecords());
    // 2. 對局中斷線超過時限、而且對方在線上：判斷線的一方中離負（只會判一次）
    if (d.forfeitAt !== null && now >= d.forfeitAt) {
      const r = forfeit(m, d.forfeitSeat, "timeout");
      if (r.ok) {
        m.ver++;
        const record = this.recordRow(r.value.winner, "timeout");
        this.store.commit({ meta: m, record });
        this.records = null;
        this.broadcastRoom("timeout", d.forfeitSeat);
      }
    }
    // 3. 開局前斷線太久：座位讓出來
    if (d.releaseAt !== null && now >= d.releaseAt && leave(m, d.releaseSeat).ok) {
      this.store.commit({ meta: m });
      this.broadcastRoom("left", d.releaseSeat);
    }
    // 4. 過期：進行中的牌局 24 小時沒人動 → 這一場作廢（不記勝負）；只剩戰績的房間 7 天後清掉
    const empty = this.ctx.getWebSockets().filter(w => this.seatOf(w) >= 0).length === 0;
    if (empty && (now >= d.expireAt || (m.status === "CLOSED" && !this.hasRecords() && now >= m.lastActive + CLOSED_EMPTY_MS))) {
      if (inMatch(m) && this.hasRecords()) { m.status = "CLOSED"; m.lastActive = now; this.store.commit({ meta: m }); }
      else { await this.store.wipe(); this.meta = null; this.game = null; this.ls = null; return; }
    }
    this.store.pruneCommands(now - COMMAND_KEEP_MS);
    await this.scheduleAlarm();
  }

  // ---------------- 小工具 ----------------

  private recordList(): RecordRow[] { return this.records ??= this.store.records(); }

  private recordRow(winner: number, reason: RecordRow["reason"]): RecordRow {
    const m = this.meta!, g = this.game;
    if (m.mode === "laststand" && this.ls) {
      const s = this.ls.s;
      return { gid: m.gid ?? randomId(), at: Date.now(), winner, reason, scores: [s.stacks[0], s.stacks[1]], hands: s.trick,
        pids: [m.seats[0]?.pid ?? "", m.seats[1]?.pid ?? ""], mode: "laststand", coin: s.coin };
    }
    return { gid: m.gid ?? randomId(), at: Date.now(), winner, reason, scores: g ? [g.scores[0], g.scores[1]] : [0, 0], hands: g?.handsPlayed ?? 0,
      pids: [m.seats[0]?.pid ?? "", m.seats[1]?.pid ?? ""] };
  }

  private view(): RoomView {
    const m = this.meta!;
    const online = this.onlineSeats();
    return {
      code: m.code, status: m.status, mode: m.mode, host: m.host, ver: m.ver, gid: m.gid, now: Date.now(), result: m.result,
      seats: m.seats.map((s, i) => ({ taken: !!s, online: online[i], name: s?.name ?? "", ready: !!s?.ready, rematch: !!s?.rematch, offlineSince: s?.offlineSince ?? null, stake: s?.stake ?? "", vow: s?.vow ?? "" })),
      stats: pairStats(this.recordList(), [m.seats[0]?.pid ?? null, m.seats[1]?.pid ?? null], m.mode),
      timing: { notice: this.timing.notice, choice: this.timing.choice, forfeit: this.timing.forfeit },
      ...(({ forfeitAt, forfeitSeat }) => ({ forfeitAt, forfeitSeat }))(deadlines(m, this.timing, false)),
    };
  }

  private resync(ws: WebSocket, seat: number) {
    const m = this.meta!;
    this.send(ws, { t: "resync", r: this.view(), ver: m.ver, eid: m.eid,
      s: m.mode === "classic" && this.game && m.gid ? this.game.viewFor(seat) : null,
      ls: m.mode === "laststand" && this.ls && m.gid ? this.ls.viewFor(seat) : null });
  }

  private recap(ws: WebSocket, seat: number, gid: unknown) {
    const m = this.meta!;
    const id = typeof gid === "string" && gid ? gid : m.gid;
    if (!id || seat < 0 || m.mode === "laststand") { this.send(ws, { t: "recap", gid: id ?? "", items: [] }); return; }     // 梭了啦的戰報在 P2
    const names: [string, string] = [m.seats[0]?.name ?? "房主", m.seats[1]?.name ?? "朋友"];
    this.send(ws, { t: "recap", gid: id, items: highlights(this.store.events(id), names) });
  }

  private commitRoom(seat: number, cid: string | undefined, record?: RecordRow) {
    const m = this.meta!;
    m.lastActive = Date.now();
    this.store.commit({ meta: m, command: cid ? { cid, seat, ok: true } : undefined, record });
    if (record) this.records = null;
  }

  private ack(ws: WebSocket, cid: string | undefined) { if (cid) this.send(ws, { t: "ack", cid, ver: this.meta!.ver }); }

  private reject(ws: WebSocket, seat: number, cid: string | undefined, code: RejectCode, msg: string) {
    const m = this.meta!;
    if (cid) { try { this.store.commit({ meta: m, command: { cid, seat, ok: false, code, msg } }); } catch { /* 拒絕紀錄存不了也沒關係 */ } }
    this.send(ws, { t: "reject", cid, code, msg, ver: m.ver });
    if (code === "STALE" || code === "PAUSED") this.resync(ws, seat);
  }

  // 依收件人分送事件（私人的只給那個座位），再送各自的牌桌狀態
  private broadcastGame(logged: { eid: number; to: number; e: GameEvent }[]) {
    const m = this.meta!;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.seatOf(ws);
      if (seat < 0) continue;
      for (const x of logged) if (x.to < 0 || x.to === seat) this.send(ws, { t: "event", e: x.e, eid: x.eid, ver: m.ver, gid: m.gid ?? undefined });
      if (this.game) this.send(ws, { t: "state", s: this.game.viewFor(seat), ver: m.ver, gid: m.gid ?? undefined });
    }
  }

  private broadcastRoom(notice?: Notice, seat?: number) {
    if (!this.meta) return;
    const msg: ServerMsg = { t: "room", r: this.view(), notice, seat };
    for (const ws of this.ctx.getWebSockets()) if (this.seatOf(ws) >= 0) this.send(ws, msg);
  }

  // 回個話：只轉送（不碰牌局、不存檔）；編號不對或太頻繁就丟掉
  private emote(seat: number, i: unknown) {
    if (seat < 0 || seat > 1 || !Number.isInteger(i) || (i as number) < 0 || (i as number) >= EMOTE_COUNT) return;
    const now = Date.now();
    if (!emoteAllowed(this.emoteTimes[seat], now)) return;
    this.emoteTimes[seat] = [...this.emoteTimes[seat].filter(t => now - t < EMOTE_WINDOW_MS), now];
    const msg: ServerMsg = { t: "emote", seat, i: i as number };
    for (const ws of this.ctx.getWebSockets()) if (this.seatOf(ws) >= 0) this.send(ws, msg);
  }

  private onlineSeats(): boolean[] {
    const on = [false, false];
    for (const ws of this.ctx.getWebSockets()) { const s = this.seatOf(ws); if (s >= 0) on[s] = true; }
    return on;
  }

  private seatOf(ws: WebSocket): number {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a && typeof a.seat === "number" ? a.seat : -1;
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 對方剛好斷線 */ }
  }
}

void MODES;
