// 梭了啦 P2「全桌都在看你笑話」驗收：瀏覽器真的點（模擬手機，不是真機；真機項目見 test/MANUAL-online.md）
//   AI 測試局：開場契約公證處小卡；每一步量字幕／小卡位置（字幕只在標題列、最多兩則、不蓋選單鈕；小卡不蓋對手、方向、賭盤、底部固定區）；
//             點小卡略過、不會送出任何動作；中途重新整理不重播舊新聞；中場節目最多一次；結算有戰報標題、戰報可開可複製
//   設定：梭了啦轉播 關閉／精簡；系統「減少動態效果」：只淡入淡出
//   六種手機大小各打一段，同樣量位置
//   朋友連線（兩個獨立瀏覽器環境）：雙方開場都有契約公證處、打完雙方戰報一模一樣
// 用法：先 npx wrangler dev（自己電腦上的建置），再 node test/e2e/p2-cast.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const text = (P, sel) => P.textContent(sel).then(t => (t ?? "").trim());
const LS = P => P.evaluate(() => globalThis.__hbLS?.() ?? null);
const CAST = P => P.evaluate(() => globalThis.__hbCast?.() ?? null);
const SIZES = [
  ["iPhone SE（第一代）", 320, 568], ["iPhone SE 2／8", 375, 553], ["iPhone 13", 390, 664],
  ["LINE 內建瀏覽器（約）", 390, 600], ["Pixel 7", 412, 839], ["iPhone Pro Max", 430, 739],
];

async function phone(label, ctxOpt, name = "大雞") {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], ...ctxOpt });
  await ctx.addInitScript(n => { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); localStorage.setItem("hb-name", n); localStorage.setItem("hb-story-offered", "1"); } }, name);
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/WebSocket|Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  return { ctx, p };
}
// 開一場 AI 測試局（AI 快速）
async function startAi(P, stake = "宵夜錢", vow = "這局我閉著眼睛都能贏") {
  await P.goto(BASE + "/?dev=1");                       // 正式站的入口藏起來（LS_AI=dev）：這支手機先打開
  await P.goto(BASE + "/?play=shuo");
  await P.click("#shuoAi");
  await P.waitForSelector("#contract:not([hidden])");
  await P.click("#aiDevWait"); await P.waitForSelector("#lsDev:not([hidden])");
  await P.selectOption("#lsDevSpeed", "fast");
  await P.click("#lsDev .sheet > .close"); await P.waitForSelector("#lsDev", { state: "hidden" });
  await P.fill("#stakeInput", stake); if (vow) await P.fill("#vowInput", vow);
  await P.click("#stakeSeal");
  await P.waitForFunction(() => document.getElementById("contractState").textContent.includes("已蓋章"), null, { timeout: 4000 });
  await P.click("#readyBtn");
  await P.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
}
// 量位置：字幕只在標題列、最多兩則、不蓋選單鈕；小卡不蓋對手、方向、賭盤、底部固定區
const inter = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const issues = [];
async function audit(P, tag) {
  const r = await P.evaluate(() => {
    const R = id => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null; };
    const tk = document.getElementById("lsTicker"), on = tk.classList.contains("on") && !tk.classList.contains("hush");
    const card = document.getElementById("lsCast"), cardOn = !card.hidden && !card.classList.contains("out") && getComputedStyle(card).opacity > 0.5;
    return { ticker: on ? R("lsTicker") : null, bar: R("lsBar"), card: cardOn ? R("lsCast") : null, opp: R("lsOpp"), pot: R("lsPot"), dir: R("lsDir"), dock: R("lsDock"), menu: R("lsMenuBtn"),
      items: tk.querySelectorAll(".tk:not(.out)").length,
      clipped: [...tk.querySelectorAll(".tk:not(.out) span, .tk:not(.out) i")].filter(e => { const a = e.getBoundingClientRect(), b = tk.getBoundingClientRect(); return a.height > 2 && (a.bottom > b.bottom + 2 || a.top < b.top - 2); }).map(e => e.textContent.slice(0, 10)),
      press: document.getElementById("lstable").dataset.press, scrollW: document.documentElement.scrollWidth, W: document.documentElement.clientWidth };
  });
  if (r.ticker) {
    if (r.ticker.top < r.bar.top - 1 || r.ticker.bottom > r.bar.bottom + 1) issues.push(`${tag} 字幕超出標題列`);
    if (inter(r.ticker, r.menu)) issues.push(`${tag} 字幕蓋到選單鈕`);
    if (r.items > 2) issues.push(`${tag} 字幕超過兩則`);
    if (r.clipped.length) issues.push(`${tag} 字幕被框切掉：${r.clipped.join("、")}`);
  }
  if (r.card) for (const k of ["opp", "pot", "dir", "dock"]) if (inter(r.card, r[k])) issues.push(`${tag} 小卡蓋到 ${k}`);
  if (r.scrollW > r.W + 1) issues.push(`${tag} 可以橫向捲動`);
  return r;
}
// 玩家這邊照畫面上的按鈕點
let seedv = 0.37;
const rnd = () => (seedv = (seedv * 9301 + 0.4927) % 1);
async function act(P) {
  const has = a => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
  if (await has("noflip")) { await P.click(`#lsActions [data-a="${rnd() < 0.3 ? "flip" : "noflip"}"]`); return true; }
  if (await has("nosafe")) { await P.click(`#lsActions [data-a="${rnd() < 0.15 ? "safe" : "nosafe"}"]`); return true; }
  if (await P.locator("#lsHand .lscard:not([disabled])").count() && await P.isVisible('#lsActions [data-a="lock"]')) {
    const n = await P.locator("#lsHand .lscard:not([disabled])").count();
    await P.locator("#lsHand .lscard:not([disabled])").nth(Math.floor(rnd() * n)).click();
    await P.click('#lsActions [data-a="lock"]'); return true;
  }
  if (await has("insight") && rnd() < 0.3) { await P.click('#lsActions [data-a="insight"]'); return true; }
  if (await has("call")) { await P.click(`#lsActions [data-a="${rnd() < 0.2 ? "fold" : "call"}"]`); return true; }
  if (await has("raise") && rnd() < 0.55) { await P.click('#lsActions [data-a="raise"]'); return true; }
  if (await has("check")) { await P.click('#lsActions [data-a="check"]'); return true; }
  return false;
}
const myTurn = P => P.evaluate(() => !!document.querySelector("#lsActions button[data-a]:not([disabled])"));

