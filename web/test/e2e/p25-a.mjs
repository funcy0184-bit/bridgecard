// 梭了啦 P2.5-A 牌桌骨架驗收（瀏覽器真的點；模擬手機，不是真機）
//   每一步檢查：牌桌不能捲動、五區（頂列／對手名牌／牌桌／我的名牌＋手牌／行動列）由上往下不重疊、按鈕至少 44px、一排最多 4 顆
//   隱藏資訊：翻牌前對手的出牌位只有牌背（DOM 裡沒有牌面）；我蓋的牌離開手牌、在我的出牌位（牌背＋只有自己看得到的小標）
//   上一墩攤在桌上：翻牌墩是雙方真的牌、棄牌墩只有大中小；加注金額列（＋／−／梭哈／取消）；每墩紀錄、完整試算面板
//   大小：iPhone 13 打完整場；其他五種大小＋橫拿各打一段
// 用法：先 npx wrangler dev，再 node test/e2e/p25-a.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const SIZES = [
  ["iPhone 13", 390, 664, true], ["iPhone SE（第一代）", 320, 568], ["iPhone SE 2／8", 375, 553], ["LINE 內建瀏覽器（約）", 390, 600],
  ["Pixel 7", 412, 839], ["iPhone Pro Max", 430, 739], ["橫拿（約）", 740, 390],
].filter(x => !process.env.ONLY || process.env.ONLY.split(",").includes(x[0]));   // L1 冒煙：ONLY="iPhone 13" 只跑代表尺寸

