// 房間狀態機（C1）、同桌戰績與精彩回顧（C4）：純函式測試
import { describe, expect, it } from "vitest";
import {
  RoomMeta, deadlines, finishMatch, forfeit, inMatch, join, leave, markOffline, markOnline, newRoom, setMode, setReady, setRematch, startMatch,
} from "../src/server/lobby";
import { MODES, TIMING, isValidCode, CODE_ALPHABET } from "../src/server/protocol";
import { LoggedEvent, RecordRow, highlights, isPublic, pairStats } from "../src/server/records";
import { HoneymoonGame, Phase } from "../src/game/game";
import { seededRng } from "../src/game/cards";
import { chooseCall, chooseCard } from "../src/game/ai";

const T0 = 1_000_000;
const fresh = (n: number) => ({ tokenHash: `h${n}`, pid: `p${n}` });

// 兩人入座的房間
function twoSeated(): RoomMeta {
  const m = newRoom("ABCDEF", T0);
  join(m, null, fresh(1), "阿明", T0);
  join(m, null, fresh(2), "小美", T0);
  return m;
}
function playing(): RoomMeta {
  const m = twoSeated();
  setReady(m, 0, true);
  setReady(m, 1, true);
  startMatch(m, "g1");
  return m;
}

describe("C1 房間：建立、加入、座位", () => {
  it("新房間是 WAITING、經典模式；第一個人坐 0 號而且是房主；第二個人來了變 READY", () => {
    const m = newRoom("ABCDEF", T0);
    expect(m.status).toBe("WAITING");
    expect(m.mode).toBe("classic");
    const a = join(m, null, fresh(1), "阿明", T0);
    expect(a).toEqual({ ok: true, value: { seat: 0, isNew: true } });
    expect(m.host).toBe(0);
    expect(m.status).toBe("WAITING");
    const b = join(m, null, fresh(2), "", T0);
    expect(b).toEqual({ ok: true, value: { seat: 1, isNew: true } });
    expect(m.seats[1]!.name).toBe("朋友");          // 沒填暱稱：給預設名
    expect(m.status).toBe("READY");
  });

  it("第三個人擠不進來；拿著憑證回來的人回原座位（不會變成新的人）", () => {
    const m = twoSeated();
    expect(join(m, null, fresh(3), "路人", T0)).toEqual({ ok: false, code: "FULL" });
    expect(join(m, "h-假的", fresh(4), "路人", T0)).toEqual({ ok: false, code: "FULL" });
    const back = join(m, "h2", fresh(5), "小美2", T0);
    expect(back).toEqual({ ok: true, value: { seat: 1, isNew: false } });
    expect(m.seats[1]!.pid).toBe("p2");              // 還是同一個人
    expect(m.seats[1]!.name).toBe("小美2");
  });

  it("暱稱不是身分：跟房主取一樣的名字也只會拿到空位，拿不到房主的座位", () => {
    const m = newRoom("ABCDEF", T0);
    join(m, null, fresh(1), "阿明", T0);
    const r = join(m, null, fresh(2), "阿明", T0);
    expect(r.ok && r.value.seat).toBe(1);
    expect(m.seats[0]!.tokenHash).toBe("h1");
  });

  it("開打之後陌生人不能入座（就算有人離開了座位也一樣）；拿憑證的本人可以回來", () => {
    const m = playing();
    expect(join(m, null, fresh(3), "路人", T0)).toEqual({ ok: false, code: "FULL" });
    expect(join(m, "h1", fresh(4), "", T0)).toEqual({ ok: true, value: { seat: 0, isNew: false } });
    finishMatch(m, 0, "target");
    expect(m.status).toBe("SETTLEMENT");
    expect(join(m, null, fresh(5), "路人", T0)).toEqual({ ok: false, code: "FULL" });
  });

  it("關掉的房間誰都進不來（包括原本的人）", () => {
    const m = twoSeated();
    leave(m, 0); leave(m, 1);
    expect(m.status).toBe("CLOSED");
    expect(join(m, "h1", fresh(6), "", T0)).toEqual({ ok: false, code: "CLOSED" });
    expect(join(m, null, fresh(7), "", T0)).toEqual({ ok: false, code: "CLOSED" });
  });

  it("房號：6 碼、只用不容易看錯的字；舊的 4 碼還能進；其他長度、0/O/1/I/L 都不行", () => {
    expect(isValidCode("ABCDEF")).toBe(true);
    expect(isValidCode("ABCD")).toBe(true);
    expect(isValidCode("ABCDE")).toBe(false);
    expect(isValidCode("ABCDEFG")).toBe(false);
    for (const bad of "01OIL") expect(isValidCode(`ABCDE${bad}`)).toBe(false);
    expect(CODE_ALPHABET.length ** 6).toBeGreaterThan(800_000_000);
  });
});

