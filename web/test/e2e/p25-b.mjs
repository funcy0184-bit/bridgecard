// P2.5-B 驗收：卡牌操作與出牌手感（L2：iPhone 13 完整一場 AI 對局＋減少動態一場＋快速操作＋重新整理）
//   · 按下「蓋牌」到牌開始動 ≤ 50ms（按下那一刻特效層就有飛行中的牌）
//   · 飛行途中我的出牌位是藏著的；落桌那一刻飛行的牌和出牌位誤差 ≤ 2px
//   · 對手的牌從對手名牌飛出；翻牌前整頁（含特效層）沒有對手的牌面
//   · 每一墩依序：翻牌 → 判勝負 → 看結果 → 收牌 → 清桌（整場最後一墩：翻牌 → 判勝負，不收牌）
//   · 連點「蓋牌」只會送出一次；拖牌上桌可以蓋牌
//   · 減少動態：不出現飛行的牌，照樣打完一場
//   · 重新整理（斷線回來）：不重播、沒有殘留的飛行牌
// 用法：node test/e2e/p25-b.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(reduce, quality = "") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, reducedMotion: reduce ? "reduce" : "no-preference" });
  await ctx.addInitScript(([q, key]) => { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); localStorage.setItem("hb-name", "大雞"); localStorage.setItem("hb-story-offered", "1"); if (q) localStorage.setItem(key, JSON.stringify({ quality: q })); } }, [quality, "hb-web-settings"]);
  const P = await ctx.newPage();
  const errors = [];
  P.on("pageerror", e => errors.push(String(e)));
  await P.goto(BASE + "/?dev=1"); await P.goto(BASE + "/?play=shuo");
  await P.click("#shuoAi"); await P.waitForSelector("#contract:not([hidden])");
  await P.click("#stakeSeal"); await sleep(300); await P.click("#readyBtn"); await P.waitForSelector("#lstable:not([hidden])");
  // 頁面裡的記錄器：每 30ms 記一次演出階段、檢查隱藏資訊、記錄出現過的飛行牌
  await P.evaluate(() => {
    const g = globalThis;
    g.__rec = { phases: [], leaks: [], clones: 0, hiddenDuringFly: 0, flySamples: 0, chips: 0, shadows: 0, moneyBad: [], preMoneyBad: [] };
    let last = "";
    setInterval(() => {
      const v = g.__hbLS?.(), s = g.__hbLSStage?.();
      if (!v || !s) return;
      const key = `${s.trick}:${s.phase}`;
      if (s.phase !== "idle" && key !== last) g.__rec.phases.push([s.trick, s.phase]);
      last = key;
      if (document.querySelector("#fx .lsfly")) g.__rec.clones++;
      if (document.querySelector("#fx .lsflychip")) g.__rec.chips++;
      if (document.querySelector("#lsFelt .impactlayer > .cshadow")) g.__rec.shadows++;
      // P2.5-C 錢：沒在展示時，名牌上的餘額＝伺服器的餘額；展示途中籌碼還沒收完時＝結算前（開局餘額−本墩承諾）
      const me = v.seat, mine = Number(document.getElementById("lsMyChips").textContent), theirs = Number(document.getElementById("lsOppChips").textContent);
      if (s.phase === "idle" && !s.trick && (mine !== v.stacks[me] || theirs !== v.stacks[1 - me])) g.__rec.moneyBad.push(`${mine}/${theirs} ≠ ${v.stacks[me]}/${v.stacks[1 - me]}`);
      if ((s.phase === "reveal" || s.phase === "verdict") && !v.result) {
        const R = v.history.find(h => h.trick === s.trick);
        if (R && (mine !== R.startStacks[me] - R.commit[me] || theirs !== R.startStacks[1 - me] - R.commit[1 - me])) g.__rec.preMoneyBad.push(`第 ${s.trick} 墩 ${mine}/${theirs}`);
      }
      // 隱藏資訊：不是展示中、也沒結束，整頁（含特效層）不能有手上沒有的牌面（對手的牌）
      if (!s.trick && !v.result) {
        const faces = [...document.querySelectorAll(".card:not(.back)")].filter(e => e.closest("#lstable, #fx") && !e.closest("#lsLogPanel")).map(e => Number(e.dataset.id)).filter(id => !Number.isNaN(id) && !v.hand.includes(id));
        if (faces.length) g.__rec.leaks.push(`第 ${v.trick} 墩 ${v.phase}：${faces.join(",")}`);
      }
      if (s.mine && !s.mine.landed) { g.__rec.flySamples++; if (document.getElementById("lsMySlot").classList.contains("incoming")) g.__rec.hiddenDuringFly++; }
    }, 30);
  });
  return { ctx, P, errors };
}

