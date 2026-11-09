// 牌桌與教學共用的「說成人話」：每一句都由 rules.ts 判定，不另寫一套
import { describe, expect, it } from "vitest";
import { Strain, Suit, cardId } from "../src/game/cards";
import { followAdvice, illegalReason, trickSentence, whyTrick, LEAD_ADVICE } from "../src/game/explain";
import { beats } from "../src/game/rules";

const C = cardId;
const { Clubs: CL, Diamonds: DI, Hearts: HE, Spades: SP } = Suit;

describe("這墩為什麼是這個人贏", () => {
  it("♠K／♦A：誰先出，領出花色就是誰的", () => {
    const a = trickSentence(C(SP, 13), C(DI, 14), Strain.Hearts, "阿禾", "你");
    expect(a).toEqual({ winnerIsLeader: true, text: "阿禾贏：本墩先出黑桃，你的方塊不是領出花色，也不是王牌，點數再大也沒用。" });
    const b = trickSentence(C(DI, 14), C(SP, 13), Strain.Hearts, "你", "阿禾");
    expect(b).toEqual({ winnerIsLeader: true, text: "你贏：本墩先出方塊，阿禾的黑桃不是領出花色，也不是王牌。" });
  });
  it("王吃、都是王牌、同花色、先出王牌：說法和 beats() 的結果一致", () => {
    expect(whyTrick(C(SP, 14), C(HE, 2), Strain.Hearts, "你").kind).toBe("ruff");
    expect(whyTrick(C(HE, 9), C(HE, 12), Strain.Hearts, "你")).toMatchObject({ kind: "trump-vs-trump", leaderWins: false });
    expect(whyTrick(C(CL, 9), C(CL, 12), Strain.NoTrump, "你")).toMatchObject({ kind: "same-suit", leaderWins: false });
    expect(whyTrick(C(HE, 3), C(SP, 14), Strain.Hearts, "你")).toMatchObject({ kind: "trump-lead", leaderWins: true });
    // 每一種組合都和規則判定一樣
    for (let lead = 0; lead < 52; lead += 5) for (let follow = 1; follow < 52; follow += 7) for (const t of [Strain.Hearts, Strain.NoTrump]) {
      if (lead === follow) continue;
      expect(whyTrick(lead, follow, t, "你").leaderWins).toBe(!beats(follow, lead, t));
    }
  });
  it("無王：說明裡寫本局無王，不提王牌", () => {
    expect(whyTrick(C(CL, 13), C(HE, 14), Strain.NoTrump, "你").why).toContain("本局無王");
  });
});

describe("輪到你時能出什麼", () => {
  it("有領出花色：一定要跟；點到不能出的牌說具體原因", () => {
    expect(followAdvice([C(SP, 3), C(HE, 2)], C(SP, 13), Strain.Hearts, false)).toBe("你還有♠，請出一張黑桃。");
    expect(illegalReason([C(SP, 3), C(HE, 2)], C(SP, 13), C(HE, 2))).toBe("你還有♠，這墩必須先跟黑桃。");
    expect(illegalReason([C(SP, 3), C(HE, 2)], C(SP, 13), C(SP, 3))).toBeNull();
    expect(illegalReason([C(SP, 3)], null, C(SP, 3))).toBeNull();
  });
  it("沒有領出花色：有王合約提王吃或墊牌；沒有王牌就只能墊；無王不提王吃", () => {
    expect(followAdvice([C(HE, 2), C(CL, 3)], C(SP, 13), Strain.Hearts, false)).toBe("你沒有黑桃，可以用紅心王吃，也可以墊牌保留王牌。");
    expect(followAdvice([C(DI, 2), C(CL, 3)], C(SP, 13), Strain.Hearts, false)).toContain("也沒有王牌");
    const nt = followAdvice([C(HE, 2), C(CL, 3)], C(SP, 13), Strain.NoTrump, false);
    expect(nt).toContain("本局無王");
    expect(nt).not.toContain("王吃");
    expect(followAdvice([C(HE, 2)], C(SP, 13), Strain.NoTrump, true)).toContain("搶牌階段沒有王牌");
    expect(LEAD_ADVICE).toBe("你先出牌：這張牌會決定本墩要跟的花色。");
  });
});
