// 事件導演：從「公開的對局紀錄」整理出可以拿來演的事（敘事事件）和雙方的行為統計
//   · 只吃公開資料（publicOf 會把手牌、鎖的牌、讀心結果拿掉）：雙方看到的節目一樣，也不會提早說出還沒翻的牌
//   · 純函數、從頭重算：重新整理、斷線回來、同一筆事件重送，統計都不會多加一次；同一件事的 id 永遠一樣
//   · 結果型的事（翻轉後輸、逆轉、同點……）只從「已經結算的墩」判斷
import type { BetStep, LSView, TrickRecord } from "../engine";
import { START_CHIPS, TRICKS } from "../rules";
import { PRESSURE, PRIORITY, REPORTABLE, SETTLED } from "./config";
import type { Beat, BeatData, BeatType, PublicMatch } from "./types";

// 從牌桌畫面資料取出公開的部分（hand、myLock、insight、myInsights、legal 一律不拿）
export function publicOf(v: LSView): PublicMatch & { stake: number } {
  return {
    trick: v.trick, phase: v.phase, toAct: v.toAct, declarer: v.declarer, firstBettor: v.firstBettor,
    dir: v.dir, nextDir: v.nextDir, flippedBy: v.flippedBy, safeguard: v.safeguard,
    ante: v.ante, cap: v.cap, allInStage: v.allInStage, stake: v.stake,
    stacks: [v.stacks[0], v.stacks[1]], commit: [v.commit[0], v.commit[1]], pool: [v.pool[0], v.pool[1]],
    insightUsed: [v.insightUsed[0], v.insightUsed[1]],
    steps: v.steps.map(s => ({ ...s })), history: JSON.parse(JSON.stringify(v.history)) as TrickRecord[],
    result: v.result ? { ...v.result } : null,
  };
}

export interface SeatStats {
  raises: number; reraises: number; raiseTricks: number[]; raiseStreak: number; maxRaiseStreak: number;
  folds: number; foldTricks: number[]; foldStreak: number; maxFoldStreak: number;
  allIns: number; allInCalls: number; insights: number; insightFolds: number;
  raiserFolded: boolean;         // 加注很多次之後第一次棄牌（記仇用，只演一次）
  flips: { trick: number; outcome: "won" | "lost" | "tie" | "pending" }[];
  safeguards: { trick: number; outcome: "won" | "lost" | "tie" | "pending" }[];
  won: number; lost: number; loseStreak: number; maxLoseStreak: number;
}
export interface MatchStats {
  seats: [SeatStats, SeatStats];
  maxPool: { size: number; trick: number };
  biggestBet: { amount: number; trick: number; winner: number; allIn: boolean } | null;   // 雙方都押到的最大一墩（接戰後翻牌）
  leadChanges: { trick: number; leader: number }[];
  leader: number;                 // 目前持有領先的人（-1 同分）
  holdings: [number, number];     // 最近一墩結算後的持有（手上＋疊池裡自己的出資）
  tricksSettled: number;
}
export interface Analysis { beats: Beat[]; stats: MatchStats; pressure: Pressure }

export type Stage = "idle" | "deciding" | "offer" | "checked" | "called" | "folded" | "over";
export interface Pressure { level: 1 | 2 | 3 | 4; stage: Stage; offer: number; matched: number; pool: number; raiser: number }

const blank = (): SeatStats => ({
  raises: 0, reraises: 0, raiseTricks: [], raiseStreak: 0, maxRaiseStreak: 0, folds: 0, foldTricks: [], foldStreak: 0, maxFoldStreak: 0,
  allIns: 0, allInCalls: 0, insights: 0, insightFolds: 0, raiserFolded: false, flips: [], safeguards: [],
  won: 0, lost: 0, loseStreak: 0, maxLoseStreak: 0,
});
const recOf = (h: TrickRecord[], t: number) => h.find(r => r.trick === t);
const holdAfter = (r: TrickRecord): [number, number] => [r.stacksAfter[0] + r.poolAfter[0], r.stacksAfter[1] + r.poolAfter[1]];
const holdBefore = (r: TrickRecord): [number, number] => [r.startStacks[0] + r.poolBefore[0], r.startStacks[1] + r.poolBefore[1]];
// 連續幾墩（照墩數，不看同一墩按了幾次）：最後一個是 t，往前數連續的墩
function streakEnding(tricks: number[], t: number): number {
  const set = new Set(tricks);
  let n = 0;
  while (set.has(t - n)) n++;
  return n;
}

