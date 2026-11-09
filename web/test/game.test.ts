// 網頁版規則測試：跟 Unity 版的 RulesTests / ScoringTests / AuctionTests / 5000 局模擬對應
import { describe, expect, it } from "vitest";
import { Call, bidIndex, cardId, newShuffledDeck, seededRng, sortHand, Strain, Suit, suitOf, rankOf } from "../src/game/cards";
import { beats, hcp, legalPlays } from "../src/game/rules";
import { breakdown, declarerPreview, score } from "../src/game/scoring";
import { GameEvent, HoneymoonGame, Phase, other } from "../src/game/game";
import { chooseCall, chooseCard } from "../src/game/ai";

const C = (s: number, r: number) => cardId(s, r);
const B = (lv: number, s: number) => bidIndex(lv, s);

function finishDraw(g: HoneymoonGame) {
  while (g.phase === Phase.Draw) {
    if (g.trickComplete) g.resolveTrick();
    else g.playCard(g.currentPlayer, chooseCard(g, g.currentPlayer));
  }
}

describe("搶走的明牌紀錄（牌局紀錄面板用）", () => {
  it("兩邊看到的都只是翻開過的明牌：自己的、對手的各一份，不含暗牌", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new HoneymoonGame(seededRng(seed));
      g.startNew();
      const shown: number[] = [];
      const took: [number[], number[]] = [[], []];
      while (g.phase === Phase.Draw) {
        if (g.trickComplete) {
          const up = g.faceUp; shown.push(up);
          g.resolveTrick();
          const w = g.viewFor(0).myTakenFaceUp.includes(up) ? 0 : 1;
          took[w].push(up);
        } else g.playCard(g.currentPlayer, chooseCard(g, g.currentPlayer));
        for (const s of [0, 1]) {
          const v = g.viewFor(s);
          expect(v.myTakenFaceUp).toEqual(took[s]);
          expect(v.oppTakenFaceUp).toEqual(took[1 - s]);
          for (const c of [...v.myTakenFaceUp, ...v.oppTakenFaceUp]) expect(shown).toContain(c);
        }
      }
      expect(took[0].length + took[1].length).toBe(13);
    }
  });
});

describe("牌與規則", () => {
  it("52 張牌編號來回一致、洗牌不重複", () => {
    const d = newShuffledDeck(seededRng(1));
    expect(new Set(d).size).toBe(52);
    expect(C(Suit.Spades, 14)).toBe(51);
  });
  it("大牌點 A4 K3 Q2 J1", () => {
    expect(hcp([C(0, 14), C(2, 13), C(2, 12), C(1, 11)])).toBe(10);
  });
  it("手牌排序 ♠♥♦♣ 由大到小", () => {
    const h = sortHand([C(0, 2), C(3, 3), C(2, 14), C(3, 14), C(1, 9)]);
    expect(h).toEqual([C(3, 14), C(3, 3), C(2, 14), C(1, 9), C(0, 2)]);
  });
  it("有首引花色必須跟，缺門可以出任何牌", () => {
    expect(legalPlays([C(3, 2), C(2, 5), C(2, 9)], C(2, 14))).toEqual([C(2, 5), C(2, 9)]);
    expect(legalPlays([C(3, 2), C(0, 5)], C(2, 14)).length).toBe(2);
  });
  it("同門比大小、墊牌不會贏、小王壓大牌、無王沒有王", () => {
    expect(beats(C(2, 13), C(2, 12), Strain.NoTrump)).toBe(true);
    expect(beats(C(3, 14), C(2, 2), Strain.NoTrump)).toBe(false);
    expect(beats(C(0, 2), C(2, 14), Strain.Clubs)).toBe(true);
    expect(beats(C(2, 14), C(0, 2), Strain.Clubs)).toBe(false);
  });
});

