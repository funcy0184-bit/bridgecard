// 拳刃交鋒（模組版）瀏覽器驗收：大廳四入口、四關教學用鍵盤打通、三難度 AI 對戰、同機雙人、線上房間 UI 與 ?room= 偵測
//   ES Modules 要用 http 開：先在 web/public 起靜態伺服器（例如 python3 -m http.server 8811），再跑
//   node test/e2e/fist-app.mjs http://127.0.0.1:8811/fist/ [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8811/fist/", OUT = process.argv[3] ?? "";
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
const P = await ctx.newPage();
const errors = []; P.on("pageerror", e => errors.push(String(e))); P.on("console", m => { if (m.type() === "error" && !/WebSocket|ws:\/\/|fighter_p|404/.test(m.text())) errors.push(m.text()); });
const shot = async n => { if (OUT) await P.screenshot({ path: `${OUT}/${n}.png` }); };
const V = () => P.evaluate(() => { const v = __fist.view; return v && { phase: v.phase, t: v.t, f: v.fighters.map(f => ({ pos: f.pos, power: f.power, damage: f.damage, stun: f.stun, stance: f.stance })), r: v.round }; });
const waitPh = (ph, ms = 8000) => P.waitForFunction(p => __fist.view?.phase === p, ph, { timeout: ms, polling: 10 });
const key = async (k, hold = 40) => { await P.keyboard.down(k); await sleep(hold); await P.keyboard.up(k); };
const objective = () => P.textContent("#objective");

await P.goto(BASE);
console.log("大廳");
ok(await P.isVisible("#menu"), "開場是主選單");
for (const t of ["互動教學道場", "單人對戰 AI", "同機雙人", "線上對戰"]) ok((await P.textContent("#menu")).includes(t), `入口：${t}`);
await shot("menu");

console.log("互動教學道場（用鍵盤打通四關）");
await P.click('[data-go="tutorial"]'); await sleep(300);
ok(await P.isVisible("#skipTut") && await P.isVisible("#objective"), "右上角有「跳過教學」、頂部一行目標");
ok((await objective()).includes("走一步"), `關卡 1 目標：${await objective()}`);
await shot("tut1");
await key("d"); await sleep(250);
ok((await objective()).includes("連走 2 步"), "走一步之後：換下一個目標（連走兩步）");
await waitPh("PHASE_MOVE"); await P.waitForFunction(() => __fist.view.t < 0.2, null, { polling: 10 });
await key("a"); await sleep(220); await key("a"); await sleep(250);
ok((await objective()).includes("硬直"), "第 2 步落地：看到硬直目標");
await shot("tut1-stun");
await P.waitForFunction(() => document.getElementById("objective").textContent.startsWith("2/4"), null, { timeout: 5000 }).catch(() => {});
ok((await objective()).startsWith("2/4"), `關卡 2：${await objective()}`);
await P.waitForFunction(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.fighters[1].stance === "rock", null, { timeout: 4000 });
await shot("tut2");
await key("d");
await P.waitForFunction(() => document.getElementById("objective").textContent.startsWith("3/4"), null, { timeout: 5000 }).catch(() => {});
ok((await objective()).startsWith("3/4"), `出布贏石頭 → 關卡 3：${await objective()}`);
await waitPh("PHASE_MASH");
for (let i = 0; i < 12; i++) { await key(["a", "s", "d"][i % 3], 15); await sleep(10); }
await shot("tut3-mash");
await P.waitForFunction(() => document.getElementById("objective").textContent.includes("防守"), null, { timeout: 5000 }).catch(() => {});
ok((await objective()).includes("防守"), "打滿 4 次追加 → 換防守");
await waitPh("PHASE_FINISHER_WINDOW"); await sleep(80); await shot("tut3-blue");
await key("a");
await P.waitForFunction(() => document.getElementById("objective").textContent.startsWith("4/4"), null, { timeout: 6000 }).catch(() => {});
ok((await objective()).startsWith("4/4"), `彈反成功 → 關卡 4：${await objective()}`);
await waitPh("PHASE_FINISHER_WINDOW"); await sleep(120); await shot("tut4-red");
const v4 = await V();
ok(v4.f[0].pos === 7 && v4.f[0].power === 0 && v4.f[0].damage === 110 && v4.r.type === "red" && JSON.stringify(v4.r.dirs) === "[-1]", "關卡 4：格 7、110%、0 氣、紅招只亮 ◀");
await key("a");
await P.waitForFunction(() => document.getElementById("menu").hidden === false, null, { timeout: 8000 }).catch(() => {});
ok(await P.isVisible("#menu"), "四關完成：回到大廳");

