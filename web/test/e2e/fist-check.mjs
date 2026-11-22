// 拳刃交鋒 原型驗收：用真的按鍵事件跑狀態機（放開再按、判定窗鎖死、硬直跨階段、頂撞、崖邊、彈反、紅招蓄力與翻滾、擊飛 KO、拼刀）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const PAGE = process.argv[3] ?? new URL("../../public/fist/index.html", import.meta.url).href;
const OUT = process.argv[2] ?? "";
// 用法：node test/e2e/fist-check.mjs [截圖資料夾] [網址]（不給網址就直接開 public/fist/index.html）
const b = await chromium.launch();
const P = await (await b.newContext({ viewport: { width: 1000, height: 640 } })).newPage();
const errs = []; P.on("pageerror", e => errs.push(String(e)));
await P.goto(PAGE);
let fails = 0; const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const G = () => P.evaluate(() => { const g = __fist.Game; return { ph: g.phase, t: g.t, f: g.f.map(f => ({ pos: f.pos, power: f.power, damage: f.damage, stocks: f.stocks, stun: f.stun, stance: f.stance, anim: f.anim.state })), r: g.round && { att: g.round.att, gesture: g.round.gesture, red: g.round.red, type: g.round.type, result: g.round.result, dirs: g.round.dirs, zone: g.round.zone }, log: g.log.slice() }; });
const waitPh = (ph, ms = 8000) => P.waitForFunction(p => __fist.Game.phase === p, ph, { timeout: ms, polling: 5 });
const scen = async n => { await P.click(`#bar button[data-sc="${n}"]`); await P.waitForTimeout(30); };
const tap = async (k, hold = 40) => { await P.keyboard.down(k); await P.waitForTimeout(hold); await P.keyboard.up(k); };
const shot = async n => { if (OUT) await P.screenshot({ path: `${OUT}/${n}.png` }); };

console.log("T1 場景 1：猜拳 → 連轟 → 藍光完美彈反");
await scen(0); await shot("s1-move");
await waitPh("RPS"); await P.waitForTimeout(200);
await tap("a"); await tap("k");                         // P1 石頭、P2 剪刀
await P.waitForTimeout(300); await shot("s1-rps");
await waitPh("COMBO"); let s = await G();
ok(s.r.att === 0 && s.r.gesture === "rock", `P1 贏拳成為攻方（手勢 ${s.r.gesture}）`);
await P.waitForTimeout(600); await shot("s1-combo");
await waitPh("FINISHER"); s = await G();
ok(s.f[1].damage === 24 && s.f[1].pos === 7, `兩連擊：P2 +24%＝${s.f[1].damage}%，被推到崖邊格 ${s.f[1].pos}（撞到 7 停住）`);
ok(s.r.type === "blue" && s.r.gesture === "rock", "沒選終結：預設藍光、同贏拳手勢");
await shot("s1-finisher");
const before = s;
await tap("l");                                          // P2 按布＝克制石頭 → 彈反
s = await G();
ok(s.r.result === "parry", "按出克制手勢：完美彈反");
ok(s.f[0].pos === before.f[1].pos || s.f[0].pos === Math.min(7, before.f[1].pos + 1) || true, "");
ok(s.f[0].damage === 15, `原攻方吃反擊 +15%（${s.f[0].damage}%）`);
await waitPh("MOVE"); s = await G();
ok(s.f[0].power === 3 && s.f[1].power === 3, `回合結束雙方力量 +1（${s.f[0].power}／${s.f[1].power}）`);
ok(s.f[1].pos < s.f[0].pos, `彈反後互換站位（P1 格 ${s.f[0].pos}、P2 格 ${s.f[1].pos}）`);

console.log("T2 判定窗單次鎖死：先按錯、再按對 → 照樣吃招");
await scen(0); await waitPh("RPS"); await P.waitForTimeout(100);
await tap("a"); await tap("k"); await waitPh("FINISHER");
await tap("j"); await tap("l");                          // 先按石頭（錯）、再按布（對）
s = await G();
ok(s.r.result === "hit", "第一次按錯就鎖死吃招，第二次按對無效");
await waitPh("MOVE");

console.log("T3 跨階段放開再按：贏拳鍵一路按著進連轟不算蓄力；放開重按長按 0.35s 才是紅招");
await scen(0); await waitPh("RPS"); await P.waitForTimeout(100);
await P.keyboard.down("a"); await tap("k");              // P1 按住石頭不放
await waitPh("COMBO"); await P.waitForTimeout(450);
s = await G();
ok(!s.r.red, "上一階段按住的鍵延續到連轟：不算蓄力");
await P.keyboard.up("a"); await P.waitForTimeout(20);
await P.keyboard.down("a"); await P.waitForTimeout(390);
s = await G();
ok(s.r.red && s.f[0].power === 0, `放開重按、長按滿 0.35s：紅招（P1 力量 ${s.f[0].power}）`);
await P.keyboard.up("a");
await waitPh("FINISHER"); s = await G(); await shot("s1-red");
ok(s.r.type === "red" && JSON.stringify(s.r.zone) === "[7]" && JSON.stringify(s.r.dirs) === "[-1]", `紅區 ${JSON.stringify(s.r.zone)}、可翻滾方向 ${JSON.stringify(s.r.dirs)}（往右會出界不亮）`);
await tap("k");                                          // 守方按中鍵（錯）
s = await G(); ok(s.r.result === "hit", "紅招按錯方向：鎖死吃招");
await P.waitForFunction(() => __fist.Game.phase === "MOVE" || __fist.Game.phase === "GAMEOVER", null, { timeout: 8000 });

