// 梭了啦 單人測試（真人 vs 測試 AI）驗收：瀏覽器真的點（模擬手機，不是真機）
//   入口 → 等待室（沒有房號／玩法／邀請，契約書照用）→ 牌桌標「單人測試｜不計正式戰績」→ 點完整一場
//   全程沒有打 /api、沒有 WebSocket；AI 思考中重新整理接得上；AI 思考中離開沒有幽靈計時器；從入口接著打
//   結算「本機測試、不計正式戰績」→ 再來一場交換先手 → 選單重開；測試工具：策略、跳過等待、複製紀錄（不含暱稱、賭上之物）、
//   seed 重開同一副牌、指定先手；只用自己的存檔鍵；最後六種手機大小的版面
// 用法：先 npx wrangler dev（自己電腦上的建置，入口是 on），再 node test/e2e/lsai-ui.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [], net = [];
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const text = (P, sel) => P.textContent(sel).then(t => (t ?? "").trim());
const info = P => P.evaluate(() => globalThis.__hbLsAi?.() ?? null);
const view = P => P.evaluate(() => globalThis.__hbLS?.() ?? null);
async function phone(label, dev = "iPhone 13") {
  const ctx = await browser.newContext({ ...devices[dev] });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); localStorage.setItem("hb-name", "大雞"); localStorage.setItem("hb-solo-v1", "經典單機的存檔"); } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  p.on("request", r => { if (/\/api\//.test(r.url())) net.push(r.url()); });
  p.on("websocket", w => net.push("WebSocket " + w.url()));
  return { ctx, p };
}
async function openDev(P) { await P.click("#lsMenuBtn"); await P.waitForSelector("#lsDevBtn:not([hidden])"); await P.click("#lsDevBtn"); await P.waitForSelector("#lsDev:not([hidden])"); }
async function closeDev(P) { await P.click("#lsDev .sheet > .close"); await P.waitForSelector("#lsDev", { state: "hidden" }); }
// 玩家這邊：照畫面上的按鈕點（不看 AI 的牌）
const seen = { flip: 0, safe: 0, lock: 0, check: 0, raise: 0, call: 0, fold: 0, insight: 0 };
let coin = 0.37;
const rnd = () => (coin = (coin * 9301 + 0.4927) % 1);
async function act(P) {
  const has = a => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
  if (await has("noflip")) { const f = rnd() < 0.3; await P.click(`#lsActions [data-a="${f ? "flip" : "noflip"}"]`); if (f) seen.flip++; return true; }
  if (await has("nosafe")) { const f = rnd() < 0.2; await P.click(`#lsActions [data-a="${f ? "safe" : "nosafe"}"]`); if (f) seen.safe++; return true; }
  if (await P.locator("#lsHand .lscard:not([disabled])").count() && await P.isVisible('#lsActions [data-a="lock"]')) {
    const n = await P.locator("#lsHand .lscard:not([disabled])").count();
    await P.locator("#lsHand .lscard:not([disabled])").nth(Math.floor(rnd() * n)).click();
    await P.click('#lsActions [data-a="lock"]'); seen.lock++; return true;
  }
  if (await has("insight") && rnd() < 0.5) { await P.click('#lsActions [data-a="insight"]'); seen.insight++; return true; }
  if (await has("call")) { if (rnd() < 0.2) { await P.click('#lsActions [data-a="fold"]'); seen.fold++; } else { await P.click('#lsActions [data-a="call"]'); seen.call++; } return true; }
  if (await has("raise") && rnd() < 0.4) { await P.click('#lsActions [data-a="raise"]'); seen.raise++; return true; }
  if (await has("check")) { await P.click('#lsActions [data-a="check"]'); seen.check++; return true; }
  return false;
}
async function playToEnd(P, limitMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await P.isVisible("#matchEnd:not([hidden])")) return true;
    if (!(await act(P))) await sleep(80);
    else await sleep(60);
  }
  return false;
}

console.log("入口、等待室");
const { ctx, p: P } = await phone("手機");
await P.goto(BASE + "/?play=shuo");
await P.waitForSelector("#shuoAi:not([hidden])");
ok((await text(P, "#shuoAi")).startsWith("跟 AI 試打一局") && (await text(P, "#shuoAiSub")).includes("不計正式戰績") && await P.isVisible("#shuoCreate"), "梭了啦選單多一個「跟 AI 試打一局（單人測試｜不計正式戰績）」，找朋友開一局照舊");
await P.click("#shuoAi");
await P.waitForSelector("#wait:not([hidden])");
await P.waitForSelector("#contract:not([hidden])");
ok(await P.isVisible("#aiNote") && !(await P.isVisible("#bigCode")) && !(await P.isVisible("#modePick")) && !(await P.isVisible("#share")),
  "等待室：顯示「單人測試｜不計正式戰績」，沒有房號、玩法選擇、邀請按鈕（不假裝有房間）");
