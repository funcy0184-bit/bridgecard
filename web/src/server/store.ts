// 房間的保存：Durable Object 內建 SQLite。
//   meta      房間狀態（JSON：座位、狀態、模式、版本、場次編號……）與資料庫版本
//   game      權威牌局快照（洗好的牌堆、雙方手牌、輪到誰……只存在伺服器）
//   events    事件紀錄（含只給某一方的私人事件；對外回傳一律照身份過濾）
//   commands  指令去重：同一個指令編號重送，回同一個結果、不會重複生效
//   matches   打完的場次（同桌戰績；場次編號是主鍵，不會重複記）
// 每次成功的操作：牌局快照、事件、指令紀錄、房間狀態在同一個交易裡寫入（全成功或全不寫）。
import type { GameEvent, GameSnapshot } from "../game/game";
import type { LSEvent, LSState } from "../laststand/engine";
import type { RoomMeta } from "./lobby";
import type { RecordRow, LoggedEvent } from "./records";

export const SCHEMA_VERSION = 3;

// 每一版要跑的 SQL（以後改結構就往後加，不要改前面的）
const MIGRATIONS: Record<number, string[]> = {
  2: [
    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY CHECK (id = 1), gid TEXT, snapshot TEXT)",
    "CREATE TABLE IF NOT EXISTS events (eid INTEGER PRIMARY KEY, gid TEXT, ver INTEGER, to_seat INTEGER, type TEXT, data TEXT, at INTEGER)",
    "CREATE INDEX IF NOT EXISTS events_gid ON events (gid)",
    "CREATE TABLE IF NOT EXISTS commands (cid TEXT PRIMARY KEY, seat INTEGER, ok INTEGER, code TEXT, msg TEXT, ver INTEGER, at INTEGER)",
    "CREATE TABLE IF NOT EXISTS matches (gid TEXT PRIMARY KEY, at INTEGER, winner INTEGER, reason TEXT, score0 INTEGER, score1 INTEGER, hands INTEGER, pid0 TEXT, pid1 TEXT)",
  ],
  // 第 3 版：逆命賭局。牌局快照記是哪一種遊戲；戰績記模式和第 1 墩宣戰權（算位置勝率用）
  3: [
    "ALTER TABLE game ADD COLUMN kind TEXT",
    "ALTER TABLE matches ADD COLUMN mode TEXT",
    "ALTER TABLE matches ADD COLUMN coin INTEGER",
  ],
};

export interface CommandRow { ok: boolean; code: string; msg: string; ver: number }
export interface Commit {
  meta: RoomMeta;
  snapshot?: GameSnapshot | LSState | null;   // undefined：牌局沒變
  kind?: "classic" | "laststand";             // 快照是哪一種遊戲（沒寫就是經典）
  events?: { eid: number; to: number; e: GameEvent | LSEvent }[];
  command?: { cid: string; seat: number; ok: boolean; code?: string; msg?: string };
  record?: RecordRow;
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
export const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");

export class RoomStore {
  constructor(private storage: DurableObjectStorage) {}
  private get sql() { return this.storage.sql; }

  // 建表＋升級；舊版（整包 JSON 存在 key「room」）的房間搬進新結構
  async migrate(): Promise<void> {
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'schema'").toArray()[0];
    let ver = row ? Number(row.v) : 1;
    for (let v = ver + 1; v <= SCHEMA_VERSION; v++) {
      for (const q of MIGRATIONS[v] ?? []) this.sql.exec(q);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)", String(v));
      ver = v;
    }
    const legacy = await this.storage.get<{ code: string; createdAt: number; lastActive: number; seats: ({ token: string; name: string } | null)[]; game: GameSnapshot | null }>("room");
    if (legacy && !this.loadMeta()) {
      const seats = await Promise.all(legacy.seats.map(async s => s ? { pid: randomId(), tokenHash: await sha256(s.token), name: s.name, ready: false, rematch: false, offlineSince: null, joinedAt: legacy.createdAt } : null));
      const g = legacy.game;
      const status = g ? (g.matchWinner >= 0 ? "SETTLEMENT" : "IN_GAME") : seats.every(Boolean) ? "READY" : "WAITING";
      const meta: RoomMeta = { schema: 2, code: legacy.code, createdAt: legacy.createdAt, lastActive: legacy.lastActive, status, mode: "classic",
        host: 0, seats, ver: 1, eid: 0, gid: g ? randomId() : null, result: g && g.matchWinner >= 0 ? { winner: g.matchWinner, reason: "target" } : null };
      this.storage.transactionSync(() => {
        this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('room', ?)", JSON.stringify(meta));
        if (g) this.sql.exec("INSERT OR REPLACE INTO game (id, gid, snapshot) VALUES (1, ?, ?)", meta.gid, JSON.stringify(g));
      });
      await this.storage.delete("room");
    }
  }