describe("C1 房間：準備、模式、房主", () => {
  it("只有兩人入座才能準備；兩個人都準備才開局；可以取消準備", () => {
    const m = newRoom("ABCDEF", T0);
    join(m, null, fresh(1), "阿明", T0);
    expect(setReady(m, 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
    join(m, null, fresh(2), "小美", T0);
    expect(setReady(m, 0, true)).toEqual({ ok: true, value: { start: false } });
    expect(setReady(m, 0, false)).toEqual({ ok: true, value: { start: false } });
    expect(setReady(m, 0, true)).toEqual({ ok: true, value: { start: false } });
    expect(setReady(m, 1, true)).toEqual({ ok: true, value: { start: true } });
  });

  it("不在座位上的人不能按準備、不能換模式", () => {
    const m = newRoom("ABCDEF", T0);
    join(m, null, fresh(1), "阿明", T0);
    expect(setReady(m, 1, true)).toMatchObject({ ok: false, code: "NOT_SEATED" });
    expect(setMode(m, 1, "classic")).toMatchObject({ ok: false, code: "NOT_SEATED" });
  });

  it("有人新進來：大家的準備都要重新確認", () => {
    const m = twoSeated();
    setReady(m, 0, true);
    leave(m, 1);
    expect(m.seats[0]!.ready).toBe(false);
    join(m, null, fresh(3), "小華", T0);
    expect(m.seats[0]!.ready).toBe(false);
    expect(m.status).toBe("READY");
  });

  it("只有房主能換模式；籌碼對決還沒開放會被拒絕（不會用假籌碼冒充）", () => {
    const m = twoSeated();
    expect(setMode(m, 1, "classic")).toMatchObject({ ok: false, code: "NOT_HOST" });
    expect(setMode(m, 0, "chips")).toMatchObject({ ok: false, code: "MODE_UNAVAILABLE" });
    expect(m.mode).toBe("classic");
    expect(setMode(m, 0, "classic")).toEqual({ ok: true, value: { changed: false } });
    expect(setMode(m, 0, "nope" as never)).toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("換了模式雙方都要重新準備；開打之後模式鎖定", () => {
    const m = twoSeated();
    const was = MODES.chips.enabled;
    MODES.chips.enabled = true;                         // 假設以後開放了：換模式的流程要對
    try {
      setReady(m, 0, true); setReady(m, 1, false);
      expect(setMode(m, 0, "chips")).toEqual({ ok: true, value: { changed: true } });
      expect(m.seats.every(s => !s!.ready)).toBe(true);
      setReady(m, 0, true); setReady(m, 1, true);
      startMatch(m, "g1");
      expect(setMode(m, 0, "classic")).toMatchObject({ ok: false, code: "MODE_LOCKED" });
    } finally { MODES.chips.enabled = was; }
  });

  it("房主離開：剩下的人變房主、狀態回 WAITING；兩個都走了就關房", () => {
    const m = twoSeated();
    expect(leave(m, 0)).toEqual({ ok: true, value: undefined });
    expect(m.host).toBe(1);
    expect(m.status).toBe("WAITING");
    expect(leave(m, 0)).toMatchObject({ ok: false, code: "NOT_SEATED" });   // 重複按離開
    leave(m, 1);
    expect(m.status).toBe("CLOSED");
  });

  it("開局前斷線：準備自動取消，斷線中不能按準備；回來之後可以", () => {
    const m = twoSeated();
    setReady(m, 0, true);
    markOffline(m, 0, T0);
    expect(m.seats[0]!.ready).toBe(false);
    expect(setReady(m, 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
    markOnline(m, 0);
    expect(setReady(m, 0, true)).toEqual({ ok: true, value: { start: false } });
  });
});

describe("C1 房間：對局、結算、再來一場", () => {
  it("開局：IN_GAME、準備勾清掉；對局中不能用一般離開（要認輸離開）", () => {
    const m = playing();
    expect(m.status).toBe("IN_GAME");
    expect(m.gid).toBe("g1");
    expect(m.seats.every(s => !s!.ready)).toBe(true);
    expect(leave(m, 0)).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(setReady(m, 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });

  it("對局中斷線 → PAUSED；回來 → IN_GAME", () => {
    const m = playing();
    expect(markOffline(m, 1, T0)).toBe(true);
    expect(m.status).toBe("PAUSED");
    expect(markOffline(m, 1, T0 + 5)).toBe(false);     // 已經算斷線：不重算時間
    expect(m.seats[1]!.offlineSince).toBe(T0);
    markOffline(m, 0, T0 + 10);
    markOnline(m, 1);
    expect(m.status).toBe("PAUSED");                   // 還有一個人沒回來
    markOnline(m, 0);
    expect(m.status).toBe("IN_GAME");
  });

  it("認輸離開判自己負，只算一次（重複送、逾時再判都不會改結果）", () => {
    const m = playing();
    expect(forfeit(m, 1, "forfeit")).toEqual({ ok: true, value: { winner: 0 } });
    expect(m.status).toBe("SETTLEMENT");
    expect(m.result).toEqual({ winner: 0, reason: "forfeit" });
    expect(forfeit(m, 1, "forfeit")).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(forfeit(m, 0, "timeout")).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(finishMatch(m, 1, "target")).toBe(false);
    expect(m.result).toEqual({ winner: 0, reason: "forfeit" });
  });

  it("再來一場：兩個人都按才開；可以收回；對方走了就不能按", () => {
    const m = playing();
    finishMatch(m, 0, "target");
    expect(setRematch(m, 0, true)).toEqual({ ok: true, value: { start: false } });
    expect(m.status).toBe("REMATCH");
    expect(setRematch(m, 0, false)).toEqual({ ok: true, value: { start: false } });
    expect(m.status).toBe("SETTLEMENT");
    setRematch(m, 0, true);
    expect(setRematch(m, 1, true)).toEqual({ ok: true, value: { start: true } });
    startMatch(m, "g2");
    expect(m.status).toBe("IN_GAME");
    expect(m.result).toBeNull();
    expect(m.seats.every(s => !s!.rematch)).toBe(true);

    const n = playing();
    finishMatch(n, 1, "target");
    leave(n, 1);
    expect(n.status).toBe("WAITING");
    expect(setRematch(n, 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });

  it("還沒結束不能按再來一場", () => {
    expect(setRematch(playing(), 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(setRematch(twoSeated(), 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });

  it("有人斷線時開局：直接是 PAUSED", () => {
    const m = twoSeated();
    m.seats[1]!.offlineSince = T0;
    startMatch(m, "g1");
    expect(m.status).toBe("PAUSED");
    expect(inMatch(m)).toBe(true);
  });
});

describe("C4 時間軸：中離、讓座、過期（只排一個鬧鐘）", () => {
  const t = { ...TIMING };
  it("對局中一方斷線、另一方在線：斷線時間＋10 分鐘判中離", () => {
    const m = playing();
    markOffline(m, 1, T0);
    const d = deadlines(m, t, false);
    expect(d.forfeitAt).toBe(T0 + t.forfeit);
    expect(d.forfeitSeat).toBe(1);
    expect(d.releaseAt).toBeNull();
  });

  it("兩邊都斷線：誰都不判（等人回來）", () => {
    const m = playing();
    markOffline(m, 0, T0); markOffline(m, 1, T0);
    expect(deadlines(m, t, false).forfeitAt).toBeNull();
  });

  it("開局前斷線：10 分鐘後讓出座位，不判中離", () => {
    const m = twoSeated();
    markOffline(m, 1, T0);
    const d = deadlines(m, t, false);
    expect(d.forfeitAt).toBeNull();
    expect(d.releaseAt).toBe(T0 + t.seatHold);
    expect(d.releaseSeat).toBe(1);
  });

  it("過期：牌局 24 小時、只剩戰績的房 7 天", () => {
    const m = playing();
    m.lastActive = T0;
    expect(deadlines(m, t, true).expireAt).toBe(T0 + t.resumeKeep);
    finishMatch(m, 0, "target");
    expect(deadlines(m, t, true).expireAt).toBe(T0 + t.recordKeep);
    expect(deadlines(m, t, false).expireAt).toBe(T0 + t.resumeKeep);
  });

  it("時間軸集中在一個地方：30 秒提示、2 分鐘可以選、10 分鐘判中離", () => {
    expect([TIMING.notice, TIMING.choice, TIMING.forfeit]).toEqual([30_000, 120_000, 600_000]);
  });
});

describe("C4 同桌戰績", () => {
  const row = (gid: string, at: number, winner: number, pids: [string, string] = ["a", "b"]): RecordRow =>
    ({ gid, at, winner, reason: "target", scores: [100, 40], hands: 3, pids });
  it("只算現在這兩個人：勝場、目前連勝、最近 5 場（新的在前）", () => {
    const rows = [row("1", 1, 0), row("2", 2, 1), row("3", 3, 1), row("x", 4, 0, ["a", "c"]), row("4", 5, 1)];
    const s = pairStats(rows, ["a", "b"]);
    expect(s.played).toBe(4);
    expect(s.wins).toEqual([1, 3]);
    expect(s.draws).toBe(0);
    expect(s.streak).toEqual({ seat: 1, n: 3 });
    expect(s.last.map(r => r.gid)).toEqual(["4", "3", "2", "1"]);
    expect((s.last[0] as unknown as { pids?: unknown }).pids).toBeUndefined();   // 不送別人的編號
  });
  it("座位上的人換了就是另一組，從 0 開始", () => {
    const s = pairStats([row("1", 1, 0)], ["a", "z"]);
    expect(s).toEqual({ played: 0, wins: [0, 0], draws: 0, streak: null, last: [] });
  });
});

// 跑一整場，記下所有事件（含私人的），用來測回顧不洩漏
function simulateMatch(seed: number): LoggedEvent[] {
  const g = new HoneymoonGame(seededRng(seed));
  const log: LoggedEvent[] = [];
  let eid = 0;
  g.on((e, to) => log.push({ eid: ++eid, to, e }));
  g.startNewMatch();
  for (let i = 0; i < 20000 && g.matchWinner < 0; i++) {
    if (g.trickComplete) g.resolveTrick();
    else if (g.phase === Phase.Finished) g.startNew();
    else if (g.phase === Phase.Bidding) g.makeCall(g.currentPlayer, chooseCall(g, g.currentPlayer));
    else g.playCard(g.currentPlayer, chooseCard(g, g.currentPlayer));
  }
  expect(g.matchWinner).toBeGreaterThanOrEqual(0);
  return log;
}

describe("C4 精彩回顧：只用公開事件", () => {
  it("私人事件（摸到的暗牌）不算公開", () => {
    expect(isPublic({ eid: 1, to: 0, e: { type: "CardDrawn", seat: 0, card: 5, value: 0, extra: 0 } })).toBe(false);
    expect(isPublic({ eid: 1, to: -1, e: { type: "CardDrawn", seat: 0, card: -1, value: 0, extra: 0 } })).toBe(false);
    expect(isPublic({ eid: 1, to: -1, e: { type: "CardPlayed", seat: 0, card: 5, value: 0, extra: 0 } })).toBe(true);
  });

  it("回顧裡出現的每一張牌，都是兩邊都看過的（打出來的牌或翻開的明牌），不會出現暗牌", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const log = simulateMatch(seed);
      const seen = new Set<number>();
      for (const x of log) if (x.to < 0 && (x.e.type === "CardPlayed" || x.e.type === "FaceUpTaken")) seen.add(x.e.card);
      const privateOnly = new Set(log.filter(x => x.to >= 0 && x.e.type === "CardDrawn").map(x => x.e.card).filter(c => !seen.has(c)));
      const items = highlights(log, ["阿明", "小美"]);
      expect(items.length).toBeGreaterThan(0);
      for (const h of items) {
        for (const c of h.cards ?? []) { expect(seen.has(c)).toBe(true); expect(privateOnly.has(c)).toBe(false); }
        expect(h.hand).toBeGreaterThan(0);
        expect(h.text).toMatch(/第 \d+ 局/);
      }
      expect(items.some(h => h.kind === "matchPoint")).toBe(true);
      expect(items.some(h => h.kind === "bigHand")).toBe(true);
    }
  });

  it("把私人事件拿掉，回顧完全一樣（證明回顧根本不看私人資料）", () => {
    for (let seed = 30; seed <= 40; seed++) {
      const log = simulateMatch(seed);
      expect(highlights(log.filter(isPublic), ["甲", "乙"])).toEqual(highlights(log, ["甲", "乙"]));
    }
  });
});
