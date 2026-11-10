// 入口：網頁檔案由 Cloudflare 靜態資源直接送；/api/* 才進到這裡
//   POST /api/rooms            開房，回傳 { code }（房號 6 碼，伺服器隨機產生、不重複）
//   GET  /api/rooms/:code      查房間在不在、有沒有空位、開打了沒（不含任何私人資料）
//   GET  /api/rooms/:code/ws   WebSocket，進到那個房間（私人座位憑證在連上之後才送，不放網址）
// 同一個來源 10 分鐘內查不到房間太多次、或開房太多次，先擋一下（防猜房號）
import { CODE_ALPHABET, CODE_LENGTH, LIMITS, isValidCode, normalizeCode, type ServerMsg } from "./protocol";
import { Env, Room } from "./room";
import { Limiter } from "./limiter";

export { Room, Limiter };

function newCode(): string {
  // 用拒絕取樣避免取餘數造成的偏差
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    for (const x of b) if (x < 248 && out.length < CODE_LENGTH) out.push(CODE_ALPHABET[x % CODE_ALPHABET.length]);
  }
  return out.join("");
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
const limiter = (env: Env, req: Request) => env.LIMITER.get(env.LIMITER.idFromName(req.headers.get("CF-Connecting-IP") ?? "local"));

// 被擋的 WebSocket：還是升級，送一句原因再關掉（瀏覽器才看得到為什麼）
function refuseSocket(msg: ServerMsg, code: number): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify(msg));
  pair[1].close(code, "refused");
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);   // ["api","rooms",code,"ws"]

    if (parts[0] !== "api") return env.ASSETS.fetch(req);

    if (parts[1] === "rooms" && parts.length === 2 && req.method === "POST") {
      if (!(await limiter(env, req).hit("create", LIMITS.creates, LIMITS.windowMs)))
        return Response.json({ error: "開桌太頻繁了，休息幾分鐘再試。" }, { status: 429 });
      for (let i = 0; i < 12; i++) {
        const code = newCode();
        const res = await roomStub(env, code).fetch("https://room/init", { method: "POST", body: code });
        if (res.status === 201) return Response.json({ code });
      }
      return Response.json({ error: "房間太多了，請再試一次" }, { status: 503 });
    }

    if (parts[1] === "rooms" && parts[2]) {
      const code = normalizeCode(parts[2]);
      const ws = parts[3] === "ws";
      if (ws && req.headers.get("Upgrade") !== "websocket") return new Response("需要 WebSocket", { status: 426 });
      const lim = limiter(env, req);
      if (await lim.blocked("miss", LIMITS.misses, LIMITS.windowMs)) {
        const msg = "查房號太多次了，休息幾分鐘再試。";
        return ws ? refuseSocket({ t: "error", code: "RATE", msg }, 4429) : Response.json({ error: msg }, { status: 429 });
      }
      if (!isValidCode(code)) { await lim.hit("miss", LIMITS.misses, LIMITS.windowMs); return ws ? refuseSocket({ t: "gone" }, 4404) : Response.json({ exists: false }, { status: 404 }); }
      const stub = roomStub(env, code);
      const info = await (await stub.fetch("https://room/info")).json() as { exists: boolean };
      if (!info.exists) await lim.hit("miss", LIMITS.misses, LIMITS.windowMs);   // 查不到才算一次
      if (ws) return stub.fetch(req);
      if (parts.length === 3) return Response.json(info, { status: info.exists ? 200 : 404 });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
