// 梭了啦 單人測試（真人 vs 測試 AI，整場在手機上跑）：不開房、不連網路、規則照引擎、AI 不偷看、籌碼守恆、可重現
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalLastStandTable, LS_AI_KEY, SeedRng, matchSeed, AiSettings } from "../src/client/laststand-solo";
import type { Action, LSEvent, LSView } from "../src/laststand/engine";
import { STRATEGIES } from "../src/laststand/ai";
import { deal, seededRng } from "../src/laststand/rules";
import type { RoomView, ServerMsg } from "../src/server/protocol";

class MemKV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const STRATS = Object.keys(STRATEGIES);

interface H { t: LocalLastStandTable; kv: MemKV; msgs: ServerMsg[]; view: LSView | null; room: RoomView | null }
function harness(set: Partial<AiSettings>, kv = new MemKV(), fresh = true, delay = 0): H {
  const t = new LocalLastStandTable("測試員", fresh, kv, { speed: "instant", ...set }, () => delay);
  const h: H = { t, kv, msgs: [], view: null, room: null };
  t.onMessage = m => {
    h.msgs.push(m);
    if (m.t === "lsState") h.view = m.s;
    if (m.t === "room") h.room = m.r;
    if (m.t === "resync") { h.room = m.r; h.view = m.ls ?? h.view; }
  };
  t.open();
  return h;
}
const send = (h: H, m: Parameters<LocalLastStandTable["command"]>[0]) => new Promise<{ ok: boolean; code?: string; msg?: string }>(res => {
  h.t.command(m, r => res(r as { ok: boolean }));
});
// 玩家這邊：只看自己收到的牌桌，用一套策略選（亂數由牌桌狀態決定，所以重來一次會做一樣的事）
function picker(name: string, seed: number) {
  return (v: LSView): Action => STRATEGIES[name](v, seededRng(seed * 7919 + v.trick * 101 + v.steps.length * 13 + (v.phase === "lock" ? 1 : 0) + (v.insight >= 0 ? 3 : 0)));
}
const myTurn = (v: LSView) => { const L = v.legal; return L.flip || L.safeguard || L.lock.length > 0 || L.check || L.call || L.fold || !!L.raise || L.insight; };
async function start(h: H) {
  for (let i = 0; i < 5 && !h.room; i++) await tick();
  expect((await send(h, { t: "stake", stake: "", vow: "" })).ok).toBe(true);
  expect((await send(h, { t: "ready", ready: true })).ok).toBe(true);
  for (let i = 0; i < 5 && !h.view; i++) await tick();
}
async function playOut(h: H, pick: (v: LSView) => Action, stopAt?: (v: LSView) => boolean) {
  for (let i = 0; i < 20000; i++) {
    await tick();
    if (h.room?.status === "SETTLEMENT") return true;
    const v = h.view;
    if (!v || v.result) continue;
    if (stopAt?.(v)) return false;
    if (!myTurn(v)) continue;
    const r = await send(h, { t: "ls", a: pick(v) });
    if (!r.ok) throw new Error(`玩家的合法動作被拒：${r.msg}`);
  }
  throw new Error("卡住了：20000 步還沒打完");
}
const lsEvents = (h: H) => h.msgs.filter((m): m is Extract<ServerMsg, { t: "lsEvent" }> => m.t === "lsEvent").map(m => m.e);

let fetchSpy: ReturnType<typeof vi.fn>, wsSpy: ReturnType<typeof vi.fn>;
beforeAll(() => {
  fetchSpy = vi.fn(() => { throw new Error("單人測試不該連網路"); });
  wsSpy = vi.fn(() => { throw new Error("單人測試不該開 WebSocket"); });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("WebSocket", wsSpy);
});
afterAll(() => vi.unstubAllGlobals());

