// 拳刃交鋒 engine.js 規則驗收（純邏輯，node 直接跑：node test/fist-engine.mjs）
//   v4：沒有走位；猜拳 2.8s → 開牌停頓 0.55s → 連勝 1、2 單發重擊／連勝 3 四套拳逐拳反擊；武器過熱；平手累積 2 次 → 拼刀五連斬
//   （v3 的連打／終結擇／紅光翻滾已依需求移除，那幾段改成檢查新規則；藏招保密、過熱、拼刀、延遲寬容、越打越快照舊）
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

console.log("開局：沒有走位，直接猜拳；連勝 0/3");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  ok(e.phase === PH.RPS && near(e.dur, 2.8) && near(e.reveal, 2.2), `第一個階段就是猜拳：${e.dur}s（亮招 ${e.reveal}s＋藏招 ${+(e.dur - e.reveal).toFixed(2)}s）`);
  ok(e.f.every(f => f.streak === 0) && e.viewFor(0).streakTarget === 3, "開局雙方連勝 0/3");
  ok(PH.MASH === undefined && PH.SELECT === undefined && PH.WINDOW === undefined, "狂敲連打／終結擇／紅光判定窗已移除");
  ok(PH.MOVE === undefined, "走位階段已移除");
}

console.log("猜拳 → 開牌停頓 → 連勝重擊；藏招保密");
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
  ok(e.phase === PH.REVEAL, "停頓期間還沒出手（給大腦消化）");
  until(e, () => e.phase === PH.STRIKE);
  ok(e.round.att === 0 && e.round.winGesture === "rock" && e.f[0].streak === 1, "停頓完：P1 連勝 1/3 → 單發重擊（不進連打）");
}

console.log("武器過熱");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  run(e, 0.3); tap(e, 0, "R"); tap(e, 1, "L");                              // P1 布、P2 石 → P1 贏
  until(e, () => e.phase === PH.STRIKE);
  ok(e.f[0].heat === "paper" && e.f[1].heat === "rock" && has(e, "heat", x => x.heat.join() === "paper,rock"), "分出勝負：雙方剛出的那招過熱（P1 布、P2 石）");
  ok(e.viewFor(0).fighters[1].heat === "rock" && e.viewFor(1).fighters[0].heat === "paper", "過熱是公開資訊：雙方都看得到對方禁用哪招");
  until(e, () => e.phase === PH.RPS);
  ok(e.f[1].damage === CONFIG.strike.damage && e.f[1].pos === 6 && has(e, "hit", x => x.kind === "strike") && has(e, "round_end"), `單發重擊：+${CONFIG.strike.damage}%、推 1 格（5 → ${e.f[1].pos}），直接回猜拳`);
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

console.log("拼刀蓄力：整場累積平手 2 次才觸發（不用連續）");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  ok(e.gauge === 0 && e.viewFor(0).gauge === 0 && e.viewFor(0).gaugeMax === 2, "開局蓄力 ⚔️ 0/2");
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "L");
  until(e, () => e.phase === PH.CLASH || e.phase === PH.CLASH_INPUT);
  ok(e.phase === PH.CLASH && e.gauge === 1 && has(e, "gauge", x => x.gauge === 1 && !x.full) && has(e, "clash", x => !x.wave), "第 1 次平手：小拼刀「叮！」彈開，蓄力 1/2");
  until(e, () => e.phase === PH.RPS);
  ok(e.f.every(f => f.damage === 0 && f.streak === 0) && !has(e, "round_end"), "小拼刀：沒傷害、不算一輪攻防");
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "M");                              // 中間分出一次勝負（重擊、沒人落台）：蓄力不歸零
  until(e, () => e.phase === PH.STRIKE);
  ok(e.gauge === 1 && e.f[0].heat === "rock", "中間有一輪分出勝負：蓄力保留 1/2（累積、不用連續）");
  until(e, () => e.phase === PH.RPS);
  ok(e.gauge === 1 && !has(e, "ko") && e.f[0].streak === 1, "那輪結束（重擊、沒人落台）蓄力仍是 1/2、P1 連勝 1/3");
  run(e, 0.3); tap(e, 0, "M"); tap(e, 1, "M");
  ok(e.f[0].heat === "rock" && e.f[1].heat === "scissors", "（P2 過熱剪刀時按剪刀會被擋；P1 剪刀合法）");
  tap(e, 1, "R"); tap(e, 0, "R");                                           // 布對布
  until(e, () => e.phase === PH.CLASH || e.phase === PH.CLASH_INPUT || e.phase === PH.STRIKE);
  ok(e.phase === PH.CLASH_INPUT && e.gauge === 2 && has(e, "gauge", x => x.gauge === 2 && x.full), "第 2 次平手：蓄力 2/2 集滿 → 五連斬");
  ok(e.f[0].streak === 1, "平手不重置連勝（P1 仍是 1/3）");
  const keep = CONFIG.CLASH_TRIGGER_TIES; CONFIG.CLASH_TRIGGER_TIES = 1;
  const q = make(S({ pos: 3 }, { pos: 5 })); run(q, 0.3); tap(q, 0, "L"); tap(q, 1, "L");
  until(q, () => q.phase === PH.CLASH || q.phase === PH.CLASH_INPUT);
  ok(q.phase === PH.CLASH_INPUT, "CLASH_TRIGGER_TIES 可調：設成 1 → 第一次平手就拼刀");
  CONFIG.CLASH_TRIGGER_TIES = keep;
}

