// 兩支模擬手機（iPhone + Android）真的點畫面：開房 → 輸房號加入 → 抽牌 → 叫牌（含加倍）→ 打牌 → 結算
// 用法：先 npm run dev，再 node test/e2e/two-phones.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const shot = async (page, name) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); console.log("  📸", name); };

// 測正式網址、而且這台機器要走代理才出得去：HB_PROXY=http://代理位址
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
async function phone(device, label) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`[${label}] console: ${m.text()}`); });
  await page.goto(BASE);
  return page;
}

const DEV_A = process.env.HB_DEVICE_A ?? "iPhone 13", DEV_B = process.env.HB_DEVICE_B ?? "Pixel 7";
console.log(`房主：${DEV_A}　朋友：${DEV_B}`);
const A = await phone(DEV_A, "房主");
const B = await phone(DEV_B, "朋友");

// --- 開房：主選單 → 朋友連線 ---
await shot(A, "01-home");
await A.click("#goOnline");
// 第一次在這支手機按「朋友連線」會先問要不要跟阿禾學：選「我會玩，直接開始」
await A.waitForSelector("#storyOffer:not([hidden])");
console.log("✓ 第一次按朋友連線會先問要不要跟阿禾學");
await A.click("#offerSkip");
await A.waitForSelector("#online:not([hidden])");
await A.fill("#name", "阿明");
await A.click("#create");
await A.waitForSelector("#wait:not([hidden])");
const code = (await A.textContent("#bigCode")).trim();
console.log("✓ 房主開房，房號", code);
await sleep(600);
await shot(A, "02-waiting");

// --- 朋友輸入房號 ---
await B.click("#goOnline");
await B.waitForSelector("#storyOffer:not([hidden])");
await B.click("#offerSkip");
await B.waitForSelector("#online:not([hidden])");
await B.fill("#name", "小美");
await B.fill("#code", code.toLowerCase());     // 打小寫也要能進
await B.click("#join");
await Promise.all([A.waitForSelector("#wait:not([hidden])"), B.waitForSelector("#wait:not([hidden])")]);
await A.waitForFunction(() => document.getElementById("plateOpp").classList.contains("in") && !document.getElementById("readyBtn").disabled, null, { timeout: 5000 });
if (await A.isVisible("#table:not([hidden])")) { console.error("✗ 還沒按準備就進牌桌了"); process.exit(1); }
console.log("✓ 朋友輸入房號加入：兩邊都在等待室，不會自動開打");
if (!(await A.textContent("#plateMe small")).includes("房主") || !(await B.textContent("#plateOpp small")).includes("房主")) { console.error("✗ 房主標示不對"); process.exit(1); }
// 玩法：朋友點不動（玩法由房主選）；房主點籌碼對決會說還沒開放
await B.click('#modePick [data-mode="chips"]');
await B.waitForFunction(() => document.getElementById("banner").textContent.includes("房主選"), null, { timeout: 3000 });
await A.click('#modePick [data-mode="chips"]');
await A.waitForFunction(() => document.getElementById("banner").textContent.includes("籌碼對決還在做"), null, { timeout: 3000 });
if ((await A.getAttribute('#modePick [data-mode="classic"]', "aria-checked")) !== "true") { console.error("✗ 玩法被改掉了"); process.exit(1); }
console.log("✓ 玩法：朋友不能換、房主點籌碼對決會說還沒開放，維持經典牌局");
await shot(B, "02b-both-seated-B");
await A.click("#readyBtn");
await B.waitForFunction(() => document.querySelector("#plateOpp em").textContent.includes("準備好了"), null, { timeout: 4000 });
await A.waitForFunction(() => document.getElementById("readyBtn").textContent === "取消準備", null, { timeout: 3000 }).catch(() => { console.error("✗ 按了準備，按鈕沒變成取消準備"); process.exit(1); });
await shot(B, "02c-host-ready-B");
console.log("✓ 房主按準備：朋友那邊看到「準備好了」");
await B.click("#readyBtn");
await Promise.all([A.waitForSelector("#table:not([hidden])"), B.waitForSelector("#table:not([hidden])")]);
for (const P of [A, B]) await P.waitForFunction(() => document.getElementById("banner").textContent.includes("兩邊都準備好了"), null, { timeout: 4000 });
console.log("✓ 兩邊都按準備：一起進牌桌，看到「兩邊都準備好了，開打！」");
await sleep(900);
await shot(A, "03-draw-phase-A");

