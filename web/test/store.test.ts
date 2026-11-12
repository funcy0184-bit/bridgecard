// C4 保存：SQLite 結構升級、舊房間搬遷、交易（全成功或全不寫）、指令去重、戰績不重複
// 用 Node 內建的 SQLite 做一個跟 Durable Object 一樣介面的假儲存（sql.exec、transactionSync、get／put／delete）
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { RoomStore, SCHEMA_VERSION, sha256 } from "../src/server/store";
import { newRoom, join } from "../src/server/lobby";
import { HoneymoonGame } from "../src/game/game";
import { seededRng } from "../src/game/cards";

function fakeStorage() {
  const db = new DatabaseSync(":memory:");
  const kv = new Map<string, unknown>();
  const storage = {
    sql: {
      exec(q: string, ...b: (string | number | null)[]) {
        const st = db.prepare(q);
        const rows = /^\s*select/i.test(q) ? st.all(...b) : (st.run(...b), []);
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    async get<T>(k: string) { return kv.get(k) as T | undefined; },
    async put(k: string, v: unknown) { kv.set(k, v); },
    async delete(k: string) { return kv.delete(k); },
    async deleteAll() {
      kv.clear();
      for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) db.exec(`DROP TABLE ${r.name}`);
    },
  };
  return { storage, db, kv };
}
const asStorage = (s: ReturnType<typeof fakeStorage>["storage"]) => s as unknown as DurableObjectStorage;
const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe("C4 保存：結構與升級", () => {
  it("新房間：建好所有表、記下結構版本；升級跑兩次也不會出事", async () => {
    const { storage, db } = fakeStorage();
    const s = new RoomStore(asStorage(storage));
    await s.migrate();
    await s.migrate();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(r => r.name);
    expect(tables).toEqual(["commands", "events", "game", "matches", "meta"]);
    expect((db.prepare("SELECT v FROM meta WHERE k = 'schema'").get() as { v: string }).v).toBe(String(SCHEMA_VERSION));
    expect(SCHEMA_VERSION).toBe(3);
    // 第 3 版：牌局快照記遊戲種類；戰績記模式和第 1 墩宣戰權
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name);
    expect(cols("game")).toContain("kind");
    expect(cols("matches")).toEqual(expect.arrayContaining(["mode", "coin"]));
    expect(s.loadMeta()).toBeNull();
    expect(s.loadSnapshot()).toBeNull();
  });

  it("舊版（整包 JSON）進行中的房間：搬進新結構，憑證只存雜湊、牌局一模一樣、舊資料刪掉", async () => {
    const { storage, kv } = fakeStorage();
    const g = new HoneymoonGame(seededRng(7));
    g.startNewMatch();
    const snap = g.snapshot();
    kv.set("room", { code: "AB2C", createdAt: 100, lastActive: 200, seats: [{ token: "tok-host", name: "阿明" }, { token: "tok-guest", name: "小美" }], game: snap });
    const s = new RoomStore(asStorage(storage));
    await s.migrate();
    const m = s.loadMeta()!;
    expect(m.code).toBe("AB2C");
    expect(m.status).toBe("IN_GAME");
    expect(m.seats[0]!.tokenHash).toBe(await sha256("tok-host"));
    expect(JSON.stringify(m)).not.toContain("tok-host");
    expect(m.seats[1]!.name).toBe("小美");
    expect(m.seats[0]!.pid).not.toBe(m.seats[1]!.pid);
    expect(m.gid).toBeTruthy();
    expect(s.loadSnapshot()).toEqual(snap);
    expect(kv.has("room")).toBe(false);
    // 再開一次（房間重開機）：不會再搬一次、資料不變
    await s.migrate();
    expect(s.loadMeta()).toEqual(m);
  });

  it("舊版只有一個人在等的房間 → WAITING；兩個人坐好還沒打 → READY", async () => {
    for (const [seats, want] of [[[{ token: "a", name: "甲" }, null], "WAITING"], [[{ token: "a", name: "甲" }, { token: "b", name: "乙" }], "READY"]] as const) {
      const { storage, kv } = fakeStorage();
      kv.set("room", { code: "XY23", createdAt: 1, lastActive: 2, seats, game: null });
      const s = new RoomStore(asStorage(storage));
      await s.migrate();
      expect(s.loadMeta()!.status).toBe(want);
      expect(s.loadMeta()!.gid).toBeNull();
    }
  });
});

