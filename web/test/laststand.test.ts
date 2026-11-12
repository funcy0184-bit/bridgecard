// 《逆命賭局》規則引擎測試：發牌、方向、權利輪替、底注／上限、下注流程、棄牌退款、疊池帳本、
// 保命（禁止條件、順序）、翻轉、讀心、梭哈同點、最終墩同點、耗盡退款、淘汰、守恆、隱私、快照
import { describe, expect, it } from "vitest";
import { Action, LSEvent, LastStandGame, actorsNow, randomAction } from "../src/laststand/engine";
import { Dir, GDD_STAGES, HIGH, LOW, MID, TOTAL_CHIPS, catOf, declarerOf, deal, firstBettorOf, seededRng, stageOf } from "../src/laststand/rules";

const C = (rank: number, suit = 0) => suit * 13 + (rank - 2);
// 兩手固定的牌（各 3 大 3 中 3 小）
const HA = [C(14, 0), C(13, 0), C(12, 0), C(10, 0), C(9, 0), C(8, 0), C(6, 0), C(5, 0), C(4, 0)];
const HB = [C(14, 1), C(12, 1), C(11, 1), C(10, 1), C(8, 1), C(7, 1), C(6, 1), C(3, 1), C(2, 1)];
const ALL_HIGH: Dir[] = Array(9).fill("high");

function rig(o: { dirs?: Dir[]; coin?: 0 | 1; stacks?: [number, number]; hands?: [number[], number[]] } = {}) {
  const log: { e: LSEvent; to: number }[] = [];
  const g = LastStandGame.setup({ hands: o.hands ?? [HA, HB], directions: o.dirs ?? ALL_HIGH, coin: o.coin ?? 0, stacks: o.stacks }, (e, to) => log.push({ e, to }));
  return { g, log };
}
// 直接跳到第 t 墩開頭（籌碼、疊池照指定的；總數必須是 30）
function atTrick(g: LastStandGame, t: number, stacks: [number, number], pool: [number, number] = [0, 0]) {
  const s = g.s;
  s.stacks = [stacks[0], stacks[1]]; s.pool = [pool[0], pool[1]]; s.commit = [0, 0]; s.locks = [-1, -1];
  expect(g.total()).toBe(TOTAL_CHIPS);
  s.trick = t - 1;
  (g as unknown as { beginTrick(): void }).beginTrick();
}
const ok = (g: LastStandGame, seat: number, a: Action) => { const r = g.act(seat, a); if (!r.ok) throw new Error(`${seat} ${JSON.stringify(a)} → ${r.msg}`); };
const no = (g: LastStandGame, seat: number, a: Action) => expect(g.act(seat, a).ok).toBe(false);
// 翻轉、保命都略過
function skipPre(g: LastStandGame) {
  while (g.s.phase === "flip" || g.s.phase === "safeguard") ok(g, g.s.toAct, g.s.phase === "flip" ? { t: "flip", flip: false } : { t: "safeguard", use: false });
}
function lockBoth(g: LastStandGame, a: number, b: number) { skipPre(g); ok(g, 0, { t: "lock", card: a }); ok(g, 1, { t: "lock", card: b }); }

