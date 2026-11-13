// P2.5-E 驗收：轉播降噪（iPhone 13，AI 對局）
//   · 重大事件（優先級 ≥ 80）在「空檔」（沒在等我做決定、牌桌沒在演）才進牌桌中央；不蓋對手名牌、行動列、標題列
//   · 輪到我做決定：小卡馬上退回頂列一行；新的重大事件也不進牌桌中央
//   · 牌桌中央的完整小卡：點一下就略過，而且不會替我送出任何動作
//   · 輪到我時頂列字幕變淡；彈幕收合鈕：收＝只播重要的、開＝全部播
//   · 用 __hbCastPush 塞演出（只為了確定遇得到重大事件；位置、時機都是正式的邏輯在判斷）
// 用法：node test/e2e/p25-e.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); localStorage.setItem("hb-name", "大雞"); localStorage.setItem("hb-story-offered", "1"); } });
const P = await ctx.newPage();
const errors = [];
P.on("pageerror", e => errors.push(String(e)));
await P.goto(BASE + "/?dev=1"); await P.goto(BASE + "/?play=shuo");
await P.click("#shuoAi"); await P.waitForSelector("#contract:not([hidden])");
await P.click("#stakeSeal"); await sleep(300); await P.click("#readyBtn"); await P.waitForSelector("#lstable:not([hidden])");
await sleep(5000);                                   // 開場的契約小卡演完

let n = 0;
const cue = () => ({ id: `test:${++n}`, beat: "test", channel: "card", program: "court", priority: 90, level: 3, title: "驗收用的重大事件", lines: [{ who: "主播", text: "這是一則驗收用的重大事件。" }, { text: "第二行。" }], ttl: 6000, skippable: true });
// 量現在的狀態
const look = () => P.evaluate(() => {
  const R = id => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? b.toJSON() : null; };
  const card = document.getElementById("lsCast"), cardOn = !card.hidden && !card.classList.contains("out");
  const v = globalThis.__hbLS(), L = v.legal;
  const myDecision = !v.result && (L.flip || L.safeguard || L.lock.length > 0 || (v.phase === "bet" && v.toAct === v.seat));
  return { card: cardOn ? R("lsCast") : null, felt: R("lsFelt"), opp: R("lsOpp"), dock: R("lsDock"), bar: R("lsBar"), myDecision, idle: globalThis.__hbLSIdle(), result: !!v.result,
    buttons: document.querySelectorAll("#lsActions button:not([hidden]):not([disabled])").length, tickerDim: document.getElementById("lsTicker").classList.contains("dim"),
    tickerTap: document.getElementById("lsTicker").classList.contains("tap"), key: `${v.trick}:${v.phase}:${v.steps.length}:${v.myLock}` };
});
const inter = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const has = a => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
// 往下打一步（輪到我才動）
async function step() {
  if (await has("noflip")) await P.click('#lsActions [data-a="noflip"]');
  else if (await has("nosafe")) await P.click('#lsActions [data-a="nosafe"]');
  else if (await P.isVisible('#lsActions [data-a="lock"]')) { const c = P.locator("#lsHand .lscard:not([disabled])"); if (await c.count()) { await c.nth(0).click(); await P.click('#lsActions [data-a="lock"]'); } }
  else if (await has("call")) await P.click('#lsActions [data-a="call"]');
  else if (await has("check")) await P.click('#lsActions [data-a="check"]');
}

