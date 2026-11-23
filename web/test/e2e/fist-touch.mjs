// 拳刃交鋒：手機觸控按鍵驗收（模擬 iPhone 13 直拿／橫拿、桌機滑鼠）
//   node test/e2e/fist-touch.mjs http://127.0.0.1:8790/ [截圖資料夾]
//   檢查：觸控模式自動開、按鍵區在畫布下方不重疊、按鍵夠大、點擊走位／出拳、長按 0.3s 開紅招、連打大卡連點、
//         兩人同時按（多指）、比賽結束點畫面重開、教學文字改成觸控說法、桌機滑鼠點卡片不會誤觸
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8790/", OUT = process.argv[3] ?? "";
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// 對某張卡送觸控事件（Playwright 的 touchscreen 只有 tap，按住／多指用 PointerEvent 模擬）
const ptr = (P, sel, type, id = 1, kind = "touch") => P.evaluate(([sel, type, id, kind]) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: kind, isPrimary: id === 1, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
}, [sel, type, id, kind]);
const card = (seat, btn) => `.kgroup[data-seat="${seat}"] .kcard[data-btn="${btn}"]`;
const mash = seat => `.kgroup[data-seat="${seat}"] .kmash`;
const tapCard = async (P, sel, id = 1, hold = 40) => { await ptr(P, sel, "pointerdown", id); await sleep(hold); await ptr(P, sel, "pointerup", id); };
const layout = P => P.evaluate(() => {
  const kb = document.getElementById("keybar").getBoundingClientRect(), cv = document.getElementById("screen").getBoundingClientRect();
  const cards = [...document.querySelectorAll(".kcard")].filter(c => !c.hidden).map(c => c.getBoundingClientRect());
  return { kbTop: kb.top, kbBottom: kb.bottom, cvBottom: cv.bottom, cvTop: cv.top, cvW: cv.width, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, minW: Math.min(...cards.map(c => c.width)), minH: Math.min(...cards.map(c => c.height)), maxRight: Math.max(...cards.map(c => c.right)), touch: __fist.touch };
});
const waitPh = (P, ph, ms = 8000) => P.waitForFunction(p => __fist.view?.phase === p, ph, { timeout: ms, polling: 10 });