const has = (P, a) => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);

// 打一場：每個決定都照固定節奏；回傳統計
async function play(P, opt = {}) {
  const st = { locks: 0, startLag: [], land: [], dbl: 0, drag: 0, opp: 0, oppOk: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    if (await P.isVisible("#matchEnd:not([hidden])")) break;
    await sleep(140);
    const oppFrom = await P.evaluate(() => { const x = globalThis.__hbLSOppFrom; globalThis.__hbLSOppFrom = null; return x; });
    if (oppFrom) { st.opp++; if (oppFrom.inNameplate) st.oppOk++; }
    if (await has(P, "noflip")) await P.click('#lsActions [data-a="noflip"]');
    else if (await has(P, "nosafe")) await P.click('#lsActions [data-a="nosafe"]');
    else if (await P.isVisible('#lsActions [data-a="lock"]')) {
      const cards = P.locator("#lsHand .lscard:not([disabled])");
      const n = await cards.count();
      if (!n) continue;
      if (opt.drag && st.drag < 2 && st.locks >= 1) {
        // 拖牌上桌：按住手牌往上拖到牌桌放開
        const c = cards.nth(n - 1), id = Number(await c.getAttribute("data-id"));
        const b = await c.boundingBox(), f = await P.locator("#lsFelt").boundingBox();
        await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await P.mouse.down();
        for (let k = 1; k <= 8; k++) await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - (b.y - (f.y + f.height * 0.6)) * k / 8);
        await P.mouse.up();
        await P.waitForFunction(x => globalThis.__hbLS().myLock === x || !globalThis.__hbLS().hand.includes(x), id, { timeout: 3000 }).then(() => st.drag++, () => {});
        st.locks++;
        continue;
      }
      await cards.nth(0).click();
      (st.tips ??= []).push((await P.textContent("#lsRisk")).includes("拖到桌上"));   // P2.5-D 首次提示：第一次有、之後沒有
      await P.evaluate(() => { globalThis.__hbLSLand = null; });
      // 按下到開始動：同一個事件裡就要有飛行的牌（下一幀開始動）；第二次連點只會被擋掉
      const r = await P.evaluate(dbl => {
        const btn = document.querySelector('#lsActions [data-a="lock"]');
        const t = performance.now();
        btn.click();
        const lag = document.querySelector("#fx .lsfly") ? performance.now() - t : -1;
        if (dbl) btn.click();
        return { lag, clones: document.querySelectorAll("#fx .lsfly").length, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
      }, st.locks % 3 === 1);
      if (st.locks % 3 === 1) { st.dbl++; if (r.clones > 1) st.dblBad = (st.dblBad ?? 0) + 1; }
      if (!r.reduced) st.startLag.push(r.lag);
      st.locks++;
      if (!r.reduced) {
        await P.waitForFunction(() => !!globalThis.__hbLSLand, null, { timeout: 3000 }).catch(() => {});
        const land = await P.evaluate(() => globalThis.__hbLSLand);
        if (land) st.land.push(Math.max(land.dx, land.dy, land.dw));
      }
    }
    else if (await has(P, "call")) await P.click('#lsActions [data-a="call"]');
    else if (await has(P, "check")) await P.click('#lsActions [data-a="check"]');
  }
  st.ended = await P.isVisible("#matchEnd:not([hidden])");
  st.rec = await P.evaluate(() => globalThis.__rec);
  st.result = await P.evaluate(() => globalThis.__hbLS().result);
  return st;
}

