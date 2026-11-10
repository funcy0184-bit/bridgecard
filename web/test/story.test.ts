// 阿禾的四幕故事＋單機（跟電腦打）的測試
//   · 每一幕都用正式規則引擎跑：兩種搶牌、跟牌、王吃／墊牌、最後兩墩、計分
//   · 分支：開場態度、想不想搶、叫牌計畫、被加倍怎麼回、兩人都不叫重發——台詞不同，結果一律照引擎
//   · 重來回到同一手、存檔重播得到同一個結果；「比較看看」不動正式牌局
//   · 阿禾的手牌和他摸的暗牌不會出現在你看得到的東西裡
//   · 單機：電腦打完整場（含加倍），存檔／讀檔，重新發牌
import { describe, expect, it, vi } from "vitest";
import { Call, Strain, Suit, bidIndex, cardId, cardText, suitOf, tricksNeeded } from "../src/game/cards";
import { GameEvent, Phase, TableState } from "../src/game/game";
import { score } from "../src/game/scoring";
import {
  ACTS, AHE, ASKS, CONTRACT, DOUBLE_LINES, LINES, ME, REDEAL_LINES, STEPS, StepId, TALK, act, answer, bidMeaning, outcomeOf, replay, resultLine, settle, start, stepIndex,
  bidReaction, canRuff, trumpText, bidAllowed, trickWhy, nextLeader, midway, preview, aheDoubled, handSummary, type Ctx, type Line,
} from "../src/story/script";
import { LocalTable, SOLO_KEY } from "../src/client/solo";
import type { ServerMsg } from "../src/server/protocol";

const C = cardId;
const { Clubs: CL, Diamonds: DI, Hearts: HE, Spades: SP } = Suit;
const step = (id: StepId) => STEPS[stepIndex(id)];
const ctx = (picks: Record<string, string> = {}, more: Partial<Ctx> = {}): Ctx => ({ picks, ...more });
const texts = (ls: Line[]) => ls.map(l => l.text).join("");

function play(id: StepId, card: number) {
  const run = start(step(id));
  const a = act(run, card);
  const b = a.ok ? settle(run) : [];
  return { run, a, b, v: run.game.viewFor(ME) };
}
// 第四幕：兩墩（第一墩出 first，第二墩出手上剩下能出的那張）
function play2(id: StepId, first: number) {
  const run = start(step(id));
  expect(act(run, first).ok).toBe(true);
  settle(run);
  const mid = midway(run)!;
  const second = run.game.viewFor(ME).legal[0];
  expect(act(run, second).ok).toBe(true);
  settle(run);
  return { run, mid, second };
}

// 你看得到的所有牌（畫面上會畫出來的）
function visibleCards(v: TableState, events: GameEvent[]): Set<number> {
  const s = new Set<number>([...v.hand, ...v.legal, ...v.oppTakenFaceUp, ...v.myTakenFaceUp, v.faceUp, v.leadCard, v.followCard]);
  for (const e of events) s.add(e.card);
  s.delete(-1);
  return s;
}

