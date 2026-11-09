// 阿禾的四幕故事＋單機（跟電腦打）的測試
//   · 每一幕都用正式規則引擎跑：兩種搶牌、跟牌、王吃／墊牌、最後一墩、計分
//   · 重來回到同一手、存檔重播得到同一個結果
//   · 阿禾的手牌和他摸的暗牌不會出現在你看得到的東西裡
//   · 單機：電腦打完整場（含加倍），存檔／讀檔，重新發牌
import { describe, expect, it, vi } from "vitest";
import { Call, Strain, Suit, bidIndex, cardId, cardText, suitOf, tricksNeeded } from "../src/game/cards";
import { GameEvent, Phase, TableState } from "../src/game/game";
import { score } from "../src/game/scoring";
import {
  ACTS, AHE, CONTRACT, LINES, ME, STEPS, StepId, TALK, act, bidMeaning, outcomeOf, replay, resultLine, settle, start, stepIndex,
  bidReaction, canRuff, trumpText, bidAllowed, trickWhy, nextLeader,
} from "../src/story/script";
import { LocalTable, SOLO_KEY } from "../src/client/solo";
import type { ServerMsg } from "../src/server/protocol";

const C = cardId;
const { Clubs: CL, Diamonds: DI, Hearts: HE, Spades: SP } = Suit;
const step = (id: StepId) => STEPS[stepIndex(id)];

function play(id: StepId, card: number) {
  const run = start(step(id));
  const a = act(run, card);
  const b = a.ok ? settle(run) : [];
  return { run, a, b, v: run.game.viewFor(ME) };
}

// 你看得到的所有牌（畫面上會畫出來的）
function visibleCards(v: TableState, events: GameEvent[]): Set<number> {
  const s = new Set<number>([...v.hand, ...v.legal, ...v.oppTakenFaceUp, v.faceUp, v.leadCard, v.followCard]);
  for (const e of events) s.add(e.card);
  s.delete(-1);
  return s;
}

describe("故事：四幕、十二段", () => {
  it("四幕依序排好，每一幕都有比較案例", () => {
    expect(ACTS.map(a => a.title)).toEqual(["先來搶牌", "你敢叫幾墩？", "王牌派上用場", "說到做到"]);
    expect(STEPS.map(s => s.id)).toEqual(["grab", "grab2", "bid", "bid2", "follow", "ruff", "flipA", "flipB", "trumps", "nt", "last", "down"]);
    expect(STEPS.map(s => s.act)).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  });
  it("每一個固定牌局都合法：手牌張數對得上、墩數加起來不超過 13", () => {
    for (const st of STEPS) {
      const sn = st.snapshot;
      const played = sn.tricksWon[0] + sn.tricksWon[1];
      const mine = sn.hands[ME].length, his = sn.hands[AHE].length;
      const aheLed = sn.leadCard >= 0 && sn.leader === AHE;
      if (sn.phase === Phase.Play) expect(mine + his + (aheLed ? 1 : 0)).toBe(2 * (13 - played));
      // 牌不重複
      const all = [...sn.hands[0], ...sn.hands[1], ...sn.stock, ...(sn.leadCard >= 0 ? [sn.leadCard] : [])];
      expect(new Set(all).size).toBe(all.length);
    }
  });
  it("沒有「有王牌就能隨時出」或「花色依黑桃紅心方塊梅花比大小」的錯誤說法", () => {
    const all = JSON.stringify(LINES) + JSON.stringify(Object.values(TALK).map(t => t.intro));
    for (const w of ["有王牌就能隨時出", "黑桃、紅心、方塊、梅花比", "四種花色", "數到十"]) expect(all).not.toContain(w);
  });
});

