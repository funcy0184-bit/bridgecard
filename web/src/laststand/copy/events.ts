// 《逆命賭局》事件判定表：文案只能說「真的發生過的事」
// 判定只用伺服器的對局紀錄（LSState.history）；棄牌的確切牌面只有在雙方賽後同意揭露時才拿來算 bluff_verified
// 「持有」= 手上籌碼 + 疊池裡自己的出資（比誰領先時用這個，疊池裡的錢不會被當成輸掉）
import type { LSState, TrickRecord } from "../engine";
import { START_CHIPS, TRICKS, compare } from "../rules";

// ---------------- 對局中（每墩最多一句）的事件 ----------------
export type LiveEvent =
  | "raise" | "reraise" | "call" | "fold" | "fold_after_raise" | "allin_announced" | "allin_called"
  | "direction_flip" | "tie" | "pool_win" | "safeguard" | "insight" | "comeback" | "final_trick" | "chip_zero" | "vow_echo";
// ---------------- 賽後戰報的事件 ----------------
export type MatchEvent =
  | "finish_general" | "finish_draw" | "allin_loss" | "allin_win" | "last_trick_comeback" | "fold_win"
  | "bluff_verified" | "tie_pool" | "vow_backfire" | "safeguard_save" | "fold_streak";

// 判定表（給人看、也給測試對照）：每一個事件什麼時候成立
export const EVENT_RULES: Record<LiveEvent | MatchEvent, string> = {
  raise: "某人在本墩做「首次加注」，而且不是梭哈（第 7–9 墩加到上限另算 allin_announced）。actor＝加注者",
  reraise: "某人「反加」，而且不是梭哈。actor＝反加者",
  call: "面對加注選擇接戰，而且對方那次不是梭哈（梭哈被接另算 allin_called）。actor＝接戰者",
  fold: "某人棄牌（本遊戲只有面對加注才能棄牌）。actor＝棄牌者",
  fold_after_raise: "棄牌，而且棄牌者面對的承諾至少是本墩底注的 2 倍，或是被反加後棄牌（有壓力的棄牌）。actor＝棄牌者",
  allin_announced: "第 7–9 墩有人把本墩承諾加到上限（梭哈）。actor＝梭哈方",
  allin_called: "梭哈之後對方接戰。actor＝接戰者",
  direction_flip: "宣戰權玩家使用翻轉。actor＝翻轉者；directionLabel＝翻轉後的方向",
  tie: "翻牌同點（不看花色）",
  pool_win: "有人拿走疊池（翻牌贏或對方棄牌，疊池原本不是空的）。actor＝拿走的人",
  safeguard: "有人宣告保命。actor＝宣告者",
  insight: "有人使用讀心（結果只有本人看得到）。actor＝使用者",
  comeback: "這一墩結算前嚴格落後、結算後嚴格領先（看持有）。actor＝新的領先者",
  final_trick: "第 9 墩開始",
  chip_zero: "有人在結算、退款之後手上歸零（淘汰）。actor＝歸零的人",
  vow_echo: "有填賽前豪言的人，在第 5 墩以後某墩結算後持有 ≤ 9 枚（落後 12 枚以上）；每場最多一次。actor＝那個人",
  finish_general: "有勝負（不是平手）時一定成立（保底）",
  finish_draw: "第 9 墩結算、疊池退完後雙方持有相同",
  allin_loss: "有被接戰而且分出勝負的梭哈，梭哈方是本場落敗者、輸了那一墩。keyTrick＝最後一次；amount＝梭哈方那墩的承諾",
  allin_win: "有被接戰而且分出勝負的梭哈，梭哈方是本場勝者、贏了那一墩。keyTrick＝最後一次",
  last_trick_comeback: "打滿 9 墩；第 9 墩開始時勝者沒有領先（落後或同分），第 9 墩結算後勝出",
  fold_win: "有一墩是「勝者加注（或反加）、敗者棄牌」。keyTrick＝這種墩裡轉移最多（含疊池）的一墩",
  bluff_verified: "雙方賽後都同意揭露，而且伺服器比對：上面那種棄牌墩裡，棄牌者（敗者）的牌照當墩方向原本會贏",
  tie_pool: "有同點而且疊池留到下一墩（沒有當墩退款），最大一次疊池雙方合計 ≥ 4 枚。keyTrick＝形成最大疊池的那一墩",
  vow_backfire: "有勝負，而且敗者的賽前豪言不是空的（只回放原句，不解讀）",
  safeguard_save: "有人在保命墩輸了，而且省下的籌碼（有效底注 − 1）≥ 2（也就是第 7–9 墩）。actor＝保命者",
  fold_streak: "敗者本場棄牌 3 次以上",
};

