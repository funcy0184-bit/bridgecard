// P2.5-B 牌桌演出導演：佇列順序、略過、斷線取消、整場結束不收牌、背景分頁直接到終點、我的蓋牌（確認／拒絕／連點）
import { describe, expect, it } from "vitest";
import type { TrickRecord } from "../src/laststand/engine";
import { SHOW_MS, StageAnims, TableStage } from "../src/client/lsstage";

const rec = (trick: number, winner = 0): TrickRecord => ({ trick, winner } as unknown as TrickRecord);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// 假的動畫：每一段都記下來；可以讓某一段「卡住」直到手動放行
function fake(opt: { away?: boolean } = {}) {
  const log: string[] = [];
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nid = 0;
  const gates = new Map<string, () => void>();
  const step = (name: string, hold = false) => {
    log.push(name);
    if (!hold) return Promise.resolve();
    return new Promise<void>(res => gates.set(name, res));
  };
  const holdOn = new Set<string>();
  const a: StageAnims = {
    instant: () => false,
    away: () => !!opt.away,
    render: () => { log.push("render"); },
    reveal: () => step("reveal", holdOn.has("reveal")),
    verdict: () => step("verdict"),
    collect: (_r, quick) => step(quick ? "collect:quick" : "collect"),
    cleared: () => { log.push("cleared"); },
    oppLand: () => step("oppLand", holdOn.has("oppLand")),
    myFly: id => step(`myFly:${id}`, holdOn.has("myFly")),
    myRest: () => { log.push("myRest"); },
    myBack: id => step(`myBack:${id}`),
    clearFx: () => { log.push("clearFx"); },
    now: () => t,
    setTimer: (fn, ms) => { const id = ++nid; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimer: id => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
    nextFrame: fn => queueMicrotask(fn),
  };
  const advance = async (ms: number) => {
    t += ms;
    for (const x of timers.filter(x => x.at <= t)) { timers.splice(timers.indexOf(x), 1); x.fn(); }
    await flush();
  };
  // 放行：名稱開頭符合的那一段（myFly 放行 myFly:7）
  const release = async (name: string) => { for (const [k, g] of [...gates]) if (k === name || k.startsWith(name + ":")) { g(); gates.delete(k); } await flush(); };
  const steps = () => log.filter(x => x !== "render");
  return { a, log, steps, advance, release, holdOn, timers };
}

describe("P2.5-B 牌桌演出導演", () => {
  it("一墩結束：翻牌 → 判勝負 → 看結果（等到 SHOW_MS）→ 收牌 → 清桌；一結算就凍結在那一墩", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.trickEnd(rec(3), false);
    expect(s.presenting()?.trick).toBe(3);
    expect(s.phase()).toBe("pre");
    await flush();
    expect(f.steps()).toEqual(["reveal", "verdict"]);
    expect(s.phase()).toBe("hold");
    expect(s.verdictShown()).toBe(true);
    await f.advance(SHOW_MS - 1);
    expect(s.phase()).toBe("hold");
    await f.advance(1);
    expect(f.steps()).toEqual(["reveal", "verdict", "collect", "cleared"]);
    expect(s.presenting()).toBeNull();
    expect(s.phase()).toBe("idle");
    expect(s.idle()).toBe(true);
    expect(f.timers.length).toBe(0);
  });

  it("翻牌那一下勝負還沒揭曉（不能先亮金框）", async () => {
    const f = fake();
    f.holdOn.add("reveal");
    const s = new TableStage(f.a);
    s.trickEnd(rec(1), false);
    await flush();
    expect(s.phase()).toBe("reveal");
    expect(s.verdictShown()).toBe(false);
    await f.release("reveal");
    expect(s.verdictShown()).toBe(true);
  });

  it("整場結束：翻牌、判勝負後不收牌（最後一墩留在桌上），也不等看結果", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.trickEnd(rec(9), true);
    await flush();
    expect(f.steps()).toEqual(["reveal", "verdict"]);
    expect(s.presenting()).toBeNull();
    expect(s.idle()).toBe(true);
    expect(f.timers.length).toBe(0);
  });

  it("點牌桌略過：不等看結果，直接快速收牌", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.trickEnd(rec(2), false);
    await flush();
    expect(s.phase()).toBe("hold");
    s.skip();
    await flush();
    expect(f.steps()).toEqual(["reveal", "verdict", "collect:quick", "cleared"]);
    expect(f.timers.length).toBe(0);
    expect(s.idle()).toBe(true);
  });

  it("斷線回來（cancelAll）：演到一半直接停，不會再演判勝負、不重播", async () => {
    const f = fake();
    f.holdOn.add("reveal");
    const s = new TableStage(f.a);
    s.trickEnd(rec(4), false);
    s.oppLock();
    await flush();
    s.cancelAll();
    await f.release("reveal");
    await f.advance(SHOW_MS * 2);
    expect(f.steps()).toEqual(["reveal", "clearFx"]);
    expect(s.presenting()).toBeNull();
    expect(s.isIncoming("opp")).toBe(false);
    expect(s.idle()).toBe(true);
  });

  it("對手蓋牌排在一墩結束後面演；飛到之前出牌位藏著", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.trickEnd(rec(5), false);
    s.oppLock();
    expect(s.isIncoming("opp")).toBe(true);
    await flush();
    expect(f.steps()).toEqual(["reveal", "verdict"]);
    await f.advance(SHOW_MS);
    expect(f.steps()).toEqual(["reveal", "verdict", "collect", "cleared", "oppLand"]);
    expect(s.isIncoming("opp")).toBe(false);
    expect(s.idle()).toBe(true);
  });

  it("背景分頁：不等看結果、直接演完", async () => {
    const f = fake({ away: true });
    const s = new TableStage(f.a);
    s.trickEnd(rec(6), false);
    await flush();
    expect(f.steps()).toEqual(["reveal", "verdict", "collect", "cleared"]);
    expect(s.idle()).toBe(true);
  });

  it("我的蓋牌：先確認後落桌 → 落桌那一刻才交給出牌位；連點只演一次", async () => {
    const f = fake();
    f.holdOn.add("myFly");
    const s = new TableStage(f.a);
    s.myLock(7);
    s.myLock(8);
    expect(s.flyingId()).toBe(7);
    expect(s.isIncoming("me")).toBe(true);
    s.myLockConfirmed(7);
    await flush();
    expect(s.isIncoming("me")).toBe(true);           // 還在飛
    await f.release("myFly");
    expect(f.steps()).toEqual(["myFly:7", "myRest"]);
    expect(s.isIncoming("me")).toBe(false);
    expect(s.flyingId()).toBe(-1);
    expect(s.idle()).toBe(true);
  });

  it("我的蓋牌：先落桌、伺服器慢一點才確認 → 牌停在出牌位等", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.myLock(3);
    await flush();
    expect(s.isIncoming("me")).toBe(true);
    expect(f.steps()).toEqual(["myFly:3"]);
    s.myLockConfirmed(3);
    expect(f.steps()).toEqual(["myFly:3", "myRest"]);
    expect(s.isIncoming("me")).toBe(false);
  });

  it("我的蓋牌被拒絕：等落桌後飛回手牌，手牌那張重新出現", async () => {
    const f = fake();
    f.holdOn.add("myFly");
    const s = new TableStage(f.a);
    s.myLock(11);
    s.myLockFailed();
    await flush();
    expect(f.steps()).toEqual(["myFly:11"]);         // 不會半空中掉頭
    await f.release("myFly");
    expect(f.steps()).toEqual(["myFly:11", "myBack:11"]);
    expect(s.flyingId()).toBe(-1);
    expect(s.isIncoming("me")).toBe(false);
  });

  it("確認的是別張牌（不應該發生）：不交接", async () => {
    const f = fake();
    const s = new TableStage(f.a);
    s.myLock(1);
    await flush();
    s.myLockConfirmed(2);
    expect(s.flyingId()).toBe(1);
  });
});
