// 簡單電腦（Unity 版 SimpleAI.cs）：只看自己的手牌做決定。
// 連線版第一版用不到，留給模擬測試和之後的「斷線由電腦接手」
import { Call, Strain, bidIndex, rankOf, suitOf, tricksNeeded, bidStrain } from "./cards";
import { HoneymoonGame, Phase } from "./game";
import { beats, hcp, isTrump } from "./rules";

const lowest = (l: number[]) => l.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
const highest = (l: number[]) => l.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];

export function chooseCard(g: HoneymoonGame, p: number): number {
  const opts = g.legalFor(p);
  const leading = p === g.leader;
  if (g.phase === Phase.Draw) {
    const want = g.faceUp >= 0 && rankOf(g.faceUp) >= 10;
    if (leading) return want ? highest(opts) : lowest(opts);
    const win = opts.filter(c => beats(c, g.leadCard, g.trump));
    return want && win.length > 0 ? lowest(win) : lowest(opts);
  }
  if (leading) {
    const aces = opts.filter(c => rankOf(c) === 14 && !isTrump(c, g.trump));
    if (aces.length > 0) return aces[0];
    const bySuit = new Map<number, number[]>();
    for (const c of opts) bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) ?? []), c]);
    const longest = [...bySuit.values()].sort((a, b) => b.length - a.length)[0];
    return lowest(longest);
  }
  const winners = opts.filter(c => beats(c, g.leadCard, g.trump));
  if (winners.length > 0) return lowest(winners);
  const nonTrump = opts.filter(c => !isTrump(c, g.trump));
  return lowest(nonTrump.length > 0 ? nonTrump : opts);
}

// 3000 局模擬回歸出來的係數（跟 Unity 版一樣）
export function estimateTricks(hand: number[], strain: number): number {
  const h = hcp(hand);
  if (strain === Strain.NoTrump) return 4.44 + 0.221 * h;
  const len = hand.filter(c => suitOf(c) === strain).length;
  return 2.70 + 0.142 * h + 0.780 * len;
}

const SUIT_SAFETY = 0.35, NT_SAFETY = 0.9, OPEN_FLOOR = 6.4;
const DOUBLE_MARGIN = 3.0, NT_DOUBLE_MARGIN = 3.5, REDOUBLE_MARGIN = 1.5;
const safety = (s: number) => s === Strain.NoTrump ? NT_SAFETY : SUIT_SAFETY;

export function chooseBid(g: HoneymoonGame, p: number): number | null {
  const h = g.hands[p];
  const nobodyBid = g.minBidIndex === 0;
  let best: number | null = null, bestMargin = -Infinity;
  for (let s = 0; s < 5; s++) {
    const est = estimateTricks(h, s);
    let lv = 1;
    while (lv <= 7 && bidIndex(lv, s) < g.minBidIndex) lv++;
    if (lv > 7) continue;
    const margin = est - safety(s) - (lv + 6);
    const openAnyway = nobodyBid && lv === 1 && est >= OPEN_FLOOR;
    if (margin < 0 && !openAnyway) continue;
    if (margin > bestMargin) { bestMargin = margin; best = bidIndex(lv, s); }
  }
  if (best === null) return null;
  const bs = bidStrain(best);
  const jump = Math.min(7, Math.floor(estimateTricks(h, bs) - safety(bs)) - 6);
  return bidIndex(Math.max(Math.floor(best / 5) + 1, jump), bs);
}

export function chooseCall(g: HoneymoonGame, p: number): number {
  if (g.highestBidder === p)
    return g.canRedouble(p) && shouldRedouble(g, p) ? Call.Redouble : Call.Pass;
  const bid = chooseBid(g, p);
  if (bid !== null) return bid;
  if (g.canDouble(p) && shouldDouble(g, p)) return Call.Double;
  return Call.Pass;
}

function shouldDouble(g: HoneymoonGame, p: number) {
  const s = bidStrain(g.highestBid);
  const margin = s === Strain.NoTrump ? NT_DOUBLE_MARGIN : DOUBLE_MARGIN;
  return estimateTricks(g.hands[p], s) - margin > 13 - tricksNeeded(g.highestBid);
}

function shouldRedouble(g: HoneymoonGame, p: number) {
  const s = bidStrain(g.highestBid);
  return estimateTricks(g.hands[p], s) - safety(s) >= tricksNeeded(g.highestBid) + REDOUBLE_MARGIN;
}