// 戰報優先順序：主事件＋一則側事件（企劃書：決勝梭哈失敗 > 最後一墩翻盤 > 同意揭露的被唬退 > 大額疊池 > 豪言打臉 > 其他）
export const MATCH_PRIORITY: MatchEvent[] = [
  "finish_draw", "allin_loss", "last_trick_comeback", "allin_win", "bluff_verified", "tie_pool", "vow_backfire", "fold_win", "safeguard_save", "fold_streak", "finish_general",
];

export interface Found<E> { type: E; keyTrick?: number; actor?: number; amount?: number; directionLabel?: string }

// 持有：第 t 墩結算後（t = 0 表示開局）；照墩數找紀錄（不靠陣列位置）
export const recOf = (h: TrickRecord[], t: number) => h.find(r => r.trick === t);
export const holdingsBefore = (r: TrickRecord): [number, number] => [r.startStacks[0] + r.poolBefore[0], r.startStacks[1] + r.poolBefore[1]];
export function holdingsAfter(h: TrickRecord[], t: number): [number, number] {
  const r = recOf(h, t);
  if (r) return [r.stacksAfter[0] + r.poolAfter[0], r.stacksAfter[1] + r.poolAfter[1]];
  const next = h.find(x => x.trick === t + 1);
  return next ? holdingsBefore(next) : [START_CHIPS, START_CHIPS];
}
const raisedBy = (r: TrickRecord, p: number) => r.steps.some(s => s.act === "raise" && s.seat === p);

// ---------------- 每一墩的對局事件 ----------------
export function liveEventsOfTrick(h: TrickRecord[], t: number, vows: [string, string] = ["", ""], echoed = false): Found<LiveEvent>[] {
  const r = recOf(h, t);
  if (!r) return [];
  const out: Found<LiveEvent>[] = [];
  if (t === TRICKS) out.push({ type: "final_trick" });
  if (r.flippedBy >= 0) out.push({ type: "direction_flip", actor: r.flippedBy, directionLabel: r.dir === "high" ? "比大" : "比小" });
  if (r.safeguardBy >= 0) out.push({ type: "safeguard", actor: r.safeguardBy });
  r.insight.forEach((u, p) => { if (u) out.push({ type: "insight", actor: p }); });
  let allInSeat = -1;
  r.steps.forEach((s, i) => {
    if (s.act === "raise" && s.allIn) { allInSeat = s.seat; out.push({ type: "allin_announced", actor: s.seat }); }
    else if (s.act === "raise") out.push({ type: s.reraise ? "reraise" : "raise", actor: s.seat });
    else if (s.act === "call") out.push({ type: allInSeat >= 0 && allInSeat !== s.seat ? "allin_called" : "call", actor: s.seat });
    else if (s.act === "fold") {
      out.push({ type: "fold", actor: s.seat });
      const facing = r.commit[1 - s.seat];
      if (facing >= r.ante * 2 || r.steps.slice(0, i).some(x => x.reraise)) out.push({ type: "fold_after_raise", actor: s.seat });
    }
  });
  if (r.outcome === "tie") out.push({ type: "tie" });
  if (r.poolTaken > 0) out.push({ type: "pool_win", actor: r.winner });
  const before = holdingsBefore(r), after = holdingsAfter(h, t);
  for (const p of [0, 1]) if (before[p] < before[1 - p] && after[p] > after[1 - p]) out.push({ type: "comeback", actor: p });
  const zero = r.stacksAfter.findIndex(x => x === 0);
  if (zero >= 0) out.push({ type: "chip_zero", actor: zero });
  if (!echoed && t >= 5) for (const p of [0, 1]) if (vows[p] && after[p] <= 9) { out.push({ type: "vow_echo", actor: p }); break; }
  return out;
}

// ---------------- 賽後：事實與事件 ----------------
export interface Facts {
  winner: number; loser: number; draw: boolean; fullNine: boolean;
  loserVowExists: boolean; revealConsentBoth: boolean;
  loserLedBeforeFinal: boolean;    // 第 9 墩開始時敗者嚴格領先
  loserLedAllEight: boolean;       // 第 1–8 墩每墩結算後敗者都嚴格領先
  loserLedBeforeKey: boolean;      // 關鍵梭哈墩（allin_win）開始前敗者嚴格領先
  keyTrickIsFinal: boolean;        // 關鍵梭哈墩是第 9 墩
  allInWholeStack: boolean;        // 關鍵梭哈（allin_loss）時，梭哈方推出的是自己全部的籌碼
}
export interface MatchSummary { facts: Facts; events: Found<MatchEvent>[] }

