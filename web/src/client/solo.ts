// 單機：跟電腦（阿禾）打。規則引擎、電腦都跟雲端房間同一份（src/game），只是改在手機上跑。
// 對牌桌畫面來說，它跟雲端連線長得一樣：收 ClientMsg、回 ServerMsg（事件一定比狀態先到），
// 所以 main.ts 的動畫、叫牌面板、結算都不用另外寫一套。
// 牌局每一步都存進 localStorage，重新整理或關掉再開，回來還是同一局。
import type { ClientMsg, ServerMsg } from "../server/protocol";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { chooseCall, chooseCard } from "../game/ai";

// 跟 net.ts 的 ConnStatus 一樣（這個檔案也給測試在 Node 上跑，所以不引用瀏覽器專用的 net.ts）
export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";
// localStorage 的最小介面（測試可以換成假的）
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; }

// 牌桌畫面要的連線介面：雲端的 Connection 和單機的 LocalTable 都符合
export interface Link {
  readonly code: string;
  readonly solo?: boolean;
  onMessage: (m: ServerMsg) => void;
  onStatus: (s: ConnStatus) => void;
  open(): void;
  send(m: ClientMsg): void;
  close(): void;
}

export const SOLO_KEY = "hb-solo-v1";
export const AI_NAME = "阿禾";
export const ME = 0, AI = 1;

export interface SoloDelays { trick: number; play: number; lead: number; call: number; }
// 兩張牌都上桌後停 1.3 秒（跟雲端房間一樣）；電腦想一下再出，玩家才看得清楚
export const DEFAULT_DELAYS: SoloDelays = { trick: 1300, play: 750, lead: 1000, call: 1000 };

interface Saved { v: 1; game: GameSnapshot; }

export function loadSolo(storage: Pick<KV, "getItem"> | null = safeStorage()): GameSnapshot | null {
  try {
    const raw = storage?.getItem(SOLO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s && s.v === 1 && s.game && Array.isArray(s.game.hands) ? s.game : null;
  } catch { return null; }
}

// 有一局還沒打完（整場還沒分出勝負）
export function hasUnfinishedSolo(): boolean {
  const g = loadSolo();
  return !!g && g.matchWinner < 0;
}

function safeStorage(): KV | null {
  try { return (globalThis as { localStorage?: KV }).localStorage ?? null; } catch { return null; }
}

export class LocalTable implements Link {
  readonly code = "SOLO";
  readonly solo = true;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};

  game!: HoneymoonGame;
  private pending: { e: GameEvent; to: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private name: string,
    private fresh: boolean,
    private delays: SoloDelays = DEFAULT_DELAYS,
    private storage: KV | null = safeStorage(),
    private rng: () => number = Math.random,
  ) {}

  open() {
    this.closed = false;
    this.onStatus("open");
    this.deliver({ t: "welcome", seat: ME, token: "", code: this.code });
    this.deliver({
      t: "lobby", started: true,
      seats: [{ taken: true, online: true, name: this.name || "你" }, { taken: true, online: true, name: AI_NAME }],
    });
    const snap = this.fresh ? null : loadSolo(this.storage);
    let restored: HoneymoonGame | null = null;
    if (snap && snap.matchWinner < 0) {
      try { restored = HoneymoonGame.restore(snap, this.rng); } catch { restored = null; }
    }
    if (restored) {
      this.attach(restored);
      this.deliver({ t: "state", s: restored.viewFor(ME) });
      this.schedule();
    } else {
      this.attach(new HoneymoonGame(this.rng));
      this.apply(() => this.game.startNewMatch());
    }
  }

  // 開新的一場（重新洗牌、分數歸零）
  restart() {
    this.attach(new HoneymoonGame(this.rng));
    this.apply(() => this.game.startNewMatch());
  }

  send(m: ClientMsg) {
    if (this.closed || !this.game) return;
    const g = this.game;
    switch (m.t) {
      case "play":
        if (Number.isInteger(m.card)) this.apply(() => g.playCard(ME, m.card));
        break;
      case "call":
        if (Number.isInteger(m.call)) this.apply(() => g.makeCall(ME, m.call));
        break;
      case "next":
        if (g.phase === Phase.Finished) this.apply(() => g.startNew());   // 整場結束時 startNew 會自動開新的一場
        break;
      case "ping":
        this.deliver({ t: "pong" });
        break;
    }
  }

  close() {
    this.closed = true;
    this.stopTimer();
  }

  private stopTimer() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  private attach(g: HoneymoonGame) {
    this.stopTimer();
    this.game = g;
    g.on((e, to) => this.pending.push({ e, to }));
  }

  // 跟雲端房間的 apply 一樣：做一個動作 → 只送玩家看得到的事件 → 再送牌桌 → 存檔 → 排下一步
  private apply(action: () => unknown) {
    this.pending = [];
    action();
    const events = this.pending;
    this.pending = [];
    for (const { e, to } of events) if (to < 0 || to === ME) this.deliver({ t: "event", e });
    this.deliver({ t: "state", s: this.game.viewFor(ME) });
    this.save();
    this.schedule();
  }

  private schedule() {
    this.stopTimer();
    if (this.closed) return;
    const g = this.game;
    if (g.trickComplete) { this.timer = setTimeout(() => this.apply(() => g.resolveTrick()), this.delays.trick); return; }
    if (g.currentPlayer !== AI) return;
    if (g.phase === Phase.Bidding) {
      this.timer = setTimeout(() => this.apply(() => g.makeCall(AI, chooseCall(g, AI))), this.delays.call);
    } else if (g.phase === Phase.Draw || g.phase === Phase.Play) {
      const leading = g.leader === AI && g.leadCard < 0;
      this.timer = setTimeout(() => this.apply(() => g.playCard(AI, chooseCard(g, AI))), leading ? this.delays.lead : this.delays.play);
    }
  }

  private save() {
    try { this.storage?.setItem(SOLO_KEY, JSON.stringify({ v: 1, game: this.game.snapshot() } satisfies Saved)); }
    catch { /* 無痕模式存不了：這局關掉就沒了 */ }
  }

  // 照順序、非同步送出：跟網路一樣，按鈕的事件處理先跑完，畫面才收到結果
  private deliver(m: ServerMsg) {
    queueMicrotask(() => { if (!this.closed || m.t === "pong") this.onMessage(m); });
  }
}