console.log("拼刀模式：五連斬預輸入（蓄力 1/2 開局，再平手一次）");
{
  const e = make(S({ pos: 3, heat: "paper" }, { pos: 5, heat: "scissors" }, { gauge: 1 }));
  run(e, 0.3); tap(e, 0, "L"); tap(e, 1, "L");                              // 石頭對石頭
  until(e, () => e.phase === PH.CLASH_INPUT);
  ok(e.phase === PH.CLASH_INPUT && near(e.dur, 3.5) && CONFIG.CLASH_SEQUENCE_LENGTH === 5, `拼刀預輸入 ${e.dur}s、${CONFIG.CLASH_SEQUENCE_LENGTH} 格`);
  tap(e, 0, "R", 0.02); tap(e, 0, "R", 0.02);                                // 布：拼刀期間過熱不限制
  ok(e.cm.seq[0].join() === "paper,paper", "拼刀輸入：過熱的布照樣能填");
  const v1 = e.viewFor(1);
  ok(v1.clash.count.join() === "2,0" && v1.clash.seq[0] === null && e.viewFor(0).clash.seq[0].length === 2 && v1.clash.n === 5, "對手只看得到你填了幾格，看不到內容");
  ok(e.log.filter(x => x.type === "clash_pick").every(x => x.private === 0) && e.log.filter(x => x.type === "clash_input").every(x => x.private === undefined && x.gesture === undefined), "公開事件只有格數；填了什麼只送給自己");
  for (const b of ["M", "M", "M"]) tap(e, 0, b, 0.02);
  ok(e.cm.seq[0].length === 5 && e.cm.first === 0 && has(e, "clash_first", x => x.p === 0), "P1 先填滿 5 格：⚡ 先手");
  tap(e, 0, "L", 0.02);
  ok(e.cm.seq[0].length === 5, "填滿後再按不會多出第 6 格");
  for (const b of ["L", "L", "R", "R", "L"]) tap(e, 1, b, 0.02);           // P2：石 石 布 布 石
  ok(e.phase === PH.CLASH_ANIM && e.cm.first === 0, "雙方都填滿 → 立刻進入對砍（先手不會被搶走）");
  ok(e.viewFor(1).clash.seq[0].join() === "paper,paper,scissors,scissors,scissors", "對砍開始：序列全公開");
  ok(has(e, "clash_dash", x => near(x.zoom, 1.22) && near(x.dur, 0.25)), "衝刺交會 0.25s、鏡頭 1.22x");
  until(e, () => e.phase !== PH.CLASH_ANIM || !!e.cm.result);
  const cuts = e.log.filter(x => x.type === "clash_cut");
  // P1 布 布 剪 剪 剪 ／ P2 石 石 布 布 石 → P1 P1 P1 P1 P2
  ok(cuts.length === 5 && cuts.map(c => c.winner).join() === "0,0,0,0,1", `五刀依序結算：${cuts.map(c => `第${c.n}刀 ${c.winner < 0 ? "平" : "P" + (c.winner + 1)}`).join("、")}`);
  const A = e.cm.cutAt, gaps = A.map((x, i) => +(x - (i ? A[i - 1] : CONFIG.clashMode.dashDur)).toFixed(3));
  ok(gaps.join() === "0.55,0.4,0.28,0.2,0.14", `由慢到快：每刀間隔 ${gaps.join("／")}s`);
  ok(cuts.map(c => c.zoom).join() === "1.22,1.27,1.32,1.37,1.45" && cuts.map(c => c.hitstop).join() === "50,60,70,80,180" && cuts.map(c => c.pitch).join() === "1,1.1,1.2,1.32,1.45", "鏡頭／頓幀／音高逐刀加強");
  ok(cuts[4].impact === 2 && cuts.slice(0, 4).every(c => c.impact === 0) && cuts[4].last, "第 5 刀：2 幀黑白反色衝擊幀");
  ok(e.log.filter(x => x.type === "hitstop" && x.ev === "clash").map(x => x.ms).join() === "50,60,70,80,180", "每刀送出對應的頓幀");
  ok(e.cm.score.join() === "4,1" && has(e, "clash_result", x => x.winner === 0 && x.main === "scissors" && !x.tiebreak), "P1 4:1 勝；贏最多刀的是剪刀（2 刀）→ 主招剪刀");
  until(e, () => e.phase !== PH.CLASH_ANIM);
  ok(has(e, "clash_finisher", x => x.main === "scissors" && x.name === "居合十字斬" && x.damage === 30 && x.first), "居合十字斬：+24%＋先手 6% = 30%");
  ok(has(e, "clash_pass") && e.f[1].damage === 30, "青光穿身（clash_pass）後才命中");
  ok(e.f[0].heat === null && e.f[1].heat === null && e.gauge === 0 && has(e, "gauge", x => x.gauge === 0), "拼刀結算：過熱全部清除、蓄力歸零");
  until(e, () => e.phase === PH.RPS);
  ok(has(e, "round_end"), "拼刀有勝負＝一輪攻防結束，回猜拳");
}