describe("故事：四幕、十二段", () => {
  it("四幕依序排好，每一幕都有比較案例", () => {
    expect(ACTS.map(a => a.title)).toEqual(["先來搶牌", "這局你敢叫多大？", "王牌派上用場", "說到做到"]);
    expect(STEPS.map(s => s.id)).toEqual(["grab", "grab2", "bid", "bid2", "follow", "ruff", "flipA", "flipB", "trumps", "nt", "last", "dbl"]);
    expect(STEPS.map(s => s.act)).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  });
  it("每一個固定牌局都合法：手牌張數對得上、墩數加起來不超過 13", () => {
    for (const st of STEPS) {
      const sn = st.snapshot;
      const played = sn.tricksWon[0] + sn.tricksWon[1];
      const mine = sn.hands[ME].length, his = sn.hands[AHE].length;
      const aheLed = sn.leadCard >= 0 && sn.leader === AHE;
      if (sn.phase === Phase.Play) expect(mine + his + (aheLed ? 1 : 0)).toBe(2 * (13 - played));
      if (sn.phase === Phase.Draw) expect(mine).toBe(his + (aheLed ? 1 : 0));
      // 牌不重複
      const all = [...sn.hands[0], ...sn.hands[1], ...sn.stock, ...(sn.leadCard >= 0 ? [sn.leadCard] : [])];
      expect(new Set(all).size).toBe(all.length);
    }
  });
  it("沒有「有王牌就能隨時出」或「花色依黑桃紅心方塊梅花比大小」的錯誤說法，也沒有客服口吻", () => {
    const p = ctx({ attitude: "pro" }, { egg: true });
    const all = JSON.stringify(LINES) + JSON.stringify(Object.values(TALK).map(t => t.intro(p))) + JSON.stringify(ASKS);
    for (const w of ["有王牌就能隨時出", "黑桃、紅心、方塊、梅花比", "四種花色", "數到十", "請選擇", "恭喜您", "您", "此策略", "請執行"]) expect(all).not.toContain(w);
  });
});

describe("第一幕：搶牌與一墩的完整循環", () => {
  it("開場三種態度：完全不會／知道一點點／我超強，阿禾各有不同回法", () => {
    const run = start(step("grab"));
    const a = ["newbie", "some", "pro"].map(k => texts(answer("attitude", k, run, ctx())));
    expect(new Set(a).size).toBe(3);
    expect(a[0]).toContain("我一開始也不會");
    expect(a[2]).toContain("等等輸了不要哭喔");
    expect(TALK.grab.intro(ctx()).some(l => l.ask === "attitude" && l.choices?.length === 3)).toBe(true);
    expect(TALK.grab.intro(ctx()).some(l => l.ask === "grab" && l.choices?.length === 3)).toBe(true);
  });
  it("♣Q 贏 ♣9、♣4 輸 ♣9：贏家拿明牌、輸家摸暗牌，各出一張補一張；♥3 不能出（要跟梅花）", () => {
    expect(act(start(step("grab")), C(HE, 3)).ok).toBe(false);
    expect(LINES.grab.illegal!(start(step("grab"))).join("")).toContain("你還有梅花啦，不能偷跑");
    const w = play("grab", C(CL, 12));
    expect(outcomeOf(w.run)).toBe("win");
    expect(w.v.hand).toContain(C(DI, 13));
    expect(w.v.hand.length).toBe(3);
    expect(LINES.grab.explain(w.run, "win")).toContain("下一墩由你先出");
    const l = play("grab", C(CL, 4));
    expect(outcomeOf(l.run)).toBe("lose");
    expect(LINES.grab.explain(l.run, "lose")).toContain("你從牌堆摸到暗牌 ♠6，♣Q 還留在你手上");
    expect(LINES.grab.explain(l.run, "lose")).toContain("下一墩由阿禾先出");
  });
  it("想搶、保守、不知道怎麼搶：結果照引擎，台詞跟著你的選擇（保守不判錯）", () => {
    const w = play("grab", C(CL, 12)).run, l = play("grab", C(CL, 4)).run;
    expect(texts(TALK.grab.outro("win", w, ctx({ grab: "go" })))).toContain("漂亮");
    expect(texts(TALK.grab.outro("lose", l, ctx({ grab: "go" })))).toContain("不是想搶就一定搶得到");
    const keep = texts(TALK.grab.outro("lose", l, ctx({ grab: "keep" })));
    expect(keep).toContain("大牌還留在手上");
    expect(keep).not.toMatch(/錯|不對/);
    expect(texts(answer("grab", "how", start(step("grab")), ctx()))).toContain("贏的人拿明牌");
  });
  it("接著的下一墩：贏家（你）先出；明牌 ♥J 不決定跟牌花色；搶完才進入叫牌", () => {
    const st = step("grab2");
    expect(st.snapshot.leader).toBe(ME);
    for (const card of [C(CL, 4), C(DI, 13), C(HE, 3)]) {
      const run = start(st);
      expect(act(run, card).ok).toBe(true);
      settle(run);
      expect(outcomeOf(run)).toBe("win");
      expect(run.game.phase).toBe(Phase.Bidding);   // 牌堆空了 → 叫牌
      expect(run.game.viewFor(ME).myTricks).toBe(0); // 搶牌的墩不算合約
      expect(LINES.grab2.explain(run, "win")).toContain("不是領出花色");
      // 阿禾有沒有跟：照真的牌講
      const followed = suitOf(run.trick!.follow) === suitOf(card);
      expect(texts(TALK.grab2.outro("win", run, ctx()))).toContain(followed ? "可惜比你小" : "只好墊一張");
    }
  });
  it("第一幕結尾的幹話彩蛋：只有抽到才出現，選「蛤？」阿禾會圓回來", () => {
    const run = play("grab2", C(DI, 13)).run;
    expect(texts(TALK.grab2.outro("win", run, ctx({}, { egg: false })))).not.toContain("今天就是明天的昨天");
    const withEgg = TALK.grab2.outro("win", run, ctx({}, { egg: true }));
    expect(withEgg.at(-1)!.ask).toBe("egg");
    expect(texts(answer("egg", "huh", run, ctx()))).toContain("我突然想到");
  });
});

