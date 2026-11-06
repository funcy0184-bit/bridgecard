// 打包手機端：主程式 app.js、故事頁 story.js。
// 版本號：Cloudflare 部署時用那一次的 commit（WORKERS_CI_COMMIT_SHA），在自己電腦上用 git；都沒有就是 dev。
// 版本號會顯示在「設定」最下面，回報問題時一起附上，就知道你看到的是哪一版。
import { build } from "esbuild";
import { execSync } from "node:child_process";

let sha = process.env.WORKERS_CI_COMMIT_SHA || "";
if (!sha) { try { sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { sha = "dev"; } }
const stamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const define = { __BUILD__: JSON.stringify({ sha: sha.slice(0, 7), at: stamp }) };
const common = { bundle: true, format: "esm", target: "es2020", minify: true, sourcemap: true, define, logLevel: "info" };
await build({ ...common, entryPoints: ["src/client/main.ts"], outfile: "public/app.js" });
await build({ ...common, entryPoints: ["src/story/main.ts"], outfile: "public/story/story.js" });