console.log("拼刀：主招規則、平分看先手、都沒先手白色衝擊波、超時補齊");
{
  const setupClash = (extra = {}) => { const x = make(S({ pos: 3, ...extra }, { pos: 5 }, { gauge: 1 })); run(x, 0.3); tap(x, 0, "M"); tap(x, 1, "M"); until(x, () => x.phase === PH.CLASH_INPUT); return x; };
  const fill = (x, p, keys) => { for (const b of keys) tap(x, p, b, 0.02); };
  const both = (x, keys) => { for (const b of keys) { x.input(0, "down", b); x.input(1, "down", b); run(x, 0.02); x.input(0, "up", b); x.input(1, "up", b); run(x, STEP); } };
  // 主招平手：P1 贏石 1、布 1，最後一次贏的是布 → 布
  const m = setupClash();
  fill(m, 1, ["M", "L", "R", "R", "R"]); fill(m, 0, ["L", "R", "R", "M", "M"]);   // 刀：P1 石>剪、P1 布>石、平、P2 布<剪? → 剪>布 P1、剪>布 P1
  until(m, () => !!m.cm.result || m.phase !== PH.CLASH_ANIM);
  ok(m.cm.cuts.join() === "0,0,-1,0,0" && m.cm.result.main === "scissors", "主招：贏最多刀的手勢（剪刀 2 刀）");
  const m2 = setupClash();
  fill(m2, 1, ["M", "L", "L", "L", "L"]); fill(m2, 0, ["L", "R", "L", "L", "L"]);  // P1 石贏 1、布贏 1，其餘平；最後贏的那刀是布
  until(m2, () => !!m2.cm.result || m2.phase !== PH.CLASH_ANIM);
  ok(m2.cm.cuts.join() === "0,0,-1,-1,-1" && m2.cm.result.main === "paper" && m2.cm.result.winner === 0, "次數相同：取勝方最後一次贏的那刀（布）");
  // 平分看先手：0.25s 金光慢動作
  const e = setupClash();
  fill(e, 1, ["L", "M", "R", "L", "L"]);                                    // P2 先填
  fill(e, 0, ["M", "L", "R", "L", "L"]);                                    // 刀1 P2 石>剪、刀2 P1 石>剪、其餘平 → 1:1
  until(e, () => !!e.cm.result || e.phase !== PH.CLASH_ANIM);
  const R = e.cm.result;
  ok(e.cm.score.join() === "1,1" && R.winner === 1 && R.tiebreak && R.main === "rock", "1:1 平分：持有 ⚡ 先手的 P2 勝（先手絕殺），主招石頭");
  ok(near(e.cm.fxAt - e.t, CONFIG.clashMode.tiebreakSlow) || e.cm.fxAt > e.t, "先手絕殺：先放 0.25s 金光慢動作");
  until(e, () => e.phase !== PH.CLASH_ANIM);
  ok(has(e, "clash_finisher", x => x.main === "rock" && x.name === "崩山重砸" && x.damage === 30) && has(e, "hitstop", x => x.vertical), "崩山重砸：+30%、垂直震動");
  const d = setupClash();
  both(d, ["L", "M", "R", "L", "M"]);
  until(d, () => d.phase !== PH.CLASH_ANIM);
  ok(d.cm.first === -1 && !has(d, "clash_first") && has(d, "clash_end", x => x.winner === -1 && x.draw), "同時填完沒有先手；五刀全平 → 平局");
  ok(d.phase === PH.CLASH && has(d, "clash", x => x.wave) && d.gauge === 0, "平局：白色衝擊波彈開、蓄力歸零");
  ok(until(d, () => d.phase === PH.RPS) && d.f.every(f => f.damage === 0) && !has(d, "round_end"), "平局各自彈開，直接下一輪猜拳（沒損傷）");
  const t = setupClash();
  tap(t, 0, "L", 0.02);
  until(t, () => t.phase === PH.CLASH_ANIM, 5);
  ok(t.cm.seq.every(s => s.length === 5) && t.cm.seq[0][0] === "rock" && t.cm.first === -1, "3.5 秒到：P1 只填 1 格、P2 沒填，都被隨機補滿；沒人填滿＝沒有先手");
  // 三種大招：傷害、擊飛倍率、角度完全一樣（只差演出）
  const launch = (a, b) => {
    const x = make(S({ pos: 3 }, { pos: 5, damage: 40 }, { gauge: 1 })); run(x, 0.3); tap(x, 0, "M"); tap(x, 1, "M"); until(x, () => x.phase === PH.CLASH_INPUT);
    fill(x, 0, a); fill(x, 1, b); until(x, () => x.phase !== PH.CLASH_ANIM);
    const fin = x.log.find(e => e.type === "clash_finisher");
    return { main: fin.main, dmg: fin.damage, vx: Math.abs(x.f[1].vx).toFixed(3), vy: x.f[1].vy.toFixed(3), x };
  };
  const L3 = [launch(["L", "L", "L", "L", "L"], ["M", "M", "M", "M", "M"]), launch(["M", "M", "M", "M", "M"], ["R", "R", "R", "R", "R"]), launch(["R", "R", "R", "R", "R"], ["L", "L", "L", "L", "L"])];
  ok(L3.map(l => l.main).join() === "rock,scissors,paper", "三種主招都打得出來（崩山重砸／居合十字斬／零距離氣功轟飛）");
  ok(L3.every(l => l.dmg === L3[0].dmg && l.vx === L3[0].vx && l.vy === L3[0].vy), `三種大招傷害 ${L3[0].dmg}%、擊飛速度完全相同（vx ${L3[0].vx}、vy ${L3[0].vy}）`);
  for (const l of L3) until(l.x, () => l.x.phase === PH.RPS || has(l.x, "ko"), 6);
  ok(L3.every(l => !has(l.x, "skid")), "氣功轟飛不再落地滑行");
}