for (const [name, dev] of [["iPhone 13 直拿", devices["iPhone 13"]], ["iPhone 13 橫拿", devices["iPhone 13 landscape"]]]) {
  console.log(name);
  const ctx = await browser.newContext({ ...dev });
  const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(String(e)));
  await P.goto(BASE);
  await P.tap('[data-go="difficulty"]'); await P.tap('[data-go="ai:easy"]');
  await P.waitForFunction(() => __fist.view, null, { timeout: 5000 });
  await sleep(200);
  const L = await layout(P);
  ok(L.touch, "手機一開就是觸控模式");
  ok(L.kbTop >= L.cvBottom - 1 && L.kbBottom <= L.vh + 1, `按鍵區在畫布下方、不蓋畫面（畫布底 ${Math.round(L.cvBottom)}、按鍵區 ${Math.round(L.kbTop)}～${Math.round(L.kbBottom)}）`);
  ok(L.sw <= L.vw && L.sh <= L.vh, "沒有橫向／直向捲動");
  const barBottom = await P.evaluate(() => document.querySelector("#game .bar").getBoundingClientRect().bottom);
  ok(L.cvTop >= barBottom - 1, `上排按鈕不蓋畫面 HUD（按鈕底 ${Math.round(barBottom)}、畫布頂 ${Math.round(L.cvTop)}）`);
  ok(!(await P.textContent(".kcap")).includes("A/S/D"), `按鍵區標題不寫鍵盤鍵位：「${await P.textContent(".kcap")}」`);
  ok(L.minW >= 44 && L.minH >= 40 && L.maxRight <= L.vw, `按鍵夠大（最小 ${Math.round(L.minW)}×${Math.round(L.minH)}px）、都在畫面內`);
  if (OUT) await P.screenshot({ path: `${OUT}/touch-${dev.viewport.width}x${dev.viewport.height}.png` });

  // 猜拳：點過熱的 🖐️ 會被鎖住、點 ✊ 擺出石頭
  await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 1, heat: "paper" }, { pos: 6, power: 1 }], phase: "PHASE_RPS" }));
  await sleep(80); await tapCard(P, card(0, "R"));
  ok(await P.evaluate(() => __fist.view.fighters[0].stance === null), "點過熱的「♨️ 過熱」卡：鎖住出不了");
  await tapCard(P, card(0, "L"));
  await sleep(60);
  ok(await P.evaluate(() => __fist.view.fighters[0].stance === "rock"), "點「✊ 石頭」：擺出石頭架式");
  // 連打：連點大卡 12 下 → 追加上限 4
  await P.evaluate(() => { const t = __fist.transport; t.bots[0].attach({ view: () => t.engine.viewFor(1), input: () => {} }); t.engine.reset({ p: [{ pos: 3, power: 2 }, { pos: 4, power: 2 }], phase: "PHASE_MASH", round: { att: 0, winGesture: "rock" } }); });
  await sleep(40);
  ok(await P.isVisible(mash(0)), "連打：三張卡合成「🔥 狂敲連打！」大卡");
  for (let i = 0; i < 12; i++) await tapCard(P, mash(0), 1, 12);
  await waitPh(P, "PHASE_FINISHER_SELECT", 3000);
  ok(await P.evaluate(() => __fist.view.round.extra === 4), "連點大卡：追加打滿 4 拳");
  // 終結擇：按住 ✊ 0.3 秒以上 → 紅光
  await ptr(P, card(0, "L"), "pointerdown", 2); await sleep(380);
  const red = await P.evaluate(() => __fist.transport.engine.round.red);
  await ptr(P, card(0, "L"), "pointerup", 2);
  ok(red, "按住贏拳卡 0.38 秒：開出紅光強化");
  // 比賽結束：點畫面重開
  await P.evaluate(() => { const e = __fist.transport.engine; e.winner = 0; e.go("PHASE_GAMEOVER", null, true); });
  await sleep(80);
  await P.tap("#screen");
  await P.waitForFunction(() => __fist.view && __fist.view.phase !== "PHASE_GAMEOVER" && __fist.view.fighters.every(f => f.stocks === 3), null, { timeout: 3000 }).catch(() => {});
  ok(await P.evaluate(() => !!__fist.view && __fist.view.phase !== "PHASE_GAMEOVER" && __fist.view.fighters.every(f => f.stocks === 3 && f.damage === 0)), "比賽結束：點畫面再來一場（3 命、0%）");

  // 同機雙人：兩根手指同時按（P1 ✊、P2 ✌️）
  await P.tap('#game [data-go="menu"]');
  await P.tap('[data-go="local2p"]');
  await waitPh(P, "PHASE_RPS"); await sleep(80);
  const L2 = await layout(P);
  ok(L2.minW >= 44 && L2.maxRight <= L2.vw, `雙人六顆鍵都放得下（最小 ${Math.round(L2.minW)}px 寬）`);
  if (OUT) await P.screenshot({ path: `${OUT}/touch2p-${dev.viewport.width}x${dev.viewport.height}.png` });
  await ptr(P, card(0, "L"), "pointerdown", 11); await ptr(P, card(1, "M"), "pointerdown", 12);
  await sleep(50);
  await ptr(P, card(0, "L"), "pointerup", 11); await ptr(P, card(1, "M"), "pointerup", 12);
  await waitPh(P, "PHASE_MASH", 5000);                               // 猜拳 2.8s＋開牌停頓 0.55s
  ok(await P.evaluate(() => __fist.view.round.att === 0), "兩根手指同時按：P1 石頭、P2 剪刀都算數，P1 贏拳");
  await ctx.close();
}

