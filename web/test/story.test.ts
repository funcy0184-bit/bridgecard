// 阿禾的四幕故事＋單機（跟電腦打）的測試
//   · 每一幕都用正式規則引擎跑：兩種搶牌、跟牌、王吃／墊牌、最後一墩、計分
//   · 重來回到同一手、存檔重播得到同一個結果
//   · 阿禾的手牌和他摸的暗牌不會出現在你看得到的東西裡
//   · 單機：電腦打完整場（含加倍），存檔／讀檔，重新發牌
import { describe, expect, it, vi } from "vitest";
import { Call, Strain, Suit, bidIndex, cardId, cardText } from "../src/game/cards";
import { GameEvent, Phase, TableState } from "../src/game/game";
import { score } from "../src/game/scoring";
import {
  ACTS, AHE, CONTRACT, LINES, ME, STEPS, StepId, TALK, act, bidMeaning, outcomeOf, replay, resultLine, settle, start, stepIndex,
  bidReaction, canRuff, trumpText,
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

describe("故事：四幕、五個畫面", () => {
  it("四幕依序排好，每一幕至少一個畫面", () => {
    expect(ACTS.map(a => a.title)).toEqual(["先來搶牌", "你敢叫幾墩？", "王牌派上用場", "說到做到"]);
    expect(STEPS.map(s => s.act)).toEqual([0, 1, 2, 2, 3]);
  });
  it("沒有辨認花色、比數字、排 J/Q/K/A 的關卡", () => {
    const all = JSON.stringify(LINES) + JSON.stringify(ACTS);
    for (const w of ["四種花色", "哪一張的點數大", "數到十", "排成一列"]) expect(all).not.toContain(w);
  });
  it("台詞照劇本", () => {
    expect(LINES.grab.ask).toBe("「明牌是 ♦K，這墩贏的人拿走。我出了 ♣9，來，換你出一張試試！」");
    expect(LINES.grab.reply("win")).toBe("「漂亮！這張明牌是你的了。」");
    expect(LINES.grab.reply("lose")).toBe("「嘿，這張被我拿走啦。」");
    expect(LINES.bid.reply("contract")).toBe("「我 Pass，不往上叫了。」");
    expect(LINES.follow.illegal).toBe("「等等，你還有這個花色，要先跟牌喔。」");
    expect(LINES.ruff.ask).toBe("「欸，機會來了！你沒有黑桃，可以試試看出王牌。」");
    expect(LINES.ruff.reply("ruff")).toBe("「對！就是這樣！」");
    expect(LINES.last.reply("made")).toBe("「喔！還真的被你打成了！」");
  });
});

describe("第一幕：雨停前，先搶一張牌", () => {
  it("出 ♣Q：贏這墩，♦K 進手牌；阿禾摸暗牌，你看不到是哪張", () => {
    const { run, v } = play("grab", C(CL, 12));
    expect(outcomeOf(run)).toBe("win");
    expect(run.trick).toMatchObject({ lead: C(CL, 9), follow: C(CL, 12), winner: ME });
    expect(v.hand).toEqual([C(DI, 13), C(CL, 4)]);
    expect(v.oppCount).toBe(2);                                    // 出一張、補一張
    const drawn = run.events.filter(e => e.type === "CardDrawn");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ seat: AHE, card: -1 });       // 只知道他摸了一張
    expect(visibleCards(v, run.events).has(C(SP, 6))).toBe(false);
  });
  it("出 ♣4：輸這墩，阿禾拿 ♦K；你摸到 ♠6、留下 ♣Q", () => {
    const { run, v } = play("grab", C(CL, 4));
    expect(outcomeOf(run)).toBe("lose");
    expect(run.events.find(e => e.type === "FaceUpTaken")).toMatchObject({ seat: AHE, card: C(DI, 13) });
    expect(v.hand).toEqual([C(SP, 6), C(CL, 12)]);
    expect(v.oppCount).toBe(2);
    expect(v.oppTakenFaceUp).toEqual([C(DI, 13)]);
    expect(LINES.grab.explain(run, "lose")).toContain("你從牌堆摸到暗牌 ♠6，♣Q 還留在你手上");
  });
  it("兩種都合法；換一張試試 = 回到一模一樣的同一手", () => {
    const fresh = JSON.stringify(start(step("grab")).game.viewFor(ME));
    expect(JSON.parse(fresh).legal.sort()).toEqual([C(CL, 4), C(CL, 12)].sort());
    play("grab", C(CL, 12));
    expect(JSON.stringify(start(step("grab")).game.viewFor(ME))).toBe(fresh);
  });
  it("搶牌的墩數不算進合約（沒有加到墩數）", () => {
    const { v } = play("grab", C(CL, 12));
    expect([v.myTricks, v.oppTricks]).toEqual([0, 0]);
    expect(v.phase).toBe(Phase.Draw);
  });
});

