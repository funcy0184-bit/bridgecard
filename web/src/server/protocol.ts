// 手機 ↔ 雲端房間的訊息格式（WebSocket 上傳 JSON）
import type { GameEvent, TableState } from "../game/game";

export type ClientMsg =
  | { t: "hello"; token?: string | null; name?: string }   // 進房；token = 之前拿到的座位憑證（重連用）
  | { t: "play"; card: number }
  | { t: "call"; call: number }                             // 叫品 0..34、Pass -1、加倍 -2、再加倍 -3
  | { t: "next" }                                           // 局末「下一局」／整場結束「再來一場」
  | { t: "emote"; i: number }                               // 回個話（第 i 句短句；純社交，不影響牌局）
  | { t: "ping" };

export interface SeatInfo { taken: boolean; online: boolean; name: string; }

export type ServerMsg =
  | { t: "welcome"; seat: number; token: string; code: string }
  | { t: "lobby"; seats: SeatInfo[]; started: boolean }
  | { t: "event"; e: GameEvent }
  | { t: "state"; s: TableState }
  | { t: "full" }
  | { t: "gone" }                                           // 房間不存在（打錯房號或已過期）
  | { t: "error"; msg: string }
  | { t: "emote"; seat: number; i: number }                 // 某個座位回了一句（照暱稱顯示，不是阿禾講的）
  | { t: "pong" };

// 回個話：短句的數量（文字在用戶端，伺服器只檢查編號）；防洗版：同一個人間隔、短時間內次數
export const EMOTE_COUNT = 5;
export const EMOTE_GAP_MS = 2500;
export const EMOTE_WINDOW_MS = 20000;
export const EMOTE_WINDOW_MAX = 4;
// 這一句能不能送：last = 這個人最近幾次的時間（毫秒）
export function emoteAllowed(times: number[], now: number): boolean {
  const recent = times.filter(t => now - t < EMOTE_WINDOW_MS);
  if (recent.length && now - Math.max(...recent) < EMOTE_GAP_MS) return false;
  return recent.length < EMOTE_WINDOW_MAX;
}

// 房號：4 碼，去掉容易看錯的 0 O 1 I L
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;
export const isValidCode = (c: string) =>
  c.length === CODE_LENGTH && [...c].every(ch => CODE_ALPHABET.includes(ch));
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

export const cleanName = (raw: unknown, fallback: string) => {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 10) : "";
  return s || fallback;
};