console.log("連勝：連贏 3 次才進四套拳；輸一輪歸零；平手不動；重擊推到崖邊停住");
{
  const e = make(S({ pos: 3 }, { pos: 5 }));
  const round = (a, b) => { until(e, () => e.phase === PH.RPS && e.t > 0.1); tap(e, 0, a); tap(e, 1, b); until(e, () => [PH.STRIKE, PH.BURST, PH.CLASH, PH.CLASH_INPUT].includes(e.phase)); return e.phase; };
  ok(round("L", "M") === PH.STRIKE && e.f.map(f => f.streak).join() === "1,0" && has(e, "streak", x => x.p === 0 && x.streak.join() === "1,0"), "P1 贏第 1 次：連勝 1/3、單發重擊");
  until(e, () => e.phase === PH.RPS);
  ok(round("M", "R") === PH.STRIKE && e.f[0].streak === 2, "P1 再贏：連勝 2/3、還是單發重擊");
  until(e, () => e.phase === PH.RPS);
  ok(e.f[1].pos === 7 && e.f[1].damage === 2 * CONFIG.strike.damage, `兩記重擊：P2 被推到崖邊格 ${e.f[1].pos}、+${e.f[1].damage}%`);
  ok(round("R", "L") === PH.BURST && e.f[0].streak === 3 && has(e, "combo_start", x => x.att === 0), "連勝 3/3：🔥 連勝爆發 → 四套拳");
  const b = make(S({ pos: 3, streak: 2 }, { pos: 5 }));
  run(b, 0.3); tap(b, 0, "L"); tap(b, 1, "R");                              // P1 連勝 2 被 P2 斷掉
  until(b, () => b.phase === PH.STRIKE);
  ok(b.f[0].streak === 0 && b.f[1].streak === 1 && has(b, "streak", x => x.p === 0 && x.why === "broken"), "被斷連勝：P1 歸零、換 P2 從 1/3 算");
  const t = make(S({ pos: 3, streak: 2 }, { pos: 5 }));
  run(t, 0.3); tap(t, 0, "L"); tap(t, 1, "L"); until(t, () => t.phase === PH.CLASH);
  ok(t.f[0].streak === 2, "平手：連勝不重置（2/3 保留）");
  const w = make(S({ pos: 6 }, { pos: 7 }, { phase: PH.STRIKE, round: { att: 0, winGesture: "rock" } }));
  until(w, () => w.phase === PH.RPS);
  ok(w.f[1].pos === 7 && w.f[1].damage === CONFIG.strike.damage, "對手已在崖邊：重擊照樣加傷，但推不出台（撞崖邊停住）");
}