describe("第二幕：你敢拿幾墩？", () => {
  it("2♥ 的白話：紅心當王、至少 8 墩（6＋2）", () => {
    expect(bidMeaning(CONTRACT)).toBe("紅心當王牌，至少要贏 8 墩（6＋2）");
    expect(bidMeaning(bidIndex(1, Strain.NoTrump))).toBe("不設王牌（無王），至少要贏 7 墩（6＋1）");
    // 無王時不能說成任何花色當王牌
    expect(trumpText(bidIndex(3, Strain.NoTrump))).toBe("不設王牌（無王）");
    // 你點哪個叫牌，阿禾就照那個叫牌算墩數
    expect(bidReaction(CONTRACT)).toBe("「喔？你要叫 2♥，那就得拿到 8 墩喔！」");
    expect(bidReaction(bidIndex(3, Strain.Spades))).toBe("「喔？你要叫 3♠，那就得拿到 9 墩喔！」");
  });
  it("故事只送出 2♥；叫 2♥ → 阿禾 Pass → 合約成立、你是莊家、阿禾先出", () => {
    const run = start(step("bid"));
    expect(act(run, bidIndex(3, Strain.Spades)).ok).toBe(false);
    expect(act(run, CONTRACT).ok).toBe(true);
    const evs = settle(run);
    expect(evs.map(e => e.type)).toEqual(["Passed", "ContractSet"]);
    const v = run.game.viewFor(ME);
    expect([v.phase, v.highestBid, v.declarer, v.leaderSeat, v.myTricks]).toEqual([Phase.Play, CONTRACT, ME, AHE, 0]);
    expect(run.game.trump).toBe(Strain.Hearts);
    expect(v.auctionCalls).toEqual([CONTRACT, Call.Pass]);
    expect(LINES.bid.explain(run, "contract")).toContain("「合約」");
    expect(LINES.bid.explain(run, "contract")).toContain("「莊家」");
    expect(v.hand.filter(c => Math.floor(c / 13) === Suit.Hearts)).toHaveLength(6);
  });
});

describe("第三幕：那張小紅心，該現在用嗎？", () => {
  it("有黑桃時出 ♥2 不合法（引擎回 Illegal），改出 ♠3 → 阿禾拿這墩", () => {
    const run = start(step("follow"));
    const bad = act(run, C(HE, 2));
    expect(bad.ok).toBe(false);
    expect(bad.events.map(e => e.type)).toEqual(["Illegal"]);
    expect(act(run, C(SP, 3)).ok).toBe(true);
    settle(run);
    expect(run.trick).toMatchObject({ winner: AHE, ruff: false });
    expect(outcomeOf(run)).toBe("followed");
  });
  it("換一手（沒有黑桃）：♥2 王吃拿下這墩", () => {
    const { run, a } = play("ruff", C(HE, 2));
    expect(a.events.find(e => e.type === "CardPlayed")).toMatchObject({ extra: 1 });   // 1 = 王吃
    expect(run.trick).toMatchObject({ winner: ME, ruff: true });
    expect(outcomeOf(run)).toBe("ruff");
  });
  it("換一手（沒有黑桃）：墊 ♣3 → 阿禾拿這墩，♥2 留在手上", () => {
    const { run, v } = play("ruff", C(CL, 3));
    expect(run.trick).toMatchObject({ winner: AHE, ruff: false });
    expect(v.hand).toEqual([C(HE, 2)]);
    expect(outcomeOf(run)).toBe("discard");
  });
});

describe("第四幕：最後一墩，你來收桌", () => {
  it("7／8 → 出 ♣A → 8／8，8 比 5，打成 +20 分（分數取自計分程式）", () => {
    const run = start(step("last"));
    expect(run.game.viewFor(ME).myTricks).toBe(7);
    act(run, C(CL, 14));
    const evs = settle(run);
    expect(evs.map(e => e.type)).toEqual(["TrickWon", "GameOver", "HandScored"]);
    const g = run.game, r = g.lastResult!;
    expect(g.tricksWon).toEqual([8, 5]);
    expect(r).toMatchObject({ made: true, overtricks: 0, points: 20, scorer: ME, doubled: 0 });
    expect(r.points).toBe(score(CONTRACT, 0, ME, 8).points);
    expect(resultLine(r)).toBe("2♥、沒有加倍、剛好打成，這局 +20 分");
    expect(LINES.last.explain(run, "made")).toContain("最後是 8 比 5");
  });
  it("結算文字也能處理超墩、倒約、加倍", () => {
    expect(resultLine({ ...score(CONTRACT, 1, ME, 9), handNumber: 1 })).toBe("2♥、加倍、多 1 墩，這局 +42 分");
    expect(resultLine({ ...score(CONTRACT, 0, ME, 6), handNumber: 1 })).toBe("2♥、沒有加倍、倒 2 墩，對手 +20 分");
  });
});