// 在頁面裡量：回傳這一步的問題
const probe = () => {
  const v = globalThis.__hbLS?.();
  const issues = [];
  if (!v) return { issues: ["沒有牌桌"], phase: "" };
  const t = document.getElementById("lstable");
  if (t.scrollHeight > t.clientHeight + 1) issues.push(`牌桌可以捲動（${t.scrollHeight}/${t.clientHeight}）`);
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push("頁面可以橫向捲動");
  const R = id => document.getElementById(id).getBoundingClientRect();
  const zones = ["lsBar", "lsOpp", "lsFelt", "lsMe", "lsHand", "lsDock"].map(id => [id, R(id)]);
  for (let i = 1; i < zones.length; i++) if (zones[i][1].top < zones[i - 1][1].bottom - 1) issues.push(`${zones[i][0]} 跟 ${zones[i - 1][0]} 重疊`);
  const H = innerHeight;
  if (R("lsDock").bottom > H + 1) issues.push(`行動列超出畫面（${Math.round(R("lsDock").bottom)}/${H}）`);
  const btns = [...document.querySelectorAll("#lsActions button:not([hidden])")];
  for (const b of btns) { const r = b.getBoundingClientRect(); if (r.height < 44 - 0.5 || r.width < 44 - 0.5) issues.push(`按鈕太小：${b.dataset.a}（${Math.round(r.width)}×${Math.round(r.height)}）`); if (r.bottom > H + 1) issues.push(`按鈕在畫面外：${b.dataset.a}`); }
  const main = document.querySelectorAll(".lsbtns > button:not([hidden])").length;
  if (main > 4) issues.push(`一排有 ${main} 顆按鈕`);
  // 隱藏資訊與出牌位
  const me = v.seat, op = 1 - me, last = v.history.at(-1);
  // P2.5-A 生命週期：結算 → 展示（那一墩的牌＋那一墩的方向，#lsLast 變成 hot）→ 清空出牌區 → 下一墩；整場結束就一直攤著最後一墩
  const revealing = !!last && (!!v.result || document.getElementById("lsLast").classList.contains("hot"));
  const oppFaces = [...document.querySelectorAll("#lsOppSlot .card:not(.back)")].map(e => Number(e.dataset.id));
  const oppCats = [...document.querySelectorAll("#lsOppSlot .lscat")].map(e => e.textContent);
  const myFaces = [...document.querySelectorAll("#lsMySlot .card:not(.back), #lsMySlot .lscat")];
  const CAT = ["小", "中", "大"], DIR = { high: "比大", low: "比小" };
  if (!revealing) {
    if (oppFaces.length || oppCats.length) issues.push(`翻牌前對手出牌位出現牌面：${oppFaces.join(",")}${oppCats.join(",")}`);
    // P2.5-B：特效層（飛行中的牌）也不能有不是我自己的牌面
    const fxFaces = [...document.querySelectorAll("#fx .card:not(.back)")].map(e => Number(e.dataset.id)).filter(id => !v.hand.includes(id) && id !== v.myLock);
    if (fxFaces.length) issues.push(`翻牌前特效層出現不是我的牌面：${fxFaces.join(",")}`);
    if (myFaces.length) issues.push("展示結束了，我的出牌位還留著上一墩的牌（沒有清場）");
    if (v.locked[op] && !document.querySelector("#lsOppSlot .card.back")) issues.push("對手蓋了牌，出牌位沒有牌背");
    if (document.getElementById("lsDirBig").textContent !== DIR[v.dir]) issues.push(`方向顯示 ${document.getElementById("lsDirBig").textContent} ≠ 這一墩 ${DIR[v.dir]}`);
    if (!v.result && document.getElementById("lsTrick").textContent !== `第 ${v.trick}／9 墩`) issues.push(`頂列墩數 ${document.getElementById("lsTrick").textContent} ≠ 這一墩 ${v.trick}`);
  } else if (["pre", "reveal", "collect"].includes(globalThis.__hbLSStage?.().phase)) {
    // P2.5-B：翻牌途中（牌正在轉、勝負還沒揭曉）、收牌途中（牌正在飛走）不檢查金框和牌面位置；
    //   但翻牌還沒揭曉就先畫金框／變暗算錯；隱藏資訊在下面另外檢查（不管哪個階段都跑）
    if (globalThis.__hbLSStage().phase === "reveal" && document.querySelector("#lsOppSlot.win, #lsMySlot.win, #lsOppSlot.lose, #lsMySlot.lose")) issues.push("翻牌還沒揭曉就先畫了金框／變暗");
    if (document.getElementById("lsDirBig").textContent !== DIR[last.dir]) issues.push(`攤開第 ${last.trick} 墩，方向卻顯示 ${document.getElementById("lsDirBig").textContent}（那一墩是 ${DIR[last.dir]}）`);
  } else {
    // 展示中：頂列墩數、身分標也是那一墩的；對手名牌不出現下一墩的動作（想翻轉嗎…）
    if (!v.result && document.getElementById("lsTrick").textContent !== `第 ${last.trick}／9 墩`) issues.push(`攤開第 ${last.trick} 墩，頂列卻寫 ${document.getElementById("lsTrick").textContent}`);
    if (!v.result && document.getElementById("lsOppStatus").textContent) issues.push(`攤牌停留中，對手名牌卻出現下一墩的動作「${document.getElementById("lsOppStatus").textContent}」`);
    if (!v.result && document.getElementById("lsMyTag").textContent !== (last.declarer === me ? "宣戰權" : "下注先手")) issues.push("攤牌停留中，我的身分標不是那一墩的");
    // 展示中：方向、牌、贏家框都是「那一墩」的，而且贏家符合比大小
    if (document.getElementById("lsDirBig").textContent !== DIR[last.dir]) issues.push(`攤開第 ${last.trick} 墩，方向卻顯示 ${document.getElementById("lsDirBig").textContent}（那一墩是 ${DIR[last.dir]}）`);
    if (!document.getElementById("lsLast").textContent.includes(`第 ${last.trick} 墩`)) issues.push("結果標籤不是展示中的那一墩");
    const winSlot = document.querySelector("#lsMySlot.win") ? me : document.querySelector("#lsOppSlot.win") ? op : -1;
    if (winSlot !== last.winner) issues.push(`金框在 ${winSlot}，那一墩贏家是 ${last.winner}`);
    if (last.cards) {
      if (oppFaces[0] !== last.cards[op]) issues.push(`上一墩對手的牌攤錯：${oppFaces[0]} ≠ ${last.cards[op]}`);
      const mine = Number(document.querySelector("#lsMySlot .card:not(.back)")?.dataset.id);
      if (mine !== last.cards[me]) issues.push(`上一墩我的牌攤錯：${mine} ≠ ${last.cards[me]}`);
      const a = last.cards[0] % 13, b = last.cards[1] % 13;
      const w = a === b ? -1 : (last.dir === "high" ? a > b : a < b) ? 0 : 1;
      if (w !== last.winner) issues.push(`第 ${last.trick} 墩贏家跟比大小不符（${DIR[last.dir]}）`);
    } else if (oppCats[0] !== CAT[last.cats[op]] || oppFaces.length) issues.push("棄牌墩：對手出牌位應該只有大中小");
  }
  if (!revealing && v.myLock >= 0) {
    if (document.querySelector(`#lsHand .lscard[data-id="${v.myLock}"]`)) issues.push("蓋了的牌還在手牌裡");
    const SUITS = ["♣", "♦", "♥", "♠"], RT = { 11: "J", 12: "Q", 13: "K", 14: "A" }, r = v.myLock % 13 + 2;
    const want = `${RT[r] ?? r}${SUITS[Math.floor(v.myLock / 13)]}`;
    if (!document.querySelector("#lsMySlot .card.back") || document.querySelector("#lsMySlot .lspeek")?.textContent !== want) issues.push(`我的出牌位應該是牌背＋「${want}」`);
  }
  // 押注是 0 的時候不顯示（不要一堆 0）
  // P2.5-C：一墩剛結算、籌碼還沒收完（翻牌、判勝負）時，押注位顯示的是那一墩押的錢；其他時候是伺服器的本墩承諾
  const stg = globalThis.__hbLSStage?.(), presR = stg && ["pre", "reveal", "verdict"].includes(stg.phase) ? v.history.find(h => h.trick === stg.trick) : null;
  const shown = presR ? presR.commit : v.commit;
  for (const [id, n] of [["lsMyBet", shown[me]], ["lsOppBet", shown[op]]]) {
    if (!n && getComputedStyle(document.getElementById(id)).visibility !== "hidden") issues.push(`${id} 押 0 還顯示著`);
    if (n && !document.getElementById("lsFelt").classList.contains("paying") && document.getElementById(id).querySelector("b").textContent !== String(n)) issues.push(`${id} 顯示 ${document.getElementById(id).querySelector("b").textContent}，應該是 ${n}`);
  }
  if (v.result && !document.getElementById("lsHand").classList.contains("wait")) issues.push("整場結束，剩下的手牌沒有變暗");
  const handN = document.querySelectorAll("#lsHand .lscard").length, wantN = v.hand.length - (v.myLock >= 0 ? 1 : 0);
  if (handN !== wantN) issues.push(`手牌張數 ${handN} ≠ ${wantN}`);
  return { issues, phase: v.phase, trick: v.trick, revealing, hist: v.history.length, showing: revealing && !v.result };
};

