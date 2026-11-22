// 拳刃交鋒 engine.js 規則驗收（純邏輯，node 直接跑：node test/fist-engine.mjs）
//   放開再按、判定窗單次鎖死、硬直跨階段、頂撞、崖邊、連打追加、終結擇（短按／長按紅光）、彈反、紅招翻滾、擊飛 KO、拼刀、
//   回合結束回氣、資訊遮蔽（藏招、還沒亮出的終結手勢）
import { Engine, PH, cellX } from "../public/fist/src/engine.js";
import { CONFIG } from "../public/fist/src/config.js";

const STEP = 1 / 120;
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
function make(setup) { const e = new Engine({ setup, rng: () => 0.1 }); e.log = []; return e; }
function run(e, sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) e.log.push(...e.step(STEP)); }
function until(e, cond, max = 10) { let t = 0; while (!cond() && t < max) { e.log.push(...e.step(STEP)); t += STEP; } return cond(); }
const tap = (e, p, btn, hold = 0.04) => { e.input(p, "down", btn); run(e, hold); e.input(p, "up", btn); run(e, STEP); };
const has = (e, type, f = () => true) => e.log.some(x => x.type === type && f(x));
const S = (a, b, extra = {}) => ({ p: [a, b], ...extra });

console.log("走位");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }));
  e.input(0, "down", "R"); e.input(1, "down", "L"); run(e, 0.3); e.input(0, "up", "R"); e.input(1, "up", "L"); run(e, STEP);
  ok(e.f[0].pos === 3 && e.f[1].pos === 5 && e.f[0].power === 1 && e.f[1].power === 1, "同時踏進格 4：頂撞彈回原格、力量照扣");
  const e2 = make(S({ pos: 3, power: 2 }, { pos: 7, power: 2 }));
  tap(e2, 1, "R");
  ok(e2.f[1].pos === 7 && e2.f[1].power === 2 && e2.f[1].steps === 0 && has(e2, "wobble"), "崖邊往外按：微晃、不扣氣不計步");
  tap(e2, 0, "L"); run(e2, 0.2); tap(e2, 0, "L"); run(e2, 0.2);
  ok(e2.f[0].pos === 1 && e2.f[0].stun > 0.7 && has(e2, "stun", x => x.p === 0), `第 2 步落地硬直（剩 ${e2.f[0].stun.toFixed(2)}s）`);
  tap(e2, 0, "R");
  ok(e2.f[0].pos === 1 && has(e2, "deny", x => x.why === "steps"), "第 3 步：步數用完");
  until(e2, () => e2.phase === PH.RPS);
  ok(e2.f[0].stun > 0, "硬直延續到猜拳");
  tap(e2, 0, "L"); ok(e2.f[0].stance === null && has(e2, "deny", x => x.why === "stun"), "硬直中按鍵鎖死、不能換招");
  until(e2, () => e2.f[0].stun === 0); tap(e2, 0, "R"); ok(e2.f[0].stance === "paper", "硬直結束後可以出拳");
  const e3 = make(S({ pos: 3, power: 0 }, { pos: 5, power: 2 }));
  tap(e3, 0, "L"); ok(e3.f[0].pos === 3 && has(e3, "deny", x => x.why === "power"), "沒氣不能走");
}

console.log("放開再按（跨階段）");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }));
  e.input(0, "down", "L"); run(e, 0.05);                                     // 走位時按住左
  ok(e.f[0].pos === 2 || e.f[0].move, "走位階段按左：踏出一步");
  until(e, () => e.phase === PH.RPS);
  run(e, 0.1);
  ok(e.f[0].stance === null, "一路按著進猜拳：不算出拳（要放開再按）");
  e.input(0, "up", "L"); run(e, STEP); e.input(0, "down", "L"); run(e, STEP); e.input(0, "up", "L"); run(e, STEP);
  ok(e.f[0].stance === "rock", "放開再按：才算出石頭");
  // 鍵盤自動重複：連送兩次 down 只算一次
  const e2 = make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }));
  e2.input(0, "down", "R"); e2.input(0, "down", "R"); run(e2, 0.3);
  ok(e2.f[0].steps === 1, "重複的按下（自動重複）只算一次");
}