describe("C4 保存：交易", () => {
  async function ready() {
    const f = fakeStorage();
    const s = new RoomStore(asStorage(f.storage));
    await s.migrate();
    const m = newRoom("ABCDEF", 1);
    join(m, null, { tokenHash: "h1", pid: "p1" }, "阿明", 1);
    m.gid = "g1";
    return { ...f, s, m };
  }
  const ev = (eid: number) => ({ eid, to: -1, e: { type: "CardPlayed" as const, seat: 0, card: eid, value: 0, extra: 0 } });

  it("一次寫完：房間狀態、牌局快照、事件、指令紀錄、戰績都在", async () => {
    const { s, m, db } = await ready();
    const g = new HoneymoonGame(seededRng(1)); g.startNewMatch();
    m.ver = 1; m.eid = 2;
    s.commit({ meta: m, snapshot: g.snapshot(), events: [ev(1), ev(2)], command: { cid: "c1", seat: 0, ok: true },
      record: { gid: "g1", at: 5, winner: 0, reason: "target", scores: [100, 20], hands: 4, pids: ["p1", "p2"] } });
    expect(s.loadMeta()!.ver).toBe(1);
    expect(s.loadSnapshot()).toEqual(g.snapshot());
    expect(s.events("g1").map(x => x.eid)).toEqual([1, 2]);
    expect(s.command("c1")).toEqual({ ok: true, code: "", msg: "", ver: 1 });
    expect(count(db, "matches")).toBe(1);
  });

  it("中間任何一步失敗：整筆都不寫（房間狀態、指令紀錄、戰績都還是舊的）", async () => {
    const { s, m, db } = await ready();
    m.ver = 1; m.eid = 1;
    s.commit({ meta: m, events: [ev(1)] });
    const before = s.loadMeta();
    const bad = { ...m, ver: 2, eid: 2 };
    expect(() => s.commit({ meta: bad, events: [ev(2), ev(1)], command: { cid: "c2", seat: 0, ok: true },     // 事件 1 重複 → 失敗
      record: { gid: "g1", at: 5, winner: 0, reason: "target", scores: [1, 0], hands: 1, pids: ["p1", "p2"] } })).toThrow();
    expect(s.loadMeta()).toEqual(before);
    expect(s.events("g1").map(x => x.eid)).toEqual([1]);
    expect(s.command("c2")).toBeNull();
    expect(count(db, "matches")).toBe(0);
  });

  it("同一個指令編號只記第一次的結果；同一場只記一筆戰績", async () => {
    const { s, m, db } = await ready();
    s.commit({ meta: m, command: { cid: "c1", seat: 0, ok: false, code: "NOT_HOST", msg: "只有房主可以換模式。" } });
    s.commit({ meta: m, command: { cid: "c1", seat: 0, ok: true } });
    expect(s.command("c1")).toMatchObject({ ok: false, code: "NOT_HOST" });
    const rec = { gid: "g1", at: 5, winner: 1, reason: "forfeit" as const, scores: [0, 0] as [number, number], hands: 0, pids: ["p1", "p2"] as [string, string] };
    s.commit({ meta: m, record: rec });
    s.commit({ meta: m, record: { ...rec, winner: 0, reason: "timeout" } });
    expect(count(db, "matches")).toBe(1);
    expect(s.records()[0]).toMatchObject({ winner: 1, reason: "forfeit" });
  });

  it("舊的指令紀錄會清掉；清空房間全部不留", async () => {
    const { s, m, db } = await ready();
    s.commit({ meta: m, command: { cid: "old", seat: 0, ok: true } });
    s.pruneCommands(Date.now() + 1);
    expect(s.command("old")).toBeNull();
    await s.wipe();
    expect(count(db, "sqlite_master")).toBe(0);
  });
});
