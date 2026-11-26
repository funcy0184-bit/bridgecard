// engine.js — 《拳刃交鋒》規則引擎（純邏輯：不碰 DOM、不碰畫面、不碰聲音）
//   · 輸入：engine.input(seat, "down" | "up", btn)，btn = "L" | "M" | "R"（本機鍵盤、AI、線上都送同一種事件）
//   · 時間：engine.step(dt) 回傳這一步發生的事件（畫面、音效、教學都靠事件）
//   · 畫面資料：engine.viewFor(seat) —— 依觀看者遮掉不該看到的東西（藏招、四套拳攻方還沒亮出的那一拳、拼刀時對手的五連斬序列）
//   · v4 流程（沒有走位；秒數全在 config.js）：
//       猜拳 RPS（2.2s 亮招＋0.6s 藏招）→ 開牌停頓 REVEAL（0.55s）
//         ├ 分出勝負 → 雙方剛出的手勢過熱；贏拳方連勝 +1、輸方連勝歸零
//         │    ├ 連勝 1、2：單發重擊 STRIKE（小傷＋推 1 格）→ 下一輪猜拳
//         │    └ 連勝 3：連勝爆發 BURST → 四套拳 ×4（攻方選拳 COMBO_PREP → 守方反擊窗 COMBO_CUE → 命中 COMBO_HIT）
//         │         反擊成功：反打＋換位，提早結束；4 拳都吃：第 4 拳擊飛 → 結算 RESOLVE；結束後攻方連勝歸零
//         └ 平手（連勝不動）→ 拼刀蓄力 +1（整場累積，不用連續）
//              ├ 未滿 CLASH_TRIGGER_TIES（2）：小拼刀「叮！」彈開 CLASH（不回氣、過熱不重置）→ 下一輪猜拳
//              └ 集滿：五連斬預輸入 CLASH_INPUT（3.5s、搶 ⚡ 先手）→ 由慢到快五刀對砍 CLASH_ANIM
//                   → 積分高者（同分看先手）依「主招」放專屬大招擊飛 → 結算；同分又沒先手：白色衝擊波彈開
//              拼刀結算或有人落台：蓄力歸零、過熱全清（落台時雙方連勝也歸零）
//   · 防誤觸：
//       1. 放開再按：進入新階段時，還按著的鍵一律標 stale，要放開再按才算；鍵盤自動重複不算新按下
//       2. 反擊窗單次鎖死：四套拳每一拳守方只認第一次按鍵，按錯立刻吃拳
import { CONFIG } from "./config.js";