console.log("四套拳：攻方選拳（守方看不到）→ 守方逐拳反擊（只認第一下）");
{
  const C = CONFIG.combo;
  const e = make(S({ pos: 3 }, { pos: 5 }, { phase: PH.BURST, round: { att: 0, winGesture: "rock" } }));
  ok(near(e.dur, C.burstDur), `連勝爆發演出 ${C.burstDur}s`);
  until(e, () => e.phase === PH.COMBO_PREP);
  ok(e.round.n === 1 && near(e.dur, C.prepDur), `第 1 拳：攻方選拳 ${C.prepDur}s`);
  tap(e, 0, "M"); tap(e, 0, "R");                                            // 改兩次：最後按的算
  ok(e.viewFor(1).round.gesture === null && e.viewFor(-1).round.gesture === null && e.viewFor(0).round.gesture === "paper", "選拳期：守方（和共用畫面）看不到，攻方看得到自己選的布");
  ok(e.log.filter(x => x.type === "combo_pick").every(x => x.private === 0), "選拳事件只送攻方");
  tap(e, 1, "M");                                                            // 守方在選拳期亂按：不算
  until(e, () => e.phase === PH.COMBO_CUE);
  ok(e.round.gesture === "paper" && !e.round.done && near(e.dur, C.reactDur) && has(e, "combo_cue", x => x.n === 1 && x.gesture === "paper" && x.counter === "scissors"), `拳種亮出（布）：守方反擊窗 ${C.reactDur}s，選拳期亂按的不算`);
  ok(e.viewFor(1).round.gesture === "paper" && e.viewFor(1).round.counter === "scissors", "反擊窗：守方看得到拳種與剋制手勢");
  tap(e, 1, "L"); tap(e, 1, "M");                                            // 先按錯（石頭被布剋）再按對
  ok(e.round.result === "hit" && has(e, "wrong", x => x.p === 1) && e.f[1].damage === C.hitDamage[0], `只認第一下：按錯就吃第 1 拳 +${C.hitDamage[0]}%，後面按對沒用`);
  until(e, () => e.phase === PH.COMBO_PREP);
  ok(e.round.n === 2, "吃拳後進第 2 拳");
  until(e, () => e.phase === PH.COMBO_CUE);
  ok(e.round.random && ["rock", "scissors", "paper"].includes(e.round.gesture), `攻方沒選：系統隨機出（${e.round.gesture}）`);
  const late = make(S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 } }));
  tap(late, 0, "L"); until(late, () => late.phase === PH.COMBO_CUE); run(late, 0.8); tap(late, 1, "R");
  ok(late.round.result === "counter", "0.8 秒才按也來得及（新手友善）");
  const to = make(S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 } }));
  until(to, () => to.phase === PH.COMBO_HIT);
  ok(has(to, "timeout", x => x.p === 1) && to.round.result === "hit", "沒按：逾時吃拳");
}