describe("第二幕：叫牌、加倍、合約與首攻", () => {
  it("叫得低：阿禾 Pass，合約成立，防守方先出", () => {
    expect(act(start(step("bid")), bidIndex(5, Strain.Spades)).ok).toBe(false);          // 這關最多 4 線
    const { run, v } = play("bid", CONTRACT);
    expect(outcomeOf(run)).toBe("contract");
    expect([v.declarer, v.leaderSeat, v.highestBid, v.doubled]).toEqual([ME, AHE, CONTRACT, 0]);
    expect(LINES.bid.explain(run, "contract")).toContain("8 墩（6＋2）");
  });
  it("叫 3 線以上：阿禾加倍 → 你可以再加倍或直接打；加倍後不能亂叫", () => {
    const run = start(step("bid"));
    expect(act(run, bidIndex(3, Strain.Hearts)).ok).toBe(true);
    settle(run);
    expect(aheDoubled(run)).toBe(true);
    expect(run.done).toBe(false);
    expect(bidAllowed(run, bidIndex(4, Strain.Hearts))).toBe(false);
    expect(bidAllowed(run, Call.Redouble)).toBe(true);
    expect(DOUBLE_LINES.at(-1)!.choices!.map(c => c.key)).toEqual(["rdbl", "play", "what"]);
    const r1 = replay(step("bid"), [bidIndex(3, Strain.Hearts), Call.Redouble])!;
    expect([outcomeOf(r1), r1.game.doubled, r1.game.declarer]).toEqual(["contract", 2, ME]);
    const r2 = replay(step("bid"), [bidIndex(3, Strain.Hearts), Call.Pass])!;
    expect([outcomeOf(r2), r2.game.doubled]).toEqual(["contract", 1]);
    expect(LINES.bid.explain(r2, "contract")).toContain("打成拿 60 分（沒加倍是 30）");
    expect(texts(answer("dbl", "what", run, ctx()))).toContain("沒加倍打成 30 分，加倍變 60、再加倍變 120");
  });
  it("叫無王：阿禾說這局不能靠王吃；叫低／叫高的反應不一樣", () => {
    expect(bidReaction(bidIndex(1, Strain.NoTrump))).toContain("不能靠王吃");
    expect(bidReaction(bidIndex(2, Strain.Diamonds))).toContain("先穩一點");
    expect(bidReaction(bidIndex(3, Strain.Diamonds))).toContain("這麼敢");
    expect(bidReaction(Call.Pass)).toContain("先看看對手怎麼講");
  });
  it("你不叫、阿禾也不叫：照規則重發（教學回到同一手）", () => {
    const run = start(step("bid"));
    expect(act(run, Call.Pass).ok).toBe(true);
    settle(run);
    expect(run.redeal).toBe(true);
    expect(texts(REDEAL_LINES)).toContain("我們兩個都不叫");
    expect(replay(step("bid"), [Call.Pass])).toBeNull();             // 重發不存檔
  });
  it("「這個我不會」：只看你自己的手牌，數花色和大牌", () => {
    expect(handSummary(step("bid").snapshot.hands[ME])).toBe("你現在：♠ 2 張、♥ 6 張、♦ 3 張、♣ 2 張；大牌有 ♠K ♥A ♥K ♥Q ♣A。");
    expect(texts(answer("plan", "help", start(step("bid")), ctx()))).toContain("花色多不代表一定贏");
  });
  it("競叫：你叫 2♥、阿禾叫 2♠，再輪到你：比 2♠ 低的不能叫、可以叫更高或 Pass", () => {
    const run = start(step("bid2"));
    expect(act(run, CONTRACT).ok).toBe(true);
    settle(run);
    expect(run.done).toBe(false);
    expect(run.game.highestBid).toBe(bidIndex(2, Strain.Spades));
    expect(bidAllowed(run, bidIndex(2, Strain.Hearts))).toBe(false);
    expect(bidAllowed(run, bidIndex(3, Strain.Hearts))).toBe(true);
    expect(bidAllowed(run, Call.Pass)).toBe(true);
    expect(bidAllowed(run, Call.Double)).toBe(false);
    const r1 = replay(step("bid2"), [CONTRACT, bidIndex(3, Strain.Hearts)])!;
    expect([outcomeOf(r1), r1.game.declarer, tricksNeeded(r1.game.highestBid)]).toEqual(["raise", ME, 9]);
    const r2 = replay(step("bid2"), [CONTRACT, Call.Pass])!;
    expect([outcomeOf(r2), r2.game.declarer, r2.game.viewFor(ME).leaderSeat]).toEqual(["defend", AHE, ME]);
    expect(LINES.bid2.explain(r2, "defend")).toContain("你是防守方");
  });
});

