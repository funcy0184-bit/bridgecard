// 房間狀態機（純函式：不碰網路、不碰儲存，測試可以直接跑）
//
//   WAITING ──(兩人入座)──▶ READY ──(兩人都準備)──▶ IN_GAME ──(有人斷線)──▶ PAUSED ──(都回來)──▶ IN_GAME
//      ▲                    │ ▲                        │                       │
//      └──(有人離開座位)────┘ └─(開局前有人離開)─────┐  ├─(整場打完)──▶ SETTLEMENT ──(有人按再來一場)──▶ REMATCH ──(兩人都按)──▶ IN_GAME
//                                                    │  └─(認輸／斷線逾時)──▶ SETTLEMENT
//   任何狀態 ──(兩人都離開、過期)──▶ CLOSED（不能再加入）
//
// 用戶端不能直接改狀態：只能送意圖（準備、換模式、離開、再來一場），由這裡判斷合不合法。
import { MODES, Mode, RejectCode, RoomStatus, EndReason } from "./protocol";

export interface SeatMeta {
  pid: string;                 // 這個座位上的人的編號（公開；戰績用，不是憑證）
  tokenHash: string;           // 私人座位憑證的雜湊（伺服器不存明碼）
  name: string;
  ready: boolean;
  rematch: boolean;
  offlineSince: number | null; // 斷線開始的時間（存起來：房間重開機後也能算中離）
  onlineAt?: number;           // 最近一次連上的時間（兩邊都斷過線時，中離從「對方回來」才開始算）
  stake?: string;              // 逆命賭局：契約書上賭上之物（沒簽就是 undefined）
  joinedAt: number;
}

export interface RoomMeta {
  schema: 2;
  code: string;
  createdAt: number;
  lastActive: number;
  status: RoomStatus;
  mode: Mode;
  host: number;
  seats: (SeatMeta | null)[];
  ver: number;                  // 狀態版本：每次成功的操作 +1
  eid: number;                  // 最後一個事件序號
  gid: string | null;           // 這一場的編號（再來一場會換新的）
  result: { winner: number; reason: EndReason } | null;
  lsCoin?: 0 | 1;               // 逆命賭局：上一場第 1 墩宣戰權給誰（再戰時交換）
}

export type Fail = { ok: false; code: RejectCode; msg: string };
export type Ok<T = undefined> = { ok: true; value: T };
const fail = (code: RejectCode, msg: string): Fail => ({ ok: false, code, msg });
const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export function newRoom(code: string, now: number): RoomMeta {
  return { schema: 2, code, createdAt: now, lastActive: now, status: "WAITING", mode: "classic", host: 0, seats: [null, null], ver: 0, eid: 0, gid: null, result: null };
}

export const seated = (m: RoomMeta) => m.seats.filter(Boolean).length;
export const inMatch = (m: RoomMeta) => m.status === "IN_GAME" || m.status === "PAUSED";
const DEFAULT_NAMES = ["房主", "朋友"];

// 誰的憑證：回傳座位（找不到 -1）
export const seatOfToken = (m: RoomMeta, tokenHash: string | null) => tokenHash ? m.seats.findIndex(s => !!s && s.tokenHash === tokenHash) : -1;

// 進房：拿著憑證回來就回原座位；新的人只能在開局前坐空位
export type JoinResult = { seat: number; isNew: boolean };
export function join(m: RoomMeta, tokenHash: string | null, fresh: { tokenHash: string; pid: string }, name: string, now: number): Ok<JoinResult> | Fail | { ok: false; code: "FULL" | "CLOSED" } {
  if (m.status === "CLOSED") return { ok: false, code: "CLOSED" };
  const back = seatOfToken(m, tokenHash);
  // 拿憑證回來（重新整理、重連）：原本的座位、原本的暱稱，不會被這次送來的名字蓋掉
  if (back >= 0) return ok({ seat: back, isNew: false });
  // 新的人：只有等人／確認準備時有空位才行（比賽開始、結算中、再來一場都不讓陌生人坐）
  const free = m.seats.findIndex(s => s === null);
  if (free < 0 || !(m.status === "WAITING" || m.status === "READY")) return { ok: false, code: "FULL" };
  m.seats[free] = { pid: fresh.pid, tokenHash: fresh.tokenHash, name: name || DEFAULT_NAMES[free], ready: false, rematch: false, offlineSince: null, joinedAt: now };
  if (seated(m) === 1) m.host = free;                 // 第一個坐下的是房主
  for (const s of m.seats) if (s) s.ready = false;    // 有人進來：準備重新確認
  m.status = seated(m) === 2 ? "READY" : "WAITING";
  return ok({ seat: free, isNew: true });
}