async function startAi(P) {
  await P.goto(BASE + "/?dev=1");
  await P.goto(BASE + "/?play=shuo");
  await P.click("#shuoAi");
  await P.waitForSelector("#contract:not([hidden])");
  await P.click("#aiDevWait"); await P.waitForSelector("#lsDev:not([hidden])");
  await P.selectOption("#lsDevSpeed", "fast");
  await P.click("#lsDev .sheet > .close"); await P.waitForSelector("#lsDev", { state: "hidden" });
  await P.click("#stakeSeal");
  await P.waitForFunction(() => document.getElementById("contractState").textContent.includes("已蓋章"), null, { timeout: 4000 });
  await P.click("#readyBtn");
  await P.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
  await sleep(500);
}

let seedv = 0.41;
const rnd = () => (seedv = (seedv * 9301 + 0.4927) % 1);
const allIssues = [];
const seen = { cleared: 0, reveal: 0, revealFold: 0, lockMoved: 0, raiseRow: 0, allIn: 0, cancel: 0, flipBtns: 0, safeBtns: 0, wait: 0 };

for (const [name, w, h, full] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); localStorage.setItem("hb-name", "大雞"); localStorage.setItem("hb-story-offered", "1"); } });
  const P = await ctx.newPage();
  const errors = [];
  P.on("pageerror", e => errors.push(e.message));
  await startAi(P);
  const before = allIssues.length;
  const shot = async n => { if (SHOTS) await P.screenshot({ path: `${SHOTS}/p25a-${w}x${h}-${n}.png` }); };
  // 面板：每墩紀錄、完整試算（開了不推版面、可以關）；比賽已經結束就跳過（結算時面板會自己收）
  const panelsOk = async () => {
    if (await P.isVisible("#lsLast")) {
      await P.click("#lsLast"); await sleep(250);
      const n = await P.locator("#lsLogList li").count(), hist = await P.evaluate(() => globalThis.__hbLS().history.length);
      if (!(await P.isVisible("#lsLogPanel")) || n !== hist) allIssues.push(`${name}：每墩紀錄面板不對（${n}/${hist}）`);
      await shot("log");
      await P.click("#lsLogPanel [data-close]");
    }
    await P.click("#lsHelpBtn"); await sleep(250);
    if (!(await P.isVisible("#lsHelpPanel")) || !(await P.textContent("#lsHelpBody")).includes("大＝J～A")) allIssues.push(`${name}：完整試算面板不對`);
    await shot("help");
    await P.click("#lsHelpPanel [data-close]");
    const sc = await P.evaluate(() => { const t = document.getElementById("lstable"); return t.scrollTop; });
    if (sc) allIssues.push(`${name}：開關面板後牌桌捲動了`);
  };

  let steps = 0, panelsDone = false;
  const t0 = Date.now();
  while (Date.now() - t0 < (full ? 240000 : 60000) && (full || steps < 40)) {
    if (await P.isVisible("#matchEnd:not([hidden])")) break;
    await sleep(160);
    const r = await P.evaluate(probe);
    for (const x of r.issues) allIssues.push(`${name} 第 ${r.trick} 墩 ${r.phase}：${x}`);
    if (r.revealing && r.hist >= 1) { seen.reveal++; if (await P.locator("#lsOppSlot .lscat").count()) seen.revealFold++; }
    if (!r.revealing && r.hist >= 1 && r.phase !== "bet") seen.cleared++;
    const has = a => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
    if (await has("noflip")) { seen.flipBtns++; await P.click(`#lsActions [data-a="${rnd() < 0.25 ? "flip" : "noflip"}"]`); }
    else if (await has("nosafe")) { seen.safeBtns++; await P.click(`#lsActions [data-a="${rnd() < 0.15 ? "safe" : "nosafe"}"]`); }
    else if (await P.isVisible('#lsActions [data-a="lock"]')) {
      if (!panelsDone && r.hist >= 1) { panelsDone = true; await panelsOk(); }
      const n = await P.locator("#lsHand .lscard:not([disabled])").count();
      if (!n) continue;
      const pick = P.locator("#lsHand .lscard:not([disabled])").nth(Math.floor(rnd() * n));
      const id = Number(await pick.getAttribute("data-id"));
      await pick.click();
      if (steps < 3) await shot(`lock-${steps}`);
      await P.click('#lsActions [data-a="lock"]');
      const histBefore = r.hist;
      await P.waitForFunction(x => globalThis.__hbLS?.().myLock === x || globalThis.__hbLS?.().history.length > 0, id, { timeout: 3000 }).catch(() => {});
      // 這一墩還沒結算（還蓋著）：那張牌要在我的出牌位、不在手上；已經馬上翻牌結算的（例如保命墩不用下注）就攤在桌上
      const st = await P.evaluate(x => ({ lock: globalThis.__hbLS().myLock, hist: globalThis.__hbLS().history.length, inHand: !!document.querySelector(`#lsHand .lscard[data-id="${x}"]`), back: !!document.querySelector("#lsMySlot .card.back") }), id);
      if (st.lock === id) { if (!st.inHand && st.back) seen.lockMoved++; else allIssues.push(`${name}：蓋牌後那張牌沒有移到桌上`); }
      else if (st.hist <= histBefore) allIssues.push(`${name}：蓋牌沒有生效`);
      if (await P.evaluate(() => !globalThis.__hbLS().locked[1 - globalThis.__hbLS().seat])) seen.wait++;
    }
    else if (await has("call")) {
      if (await has("raiseopen") && rnd() < 0.3) { await P.click('#lsActions [data-a="raiseopen"]'); seen.raiseRow++; await P.click('#lsActions [data-a="raise"]'); }
      else await P.click(`#lsActions [data-a="${rnd() < 0.2 ? "fold" : "call"}"]`);
    }
    else if (await has("raiseopen")) {
      await P.click('#lsActions [data-a="raiseopen"]'); seen.raiseRow++;
      const r2 = await P.evaluate(probe);
      for (const x of r2.issues) allIssues.push(`${name} 加注金額列：${x}`);
      const label = async () => (await P.textContent('#lsActions [data-a="raise"]')).trim();
      const a = await label();
      if (await P.isEnabled('#lsActions [data-a="plus"]')) { await P.click('#lsActions [data-a="plus"]'); if ((await label()) === a) allIssues.push(`${name}：按＋金額沒變`); await P.click('#lsActions [data-a="minus"]'); }
      if (await has("max")) { await P.click('#lsActions [data-a="max"]'); if ((await label()).startsWith("梭哈")) seen.allIn++; else allIssues.push(`${name}：按梭哈之後按鈕沒寫梭哈`); }
      if (rnd() < 0.4) { await P.click('#lsActions [data-a="cancel"]'); seen.cancel++; if (await P.isVisible('#lsActions [data-a="raise"]')) allIssues.push(`${name}：取消後金額列沒收起來`); await P.click('#lsActions [data-a="check"]'); }
      else await P.click('#lsActions [data-a="raise"]');
    }
    else if (await has("check")) await P.click('#lsActions [data-a="check"]');
    steps++;
  }

  await shot("end");
  if (errors.length) allIssues.push(`${name} 頁面錯誤：${errors.slice(0, 3).join(" | ")}`);
  const mine = allIssues.length - before;
  ok(mine === 0, `${name} ${w}×${h}：${steps} 步，每一步都不捲動、五區不重疊、按鈕夠大、翻牌前看不到對手的牌${mine ? `（${mine} 個問題）` : ""}`);
  if (mine) console.log("     ", allIssues.slice(before, before + 6).join("\n      "));
  if (full) ok(await P.isVisible("#matchEnd:not([hidden])"), `${name}：打完整場`);
  await ctx.close();
}
ok(seen.lockMoved >= 5, `蓋牌：那張牌離開手牌、變成我出牌位的牌背（${seen.lockMoved} 次）`);
ok(seen.reveal > 0, `結算後展示那一墩：牌、方向、金框、結果標籤都是那一墩的，贏家符合比大小（${seen.reveal} 次，其中棄牌 ${seen.revealFold} 次）`);
ok(seen.cleared > 0, `展示結束後出牌區清空、方向換成這一墩（${seen.cleared} 次）`);
ok(seen.raiseRow > 0 && seen.cancel > 0, `加注金額列：展開 ${seen.raiseRow} 次、取消 ${seen.cancel} 次、梭哈按鈕 ${seen.allIn} 次`);
ok(seen.flipBtns > 0 && seen.safeBtns > 0, `宣戰權（${seen.flipBtns}）、保命（${seen.safeBtns}）都出現過`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
