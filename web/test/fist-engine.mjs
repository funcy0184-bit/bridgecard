// 拳刃交鋒 engine.js 規則驗收（純邏輯，node 直接跑：node test/fist-engine.mjs）
//   v3：沒有走位；猜拳 2.8s → 開牌停頓 0.55s → 連打／終結擇／判定窗 0.8s；武器過熱；平手 → 拼刀三連斬（先手獎勵）
//   延續 v2 的核心檢查：藏招保密、放開再按、判定窗單次鎖死、紅招蓄力與翻滾、擊飛公式、KO、延遲寬容、越打越快、flow 不吞事件
import { Engine, PH } from "../public/fist/src/engine.js";
import { CONFIG } from "../public/fist/src/config.js";

const STEP = 1 / 120;
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
function make(setup, opts = {}) { const e = new Engine({ setup, rng: () => 0.1, ...opts }); e.log = []; return e; }
function run(e, sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) e.log.push(...e.step(STEP)); }
function until(e, cond, max = 12) { let t = 0; while (!cond() && t < max) { e.log.push(...e.step(STEP)); t += STEP; } return cond(); }
const tap = (e, p, btn, hold = 0.04) => { e.input(p, "down", btn); run(e, hold); e.input(p, "up", btn); run(e, STEP); };
const has = (e, type, f = () => true) => e.log.some(x => x.type === type && f(x));
const S = (a, b, extra = {}) => ({ p: [a, b], ...extra });
const near = (a, b) => Math.abs(a - b) < 1e-6;

console.log("開局：沒有走位，直接猜拳；力量 1 格");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  ok(e.phase === PH.RPS && near(e.dur, 2.8) && near(e.reveal, 2.2), `第一個階段就是猜拳：${e.dur}s（亮招 ${e.reveal}s＋藏招 ${+(e.dur - e.reveal).toFixed(2)}s）`);
  ok(e.f.every(f => f.power === 1), "開局力量 1 格");
  ok(PH.MOVE === undefined, "走位階段已移除");
}

console.log("猜拳 → 開牌停頓 → 連打；藏招保密");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "R");                              // 亮招：P1 石、P2 布
  ok(e.viewFor(0).fighters[1].stance === "paper", "亮招期：看得到對手擺的架式");
  until(e, () => e.t >= e.reveal + 0.05);
  tap(e, 1, "M");                                                            // 藏招期 P2 換剪刀
  ok(e.viewFor(0).fighters[1].stance === "hidden" && e.viewFor(1).fighters[1].stance === "scissors" && e.viewFor(-1).fighters[0].stance === "hidden", "藏招：對手看不到你換了什麼（同機共用畫面兩邊都遮）");
  ok(e.log.filter(x => x.type === "stance" && x.p === 1 && x.gesture === "scissors").every(x => x.private === 1), "藏招期的換招事件標成私密");
  until(e, () => e.phase === PH.REVEAL);
  ok(near(e.dur, CONFIG.reveal.dur) && has(e, "rps_result", x => x.winner === 0 && x.stances.join() === "rock,scissors"), `開牌停頓 ${e.dur}s：石頭壓制剪刀，P1 贏`);
  ok(e.viewFor(1).rps?.winner === 0 && e.viewFor(1).rps.stances[1] === "scissors", "開牌停頓時雙方畫面都看得到結果");
  run(e, CONFIG.reveal.dur - 0.05);
  ok(e.phase === PH.REVEAL, "停頓期間還沒進連打（給大腦消化）");
  until(e, () => e.phase === PH.MASH);
  ok(e.round.att === 0 && e.round.winGesture === "rock", "停頓完才進連打：P1 攻方");
}

