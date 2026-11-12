// 《梭了啦！這局賭什麼？》模擬用的 AI 對手：只看 viewFor 給的資訊（不偷看對手手牌、鎖牌、未公開方向）
//   保守型 conservative：前段丟小牌省資源、強才加注、被加注不夠強就棄、後段弱牌用保命
//   激進加注型 aggressive：永遠鎖最強的牌、能加就加到上限、能反加就反加、從不棄牌（測「固定加注」是不是無敵）
//   隨機型 random：所有合法動作隨機選
//   唬牌型 bluffer：弱牌常常大加注嚇人、強牌反而裝弱（過牌／接戰）
//   保留極端牌型 hoarder：前段先出中牌，把最大和最小留到第 7–9 墩，配合方向就梭哈
//   平衡型 balanced：照勝率決定（當作「一般玩家」基準）
import type { Action, LSView } from "./engine";
import { CAT_CARDS, Cat, Dir, HIGH, LOW, MID, catOf, compare, flipDir, rankOf } from "./rules";

export type Strategy = (v: LSView, rng: () => number) => Action;

// ---------------- 從這個座位看得到的資訊估勝率 ----------------
// 還沒看過的牌：扣掉自己手上、所有翻開過的牌（棄牌牌面看不到，留在「未知」裡）
function unseen(v: LSView): [number[], number[], number[]] {
  const out = new Set<number>([...v.hand]);
  for (const r of v.history) if (r.cards) { out.add(r.cards[0]); out.add(r.cards[1]); }
  return [0, 1, 2].map(c => CAT_CARDS[c].filter(x => !out.has(x))) as [number[], number[], number[]];
}
// 我的牌 x 對上對手鎖的牌：贏、平的機率（對手分類照他剩幾張；讀心過就只看那一類）
export function odds(v: LSView, x: number, dir: Dir = v.dir): { win: number; tie: number } {
  const opp = 1 - v.seat, cnt = v.counts[opp];
  const pool = unseen(v);
  const weights = [0, 1, 2].map(c => (v.insight >= 0 ? (c === v.insight ? 1 : 0) : cnt[c]));
  const tot = weights.reduce((a, b) => a + b, 0) || 1;
  let win = 0, tie = 0;
  for (const c of [0, 1, 2]) {
    if (!weights[c] || !pool[c].length) continue;
    let w = 0, t = 0;
    for (const y of pool[c]) { const r = compare(x, y, dir); if (r > 0) w++; else if (r === 0) t++; }
    win += (weights[c] / tot) * (w / pool[c].length);
    tie += (weights[c] / tot) * (t / pool[c].length);
  }
  return { win, tie };
}
const pick = <T>(arr: T[], rng: () => number) => arr[Math.floor(rng() * arr.length)];
const by = <T>(arr: T[], f: (x: T) => number) => arr.slice().sort((a, b) => f(a) - f(b));
const myLockOdds = (v: LSView) => (v.myLock >= 0 ? odds(v, v.myLock) : { win: 0.5, tie: 0 });
const extremeFor = (x: number, dir: Dir) => (dir === "high" ? rankOf(x) >= 13 : rankOf(x) <= 3);
const raiseTo = (v: LSView, frac: number) => {
  const r = v.legal.raise!;
  return Math.max(r[0], Math.min(r[1], Math.round(r[0] + (r[1] - r[0]) * frac)));
};
// 最好的牌在目前方向跟翻轉後方向的勝率差
function flipGain(v: LSView): number {
  const best = (d: Dir) => Math.max(...v.hand.map(x => odds(v, x, d).win));
  return best(flipDir(v.dir)) - best(v.dir);
}