describe("第三幕：先後順序、跟牌與王牌", () => {
  it("黑桃是王牌、阿禾出 ♥A：有紅心不能王吃；企圖王吃阿禾會攔；為什麼要跟有說明", () => {
    expect(act(start(step("follow")), C(SP, 2)).ok).toBe(false);
    expect(texts(answer("follow", "ruff", start(step("follow")), ctx()))).toContain("你還有紅心啊");
    expect(texts(answer("follow", "why", start(step("follow")), ctx()))).toContain("等你真的沒有紅心");
    const run = play("follow", C(HE, 3)).run;
    expect(outcomeOf(run)).toBe("followed");
    expect(run.trick!.winner).toBe(AHE);
    expect(canRuff(start(step("follow")))).toBe(false);
  });
  it("沒有紅心：♠2 王吃贏、♣3 墊牌輸；王吃的台詞照真的牌講", () => {
    const r = play("ruff", C(SP, 2)).run;
    expect([outcomeOf(r), r.trick!.winner, r.trick!.ruff]).toEqual(["ruff", ME, true]);
    expect(texts(TALK.ruff.outro("ruff", r, ctx()))).toContain("我紅心 A 被你黑桃 2 吃掉？");
    const d = play("ruff", C(CL, 3)).run;
    expect([outcomeOf(d), d.trick!.winner]).toEqual(["discard", AHE]);
    expect(canRuff(start(step("ruff")))).toBe(true);
  });
  it("「我想先比較看看」：兩種出法的結果都算給你看，正式牌局一張牌都沒動", () => {
    const run = start(step("ruff"));
    const before = JSON.stringify(run.game.viewFor(ME));
    const pv = preview(run);
    expect(pv.map(p => [cardText(p.card), p.winner])).toEqual([[cardText(C(SP, 2)), ME], [cardText(C(CL, 3)), AHE]]);
    expect(JSON.stringify(run.game.viewFor(ME))).toBe(before);
    expect(run.actions).toEqual([]);
    expect(texts(answer("ruff", "compare", run, ctx()))).toContain("這只是看看，還沒出喔");
  });
  it("對照 A：阿禾先出 ♠K、你出 ♦A → ♠K 贏（♦A 不是黑桃也不是王牌）", () => {
    const { run } = play("flipA", C(DI, 14));
    expect(run.trick!.winner).toBe(AHE);
    expect(trickWhy(run)).toContain("阿禾贏：本墩先出黑桃，你的方塊不是領出花色，也不是王牌");
    expect(nextLeader(run)).toBe("下一墩由阿禾先出。");
  });
  it("對照 B：你先出 ♦A、阿禾沒有方塊出 ♠K → ♦A 贏", () => {
    const { run } = play("flipB", C(DI, 14));
    expect(run.trick!.follow).toBe(C(SP, 13));
    expect(run.trick!.winner).toBe(ME);
    expect(trickWhy(run)).toContain("你贏：本墩先出方塊，阿禾的黑桃不是領出花色，也不是王牌");
    expect(LINES.flipB.explain(run, "win")).toContain("同樣兩張牌，改變誰先出，領出花色就不同");
  });
  it("都是王牌比點數；有領出花色不能改出別的", () => {
    expect(act(start(step("trumps")), C(SP, 5)).ok).toBe(false);
    const { run } = play("trumps", C(HE, 12));
    expect(run.trick!.winner).toBe(ME);
    expect(trickWhy(run)).toContain("兩張都是王牌");
  });
  it("無王：沒有王吃，出什麼都贏不了領出花色；也不會出現王吃提示", () => {
    expect(canRuff(start(step("nt")))).toBe(false);
    for (const card of [C(HE, 14), C(SP, 2)]) {
      const { run } = play("nt", card);
      expect(run.trick!.winner).toBe(AHE);
      expect(trickWhy(run)).toContain("本局無王");
    }
    expect(JSON.stringify(LINES.nt) + JSON.stringify(TALK.nt.intro(ctx()))).not.toContain("可以用");
  });
});

