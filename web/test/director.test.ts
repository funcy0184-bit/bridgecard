// P2 事件導演：用固定牌局（真的規則引擎事件）驗證「只有真的發生的事才會演」、順序對、不重複、可重建、不外洩
import { describe, expect, it } from "vitest";
import { Action, LastStandGame, LSView } from "../src/laststand/engine";
import { Dir, cardText } from "../src/laststand/rules";
import { analyze, publicOf } from "../src/laststand/director/analyze";
import { Director, type Cast } from "../src/laststand/director/director";
import type { Beat, Cue } from "../src/laststand/director/types";

// 牌：花色 × 13 +（點數 − 2）；S()＝花色 0（♣）、H()＝花色 1（♦）；比大小不看花色
const S = (rank: number) => rank - 2, H = (rank: number) => 13 + rank - 2;
const HAND0 = [S(14), S(13), S(12), S(10), S(9), S(8), S(6), S(5), S(4)];
const HAND1 = [H(14), H(13), H(11), H(10), H(9), H(7), H(6), H(3), H(2)];
const CAST: Cast = { names: ["大雞", "小美"], stakes: ["阿嬤的藍白拖", ""], vows: ["這局我閉著眼睛都能贏", ""] };

interface TrickPlan { flip?: boolean; safe?: number; lock: [number, number]; bets?: Action[]; insight?: number }
// 照計畫打：翻轉（宣戰權）→ 保命 → 鎖牌 → 下注（照順序給輪到的人；insight＝那個人回應前先讀心）
function play(plans: TrickPlan[], o: { coin?: 0 | 1; dirs?: Dir[]; stacks?: [number, number] } = {}) {
  const g = LastStandGame.setup({ hands: [HAND0, HAND1], directions: o.dirs ?? Array(9).fill("high"), coin: o.coin ?? 0, stacks: o.stacks });
  const views: LSView[] = [g.viewFor(0)];
  const act = (seat: number, a: Action) => { const r = g.act(seat, a); if (!r.ok) throw new Error(`第 ${g.s.trick} 墩 ${seat} ${JSON.stringify(a)}：${r.msg}`); views.push(g.viewFor(0)); };
  for (const p of plans) {
    if (g.over) break;
    if (g.s.phase === "flip") act(g.s.toAct, { t: "flip", flip: !!p.flip });
    while (g.s.phase === "safeguard") act(g.s.toAct, { t: "safeguard", use: p.safe === g.s.toAct });
    if (g.s.phase === "lock") { act(0, { t: "lock", card: p.lock[0] }); act(1, { t: "lock", card: p.lock[1] }); }
    for (const a of p.bets ?? []) {
      if (g.s.phase !== "bet") break;
      const seat = g.s.toAct;
      if (p.insight === seat && g.legal(seat).insight) act(seat, { t: "insight" });
      act(seat, a);
    }
    while (g.s.phase === "bet") act(g.s.toAct, { t: "check" });
  }
  return { g, views };
}
// 一路看下去：每個新畫面都餵給導演，記下每一步新出的演出
function direct(views: LSView[], cast = CAST, gid = "g-test") {
  const d = new Director(gid, cast);
  const steps: { view: LSView; cues: Cue[]; beats: Beat[] }[] = [];
  let seen = new Set<string>();
  for (const v of views) {
    const { cues, analysis } = d.update(publicOf(v));
    const beats = analysis.beats.filter(b => !seen.has(b.id));
    seen = new Set(analysis.beats.map(b => b.id));
    steps.push({ view: v, cues, beats });
  }
  return { d, steps, all: steps.flatMap(s => s.cues), beats: steps.flatMap(s => s.beats) };
}
const texts = (cues: Cue[]) => cues.flatMap(c => [c.title ?? "", ...c.lines.map(l => l.text)]).join("\n");

