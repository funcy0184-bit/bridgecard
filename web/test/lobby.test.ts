// 房間狀態機（C1）、同桌戰績與精彩回顧（C4）：純函式測試
import { describe, expect, it } from "vitest";
import {
  RoomMeta, canSeatNew, deadlines, finishMatch, forfeit, inMatch, join, leave, markOffline, markOnline, newRoom, setMode, setName, setReady, setRematch, setStake, startMatch,
} from "../src/server/lobby";
import { DEFAULT_STAKE, MODES, NAME_MAX, STAKE_MAX, TIMING, checkName, checkStake, isValidCode, nameLength, CODE_ALPHABET } from "../src/server/protocol";
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

  it("第三個人擠不進來；拿著憑證回來的人回原座位、原本的暱稱（不會變成新的人，也不會被這次的名字蓋掉）", () => {
    const m = twoSeated();
    expect(join(m, null, fresh(3), "路人", T0)).toEqual({ ok: false, code: "FULL" });
    expect(join(m, "h-假的", fresh(4), "路人", T0)).toEqual({ ok: false, code: "FULL" });
    const back = join(m, "h2", fresh(5), "別的名字", T0);
    expect(back).toEqual({ ok: true, value: { seat: 1, isNew: false } });
    expect(m.seats[1]!.pid).toBe("p2");              // 還是同一個人
    expect(m.seats[1]!.name).toBe("小美");            // 重新整理不會改名
    expect(m.seats.filter(Boolean).length).toBe(2);   // 沒有多出第三個玩家
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

  it("只有房主能換模式；沒開放的模式會被拒絕；不存在的模式也拒絕（舊的「籌碼對決」已經換成逆命賭局）", () => {
    const m = twoSeated();
    expect(setMode(m, 1, "classic")).toMatchObject({ ok: false, code: "NOT_HOST" });
    expect(setMode(m, 0, "chips" as never)).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    const was = MODES.laststand.enabled;
    MODES.laststand.enabled = false;                    // 假設暫時關掉：要回「還沒開放」
    try { expect(setMode(m, 0, "laststand")).toMatchObject({ ok: false, code: "MODE_UNAVAILABLE" }); }
    finally { MODES.laststand.enabled = was; }
    expect(m.mode).toBe("classic");
    expect(setMode(m, 0, "classic")).toEqual({ ok: true, value: { changed: false } });
    expect(setMode(m, 0, "nope" as never)).toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("換了模式雙方都要重新準備；開打之後模式鎖定", () => {
    const m = twoSeated();
    setReady(m, 0, true); setReady(m, 1, false);
    expect(setMode(m, 0, "laststand")).toEqual({ ok: true, value: { changed: true } });
    expect(m.seats.every(s => !s!.ready)).toBe(true);
    setStake(m, 0, "阿嬤的藍白拖"); setStake(m, 1, "我最後的尊嚴");
    setReady(m, 0, true); setReady(m, 1, true);
    startMatch(m, "g1");
    expect(setMode(m, 0, "classic")).toMatchObject({ ok: false, code: "MODE_LOCKED" });
  });

  it("逆命賭局：沒在契約書蓋章不能按準備；蓋了章可以改，按了準備或開打後鎖定；只能改自己的", () => {
    const m = twoSeated();
    setMode(m, 0, "laststand");
    expect(setReady(m, 0, true)).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(setStake(m, 0, "阿嬤的藍白拖")).toEqual({ ok: true, value: { changed: true } });
    expect(m.seats[1]!.stake).toBeUndefined();
    expect(setStake(m, 0, "影印機最後一張紙")).toEqual({ ok: true, value: { changed: true } });
    expect(setReady(m, 0, true)).toEqual({ ok: true, value: { start: false } });
    expect(setStake(m, 0, "又改")).toMatchObject({ ok: false, code: "BAD_STATE" });
    setReady(m, 0, false);
    expect(setStake(m, 0, "又改")).toMatchObject({ ok: true });
    expect(setStake(m, 2, "x")).toMatchObject({ ok: false, code: "NOT_SEATED" });
    // 經典牌局不用契約
    const c = twoSeated();
    expect(setReady(c, 0, true)).toEqual({ ok: true, value: { start: false } });
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
    markOnline(m, 0, T0);
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
    markOnline(m, 1, T0 + 20);
    expect(m.status).toBe("PAUSED");                   // 還有一個人沒回來
    markOnline(m, 0, T0 + 30);
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

  it("兩邊都斷線、一個人 15 分鐘後回來：另一個人從「他回來」才開始算 10 分鐘，不會一回來就判", () => {
    const m = playing();
    markOffline(m, 0, T0); markOffline(m, 1, T0);
    markOnline(m, 0, T0 + 15 * 60_000);
    const d = deadlines(m, t, false);
    expect(d.forfeitSeat).toBe(1);
    expect(d.forfeitAt).toBe(T0 + 15 * 60_000 + t.forfeit);
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

describe("C1 暱稱：規則", () => {
  const ok = (raw: string) => { const r = checkName(raw); if (!r.ok) throw new Error(r.msg); return r.name; };
  const bad = (raw: unknown) => { const r = checkName(raw); expect(r.ok).toBe(false); return r.ok ? "" : r.code; };
  it("繁體中文、英文、數字、一般符號、表情符號都可以；頭尾空白去掉、中間連續空白變一個", () => {
    expect(ok("  阿明  ")).toBe("阿明");
    expect(ok("Ming 小 明")).toBe("Ming 小 明");
    expect(ok("小美   Lin")).toBe("小美 Lin");
    expect(ok("Player_2.0")).toBe("Player_2.0");
    expect(ok("阿明♠️")).toBe("阿明♠️");
    expect(ok("橋牌王👑")).toBe("橋牌王👑");
    expect(ok("O'Neil-陳")).toBe("O'Neil-陳");
  });
  it("空白、只有空白、不是文字：不接受", () => {
    expect(bad("")).toBe("EMPTY");
    expect(bad("   ")).toBe("EMPTY");
    expect(bad("\u3000\t\n")).toBe("EMPTY");
    expect(bad(undefined)).toBe("EMPTY");
    expect(bad(123)).toBe("EMPTY");
  });
  it(`最多 ${NAME_MAX} 個字（中文一個字、一個 emoji 組合都算 1）；超過要提示縮短，不偷偷截斷`, () => {
    expect(ok("一".repeat(16))).toBe("一".repeat(16));
    expect(bad("一".repeat(17))).toBe("TOO_LONG");
    expect(ok("a".repeat(16))).toHaveLength(16);
    expect(bad("a".repeat(17))).toBe("TOO_LONG");
    expect(nameLength("👨‍👩‍👧‍👦")).toBe(1);                  // 家庭 emoji（好幾個碼點）算一個字
    expect(ok("小美👨‍👩‍👧‍👦🎉")).toBeTruthy();
    expect(nameLength("小美👨‍👩‍👧‍👦🎉")).toBe(4);
    // 防「亂碼字」：一個字疊上幾百個附加符號會把版面弄壞，所以另外限制總碼點數
    expect(bad("a" + "\u0301".repeat(60))).toBe("TOO_LONG");
    const r = checkName("一".repeat(20));
    expect(!r.ok && r.msg).toContain("縮短");
  });
  it("HTML／程式碼的符號不接受；看不見的控制字元直接拿掉", () => {
    expect(bad("<script>")).toBe("BAD_CHARS");
    expect(bad("阿明<b>")).toBe("BAD_CHARS");
    expect(bad('a"b')).toBe("BAD_CHARS");
    expect(bad("a`b")).toBe("BAD_CHARS");
    expect(bad("a{b}")).toBe("BAD_CHARS");
    expect(ok("阿\u200B明")).toBe("阿明");                    // 零寬空白
    expect(ok("\u202E阿明")).toBe("阿明");                     // 文字方向控制
    expect(ok("阿\u0000明")).toBe("阿 明");                    // 控制字元變空白
  });
});

describe("C1 暱稱：修改、鎖定", () => {
  it("還沒按準備可以改自己的；按了準備要先取消；對局開始到這場結束都鎖定", () => {
    const m = twoSeated();
    expect(setName(m, 0, "阿明明")).toEqual({ ok: true, value: { changed: true } });
    expect(m.seats[0]!.name).toBe("阿明明");
    expect(m.seats[1]!.name).toBe("小美");                     // 只改到自己的
    expect(setName(m, 0, "阿明明")).toEqual({ ok: true, value: { changed: false } });
    setReady(m, 0, true);
    expect(setName(m, 0, "又改")).toMatchObject({ ok: false, code: "NAME_LOCKED" });
    setReady(m, 0, false);
    expect(setName(m, 0, "又改")).toMatchObject({ ok: true });
    setReady(m, 0, true); setReady(m, 1, true); startMatch(m, "g1");
    expect(setName(m, 1, "小美美")).toMatchObject({ ok: false, code: "NAME_LOCKED" });
    finishMatch(m, 0, "target");
    expect(setName(m, 1, "小美美")).toMatchObject({ ok: false, code: "NAME_LOCKED" });
    expect(setName(m, 1, "小美美")).toMatchObject({ ok: false });
  });
  it("不在座位上不能改；兩人同名也可以（用房主／訪客分辨，身分看憑證）", () => {
    const m = newRoom("ABCDEF", T0);
    join(m, null, fresh(1), "小明", T0);
    expect(setName(m, 1, "x")).toMatchObject({ ok: false, code: "NOT_SEATED" });
    join(m, null, fresh(2), "小明", T0);
    expect(m.seats.map(s => s!.name)).toEqual(["小明", "小明"]);
    expect(m.seats[0]!.tokenHash).not.toBe(m.seats[1]!.tokenHash);
  });
  it("只有開局前、還有空位時才需要檢查新來的人的暱稱", () => {
    const m = newRoom("ABCDEF", T0);
    expect(canSeatNew(m)).toBe(true);
    join(m, null, fresh(1), "甲", T0);
    expect(canSeatNew(m)).toBe(true);
    join(m, null, fresh(2), "乙", T0);
    expect(canSeatNew(m)).toBe(false);
  });
});

describe("逆命賭局：賭上之物（純遊戲敘事）", () => {
  const ok = (raw: unknown) => { const r = checkStake(raw); if (!r.ok) throw new Error(r.msg); return r.stake; };
  const bad = (raw: unknown) => { const r = checkStake(raw); expect(r.ok).toBe(false); return r.ok ? "" : r.msg; };
  it("空白 → 我最後的尊嚴；去頭尾空白；中英文、數字、常見標點都可以", () => {
    expect(ok("")).toBe(DEFAULT_STAKE);
    expect(ok("   ")).toBe("我最後的尊嚴");
    expect(ok("  阿嬤的藍白拖 ")).toBe("阿嬤的藍白拖");
    expect(ok("下週便當的決定權！")).toBe("下週便當的決定權！");
    expect(ok("一隻沒有穿褲子的皮卡丘（限量版）")).toBeTruthy();
    expect(ok("星期三的早餐資格, 2 份")).toBeTruthy();
  });
  it(`最多 ${STAKE_MAX} 個字；不能放網址、email、電話號碼、HTML／程式碼符號`, () => {
    expect(ok("一".repeat(24))).toHaveLength(24);
    expect(bad("一".repeat(25))).toContain("縮短");
    expect(bad("https://x.com")).toContain("網址");
    expect(bad("看 www.example.tw")).toContain("網址");
    expect(bad("寄到 a.b@mail.com")).toContain("email");
    expect(bad("打 0912-345-678")).toContain("電話");
    expect(bad("<script>")).toContain("「<」");
    expect(bad("a{b}")).toContain("「{」");
  });
});

describe("同桌戰績：逆命賭局可能平手、依模式分開算", () => {
  it("平手算進 draws、打斷連勝；只算目前模式", async () => {
    const { pairStats } = await import("../src/server/records");
    const row = (gid: string, at: number, winner: number, mode: "classic" | "laststand") => ({ gid, at, winner, reason: "nine" as const, scores: [15, 15] as [number, number], hands: 9, pids: ["a", "b"] as [string, string], mode });
    const rows = [row("1", 1, 0, "laststand"), row("2", 2, 0, "laststand"), row("3", 3, -1, "laststand"), row("4", 4, 1, "classic")];
    const s = pairStats(rows, ["a", "b"], "laststand");
    expect(s).toMatchObject({ played: 3, wins: [2, 0], draws: 1, streak: null });
    expect(pairStats(rows, ["a", "b"], "classic")).toMatchObject({ played: 1, wins: [0, 1] });
  });
});