console.log("反擊成功：中斷剩下的拳、換位、反打；4 拳全吃：第 4 拳擊飛；結束後連勝歸零");
{
  const C = CONFIG.combo;
  const e = make(S({ pos: 3, streak: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0, n: 1 } }));   // 從第 2 拳開始
  tap(e, 0, "M"); until(e, () => e.phase === PH.COMBO_CUE);                  // 剪刀
  tap(e, 1, "L");                                                            // 石頭剋剪刀
  ok(e.round.result === "counter" && has(e, "counter", x => x.p === 1 && x.n === 2) && e.phase === PH.RESOLVE, "第 2 拳按出剋制手勢：反擊成功，四套拳提早結束");
  ok(e.f[0].pos === 5 && e.f[1].pos === 3 && e.f[0].damage === C.counterDamage, `換位＋反打 +${C.counterDamage}%、攻方被擊退到格 ${e.f[0].pos}`);
  ok(e.f[0].streak === 0 && has(e, "combo_end", x => x.how === "countered"), "四套拳結束：攻方連勝歸零");
  const full = make(S({ pos: 2, streak: 3 }, { pos: 3 }, { phase: PH.BURST, round: { att: 0, winGesture: "rock" } }));
  until(full, () => full.phase === PH.RESOLVE, 10);
  const hits = full.log.filter(x => x.type === "hit" && x.kind === "combo");
  const sum = C.hitDamage.reduce((a, b) => a + b, 0);
  ok(hits.length === 4 && hits[3].final && full.f[1].air && full.f[1].damage === sum, `守方完全沒按：吃好吃滿 4 拳（+${sum}%），第 4 拳擊飛`);
  ok(hits.slice(0, 3).every(h => !h.final) && full.f[1].pos === 6, `第 1～3 拳每拳推 1 格（3 → ${full.f[1].pos}）`);
  const R = CONFIG.resolve;
  ok(near(hits[3].v, R.vBase * (1 + sum / R.damageDiv) * C.finalLaunch), `第 4 拳擊飛：V = vBase × (1 + ${sum}/${R.damageDiv}) × ${C.finalLaunch}`);
  ok(full.f[0].streak === 0 && has(full, "combo_end", x => x.how === "full" && x.hits === 4), "打完四拳：攻方連勝歸零");
}

console.log("落台：扣命、重生、損傷／過熱／蓄力／雙方連勝全歸零");
{
  const e = make(S({ pos: 6, streak: 3 }, { pos: 7, damage: 150, heat: "rock", streak: 0 }, { phase: PH.COMBO_PREP, round: { att: 0, n: 3 }, gauge: 1 }));
  until(e, () => has(e, "ko"), 6);
  ok(has(e, "ko", x => x.p === 1) && e.f[1].stocks === CONFIG.stocks - 1, "150% 吃第 4 拳：擊飛出界 KO，扣 1 命");
  until(e, () => e.phase === PH.RPS);
  ok(e.f[1].damage === 0 && e.f[0].pos === CONFIG.spawn[0] && e.f[1].pos === CONFIG.spawn[1] && e.f[1].heat === null && e.gauge === 0 && e.f.every(f => f.streak === 0), "重生：回中央、損傷歸零、過熱清除、蓄力與雙方連勝歸零");
}

console.log("站位只靠推擠、換位、擊飛");
{
  const m = make(S({ pos: 3 }, { pos: 5 }));
  for (let i = 0; i < 200; i++) { m.input(0, "down", "L"); m.input(1, "down", "R"); m.step(STEP); m.input(0, "up", "L"); m.input(1, "up", "R"); m.step(STEP); }
  ok(m.f[0].pos === 3 && m.f[1].pos === 5, "猜拳時亂按方向鍵不會移動");
}