// 每一墩的演出順序
function orderOk(phases, finalTrick) {
  const by = new Map();
  for (const [t, p] of phases) { if (!by.has(t)) by.set(t, []); const a = by.get(t); if (a.at(-1) !== p) a.push(p); }
  const bad = [];
  for (const [t, a] of by) {
    const want = t === finalTrick ? ["reveal", "verdict"] : ["reveal", "verdict", "hold", "collect"];
    const seq = a.filter(p => p !== "pre");
    let i = 0;
    for (const p of seq) { if (p === want[i]) i++; else if (!want.includes(p)) bad.push(`${t}:${p}`); }
    if (i < want.length - (t === finalTrick ? 0 : 1)) bad.push(`第 ${t} 墩只看到 ${seq.join("→")}`);   // 收牌很短，取樣可能跳過
  }
  return { tricks: by.size, bad };
}

console.log("P2.5-B 卡牌手感（iPhone 13）");
{
  const { ctx, P, errors } = await open(false);
  const st = await play(P, { drag: true });
  ok(st.ended, "打完整場（AI 對局）");
  const maxLag = Math.max(...st.startLag);
  ok(st.startLag.length >= 3 && maxLag >= 0 && maxLag <= 50, `按下蓋牌到開始動：${st.startLag.length} 次，最慢 ${maxLag.toFixed(1)}ms（≤ 50ms）`);
  const maxErr = Math.max(...st.land);
  ok(st.land.length >= 3 && maxErr <= 2, `落桌位置跟出牌位的誤差：${st.land.length} 次，最大 ${maxErr.toFixed(2)}px（≤ 2px）`);
  ok(st.rec.flySamples > 0 && st.rec.hiddenDuringFly === st.rec.flySamples, `飛行途中出牌位藏著（取樣 ${st.rec.flySamples} 次）`);
  ok(st.opp >= 3 && st.oppOk === st.opp, `對手的牌從對手名牌飛出（${st.oppOk}/${st.opp}）`);
  ok(st.rec.leaks.length === 0, `翻牌前整頁沒有對手的牌面${st.rec.leaks.length ? `：${st.rec.leaks.slice(0, 3).join("；")}` : ""}`);
  const o = orderOk(st.rec.phases, st.result?.trick);
  ok(o.tricks >= 3 && !o.bad.length, `每一墩依序 翻牌 → 判勝負 → 看結果 → 收牌（${o.tricks} 墩）${o.bad.length ? `：${o.bad.slice(0, 4).join("；")}` : ""}`);
  ok(st.dbl >= 1 && !st.dblBad, `連點蓋牌只演一次（${st.dbl} 次連點）`);
  ok(st.drag >= 1, `拖牌上桌蓋牌（${st.drag} 次）`);
  ok(st.tips?.[0] === true && st.tips.slice(1).every(x => !x), `首次提示只出現一次（蓋牌提示：${(st.tips ?? []).map(x => (x ? "有" : "無")).join("")}）`);
  ok(st.rec.shadows > 0, `標準品質落桌有接觸陰影（取樣到 ${st.rec.shadows} 次）`);
  ok(st.rec.chips > 0, `籌碼有飛（下注推上桌、結算收走；取樣到 ${st.rec.chips} 次）`);
  ok(st.rec.moneyBad.length === 0, `沒在展示時，名牌上的餘額＝伺服器的餘額${st.rec.moneyBad.length ? `：${st.rec.moneyBad.slice(0, 3).join("；")}` : ""}`);
  ok(st.rec.preMoneyBad.length === 0, `翻牌、判勝負時餘額還是結算前的（籌碼收完才變）${st.rec.preMoneyBad.length ? `：${st.rec.preMoneyBad.slice(0, 3).join("；")}` : ""}`);
  // P2.5-F：打完整場之後特效層沒有殘留（飛行的牌、籌碼、翻牌用的牌背、接觸陰影）
  await sleep(1500);
  const left = await P.evaluate(() => ({ fx: document.querySelectorAll("#fx .lsfly, #fx .lsflychip").length, flip: document.querySelectorAll(".lsflipback, .lsscan").length, shadow: document.querySelectorAll("#lsFelt .impactlayer > *").length }));
  ok(!left.fx && !left.flip && left.shadow <= 1, `打完整場特效沒有殘留（飛行 ${left.fx}、翻牌蓋 ${left.flip}、陰影 ${left.shadow}）`);
  ok(errors.length === 0, `沒有頁面錯誤${errors.length ? `：${errors[0]}` : ""}`);

  // 重新整理（等同斷線回來拿整份快照）：在牌飛到一半的時候重整
  console.log("重新整理（斷線回來）");
  await P.click("#matchEnd [data-act='rematch'], #rematchBtn").catch(() => {});
  await ctx.close();
}
{
  const { ctx, P, errors } = await open(false);
  for (let i = 0; i < 40; i++) {
    if (await has(P, "noflip")) await P.click('#lsActions [data-a="noflip"]');
    else if (await has(P, "nosafe")) await P.click('#lsActions [data-a="nosafe"]');
    else if (await P.isVisible('#lsActions [data-a="lock"]')) {
      const c = P.locator("#lsHand .lscard:not([disabled])");
      if (await c.count()) { await c.nth(0).click(); await P.click('#lsActions [data-a="lock"]'); await sleep(60); break; }
    }
    await sleep(150);
  }
  await P.reload();
  await P.waitForSelector("#lstable:not([hidden])", { timeout: 10000 }).catch(() => {});
  await P.waitForFunction(() => !!globalThis.__hbLS?.(), null, { timeout: 10000 }).catch(() => {});   // 等存檔恢復、拿到快照
  await sleep(400);
  const after = await P.evaluate(() => ({ clones: document.querySelectorAll("#fx .lsfly").length, stage: globalThis.__hbLSStage?.(), v: globalThis.__hbLS?.() }));
  ok(!!after.v && after.clones === 0 && after.stage?.phase === "idle" && !after.stage?.mine, `重新整理後不重播、沒有殘留的飛行牌（階段 ${after.stage?.phase}、飛行牌 ${after.clones}、牌桌 ${after.v ? "有" : "沒有"}、mine ${JSON.stringify(after.stage?.mine)}）`);
  const lockedOk = after.v && (after.v.myLock >= 0 ? await P.isVisible("#lsMySlot .card.back") : true);
  ok(lockedOk, "重新整理後出牌位照快照擺好");
  ok(errors.length === 0, `沒有頁面錯誤${errors.length ? `：${errors[0]}` : ""}`);
  await ctx.close();
}

