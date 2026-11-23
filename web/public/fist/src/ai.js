// ai.js — 三難度 AI（新手木樁／道場師兄／讀心宗師）
//   不作弊：
//     · 只能拿 port.view() —— 就是 engine.viewFor(自己座位)，藏招時看不到對手換了什麼、看不到攻方還沒亮出的終結手勢
//     · 對手的資訊要經過「反應延遲」才看得到：AI 把每一幀的畫面存起來，決策時讀 reactionMs 之前的那一幀
//     · 只能像真人一樣送按下／放開（同樣受放開再按、判定窗單次鎖死限制）
//   自己的狀態（力量、硬直、是不是攻方）不用延遲：那是「自己知道的事」
import { CONFIG } from "./config.js";
import { PH, COUNTER, KEY_OF, GESTURE_OF } from "./engine.js";

const GESTURES = ["rock", "scissors", "paper"];

export class AIPlayer {
  constructor(seat, level = "mid", rng = Math.random) {
    this.seat = seat; this.level = level; this.cfg = CONFIG.ai[level] ?? CONFIG.ai.mid; this.rng = rng;
    this.now = 0; this.hist = []; this.timers = []; this.phaseKey = ""; this.plan = {}; this.lastOppStance = null;
  }
  attach(port) { this.port = port; }
  // 排一次按鍵：delay 秒後按下、hold 秒後放開
  press(btn, delay = 0, hold = 0.05) { this.timers.push({ at: this.now + delay, type: "down", btn }, { at: this.now + delay + hold, type: "up", btn }); }
  pick(list) { return list[Math.floor(this.rng() * list.length)]; }

  update(dt) {
    this.now += dt;
    const v = this.port.view();
    this.hist.push({ at: this.now, v });
    while (this.hist.length > 2 && this.hist[1].at <= this.now - this.cfg.reactionMs / 1000) this.hist.shift();
    const seen = this.hist[0].v;                                         // 反應延遲後才「看到」的畫面
    // 執行到時間的按鍵
    for (const t of this.timers) if (t.at <= this.now) this.port.input(t.type, t.btn);
    this.timers = this.timers.filter(t => t.at > this.now);
    // 記住對手最後一次「公開亮出」的架式（藏招前）
    if (seen.phase === PH.RPS) { const s = seen.fighters[1 - this.seat].stance; if (s && s !== "hidden") this.lastOppStance = s; }
    // 新的一個階段（用自己的畫面判斷階段開始：自己知道輪到什麼了）
    const key = `${v.phase}:${Math.floor(v.rt - v.t + 1e-6)}:${(v.rt - v.t).toFixed(3)}`;
    if (key !== this.phaseKey) { this.phaseKey = key; this.plan = { start: this.now }; if (v.phase === PH.RPS) this.lastOppStance = null; }
    const fn = this["on_" + v.phase];
    if (fn) fn.call(this, v, seen);
  }

  me(v) { return v.fighters[this.seat]; }
  opp(v) { return v.fighters[1 - this.seat]; }

  // ---------- 走位：等看到這一輪開始（反應延遲）才決定 ----------
  [`on_${PH.MOVE}`](v, seen) {
    const P = this.plan;
    if (P.done || seen.phase !== PH.MOVE) return;
    P.done = true;
    const me = this.me(v), op = this.opp(seen), dist = Math.abs(me.pos - op.pos), toward = Math.sign(op.pos - me.pos) || 1;
    const atEdge = me.pos === 1 || me.pos === CONFIG.cells, inward = me.pos === 1 ? 1 : -1;
    const btnOf = d => (d < 0 ? "L" : "R");
    const budget = me.power - this.cfg.keepPower;                          // 宗師：保留 2 氣收頭
    if (this.level === "easy") {
      if (this.rng() < 0.5 && dist > 1 && me.power >= 1) this.press(btnOf(toward));
      else if (this.rng() < 0.5) this.press("M");
    } else if (atEdge && me.power >= 1 && (budget >= 1 || this.level === "mid")) this.press(btnOf(inward));   // 崖邊先往台內
    else if (dist > 2 && budget >= 1) this.press(btnOf(toward));
    else this.press("M");
  }