ok((await text(P, "#plateOppName")) === "測試 AI" && (await text(P, "#plateOppStake")).includes("一包乖乖") && (await text(P, "#plateOppVow")).includes("測試"), "對手名牌：測試 AI、預設的賭上之物和豪言");
await P.click("#aiDevWait"); await P.waitForSelector("#lsDev:not([hidden])");
await P.selectOption("#lsDevSpeed", "fast");
await closeDev(P);
await P.fill("#stakeInput", "宵夜錢"); await P.fill("#vowInput", "測試也要贏");
await P.click("#stakeSeal");
await P.waitForFunction(() => document.getElementById("contractState").textContent.includes("已蓋章"), null, { timeout: 4000 });
await P.click("#readyBtn");
await P.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
ok((await text(P, "#lsTestTag")).includes("單人測試｜不計正式戰績") && (await text(P, "#lsOppName")) === "測試 AI", "牌桌：標著「單人測試｜不計正式戰績・AI 均衡」，對手是測試 AI");
const d0 = (await view(P)).declarer;
await P.screenshot({ path: `${SHOTS}/lsai-table.png` });

console.log("打一整場（AI 快速）");
const done1 = await playToEnd(P);
const i1 = await info(P);
ok(done1 && i1.status === "SETTLEMENT" && i1.total === 30 && i1.illegal === 0 && i1.leak === 0, `打完第 1 場：${JSON.stringify({ stacks: i1.stacks, total: i1.total, illegal: i1.illegal, leak: i1.leak })}`);
ok((await text(P, "#meStats")).includes("本機測試") && (await text(P, "#meStats")).includes("不計正式戰績") && (await text(P, "#meStats")).includes("宵夜錢"), "結算面板：本機測試戰績（不計正式戰績）、雙方賭上之物");
await P.click("#meRematch");
await P.waitForFunction(() => { const v = globalThis.__hbLS?.(); return v && !v.result && v.trick === 1; }, null, { timeout: 6000 });
const v2 = await view(P);
ok((await info(P)).matchNo === 2 && v2.declarer === 1 - d0, `再來一場：第 2 場開打，第 1 墩宣戰權交換（${d0 === 0 ? "你" : "AI"} → ${v2.declarer === 0 ? "你" : "AI"}）`);

console.log("AI 思考中重新整理、離開");
await openDev(P); await P.selectOption("#lsDevSpeed", "normal"); await closeDev(P);
for (let k = 0; k < 400 && !(await info(P)).pendingAi; k++) { if (!(await act(P))) await sleep(50); }
const before = await view(P), bi = await info(P);
ok(bi.pendingAi, "等到輪到 AI（AI 思考中）");
await P.reload();
await P.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
await sleep(300);
const after = await view(P);
ok(after.trick === before.trick && JSON.stringify(after.stacks) === JSON.stringify(before.stacks) && JSON.stringify(after.hand) === JSON.stringify(before.hand) && (await text(P, "#lsTestTag")).includes("單人測試"),
  `AI 思考中重新整理：回到同一墩（第 ${after.trick} 墩），籌碼、手牌都一樣`);
for (let k = 0; k < 100 && !(await info(P)).pendingAi; k++) { if (!(await act(P))) await sleep(50); }
ok((await info(P)).pendingAi, "又輪到 AI");
await P.click("#lsMenuBtn"); await P.waitForSelector("#leaveBtn:not([hidden])");
ok((await text(P, "#leaveBtn")) === "回梭了啦選單", "選單：回梭了啦選單");
await P.click("#leaveBtn");
await P.waitForSelector("#shuo:not([hidden])");
const savedA = await P.evaluate(() => localStorage.getItem("hb-laststand-ai-v1"));
await sleep(2500);
const savedB = await P.evaluate(() => localStorage.getItem("hb-laststand-ai-v1"));
ok(savedA === savedB && (await info(P)) === null, "AI 思考中離開：2.5 秒內沒有任何動作偷偷發生（沒有幽靈計時器）");
ok((await text(P, "#shuoAiSub")).includes("接著上次的測試"), "入口顯示「接著上次的測試」");
await P.click("#shuoAi");
await P.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
ok((await view(P)).trick === after.trick, "從入口接著打：同一墩");

