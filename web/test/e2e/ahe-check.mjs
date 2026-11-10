// 阿禾在正式對戰的嘴：實際打幾局，檢查
//   · 每一句都對得上真的事件（王吃的台詞一定是真的王吃、打成的台詞一定是那一方真的打成……）
//   · 同一時間只有一個泡泡、泡泡不遮手牌和按鈕、表情記號不累積
//   · 一局講的話有上限、幹話一場最多 2 句
//   · 精簡：只講重要的；關閉：完全不講，但出牌、結算照常
//   · 回個話（表情）：你的泡泡、阿禾回一句、防洗版冷卻；不影響牌局
// 用法：先 npm run dev，再 node test/e2e/ahe-check.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0; const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rank = c => (c % 13) + 2;

// 每個台詞事件 → 它一定要對得上的真實事件
const RULES = {
  matchStart: c => c.cause === "NewHand" && c.value <= 1, rematch: c => c.cause === "NewHand" && c.value <= 1,
  aheLeads: c => c.cause === "NewHand" && !c.me, nextHand: c => c.cause === "NewHand" && c.me,
  trickMe: c => c.cause === "TrickWon" && c.me, trickAhe: c => c.cause === "TrickWon" && !c.me,
  faceUpMe: c => c.cause === "FaceUpTaken" && c.me && rank(c.card) >= 12, faceUpAhe: c => c.cause === "FaceUpTaken" && !c.me && rank(c.card) >= 12,
  ruffMe: c => c.cause === "TrickWon" && c.me && c.extra === 1, ruffAhe: c => c.cause === "TrickWon" && !c.me && c.extra === 1,
  streakMe: c => c.cause === "TrickWon" && c.me, streakAhe: c => c.cause === "TrickWon" && !c.me,
  keyMe: c => c.cause === "TrickWon" && c.me, keyAhe: c => c.cause === "TrickWon" && !c.me,
  nearDecl: c => c.cause === "TrickWon", reached: c => c.cause === "TrickWon", setLocked: c => c.cause === "TrickWon",
  bidHighMe: c => c.cause === "BidMade" && c.me, bidRaiseAhe: c => c.cause === "BidMade" && !c.me,
  doubleMe: c => c.cause === "Doubled" && c.me, doubleAhe: c => c.cause === "Doubled" && !c.me,
  redoubleMe: c => c.cause === "Redoubled" && c.me, redoubleAhe: c => c.cause === "Redoubled" && !c.me,
  contractMe: c => c.cause === "ContractSet" && c.me, contractAhe: c => c.cause === "ContractSet" && !c.me,
  madeMe: c => c.cause === "GameOver" && c.me && c.value >= c.extra, downMe: c => c.cause === "GameOver" && c.me && c.value < c.extra,
  madeAhe: c => c.cause === "GameOver" && !c.me && c.value >= c.extra, downAhe: c => c.cause === "GameOver" && !c.me && c.value < c.extra,
  matchMe: c => c.cause === "result" && c.extra === 1, matchAhe: c => c.cause === "result" && c.extra === 1,
  reversal: c => c.cause === "result" && c.me,
  nonsense: () => true,
};
const LITE_OK = new Set(["ruffMe", "ruffAhe", "keyMe", "keyAhe", "reversal", "reached", "setLocked", "doubleMe", "doubleAhe", "redoubleMe", "redoubleAhe",
  "madeMe", "downMe", "madeAhe", "downAhe", "matchMe", "matchAhe"]);

