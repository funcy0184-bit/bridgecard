// 拳刃交鋒 🛠️ 訓練場（木樁沙盒）驗收：入口、木樁出招控制、一鍵狀態／跳轉、即時調秒數、無限命、離開還原
//   用法：node test/e2e/fist-training.mjs [網址]（預設 http://127.0.0.1:8790/）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:8790/";
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 720 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
const P = await ctx.newPage();
const errors = []; P.on("pageerror", e => { errors.push(String(e)); if (errors.length === 1) console.log("    [頁面錯誤]", e.stack.split("\n").slice(0, 3).join(" | ")); });
const ev = fn => P.evaluate(fn);
const waitPh = (ph, ms = 8000) => P.waitForFunction(p => __fist.view?.phase === p, ph, { timeout: ms, polling: 10 });
const tw = (fn, ms = 8000) => P.waitForFunction(fn, null, { timeout: ms, polling: 10 }).catch(() => {});
const key = async (k, hold = 30) => { await P.keyboard.down(k); await sleep(hold); await P.keyboard.up(k); };
const sel = (k, v) => P.selectOption(`#trainPanel [data-k="${k}"]`, v);
const btn = v => P.click(`#trainPanel button[data-v="${v}"]`);
const slide = (k, v) => P.evaluate(([k, v]) => { const el = document.querySelector(`#trainPanel [data-k="${k}"]`); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, [k, v]);
// 打一輪猜拳（我出 k），等到結果階段
const playRps = async k => { await tw(() => __fist.view?.phase === "PHASE_RPS" && __fist.view.t > 0.35); await key(k); await tw(() => !["PHASE_RPS", "PHASE_REVEAL"].includes(__fist.view?.phase)); return ev(() => __fist.view.phase); };

await P.goto(BASE);
console.log("入口");
ok((await P.textContent("#menu")).includes("🛠️ 訓練場（木樁測試）"), "主選單有「🛠️ 訓練場（木樁測試）」");
const base = await ev(() => ({ react: __fist.CONFIG.combo.reactDur, rps: __fist.CONFIG.rps.dur, reveal: __fist.CONFIG.rps.reveal, input: __fist.CONFIG.clashMode.inputDur }));
await P.click('[data-go="training"]');
await waitPh("PHASE_RPS");
ok(await P.isVisible("#trainPanel") && await P.isVisible("#trainBtn") && (await P.textContent("#modeTag")).includes("訓練場"), "進場：模式標籤、桌機預設展開木樁設定面板");
await P.click("#trainBtn"); ok(await P.isHidden("#trainPanel"), "「🛠️ 面板」可收合"); await P.click("#trainBtn");

console.log("木樁猜拳出招");
await sel("rps", "scissors");
await playRps("a");
ok(await ev(() => __fist.transport.engine.lastRps.stances[1] === "scissors"), "固定出剪刀：木樁出剪刀");
await btn("reset"); await sel("rps", "letwin");                       // 重置：上一輪我贏了剪刀，連勝已經是 1
let phases = [];
for (const k of ["s", "d", "a"]) phases.push(await playRps(k));      // 換招避開過熱；讓我贏 → 連勝 1、2 重擊，第 3 勝爆發
ok(phases.join() === "PHASE_STRIKE,PHASE_STRIKE,PHASE_BURST" && await ev(() => __fist.view.fighters[0].streak === 3), `固定讓我贏：3 連勝進四套拳（${phases.map(p => p.replace("PHASE_", "")).join("→")}）`);
await btn("reset"); await sel("rps", "win");
ok(await playRps("d") === "PHASE_STRIKE" && await ev(() => __fist.transport.engine.round.att === 1 && __fist.view.fighters[1].streak === 1), "固定贏我：木樁贏、木樁連勝 1/3");
await btn("reset"); await sel("rps", "tie");
ok(await playRps("a") === "PHASE_CLASH", "固定平手：第 1 次小拼刀「叮！」");
await tw(() => __fist.view?.phase === "PHASE_RPS");
ok(await playRps("s") === "PHASE_CLASH_INPUT", "再平手：蓄力 2/2 進五連斬");
await btn("reset"); await sel("rps", "rock");

console.log("木樁打我四套拳：逐拳指定");
for (const [i, g] of ["rock", "scissors", "paper", "rock"].entries()) await P.selectOption(`#trainPanel [data-k="combo"][data-i="${i}"]`, g);
await btn("dummyCombo");
const seen = [];
for (let n = 1; n <= 4; n++) {
  await P.waitForFunction(n => __fist.view?.phase === "PHASE_COMBO_CUE" && __fist.view.round.n === n, n, { timeout: 6000, polling: 10 }).catch(() => {});
  seen.push(await ev(() => __fist.view.round.gesture));
}
ok(seen.join() === "rock,scissors,paper,rock", `四拳照設定出：${seen.join("、")}`);

console.log("我打四套拳：木樁反擊時機");
await btn("reset");
await sel("defend", "2"); await btn("myCombo");
await tw(() => __fist.view?.phase === "PHASE_RESOLVE", 8000);
ok(await ev(() => __fist.transport.engine.round.result === "counter" && __fist.transport.engine.round.n === 2), "指定在第 2 拳反擊：第 2 拳被反擊");
await btn("reset"); await sel("defend", "none"); await btn("myCombo");
await tw(() => __fist.view?.phase === "PHASE_RESOLVE", 8000);
ok(await ev(() => __fist.transport.engine.round.result === "hit" && __fist.transport.engine.round.hits === 4), "完全不反擊：吃滿 4 拳、第 4 拳擊飛");

console.log("拼刀預設＋木樁搶先手");
await btn("reset"); await sel("clash", "paper"); await P.check('#trainPanel [data-k="clashFirst"]');
await btn("clash");
await tw(() => __fist.view?.clash?.first === 1, 3000);
ok(await ev(() => __fist.view.clash.first === 1), "木樁搶先手：一開場就填滿");
for (const k of ["a", "a", "a", "a", "a"]) await key(k, 20);
await waitPh("PHASE_CLASH_ANIM");
ok(await ev(() => __fist.view.clash.seq[1].every(g => g === "paper")), "拼刀 5 招全布");
await P.uncheck('#trainPanel [data-k="clashFirst"]');

console.log("一鍵狀態、無限命");
await btn("reset");
await P.click('#trainPanel button[data-v="1:135"]'); await P.click('#trainPanel button[data-v="0:50"]'); await sleep(80);   // 畫面下一幀才更新
ok(await ev(() => __fist.view.fighters[1].damage === 135 && __fist.view.fighters[0].damage === 50), "損傷按鈕：我 50%、木樁 135%");
await sel("pos1", "7"); await sel("pos0", "6"); await sleep(80);
ok(await ev(() => __fist.view.fighters[1].pos === 7 && __fist.view.fighters[0].pos === 6), "站位：我第 6 格、木樁第 7 格（崖邊）");
await sel("defend", "none"); await btn("myCombo");
await tw(() => __fist.view?.phase === "PHASE_RPS" && __fist.transport.engine.f[1].damage === 0, 12000);
const ko = await ev(() => ({ ph: __fist.view.phase, stocks: __fist.transport.engine.f[1].stocks, dmg: __fist.transport.engine.f[1].damage }));
ok(ko.ph === "PHASE_RPS" && ko.stocks >= 99 && ko.dmg === 0, `無限命：木樁被打出場 KO 後閃回場中（命 ${ko.stocks}、損傷歸零），繼續練`);
await P.check('#trainPanel [data-k="noHeat"]'); await P.check('#trainPanel [data-k="debugBox"]');
ok(await ev(() => !__fist.CONFIG.overheat.enabled && __fist.CONFIG.DEBUG_SPRITE_BOX), "開關：關閉過熱、顯示對齊框");
await sel("rps", "letwin");
await playRps("d"); await tw(() => __fist.view?.phase === "PHASE_RPS");
await playRps("d");
ok(await ev(() => __fist.view.fighters[0].heat === null && __fist.transport.engine.lastRps.stances[0] === "paper"), "關閉過熱：連出兩次布也可以");

console.log("即時調秒數＋複製參數");
await slide("reactDur", 0.5); await slide("rpsDur", 2); await slide("inputDur", 2.5);
await btn("reset"); await sleep(80);
ok(await ev(() => Math.abs(__fist.view.dur - 2) < 1e-6), "猜拳秒數拉到 2.0：下一輪猜拳就是 2.0 秒");
await btn("myCombo"); await tw(() => __fist.view?.phase === "PHASE_COMBO_CUE");
ok(await ev(() => Math.abs(__fist.view.dur - 0.5) < 1e-6), "每拳反擊秒數拉到 0.5：反擊窗 0.5 秒");
await btn("clash"); await sleep(80);
ok(await ev(() => Math.abs(__fist.view.dur - 2.5) < 1e-6), "拼刀輸入秒數拉到 2.5：五連斬輸入 2.5 秒");
await P.click("#trainPanel [data-copy]"); await sleep(150);
const clip = await ev(() => navigator.clipboard.readText());
ok(clip.includes("rps: { dur: 2, reveal: 1.4 }") && clip.includes("combo.reactDur: 0.5") && clip.includes("clashMode.inputDur: 2.5"), "📋 複製目前參數：可直接貼回 config.js");
ok((await P.textContent("#trainPanel [data-msg]")).includes("已複製"), "面板顯示「已複製」");

console.log("⚡ v2.0 實驗開關");
ok(await ev(() => Object.values(__fist.CONFIG.V2_EXPERIMENTS).every(v => v === false)), "進訓練場時 v2 開關預設全關");
await P.click("#trainPanel [data-v2all]"); await sleep(50);
ok(await ev(() => Object.values(__fist.CONFIG.V2_EXPERIMENTS).every(v => v === true)) && (await P.textContent("#trainPanel [data-v2all]")).includes("全開中"), "⚡ 一鍵全開 v2.0：5 個開關全部打開");
await P.uncheck('#trainPanel [data-k="noHeat"]').catch(() => {}); await P.check('#trainPanel [data-k="noHeat"]');
await btn("reset"); await sel("rps", "letwin"); await sleep(80);
await tw(() => __fist.view?.phase === "PHASE_RPS");
ok(await ev(() => Math.abs(__fist.view.dur - __fist.CONFIG.V2.rpsDur) < 1e-6), "v2 猜拳限時 1.5 秒");
const t0 = await ev(() => __fist.view.rt);
await key("a"); await key("s");
await tw(() => __fist.view?.phase !== "PHASE_RPS", 3000);
const lock = await ev(() => ({ st: __fist.transport.engine.lastRps.stances[0], dt: __fist.view.rt - 0 }));
ok(lock.st === "rock", "按下即鎖定：先按石頭、再按剪刀無效");
ok(lock.dt - t0 < 1.0, `雙方鎖定就開牌，不等倒數（${(lock.dt - t0).toFixed(2)}s）`);
await tw(() => __fist.view?.phase === "PHASE_RPS", 4000); await sleep(300);
ok(await ev(() => __fist.transport.engine.f[1].damage === __fist.CONFIG.V2.strikeDamage), `單發重擊 +${await ev(() => __fist.CONFIG.V2.strikeDamage)}%`);
ok(await ev(() => Math.abs(Math.abs(__fist.view.fighters[1].x - __fist.view.fighters[0].x) - __fist.CONFIG.V2.engageGap) < 1.5), "滑行後下一輪自動貼近");
await slide("v2dmg", 15); await slide("v2kb", 120);
ok(await ev(() => __fist.CONFIG.V2.strikeDamage === 15 && __fist.CONFIG.V2.BASE_KNOCKBACK === 120), "v2 滑桿：單拳傷害 15%、BASE_KNOCKBACK 120");
await P.click("#trainPanel [data-copy]"); await sleep(150);
const clip2 = await ev(() => navigator.clipboard.readText());
ok(clip2.includes('"BASE_KNOCKBACK": 120') && clip2.includes('"fastRps": true'), "📋 複製參數含 v2 JSON");
await P.click("#trainPanel [data-v2all]"); await P.click("#trainPanel [data-v2all]"); await sleep(50);   // 先全關再全開：離開時要能還原

console.log("離開：不汙染其他模式");
await P.keyboard.press("Escape"); await sleep(150);
const after = await ev(() => ({ react: __fist.CONFIG.combo.reactDur, rps: __fist.CONFIG.rps.dur, reveal: __fist.CONFIG.rps.reveal, input: __fist.CONFIG.clashMode.inputDur, heat: __fist.CONFIG.overheat.enabled, box: __fist.CONFIG.DEBUG_SPRITE_BOX, v2: Object.values(__fist.CONFIG.V2_EXPERIMENTS).some(Boolean), kb: __fist.CONFIG.V2.BASE_KNOCKBACK }));
ok(!after.v2 && after.kb === 95, "離開訓練場：v2 開關全部關回、BASE_KNOCKBACK 還原 95");
ok(after.react === base.react && after.rps === base.rps && after.reveal === base.reveal && after.input === base.input && after.heat && !after.box, `Esc 回大廳：秒數、過熱、對齊框全部還原（反擊 ${after.react}s、猜拳 ${after.rps}s）`);
await P.click('[data-go="local2p"]'); await waitPh("PHASE_RPS");
ok(await ev(() => Math.abs(__fist.view.dur - 2.8) < 1e-6) && await P.isHidden("#trainPanel") && await P.isHidden("#trainBtn"), "同機雙人：照正式秒數、沒有訓練面板");

ok(errors.length === 0, `沒有頁面錯誤${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