// ================= 1. AI 測試局（iPhone 13）=================
console.log("AI 測試局：開場、位置、略過、重新整理、壓力、中場、戰報");
{
  const { ctx, p: P } = await phone("AI", { ...devices["iPhone 13"] });
  await startAi(P);
  await P.waitForFunction(() => (globalThis.__hbCast?.().played ?? []).some(x => x.id.startsWith("1:start")), null, { timeout: 4000 }).catch(() => {});
  let c = await CAST(P);
  const open = c.played.find(x => x.id.startsWith("1:start"));
  ok(!!open && open.channel === "card" && /契約公證處/.test(open.title ?? ""), `開場：契約公證處小卡（${open?.title}）`);
  ok(!!open && open.text.includes("宵夜錢"), "契約小卡寫的是玩家填的賭上之物（原樣）");
  await P.screenshot({ path: `${SHOTS}/p2-ai-open.png` });
  let skipped = false, reloaded = false, maxPress = 1, steps = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (await P.isVisible("#matchEnd:not([hidden])")) break;
    const r = await audit(P, `AI 第 ${steps} 步`);
    maxPress = Math.max(maxPress, Number(r.press));
    // 點小卡略過：不會送出動作
    if (!skipped && r.card) {
      const before = JSON.stringify((await LS(P)).steps) + (await LS(P)).phase;
      await P.click("#lsCast", { position: { x: 30, y: 12 } });
      await sleep(450);
      const hidden = await P.evaluate(() => { const e = document.getElementById("lsCast"); return e.hidden || e.classList.contains("out"); });
      const after = JSON.stringify((await LS(P)).steps) + (await LS(P)).phase;
      ok(hidden, "點一下節目小卡：馬上收起來（略過）");
      ok(before === after || !(await myTurn(P)), "略過小卡不會替玩家送出任何動作");
      skipped = true;
    }
    // 第 3 墩、輪到自己：重新整理 → 不重播舊新聞
    const v = await LS(P);
    if (!reloaded && v && v.trick === 3 && await myTurn(P)) {
      await P.reload();
      await P.waitForSelector("#lstable:not([hidden])", { timeout: 8000 });
      await sleep(1600);
      c = await CAST(P);
      ok(c.played.length === 0, `中途重新整理：不重播之前的轉播（重整後 1.6 秒內演了 ${c.played.length} 則）`);
      reloaded = true;
      continue;
    }
    if (!(await act(P))) await sleep(150); else await sleep(650);
    steps++;
  }
  ok(await P.isVisible("#matchEnd:not([hidden])"), `打完整場（${steps} 步）`);
  c = await CAST(P);
  const fin = await LS(P);
  const mids = c.played.filter(x => x.id === "4:intermission").length;
  ok(mids <= 1 && (fin.result.trick > 4 ? true : mids === 0), `中場節目最多一次（這場打到第 ${fin.result.trick} 墩，播了 ${mids} 次）`);
  ok(maxPress >= 2, `下注壓力氛圍有變化（最高到 ${maxPress}）`);
  const head = await text(P, "#meHead");
  ok(head.startsWith("【") && head.length > 4 && await P.isVisible("#meReport"), `結算：戰報標題 ${head}＋「看賽後戰報」`);
  await P.screenshot({ path: `${SHOTS}/p2-ai-end.png` });
  await P.click("#meReport");
  await P.waitForSelector("#lsReport:not([hidden])");
  const secs = await P.$$eval("#rpBody section", s => s.map(x => x.dataset.k));
  ok(["result", "absurd", "contract", "closing"].every(k => secs.includes(k)), `戰報分段：${secs.join("、")}`);
  await P.screenshot({ path: `${SHOTS}/p2-ai-report.png`, fullPage: false });
  await P.click("#rpCopy"); await sleep(250);
  const clip = await P.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  ok(clip.startsWith("《梭了啦！這局賭什麼？》賽後戰報") && clip.includes("宵夜錢") && clip.includes("單人測試｜不計正式戰績") && (await text(P, "#rpNote")).includes("複製好了"), "複製戰報：純文字、有賭上之物、AI 測試標明不計正式戰績");
  ok(!/<[a-z]/i.test(await P.$eval("#rpBody", e => e.innerHTML.replace(/<\/?(section|h4|p|ul|li|blockquote)( data-k="\w+")?>/g, ""))), "戰報用純文字顯示（沒有額外的 HTML）");
  await ctx.close();
}