describe("第一幕：搶牌與一墩的完整循環", () => {
  it("♣Q 贏 ♣9、♣4 輸 ♣9：贏家拿明牌、輸家摸暗牌，各出一張補一張", () => {
    const w = play("grab", C(CL, 12));
    expect(outcomeOf(w.run)).toBe("win");
    expect(w.v.hand).toContain(C(DI, 13));
    expect(w.v.hand.length).toBe(2);
    expect(LINES.grab.explain(w.run, "win")).toContain("下一墩由你先出");
    const l = play("grab", C(CL, 4));
    expect(outcomeOf(l.run)).toBe("lose");
    expect(LINES.grab.explain(l.run, "lose")).toContain("你從牌堆摸到暗牌 ♠6，♣Q 還留在你手上");
    expect(LINES.grab.explain(l.run, "lose")).toContain("下一墩由阿禾先出");
  });
  it("接著的下一墩：贏家（你）先出；明牌 ♥J 不決定跟牌花色；搶完才進入叫牌", () => {
    const st = step("grab2");
    expect(st.snapshot.leader).toBe(ME);
    for (const card of [C(CL, 4), C(DI, 13)]) {
      const run = start(st);
      expect(act(run, card).ok).toBe(true);
      settle(run);                                  // 阿禾回一張（他沒有你出的花色）
      expect(suitOf(run.trick!.follow)).not.toBe(suitOf(card));
      expect(outcomeOf(run)).toBe("win");
      expect(run.game.phase).toBe(Phase.Bidding);   // 牌堆空了 → 叫牌
      expect(run.game.viewFor(ME).myTricks).toBe(0); // 搶牌的墩不算合約
      expect(LINES.grab2.explain(run, "win")).toContain("不是領出花色");
    }
  });
});

describe("第二幕：叫牌、合約與首攻", () => {
  it("情況 A：你叫 2♥、阿禾 Pass，合約成立，防守方先出", () => {
    expect(act(start(step("bid")), bidIndex(3, Strain.Spades)).ok).toBe(false);
    const { run, v } = play("bid", CONTRACT);
    expect(outcomeOf(run)).toBe("contract");
    expect([v.declarer, v.leaderSeat, v.highestBid]).toEqual([ME, AHE, CONTRACT]);
    expect(LINES.bid.explain(run, "contract")).toContain("8 墩（6＋2）");
  });
  it("情況 B：你叫 2♥、阿禾叫 2♠，再輪到你：比 2♠ 低的不能叫、可以叫更高或 Pass", () => {
    const run = start(step("bid2"));
    expect(act(run, CONTRACT).ok).toBe(true);
    settle(run);
    expect(run.done).toBe(false);
    expect(run.game.highestBid).toBe(bidIndex(2, Strain.Spades));
    expect(bidAllowed(run, bidIndex(2, Strain.Hearts))).toBe(false);
    expect(bidAllowed(run, bidIndex(3, Strain.Hearts))).toBe(true);
    expect(bidAllowed(run, Call.Pass)).toBe(true);
    expect(bidAllowed(run, Call.Double)).toBe(false);      // 加倍放在延伸說明
    // 叫 3♥：你是莊家、要 9 墩
    const r1 = replay(step("bid2"), [CONTRACT, bidIndex(3, Strain.Hearts)])!;
    expect([outcomeOf(r1), r1.game.declarer, tricksNeeded(r1.game.highestBid)]).toEqual(["raise", ME, 9]);
    // Pass：阿禾的 2♠ 成立，他是莊家，你是防守方、先出第一張
    const r2 = replay(step("bid2"), [CONTRACT, Call.Pass])!;
    expect([outcomeOf(r2), r2.game.declarer, r2.game.viewFor(ME).leaderSeat]).toEqual(["defend", AHE, ME]);
    expect(LINES.bid2.explain(r2, "defend")).toContain("你是防守方");
  });
});

describe("第三幕：先後順序、跟牌與王牌", () => {
  it("有黑桃不能出紅心；缺門可以王吃或墊牌", () => {
    expect(act(start(step("follow")), C(HE, 2)).ok).toBe(false);
    expect(outcomeOf(play("follow", C(SP, 3)).run)).toBe("followed");
    expect(outcomeOf(play("ruff", C(HE, 2)).run)).toBe("ruff");
    expect(outcomeOf(play("ruff", C(CL, 3)).run)).toBe("discard");
    expect(canRuff(start(step("follow")))).toBe(false);
    expect(canRuff(start(step("ruff")))).toBe(true);
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
    expect(JSON.stringify(LINES.nt) + JSON.stringify(TALK.nt.intro)).not.toContain("可以用");
  });
});

