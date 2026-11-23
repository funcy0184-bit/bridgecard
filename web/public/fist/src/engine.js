// engine.js — 《拳刃交鋒》規則引擎（純邏輯：不碰 DOM、不碰畫面、不碰聲音）
//   · 輸入：engine.input(seat, "down" | "up", btn)，btn = "L" | "M" | "R"（本機鍵盤、AI、線上都送同一種事件）
//   · 時間：engine.step(dt) 回傳這一步發生的事件（畫面、音效、教學都靠事件）
//   · 畫面資料：engine.viewFor(seat) —— 依觀看者遮掉不該看到的東西（藏招、攻方還沒亮出的終結手勢）
//   · 防誤觸都在這裡：
//       1. 放開再按：進入新階段時，還按著的鍵一律標 stale，要放開再按才算；鍵盤自動重複不算新按下
//       2. 判定窗單次鎖死：終結判定窗內守方只認第一次按鍵，按錯立刻吃招
import { CONFIG } from "./config.js";

export const PH = {
  MOVE: "PHASE_MOVE", RPS: "PHASE_RPS", CLASH: "PHASE_CLASH", MASH: "PHASE_MASH",
  SELECT: "PHASE_FINISHER_SELECT", WINDOW: "PHASE_FINISHER_WINDOW", RESOLVE: "PHASE_RESOLVE",
  GAMEOVER: "PHASE_GAMEOVER", IDLE: "PHASE_IDLE",
};
export const PH_LABEL = {
  [PH.MOVE]: "走位", [PH.RPS]: "猜拳對峙", [PH.CLASH]: "拼刀！", [PH.MASH]: "連打加壓", [PH.SELECT]: "終結擇",
  [PH.WINDOW]: "終結判定", [PH.RESOLVE]: "結算", [PH.GAMEOVER]: "比賽結束", [PH.IDLE]: "",
};
export const GESTURE_OF = CONFIG.gestureOf;
export const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };       // 誰贏誰
export const COUNTER = { rock: "paper", scissors: "rock", paper: "scissors" };     // 克制這招的手勢
export const KEY_OF = { rock: "L", scissors: "M", paper: "R" };
export const GLABEL = { rock: "石", scissors: "剪", paper: "布" };
export const cellX = i => CONFIG.stageX + (i - 0.5) * CONFIG.cellW;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// 可重現的亂數（線上、測試用）
export function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const DEFAULT_SETUP = { p: [{ pos: CONFIG.spawn[0], power: CONFIG.powerStart, damage: 0 }, { pos: CONFIG.spawn[1], power: CONFIG.powerStart, damage: 0 }] };

export class Engine {
  /**
   * @param {object} opts
   * @param {() => number} [opts.rng]   亂數（逾時沒出拳時隨機）
   * @param {(from:string,to:string,engine:Engine)=>void|{phase?:string,data?:object,reset?:object}} [opts.flow]
   *        階段切換前的掛鉤（教學用來重來、跳關、停在 IDLE）
   * @param {number} [opts.windowGrace]  終結判定窗的延遲寬容（秒）：線上伺服器設 0.08，畫面倒數仍是 0.5s，伺服器多收這段時間內抵達的按鍵
   */
  constructor(opts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.flow = opts.flow ?? null;
    this.windowGrace = opts.windowGrace ?? 0;
    this.speedUp = opts.speedUp ?? true;                                          // 越打越快（教學關掉）
    this.reset(opts.setup ?? DEFAULT_SETUP);
  }

