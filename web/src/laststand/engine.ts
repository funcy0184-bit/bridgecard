// 《逆命賭局》權威規則引擎（純邏輯：伺服器跑這一份；手機只送「我想做什麼」，看到的是 viewFor 過濾過的）
//
// 每一墩的狀態轉移：
//   開墩 ─▶ flip（宣戰權玩家決定翻不翻轉；用過就跳過）
//        ─▶ safeguard（依「下注先手 → 宣戰權」的固定輪替順序決定保命；有未決疊池時本墩禁止保命；
//                       一方用了另一方不得再用；用過的人跳過）
//        ─▶ lock（雙方秘密鎖牌，順序不拘；鎖了不能改）
//        ─▶ 扣底注（保命墩只押 1 枚）
//        ─▶ bet（下注先手：過牌／加注 → 對手：過牌（雙方都過＝翻牌）／加注，或面對加注：接戰／棄牌／反加
//                 → 被反加的人：接戰／棄牌。每墩最多首次加注 1 次＋反加 1 次，最多 4 步一定結束；
//                 保命墩、上限等於底注時不下注，直接翻牌）
//        ─▶ 結算：翻牌比大小（贏家拿對方的承諾＋整個疊池）／同點（雙方承諾按出資進疊池）／
//                 棄牌（棄牌者只輸被跟到的部分，對手多押的退回；勝方拿疊池；雙方鎖牌消耗、只公開分類）
//        ─▶ 退款檢查：第 9 墩仍同點、或有人手上籌碼耗盡無法繼續處理疊池 → 疊池按出資退回原出資者
//        ─▶ 淘汰檢查（全部結算、退款之後才判）：手上 0 枚 → 敗；第 9 墩後比籌碼（相同＝平手）
//
// 籌碼守恆：雙方手上 + 本墩承諾 + 疊池（每人出資分開記）永遠 = 30
import {
  Cat, Dir, START_CHIPS, TOTAL_CHIPS, TRICKS, allInStage, catCounts, catOf, compare, deal, declarerOf, firstBettorOf, flipDir, stageOf,
} from "./rules";

export type Phase = "flip" | "safeguard" | "lock" | "bet" | "over";
export type Action =
  | { t: "flip"; flip: boolean }
  | { t: "safeguard"; use: boolean }
  | { t: "lock"; card: number }
  | { t: "check" }
  | { t: "raise"; to: number }
  | { t: "call" }
  | { t: "fold" }
  | { t: "insight" };

export type EventType =
  | "MatchStart" | "TrickStart" | "Flip" | "FlipPass" | "Safeguard" | "SafeguardPass" | "SafeguardBlocked"
  | "Locked" | "LockedCard" | "Ante" | "NoBet" | "Check" | "Raise" | "Call" | "Fold" | "Insight" | "InsightResult"
  | "Showdown" | "FoldReveal" | "Settle" | "PoolAdd" | "PoolRefund" | "Eliminated" | "MatchOver";
export interface LSEvent {
  type: EventType; trick: number; seat: number;
  to?: number; amount?: number; card?: number; cat?: number; dir?: Dir; next?: Dir | null; reason?: string; winner?: number;
  cards?: [number, number]; cats?: [number, number]; pool?: [number, number]; refund?: [number, number]; stacks?: [number, number];
  ante?: number; cap?: number; declarer?: number; firstBettor?: number; reraise?: boolean; allIn?: boolean; excess?: number;
}
export type Listener = (e: LSEvent, to: number) => void;      // to：-1 兩邊都收；0／1 只給那個座位

export interface BetStep { seat: number; act: "check" | "raise" | "call" | "fold"; to: number; reraise?: boolean; allIn?: boolean }
// 每一墩的公開紀錄（棄牌的確切牌面不在這裡）
export interface TrickRecord {
  trick: number; baseDir: Dir; dir: Dir; flippedBy: number; safeguardBy: number; safeguardBlocked: boolean;
  declarer: number; firstBettor: number; ante: number; cap: number; stake: number; startStacks: [number, number];
  steps: BetStep[]; insight: [boolean, boolean];
  outcome: "showdown" | "tie" | "fold";
  cards: [number, number] | null;          // 翻牌（含同點）才有確切牌面
  cats: [Cat, Cat];                        // 大中小分類：翻牌、棄牌都公開
  folder: number; winner: number;          // 棄牌者；贏家（-1 = 同點）
  commit: [number, number];                // 結算前雙方本墩承諾
  transfer: number;                        // 輸方實際付給贏方（不含疊池）
  excessReturned: number;                  // 棄牌時退回給加注方、沒被跟到的部分
  poolTaken: number;                       // 贏方拿走的疊池
  poolAdded: [number, number];             // 同點時雙方各進疊池多少
  refund: { amounts: [number, number]; reason: "final_tie" | "allin_tie" | "exhausted" } | null;
  allIn: number;                           // 第 7–9 墩把承諾加到上限的人（梭哈方），-1 = 沒有
  stacksAfter: [number, number]; poolAfter: [number, number];
}

