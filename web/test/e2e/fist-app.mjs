// 拳刃交鋒（模組版）瀏覽器驗收：大廳四入口、四關教學用鍵盤打通（v3：過熱／彈反／拼刀／紅招）、三難度 AI 對戰、同機雙人（鍵位卡、過熱卡、拼刀卡、出招提示開關）、
//   線上對戰雙開瀏覽器（建房、邀請連結、READY 倒數、藏招封包保密、斷線暫停與重連、離開房間）
//   先起後端（同時提供前端靜態檔）：cd fist-online && npx wrangler dev --port 8790
//   node test/e2e/fist-app.mjs http://127.0.0.1:8790/ [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8790/", OUT = process.argv[3] ?? "";
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, permissions: ["clipboard-read", "clipboard-write"] });
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
const tw = (f, ms = 8000) => P.waitForFunction(f, null, { timeout: ms, polling: 10 }).catch(() => {});
await P.click('[data-go="tutorial"]'); await sleep(300);
ok(await P.isVisible("#skipTut") && await P.isVisible("#objective"), "右上角有「跳過教學」、頂部一行目標");
ok((await objective()).startsWith("1/4") && (await objective()).includes("石頭"), `關卡 1 目標：${await objective()}`);
await shot("tut1");
await tw(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.fighters[1].stance === "rock");
await key("d");                                                     // 布剋石頭
await tw(() => __fist.view?.phase === "PHASE_REVEAL");
ok(await P.evaluate(() => __fist.view.rps?.winner === 0), "開牌停頓：布壓制石頭");
await tw(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.fighters[0].heat === "paper");
await sleep(80);
const heatCard = await P.evaluate(() => { const c = document.querySelector('.kgroup[data-seat="0"] .kcard[data-btn="R"]'); return { cls: c.className, label: c.querySelector(".kl").textContent }; });
ok(heatCard.cls.includes("heat") && heatCard.label === "♨️ 過熱" && (await objective()).includes("過熱"), `第二輪：布過熱，鍵位卡反灰蓋「${heatCard.label}」`);
await shot("tut1-heat");
await key("d");
ok(await P.evaluate(() => __fist.view.fighters[0].stance === null), "按過熱的布：鎖住出不了");
await tw(() => __fist.view.fighters[1].stance === "scissors");
await key("a");                                                     // 石頭剋剪刀
await tw(() => document.getElementById("objective").textContent.startsWith("2/4"));
ok((await objective()).startsWith("2/4"), `改出石頭剋剪刀 → 關卡 2：${await objective()}`);
await waitPh("PHASE_MASH");
for (let i = 0; i < 12; i++) { await key(["a", "s", "d"][i % 3], 15); await sleep(10); }
await tw(() => document.getElementById("objective").textContent.includes("防守"));
ok((await objective()).includes("防守"), "打滿 4 次追加 → 換防守");
await waitPh("PHASE_FINISHER_WINDOW"); await sleep(400); await shot("tut2-blue");
await key("a");                                                     // 0.4s 才按也來得及
await tw(() => document.getElementById("objective").textContent.startsWith("3/4"));
ok((await objective()).startsWith("3/4"), `慢動作 0.8s 內彈反 → 關卡 3：${await objective()}`);
await tw(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.fighters[1].stance === "rock");
ok(await P.evaluate(() => __fist.view.gauge === 1), "關卡 3：蓄力從 ⚔️ 1/2 開始");
await key("a");                                                     // 故意平手
await waitPh("PHASE_CLASH_INPUT");
await sleep(150); await shot("tut3-clash");
for (const k of ["a", "s", "d", "a", "s"]) await key(k, 25);
await tw(() => __fist.view?.clash?.first === 0, 3000);
ok(await P.evaluate(() => __fist.view.clash?.first === 0 && __fist.view.clash.count[0] === 5), "搶先填完 5 格：⚡ 先手");
await waitPh("PHASE_CLASH_ANIM"); await sleep(1300); await shot("tut3-cuts");
await tw(() => document.getElementById("objective").textContent.startsWith("4/4"), 12000);
ok((await objective()).startsWith("4/4"), `看完五刀對砍 → 關卡 4：${await objective()}`);
await waitPh("PHASE_FINISHER_WINDOW"); await sleep(120); await shot("tut4-red");
const v4 = await V();
ok(v4.f[0].pos === 7 && v4.f[0].power === 0 && v4.f[0].damage >= 125 && v4.r.type === "red" && JSON.stringify(v4.r.dirs) === "[-1]", "關卡 4：格 7、瀕死、0 氣、紅招只亮 ◀");
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
  while (Date.now() - t0 < 20000 && rounds < 1) {
    const v = await V();
    if (!v) { await sleep(50); continue; }
    if (v.phase === "PHASE_RPS" && v.t > 0.2 && v.t < 0.3) await key(["a", "s", "d"][Math.floor(Math.random() * 3)]);
    if (v.phase === "PHASE_MASH" && v.r?.att === 0) await key(["a", "s", "d"][Math.floor(Math.random() * 3)], 15);
    if (v.f[1].stance && v.phase === "PHASE_RPS" && v.t < 2.2) aiActed = true;
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
const cards = seat => P.evaluate(s => { const g = document.querySelector(`.kgroup[data-seat="${s}"]`); return { mash: !g.querySelector(".kmash").hidden, cards: [...g.querySelectorAll(".kcard")].map(c => ({ label: c.querySelector(".kl").textContent, cls: c.className, key: c.querySelector(".kk").textContent })) }; }, seat);
await sleep(60);
const m0 = await cards(0), m1 = await cards(1);
ok(m0.mash && m1.cards.every(c => c.cls.includes("locked")), "連打：攻方 P1 變成「🔥 狂敲連打！」大卡、守方 P2 三張鎖住");
await shot("local2p-mash");
await waitPh("PHASE_FINISHER_WINDOW");
let w1 = await cards(1);
ok(w1.cards.map(c => c.label).join("|") === "✊ 石頭|✌️ 剪刀|🖐️ 布" && w1.cards[2].cls.includes("parry"), `藍招（石頭）：守方 P2 的克制鍵「🖐️ 布 / ${w1.cards[2].key}」發光`);
const coach2p = await P.textContent("#coach");
ok(await P.isVisible("#coach") && coach2p.includes("P2") && coach2p.includes("彈反"), `新手引導（同機）：${coach2p}`);
await P.click("#gearBtn");
await P.click('#settingsPop [data-go="hints"]');
await sleep(60); w1 = await cards(1);
ok(!w1.cards.some(c => c.cls.includes("parry")) && (await P.textContent('#settingsPop [data-go="hints"]')).includes("關"), "⚙️ 出招提示：關 → 克制鍵不再發光");
await P.click('#settingsPop [data-go="hints"]');
await P.click('#settingsPop [data-go="guide"]'); await sleep(60);
ok(await P.isHidden("#coach"), "⚙️ 新手引導：關 → 提示那一行消失");
await P.click('#settingsPop [data-go="guide"]'); await P.click("#gearBtn");
ok(await P.evaluate(() => __fist.showHints && __fist.renderer.showHints), "再按一次：提示開回來（存在這台瀏覽器）");
// 紅招：守方站崖邊只亮可翻滾的方向
await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 6, power: 2 }, { pos: 7, power: 0, damage: 110 }], phase: "PHASE_FINISHER_WINDOW", round: { att: 0, red: true } }));
await sleep(60); const r1 = await cards(1);
ok(r1.cards[0].label === "◀ 左翻" && !r1.cards[0].cls.includes("locked") && r1.cards[1].cls.includes("locked") && r1.cards[2].cls.includes("locked"), "紅招：守方只亮「◀ 左翻」，中、右鎖住");
await shot("local2p-red");
// 猜拳：過熱的鍵反灰、按下去抖一下；正常的鍵按下有壓縮回饋
await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 1, heat: "paper" }, { pos: 5, power: 1, heat: "rock" }], phase: "PHASE_RPS" }));
await sleep(80);
let h0 = await cards(0), h1 = await cards(1);
ok(h0.cards[2].cls.includes("heat") && h0.cards[2].label === "♨️ 過熱" && h1.cards[0].cls.includes("heat"), "P1 過熱布、P2 過熱石：各自那張卡反灰蓋「♨️ 過熱」");
await P.keyboard.down("d"); const nope = await P.evaluate(() => document.querySelector('.kgroup[data-seat="0"] .kcard[data-btn="R"]').className); await P.keyboard.up("d");
await P.keyboard.down("a"); const pressed = await P.evaluate(() => document.querySelector('.kgroup[data-seat="0"] .kcard[data-btn="L"]').className); await P.keyboard.up("a");
await P.waitForFunction(() => __fist.view.fighters[0].stance === "rock", null, { timeout: 1000 }).catch(() => {});   // 引擎下一幀才處理按鍵
ok(nope.includes("nope") && pressed.includes("pressed") && await P.evaluate(() => __fist.view.fighters[0].stance === "rock"), "按過熱的布：卡片抖一下不算；按石頭：壓縮回饋、出石頭");
await shot("local2p-heat");
// 拼刀預輸入：三張都能按（過熱不限制），顯示填了幾格
await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 1, heat: "paper" }, { pos: 5, power: 1 }], phase: "PHASE_CLASH_INPUT" }));
await sleep(80); await key("d", 20); await sleep(60);
h0 = await cards(0);
ok(h0.cards.every(c => !c.cls.includes("heat") && !c.cls.includes("locked")) && (await P.evaluate(() => document.querySelector('.kgroup[data-seat="0"] .kcard[data-btn="M"] .ksub').textContent)) === "劍格 1/5", "拼刀：三張卡都能按（過熱不限制），顯示「劍格 1/5」");
await P.keyboard.press("Escape"); await sleep(150);

