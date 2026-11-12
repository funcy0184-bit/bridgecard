// 把規則判定「說成人話」：這墩為什麼是這個人贏、現在能出什麼、為什麼不能出。
// 只用 rules.ts 的 beats／isTrump／legalPlays 判斷，牌桌、教學、測試都用這一份，不會各說各話。
// 只看公開的牌（兩張已經出的牌、自己的手牌、合約王牌），不碰對手的手牌。
import { SUIT_SYMBOL, Strain, cardText, rankOf, suitOf } from "./cards";
import { beats, isTrump, legalPlays } from "./rules";

export const SUIT_NAME = ["梅花", "方塊", "紅心", "黑桃"] as const;
export const suitWord = (s: number) => `${SUIT_SYMBOL[s]} ${SUIT_NAME[s]}`;
export const trumpWord = (trump: number) => trump === Strain.NoTrump ? "無王" : `${SUIT_SYMBOL[trump]} ${SUIT_NAME[trump]}`;

export interface TrickWhy {
  leaderWins: boolean;
  winnerCard: number;
  kind: "same-suit" | "ruff" | "trump-vs-trump" | "off-suit" | "trump-lead";
  why: string;          // 為什麼（不含誰贏）
}

// lead：先出的牌（領出花色）；follow：後出的牌；trump：Strain（搶牌階段請傳 NoTrump）
export function whyTrick(lead: number, follow: number, trump: number, followName: string): TrickWhy {
  const followWins = beats(follow, lead, trump);
  const ls = suitOf(lead), fs = suitOf(follow);
  const ln = SUIT_NAME[ls];
  const lt = isTrump(lead, trump), ft = isTrump(follow, trump);
  if (lt && ft) {
    return { leaderWins: !followWins, winnerCard: followWins ? follow : lead, kind: "trump-vs-trump",
      why: `兩張都是王牌（${SUIT_NAME[trump]}），比點數：${cardText(followWins ? follow : lead)} 比 ${cardText(followWins ? lead : follow)} 大。` };
  }
  if (followWins && ft) {
    return { leaderWins: false, winnerCard: follow, kind: "ruff",
      why: `本墩先出${ln}，${followName}沒有${ln}，用${SUIT_NAME[trump]}王牌王吃。` };
  }
  if (fs === ls) {
    return { leaderWins: !followWins, winnerCard: followWins ? follow : lead, kind: "same-suit",
      why: `同樣是${ln}，比點數：${cardText(followWins ? follow : lead)} 比 ${cardText(followWins ? lead : follow)} 大。` };
  }
  if (lt) {
    return { leaderWins: true, winnerCard: lead, kind: "trump-lead",
      why: `本墩先出的是王牌（${SUIT_NAME[trump]}），${followName}的 ${cardText(follow)} 不是王牌。` };
  }
  // 後出的人沒跟領出花色、也不是王牌：再大也贏不了
  const bigger = rankOf(follow) > rankOf(lead) ? `點數再大也沒用` : "";
  const notTrump = trump === Strain.NoTrump ? "（本局無王）" : "，也不是王牌";
  return { leaderWins: true, winnerCard: lead, kind: "off-suit",
    why: `本墩先出${ln}，${followName}的${SUIT_NAME[fs]}不是領出花色${notTrump}${bigger ? `，${bigger}` : ""}。` };
}

// 一句完整的結果：「阿元贏：本墩先出黑桃，你的方塊不是領出花色，也不是王牌。」
export function trickSentence(lead: number, follow: number, trump: number, leaderName: string, followerName: string): { winnerIsLeader: boolean; text: string } {
  const w = whyTrick(lead, follow, trump, followerName === "你" ? "你" : followerName);
  return { winnerIsLeader: w.leaderWins, text: `${w.leaderWins ? leaderName : followerName}贏：${w.why}` };
}

// 輪到你跟牌時該怎麼出（只看你的手牌和桌上的領出牌）
export function followAdvice(hand: number[], lead: number, trump: number, draw: boolean): string {
  const ls = suitOf(lead), ln = SUIT_NAME[ls];
  if (hand.some(c => suitOf(c) === ls)) return `你還有${SUIT_SYMBOL[ls]}，請出一張${ln}。`;
  if (draw) return `你沒有${ln}，可以出其他花色（搶牌階段沒有王牌，這墩贏不了）。`;
  if (trump === Strain.NoTrump) return `你沒有${ln}，可以出其他花色；本局無王，其他花色不能靠點數大贏過${ln}。`;
  if (hand.some(c => suitOf(c) === trump)) return `你沒有${ln}，可以用${SUIT_NAME[trump]}王吃，也可以墊牌保留王牌。`;
  return `你沒有${ln}，也沒有王牌，只能墊一張其他花色（這墩贏不了）。`;
}

// 點到不能出的牌：說出具體原因
export function illegalReason(hand: number[], lead: number | null, card: number): string | null {
  if (legalPlays(hand, lead).includes(card)) return null;
  const ls = suitOf(lead!);
  return `你還有${SUIT_SYMBOL[ls]}，這墩必須先跟${SUIT_NAME[ls]}。`;
}

export const LEAD_ADVICE = "你先出牌：這張牌會決定本墩要跟的花色。";
