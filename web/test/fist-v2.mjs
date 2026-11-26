// 拳刃交鋒 v2.0 實驗開關（訓練場專用）引擎驗收：快節奏讀心、無格線滑行、回場、KO、反擊窗、全關恢復 v4
//   用法：node test/fist-v2.mjs
const root = new URL("../public/fist/src", import.meta.url).href;
const { CONFIG } = await import(root + "/config.js");
const { Engine, PH } = await import(root + "/engine.js");
Object.assign(CONFIG.V2_EXPERIMENTS, { fastRps: true, freeStage: true, heavyHits: true, comboV2: true, juice: true });
let fails = 0; const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const dt = 1 / 120;
const run = (e, sec, until) => { const evs = []; for (let t = 0; t < sec; t += dt) { evs.push(...e.step(dt)); if (until && until(e)) break; } return evs; };
const tap = (e, p, b) => { e.input(p, "down", b); e.step(dt); e.input(p, "up", b); };

let e = new Engine({ rng: () => 0.5, speedUp: false });
run(e, 0.1);
ok(e.phase === PH.RPS && Math.abs(e.dur - 1.5) < 1e-9, "猜拳限時 1.5s");
tap(e, 0, "L"); tap(e, 0, "M");
ok(e.f[0].stance === "rock" && e.f[0].picked, "按下即鎖定：第二下改剪刀無效");
ok(e.viewFor(1).fighters[0].stance === "hidden" && e.viewFor(1).fighters[0].anim.state === "stance_hidden", "對手看不到我出什麼（黑影）");
ok(e.f[0].anim.state === "stance_rock", "鎖定當幀就擺出前搖");
const t0 = e.rt; tap(e, 1, "M");
run(e, 1, e => e.phase !== PH.RPS);
ok(e.rt - t0 < 0.2 && e.phase === PH.REVEAL, `雙方鎖定立刻開牌（${((e.rt - t0) * 1000).toFixed(0)}ms）`);
const x1 = e.f[1].x;
const evs = run(e, 2, e => e.phase === PH.RPS && e.t > 0.3);
const hit = evs.find(v => v.type === "hit");
ok(hit?.damage === 13 && e.f[1].damage === 13, "單發重擊 +13%");
ok(e.f[1].x !== x1 && Math.abs(((e.f[1].x - CONFIG.stageX) / CONFIG.cellW) % 1 - 0.5) > 0.01 || evs.some(v => v.type === "engage"), `無格線：受擊滑行後不吸附格子（x ${x1.toFixed(1)}→${e.f[1].x.toFixed(1)}）`);
ok(Math.abs(Math.abs(e.f[1].x - e.f[0].x) - CONFIG.V2.engageGap) < 1, `下一輪前自動貼近到 ${CONFIG.V2.engageGap}px`);

// 交鋒時間：從猜拳開始到下一輪猜拳
e = new Engine({ rng: () => 0.5, speedUp: false }); run(e, 0.05);
const s0 = e.rt; tap(e, 0, "L"); tap(e, 1, "M"); run(e, 3, e => e.phase === PH.RPS && e.rt - s0 > 0.1);
ok(e.rt - s0 <= 1.5, `一次交鋒（雙方秒按）${(e.rt - s0).toFixed(2)}s ≤ 1.5s`);

// 低損傷擊飛出台 → 回場；高損傷台邊 → KO
const launch = (dmg, x) => {
  const e = new Engine({ rng: () => 0.5, speedUp: false, setup: { p: [{ pos: 5, damage: 0 }, { pos: 6, damage: dmg }], phase: PH.COMBO_PREP, round: { att: 0, winGesture: "rock", n: 3 } } });
  e.f[0].x = e.f[0].hx = x - 30; e.f[1].x = e.f[1].hx = x;
  const evs = run(e, 0.6, e => e.phase === PH.COMBO_CUE).concat(run(e, 1.2));  // 木樁不按＝吃第 4 拳
  const all = evs.concat(run(e, 6, e => e.phase === PH.RPS));
  return { ko: all.some(v => v.type === "ko"), rec: all.some(v => v.type === "recover"), e };
};
let r = launch(30, 396); ok(!r.ko && r.rec && !r.e.f[1].air, "30% 在台邊吃第 4 拳：飛出平台但回場落地");
r = launch(140, 396); ok(r.ko, "140% 在台邊吃第 4 拳：轟出畫面 KO");
r = launch(0, 240); ok(!r.ko && !r.rec, "0% 在中央：只小飛一下落回台上");
// 反擊窗
e = new Engine({ rng: () => 0.5, speedUp: false, setup: { p: [{ pos: 3 }, { pos: 5 }], phase: PH.COMBO_PREP, round: { att: 0, winGesture: "rock", n: 0 } } });
run(e, 2, e => e.phase === PH.COMBO_CUE);
ok(Math.abs(e.dur - 0.75) < 1e-9, "四套拳反擊窗 0.75s");
// 關閉後恢復 v4
Object.keys(CONFIG.V2_EXPERIMENTS).forEach(k => CONFIG.V2_EXPERIMENTS[k] = false);
e = new Engine({ rng: () => 0.5 }); run(e, 0.05);
ok(Math.abs(e.dur - CONFIG.rps.dur) < 1e-9, "開關全關：猜拳回到 2.8s");
console.log(fails ? `✗ ${fails}` : "全部通過"); process.exit(fails ? 1 : 0);