describe("梭了啦單人測試：120 場不同 seed 的完整對局", () => {
  it("每場都打完、沒有不合法動作、籌碼一直是 30、AI 的牌沒有提早送出、各種動作都打到、雙方都當過先手", async () => {
    const seen: Record<string, number> = {};
    const firsts = new Set<number>();
    let games = 0, nine = 0, elim = 0;
    for (let k = 0; k < 120; k++) {
      const first = (["seed", "me", "ai"] as const)[k % 3];
      const h = harness({ seed: 1000 + k, strategy: STRATS[k % 6], first });
      await start(h);
      const aiCards = new Set(h.t.game!.s.hands[1]);
      expect(h.view!.hand.some(c => aiCards.has(c))).toBe(false);
      await playOut(h, picker(STRATS[(k + 2) % 6], k));
      games++;
      const evs = lsEvents(h);
      const ms = evs.find(e => e.type === "MatchStart")!;
      if (first === "me") expect(ms.declarer).toBe(0);
      if (first === "ai") expect(ms.declarer).toBe(1);
      firsts.add(ms.declarer!);
      // 守恆：每一個送給玩家的牌桌，雙方手上＋本墩已押＋疊池 = 30
      for (const m of h.msgs) if (m.t === "lsState") {
        const v = m.s;
        expect(v.stacks[0] + v.stacks[1] + v.commit[0] + v.commit[1] + v.pool[0] + v.pool[1]).toBe(30);
        expect(v.hand.some(c => aiCards.has(c))).toBe(false);
      }
      // 不外洩：除了翻牌，任何送到玩家的事件都不含 AI 的牌；AI 的私人事件（鎖了哪張、讀心結果）不送
      for (const e of evs) {
        if (e.type === "Showdown") continue;
        if (e.card !== undefined) expect(aiCards.has(e.card)).toBe(false);
        if (e.cards) expect(e.cards.some(c => aiCards.has(c))).toBe(false);
        if ((e.type === "LockedCard" || e.type === "InsightResult")) expect(e.seat).toBe(0);
      }
      expect(h.t.s.illegal).toBe(0);
      expect(h.t.s.leak).toBe(0);
      expect(h.t.game!.total()).toBe(30);
      const res = h.room!.result!;
      if (res.reason === "nine") nine++; else elim++;
      for (const e of evs) {
        const key = e.type === "Raise" ? (e.reraise ? "Reraise" : "Raise") : e.type;
        seen[key] = (seen[key] ?? 0) + 1;
        if (e.type === "Raise" && e.allIn) seen.AllIn = (seen.AllIn ?? 0) + 1;
      }
      // 選單裡的紀錄：不含暱稱、不含 AI 沒公開的牌
      const log = h.t.logText();
      expect(log).not.toContain("測試員");
      h.t.close();
    }
    console.log(`120 場：九墩打完 ${nine}、有人歸零 ${elim}；動作次數 ${JSON.stringify(seen)}`);
    expect(games).toBe(120);
    expect(firsts).toEqual(new Set([0, 1]));
    for (const k of ["Flip", "FlipPass", "Safeguard", "SafeguardPass", "Locked", "Check", "Raise", "Reraise", "AllIn", "Call", "Fold", "Insight", "Showdown", "PoolAdd", "Settle"])
      expect(seen[k] ?? 0, `沒打到 ${k}`).toBeGreaterThan(0);
    expect(nine).toBeGreaterThan(0);
    expect(elim).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  }, 120_000);
});

