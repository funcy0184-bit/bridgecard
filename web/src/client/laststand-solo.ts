// 梭了啦 單人測試（開發者用）：真人（座位 0）對測試 AI（座位 1），整場都在這支手機上跑
//   規則：src/laststand/engine.ts（跟雲端房間同一份，每個動作都經過 act 驗證）
//   AI：src/laststand/ai.ts 的六套策略，只拿得到 viewFor(1)（看不到你的手牌、你鎖的牌、還沒公開的方向）
//   對畫面來說它跟雲端房間長得一樣：收 ClientMsg，照伺服器的順序回 ServerMsg（ack → room → lsEvent → lsState），
//   所以等待室、契約書、牌桌、結算、再戰全部沿用，不另外寫一套
//   不開房、不連網路、不寫正式戰績；只存在這支手機（hb-laststand-ai-v1），不碰經典單機和朋友連線的存檔
//   沒有任何改牌、改籌碼、強制結算的介面；測試紀錄只記你看得到的事（AI 的手牌、還沒翻的牌不會進紀錄）
import type { ClientMsg, EndReason, Notice, RoomView, ServerMsg } from "../server/protocol";
import { DEFAULT_STAKE, checkName, checkStake, checkVow } from "../server/protocol";
import { Action, LSEvent, LSState, LastStandGame, actorsNow, randomAction } from "../laststand/engine";
import { STRATEGIES } from "../laststand/ai";
import { CAT_LABEL, DIR_LABEL, TOTAL_CHIPS, cardText, deal } from "../laststand/rules";
import type { Command, ConnStatus, KV, Link, Reply } from "./solo";

export const LS_AI_KEY = "hb-laststand-ai-v1";
export const AI_LS_NAME = "測試 AI";
export const AI_STAKE = "一包乖乖（測試用）";
export const AI_VOW = "我只是來陪你測試的，別太認真。";
export const ME = 0, AI = 1;

// 策略類型（不是難度等級：這些策略沒有照難度平衡過）
export const STRATEGY_NAMES: Record<string, string> = {
  balanced: "均衡", conservative: "保守", aggressive: "激進", random: "隨機", bluffer: "詐唬", hoarder: "留牌",
};
export type AiSpeed = "normal" | "fast" | "instant";
export const SPEED_NAMES: Record<AiSpeed, string> = { normal: "一般（0.6～1 秒）", fast: "快速（約 0.15 秒）", instant: "不等（馬上出）" };
export const SPEED_MS: Record<AiSpeed, [number, number]> = { normal: [600, 1000], fast: [120, 200], instant: [0, 0] };
// 第 1 場第 1 墩的宣戰權給誰（照 seed／我／AI）；之後每一場交換，跟朋友連線一樣
export type FirstPolicy = "seed" | "me" | "ai";
export const FIRST_NAMES: Record<FirstPolicy, string> = { seed: "照 seed", me: "我先", ai: "AI 先" };

export interface AiSettings { strategy: string; speed: AiSpeed; first: FirstPolicy; seed: number }
export const DEFAULT_SETTINGS: AiSettings = { strategy: "balanced", speed: "normal", first: "seed", seed: 0 };