  loadMeta(): RoomMeta | null {
    const r = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'room'").toArray()[0];
    return r ? JSON.parse(r.v) as RoomMeta : null;
  }
  // 經典牌局的快照（逆命賭局的快照不會從這裡拿到）
  loadSnapshot(): GameSnapshot | null {
    const g = this.loadGame();
    return g && g.kind === "classic" ? g.snapshot as GameSnapshot : null;
  }
  loadGame(): { kind: "classic" | "laststand"; snapshot: GameSnapshot | LSState } | null {
    const r = this.sql.exec<{ snapshot: string | null; kind: string | null }>("SELECT snapshot, kind FROM game WHERE id = 1").toArray()[0];
    return r?.snapshot ? { kind: r.kind === "laststand" ? "laststand" : "classic", snapshot: JSON.parse(r.snapshot) } : null;
  }

  // 一次寫完：房間狀態＋牌局快照＋事件＋指令紀錄＋戰績（交易：任何一步失敗，全部不寫）
  commit(c: Commit) {
    this.storage.transactionSync(() => {
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('room', ?)", JSON.stringify(c.meta));
      if (c.snapshot !== undefined) this.sql.exec("INSERT OR REPLACE INTO game (id, gid, snapshot, kind) VALUES (1, ?, ?, ?)", c.meta.gid, c.snapshot ? JSON.stringify(c.snapshot) : null, c.kind ?? "classic");
      const now = Date.now();
      for (const x of c.events ?? [])
        this.sql.exec("INSERT INTO events (eid, gid, ver, to_seat, type, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)", x.eid, c.meta.gid, c.meta.ver, x.to, x.e.type, JSON.stringify(x.e), now);
      if (c.command) this.sql.exec("INSERT OR IGNORE INTO commands (cid, seat, ok, code, msg, ver, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        c.command.cid, c.command.seat, c.command.ok ? 1 : 0, c.command.code ?? "", c.command.msg ?? "", c.meta.ver, now);
      if (c.record) {
        const r = c.record;
        this.sql.exec("INSERT OR IGNORE INTO matches (gid, at, winner, reason, score0, score1, hands, pid0, pid1, mode, coin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          r.gid, r.at, r.winner, r.reason, r.scores[0], r.scores[1], r.hands, r.pids[0], r.pids[1], r.mode ?? "classic", r.coin ?? -1);
      }
    });
  }

  // 這個指令處理過了嗎（處理過就回同一個結果）
  command(cid: string): CommandRow | null {
    const r = this.sql.exec<{ ok: number; code: string; msg: string; ver: number }>("SELECT ok, code, msg, ver FROM commands WHERE cid = ?", cid).toArray()[0];
    return r ? { ok: !!r.ok, code: r.code, msg: r.msg, ver: r.ver } : null;
  }

  events(gid: string): LoggedEvent[] {
    return this.sql.exec<{ eid: number; to_seat: number; data: string }>("SELECT eid, to_seat, data FROM events WHERE gid = ? ORDER BY eid", gid).toArray()
      .map(r => ({ eid: r.eid, to: r.to_seat, e: JSON.parse(r.data) as GameEvent }));
  }

  records(): RecordRow[] {
    return this.sql.exec<{ gid: string; at: number; winner: number; reason: string; score0: number; score1: number; hands: number; pid0: string; pid1: string; mode: string | null; coin: number | null }>("SELECT * FROM matches ORDER BY at").toArray()
      .map(r => ({ gid: r.gid, at: r.at, winner: r.winner, reason: r.reason as RecordRow["reason"], scores: [r.score0, r.score1], hands: r.hands, pids: [r.pid0, r.pid1],
        mode: (r.mode === "laststand" ? "laststand" : "classic") as RecordRow["mode"], coin: r.coin ?? -1 }));
  }

  // 舊的指令紀錄清掉（重送只會在幾秒內發生；留一天就很夠）
  pruneCommands(before: number) { this.sql.exec("DELETE FROM commands WHERE at < ?", before); }

  async wipe() { await this.storage.deleteAll(); }
}
