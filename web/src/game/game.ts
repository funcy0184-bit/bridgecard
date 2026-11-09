// 蜜月橋牌遊戲狀態機：Unity 版 HoneymoonGame.cs 的 TypeScript 版本，規則一模一樣。
// 雲端房間（Durable Object）只跑這一份；手機只收「自己看得到的」TableState 和事件。
import { Call, isBid, bidStrain, tricksNeeded, newShuffledDeck, sortHand, Strain, suitOf } from "./cards";
import { beats, isTrump, legalPlays } from "./rules";
import { DEFAULT_TARGET, HandResult, score } from "./scoring";

export const Phase = { Draw: 0, Bidding: 1, Play: 2, Finished: 3 } as const;
export type PhaseId = 0 | 1 | 2 | 3;

export type EventType =
  | "NewHand" | "CardPlayed" | "TrickWon" | "FaceUpTaken" | "CardDrawn" | "DrawPhaseOver"
  | "BidMade" | "Passed" | "ContractSet" | "GameOver" | "Illegal" | "Redeal"
  | "Doubled" | "Redoubled" | "HandScored" | "MatchOver";

// 欄位意義跟 Unity 版 GameEvent.cs 一樣
export interface GameEvent { type: EventType; seat: number; card: number; value: number; extra: number; }
const ev = (type: EventType, seat = -1, card = -1, value = -1, extra = -1): GameEvent => ({ type, seat, card, value, extra });

export interface AuctionEntry { seat: number; call: number; }

// 某一個座位看得到的牌桌（對手手牌只有張數）
export interface TableState {
  seat: number; phase: PhaseId;
  hand: number[]; legal: number[]; oppCount: number;
  faceUp: number; stockCount: number;
  leadCard: number; followCard: number; leaderSeat: number; currentSeat: number;
  myTricks: number; oppTricks: number; oppTakenFaceUp: number[]; myTakenFaceUp: number[];   // 兩邊搶走的明牌（公開資訊）
  highestBid: number; highestBidder: number; declarer: number; minBid: number;
  doubled: number; canDouble: boolean; canRedouble: boolean;
  auctionSeats: number[]; auctionCalls: number[];
  myScore: number; oppScore: number; targetScore: number; handNumber: number;
  hasResult: boolean; result: HandResult | null; matchWinner: number;
}

// 存進雲端的完整狀態（JSON）
export interface GameSnapshot {
  hands: [number[], number[]]; takenFaceUp: [number[], number[]]; stock: number[]; tricksWon: [number, number];
  phase: PhaseId; currentPlayer: number; leader: number; leadCard: number; followCard: number; trump: number;
  highestBid: number; highestBidder: number; doubled: number; declarer: number;
  auction: AuctionEntry[]; passesInRow: number; firstSeat: number;
  targetScore: number; scores: [number, number]; handsPlayed: number; lastResult: HandResult | null; matchWinner: number;
}

export type Listener = (e: GameEvent, to: number) => void;   // to：-1 = 兩邊都收，0 / 1 = 只給那個座位

export const other = (p: number) => 1 - p;

export class HoneymoonGame {
  hands: [number[], number[]] = [[], []];
  takenFaceUp: [number[], number[]] = [[], []];
  stock: number[] = [];
  tricksWon: [number, number] = [0, 0];

  phase: PhaseId = Phase.Draw;
  currentPlayer = 0;
  leader = 0;
  leadCard = -1;
  followCard = -1;
  trump: number = Strain.NoTrump;

  highestBid = -1;
  highestBidder = -1;
  doubled = 0;
  declarer = -1;
  auction: AuctionEntry[] = [];
  private passesInRow = 0;
  private firstSeat = 1;   // 每局輪流先手，startNew 會先切換

  targetScore: number;
  scores: [number, number] = [0, 0];
  handsPlayed = 0;
  lastResult: HandResult | null = null;
  matchWinner = -1;

  private listeners: Listener[] = [];

  constructor(private rng: () => number = Math.random, targetScore = DEFAULT_TARGET) {
    this.targetScore = targetScore;
  }

  on(fn: Listener) { this.listeners.push(fn); }
  private emit(e: GameEvent, to = -1) { for (const fn of this.listeners) fn(e, to); }

  get trickComplete() { return this.leadCard >= 0 && this.followCard >= 0; }
  get faceUp() { return this.stock.length > 0 ? this.stock[0] : -1; }
  get matchOver() { return this.matchWinner >= 0; }
  get minBidIndex() { return this.highestBid >= 0 ? this.highestBid + 1 : 0; }

  // ---------------- 開局 ----------------

  startNewMatch() {
    this.scores = [0, 0];
    this.handsPlayed = 0;
    this.matchWinner = -1;
    this.startNew();
  }

