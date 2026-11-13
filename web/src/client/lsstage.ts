// P2.5-B 牌桌演出導演：一墩的「結算 → 翻牌 → 判勝負 → 看結果 → 收牌 → 清桌」由這裡決定什麼時候換畫面
//
// 規矩：
//   · 伺服器說了算：快照（lsState）照舊先擺好位置；這裡只負責「怎麼演」，不改任何遊戲資料，也不擋伺服器的下一步
//   · 只有一條佇列、一個取消鍵：事件進來只排演出（對手蓋牌、一墩結束），一個接一個演；只有「看結果」那段需要等時間
//   · 我的蓋牌不排隊：按下那一幀就開始飛（互動要跟手），伺服器確認前牌停在出牌位，被拒絕就飛回手牌
//   · 斷線回來／重新整理（resync）、換一場：cancelAll() → 動畫全部到終點、佇列清空、不重播
//   · 背景分頁：直接到終點（瀏覽器會暫停背景動畫，回來才不會一次補播一堆）
//   · 隱藏資訊：對手的飛牌一律是牌背節點；牌面只在翻牌（伺服器送來雙方牌面）之後才建立
//
// 核心（TableStage）不碰 DOM：動畫由外面注入（StageAnims），單元測試用假的動畫和假時鐘
import type { TrickRecord } from "../laststand/engine";

export type StagePhase = "idle" | "pre" | "reveal" | "verdict" | "hold" | "collect";
// 一墩結束到開始收牌的總時間（翻牌＋判勝負＋看結果）；點牌桌可以略過
export const SHOW_MS = 1700;

export interface StageAnims {
  /** 動畫要不要直接到終點（背景分頁、動畫關閉） */
  instant(): boolean;
  /** 看不到畫面（背景分頁）：連「看結果」都不用等 */
  away(): boolean;
  render(): void;
  reveal(rec: TrickRecord): Promise<void>;
  verdict(rec: TrickRecord): Promise<void>;
  collect(rec: TrickRecord, quick: boolean): Promise<void>;
  cleared(): void;
  oppLand(): Promise<void>;
  /** 我的蓋牌：飛到出牌位（回傳落桌的那一刻） */
  myFly(id: number): Promise<void>;
  /** 落桌又確認了：收掉飛行用的複製品（出牌位裡的牌背接手） */
  myRest(): void;
  /** 被拒絕：複製品飛回手牌、移除 */
  myBack(id: number): Promise<void>;
  /** 把飛行中的複製品、殘留特效全部收掉，正在跑的動畫直接到終點 */
  clearFx(): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  nextFrame(fn: () => void): void;
}

type Cue = { k: "end"; rec: TrickRecord; final: boolean } | { k: "opp" };

export class TableStage {
  private q: Cue[] = [];
  private running = false;
  private epoch = 0;
  private rec: TrickRecord | null = null;
  private ph: StagePhase = "idle";
  private skipped = false;
  private timer: unknown = null;
  private wake: (() => void) | null = null;
  private pumpAsked = false;
  // 出牌位「飛行中」：快照已經放好牌背，但要等飛到才現身
  private incoming = { me: false, opp: false };
  // 我的蓋牌：飛行狀態
  private mine: { id: number; landed: boolean; confirmed: boolean; failed: boolean; done: Promise<void> | null } | null = null;

  constructor(private a: StageAnims) {}

  /** 正在展示（攤牌、看結果、收牌）的那一墩；沒有就是 null */
  presenting(): TrickRecord | null { return this.rec; }
  phase(): StagePhase { return this.ph; }
  /** 勝負已經揭曉（可以畫金框、寫結果） */
  verdictShown(): boolean { return this.ph === "verdict" || this.ph === "hold"; }
  /** P2.5-C：錢算進去了沒（判勝負那段籌碼還在飛：顯示結算前的餘額、押注、疊池；看結果起才是結算後的） */
  paid(): boolean { return !this.rec || this.ph === "hold" || this.ph === "collect"; }
  isIncoming(side: "me" | "opp"): boolean { return this.incoming[side]; }
  /** 正在飛（或停在出牌位等確認）的那張我的牌；手牌裡先藏起來 */
  flyingId(): number { return this.mine ? this.mine.id : -1; }
  /** 驗收用：佇列有沒有演完 */
  idle(): boolean { return !this.running && !this.q.length && !this.mine && !this.pumpAsked; }
  info() { return { phase: this.ph, queue: this.q.length, running: this.running, mine: this.mine ? { ...this.mine, done: undefined } : null, incoming: { ...this.incoming }, trick: this.rec?.trick ?? 0 }; }

  // ---------------- 事件進來 ----------------

  /** 一墩結算了（快照裡多了一筆紀錄）；final＝整場結束（最後一墩留在桌上，不收牌） */
  trickEnd(rec: TrickRecord, final: boolean) {
    // 沒有別的一墩在展示：馬上把桌子「凍結」在這一墩（不讓下一墩的空出牌位先閃出來）
    if (!this.rec) { this.rec = rec; this.ph = "pre"; }
    this.q.push({ k: "end", rec, final });
    this.pump();
  }

  /** 對手蓋牌（Locked 事件，不含牌面）：從對手名牌飛一張牌背到出牌位 */
  oppLock() {
    this.incoming.opp = true;
    this.q.push({ k: "opp" });
    this.pump();
  }