describe("第四幕：打成、超墩、倒約、加倍", () => {
  it("2♥ 剩兩墩：出 ♣A → 拿到第 8 墩（達標），最後再多一墩：打成超一 +22", () => {
    const { run, mid } = play2("last", C(CL, 14));
    expect([mid.won, mid.mine, mid.reached]).toEqual([true, 8, true]);
    const r = run.game.lastResult!;
    expect([outcomeOf(run), r.made, r.overtricks, r.points, run.game.tricksWon[ME]]).toEqual(["made", true, 1, 22, 9]);
    expect(resultLine(r)).toBe("2♥、沒有加倍、多 1 墩，這局 +22 分");
    expect(texts(TALK.last.outro("made", run, ctx()))).toContain("你是不是太貪心了");
  });
  it("出 ♣3 → 這墩輸；還剩一墩、差一墩（還有機會）；最後 ♣A 墊不贏 ♦9：7 比 6 倒一，對手 +10", () => {
    const run = start(step("last"));
    act(run, C(CL, 3)); settle(run);
    const m = midway(run)!;
    expect([m.won, m.mine, m.left, m.possible]).toEqual([false, 7, 1, true]);
    expect(texts(TALK.last.mid!(run, ctx()))).toContain("拿到就打成");
    expect(run.trick!.lead).toBe(C(DI, 9));                          // 阿禾先出最後一墩
    act(run, C(CL, 14)); settle(run);
    const r = run.game.lastResult!;
    expect([outcomeOf(run), r.made, r.undertricks, r.points, run.game.tricksWon[ME], run.game.tricksWon[AHE]]).toEqual(["down", false, 1, 10, 7, 6]);
    expect(LINES.last.explain(run, "down")).toContain("即使你拿 7 墩、對手拿 6 墩，你仍未達成承諾的 8 墩");
    expect(texts(TALK.last.outro("down", run, ctx()))).toContain("就差一墩");
  });
  it("4♥ 被加倍：♠K → 剛好 10 墩，加倍打成 80；♠3 → 確定打不成（不說還有機會），倒二賠 40", () => {
    const ok = play2("dbl", C(SP, 13)).run;
    expect([outcomeOf(ok), ok.game.lastResult!.points, ok.game.lastResult!.doubled]).toEqual(["made", 80, 1]);
    expect(texts(TALK.dbl.outro("made", ok, ctx()))).toContain("我都加倍了你還打成");
    const run = start(step("dbl"));
    act(run, C(SP, 3)); settle(run);
    const m = midway(run)!;
    expect([m.possible, m.need - m.mine, m.left]).toEqual([false, 2, 1]);
    const said = texts(TALK.dbl.mid!(run, ctx()));
    expect(said).toContain("已經打不成了");
    expect(said).not.toContain("還有機會");
    act(run, run.game.viewFor(ME).legal[0]); settle(run);
    const r = run.game.lastResult!;
    expect([outcomeOf(run), r.undertricks, r.points]).toEqual(["down", 2, 40]);
    expect(texts(TALK.dbl.outro("down", run, ctx()))).toContain("被加倍還沒打成");
    expect(TALK.dbl.outro("down", run, ctx()).at(-1)!.choices!.map(c => c.key)).toEqual(["play", "more", "cheat"]);
    expect(texts(answer("end", "cheat", run, ctx()))).toContain("……好啦，有一點點");
  });
  it("計分跟速查一致：打成線數×10、超墩每墩 +2、倒約每墩 10，加倍 ×2、再加倍 ×4", () => {
    expect(resultLine({ ...score(CONTRACT, 1, ME, 9), handNumber: 1 })).toBe("2♥、加倍、多 1 墩，這局 +42 分");
    expect(resultLine({ ...score(CONTRACT, 0, ME, 6), handNumber: 1 })).toBe("2♥、沒有加倍、倒 2 墩，對手 +20 分");
    expect(score(CONTRACT, 2, ME, 7).points).toBe(40);
  });
  it("白話：叫牌的意思照規則算", () => {
    expect(bidMeaning(CONTRACT)).toBe("紅心當王牌，至少要贏 8 墩（6＋2）");
    expect(bidMeaning(bidIndex(1, Strain.NoTrump))).toBe("不設王牌（無王），至少要贏 7 墩（6＋1）");
    expect(trumpText(bidIndex(3, Strain.NoTrump))).toBe("不設王牌（無王）");
  });
  it("開場態度會被記住：之後的幕偶爾提起", () => {
    expect(texts(TALK.bid.intro(ctx({ attitude: "pro" })))).toContain("你不是說你超強");
    expect(texts(TALK.follow.intro(ctx({ attitude: "newbie" })))).toContain("完全不會的人，現在已經在學王吃了");
    expect(texts(TALK.bid.intro(ctx({ attitude: "some" })))).not.toContain("超強");
    expect(texts(TALK.last.intro(ctx({}, { bidCall: bidIndex(3, Strain.Hearts) })))).toContain("你剛剛叫的是 3♥");
  });
});