console.log("猜拳 → 連打 → 終結擇 → 藍光彈反");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }));
  until(e, () => e.phase === PH.RPS); run(e, 0.1);
  tap(e, 0, "L"); tap(e, 1, "M");                                           // P1 石、P2 剪
  // 藏招：P2 換招 P1 看不到
  until(e, () => e.t >= CONFIG.rps.reveal + 0.05);
  tap(e, 1, "R");
  ok(e.viewFor(0).fighters[1].stance === "hidden" && e.viewFor(1).fighters[1].stance === "paper" && e.viewFor(-1).fighters[0].stance === "hidden", "藏招：對手看不到你換了什麼（同機共用畫面兩邊都遮）");
  tap(e, 1, "M");                                                            // 換回剪刀
  until(e, () => e.phase === PH.MASH);
  ok(e.round.att === 0, "石頭贏剪刀：P1 成為攻方");
  for (let i = 0; i < 12; i++) tap(e, 0, ["L", "M", "R"][i % 3], 0.01);     // 狂按 12 下
  until(e, () => e.phase === PH.SELECT);
  ok(e.round.hits === 2 && e.round.extra === 4 && e.f[1].damage === 2 * CONFIG.mash.baseDamage + 4 * CONFIG.mash.extraDamage, `連打：保底 2 拳 + 追加上限 4 拳（P2 ${e.f[1].damage}%）`);
  ok(e.f[1].pos === 7, `保底兩拳把對手推到崖邊（格 ${e.f[1].pos}），撞崖邊停住`);
  ok(e.viewFor(1).round.gesture === null, "終結擇：守方看不到攻方選的手勢");
  tap(e, 0, "R");                                                            // 短按布：普通終結改成布
  ok(e.round.gesture === "paper" && !e.round.red, "短按選終結手勢（布）");
  until(e, () => e.phase === PH.WINDOW);
  ok(e.viewFor(1).round.gesture === "paper" && e.viewFor(1).round.type === "blue", "判定窗：手勢公開、藍光");
  tap(e, 1, "M");                                                            // 剪刀剋布 → 彈反
  ok(e.round.result === "parry" && e.f[0].damage === CONFIG.parry.counterDamage, `按克制手勢：完美彈反，原攻方吃反擊 +${CONFIG.parry.counterDamage}%`);
  until(e, () => e.phase === PH.MOVE);
  ok(e.f[1].pos < e.f[0].pos && e.f[0].power === 3 && e.f[1].power === 3, `彈反互換站位（P1 格 ${e.f[0].pos}、P2 格 ${e.f[1].pos}）；回合結束雙方 +1 氣`);
}

console.log("判定窗單次鎖死");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  tap(e, 1, "L"); tap(e, 1, "R");                                            // 先按錯（石）再按對（布）
  ok(e.round.result === "hit" && has(e, "wrong"), "第一次按錯就吃招，第二次按對無效");
  const e2 = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  run(e2, 0.55);
  ok(e2.round.result === "hit" && has(e2, "timeout"), "0.5s 沒反應：吃招");
}

console.log("終結擇：長按贏拳鍵 0.3s＝紅光；未滿放開＝藍光不扣氣");
{
  const mk = () => make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" } }));
  const e = mk(); until(e, () => e.phase === PH.SELECT);
  e.input(0, "down", "L"); run(e, 0.32);
  ok(e.round.red && e.f[0].power === 0 && has(e, "red_ready"), "長按滿 0.3s：紅光，扣 2 氣");
  e.input(0, "up", "L"); until(e, () => e.phase === PH.WINDOW);
  ok(e.round.type === "red" && e.round.zone.length >= 1, `紅區鎖定（${e.round.zone}）`);
  const e2 = mk(); until(e2, () => e2.phase === PH.SELECT);
  e2.input(0, "down", "L"); run(e2, 0.2); e2.input(0, "up", "L"); run(e2, STEP);
  ok(!e2.round.red && e2.f[0].power === 2, "按 0.2s 就放開：藍光、不扣氣");
  const e3 = make(S({ pos: 3, power: 1 }, { pos: 5, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "rock" } }));
  until(e3, () => e3.phase === PH.SELECT); e3.input(0, "down", "L"); run(e3, 0.35);
  ok(!e3.round.red && e3.f[0].power === 1, "力量不到 2：長按也不會紅光");
  const e4 = mk(); e4.input(0, "down", "L"); until(e4, () => e4.phase === PH.SELECT); run(e4, 0.35);
  ok(!e4.round.red, "從連打一路按著進終結擇：不算長按（放開再按）");
}