// 可以存狀態的亂數（跟 rules.ts 的 seededRng 同一個演算法、同一個 seed 給同一串數字），重新整理也接得上
export class SeedRng {
  a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next = (): number => {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 第 n 場用的 seed：發牌只看「seed＋第幾場」，跟怎麼打無關（同一個 seed、同一場一定同一副牌）
export const matchSeed = (seed: number, n: number) => (seed + Math.imul(n, 0x9e3779b1)) >>> 0;
const aiSeedOf = (ms: number) => (ms ^ 0xa5a5a5a5) >>> 0;
export const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

type Status = "READY" | "IN_GAME" | "SETTLEMENT";
export interface Session {
  v: 1;
  settings: AiSettings;
  matchNo: number;                 // 這是第幾場（還沒開打是 0）
  coin1: 0 | 1 | -1;               // 第 1 場第 1 墩的宣戰權（之後交換）
  aiRng: number;                   // AI 亂數目前的狀態（每場從「這場的 seed」重新開始）
  status: Status;
  me: { name: string; stake: string; vow: string; ready: boolean };
  gid: string | null; ver: number; eid: number;
  result: { winner: number; reason: EndReason } | null;
  stats: { played: number; wins: [number, number]; draws: number };
  game: LSState | null;
  log: string[];
  illegal: number;                 // AI 選到不合法動作的次數（應該永遠是 0）
  leak: number;                    // 送給你的資料裡出現 AI 沒公開的牌（應該永遠是 0）
}

function safeStorage(): KV | null {
  try { return (globalThis as { localStorage?: KV }).localStorage ?? null; } catch { return null; }
}
export function loadLsAi(storage: Pick<KV, "getItem"> | null = safeStorage()): Session | null {
  try {
    const raw = storage?.getItem(LS_AI_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s || s.v !== 1 || !s.settings || !s.me || !Array.isArray(s.log)) return null;
    if (!STRATEGIES[s.settings.strategy]) s.settings.strategy = "balanced";
    if (!SPEED_MS[s.settings.speed]) s.settings.speed = "normal";
    return s;
  } catch { return null; }
}
// 有一場還沒打完（首頁入口顯示「接著上次的測試」）
export function hasUnfinishedLsAi(): boolean {
  const s = loadLsAi();
  return !!s && s.status === "IN_GAME" && !!s.game;
}

export class LocalLastStandTable implements Link {
  readonly code = "AI";
  readonly solo = true;
  readonly lsAi = true;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};

  game: LastStandGame | null = null;
  s!: Session;
  private pending: { e: LSEvent; to: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;                 // 每次開、關、重開 +1：舊的計時器醒來發現世代不對就什麼都不做
  private closed = true;
  private aiRng = new SeedRng(1);
  private dealtAi: Set<number> = new Set();   // AI 這一場拿到的牌（檢查有沒有在翻牌前送到你這邊）

  constructor(
    private name: string,
    private fresh: boolean,
    private storage: KV | null = safeStorage(),
    private init: Partial<AiSettings> = {},
    private delayOf: (speed: AiSpeed) => number = sp => { const [a, b] = SPEED_MS[sp]; return a + Math.round(Math.random() * (b - a)); },
  ) {}

  // ---------------- Link ----------------
  open() {
    this.closed = false;
    this.gen++;
    this.onStatus("open");
    const saved = this.fresh ? null : loadLsAi(this.storage);
    this.s = saved ?? this.newSession();
    if (this.name) this.s.me.name = this.s.me.name || this.name;
    this.game = null;
    if (this.s.game) {
      try { this.attach(LastStandGame.restore(this.s.game)); } catch { this.game = null; this.s.game = null; this.s.status = "READY"; }
    }
    if (this.s.status === "IN_GAME" && !this.game) this.s.status = "READY";
    this.aiRng = new SeedRng(this.s.aiRng);
    this.dealtAi = new Set(this.game ? this.allAiCards() : []);
    this.deliver({ t: "welcome", v: 2, seat: ME, token: "", code: this.code, gid: this.s.gid });
    this.resync();
    this.save();
    this.schedule();
  }
  send(m: ClientMsg) {
    if (this.closed) return;
    if (m.t === "ping") { this.deliver({ t: "pong" }); return; }
    if (m.t === "sync") { this.resync(); return; }
    if (m.t === "emote" || m.t === "hello" || m.t === "recap") return;
    this.command(m as Command);
  }
  command(m: Command, done?: (r: Reply) => void): string | null {
    if (this.closed) return null;
    const s = this.s;
    const reply = (r: Reply) => { if (done) queueMicrotask(() => { if (!this.closed) done(r); }); };
    const no = (code: Extract<Reply, { ok: false }>["code"], msg: string) => reply({ ok: false, code, msg, ver: s.ver });
    switch (m.t) {
      case "ls": {
        if (s.status !== "IN_GAME" || !this.game) { no("BAD_STATE", "現在沒有進行中的牌局。"); break; }
        if (!m.a || typeof m.a !== "object") { no("BAD_REQUEST", "看不懂這個動作。"); break; }
        let r;
        try { r = this.play(ME, m.a as Action); } catch { r = { ok: false as const, code: "BAD_REQUEST", msg: "看不懂這個動作。" }; }
        if (!r.ok) { no(r.code === "NOT_YOUR_TURN" ? "NOT_YOUR_TURN" : r.code === "BAD_REQUEST" ? "BAD_REQUEST" : "ILLEGAL", r.msg); break; }
        reply({ ok: true, ver: s.ver });
        this.flush();
        break;
      }
      case "stake": {
        if (s.status === "IN_GAME") { no("BAD_STATE", "對局開始後契約就生效了，這一場結束後再改。"); break; }
        if (s.me.ready) { no("BAD_STATE", "已經按準備了：先取消準備再改契約。"); break; }
        const a = checkStake(m.stake), b = checkVow(m.vow);
        if (!a.ok) { no("STAKE_INVALID", a.msg); break; }
        if (!b.ok) { no("STAKE_INVALID", b.msg); break; }
        s.me.stake = a.stake; s.me.vow = b.vow; s.ver++;
        reply({ ok: true, ver: s.ver });
        this.deliverRoom("stake", ME);
        this.save();
        break;
      }
      case "name": {
        if (s.me.ready || s.status === "IN_GAME") { no("NAME_LOCKED", "按了準備或開打之後就不能改名了。"); break; }
        const c = checkName(m.name);
        if (!c.ok) { no("NAME_INVALID", c.msg); break; }
        s.me.name = c.name; s.ver++;
        reply({ ok: true, ver: s.ver });
        this.deliverRoom("name", ME);
        this.save();
        break;
      }
      case "ready": {
        if (s.status !== "READY") { no("BAD_STATE", "現在不能按準備。"); break; }
        if (m.ready && !s.me.stake) { no("BAD_STATE", "先在賭局契約書上蓋章，再按準備。"); break; }
        if (!m.ready) { s.me.ready = false; s.ver++; reply({ ok: true, ver: s.ver }); this.deliverRoom("ready", ME); this.save(); break; }
        this.begin(reply, false);          // AI 一直是準備好的：你一按就開打
        break;
      }
      case "rematch": {
        if (s.status !== "SETTLEMENT") { no("BAD_STATE", "這一場還沒結束。"); break; }
        if (!m.ready) { reply({ ok: true, ver: s.ver }); break; }
        this.begin(reply, false);          // AI 一定答應再來一場
        break;
      }
      case "mode": no("MODE_LOCKED", "單人測試只有梭了啦。"); break;
      case "leave": reply({ ok: true, ver: s.ver }); this.save(); break;
      default: no("BAD_REQUEST", "單人測試不支援這個動作。");
    }
    return "local";
  }
  close() {
    this.closed = true;
    this.gen++;
    this.stopTimer();
  }

  // ---------------- 開發者工具（選單裡的「測試工具」用；都不會改規則、改牌或改籌碼） ----------------
  get pendingAi(): boolean { return this.timer !== null; }
  // 馬上執行已經排好的那一步 AI（跟等時間到一樣走規則驗證，不會跳過任何動作）
  skipWait() {
    if (this.closed || this.timer === null) return;
    this.stopTimer();
    this.aiStep(this.gen);
  }
  // 換策略／速度：下一個 AI 動作開始用；排好的那一步照新速度重排
  setStrategy(k: string) {
    if (!STRATEGIES[k] || this.s.settings.strategy === k) return;
    this.s.settings.strategy = k;
    this.log(`· AI 策略改成「${STRATEGY_NAMES[k] ?? k}」（下一個 AI 動作開始）`);
    this.save();
  }
  setSpeed(sp: AiSpeed) {
    if (!SPEED_MS[sp] || this.s.settings.speed === sp) return;
    this.s.settings.speed = sp;
    this.save();
    if (this.timer !== null) this.schedule();
  }
  setFirst(f: FirstPolicy) { if (FIRST_NAMES[f]) { this.s.settings.first = f; this.save(); } }
  // 重開：same = 同一副牌（同一場號）重打；否則換下一副；seed 給了就換 seed、從第 1 場算
  restart(o: { same?: boolean; seed?: number } = {}) {
    if (this.closed) return;
    this.gen++;
    this.stopTimer();
    const s = this.s;
    if (o.seed !== undefined && Number.isFinite(o.seed)) {
      s.settings.seed = Math.floor(Math.abs(o.seed)) % 4_294_967_296;
      s.matchNo = 0; s.coin1 = -1;
      this.log(`· 換 seed：${s.settings.seed}（從第 1 場重新算）`);
    } else if (o.same && s.matchNo > 0) s.matchNo--;
    s.me.ready = !!s.me.stake;
    this.begin(null, true);
  }
  // 測試紀錄（只有你看得到的事；不含暱稱、賭上之物、AI 沒公開的牌）
  logText(): string {
    const s = this.s, g = this.game;
    const head = [
      "梭了啦 單人測試紀錄（不計正式戰績）",
      `版本 ${typeof __BUILD__ !== "undefined" ? __BUILD__.sha : "dev"}｜seed ${s.settings.seed}｜第 ${s.matchNo} 場｜AI 策略 ${STRATEGY_NAMES[s.settings.strategy] ?? s.settings.strategy}｜速度 ${SPEED_NAMES[s.settings.speed]}`,
      g ? `目前：第 ${g.s.trick} 墩・${PHASE_NAME[g.s.phase]}・輪到 ${this.actorText()}｜籌碼 你 ${g.s.stacks[ME]}・AI ${g.s.stacks[AI]}｜總數 ${g.total()}` : `目前：${s.status === "SETTLEMENT" ? "這一場結束了" : "還沒開打"}`,
      `AI 不合法動作 ${s.illegal} 次｜送出未公開的牌 ${s.leak} 次｜本機戰績 你 ${s.stats.wins[ME]} 勝・AI ${s.stats.wins[AI]} 勝${s.stats.draws ? `・平 ${s.stats.draws}` : ""}`,
      "",
    ];
    return [...head, ...s.log].join("\n");
  }
  // 目前的狀況（只有公開資訊，不含任何人的手牌；測試工具面板、驗收腳本用）
  info() {
    const s = this.s, g = this.game;
    return {
      status: s.status, matchNo: s.matchNo, seed: s.settings.seed, strategy: s.settings.strategy, speed: s.settings.speed, first: s.settings.first,
      trick: g?.s.trick ?? 0, phase: g?.s.phase ?? "", actor: this.actorText(), stacks: g ? [g.s.stacks[ME], g.s.stacks[AI]] : [15, 15],
      total: g ? g.total() : TOTAL_CHIPS, pendingAi: this.timer !== null, illegal: s.illegal, leak: s.leak,
      played: s.stats.played, wins: [s.stats.wins[ME], s.stats.wins[AI]], draws: s.stats.draws, logLines: s.log.length,
    };
  }
  actorText(): string {
    const g = this.game;
    if (!g || g.over) return "（沒有人）";
    const a = actorsNow(g);
    return a.length === 2 ? "雙方（各自鎖牌）" : a[0] === ME ? "你" : "AI";
  }

  // ---------------- 內部 ----------------
  private newSession(): Session {
    const set: AiSettings = { ...DEFAULT_SETTINGS, ...this.init };
    if (!set.seed) set.seed = randomSeed();
    return {
      v: 1, settings: set, matchNo: 0, coin1: -1, aiRng: 1, status: "READY",
      me: { name: this.name || "你", stake: "", vow: "", ready: false },
      gid: null, ver: 1, eid: 0, result: null, stats: { played: 0, wins: [0, 0], draws: 0 }, game: null, log: [], illegal: 0, leak: 0,
    };
  }
  private listen = (e: LSEvent, to: number) => { this.pending.push({ e, to }); };
  private attach(g: LastStandGame) {
    this.game = g;
    g.on(this.listen);
  }
  private allAiCards(): number[] {
    const g = this.game!;
    const shown = new Set(g.s.history.flatMap(r => r.cards ?? []));
    return [...g.s.hands[AI], ...g.s.folded.filter(f => f.folder >= 0).map(f => f.cards[AI])].filter(c => !shown.has(c));
  }

  // 開新的一場（跟伺服器 beginLS 一樣：ack → room(started) → 事件 → 牌桌）
  private begin(reply: ((r: Reply) => void) | null, restarted: boolean) {
    const s = this.s;
    this.gen++;
    this.stopTimer();
    s.matchNo++;
    const ms = matchSeed(s.settings.seed, s.matchNo);
    const dealRng = new SeedRng(ms);
    const { hands, directions } = deal(dealRng.next);
    if (s.coin1 === -1) s.coin1 = s.settings.first === "me" ? 0 : s.settings.first === "ai" ? 1 : dealRng.next() < 0.5 ? 0 : 1;
    const coin = ((s.coin1 + s.matchNo - 1) % 2) as 0 | 1;      // 之後每一場交換
    this.aiRng = new SeedRng(aiSeedOf(ms));
    s.aiRng = this.aiRng.a;
    this.pending = [];
    this.game = LastStandGame.setup({ hands, directions, coin }, this.listen);   // 開局事件（MatchStart、第 1 墩）也會收到
    this.dealtAi = new Set(hands[AI]);
    if (!s.me.stake) s.me.stake = DEFAULT_STAKE;
    s.status = "IN_GAME"; s.result = null; s.me.ready = true;
    s.gid = `ai-${s.settings.seed}-${s.matchNo}`;
    s.ver++;
    this.log(`══ 第 ${s.matchNo} 場${restarted ? "（重開）" : ""}｜seed ${s.settings.seed}｜第 1 墩宣戰權：${coin === ME ? "你" : "AI"}｜AI 策略 ${STRATEGY_NAMES[s.settings.strategy] ?? s.settings.strategy}`);
    reply?.({ ok: true, ver: s.ver });
    this.deliverRoom("started", ME);
    this.flush(false);
  }

  // 做一個動作（你或 AI）：引擎驗證，失敗就什麼都沒變
  private play(seat: number, a: Action): { ok: true } | { ok: false; code: string; msg: string } {
    const g = this.game!;
    this.pending = [];
    const r = g.act(seat, a);
    if (!r.ok) { this.pending = []; return r; }
    this.s.ver++;
    if (g.total() !== TOTAL_CHIPS) this.log(`⚠ 籌碼總數變成 ${g.total()}（應該是 ${TOTAL_CHIPS}）`);
    if (g.over && g.s.result) {
      const res = g.s.result;
      this.s.status = "SETTLEMENT";
      this.s.result = { winner: res.winner, reason: res.reason };
      this.s.me.ready = false;
      this.s.stats.played++;
      if (res.winner < 0) this.s.stats.draws++; else this.s.stats.wins[res.winner]++;
    }
    return r;
  }

  // 把事件（只送你看得到的）和你的牌桌送出去；結束了再送房間（跟伺服器 onLS 一樣的順序）；存檔；排 AI
  private flush(roomAfter = true) {
    const g = this.game!;
    const evs = this.pending; this.pending = [];
    for (const { e, to } of evs) {
      this.logEvent(e, to);
      if (to >= 0 && to !== ME) continue;                      // AI 自己的私人事件（鎖了哪張、讀心結果）不給你
      if (this.leaks(e)) this.s.leak++;
      this.deliver({ t: "lsEvent", e, eid: ++this.s.eid, ver: this.s.ver, gid: this.s.gid ?? undefined });
    }
    const view = g.viewFor(ME);
    if (view.hand.some(c => this.dealtAi.has(c))) this.s.leak++;
    this.deliver({ t: "lsState", s: view, ver: this.s.ver, gid: this.s.gid ?? undefined });
    if (roomAfter && this.s.status === "SETTLEMENT") this.deliverRoom(undefined, -1);
    this.s.game = g.snapshot();
    this.save();
    this.schedule();
  }
  // 送給你的事件裡，不能有 AI 還沒公開的牌（只有翻牌 Showdown 才會公開雙方的牌）
  private leaks(e: LSEvent): boolean {
    if (e.type === "Showdown") return false;
    if (e.card !== undefined && this.dealtAi.has(e.card)) return true;
    return !!e.cards?.some(c => this.dealtAi.has(c));
  }

  // 排下一個 AI 動作：同一時間最多一個計時器；舊的計時器醒來世代不對就不做事
  private schedule() {
    this.stopTimer();
    const g = this.game;
    if (this.closed || this.s.status !== "IN_GAME" || !g || g.over || !actorsNow(g).includes(AI)) return;
    const gen = this.gen;
    this.timer = setTimeout(() => { this.timer = null; this.aiStep(gen); }, Math.max(0, this.delayOf(this.s.settings.speed)));
  }
  private aiStep(gen: number) {
    const g = this.game;
    if (gen !== this.gen || this.closed || !g || this.s.status !== "IN_GAME" || g.over || !actorsNow(g).includes(AI)) return;
    const view = g.viewFor(AI);                                 // AI 只看得到自己這一邊
    let a: Action | null = null;
    try { a = STRATEGIES[this.s.settings.strategy](view, this.aiRng.next); } catch { a = null; }
    let r = a ? this.play(AI, a) : { ok: false as const, code: "ILLEGAL", msg: "AI 沒有選動作" };
    if (!r.ok) {
      this.s.illegal++;
      this.log(`⚠ AI 選了不合法的動作（${a ? a.t : "沒有"}：${r.msg}），改用隨機合法動作`);
      const fb = randomAction(g, AI, this.aiRng.next);
      if (fb) r = this.play(AI, fb);
    }
    this.s.aiRng = this.aiRng.a;
    this.flush();
  }
  private stopTimer() { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }

  private resync() {
    const s = this.s;
    const view = this.game ? this.game.viewFor(ME) : null;
    this.deliver({ t: "resync", r: this.room(), s: null, ver: s.ver, eid: s.eid, ls: view });
  }
  private deliverRoom(notice: Notice | undefined, seat: number) {
    this.deliver({ t: "room", r: this.room(), ...(notice ? { notice, seat } : {}) } as ServerMsg);
  }
  private room(): RoomView {
    const s = this.s;
    return {
      code: this.code, status: s.status, mode: "laststand", host: ME, ver: s.ver, gid: s.gid, now: Date.now(), result: s.result,
      seats: [
        { taken: true, online: true, name: s.me.name || "你", ready: s.me.ready, rematch: false, offlineSince: null, stake: s.me.stake, vow: s.me.vow },
        { taken: true, online: true, name: AI_LS_NAME, ready: true, rematch: false, offlineSince: null, stake: AI_STAKE, vow: AI_VOW },
      ],
      stats: { played: s.stats.played, wins: [s.stats.wins[0], s.stats.wins[1]], draws: s.stats.draws, streak: null, last: [] },
      timing: { notice: 30_000, choice: 120_000, forfeit: 600_000 }, forfeitAt: null, forfeitSeat: -1,
    };
  }

  // ---------------- 測試紀錄 ----------------
  private log(line: string) {
    this.s.log.push(line);
    if (this.s.log.length > 600) this.s.log.splice(0, this.s.log.length - 600);
  }
  private logEvent(e: LSEvent, to: number) {
    if (to >= 0 && to !== ME) return;                           // AI 的私人事件不記
    const who = (x: number) => (x === ME ? "你" : "AI");
    const st = e.stacks ? `（你 ${e.stacks[ME]}・AI ${e.stacks[AI]}）` : "";
    switch (e.type) {
      case "TrickStart": this.log(`— 第 ${e.trick} 墩 ${DIR_LABEL[e.dir!]}（下一墩 ${e.next ? DIR_LABEL[e.next] : "沒有"}）`); break;
      case "Flip": this.log(`${who(e.seat)} 翻轉：這一墩改成${DIR_LABEL[e.dir!]}`); break;
      case "FlipPass": this.log(`${who(e.seat)} 不翻`); break;
      case "Safeguard": this.log(`${who(e.seat)} 用保命`); break;
      case "SafeguardPass": this.log(`${who(e.seat)} 不用保命`); break;
      case "SafeguardBlocked": this.log("有疊池：這一墩不能保命"); break;
      case "Locked": this.log(`${who(e.seat)} 鎖牌`); break;
      case "LockedCard": this.log(`（你鎖的是 ${cardText(e.card!)}）`); break;
      case "Ante": this.log(`底注 ${e.amount}${st}`); break;
      case "NoBet": this.log(e.reason === "safeguard" ? "保命墩：不下注，直接翻牌" : "上限等於底注：不下注，直接翻牌"); break;
      case "Check": this.log(`${who(e.seat)} 過牌`); break;
      case "Raise": this.log(`${who(e.seat)} ${e.reraise ? "反加" : "加注"}到 ${e.to}${e.allIn ? "（梭哈）" : ""}`); break;
      case "Call": this.log(`${who(e.seat)} 接戰（押到 ${e.to}）`); break;
      case "Fold": this.log(`${who(e.seat)} 棄牌`); break;
      case "FoldReveal": this.log(`公開分類：你 ${CAT_LABEL[e.cats![ME]]}・AI ${CAT_LABEL[e.cats![AI]]}`); break;
      case "Insight": this.log(`${who(e.seat)} 讀心`); break;
      case "InsightResult": this.log(`（讀心：AI 鎖的是「${CAT_LABEL[e.cat!]}」）`); break;
      case "Showdown": this.log(`翻牌：你 ${cardText(e.cards![ME])}・AI ${cardText(e.cards![AI])} → ${e.winner! < 0 ? "同點" : `${who(e.winner!)}贏`}`); break;
      case "Settle": this.log(`結算：${who(e.seat)} 拿 ${e.amount}${e.pool?.[0] ? `＋疊池 ${e.pool[0]}` : ""}${e.excess ? `（退回多押 ${e.excess}）` : ""}${st}`); break;
      case "PoolAdd": this.log(`同點：進疊池（你出 ${e.pool![ME]}・AI 出 ${e.pool![AI]}）`); break;
      case "PoolRefund": this.log(`疊池退款：你 ${e.refund![ME]}・AI ${e.refund![AI]}${st}`); break;
      case "Eliminated": this.log(`${who(e.seat)} 籌碼歸零`); break;
      case "MatchOver": this.log(`══ 結束：${e.winner! < 0 ? "平手" : `${who(e.winner!)}贏`}${st}｜總數 ${this.game?.total() ?? "?"}`); break;
    }
  }

  private save() {
    try { this.storage?.setItem(LS_AI_KEY, JSON.stringify(this.s)); } catch { /* 無痕模式存不了：這場關掉就沒了 */ }
  }
  // 照順序、非同步送出（跟網路一樣：按鈕的處理先跑完，畫面才收到結果）
  private deliver(m: ServerMsg) {
    queueMicrotask(() => { if (!this.closed || m.t === "pong") this.onMessage(m); });
  }
}

const PHASE_NAME: Record<string, string> = { flip: "宣戰權（翻不翻）", safeguard: "保命", lock: "鎖牌", bet: "下注", over: "結束" };
declare const __BUILD__: { sha: string; at: string };