describe("第四幕：打成與倒約", () => {
  it("情況 A：2♥ 拿到 8 墩，打成 +20", () => {
    const { run } = play("last", C(CL, 14));
    const r = run.game.lastResult!;
    expect([outcomeOf(run), r.made, r.points, run.game.tricksWon[ME]]).toEqual(["made", true, 20, 8]);
    expect(resultLine(r)).toBe("2♥、沒有加倍、剛好打成，這局 +20 分");
  });
  it("情況 B：2♥ 只拿到 7 墩，倒一；你 7 墩、對手 6 墩，仍未達成 8 墩；對手 +10", () => {
    const { run } = play("down", C(CL, 13));
    const r = run.game.lastResult!;
    expect([outcomeOf(run), r.made, r.undertricks, r.points, run.game.tricksWon[ME], run.game.tricksWon[AHE]]).toEqual(["down", false, 1, 10, 7, 6]);
    expect(LINES.down.explain(run, "down")).toContain("即使你拿 7 墩、對手拿 6 墩，你仍未達成承諾的 8 墩");
  });
  it("計分跟速查一致：打成線數×10、超墩每墩 +2、倒約每墩 10，加倍 ×2、再加倍 ×4", () => {
    expect(resultLine({ ...score(CONTRACT, 1, ME, 9), handNumber: 1 })).toBe("2♥、加倍、多 1 墩，這局 +42 分");
    expect(resultLine({ ...score(CONTRACT, 0, ME, 6), handNumber: 1 })).toBe("2♥、沒有加倍、倒 2 墩，對手 +20 分");
    expect(score(CONTRACT, 2, ME, 7).points).toBe(40);
  });
  it("白話：叫牌的意思與阿禾的反應照規則算", () => {
    expect(bidMeaning(CONTRACT)).toBe("紅心當王牌，至少要贏 8 墩（6＋2）");
    expect(bidMeaning(bidIndex(1, Strain.NoTrump))).toBe("不設王牌（無王），至少要贏 7 墩（6＋1）");
    expect(trumpText(bidIndex(3, Strain.NoTrump))).toBe("不設王牌（無王）");
    expect(bidReaction(bidIndex(3, Strain.Spades))).toBe("「喔？你要叫 3♠，那就得拿到 9 墩喔！」");
  });
});

describe("存檔、重播、不外洩", () => {
  const paths: [StepId, number[]][] = [
    ["grab", [C(CL, 12)]], ["grab", [C(CL, 4)]], ["grab2", [C(DI, 13)]], ["bid", [CONTRACT]], ["bid2", [CONTRACT, Call.Pass]], ["bid2", [CONTRACT, bidIndex(3, Strain.Hearts)]],
    ["follow", [C(SP, 3)]], ["ruff", [C(HE, 2)]], ["ruff", [C(CL, 3)]], ["flipA", [C(DI, 14)]], ["flipB", [C(DI, 14)]], ["trumps", [C(HE, 12)]], ["nt", [C(SP, 2)]],
    ["last", [C(CL, 14)]], ["down", [C(CL, 13)]],
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
    expect(replay(step("follow"), [C(HE, 2)])).toBeNull();
    expect(replay(step("bid"), [bidIndex(1, Strain.Clubs)])).toBeNull();
    expect(replay(step("grab"), [C(CL, 12), C(CL, 4)])).toBeNull();
  });
  it.each(paths)("%s 出 %j：阿禾沒出過的手牌、他摸的暗牌都看不到", (id, acts) => {
    const run = runIt(id, acts);
    const v = run.game.viewFor(ME);
    const s = step(id).snapshot;
    const hidden = new Set<number>(s.hands[AHE]);
    if (run.trick && run.trick.follow >= 0 && run.trick.leader === ME) hidden.delete(run.trick.follow);   // 他回的那張已經亮在桌上
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

describe("一句一句講", () => {
  it("每一段的前情最後一句就是阿禾的問題；出牌後第一句是阿禾的反應；開場有「好啊，來吧！」", () => {
    for (const st of STEPS) {
      const t = TALK[st.id];
      expect(t.intro.at(-1)!.text).toBe(LINES[st.id].ask);
      expect(t.intro.length).toBeGreaterThanOrEqual(2);
      expect(t.intro.length).toBeLessThanOrEqual(8);            // 不用長篇對話
      for (const o of st.outcomes) expect(t.outro(o, start(st))[0].text).toBe(LINES[st.id].reply(o));
    }
    expect(TALK.grab.intro.some(l => l.cta === "好啊，來吧！")).toBe(true);
  });
  it("第四幕的分數台詞取自計分程式", () => {
    const { run } = play("last", C(CL, 14));
    expect(TALK.last.outro("made", run).map(l => l.text).join("")).toContain("就是 20 分");
    expect(TALK.last.outro("made", run).map(l => l.text).join("")).not.toContain("多贏了");
    const d = play("down", C(CL, 13)).run;
    expect(TALK.down.outro("down", d).map(l => l.text).join("")).toContain("這次我拿 10 分");
  });
});
