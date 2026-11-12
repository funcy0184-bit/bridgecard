// 打包手機端：主程式 app.js、故事頁 story.js。
// 版本號：Cloudflare 部署時用那一次的 commit（WORKERS_CI_COMMIT_SHA），在自己電腦上用 git；都沒有就是 dev。
// 版本號會顯示在「設定」最下面，回報問題時一起附上，就知道你看到的是哪一版。
import { build } from "esbuild";
import { execSync } from "node:child_process";

let sha = process.env.WORKERS_CI_COMMIT_SHA || "";
if (!sha) { try { sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { sha = "dev"; } }
const stamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
// 梭了啦 單人測試（真人 vs 測試 AI，開發者用）：on 入口一直在／dev 這支手機開過 /?dev=1 才出現／off 整段不打包
// 沒指定時：自己電腦上 on；Cloudflare 自動部署（有 WORKERS_CI_COMMIT_SHA）dev。在 Workers Builds 的建置變數設 LS_AI 就能改
const lsAi = ["on", "dev", "off"].includes(process.env.LS_AI ?? "") ? process.env.LS_AI : process.env.WORKERS_CI_COMMIT_SHA ? "dev" : "on";
const define = { __BUILD__: JSON.stringify({ sha: sha.slice(0, 7), at: stamp }), __LS_AI__: JSON.stringify(lsAi) };
console.log(`梭了啦單人測試入口：${lsAi}`);
const common = { bundle: true, format: "esm", target: "es2020", minify: true, sourcemap: true, define, logLevel: "info" };
// LS_AI=off：把單人測試換成空的替身（程式碼完全不進正式版的 app.js）
const lsAiOff = { name: "ls-ai-off", setup(b) { if (lsAi === "off") b.onResolve({ filter: /\/laststand-solo$/ }, () => ({ path: new URL("../src/client/laststand-solo-off.ts", import.meta.url).pathname })); } };
await build({ ...common, entryPoints: ["src/client/main.ts"], outfile: "public/app.js", plugins: [lsAiOff] });
await build({ ...common, entryPoints: ["src/story/main.ts"], outfile: "public/story/story.js" });