describe("發牌、方向、權利輪替", () => {
  it("每人 3 大 3 中 3 小、18 張都不一樣；方向 5 比大 4 比小", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { hands, directions } = deal(seededRng(seed));
      for (const h of hands) expect([LOW, MID, HIGH].map(c => h.filter(x => catOf(x) === c).length)).toEqual([3, 3, 3]);
      expect(new Set([...hands[0], ...hands[1]]).size).toBe(18);
      expect(directions.filter(d => d === "high").length).toBe(5);
      expect(directions).toHaveLength(9);
    }
  });
  it("宣戰權和下注先手每墩分給不同人，各自逐墩交替", () => {
    for (const coin of [0, 1]) for (let t = 1; t <= 9; t++) {
      expect(declarerOf(coin, t)).not.toBe(firstBettorOf(coin, t));
      if (t > 1) expect(declarerOf(coin, t)).not.toBe(declarerOf(coin, t - 1));
    }
  });
  it("底注／上限分三段（正式採方案 B：中段上限 4；企劃書原值 6 保留給比較用）", () => {
    expect([1, 3, 4, 6, 7, 9].map(t => stageOf(t))).toEqual([{ ante: 1, cap: 3 }, { ante: 1, cap: 3 }, { ante: 2, cap: 4 }, { ante: 2, cap: 4 }, { ante: 3, cap: Infinity }, { ante: 3, cap: Infinity }]);
    expect(stageOf(5, GDD_STAGES)).toEqual({ ante: 2, cap: 6 });
  });
});

describe("底注與上限（用該墩開始時的籌碼算）", () => {
  it("第 7 墩 12：18 → 底注 3、上限 12；扣了底注之後上限還是 12（不會被降成 9）", () => {
    const { g } = rig();
    atTrick(g, 7, [12, 18]);
    expect([g.s.ante, g.s.cap]).toEqual([3, 12]);
    lockBoth(g, HA[0], HB[0]);
    expect(g.s.stacks).toEqual([9, 15]);
    const fb = g.firstBettor();
    expect(g.legal(fb).raise).toEqual([4, 12]);
    no(g, fb, { t: "raise", to: 13 });
    ok(g, fb, { t: "raise", to: 12 });
    expect(g.s.steps.at(-1)).toMatchObject({ act: "raise", to: 12, allIn: true });
  });
  it("籌碼比底注少：有效底注＝雙方最小值；上限等於底注時不下注、直接翻牌", () => {
    const { g, log } = rig();
    atTrick(g, 7, [2, 28]);
    expect([g.s.ante, g.s.cap]).toEqual([2, 2]);
    lockBoth(g, HA[8], HB[0]);                       // 比大：A 的 4 輸 B 的 A
    expect(log.some(x => x.e.type === "NoBet" && x.e.reason === "cap")).toBe(true);
    expect(g.s.result).toMatchObject({ winner: 1, reason: "elimination", trick: 7 });
    expect(g.s.stacks).toEqual([0, 30]);
  });
  it("第 4 墩 4：26 → 底注 2、上限 4，可以加到 3 或 4", () => {
    const { g } = rig();
    atTrick(g, 4, [4, 26]);
    lockBoth(g, HA[0], HB[1]);
    expect(g.legal(g.firstBettor()).raise).toEqual([3, 4]);
  });
});

