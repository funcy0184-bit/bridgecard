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

const browser = await chromium.launch();
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
await Promise.all([A.waitForSelector("#table:not([hidden])"), B.waitForSelector("#table:not([hidden])")]);
console.log("✓ 朋友輸入房號加入，兩邊都進到牌桌");
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
    const none = !((await page.textContent("#bidContract")) ?? "").includes("目前");
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
  if (await legal.count() > 0 && /輪到你(出|跟)牌/.test(turn)) {
    // 手牌是疊在一起的，跟真人一樣點露出來的左邊那一條
    const id = await legal.first().getAttribute("data-id");
    const card = page.locator(`#hand .card[data-id="${id}"]`);   // 記住是哪一張，第二次點同一張
    await card.click({ position: { x: 10, y: 34 } }); await sleep(120);
    if (!seen.has("select")) { seen.add("select"); await shot(page, `04-card-selected-${me}`); }
    await card.click({ position: { x: 10, y: 34 }, force: true });
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

// --- 下一局、重新整理也回得來 ---
await B.click("#nextBtn");
await A.waitForFunction(() => document.querySelector("#handNo")?.textContent?.includes("第 2 局"), null, { timeout: 8000 });
console.log("✓ 朋友按「下一局」，兩邊都進到第 2 局");
await B.reload();
await B.waitForSelector("#table:not([hidden])", { timeout: 8000 });
await sleep(500);
const handAfter = await B.locator("#hand .card").count();
console.log(`✓ 朋友重新整理網頁，直接回到牌桌（手上 ${handAfter} 張）`);
await shot(B, "10-after-reload-B");

await browser.close();
if (errors.length) { console.error("✗ 頁面有錯誤：\n" + errors.join("\n")); process.exit(1); }
console.log("✓ 兩支手機全程沒有任何頁面錯誤");