console.log("減少動態（系統設定）");
{
  const { ctx, P, errors } = await open(true);
  const st = await play(P);
  ok(st.ended, "打完整場");
  ok(st.rec.clones === 0, `沒有飛行的牌（取樣到 ${st.rec.clones} 次）`);
  ok(st.rec.leaks.length === 0, "翻牌前整頁沒有對手的牌面");
  ok(errors.length === 0, `沒有頁面錯誤${errors.length ? `：${errors[0]}` : ""}`);
  await ctx.close();
}

console.log("精簡品質（低階手機／自動降級）");
{
  const { ctx, P, errors } = await open(false, "lite");
  const st = await play(P);
  ok(st.ended, "打完整場");
  const q = await P.evaluate(() => document.documentElement.dataset.quality ?? "");
  ok(st.land.length >= 3 && Math.max(...st.land) <= 2, `精簡品質照樣飛牌、落桌對準（${st.land.length} 次）`);
  ok(st.rec.shadows === 0, `精簡品質不畫接觸陰影（對局中取樣到 ${st.rec.shadows} 次）`);
  ok(st.rec.leaks.length === 0, "翻牌前整頁沒有對手的牌面");
  ok(errors.length === 0, `沒有頁面錯誤${errors.length ? `：${errors[0]}` : ""}${q ? `（品質 ${q}）` : ""}`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