describe("存檔、重播、不外洩", () => {
  const paths: [StepId, number[]][] = [
    ["grab", [C(CL, 12)]], ["grab", [C(CL, 4)]], ["grab2", [C(DI, 13)]], ["bid", [CONTRACT]], ["bid", [bidIndex(3, Strain.Hearts), Call.Redouble]], ["bid2", [CONTRACT, Call.Pass]], ["bid2", [CONTRACT, bidIndex(3, Strain.Hearts)]],
    ["follow", [C(HE, 3)]], ["ruff", [C(SP, 2)]], ["ruff", [C(CL, 3)]], ["flipA", [C(DI, 14)]], ["flipB", [C(DI, 14)]], ["trumps", [C(HE, 12)]], ["nt", [C(SP, 2)]],
    ["last", [C(CL, 14), C(CL, 3)]], ["last", [C(CL, 3), C(CL, 14)]], ["dbl", [C(SP, 13), C(SP, 3)]], ["dbl", [C(SP, 3), C(SP, 13)]],
  ];
  const runIt = (id: StepId, acts: number[]) => replay(step(id), acts)!;
  it.each(paths)("%s 出 %j：重新整理後重播得到同一個畫面", (id, acts) => {
    const run = runIt(id, acts);
    expect(run.done).toBe(true);
    const again = replay(step(id), run.actions)!;
    expect(JSON.stringify(again.game.viewFor(ME))).toBe(JSON.stringify(run.game.viewFor(ME)));
    expect(again.trick).toEqual(run.trick);
    expect(outcomeOf(again)).toBe(outcomeOf(run));
  });
  it("壞掉的存檔（不合法的動作）不會被重播", () => {
    expect(replay(step("follow"), [C(SP, 2)])).toBeNull();
    expect(replay(step("bid2"), [bidIndex(1, Strain.Clubs)])).toBeNull();
    expect(replay(step("grab"), [C(CL, 12), C(CL, 4)])).toBeNull();
  });
  it.each(paths)("%s 出 %j：阿禾沒出過的手牌、他摸的暗牌都看不到", (id, acts) => {
    const run = runIt(id, acts);
    const v = run.game.viewFor(ME);
    const s = step(id).snapshot;
    const shown = new Set<number>();
    for (const t of run.history) { shown.add(t.lead); shown.add(t.follow); }
    const hidden = new Set<number>(s.hands[AHE].filter(x => !shown.has(x)));
    if (s.phase === Phase.Draw && run.trick!.winner === ME) hidden.add(s.stock[1]);
    const seen = visibleCards(v, run.events);
    for (const h of hidden) expect(seen.has(h)).toBe(false);
  });
});