console.log("武器過熱");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  run(e, 0.3); tap(e, 0, "R"); tap(e, 1, "L");                              // P1 布、P2 石 → P1 贏
  until(e, () => e.phase === PH.MASH);
  ok(e.f[0].heat === "paper" && e.f[1].heat === "rock" && has(e, "heat", x => x.heat.join() === "paper,rock"), "分出勝負：雙方剛出的那招過熱（P1 布、P2 石）");
  ok(e.viewFor(0).fighters[1].heat === "rock" && e.viewFor(1).fighters[0].heat === "paper", "過熱是公開資訊：雙方都看得到對方禁用哪招");
  const before = e.f[1].damage;
  for (let i = 0; i < 8; i++) tap(e, 0, "R", 0.01);                         // 一直按過熱的布鍵
  until(e, () => e.phase === PH.SELECT);
  ok(e.round.extra === 4 && e.f[1].damage > before, "連打：過熱的鍵照樣算數（追加打滿 4 拳）");
  until(e, () => e.phase === PH.WINDOW);
  ok(e.round.gesture === "paper", "終結手勢：贏拳的布");
  tap(e, 1, "M");                                                            // 守方剪刀彈反
  ok(e.round.result === "parry", "判定窗：照常彈反");
  until(e, () => e.phase === PH.RPS);
  ok(e.f[0].power === 2 && e.f[1].power === 2, "一輪攻防結算：雙方各回 1 氣");
  run(e, 0.2);
  e.log = [];
  tap(e, 0, "R");                                                            // 下一輪 P1 想再出布
  ok(e.f[0].stance === null && has(e, "deny", x => x.p === 0 && x.why === "heat"), "下一輪猜拳：按過熱的布 → 鎖住、播喀嚓");
  tap(e, 0, "M");
  ok(e.f[0].stance === "scissors", "改出剪刀可以");
  const picks = new Set();
  for (const r of [0.01, 0.4, 0.7, 0.99]) {
    const x = new Engine({ setup: S({ pos: 3, heat: "rock" }, { pos: 5, heat: "paper" }), rng: () => r });
    for (let i = 0; i < 400; i++) x.step(STEP);
    picks.add(x.lastRps.stances[0]);
    ok(x.lastRps.stances[0] !== "rock" && x.lastRps.stances[1] !== "paper" && x.lastRps.random.every(Boolean), `逾時沒出（亂數 ${r}）：P1 ${x.lastRps.stances[0]}、P2 ${x.lastRps.stances[1]}，都避開過熱`);
  }
  ok(picks.size === 2, `逾時隨機兩招都可能出現（${[...picks]}）`);
}

console.log("拼刀模式：平手 → 三連斬預輸入");
{
  const e = make(S({ pos: 3, heat: "paper" }, { pos: 5, heat: "scissors" }));
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "L");                              // 石頭對石頭
  until(e, () => e.phase === PH.CLASH_INPUT);
  ok(e.phase === PH.CLASH_INPUT && near(e.dur, CONFIG.clashMode.inputDur), `平手 ${CONFIG.CLASH_TRIGGER_TIES} 次 → 拼刀預輸入 ${e.dur}s`);
  tap(e, 0, "R", 0.02); tap(e, 0, "R", 0.02);                                // 布：拼刀期間過熱不限制
  ok(e.cm.seq[0].join() === "paper,paper", "拼刀輸入：過熱的布照樣能填");
  const v1 = e.viewFor(1);
  ok(v1.clash.count.join() === "2,0" && v1.clash.seq[0] === null && e.viewFor(0).clash.seq[0].length === 2, "對手只看得到你填了幾格，看不到內容");
  ok(e.log.filter(x => x.type === "clash_pick").every(x => x.private === 0) && e.log.filter(x => x.type === "clash_input").every(x => x.private === undefined && x.gesture === undefined), "公開事件只有格數；填了什麼只送給自己");
  tap(e, 0, "M", 0.02);
  ok(e.cm.first === 0 && has(e, "clash_first", x => x.p === 0), "P1 先填滿 3 格：⚡ 先手");
  tap(e, 1, "L", 0.02); tap(e, 1, "L", 0.02); tap(e, 1, "R", 0.02);
  ok(e.phase === PH.CLASH_ANIM && e.cm.first === 0, "雙方都填滿 → 立刻進入對砍（先手不會被搶走）");
  ok(e.viewFor(1).clash.seq[0].join() === "paper,paper,scissors", "對砍開始：序列全公開");
  until(e, () => e.phase !== PH.CLASH_ANIM);
  const cuts = e.log.filter(x => x.type === "clash_cut");
  ok(cuts.length === 3 && cuts.map(c => c.winner).join() === "0,0,0", `三刀依序結算：${cuts.map(c => `第${c.n}刀 ${c.winner < 0 ? "平" : "P" + (c.winner + 1)}`).join("、")}`);
  const A = CONFIG.clashMode.cutAt;
  ok(near(A[1] - A[0], 0.45) && near(A[2] - A[1], 0.45) && A[2] < CONFIG.clashMode.animDur, `每刀間隔 0.45s、演出 ${CONFIG.clashMode.animDur}s`);
  ok(has(e, "clash_end", x => x.winner === 0 && x.damage === CONFIG.clashMode.winDamage + CONFIG.clashMode.firstBonus), `P1 3:0 勝，又有先手：P2 吃 ${CONFIG.clashMode.winDamage}+${CONFIG.clashMode.firstBonus}%`);
  ok(e.f[0].heat === null && e.f[1].heat === null, "拼刀結算：過熱全部清除");
  until(e, () => e.phase === PH.RPS);
  ok(e.f[0].power === 2 && e.f[1].power === 2, "拼刀有勝負＝一輪攻防：雙方各回 1 氣");
}