console.log("跳過教學");
await P.click('[data-go="tutorial"]'); await sleep(200); await P.click("#skipTut");
await P.waitForFunction(() => !document.getElementById("menu").hidden, null, { timeout: 3000 }).catch(() => {});
ok(await P.isVisible("#menu"), "按「跳過教學」回到大廳");

console.log("單人對戰 AI（三難度）");
for (const lv of ["easy", "mid", "master"]) {
  await P.click('[data-go="difficulty"]'); await P.click(`[data-go="ai:${lv}"]`); await sleep(200);
  // 玩家亂按，打到有一回合結算
  const t0 = Date.now(); let rounds = 0, aiActed = false;
  while (Date.now() - t0 < 12000 && rounds < 2) {
    const v = await V();
    if (!v) { await sleep(50); continue; }
    if (v.phase === "PHASE_RPS" && v.t > 0.2 && v.t < 0.3) await key(["a", "s", "d"][Math.floor(Math.random() * 3)]);
    if (v.phase === "PHASE_MASH" && v.r?.att === 0) await key(["a", "s", "d"][Math.floor(Math.random() * 3)], 15);
    if (v.f[1].stance && v.phase === "PHASE_RPS" && v.t < 1.3) aiActed = true;
    const done = await P.evaluate(() => __fist.view?.phase === "PHASE_RESOLVE");
    if (done) { rounds++; await P.waitForFunction(() => __fist.view?.phase !== "PHASE_RESOLVE", null, { timeout: 4000 }).catch(() => {}); }
    await sleep(30);
  }
  ok(rounds >= 1 && aiActed, `${lv}：AI 有出招、打完 ${rounds} 回合攻防`);
  if (lv === "master") await shot("ai-master");
  await P.keyboard.press("Escape"); await sleep(150);
}

console.log("同機雙人");
await P.click('[data-go="local2p"]'); await waitPh("PHASE_RPS");
await sleep(150); await key("a"); await key("k");
await waitPh("PHASE_MASH");
const v2 = await V();
ok(v2.r.att === 0, "P1 按 A（石）、P2 按 K（剪）：P1 贏拳進連打");
await shot("local2p-mash");
await P.keyboard.press("Escape"); await sleep(150);

console.log("線上對戰（後端還沒上線）");
await P.click('[data-go="online"]');
await P.fill("#roomInput", "ab1");
await P.click('[data-go="join"]');
ok((await P.textContent("#roomError")).includes("4 碼"), "房號格式錯誤有提示");
await P.click('[data-go="create"]'); await sleep(600);
const url = P.url();
ok(/[?&]room=[A-Z2-9]{4}/.test(url), `建立房間：網址帶房號（${url.split("?")[1]}）`);
ok(await P.isVisible("#netStatus"), `連線狀態：${await P.textContent("#netStatus")}`);
await P.keyboard.press("Escape");
const P2 = await ctx.newPage(); P2.on("pageerror", e => errors.push(String(e)));
await P2.goto(BASE + "?room=QW3E"); await sleep(500);
ok(await P2.isVisible("#game") && (await P2.textContent("#modeTag")).includes("QW3E"), "網址帶 ?room=QW3E：自動進那個房間");
await P2.close();

ok(errors.length === 0, `沒有頁面錯誤${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
