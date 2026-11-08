// Impact Score／Impact Tier：一墩牌「到底有多重要」。
// 純計算、不碰畫面：只看已確認的事件（TrickWon）和這一墩「之前」的公開牌桌狀態
// （合約、加倍、雙方墩數、比分、翻開的明牌），絕不看任何人的手牌。
//
//   Tier 0 一般出牌（Heavy Card）     所有牌落桌的基本重量；搶牌時拿到普通明牌
//   Tier 1 強力出牌（Solid Impact）   已確認的一般贏墩；搶牌時搶到大牌明牌（J 以上）
//   Tier 2 特殊出牌（Heavy Impact）   王吃；背水一墩（一墩都不能丟還拿下）；加倍局裡「再一墩就定案」
//   Tier 3 關鍵出牌（Critical Impact）這一墩讓合約確定打成，或確定倒約（不用等到最後一墩）
//   Tier 4 決勝爆發（Final Impact）   加倍／再加倍或大滿貫等級的合約打成；這一墩確定拿下整場
//
// 不盲目累加：先依「主要事件」決定等級（整場勝負 > 合約定案 > 背水／再一墩 > 王吃 > 一般贏墩），
// 其他條件只做有限度的加成（power），同一墩只有一個主要高潮。
import { bidLevel, rankOf, tricksNeeded } from "../game/cards";
import { Phase, type GameEvent, type TableState } from "../game/game";
import { madePoints, pointsPerUndertrick } from "../game/scoring";

export type Tier = 0 | 1 | 2 | 3 | 4;
export type ImpactKind = "play" | "draw" | "faceup" | "trick" | "matchpoint" | "ruff" | "pivot" | "made" | "set" | "match";
export type Crack = "none" | "hairline" | "ink" | "gold";

export interface Impact {
  tier: Tier;
  kind: ImpactKind;          // 主要事件
  score: number;             // Impact Score（有限度加成後）
  power: number;             // 同一級裡的強弱 0..1
  winnerMe: boolean;         // 這墩是不是你贏的
  good: boolean;             // 對「你」是不是好事（決定歡慶或沉重）
  doubled: number;
  label: string;             // 簡短事件文字（沒有就空字串）
  reasons: string[];         // 為什麼是這一級（測試、除錯用）
  crack: Crack;
  hitstop: number;           // 定格毫秒（0 = 不定格）
  comeback: boolean;         // 整場：這一墩讓本來落後的一方拿下比賽
  outcome: "made" | "set" | null;   // 這一墩讓合約定案：打成／倒約
}

// 初始權重（設計方向，可以調）
export const WEIGHTS = { trick: 1, faceup: 1, ruff: 3, doubledKey: 2, redoubledKey: 3, made: 5, set: 5, reversal: 3, match: 6, pivot: 3, matchpoint: 2 };

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));

// 合約風險：線數越高、加倍越多越危險（0..1）。張力系統也用這個
export function contractRisk(bid: number, doubled: number): number {
  if (bid < 0) return 0;
  return clamp(((bidLevel(bid) - 1) / 6) * 0.6 + [0, 0.22, 0.4][Math.min(2, doubled)]);
}

// 出牌本體的重量（Layer A）：每張牌都有重量；大牌、王吃、高風險合約稍微重一點。
// 這只影響落桌的手感，跟這墩會不會贏無關（大牌不等於已經贏了）。
export function playWeight(card: number, ruff: boolean, s: Pick<TableState, "phase" | "highestBid" | "doubled"> | null): number {
  let w = 1;
  const r = rankOf(card);
  if (r === 14) w += 0.1; else if (r === 13) w += 0.06; else if (r === 12) w += 0.03;
  if (ruff) w += 0.12;
  if (s && s.phase === Phase.Play && s.highestBid >= 0) w += contractRisk(s.highestBid, s.doubled) * 0.35;   // 加倍局：基本拍桌感略微加重
  return clamp(w, 0.85, 1.5);
}

const TIER_SCORE: Record<Tier, [number, number]> = { 0: [0, 1], 1: [1, 2], 2: [2, 7], 3: [5, 10], 4: [6, 14] };