describe("下注流程（每墩最多首次加注 1 次＋反加 1 次）", () => {
  it("雙方過牌 → 用底注翻牌", () => {
    const { g } = rig();
    lockBoth(g, HA[0], HB[1]);                       // A♠ 對 Q♥，比大：A 贏
    const fb = g.firstBettor();
    ok(g, fb, { t: "check" }); ok(g, 1 - fb, { t: "check" });
    expect(g.s.history[0]).toMatchObject({ outcome: "showdown", winner: 0, transfer: 1 });
    expect(g.s.stacks).toEqual([16, 14]);
  });
  it("先手加注 → 對手可以接戰／棄牌／反加（也可以讀心）；被反加的人只能接戰／棄牌", () => {
    const { g } = rig();
    lockBoth(g, HA[0], HB[1]);
    const a = g.firstBettor(), b = 1 - a;
    no(g, b, { t: "check" });                        // 不是他的回合
    ok(g, a, { t: "raise", to: 2 });
    expect(g.legal(b)).toMatchObject({ call: true, fold: true, insight: true, check: false, raise: [3, 3] });
    no(g, b, { t: "check" });
    ok(g, b, { t: "raise", to: 3 });
    expect(g.legal(a)).toMatchObject({ call: true, fold: true, check: false, raise: null });
    no(g, a, { t: "raise", to: 3 });
    ok(g, a, { t: "call" });
    expect(g.s.history[0].steps.map(s => s.act)).toEqual(["raise", "raise", "call"]);
    expect(g.s.history[0].commit).toEqual([3, 3]);
  });
  it("先手過牌 → 對手可以加注（算首次加注）→ 先手可以反加 → 對手只能接戰／棄牌（最多 4 步）", () => {
    const { g } = rig();
    atTrick(g, 4, [15, 15]);
    lockBoth(g, HA[0], HB[1]);
    const a = g.firstBettor(), b = 1 - a;
    ok(g, a, { t: "check" });
    expect(g.legal(b)).toMatchObject({ check: true, raise: [3, 4] });
    ok(g, b, { t: "raise", to: 3 });
    expect(g.legal(a)).toMatchObject({ call: true, fold: true, raise: [4, 4] });
    ok(g, a, { t: "raise", to: 4 });
    expect(g.legal(b)).toMatchObject({ call: true, fold: true, raise: null, check: false });
    ok(g, b, { t: "fold" });
    expect(g.s.history[0].steps).toHaveLength(4);
  });
  it("不合法：不是你的回合、加注超出範圍、面對加注不能過牌、沒人加注不能棄牌／接戰、讀心時機不對", () => {
    const { g } = rig();
    skipPre(g);
    no(g, 0, { t: "check" });                        // 還在鎖牌
    no(g, 0, { t: "lock", card: HB[0] });            // 不是自己的牌
    ok(g, 0, { t: "lock", card: HA[0] });
    no(g, 0, { t: "lock", card: HA[1] });            // 鎖了不能改
    ok(g, 1, { t: "lock", card: HB[0] });
    const a = g.firstBettor(), b = 1 - a;
    no(g, a, { t: "fold" }); no(g, a, { t: "call" }); no(g, a, { t: "insight" });
    no(g, a, { t: "raise", to: 1 }); no(g, a, { t: "raise", to: 4 }); no(g, a, { t: "raise", to: 2.5 });
    ok(g, a, { t: "raise", to: 2 });
    no(g, b, { t: "check" });
    expect(g.total()).toBe(TOTAL_CHIPS);
  });
});