// --- 自動打：只透過點畫面 ---
const seen = new Set();
let doubled = false, plays = 0, bids = 0;
async function step(page, me) {
  if (await page.isVisible("#result:not([hidden])")) return "done";
  const turn = (await page.textContent("#turnLine")) ?? "";
  if (await page.isVisible("#bidPanel:not([hidden])")) {
    if (!(await page.isVisible("#bidPanel.mine"))) return "wait";
    if (!seen.has("bid")) { seen.add("bid"); await shot(page, `05-bidding-${me}`); }
    // 叫牌面板的三顆按鈕一定要看得到、點得到（沒被切掉或蓋住）
    for (const sel of ["#bidConfirm", "#bidPass", "#bidDouble"]) {
      const ok = await page.$eval(sel, el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.bottom <= innerHeight && r.height > 20 && (hit === el || el.contains(hit));
      });
      if (!ok) errors.push(`[${me}] 叫牌按鈕 ${sel} 被切掉或擋住`);
    }
    const none = !((await page.textContent("#bidContract")) ?? "").includes("現在最高");
    if (none) {
      // 1♦：先點階數、再點花色、看試算、再確定
      await page.locator("#bidLevels button:not([disabled])").first().click(); await sleep(120);
      await page.locator("#bidStrains button:not([disabled])").nth(1).click(); await sleep(250);
      if (!seen.has("preview")) { seen.add("preview"); await shot(page, `06-bid-preview-${me}`); }
      await page.click("#bidConfirm");
    } else if (!doubled && await page.isEnabled("#bidDouble")) {
      doubled = true;
      await page.click("#bidDouble");
      await sleep(350); await shot(page, `07-doubled-${me}`);
    } else await page.click("#bidPass");
    bids++;
    return "acted";
  }
  const legal = page.locator("#hand .card.legal");
  if (await legal.count() > 0 && /換你出牌|換你跟牌/.test(turn)) {
    // 手牌是疊在一起的，跟真人一樣點露出來的左邊那一條
    const id = await legal.first().getAttribute("data-id");
    const card = page.locator(`#hand .card[data-id="${id}"]`);   // 記住是哪一張，第二次點同一張
    await card.click({ position: { x: 10, y: 34 } }); await sleep(120);
    if (!seen.has("select")) { seen.add("select"); await shot(page, `04-card-selected-${me}`); }
    await page.click("#playBtn");                         // 選好之後按「確認出牌」才送出
    plays++;
    if (plays === 31 && !seen.has("play")) { seen.add("play"); await sleep(250); await shot(page, `08-play-phase-${me}`); }
    return "acted";
  }
  return "wait";
}

