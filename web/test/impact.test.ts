// Impact Score／Tier：同一墩只有一個主要事件，強度看真的牌局數學，不看牌面大小
import { describe, expect, it } from "vitest";
import { Strain, Suit, bidIndex, cardId } from "../src/game/cards";
import { Phase, type TableState } from "../src/game/game";
import { evaluateTrick, playWeight, contractRisk, ImpactGate, trickKey, legacyLevel } from "../src/client/impact";

const ME = 0, OPP = 1;
function st(p: Partial<TableState>): TableState {
  return {
    seat: ME, phase: Phase.Play, hand: [], legal: [], oppCount: 0, faceUp: -1, stockCount: 0,
    leadCard: -1, followCard: -1, leaderSeat: ME, currentSeat: ME, myTricks: 0, oppTricks: 0, oppTakenFaceUp: [], myTakenFaceUp: [],
    highestBid: bidIndex(2, Strain.Hearts), highestBidder: ME, declarer: ME, minBid: 0,
    doubled: 0, canDouble: false, canRedouble: false, auctionSeats: [], auctionCalls: [],
    myScore: 0, oppScore: 0, targetScore: 100, handNumber: 1, hasResult: false, result: null, matchWinner: -1,
    ...p,
  } as TableState;
}
const won = (seat: number, ruff = false) => ({ type: "TrickWon" as const, seat, extra: ruff ? 1 : 0 });

describe("Impact Tier：每一級的觸發條件", () => {
  it("搶牌：搶到 J 以上的明牌是 Tier 1，普通明牌是 Tier 0（不爆炸）", () => {
    expect(evaluateTrick(won(ME), st({ phase: Phase.Draw, faceUp: cardId(Suit.Diamonds, 13), stockCount: 20 })).tier).toBe(1);
    expect(evaluateTrick(won(ME), st({ phase: Phase.Draw, faceUp: cardId(Suit.Clubs, 5), stockCount: 20 })).tier).toBe(0);
  });
  it("一般贏墩是 Tier 1；大牌本身不會讓結果變重", () => {
    const i = evaluateTrick(won(ME), st({ myTricks: 2, oppTricks: 1 }));
    expect([i.tier, i.kind, i.crack]).toEqual([1, "trick", "none"]);
  });
  it("王吃是 Tier 2（有細微壓裂、短定格）", () => {
    const i = evaluateTrick(won(ME, true), st({ myTricks: 2, oppTricks: 2 }));
    expect([i.tier, i.kind, i.crack]).toEqual([2, "ruff", "hairline"]);
    expect(i.hitstop).toBeGreaterThan(0);
  });
  it("剛好拿到目標墩數那一墩：Tier 3 打成", () => {
    // 2♥ 要 8 墩，已經 7 墩
    const i = evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 3 }));
    expect([i.tier, i.kind, i.good, i.label]).toEqual([3, "made", true, "打成！"]);
    expect(i.hitstop).toBeGreaterThanOrEqual(60);
    expect(i.hitstop).toBeLessThanOrEqual(100);
  });
  it("合約不可能打成的那一刻就判倒約，不用等到最後一墩（規格的例子：要 9 墩、5 墩、剩 3 墩）", () => {
    // 3♥ 要 9 墩。你是莊家 5 墩、阿元 4 墩，這墩阿元贏 → 阿元 5 墩、剩 3 墩，你最多 8 墩
    const s = st({ highestBid: bidIndex(3, Strain.Hearts), myTricks: 5, oppTricks: 4 });
    const i = evaluateTrick(won(OPP), s);
    expect([i.tier, i.kind, i.good, i.winnerMe]).toEqual([3, "set", false, false]);
    // 之後再贏墩，就不是關鍵了
    expect(evaluateTrick(won(ME), st({ highestBid: bidIndex(3, Strain.Hearts), myTricks: 5, oppTricks: 5 })).tier).toBe(1);
  });
  it("加倍、再加倍的合約打成，或大滿貫等級：Tier 4（金色裂紋）", () => {
    const dbl = evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 3, doubled: 1 }));
    expect([dbl.tier, dbl.kind, dbl.crack]).toEqual([4, "made", "gold"]);
    const grand = evaluateTrick(won(ME), st({ highestBid: bidIndex(7, Strain.Spades), myTricks: 12, oppTricks: 0 }));
    expect(grand.tier).toBe(4);
    // 一般 2♥ 打成只到 Tier 3
    expect(evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 3 })).tier).toBe(3);
  });
  it("對方把加倍合約打倒：Tier 3，沉重不是歡慶（不是金色）", () => {
    // 4♥ 要 10 墩、倒約點是防守方 4 墩：阿元 3 墩時再贏一墩
    const i = evaluateTrick(won(OPP), st({ highestBid: bidIndex(4, Strain.Hearts), myTricks: 5, oppTricks: 3, doubled: 1 }));
    expect([i.tier, i.kind, i.good, i.crack]).toEqual([3, "set", false, "ink"]);
  });
  it("這一墩確定拿下整場：Tier 4；本來落後就是逆轉", () => {
    const i = evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 2, myScore: 85, oppScore: 90 }));
    expect([i.tier, i.kind, i.comeback, i.label]).toEqual([4, "match", true, "逆轉！"]);
    // 打成也不夠 100 分：不是整場勝負
    expect(evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 2, myScore: 70 })).kind).toBe("made");
    // 對方倒約讓你拿到 100 分：防守方也能決勝
    const def = evaluateTrick(won(ME), st({ declarer: OPP, highestBidder: OPP, myTricks: 5, oppTricks: 4, myScore: 95 }));
    expect([def.tier, def.kind, def.good]).toEqual([4, "match", true]);
  });
  it("背水一墩：需要剩下每一墩、拿下來了（Tier 2）", () => {
    // 2♥ 要 8 墩：你 4 墩、阿元 5 墩、剩 4 墩 → 每墩都要
    const i = evaluateTrick(won(ME), st({ myTricks: 4, oppTricks: 5 }));
    expect([i.tier, i.kind, i.label]).toEqual([2, "pivot", "關鍵一墩"]);
  });
  it("加倍局「再一墩就定案」是 Tier 2；沒加倍只是 Tier 1", () => {
    expect(evaluateTrick(won(ME), st({ myTricks: 6, oppTricks: 2, doubled: 1 })).tier).toBe(2);
    expect(evaluateTrick(won(ME), st({ myTricks: 6, oppTricks: 2 })).tier).toBe(1);
  });
});

