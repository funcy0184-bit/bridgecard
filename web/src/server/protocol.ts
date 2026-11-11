// 手機 ↔ 雲端房間的訊息格式（WebSocket 上傳 JSON）。第 2 版：有協定版本、指令編號、狀態版本。
//
// 用戶端 → 伺服器（括號是規格裡的名稱）
//   hello   (ROOM_JOIN)          進房；token = 之前拿到的私人座位憑證（重連用），v = 協定版本，name = 暱稱（新入座的人一定要有；拿憑證回來的人用原本的）
//   name    (NAME_SET)           開局前、還沒按準備時改自己的暱稱（只能改自己的）
//   ready   (READY_SET)          準備／取消準備（雙方入座後）
//   mode    (MODE_SET)           房主在開局前換模式（換了雙方準備要重按）
//   play    (CARD_PLAY)          出牌
//   call    (BID_SUBMIT／PASS／DOUBLE／REDOUBLE)  叫品 0..34、Pass -1、加倍 -2、再加倍 -3
//   next                         這一局結算完，開下一局
//   rematch (REMATCH_READY)      整場結束後「再來一場」
//   leave                        開局前離開（讓出座位）／對局中「認輸離開」（照中離規則判負）
//   sync    (STATE_SYNC_REQUEST) 要最新的完整狀態
//   recap                        要這一場的精彩回顧
//   emote                        回個話（純社交）
//   ping
// 每個會改變狀態的指令都帶 cid（唯一指令編號，重送不會重複生效）；牌局指令另外帶 ver（我看到的狀態版本，過期就拒絕）。
//
// 伺服器 → 用戶端
//   welcome                      你的座位、房號、這一場的編號、協定版本
//   room    (ROOM_SNAPSHOT／PLAYER_JOINED／PLAYER_LEFT／READY_CHANGED／MODE_CHANGED／PLAYER_DISCONNECTED／PLAYER_RECONNECTED)
//           房間狀態快照；notice 註明這次是因為什麼改變
//   event   (GAME_STARTED=NewHand、CARD_PLAYED=CardPlayed、TRICK_RESOLVED=TrickWon、BID_UPDATED=BidMade／Passed／Doubled／Redoubled、
//            CONTRACT_FINALIZED=ContractSet、ROUND_SETTLED=GameOver＋HandScored、MATCH_FINISHED=MatchOver）帶 eid（事件序號）、ver
//   state   你看得到的牌桌狀態（照座位過濾），帶 ver
//   ack     指令成功（已存檔才回）     reject (ACTION_REJECTED)：指令失敗＋原因；過期的會接著送 resync
//   resync  (STATE_RESYNC)       完整快照（房間＋牌桌），用戶端直接跳到最新狀態，不補播舊動畫
//   recap                        這一場的精彩回顧（只有公開資訊）
//   full／gone／closed／error／emote／pong
import type { GameEvent, TableState } from "../game/game";

export const PROTOCOL_VERSION = 2;

export type RoomStatus = "WAITING" | "READY" | "IN_GAME" | "PAUSED" | "SETTLEMENT" | "REMATCH" | "CLOSED";
export type Mode = "classic" | "chips";
// 模式：籌碼對決還沒做出來，伺服器會拒絕（不用假籌碼冒充）
export const MODES: Record<Mode, { label: string; enabled: boolean }> = {
  classic: { label: "經典牌局", enabled: true },
  chips: { label: "籌碼對決", enabled: false },
};

export type ClientMsg =
  | { t: "hello"; v?: number; token?: string | null; name?: string }
  | { t: "name"; name: string; cid?: string }
  | { t: "ready"; ready: boolean; cid?: string }
  | { t: "mode"; mode: Mode; cid?: string }
  | { t: "play"; card: number; cid?: string; ver?: number; gid?: string }
  | { t: "call"; call: number; cid?: string; ver?: number; gid?: string }
  | { t: "next"; cid?: string; ver?: number; gid?: string }
  | { t: "rematch"; ready: boolean; cid?: string }
  | { t: "leave"; forfeit?: boolean; cid?: string }
  | { t: "sync" }
  | { t: "recap"; gid?: string }
  | { t: "emote"; i: number }
  | { t: "ping" };

export interface SeatInfo {
  taken: boolean; online: boolean; name: string;
  ready: boolean; rematch: boolean;
  offlineSince: number | null;           // 斷線從什麼時候開始（伺服器時間；畫面算經過幾秒）
}
export type EndReason = "target" | "forfeit" | "timeout";
export interface MatchRecord { gid: string; at: number; winner: number; reason: EndReason; scores: [number, number]; hands: number }
export interface PairStats { played: number; wins: [number, number]; draws: number; streak: { seat: number; n: number } | null; last: MatchRecord[] }
export interface RoomView {
  code: string; status: RoomStatus; mode: Mode; host: number; seats: SeatInfo[];
  ver: number; gid: string | null; now: number;
  result: { winner: number; reason: EndReason } | null;   // 這一場怎麼結束的（整場結算時）
  stats: PairStats;                                         // 同桌戰績（只算現在這兩個人）
  timing: { notice: number; choice: number; forfeit: number };   // 斷線多久提示／可以選離開／判負（毫秒）
  forfeitAt: number | null; forfeitSeat: number;            // 對局中有人斷線：伺服器時間幾點會照規則判他中離（沒有就是 null）
}
export type Notice = "joined" | "left" | "ready" | "mode" | "name" | "disconnected" | "reconnected" | "started" | "forfeit" | "timeout" | "rematch" | "host";

export interface Highlight { kind: "ruff" | "doubleMade" | "doubleDown" | "decider" | "bigHand" | "matchPoint"; hand: number; text: string; cards?: [number, number]; seats?: [number, number] }

