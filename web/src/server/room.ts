// 一個房間 = 一個 Durable Object（雲端上的小主機）。
// 洗牌、記輪到誰、判斷誰贏、計分全部在這裡做；每支手機只會收到自己座位看得到的東西。
// 兩支手機都關掉也沒關係：狀態存在雲端，重新打開、用同一個憑證連回來就回到同一桌。
import { DurableObject } from "cloudflare:workers";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { ClientMsg, EMOTE_COUNT, EMOTE_WINDOW_MS, ServerMsg, SeatInfo, cleanName, emoteAllowed } from "./protocol";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

interface Seat { token: string; name: string; }
interface RoomData {
  code: string;
  createdAt: number;
  lastActive: number;
  seats: (Seat | null)[];
  game: GameSnapshot | null;
}
interface Attachment { seat: number; }

export const TRICK_PAUSE_MS = 1300;              // 兩張牌都上桌後停多久再結算（跟 Unity 版一樣）
export const IDLE_EXPIRE_MS = 24 * 3600 * 1000;  // 沒人連線超過 24 小時就清掉房間

const cryptoRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const DEFAULT_NAMES = ["房主", "朋友"];

export class Room extends DurableObject<Env> {
  private data: RoomData | null = null;
  private game: HoneymoonGame | null = null;
  private pending: { e: GameEvent; to: number }[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<RoomData>("room")) ?? null;
      if (this.data?.game) this.attach(HoneymoonGame.restore(this.data.game, cryptoRng));
    });
  }

  private attach(g: HoneymoonGame) {
    this.game = g;
    g.on((e, to) => this.pending.push({ e, to }));
  }

  // ---------------- HTTP：建立房間、查房間、升級成 WebSocket ----------------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init" && req.method === "POST") {
      if (this.data) return new Response("exists", { status: 409 });
      const code = await req.text();
      this.data = { code, createdAt: Date.now(), lastActive: Date.now(), seats: [null, null], game: null };
      await this.save();
      await this.scheduleAlarm();
      return new Response("created", { status: 201 });
    }
    if (url.pathname === "/info") {
      return Response.json(this.data
        ? { exists: true, seats: this.data.seats.map(s => !!s), started: !!this.game }
        : { exists: false });
    }
    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      if (!this.data) {
        server.send(JSON.stringify({ t: "gone" } satisfies ServerMsg));
        server.close(4404, "room not found");
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  // ---------------- WebSocket ----------------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.data) { this.send(ws, { t: "gone" }); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { this.send(ws, { t: "error", msg: "看不懂的訊息" }); return; }

    if (msg.t === "ping") { this.send(ws, { t: "pong" }); return; }
    if (msg.t === "hello") { await this.hello(ws, msg); return; }

    const seat = this.seatOf(ws);
    if (msg.t === "emote") { this.emote(seat, msg.i); return; }
    if (seat < 0 || !this.game) return;
    const g = this.game;
    switch (msg.t) {
      case "play":
        if (Number.isInteger(msg.card)) await this.apply(() => g.playCard(seat, msg.card));
        break;
      case "call":
        if (Number.isInteger(msg.call)) await this.apply(() => g.makeCall(seat, msg.call));
        break;
      case "next":
        if (g.phase === Phase.Finished) await this.apply(() => g.startNew());   // 整場結束時 startNew 會自動開新的一場
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.broadcastLobby(ws);
    await this.scheduleAlarm();
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastLobby(ws);
  }

  private async hello(ws: WebSocket, msg: Extract<ClientMsg, { t: "hello" }>) {
    const d = this.data!;
    // 1. 拿著憑證回來 → 回到原本的座位（重新整理、斷線重連都走這裡）
    let seat = d.seats.findIndex(s => !!s && !!msg.token && s.token === msg.token);
    // 2. 新的人 → 坐空位（第一個進來的是房主）
    if (seat < 0) {
      seat = d.seats.findIndex(s => s === null);
      if (seat < 0) { this.send(ws, { t: "full" }); ws.close(4409, "room full"); return; }
      d.seats[seat] = { token: crypto.randomUUID(), name: cleanName(msg.name, DEFAULT_NAMES[seat]) };
    } else if (msg.name) {
      d.seats[seat]!.name = cleanName(msg.name, d.seats[seat]!.name);
    }

    // 同一個座位的舊連線（例如另一個分頁）關掉，避免兩邊同時操作
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && this.seatOf(other) === seat) other.close(4000, "replaced");
    }
    ws.serializeAttachment({ seat } satisfies Attachment);
    this.send(ws, { t: "welcome", seat, token: d.seats[seat]!.token, code: d.code });

    if (!this.game && d.seats.every(s => s !== null)) {
      // 兩個人都到了：雲端洗牌、發牌
      this.attach(new HoneymoonGame(cryptoRng));
      await this.apply(() => this.game!.startNewMatch());
    } else {
      d.lastActive = Date.now();
      await this.save();
      if (this.game) this.send(ws, { t: "state", s: this.game.viewFor(seat) });
    }
    this.broadcastLobby();
  }

  // 執行一個動作 → 把產生的事件依收件人分送 → 再送各自的牌桌狀態 → 存檔
  private async apply(action: () => unknown) {
    this.pending = [];
    action();
    const events = this.pending;
    this.pending = [];
    for (const ws of this.ctx.getWebSockets()) {
      const seat = this.seatOf(ws);
      if (seat < 0) continue;
      for (const { e, to } of events) if (to < 0 || to === seat) this.send(ws, { t: "event", e });
      if (this.game) this.send(ws, { t: "state", s: this.game.viewFor(seat) });
    }
    this.data!.lastActive = Date.now();
    await this.save();
    await this.scheduleAlarm();
  }

  // 只有一個鬧鐘：有墩要結算就排 1.3 秒後；不然排「閒置過期」檢查
  private async scheduleAlarm() {
    if (!this.data) return;
    const at = this.game?.trickComplete ? Date.now() + TRICK_PAUSE_MS : this.data.lastActive + IDLE_EXPIRE_MS;
    await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    if (!this.data) return;
    if (this.game?.trickComplete) {
      const g = this.game;
      await this.apply(() => g.resolveTrick());
      return;
    }
    const idle = Date.now() - this.data.lastActive >= IDLE_EXPIRE_MS;
    if (idle && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.data = null;
      this.game = null;
      return;
    }
    await this.scheduleAlarm();
  }

  // ---------------- 小工具 ----------------

  // 回個話：只轉送（不碰牌局、不存檔）；編號不對或太頻繁就丟掉
  private emoteTimes: [number[], number[]] = [[], []];
  private emote(seat: number, i: unknown) {
    if (seat < 0 || seat > 1 || !Number.isInteger(i) || (i as number) < 0 || (i as number) >= EMOTE_COUNT) return;
    const now = Date.now();
    if (!emoteAllowed(this.emoteTimes[seat], now)) return;
    this.emoteTimes[seat] = [...this.emoteTimes[seat].filter(t => now - t < EMOTE_WINDOW_MS), now];
    const msg: ServerMsg = { t: "emote", seat, i: i as number };
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  private seatOf(ws: WebSocket): number {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a && typeof a.seat === "number" ? a.seat : -1;
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 對方剛好斷線 */ }
  }

  private broadcastLobby(closing?: WebSocket) {
    if (!this.data) return;
    const online = [false, false];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue;
      const s = this.seatOf(ws);
      if (s >= 0) online[s] = true;
    }
    const seats: SeatInfo[] = this.data.seats.map((s, i) => ({ taken: !!s, online: online[i], name: s?.name ?? "" }));
    const msg: ServerMsg = { t: "lobby", seats, started: !!this.game };
    for (const ws of this.ctx.getWebSockets()) if (ws !== closing) this.send(ws, msg);
  }

  private async save() {
    if (!this.data) return;
    this.data.game = this.game ? this.game.snapshot() : null;
    await this.ctx.storage.put("room", this.data);
  }
}
