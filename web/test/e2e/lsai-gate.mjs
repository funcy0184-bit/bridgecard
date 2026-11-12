// 梭了啦單人測試的入口開關（LS_AI=dev，Cloudflare 自動部署的預設）：
//   一般玩家看不到「跟 AI 試打一局」，直接打 /?lsai=1 也進不去；這支手機開過 /?dev=1 才出現；/?dev=0 收回去
// 用法：LS_AI=dev npm run build，再 npx wrangler dev，然後 node test/e2e/lsai-gate.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const b = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const p = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
await p.goto(BASE + "/?play=shuo"); await p.waitForSelector("#shuo:not([hidden])");
ok(await p.isHidden("#shuoAi"), "一般玩家：梭了啦選單看不到「跟 AI 試打一局」");
await p.goto(BASE + "/?lsai=1"); await p.waitForTimeout(600);
ok(await p.isHidden("#lstable") && await p.isHidden("#wait") && (await p.evaluate(() => globalThis.__hbLsAi?.() ?? null)) === null, "直接打 /?lsai=1：進不去單人測試");
await p.goto(BASE + "/?dev=1&play=shuo"); await p.waitForSelector("#shuo:not([hidden])");
ok(await p.isVisible("#shuoAi"), "開過 /?dev=1：這支手機出現入口");
await p.goto(BASE + "/?play=shuo"); await p.waitForSelector("#shuo:not([hidden])");
ok(await p.isVisible("#shuoAi"), "之後不用再帶 dev=1（記在這支手機）");
await p.goto(BASE + "/?dev=0&play=shuo"); await p.waitForSelector("#shuo:not([hidden])");
ok(await p.isHidden("#shuoAi"), "/?dev=0：收回去");
await b.close();
console.log(fails ? `\n${fails} 項沒過` : "\n單人測試入口開關驗收全部通過");
process.exit(fails ? 1 : 0);