// ---------------- 單機：跟電腦打 ----------------

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// 一個「玩家」：只看 TableState 做決定（跟真人一樣看不到電腦的牌）
function attachPlayer(t: LocalTable, rng: () => number) {
  const log = { states: [] as TableState[], events: [] as GameEvent[], hands: 0, doubles: 0 };
  t.onMessage = (m: ServerMsg) => {
    if (m.t === "event") {
      log.events.push(m.e);
      if (m.e.type === "HandScored") log.hands++;
      if (m.e.type === "Doubled" || m.e.type === "Redoubled") log.doubles++;
    }
    if (m.t !== "state") return;
    const s = m.s;
    log.states.push(s);
    if (s.currentSeat !== 0) { if (s.phase === Phase.Finished && s.matchWinner < 0) t.send({ t: "next" }); return; }
    if ((s.phase === Phase.Draw || s.phase === Phase.Play) && s.legal.length && !(s.leadCard >= 0 && s.followCard >= 0)) {
      t.send({ t: "play", card: s.legal[Math.floor(rng() * s.legal.length)] });
    } else if (s.phase === Phase.Bidding) {
      if (s.canDouble && rng() < 0.3) t.send({ t: "call", call: Call.Double });
      else if (s.minBid < 35 && rng() < 0.45) t.send({ t: "call", call: s.minBid + Math.floor(rng() * Math.min(3, 35 - s.minBid)) });
      else t.send({ t: "call", call: Call.Pass });
    } else if (s.phase === Phase.Finished && s.matchWinner < 0) t.send({ t: "next" });
  };
  return log;
}