describe("計分（規格範例原封不動）", () => {
  const H3 = B(3, Strain.Hearts);
  it("3♥ 加倍拿 10 墩：莊家 62 分", () => {
    const r = score(H3, 1, 0, 10);
    expect([r.scorer, r.contractPoints, r.overtrickPoints, r.points]).toEqual([0, 60, 2, 62]);
  });
  it("3♥ 加倍只拿 8 墩：防守方 20 分", () => {
    const r = score(H3, 1, 0, 8);
    expect([r.scorer, r.undertricks, r.points]).toEqual([1, 1, 20]);
  });
  it("試算文字", () => {
    expect(declarerPreview(H3, 1)).toBe("要贏 9 墩｜打成拿 60 分｜每倒 1 墩，對手拿 20 分");
  });
  it.each([
    [1, Strain.Clubs, 0, 7, 0, 10], [1, Strain.NoTrump, 0, 13, 0, 22], [2, Strain.Hearts, 2, 9, 0, 82],
    [4, Strain.Spades, 0, 7, 1, 30], [2, Strain.Hearts, 2, 6, 1, 80], [7, Strain.Clubs, 1, 0, 1, 260],
  ])("%i 線 王%i 加倍%i 拿%i → 座位%i 得%i", (lv, s, d, taken, scorer, pts) => {
    const r = score(B(lv, s), d, 0, taken);
    expect(r.scorer).toBe(scorer);
    expect(r.points).toBe(pts);
  });
  it("結算明細", () => {
    expect(breakdown(score(H3, 1, 0, 10), 0, "朋友")).toEqual([
      "合約 3♥ 加倍（你是莊家）", "要贏 9 墩，贏了 10 墩 → 打成，多 1 墩",
      "合約分：3 線 × 10 × 2 = 60", "超墩分：1 墩 × 2 = 2", "你 +62 分",
    ]);
  });
});

describe("叫牌", () => {
  function atBidding(seed = 11) {
    const g = new HoneymoonGame(seededRng(seed));
    g.startNewMatch();
    finishDraw(g);
    return { g, p: g.currentPlayer, o: other(g.currentPlayer) };
  }
  it("加倍只有防守方能叫，加倍後輪到莊家", () => {
    const { g, p, o } = atBidding();
    expect(g.makeCall(p, Call.Double)).toBe(false);
    g.makeCall(p, B(3, Strain.Hearts));
    expect(g.canDouble(p)).toBe(false);
    expect(g.makeCall(o, Call.Double)).toBe(true);
    expect(g.currentPlayer).toBe(p);
    g.makeCall(p, Call.Pass);
    expect(g.phase).toBe(Phase.Play);
    expect(g.doubled).toBe(1);
    expect(g.leader).toBe(o);
  });
  it("再加倍只有被加倍的莊家能叫", () => {
    const { g, p, o } = atBidding();
    g.makeCall(p, B(2, Strain.Spades));
    expect(g.makeCall(o, Call.Redouble)).toBe(false);
    g.makeCall(o, Call.Double);
    expect(g.makeCall(p, Call.Redouble)).toBe(true);
    expect(g.makeCall(o, Call.Double)).toBe(false);
    g.makeCall(o, Call.Pass);
    expect(g.doubled).toBe(2);
  });
  it("蓋叫清除加倍", () => {
    const { g, p, o } = atBidding();
    g.makeCall(p, B(2, Strain.Hearts));
    g.makeCall(o, Call.Double);
    g.makeCall(p, B(3, Strain.Clubs));
    expect(g.doubled).toBe(0);
    expect(g.canDouble(o)).toBe(true);
  });
  it("雙方起手都 Pass 重發，分數不變、叫牌紀錄清空", () => {
    const { g, p, o } = atBidding();
    g.makeCall(p, Call.Pass);
    g.makeCall(o, Call.Pass);
    expect(g.phase).toBe(Phase.Draw);
    expect(g.auction.length).toBe(0);
    expect(g.scores).toEqual([0, 0]);
  });
  it("叫牌紀錄雙方都看得到", () => {
    const { g, p, o } = atBidding();
    g.makeCall(p, Call.Pass); g.makeCall(o, B(1, Strain.Spades)); g.makeCall(p, Call.Double);
    for (const s of [0, 1]) expect(g.viewFor(s).auctionCalls).toEqual([Call.Pass, B(1, Strain.Spades), Call.Double]);
  });
});