describe("梭了啦單人測試：重現、存檔、計時器", () => {
  it("固定 seed：發牌跟 rules.seededRng 一樣，同樣的打法整場事件一模一樣", async () => {
    const r1 = seededRng(42), r2 = new SeedRng(42);
    for (let i = 0; i < 50; i++) expect(r2.next()).toBe(r1());
    const runs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const h = harness({ seed: 777, strategy: "random" });
      await start(h);
      const d = deal(seededRng(matchSeed(777, 1)));
      expect(h.t.game!.s.hands).toEqual(d.hands);
      expect(h.t.game!.s.directions).toEqual(d.directions);
      await playOut(h, picker("bluffer", 5));
      runs.push(JSON.stringify(lsEvents(h)));
      h.t.close();
    }
    expect(runs[0]).toBe(runs[1]);
  });

  it("打到一半重新整理（關掉再開）：接著打，結果跟一口氣打完一模一樣；AI 的亂數也接得上", async () => {
    const pick = picker("balanced", 9);
    const a = harness({ seed: 2468, strategy: "random" });
    await start(a); await playOut(a, pick); a.t.close();
    const kv = new MemKV();
    const b = harness({ seed: 2468, strategy: "random" }, kv);
    await start(b);
    await playOut(b, pick, v => v.trick >= 4);
    const before = lsEvents(b);
    b.t.close();
    expect(JSON.parse(kv.getItem(LS_AI_KEY)!).status).toBe("IN_GAME");
    const c = harness({}, kv, false);
    for (let i = 0; i < 5; i++) await tick();
    expect(c.view!.trick).toBeGreaterThanOrEqual(4);
    await playOut(c, pick);
    expect(JSON.stringify([...before, ...lsEvents(c)])).toBe(JSON.stringify(lsEvents(a)));
    c.t.close();
  });

  it("AI 思考中關掉或重開：舊的計時器不會再動作，也不會把舊的一場送進新的一場", async () => {
    const h = harness({ seed: 31, first: "ai" }, new MemKV(), true, 40);   // AI 先宣戰：開局就輪到 AI
    await start(h);
    expect(h.t.pendingAi).toBe(true);
    h.t.close();
    const n = h.msgs.length;
    await new Promise(r => setTimeout(r, 150));
    expect(h.msgs.length).toBe(n);
    expect(h.t.pendingAi).toBe(false);

    const g = harness({ seed: 32, first: "ai" }, new MemKV(), true, 40);
    await start(g);
    expect(g.t.pendingAi).toBe(true);
    const oldGid = g.t.s.gid;
    g.t.restart();
    const mark = g.msgs.length;
    await new Promise(r => setTimeout(r, 300));
    const after = g.msgs.slice(mark).filter(m => m.t === "lsEvent" || m.t === "lsState") as { gid?: string }[];
    expect(after.length).toBeGreaterThan(0);
    expect(g.t.s.gid).not.toBe(oldGid);
    expect(after.every(m => m.gid === g.t.s.gid)).toBe(true);
    expect(g.t.s.illegal).toBe(0);
    g.t.close();
  });

  it("「立即跳過等待」只是把排好的那一步提前，照規則走；換速度不會打亂順序", async () => {
    const h = harness({ seed: 55, first: "ai", speed: "normal" }, new MemKV(), true, 10_000);
    await start(h);
    expect(h.t.pendingAi).toBe(true);
    const before = h.view!;
    h.t.skipWait();
    for (let i = 0; i < 5; i++) await tick();
    expect(h.view).not.toBe(before);
    expect(h.t.s.illegal).toBe(0);
    h.t.setSpeed("fast");
    h.t.close();
  });

  it("不合法的指令：照引擎拒絕、說原因，牌桌不變；不支援的指令（換模式）也拒絕", async () => {
    const h = harness({ seed: 8, first: "me" });
    await start(h);
    const ver = h.t.s.ver;
    let r = await send(h, { t: "ls", a: { t: "raise", to: 999 } });
    expect(r.ok).toBe(false);
    expect(h.t.s.ver).toBe(ver);
    r = await send(h, { t: "ls", a: { t: "lock", card: h.t.game!.s.hands[1][0] } });
    expect(r.ok).toBe(false);
    r = await send(h, { t: "mode", mode: "classic" });
    expect(r.ok).toBe(false);
    r = await send(h, { t: "stake", stake: "<b>", vow: "" });
    expect(r.ok).toBe(false);
    h.t.close();
  });

  it("只用自己的存檔鍵；結算後再來一場會交換第 1 墩宣戰權、本機戰績累計", async () => {
    const kv = new MemKV();
    kv.setItem("hb-solo-v1", "classic");
    const h = harness({ seed: 99, first: "me" }, kv);
    await start(h);
    await playOut(h, picker("aggressive", 1));
    expect(kv.getItem("hb-solo-v1")).toBe("classic");
    expect([...kv.m.keys()].sort()).toEqual(["hb-laststand-ai-v1", "hb-solo-v1"]);
    expect(h.room!.stats.played).toBe(1);
    const n = h.msgs.length;
    expect((await send(h, { t: "rematch", ready: true })).ok).toBe(true);
    for (let i = 0; i < 5; i++) await tick();
    const ms = h.msgs.slice(n).find(m => m.t === "lsEvent" && (m.e as LSEvent).type === "MatchStart") as { e: LSEvent };
    expect(ms.e.declarer).toBe(1);
    await playOut(h, picker("aggressive", 2));
    expect(h.room!.stats.played).toBe(2);
    h.t.close();
  });
});
