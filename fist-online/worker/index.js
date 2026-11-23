// worker/index.js — 獨立部署版入口（主站已內建同一套：/fist/ 底下）
//   房間伺服器與路由的程式在 web/src/server/fist/，兩邊共用同一份
import { handleFist } from "../../web/src/server/fist/route.js";
export { GameRoom } from "../../web/src/server/fist/gameRoom.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, time: Date.now() }), { headers: { "content-type": "application/json" } });
    return (await handleFist(req, env.ROOMS)) ?? env.ASSETS.fetch(req);
  },
};