console.log("紅招：零氣閃避（翻滾穿過攻方）／按錯吃招擊飛 KO");
{
  const setup = S({ pos: 6, power: 2 }, { pos: 7, power: 0, damage: 110 }, { phase: PH.WINDOW, round: { att: 0, red: true } });
  const e = make(setup);
  ok(JSON.stringify(e.round.zone) === "[6,7]" && JSON.stringify(e.round.dirs) === "[-1]", `崖邊：紅區 ${JSON.stringify(e.round.zone)}，只亮 ◀（${JSON.stringify(e.round.dirs)}）`);
  tap(e, 1, "L");
  ok(e.round.result === "roll" && e.f[1].pos === 5, `0 氣照樣翻滾 2 格到格 ${e.f[1].pos}（穿過格 6 的攻方）`);
  const e2 = make(setup);
  tap(e2, 1, "M");
  until(e2, () => has(e2, "ko"));
  ok(has(e2, "ko", x => x.p === 1) && e2.f[1].stocks === CONFIG.stocks - 1, "按錯：吃紅招擊飛出界 KO，扣 1 命");
  until(e2, () => e2.phase === PH.MOVE);
  ok(e2.f[1].damage === 0 && e2.f[0].pos === CONFIG.spawn[0] && e2.f[1].pos === CONFIG.spawn[1], "掉命：重置中央、損傷歸零");
}

console.log("擊飛公式");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2, damage: 40 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }));
  run(e, 0.55);
  const ev = e.log.find(x => x.type === "finisher_hit"), R = CONFIG.resolve;
  const d = 40 + CONFIG.finisherDamage;
  ok(Math.abs(ev.v - R.vBase * (1 + d / R.damageDiv)) < 1e-6, `藍光：V = vBase × (1 + ${d}/${R.damageDiv}) = ${ev.v.toFixed(1)}`);
  const e2 = make(S({ pos: 3, power: 2 }, { pos: 4, power: 2, damage: 40 }, { phase: PH.WINDOW, round: { att: 0, red: true } }));
  run(e2, 0.55);
  const ev2 = e2.log.find(x => x.type === "finisher_hit");
  ok(Math.abs(ev2.v - R.vBase * (1 + d / R.damageDiv) * R.redMult) < 1e-6, `紅光：再 × ${R.redMult} = ${ev2.v.toFixed(1)}`);
}

console.log("拼刀與回氣");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 5, power: 2 }));
  until(e, () => e.phase === PH.RPS); run(e, 0.1); tap(e, 0, "M"); tap(e, 1, "M");
  until(e, () => e.phase === PH.CLASH);
  ok(e.phase === PH.CLASH, "同手勢：拼刀");
  until(e, () => e.phase === PH.MOVE);
  ok(e.f[0].power === 2 && e.f[1].power === 2, "拼刀不回力量，直接回走位");
}

console.log("flow 中途 reset 不吞事件（教學用）");
{
  const setupB = S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 1, gesture: "scissors" } });
  const e = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "paper" } }), rng: () => 0.1, flow: (from) => (from === PH.MASH ? { reset: setupB } : undefined) });
  e.log = [];
  for (let i = 0; i < 10; i++) tap(e, 0, ["L", "M", "R"][i % 3], 0.01);
  until(e, () => e.phase === PH.WINDOW);
  ok(has(e, "mash_end", x => x.extra === 4), "連打結束時 flow 換段：mash_end（追加 4）仍有送出");
  ok(e.phase === PH.WINDOW && e.round.att === 1, "且已換到下一段的設定");
}

console.log("紅區永遠兩格、線上延遲寬容");
{
  const e = make(S({ pos: 3, power: 2 }, { pos: 4, power: 0 }, { phase: PH.WINDOW, round: { att: 0, red: true } }));
  ok(JSON.stringify(e.round.zone) === "[4,5]", `台中央：紅區是守方腳下＋往外一格（${JSON.stringify(e.round.zone)}）`);
  const late = grace => { const x = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }), rng: () => 0.1, windowGrace: grace }); x.log = []; run(x, CONFIG.window.dur + 0.04); x.input(1, "down", "R"); run(x, STEP * 2); return x.round.result; };
  ok(late(0) === "hit", "本機（無寬容）：0.54s 才按 → 已逾時吃招");
  ok(late(CONFIG.net.windowGraceMs / 1000) === "parry", `線上（寬容 ${CONFIG.net.windowGraceMs}ms）：0.54s 抵達的正確按鍵仍算彈反`);
  const x = new Engine({ setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 0, gesture: "rock" } }), rng: () => 0.1, windowGrace: 0.08 }); x.log = [];
  run(x, CONFIG.window.dur + 0.09);
  ok(x.round.result === "hit" && has(x, "timeout"), "寬容期過了才逾時");
}

console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