// ================= 2. 設定：關閉／精簡；減少動態 =================
console.log("設定：梭了啦轉播 關閉／精簡；系統減少動態效果");
{
  const { ctx, p: P } = await phone("設定", { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  await P.goto(BASE);
  await P.evaluate(() => { const s = JSON.parse(localStorage.getItem("hb-web-settings") || "{}"); s.cast = "off"; localStorage.setItem("hb-web-settings", JSON.stringify(s)); });
  await startAi(P, "", "");
  for (let i = 0; i < 14; i++) { if (!(await act(P))) await sleep(200); else await sleep(500); }
  let c = await CAST(P);
  ok(c.played.length === 0 && !(await P.isVisible("#lsCast")), `轉播「關閉」：不出字幕、不出小卡（演了 ${c.played.length} 則）`);
  await P.click("#lsMenuBtn"); await P.waitForSelector("#menu:not([hidden])");
  ok(await P.isVisible('#settingsBox [data-cast="lite"]'), "選單設定裡有「梭了啦轉播：正常／精簡／關閉」");
  await P.click('#settingsBox [data-cast="lite"]');
  await P.click("#menu [data-close]");
  for (let i = 0; i < 24; i++) { if (await P.isVisible("#matchEnd:not([hidden])")) break; if (!(await act(P))) await sleep(200); else await sleep(500); }
  c = await CAST(P);
  ok(c.played.every(x => x.pr >= 60), `轉播「精簡」：只播重要的（演了 ${c.played.length} 則，最低優先級 ${Math.min(...c.played.map(x => x.pr), 99)}）`);
  await ctx.close();

  const R = await phone("減少動態", { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await startAi(R.p);
  ok((await R.p.getAttribute("#lstable", "data-calm")) === "1", "系統減少動態效果：牌桌標記 calm");
  let anim = "";
  for (let i = 0; i < 30 && !anim; i++) {
    anim = await R.p.evaluate(() => { const e = document.querySelector("#lsTicker .tk:not(.out)") || (!document.getElementById("lsCast").hidden && document.getElementById("lsCast")); return e ? getComputedStyle(e).animationName : ""; });
    if (!anim) { if (!(await act(R.p))) await sleep(200); else await sleep(300); }
  }
  ok(anim === "fadeIn", `減少動態：轉播只淡入（animation: ${anim || "沒抓到"}）`);
  await R.ctx.close();
}

// ================= 3. 六種手機大小 =================
console.log("六種手機大小：每一步量字幕／小卡位置");
for (const [name, w, h] of SIZES) {
  const before = issues.length;
  const { ctx, p: P } = await phone(name, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await startAi(P);
  let cards = 0, ticks = 0, compact = 0;
  for (let i = 0; i < 36; i++) {
    if (await P.isVisible("#matchEnd:not([hidden])")) break;
    const r = await audit(P, `${name} 第 ${i} 步`);
    if (r.card) cards++; if (r.ticker) ticks++;
    if (!(await act(P))) await sleep(150); else await sleep(550);
  }
  compact = (await CAST(P)).played.filter(x => x.mode === "ticker-card").length;
  ok(issues.length === before, `${name} ${w}×${h}：字幕在標題列、小卡不蓋對手／方向／賭盤／底部按鈕、沒有橫向捲動（看到字幕 ${ticks} 次、小卡 ${cards} 次、空位不夠改成一行 ${compact} 次）`);
  if (issues.length > before) console.log("     ", issues.slice(before, before + 5).join("；"));
  await P.screenshot({ path: `${SHOTS}/p2-size-${w}x${h}.png` });
  await ctx.close();
}

// ================= 4. 朋友連線：兩支手機 =================
console.log("朋友連線：雙方開場都有契約公證、打完戰報一模一樣");
{
  const H = await phone("房主", { ...devices["iPhone 13"] }, "大雞");
  const G = await phone("朋友", { ...devices["Pixel 7"] }, "小美");
  await H.p.goto(BASE); await H.p.click("#goOnline"); await H.p.fill("#name", "大雞"); await H.p.click("#create");
  await H.p.waitForSelector("#wait:not([hidden])");
  const code = (await text(H.p, "#bigCode")).replace(/\s/g, "");
  await G.p.goto(`${BASE}/?room=${code}`);
  await G.p.waitForSelector("#online:not([hidden])");
  await G.p.fill("#name", "小美"); await G.p.click("#join");
  await G.p.waitForSelector("#wait:not([hidden])");
  await H.p.click('#modePick [data-mode="laststand"]');
  await H.p.waitForSelector("#contract:not([hidden])"); await G.p.waitForSelector("#contract:not([hidden])");
  await H.p.fill("#stakeInput", "阿嬤的藍白拖"); await H.p.fill("#vowInput", "今天手很順");
  await H.p.click("#stakeSeal"); await G.p.click("#stakeSeal");
  await H.p.waitForFunction(() => document.getElementById("plateOppStake").textContent.includes("我最後的尊嚴"), null, { timeout: 5000 });
  await H.p.click("#readyBtn"); await sleep(300); await G.p.click("#readyBtn");
  await Promise.all([H.p.waitForSelector("#lstable:not([hidden])", { timeout: 8000 }), G.p.waitForSelector("#lstable:not([hidden])", { timeout: 8000 })]);
  await sleep(1500);
  const [ch, cg] = [await CAST(H.p), await CAST(G.p)];
  const oh = ch.played.find(x => x.id.startsWith("1:start")), og = cg.played.find(x => x.id.startsWith("1:start"));
  ok(!!oh && !!og && oh.id === og.id && oh.text === og.text, `雙方開場都是同一張契約公證處小卡（${oh?.title}）`);
  ok(ch.gid === cg.gid && !!ch.gid, "雙方用同一個對局編號選文案");
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 240000) {
    const [vh, vg] = [await LS(H.p), await LS(G.p)];
    if (vh?.result && vg?.result) break;
    await audit(H.p, `房主 第 ${n} 步`); await audit(G.p, `朋友 第 ${n} 步`);
    const a = await act(H.p) || await act(G.p);
    await sleep(a ? 450 : 200);
    n++;
  }
  await Promise.all([H.p.waitForSelector("#matchEnd:not([hidden])", { timeout: 9000 }), G.p.waitForSelector("#matchEnd:not([hidden])", { timeout: 9000 })]).catch(() => {});
  const [hh, hg] = [await text(H.p, "#meHead"), await text(G.p, "#meHead")];
  ok(!!hh && hh === hg, `打完：雙方戰報標題一樣 ${hh}`);
  await H.p.click("#meReport"); await G.p.click("#meReport");
  await H.p.click("#rpCopy"); await G.p.click("#rpCopy"); await sleep(300);
  const [th, tg] = [await H.p.evaluate(() => navigator.clipboard.readText()), await G.p.evaluate(() => navigator.clipboard.readText())];
  ok(th.length > 80 && th === tg, "雙方複製出來的戰報一字不差");
  ok(th.includes("大雞") && th.includes("小美") && !th.includes("單人測試"), "戰報用雙方暱稱；朋友連線不會標成單人測試");
  await H.p.screenshot({ path: `${SHOTS}/p2-online-report.png` });
  await H.ctx.close(); await G.ctx.close();
}

ok(issues.length === 0, `位置檢查全部通過（問題 ${issues.length} 個）`);
if (issues.length) console.log("  ", issues.slice(0, 10).join("\n   "));
ok(errors.length === 0, `沒有頁面錯誤${errors.length ? "：" + errors.slice(0, 5).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