export interface LSState {
  v: 1;
  hands: [number[], number[]];             // 手上還沒用掉的牌（鎖了還沒結算的也在）
  directions: Dir[];                       // 9 墩原始方向（伺服器保密：只公開當墩與下一墩）
  coin: 0 | 1;                             // 第 1 墩的宣戰權給誰
  stacks: [number, number];                // 手上籌碼
  trick: number; phase: Phase; toAct: number;
  dir: Dir; flippedBy: number;
  flipUsed: [boolean, boolean]; safeUsed: [boolean, boolean]; insightUsed: [boolean, boolean];
  safeguard: number; safeguardBlocked: boolean; safeOrder: number[];
  locks: [number, number];
  ante: number; cap: number; stake: number; startStacks: [number, number];
  commit: [number, number];
  raises: number; checks: number; steps: BetStep[]; insightThis: [boolean, boolean]; insightNow: [number, number];
  pool: [number, number];                  // 疊池：每位玩家的出資分開記
  history: TrickRecord[];
  insightLog: { trick: number; seat: number; cat: Cat }[];       // 讀心結果（只給使用者看）
  folded: { trick: number; folder: number; cards: [number, number] }[];   // 棄牌確切牌面（伺服器保密，賽後雙方同意才公開）
  result: { winner: number; reason: "elimination" | "nine"; trick: number } | null;
}

export interface Legal {
  flip: boolean; safeguard: boolean; lock: number[];
  check: boolean; raise: [number, number] | null; call: boolean; fold: boolean; insight: boolean;
}
export type ActResult = { ok: true } | { ok: false; code: string; msg: string };

export interface LSView {
  seat: number; trick: number; phase: Phase; toAct: number;
  declarer: number; firstBettor: number;
  dir: Dir; nextDir: Dir | null; flippedBy: number;
  ante: number; cap: number; stake: number; allInStage: boolean;
  stacks: [number, number]; commit: [number, number]; pool: [number, number];
  hand: number[]; myLock: number; locked: [boolean, boolean];
  counts: [[number, number, number], [number, number, number]];     // 雙方剩餘大中小（公開；鎖了還沒結算的也算）
  flipUsed: [boolean, boolean]; safeUsed: [boolean, boolean]; insightUsed: [boolean, boolean];
  safeguard: number; safeguardBlocked: boolean;
  insight: number;                                                   // 本墩讀心看到的對手分類（只有自己），-1
  myInsights: { trick: number; cat: Cat }[];
  steps: BetStep[];
  history: TrickRecord[];
  legal: Legal;
  result: LSState["result"];
}

