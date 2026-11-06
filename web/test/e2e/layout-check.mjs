// 版面校正：在不同手機大小下走過每一個畫面，檢查
//   1. 沒有東西超出螢幕左右邊界（頁面不會橫向捲動）
//   2. 文字、按鈕沒有被自己的框切掉（裝飾性的茶杯、花枝除外）
//   3. 重要的東西整個在螢幕裡：故事的對話框、牌桌手牌、出牌按鈕、叫牌按鈕、結算單、選單
// 用法：先 npm run dev，再 node test/e2e/layout-check.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const SIZES = [
  ["iPhone SE（第一代）", 320, 568], ["iPhone SE 2／8", 375, 553], ["iPhone 13", 390, 664],
  ["LINE 內建瀏覽器（約）", 390, 600], ["Pixel 7", 412, 839], ["iPhone Pro Max", 430, 739],
];
const DECOR = ".cup, .cv-branch, .frame, .fc, .tc-ace, .seal, .stamp, .clip";

const probe = (keys) => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const issues = [];
  if (document.documentElement.scrollWidth > W + 1) issues.push(`頁面可以橫向捲動（${document.documentElement.scrollWidth}/${W}）`);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#fx, .sr-only, [hidden]") || el.matches("canvas, svg *, option")) continue;
    if (el.closest(".cup, .cv-branch, .frame, .fc, .tc-ace, .seal, .stamp, .clip, .particles, .flash, .shock, .popup, .card.flying")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (cs.position !== "fixed" && (r.right > W + 1 || r.left < -1)) {
      // 被某個在螢幕內的容器裁掉、而且那個容器是「可以捲動」的，就不算
      let ok = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(auto|scroll)/.test(s.overflowX + s.overflow)) { ok = true; break; }
      }
      if (!ok) issues.push(`超出螢幕：${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    // 文字被自己的框切掉（overflow hidden 的容器，不是可以捲動的）
    if (el.childElementCount === 0 && (el.textContent || "").trim()) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) break;
        if (s.overflow === "hidden" || s.overflowX === "hidden" || s.overflowY === "hidden") {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 2 || r.left < ar.left - 2 || r.bottom > ar.bottom + 2) issues.push(`被框切掉：「${el.textContent.trim().slice(0, 12)}」在 ${a.id || a.className}`);
          break;
        }
      }
    }
  }
  for (const k of keys) {
    const el = document.querySelector(k);
    if (!el) { issues.push(`找不到 ${k}`); continue; }
    const r = el.getBoundingClientRect();
    if (r.top < -1 || r.bottom > H + 1 || r.left < -1 || r.right > W + 1) { issues.push(`${k} 不在螢幕裡（${Math.round(r.top)}..${Math.round(r.bottom)} / 高 ${H}）`); continue; }
    // 按鈕要真的點得到：正中間不能被別的東西蓋住（例如被手牌壓住、被捲動的框切掉）
    if (el.matches("button, a, [role=button]")) {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) issues.push(`${k} 點不到，被 ${hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + (typeof hit.className === "string" && hit.className ? "." + hit.className.trim().split(/\s+/).join(".") : "") : "（螢幕外）"} 蓋住`);
    }
  }
  return [...new Set(issues)].slice(0, 8);
};

const b = await chromium.launch();
let total = 0;
for (const [name, w, h] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem("hb-story-offered", "1"); localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true })); });
  const results = [];
  const check = async (label, keys = []) => { await p.waitForTimeout(350); results.push([label, await p.evaluate(probe, keys)]); };
  const mode = () => p.evaluate(() => document.getElementById("narrator")?.dataset.mode);
  const story = async () => { for (let i = 0; i < 30 && ["intro", "outro"].includes(await mode()); i++) { await p.locator("#spoken").click(); await p.waitForTimeout(40); } };

  // 封面、選單、朋友連線、等朋友
  await p.goto(base + "/"); await check("封面", [".cv-top", "#titleCard", "#storyCard", "#solo", "#goOnline"]);
  await p.click("#goMenu"); await check("封面選單", ["#homeMenu .sheet"]); await p.click("#homeMenu [data-close]");
  await p.click("#goNews"); await check("最新消息", ["#newsModal .sheet"]); await p.click("#newsModal [data-close]");
  await p.click("#goOnline"); await check("朋友連線", ["#create", "#join"]);
  await p.click("#create"); await p.waitForSelector("#wait:not([hidden])"); await check("等朋友", ["#bigCode", "#share", "#cancelWait"]);
  await p.click("#cancelWait");
  // 故事：開場 → 輪到你 → 出牌後的說明 → 完成；叫牌；章節抽屜；設定
  await p.goto(base + "/story/"); await p.waitForTimeout(200); await check("故事開場（第一幕紙條）", ["#narrator", "#spoken", "#sHand"]);
  await story(); await check("故事：輪到你", ["#narrator", "#sHand", "#controls"]);
  await p.locator("#sHand .card").first().click(); await p.waitForTimeout(2500); await check("故事：阿禾說明", ["#narrator", "#spoken"]);
  await story(); await check("故事：完成這一步", ["#narrator", "#controls .s-emph"]);
  await p.locator("#controls .s-emph").click(); await p.waitForTimeout(300); await story(); await check("故事：叫牌", ["#narrator", "#sBoard .sgrid", "#sHand"]);
  await p.locator('#sBoard button[data-bid="7"]').click(); await check("故事：選好 2♥、準備叫", ["#sCall", "#sBoard .sgrid", "#sHand", "#narrator"]);
  await p.click("#navChapters"); await check("故事：章節抽屜", ["#contentsBox"]); await p.click("#closeChapters");
  await p.click("#setBtn"); await check("故事：設定", ["#setDlg"]); await p.click("#setClose");
  // 牌桌：搶牌 → 叫牌 → 出牌 → 結算
  await p.goto(base + "/?solo=new"); await p.waitForSelector("#hand .card"); await check("牌桌：搶牌", ["#hand", "#actions", "#felt", ".topbar"]);
  let saw = { bid: false, play: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(await p.locator("#result").isVisible())) {
    if (await p.locator("#bidPanel.mine").isVisible()) {
      if (!saw.bid) { await check("牌桌：叫牌", ["#bidPanel", "#bidConfirm", "#bidPass", "#bidDouble", "#bidLevels", "#bidStrains"]); saw.bid = true; }
      if ((await p.textContent("#bidContract")).includes("輪到你叫牌")) { await p.locator("#bidLevels button:not([disabled])").first().click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
      else await p.click("#bidPass");
      await p.waitForTimeout(200); continue;
    }
    const mine = (await p.getAttribute("#turnLine", "class"))?.includes("mine");
    if (mine && await p.locator("#hand .card.legal").count()) {
      const phase = await p.textContent("#phaseText");
      if (phase.includes("後半") && !saw.play) { await check("牌桌：出牌", ["#hand", "#actions", "#trumpPanel", "#tallyPanel", "#infoStrip"]); saw.play = true; }
      await p.click("#hintBtn"); await p.click("#playBtn");   // 用「提示」選牌再按「出牌」
    }
    await p.waitForTimeout(80);
  }
  await p.locator("#resSheet").click({ position: { x: 30, y: 100 } });
  await check("結算單", ["#resSheet", "#nextBtn", "#resHome"]);
  await p.click("#nextBtn"); await p.waitForTimeout(500);
  await p.click("#menuBtn"); await check("牌桌選單（設定）", ["#menu .sheet"]);

  const bad = results.filter(([, r]) => r.length);
  total += bad.length;
  console.log(`${name}（${w}×${h}）：${bad.length ? `⚠ ${bad.length} 個畫面有問題` : "全部 OK"}（檢查 ${results.length} 個畫面）`);
  for (const [label, r] of bad) { console.log(`   · ${label}`); for (const x of r) console.log(`       - ${x}`); }
  await ctx.close();
}
await b.close();
console.log(total ? `共 ${total} 個畫面要修` : "版面校正：每個大小、每個畫面都通過");
process.exit(total ? 1 : 0);