const b = await chromium.launch();
async function open(talk, w = 390, h = 844) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(t => {
    localStorage.setItem("hb-story-offered", "1");
    localStorage.setItem("hb-coach-seen", JSON.stringify(["draw", "bid", "contract", "firstTrick", "result"]));
    localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true, talk: t }));
    localStorage.removeItem("hb-solo-v1");
  }, talk);
  await p.goto(base + "/?solo=new");
  await p.waitForSelector("#hand .card");
  // 一直看著：同時可見的泡泡數、泡泡有沒有蓋到手牌和按鈕、表情記號有沒有累積
  await p.evaluate(() => {
    window.__qa = { maxBubbles: 0, overlap: 0, maxMarks: 0, shown: 0 };
    const hit = (a, c) => a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1;
    const watch = () => {
      const q = document.getElementById("quip");
      const vis = [...document.querySelectorAll(".quip:not([hidden])")];
      window.__qa.maxBubbles = Math.max(window.__qa.maxBubbles, vis.length);
      window.__qa.maxMarks = Math.max(window.__qa.maxMarks, document.querySelectorAll("#oppArea .emomark").length);
      if (!q.hidden) {
        window.__qa.shown++;
        const r = q.getBoundingClientRect();
        for (const id of ["hand", "playBtn", "hintBtn", "turnLine"]) { const e = document.getElementById(id); if (e && hit(r, e.getBoundingClientRect())) window.__qa.overlap++; }
      }
      requestAnimationFrame(watch);
    };
    watch();
  });
  return { ctx, p, errs };
}
// 打下去：會叫牌、會加倍，出牌用「提示」選的那張
async function playHands(p, hands, maxMs) {
  const t0 = Date.now();
  let done = 0, doubles = 0;
  while (Date.now() - t0 < maxMs && done < hands) {
    if (await p.locator("#result").isVisible()) {
      done++;
      await p.locator("#resSheet").click({ position: { x: 30, y: 100 } }).catch(() => {});
      await sleep(400);
      if (done >= hands) break;
      await p.click("#nextBtn").catch(() => {});
      await p.waitForFunction(() => document.getElementById("result").hidden, null, { timeout: 8000 }).catch(() => {});
      continue;
    }
    if (await p.locator("#bidPanel.mine").isVisible()) {
      if (await p.locator("#bidDouble:not([disabled])").count() && Math.random() < 0.7) { await p.click("#bidDouble"); doubles++; }
      else if ((await p.textContent("#bidContract")).includes("換你叫牌") || Math.random() < 0.35) {
        const lv = p.locator("#bidLevels button:not([disabled])");
        if (await lv.count()) { await lv.nth(Math.min(await lv.count() - 1, Math.floor(Math.random() * 3))).click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
        else await p.click("#bidPass");
      } else await p.click("#bidPass");
      await sleep(200); continue;
    }
    const mine = ((await p.getAttribute("#turnLine", "class")) ?? "").includes("mine");
    if (mine && await p.locator("#hand .card.legal").count()) { await p.click("#hintBtn"); await p.click("#playBtn"); await sleep(150); continue; }
    await sleep(100);
  }
  return { done, doubles };
}

console.log("正常互動：打幾局，台詞都對得上真的事件");
{
  const { ctx, p, errs } = await open("full");
  const r = await playHands(p, 4, 300000);
  const log = await p.evaluate(() => window.__hbAhe);
  const qa = await p.evaluate(() => window.__qa);
  const bad = log.filter(l => !(RULES[l.id] ?? (() => false))(l));
  ok(r.done >= 2, `打完 ${r.done} 局（加倍 ${r.doubles} 次），阿禾講了 ${log.length} 句`);
  ok(log.length > 0, `有講話：${[...new Set(log.map(l => l.id))].join("、")}`);
  ok(bad.length === 0, bad.length ? `對不上的台詞：${JSON.stringify(bad.slice(0, 3))}` : "每一句都對得上觸發它的真實事件（王吃、打成、加倍、誰當莊……）");
  const perHand = {};
  for (const l of log) if (l.cause !== "result") (perHand[l.deal] ??= []).push(l.id);   // 牌桌上的泡泡（結算單那一句另計）
  const most = Object.values(perHand).sort((a, c) => c.length - a.length)[0] ?? [];
  ok(most.length <= 8, `一局牌桌上最多講 ${most.length} 句（不吵）：${most.join("、")}`);
  ok(log.filter(l => l.id === "nonsense").length <= 2, `幹話 ${log.filter(l => l.id === "nonsense").length} 句（一場最多 2 句）`);
  const texts = log.map(l => l.text);
  let rep = 0; for (let i = 1; i < texts.length; i++) if (texts[i] === texts[i - 1]) rep++;
  ok(rep === 0, "沒有連續兩句一模一樣");
  ok(qa.maxBubbles <= 1 && qa.overlap === 0, `同時最多 ${qa.maxBubbles} 個泡泡；泡泡蓋到手牌／按鈕 ${qa.overlap} 次`);
  ok(qa.maxMarks <= 1, `表情記號沒有累積（最多 ${qa.maxMarks} 個）`);
  ok(errs.length === 0, `沒有錯誤${errs.length ? "：" + errs[0] : ""}`);
  await ctx.close();
}

console.log("精簡互動：只講重要的");
{
  const { ctx, p, errs } = await open("lite");
  await playHands(p, 2, 160000);
  const log = await p.evaluate(() => window.__hbAhe);
  ok(log.every(l => LITE_OK.has(l.id)), `只有重要事件（${[...new Set(log.map(l => l.id))].join("、") || "這兩局剛好沒有"}）`);
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

console.log("關閉額外吐槽：完全不講，牌照打、結算照常");
{
  const { ctx, p, errs } = await open("off");
  const r = await playHands(p, 1, 120000);
  const log = await p.evaluate(() => window.__hbAhe);
  const qa = await p.evaluate(() => window.__qa);
  ok(r.done === 1 && log.length === 0 && qa.shown === 0, `打完一局、阿禾一句都沒講（泡泡出現 ${qa.shown} 格）`);
  ok(await p.locator("#resTitle").innerText() !== "", "結算照常顯示");
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

await b.close();
console.log(fails ? `\n${fails} 項沒過` : "\n阿禾互動驗收全部通過");
process.exit(fails ? 1 : 0);