export type RejectCode = "STALE" | "ILLEGAL" | "NOT_YOUR_TURN" | "PAUSED" | "BAD_STATE" | "NOT_HOST" | "MODE_LOCKED" | "MODE_UNAVAILABLE" | "NOT_SEATED" | "SAVE_FAILED" | "BAD_REQUEST"
  | "NAME_INVALID" | "NAME_LOCKED";

export type ServerMsg =
  | { t: "welcome"; v: number; seat: number; token: string; code: string; gid: string | null }
  | { t: "room"; r: RoomView; notice?: Notice; seat?: number }
  | { t: "lobby"; seats: { taken: boolean; online: boolean; name: string }[]; started: boolean }   // 單機（LocalTable）用
  | { t: "event"; e: GameEvent; eid?: number; ver?: number; gid?: string }
  | { t: "state"; s: TableState; ver?: number; gid?: string }
  | { t: "ack"; cid: string; ver: number }
  | { t: "reject"; cid?: string; code: RejectCode; msg: string; ver: number }
  | { t: "resync"; r: RoomView; s: TableState | null; ver: number; eid: number }
  | { t: "recap"; gid: string; items: Highlight[] }
  | { t: "full" }
  | { t: "gone" }                                           // 房間不存在（打錯房號或已過期）
  | { t: "closed"; msg: string }                            // 房間關了（兩人都離開、過期）
  | { t: "error"; msg: string; code?: "VERSION" | "RATE" | "NAME" }
  | { t: "emote"; seat: number; i: number }                 // 某個座位回了一句（照暱稱顯示，不是阿禾講的）
  | { t: "pong" };

// 斷線時間軸（集中在這裡，方便調整；本機測試可以用環境變數縮短）
export const TIMING = {
  notice: 30_000,                // 30 秒：清楚提示對手斷線
  choice: 120_000,               // 2 分鐘：另一方可以選「繼續等」或「先離開（牌局保留）」
  forfeit: 600_000,              // 10 分鐘：對局中斷線超過這個時間、而且對方在線上，判斷線的一方中離負
  seatHold: 600_000,             // 開局前斷線超過 10 分鐘：座位讓出來
  resumeKeep: 24 * 3600_000,     // 進行中的牌局：最後一次有動作後保留 24 小時可以回來接著打
  recordKeep: 7 * 24 * 3600_000, // 打完的戰績：保留 7 天
  trickPause: 1300,              // 兩張牌都上桌後停多久再結算
};
export type Timing = typeof TIMING;

// 回個話：短句的數量（文字在用戶端，伺服器只檢查編號）；防洗版：同一個人間隔、短時間內次數
export const EMOTE_COUNT = 5;
export const EMOTE_GAP_MS = 2500;
export const EMOTE_WINDOW_MS = 20000;
export const EMOTE_WINDOW_MAX = 4;
// 這一句能不能送：times = 這個人最近幾次的時間（毫秒）
export function emoteAllowed(times: number[], now: number): boolean {
  const recent = times.filter(t => now - t < EMOTE_WINDOW_MS);
  if (recent.length && now - Math.max(...recent) < EMOTE_GAP_MS) return false;
  return recent.length < EMOTE_WINDOW_MAX;
}

// 房號：新開的房 6 碼（去掉容易看錯的 0 O 1 I L，31^6 ≈ 8.9 億種）；舊的 4 碼房還能進
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const isValidCode = (c: string) =>
  (c.length === CODE_LENGTH || c.length === 4) && [...c].every(ch => CODE_ALPHABET.includes(ch));
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

// 暱稱：只是顯示用的名字，不是身分（身分看私人座位憑證）
//   · 中英文、數字、一般安全符號（含表情符號）；頭尾空白去掉、中間連續空白變一個；看不見的控制字元直接拿掉
//   · 最多 16 個字：照「看起來的一個字」算（中文一個字、一個 emoji 組合都算 1）
//   · 空白、太長、有不允許的符號：拒絕並說明（不偷偷截斷）；畫面一律用純文字顯示，不當 HTML
export const NAME_MAX = 16;
const NAME_PUNCT = " -_.·・'’!?！？~～()（）&+@#,，。、:：*★☆♠♣♥♦♤♧♡♢♪^";
const NAME_OK = /[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F\u20E3]/u;
const graphemes = (() => {
  try { const g = new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }); return (s: string) => [...g.segment(s)].length; }
  catch { return (s: string) => [...s].length; }
})();
export const nameLength = (s: string) => graphemes(s);
export function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.slice(0, 400).normalize("NFC")
    .replace(/[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")   // 看不見的字元（零寬、方向控制）
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, " ")
    .trim();
}
export type NameCheck = { ok: true; name: string } | { ok: false; code: "EMPTY" | "TOO_LONG" | "BAD_CHARS"; msg: string };
export function checkName(raw: unknown): NameCheck {
  const name = normalizeName(raw);
  if (!name) return { ok: false, code: "EMPTY", msg: "請先填你的暱稱。" };
  if (nameLength(name) > NAME_MAX || [...name].length > NAME_MAX * 3) return { ok: false, code: "TOO_LONG", msg: `暱稱最多 ${NAME_MAX} 個字，請縮短一點。` };
  for (const ch of name) if (!NAME_OK.test(ch) && !NAME_PUNCT.includes(ch)) return { ok: false, code: "BAD_CHARS", msg: `暱稱不能用「${ch}」，請用中英文、數字或一般符號。` };
  return { ok: true, name };
}

// 加入頻率限制：同一個來源 10 分鐘內查不到房間超過 30 次、或開房超過 30 次，先擋一下
export const LIMITS = { windowMs: 10 * 60_000, misses: 30, creates: 30 };