  // ---------------- 狀態 ----------------
  reset(setup = DEFAULT_SETUP) {
    this.rt = 0; this.t = 0; this.dur = 0; this.phase = PH.IDLE;
    this.round = null; this.winner = -1; this.koTimer = null; this.lastRps = null;
    this.rounds = setup.rounds ?? 0; this.speedLv = this.levelFor(this.rounds); this.reveal = CONFIG.rps.reveal;
    this.inbox = []; this.out = this.out ?? [];                                       // flow 在階段中途 reset：同一幀已發出的事件（例如 mash_end）不能丟
    this.keys = [0, 1].map(() => ({ L: { down: false, stale: false, at: 0 }, M: { down: false, stale: false, at: 0 }, R: { down: false, stale: false, at: 0 } }));
    this.f = [0, 1].map(i => {
      const s = setup.p[i];
      return {
        i, pos: s.pos, power: s.power ?? CONFIG.powerStart, damage: s.damage ?? 0, stocks: s.stocks ?? setup.stocks ?? CONFIG.stocks,
        stun: 0, steps: 0, locked: false, move: null, wobble: 0, deny: 0,
        stance: null, picked: false, random: false,
        x: cellX(s.pos), y: CONFIG.floorY, vx: 0, vy: 0, air: false, rot: 0, out: false, gl: null,
        face: i === 0 ? 1 : -1, anim: { state: "idle", t: 0 }, fin: 0, redGlow: false,
      };
    });
    this.go(setup.phase ?? PH.MOVE, setup.round ?? null, true);
  }
  emit(type, data = {}) { this.out.push({ type, ...data }); }
  // ---- 速度等級：0（開局）～ maxLevel（最快）；各階段時間在開局值與 fast 值之間線性內插 ----
  levelFor(rounds) { const S = CONFIG.speed; return this.speedUp ? Math.min(S.maxLevel, Math.floor(rounds / S.roundsPerLevel)) : 0; }
  sp(base, fast) { return base + (fast - base) * (this.speedLv / CONFIG.speed.maxLevel); }
  other(f) { return this.f[1 - f.i]; }
  setAnim(f, st) { if (f.anim.state !== st) f.anim = { state: st, t: 0 }; }

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
    if (ph === PH.MOVE) {
      const lv = this.levelFor(this.rounds);
      if (lv > this.speedLv) { this.speedLv = lv; this.emit("speed_up", { lv }); }
      this.dur = this.sp(C.move.dur, C.speed.fast.move);
      for (const f of this.f) { f.steps = 0; f.locked = false; f.stance = null; f.redGlow = false; if (!f.move) this.setAnim(f, f.stun > 0 || f.power <= 0 ? "exhausted" : "idle"); }
    } else if (ph === PH.RPS) {
      this.reveal = this.sp(C.rps.reveal, C.speed.fast.rpsReveal);
      this.dur = this.reveal + this.sp(C.rps.dur - C.rps.reveal, C.speed.fast.rpsHidden);
      for (const f of this.f) { f.stance = null; f.picked = false; }
      this.hidSent = false;
    } else if (ph === PH.CLASH) {
      this.dur = C.clash.dur;
      for (const f of this.f) this.setAnim(f, "clash");
      this.emit("clash", { x: (a.x + b.x) / 2 });
      this.emit("hitstop", { ev: "clash" });
    } else if (ph === PH.MASH) {
      this.dur = this.sp(C.mash.dur, C.speed.fast.mash);
      if (data) this.round = { att: data.att, def: 1 - data.att, winGesture: data.winGesture, winKey: KEY_OF[data.winGesture] };
      const r = this.round, att = this.f[r.att];
      Object.assign(r, { hits: 0, extra: 0, presses: 0, gesture: r.winGesture, red: false, charging: false, chargeStart: 0, result: null });
      att.stance = r.winGesture;
      this.setAnim(att, "mash_hit");
    } else if (ph === PH.SELECT) {
      this.dur = this.sp(C.select.dur, C.speed.fast.select);
      const r = this.round;
      r.gesture = r.winGesture; r.red = false; r.charging = false; r.chosen = false;
    } else if (ph === PH.WINDOW) {
      this.dur = this.sp(C.window.dur, C.speed.fast.window);
      if (data) {                                                         // 教學直接從判定窗開始
        this.round = { att: data.att, def: 1 - data.att, winGesture: data.gesture ?? "rock", gesture: data.gesture ?? "rock", red: !!data.red, extra: 0, hits: 0 };
        if (data.red) this.f[data.att].redGlow = true;
      }
      const r = this.round, att = this.f[r.att], def = this.f[r.def];
      r.done = false; r.type = r.red ? "red" : "blue"; r.cueAt = this.rt; r.result = null;
      att.stance = r.gesture; att.fin = 0;                                   // 終結技拿「已公開的出招手勢」那把武器（紅招＝贏拳手勢）
      r.away = Math.sign(def.pos - att.pos) || 1;
      if (r.red) {                                                        // 危險格在提示亮起時鎖定，到收招都不變
        const next = def.pos + r.away;                                    // 規格：相鄰兩格（崖邊時往台內補一格）
        r.zone = next >= 1 && next <= C.cells ? [def.pos, next].sort((x, y) => x - y) : [def.pos - r.away, def.pos].sort((x, y) => x - y);
        r.dirs = [-1, 1].filter(d => { const to = def.pos + d * C.roll.cells; return to >= 1 && to <= C.cells && to !== att.pos; });
        this.setAnim(att, "finisher_red");
      } else { r.zone = []; r.dirs = []; this.setAnim(att, "finisher_blue"); }
      this.setAnim(def, "idle");
      this.emit("cue", { kind: r.type, att: r.att, def: r.def, gesture: r.red ? null : r.gesture, zone: r.zone, dirs: r.dirs });
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
      if (f.stun > 0) { f.stun = Math.max(0, f.stun - dt); if (f.stun === 0) this.emit("stun_end", { p: f.i }); }
      if (f.wobble > 0) f.wobble = Math.max(0, f.wobble - dt);
      if (f.deny > 0) f.deny = Math.max(0, f.deny - dt);
      this.updateMove(f, dt);
      this.updateGlide(f, dt);
    }
    for (const f of this.f) { const o = this.other(f); if (!f.air && !f.out && !f.gl) f.face = Math.sign(o.x - f.x) || f.face; }
    // 3. 階段邏輯（換階段後同一步剩下的按鍵不再處理）
    const ph = this.phase, fn = this["upd_" + ph];
    if (fn) fn.call(this, dt, evs, ph);
    return this.out.splice(0);
  }

  // ---------------- PHASE_MOVE ----------------
  [`upd_${PH.MOVE}`](dt, evs, ph) {
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down") continue;
      const f = this.f[e.p];
      if (e.btn === "M") { if (!f.locked) { f.locked = true; this.emit("lock", { p: f.i }); } continue; }
      this.tryStep(f, e.btn === "L" ? -1 : 1);
    }
    if (this.t >= this.dur) this.go(PH.RPS);
  }
  tryStep(f, dir) {
    const C = CONFIG.move;
    if (f.locked || f.move || f.steps >= C.maxSteps) { f.deny = 0.25; this.emit("deny", { p: f.i, why: f.locked ? "locked" : "steps" }); return; }
    const to = f.pos + dir;
    if (to < 1 || to > CONFIG.cells) { f.wobble = C.wobbleTime; f.wobbleDir = dir; this.emit("wobble", { p: f.i, dir }); return; }   // 崖邊往外：微晃、不扣氣不計步
    if (f.power < 1) { f.deny = 0.4; this.emit("deny", { p: f.i, why: "power" }); return; }
    f.power -= 1; f.steps += 1;
    const o = this.other(f), om = o.move;
    let bump = false;
    if (om && !om.bump && (om.to === to || (om.to === f.pos && to === om.from))) {     // 同時踏進同一格／互相穿過：雙方頂撞彈回
      bump = true;
      o.move = { from: om.from, to: om.to, t: 0, dur: C.bumpTime, bump: true, second: om.second };
    } else if (o.pos === to) bump = true;                                               // 踏進對方站著的格子：彈回
    f.move = { from: f.pos, to, t: 0, dur: bump ? C.bumpTime : C.stepTime, bump, second: f.steps === C.maxSteps };
    this.setAnim(f, "step");
    this.emit("step", { p: f.i, from: f.pos, to, bump, n: f.steps });
  }
  updateMove(f, dt) {
    const m = f.move;
    if (!m) return;
    m.t += dt;
    const k = clamp(m.t / m.dur, 0, 1);
    f.x = m.bump ? lerp(cellX(m.from), cellX(m.to), 0.42 * Math.sin(Math.PI * k)) : lerp(cellX(m.from), cellX(m.to), 1 - Math.pow(1 - k, 2));
    f.y = CONFIG.floorY - Math.sin(Math.PI * k) * (m.bump ? 3 : 5);
    if (k >= 1) {
      if (!m.bump) f.pos = m.to;
      f.x = cellX(f.pos); f.y = CONFIG.floorY; f.move = null;
      if (m.second) { f.stun = CONFIG.move.secondStepStun; this.emit("stun", { p: f.i, sec: f.stun }); }   // 第二步落地起算硬直，跨階段
      if (this.phase === PH.MOVE || this.phase === PH.RPS) this.setAnim(f, f.stun > 0 || f.power <= 0 ? "exhausted" : "idle");
    }
  }

  // ---------------- PHASE_RPS ----------------
  [`upd_${PH.RPS}`](dt, evs, ph) {
    const hidden = this.t >= this.reveal;
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down") continue;
      const f = this.f[e.p];
      if (f.stun > 0) { f.deny = 0.3; this.emit("deny", { p: f.i, why: "stun" }); continue; }   // 硬直：按鍵反灰、不能換招
      f.stance = GESTURE_OF[e.btn]; f.picked = true;
      this.emit("stance", { p: f.i, gesture: f.stance, private: hidden ? f.i : undefined });       // 藏招時只有自己知道
    }
    if (hidden && !this.hidSent) { this.hidSent = true; this.emit("hide"); }
    for (const f of this.f) if (!f.move) this.setAnim(f, hidden ? "stance_hidden" : f.stance ? "stance_" + f.stance : f.stun > 0 ? "exhausted" : "idle");
    if (this.t >= this.dur) {
      for (const f of this.f) if (!f.stance) { f.stance = ["rock", "scissors", "paper"][Math.floor(this.rng() * 3)]; f.random = true; } else f.random = false;
      const [a, b] = this.f;
      for (const f of this.f) this.setAnim(f, "stance_" + f.stance);
      const w = a.stance === b.stance ? -1 : BEATS[a.stance] === b.stance ? 0 : 1;
      this.lastRps = { stances: [a.stance, b.stance], random: [a.random, b.random], winner: w };
      this.rounds++;
      this.emit("rps_result", this.lastRps);
      if (w < 0) { this.go(PH.CLASH); return; }
      this.round = { att: w, def: 1 - w, winGesture: this.f[w].stance, winKey: KEY_OF[this.f[w].stance] };
      this.go(PH.MASH);
    }
  }

  // ---------------- 拼刀（平手：不回力量，直接回走位） ----------------
  [`upd_${PH.CLASH}`]() {
    const [a, b] = this.f, k = clamp(this.t / this.dur, 0, 1);
    a.x = cellX(a.pos) - Math.sin(Math.PI * k) * 6; b.x = cellX(b.pos) + Math.sin(Math.PI * k) * 6;
    if (this.t >= this.dur) { a.x = cellX(a.pos); b.x = cellX(b.pos); this.go(PH.MOVE); }
  }

  // ---------------- PHASE_MASH（連打加壓） ----------------
  [`upd_${PH.MASH}`](dt, evs, ph) {
    const r = this.round, att = this.f[r.att], def = this.f[r.def], C = CONFIG.mash;
    // 保底自動兩拳：各 +baseDamage%、把對手往崖邊推（撞崖邊強制停住）
    while (r.hits < C.baseHits.length && this.t >= C.baseHits[r.hits]) {
      r.hits++;
      def.damage += C.baseDamage;
      const away = Math.sign(def.pos - att.pos) || 1, to = def.pos + away;
      if (to >= 1 && to <= CONFIG.cells) def.pos = to;
      this.glide(def, 0.1, 2, 0);
      this.setAnim(att, "mash_hit"); att.anim.alt = r.hits % 2; this.setAnim(def, "hitstun"); def.anim = { state: "hitstun", t: 0 };
      this.emit("hit", { p: def.i, kind: "base", n: r.hits, damage: C.baseDamage, combo: r.hits + r.extra, x: def.x, toward: away });
      this.emit("hitstop", { ev: r.hits === 1 ? "combo_1" : "combo_2" });
    }
    // 狂按任意三鍵：每 2 下追加 1 拳小連擊 +extraDamage%，上限 4 拳
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down" || e.p !== r.att) continue;
      r.presses++;
      if (r.presses % C.pressesPerExtra === 0 && r.extra < C.maxExtra) {
        r.extra++;
        def.damage += C.extraDamage;
        att.anim = { state: "mash_hit", t: 0, alt: r.extra % 2 }; def.anim = { state: "hitstun", t: 0 };
        this.emit("hit", { p: def.i, kind: "extra", n: r.extra, damage: C.extraDamage, combo: r.hits + r.extra, x: def.x, toward: Math.sign(def.pos - att.pos) || 1 });
        this.emit("hitstop", { ev: "mash_extra", ms: CONFIG.feel.mashExtraHitstopMs, shake: CONFIG.feel.mashShakePx[r.extra] });
      }
    }
    if (this.t >= this.dur) {
      this.emit("mash_end", { p: r.att, extra: r.extra, combo: r.hits + r.extra });
      this.go(PH.SELECT);
    }
  }

  // ---------------- PHASE_FINISHER_SELECT（終結擇） ----------------
  [`upd_${PH.SELECT}`](dt, evs, ph) {
    const r = this.round, att = this.f[r.att], S = CONFIG.select;
    for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.p !== r.att || r.red) continue;
      if (e.type === "down") {
        // 蓄力事件標 private：守方只在紅光成形（red_ready）那一刻才知道
        if (e.btn === r.winKey && att.power >= S.redCost) { r.charging = true; r.chargeStart = this.rt; r.gesture = r.winGesture; this.emit("charge_start", { p: att.i, private: att.i }); }
        else { if (r.charging) this.emit("charge_stop", { p: att.i, private: att.i }); r.charging = false; r.gesture = GESTURE_OF[e.btn]; this.emit("finisher_pick", { p: att.i, gesture: r.gesture, private: att.i }); }
        r.chosen = true;
      } else if (e.type === "up" && r.charging && e.btn === r.winKey) {
        r.charging = false; this.emit("charge_stop", { p: att.i, private: att.i });              // 未滿 0.3s 放開：藍光普通終結、不扣氣
      }
    }
    if (r.charging && this.held(r.att, r.winKey) && this.rt - r.chargeStart >= S.chargeTime) {   // 長按贏拳鍵滿 0.3s：紅光強化
      r.charging = false; r.red = true; att.power -= S.redCost; att.redGlow = true;
      this.emit("red_ready", { p: att.i });
    }
    if (this.t >= this.dur) { if (r.charging) this.emit("charge_stop", { p: att.i, private: att.i }); r.charging = false; this.go(PH.WINDOW); }
  }

  // ---------------- PHASE_FINISHER_WINDOW（接受區間 cueAt ≤ now < deadlineAt） ----------------
  [`upd_${PH.WINDOW}`](dt, evs, ph) {
    const r = this.round;
    if (!r.done) for (const e of evs) {
      if (this.phase !== ph) return;
      if (e.type !== "down" || e.p !== r.def) continue;                       // 只有守方、只認第一次按鍵
      r.done = true;
      if (r.type === "blue") {
        if (e.btn === KEY_OF[COUNTER[r.gesture]]) this.parry(); else { this.emit("wrong", { p: r.def, btn: e.btn }); this.finisherHit(); }
      } else {
        const d = e.btn === "L" ? -1 : e.btn === "R" ? 1 : 0;
        if (d && r.dirs.includes(d)) this.rollOut(d); else { this.emit("wrong", { p: r.def, btn: e.btn }); this.finisherHit(); }
      }
      return;
    }
    if (!r.done && this.t >= this.dur + this.windowGrace) { r.done = true; this.emit("timeout", { p: r.def }); this.finisherHit(); }
  }
  parry() {
    const r = this.round, att = this.f[r.att], def = this.f[r.def];
    r.result = "parry";
    const delay = CONFIG.parry.hitstopMs / 1000;                             // 頓幀完才演跨身換位
    this.emit("parry", { p: def.i, att: att.i, x: (att.x + def.x) / 2 });
    this.emit("hitstop", { ev: "parry_success", ms: CONFIG.parry.hitstopMs });
    [att.pos, def.pos] = [def.pos, att.pos];                                  // 互換站位
    this.setAnim(def, "parry_success");
    att.damage += CONFIG.parry.counterDamage;                                 // 原守方反打一下重拳、擊退 1 格（撞崖邊停住）
    const away = Math.sign(att.pos - def.pos) || 1;
    const to = clamp(att.pos + away * CONFIG.parry.counterKnock, 1, CONFIG.cells);
    if (to !== def.pos) att.pos = to;
    this.glide(def, 0.18, 8, delay); this.glide(att, 0.24, 6, delay);
    this.setAnim(att, "knockback");
    this.emit("hit", { p: att.i, kind: "counter", damage: CONFIG.parry.counterDamage, x: cellX(att.pos), toward: away });
    this.go(PH.RESOLVE);
  }
  rollOut(d) {
    const r = this.round, att = this.f[r.att], def = this.f[r.def];
    r.result = "roll";
    const from = def.pos;
    def.pos = from + d * CONFIG.roll.cells;
    this.glide(def, CONFIG.roll.time, 6, 0);
    this.setAnim(def, "roll");
    att.fin = 1;
    this.emit("roll", { p: def.i, dir: d, from, to: def.pos, zone: r.zone });
    this.go(PH.RESOLVE);
  }
  finisherHit() {
    const r = this.round, att = this.f[r.att], def = this.f[r.def], R = CONFIG.resolve;
    r.result = "hit";
    def.damage += CONFIG.finisherDamage;
    const v = R.vBase * (1 + def.damage / R.damageDiv) * (r.red ? R.redMult : 1);   // V = V_base × (1 + damage / damageDiv)（紅招 × redMult）
    const a = R.angleDeg * Math.PI / 180;
    def.vx = Math.cos(a) * v * r.away; def.vy = -Math.sin(a) * v; def.air = true; def.rot = 0;
    att.fin = 1;
    this.setAnim(def, "knockback");
    this.emit("finisher_hit", { p: def.i, att: att.i, red: r.red, damage: CONFIG.finisherDamage, v, x: def.x, zone: r.zone });
    this.emit("hitstop", { ev: r.red ? "finisher_red" : "finisher_blue" });
    this.go(PH.RESOLVE);
  }

  // ---------------- PHASE_RESOLVE ----------------
  [`upd_${PH.RESOLVE}`](dt) {
    const R = CONFIG.resolve;
    for (const f of this.f) {
      if (!f.air || f.out) continue;
      f.vy += R.gravity * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vx * dt * 0.05;
      const left = CONFIG.stageX, right = CONFIG.stageX + CONFIG.cells * CONFIG.cellW;
      if (f.y >= CONFIG.floorY && f.vy > 0 && f.x >= left && f.x < right) {        // 落在台上：對齊最近的格子
        f.y = CONFIG.floorY; f.air = false; f.rot = 0;
        let c = clamp(Math.floor((f.x - CONFIG.stageX) / CONFIG.cellW) + 1, 1, CONFIG.cells);
        const o = this.other(f);
        if (c === o.pos) { const d = Math.sign(f.vx) || 1; c = (c + d >= 1 && c + d <= CONFIG.cells) ? c + d : c - d; }
        f.pos = c; this.glide(f, 0.15, 0, 0);
        this.setAnim(f, "idle");
        this.emit("land", { p: f.i, pos: c, x: f.x });
      } else if (f.x < -R.koMargin || f.x > CONFIG.W + R.koMargin || f.y > CONFIG.H + 40) this.ko(f);
    }
    if (this.koTimer !== null) { this.koTimer -= dt; if (this.koTimer > 0) return; this.koTimer = null; if (this.afterKO()) return; }
    if (this.t >= this.dur && this.f.every(f => !f.air && !f.gl)) this.endRound();
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
      f.pos = CONFIG.spawn[f.i]; f.x = cellX(f.pos); f.y = CONFIG.floorY; f.air = false; f.vx = f.vy = 0; f.rot = 0; f.stun = 0; f.gl = null; f.redGlow = false;
      this.setAnim(f, "idle");
    }
    this.emit("respawn");
    return false;
  }
  endRound() {
    for (const f of this.f) { f.power = Math.min(CONFIG.powerMax, f.power + 1); f.redGlow = false; }   // 攻防結算後雙方各回 1 氣
    this.emit("round_end");
    this.go(PH.MOVE);
  }

  // 畫面位置滑到邏輯格子（delay：等頓幀結束才開始動）
  glide(f, dur, arc, delay) { f.gl = { from: f.x, to: cellX(f.pos), t: -delay, dur, arc }; }
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
  //   seat = 0／1：那位玩家看得到的；seat = -1：同機雙人共用螢幕（兩邊的藏招都遮）
  viewFor(seat = -1) {
    const r = this.round, hidden = this.phase === PH.RPS && this.t >= this.reveal;
    const showGesture = r && (this.phase === PH.WINDOW || this.phase === PH.RESOLVE || seat === r.att);
    return {
      phase: this.phase, t: this.t, dur: this.dur, rt: this.rt, winner: this.winner, seat,
      reveal: this.reveal, speedLv: this.speedLv, rounds: this.rounds,
      fighters: this.f.map(f => ({
        i: f.i, pos: f.pos, x: f.x, y: f.y, rot: f.rot, face: f.face, out: f.out, air: f.air,
        power: f.power, damage: f.damage, stocks: f.stocks, stun: f.stun, steps: f.steps, locked: f.locked,
        wobble: f.wobble, wobbleDir: f.wobbleDir ?? 0, deny: f.deny, fin: f.fin, redGlow: f.redGlow,
        stance: hidden && seat !== f.i ? "hidden" : f.stance,
        picked: f.picked,
        anim: { state: hidden && seat !== f.i && f.anim.state.startsWith("stance_") ? "stance_hidden" : f.anim.state, t: f.anim.t, alt: f.anim.alt ?? 0 },
      })),
      round: r ? {
        att: r.att, def: r.def, winGesture: r.winGesture, winKey: r.winKey,
        gesture: showGesture ? r.gesture : null, red: !!r.red, charging: !!r.charging && seat === r.att,
        hits: r.hits ?? 0, extra: r.extra ?? 0, presses: seat === r.att ? r.presses ?? 0 : 0,
        type: this.phase === PH.WINDOW || this.phase === PH.RESOLVE ? r.type : null,
        zone: r.zone ?? [], dirs: r.dirs ?? [], cueAt: r.cueAt ?? 0, done: !!r.done, result: r.result ?? null,
      } : null,
    };
  }
}