  startNew() {
    if (this.matchOver) { this.startNewMatch(); return; }
    const d = newShuffledDeck(this.rng);
    for (let p = 0; p < 2; p++) {
      this.hands[p] = sortHand(d.slice(p * 13, p * 13 + 13));
      this.takenFaceUp[p] = [];
      this.tricksWon[p] = 0;
    }
    this.stock = d.slice(26);
    this.highestBid = -1; this.highestBidder = -1; this.declarer = -1; this.doubled = 0; this.passesInRow = 0;
    this.auction = [];
    this.lastResult = null;
    this.trump = Strain.NoTrump;            // 抽牌階段不設王牌
    this.phase = Phase.Draw;
    this.firstSeat = other(this.firstSeat);
    this.leader = this.currentPlayer = this.firstSeat;
    this.leadCard = this.followCard = -1;
    this.emit(ev("NewHand", this.firstSeat, -1, this.handsPlayed + 1));
  }

  // ---------------- 出牌 ----------------

  legalFor(p: number) { return legalPlays(this.hands[p], p === this.leader ? null : this.leadCard); }

  playCard(p: number, c: number): boolean {
    if (this.phase !== Phase.Draw && this.phase !== Phase.Play) return false;
    if (p !== this.currentPlayer || this.trickComplete) return false;
    if (!this.hands[p].includes(c)) return false;
    if (!this.legalFor(p).includes(c)) {
      this.emit(ev("Illegal", p, c), p);
      return false;
    }
    this.hands[p].splice(this.hands[p].indexOf(c), 1);
    let winning: boolean, ruff = false;
    if (p === this.leader) {
      this.leadCard = c;
      this.currentPlayer = other(p);
      winning = true;
    } else {
      this.followCard = c;
      winning = beats(c, this.leadCard, this.trump);
      ruff = isTrump(c, this.trump) && !isTrump(this.leadCard, this.trump);
    }
    this.emit(ev("CardPlayed", p, c, winning ? 1 : 0, ruff ? 1 : 0));
    return true;
  }

  trickWinner() { return beats(this.followCard, this.leadCard, this.trump) ? other(this.leader) : this.leader; }

  // 兩張都出完後，由房間停頓一下再呼叫
  resolveTrick() {
    if (!this.trickComplete) return;
    const w = this.trickWinner(), l = other(w);
    const winCard = w === this.leader ? this.leadCard : this.followCard;
    const ruff = w !== this.leader && isTrump(this.followCard, this.trump) && !isTrump(this.leadCard, this.trump);

    if (this.phase === Phase.Draw) {
      this.emit(ev("TrickWon", w, winCard, -1, ruff ? 1 : 0));
      const up = this.stock.shift()!;
      const hidden = this.stock.shift()!;
      this.hands[w].push(up);
      this.hands[l].push(hidden);
      this.takenFaceUp[w].push(up);
      sortHand(this.hands[0]); sortHand(this.hands[1]);
      this.emit(ev("FaceUpTaken", w, up));
      this.emit(ev("CardDrawn", l, hidden), l);   // 自己看得到摸到什麼
      this.emit(ev("CardDrawn", l), w);           // 對手只知道你摸了一張
      this.leadCard = this.followCard = -1;
      if (this.stock.length === 0) {
        this.phase = Phase.Bidding;
        this.currentPlayer = this.firstSeat;
        this.emit(ev("DrawPhaseOver", this.firstSeat));
      } else this.leader = this.currentPlayer = w;
      return;
    }

    this.tricksWon[w]++;
    this.emit(ev("TrickWon", w, winCard, this.tricksWon[w], ruff ? 1 : 0));
    this.leadCard = this.followCard = -1;
    if (this.hands[0].length === 0) this.finishHand();
    else this.leader = this.currentPlayer = w;
  }

  private finishHand() {
    this.phase = Phase.Finished;
    this.emit(ev("GameOver", this.declarer, -1, this.tricksWon[this.declarer], tricksNeeded(this.highestBid)));
    const r = score(this.highestBid, this.doubled, this.declarer, this.tricksWon[this.declarer]);
    this.handsPlayed++;
    r.handNumber = this.handsPlayed;
    this.scores[r.scorer] += r.points;
    this.lastResult = r;
    this.emit(ev("HandScored", r.scorer, -1, r.points, this.scores[r.scorer]));
    if (this.scores[r.scorer] >= this.targetScore) {
      this.matchWinner = r.scorer;
      this.emit(ev("MatchOver", r.scorer, -1, this.scores[r.scorer], this.scores[other(r.scorer)]));
    }
  }

  // ---------------- 叫牌 ----------------

  canDouble(p: number) { return this.phase === Phase.Bidding && this.highestBid >= 0 && this.highestBidder !== p && this.doubled === 0; }
  canRedouble(p: number) { return this.phase === Phase.Bidding && this.highestBid >= 0 && this.highestBidder === p && this.doubled === 1; }