// 這一墩的衝擊（TrickWon 進來時呼叫；s 是這一墩之前的狀態）
export function evaluateTrick(e: Pick<GameEvent, "type" | "seat" | "extra">, s: TableState): Impact {
  const winnerMe = e.seat === s.seat;
  const base = (tier: Tier, kind: ImpactKind, score: number, reasons: string[], label = "", extra: Partial<Impact> = {}): Impact => {
    const [lo, hi] = TIER_SCORE[tier];
    return {
      tier, kind, score, power: clamp((score - lo) / Math.max(1, hi - lo)), winnerMe, good: winnerMe, doubled: s.doubled, label, reasons,
      crack: tier >= 4 ? (winnerMe ? "gold" : "ink") : tier === 3 ? "ink" : tier === 2 ? "hairline" : "none",
      hitstop: 0, comeback: false, outcome: null, ...extra,
    };
  };

  // ---- 前半場：搶牌（不算分，搶的是明牌） ----
  if (s.phase === Phase.Draw) {
    const up = s.faceUp;
    if (up >= 0 && rankOf(up) >= 11) return base(1, "faceup", WEIGHTS.faceup, ["搶到 J 以上的明牌"]);
    return base(0, "draw", 0, ["搶牌：普通明牌"]);
  }
  if (s.phase !== Phase.Play || s.declarer < 0 || s.highestBid < 0) return base(1, "trick", WEIGHTS.trick, ["一般贏墩"]);

  // ---- 後半場：看合約的數學 ----
  const need = tricksNeeded(s.highestBid);
  const setAt = 14 - need;                                   // 防守方拿到這麼多墩，合約就不可能打成了
  const iDecl = s.declarer === s.seat;
  const declBefore = iDecl ? s.myTricks : s.oppTricks;
  const defBefore = iDecl ? s.oppTricks : s.myTricks;
  const left = 13 - (declBefore + defBefore);                // 包含這一墩
  const winnerDecl = e.seat === s.declarer;
  const declAfter = declBefore + (winnerDecl ? 1 : 0);
  const defAfter = defBefore + (winnerDecl ? 0 : 1);
  const decidedBefore = declBefore >= need || defBefore >= setAt;   // 之前就已經定案了：之後的墩不再是關鍵
  const ruff = e.extra === 1;
  const d = s.doubled;
  const dBonus = d >= 2 ? WEIGHTS.redoubledKey : d === 1 ? WEIGHTS.doubledKey : 0;
  const made = !decidedBefore && winnerDecl && declAfter === need;
  const set = !decidedBefore && !winnerDecl && defAfter === setAt;

  if (made || set) {
    // 這一墩讓合約定案。保證拿到的分數夠不夠拿下整場？（只有得分的一方會加分）
    const scorerIsMe = made ? iDecl : !iDecl;
    const scorerScore = scorerIsMe ? s.myScore : s.oppScore;
    const otherScore = scorerIsMe ? s.oppScore : s.myScore;
    const remaining = left - 1;                              // 這一墩之後還剩幾墩
    const guaranteed = made ? madePoints(s.highestBid, d) : pointsPerUndertrick(d) * Math.max(1, need - (declAfter + remaining));
    const clinch = scorerScore + guaranteed >= s.targetScore;
    const reasons = [made ? "這一墩確定打成合約" : "這一墩確定合約倒約"];
    if (ruff) reasons.push("王吃");
    if (d) reasons.push(d >= 2 ? "再加倍" : "加倍");
    if (clinch) {
      const comeback = scorerScore < otherScore;
      reasons.push("確定拿下整場", ...(comeback ? ["逆轉"] : []));
      const score = WEIGHTS.match + Math.min(3, dBonus) + (comeback ? WEIGHTS.reversal : 0) + (ruff ? 1 : 0);
      return base(4, "match", score, reasons, comeback ? "逆轉！" : "決勝一墩", { hitstop: 130 + Math.round(40 * clamp(score / 14)), comeback, outcome: made ? "made" : "set" });
    }
    const highRisk = made && (d >= 1 || contractRisk(s.highestBid, d) >= 0.6);
    const score = (made ? WEIGHTS.made : WEIGHTS.set) + dBonus + (ruff ? 1 : 0);
    if (highRisk) return base(4, "made", score + 1, [...reasons, "高風險合約"], "打成！", { hitstop: 120 + Math.round(30 * clamp(score / 10)), outcome: "made" });
    return base(3, made ? "made" : "set", score, reasons, made ? "打成！" : "倒約！", { hitstop: 60 + Math.round(40 * clamp((score - 5) / 4)), outcome: made ? "made" : "set" });
  }

  if (!decidedBefore) {
    // 背水一墩：這一方需要剩下的每一墩，這墩拿下來了（還沒定案）
    const pivot = winnerDecl ? need - declBefore === left : setAt - defBefore === left;
    if (pivot) {
      const score = WEIGHTS.pivot + dBonus + (ruff ? 1 : 0);
      return base(2, "pivot", score, ["一墩都不能丟，拿下來了", ...(ruff ? ["王吃"] : []), ...(d ? ["加倍局"] : [])], "關鍵一墩", { hitstop: 50 });
    }
    // 再一墩就定案：贏的這一方離目標只差一墩（加倍局才升到 Tier 2）
    const oneAway = winnerDecl ? need - declAfter === 1 : setAt - defAfter === 1;
    if (oneAway && d >= 1) {
      const score = WEIGHTS.matchpoint + dBonus + (ruff ? 1 : 0);
      return base(2, "matchpoint", score, ["加倍局：再一墩就定案", ...(ruff ? ["王吃"] : [])], winnerDecl ? "再一墩打成" : "再一墩倒約", { hitstop: 40 });
    }
    if (ruff) return base(2, "ruff", WEIGHTS.ruff + (d ? 1 : 0), ["王吃成功"], "王吃！", { hitstop: 50 });
    if (oneAway) return base(1, "matchpoint", WEIGHTS.trick + 1, ["再一墩就定案"]);
  } else if (ruff) {
    // 合約已經定案後的王吃：還是王吃，但不是轉折，降一級
    return base(1, "ruff", WEIGHTS.trick + 1, ["王吃（合約已定案）"]);
  }
  return base(1, "trick", WEIGHTS.trick, ["一般贏墩"]);
}

// 給舊的回饋分級（1 一般／2 關鍵／3 合約級）和測試紀錄用
export const legacyLevel = (t: Tier): 1 | 2 | 3 => (t >= 3 ? 3 : t === 2 ? 2 : 1);

// 同一墩只演一次（網路延遲、重新整理都不會重播同一墩的結果）
export class ImpactGate {
  private seen = new Set<string>();
  once(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 120) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }
}
export const trickKey = (s: TableState) => `${s.handNumber}:${s.phase}:${s.myTricks + s.oppTricks}:${s.phase === Phase.Draw ? s.stockCount : 0}`;
