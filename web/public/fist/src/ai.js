// ai.js — 三難度 AI（新手木樁／道場師兄／讀心宗師）
//   不作弊：
//     · 只能拿 port.view() —— 就是 engine.viewFor(自己座位)，藏招時看不到對手換了什麼、看不到四套拳攻方還沒亮出的那一拳
//     · 對手的資訊要經過「反應延遲」才看得到：AI 把每一幀的畫面存起來，決策時讀 reactionMs 之前的那一幀
//     · 只能像真人一樣送按下／放開（同樣受放開再按、反擊窗單次鎖死限制）
//   自己的狀態（連勝、過熱、是不是攻方）不用延遲：那是「自己知道的事」；過熱是公開資訊（雙方 HUD 都顯示）
import { CONFIG } from "./config.js";
import { PH, COUNTER, KEY_OF, GESTURE_OF, BEATS } from "./engine.js";

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

  // ---------- 猜拳：只會出沒過熱的招；先看對手亮出的架式（有延遲）再選；師兄／宗師會算對手的過熱 ----------
  //   對手過熱一招 → 對手只剩兩招可出 → 一定有一招「贏一招、平一招、永遠不輸」（保底）
  allowedFor(f) { return GESTURES.filter(g => g !== f.heat); }
  safePick(me, op) {                                                     // 對手剩兩招時的保底手勢（自己過熱的話退而求其次）
    const opts = this.allowedFor(op), mine = this.allowedFor(me);
    const score = g => opts.reduce((s, o) => s + (BEATS[g] === o ? 1 : BEATS[o] === g ? -1 : 0), 0);
    const best = Math.max(...mine.map(score));
    return this.pick(mine.filter(g => score(g) === best));
  }
  [`on_${PH.RPS}`](v, seen) {
    const P = this.plan, me = this.me(v), op = this.opp(v), mine = this.allowedFor(me);
    const legal = g => (mine.includes(g) ? g : this.pick(mine));          // 絕不按過熱的鍵
    const oppSeen = seen.phase === PH.RPS && seen.t < (seen.reveal ?? CONFIG.rps.reveal) ? this.opp(seen).stance : null;
    const useHeat = op.heat && this.rng() < this.cfg.readHeat;            // 師兄／宗師：拿對手的過熱算保底
    const read = () => {
      if (oppSeen && oppSeen !== "hidden" && this.rng() < this.cfg.counterRead && mine.includes(COUNTER[oppSeen])) return COUNTER[oppSeen];
      return useHeat ? this.safePick(me, op) : this.pick(mine);
    };
    const ready = seen.phase === PH.RPS;                                  // 反應延遲過了
    const reveal = v.reveal ?? CONFIG.rps.reveal;
    if (!P.first && ready) { P.first = true; P.g = legal(this.cfg.feint ? this.pick(mine) : read()); this.press(KEY_OF[P.g]); return; }
    if (!P.first) return;
    if (this.level === "mid" && !P.second && v.t >= reveal * 0.6) { P.second = true; const g = legal(read()); if (g !== P.g) { P.g = g; this.press(KEY_OF[g]); } }
    if (this.cfg.feint && !P.feint && v.t >= reveal * 0.45) { P.feint = true; const g = legal(this.pick(mine.filter(x => x !== P.g))); P.g = g; this.press(KEY_OF[g]); }   // 亮招期故意切招騙人
    if (this.cfg.hiddenSwitch && !P.final && v.t >= reveal + 0.12 + this.rng() * 0.2) {                                                                  // 最後藏招變拳
      P.final = true;
      let g = this.lastOppStance && this.rng() < this.cfg.counterRead ? COUNTER[this.lastOppStance] : useHeat ? this.safePick(me, op) : this.pick(mine);
      g = legal(g);
      if (g !== P.g) { P.g = g; this.press(KEY_OF[g]); }
    }
  }

  // ---------- 拼刀預輸入：照難度的節奏連按 5 下（新手慢、宗師搶先手） ----------
  [`on_${PH.CLASH_INPUT}`](v, seen) {
    const P = this.plan;
    if (P.done || seen.phase !== PH.CLASH_INPUT) return;                   // 看到拼刀開始（反應延遲）才動手
    P.done = true;
    const gap = this.cfg.clashMs / 1000;
    let at = 0;
    for (let k = 0; k < CONFIG.CLASH_SEQUENCE_LENGTH; k++) { this.press(KEY_OF[this.pick(GESTURES)], at, 0.03); at += gap * (0.85 + this.rng() * 0.3); }
  }

  // ---------- 四套拳・攻方：每一拳選一招（自己的回合：不用等反應）；宗師不連出同一招，比較難讀 ----------
  [`on_${PH.COMBO_PREP}`](v) {
    const P = this.plan, r = v.round;
    if (P.done || !r || r.att !== this.seat) return;
    P.done = true;
    let g = this.pick(GESTURES);
    if (this.level === "master" && g === this.lastCombo) g = this.pick(GESTURES.filter(x => x !== this.lastCombo));
    this.lastCombo = g;
    if (this.level === "easy" && this.rng() < 0.3) return;                // 新手偶爾發呆：交給系統隨機
    this.press(KEY_OF[g], Math.min(v.dur - 0.08, 0.08 + this.rng() * 0.2));
  }

  // ---------- 四套拳・守方：拳種亮出後 counterMs 左右按；counterRate 機率按對，其餘一半按錯、一半發呆 ----------
  [`on_${PH.COMBO_CUE}`](v) {
    const P = this.plan, r = v.round;
    if (P.done || !r || r.def !== this.seat || !r.gesture) return;
    P.done = true;
    const at = Math.max(0.05, Math.min(v.dur - 0.05, (this.cfg.counterMs + (this.rng() * 80 - 40)) / 1000));
    const right = KEY_OF[COUNTER[r.gesture]];
    if (this.rng() < this.cfg.counterRate) this.press(right, at);
    else if (this.rng() < 0.5) this.press(this.pick(["L", "M", "R"].filter(b => b !== right)), at);
  }
}

// 教學用的腳本電腦：照劇本在指定時間按鍵（例如猜拳時固定亮石頭）；劇本可以是函式，依進入階段時的畫面決定
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
    if (key !== this.phaseKey) { const sc = this.script[v.phase]; this.phaseKey = key; this.done = {}; this.list = typeof sc === "function" ? sc(v) : sc ?? []; }
    for (const [i, s] of (this.list ?? []).entries()) if (!this.done[i] && v.t >= s.at) { this.done[i] = true; this.press(s.btn, 0, s.hold ?? 0.05); }
  }
}
export { GESTURE_OF };