console.log("拼刀：平分看先手、都沒先手各自彈開、超時補齊");
{
  const setupClash = () => { const x = make(S({ pos: 3 }, { pos: 5 })); run(x, 0.3); tap(x, 0, "M"); tap(x, 1, "M"); until(x, () => x.phase === PH.CLASH_INPUT); return x; };
  const e = setupClash();
  tap(e, 1, "L", 0.02); tap(e, 1, "M", 0.02); tap(e, 1, "R", 0.02);         // P2 先填：石 剪 布
  tap(e, 0, "M", 0.02); tap(e, 0, "L", 0.02); tap(e, 0, "R", 0.02);         // P1：剪 石 布 → 刀1 P2、刀2 P1、刀3 平
  until(e, () => e.phase !== PH.CLASH_ANIM);
  ok(e.cm.score.join() === "1,1" && e.cm.first === 1 && has(e, "clash_end", x => x.winner === 1 && x.damage === CONFIG.clashMode.winDamage + CONFIG.clashMode.firstBonus), "1:1 平分：持有 ⚡ 先手的 P2 直接勝");
  const d = setupClash();
  for (const b of ["L", "M", "R"]) { d.input(0, "down", b); d.input(1, "down", b); run(d, 0.02); d.input(0, "up", b); d.input(1, "up", b); run(d, STEP); }
  until(d, () => d.phase !== PH.CLASH_ANIM);
  ok(d.cm.first === -1 && !has(d, "clash_first") && has(d, "clash_end", x => x.winner === -1), "同時填完沒有先手；三刀全平 → 平局");
  ok(d.phase === PH.CLASH && until(d, () => d.phase === PH.RPS) && d.f.every(f => f.power === 1 && f.damage === 0), "平局各自彈開，直接下一輪猜拳（不回氣、沒損傷）");
  const t = setupClash();
  tap(t, 0, "L", 0.02);
  until(t, () => t.phase === PH.CLASH_ANIM, 4);
  ok(t.cm.seq.every(s => s.length === 3) && t.cm.seq[0][0] === "rock" && t.cm.first === -1, "3 秒到：P1 只填 1 格、P2 沒填，都被隨機補滿；沒人填滿＝沒有先手");
}

console.log("CLASH_TRIGGER_TIES 可調");
{
  const keep = CONFIG.CLASH_TRIGGER_TIES; CONFIG.CLASH_TRIGGER_TIES = 2;
  const e = make(S({ pos: 3 }, { pos: 5 }));
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "L");
  until(e, () => e.phase === PH.CLASH || e.phase === PH.CLASH_INPUT);
  ok(e.phase === PH.CLASH, "設成 2：第一次平手只彈開");
  until(e, () => e.phase === PH.RPS); run(e, 0.3); tap(e, 0, "M"); tap(e, 1, "M");
  until(e, () => e.phase === PH.CLASH_INPUT || e.phase === PH.MASH);
  ok(e.phase === PH.CLASH_INPUT, "連續第二次平手：進拼刀");
  CONFIG.CLASH_TRIGGER_TIES = keep;
}

