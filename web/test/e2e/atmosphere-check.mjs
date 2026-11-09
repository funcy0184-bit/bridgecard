// 常駐氣氛、勝利分級、特效品質的驗收：
//   加倍／再加倍的進場、常駐、退場；我方／對方連贏與中斷；精簡模式仍看得懂；
//   自動品質依實際幀時間降級、恢復後再升級（不會一次卡頓就降）；長時間打牌元素不累積
// 用法：先 npm run dev，再 node test/e2e/atmosphere-check.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0; const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const c = (s, r) => s * 13 + (r - 2); const CL = 0, DI = 1, HE = 2, SP = 3;
const save = d => ({ hands: [[c(CL, 14), c(HE, 9), c(DI, 4)], [c(DI, 6), c(SP, 3)]], takenFaceUp: [[], []], stock: [], tricksWon: [7, 3],
  phase: 2, currentPlayer: 0, leader: 1, leadCard: c(CL, 13), followCard: -1, trump: HE, highestBid: 7, highestBidder: 0, doubled: d, declarer: 0,
  auction: [{ seat: 0, call: 7 }, { seat: 1, call: -2 }], passesInRow: 1, firstSeat: 0, targetScore: 100, scores: [0, 0], handsPlayed: 0, lastResult: null, matchWinner: -1 });
const b = await chromium.launch();
async function open(settings, snap) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(([st, sn]) => {
    localStorage.setItem("hb-story-offered", "1");
    localStorage.setItem("hb-coach-seen", JSON.stringify(["draw", "bid", "contract", "firstTrick", "result"]));
    localStorage.setItem("hb-web-settings", JSON.stringify(st));
    if (sn) localStorage.setItem("hb-solo-v1", JSON.stringify({ v: 1, game: sn })); else localStorage.removeItem("hb-solo-v1");
  }, [settings, snap]);
  await p.goto(base + (snap ? "/?solo=1" : "/?solo=new"));
  await p.waitForSelector("#hand .card");
  await sleep(500);
  return { ctx, p, errs };
}
const felt = p => p.evaluate(() => ({ heat: document.getElementById("felt").dataset.heat, tone: document.getElementById("felt").dataset.tone, mult: document.querySelector("#keyInfo .mult")?.textContent ?? "" }));
async function playOut(p, maxMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && !(await p.locator("#result").isVisible())) {
    if (await p.locator("#bidPanel.mine").isVisible()) {
      if ((await p.textContent("#bidContract")).includes("換你叫牌")) { await p.locator("#bidLevels button:not([disabled])").first().click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
      else await p.click("#bidPass");
      await sleep(150); continue;
    }
    const mine = (await p.getAttribute("#turnLine", "class"))?.includes("mine");
    if (mine && await p.locator("#hand .card.legal").count()) { await p.click("#hintBtn"); await p.click("#playBtn"); }
    await sleep(60);
  }
}