export function summarize(s: LSState, o: { vows?: [string, string]; revealConsentBoth?: boolean } = {}): MatchSummary {
  const h = s.history, res = s.result;
  if (!res) throw new Error("比賽還沒結束，不能產生戰報");
  const vows = o.vows ?? ["", ""];
  const draw = res.winner < 0;
  const winner = draw ? -1 : res.winner, loser = draw ? -1 : 1 - res.winner;
  const fullNine = res.trick === TRICKS;           // 九墩都打了（第 9 墩梭哈把人打到歸零也算）
  const facts: Facts = {
    winner, loser, draw, fullNine,
    loserVowExists: !draw && !!vows[loser]?.trim(), revealConsentBoth: !!o.revealConsentBoth,
    loserLedBeforeFinal: false, loserLedAllEight: false, loserLedBeforeKey: false, keyTrickIsFinal: false, allInWholeStack: false,
  };
  const events: Found<MatchEvent>[] = [];
  if (draw) { events.push({ type: "finish_draw" }); return { facts, events }; }

  if (fullNine) {
    const r9 = recOf(h, 9)!, b9 = holdingsBefore(r9);
    facts.loserLedBeforeFinal = b9[loser] > b9[winner];
    facts.loserLedAllEight = [1, 2, 3, 4, 5, 6, 7, 8].every(t => { const x = holdingsAfter(h, t); return x[loser] > x[winner]; });
    if (b9[winner] <= b9[loser]) events.push({ type: "last_trick_comeback", keyTrick: 9 });
  }
  // 被接戰、分出勝負的梭哈
  const decidedAllIns = h.filter(r => r.allIn >= 0 && r.outcome === "showdown");
  const lost = decidedAllIns.filter(r => r.allIn === loser && r.winner === winner).at(-1);
  if (lost) {
    events.push({ type: "allin_loss", keyTrick: lost.trick, actor: loser, amount: lost.commit[loser] });
    facts.allInWholeStack = lost.commit[loser] === lost.startStacks[loser];
  }
  const won = decidedAllIns.filter(r => r.allIn === winner && r.winner === winner).at(-1);
  if (won) {
    events.push({ type: "allin_win", keyTrick: won.trick, actor: winner, amount: won.commit[winner] });
    const before = holdingsBefore(won);
    facts.loserLedBeforeKey = before[loser] > before[winner];
    facts.keyTrickIsFinal = won.trick === TRICKS;
  }
  // 勝者加注、敗者棄牌
  const folds = h.filter(r => r.outcome === "fold" && r.folder === loser && r.winner === winner && raisedBy(r, winner));
  if (folds.length) {
    const key = folds.slice().sort((a, b) => (b.transfer + b.poolTaken) - (a.transfer + a.poolTaken))[0];
    events.push({ type: "fold_win", keyTrick: key.trick, actor: winner, amount: key.transfer + key.poolTaken });
    if (facts.revealConsentBoth) {
      // 只有雙方同意揭露才看棄牌牌面：棄牌者的牌照當墩方向原本會贏
      const verified = folds.filter(r => {
        const f = s.folded.find(x => x.trick === r.trick);
        return !!f && compare(f.cards[loser], f.cards[winner], r.dir) === 1;
      });
      if (verified.length) events.push({ type: "bluff_verified", keyTrick: verified.at(-1)!.trick, actor: winner });
    }
  }
  // 疊池留到下一墩、最大一次 ≥ 4
  const carried = h.filter(r => r.outcome === "tie" && !r.refund).map(r => ({ t: r.trick, size: r.poolAfter[0] + r.poolAfter[1] }));
  const big = carried.sort((a, b) => b.size - a.size)[0];
  if (big && big.size >= 4) events.push({ type: "tie_pool", keyTrick: big.t, amount: big.size });
  if (facts.loserVowExists) events.push({ type: "vow_backfire" });
  const save = h.find(r => r.safeguardBy >= 0 && r.winner === 1 - r.safeguardBy && r.ante - r.stake >= 2);
  if (save) events.push({ type: "safeguard_save", keyTrick: save.trick, actor: save.safeguardBy, amount: save.ante - save.stake });
  if (h.filter(r => r.outcome === "fold" && r.folder === loser).length >= 3) events.push({ type: "fold_streak" });
  events.push({ type: "finish_general" });
  events.sort((a, b) => MATCH_PRIORITY.indexOf(a.type) - MATCH_PRIORITY.indexOf(b.type));
  return { facts, events };
}