// ---------------- 各策略共用的骨架 ----------------
interface Knobs {
  lock(v: LSView, rng: () => number): number;
  flip(v: LSView, rng: () => number): boolean;
  safeguard(v: LSView, rng: () => number): boolean;
  // 輪到下注：face = 面對加注；回傳要做什麼
  bet(v: LSView, rng: () => number, p: { win: number; tie: number }, face: boolean): Action;
  insight?(v: LSView, rng: () => number, p: { win: number; tie: number }): boolean;
}
function make(k: Knobs): Strategy {
  return (v, rng) => {
    const L = v.legal;
    if (L.flip) return { t: "flip", flip: k.flip(v, rng) };
    if (L.safeguard) return { t: "safeguard", use: k.safeguard(v, rng) };
    if (L.lock.length) return { t: "lock", card: k.lock(v, rng) };
    const p = myLockOdds(v);
    if (L.insight && k.insight?.(v, rng, p)) return { t: "insight" };
    const a = k.bet(v, rng, p, L.call);
    // 保險：選到不合法的就退回最保守的合法動作
    if (a.t === "raise" && !L.raise) return L.call ? { t: "call" } : { t: "check" };
    if (a.t === "check" && !L.check) return { t: "call" };
    if ((a.t === "call" || a.t === "fold") && !L.call) return { t: "check" };
    return a;
  };
}
const bestLock = (v: LSView) => by(v.hand, x => -odds(v, x).win)[0];
const worstLock = (v: LSView) => by(v.hand, x => odds(v, x).win)[0];

// ---------------- 策略 ----------------
export const conservative: Strategy = make({
  lock: v => {
    if (v.trick >= 7) return bestLock(v);
    // 前段：能贏的牌裡挑「最不浪費」的（勝率剛好過半），沒有就丟最弱的
    const ok = v.hand.filter(x => odds(v, x).win >= 0.55);
    return ok.length ? by(ok, x => odds(v, x).win)[0] : worstLock(v);
  },
  flip: v => v.trick >= 7 && flipGain(v) >= 0.35,
  safeguard: v => v.trick >= 7 && Math.max(...v.hand.map(x => odds(v, x).win)) < 0.35,
  insight: (v, _r, p) => v.commit[1 - v.seat] >= 4 && p.win > 0.3 && p.win < 0.7,
  bet: (v, _r, p, face) => {
    if (!face) return p.win >= 0.75 && v.legal.raise ? { t: "raise", to: raiseTo(v, 0.3) } : { t: "check" };
    if (p.win >= 0.85 && v.legal.raise) return { t: "raise", to: raiseTo(v, 0.5) };
    return p.win + p.tie / 2 >= 0.55 ? { t: "call" } : { t: "fold" };
  },
});

export const aggressive: Strategy = make({
  lock: v => bestLock(v),
  flip: v => flipGain(v) >= 0.25,
  safeguard: () => false,
  bet: v => (v.legal.raise ? { t: "raise", to: v.legal.raise[1] } : v.legal.call ? { t: "call" } : { t: "check" }),
});

export const random: Strategy = (v, rng) => {
  const L = v.legal;
  if (L.flip) return { t: "flip", flip: rng() < 0.3 };
  if (L.safeguard) return { t: "safeguard", use: rng() < 0.2 };
  if (L.lock.length) return { t: "lock", card: pick(L.lock, rng) };
  const opts: Action[] = [];
  if (L.check) opts.push({ t: "check" });
  if (L.call) opts.push({ t: "call" }, { t: "fold" });
  if (L.insight && rng() < 0.3) opts.push({ t: "insight" });
  if (L.raise) opts.push({ t: "raise", to: L.raise[0] + Math.floor(rng() * (L.raise[1] - L.raise[0] + 1)) });
  return pick(opts, rng);
};

export const bluffer: Strategy = make({
  lock: (v, rng) => (rng() < 0.5 ? worstLock(v) : bestLock(v)),
  flip: v => flipGain(v) >= 0.4,
  safeguard: () => false,
  bet: (v, rng, p, face) => {
    if (!face) {
      if (p.win < 0.35 && v.legal.raise && rng() < 0.7) return { t: "raise", to: v.legal.raise[1] };   // 唬：弱牌直接推高
      if (p.win > 0.7) return { t: "check" };                                                          // 強牌裝弱
      return v.legal.raise && rng() < 0.3 ? { t: "raise", to: raiseTo(v, 0.5) } : { t: "check" };
    }
    if (p.win > 0.75 && v.legal.raise) return { t: "raise", to: v.legal.raise[1] };
    if (p.win >= 0.4) return { t: "call" };
    return rng() < 0.4 ? { t: "call" } : { t: "fold" };
  },
});

