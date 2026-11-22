// worker/index.js — 入口：建立房間、把 WebSocket 轉給該房號的 GameRoom，其餘交給靜態檔
//   POST /api/rooms          → { room: "K7P2" }（不重複 4 碼，排除 0/O/1/I）
//   GET  /ws/K7P2（Upgrade）  → 轉給 GameRoom（idFromName(房號)）
//   路徑只比對結尾，所以遊戲放在網域根目錄或子目錄（/fist/）都能用
import { CONFIG } from "../../web/public/fist/src/config.js";
export { GameRoom } from "./gameRoom.js";

const N = CONFIG.net;
const codeRe = new RegExp(`/ws/([${N.codeAlphabet}]{${N.roomCodeLength}})$`);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function makeCode() {
  const buf = new Uint8Array(N.roomCodeLength);
  crypto.getRandomValues(buf);
  return [...buf].map(b => N.codeAlphabet[b % N.codeAlphabet.length]).join("");   // 32 個字元：256 % 32 = 0，不偏
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/api/rooms")) {
      if (req.method !== "POST") return json({ error: "method" }, 405);
      for (let i = 0; i < 8; i++) {                                    // 撞號就換一組（DO 內部用 storage 判斷是否已被佔用）
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch(`https://room/init?code=${code}`, { method: "POST" });
        if (r.status === 200) return json({ room: code });
      }
      return json({ error: "busy", msg: "房間太多了，請稍後再試" }, 503);
    }
    const m = url.pathname.match(codeRe);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade" }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(`https://room/ws?code=${m[1]}`, req);
    }
    if (url.pathname.endsWith("/api/health")) return json({ ok: true, time: Date.now() });
    return env.ASSETS.fetch(req);
  },
};
