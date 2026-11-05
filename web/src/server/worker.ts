// 入口：網頁檔案由 Cloudflare 靜態資源直接送；/api/* 才進到這裡
//   POST /api/rooms            開房，回傳 { code }
//   GET  /api/rooms/:code      查房間在不在、有沒有空位
//   GET  /api/rooms/:code/ws   WebSocket，進到那個房間
import { CODE_ALPHABET, CODE_LENGTH, isValidCode, normalizeCode } from "./protocol";
import { Env, Room } from "./room";

export { Room };

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);   // ["api","rooms",code,"ws"]

    if (parts[0] !== "api") return env.ASSETS.fetch(req);

    if (parts[1] === "rooms" && parts.length === 2 && req.method === "POST") {
      for (let i = 0; i < 12; i++) {
        const code = newCode();
        const res = await roomStub(env, code).fetch("https://room/init", { method: "POST", body: code });
        if (res.status === 201) return Response.json({ code });
      }
      return Response.json({ error: "房間太多了，請再試一次" }, { status: 503 });
    }

    if (parts[1] === "rooms" && parts[2]) {
      const code = normalizeCode(parts[2]);
      if (!isValidCode(code)) return Response.json({ exists: false }, { status: 404 });
      const stub = roomStub(env, code);
      if (parts[3] === "ws") {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("需要 WebSocket", { status: 426 });
        return stub.fetch(req);
      }
      if (parts.length === 3) return stub.fetch("https://room/info");
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