const t0 = Date.now();
let doneA = false, doneB = false;
while (!(doneA && doneB) && Date.now() - t0 < 240000) {
  const [ra, rb] = await Promise.all([step(A, "A"), step(B, "B")]);
  doneA = ra === "done"; doneB = rb === "done";
  if (ra !== "acted" && rb !== "acted") await sleep(150); else await sleep(350);
}
if (!(doneA && doneB)) { console.error("✗ 4 分鐘內沒打到結算", { plays, bids }); await shot(A, "zz-stuck-A"); await shot(B, "zz-stuck-B"); process.exit(1); }
await sleep(700);
await shot(A, "09-result-A");
await shot(B, "09-result-B");
const resA = await A.textContent("#resBody"), resB = await B.textContent("#resBody");
console.log(`✓ 兩支手機都打到結算（出牌 ${plays} 次、叫牌 ${bids} 次${doubled ? "、有加倍" : ""}）`);
console.log("  房主看到：", resA.replace(/\s+/g, " "));
console.log("  朋友看到：", resB.replace(/\s+/g, " "));
const sA = [await A.textContent("#myScore"), await A.textContent("#oppScore")];
const sB = [await B.textContent("#myScore"), await B.textContent("#oppScore")];
if (sA[0] !== sB[1] || sA[1] !== sB[0]) { console.error("✗ 兩邊分數不一致", sA, sB); process.exit(1); }
console.log(`✓ 兩邊分數一致：阿明 ${sA[0]} · 小美 ${sA[1]}`);
// 局勢衝擊：兩支手機看同一個伺服器確認的結果 → 每一墩的衝擊種類一樣、贏的一方相反、同一墩不會演兩次
// 「連贏延續」只在連贏的那一方升一級演出（對面看到的是壓力），比對時還原成規則算出的基本等級
const impacts = async P => P.evaluate(() => (globalThis.__hbFx || []).filter(x => x.kind === "impact").map(x => ({ tier: x.what === "trick" && x.tier === 2 ? 1 : x.tier, what: x.what, mine: x.mine })));
const [ia, ib] = [await impacts(A), await impacts(B)];
const same = ia.length === ib.length && ia.every((x, k) => x.what === ib[k].what && x.tier === ib[k].tier && x.mine !== ib[k].mine);
if (!same || ia.length !== 26) { console.error("✗ 兩邊的局勢衝擊不一致或有重播", ia.length, ib.length); process.exit(1); }
console.log(`✓ 兩邊的局勢衝擊一致：26 墩各演一次（Tier ${[0, 1, 2, 3, 4].map(t => ia.filter(x => x.tier === t).length).join("/")}），贏的一方剛好相反`);

// --- 下一局、重新整理也回得來 ---
// 一局就有人到 100 分（例如被加倍倒很多墩）時，按鈕是「再來一場」：新的一場從第 1 局開始
const matchOver = (await B.textContent("#nextBtn")).includes("再來一場");
await B.click("#nextBtn");
if (matchOver) {
  // 整場打完：兩個人都按「再來一場」才開
  await A.waitForFunction(() => document.getElementById("nextBtn").textContent.includes("想再來一場"), null, { timeout: 5000 });
  await A.click("#nextBtn");
}
await A.waitForFunction(want => document.querySelector("#handNo")?.textContent?.includes(want) && document.getElementById("phaseText")?.textContent?.includes("搶牌"), matchOver ? "第 1 局" : "第 2 局", { timeout: 8000 });
console.log(matchOver ? "✓ 整場打完，朋友按「再來一場」，兩邊都進到新的一場" : "✓ 朋友按「下一局」，兩邊都進到第 2 局");
await B.reload();
await B.waitForSelector("#table:not([hidden])", { timeout: 8000 });
await sleep(500);
const handAfter = await B.locator("#hand .card").count();
console.log(`✓ 朋友重新整理網頁，直接回到牌桌（手上 ${handAfter} 張）`);
await shot(B, "10-after-reload-B");

// 朋友連線：對面是真人，畫面上不會冒出阿禾的名字、郵票或台詞
for (const [P, n] of [[A, "房主"], [B, "朋友"]]) {
  const ahe = await P.evaluate(() => ({
    quip: document.getElementById("quip").textContent, name: document.getElementById("oppName").textContent,
    stamp: document.getElementById("oppStamp").getAttribute("src"),
  }));
  if (ahe.quip || ahe.name === "阿禾" || ahe.stamp.includes("ahe")) { console.error(`✗ ${n}的畫面出現阿禾：`, ahe); process.exit(1); }
}
console.log("✓ 朋友連線時兩邊都看不到阿禾（名字、郵票、台詞都沒有）");

await browser.close();
if (errors.length) { console.error("✗ 頁面有錯誤：\n" + errors.join("\n")); process.exit(1); }
console.log("✓ 兩支手機全程沒有任何頁面錯誤");