console.log("放開再按（跨階段）／判定窗單次鎖死／判定窗 0.8s");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 4 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" } }));
  e.input(0, "down", "L"); until(e, () => e.phase === PH.SELECT); run(e, 0.35);
  ok(!e.round.red, "從連打一路按著進終結擇：不算長按（放開再按）");
  const w = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  ok(near(w.dur, 0.8), `終結判定窗 ${w.dur}s`);
  tap(w, 1, "L"); tap(w, 1, "R");
  ok(w.round.result === "hit" && has(w, "wrong"), "只認第一次按鍵：按錯就吃招，後面按對也沒用");
  const late = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  run(late, 0.7); tap(late, 1, "R");
  ok(late.round.result === "parry", "0.7s 才按也來得及（新手友善）");
}

console.log("終結擇：長按贏拳鍵 0.3s＝紅光（要 2 氣）；未滿放開＝藍光不扣氣");
{
  const mk = power => make(S({ pos: 3, power }, { pos: 4 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" } }));
  const e = mk(2); until(e, () => e.phase === PH.SELECT);
  e.input(0, "down", "L"); run(e, 0.32);
  ok(e.round.red && e.f[0].power === 0 && has(e, "red_ready"), "按住 0.3s：紅光強化，扣 2 氣");
  const e2 = mk(2); until(e2, () => e2.phase === PH.SELECT); tap(e2, 0, "L", 0.15);
  ok(!e2.round.red && e2.f[0].power === 2, "未滿 0.3s 放開：藍光，不扣氣");
  const e3 = mk(1); until(e3, () => e3.phase === PH.SELECT); e3.input(0, "down", "L"); run(e3, 0.35);
  ok(!e3.round.red, "只有 1 氣（開局值）：開不了紅光");
}

console.log("紅招：零氣閃避（翻滾穿過攻方）／按錯吃招擊飛 KO、重生清過熱");
{
  const setup = S({ pos: 6, power: 2 }, { pos: 7, power: 0, damage: 130, heat: "rock" }, { phase: PH.WINDOW, round: { att: 0, red: true } });
  const e = make(setup);
  ok(JSON.stringify(e.round.zone) === "[6,7]" && JSON.stringify(e.round.dirs) === "[-1]", `崖邊：紅區 ${JSON.stringify(e.round.zone)}，只亮 ◀`);
  tap(e, 1, "L");
  ok(e.round.result === "roll" && e.f[1].pos === 5, `按 ◀（就算是過熱的鍵）翻滾 2 格到格 ${e.f[1].pos}`);
  const e2 = make(setup);
  tap(e2, 1, "M");
  until(e2, () => has(e2, "ko"));
  ok(has(e2, "ko", x => x.p === 1) && e2.f[1].stocks === CONFIG.stocks - 1, "按錯：吃紅招擊飛出界 KO，扣 1 命");
  until(e2, () => e2.phase === PH.RPS);
  ok(e2.f[1].damage === 0 && e2.f[0].pos === CONFIG.spawn[0] && e2.f[1].pos === CONFIG.spawn[1] && e2.f[1].heat === null, "掉命：重置中央、損傷歸零、過熱清除");
}

console.log("擊飛公式");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2, damage: 40 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  run(e, 0.85);
  const ev = e.log.find(x => x.type === "finisher_hit"), R = CONFIG.resolve, d = 40 + CONFIG.finisherDamage;
  ok(near(ev.v, R.vBase * (1 + d / R.damageDiv)), `藍光：V = vBase × (1 + ${d}/${R.damageDiv}) = ${ev.v.toFixed(1)}`);
  const e2 = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2, damage: 40 }, { phase: PH.WINDOW, round: { att: 0, red: true } }));
  run(e2, 0.85);
  ok(near(e2.log.find(x => x.type === "finisher_hit").v, R.vBase * (1 + d / R.damageDiv) * R.redMult), `紅光：再 × ${R.redMult}`);
}