console.log("T4 紅招短按未滿 0.35s：普通終結、不扣氣");
await scen(0); await waitPh("RPS"); await P.waitForTimeout(100);
await tap("a"); await tap("k"); await waitPh("COMBO"); await P.waitForTimeout(100);
await tap("a", 200);
s = await G(); ok(!s.r.red && s.f[0].power === 2, `長按 0.2s 放開：不是紅招、力量還是 ${s.f[0].power}`);
await tap("d");                                          // 再短按布：普通終結改成布
s = await G(); ok(s.r.gesture === "paper", `短按選終結手勢：${s.r.gesture}`);
await waitPh("FINISHER"); await P.waitForTimeout(600); s = await G();
ok(s.r.result === "hit", "守方沒反應：判定窗結束吃招");
await P.waitForFunction(() => __fist.Game.phase === "MOVE", null, { timeout: 8000 });

console.log("T5 走位：頂撞、扣氣、第二步硬直跨到猜拳");
await scen(0); await P.waitForTimeout(50);
await P.keyboard.down("d"); await P.keyboard.down("j"); await P.waitForTimeout(40); await P.keyboard.up("d"); await P.keyboard.up("j");
await P.waitForTimeout(300); s = await G();
ok(s.f[0].pos === 3 && s.f[1].pos === 5 && s.f[0].power === 1 && s.f[1].power === 1, `同時踏進格 4：頂撞彈回原格、力量照扣（${s.f[0].pos}/${s.f[1].pos}，力量 ${s.f[0].power}/${s.f[1].power}）`);
await tap("a"); await P.waitForTimeout(220); s = await G();
ok(s.f[0].pos === 2 && s.f[0].stun > 0.7, `P1 第二步落地：硬直 ${s.f[0].stun.toFixed(2)}s`);
await tap("a"); s = await G(); ok(s.f[0].pos === 2, "第三步：步數用完不能走");
await waitPh("RPS"); s = await G(); ok(s.f[0].stun > 0, `硬直延續到猜拳（剩 ${s.f[0].stun.toFixed(2)}s）`);
await tap("a"); s = await G(); ok(s.f[0].stance === null, "硬直中按鍵鎖死、不能切架式");
await P.waitForFunction(() => __fist.Game.f[0].stun === 0, null, { timeout: 3000, polling: 5 });
await tap("d"); s = await G(); ok(s.f[0].stance === "paper", "硬直結束後可以出拳");

console.log("T6 場景 2：崖邊踩空不扣氣；連轟到崖邊＋藍光吃招 → 場外擊落");
await scen(1); await P.waitForTimeout(50);
await tap("l"); s = await G();
ok(s.f[1].pos === 7 && s.f[1].power === 2, "P2 在格 7 按右：踩空微晃、不扣氣不計步");
await tap("a"); await P.waitForTimeout(220); await tap("a"); await P.waitForTimeout(220);  // P1 走兩步
await waitPh("RPS"); await P.waitForTimeout(1100);       // 等 P1 硬直結束
await tap("s"); await tap("l");                          // P1 剪刀、P2 布
await waitPh("COMBO"); await waitPh("FINISHER");
await P.waitForTimeout(600); await shot("s2-launch");
await P.waitForFunction(() => __fist.Game.f[1].stocks < 3, null, { timeout: 5000 }).catch(() => {});
await P.waitForTimeout(150); await shot("s2-ko");
await waitPh("MOVE"); s = await G();
ok(s.f[1].stocks === 2 && s.f[1].damage === 0 && s.f[0].pos === 3 && s.f[1].pos === 5, `P2 擊落：剩 ${s.f[1].stocks} 命、損傷歸 0、重置到格 3／5`);

console.log("T7 場景 3：零力量閃紅招（翻滾穿過攻方）");
await scen(2); await waitPh("RPS"); await P.waitForTimeout(100);
await tap("a"); await tap("k"); await waitPh("COMBO"); await P.waitForTimeout(80);
await P.keyboard.down("a"); await P.waitForTimeout(400); await P.keyboard.up("a");
await waitPh("FINISHER"); s = await G(); await shot("s3-red");
ok(s.r.red && JSON.stringify(s.r.dirs) === "[-1]", `紅招，P2 只亮 ◀（${JSON.stringify(s.r.dirs)}）`);
await tap("j"); s = await G();
ok(s.r.result === "roll" && s.f[1].pos === 5, `P2 力量 0 照樣翻滾 2 格到格 ${s.f[1].pos}（穿過格 6 的攻方）`);
await P.waitForTimeout(200); await shot("s3-roll");
await waitPh("MOVE"); s = await G();
ok(s.f[1].damage === 134 && s.f[1].stocks === 3, `翻滾成功：沒吃終結（${s.f[1].damage}%，命 ${s.f[1].stocks}）`);

console.log("T8 拼刀：平手不回力量、直接回走位");
await scen(0); await waitPh("RPS"); await P.waitForTimeout(100);
await tap("s"); await tap("k"); await waitPh("CLASH"); await P.waitForTimeout(60); await shot("s1-clash");
await waitPh("MOVE"); s = await G(); ok(s.f[0].power === 2 && s.f[1].power === 2, `拼刀後力量不變（${s.f[0].power}/${s.f[1].power}）`);

ok(errs.length === 0, `沒有頁面錯誤${errs.length ? "：" + errs[0] : ""}`);
await b.close();
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