describe("不盲目累加、決定性事件優先", () => {
  it("王吃又剛好打成：只算一個主要事件（打成），王吃只是加成", () => {
    const plain = evaluateTrick(won(ME), st({ myTricks: 7, oppTricks: 3 }));
    const ruff = evaluateTrick(won(ME, true), st({ myTricks: 7, oppTricks: 3 }));
    expect(ruff.kind).toBe("made");
    expect(ruff.tier).toBe(plain.tier);
    expect(ruff.score).toBe(plain.score + 1);
  });
  it("整場勝負 > 合約定案 > 背水 > 王吃 > 一般", () => {
    const order = ["match", "made", "pivot", "ruff", "trick"];
    const got = [
      evaluateTrick(won(ME, true), st({ myTricks: 7, oppTricks: 2, myScore: 95 })).kind,
      evaluateTrick(won(ME, true), st({ myTricks: 7, oppTricks: 3 })).kind,
      evaluateTrick(won(ME, true), st({ myTricks: 4, oppTricks: 5 })).kind,
      evaluateTrick(won(ME, true), st({ myTricks: 2, oppTricks: 2 })).kind,
      evaluateTrick(won(ME), st({ myTricks: 2, oppTricks: 2 })).kind,
    ];
    expect(got).toEqual(order);
  });
  it("一整手 13 墩：大部分是 Tier 1，Tier 3 以上最多一次", () => {
    // 2♥：你贏 8 墩、阿元 5 墩，交錯出現
    const seq = [ME, OPP, ME, ME, OPP, ME, OPP, ME, ME, OPP, ME, OPP, ME];
    let my = 0, opp = 0;
    const tiers = seq.map(w => { const t = evaluateTrick(won(w), st({ myTricks: my, oppTricks: opp })).tier; if (w === ME) my++; else opp++; return t; });
    expect(tiers.filter(t => t >= 3).length).toBe(1);
    expect(tiers.filter(t => t <= 1).length).toBeGreaterThanOrEqual(10);
  });
});

describe("出牌重量（Layer A）與防重播", () => {
  it("每張牌都有重量；A、王吃、高風險合約稍微重一點，但有上限", () => {
    const low = playWeight(cardId(Suit.Clubs, 3), false, null);
    expect(low).toBe(1);
    expect(playWeight(cardId(Suit.Clubs, 14), false, null)).toBeGreaterThan(low);
    expect(playWeight(cardId(Suit.Hearts, 2), true, null)).toBeGreaterThan(low);
    const s = { phase: Phase.Play, highestBid: bidIndex(6, Strain.Spades), doubled: 2 };
    expect(playWeight(cardId(Suit.Clubs, 3), false, s)).toBeGreaterThan(playWeight(cardId(Suit.Clubs, 3), false, { ...s, doubled: 0 }));
    expect(playWeight(cardId(Suit.Spades, 14), true, s)).toBeLessThanOrEqual(1.5);
    expect(contractRisk(-1, 0)).toBe(0);
  });
  it("同一墩只演一次", () => {
    const g = new ImpactGate();
    const s = st({ myTricks: 3, oppTricks: 2 });
    expect(g.once(trickKey(s))).toBe(true);
    expect(g.once(trickKey(s))).toBe(false);
    expect(g.once(trickKey(st({ myTricks: 4, oppTricks: 2 })))).toBe(true);
  });
  it("對應舊的三級回饋", () => {
    expect([0, 1, 2, 3, 4].map(t => legacyLevel(t as 0))).toEqual([1, 1, 2, 3, 3]);
  });
});