console.log("站位只靠推擠、換位、翻滾");
{
  const e = make(S({ pos: 3 }, { pos: 5 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" } }));
  until(e, () => e.phase === PH.SELECT);
  ok(e.f[1].pos === 7 && e.f[0].pos === 3, `贏拳連打保底兩拳把對手推 2 格（格 5 → ${e.f[1].pos}）`);
  const m = make(S({ pos: 3 }, { pos: 5 }));
  for (let i = 0; i < 200; i++) { m.input(0, "down", "L"); m.input(1, "down", "R"); m.step(STEP); m.input(0, "up", "L"); m.input(1, "up", "R"); m.step(STEP); }
  ok(m.f[0].pos === 3 && m.f[1].pos === 5, "猜拳時亂按方向鍵不會移動");
}

console.log("flow 中途 reset 不吞事件（教學用）");
{
  const setupB = S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 1, gesture: "scissors" } });
  const e = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "paper" } }), rng: () => 0.1, flow: from => (from === PH.MASH ? { reset: setupB } : undefined) });
  e.log = [];
  for (let i = 0; i < 10; i++) tap(e, 0, ["L", "M", "R"][i % 3], 0.01);
  until(e, () => e.phase === PH.WINDOW);
  ok(has(e, "mash_end", x => x.extra === 4), "連打結束時 flow 換段：mash_end（追加 4）仍有送出");
  ok(e.phase === PH.WINDOW && e.round.att === 1, "且已換到下一段的設定");
}

console.log("線上延遲寬容");
{
  const late = grace => { const x = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }), rng: () => 0.1, windowGrace: grace }); x.log = []; run(x, CONFIG.window.dur + 0.04); x.input(1, "down", "R"); run(x, STEP * 2); return x.round.result; };
  ok(late(0) === "hit", `本機（無寬容）：${(CONFIG.window.dur + 0.04).toFixed(2)}s 才按 → 已逾時吃招`);
  ok(late(CONFIG.net.windowGraceMs / 1000) === "parry", `線上（寬容 ${CONFIG.net.windowGraceMs}ms）：晚 40ms 抵達的正確按鍵仍算彈反`);
}

console.log("越打越快");
{
  const Sp = CONFIG.speed, e = make(S({ pos: 3 }, { pos: 5 }));
  const durs = [];
  for (let k = 0; k < 12; k++) {                                         // 打 12 回合拼刀平局（都按同一招、拼刀同時填）
    until(e, () => e.phase === PH.RPS); durs.push([e.speedLv, +e.dur.toFixed(3), +e.reveal.toFixed(3)]);
    run(e, 0.05); tap(e, 0, "M"); tap(e, 1, "M");
    until(e, () => e.phase === PH.CLASH_INPUT);
    for (const b of ["L", "L", "L"]) { e.input(0, "down", b); e.input(1, "down", b); run(e, 0.02); e.input(0, "up", b); e.input(1, "up", b); run(e, STEP); }
    until(e, () => e.phase === PH.RPS);
  }
  ok(durs[0][0] === 0 && durs[3][0] === 1 && durs[6][0] === 2 && durs[9][0] === 3, `每 3 回合升一級（等級 ${durs.map(d => d[0] + 1).join("")}）`);
  ok(near(durs[0][1], 2.8) && near(durs[0][2], 2.2), "Lv.1 猜拳 2.8s（亮招 2.2s）");
  ok(near(durs[9][2], Sp.fast.rpsReveal) && near(durs[9][1], Sp.fast.rpsReveal + Sp.fast.rpsHidden), `最快：亮招 ${Sp.fast.rpsReveal}s＋藏招 ${Sp.fast.rpsHidden}s`);
  const f = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" }, rounds: 12 }), rng: () => 0.1 }); f.log = [];
  until(f, () => f.phase === PH.SELECT); f.input(0, "down", "L"); run(f, 0.34);
  ok(f.round.red, "最快等級仍開得出紅光");
  until(f, () => f.phase === PH.WINDOW); ok(near(f.dur, Sp.fast.window), `最快判定窗 ${f.dur}s`);
  const t = new Engine({ setup: S({ pos: 3 }, { pos: 5 }, { rounds: 12 }), speedUp: false });
  ok(t.speedLv === 0 && near(t.dur, 2.8), "教學（speedUp: false）不加速");
}

console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