  // ---------- 猜拳：先看對手亮出的架式（有延遲）再選；宗師會假動作＋藏招變拳 ----------
  [`on_${PH.RPS}`](v, seen) {
    const P = this.plan, me = this.me(v), C = CONFIG.rps;
    if (me.stun > 0) return;                                             // 硬直中按了也沒用
    const oppSeen = seen.phase === PH.RPS && seen.t < (seen.reveal ?? C.reveal) ? this.opp(seen).stance : null;
    const read = () => (oppSeen && oppSeen !== "hidden" && this.rng() < this.cfg.counterRead ? COUNTER[oppSeen] : this.pick(GESTURES));
    const ready = seen.phase === PH.RPS;                                  // 反應延遲過了
    if (!P.first && ready) { P.first = true; P.g = this.cfg.feint ? this.pick(GESTURES) : read(); this.press(KEY_OF[P.g]); return; }
    if (!P.first) return;
    if (this.level === "mid" && !P.second && v.t >= 1.0) { P.second = true; const g = read(); if (g !== P.g) { P.g = g; this.press(KEY_OF[g]); } }
    if (this.cfg.feint && !P.feint && v.t >= 0.75) { P.feint = true; const g = this.pick(GESTURES.filter(x => x !== P.g)); P.g = g; this.press(KEY_OF[g]); }   // 前 1.3s 故意切招騙人
    if (this.cfg.hiddenSwitch && !P.final && v.t >= (v.reveal ?? C.reveal) + 0.12 + this.rng() * 0.15) {                                                                  // 最後 0.5s 藏招變拳
      P.final = true;
      const g = this.lastOppStance && this.rng() < this.cfg.counterRead ? COUNTER[this.lastOppStance] : this.pick(GESTURES);
      if (g !== P.g) { P.g = g; this.press(KEY_OF[g]); }
    }
  }

  // ---------- 連打：攻方狂按（按得多快看難度） ----------
  [`on_${PH.MASH}`](v) {
    const P = this.plan, r = v.round;
    if (!r || r.att !== this.seat) return;
    P.next ??= this.now + 0.06;
    if (this.now >= P.next) {
      const btns = ["L", "M", "R"];
      P.i = ((P.i ?? 0) + 1) % 3;
      this.press(btns[P.i], 0, 0.03);
      P.next = this.now + (this.cfg.mashIntervalMs / 1000) * (0.85 + this.rng() * 0.3);
    }
  }

  // ---------- 終結擇：攻方決定藍光或紅光（自己的回合：不用等反應） ----------
  [`on_${PH.SELECT}`](v) {
    const P = this.plan, r = v.round, me = this.me(v), op = this.opp(v);
    if (P.done || !r || r.att !== this.seat) return;
    P.done = true;
    const canRed = me.power >= CONFIG.select.redCost, edge = op.pos === 1 || op.pos === CONFIG.cells;
    let red = false;
    if (this.level === "easy") red = canRed && this.rng() < 0.06;                           // 極少開紅招
    else if (this.level === "mid") red = canRed && op.damage >= 80 && edge;                  // 對手 ≥ 80% 且站崖邊
    else red = canRed && (op.damage >= 70 || (edge && op.damage >= 50));                     // 宗師：看準就收頭
    if (red) this.press(r.winKey, 0.015, CONFIG.select.chargeTime + 0.05);
    else if (this.level !== "easy" && this.rng() < 0.6) this.press(this.pick(["L", "M", "R"]), 0.05);   // 換個終結手勢
  }

  // ---------- 終結判定窗：守方（提示是公開的；反應時間＝defenseMs，成功率看難度） ----------
  [`on_${PH.WINDOW}`](v) {
    const P = this.plan, r = v.round;
    if (P.done || !r || r.def !== this.seat || !r.type) return;
    P.done = true;
    const at = Math.min(0.46, (this.cfg.defenseMs + (this.rng() * 80 - 40)) / 1000);
    if (r.type === "blue") {
      const right = KEY_OF[COUNTER[r.gesture]];
      if (this.rng() < this.cfg.parryRate) this.press(right, at);
      else if (this.rng() < 0.5) this.press(this.pick(["L", "M", "R"].filter(b => b !== right)), at);   // 猜錯
    } else {
      if (r.dirs.length && this.rng() < this.cfg.rollRate) this.press(this.pick(r.dirs) < 0 ? "L" : "R", at);
      else if (this.rng() < 0.5) this.press("M", at);
    }
  }
}

// 教學用的腳本電腦：照劇本在指定時間按鍵（例如猜拳時固定亮石頭）
export class ScriptBot {
  constructor(seat, script = {}) { this.seat = seat; this.script = script; this.now = 0; this.phaseKey = ""; this.timers = []; this.done = {}; }
  attach(port) { this.port = port; }
  press(btn, delay = 0, hold = 0.05) { this.timers.push({ at: this.now + delay, type: "down", btn }, { at: this.now + delay + hold, type: "up", btn }); }
  update(dt) {
    this.now += dt;
    const v = this.port.view();
    for (const t of this.timers) if (t.at <= this.now) this.port.input(t.type, t.btn);
    this.timers = this.timers.filter(t => t.at > this.now);
    const key = `${v.phase}:${(v.rt - v.t).toFixed(3)}`;
    if (key !== this.phaseKey) { this.phaseKey = key; this.done = {}; }
    for (const [i, s] of (this.script[v.phase] ?? []).entries()) if (!this.done[i] && v.t >= s.at) { this.done[i] = true; this.press(s.btn, 0, s.hold ?? 0.05); }
  }
}
export { GESTURE_OF };