console.log("震動（模擬 Android，記錄 navigator.vibrate 的震法）");
{
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  await ctx.addInitScript(() => { window.__vib = []; navigator.vibrate = p => { window.__vib.push(p); return true; }; });
  const P = await ctx.newPage(); P.on("pageerror", e => errors.push(String(e)));
  await P.goto(BASE); await P.tap('[data-go="difficulty"]'); await P.tap('[data-go="ai:easy"]');
  await P.waitForFunction(() => __fist.view, null, { timeout: 5000 });
  const H = await P.evaluate(() => __fist.CONFIG.haptics);
  const vib = () => P.evaluate(() => window.__vib.splice(0).filter(p => p !== 6));      // 6ms 是按鍵小回饋，先濾掉
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // 我打人：連打
  await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 2 }, { pos: 4, power: 2 }], phase: "PHASE_MASH", round: { att: 0, winGesture: "rock" } }));
  await vib();
  for (let i = 0; i < 6; i++) await tapCard(P, mash(0), 1, 15);
  await waitPh(P, "PHASE_FINISHER_SELECT", 3000);
  const deal = await vib();
  ok(deal.some(p => same(p, H.dealBase)) && deal.some(p => same(p, H.dealExtra)), `打到對手：保底拳 ${H.dealBase}ms、追加拳 ${H.dealExtra}ms（實際 ${JSON.stringify(deal)}）`);
  // 我被打：藍光終結沒接住
  await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 2 }, { pos: 4, power: 2 }], phase: "PHASE_FINISHER_WINDOW", round: { att: 1, gesture: "rock" } }));
  await vib(); await sleep(1100);                                    // 判定窗 0.8s 逾時才吃招
  const take = await vib();
  ok(take.some(p => same(p, H.takeFinisher)), `被終結技打到：重震 ${JSON.stringify(H.takeFinisher)}（實際 ${JSON.stringify(take)}）`);
  // 完美彈反
  await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 2 }, { pos: 4, power: 2 }], phase: "PHASE_FINISHER_WINDOW", round: { att: 1, gesture: "rock" } }));
  await vib(); await tapCard(P, card(0, "R")); await sleep(120);
  const parry = await vib();
  ok(parry.length === 1 && same(parry[0], H.parryMe), `完美彈反：噠噠 ${JSON.stringify(H.parryMe)}（實際 ${JSON.stringify(parry)}）`);
  // 關掉震動
  await P.tap("#gearBtn"); await P.tap('#settingsPop [data-go="haptics"]'); await P.tap("#gearBtn");
  await P.evaluate(() => __fist.transport.engine.reset({ p: [{ pos: 3, power: 2 }, { pos: 4, power: 2 }], phase: "PHASE_FINISHER_WINDOW", round: { att: 1, gesture: "rock" } }));
  await vib(); await sleep(1100);                                    // 判定窗 0.8s 逾時才吃招
  ok((await vib()).length === 0 && !(await P.evaluate(() => __fist.Haptics.on)), "⚙️ 震動：關 → 被打也不震");
  await P.evaluate(() => __fist.Haptics.set(true));
  await ctx.close();
}

console.log("互動教學（觸控說法）");
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const P = await ctx.newPage(); P.on("pageerror", e => errors.push(String(e)));
  await P.goto(BASE); await P.tap('[data-go="tutorial"]'); await sleep(200);
  const t = await P.textContent("#objective");
  ok(t.includes("點『🖐️ 布』") && !/按 [ASD]/.test(t), `目標改成觸控說法：${t}`);
  await P.waitForFunction(() => __fist.view?.fighters[1].stance === "rock", null, { timeout: 4000 });
  await tapCard(P, card(0, "R"));
  await P.waitForFunction(() => document.getElementById("objective").textContent.includes("過熱"), null, { timeout: 5000 }).catch(() => {});
  ok((await P.textContent("#objective")).includes("過熱"), `點卡片出布就能過教學第一步：${await P.textContent("#objective")}`);
  await ctx.close();
}

console.log("桌機（滑鼠＋鍵盤）");
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const P = await ctx.newPage(); P.on("pageerror", e => errors.push(String(e)));
  await P.goto(BASE); await P.click('[data-go="local2p"]');
  await waitPh(P, "PHASE_RPS"); await sleep(100);
  const L = await layout(P);
  ok(!L.touch && Math.abs(L.kbBottom - L.cvBottom) < 2, "桌機不是觸控模式：鍵位卡照舊疊在畫布底部");
  await ptr(P, card(0, "R"), "pointerdown", 1, "mouse"); await ptr(P, card(0, "R"), "pointerup", 1, "mouse"); await sleep(300);   // 桌機卡片本來就不接滑鼠（pointer-events: none），直接送事件確認也不會誤觸
  ok(await P.evaluate(() => __fist.view.fighters[0].stance === null), "桌機滑鼠點卡片不會誤觸出招");
  await P.keyboard.press("d"); await sleep(100);
  ok(await P.evaluate(() => __fist.view.fighters[0].stance === "paper"), "鍵盤照常可用");
  await ctx.close();
}

ok(errors.length === 0, `沒有頁面錯誤${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
