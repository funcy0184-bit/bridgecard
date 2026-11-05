// 橋牌三條核心規則：跟花色、同門比大小、王牌壓一切（Unity 版 BridgeRules.cs）
import { Strain, hcpOf, suitOf, rankOf } from "./cards";

// led = 這墩領出的牌；null 代表自己是領牌的人，什麼都能出
export function legalPlays(hand: number[], led: number | null): number[] {
  if (led === null) return hand.slice();
  const follow = hand.filter(c => suitOf(c) === suitOf(led));
  return follow.length > 0 ? follow : hand.slice();
}

export const isTrump = (c: number, trump: number) => trump !== Strain.NoTrump && suitOf(c) === trump;

// challenger 能不能壓過目前最大的 current
export function beats(challenger: number, current: number, trump: number): boolean {
  const a = isTrump(challenger, trump), b = isTrump(current, trump);
  if (a !== b) return a;
  return suitOf(challenger) === suitOf(current) && rankOf(challenger) > rankOf(current);
}

export const hcp = (hand: number[]) => hand.reduce((s, c) => s + hcpOf(c), 0);
