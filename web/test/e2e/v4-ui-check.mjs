// 對局 UI 精簡版 V4 驗收（手機 360×640、390×844 與桌面 1280×800）：
//   不捲動、階段一眼看得出來、流程可以點開說明（不影響牌局）、主要提示只有一個焦點、
//   手牌花色張數正確、牌局紀錄只放公開過的牌、音量鈕兩種狀態、手牌沒變形、選牌→確認出牌正常、詳細計分收起來
// 用法：先 npm run dev，再 node test/e2e/v4-ui-check.mjs [網址] [舊版網址（可省略，用來比較主畫面字數）]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const oldBase = process.argv[3] ?? "";
let fails = 0; const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STAGE_TITLES = ["先來搶牌", "這局敢叫多大？", "正式開打", "來算分吧"];
const b = await chromium.launch();

async function open(url, vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(() => {
    localStorage.setItem("hb-story-offered", "1");
    localStorage.setItem("hb-coach-seen", JSON.stringify(["draw", "bid", "contract", "firstTrick", "result"]));
    localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true }));
    localStorage.removeItem("hb-solo-v1");
    // 記下每一張「公開出現在桌上」的牌：翻開的明牌、兩個出牌格
    window.__public = new Set();
    new MutationObserver(() => {
      for (const c of document.querySelectorAll("#stock .faceup .card, #mySlot .card, #oppSlot .card")) window.__public.add(Number(c.dataset.id));
    }).observe(document, { subtree: true, childList: true });
  });
  await p.goto(url + "/?solo=new");
  await p.waitForSelector("#hand .card");
  await sleep(500);
  return { ctx, p, errs };
}