console.log("測試工具");
await openDev(P);
const statTxt = await text(P, "#lsDevStat");
ok(statTxt.includes("輪到") && statTxt.includes("AI 策略") && statTxt.includes("seed") && statTxt.includes("總數 30"), "測試工具：看得到輪到誰、AI 策略、seed、籌碼總數 30");
await P.selectOption("#lsDevStrategy", "aggressive");
await P.selectOption("#lsDevSpeed", "normal");
ok((await text(P, "#lsTestTag")).includes("激進"), "換策略：牌桌標籤也跟著變（激進）");
await closeDev(P);
// 跳過等待：輪到 AI 的那一刻，打開測試工具、按「跳過 AI 等待」（同一個瞬間做，免得 AI 自己先出手）
let skip = null;
for (let k = 0; k < 200 && !skip; k++) {
  if ((await info(P)).pendingAi) {
    skip = await P.evaluate(() => {
      const b0 = globalThis.__hbLsAi(); if (!b0.pendingAi) return null;
      document.getElementById("lsDevBtn").click();
      const b = document.getElementById("lsDevSkip"), enabled = !b.disabled;
      b.click();
      const a = globalThis.__hbLsAi();
      return { enabled, before: b0.logLines, after: a.logLines, illegal: a.illegal };
    });
    if (skip) break;
  }
  if (!(await act(P))) await sleep(40);
}
ok(!!skip && skip.enabled && skip.after > skip.before && skip.illegal === 0, `跳過 AI 等待：AI 思考中按下去，馬上執行排好的那一步（紀錄 ${skip?.before} → ${skip?.after} 行），照規則走`);
await P.waitForSelector("#lsDev:not([hidden])");
await P.click("#lsDevCopy"); await sleep(300);
const clip = await P.evaluate(() => navigator.clipboard.readText().catch(() => ""));
ok(clip.includes("seed") && clip.includes("單人測試紀錄") && !clip.includes("大雞") && !clip.includes("宵夜錢"), "複製測試紀錄：有 seed、動作紀錄；不含暱稱和賭上之物");
P.on("dialog", d => d.accept());
await P.selectOption("#lsDevFirst", "me");
await P.fill("#lsDevSeed", "424242"); await P.click("#lsDevSeedGo");
await P.waitForFunction(() => globalThis.__hbLsAi?.().seed === 424242 && globalThis.__hbLS?.()?.trick === 1, null, { timeout: 5000 });
const h1 = (await view(P)).hand, dA = (await view(P)).declarer;
await P.fill("#lsDevSeed", "424242"); await P.click("#lsDevSeedGo");
await sleep(500);
const h2 = (await view(P)).hand;
ok(JSON.stringify(h1) === JSON.stringify(h2) && dA === 0, `同一個 seed（424242）重開：同一副牌；設定「我先」→ 第 1 墩宣戰權是你`);
await P.selectOption("#lsDevFirst", "ai");
await P.fill("#lsDevSeed", "424242"); await P.click("#lsDevSeedGo");
await sleep(500);
ok((await view(P)).declarer === 1 && JSON.stringify((await view(P)).hand) === JSON.stringify(h1), "設定「AI 先」：同一副牌、第 1 墩宣戰權給 AI（AI 先手也能正常開局）");
await P.click("#lsDevSame"); await sleep(500);
ok(JSON.stringify((await view(P)).hand) === JSON.stringify(h1), "同一副牌重來：手牌一樣");
await P.click("#lsDevNext"); await sleep(500);
ok(JSON.stringify((await view(P)).hand) !== JSON.stringify(h1) && (await info(P)).matchNo === 2, "換下一副牌：第 2 場、不同的牌");
await P.selectOption("#lsDevSpeed", "fast");
await closeDev(P);
ok(await playToEnd(P), "接著打完這一場（激進 AI）");
const fin = await info(P);
ok(fin.total === 30 && fin.illegal === 0 && fin.leak === 0, `全部打完：籌碼總數 ${fin.total}、AI 不合法動作 ${fin.illegal}、送出未公開的牌 ${fin.leak}`);
const keys = await P.evaluate(() => Object.keys(localStorage).sort());
ok(keys.includes("hb-laststand-ai-v1") && (await P.evaluate(() => localStorage.getItem("hb-solo-v1"))) === "經典單機的存檔", `只用自己的存檔鍵（hb-laststand-ai-v1），經典單機的存檔沒被動到`);
ok(net.length === 0, `全程沒有打 /api、沒有 WebSocket（${net.length ? net.join("、") : "0 次"}）`);
ok(Object.values(seen).filter(Boolean).length >= 6, `玩家點過的動作：${JSON.stringify(seen)}`);
await ctx.close();