describe("存檔、重播、不外洩", () => {
  const paths: [StepId, number][] = [
    ["grab", C(CL, 12)], ["grab", C(CL, 4)], ["bid", CONTRACT], ["follow", C(SP, 3)],
    ["ruff", C(HE, 2)], ["ruff", C(CL, 3)], ["last", C(CL, 14)],
  ];
  it.each(paths)("%s 出 %i：重新整理後重播得到同一個畫面", (id, a) => {
    const { run } = play(id, a);
    const again = replay(step(id), run.actions)!;
    expect(again.done).toBe(true);
    expect(JSON.stringify(again.game.viewFor(ME))).toBe(JSON.stringify(run.game.viewFor(ME)));
    expect(again.trick).toEqual(run.trick);
    expect(outcomeOf(again)).toBe(outcomeOf(run));
  });
  it("壞掉的存檔（不合法的動作）不會被重播", () => {
    expect(replay(step("follow"), [C(HE, 2)])).toBeNull();
    expect(replay(step("bid"), [bidIndex(1, Strain.Clubs)])).toBeNull();
    expect(replay(step("grab"), [C(CL, 12), C(CL, 4)])).toBeNull();
  });
  it.each(paths)("%s 出 %i：阿禾沒出過的手牌、他摸的暗牌都看不到", (id, a) => {
    const { run, v } = play(id, a);
    const s = step(id).snapshot;
    const hidden = new Set<number>(s.hands[AHE]);
    // 抽牌階段：輸的人摸的是牌堆第 2 張；阿禾摸的那張要保密
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
  it("每一幕的前情最後一句就是阿禾的問題；出牌後第一句是阿禾的反應", () => {
    for (const st of STEPS) {
      const t = TALK[st.id];
      expect(t.intro.at(-1)!.text).toBe(LINES[st.id].ask);
      expect(t.intro.length).toBeGreaterThanOrEqual(3);
      for (const o of st.outcomes) {
        const run = start(st);
        expect(t.outro(o, run)[0].text).toBe(LINES[st.id].reply(o));
      }
    }
  });
  it("第四幕的分數台詞取自計分程式", () => {
    const run = start(step("last"));
    act(run, C(CL, 14)); settle(run);
    expect(TALK.last.outro("made", run).map(l => l.text).join("")).toContain("就是 20 分");
    expect(TALK.last.outro("made", run).map(l => l.text).join("")).toContain("你說要 8 墩，就真的拿到 8 墩");
    // 剛好打成：不會冒出「多贏了幾墩」
    expect(TALK.last.outro("made", run).map(l => l.text).join("")).not.toContain("多贏了");
  });
  it("台詞跟著真的發生的事：王吃只在真的能王吃時提示、摸到的暗牌照引擎、合約照叫出來的", () => {
    // 第三幕之一：手上還有黑桃 → 不能王吃，阿禾不提示；之二：沒有黑桃、有紅心王牌 → 可以
    expect(canRuff(start(step("follow")))).toBe(false);
    expect(canRuff(start(step("ruff")))).toBe(true);
    expect(LINES.follow.ask).not.toContain("王牌");
    // 第一幕輸掉：你摸到的那張暗牌就是引擎發給你的那張
    const g = start(step("grab"));
    act(g, C(CL, 4)); settle(g);
    const drawn = g.events.find(e => e.type === "CardDrawn" && e.seat === ME)!;
    expect(TALK.grab.outro("lose", g).map(l => l.text).join("")).toContain(`你摸到的是 ${cardText(drawn.card)}`);
    expect(TALK.grab.outro("win", g).map(l => l.text).join("")).not.toContain("你還能摸一張暗牌");
    // 第二幕：合約、墩數、誰先出都照真的叫牌結果
    const b = start(step("bid"));
    act(b, CONTRACT); settle(b);
    const said = TALK.bid.outro("contract", b).map(l => l.text).join("");
    expect(said).toContain("2♥ 就是這局的『合約』：紅心當王牌，你要贏到 8 墩");
    expect(said).toContain("由我先出第一張");
    // 開場有「好啊，來吧！」可以按
    expect(TALK.grab.intro.some(l => l.cta === "好啊，來吧！")).toBe(true);
  });
});