// 主畫面看得到的字數（不算牌面、對手背面牌、彈出面板）
const visibleText = p => p.evaluate(() => {
  const root = document.getElementById("table");
  const skip = el => el.closest(".card, #oppFan, #stagePop, #tipPop, #recordPop, .sr-only, #bidPanel, [hidden]");
  let n = 0;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const el = t.parentElement;
    if (!el || skip(el)) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0) continue;
    n += t.textContent.replace(/\s/g, "").length;
  }
  // 出牌格標籤是 ::after 內容
  for (const s of root.querySelectorAll(".slot")) n += (s.dataset.label ?? "").replace(/\s/g, "").length;
  return n;
});
const box = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const overlap = (a, c) => a && c && a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
const noScroll = p => p.evaluate(() => {
  window.scrollTo(0, 400);
  const t = document.getElementById("table");
  return window.scrollY === 0 && document.scrollingElement.scrollHeight <= innerHeight + 1 && t.scrollHeight <= t.clientHeight + 1;
});
async function suitCountsOk(p) {
  return p.evaluate(() => {
    const ids = [...document.querySelectorAll("#hand .card")].map(c => Number(c.dataset.id));
    const n = [0, 0, 0, 0]; for (const id of ids) n[Math.floor(id / 13)]++;
    const shown = [...document.querySelectorAll("#suitCount .sc")].map(e => ({ s: e.querySelector("i").textContent, v: Number(e.querySelector("b").textContent), red: e.classList.contains("red") }));
    const want = [["♠", n[3], false], ["♥", n[2], true], ["♦", n[1], true], ["♣", n[0], false]];
    const same = shown.length === 4 && want.every(([s, v, red], i) => shown[i].s === s && shown[i].v === v && shown[i].red === red);
    return { same, sum: shown.reduce((a, x) => a + x.v, 0), hand: ids.length, shown: shown.map(x => x.s + x.v).join(" ") };
  });
}
// 像人一樣點牌：找這張牌露出來、點得到的位置再點（手牌是扇形疊在一起的）
async function tapCard(p, id) {
  const pt = await p.evaluate(id => {
    const el = document.querySelector(`#hand .card[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.15, 0.3, 0.5]) for (let x = r.left + 3; x < r.right - 2; x += 3) {
      const y = r.top + r.height * fy;
      if (document.elementFromPoint(x, y)?.closest(".card") === el) return { x, y };
    }
    return null;
  }, id);
  if (!pt) return false;
  await p.mouse.click(pt.x, pt.y);
  return true;
}
async function myTurnNow(p) {
  return ((await p.getAttribute("#turnLine", "class")) ?? "").includes("mine") && (await p.locator("#hand .card.legal").count()) > 0 && (await p.locator("#hand .card.flying").count()) === 0;
}

for (const [label, vp, mobile] of [["手機 360×640", { width: 360, height: 640 }, true], ["手機 390×844", { width: 390, height: 844 }, true], ["桌面 1280×800", { width: 1280, height: 800 }, false]]) {
  console.log(`\n${label}`);
  const { ctx, p, errs } = await open(base, vp, mobile);

  // 1. 階段一眼看得出來；畫面不捲動
  ok((await p.locator("#phaseChip li.now").innerText()).includes("搶牌") && /搶牌中/.test(await p.innerText("#keyInfo")) && /\/ 13/.test(await p.innerText("#keyInfo")), "搶牌：流程停在「搶牌」，第二排寫「搶牌中 n / 13」");
  ok(await noScroll(p), "牌桌沒有整頁上下捲動");

  // 2. 流程每一格都能點開說明，點空白處收起來，牌局不受影響
  const before = await p.evaluate(() => [...document.querySelectorAll("#hand .card")].map(c => c.dataset.id).join(","));
  let stageOk = true, stageNoCover = true;
  for (let i = 0; i < 4; i++) {
    await p.locator(`#phaseChip button[data-stage="${i}"]`).click();
    await sleep(120);
    const vis = await p.locator("#stagePop").isVisible();
    const title = await p.innerText("#stageTitle");
    if (!vis || title !== STAGE_TITLES[i]) stageOk = false;
    const pop = await box(p, "#stagePop");
    if (overlap(pop, await box(p, "#playBtn")) || overlap(pop, await box(p, "#hand"))) stageNoCover = false;
    await p.mouse.click(vp.width / 2, (await box(p, "#felt")).b - 30);   // 點牌桌空白處
    await sleep(120);
    if (await p.locator("#stagePop").isVisible()) stageOk = false;
  }
  ok(stageOk, "①搶牌 ②叫牌 ③出牌 ④結算 都能點開說明，點空白處就收起來");
  ok(stageNoCover, "階段說明不遮手牌和確認出牌");
  ok(before === await p.evaluate(() => [...document.querySelectorAll("#hand .card")].map(c => c.dataset.id).join(",")), "看說明不改變牌局（手牌沒變）");

  // 3. 音量：留聲機喇叭，靜音／有聲一眼分得出來；按鈕夠大
  const mb = await box(p, "#muteBtn");
  const m0 = await p.evaluate(() => ({ on: getComputedStyle(document.querySelector("#muteBtn .on")).display, off: getComputedStyle(document.querySelector("#muteBtn .off")).display, pressed: document.getElementById("muteBtn").getAttribute("aria-pressed") }));
  await p.locator("#muteBtn").click(); await sleep(80);
  const m1 = await p.evaluate(() => ({ on: getComputedStyle(document.querySelector("#muteBtn .on")).display, off: getComputedStyle(document.querySelector("#muteBtn .off")).display, pressed: document.getElementById("muteBtn").getAttribute("aria-pressed"), muted: JSON.parse(localStorage.getItem("hb-web-settings")).muted }));
  await p.locator("#muteBtn").click(); await sleep(80);
  ok(m0.on !== "none" && m0.off === "none" && m0.pressed === "false" && m1.on === "none" && m1.off !== "none" && m1.pressed === "true" && m1.muted === true, "音量鈕：有聲是喇叭＋聲波、靜音是喇叭＋✕，設定真的切換");
  ok(mb.w >= 40 && mb.h >= 40, `音量鈕夠大（${Math.round(mb.w)}×${Math.round(mb.h)}）`);

  // 4. 手牌沒變形、牌面看得到
  const cards = await p.evaluate(() => [...document.querySelectorAll("#hand .card")].map(c => ({ w: c.offsetWidth, h: c.offsetHeight })));
  const w0 = cards[0].w;
  ok(cards.every(c => c.w === w0 && Math.abs(c.h / c.w - 1.42) < 0.03), `手牌等比例（寬 ${w0}px、高 ${cards[0].h}px，13 張一樣大）`);
  if (mobile) ok(w0 >= 56 && w0 <= 62 && cards[0].h >= 78 && cards[0].h <= 88, "手機手牌在 56–62 × 78–87 左右");

  // 5. 一路打完一局：檢查提示、花色張數、選牌→確認、不能出的理由、紀錄面板、「?」
  let sawSingle = true, singleChecks = 0, countOk = true, countChecks = 0, sawPulse = false, sawTip = false, sawIllegal = false, sawToggle = false;
  let recOk = null, recLeak = false, sawPlayKey = false, sawDefend = false, sawBidKey = false, textPlay = -1, scrollOk = true;
  const t0 = Date.now();
  await p.evaluate(() => { window.__hit = 0; new MutationObserver(ms => { for (const m of ms) if (m.target.classList?.contains("hit")) window.__hit++; }).observe(document.getElementById("suitCount"), { subtree: true, attributes: true, attributeFilter: ["class"] }); });
  while (Date.now() - t0 < 150000 && !(await p.locator("#result").isVisible())) {
    if (await p.locator("#bidPanel.mine").isVisible()) {
      const k = await p.innerText("#keyInfo");
      if (/叫牌中/.test(k) && /輪到你/.test(k)) sawBidKey = true;
      // 360：都 Pass，讓阿禾當莊（看防守方的顯示）；其他尺寸：自己叫
      if (label.includes("360") || !(await p.textContent("#bidContract")).includes("換你叫牌")) await p.click("#bidPass");
      else { await p.locator("#bidLevels button:not([disabled])").first().click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
      await sleep(250); continue;
    }
    if (await myTurnNow(p)) {
      // 主要提示只有一句（＋旁邊的「?」）
      const tl = await p.evaluate(() => { const l = document.getElementById("turnLine"); return { tts: l.querySelectorAll(".tt").length, kids: l.children.length, text: l.querySelector(".tt").innerText }; });
      singleChecks++; if (!(tl.tts === 1 && tl.kids === 2 && !tl.text.includes("\n"))) sawSingle = false;
      const sc = await suitCountsOk(p); countChecks++; if (!sc.same || sc.sum !== sc.hand) { countOk = false; console.log("    花色張數不對：", sc); }
      if (!(await noScroll(p))) scrollOk = false;
      const phase = await p.innerText("#phaseText");
      if (phase.includes("後半")) {
        const k = await p.innerText("#keyInfo");
        if (/王牌|無王/.test(k) && /莊家/.test(k) && /\/ \d+ 墩/.test(k)) sawPlayKey = true;
        if (/莊家 阿禾/.test(k) && /你防守/.test(k)) sawDefend = true;
        if (textPlay < 0) textPlay = await visibleText(p);
      }
      // 「?」：規則細節點開才看
      if (!sawTip) {
        await p.locator("#turnLine .qbtn").click(); await sleep(120);
        const tb = await box(p, "#tipPop"), lb = await box(p, "#turnLine");
        sawTip = await p.locator("#tipPop").isVisible() && (await p.innerText("#tipText")).length > 6 && tb.b <= lb.t + 1 && !overlap(tb, await box(p, "#playBtn"));
        await p.mouse.click(vp.width / 2, (await box(p, "#felt")).t + 40); await sleep(120);
        sawTip = sawTip && !(await p.locator("#tipPop").isVisible());
      }
      // 牌局紀錄：搶過幾墩以後打開看（不遮確認出牌；只有公開過的牌）
      if (recOk === null && (await p.evaluate(() => (JSON.parse(sessionStorage.getItem("hb-trick-log") ?? "{}").list ?? []).length)) >= 3) {
        await p.locator("#recordBtn").click(); await sleep(200);
        const rb = await box(p, "#recordPop"), lb = await box(p, "#turnLine");
        let good = rb && rb.b <= lb.t + 1 && !overlap(rb, await box(p, "#playBtn")) && !overlap(rb, await box(p, "#hand"));
        for (const tab of ["mine", "opp", "tricks", "auction"]) {
          await p.locator(`#recordPop [data-tab="${tab}"]`).click(); await sleep(100);
          const r = await p.evaluate(t => {
            const ids = [...document.querySelectorAll("#recBody .card")].map(c => Number(c.dataset.id));
            const w = [...document.querySelectorAll("#recBody .card")].map(c => c.offsetWidth);
            return { ids, minW: w.length ? Math.min(...w) : 99, cnt: t === "mine" ? Number(document.getElementById("cntMine").textContent) : t === "opp" ? Number(document.getElementById("cntOpp").textContent) : -1, leak: ids.filter(id => !window.__public.has(id)) };
          }, tab);
          if (r.leak.length) { recLeak = true; console.log("    紀錄裡有沒公開過的牌：", tab, r.leak); }
          if ((tab === "mine" || tab === "opp") && r.ids.length !== r.cnt) good = false;
          if (r.minW < 40) good = false;
          if (tab === "tricks" && !(await p.locator("#recBody .recrow").count())) good = false;
        }
        const scrollable = await p.evaluate(() => { const b = document.getElementById("recBody"); return getComputedStyle(b).overflowY; });
        await p.mouse.click(vp.width / 2, (await box(p, "#turnLine")).t - 2 > (await box(p, "#recordPop")).b ? (await box(p, "#turnLine")).b + 4 : 5);
        await sleep(150);
        const closed = !(await p.locator("#recordPop").isVisible());
        if (!closed) await p.locator("#recordPop [data-rclose]").click();
        recOk = good && closed && scrollable === "auto";
      }
      // 選牌→再點收回；不能出的牌說理由；最後按確認出牌
      const legal = p.locator("#hand .card.legal").first();
      const legalId = await legal.getAttribute("data-id");
      const dim = p.locator("#hand .card.dim").first();
      if (!sawIllegal && await dim.count()) {
        const dimId = await dim.getAttribute("data-id");
        await tapCard(p, dimId); await sleep(150);
        const t = await p.innerText("#turnLine");
        sawIllegal = /必須先跟/.test(t) && ((await p.getAttribute("#turnLine", "class")) ?? "").includes("bad");
        await tapCard(p, dimId); await sleep(100);
      }
      const n0 = await p.locator("#hand .card").count();
      const card = p.locator(`#hand .card[data-id="${legalId}"]`);
      if (!sawToggle) {
        await tapCard(p, legalId); await sleep(100); const s1 = await card.evaluate(e => e.classList.contains("sel"));
        await tapCard(p, legalId); await sleep(100); const s2 = await card.evaluate(e => e.classList.contains("sel"));
        sawToggle = s1 && !s2;
      }
      await tapCard(p, legalId); await sleep(80);
      if (!(await card.evaluate(e => e.classList.contains("sel")))) await p.click("#hintBtn");   // 保險：用「提示」選一張能出的
      await p.click("#playBtn");
      await sleep(200);
      const n1 = await p.locator("#hand .card").count();
      if (n1 >= n0 && !(await p.locator("#result").isVisible())) { /* 可能還在飛，下一圈再看 */ }
      await sleep(250);
      if ((await p.evaluate(() => window.__hit)) > 0) sawPulse = true;
      continue;
    }
    await sleep(120);
  }
  ok(await p.locator("#result").isVisible(), "打完一整局");
  ok(sawSingle && singleChecks > 5, `輪到你時主要提示只有一句（檢查 ${singleChecks} 次）`);
  ok(countOk && countChecks > 5, `手牌花色張數 = 實際手牌（♠♥♦♣ 順序、紅黑顏色、總數），檢查 ${countChecks} 次`);
  ok(sawPulse, "張數變化時那個數字有彈一下");
  ok(sawTip, "「?」點開才看規則，不遮確認出牌，點空白處收起來");
  ok(sawToggle, "點牌選起、再點一次收回");
  ok(sawIllegal || label.includes("1280"), sawIllegal ? "點到不能出的牌：一句具體理由（你還有…必須先跟…）" : "（這一局沒遇到不能出的牌）");
  ok(recOk === true, "牌局紀錄：展開不遮手牌和確認出牌，分頁可切換，牌夠大，點空白處收起來");
  ok(!recLeak, "牌局紀錄只出現公開過的牌（明牌、打出來的牌），沒有暗牌或對手手牌");
  ok(sawBidKey || label.includes("360"), "叫牌：第二排寫「叫牌中 · 輪到你」");
  ok(sawPlayKey, "出牌：第二排有合約、王牌、莊家、已贏 / 目標墩數");
  if (label.includes("360")) ok(sawDefend, "阿禾當莊：寫「莊家 阿禾」＋「你防守」，不會誤會成自己的目標");
  ok(scrollOk, "打牌途中都沒有整頁捲動");
  if (textPlay > 0) console.log(`    主畫面字數（出牌、輪到你時）：${textPlay} 字`);

  // 6. 結算：詳細計分預設收起來
  await p.locator("#resSheet").click({ position: { x: 30, y: 100 } }); await sleep(300);
  const closedFirst = !(await p.evaluate(() => document.getElementById("resMore").open));
  await p.locator("#resMore summary").click(); await sleep(150);
  ok(closedFirst && await p.locator("#resBody").isVisible(), "結算：詳細計分預設收起來，點「計分明細」才展開");
  ok(errs.length === 0, `沒有錯誤${errs.length ? "：" + errs.join(" / ") : ""}`);
  await ctx.close();
}

// 主畫面字數：跟舊版比（有給舊版網址才比）
if (oldBase) {
  console.log("\n主畫面字數比較（390×844，出牌階段輪到你時）");
  const count = async url => {
    const { ctx, p } = await open(url, { width: 390, height: 844 }, true);
    const t0 = Date.now(); let n = -1;
    while (Date.now() - t0 < 120000 && n < 0) {
      if (await p.locator("#bidPanel.mine").isVisible()) {
        if ((await p.textContent("#bidContract")).includes("換你叫牌")) { await p.locator("#bidLevels button:not([disabled])").first().click(); await p.locator("#bidStrains button:not([disabled])").first().click(); await p.click("#bidConfirm"); }
        else await p.click("#bidPass");
        await sleep(250); continue;
      }
      if (await myTurnNow(p)) {
        if ((await p.innerText("#phaseText")).includes("後半")) { await sleep(400); n = await visibleText(p); break; }
        await p.click("#hintBtn"); await p.click("#playBtn"); await sleep(250); continue;
      }
      await sleep(120);
    }
    await ctx.close();
    return n;
  };
  const [o, nw] = [await count(oldBase), await count(base)];
  console.log(`    舊版 ${o} 字 → 新版 ${nw} 字`);
  ok(o > 0 && nw > 0 && nw < o, "主畫面文字明顯減少");
}

await b.close();
console.log(fails ? `\n${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