console.log("加倍／再加倍：進場、常駐、退場");
for (const d of [1, 2]) {
  const { ctx, p, errs } = await open({ fast: true, quality: "standard" }, save(d));
  const f = await felt(p);
  ok(f.heat === String(d) && f.tone === (d === 2 ? "wine" : "gold") && f.mult === `×${d === 2 ? 4 : 2}`, `${d === 2 ? "再加倍" : "加倍"}：氣氛 ${f.heat}／${f.tone}，倍率徽章 ${f.mult}`);
  await playOut(p);
  ok((await felt(p)).heat === String(d), "加倍的氣氛保留到這局結算");
  await p.locator("#resSheet").click({ position: { x: 30, y: 100 } }); await sleep(300);
  await p.click("#nextBtn"); await p.waitForFunction(() => document.getElementById("phaseText")?.textContent?.includes("搶牌"), null, { timeout: 8000 }); await sleep(300);
  ok((await felt(p)).heat === "0", "新的一局：氣氛退去");
  await p.click("#menuBtn"); await p.click("#leaveBtn"); await sleep(300);
  ok((await felt(p)).heat === "0" && (await p.evaluate(() => document.querySelectorAll(".streakchip:not([hidden])").length)) === 0, "離開對局：氣氛與標記清掉");
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

console.log("連續贏墩：我方暗金、對方酒紅、中斷就退去；不加分");
{
  // 固定牌局：1NT 阿禾當莊家、你先出。你有 ♠A～♠5（10 張）＋♥2～♥4；阿禾 ♠2～♠4＋♥5～♥A
  // → 你先連贏一大串黑桃，出紅心時被打斷，接著換阿禾連贏
  const sp = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map(r => c(SP, r)), mh = [2, 3, 4].map(r => c(HE, r));
  const ah = [2, 3, 4].map(r => c(SP, r)).concat([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => c(HE, r)));
  const streakSave = { hands: [sp.concat(mh), ah], takenFaceUp: [[], []], stock: [], tricksWon: [0, 0], phase: 2, currentPlayer: 0, leader: 0, leadCard: -1, followCard: -1,
    trump: 4, highestBid: 4, highestBidder: 1, doubled: 0, declarer: 1, auction: [{ seat: 1, call: 4 }, { seat: 0, call: -1 }], passesInRow: 1, firstSeat: 1,
    targetScore: 100, scores: [0, 0], handsPlayed: 0, lastResult: null, matchWinner: -1 };
  const { ctx, p, errs } = await open({ fast: true, quality: "standard" }, streakSave);
  await p.evaluate(() => { window.__chips = []; new MutationObserver(() => { for (const e of document.querySelectorAll(".streakchip:not([hidden])")) { const t = `${e.classList.contains("me") ? "me" : "opp"}|${e.textContent}|${document.getElementById("felt").dataset.tone}`; if (window.__chips.at(-1) !== t) window.__chips.push(t); } }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
  const scoreBefore = await p.evaluate(() => [document.getElementById("myScore").textContent, document.getElementById("oppScore").textContent]);
  let heatDuringMe = "", heatAfterBreak = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(await p.locator("#result").isVisible())) {
    const chip = await p.evaluate(() => [...document.querySelectorAll(".streakchip:not([hidden])")].map(e => e.className).join(","));
    if (chip.includes("me") && !heatDuringMe) heatDuringMe = (await felt(p)).heat + (await felt(p)).tone;
    if (heatDuringMe && !chip && !heatAfterBreak) heatAfterBreak = (await felt(p)).heat;
    const mine = (await p.getAttribute("#turnLine", "class"))?.includes("mine");
    if (mine && await p.locator("#hand .card.legal").count()) { await p.click("#hintBtn"); await p.click("#playBtn"); }
    await sleep(60);
  }
  const chips = await p.evaluate(() => window.__chips);
  const me = chips.filter(x => x.startsWith("me")), opp = chips.filter(x => x.startsWith("opp"));
  console.log(`   連贏標記：${chips.slice(0, 3).join("、")} … ${chips.slice(-2).join("、")}`);
  ok(me.length > 0 && me.every(x => /你連贏 \d+ 墩\|gold/.test(x)), "你連贏 3 墩以上：你旁邊出現「你連贏 N 墩」，桌緣暗金");
  ok(heatDuringMe === "1gold" && heatAfterBreak === "0", `連贏中斷：氣氛退去（連贏中 ${heatDuringMe} → 中斷後 ${heatAfterBreak}）`);
  ok(opp.length > 0 && opp.every(x => /阿禾連贏 \d+ 墩\|wine/.test(x)), "阿禾連贏：標記在阿禾旁邊、桌緣酒紅（是壓力，不是你在贏）");
  const sAfter = await p.evaluate(() => [document.getElementById("rtMe").textContent, document.getElementById("rtOpp").textContent, document.getElementById("resBody").innerText]);
  ok(!/連贏/.test(sAfter[2]), "結算明細沒有任何連贏加分（連贏只是氣氛）");
  void scoreBefore;
  // 長時間：特效元素不累積
  await sleep(1500);
  const counts = await p.evaluate(() => ({ fx: document.getElementById("fx").childElementCount, layer: document.querySelectorAll(".impactlayer > *").length, aura: document.querySelectorAll(".aura").length, chips: document.querySelectorAll(".streakchip").length }));
  ok(counts.layer === 0 && counts.aura === 1 && counts.chips === 2 && counts.fx < 12, `打完一整局特效元素沒有累積（${JSON.stringify(counts)}）`);
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

console.log("精簡品質：常駐氣氛靜態、沒有裝飾粒子，局面仍看得懂");
{
  const { ctx, p, errs } = await open({ fast: true, quality: "lite" }, save(2));
  const r = await p.evaluate(() => ({ q: document.documentElement.dataset.q, anim: getComputedStyle(document.querySelector(".aura .ag")).animationName, run: getComputedStyle(document.querySelector(".aura .ar")).display, heat: document.getElementById("felt").dataset.heat, turn: document.getElementById("turnLine").innerText, lead: document.getElementById("oppSlot").dataset.label + "|" + (document.querySelector("#oppSlot .card") ? "card" : ""), mult: document.querySelector("#keyInfo .mult")?.textContent }));
  ok(r.q === "lite" && r.anim === "none" && r.run === "none", `精簡：桌緣靜態（${r.anim}／${r.run}）`);
  ok(r.heat === "2" && r.mult === "×4" && /換你跟牌/.test(r.turn) && /①先出\|card/.test(r.lead), "精簡：倍率、輪到誰、領出花色都還在");
  await playOut(p);
  ok(await p.locator("#result").isVisible() && (await p.locator("#resTitle").innerText()).length > 0, "精簡：勝負與計分照常顯示");
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

console.log("自動品質：一段時間的實際幀時間才升降，不會一次卡頓就降級");
{
  const { ctx, p, errs } = await open({ fast: true, quality: "auto" }, null);
  // 低階的機器（核心數少）從精簡開始：先等它在順暢時升一級
  if ((await p.evaluate(() => document.documentElement.dataset.q)) === "lite") await p.waitForFunction(() => document.documentElement.dataset.q !== "lite", null, { timeout: 30000 }).catch(() => {});
  const start = await p.evaluate(() => ({ ...globalThis.__hbPerf, q: document.documentElement.dataset.q }));
  console.log(`   起始品質：${start.q}（順暢時會自動升級）`);
  // 一次短暫卡頓（300ms）：不該降級
  await p.evaluate(() => { const t = performance.now(); while (performance.now() - t < 300) {} });
  await sleep(4500);
  const afterSpike = await p.evaluate(() => document.documentElement.dataset.q);
  ok(afterSpike === start.q, `一次 300ms 卡頓不降級（${start.q} → ${afterSpike}）`);
  // 持續變卡（每一格多 30ms）：降一級
  await p.evaluate(() => { window.__busy = true; const loop = () => { if (!window.__busy) return; const t = performance.now(); while (performance.now() - t < 30) {} requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  await p.waitForFunction(q => document.documentElement.dataset.q !== q, start.q, { timeout: 20000 }).catch(() => {});
  const down = await p.evaluate(() => ({ q: document.documentElement.dataset.q, ...globalThis.__hbPerf }));
  ok(down.q !== start.q, `持續變卡：自動降級（${start.q} → ${down.q}，平均幀 ${down.avg}ms）`);
  // 恢復順暢：過一陣子才升回來
  await p.evaluate(() => { window.__busy = false; });
  await p.waitForFunction(q => document.documentElement.dataset.q !== q, down.q, { timeout: 30000 }).catch(() => {});
  const up = await p.evaluate(() => ({ q: document.documentElement.dataset.q, ...globalThis.__hbPerf }));
  ok(up.q !== down.q, `恢復順暢：過一陣子才升回來（${down.q} → ${up.q}，共調整 ${up.changes} 次）`);
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

console.log("減少動態效果：效能再好也是精簡");
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem("hb-story-offered", "1"); localStorage.removeItem("hb-web-settings"); });
  await p.goto(base + "/?solo=new"); await p.waitForSelector("#hand .card");
  ok((await p.evaluate(() => document.documentElement.dataset.q)) === "lite", "系統要求減少動態效果：自動品質用精簡");
  await ctx.close();
}

await b.close();
console.log(fails ? `${fails} 項失敗` : "氣氛與品質驗收全部通過");
process.exit(fails ? 1 : 0);