const seen = { quietIn: 0, quietBad: [], retreat: 0, retreatBad: 0, busyPush: 0, busyBad: 0, skip: 0, skipBad: 0, dim: 0, dimBad: 0 };
for (let i = 0; i < 300 && (seen.quietIn < 2 || seen.retreat < 1 || seen.busyPush < 2 || seen.skip < 1); i++) {
  if (await P.isVisible("#matchEnd:not([hidden])")) break;
  const s = await look();
  if (process.env.DEBUG) console.log(i, JSON.stringify({ d: s.myDecision, b: s.buttons, idle: s.idle, card: !!s.card, key: s.key }));
  if (s.myDecision) {
    // 輪到我：字幕變淡；塞一則重大事件 → 不能進牌桌中央
    seen.dim++; if (!s.tickerDim) seen.dimBad++;
    if (seen.busyPush < 2) {
      await P.evaluate(c => globalThis.__hbCastPush(c), cue()); await sleep(250);
      const t = await look(); seen.busyPush++;
      if (t.card && inter(t.card, t.felt)) seen.busyBad++;
      await P.evaluate(() => { const t = document.getElementById("lsTicker"); if (t.classList.contains("tap")) t.click(); });   // 收掉，別影響下一步
    }
    await step();
  } else if (!s.myDecision && s.idle && !s.result) {
    // 空檔：塞一則重大事件 → 要進牌桌中央、不蓋名牌／行動列／標題列
    await P.evaluate(c => globalThis.__hbCastPush(c), cue()); await sleep(120);
    const t = await look();
    if (t.card && inter(t.card, t.felt)) {
      seen.quietIn++;
      for (const k of ["opp", "dock", "bar"]) if (inter(t.card, t[k])) seen.quietBad.push(k);
      if (seen.skip < 1) {
        // 點牌桌中央的小卡：馬上收起來、不替我送出動作
        await P.click("#lsCast"); await sleep(450);
        const u = await look();
        seen.skip++;
        if (u.card) seen.skipBad++;
      } else {
        // 等到輪到我：小卡要退回頂列
        await P.waitForFunction(() => document.querySelectorAll("#lsActions button:not([hidden]):not([disabled])").length > 0, null, { timeout: 8000 }).catch(() => {});
        await sleep(200);
        const u = await look();
        if (u.myDecision) { seen.retreat++; if (u.card && inter(u.card, u.felt)) seen.retreatBad++; }
      }
    } else if (t.myDecision === false && t.idle) { /* 這一刻空檔剛好結束，再試 */ }
  }
  await sleep(120);
}
ok(seen.quietIn >= 1 && !seen.quietBad.length, `空檔時重大事件進牌桌中央（${seen.quietIn} 次），沒蓋到名牌／行動列／標題列${seen.quietBad.length ? `：${seen.quietBad.join("、")}` : ""}`);
ok(seen.skip >= 1 && !seen.skipBad, `點牌桌中央的小卡：馬上收起來（${seen.skip} 次）`);
ok(seen.retreat >= 1 && !seen.retreatBad, `輪到我做決定：小卡退回頂列（${seen.retreat} 次）`);
ok(seen.busyPush >= 1 && !seen.busyBad, `輪到我時來的重大事件不進牌桌中央（${seen.busyPush} 次）`);
ok(seen.dim >= 3 && !seen.dimBad, `輪到我時頂列字幕變淡（${seen.dim} 次）`);

// 彈幕收合鈕
await P.evaluate(c => globalThis.__hbCastPush({ ...c, channel: "chat", priority: 20, title: undefined }), cue());
await sleep(300);
const foldVisible = await P.isVisible("#lsTkFold");
let foldOk = false;
if (foldVisible) {
  const a = (await P.textContent("#lsTkFold")).trim();
  await P.click("#lsTkFold");
  const b = (await P.textContent("#lsTkFold").catch(() => "")).trim();
  const lite = await P.evaluate(() => JSON.parse(localStorage.getItem("hb-fx") ?? localStorage.getItem("hb-settings") ?? "{}").cast);
  await P.click("#lsTkFold").catch(() => {});
  foldOk = a === "收" && (b === "開" || lite === "lite");
}
ok(foldVisible && foldOk, `彈幕收合鈕：字幕出現時才有，收↔開可以切換`);
ok(errors.length === 0, `沒有頁面錯誤${errors.length ? `：${errors[0]}` : ""}`);

await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