// 現在能不能讓一個新的人坐下（能的話才需要檢查他的暱稱）
export const canSeatNew = (m: RoomMeta) => (m.status === "WAITING" || m.status === "READY") && m.seats.some(s => s === null);

// 改自己的暱稱：開局前、還沒按準備時才行（只能改自己的座位；對局開始到這一場結束都鎖定）
export function setName(m: RoomMeta, seat: number, name: string): Ok<{ changed: boolean }> | Fail {
  const s = m.seats[seat];
  if (!s) return fail("NOT_SEATED", "你不在這桌。");
  if (!(m.status === "WAITING" || m.status === "READY")) return fail("NAME_LOCKED", "對局開始後暱稱就鎖定了，這一場結束後再改。");
  if (s.ready) return fail("NAME_LOCKED", "已經按準備了：先取消準備再改暱稱。");
  const changed = s.name !== name;
  s.name = name;
  return ok({ changed });
}

// 逆命賭局：在契約書上蓋章（寫好賭上之物）；開局前、還沒按準備才能改，只能改自己的
export function setStake(m: RoomMeta, seat: number, stake: string): Ok<{ changed: boolean }> | Fail {
  const s = m.seats[seat];
  if (!s) return fail("NOT_SEATED", "你不在這桌。");
  if (!(m.status === "WAITING" || m.status === "READY")) return fail("BAD_STATE", "對局開始後契約就生效了，這一場結束後再改。");
  if (s.ready) return fail("BAD_STATE", "已經按準備了：先取消準備再改契約。");
  const changed = s.stake !== stake;
  s.stake = stake;
  return ok({ changed });
}

// 開局前離開：讓出座位；房主走了換剩下的人當房主；兩個都走了就關房
// 整場結束後（結算／再來一場）離開：也讓出座位，戰績還留著
export function leave(m: RoomMeta, seat: number): Ok | Fail {
  if (!m.seats[seat]) return fail("NOT_SEATED", "你不在這桌。");
  if (inMatch(m)) return fail("BAD_STATE", "牌局進行中：要離開請用「認輸離開」，或直接關掉（10 分鐘內回來可以接著打）。");
  m.seats[seat] = null;
  for (const s of m.seats) if (s) { s.ready = false; s.rematch = false; }
  const left = m.seats.findIndex(Boolean);
  if (left < 0) { m.status = "CLOSED"; return ok(undefined); }
  if (m.host === seat) m.host = left;
  m.status = "WAITING";
  return ok(undefined);
}

// 準備／取消準備：只有兩人入座、還沒開打時可以按；兩個人都準備 → 由呼叫的人開局
export function setReady(m: RoomMeta, seat: number, ready: boolean): Ok<{ start: boolean }> | Fail {
  const s = m.seats[seat];
  if (!s) return fail("NOT_SEATED", "你不在這桌。");
  if (m.status !== "READY") return fail("BAD_STATE", m.status === "WAITING" ? "朋友還沒來，等他入座再準備。" : "現在不能改準備。");
  if (ready && s.offlineSince !== null) return fail("BAD_STATE", "連線中斷時不能準備。");
  if (ready && m.mode === "laststand" && !s.stake) return fail("BAD_STATE", "先在賭局契約書上蓋章，再按準備。");
  s.ready = ready;
  return ok({ start: m.seats.every(x => x?.ready) });
}

// 房主換模式：開局前才能換；換了雙方都要重新準備
export function setMode(m: RoomMeta, seat: number, mode: Mode): Ok<{ changed: boolean }> | Fail {
  if (!m.seats[seat]) return fail("NOT_SEATED", "你不在這桌。");
  if (seat !== m.host) return fail("NOT_HOST", "只有房主可以換模式。");
  if (!(m.status === "WAITING" || m.status === "READY")) return fail("MODE_LOCKED", "開打之後模式就鎖定了。");
  if (!MODES[mode]) return fail("BAD_REQUEST", "沒有這個模式。");
  if (!MODES[mode].enabled) return fail("MODE_UNAVAILABLE", `${MODES[mode].label}還沒開放，先用${MODES.classic.label}。`);
  const changed = m.mode !== mode;
  m.mode = mode;
  if (changed) for (const s of m.seats) if (s) s.ready = false;
  return ok({ changed });
}

