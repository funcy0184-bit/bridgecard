// 逆命賭局 P1（瀏覽器真的點）：房主用 iPhone 13、朋友用桌機（另一個獨立瀏覽器環境）
//   賭局契約書：提示文字輪播（點了、打字、有字就停；減少動態效果不輪播）、即時預覽、空白＝我最後的尊嚴、蓋章、雙方看得到
//   牌桌：方向與下一墩、雙方籌碼／剩餘張數／大中小、底注與上限、已投入、可能損失／獲得、輪到誰、
//         鎖牌、過牌、加注／反加、接戰、棄牌、梭哈顯示「每人押多少」；中途重新整理；打完九墩或歸零 → 結算 → 再戰交換宣戰權
// 用法：先 npx wrangler dev，再 node test/e2e/laststand-ui.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const shot = (P, n) => P.screenshot({ path: `${SHOTS}/ls-${n}.png` });
const text = (P, sel) => P.textContent(sel).then(t => (t ?? "").trim());
const LS = P => P.evaluate(() => globalThis.__hbLS?.() ?? null);
async function phone(kind, label, url = BASE, extra = {}) {
  const ctx = await browser.newContext({ ...(kind === "desktop" ? { viewport: { width: 1280, height: 800 } } : devices["iPhone 13"]), ...extra });
  await ctx.addInitScript(() => { try { localStorage.setItem("hb-story-offered", "1"); } catch { /* */ } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/WebSocket|Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  await p.goto(url);
  return { ctx, p };
}

console.log("開桌、換成逆命賭局");
const H = await phone("mobile", "房主");
await H.p.click("#goOnline"); await H.p.fill("#name", "大雞"); await H.p.click("#create");
await H.p.waitForSelector("#wait:not([hidden])");
const code = (await text(H.p, "#bigCode")).replace(/\s/g, "");
const G = await phone("desktop", "朋友", `${BASE}/?room=${code}`);
await G.p.waitForSelector("#online:not([hidden])");
await G.p.fill("#name", "阿禾"); await G.p.click("#join");
await G.p.waitForSelector("#wait:not([hidden])");
await H.p.click('#modePick [data-mode="laststand"]');
await H.p.waitForSelector("#contract:not([hidden])", { timeout: 5000 });
await G.p.waitForSelector("#contract:not([hidden])", { timeout: 5000 });
ok((await text(H.p, ".ctitle")) === "賭局契約書", "房主選逆命賭局：雙方都出現「賭局契約書」");
ok(await H.p.isDisabled("#readyBtn") && (await text(H.p, "#waitText")).includes("契約書"), "還沒蓋章：「準備好了」按不了，提示先蓋章");

console.log("契約書：提示輪播、預覽、蓋章");
const phSeen = new Set([await text(H.p, "#stakePh")]);
for (let i = 0; i < 10; i++) { await sleep(500); phSeen.add(await text(H.p, "#stakePh")); }
ok(phSeen.size === 2 && [...phSeen].every(t => ["這場，你要賭上什麼？", "你要交出什麼？"].includes(t)), `輸入框空著：提示文字在兩句之間輪播（看到 ${[...phSeen].join("／")}）`);
await H.p.click("#stakeInput");
const phFocus = await text(H.p, "#stakePh");
await sleep(4500);
ok((await text(H.p, "#stakePh")) === phFocus, "點了輸入框：停止輪播");
ok((await text(H.p, "#stakePreview")) === "本人自願於本場賭局中賭上『我最後的尊嚴』。", "還沒填：預覽是「我最後的尊嚴」");
await H.p.keyboard.type("阿嬤的藍白拖");
ok((await text(H.p, "#stakePreview")) === "本人自願於本場賭局中賭上『阿嬤的藍白拖』。" && await H.p.isHidden("#stakePh"), "打字時即時預覽、提示文字收起來");
await H.p.click(".ctitle"); await sleep(4300);
ok((await H.p.inputValue("#stakeInput")) === "阿嬤的藍白拖" && await H.p.isHidden("#stakePh"), "有字的時候不輪播、也不會蓋掉玩家打的字");
await shot(H.p, "contract-typing");
await H.p.click("#stakeSeal");
await H.p.waitForFunction(() => document.getElementById("contractState").textContent.includes("已蓋章"), null, { timeout: 4000 });
await G.p.click("#stakeSeal");                         // 朋友什麼都不填直接蓋章
await G.p.waitForFunction(() => document.getElementById("plateMeStake").textContent.includes("我最後的尊嚴"), null, { timeout: 4000 });
await H.p.waitForFunction(() => document.getElementById("plateOppStake").textContent.includes("我最後的尊嚴"), null, { timeout: 4000 });
ok((await text(G.p, "#plateOppStake")) === "賭上『阿嬤的藍白拖』" && (await text(H.p, "#plateMeStake")) === "賭上『阿嬤的藍白拖』", "雙方名牌都看得到彼此賭上的東西；朋友空白蓋章 → 我最後的尊嚴");
await shot(H.p, "contract-signed");
// 減少動態效果：不輪播
const R = await phone("mobile", "減少動態", `${BASE}/?room=${code}`, { reducedMotion: "reduce" });
// 第三支手機進不了這桌（已坐滿）：改用 evaluate 直接測輪播函式的條件 → 開一桌自己的來看
await R.p.goto(BASE); await R.p.click("#goOnline"); await R.p.fill("#name", "小動"); await R.p.click("#create");
await R.p.waitForSelector("#wait:not([hidden])");
await R.p.click('#modePick [data-mode="laststand"]');
await R.p.waitForSelector("#contract:not([hidden])");
const r0 = await text(R.p, "#stakePh"); await sleep(4600);
ok((await text(R.p, "#stakePh")) === r0, "系統設定「減少動態效果」：提示文字不輪播");
await R.ctx.close();

console.log("開打");
await H.p.click("#readyBtn"); await sleep(300); await G.p.click("#readyBtn");
await Promise.all([H.p.waitForSelector("#lstable:not([hidden])", { timeout: 8000 }), G.p.waitForSelector("#lstable:not([hidden])", { timeout: 8000 })]);
await sleep(400);
const v0 = await LS(H.p);
ok(["比大", "比小"].includes(await text(H.p, "#lsDirBig")) && (await text(H.p, "#lsDirNote")).startsWith("下一墩："), `方向：本墩「${await text(H.p, "#lsDirBig")}」、${await text(H.p, "#lsDirNote")}`);
ok((await text(H.p, "#lsMyChips")) === "15" && (await text(H.p, "#lsOppChips")) === "15" && (await text(H.p, "#lsOppCounts")) === "剩 9 張：大 3・中 3・小 3", "雙方 15 枚、對手剩 9 張：大 3・中 3・小 3");
ok((await text(H.p, "#lsStage")).includes("底注 1") && (await text(H.p, "#lsRisk")).includes("每人最多押到 3"), `底注與單人上限：「${await text(H.p, "#lsStage")}」`);
ok((await H.p.locator("#lsHand .lscard").count()) === 9, "手上 9 張（只有自己的）");
await shot(H.p, "table-start");

// 照真人的方式點：翻轉／保命大多不用；鎖第一張可以點的；下注：房主常加注、第 7 墩以後梭哈，朋友大多接戰、偶爾棄牌
const seen = { raise: 0, reraiseUi: 0, allInLabel: 0, riskFacing: 0, fold: 0, call: 0, check: 0, lock: 0 };
let refreshed = false, rnd = 7;
const coin = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
async function step(P, who) {
  const v = await LS(P);
  if (!v || v.result) return "done";
  const has = async a => P.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
  try {
    if (await has("noflip")) { await P.click(`#lsActions [data-a="${coin() < 0.2 ? "flip" : "noflip"}"]`); return "acted"; }
    if (await has("nosafe")) { await P.click(`#lsActions [data-a="${coin() < 0.15 ? "safe" : "nosafe"}"]`); return "acted"; }
    if (v.phase === "lock" && v.myLock < 0) {
      await P.locator("#lsHand .lscard:not([disabled])").first().click();
      await P.click('#lsActions [data-a="lock"]'); seen.lock++;
      return "acted";
    }
    if (v.phase === "bet" && v.toAct === v.seat) {
      if (await has("call")) {
        seen.riskFacing += (await text(P, "#lsRisk")).includes("若接戰") && (await text(P, "#lsRisk")).includes("若棄牌") ? 1 : 0;
        if (who === "G" && await has("raise") && coin() < 0.25) { await P.click('#lsActions [data-a="raise"]'); seen.reraiseUi++; return "acted"; }
        if (coin() < 0.18) { await P.click('#lsActions [data-a="fold"]'); seen.fold++; } else { await P.click('#lsActions [data-a="call"]'); seen.call++; }
        return "acted";
      }
      if (await has("raise") && (who === "H" ? coin() < 0.6 : coin() < 0.2)) {
        if (v.allInStage && await has("max")) { await P.click('#lsActions [data-a="max"]'); await sleep(100); }
        const label = await text(P, '#lsActions [data-a="raise"]');
        if (label.startsWith("梭哈：每人押")) seen.allInLabel++;
        await P.click('#lsActions [data-a="raise"]'); seen.raise++;
        return "acted";
      }
      if (await has("check")) { await P.click('#lsActions [data-a="check"]'); seen.check++; return "acted"; }
    }
  } catch { return "wait"; }
  return "wait";
}
async function playMatch(label) {
  for (let i = 0; i < 600; i++) {
    const [a, b] = [await step(H.p, "H"), await step(G.p, "G")];
    if (a === "done" && b === "done") return true;
    // 第一場第 3 墩：朋友重新整理
    if (!refreshed) {
      const v = await LS(G.p);
      if (v && v.trick === 3 && v.phase === "lock") {
        // 重新整理的時候對方可能剛好鎖牌（兩人都鎖 → 自動扣底注），所以比「手上＋本墩已投入」
        const before = JSON.stringify({ s: [v.stacks[0] + v.commit[0], v.stacks[1] + v.commit[1]], h: v.hand, t: v.trick });
        await G.p.reload();
        await G.p.waitForSelector("#lstable:not([hidden])", { timeout: 10000 });
        await G.p.waitForFunction(() => !!globalThis.__hbLS?.(), null, { timeout: 8000 });
        const w = await LS(G.p);
        const after = JSON.stringify({ s: [w.stacks[0] + w.commit[0], w.stacks[1] + w.commit[1]], h: w.hand, t: w.trick });
        ok(after === before && (await text(G.p, "#lsMyChips")) === String(w.stacks[w.seat]), `第 3 墩朋友重新整理：直接回到逆命牌桌，籌碼、手牌都一樣（${before} → ${after}）`);
        refreshed = true;
      }
    }
    // 偷看檢查：每個人畫面上的手牌只有自己的
    if (i % 15 === 0) {
      const [vh, vg] = [await LS(H.p), await LS(G.p)];
      if (vh && vg && vh.hand.some(c => vg.hand.includes(c))) { ok(false, "兩邊手牌重疊"); return false; }
      if (vh && vg && vg.phase === "lock" && vh.myLock >= 0 && JSON.stringify(vg).includes(`"myLock":${vh.myLock}`)) { ok(false, "對手的鎖牌出現在朋友的畫面資料"); return false; }
    }
    if (a !== "acted" && b !== "acted") await sleep(150); else await sleep(120);
  }
  ok(false, `${label} 打不完`);
  return false;
}
await playMatch("第一場");
await H.p.waitForSelector("#matchEnd:not([hidden])", { timeout: 8000 }).catch(() => ok(false, "沒有出現結算面板"));
const res = (await LS(H.p)).result;
ok(true, `第一場打完：${res.reason === "elimination" ? `第 ${res.trick} 墩有人歸零` : "九墩打完"}；結算面板「${await text(H.p, "#meTitle")}」— ${await text(H.p, "#meText")}`);
ok((await text(H.p, "#meStats")).includes("賭上之物：你『阿嬤的藍白拖』") && (await text(G.p, "#meStats")).includes("你『我最後的尊嚴』"), "結算面板列出雙方賭上之物（僅供遊戲敘事）");
await shot(H.p, "match-end");
ok(seen.lock >= 2 && seen.raise > 0 && seen.call + seen.fold > 0 && seen.riskFacing > 0, `操作都點過：鎖牌 ${seen.lock}、加注 ${seen.raise}、反加 ${seen.reraiseUi}、接戰 ${seen.call}、棄牌 ${seen.fold}、過牌 ${seen.check}；面對加注時都有顯示「若接戰／若棄牌」`);
const hist = (await LS(H.p)).history;
ok(hist.every(t => t.outcome !== "fold" || t.cards === null), "棄牌墩在畫面資料裡只有分類，沒有牌面");

console.log("再戰：交換第 1 墩宣戰權");
const firstDecl = v0.declarer;
await H.p.click("#meRematch"); await sleep(300);
await G.p.waitForFunction(() => document.getElementById("meRematch").textContent.includes("想再來一場"), null, { timeout: 5000 });
await G.p.click("#meRematch");
await H.p.waitForFunction(() => { const v = globalThis.__hbLS?.(); return v && v.trick === 1 && !v.result; }, null, { timeout: 8000 });
const v1 = await LS(H.p);
ok(v1.declarer !== firstDecl && v1.stacks.join() === "15,15", `再來一場：第 1 墩宣戰權換人（${firstDecl} → ${v1.declarer}），籌碼重設 15：15`);
await shot(G.p, "rematch");
// 第二場打到出現梭哈畫面為止（看「每人押 X」的說明）
await playMatch("第二場");
ok(seen.allInLabel > 0 || (await LS(H.p)).history.every(t => t.trick < 7 || t.cap <= t.ante), `梭哈按鈕寫「梭哈：每人押 X」（出現 ${seen.allInLabel} 次）`);

await browser.close();
if (errors.length) { console.log(errors.join("\n")); fails++; }
ok(!errors.length, "全程沒有頁面錯誤");
console.log(fails ? `\n${fails} 項沒過` : "\n逆命賭局介面驗收全部通過");
process.exit(fails ? 1 : 0);