  isLegalCall(p: number, call: number): boolean {
    if (this.phase !== Phase.Bidding || p !== this.currentPlayer) return false;
    if (call === Call.Pass) return true;
    if (call === Call.Double) return this.canDouble(p);
    if (call === Call.Redouble) return this.canRedouble(p);
    return isBid(call) && call >= this.minBidIndex;
  }

  makeCall(p: number, call: number): boolean {
    if (!this.isLegalCall(p, call)) return false;
    this.auction.push({ seat: p, call });

    if (isBid(call)) {
      this.highestBid = call; this.highestBidder = p;
      this.doubled = 0;                      // 蓋叫 → 舊合約的加倍清除
      this.passesInRow = 0;
      this.emit(ev("BidMade", p, -1, call));
      this.currentPlayer = other(p);
      return true;
    }
    if (call === Call.Double) {
      this.doubled = 1;
      this.emit(ev("Doubled", p, -1, this.highestBid));
      this.currentPlayer = other(p);
      return true;
    }
    if (call === Call.Redouble) {
      this.doubled = 2;
      this.emit(ev("Redoubled", p, -1, this.highestBid));
      this.currentPlayer = other(p);
      return true;
    }

    this.passesInRow++;
    this.emit(ev("Passed", p));
    if (this.highestBid >= 0) this.startPlay();          // 已經有合約：一方 Pass 就定約
    else if (this.passesInRow >= 2) {
      this.emit(ev("Redeal"));                           // 雙方起手都 Pass：重發，分數不變
      this.startNew();
    } else this.currentPlayer = other(p);
    return true;
  }

  private startPlay() {
    this.declarer = this.highestBidder;
    this.trump = bidStrain(this.highestBid);
    this.phase = Phase.Play;
    this.tricksWon = [0, 0];
    this.leader = this.currentPlayer = other(this.declarer);   // 非莊家先出
    this.emit(ev("ContractSet", this.declarer, -1, this.highestBid, this.doubled));
  }

  // ---------------- 給某個座位看的牌桌 ----------------

  viewFor(s: number): TableState {
    const o = other(s);
    const canPlay = (this.phase === Phase.Draw || this.phase === Phase.Play) && this.currentPlayer === s && !this.trickComplete;
    const myBidTurn = this.phase === Phase.Bidding && this.currentPlayer === s;
    return {
      seat: s, phase: this.phase,
      hand: this.hands[s].slice(),
      legal: canPlay ? this.legalFor(s) : [],
      oppCount: this.hands[o].length,
      faceUp: this.phase === Phase.Draw ? this.faceUp : -1,
      stockCount: this.stock.length,
      leadCard: this.leadCard, followCard: this.followCard,
      leaderSeat: this.leader, currentSeat: this.currentPlayer,
      myTricks: this.tricksWon[s], oppTricks: this.tricksWon[o],
      oppTakenFaceUp: this.takenFaceUp[o].slice(), myTakenFaceUp: this.takenFaceUp[s].slice(),
      highestBid: this.highestBid, highestBidder: this.highestBidder, declarer: this.declarer,
      minBid: this.minBidIndex, doubled: this.doubled,
      canDouble: myBidTurn && this.canDouble(s), canRedouble: myBidTurn && this.canRedouble(s),
      auctionSeats: this.auction.map(a => a.seat), auctionCalls: this.auction.map(a => a.call),
      myScore: this.scores[s], oppScore: this.scores[o], targetScore: this.targetScore,
      handNumber: this.phase === Phase.Finished ? this.handsPlayed : this.handsPlayed + 1,
      hasResult: this.lastResult !== null, result: this.lastResult ? { ...this.lastResult } : null,
      matchWinner: this.matchWinner,
    };
  }

  // ---------------- 存檔／讀檔（雲端房間睡著再醒來時用） ----------------

  snapshot(): GameSnapshot {
    return JSON.parse(JSON.stringify({
      hands: this.hands, takenFaceUp: this.takenFaceUp, stock: this.stock, tricksWon: this.tricksWon,
      phase: this.phase, currentPlayer: this.currentPlayer, leader: this.leader,
      leadCard: this.leadCard, followCard: this.followCard, trump: this.trump,
      highestBid: this.highestBid, highestBidder: this.highestBidder, doubled: this.doubled, declarer: this.declarer,
      auction: this.auction, passesInRow: this.passesInRow, firstSeat: this.firstSeat,
      targetScore: this.targetScore, scores: this.scores, handsPlayed: this.handsPlayed,
      lastResult: this.lastResult, matchWinner: this.matchWinner,
    }));
  }

  static restore(s: GameSnapshot, rng: () => number = Math.random): HoneymoonGame {
    const g = new HoneymoonGame(rng, s.targetScore);
    const copy: GameSnapshot = JSON.parse(JSON.stringify(s));
    Object.assign(g, copy);
    return g;
  }
}

// 給測試和電腦用：手牌裡有沒有某個花色
export const hasSuit = (hand: number[], suit: number) => hand.some(c => suitOf(c) === suit);
