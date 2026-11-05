// 第一版簡化計分（docs/SPEC.md，跟 Unity 版 Scoring.cs 一樣）
//   打成：莊家得「線數 × 10 × 倍率」+ 每超 1 墩 2 分
//   倒約：防守方每倒 1 墩得「10 × 倍率」
//   倍率：沒加倍 ×1、加倍 ×2、再加倍 ×4
import { bidLevel, bidText, tricksNeeded } from "./cards";

export const PER_LEVEL = 10;
export const PER_OVERTRICK = 2;
export const PER_UNDERTRICK = 10;
export const DEFAULT_TARGET = 100;

export interface HandResult {
  handNumber: number;
  declarer: number;
  bidIndex: number;
  doubled: number;
  tricksNeeded: number;
  tricksTaken: number;
  made: boolean;
  overtricks: number;
  undertricks: number;
  contractPoints: number;
  overtrickPoints: number;
  penaltyPoints: number;
  scorer: number;
  points: number;
}

export const multiplier = (doubled: number) => doubled >= 2 ? 4 : doubled === 1 ? 2 : 1;
export const madePoints = (bid: number, doubled: number) => bidLevel(bid) * PER_LEVEL * multiplier(doubled);
export const pointsPerUndertrick = (doubled: number) => PER_UNDERTRICK * multiplier(doubled);

export function score(bid: number, doubled: number, declarer: number, tricksTaken: number): HandResult {
  const need = tricksNeeded(bid);
  const r: HandResult = {
    handNumber: 0, declarer, bidIndex: bid, doubled, tricksNeeded: need, tricksTaken,
    made: tricksTaken >= need, overtricks: 0, undertricks: 0,
    contractPoints: 0, overtrickPoints: 0, penaltyPoints: 0, scorer: -1, points: 0,
  };
  if (r.made) {
    r.overtricks = tricksTaken - need;
    r.contractPoints = madePoints(bid, doubled);
    r.overtrickPoints = r.overtricks * PER_OVERTRICK;
    r.scorer = declarer;
    r.points = r.contractPoints + r.overtrickPoints;
  } else {
    r.undertricks = need - tricksTaken;
    r.penaltyPoints = r.undertricks * pointsPerUndertrick(doubled);
    r.scorer = 1 - declarer;
    r.points = r.penaltyPoints;
  }
  return r;
}

// ---------------- 畫面文字 ----------------

export const doubledText = (d: number) => d >= 2 ? "再加倍" : d === 1 ? "加倍" : "";
export const contractText = (bid: number, d: number) => d > 0 ? `${bidText(bid)} ${doubledText(d)}` : bidText(bid);

export const declarerPreview = (bid: number, d: number) =>
  `目標 ${tricksNeeded(bid)} 墩｜打成 ${madePoints(bid, d)} 分｜每倒 1 墩對手得 ${pointsPerUndertrick(d)} 分`;

export const defenderPreview = (bid: number, d: number, name: string) =>
  `${name}目標 ${tricksNeeded(bid)} 墩｜打成${name}得 ${madePoints(bid, d)} 分｜每倒 1 墩你得 ${pointsPerUndertrick(d)} 分`;

export function breakdown(r: HandResult, mySeat: number, oppName: string): string[] {
  const name = (s: number) => s === mySeat ? "你" : oppName;
  const mult = multiplier(r.doubled);
  const m = mult > 1 ? ` × ${mult}` : "";
  const lines = [
    `合約 ${contractText(r.bidIndex, r.doubled)}（${name(r.declarer)}是莊家）`,
    r.made
      ? `需要 ${r.tricksNeeded} 墩，拿到 ${r.tricksTaken} 墩 → 打成` + (r.overtricks > 0 ? `，超 ${r.overtricks} 墩` : "")
      : `需要 ${r.tricksNeeded} 墩，拿到 ${r.tricksTaken} 墩 → 倒 ${r.undertricks} 墩`,
  ];
  if (r.made) {
    lines.push(`合約分：${bidLevel(r.bidIndex)} 線 × ${PER_LEVEL}${m} = ${r.contractPoints}`);
    if (r.overtricks > 0) lines.push(`超墩分：${r.overtricks} 墩 × ${PER_OVERTRICK} = ${r.overtrickPoints}`);
  } else {
    lines.push(`倒約分：${r.undertricks} 墩 × ${PER_UNDERTRICK}${m} = ${r.penaltyPoints}`);
  }
  lines.push(`${name(r.scorer)} +${r.points} 分`);
  return lines;
}