console.log("放開再按（跨階段）");
{
  const e = make(S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 } }));
  e.input(1, "down", "R"); run(e, 0.05);                                       // 守方在選拳期就按著布
  until(e, () => e.phase === PH.COMBO_CUE); run(e, 0.05);
  ok(!e.round.done, "從選拳期一路按著進反擊窗：不算（要放開再按）");
}

console.log("flow 中途 reset 不吞事件（教學用）");
{
  const setupB = S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 1 } });
  const e = new Engine({ setup: S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 } }), rng: () => 0.1, flow: from => (from === PH.COMBO_HIT ? { reset: setupB } : undefined) });
  e.log = [];
  until(e, () => e.phase === PH.COMBO_PREP && e.round.att === 1);
  ok(has(e, "hit", x => x.kind === "combo" && x.n === 1), "吃拳後 flow 換段：hit 事件仍有送出");
  ok(e.phase === PH.COMBO_PREP && e.round.att === 1, "且已換到下一段的設定");
}

console.log("線上延遲寬容（四套拳反擊窗）");
{
  const late = grace => { const x = new Engine({ setup: S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 } }), rng: () => 0.1, windowGrace: grace }); x.log = []; x.input(0, "down", "L"); run(x, 0.05); x.input(0, "up", "L"); until(x, () => x.phase === PH.COMBO_CUE); run(x, x.dur + 0.04); x.input(1, "down", "R"); run(x, STEP * 2); return x.round.result; };
  ok(late(0) === "hit", `本機（無寬容）：反擊窗結束後 40ms 才按 → 已逾時吃拳`);
  ok(late(CONFIG.net.windowGraceMs / 1000) === "counter", `線上（寬容 ${CONFIG.net.windowGraceMs}ms）：晚 40ms 抵達的正確按鍵仍算反擊`);
}

console.log("越打越快");
{
  const Sp = CONFIG.speed, e = make(S({ pos: 3 }, { pos: 5 }));
  const durs = [];
  for (let k = 0; k < 12; k++) {                                         // 打 12 回合拼刀平局（都按同一招、拼刀同時填）
    until(e, () => e.phase === PH.RPS); durs.push([e.speedLv, +e.dur.toFixed(3), +e.reveal.toFixed(3)]);
    run(e, 0.05); tap(e, 0, "M"); tap(e, 1, "M");
    until(e, () => e.phase === PH.CLASH_INPUT || e.phase === PH.CLASH);     // 蓄力：小拼刀、大拼刀交替
    if (e.phase === PH.CLASH_INPUT) for (const b of ["L", "L", "L", "L", "L"]) { e.input(0, "down", b); e.input(1, "down", b); run(e, 0.02); e.input(0, "up", b); e.input(1, "up", b); run(e, STEP); }
    until(e, () => e.phase === PH.RPS);
  }
  ok(durs[0][0] === 0 && durs[3][0] === 1 && durs[6][0] === 2 && durs[9][0] === 3, `每 3 回合升一級（等級 ${durs.map(d => d[0] + 1).join("")}）`);
  ok(near(durs[0][1], 2.8) && near(durs[0][2], 2.2), "Lv.1 猜拳 2.8s（亮招 2.2s）");
  ok(near(durs[9][2], Sp.fast.rpsReveal) && near(durs[9][1], Sp.fast.rpsReveal + Sp.fast.rpsHidden), `最快：亮招 ${Sp.fast.rpsReveal}s＋藏招 ${Sp.fast.rpsHidden}s`);
  const f = new Engine({ setup: S({ pos: 3 }, { pos: 4 }, { phase: PH.COMBO_PREP, round: { att: 0 }, rounds: 12 }), rng: () => 0.1 }); f.log = [];
  ok(near(f.dur, Sp.fast.comboPrep), `最快選拳 ${f.dur}s`);
  until(f, () => f.phase === PH.COMBO_CUE); ok(near(f.dur, Sp.fast.comboReact), `最快反擊窗 ${f.dur}s`);
  const t = new Engine({ setup: S({ pos: 3 }, { pos: 5 }, { rounds: 12 }), speedUp: false });
  ok(t.speedLv === 0 && near(t.dur, 2.8), "教學（speedUp: false）不加速");
}

console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
