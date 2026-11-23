// route.js（拳刃交鋒）— 建房與 WebSocket 路由，主站 worker.ts 與獨立的 fist-online 共用
//   POST …/api/rooms        → { room: "K7P2" }（不重複 4 碼，排除 0/O/1/I）
//   GET  …/ws/K7P2（Upgrade）→ 轉給該房號的 GameRoom Durable Object
//   只比對路徑結尾：放在主站 /fist/ 底下或獨立 Worker 的根目錄都能用；不是這兩種路徑就回傳 null
import { CONFIG } from "../../../public/fist/src/config.js";

const N = CONFIG.net;
const codeRe = new RegExp(`/ws/([${N.codeAlphabet}]{${N.roomCodeLength}})$`);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function makeCode() {
  const buf = new Uint8Array(N.roomCodeLength);
  crypto.getRandomValues(buf);
  return [...buf].map(b => N.codeAlphabet[b % N.codeAlphabet.length]).join("");   // 32 個字元：256 % 32 = 0，不偏
}

/**
 * @param {Request} req
 * @param {DurableObjectNamespace} ns   GameRoom 的 namespace
 * @param {{ allowCreate?: () => Promise<boolean> }} [opts]  建房前的頻率限制（主站共用 Limiter）
 * @returns {Promise<Response|null>}
 */
export async function handleFist(req, ns, opts = {}) {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/rooms")) {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (opts.allowCreate && !(await opts.allowCreate())) return json({ error: "rate", msg: "開房太頻繁了，休息幾分鐘再試" }, 429);
    for (let i = 0; i < 8; i++) {                                    // 撞號就換一組（DO 內部用 storage 判斷是否已被佔用）
      const code = makeCode();
      const r = await ns.get(ns.idFromName(code)).fetch(`https://room/init?code=${code}`, { method: "POST" });
      if (r.status === 200) return json({ room: code });
    }
    return json({ error: "busy", msg: "房間太多了，請稍後再試" }, 503);
  }
  const m = url.pathname.match(codeRe);
  if (m) {
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade" }, 426);
    return ns.get(ns.idFromName(m[1])).fetch(`https://room/ws?code=${m[1]}`, req);
  }
  return null;
}