describe("存檔／讀檔", () => {
  it("任何時間點存檔再讀回來，接著打的結果完全一樣", () => {
    const a = new HoneymoonGame(seededRng(5));
    a.startNewMatch();
    for (let i = 0; i < 37; i++) step(a);   // 停在抽牌階段中間
    const b = HoneymoonGame.restore(a.snapshot(), seededRng(999));
    for (let i = 0; i < 200 && a.phase !== Phase.Finished; i++) { step(a); step(b); }
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});

function step(g: HoneymoonGame) {
  if (g.phase === Phase.Finished) return;
  if (g.trickComplete) g.resolveTrick();
  else if (g.phase === Phase.Bidding) g.makeCall(g.currentPlayer, chooseCall(g, g.currentPlayer));
  else g.playCard(g.currentPlayer, chooseCard(g, g.currentPlayer));
}

// ================= 大量對打：每一步檢查不變量，獨立裁判自己算 =================

function playMatch(seed: number, random: boolean) {
  const rng = seededRng(seed);
  const pick = seededRng(seed ^ 0x5eed);
  const g = new HoneymoonGame(rng);
  const inbox: GameEvent[][] = [[], []];
  const played = new Set<number>();
  g.on((e, to) => {
    if (to < 0 || to === 0) inbox[0].push(e);
    if (to < 0 || to === 1) inbox[1].push(e);
    if (e.type === "CardPlayed") played.add(e.card);
    if (e.type === "NewHand") played.clear();
  });
  const fail = (m: string) => { throw new Error(`[seed=${seed} ${random ? "隨機" : "AI"}] ${m}`); };
  g.startNewMatch();
  let hands = 0;

  for (let steps = 0; steps < 200000 && !g.matchOver; steps++) {
    // 52 張守恆、畫面不外洩
    const all = [...g.hands[0], ...g.hands[1], ...g.stock, ...played];
    if (all.length !== 52 || new Set(all).size !== 52) fail(`牌數不守恆 ${all.length}`);
    for (const s of [0, 1]) {
      const v = g.viewFor(s);
      if (v.hand.some(c => g.hands[other(s)].includes(c))) fail("畫面洩漏對手手牌");
      for (const e of inbox[s]) if (e.type === "CardDrawn" && e.seat !== s && e.card >= 0) fail("收到對手的暗牌");
      inbox[s] = [];
    }

    if (g.phase === Phase.Finished) {
      // 獨立計分裁判
      const lv = Math.floor(g.highestBid / 5) + 1, need = lv + 6, got = g.tricksWon[g.declarer];
      const mult = g.doubled === 2 ? 4 : g.doubled === 1 ? 2 : 1;
      const exp = got >= need ? lv * 10 * mult + (got - need) * 2 : (need - got) * 10 * mult;
      if (g.lastResult!.points !== exp) fail(`計分錯：應得 ${exp}，實際 ${g.lastResult!.points}`);
      if (g.tricksWon[0] + g.tricksWon[1] !== 13) fail("墩數加總不是 13");
      hands++;
      g.startNew();
      continue;
    }
    if (g.trickComplete) { g.resolveTrick(); continue; }
    const p = g.currentPlayer;
    if (g.phase === Phase.Bidding) {
      if (g.makeCall(other(p), Call.Pass)) fail("搶回合叫牌");
      let call: number;
      if (!random) call = chooseCall(g, p);
      else {
        const r = pick();
        call = g.canRedouble(p) && r < 0.35 ? Call.Redouble
          : g.canDouble(p) && r < 0.35 ? Call.Double
          : r < 0.65 || g.highestBid >= 34 ? Call.Pass
          : Math.min(34, g.minBidIndex + Math.floor(pick() * 5));
      }
      if (!g.makeCall(p, call)) fail(`合法叫法被拒：${call}`);
      continue;
    }
    const legal = g.legalFor(p);
    const bad = g.hands[p].find(c => !legal.includes(c));
    if (bad !== undefined && g.playCard(p, bad)) fail("沒跟花色被接受");
    const card = random ? legal[Math.floor(pick() * legal.length)] : chooseCard(g, p);
    if (p !== g.leader && g.hands[p].some(c => suitOf(c) === suitOf(g.leadCard)) && suitOf(card) !== suitOf(g.leadCard))
      fail("裁判：沒跟花色");
    if (!g.playCard(p, card)) fail("合法的牌被拒");
  }
  if (!g.matchOver) fail("打不完");
  const w = g.matchWinner;
  if (g.scores[w] < g.targetScore || g.scores[other(w)] >= g.targetScore) fail("整場勝負判斷錯");
  return hands;
}

describe("大量對打", () => {
  it("AI 對打 300 整場：守恆、不外洩、計分、勝負全部正確", () => {
    let hands = 0;
    for (let i = 0; i < 300; i++) hands += playMatch(20261105 + i, false);
    expect(hands).toBeGreaterThan(300);
  });
  it("隨機亂叫亂打 300 整場（大量加倍、再加倍、高叫）", () => {
    for (let i = 0; i < 300; i++) playMatch(20261105 + i, true);
  });
});