export const hoarder: Strategy = make({
  lock: v => {
    if (v.trick <= 6) {
      // 前段：先出中牌（挑方向上比較好的），沒中牌再出最不極端的
      const mids = v.hand.filter(x => catOf(x) === MID);
      if (mids.length) return by(mids, x => -odds(v, x).win)[0];
      return by(v.hand, x => Math.min(Math.abs(rankOf(x) - 14), Math.abs(rankOf(x) - 2)) * -1)[0];
    }
    return bestLock(v);
  },
  flip: v => v.trick >= 7 && !v.hand.some(x => extremeFor(x, v.dir)) && v.hand.some(x => extremeFor(x, flipDir(v.dir))),
  safeguard: v => v.trick >= 7 && !v.hand.some(x => extremeFor(x, v.dir)) && Math.max(...v.hand.map(x => odds(v, x).win)) < 0.4,
  bet: (v, _r, p, face) => {
    const ext = v.myLock >= 0 && extremeFor(v.myLock, v.dir);
    if (v.allInStage && ext && v.legal.raise) return { t: "raise", to: v.legal.raise[1] };            // 留到最後的極端牌：梭哈
    if (!face) return p.win >= 0.7 && v.legal.raise ? { t: "raise", to: raiseTo(v, 0.4) } : { t: "check" };
    return p.win + p.tie / 2 >= 0.5 ? { t: "call" } : { t: "fold" };
  },
});

export const balanced: Strategy = make({
  lock: v => {
    if (v.trick >= 7) return bestLock(v);
    // 中段：需要的時候才用好牌；勝率差不多就留極端牌
    const scored = v.hand.map(x => ({ x, w: odds(v, x).win, keep: (catOf(x) === HIGH && rankOf(x) >= 13) || (catOf(x) === LOW && rankOf(x) <= 3) ? 0.15 : 0 }));
    return by(scored, s => -(s.w - s.keep))[0].x;
  },
  flip: v => flipGain(v) >= (v.trick >= 7 ? 0.25 : 0.4),
  safeguard: v => v.trick >= 7 && Math.max(...v.hand.map(x => odds(v, x).win)) < 0.3,
  insight: (v, _r, p) => v.commit[1 - v.seat] - v.commit[v.seat] >= 2 && p.win > 0.25 && p.win < 0.75,
  bet: (v, rng, p, face) => {
    const eq = p.win + p.tie / 2;
    if (!face) {
      if (eq >= 0.68 && v.legal.raise) return { t: "raise", to: raiseTo(v, eq >= 0.85 ? 1 : 0.4) };
      if (eq < 0.25 && v.legal.raise && rng() < 0.15) return { t: "raise", to: raiseTo(v, 0.5) };     // 偶爾唬一下
      return { t: "check" };
    }
    const need = v.commit[1 - v.seat] - v.commit[v.seat];
    const potOdds = need / (v.commit[1 - v.seat] * 2 + v.pool[0] + v.pool[1]);
    if (eq >= 0.85 && v.legal.raise) return { t: "raise", to: v.legal.raise[1] };
    return eq >= Math.max(0.35, potOdds) ? { t: "call" } : { t: "fold" };
  },
});

export const STRATEGIES: Record<string, Strategy> = { conservative, aggressive, random, bluffer, hoarder, balanced };
export const STRATEGY_LABEL: Record<string, string> = {
  conservative: "保守型", aggressive: "激進加注型", random: "隨機型", bluffer: "唬牌型", hoarder: "保留極端牌型", balanced: "平衡型",
};
export const CAT_NAMES: Record<Cat, string> = { [LOW]: "小", [MID]: "中", [HIGH]: "大" } as Record<Cat, string>;