// 開新的一場：狀態 → IN_GAME、換一個新的場次編號、準備和再來一場的勾都清掉
export function startMatch(m: RoomMeta, gid: string) {
  m.status = "IN_GAME";
  m.gid = gid;
  m.result = null;
  for (const s of m.seats) if (s) { s.ready = false; s.rematch = false; }
  if (m.seats.some(s => s && s.offlineSince !== null)) m.status = "PAUSED";
}

// 整場打完（照規則先到目標分數）
export function finishMatch(m: RoomMeta, winner: number, reason: EndReason) {
  if (!inMatch(m)) return false;          // 已經結算過：不重複（中離、逾時都只算一次）
  m.status = "SETTLEMENT";
  m.result = { winner, reason };
  return true;
}

// 認輸離開：只有對局中可以；判自己負（冪等：已經結算就什麼都不做）
export function forfeit(m: RoomMeta, seat: number, reason: "forfeit" | "timeout"): Ok<{ winner: number }> | Fail {
  if (!m.seats[seat]) return fail("NOT_SEATED", "你不在這桌。");
  if (!inMatch(m)) return fail("BAD_STATE", "現在沒有進行中的牌局。");
  const winner = 1 - seat;
  finishMatch(m, winner, reason);
  return ok({ winner });
}

// 再來一場：整場結算後兩人都按 → 由呼叫的人開新的一場
export function setRematch(m: RoomMeta, seat: number, want: boolean): Ok<{ start: boolean }> | Fail {
  const s = m.seats[seat];
  if (!s) return fail("NOT_SEATED", "你不在這桌。");
  if (!(m.status === "SETTLEMENT" || m.status === "REMATCH")) return fail("BAD_STATE", "這一場還沒結束。");
  if (seated(m) < 2) return fail("BAD_STATE", "對方已經離開了。");
  s.rematch = want;
  m.status = m.seats.some(x => x?.rematch) ? "REMATCH" : "SETTLEMENT";
  return ok({ start: m.seats.every(x => x?.rematch) });
}

// 連線狀態：斷線記時間；對局中斷線 → 暫停；兩人都回來 → 繼續
export function markOffline(m: RoomMeta, seat: number, now: number) {
  const s = m.seats[seat];
  if (!s || s.offlineSince !== null) return false;
  s.offlineSince = now;
  if (m.status === "READY") s.ready = false;            // 開局前斷線：準備取消（不能用斷線的人開局）
  if (m.status === "IN_GAME") m.status = "PAUSED";
  return true;
}
export function markOnline(m: RoomMeta, seat: number, now: number) {
  const s = m.seats[seat];
  if (!s) return false;
  const was = s.offlineSince !== null;
  s.offlineSince = null;
  if (was || s.onlineAt === undefined) s.onlineAt = now;
  if (m.status === "PAUSED" && m.seats.every(x => !x || x.offlineSince === null)) m.status = "IN_GAME";
  return was;
}

// 下一個要處理的時間點（只排一個鬧鐘，不每秒醒來檢查）
//   中離：對局中某一方斷線超過 forfeit、而且另一方在線上 → 判負
//         （兩邊都斷過線：從「另一方回來」開始算，不會一回來就把還沒回來的人判掉）
//   開局前：斷線超過 seatHold → 讓出座位
//   過期：進行中的牌局最後動作後 resumeKeep；只剩戰績的房間 recordKeep
export interface Deadlines { forfeitAt: number | null; forfeitSeat: number; releaseAt: number | null; releaseSeat: number; expireAt: number }
export function deadlines(m: RoomMeta, t: { forfeit: number; seatHold: number; resumeKeep: number; recordKeep: number }, hasRecords: boolean): Deadlines {
  let forfeitAt: number | null = null, forfeitSeat = -1, releaseAt: number | null = null, releaseSeat = -1;
  m.seats.forEach((s, i) => {
    if (!s || s.offlineSince === null) return;
    const other = m.seats[1 - i];
    if (inMatch(m) && other && other.offlineSince === null) {
      const at = Math.max(s.offlineSince, other.onlineAt ?? 0) + t.forfeit;
      if (forfeitAt === null || at < forfeitAt) { forfeitAt = at; forfeitSeat = i; }
    }
    if (m.status === "WAITING" || m.status === "READY") {
      const at = s.offlineSince + t.seatHold;
      if (releaseAt === null || at < releaseAt) { releaseAt = at; releaseSeat = i; }
    }
  });
  const keep = inMatch(m) || !hasRecords ? t.resumeKeep : t.recordKeep;
  return { forfeitAt, forfeitSeat, releaseAt, releaseSeat, expireAt: m.lastActive + keep };
}
