// 《梭了啦！這局賭什麼？》（程式代號 laststand，舊名逆命賭局）Last Stand：規則常數與純工具（不碰網路、不碰畫面；跟蜜月橋牌完全分開）
//
// 一場：2 人、9 墩、各 15 枚（總共 30 枚，永遠守恆）
// 發牌：一副 52 張不放回，每人 3 大（J–A）、3 中（7–10）、3 小（2–6），花色與點數隨機
// 方向：9 墩洗成 5 個比大、4 個比小；只公開當墩與下一墩；同點不看花色
// 底注／上限（每人「本墩總承諾」）：第 1–3 墩 1／3；第 4–6 墩 2／4；第 7–9 墩 3／雙方有效籌碼（可梭哈）
//   （P0 模擬後採方案 B：中段上限從企劃書的 6 降到 4，減少第 4–6 墩就有人被打光；企劃書原值留在 GDD_STAGES 方便比較）
//   有效底注 = min(階段底注, 雙方該墩開始時的手上籌碼)；上限 = min(階段上限, 雙方該墩開始時的手上籌碼)
//   上限用「該墩開始時」的籌碼算，扣了底注之後不會再被降低一次

export const START_CHIPS = 15;
export const TOTAL_CHIPS = START_CHIPS * 2;
export const TRICKS = 9;
export const HIGH_DIRS = 5;            // 9 墩裡有 5 墩比大、4 墩比小

// 卡片：id 0..51 = 花色 × 13 + (點數 − 2)；點數 A=14、K=13……2=2
export const rankOf = (id: number) => (id % 13) + 2;
export const suitOf = (id: number) => Math.floor(id / 13);
// 花色符號順序跟牌面圖（game/cards 的 SUIT_SYMBOL）一致：文字寫的花色＝畫面上畫的花色（梭了啦比大小不看花色）
export const SUITS = ["♣", "♦", "♥", "♠"];
export const RANK_TEXT: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
export const cardText = (id: number) => `${SUITS[suitOf(id)]}${RANK_TEXT[rankOf(id)] ?? rankOf(id)}`;

// 分類：0 小（2–6）、1 中（7–10）、2 大（J–A）
export type Cat = 0 | 1 | 2;
export const LOW: Cat = 0, MID: Cat = 1, HIGH: Cat = 2;
export const CAT_LABEL = ["小", "中", "大"] as const;
export const catOf = (id: number): Cat => { const r = rankOf(id); return r >= 11 ? HIGH : r >= 7 ? MID : LOW; };
export const CAT_CARDS: [number[], number[], number[]] = [[], [], []];
for (let id = 0; id < 52; id++) CAT_CARDS[catOf(id)].push(id);

export type Dir = "high" | "low";
export const DIR_LABEL: Record<Dir, string> = { high: "比大", low: "比小" };
export const flipDir = (d: Dir): Dir => (d === "high" ? "low" : "high");

// a 跟 b 比（這一墩的方向）：1 = a 贏、-1 = b 贏、0 = 同點
export function compare(a: number, b: number, dir: Dir): 1 | -1 | 0 {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra === rb) return 0;
  return (ra > rb) === (dir === "high") ? 1 : -1;
}

// 階段：底注與每人最高承諾總額（第 7–9 墩上限是雙方有效籌碼，cap = -1 表示「可梭哈」）
// 預設照企劃書 V2.0；做成參數只是為了平衡模擬比較不同數值，正式對局用預設值
export interface Stage { ante: number; cap: number }
export const DEFAULT_STAGES: Stage[] = [{ ante: 1, cap: 3 }, { ante: 2, cap: 4 }, { ante: 3, cap: -1 }];     // 方案 B（正式）
export const GDD_STAGES: Stage[] = [{ ante: 1, cap: 3 }, { ante: 2, cap: 6 }, { ante: 3, cap: -1 }];         // 企劃書原值（方案 A）
export const PLAN_C_STAGES: Stage[] = [{ ante: 1, cap: 3 }, { ante: 1, cap: 4 }, { ante: 3, cap: -1 }];      // 方案 C（比較用）
export function stageOf(trick: number, stages: Stage[] = DEFAULT_STAGES): { ante: number; cap: number } {
  const st = stages[trick <= 3 ? 0 : trick <= 6 ? 1 : 2];
  return { ante: st.ante, cap: st.cap < 0 ? Infinity : st.cap };
}
export const allInStage = (trick: number) => trick >= 7;

// 宣戰權（翻轉）與下注先手：每墩分給不同人，各自逐墩交替；第 1 墩由開局擲硬幣決定
export const declarerOf = (coin: number, trick: number) => (coin + trick - 1) % 2;
export const firstBettorOf = (coin: number, trick: number) => 1 - declarerOf(coin, trick);

// 可重現的亂數（測試、模擬用；正式對局由伺服器給 crypto 亂數）
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
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 發牌：每人各分類 3 張（同一副牌不放回）；方向 5 比大 4 比小洗勻
export function deal(rng: () => number): { hands: [number[], number[]]; directions: Dir[] } {
  const hands: [number[], number[]] = [[], []];
  for (const cat of [HIGH, MID, LOW]) {
    const pile = shuffle(CAT_CARDS[cat], rng);
    hands[0].push(...pile.slice(0, 3));
    hands[1].push(...pile.slice(3, 6));
  }
  const directions = shuffle([...Array(HIGH_DIRS).fill("high"), ...Array(TRICKS - HIGH_DIRS).fill("low")] as Dir[], rng);
  return { hands: [sortCards(hands[0]), sortCards(hands[1])], directions };
}
export const sortCards = (cards: number[]) => cards.slice().sort((a, b) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b));
export const catCounts = (cards: number[]): [number, number, number] => {
  const c: [number, number, number] = [0, 0, 0];
  for (const id of cards) c[catOf(id)]++;
  return c;
};