describe("棄牌：只輸被跟到的部分，沒被跟到的退回；雙方鎖牌消耗、只公開分類", () => {
  it("第 4 墩：先手加到 4、對手棄牌 → 對手輸 2（底注），加注方多押的 2 退回；企劃書數值（上限 6）加到 5 則退 3", () => {
    const { g } = rig();
    atTrick(g, 4, [15, 15]);
    lockBoth(g, HA[8], HB[0]);
    const a = g.firstBettor(), b = 1 - a;
    no(g, a, { t: "raise", to: 5 });                                  // 方案 B 中段上限 4
    ok(g, a, { t: "raise", to: 4 });
    ok(g, b, { t: "fold" });
    const r = g.s.history[0];
    expect(r).toMatchObject({ outcome: "fold", folder: b, winner: a, transfer: 2, excessReturned: 2, cards: null });
    expect(g.s.stacks[a]).toBe(17); expect(g.s.stacks[b]).toBe(13);
    const g2 = LastStandGame.setup({ hands: [HA, HB], directions: ALL_HIGH, coin: 0, stages: GDD_STAGES });
    atTrick(g2, 4, [15, 15]);
    lockBoth(g2, HA[8], HB[0]);
    const a2 = g2.firstBettor();
    ok(g2, a2, { t: "raise", to: 5 }); ok(g2, 1 - a2, { t: "fold" });
    expect(g2.s.history[0]).toMatchObject({ transfer: 2, excessReturned: 3 });
  });
  it("反加後棄牌：加 3、對手反加 4、原加注方棄牌 → 他輸 3，反加方多押的 1 退回", () => {
    const { g } = rig();
    atTrick(g, 4, [15, 15]);
    lockBoth(g, HA[8], HB[0]);
    const a = g.firstBettor(), b = 1 - a;
    ok(g, a, { t: "raise", to: 3 }); ok(g, b, { t: "raise", to: 4 }); ok(g, a, { t: "fold" });
    expect(g.s.history[0]).toMatchObject({ folder: a, winner: b, transfer: 3, excessReturned: 1 });
    expect(g.s.stacks[a]).toBe(12); expect(g.s.stacks[b]).toBe(18);
  });
  it("棄牌：兩張鎖牌都從手上消耗、公開分類；確切牌面不出現在任何公開事件或畫面資料，只留在伺服器", () => {
    const { g, log } = rig();
    lockBoth(g, HA[3], HB[7]);                       // A 鎖 10（中）、B 鎖 3（小）
    const a = g.firstBettor(), b = 1 - a;
    ok(g, a, { t: "raise", to: 3 }); ok(g, b, { t: "fold" });
    expect(g.s.hands[0]).not.toContain(HA[3]); expect(g.s.hands[1]).not.toContain(HB[7]);
    const reveal = log.find(x => x.e.type === "FoldReveal")!;
    expect(reveal.to).toBe(-1);
    expect(reveal.e.cats).toEqual([MID, LOW]);
    for (const x of log) if (x.to < 0 && x.e.trick === 1 && x.e.type !== "TrickStart") expect(x.e.cards ?? []).toEqual([]);
    for (const seat of [0, 1]) {
      const v = g.viewFor(seat);
      expect(v.history[0].cards).toBeNull();
      expect(v.history[0].cats).toEqual([MID, LOW]);
      expect(JSON.stringify(v)).not.toContain("folded");
    }
    expect(g.s.folded).toEqual([{ trick: 1, folder: b, cards: [HA[3], HB[7]] }]);
    expect(g.viewFor(0).counts[0]).toEqual([3, 2, 3]);     // A 少了一張中
  });
});