export const PH = {
  RPS: "PHASE_RPS", REVEAL: "PHASE_REVEAL", CLASH: "PHASE_CLASH", CLASH_INPUT: "PHASE_CLASH_INPUT", CLASH_ANIM: "PHASE_CLASH_ANIM",
  STRIKE: "PHASE_STRIKE", BURST: "PHASE_BURST", COMBO_PREP: "PHASE_COMBO_PREP", COMBO_CUE: "PHASE_COMBO_CUE", COMBO_HIT: "PHASE_COMBO_HIT",
  RESOLVE: "PHASE_RESOLVE",
  GAMEOVER: "PHASE_GAMEOVER", IDLE: "PHASE_IDLE",
};
export const PH_LABEL = {
  [PH.RPS]: "猜拳對峙", [PH.REVEAL]: "開牌！", [PH.CLASH]: "平手！", [PH.CLASH_INPUT]: "⚔️ 拼刀：五連斬", [PH.CLASH_ANIM]: "⚔️ 拼刀對砍",
  [PH.STRIKE]: "連勝重擊", [PH.BURST]: "🔥 連勝爆發！", [PH.COMBO_PREP]: "四套拳：選拳", [PH.COMBO_CUE]: "四套拳：反擊！", [PH.COMBO_HIT]: "四套拳", [PH.RESOLVE]: "結算", [PH.GAMEOVER]: "比賽結束", [PH.IDLE]: "",
};
export const GESTURE_OF = CONFIG.gestureOf;
export const GESTURES = ["rock", "scissors", "paper"];
export const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };       // 誰贏誰
export const COUNTER = { rock: "paper", scissors: "rock", paper: "scissors" };     // 克制這招的手勢
export const KEY_OF = { rock: "L", scissors: "M", paper: "R" };
export const GLABEL = { rock: "石", scissors: "剪", paper: "布" };
export const GNAME = { rock: "✊ 石頭", scissors: "✌️ 剪刀", paper: "🖐️ 布" };
export const GICON = { rock: "✊", scissors: "✌️", paper: "🖐️" };
export const cellX = i => CONFIG.stageX + (i - 0.5) * CONFIG.cellW;
// 一刀（或一次猜拳）的勝負：0／1＝那一方贏，-1＝平
export const duel = (a, b) => (a === b ? -1 : BEATS[a] === b ? 0 : 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// 可重現的亂數（線上、測試用）
export function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const DEFAULT_SETUP = { p: [{ pos: CONFIG.spawn[0], damage: 0 }, { pos: CONFIG.spawn[1], damage: 0 }] };

export class Engine {
  /**
   * @param {object} opts
   * @param {() => number} [opts.rng]   亂數（逾時沒出拳、拼刀沒填滿時隨機）
   * @param {(from:string,to:string,engine:Engine)=>void|{phase?:string,data?:object,reset?:object}} [opts.flow]
   *        階段切換前的掛鉤（教學用來重來、跳關、停在 IDLE）
   * @param {number} [opts.windowGrace]  四套拳反擊窗的延遲寬容（秒）：線上伺服器設 0.08，畫面倒數不變，伺服器多收這段時間內抵達的按鍵
   * @param {boolean} [opts.speedUp]     越打越快（教學關掉）
   */
  constructor(opts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.flow = opts.flow ?? null;
    this.windowGrace = opts.windowGrace ?? 0;
    this.speedUp = opts.speedUp ?? true;
    this.reset(opts.setup ?? DEFAULT_SETUP);
  }

  // ---------------- 狀態 ----------------
  //   setup：{ p: [{ pos, damage, stocks, heat, streak }×2], stocks, phase, round, rounds, gauge }
  //     round（教學直接從某階段開始）：STRIKE／BURST／COMBO_PREP 用 { att, winGesture?, n? }（n＝已打幾拳）
  reset(setup = DEFAULT_SETUP) {
    this.rt = 0; this.t = 0; this.dur = 0; this.phase = PH.IDLE;
    this.round = null; this.winner = -1; this.koTimer = null; this.lastRps = null; this.cm = null;
    this.rounds = setup.rounds ?? 0; this.gauge = clamp(setup.gauge ?? setup.ties ?? 0, 0, CONFIG.CLASH_TRIGGER_TIES);
    this.speedLv = this.levelFor(this.rounds); this.reveal = CONFIG.rps.reveal;
    this.inbox = []; this.out = this.out ?? [];                                       // flow 在階段中途 reset：同一幀已發出的事件不能丟
    this.keys = [0, 1].map(() => ({ L: { down: false, stale: false, at: 0 }, M: { down: false, stale: false, at: 0 }, R: { down: false, stale: false, at: 0 } }));
    this.f = [0, 1].map(i => {
      const s = setup.p[i];
      return {
        i, pos: s.pos, damage: s.damage ?? 0, stocks: s.stocks ?? setup.stocks ?? CONFIG.stocks,
        heat: s.heat ?? null, deny: 0, streak: clamp(s.streak ?? 0, 0, CONFIG.STREAK_TARGET),
        stance: null, picked: false, random: false,
        x: cellX(s.pos), y: CONFIG.floorY, vx: 0, vy: 0, air: false, rot: 0, out: false, gl: null,
        hx: cellX(s.pos), rec: false,                                               // v2 無格線：站定位置、這趟已經回場過
        face: i === 0 ? 1 : -1, anim: { state: "idle", t: 0 }, fin: 0,
      };
    });
    this.go(setup.phase ?? PH.RPS, setup.round ?? null, true);
  }
  emit(type, data = {}) { this.out.push({ type, ...data }); }
  // ---- 速度等級：0（開局）～ maxLevel（最快）；各階段時間在開局值與 fast 值之間線性內插 ----
  levelFor(rounds) { const S = CONFIG.speed; return this.speedUp ? Math.min(S.maxLevel, Math.floor(rounds / S.roundsPerLevel)) : 0; }
  sp(base, fast) { return base + (fast - base) * (this.speedLv / CONFIG.speed.maxLevel); }
  other(f) { return this.f[1 - f.i]; }
  // ---- v2.0 實驗（CONFIG.V2_EXPERIMENTS；只有訓練場會打開，全關時以下都不會改變任何行為）----
  xp(k) { return !!CONFIG.V2_EXPERIMENTS?.[k]; }
  free() { return this.xp("freeStage"); }
  homeX(f) { return this.free() ? f.hx : cellX(f.pos); }                                // 角色「站定」的位置
  dirOf(from, to) { return (this.free() ? Math.sign(to.x - from.x) : Math.sign(to.pos - from.pos)) || 0; }
  // 擊飛初速：v4 線性；v2 前緩後陡 V = BASE × (1 + (d/100)^exp × mul)
  launchV(dmg, mult = 1) {
    if (this.free()) { const V = CONFIG.V2; return V.BASE_KNOCKBACK * (1 + Math.pow(Math.max(0, dmg) / 100, V.kbExp) * V.kbMul) * mult; }
    const R = CONFIG.resolve; return R.vBase * (1 + dmg / R.damageDiv) * mult;
  }
  setAnim(f, st) { if (f.anim.state !== st) f.anim = { state: st, t: 0 }; }
  // 這位玩家這一輪猜拳能出的手勢（扣掉過熱那招）
  allowed(f) { return GESTURES.filter(g => !(CONFIG.overheat.enabled && g === f.heat)); }
  setGauge(n) { n = clamp(n, 0, CONFIG.CLASH_TRIGGER_TIES); if (n !== this.gauge) { this.gauge = n; this.emit("gauge", { gauge: n, full: n >= CONFIG.CLASH_TRIGGER_TIES }); } }
  newRound(att, g) { return { att, def: 1 - att, winGesture: g, winKey: KEY_OF[g], n: 0, hits: 0, gesture: null, result: null, done: false }; }
  // 連勝：每次變動都廣播（雙方 HUD 的 0/3 燈號）
  setStreak(i, n, why) { n = clamp(n, 0, CONFIG.STREAK_TARGET); if (this.f[i].streak !== n) { this.f[i].streak = n; this.emit("streak", { p: i, streak: this.f.map(f => f.streak), why }); } }
  clearHeat() { if (this.f.some(f => f.heat)) { for (const f of this.f) f.heat = null; this.emit("heat", { heat: [null, null] }); } }

  // ---------------- 輸入 ----------------
  input(seat, type, btn) { if ((seat === 0 || seat === 1) && (btn === "L" || btn === "M" || btn === "R")) this.inbox.push({ p: seat, type, btn }); }
  held(p, btn) { const k = this.keys[p][btn]; return k.down && !k.stale; }

  // ---------------- 階段切換 ----------------
  go(ph, data = null, force = false) {
    if (this.flow && !force) {
      const r = this.flow(this.phase, ph, this);
      if (r?.reset) { this.reset(r.reset); return; }
      if (r?.phase) { ph = r.phase; data = r.data ?? data; }
    }
    this.phase = ph; this.t = 0;
    for (const p of [0, 1]) for (const b of ["L", "M", "R"]) if (this.keys[p][b].down) this.keys[p][b].stale = true;   // 放開再按
    this.inbox = this.inbox.filter(e => e.type === "up");                                                              // 上一階段沒處理的按下全部作廢
    const C = CONFIG, [a, b] = this.f;
    if (ph === PH.RPS) {
      const lv = this.levelFor(this.rounds);
      if (lv > this.speedLv) { this.speedLv = lv; this.emit("speed_up", { lv }); }
      this.reveal = this.sp(C.rps.reveal, C.speed.fast.rpsReveal);
      this.dur = this.reveal + this.sp(C.rps.dur - C.rps.reveal, C.speed.fast.rpsHidden);
      if (this.xp("fastRps")) { this.reveal = 0; this.dur = C.V2.rpsDur; }                // v2 快節奏：一開始就藏招、按下即鎖定
      this.lockAt = null;
      if (this.free()) this.engage();
      for (const f of this.f) { f.stance = null; f.picked = false; f.fin = 0; if (!f.gl && !f.air) this.setAnim(f, "idle"); }
      this.hidSent = false;
    } else if (ph === PH.REVEAL) {
      this.dur = this.xp("fastRps") ? C.V2.revealDur : C.reveal.dur;
      for (const f of this.f) this.setAnim(f, "stance_" + f.stance);
      this.emit("rps_result", this.lastRps);
    } else if (ph === PH.CLASH) {                                          // 小拼刀「叮！」（蓄力還沒滿）／大拼刀平分（白色衝擊波）：短暫彈開
      this.dur = C.clash.dur;
      const wave = !!this.cm?.revealed && this.cm.winner < 0;
      for (const f of this.f) this.setAnim(f, wave ? "clash_draw" : "clash");
      this.emit("clash", { x: (a.x + b.x) / 2, gauge: this.gauge, wave });
      this.emit("hitstop", { ev: "clash" });
    } else if (ph === PH.CLASH_INPUT) {
      this.dur = C.clashMode.inputDur;
      this.cm = { seq: [[], []], first: -1, done: [false, false], score: [0, 0], cut: 0, cuts: [], winner: -1, revealed: false, stage: "input", result: null, hitAt: 0, zoom: 1 };
      for (const f of this.f) { f.stance = null; this.setAnim(f, "idle"); }
      this.emit("clash_start", { gauge: this.gauge, n: C.CLASH_SEQUENCE_LENGTH });
    } else if (ph === PH.CLASH_ANIM) {
      const M = C.clashMode, cm = this.cm;
      cm.revealed = true; cm.stage = "cuts";
      let t = M.dashDur; cm.cutAt = M.cuts.map(c => (t += c.gap));                 // 由慢到快：0.80 / 1.20 / 1.48 / 1.68 / 1.82
      cm.resAt = t + M.cuts[M.cuts.length - 1].hitstop / 1000 + M.resolvePause;    // 第 5 刀頓幀後停一下才宣布
      this.dur = cm.resAt;
      this.emit("clash_lock", { seq: cm.seq.map(s => s.slice()), first: cm.first });
      this.emit("clash_dash", { zoom: M.dashZoom, dur: M.dashDur });
      for (const f of this.f) this.setAnim(f, "clash_dash");
    } else if (ph === PH.STRIKE) {                                         // 連勝 1、2：單發紮實重擊
      this.dur = this.xp("fastRps") ? C.V2.strikeDur : C.strike.dur;
      if (data) this.round = this.newRound(data.att, data.winGesture ?? "rock");
      const r = this.round, att = this.f[r.att];
      r.struck = false; att.stance = r.winGesture; att.fin = 0;
      this.setAnim(att, "finisher_blue"); this.setAnim(this.f[r.def], "idle");
    } else if (ph === PH.BURST) {                                          // 連勝 3：連勝爆發 → 四套拳
      this.dur = C.combo.burstDur;
      if (data) this.round = this.newRound(data.att, data.winGesture ?? "rock");
      const r = this.round; r.n = 0;
      this.setAnim(this.f[r.att], "stance_" + r.winGesture);
      this.emit("combo_start", { att: r.att, def: r.def, hits: C.combo.hits });
    } else if (ph === PH.COMBO_PREP) {                                     // 攻方選這一拳（守方看不到）
      if (data) { this.round = this.newRound(data.att, data.winGesture ?? "rock"); this.round.n = data.n ?? 0; }
      const r = this.round, att = this.f[r.att];
      r.n += 1; r.gesture = null; r.random = false; r.done = false; r.result = null;
      this.dur = this.sp(C.combo.prepDur, C.speed.fast.comboPrep);
      att.fin = 0; this.setAnim(att, "idle"); this.setAnim(this.f[r.def], "idle");
      this.emit("combo_prep", { n: r.n, att: r.att, def: r.def });
    } else if (ph === PH.COMBO_CUE) {                                      // 拳種亮出：守方反擊窗（只認第一下）
      this.dur = this.xp("comboV2") ? C.V2.comboReact : this.sp(C.combo.reactDur, C.speed.fast.comboReact);
      const r = this.round, att = this.f[r.att];
      if (!r.gesture) { r.gesture = GESTURES[Math.floor(this.rng() * 3)]; r.random = true; }   // 攻方沒選：系統隨機
      att.stance = r.gesture; att.fin = 0; r.cueAt = this.rt; r.done = false;
      this.setAnim(att, "finisher_blue"); this.setAnim(this.f[r.def], "idle");
      this.emit("combo_cue", { n: r.n, att: r.att, def: r.def, gesture: r.gesture, counter: COUNTER[r.gesture], random: r.random });
    } else if (ph === PH.COMBO_HIT) {
      this.dur = C.combo.impactDur;
    } else if (ph === PH.RESOLVE) {
      this.dur = C.resolve.minDur;
    } else if (ph === PH.GAMEOVER) {
      this.dur = 0;
      this.emit("gameover", { winner: this.winner });
    } else this.dur = 0;
    this.emit("phase", { phase: ph });
  }

  // ---------------- 主更新 ----------------
  step(dt) {
    this.rt += dt; this.t += dt;
    // 1. 吃進輸入：只認新的按下（重複的 down 不算）；放開會清掉 stale
    const evs = [];
    for (const e of this.inbox.splice(0)) {
      const k = this.keys[e.p][e.btn];
      if (e.type === "down") { if (k.down) continue; k.down = true; k.stale = false; k.at = this.rt; evs.push(e); }
      else if (e.type === "up") { if (!k.down) continue; k.down = false; k.stale = false; evs.push(e); }
    }
    // 2. 角色計時與位置
    for (const f of this.f) {
      f.anim.t += dt;
      if (f.deny > 0) f.deny = Math.max(0, f.deny - dt);
      this.updateGlide(f, dt);
    }
    if (this.free()) { for (const f of this.f) this.physics(f, dt); this.separate(); }
    for (const f of this.f) { const o = this.other(f); if (!f.air && !f.out && !f.gl) f.face = Math.sign(o.x - f.x) || f.face; }
    // 3. 階段邏輯（換階段後同一步剩下的按鍵不再處理）
    const ph = this.phase, fn = this["upd_" + ph];
    if (fn) fn.call(this, dt, evs, ph);
    return this.out.splice(0);
  }

  // ---------------- PHASE_RPS（猜拳對峙：過熱那招不能選） ----------------
  [`upd_${PH.RPS}`](dt, evs, ph) {
    const hidden = this.t >= this.reveal;
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down") continue;
      const f = this.f[e.p], g = GESTURE_OF[e.btn];
      if (this.xp("fastRps") && f.picked) continue;                                    // v2：按下即鎖定、不能反悔
      if (!this.allowed(f).includes(g)) { f.deny = 0.3; this.emit("deny", { p: f.i, why: "heat", btn: e.btn }); continue; }   // ♨️ 過熱：鎖住
      f.stance = g; f.picked = true;
      this.emit("stance", { p: f.i, gesture: f.stance, private: hidden ? f.i : undefined });       // 藏招時只有自己知道
      if (this.xp("fastRps")) this.emit("lock", { p: f.i, fast: true });
    }
    if (hidden && !this.hidSent) { this.hidSent = true; this.emit("hide"); }
    const fast = this.xp("fastRps");
    for (const f of this.f) if ((!f.gl || fast) && !f.air) this.setAnim(f, fast ? (f.picked ? "stance_" + f.stance : "idle") : hidden ? "stance_hidden" : f.stance ? "stance_" + f.stance : "idle");   // v2：鎖定當幀就擺出前搖（對手畫面由 viewFor 遮成黑影）
    if (fast && this.lockAt === null && this.f.every(f => f.picked)) this.lockAt = this.t;     // 雙方都鎖定：不等倒數，立刻開牌
    if (this.t >= this.dur || (this.lockAt !== null && this.t >= this.lockAt + CONFIG.V2.lockRevealDelay)) {
      for (const f of this.f) {                                           // 逾時沒出：從沒過熱的招裡隨機
        if (!f.stance) { const opts = this.allowed(f); f.stance = opts[Math.floor(this.rng() * opts.length)]; f.random = true; } else f.random = false;
      }
      const [a, b] = this.f;
      const w = duel(a.stance, b.stance);
      this.lastRps = { stances: [a.stance, b.stance], random: [a.random, b.random], winner: w, heat: [a.heat, b.heat] };
      this.rounds++;
      this.go(PH.REVEAL);
    }
  }

  // ---------------- PHASE_REVEAL（開牌停頓：看清楚誰壓制誰） ----------------
  [`upd_${PH.REVEAL}`]() {
    if (this.t < this.dur) return;
    const L = this.lastRps, w = L.winner;
    if (w < 0) {                                                          // 平手：拼刀蓄力 +1（整場累積），集滿才進五連斬
      this.cm = null;
      this.setGauge(this.gauge + 1);
      this.go(this.gauge >= CONFIG.CLASH_TRIGGER_TIES ? PH.CLASH_INPUT : PH.CLASH); return;
    }
    if (CONFIG.overheat.enabled) {                                        // 分出勝負：雙方剛出的那招過熱，下一輪猜拳不能選
      this.f.forEach((f, i) => { f.heat = L.stances[i]; });
      this.emit("heat", { heat: L.stances.slice() });
    }
    this.setStreak(1 - w, 0, "broken");                                    // 輸一輪：連勝歸零（換對方從 1/3 算）
    this.setStreak(w, this.f[w].streak + 1, "win");
    this.round = this.newRound(w, this.f[w].stance);
    this.go(this.f[w].streak >= CONFIG.STREAK_TARGET ? PH.BURST : PH.STRIKE);
  }

  // ---------------- 小拼刀（蓄力未滿）／大拼刀平分：彈開、不回氣、直接下一輪猜拳 ----------------
  [`upd_${PH.CLASH}`]() {
    const [a, b] = this.f, k = clamp(this.t / this.dur, 0, 1);
    const ha = this.homeX(a), hb = this.homeX(b), d = Math.sign(hb - ha) || 1;
    a.x = ha - d * Math.sin(Math.PI * k) * 6; b.x = hb + d * Math.sin(Math.PI * k) * 6;
    if (this.t >= this.dur) { a.x = ha; b.x = hb; this.go(PH.RPS); }
  }

  // ---------------- PHASE_CLASH_INPUT（五連斬預輸入：先填滿的拿 ⚡ 先手；過熱不限制） ----------------
  [`upd_${PH.CLASH_INPUT}`](dt, evs, ph) {
    const cm = this.cm, N = CONFIG.CLASH_SEQUENCE_LENGTH, finished = [];
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down") continue;
      const s = cm.seq[e.p];
      if (s.length >= N) continue;
      s.push(GESTURE_OF[e.btn]);
      this.emit("clash_input", { p: e.p, n: s.length });                                  // 公開：只有「填了幾格」
      this.emit("clash_pick", { p: e.p, n: s.length, gesture: s[s.length - 1], private: e.p });   // 自己看得到填了什麼
      if (s.length === N && !cm.done[e.p]) { cm.done[e.p] = true; finished.push(e.p); }
    }
    if (cm.first < 0 && finished.length === 1 && !cm.done[1 - finished[0]]) {          // 同一步一起填完＝沒有先手
      cm.first = finished[0];
      this.setAnim(this.f[cm.first], "clash_first_draw");                              // 先手拔刀架勢
      this.emit("clash_first", { p: cm.first });
    }
    if ((cm.done[0] && cm.done[1]) || this.t >= this.dur) {
      for (const [i, s] of cm.seq.entries()) { while (s.length < N) s.push(GESTURES[Math.floor(this.rng() * 3)]); cm.done[i] = true; }   // 沒填滿：系統隨機補
      this.go(PH.CLASH_ANIM);
    }
  }

  // ---------------- PHASE_CLASH_ANIM（衝刺交會 → 由慢到快五刀 → 宣布勝負 → 主招大招） ----------------
  [`upd_${PH.CLASH_ANIM}`]() {
    const cm = this.cm, M = CONFIG.clashMode, [a, b] = this.f, mid = (this.homeX(a) + this.homeX(b)) / 2;
    const dir = Math.sign(this.homeX(b) - this.homeX(a)) || 1;
    if (cm.stage === "cuts") {
      const rush = 1 - Math.pow(1 - clamp(this.t / M.dashDur, 0, 1), 2);            // 0.25s 衝到中央交會
      a.x = lerp(this.homeX(a), mid - dir * M.rush, rush); b.x = lerp(this.homeX(b), mid + dir * M.rush, rush);
      cm.zoom = lerp(1, M.dashZoom, rush);
      while (cm.cut < cm.cutAt.length && this.t >= cm.cutAt[cm.cut]) {
        const k = cm.cut, c = M.cuts[k], g = [cm.seq[0][k], cm.seq[1][k]], w = duel(g[0], g[1]);
        if (w >= 0) cm.score[w]++;
        cm.cuts.push(w); cm.cut++; cm.zoom = c.zoom;
        this.f.forEach((f, i) => { f.stance = g[i]; f.anim = { state: w === 1 - i ? "clash_recoil" : "clash_" + g[i], t: 0, alt: k % 2 }; });
        this.emit("clash_cut", { n: k + 1, gestures: g, winner: w, score: cm.score.slice(), x: mid, hitstop: c.hitstop, pitch: c.pitch, zoom: c.zoom, impact: c.impactFrames ?? 0, last: k === M.cuts.length - 1 });
        this.emit("hitstop", { ev: "clash", ms: c.hitstop, shake: w < 0 ? 1 : 2 + (k >= 3 ? 1 : 0) });
      }
      if (this.t < cm.resAt) return;
      this.clashResult();
      return;
    }
    // ---- 勝方主招大招 ----
    const R = cm.result, win = this.f[R.winner], lose = this.f[1 - R.winner], F = M.finisher[R.main];
    const away = this.dirOf(win, lose) || (lose.i === 0 ? -1 : 1);
    const t0 = cm.fxAt, k = clamp((this.t - t0) / F.windup, 0, 1);
    if (cm.stage === "fin") {
      if (this.t >= t0) {
        const sx = cm.winFrom, tx = lose.x - away * 10;
        if (R.main === "rock") {                                          // 崩山重砸：跳起、從正上方砸下
          win.x = lerp(sx, tx, k); win.y = CONFIG.floorY - Math.sin(Math.PI * Math.min(1, k * 1.05)) * 46;
        } else if (R.main === "scissors") {                               // 居合十字斬：0.12s 青光穿身、停在背後收刀
          const kd = clamp((this.t - t0) / F.dash, 0, 1);
          win.x = lerp(sx, lose.x + away * 22, 1 - Math.pow(1 - kd, 3));
          if (kd >= 1 && !cm.passed) { cm.passed = true; win.face = -away; this.emit("clash_pass", { p: win.i, x: win.x }); }
        } else {                                                          // 零距離氣功：貼身蓄氣
          win.x = lerp(sx, tx, 1 - Math.pow(1 - clamp(k / 0.6, 0, 1), 2));
        }
      }
      if (this.t < cm.hitAt) return;
      // 命中：+24%（先手 +6%）＋高倍率擊飛
      cm.stage = "hit";
      win.y = CONFIG.floorY;
      const dmg = M.winDamage + (cm.first === R.winner ? M.firstBonus : 0), RS = CONFIG.resolve;
      lose.damage += dmg;
      const v = this.launchV(lose.damage, M.launch.mult), ang = M.launch.angle * Math.PI / 180;   // 三種大招擊飛完全相同
      lose.vx = Math.cos(ang) * v * away; lose.vy = -Math.sin(ang) * v; lose.air = true; lose.rot = 0;
      this.setAnim(lose, "knockback"); win.fin = 1;
      this.round = { att: R.winner, def: 1 - R.winner, type: "clash", result: "clash", gesture: R.main, winGesture: R.main, main: R.main };
      this.emit("clash_finisher", { winner: R.winner, main: R.main, name: F.name, damage: dmg, first: cm.first === R.winner, x: lose.x, y: lose.y, wx: win.x, toward: away });
      this.emit("hit", { p: lose.i, kind: "clash", damage: dmg, x: lose.x, toward: away, main: R.main });
      this.emit("hitstop", { ev: "finisher_red", ms: F.hitstopMs, shake: F.shakePx, shakeMs: F.shakeMs, vertical: R.main === "rock" });   // 頓幀／震動照美術規格
      this.emit("clash_end", { winner: R.winner, score: cm.score.slice(), first: cm.first, damage: dmg, main: R.main, tiebreak: R.tiebreak });
      this.glide(win, 0.32, 4, 0.2); win.face = away;                     // 收招、滑回自己的格子
      this.go(PH.RESOLVE);
    }
  }
  // 宣布拼刀勝負：比分高者勝；同分看 ⚡ 先手；都沒有 → 白色衝擊波彈開
  clashResult() {
    const cm = this.cm, M = CONFIG.clashMode, [a, b] = this.f;
    const w = cm.score[0] !== cm.score[1] ? (cm.score[0] > cm.score[1] ? 0 : 1) : cm.first;
    const tiebreak = cm.score[0] === cm.score[1] && w >= 0;
    cm.winner = w;
    this.clearHeat();                                                     // 拼刀結算：過熱全部清除、蓄力歸零
    this.setGauge(0);
    if (w < 0) {
      a.x = this.homeX(a); b.x = this.homeX(b); cm.zoom = 1;
      this.emit("clash_end", { winner: -1, score: cm.score.slice(), first: cm.first, draw: true });
      this.go(PH.CLASH);
      return;
    }
    const main = this.mainGesture(w);
    cm.result = { winner: w, main, tiebreak, score: cm.score.slice() };
    cm.stage = "fin"; cm.fxAt = this.t + (tiebreak ? M.tiebreakSlow : 0);
    cm.hitAt = cm.fxAt + M.finisher[main].windup; this.dur = cm.hitAt + 1;
    cm.winFrom = this.f[w].x;
    this.setAnim(this.f[w], "clash_win_" + main); this.setAnim(this.f[1 - w], "clash_recoil");
    this.f[w].stance = main;
    this.emit("clash_result", { winner: w, main, tiebreak, score: cm.score.slice(), first: cm.first, name: M.finisher[main].name });
  }
  // 主招：勝方「贏最多刀」的手勢；次數相同 → 勝方最後一次贏的那刀；一刀都沒贏（靠先手）→ 最後一格
  mainGesture(w) {
    const cm = this.cm, cnt = { rock: 0, scissors: 0, paper: 0 };
    cm.cuts.forEach((r, k) => { if (r === w) cnt[cm.seq[w][k]]++; });
    const top = Math.max(...Object.values(cnt));
    if (top === 0) return cm.seq[w][cm.seq[w].length - 1];
    const best = GESTURES.filter(g => cnt[g] === top);
    for (let k = cm.cuts.length - 1; k >= 0; k--) if (cm.cuts[k] === w && best.includes(cm.seq[w][k])) return cm.seq[w][k];
    return best[0];
  }

  // ---------------- PHASE_STRIKE（連勝 1、2：單發重擊 → 下一輪猜拳） ----------------
  [`upd_${PH.STRIKE}`]() {
    const r = this.round, att = this.f[r.att], def = this.f[r.def], S = CONFIG.strike;
    if (!r.struck && this.t >= (this.xp("fastRps") ? CONFIG.V2.strikeHitAt : S.hitAt)) {
      r.struck = true; att.fin = 1;
      const dmg = this.xp("heavyHits") ? CONFIG.V2.strikeDamage : S.damage;
      def.damage += dmg;
      const away = this.push(att, def, S.push);
      def.anim = { state: "hitstun", t: 0 };
      this.emit("hit", { p: def.i, kind: "strike", damage: dmg, x: def.x, toward: away, streak: att.streak });
      this.emit("hitstop", { ev: "combo_2", ms: S.hitstopMs, shake: 2 });
    }
    if (this.t >= this.dur && !def.gl && !this.moving(def)) this.endRound();
  }
  // 把守方往崖邊推 cells 格（撞崖邊就停、不會跟攻方重疊）；回傳推的方向
  push(att, def, cells) {
    if (this.free()) {                                                       // v2：沒有格子，受擊方依損傷往後滑、靠摩擦煞停（滑出地板就掉下去→回場）
      const away = this.dirOf(att, def) || 1;
      def.vx = away * this.launchV(def.damage) * CONFIG.V2.strikeSlide;
      return away;
    }
    const away = Math.sign(def.pos - att.pos) || 1;
    for (let k = 0; k < cells; k++) { const to = def.pos + away; if (to >= 1 && to <= CONFIG.cells && to !== att.pos) def.pos = to; }
    this.glide(def, 0.12, 2, 0);
    return away;
  }

  // ---------------- PHASE_BURST（「🔥 連勝爆發！四連擊開始！」） ----------------
  [`upd_${PH.BURST}`]() { if (this.t >= this.dur) this.go(PH.COMBO_PREP); }

  // ---------------- PHASE_COMBO_PREP（攻方選這一拳：最後按的那顆算；守方看不到） ----------------
  [`upd_${PH.COMBO_PREP}`](dt, evs, ph) {
    const r = this.round;
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down" || e.p !== r.att) continue;
      r.gesture = GESTURE_OF[e.btn];
      this.emit("combo_pick", { p: r.att, n: r.n, gesture: r.gesture, private: r.att });
    }
    if (this.t >= this.dur) this.go(PH.COMBO_CUE);
  }

  // ---------------- PHASE_COMBO_CUE（守方反擊窗：按剋制手勢＝反擊成功；按錯或逾時＝吃拳） ----------------
  [`upd_${PH.COMBO_CUE}`](dt, evs, ph) {
    const r = this.round;
    if (!r.done) for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down" || e.p !== r.def) continue;                       // 只有守方、只認第一次按鍵
      r.done = true;
      if (e.btn === KEY_OF[COUNTER[r.gesture]]) this.comboCounter();
      else { this.emit("wrong", { p: r.def, btn: e.btn, n: r.n }); this.comboHit(); }
      return;
    }
    if (!r.done && this.t >= this.dur + this.windowGrace) { r.done = true; this.emit("timeout", { p: r.def, n: r.n }); this.comboHit(); }
  }
  // 吃拳：第 1～3 拳加傷＋推擠 → 下一拳；第 4 拳加傷＋強力擊飛 → 結算
  comboHit() {
    const r = this.round, att = this.f[r.att], def = this.f[r.def], C = CONFIG.combo;
    const n = r.n, dmg = C.hitDamage[n - 1] ?? C.hitDamage[C.hitDamage.length - 1];
    r.result = "hit"; r.hits = n; att.fin = 1;
    def.damage += dmg;
    if (n >= C.hits) {
      const R = CONFIG.resolve, away = this.dirOf(att, def) || 1;
      const v = this.launchV(def.damage, C.finalLaunch), a = R.angleDeg * Math.PI / 180;
      def.vx = Math.cos(a) * v * away; def.vy = -Math.sin(a) * v; def.air = true; def.rot = 0;
      this.setAnim(att, "finisher_red"); att.fin = 1; this.setAnim(def, "knockback");
      this.emit("hit", { p: def.i, kind: "combo", n, damage: dmg, final: true, v, x: def.x, toward: away });
      this.emit("hitstop", { ev: "finisher_red" });
      this.endCombo("full");
      this.go(PH.RESOLVE);
      return;
    }
    const away = this.free() ? this.dirOf(att, def) || 1 : this.push(att, def, C.push);   // v2：前 3 拳原地重擊
    att.anim = { state: "mash_hit", t: 0, alt: n % 2 }; def.anim = { state: "hitstun", t: 0 };
    this.emit("hit", { p: def.i, kind: "combo", n, damage: dmg, x: def.x, toward: away });
    this.emit("hitstop", { ev: n === 1 ? "combo_1" : "combo_2" });
    this.go(PH.COMBO_HIT);
  }
  // 反擊成功：中斷剩下的拳，雙方換位、守方反打一拳、擊退 1 格
  comboCounter() {
    const r = this.round, att = this.f[r.att], def = this.f[r.def], C = CONFIG.combo;
    r.result = "counter";
    const delay = C.counterHitstopMs / 1000;                                 // 頓幀完才演跨身換位
    this.emit("counter", { p: def.i, att: att.i, n: r.n, gesture: r.gesture, x: (att.x + def.x) / 2 });
    this.emit("hitstop", { ev: "parry_success", ms: C.counterHitstopMs });
    let away;
    if (this.free()) {                                                       // v2：連續座標換位，攻方被擊退 counterKnock 格寬
      [att.hx, def.hx] = [def.x, att.x];
      away = Math.sign(att.hx - def.hx) || 1;
      att.hx = clamp(att.hx + away * C.counterKnock * CONFIG.cellW, CONFIG.stageX + 10, CONFIG.stageX + CONFIG.cells * CONFIG.cellW - 10);
      this.setAnim(def, "parry_success"); att.damage += C.counterDamage;
    } else {
    [att.pos, def.pos] = [def.pos, att.pos];
    this.setAnim(def, "parry_success");
    att.damage += C.counterDamage;
    away = Math.sign(att.pos - def.pos) || 1; const to = clamp(att.pos + away * C.counterKnock, 1, CONFIG.cells);
    if (to !== def.pos) att.pos = to;
    }
    this.glide(def, 0.18, 8, delay); this.glide(att, 0.24, 6, delay);
    this.setAnim(att, "knockback");
    this.emit("hit", { p: att.i, kind: "counter", damage: C.counterDamage, x: this.homeX(att), toward: away });
    this.endCombo("countered");
    this.go(PH.RESOLVE);
  }
  endCombo(how) { const r = this.round; this.emit("combo_end", { att: r.att, def: r.def, hits: r.hits, how }); this.setStreak(r.att, 0, "spent"); }

  // ---------------- PHASE_COMBO_HIT（吃拳後短停 → 下一拳） ----------------
  [`upd_${PH.COMBO_HIT}`]() { if (this.t >= this.dur && !this.f[this.round.def].gl && !this.moving(this.f[this.round.def])) this.go(PH.COMBO_PREP); }

  // ---------------- PHASE_RESOLVE ----------------
  [`upd_${PH.RESOLVE}`](dt) {
    const R = CONFIG.resolve;
    if (!this.free()) for (const f of this.f) {                               // v2 的空中物理在 physics()
      if (f.out || !f.air) continue;
      f.vy += R.gravity * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vx * dt * 0.05;
      const left = CONFIG.stageX, right = CONFIG.stageX + CONFIG.cells * CONFIG.cellW;
      if (f.y >= CONFIG.floorY && f.vy > 0 && f.x >= left && f.x < right) {        // 落在台上：對齊最近的格子
        f.y = CONFIG.floorY; f.air = false; f.rot = 0;
        this.land(f);
      } else if (f.x < -R.koMargin || f.x > CONFIG.W + R.koMargin || f.y > CONFIG.H + 40) this.ko(f);
    }
    if (this.koTimer !== null) { this.koTimer -= dt; if (this.koTimer > 0) return; this.koTimer = null; if (this.afterKO()) return; }
    if (this.t >= this.dur && this.f.every(f => !f.air && !f.gl && !this.moving(f))) this.endRound();
  }
  land(f) {
        if (this.free()) {                                                     // v2：落在哪就停在哪（不吸附格子），太貼對手就錯開
          const o = this.other(f), V = CONFIG.V2;
          if (!o.out && Math.abs(f.x - o.x) < V.minGap) { const d = Math.sign(f.x - o.x) || (f.i ? 1 : -1); f.x = clamp(o.x + d * V.minGap, CONFIG.stageX + 6, CONFIG.stageX + CONFIG.cells * CONFIG.cellW - 6); }
          f.hx = f.x; f.vx = 0; f.rec = false; this.setAnim(f, "idle");
          this.emit("land", { p: f.i, pos: f.pos, x: f.x, free: true });
          return;
        }
        let c = clamp(Math.floor((f.x - CONFIG.stageX) / CONFIG.cellW) + 1, 1, CONFIG.cells);
        const o = this.other(f);
        if (c === o.pos) { const d = Math.sign(f.vx) || 1; c = (c + d >= 1 && c + d <= CONFIG.cells) ? c + d : c - d; }
        f.pos = c; this.glide(f, 0.15, 0, 0);
        this.setAnim(f, "idle");
        this.emit("land", { p: f.i, pos: c, x: f.x });
  }
  ko(f) {
    f.out = true; f.air = false; f.stocks -= 1;
    const K = { left: 16, right: 464 };
    const x = f.x < 0 ? K.left : f.x > CONFIG.W ? K.right : clamp(f.x, K.left, K.right);
    this.koTimer = CONFIG.resolve.koPause;
    this.emit("ko", { p: f.i, x: Math.round(x), stocks: f.stocks });
  }
  afterKO() {
    const dead = this.f.find(f => f.stocks <= 0);
    if (dead) { this.winner = 1 - dead.i; this.go(PH.GAMEOVER); return true; }
    for (const f of this.f) {                                                  // 掉命：重置中央站位，被擊落的一方損傷歸零
      if (f.out) { f.damage = 0; f.out = false; }
      f.pos = CONFIG.spawn[f.i]; f.x = cellX(f.pos); f.y = CONFIG.floorY; f.air = false; f.vx = f.vy = 0; f.rot = 0; f.gl = null; f.hx = f.x; f.rec = false;
      this.setAnim(f, "idle");
    }
    this.setGauge(0);                                                          // 落台重生：拼刀蓄力、雙方連勝歸零，過熱全部清除
    this.setStreak(0, 0, "respawn"); this.setStreak(1, 0, "respawn");
    this.clearHeat();
    this.emit("respawn");
    return false;
  }
  endRound() {
    this.emit("round_end");
    this.go(PH.RPS);
  }

  // 畫面位置滑到邏輯格子（delay：等頓幀結束才開始動）
  glide(f, dur, arc, delay) { f.gl = { from: f.x, to: this.homeX(f), t: -delay, dur, arc }; }

  // ---------------- v2 無格線擂台：連續座標物理 ----------------
  moving(f) { return this.free() && (f.air || Math.abs(f.vx) > 0); }
  onStage(x) { return x >= CONFIG.stageX && x <= CONFIG.stageX + CONFIG.cells * CONFIG.cellW; }
  physics(f, dt) {
    if (f.out || f.gl) return;
    const V = CONFIG.V2, floor = CONFIG.floorY;
    if (f.air) {
      f.vy += V.gravity * dt; f.vx *= Math.exp(-V.airDrag * dt);
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vx * dt * 0.05;
      if (f.x < -V.koMarginX || f.x > CONFIG.W + V.koMarginX || f.y < -V.koMarginTop || f.y > CONFIG.H + V.koMarginBottom) { this.ko(f); if (this.phase !== PH.RESOLVE) this.go(PH.RESOLVE); return; }   // 唯一 KO：飛出畫面四邊
      if (f.vy > 0 && f.y >= floor && this.onStage(f.x) && f.y - f.vy * dt <= floor + 1) { f.y = floor; f.air = false; f.rot = 0; f.vy = 0; this.land(f); return; }
      // 場外回場：已經往下掉、而且水平速度衰減了（或掉到地板以下）→ 受身翻轉＋二段跳回最近的擂台邊
      if (!f.rec && !this.onStage(f.x) && f.vy > 0 && (Math.abs(f.vx) < V.recoverVx || f.y > floor)) {
        const L = CONFIG.stageX + V.recoverInset, R = CONFIG.stageX + CONFIG.cells * CONFIG.cellW - V.recoverInset;
        const tx = f.x < L ? L : R, vy0 = -V.recoverJump, g = V.gravity;
        const disc = vy0 * vy0 - 2 * g * (f.y - floor), T = (-vy0 + Math.sqrt(Math.max(0, disc))) / g;
        f.rec = true; f.vy = vy0; f.vx = (tx - f.x) / Math.max(0.2, T) / Math.max(0.2, Math.exp(-V.airDrag * T / 2));
        this.setAnim(f, "roll");
        this.emit("recover", { p: f.i, x: f.x, y: f.y });
      }
      return;
    }
    if (f.vx) {                                                                   // 地面滑行：摩擦煞停；滑出地板就開始掉
      f.x += f.vx * dt;
      const dv = V.friction * dt;
      f.vx = Math.abs(f.vx) <= dv ? 0 : f.vx - Math.sign(f.vx) * dv;
      if (!this.onStage(f.x)) { f.air = true; f.vy = 0; this.setAnim(f, "knockback"); return; }
      if (!f.vx) { f.hx = f.x; this.emit("slide_stop", { p: f.i, x: f.x }); }
      else if (Math.random() < dt * 20) this.emit("dust", { p: f.i, x: f.x, dir: Math.sign(f.vx) });
    }
    f.pos = clamp(Math.floor((f.x - CONFIG.stageX) / CONFIG.cellW) + 1, 1, CONFIG.cells);   // 相容：HUD／崖邊動作／AI 仍讀格子
  }
  // 兩人都在地上時不能重疊
  separate() {
    const [a, b] = this.f, m = CONFIG.V2.minGap;
    if (a.out || b.out || a.air || b.air || a.gl || b.gl) return;
    const d = b.x - a.x;
    if (Math.abs(d) >= m) return;
    const s = Math.sign(d) || 1, push = (m - Math.abs(d)) / 2;
    a.x -= s * push; b.x += s * push;
    if (!a.vx) a.hx = a.x; if (!b.vx) b.hx = b.x;
  }
  // 回合間自動貼近：保留整體戰線偏左／偏右（中點不動，貼著台邊時往內收）
  engage() {
    const [a, b] = this.f, V = CONFIG.V2;
    if (a.out || b.out || a.air || b.air) return;
    const L = CONFIG.stageX + 12, R = CONFIG.stageX + CONFIG.cells * CONFIG.cellW - 12;
    const dir = Math.sign(b.x - a.x) || 1, want = V.engageGap;
    if (Math.abs(Math.abs(b.x - a.x) - want) < 3) return;
    const mid = clamp((a.x + b.x) / 2, L + want / 2, R - want / 2);
    a.hx = mid - dir * want / 2; b.hx = mid + dir * want / 2;
    this.glide(a, V.engageDur, 0, 0); this.glide(b, V.engageDur, 0, 0);
    this.emit("engage", { x: mid });
  }
  updateGlide(f, dt) {
    const g = f.gl;
    if (!g) return;
    g.t += dt;
    if (g.t < 0) return;
    const k = clamp(g.t / g.dur, 0, 1);
    f.x = lerp(g.from, g.to, 1 - Math.pow(1 - k, 2)); f.y = CONFIG.floorY - Math.sin(Math.PI * k) * g.arc;
    if (k >= 1) {
      f.x = g.to; f.y = CONFIG.floorY; f.gl = null;
      if (f.anim.state === "roll") { this.setAnim(f, "idle"); this.emit("land", { p: f.i, pos: f.pos, x: f.x }); }
      else if (f.anim.state === "knockback" && !f.air) this.setAnim(f, "idle");
    }
  }

  // ---------------- 給畫面、AI、網路的資料 ----------------
  //   seat = 0／1：那位玩家看得到的；seat = -1：同機雙人共用螢幕（兩邊的藏招、拼刀序列都遮）
  viewFor(seat = -1) {
    const r = this.round, hidden = this.phase === PH.RPS && this.t >= this.reveal;
    const showGesture = r && (this.phase !== PH.COMBO_PREP || seat === r.att);   // 四套拳選拳時只有攻方看得到
    const cm = this.cm;
    const inClash = cm && (this.phase === PH.CLASH_INPUT || this.phase === PH.CLASH_ANIM || (this.phase === PH.RESOLVE && r?.type === "clash") || (this.phase === PH.CLASH && cm.revealed && cm.winner < 0));
    return {
      phase: this.phase, t: this.t, dur: this.dur, rt: this.rt, winner: this.winner, seat,
      reveal: this.reveal, speedLv: this.speedLv, rounds: this.rounds, gauge: this.gauge, gaugeMax: CONFIG.CLASH_TRIGGER_TIES, streakTarget: CONFIG.STREAK_TARGET,
      rps: this.phase === PH.REVEAL && this.lastRps ? { stances: this.lastRps.stances.slice(), winner: this.lastRps.winner, random: this.lastRps.random.slice() } : null,
      clash: inClash ? {
        count: cm.seq.map(s => s.length), first: cm.first, done: cm.done.slice(),
        seq: cm.seq.map((s, i) => (cm.revealed || i === seat ? s.slice() : null)),       // 預輸入時只看得到自己的；對砍開始才全公開
        cut: cm.cut, cuts: cm.cuts.slice(), score: cm.score.slice(), winner: this.phase === PH.CLASH_ANIM && !cm.result ? -2 : cm.winner,
        n: CONFIG.CLASH_SEQUENCE_LENGTH, stage: cm.stage, zoom: cm.zoom, result: cm.result ? { ...cm.result } : null,
        hitAt: cm.hitAt ?? 0, fxAt: cm.fxAt ?? 0, cutAt: cm.cutAt ? cm.cutAt.slice() : null,
      } : null,
      fighters: this.f.map(f => ({
        i: f.i, pos: f.pos, x: f.x, y: f.y, rot: f.rot, face: f.face, out: f.out, air: f.air,
        damage: f.damage, stocks: f.stocks, heat: f.heat, deny: f.deny, fin: f.fin, streak: f.streak,
        stance: hidden && seat !== f.i ? "hidden" : f.stance,
        picked: f.picked,
        anim: { state: hidden && seat !== f.i && f.anim.state.startsWith("stance_") ? "stance_hidden" : f.anim.state, t: f.anim.t, alt: f.anim.alt ?? 0 },
      })),
      round: r ? {
        att: r.att, def: r.def, winGesture: r.winGesture, winKey: r.winKey, type: r.type ?? null,
        n: r.n ?? 0, hits: r.hits ?? 0, gesture: showGesture ? r.gesture ?? null : null, random: !!r.random && showGesture,
        counter: showGesture && r.gesture ? COUNTER[r.gesture] : null,
        cueAt: r.cueAt ?? 0, done: !!r.done, result: r.result ?? null,
      } : null,
    };
  }
}