describe("單機：跟電腦（阿禾）打", () => {
  it("一整場打到有人先到 100 分；每一步都守規則、看不到電腦的牌", async () => {
    vi.useFakeTimers();
    try {
      let seed = 7;
      const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const store = new MemStore();
      const t = new LocalTable("小明", true, { trick: 5, play: 5, lead: 5, call: 5 }, store, rng);
      const log = attachPlayer(t, rng);
      t.open();
      for (let i = 0; i < 20000 && t.game.matchWinner < 0; i++) { await flush(); vi.advanceTimersByTime(5); }
      await flush();
      expect(t.game.matchWinner).toBeGreaterThanOrEqual(0);
      expect(log.hands).toBeGreaterThan(0);
      const last = log.states.at(-1)!;
      expect(Math.max(last.myScore, last.oppScore)).toBeGreaterThanOrEqual(100);
      // 電腦摸的暗牌：你只收到「他摸了一張」
      for (const e of log.events) if (e.type === "CardDrawn" && e.seat === 1) expect(e.card).toBe(-1);
      // 每個狀態：自己 + 對手 + 牌堆 + 桌上 + 已打掉的 = 52
      for (const s of log.states) {
        expect(s.hand.length + s.oppCount + s.stockCount).toBeLessThanOrEqual(52);
        expect(new Set(s.hand).size).toBe(s.hand.length);
      }
      expect(JSON.parse(store.getItem(SOLO_KEY)!).game.matchWinner).toBe(t.game.matchWinner);
      t.close();
    } finally { vi.useRealTimers(); }
  });

  it("重新整理：從存檔回到同一局；?solo=new 重新發牌", async () => {
    vi.useFakeTimers();
    try {
      const store = new MemStore();
      const a = new LocalTable("", true, { trick: 5, play: 5, lead: 5, call: 5 }, store);
      const states: TableState[] = [];
      a.onMessage = m => { if (m.t === "state") states.push(m.s); };
      a.open();
      await flush();
      const first = states.at(-1)!;
      if (first.currentSeat === 0) a.send({ t: "play", card: first.legal[0] });
      await flush();
      vi.advanceTimersByTime(50);
      await flush();
      a.close();
      const saved = JSON.parse(store.getItem(SOLO_KEY)!).game;

      const b = new LocalTable("", false, { trick: 5, play: 5, lead: 5, call: 5 }, store);
      let resumed: TableState | null = null;
      b.onMessage = m => { if (m.t === "state" && !resumed) resumed = m.s; };
      b.open();
      await flush();
      expect(resumed!.hand).toEqual(saved.hands[0]);
      b.close();

      const c = new LocalTable("", true, { trick: 5, play: 5, lead: 5, call: 5 }, store);
      const evs: string[] = [];
      c.onMessage = m => { if (m.t === "event") evs.push(m.e.type); };
      c.open();
      await flush();
      expect(evs).toContain("NewHand");
      expect(JSON.parse(store.getItem(SOLO_KEY)!).game.handsPlayed).toBe(0);
      c.close();
    } finally { vi.useRealTimers(); }
  });

  it("連線前先送 welcome（座位 0）和 lobby（對手叫阿禾）", async () => {
    const t = new LocalTable("小明", true, { trick: 1e9, play: 1e9, lead: 1e9, call: 1e9 }, new MemStore());
    const got: ServerMsg[] = [];
    t.onMessage = m => got.push(m);
    t.open();
    await flush();
    expect(got[0]).toMatchObject({ t: "welcome", seat: 0 });
    expect(got[1]).toMatchObject({ t: "lobby", started: true, seats: [{ name: "小明" }, { name: "阿禾" }] });
    expect(got.some(m => m.t === "state")).toBe(true);
    t.close();
  });
});