const bad = (code: string, msg: string): ActResult => ({ ok: false, code, msg });
const OK: ActResult = { ok: true };
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class LastStandGame {
  s: LSState;
  private listeners: Listener[] = [];

  private constructor(s: LSState) { this.s = s; }

  // 開新的一場：發牌、擲硬幣決定第 1 墩宣戰權，直接進第 1 墩
  static newMatch(rng: () => number, listener?: Listener): LastStandGame {
    const { hands, directions } = deal(rng);
    return LastStandGame.setup({ hands, directions, coin: rng() < 0.5 ? 0 : 1 }, listener);
  }
  // 指定牌局（測試、教學用）：手牌、9 墩方向、誰先拿宣戰權、起始籌碼
  static setup(o: { hands: [number[], number[]]; directions: Dir[]; coin: 0 | 1; stacks?: [number, number] }, listener?: Listener): LastStandGame {
    const stacks: [number, number] = o.stacks ? [o.stacks[0], o.stacks[1]] : [START_CHIPS, START_CHIPS];
    if (stacks[0] + stacks[1] !== TOTAL_CHIPS) throw new Error("起始籌碼加起來要是 30");
    const g = new LastStandGame({
      v: 1, hands: [o.hands[0].slice(), o.hands[1].slice()], directions: o.directions.slice(), coin: o.coin, stacks,
      trick: 0, phase: "flip", toAct: -1, dir: o.directions[0], flippedBy: -1,
      flipUsed: [false, false], safeUsed: [false, false], insightUsed: [false, false],
      safeguard: -1, safeguardBlocked: false, safeOrder: [], locks: [-1, -1],
      ante: 0, cap: 0, stake: 0, startStacks: [stacks[0], stacks[1]], commit: [0, 0],
      raises: 0, checks: 0, steps: [], insightThis: [false, false], insightNow: [-1, -1],
      pool: [0, 0], history: [], insightLog: [], folded: [], result: null,
    });
    if (listener) g.on(listener);
    g.emit({ type: "MatchStart", trick: 0, seat: -1, declarer: g.s.coin, stacks: [...g.s.stacks] as [number, number] });
    g.beginTrick();
    return g;
  }
  static restore(s: LSState): LastStandGame { return new LastStandGame(copy(s)); }
  snapshot(): LSState { return copy(this.s); }
  on(fn: Listener) { this.listeners.push(fn); }
  private emit(e: LSEvent, to = -1) { for (const fn of this.listeners) fn(e, to); }

  // 籌碼總數（守恆檢查用）：手上 + 本墩承諾 + 疊池
  total(): number { const s = this.s; return s.stacks[0] + s.stacks[1] + s.commit[0] + s.commit[1] + s.pool[0] + s.pool[1]; }
  get over() { return this.s.phase === "over"; }
  declarer(trick = this.s.trick) { return declarerOf(this.s.coin, trick); }
  firstBettor(trick = this.s.trick) { return firstBettorOf(this.s.coin, trick); }
  private facing(seat: number) { return this.s.commit[1 - seat] > this.s.commit[seat]; }

  // ---------------- 每一墩 ----------------

  private beginTrick() {
    const s = this.s;
    s.trick++;
    const st = stageOf(s.trick);
    const lo = Math.min(s.stacks[0], s.stacks[1]);
    s.startStacks = [s.stacks[0], s.stacks[1]];
    s.ante = Math.min(st.ante, lo);                 // 有效底注
    s.cap = Math.min(st.cap, lo);                   // 每人最高承諾總額：用「該墩開始時」的籌碼算
    s.stake = 0;
    s.dir = s.directions[s.trick - 1];
    s.flippedBy = -1; s.safeguard = -1; s.safeguardBlocked = false; s.safeOrder = [];
    s.locks = [-1, -1]; s.commit = [0, 0]; s.raises = 0; s.checks = 0; s.steps = [];
    s.insightThis = [false, false]; s.insightNow = [-1, -1];
    this.emit({ type: "TrickStart", trick: s.trick, seat: -1, dir: s.dir, next: s.trick < TRICKS ? s.directions[s.trick] : null,
      ante: s.ante, cap: s.cap, declarer: this.declarer(), firstBettor: this.firstBettor(), stacks: [...s.stacks] as [number, number] });
    const d = this.declarer();
    if (!s.flipUsed[d]) { s.phase = "flip"; s.toAct = d; }
    else this.enterSafeguard();
  }

  private enterSafeguard() {
    const s = this.s;
    const order = [this.firstBettor(), this.declarer()].filter(p => !s.safeUsed[p]);
    if (s.pool[0] + s.pool[1] > 0) {
      // 場上有未決疊池：本墩禁止保命
      if (order.length) { s.safeguardBlocked = true; this.emit({ type: "SafeguardBlocked", trick: s.trick, seat: -1, pool: [...s.pool] as [number, number] }); }
      return this.enterLock();
    }
    if (!order.length) return this.enterLock();
    s.safeOrder = order;
    s.phase = "safeguard";
    s.toAct = order[0];
  }

  private enterLock() { this.s.phase = "lock"; this.s.toAct = -1; }

  private enterBet() {
    const s = this.s;
    s.stake = s.safeguard >= 0 ? Math.min(1, s.ante) : s.ante;      // 保命墩：雙方最多各輸贏 1 枚
    for (const p of [0, 1]) { s.stacks[p] -= s.stake; s.commit[p] = s.stake; }
    this.emit({ type: "Ante", trick: s.trick, seat: -1, amount: s.stake, stacks: [...s.stacks] as [number, number] });
    if (s.safeguard >= 0 || s.cap <= s.stake) {
      this.emit({ type: "NoBet", trick: s.trick, seat: -1, reason: s.safeguard >= 0 ? "safeguard" : "cap" });
      return this.showdown();
    }
    s.phase = "bet";
    s.toAct = this.firstBettor();
  }

  // ---------------- 合法動作 ----------------

  legal(seat: number): Legal {
    const s = this.s;
    const L: Legal = { flip: false, safeguard: false, lock: [], check: false, raise: null, call: false, fold: false, insight: false };
    if (s.phase === "over" || (seat !== 0 && seat !== 1)) return L;
    if (s.phase === "flip" && s.toAct === seat) L.flip = true;
    if (s.phase === "safeguard" && s.toAct === seat) L.safeguard = true;
    if (s.phase === "lock" && s.locks[seat] < 0) L.lock = s.hands[seat].slice();
    if (s.phase === "bet" && s.toAct === seat) {
      const facing = this.facing(seat), hi = Math.max(s.commit[0], s.commit[1]);
      if (!facing && s.raises === 0) L.check = true;
      if (facing) { L.call = true; L.fold = true; L.insight = !s.insightUsed[seat]; }
      const canRaise = s.raises === 0 || (s.raises === 1 && facing);
      if (canRaise && hi + 1 <= s.cap) L.raise = [hi + 1, s.cap];
    }
    return L;
  }

  act(seat: number, a: Action): ActResult {
    const s = this.s;
    if (s.phase === "over") return bad("OVER", "這場已經結束了。");
    if (seat !== 0 && seat !== 1) return bad("NOT_SEATED", "你不在這桌。");
    const o = 1 - seat;
    switch (a?.t) {
      case "flip": {
        if (s.phase !== "flip") return bad("NOT_NOW", "現在不是決定翻轉的時候。");
        if (s.toAct !== seat) return bad("NOT_YOUR_TURN", "這一墩的宣戰權不在你身上。");
        if (a.flip) {
          s.dir = flipDir(s.dir); s.flipUsed[seat] = true; s.flippedBy = seat;
          this.emit({ type: "Flip", trick: s.trick, seat, dir: s.dir });
        } else this.emit({ type: "FlipPass", trick: s.trick, seat, dir: s.dir });
        this.enterSafeguard();
        return OK;
      }
      case "safeguard": {
        if (s.phase !== "safeguard") return bad("NOT_NOW", "現在不是決定保命的時候。");
        if (s.toAct !== seat) return bad("NOT_YOUR_TURN", "還沒輪到你決定保命。");
        if (a.use) {
          s.safeguard = seat; s.safeUsed[seat] = true; s.safeOrder = [];
          this.emit({ type: "Safeguard", trick: s.trick, seat });
          this.enterLock();                                   // 一方用了，另一方不必（也不能）再用
        } else {
          this.emit({ type: "SafeguardPass", trick: s.trick, seat });
          s.safeOrder.shift();
          if (s.safeOrder.length) s.toAct = s.safeOrder[0];
          else this.enterLock();
        }
        return OK;
      }
      case "lock": {
        if (s.phase !== "lock") return bad("NOT_NOW", "現在不是鎖牌的時候。");
        if (s.locks[seat] >= 0) return bad("LOCKED", "已經鎖牌了，不能改。");
        if (!Number.isInteger(a.card) || !s.hands[seat].includes(a.card)) return bad("NO_CARD", "你手上沒有這張牌。");
        s.locks[seat] = a.card;
        this.emit({ type: "Locked", trick: s.trick, seat });
        this.emit({ type: "LockedCard", trick: s.trick, seat, card: a.card }, seat);
        if (s.locks[o] >= 0) this.enterBet();
        return OK;
      }
      case "insight": {
        if (s.phase !== "bet" || s.toAct !== seat || !this.facing(seat)) return bad("NOT_NOW", "讀心只能在對方加注或反加之後、你回應之前用。");
        if (s.insightUsed[seat]) return bad("USED", "讀心這場已經用過了。");
        const cat = catOf(s.locks[o]);
        s.insightUsed[seat] = true; s.insightThis[seat] = true; s.insightNow[seat] = cat;
        s.insightLog.push({ trick: s.trick, seat, cat });
        this.emit({ type: "Insight", trick: s.trick, seat });
        this.emit({ type: "InsightResult", trick: s.trick, seat, cat }, seat);
        return OK;
      }
      case "check": {
        if (s.phase !== "bet" || s.toAct !== seat) return bad("NOT_YOUR_TURN", "還沒輪到你下注。");
        if (this.facing(seat) || s.raises > 0) return bad("ILLEGAL", "對方加注了：只能接戰、棄牌" + (s.raises === 1 ? "或反加。" : "。"));
        s.checks++;
        s.steps.push({ seat, act: "check", to: s.commit[seat] });
        this.emit({ type: "Check", trick: s.trick, seat });
        if (s.checks >= 2) this.showdown();
        else s.toAct = o;
        return OK;
      }
      case "raise": {
        if (s.phase !== "bet" || s.toAct !== seat) return bad("NOT_YOUR_TURN", "還沒輪到你下注。");
        const L = this.legal(seat);
        if (!L.raise) return bad("ILLEGAL", s.raises >= 2 ? "這一墩已經反加過了：只能接戰或棄牌。" : "這一墩已經到上限，不能再加。");
        if (!Number.isInteger(a.to) || a.to < L.raise[0] || a.to > L.raise[1]) return bad("BAD_AMOUNT", `加注要在 ${L.raise[0]}～${L.raise[1]} 枚之間（每人總承諾）。`);
        s.stacks[seat] -= a.to - s.commit[seat];
        s.commit[seat] = a.to;
        s.raises++;
        const reraise = s.raises === 2, allIn = allInStage(s.trick) && a.to === s.cap;
        s.steps.push({ seat, act: "raise", to: a.to, reraise, allIn });
        this.emit({ type: "Raise", trick: s.trick, seat, to: a.to, reraise, allIn, stacks: [...s.stacks] as [number, number] });
        s.toAct = o;
        return OK;
      }
      case "call": {
        if (s.phase !== "bet" || s.toAct !== seat) return bad("NOT_YOUR_TURN", "還沒輪到你下注。");
        if (!this.facing(seat)) return bad("ILLEGAL", "沒有人加注，不用接戰。");
        s.stacks[seat] -= s.commit[o] - s.commit[seat];
        s.commit[seat] = s.commit[o];
        s.steps.push({ seat, act: "call", to: s.commit[seat] });
        this.emit({ type: "Call", trick: s.trick, seat, to: s.commit[seat] });
        this.showdown();
        return OK;
      }
      case "fold": {
        if (s.phase !== "bet" || s.toAct !== seat) return bad("NOT_YOUR_TURN", "還沒輪到你下注。");
        if (!this.facing(seat)) return bad("ILLEGAL", "沒有人加注，不能棄牌（可以過牌）。");
        s.steps.push({ seat, act: "fold", to: s.commit[seat] });
        this.foldResolve(seat);
        return OK;
      }
    }
    return bad("BAD_REQUEST", "看不懂這個動作。");
  }

  // ---------------- 結算 ----------------

  private takeLocks(): [number, number] {
    const s = this.s, cards: [number, number] = [s.locks[0], s.locks[1]];
    for (const p of [0, 1]) s.hands[p] = s.hands[p].filter(c => c !== cards[p]);
    return cards;
  }
  private allInSeat(): number {
    const st = this.s.steps.find(x => x.act === "raise" && x.allIn);
    return st ? st.seat : -1;
  }
  private record(partial: Pick<TrickRecord, "outcome" | "cards" | "cats" | "folder" | "winner" | "commit" | "transfer" | "excessReturned" | "poolTaken" | "poolAdded">): TrickRecord {
    const s = this.s;
    return {
      trick: s.trick, baseDir: s.directions[s.trick - 1], dir: s.dir, flippedBy: s.flippedBy, safeguardBy: s.safeguard, safeguardBlocked: s.safeguardBlocked,
      declarer: this.declarer(), firstBettor: this.firstBettor(), ante: s.ante, cap: s.cap, stake: s.stake, startStacks: [...s.startStacks] as [number, number],
      steps: s.steps.slice(), insight: [...s.insightThis] as [boolean, boolean], allIn: this.allInSeat(),
      refund: null, stacksAfter: [0, 0], poolAfter: [0, 0], ...partial,
    };
  }

  // 贏家拿回自己的承諾＋輸家「被跟到」的承諾＋整個疊池（棄牌時，加注方多押、沒被跟到的部分就是拿回自己的）
  private payWinner(w: number) {
    const s = this.s, l = 1 - w;
    const matched = Math.min(s.commit[w], s.commit[l]);
    const poolTaken = s.pool[0] + s.pool[1];
    const excess = s.commit[w] - matched;
    s.stacks[w] += s.commit[w] + s.commit[l] + poolTaken;
    s.commit = [0, 0];
    s.pool = [0, 0];
    return { transfer: matched, poolTaken, excess };
  }

  private showdown() {
    const s = this.s;
    const commit: [number, number] = [s.commit[0], s.commit[1]];
    const cards = this.takeLocks();
    const r = compare(cards[0], cards[1], s.dir);
    const winner = r === 1 ? 0 : r === -1 ? 1 : -1;
    const cats: [Cat, Cat] = [catOf(cards[0]), catOf(cards[1])];
    this.emit({ type: "Showdown", trick: s.trick, seat: -1, cards, cats, dir: s.dir, winner });
    let rec: TrickRecord;
    if (winner >= 0) {
      const p = this.payWinner(winner);
      this.emit({ type: "Settle", trick: s.trick, seat: winner, amount: p.transfer, pool: [p.poolTaken, 0], stacks: [...s.stacks] as [number, number] });
      rec = this.record({ outcome: "showdown", cards, cats, folder: -1, winner, commit, transfer: p.transfer, excessReturned: 0, poolTaken: p.poolTaken, poolAdded: [0, 0] });
    } else {
      // 同點：雙方承諾按出資進疊池（不看花色）
      s.pool[0] += commit[0]; s.pool[1] += commit[1]; s.commit = [0, 0];
      this.emit({ type: "PoolAdd", trick: s.trick, seat: -1, pool: [...s.pool] as [number, number], refund: commit });
      rec = this.record({ outcome: "tie", cards, cats, folder: -1, winner: -1, commit, transfer: 0, excessReturned: 0, poolTaken: 0, poolAdded: commit });
    }
    this.endTrick(rec);
  }

  private foldResolve(f: number) {
    const s = this.s, w = 1 - f;
    const commit: [number, number] = [s.commit[0], s.commit[1]];
    const cards = this.takeLocks();
    const cats: [Cat, Cat] = [catOf(cards[0]), catOf(cards[1])];
    s.folded.push({ trick: s.trick, folder: f, cards });              // 確切牌面只留在伺服器
    this.emit({ type: "Fold", trick: s.trick, seat: f });
    this.emit({ type: "FoldReveal", trick: s.trick, seat: f, cats });
    const p = this.payWinner(w);
    this.emit({ type: "Settle", trick: s.trick, seat: w, amount: p.transfer, excess: p.excess, pool: [p.poolTaken, 0], stacks: [...s.stacks] as [number, number] });
    this.endTrick(this.record({ outcome: "fold", cards: null, cats, folder: f, winner: w, commit, transfer: p.transfer, excessReturned: p.excess, poolTaken: p.poolTaken, poolAdded: [0, 0] }));
  }

  // 疊池退款：第 9 墩仍同點、梭哈同點（短碼歸零）、或有人手上籌碼耗盡 → 按出資退回
  private maybeRefund(rec: TrickRecord) {
    const s = this.s;
    if (s.pool[0] + s.pool[1] === 0) return;
    let reason: "final_tie" | "allin_tie" | "exhausted" | null = null;
    if (s.trick >= TRICKS) reason = "final_tie";
    else if (s.stacks[0] === 0 || s.stacks[1] === 0) reason = rec.outcome === "tie" && rec.allIn >= 0 ? "allin_tie" : "exhausted";
    if (!reason) return;
    const amounts: [number, number] = [s.pool[0], s.pool[1]];
    s.stacks[0] += amounts[0]; s.stacks[1] += amounts[1];
    s.pool = [0, 0];
    rec.refund = { amounts, reason };
    this.emit({ type: "PoolRefund", trick: s.trick, seat: -1, refund: amounts, reason, stacks: [...s.stacks] as [number, number] });
  }

  private endTrick(rec: TrickRecord) {
    const s = this.s;
    this.maybeRefund(rec);
    rec.stacksAfter = [s.stacks[0], s.stacks[1]];
    rec.poolAfter = [s.pool[0], s.pool[1]];
    s.history.push(rec);
    s.locks = [-1, -1];
    // 全部結算、退款之後才判淘汰
    const out = s.stacks[0] === 0 ? 0 : s.stacks[1] === 0 ? 1 : -1;
    if (out >= 0 && s.pool[0] + s.pool[1] === 0) {
      this.emit({ type: "Eliminated", trick: s.trick, seat: out });
      return this.finish(1 - out, "elimination");
    }
    if (s.trick >= TRICKS) {
      const w = s.stacks[0] > s.stacks[1] ? 0 : s.stacks[1] > s.stacks[0] ? 1 : -1;
      return this.finish(w, "nine");
    }
    this.beginTrick();
  }

  private finish(winner: number, reason: "elimination" | "nine") {
    const s = this.s;
    s.phase = "over"; s.toAct = -1;
    s.result = { winner, reason, trick: s.trick };
    this.emit({ type: "MatchOver", trick: s.trick, seat: -1, winner, reason, stacks: [...s.stacks] as [number, number] });
  }

  // ---------------- 每個座位看得到的東西 ----------------
  // 不含：對手手牌、對手還沒翻開的鎖牌、未公開的方向、棄牌的確切牌面、對手的讀心結果
  viewFor(seat: number): LSView {
    const s = this.s;
    return {
      seat, trick: s.trick, phase: s.phase, toAct: s.toAct,
      declarer: this.declarer(), firstBettor: this.firstBettor(),
      dir: s.dir, nextDir: s.trick < TRICKS ? s.directions[s.trick] : null, flippedBy: s.flippedBy,
      ante: s.ante, cap: s.cap, stake: s.stake, allInStage: allInStage(s.trick),
      stacks: [s.stacks[0], s.stacks[1]], commit: [s.commit[0], s.commit[1]], pool: [s.pool[0], s.pool[1]],
      hand: s.hands[seat]?.slice() ?? [], myLock: s.locks[seat] ?? -1, locked: [s.locks[0] >= 0, s.locks[1] >= 0],
      counts: [catCounts(s.hands[0]), catCounts(s.hands[1])],
      flipUsed: [...s.flipUsed] as [boolean, boolean], safeUsed: [...s.safeUsed] as [boolean, boolean], insightUsed: [...s.insightUsed] as [boolean, boolean],
      safeguard: s.safeguard, safeguardBlocked: s.safeguardBlocked,
      insight: s.insightNow[seat] ?? -1,
      myInsights: s.insightLog.filter(x => x.seat === seat).map(x => ({ trick: x.trick, cat: x.cat })),
      steps: s.steps.slice(),
      history: copy(s.history),
      legal: this.legal(seat),
      result: s.result ? { ...s.result } : null,
    };
  }
}

// 隨機合法動作（測試與模擬用）
export function randomAction(g: LastStandGame, seat: number, rng: () => number): Action | null {
  const L = g.legal(seat);
  const opts: Action[] = [];
  if (L.flip) opts.push({ t: "flip", flip: false }, { t: "flip", flip: true });
  if (L.safeguard) opts.push({ t: "safeguard", use: false }, { t: "safeguard", use: true });
  for (const c of L.lock) opts.push({ t: "lock", card: c });
  if (L.check) opts.push({ t: "check" });
  if (L.call) opts.push({ t: "call" });
  if (L.fold) opts.push({ t: "fold" });
  if (L.insight) opts.push({ t: "insight" });
  if (L.raise) opts.push({ t: "raise", to: L.raise[0] + Math.floor(rng() * (L.raise[1] - L.raise[0] + 1)) });
  return opts.length ? opts[Math.floor(rng() * opts.length)] : null;
}

// 誰現在要動作（鎖牌階段兩個人都可能要動）
export function actorsNow(g: LastStandGame): number[] {
  const s = g.s;
  if (s.phase === "over") return [];
  if (s.phase === "lock") return [0, 1].filter(p => s.locks[p] < 0);
  return [s.toAct];
}

export { TOTAL_CHIPS };