describe("疊池：同點按出資累積，下一個翻牌贏或對方棄牌時勝方拿走", () => {
  it("同點進疊池（雙方出資分開記）→ 下一墩翻牌贏的人拿走疊池＋本墩", () => {
    const { g } = rig();
    lockBoth(g, HA[2], HB[1]);                       // Q 對 Q：同點（不看花色）
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    expect(g.s.history[0]).toMatchObject({ outcome: "tie", poolAdded: [1, 1], poolAfter: [1, 1] });
    expect(g.s.pool).toEqual([1, 1]);
    expect(g.total()).toBe(TOTAL_CHIPS);
    lockBoth(g, HA[0], HB[2]);                       // A 對 J：A 贏
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    expect(g.s.history[1]).toMatchObject({ winner: 0, poolTaken: 2, transfer: 1 });
    expect(g.s.stacks).toEqual([17, 13]);
    expect(g.s.pool).toEqual([0, 0]);
  });
  it("連續同點會一直累積", () => {
    const { g } = rig({ hands: [[C(9, 0), C(8, 0), C(7, 0), ...HA.slice(0, 6)], [C(9, 1), C(8, 1), C(7, 1), ...HB.slice(0, 6)]] });
    for (const [a, b] of [[C(9, 0), C(9, 1)], [C(8, 0), C(8, 1)]]) { lockBoth(g, a, b); ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" }); }
    expect(g.s.pool).toEqual([2, 2]);
    expect(g.s.stacks).toEqual([13, 13]);
  });
  it("對方棄牌也拿走疊池", () => {
    const { g } = rig();
    lockBoth(g, HA[2], HB[1]);
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    lockBoth(g, HA[8], HB[8]);
    const a = g.firstBettor(), b = 1 - a;
    ok(g, a, { t: "raise", to: 3 }); ok(g, b, { t: "fold" });
    expect(g.s.history[1]).toMatchObject({ winner: a, poolTaken: 2, transfer: 1 });
    expect(g.s.pool).toEqual([0, 0]);
  });
  it("最後一墩仍同點：疊池按各自出資退回，再判勝負（籌碼相同＝平手）", () => {
    const { g } = rig();
    atTrick(g, 9, [13, 13], [2, 2]);
    lockBoth(g, HA[2], HB[1]);
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    const r = g.s.history.at(-1)!;
    expect(r.refund).toEqual({ amounts: [5, 5], reason: "final_tie" });
    expect(g.s.stacks).toEqual([15, 15]);
    expect(g.s.result).toEqual({ winner: -1, reason: "nine", trick: 9 });
  });
  it("梭哈同點：短碼歸零 → 疊池（含之前累積的）全部按出資退回，雙方都還有籌碼就繼續打", () => {
    const { g } = rig();
    atTrick(g, 7, [10, 16], [2, 2]);
    lockBoth(g, HA[2], HB[1]);
    const a = g.firstBettor(), b = 1 - a;
    ok(g, a, { t: "raise", to: 10 }); ok(g, b, { t: "call" });
    const r = g.s.history.at(-1)!;
    expect(r.outcome).toBe("tie");
    expect(r.allIn).toBe(a);
    expect(r.poolAdded).toEqual([10, 10]);
    expect(r.refund).toEqual({ amounts: [12, 12], reason: "allin_tie" });
    expect(g.s.stacks).toEqual([12, 18]);
    expect(g.s.result).toBeNull();
    expect(g.s.trick).toBe(8);
  });
  it("一般同點讓短碼手上歸零：疊池退回後還有籌碼 → 繼續打，不提前判負", () => {
    const { g } = rig();
    atTrick(g, 2, [1, 29]);
    lockBoth(g, HA[2], HB[1]);
    expect(g.s.history.at(-1)!.refund).toEqual({ amounts: [1, 1], reason: "exhausted" });
    expect(g.s.stacks).toEqual([1, 29]);
    expect(g.s.result).toBeNull();
    expect(g.s.trick).toBe(3);
  });
  it("結算後手上歸零、疊池沒有自己的錢 → 淘汰（在那一墩結束比賽）", () => {
    const { g, log } = rig();
    atTrick(g, 2, [1, 29]);
    lockBoth(g, HA[8], HB[0]);
    expect(g.s.result).toEqual({ winner: 1, reason: "elimination", trick: 2 });
    expect(log.some(x => x.e.type === "Eliminated" && x.e.seat === 0)).toBe(true);
    expect(g.act(1, { t: "check" }).ok).toBe(false);
  });
});

describe("保命", () => {
  it("下注先手先決定、再輪到宣戰權玩家；一方用了另一方不能再用；保命墩只押 1 枚、不下注", () => {
    const { g, log } = rig();
    atTrick(g, 4, [15, 15]);
    ok(g, g.declarer(), { t: "flip", flip: false });
    expect(g.s.phase).toBe("safeguard");
    expect(g.s.toAct).toBe(g.firstBettor());
    no(g, g.declarer(), { t: "safeguard", use: true });
    ok(g, g.firstBettor(), { t: "safeguard", use: true });
    expect(g.s.phase).toBe("lock");
    expect(g.s.safeUsed[g.declarer()]).toBe(false);
    ok(g, 0, { t: "lock", card: HA[8] }); ok(g, 1, { t: "lock", card: HB[0] });
    expect(log.some(x => x.e.type === "NoBet" && x.e.reason === "safeguard")).toBe(true);
    expect(g.s.history.at(-1)).toMatchObject({ stake: 1, transfer: 1, safeguardBy: g.s.history.at(-1)!.firstBettor });
  });
  it("場上有未決疊池：本墩禁止保命（不消耗卡片）", () => {
    const { g, log } = rig();
    atTrick(g, 4, [13, 13], [2, 2]);
    ok(g, g.declarer(), { t: "flip", flip: false });
    expect(g.s.phase).toBe("lock");
    expect(g.s.safeguardBlocked).toBe(true);
    expect(g.s.safeUsed).toEqual([false, false]);
    expect(log.some(x => x.e.type === "SafeguardBlocked")).toBe(true);
  });
  it("每人每場一次：用過的人之後跳過", () => {
    const { g } = rig();
    ok(g, g.declarer(), { t: "flip", flip: false });
    const user = g.s.toAct;
    ok(g, user, { t: "safeguard", use: true });
    ok(g, 0, { t: "lock", card: HA[0] }); ok(g, 1, { t: "lock", card: HB[1] });
    // 第 2 墩：只剩另一個人可以決定
    while (g.s.phase === "flip") ok(g, g.s.toAct, { t: "flip", flip: false });
    expect(g.s.phase).toBe("safeguard");
    expect(g.s.toAct).toBe(1 - user);
    expect(g.s.safeOrder).toEqual([1 - user]);
  });
});

describe("翻轉、讀心", () => {
  it("只有宣戰權玩家能翻、每場一次；翻了公開最終方向；他下次拿到宣戰權時直接跳過", () => {
    const { g, log } = rig();
    const d = g.declarer();
    no(g, 1 - d, { t: "flip", flip: true });
    ok(g, d, { t: "flip", flip: true });
    expect(g.s.dir).toBe("low");
    expect(log.find(x => x.e.type === "Flip")).toMatchObject({ to: -1, e: { seat: d, dir: "low" } });
    lockBoth(g, HA[0], HB[8]);                       // 比小：B 的 2 贏
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    expect(g.s.history[0]).toMatchObject({ dir: "low", baseDir: "high", flippedBy: d, winner: 1 });
    // 第 2 墩宣戰權換人；第 3 墩又輪到 d，但他用過了 → 跳過翻轉
    ok(g, g.declarer(), { t: "flip", flip: false });
    lockBoth(g, HA[1], HB[1]);
    ok(g, g.firstBettor(), { t: "check" }); ok(g, 1 - g.firstBettor(), { t: "check" });
    expect(g.declarer()).toBe(d);
    expect(g.s.phase).not.toBe("flip");
  });
  it("讀心：只有被加注（或反加）的人、回應前能用；只給自己看分類；一場一次", () => {
    const { g, log } = rig();
    lockBoth(g, HA[0], HB[7]);
    const a = g.firstBettor(), b = 1 - a;
    no(g, a, { t: "insight" });
    ok(g, a, { t: "raise", to: 2 });
    ok(g, b, { t: "insight" });
    const lockOfA = g.s.locks[a];
    const res = log.find(x => x.e.type === "InsightResult")!;
    expect(res.to).toBe(b);
    expect(res.e.cat).toBe(catOf(lockOfA));
    expect(log.find(x => x.e.type === "Insight")!.to).toBe(-1);
    expect(log.find(x => x.e.type === "Insight")!.e.cat).toBeUndefined();
    expect(g.viewFor(b).insight).toBe(catOf(lockOfA));
    expect(g.viewFor(a).insight).toBe(-1);
    expect(g.viewFor(a).myInsights).toEqual([]);
    no(g, b, { t: "insight" });
    ok(g, b, { t: "call" });
  });
});

describe("隱私：每個座位只看得到自己該看的", () => {
  it("看不到對手手牌、對手還沒翻的鎖牌、未公開的方向；私人事件只給本人", () => {
    const { g, log } = rig({ dirs: ["high", "low", "high", "low", "high", "low", "high", "high", "low"] });
    skipPre(g);
    ok(g, 0, { t: "lock", card: HA[0] });
    const v1 = g.viewFor(1);
    expect(v1.hand).toEqual(HB);
    expect(v1.myLock).toBe(-1);
    expect(v1.locked).toEqual([true, false]);
    expect(Object.keys(v1)).not.toContain("directions");
    expect(v1.nextDir).toBe("low");
    const json = JSON.stringify(v1);
    for (const c of HA) expect(v1.hand).not.toContain(c);
    expect(json).not.toContain("hands");
    for (const x of log) if (x.e.type === "LockedCard") expect(x.to).toBe(x.e.seat);
  });
});

describe("守恆、不卡死、快照（隨機對打 2000 場）", () => {
  it("每一步：30 枚守恆、籌碼不為負、疊池雙方出資相同；一定打得完", () => {
    let elim = 0, draws = 0;
    const seen: Record<string, number> = { final_tie: 0, allin_tie: 0, exhausted: 0, foldExcess: 0, blocked: 0, safeguard: 0, insight: 0, flip: 0 };
    for (let seed = 1; seed <= 2000; seed++) {
      const rng = seededRng(seed);
      const g = LastStandGame.newMatch(rng);
      let steps = 0;
      while (!g.over) {
        const who = actorsNow(g);
        expect(who.length).toBeGreaterThan(0);                 // 沒有死鎖：總有人可以動
        const seat = who[Math.floor(rng() * who.length)];
        const a = randomAction(g, seat, rng);
        expect(a).not.toBeNull();
        const r = g.act(seat, a!);
        expect(r.ok).toBe(true);
        const s = g.s;
        expect(g.total()).toBe(TOTAL_CHIPS);
        expect(Math.min(...s.stacks, ...s.commit, ...s.pool)).toBeGreaterThanOrEqual(0);
        expect(s.pool[0]).toBe(s.pool[1]);
        expect(Math.max(...s.commit)).toBeLessThanOrEqual(Math.max(s.cap, s.stake));
        expect(++steps).toBeLessThan(200);
      }
      const s = g.s, res = s.result!;
      expect(s.pool).toEqual([0, 0]);
      expect(s.stacks[0] + s.stacks[1]).toBe(TOTAL_CHIPS);
      if (res.reason === "elimination") { elim++; expect(s.stacks[1 - res.winner]).toBe(0); }
      else { expect(res.trick).toBe(9); if (res.winner < 0) { draws++; expect(s.stacks[0]).toBe(s.stacks[1]); } else expect(s.stacks[res.winner]).toBeGreaterThan(s.stacks[1 - res.winner]); }
      expect(s.history.length).toBe(res.trick);
      for (const r of s.history) {
        if (r.refund) seen[r.refund.reason]++;
        if (r.excessReturned > 0) seen.foldExcess++;
        if (r.safeguardBlocked) seen.blocked++;
        if (r.safeguardBy >= 0) seen.safeguard++;
        if (r.insight.some(Boolean)) seen.insight++;
        if (r.flippedBy >= 0) seen.flip++;
        // 每一墩的帳：結算後手上 + 疊池 = 30
        expect(r.stacksAfter[0] + r.stacksAfter[1] + r.poolAfter[0] + r.poolAfter[1]).toBe(TOTAL_CHIPS);
      }
    }
    expect(elim).toBeGreaterThan(0);
    // 特殊情況在隨機對局裡真的有發生（不是只靠上面的指定牌局）
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(0);
  });
  it("對局中途存檔再讀回：接下來的動作結果一模一樣", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = seededRng(seed);
      const g = LastStandGame.newMatch(rng);
      for (let i = 0; i < 12 && !g.over; i++) { const seat = actorsNow(g)[0]; g.act(seat, randomAction(g, seat, rng)!); }
      const h = LastStandGame.restore(g.snapshot());
      const r1 = seededRng(seed * 7), r2 = seededRng(seed * 7);
      while (!g.over) {
        const seat = actorsNow(g)[0];
        const a1 = randomAction(g, seat, r1)!, a2 = randomAction(h, seat, r2)!;
        expect(a2).toEqual(a1);
        g.act(seat, a1); h.act(seat, a2);
      }
      expect(h.snapshot()).toEqual(g.snapshot());
    }
  });
});