console.log("線上對戰：雙開瀏覽器");
await P.click('[data-go="online"]');
await P.fill("#roomInput", "ab1");
await P.click('[data-go="join"]');
ok((await P.textContent("#roomError")).includes("4 碼"), "房號格式錯誤有提示");
// P 的 WebSocket 收到的每一則訊息都記下來（檢查藏招期間有沒有偷漏）
const framesP = [];
P.on("websocket", ws => ws.on("framereceived", f => { try { framesP.push(JSON.parse(f.payload)); } catch {} }));
await P.fill("#nameInput", "阿鋒");
await P.click('[data-go="create"]');
await P.waitForFunction(() => __fist.net?.seat === 0, null, { timeout: 8000 });
const room = await P.textContent("#rcCode"), link = await P.textContent("#rcLink");
ok(/^[A-HJ-NP-Z2-9]{4}$/.test(room) && P.url().endsWith(`?room=${room}`) && link === new URL(`?room=${room}`, BASE).href, `建立房間 ${room}：房主自動入座 P1，網址與邀請連結 ${link}`);
await P.click("#rcCopy");
ok((await P.evaluate(() => navigator.clipboard.readText())) === link && (await P.textContent("#rcCopy")).includes("已複製"), "一鍵複製邀請連結");
const P2 = await ctx.newPage(); P2.on("pageerror", e => errors.push(String(e)));
await P2.addInitScript(() => localStorage.setItem("fist.name", "翠嵐"));      // 朋友自己的暱稱（同一個瀏覽器測試用）
await P2.goto(link);
await P2.waitForFunction(() => __fist.net?.seat === 1, null, { timeout: 8000 });
ok(true, "朋友點開連結：自動帶入房號、直接加入成為 P2");
await P.waitForFunction(() => document.getElementById("seat1").classList.contains("on"), null, { timeout: 4000 });
ok((await P.textContent("#seat1")).includes("準備中") && (await P2.textContent("#seat1")).includes("（你）"), "雙方都看到 P1／P2 位置與連線狀態");
await P.waitForFunction(() => document.getElementById("seat1").textContent.includes("翠嵐"), null, { timeout: 3000 }).catch(() => {});
ok((await P.textContent("#seat0")).includes("阿鋒（你）") && (await P.textContent("#seat1")).includes("翠嵐") && (await P2.textContent("#seat0")).includes("阿鋒"), "雙方看到彼此暱稱：阿鋒 vs 翠嵐");
ok(await P.isVisible("#rcGuideBox") && (await P2.textContent("#rcGuide")).includes("新手引導 開"), "房主看到新手引導勾選框、朋友看到「房主設定：新手引導 開」");
await P.uncheck("#rcGuideBox");
await P2.waitForFunction(() => document.getElementById("rcGuide").textContent.includes("新手引導 關"), null, { timeout: 3000 }).catch(() => {});
ok((await P2.textContent("#rcGuide")).includes("新手引導 關"), "房主關掉引導：朋友那邊同步變「關」");
await P2.click("#gearBtn"); await P2.click('#settingsPop [data-go="guide"]'); await P2.click("#gearBtn");
ok(await P2.evaluate(() => __fist.guide) && !(await P.evaluate(() => __fist.guide)), "朋友在 ⚙️ 只把自己的引導打開（房主那邊維持關）");
await P.waitForFunction(() => /\d+ ms/.test(document.getElementById("ping").textContent), null, { timeout: 4000 });
ok(true, `角落顯示延遲：${await P.textContent("#ping")}`);
await shot("online-lobby");
await P.click("#rcReady");
await P2.waitForFunction(() => document.getElementById("seat0").classList.contains("ready"), null, { timeout: 3000 });
ok(true, "P1 按 READY：P2 畫面看到 READY ✔");
await P2.click("#rcReady");
await P.waitForFunction(() => !document.getElementById("countdown").hidden, null, { timeout: 3000 });
ok(/^[123]$/.test(await P.textContent("#countdown")), `雙方 READY：倒數 ${await P.textContent("#countdown")}…`);
await P2.waitForFunction(() => !document.getElementById("countdown").hidden, null, { timeout: 3000 });
ok(await P2.isVisible("#flowStrip") && await P.isHidden("#flowStrip"), `倒數時：開引導的人看到流程「${await P2.textContent("#flowStrip")}」，關的人沒有`);
await P.screenshot({ path: OUT ? `${OUT}/online-countdown.png` : "/dev/null" }).catch(() => {});
await P.waitForFunction(() => __fist.view?.phase === "PHASE_RPS", null, { timeout: 6000 });
await P2.waitForFunction(() => __fist.view?.phase === "PHASE_RPS", null, { timeout: 2000 });
ok(await P.isHidden("#room") && await P.isHidden("#countdown"), "開戰：房間面板收起");
ok((await P.textContent(".kcap")).includes("P1") && (await P2.textContent(".kcap")).includes("P2"), "鍵位卡標出自己是 P1／P2");
await P2.waitForFunction(() => !document.getElementById("coach").hidden, null, { timeout: 3000 }).catch(() => {});
ok((await P2.textContent("#coach")).includes("猜拳") && await P.isHidden("#coach"), `開戰：朋友看到引導「${await P2.textContent("#coach")}」、房主沒有`);
await P2.click("#emoteBtn"); await P2.click('[data-go="emote:3"]');
await P.waitForFunction(() => __fist.renderer.fx.some(p => p.k === "emote" && p.seat === 1 && p.text === "🔥"), null, { timeout: 3000 }).catch(() => {});
ok(await P.evaluate(() => __fist.renderer.fx.some(p => p.k === "emote" && p.seat === 1 && p.text === "🔥")) && await P2.isHidden("#emoteTray"), "朋友點 😀 → 🔥：房主畫面上朋友頭頂冒出 🔥");
await P.keyboard.press("Digit1");
await P2.waitForFunction(() => __fist.renderer.fx.some(p => p.k === "emote" && p.seat === 0 && p.text === "😂"), null, { timeout: 3000 }).catch(() => {});
ok(await P2.evaluate(() => __fist.renderer.fx.some(p => p.k === "emote" && p.seat === 0)), "鍵盤 1～8 也能發表情（房主按 1 → 😂）");
await shot("online-emote");
console.log("線上：藏招封包保密");
await P.waitForFunction(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.t > 0.15, null, { timeout: 8000, polling: 10 });
await P2.keyboard.down("d"); await sleep(30); await P2.keyboard.up("d");                   // P2 亮布
await P.waitForFunction(() => __fist.view.fighters[1].stance === "paper", null, { timeout: 2000 });
ok(true, "亮招期：P2 擺『布』，P1 畫面即時看到");
await P.keyboard.down("a"); await sleep(30); await P.keyboard.up("a");                     // P1 石頭
await P2.waitForFunction(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.t > __fist.view.reveal + 0.08, null, { timeout: 4000, polling: 5 });
const mark = framesP.length;
await P2.keyboard.down("s"); await sleep(30); await P2.keyboard.up("s");                   // 藏招期偷換剪刀
await P.waitForFunction(() => __fist.view?.phase !== "PHASE_RPS", null, { timeout: 3000 });
const hiddenFrames = framesP.slice(mark).filter(m => m.t === "state" && m.view.phase === "PHASE_RPS");
ok(hiddenFrames.length > 0 && !hiddenFrames.some(m => JSON.stringify(m).includes("scissors")), `藏招期間 P1 收到 ${hiddenFrames.length} 則封包，完全沒有 P2 換的『剪刀』`);
const result = framesP.flatMap(m => m.t === "state" ? m.events : []).find(e => e.type === "rps_result");
ok(result?.stances?.join() === "rock,scissors", `鎖定結算才公佈：${result?.stances}（石頭贏剪刀）`);
console.log("線上：斷線暫停 → 重連接續");
await P.waitForFunction(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.t < 1, null, { timeout: 15000 });
const before2 = await P2.evaluate(() => __fist.view.fighters.map(f => [f.damage, f.stocks]));
await P2.evaluate(() => { const t = __fist.transport; t.connect = () => {}; t.ws.close(); });   // P2 斷線（不讓它自動重連）
await P.waitForFunction(() => !document.getElementById("pauseBox").hidden, null, { timeout: 4000 });
ok(/對手斷線，等待重連 1[0-5] 秒\.\.\./.test(await P.textContent("#pauseBox")), `P1 畫面：${await P.textContent("#pauseBox")}`);
await shot("online-paused");
await P2.reload();
await P2.waitForFunction(() => __fist.net?.seat === 1 && __fist.view, null, { timeout: 8000 });
await P.waitForFunction(() => document.getElementById("pauseBox").hidden, null, { timeout: 4000 });
const after2 = await P2.evaluate(() => __fist.view.fighters.map(f => [f.damage, f.stocks]));
ok(JSON.stringify(before2) === JSON.stringify(after2), `重整後帶同一個 token 回到 P2，對戰無縫接續（${JSON.stringify(after2)}）`);
console.log("線上：離開房間");
await P2.click('#game [data-go="menu"]');
await P.waitForFunction(() => !document.getElementById("room").hidden, null, { timeout: 4000 });
ok((await P.textContent("#rcHead")).includes("對手離開") && (await P.textContent("#seat1")).includes("等待加入"), `對手離開：${await P.textContent("#rcHead")}`);
ok(!P2.url().includes("room="), "離開的人回到大廳、網址清掉房號");
{
  const c2 = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const G = await c2.newPage(); G.on("pageerror", e => errors.push(String(e)));
  await G.goto(link);
  await G.waitForFunction(() => !document.getElementById("online").hidden, null, { timeout: 4000 }).catch(() => {});
  ok(await G.isVisible("#online") && (await G.textContent("#roomError")).includes("先取個暱稱") && (await G.inputValue("#roomInput")) === room, "沒填過暱稱的朋友點連結：先停在填暱稱畫面、房號已帶好");
  await c2.close();
}
const P3 = await ctx.newPage(); P3.on("pageerror", e => errors.push(String(e)));
await P3.goto(new URL("?room=ZZZZ", BASE).href);
await P3.waitForFunction(() => document.getElementById("rcMsg").textContent.includes("找不到"), null, { timeout: 5000 });
ok(true, `不存在的房號：${await P3.textContent("#rcMsg")}`);
await P3.close(); await P2.close();
await P.click('#game [data-go="menu"]');

ok(errors.length === 0, `沒有頁面錯誤${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