// 下注壓力：只看公開的金額、墩數、雙方籌碼
export function levelOf(trick: number, ante: number, offer: number, pool: number, before: [number, number]): 1 | 2 | 3 | 4 {
  const lo = Math.min(before[0], before[1]), gap = Math.abs(before[0] - before[1]);
  if (trick >= PRESSURE.decisiveFrom && offer > ante && (offer >= lo || 2 * offer + pool > gap)) return 4;
  if (offer >= PRESSURE.highAmount || pool >= PRESSURE.highPool || (lo > 0 && offer >= lo * PRESSURE.highShare && offer > ante)) return 3;
  if (offer > ante && offer >= ante * PRESSURE.midRaiseRatio) return 2;
  return 1;
}

export function analyze(m: PublicMatch & { stake?: number }): Analysis {
  const seats: [SeatStats, SeatStats] = [blank(), blank()];
  const beats: Beat[] = [];
  let seq = 0;
  const emit = (key: string, type: BeatType, trick: number, seat: number, data: BeatData = {}) => {
    beats.push({ id: `${trick}:${key}`, seq: ++seq, type, kind: "narrative", trick, seat, priority: PRIORITY[type], settled: SETTLED.has(type), reportable: REPORTABLE.has(type), data });
  };
  const stats: MatchStats = { seats, maxPool: { size: 0, trick: 0 }, biggestBet: null, leadChanges: [], leader: -1, holdings: [START_CHIPS, START_CHIPS], tricksSettled: 0 };
  let holdings: [number, number] = [START_CHIPS, START_CHIPS];
  let pressure: Pressure = { level: 1, stage: "idle", offer: 0, matched: 0, pool: 0, raiser: -1 };

  const last = Math.max(m.trick, ...m.history.map(r => r.trick), 0);
  for (let t = 1; t <= last; t++) {
    const r = recOf(m.history, t);
    const live = !r && t === m.trick && !m.result;
    if (!r && !live) continue;
    const steps: BetStep[] = r ? r.steps : m.steps;
    const before: [number, number] = r ? holdBefore(r) : [holdings[0], holdings[1]];
    const ante = r ? r.ante : m.ante, cap = r ? r.cap : m.cap, stake = r ? r.stake : (m.stake ?? m.ante);
    const flippedBy = r ? r.flippedBy : m.flippedBy, safeBy = r ? r.safeguardBy : m.safeguard;
    const poolBefore = r ? r.poolBefore[0] + r.poolBefore[1] : m.pool[0] + m.pool[1];
    const insight: [boolean, boolean] = r ? r.insight : [0, 1].map(s => m.insightUsed[s] && !m.history.some(x => x.insight[s])) as [boolean, boolean];

    // ---- 開局、最後一墩、翻轉、保命 ----
    if (t === 1) emit("start", "match_start", t, -1);
    if (t === TRICKS) emit("final", "final_trick", t, -1);
    if (flippedBy >= 0) { emit("flip", "flip", t, flippedBy, { dir: r ? r.dir : m.dir }); seats[flippedBy].flips.push({ trick: t, outcome: "pending" }); }
    if (safeBy >= 0) { emit("safe", "safeguard", t, safeBy); seats[safeBy].safeguards.push({ trick: t, outcome: "pending" }); }

    // ---- 下注：照順序一步一步看（讀心插在使用者回應加注之前） ----
    const commit: [number, number] = [stake, stake];
    const raisedThis = [false, false], insightDone = [false, false];
    let lastRaise: BetStep | null = null, stage: Stage = live ? "deciding" : "idle";
    steps.forEach((st, i) => {
      const s = st.seat, o = 1 - s, me = seats[s];
      const responding = lastRaise && lastRaise.seat === o && (st.act === "call" || st.act === "fold" || (st.act === "raise" && st.reraise));
      if (insight[s] && !insightDone[s] && responding) { insightDone[s] = true; me.insights++; emit(`ins${s}`, "insight", t, s); }
      if (st.act === "raise") {
        const prior = me.raises;
        me.raises++;
        if (st.reraise) me.reraises++;
        commit[s] = st.to;
        const level = levelOf(t, ante, st.to, poolBefore, before);
        let type: BeatType;
        if (st.allIn) { type = "allin_offer"; me.allIns++; }
        else if (st.reraise) type = "reraise";
        else if (st.to >= cap) type = "raise_cap";
        else if (level >= 3) type = "big_offer";
        else if (prior === 0) type = "raise_first";
        else type = "raise";
        emit(`s${i}:${type}`, type, t, s, { to: st.to, level, count: me.raises });
        if (!raisedThis[s]) {
          raisedThis[s] = true;
          me.raiseTricks.push(t);
          me.raiseStreak = streakEnding(me.raiseTricks, t);
          me.maxRaiseStreak = Math.max(me.maxRaiseStreak, me.raiseStreak);
          if (me.raiseStreak === 3) emit(`s${i}:streak3`, "raise_streak3", t, s, { streak: 3, count: me.raises });
          else if (me.raiseStreak >= 4) emit(`s${i}:streakN`, "raise_streak_more", t, s, { streak: me.raiseStreak, count: me.raises });
        }
        lastRaise = st;
        stage = "offer";
      } else if (st.act === "call") {
        commit[s] = commit[o];
        const level = levelOf(t, ante, commit[s], poolBefore, before);
        if (lastRaise?.allIn && lastRaise.seat === o) { me.allInCalls++; emit(`s${i}:allin_called`, t === TRICKS ? "allin_called_final" : "allin_called", t, s, { to: commit[s], level }); }
        else if (level >= 3) emit(`s${i}:big_call`, "big_call", t, s, { to: commit[s], level });
        else emit(`s${i}:call`, "call", t, s, { to: commit[s], level });
        stage = "called";
      } else if (st.act === "fold") {
        me.folds++;
        me.foldTricks.push(t);
        me.foldStreak = streakEnding(me.foldTricks, t);
        me.maxFoldStreak = Math.max(me.maxFoldStreak, me.foldStreak);
        const level = levelOf(t, ante, commit[o], poolBefore, before);
        const pressured = commit[o] >= ante * 2 || steps.slice(0, i).some(x => x.reraise);
        if (lastRaise?.allIn && lastRaise.seat === o) emit(`s${i}:allin_folded`, "allin_folded", t, s, { to: commit[o], level, pressured });
        else if (level >= 3) emit(`s${i}:big_fold`, "big_fold", t, s, { to: commit[o], level, pressured });
        else emit(`s${i}:fold`, "fold", t, s, { to: commit[o], level, pressured });
        if (insight[s]) { me.insightFolds++; emit(`s${i}:insight_fold`, "insight_fold", t, s); }
        if (me.foldStreak === 3) emit(`s${i}:fold3`, "fold_streak3", t, s, { streak: 3, count: me.folds });
        // 記仇：已經加注 3 次以上（或連續 3 墩加注）的人，第一次棄牌
        if ((me.raises >= 3 || me.maxRaiseStreak >= 3) && !me.raiserFolded) { me.raiserFolded = true; emit(`s${i}:after_raiser`, "fold_after_raiser", t, s, { count: me.raises }); }
        stage = "folded";
      } else stage = "checked";
    });
    // 讀心用了、還沒回應（還在想）：放在最後
    for (const s of [0, 1]) if (insight[s] && !insightDone[s]) { seats[s].insights++; emit(`ins${s}`, "insight", t, s); }

    if (live) {
      const offer = Math.max(commit[0], commit[1]), matched = Math.min(commit[0], commit[1]);
      pressure = { level: levelOf(t, ante, offer, poolBefore, before), stage: m.phase === "bet" ? stage : "deciding", offer, matched, pool: poolBefore, raiser: lastRaise ? (lastRaise as BetStep).seat : -1 };
      continue;
    }

    // ---- 結算（只看已經結算的墩）----
    const rec = r!;
    const w = rec.winner, after = holdAfter(rec);
    stats.tricksSettled = t;
    if (rec.outcome === "tie") {
      emit("end:tie", "tie", t, -1, { cards: rec.cards ?? undefined, pool: rec.poolAfter[0] + rec.poolAfter[1] });
      if (poolBefore > 0 && !rec.refund) emit("end:pool_grow", "tie_pool_grow", t, -1, { pool: rec.poolAfter[0] + rec.poolAfter[1] });
    }
    const poolNow = rec.poolAfter[0] + rec.poolAfter[1];
    if (poolNow > stats.maxPool.size) stats.maxPool = { size: poolNow, trick: t };
    if (w >= 0) {
      seats[w].won++; seats[w].loseStreak = 0;
      const l = seats[1 - w];
      l.lost++; l.loseStreak++; l.maxLoseStreak = Math.max(l.maxLoseStreak, l.loseStreak);
      if (l.loseStreak === 3) emit(`end:lose3:${1 - w}`, "lose_streak3", t, 1 - w, { streak: 3 });
    } else { seats[0].loseStreak = 0; seats[1].loseStreak = 0; }
    const outcomeOf = (s: number) => (w < 0 ? "tie" : w === s ? "won" : "lost") as "won" | "lost" | "tie";
    if (flippedBy >= 0) {
      seats[flippedBy].flips[seats[flippedBy].flips.length - 1].outcome = outcomeOf(flippedBy);
      if (w === 1 - flippedBy) emit("end:flip_lost", "flip_lost", t, flippedBy, { dir: rec.dir, winner: w });
    }
    if (safeBy >= 0) {
      seats[safeBy].safeguards[seats[safeBy].safeguards.length - 1].outcome = outcomeOf(safeBy);
      emit("end:safe", "safeguard_result", t, safeBy, { winner: w, amount: rec.ante - rec.stake });
    }
    if (rec.poolTaken >= PRESSURE.highPool && w >= 0) emit("end:pool_taken", "pool_taken", t, w, { amount: rec.poolTaken, stacks: rec.stacksAfter });
    const moved = rec.transfer + rec.poolTaken;
    if ((rec.outcome === "showdown" || rec.outcome === "tie") && Math.min(rec.commit[0], rec.commit[1]) > 0) {
      const matched = Math.min(rec.commit[0], rec.commit[1]);
      if (!stats.biggestBet || matched > stats.biggestBet.amount) stats.biggestBet = { amount: matched, trick: t, winner: w, allIn: rec.allIn >= 0 };
      if (rec.allIn >= 0 && rec.outcome === "showdown") emit("end:big_result", "big_result", t, w, { amount: matched, cards: rec.cards ?? undefined, winner: w, stacks: rec.stacksAfter });
    }
    if (w >= 0 && moved >= 5 && !(rec.allIn >= 0 && rec.outcome === "showdown")) emit("end:swing", "big_swing", t, 1 - w, { amount: moved, before: [before[0], before[1]], after: [after[0], after[1]], stacks: rec.stacksAfter, winner: w });
    for (const p of [0, 1]) if (before[p] < before[1 - p] && after[p] > after[1 - p]) emit(`end:comeback${p}`, "comeback", t, p, { before: [before[0], before[1]], after: [after[0], after[1]] });
    if (rec.refund) emit("end:refund", "refund", t, -1, { reason: rec.refund.reason, stacks: rec.stacksAfter });
    const leader = after[0] === after[1] ? -1 : after[0] > after[1] ? 0 : 1;
    if (leader !== stats.leader && leader >= 0) stats.leadChanges.push({ trick: t, leader });
    stats.leader = leader;
    holdings = after;
    stats.holdings = [after[0], after[1]];
    if (m.result && m.result.trick === t) {
      if (m.result.reason === "elimination") { const z = rec.stacksAfter.findIndex(x => x === 0); emit("end:eliminated", "eliminated", t, z, { stacks: rec.stacksAfter }); }
      emit("end:match", "match_over", t, m.result.winner, { winner: m.result.winner, stacks: rec.stacksAfter, reason: m.result.reason });
      pressure = { level: 1, stage: "over", offer: 0, matched: 0, pool: 0, raiser: -1 };
    } else if (t === 4) emit("intermission", "intermission", t, -1, { stacks: [after[0], after[1]], pool: poolNow });
  }
  return { beats, stats, pressure };
}