describe("P2 事件導演：連續加注、記仇、中場調查", () => {
  // coin 0：第 1、3、5 墩先下注的是座位 1，第 2、4 墩是座位 0
  const plans: TrickPlan[] = [
    { lock: [S(14), H(2)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },
    { lock: [S(13), H(3)], bets: [{ t: "raise", to: 2 }, { t: "call" }] },
    { lock: [S(12), H(6)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },
    { lock: [S(10), H(7)], bets: [{ t: "raise", to: 3 }, { t: "call" }] },
    { lock: [S(4), H(14)], bets: [{ t: "raise", to: 3 }, { t: "fold" }] },
  ];
  const { views } = play(plans);
  const { beats, all, steps } = direct(views);
  const of = (type: string) => beats.filter(b => b.type === type);

  it("第一次加注、連續三墩加注、連續四墩（記仇）、加注很多次之後第一次棄牌：只在真的發生那一刻出現一次", () => {
    expect(of("raise_first").map(b => [b.trick, b.seat])).toEqual([[1, 0]]);
    // 小美第 5 墩的第一次加注：3 枚已經是她手上 6 枚的一半 → 算「大額出價」，不是普通的第一次加注
    expect(of("big_offer").map(b => [b.trick, b.seat, b.data.to])).toEqual([[5, 1, 3]]);
    expect(of("raise_streak3").map(b => [b.trick, b.seat])).toEqual([[3, 0]]);
    expect(of("raise_streak_more").map(b => [b.trick, b.seat, b.data.streak])).toEqual([[4, 0, 4]]);
    expect(of("fold_after_raiser").map(b => [b.trick, b.seat])).toEqual([[5, 0]]);
    expect(of("fold").length + of("big_fold").length).toBe(1);
  });
  it("「連續三墩」要三個連續的不同墩：中間有一墩沒加注就重新算", () => {
    const { views: v2 } = play([
      { lock: [S(14), H(2)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },
      { lock: [S(13), H(3)], bets: [{ t: "raise", to: 2 }, { t: "call" }] },
      { lock: [S(12), H(6)], bets: [{ t: "check" }, { t: "check" }] },
      { lock: [S(10), H(7)], bets: [{ t: "raise", to: 3 }, { t: "call" }] },
      { lock: [S(9), H(9)], bets: [{ t: "check" }, { t: "raise", to: 3 }, { t: "call" }] },
    ]);
    const a = analyze(publicOf(v2.at(-1)!));
    expect(a.beats.some(x => x.type === "raise_streak3" || x.type === "raise_streak_more")).toBe(false);
    expect(a.stats.seats[0].raises).toBe(4);
    expect(a.stats.seats[0].maxRaiseStreak).toBe(2);
  });
  it("第四墩結算後播中場節目，而且是依真實戰況（連續加注 → 異常加注調查；落後很多 → 落後分析），不會兩個都播", () => {
    const mids = all.filter(c => c.id === "4:intermission");
    expect(mids).toHaveLength(1);
    const at = steps.findIndex(s => s.cues.some(c => c.id === "4:intermission"));
    expect(steps[at].view.history.length).toBe(4);
    expect(steps[at].view.result).toBeNull();
    // 換不同對局 id：會選到哪一種由 id 決定，但每一種講的都要是真的
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const c = direct(views, CAST, `g-${i}`).all.find(x => x.id === "4:intermission")!;
      seen.add(c.title!);
      if (c.title === "突發！賽事單位介入調查") { expect(texts([c])).toContain("大雞"); expect(texts([c])).toMatch(/連續 4 墩加注|加注 4 次/); }
      else if (c.title === "中場球評｜落後分析") { expect(texts([c])).toMatch(/小美(處於落後|落後 18 枚)/); }
      else throw new Error(`不該出現的中場節目：${c.title}`);
    }
    expect(seen.size).toBe(2);
  });
  it("對手還沒接戰之前，不會說雙方已經各押；接戰之後才說", () => {
    for (const s of steps) {
      const last = s.view.steps.at(-1);
      if (last?.act === "raise" && s.view.phase === "bet") expect(texts(s.cues)).not.toMatch(/雙方各押|接了|跟了/);
    }
  });
  it("同一個畫面重送：不會多出任何演出或統計", () => {
    const d = new Director("g-test", CAST);
    for (const v of views) d.update(publicOf(v));
    const again = d.update(publicOf(views.at(-1)!));
    expect(again.cues).toEqual([]);
    expect(again.analysis.stats.seats[0].raises).toBe(4);
  });
});

describe("P2 事件導演：決勝梭哈、同點疊池、翻轉後輸、讀心後棄牌、逆轉", () => {
  it("第九墩梭哈：出價時說「還在考慮」，接戰後才是「這邊真的沒下一墩」，翻牌後才有結果", () => {
    // 輸贏交替，雙方都撐到第九墩（14:16），最後一墩先手梭哈、對方接戰
    const locks: [number, number][] = [[S(14), H(2)], [S(4), H(14)], [S(13), H(3)], [S(5), H(13)], [S(12), H(6)], [S(6), H(11)], [S(9), H(7)], [S(8), H(10)], [S(10), H(9)]];
    const g2 = LastStandGame.setup({ hands: [HAND0, HAND1], directions: Array(9).fill("high"), coin: 0 });
    const views: LSView[] = [g2.viewFor(0)];
    const act = (s: number, a: Action) => { const r = g2.act(s, a); if (!r.ok) throw new Error(r.msg); views.push(g2.viewFor(0)); };
    for (let t = 1; t <= 9 && !g2.over; t++) {
      if (g2.s.phase === "flip") act(g2.s.toAct, { t: "flip", flip: false });
      while (g2.s.phase === "safeguard") act(g2.s.toAct, { t: "safeguard", use: false });
      act(0, { t: "lock", card: locks[t - 1][0] }); act(1, { t: "lock", card: locks[t - 1][1] });
      if (t < 9) { while (g2.s.phase === "bet") act(g2.s.toAct, { t: "check" }); continue; }
      const fb = g2.s.toAct;
      act(fb, { t: "raise", to: g2.legal(fb).raise![1] });
      act(1 - fb, { t: "call" });
    }
    expect(g2.s.result?.trick).toBe(9);
    const { steps } = direct(views);
    const idxOffer = steps.findIndex(s => s.beats.some(b => b.type === "allin_offer"));
    const idxCall = steps.findIndex(s => s.beats.some(b => b.type === "allin_called_final"));
    expect(idxOffer).toBeGreaterThan(0);
    expect(idxCall).toBeGreaterThan(idxOffer);
    expect(texts(steps[idxOffer].cues)).not.toMatch(/雙方各押|沒下一墩|接了/);
    // 第九墩接戰會立刻翻牌結算：同一步裡有「梭哈被接」的演出，也才開始出現結果
    const callBeat = steps[idxCall].beats.find(b => b.type === "allin_called_final")!;
    expect(steps[idxCall].cues.some(c => c.beat === callBeat.id)).toBe(true);
    expect(steps[idxCall].view.history.length).toBe(9);
    // 結果只在結算之後
    const idxResult = steps.findIndex(s => s.beats.some(b => b.type === "big_result" || b.type === "match_over"));
    expect(idxResult).toBeGreaterThanOrEqual(idxCall);
    expect(steps[idxResult].view.history.length).toBe(9);
  });

  it("同點 → 疊池；再同點 → 疊池持續擴大；翻轉後輸只在結算後；讀心後棄牌要同一墩真的讀心又棄牌", () => {
    const { views } = play([
      { lock: [S(10), H(10)], bets: [{ t: "check" }, { t: "check" }] },                 // 同點
      { lock: [S(9), H(9)], bets: [{ t: "check" }, { t: "check" }] },                   // 又同點：疊池擴大
      { flip: true, lock: [S(14), H(7)], bets: [{ t: "check" }, { t: "check" }] },      // 座位 0 宣戰、翻成比小，A 對 7 → 輸
      { lock: [S(13), H(3)], bets: [{ t: "raise", to: 3 }, { t: "fold" }], insight: 1 }, // 座位 0 加注，座位 1 讀心後棄牌
    ], { coin: 0 });
    const { beats, steps } = direct(views);
    expect(beats.filter(b => b.type === "tie").map(b => b.trick)).toEqual([1, 2]);
    expect(beats.filter(b => b.type === "tie_pool_grow").map(b => b.trick)).toEqual([2]);
    const fl = beats.filter(b => b.type === "flip_lost");
    expect(fl.map(b => [b.trick, b.seat])).toEqual([[3, 0]]);
    const flipStep = steps.findIndex(s => s.beats.some(b => b.type === "flip_lost"));
    expect(steps[flipStep].view.history.some(r => r.trick === 3)).toBe(true);           // 結算後才出現
    expect(beats.filter(b => b.type === "insight_fold").map(b => [b.trick, b.seat])).toEqual([[4, 1]]);
  });

  it("沒有讀心的棄牌不會變成「讀心後棄牌」；讀心過、但下一墩才棄牌也不算", () => {
    const { views } = play([
      { lock: [S(14), H(2)], bets: [{ t: "check" }, { t: "raise", to: 3 }, { t: "call" }], insight: 1 },
      { lock: [S(13), H(3)], bets: [{ t: "raise", to: 3 }, { t: "fold" }] },
    ], { coin: 0 });
    expect(analyze(publicOf(views.at(-1)!)).beats.some(b => b.type === "insight_fold")).toBe(false);
  });

  it("逆轉：比較這一墩結算前後的真實持有（含疊池裡自己的出資）；從平手變領先不算逆轉", () => {
    const { views } = play([
      { lock: [S(4), H(14)], bets: [{ t: "check" }, { t: "check" }] },                         // 座位 0 輸底注 → 14:16
      { lock: [S(14), H(2)], bets: [{ t: "raise", to: 3 }, { t: "call" }] },                   // 座位 0 贏 3 → 17:13：逆轉
      { lock: [S(5), H(13)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },   // 座位 0 輸 2 → 15:15
      { lock: [S(13), H(3)], bets: [{ t: "raise", to: 3 }, { t: "call" }] },                   // 平手 → 領先：不算逆轉
    ], { coin: 0 });
    const b = analyze(publicOf(views.at(-1)!)).beats.filter(x => x.type === "comeback");
    expect(b.map(x => [x.trick, x.seat, x.data.before, x.data.after])).toEqual([[2, 0, [14, 16], [17, 13]]]);
  });

  it("提前結束（第四墩之前有人歸零）：不播中場節目", () => {
    const { views, g } = play([
      { lock: [S(4), H(14)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },
      { lock: [S(5), H(13)], bets: [{ t: "check" }, { t: "check" }] },
      { lock: [S(6), H(11)], bets: [{ t: "check" }, { t: "check" }] },
    ], { coin: 0, stacks: [3, 27] });
    expect(g.over).toBe(true);
    expect(g.s.result!.trick).toBeLessThan(4);
    const { all, beats } = direct(views);
    expect(all.some(c => c.id === "4:intermission")).toBe(false);
    expect(beats.some(b => b.type === "eliminated")).toBe(true);
  });
});

describe("P2 事件導演：重建、不外洩、契約安全", () => {
  const plans: TrickPlan[] = [
    { lock: [S(14), H(2)], bets: [{ t: "check" }, { t: "raise", to: 2 }, { t: "call" }] },
    { lock: [S(10), H(10)], bets: [{ t: "raise", to: 2 }, { t: "raise", to: 3 }, { t: "call" }] },
    { lock: [S(13), H(3)], bets: [{ t: "check" }, { t: "raise", to: 3 }, { t: "call" }] },
    { lock: [S(4), H(14)], bets: [{ t: "raise", to: 4 }, { t: "fold" }] },
    { lock: [S(12), H(6)], bets: [{ t: "check" }, { t: "check" }] },
  ];
  const { views } = play(plans);

  it("重新整理（從中途的畫面重建、不出聲），之後選到的文案跟一路看下來的一模一樣；統計也一樣", () => {
    const full = direct(views);
    const k = 12;
    const d = new Director("g-test", CAST);
    d.update(publicOf(views[k]), true);
    const rest: Cue[] = [];
    for (const v of views.slice(k + 1)) rest.push(...d.update(publicOf(v)).cues);
    const fromFull = full.steps.slice(k + 1).flatMap(s => s.cues);
    expect(rest.map(c => c.id)).toEqual(fromFull.map(c => c.id));
    expect(analyze(publicOf(views.at(-1)!)).stats).toEqual(full.d.update(publicOf(views.at(-1)!), true).analysis.stats);
  });
  it("導演只拿公開資料：publicOf 不含手牌、鎖的牌、讀心結果、可以做的動作", () => {
    const p = publicOf(views[5]) as unknown as Record<string, unknown>;
    for (const k of ["hand", "myLock", "insight", "myInsights", "legal", "counts", "locked"]) expect(p).not.toHaveProperty(k);
  });
  it("演出裡出現的牌，都是已經翻開的牌（棄牌墩、還沒翻的牌不會出現）", () => {
    const { steps } = direct(views);
    for (const s of steps) {
      const shown = new Set(s.view.history.flatMap(r => (r.cards ? r.cards.map(c => c) : [])));
      const allCards = [...HAND0, ...HAND1];
      for (const c of allCards) if (!shown.has(c)) expect(texts(s.cues)).not.toContain(cardText(c));
    }
  });
  it("開局有契約公證處（玩家填的字原樣當純文字放進去，不當 HTML）", () => {
    const cast: Cast = { names: ["<b>大雞</b>", "小美"], stakes: ["<img src=x onerror=alert(1)>", ""], vows: ["", ""] };
    const { all } = direct(views.slice(0, 2), cast);
    const c = all.find(x => x.id.startsWith("1:start"));
    expect(c?.program).toBe("notary");
    expect(texts([c!])).toContain("<img src=x onerror=alert(1)>");   // 原樣（畫面用 textContent 顯示）
  });
  it("沒有合適的模板就安全跳過（不硬湊）", () => {
    const d = new Director("g-x", { names: ["", ""], stakes: ["", ""], vows: ["", ""] });
    expect(() => { for (const v of views) d.update(publicOf(v)); }).not.toThrow();
  });
});
