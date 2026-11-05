// 牌與叫品：跟 Unity 版 Card.cs 同一套編號，連線時只傳數字
//   牌：0..51 = 花色 × 13 + (點數 - 2)；花色 0♣ 1♦ 2♥ 3♠；點數 2..14（14 = A）
//   叫品：0..34 = (線數 - 1) × 5 + 王牌；王牌 0♣ 1♦ 2♥ 3♠ 4 無王

export const Suit = { Clubs: 0, Diamonds: 1, Hearts: 2, Spades: 3 } as const;
export const Strain = { Clubs: 0, Diamonds: 1, Hearts: 2, Spades: 3, NoTrump: 4 } as const;
export type SuitId = 0 | 1 | 2 | 3;
export type StrainId = 0 | 1 | 2 | 3 | 4;

export const SUIT_SYMBOL = ["♣", "♦", "♥", "♠"] as const;

export const suitOf = (id: number) => Math.floor(id / 13) as SuitId;
export const rankOf = (id: number) => (id % 13) + 2;
export const cardId = (suit: number, rank: number) => suit * 13 + (rank - 2);
export const isRedSuit = (s: number) => s === Suit.Hearts || s === Suit.Diamonds;
export const isRedCard = (id: number) => isRedSuit(suitOf(id));
export const hcpOf = (id: number) => { const r = rankOf(id); return r >= 11 ? r - 10 : 0; };
export const rankText = (r: number) => ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? String(r);
export const cardText = (id: number) => SUIT_SYMBOL[suitOf(id)] + rankText(rankOf(id));

// 手牌排序：♠ ♥ ♦ ♣，同花色由大到小（跟 Unity 版 Deck.SortHand 一樣）
export function sortHand(hand: number[]): number[] {
  return hand.sort((a, b) => suitOf(a) !== suitOf(b) ? suitOf(b) - suitOf(a) : rankOf(b) - rankOf(a));
}

export function newShuffledDeck(rng: () => number): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------------- 叫品 ----------------

export const bidLevel = (i: number) => Math.floor(i / 5) + 1;
export const bidStrain = (i: number) => (i % 5) as StrainId;
export const bidIndex = (level: number, strain: number) => (level - 1) * 5 + strain;
export const tricksNeeded = (i: number) => bidLevel(i) + 6;
export const strainText = (s: number) => s === Strain.NoTrump ? "NT" : SUIT_SYMBOL[s];
export const bidText = (i: number) => bidLevel(i) + strainText(bidStrain(i));
export const isRedBid = (i: number) => bidStrain(i) === Strain.Hearts || bidStrain(i) === Strain.Diamonds;

// 叫牌動作：0..34 叫品，負數是特殊叫
export const Call = { Pass: -1, Double: -2, Redouble: -3 } as const;
export const isBid = (c: number) => c >= 0 && c < 35;
export function callText(c: number): string {
  if (c === Call.Pass) return "Pass";
  if (c === Call.Double) return "加倍";
  if (c === Call.Redouble) return "再加倍";
  return isBid(c) ? bidText(c) : "?";
}

// 測試用的固定亂數（mulberry32）：同一個種子 → 同一副牌
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