console.log("六種手機大小的版面");
const probe = ([keys, scroll]) => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const issues = [];
  if (document.documentElement.scrollWidth > W + 1) issues.push(`頁面可以橫向捲動（${document.documentElement.scrollWidth}/${W}）`);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#fx, .sr-only, [hidden]") || el.matches("canvas, svg *, option")) continue;
    if (el.closest(".cup, .cv-branch, .frame, .fc, .tc-ace, .seal, .stamp, .clip, .particles, .flash, .shock, .popup, .card.flying, .impactlayer, .aura")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (cs.position !== "fixed" && (r.right > W + 1 || r.left < -1)) {
      let ok = false;
      for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX + s.overflow)) { ok = true; break; } }
      if (!ok) issues.push(`超出螢幕：${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
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
    if (scroll) el.scrollIntoView({ block: "nearest" });     // 可以捲的表單頁：像玩家一樣捲到它
    const r = el.getBoundingClientRect();
    if (r.top < -1 || r.bottom > H + 1 || r.left < -1 || r.right > W + 1) { issues.push(`${k} 不在螢幕裡（${Math.round(r.top)}..${Math.round(r.bottom)} / 高 ${H}）`); continue; }
    // 按鈕要點得到、資訊要看得到：上緣、正中、下緣都不能被別的東西蓋住（底部固定區蓋到上面的資訊也算）
    // 只有短暫的提示條（#banner）不算：它幾秒就收起來
    const name = hit => hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + (typeof hit.className === "string" && hit.className ? "." + hit.className.trim().split(/\s+/).join(".") : "") : "（螢幕外）";
    if (r.width < 2 || r.height < 2) continue;                // 空的（例如還沒輪到你、按鈕列是空的）
    const btn = el.matches("button, a, [role=button]");
    for (const y of btn ? [r.top + r.height / 2] : [r.top + Math.min(4, r.height / 2), r.top + r.height / 2, r.bottom - Math.min(4, r.height / 2)]) {
      const hit = document.elementFromPoint(r.left + r.width / 2, y);
      if (hit && hit.closest("#banner")) continue;
      if (!hit || !(hit === el || el.contains(hit))) { issues.push(`${k} ${btn ? "點不到" : "看不到"}，被 ${name(hit)} 蓋住`); break; }
    }
  }
  return [...new Set(issues)].slice(0, 8);
};
const SIZES = [["iPhone SE（第一代）", 320, 568], ["iPhone SE 2／8", 375, 553], ["iPhone 13", 390, 664], ["LINE 內建瀏覽器（約）", 390, 600], ["Pixel 7", 412, 839], ["iPhone Pro Max", 430, 739]];
for (const [name, w, h] of SIZES) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await c.addInitScript(() => localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true })));
  const L = await c.newPage();
  L.on("pageerror", e => errors.push(`[${name}] ${e.message}`));
  const res = [];
  const check = async (label, keys, scroll = false) => { await L.waitForTimeout(350); const r = await L.evaluate(probe, [keys, scroll]); if (r.length) res.push([label, r]); };
  await L.goto(BASE + "/?play=shuo");
  await check("梭了啦選單", ["#shuoCreate", "#shuoAi"], true);
  await L.click("#shuoAi"); await L.waitForSelector("#contract:not([hidden])");
  await check("單人測試等待室", ["#aiNote", "#plateOpp", "#stakeSeal"], true);
  await L.click("#stakeSeal"); await L.waitForTimeout(300); await L.click("#readyBtn");
  await L.waitForSelector("#lstable:not([hidden])"); await L.waitForTimeout(2600);
  await check("單人測試牌桌", ["#lsTrick", "#lsTestTag", "#lsMenuBtn", "#lsOppChips", "#lsDirBig", "#lsMyChips", "#lsTurn", "#lsHand", "#lsActions"]);
  await L.click("#lsMenuBtn"); await L.click("#lsDevBtn"); await L.waitForSelector("#lsDev:not([hidden])");
  await check("測試工具", ["#lsDevTitle", "#lsDevStrategy", "#lsDev .sheet > .close"]);
  console.log(`  ${res.length ? "✗" : "✓"} ${name}（${w}×${h}）：${res.length ? JSON.stringify(res) : "梭了啦選單、等待室、牌桌、測試工具都 OK"}`);
  if (res.length) fails++;
  await c.close();
}

ok(errors.length === 0, "全程沒有頁面錯誤" + (errors.length ? "：" + errors.slice(0, 4).join("｜") : ""));
await browser.close();
console.log(fails ? `\n${fails} 項沒過` : "\n單人測試（AI 對戰）驗收全部通過");
process.exit(fails ? 1 : 0);
