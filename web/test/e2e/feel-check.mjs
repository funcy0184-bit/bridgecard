// 手感四項驗收：操作反應（點牌一格內就有反應、不等前一個動畫）、規則清楚（不能出的牌說原因）、
// 特效分級（一般／關鍵／勝利由真實事件觸發）、效能（影格時間、長任務）。用法：先 npm run dev，再 node test/e2e/feel-check.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const ctx = await b.newContext({ ...devices["iPhone 13"] });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await p.addInitScript(() => {
  localStorage.setItem("hb-story-offered", "1");
  // 效能：記錄長任務與每一格的時間
  window.__long = []; window.__frames = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch {}
  let last = performance.now();
  const loop = t => { window.__frames.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
await p.goto(base + "/?solo=new"); await p.waitForSelector("#hand .card");

console.log("1. 操作反應：點牌立刻有反饋（不等前一個動畫）");
const resp = [];
let illegalSeen = false, notTurnSeen = false;
const t0 = Date.now();
while (Date.now() - t0 < 170000 && !(await p.locator("#result").isVisible())) {
  if (await p.locator("#bidPanel.mine").isVisible()) {
    if ((await p.textContent("#bidContract")).includes("輪到你叫牌")) { await p.locator("#bidLevels button:not([disabled])").first().click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
    else await p.click("#bidPass");
    await p.waitForTimeout(200); continue;
  }
  const mine = (await p.getAttribute("#turnLine", "class"))?.includes("mine");
  // 不是你的回合（對手出牌、或這墩結算中）也點一下：要立刻有反應
  if (!mine && (await p.locator("#hand .card").count()) > 2 && resp.length < 8) {
    const r = await p.evaluate(() => {
      const cards = [...document.querySelectorAll("#hand .card")];
      const el = cards[Math.floor(cards.length / 2)];
      if (!el || el.classList.contains("sel")) return null;
      const t = performance.now();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { dt: performance.now() - t, sel: el.classList.contains("sel"), busy: !!document.querySelector(".card.flying") };
    });
    if (r) resp.push(r);
  }
  if (mine && !illegalSeen && await p.locator("#hand .card.dim").count()) {
    const id = await p.locator("#hand .card.dim").first().getAttribute("data-id");
    await p.locator(`#hand .card[data-id="${id}"]`).click({ position: { x: 10, y: 34 }, force: true });
    await p.waitForTimeout(80);
    const why = await p.locator(".why").first().textContent().catch(() => "");
    console.log("2. 規則清楚：不能出的牌說明原因");
    ok(/要先跟/.test(why ?? ""), `點不能出的牌：擺動＋提示「${why}」`);
    illegalSeen = true;
  }
  if (mine && await p.locator("#hand .card.legal").count()) {
    const id = await p.locator("#hand .card.legal").first().getAttribute("data-id");
    const c = p.locator(`#hand .card[data-id="${id}"]`);
    await c.click({ position: { x: 10, y: 34 } }); await p.click("#playBtn");
  }
  await p.waitForTimeout(90);
}
ok(resp.length > 0 && resp.every(r => r.sel), `不是你的回合也能先選牌：${resp.filter(r => r.sel).length}/${resp.length} 次立刻選起來`);
ok(resp.length > 0 && Math.max(...resp.map(r => r.dt)) < 16, `點下去到牌升起：最慢 ${Math.max(...resp.map(r => r.dt)).toFixed(1)}ms（一格內）；其中 ${resp.filter(r => r.busy).length} 次是在別的動畫進行中`);
ok(illegalSeen, "有測到不能出的牌");

console.log("3. 特效分級：一般／關鍵／勝利由真實事件觸發、看得出差別");
const log = await p.evaluate(() => globalThis.__hbFx);
const tricks = log.filter(x => x.kind === "trick");
const lv = n => tricks.filter(x => x.level === n).length;
console.log(`   這一局：一般 ${lv(1)} 墩、關鍵 ${lv(2)} 墩、合約級 ${lv(3)} 墩；叫牌 ${log.filter(x => x.kind === "bid").length} 次（分級 ${[...new Set(log.filter(x => x.kind === "bid").map(x => x.level))].join("/")}）`);
ok(lv(1) >= tricks.length * 0.6, "大部分是一般贏墩（不會每一墩都在爆炸）");
ok(lv(3) <= 2, "合約級特效一局最多兩次（合約達成或擊破）");
ok(!log.some(x => x.kind === "victory"), "沒有整場勝利時不放勝利特效");

console.log("4. 效能");
const frames = (await p.evaluate(() => window.__frames)).slice(30).sort((a, b) => a - b);
const p50 = frames[Math.floor(frames.length * 0.5)], p95 = frames[Math.floor(frames.length * 0.95)];
const longs = await p.evaluate(() => window.__long);
console.log(`   影格時間 中位數 ${p50.toFixed(1)}ms、95% ${p95.toFixed(1)}ms（共 ${frames.length} 格）；長任務 ${longs.length} 次 ${longs.length ? "（最長 " + Math.max(...longs) + "ms）" : ""}`);
ok(p50 < 20, "一般情況維持約 60 FPS（中位數影格 < 20ms）");
ok(longs.filter(x => x > 100).length === 0, "沒有超過 100ms 卡住畫面的長任務");
ok(errs.length === 0, "沒有錯誤" + (errs.length ? "：" + errs.join("|") : ""));
await b.close();
console.log(fails ? `${fails} 項失敗` : "驗收全部通過");
process.exit(fails ? 1 : 0);