  /** 我按了蓋牌：馬上開始飛（不排隊） */
  myLock(id: number) {
    if (this.mine) return;                         // 連點：只演一次（送出也只會送一次，見 lstable 的 busy）
    const m = { id, landed: false, confirmed: false, failed: false, done: null as Promise<void> | null };
    this.mine = m;
    this.incoming.me = true;
    const ep = this.epoch;
    m.done = this.a.myFly(id).then(() => {
      if (ep !== this.epoch || this.mine !== m) return;
      m.landed = true;
      this.settleMine();
    });
  }
  /** 伺服器確認（快照裡 myLock 已經是這張） */
  myLockConfirmed(id: number) {
    const m = this.mine;
    if (!m || m.id !== id) return;
    m.confirmed = true;
    this.settleMine();
  }
  /** 伺服器拒絕（或快照顯示沒鎖到）：牌飛回手牌 */
  myLockFailed() {
    const m = this.mine;
    if (!m || m.failed) return;
    m.failed = true;
    const ep = this.epoch;
    const back = () => this.a.myBack(m.id).then(() => {
      if (ep !== this.epoch || this.mine !== m) return;
      this.mine = null;
      this.incoming.me = false;
      this.a.render();
    });
    // 還在飛就等它落桌再回來（不會半空中掉頭）
    (m.landed ? back() : (m.done ?? Promise.resolve()).then(() => { if (ep === this.epoch) return back(); }));
  }
  private settleMine() {
    const m = this.mine;
    if (!m || !m.landed || !m.confirmed || m.failed) return;
    this.mine = null;
    this.incoming.me = false;
    this.a.myRest();
    this.a.render();
  }

  /** 點牌桌：不用等看結果，直接收牌 → 下一墩 */
  skip() {
    if (!this.rec || this.ph === "collect") return;
    this.skipped = true;
    if (this.wake) { const w = this.wake; this.wake = null; this.a.clearTimer(this.timer); this.timer = null; w(); }
  }

  /** 斷線回來、重新整理、換一場：全部到終點、清空、不重播 */
  cancelAll() {
    this.epoch++;
    this.q = [];
    this.rec = null;
    this.ph = "idle";
    this.skipped = false;
    this.running = false;
    this.pumpAsked = false;
    this.incoming = { me: false, opp: false };
    this.mine = null;
    if (this.timer !== null) { this.a.clearTimer(this.timer); this.timer = null; }
    this.wake = null;
    this.a.clearFx();
  }

  // ---------------- 佇列 ----------------

  private pump() {
    if (this.running || this.pumpAsked) return;
    // 等這一輪的快照先畫好（事件比快照早到），下一幀再開演；背景分頁直接演（不會有下一幀）
    if (this.a.away()) { void this.run(); return; }
    this.pumpAsked = true;
    const ep = this.epoch;
    this.a.nextFrame(() => { if (ep !== this.epoch) return; this.pumpAsked = false; void this.run(); });
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const ep = this.epoch;
    while (this.q.length && ep === this.epoch) {
      const c = this.q.shift()!;
      try { await (c.k === "end" ? this.playEnd(c.rec, c.final, ep) : this.playOpp(ep)); } catch { /* 演出失敗不影響遊戲 */ }
    }
    if (ep === this.epoch) this.running = false;
  }

  private async playOpp(ep: number) {
    if (this.incoming.opp) await this.a.oppLand();
    if (ep !== this.epoch) return;
    this.incoming.opp = false;
    this.a.render();
  }

  private async playEnd(rec: TrickRecord, final: boolean, ep: number) {
    const start = this.a.now();
    this.rec = rec; this.skipped = false;
    // 我的牌還在飛（極少見：對手馬上棄牌）：等它落桌
    if (this.mine?.done) await this.mine.done;
    if (ep !== this.epoch) return;
    // ① 翻牌：出牌位換成牌面，從牌背翻過來
    this.ph = "reveal";
    this.a.render();
    await this.a.reveal(rec);
    if (ep !== this.epoch) return;
    // ② 判勝負：金框、變暗、結果字
    this.ph = "verdict";
    this.a.render();
    await this.a.verdict(rec);
    if (ep !== this.epoch) return;
    // 整場結束：最後一墩留在桌上（結算面板接手）
    if (final) { this.rec = null; this.ph = "idle"; this.a.render(); return; }
    // ③ 看結果：從翻牌開始算 SHOW_MS（點牌桌、背景分頁就不等）
    this.ph = "hold";
    this.a.render();                             // 錢算進去了：餘額、疊池換成結算後的
    const left = SHOW_MS - (this.a.now() - start);
    if (left > 0 && !this.skipped && !this.a.away()) await new Promise<void>(res => { this.wake = res; this.timer = this.a.setTimer(() => { this.timer = null; this.wake = null; res(); }, left); });
    if (ep !== this.epoch) return;
    // ④ 收牌：兩張牌收到贏家那邊
    this.ph = "collect";
    await this.a.collect(rec, this.skipped);
    if (ep !== this.epoch) return;
    // ⑤ 清桌：開始下一墩
    this.rec = null; this.ph = "idle"; this.skipped = false;
    this.a.render();
    this.a.cleared();
  }
}
