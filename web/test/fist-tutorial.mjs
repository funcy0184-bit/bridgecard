// 拳刃交鋒 互動教學四關：不開瀏覽器，模擬玩家照提示操作，確認每關都能過、做錯會重來（node test/fist-tutorial.mjs）
import { Tutorial, LESSONS } from "../public/fist/src/tutorial.js";
import { PH } from "../public/fist/src/engine.js";
import { CONFIG } from "../public/fist/src/config.js";

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const STEP = 1 / 60;
let objective = null, done = null, now = 0;
const tut = new Tutorial({ onTransport: () => {}, onObjective: o => { objective = o; }, onDone: s => { done = s ?? false; } });
const view = () => tut.transport?.engine.viewFor(0);
const run = sec => { for (let t = 0; t < sec; t += STEP) tut.update(STEP); };
const until = (cond, max = 15) => { for (let t = 0; t < max && !cond(); t += STEP) tut.update(STEP); return cond(); };
const tap = (btn, hold = 0.05) => { tut.transport.sendInput({ seat: 0, type: "down", btn }); run(hold); tut.transport.sendInput({ seat: 0, type: "up", btn }); run(STEP); };
const phase = () => tut.transport?.engine.phase;

ok(LESSONS.length === 4 && LESSONS.map(l => l.name).join("／") === "關卡 1：前搖讀心與過熱／關卡 2：連勝 3 次進四套拳／關卡 3：逐拳反擊／關卡 4：五連斬拼刀", "四關名稱照新規則");
tut.start();

console.log("關卡 1：前搖讀心與過熱");
until(() => view()?.fighters[1].stance === "rock");
tap("L");                                                         // 先故意出錯（石頭對石頭）
until(() => objective.retry);
ok(objective.retry && objective.lesson === 0 && objective.step === 0, `出錯：${objective.text}`);
until(() => phase() === PH.RPS && view().fighters[1].stance === "rock" && view().t > 0.4);
tap("R");                                                         // 布剋石頭
until(() => objective.step === 1 && phase() === PH.RPS);                // 過熱在開牌停頓結束後生效
ok(objective.step === 1 && view().fighters[0].heat === "paper", `第一輪贏 → 你的布過熱：${objective.text}`);
until(() => phase() === PH.RPS && view().t > 0.4);
tap("R");
ok(view().fighters[0].stance === null, "第二輪按 D（布）：被鎖住");
until(() => objective.step === 2);
ok(objective.step === 2 && view().fighters[1].stance === "scissors", `對手改亮剪刀：${objective.text}`);
tap("L");
until(() => objective.lesson === 1);
ok(objective.lesson === 1, "石頭剋剪刀 → 過關，進關卡 2");

console.log("關卡 2：連勝 3 次進四套拳");
until(() => phase() === PH.RPS && view()?.fighters[1].stance === "rock");
ok(view().fighters[0].streak === 2, "開場你已連勝 2/3");
tap("M");                                                         // 先故意輸（剪刀被石頭剋）
until(() => objective.retry);
ok(objective.retry && objective.step === 0, `沒贏要重來：${objective.text}`);
until(() => phase() === PH.RPS && view().fighters[1].stance === "rock" && view().fighters[0].streak === 2);
tap("R");                                                         // 布剋石頭 → 第 3 勝
until(() => phase() === PH.COMBO_PREP);
ok(objective.step === 1 && view().fighters[0].streak === 3, `連勝 3/3 → 連勝爆發 → 四套拳：${objective.text}`);
tap("L");                                                         // 第 1 拳出石頭
ok(objective.step === 2 && view().round.gesture === "rock", "選拳：第 1 拳出石頭");
until(() => objective.lesson === 2, 10);
ok(objective.lesson === 2, "四拳打完 → 進關卡 3");

console.log("關卡 3：逐拳反擊");
until(() => phase() === PH.COMBO_CUE);
ok(view().round.att === 1 && view().round.gesture === "scissors" && tut.transport.engine.dur === CONFIG.combo.reactDur, `攻方頭頂亮剪刀，反擊窗 ${CONFIG.combo.reactDur}s`);
tap("R");                                                         // 先按錯（布被剪刀剋）
ok(objective.retry, `按錯：${objective.text}`);
until(() => phase() === PH.COMBO_CUE);
run(0.5); tap("L");                                               // 0.5s 才按也來得及：石頭剋剪刀
until(() => objective.lesson === 3, 6);
ok(objective.lesson === 3, "下一拳按對 → 反擊成功 → 進關卡 4");

console.log("關卡 4：五連斬拼刀");
until(() => phase() === PH.RPS && view().fighters[1].stance === "rock");
tap("R");                                                         // 先故意贏（不平手）
until(() => objective.retry);
ok(objective.retry && objective.step === 0, `沒平手要重來：${objective.text}`);
until(() => phase() === PH.RPS && view().fighters[1].stance === "rock");
ok(view().gauge === 1, "關卡 4 開場蓄力 ⚔️ 1/2");
tap("L");
until(() => phase() === PH.CLASH_INPUT);
ok(objective.step === 1 && view().gauge === 2, `平手 → 拼刀：${objective.text}`);
for (let i = 0; i < 5; i++) tap("L", 0.03);                        // 石頭×5 對上剪刀×5
ok(tut.transport.engine.cm.first === 0 && objective.step === 2, "搶先填完：⚡ 先手");
until(() => done !== null, 12);
ok(done === false, "看完五刀對砍 → 四關全部完成");

console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
