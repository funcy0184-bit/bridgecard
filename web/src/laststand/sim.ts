// 《逆命賭局》平衡模擬：不同 AI 策略互打，統計勝率、提前結束、加注／棄牌次數、梭哈逆轉、先手與宣戰權、中間牌強弱
// 每一步都檢查 30 枚守恆；任何一場卡住或不合法都直接報錯
import { LastStandGame, actorsNow } from "./engine";
import { STRATEGIES, Strategy } from "./ai";
import { Cat, Stage, TOTAL_CHIPS, seededRng } from "./rules";

export interface MatchStats {
  winner: number; endTrick: number; reason: string;
  raises: number; reraises: number; folds: number; allIns: number; allInCalled: number; ties: number;
  safeguards: number; insights: number; flips: number; refunds: number;
  behindAt7: number;                 // 第 7 墩開始時落後的座位（-1 = 沒人落後或沒打到第 7 墩）
  comeback: boolean;                 // 第 7 墩開始時落後的人最後贏了
  allInComeback: boolean;            // 上面的逆轉裡，有贏下被接戰的梭哈
  coinWinner: boolean | null;        // 第 1 墩拿宣戰權的座位（共拿 5 次宣戰權、4 次下注先手）有沒有贏；平手 null
  roleNet: { declarer: number; firstBettor: number };   // 各角色在每一墩淨賺的籌碼（加總）
  cardNet: Record<string, { n: number; win: number; net: number }>;   // 依鎖的牌分類（含方向）：出現次數、贏墩、淨籌碼
}

export function playMatch(s0: Strategy, s1: Strategy, seed: number, stages?: Stage[]): { g: LastStandGame; st: MatchStats } {
  const rng = seededRng(seed);
  const g = LastStandGame.newMatch(rng, undefined, stages);
  const strat = [s0, s1];
  let guard = 0;
  while (!g.over) {
    const who = actorsNow(g);
    if (!who.length) throw new Error(`第 ${seed} 場卡住了（沒有人能動）`);
    for (const seat of who) {
      if (g.over || !actorsNow(g).includes(seat)) continue;
      const a = strat[seat](g.viewFor(seat), rng);
      const r = g.act(seat, a);
      if (!r.ok) throw new Error(`第 ${seed} 場座位 ${seat} 不合法：${JSON.stringify(a)} → ${r.msg}`);
      if (g.total() !== TOTAL_CHIPS) throw new Error(`第 ${seed} 場籌碼不守恆：${g.total()}`);
    }
    if (++guard > 400) throw new Error(`第 ${seed} 場走太多步`);
  }
  const s = g.s, res = s.result!;
  const st: MatchStats = {
    winner: res.winner, endTrick: res.trick, reason: res.reason,
    raises: 0, reraises: 0, folds: 0, allIns: 0, allInCalled: 0, ties: 0, safeguards: 0, insights: 0, flips: 0, refunds: 0,
    behindAt7: -1, comeback: false, allInComeback: false, coinWinner: res.winner < 0 ? null : res.winner === s.coin,
    roleNet: { declarer: 0, firstBettor: 0 }, cardNet: {},
  };
  for (const r of s.history) {
    st.raises += r.steps.filter(x => x.act === "raise" && !x.reraise).length;
    st.reraises += r.steps.filter(x => x.reraise).length;
    if (r.outcome === "fold") st.folds++;
    if (r.outcome === "tie") st.ties++;
    if (r.allIn >= 0) { st.allIns++; if (r.outcome !== "fold") st.allInCalled++; }
    if (r.safeguardBy >= 0) st.safeguards++;
    st.insights += r.insight.filter(Boolean).length;
    if (r.flippedBy >= 0) st.flips++;
    if (r.refund) st.refunds++;
    if (r.trick === 7) {
      const [a, b] = r.startStacks;
      st.behindAt7 = a < b ? 0 : b < a ? 1 : -1;
    }
    // 每一墩誰賺了多少：（結算後手上＋疊池裡自己的出資）−（開始時手上＋疊池裡自己的出資）；兩人加起來一定是 0
    const net = [0, 1].map(p => r.stacksAfter[p] + r.poolAfter[p] - r.startStacks[p] - r.poolBefore[p]);
    st.roleNet.declarer += net[r.declarer];
    st.roleNet.firstBettor += net[r.firstBettor];
    // 依鎖的牌分類（翻牌、同點、棄牌都知道分類）
    for (const p of [0, 1]) {
      const cat: Cat = r.cats[p];
      const key = `${r.dir}:${cat}`;
      const c = (st.cardNet[key] ??= { n: 0, win: 0, net: 0 });
      c.n++; if (r.winner === p) c.win++; c.net += net[p];
    }
  }
  if (st.behindAt7 >= 0 && res.winner === st.behindAt7) {
    st.comeback = true;
    st.allInComeback = s.history.some(r => r.trick >= 7 && r.allIn >= 0 && r.outcome !== "fold" && r.winner === res.winner);
  }
  return { g, st };
}

export interface PairResult {
  a: string; b: string; n: number; winA: number; winB: number; draw: number;
  early: number; endTrick: number[]; avg: Record<string, number>;
  behind7: number; comeback: number; allInComeback: number; coinWins: number; coinDecided: number;
  roleNet: { declarer: number; firstBettor: number };
  cardNet: Record<string, { n: number; win: number; net: number }>;
}

// a 對 b 打 n 場：座位輪流換（偶數場 a 坐 0 號），硬幣照亂數
export function runPair(a: string, b: string, n: number, seed0 = 1, stages?: Stage[]): PairResult {
  const out: PairResult = { a, b, n, winA: 0, winB: 0, draw: 0, early: 0, endTrick: Array(10).fill(0), avg: {}, behind7: 0, comeback: 0, allInComeback: 0, coinWins: 0, coinDecided: 0,
    roleNet: { declarer: 0, firstBettor: 0 }, cardNet: {} };
  const sums: Record<string, number> = { raises: 0, reraises: 0, folds: 0, allIns: 0, allInCalled: 0, ties: 0, safeguards: 0, insights: 0, flips: 0, refunds: 0 };
  for (let i = 0; i < n; i++) {
    const aSeat = i % 2;
    const strat = aSeat === 0 ? [STRATEGIES[a], STRATEGIES[b]] : [STRATEGIES[b], STRATEGIES[a]];
    const { st } = playMatch(strat[0], strat[1], seed0 * 100003 + i, stages);
    if (st.winner < 0) out.draw++; else if (st.winner === aSeat) out.winA++; else out.winB++;
    if (st.endTrick < 9) out.early++;
    out.endTrick[st.endTrick]++;
    for (const k of Object.keys(sums)) sums[k] += (st as unknown as Record<string, number>)[k];
    if (st.behindAt7 >= 0) out.behind7++;
    if (st.comeback) out.comeback++;
    if (st.allInComeback) out.allInComeback++;
    if (st.coinWinner !== null) { out.coinDecided++; if (st.coinWinner) out.coinWins++; }
    out.roleNet.declarer += st.roleNet.declarer; out.roleNet.firstBettor += st.roleNet.firstBettor;
    for (const [k, v] of Object.entries(st.cardNet)) { const c = (out.cardNet[k] ??= { n: 0, win: 0, net: 0 }); c.n += v.n; c.win += v.win; c.net += v.net; }
  }
  for (const k of Object.keys(sums)) out.avg[k] = sums[k] / n;
  return out;
}
