// training.js — 🛠️ 測試訓練場（木樁沙盒）
//   · 只是一層「控制層」：底下就是正式版的 engine.js（LocalTransport），規則、判定、演出完全共用
//   · 木樁（P2）照面板設定出招；需要「保證結果」的地方（固定讓我贏／贏我／平手）在引擎的 flow 掛鉤裡改寫木樁那一拳
//   · 無限命：flow 攔下 GAMEOVER，直接重開；每幀把命數補回 99
//   · 面板改的 CONFIG 數值（猜拳秒數、反擊秒數、拼刀輸入、過熱、對齊框）進場時拍快照、離開時還原 —— 不影響其他模式；
//     線上房間由伺服器用自己的 CONFIG 跑，本來就碰不到
import { CONFIG } from "./config.js";
import { PH, BEATS, COUNTER, KEY_OF, GESTURES, GNAME, duel, cellX } from "./engine.js";
import { LocalTransport } from "./transport.js";

const LIVES = 99;
const pick = list => list[Math.floor(Math.random() * list.length)];

// 面板預設值
export const TRAIN_DEFAULTS = {
  rps: "rock",                 // rock／scissors／paper／letwin（讓我贏）／win（贏我）／tie（平手）／random
  combo: ["random", "random", "random", "random"],   // 木樁打我四套拳：每一拳出什麼
  defend: "none",              // 我打四套拳時木樁：none（不反擊）／1～4（在第 N 拳反擊）／random
  clash: "random",             // 拼刀 5 招：random／rock／scissors／paper
  clashFirst: false,           // 木樁搶先手
  noHeat: false,               // 暫時關閉過熱
  debugBox: false,             // 50×50 對齊框＋腳底紅點
};

// ---------------- 木樁（P2）：照設定按鍵；需要「看到我出什麼」的模式直接讀引擎（訓練用，允許作弊） ----------------
class Dummy {
  constructor(ctl) { this.seat = 1; this.ctl = ctl; this.now = 0; this.timers = []; this.key = ""; this.plan = {}; }
  attach(port) { this.port = port; }
  press(btn, delay = 0, hold = 0.04) { this.timers.push({ at: this.now + delay, type: "down", btn }, { at: this.now + delay + hold, type: "up", btn }); }
  // 猜拳時木樁要擺的手勢（相對模式依我目前擺的架式算）
  rpsTarget(mine) {
    const m = this.ctl.s.rps;
    if (GESTURES.includes(m)) return m;
    if (m === "random") return this.plan.rand ??= pick(GESTURES);
    if (!mine) return null;
    return m === "letwin" ? BEATS[mine] : m === "win" ? COUNTER[mine] : mine;   // 讓我贏＝出被我剋的；贏我＝出剋我的；平手＝一樣
  }
  update(dt) {
    this.now += dt;
    for (const t of this.timers) if (t.at <= this.now) this.port.input(t.type, t.btn);
    this.timers = this.timers.filter(t => t.at > this.now);
    const e = this.ctl.engine;
    if (!e) return;
    for (const f of e.f) if (f.stocks < LIVES) f.stocks = LIVES;              // 無限命
    const v = this.port.view(), S = this.ctl.s, r = e.round;
    const key = `${v.phase}:${(v.rt - v.t).toFixed(3)}`;
    if (key !== this.key) { this.key = key; this.plan = {}; }
    if (v.phase === PH.RPS) {
      if (v.t < 0.25) return;                                                    // 開場停一下，像真人
      const g = this.rpsTarget(e.f[0].stance), heated = CONFIG.overheat.enabled && e.f[1].heat === g;
      if (g && g !== e.f[1].stance && !heated && !this.timers.length) this.press(KEY_OF[g]);   // 過熱的招不硬按（開牌前 flow 照樣會改成指定結果）
    } else if (v.phase === PH.COMBO_PREP && r?.att === 1 && !this.plan.done) {      // 木樁打我：第 n 拳照設定出（隨機＝不按，交給系統）
      this.plan.done = true;
      const g = S.combo[r.n - 1];
      if (GESTURES.includes(g)) this.press(KEY_OF[g], 0.08);
    } else if (v.phase === PH.COMBO_CUE && r?.def === 1 && !this.plan.done) {        // 我打四套拳：木樁要不要在這拳反擊
      this.plan.done = true;
      const n = r.n, d = S.defend;
      const go = d === "random" ? Math.random() < 0.5 : d !== "none" && Number(d) === n;
      if (go) this.press(KEY_OF[COUNTER[r.gesture]], Math.min(0.25, v.dur * 0.4));
    } else if (v.phase === PH.CLASH_INPUT && !this.plan.done) {                       // 拼刀 5 招：搶先手＝一開場秒填，不搶＝慢慢填
      this.plan.done = true;
      const N = CONFIG.CLASH_SEQUENCE_LENGTH;
      for (let k = 0; k < N; k++) {
        const g = S.clash === "random" ? pick(GESTURES) : S.clash;
        this.press(KEY_OF[g], S.clashFirst ? 0.05 + k * 0.05 : v.dur * 0.55 + k * 0.14, 0.03);
      }
    }
  }
}

export class Training {
  constructor(panel) {
    this.panel = panel; this.s = { ...TRAIN_DEFAULTS, combo: TRAIN_DEFAULTS.combo.slice() };
    this.engine = null; this.transport = null; this.saved = null;
    this.build();
  }
  // 我與木樁的起始狀態（↺ 重置用）
  home() { return { p: [{ pos: CONFIG.spawn[0], damage: 0 }, { pos: CONFIG.spawn[1], damage: 0 }], stocks: LIVES, phase: PH.RPS }; }
  // 引擎 flow 掛鉤：①無限命（攔下 GAMEOVER）②固定猜拳結果（在進開牌前改寫木樁那一拳）
  flow(from, to, e) {
    if (to === PH.GAMEOVER) return { reset: this.home() };
    if (from === PH.RPS && to === PH.REVEAL && this.s.rps !== "random") {
      const mine = e.lastRps.stances[0], dummy = this.s.rps;
      const g = GESTURES.includes(dummy) ? dummy : dummy === "letwin" ? BEATS[mine] : dummy === "win" ? COUNTER[mine] : mine;
      e.f[1].stance = g;
      e.lastRps = { ...e.lastRps, stances: [mine, g], random: [e.lastRps.random[0], false], winner: duel(mine, g) };
    }
  }
  start() {
    this.saved = {                                                            // 進場拍快照：離開時把被面板改過的 CONFIG 還原
      rps: { ...CONFIG.rps }, reactDur: CONFIG.combo.reactDur, inputDur: CONFIG.clashMode.inputDur,
      overheat: CONFIG.overheat.enabled, debug: CONFIG.DEBUG_SPRITE_BOX,
    };
    this.applyConfig();
    this.transport = new LocalTransport({ setup: this.home(), viewer: 0, speedUp: false, bots: [new Dummy(this)], flow: (f, t, e) => this.flow(f, t, e) });
    this.engine = this.transport.engine;
    this.refresh();
    return this.transport;
  }
  stop() {
    if (this.saved) {
      Object.assign(CONFIG.rps, this.saved.rps); CONFIG.combo.reactDur = this.saved.reactDur; CONFIG.clashMode.inputDur = this.saved.inputDur;
      CONFIG.overheat.enabled = this.saved.overheat; CONFIG.DEBUG_SPRITE_BOX = this.saved.debug;
      CONFIG.trainingDummySeat = -1; this.saved = null;
    }
    this.engine = null; this.transport = null;
  }
  applyConfig() {
    CONFIG.overheat.enabled = this.saved ? !this.s.noHeat : CONFIG.overheat.enabled;
    CONFIG.DEBUG_SPRITE_BOX = this.s.debugBox;
    CONFIG.trainingDummySeat = 1;                      // P2 畫成木樁（dummy_sheet.png 沒放就照舊畫武者）
    if (this.s.noHeat) this.engine?.clearHeat();
  }

  // ---------------- 一鍵操作 ----------------
  setDamage(i, v) { const f = this.engine?.f[i]; if (f && !f.out) f.damage = v; }
  setPos(i, pos) {
    const e = this.engine, f = e?.f[i];
    if (!f || f.air || f.out || e.f[1 - i].pos === pos) return false;           // 不能跟對手站同一格
    f.pos = pos; f.x = cellX(pos); f.gl = null; f.y = CONFIG.floorY;
    return true;
  }
  jump(what) {
    const e = this.engine;
    if (!e) return;
    const cur = e.f.map(f => ({ pos: f.out ? CONFIG.spawn[f.i] : f.pos, damage: f.out ? 0 : f.damage }));
    if (cur[0].pos === cur[1].pos) { cur[0].pos = CONFIG.spawn[0]; cur[1].pos = CONFIG.spawn[1]; }
    const base = { stocks: LIVES };
    if (what === "myCombo") e.reset({ ...base, p: [{ ...cur[0], streak: 3 }, cur[1]], phase: PH.BURST, round: { att: 0, winGesture: "rock" } });
    else if (what === "dummyCombo") e.reset({ ...base, p: [cur[0], { ...cur[1], streak: 3 }], phase: PH.BURST, round: { att: 1, winGesture: "rock" } });
    else if (what === "clash") e.reset({ ...base, p: cur, phase: PH.CLASH_INPUT, gauge: CONFIG.CLASH_TRIGGER_TIES });
    else e.reset(this.home());
    if (this.s.noHeat) e.clearHeat();
  }
  // 目前滑桿數值 → 可以直接貼回 config.js 的片段
  snippet() {
    const r = CONFIG.rps;
    return [
      "// 拳刃交鋒 訓練場調好的參數（貼進 config.js 對應位置）",
      `rps: { dur: ${r.dur}, reveal: ${r.reveal} },          // 猜拳總秒數（最後 ${+(r.dur - r.reveal).toFixed(2)} 秒藏招）`,
      `combo.reactDur: ${CONFIG.combo.reactDur},             // 四套拳每拳反擊秒數`,
      `clashMode.inputDur: ${CONFIG.clashMode.inputDur},      // 五連斬輸入秒數`,
    ].join("\n");
  }

  // ---------------- 面板 ----------------
  build() {
    const P = this.panel;
    if (!P) return;
    const opt = (v, t) => `<option value="${v}">${t}</option>`;
    const g3 = opt("random", "隨機") + GESTURES.map(g => opt(g, GNAME[g])).join("");
    const btns = (cls, list) => list.map(([v, t]) => `<button type="button" class="tb ${cls}" data-v="${v}">${t}</button>`).join("");
    P.innerHTML = `
      <style>
        #trainPanel { position: fixed; right: 8px; top: 46px; width: 262px; max-height: calc(100vh - 140px); overflow-y: auto; z-index: 6; background: rgba(12,16,26,.94); border: 1px solid #3A4560; border-radius: 10px; padding: 8px 10px 10px; color: #E8ECF5; font: 12px/1.45 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
        #trainPanel h4 { margin: 10px 0 4px; font-size: 12px; color: #FFD27A; letter-spacing: .02em; }
        #trainPanel h4:first-of-type { margin-top: 2px; }
        #trainPanel label { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 3px 0; }
        #trainPanel select { background: #1B2232; color: #E8ECF5; border: 1px solid #3A4560; border-radius: 6px; padding: 2px 4px; font: inherit; max-width: 150px; }
        #trainPanel .row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 3px 0; }
        #trainPanel .tb { background: #233049; color: #E8ECF5; border: 1px solid #3A4A6B; border-radius: 6px; padding: 3px 7px; font: inherit; cursor: pointer; }
        #trainPanel .tb:hover { background: #2E3E5E; }
        #trainPanel .tb.go { background: #3B2A12; border-color: #C98A3A; color: #FFE2AA; width: 100%; text-align: left; margin: 2px 0; }
        #trainPanel .tb.on { background: #F2AB52; color: #1A0D08; border-color: #F2AB52; }
        #trainPanel input[type=range] { width: 120px; }
        #trainPanel .val { min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; color: #9CD8FF; }
        #trainPanel .who { min-width: 34px; color: #AAB4C8; }
        #trainPanel .msg { color: #7CF29A; min-height: 1.2em; font-size: 11px; }
        #trainPanel .hint { color: #8592A4; font-size: 11px; margin: 2px 0 0; }
      </style>
      <h4>🎯 木樁猜拳</h4>
      <label>出招<select data-k="rps">${opt("rock", "固定 ✊ 石頭") + opt("scissors", "固定 ✌️ 剪刀") + opt("paper", "固定 🖐️ 布") + opt("letwin", "固定讓我贏") + opt("win", "固定贏我") + opt("tie", "固定平手") + opt("random", "隨機出招")}</select></label>
      <h4>👊 木樁打我四套拳</h4>
      ${[0, 1, 2, 3].map(i => `<label>第 ${i + 1} 拳<select data-k="combo" data-i="${i}">${g3}</select></label>`).join("")}
      <h4>🛡️ 我打四套拳時木樁</h4>
      <label>反應<select data-k="defend">${opt("none", "完全不反擊（吃滿 4 拳）") + [1, 2, 3, 4].map(n => opt(String(n), `在第 ${n} 拳反擊`)).join("") + opt("random", "隨機反擊（每拳 50%）")}</select></label>
      <h4>⚔️ 拼刀 5 招</h4>
      <label>木樁出<select data-k="clash">${opt("random", "隨機 5 招") + opt("rock", "全石頭") + opt("scissors", "全剪刀") + opt("paper", "全布")}</select></label>
      <label>木樁搶先手<input type="checkbox" data-k="clashFirst"></label>
      <h4>🧪 一鍵狀態</h4>
      <div class="row"><span class="who">我</span>${btns("dmg", [["0:0", "0%"], ["0:60", "60%"], ["0:110", "110%"], ["0:140", "140%"]])}</div>
      <div class="row"><span class="who">木樁</span>${btns("dmg", [["1:0", "0%"], ["1:60", "60%"], ["1:110", "110%"], ["1:140", "140%"]])}</div>
      <label>我站第幾格<select data-k="pos0">${[1, 2, 3, 4, 5, 6, 7].map(n => opt(n, n)).join("")}</select></label>
      <label>木樁站第幾格<select data-k="pos1">${[1, 2, 3, 4, 5, 6, 7].map(n => opt(n, n)).join("")}</select></label>
      <label>暫時關閉過熱<input type="checkbox" data-k="noHeat"></label>
      <label>顯示 50×50 對齊框＋腳底紅點<input type="checkbox" data-k="debugBox"></label>
      <h4>⏩ 一鍵跳轉</h4>
      ${btns("go", [["myCombo", "▶ 直接測我打四套拳"], ["dummyCombo", "▶ 直接測木樁打我四套拳"], ["clash", "▶ 直接進五連斬拼刀"], ["reset", "↺ 重置位置與損傷"]])}
      <h4>⏱️ 即時調秒數（改了下一輪生效）</h4>
      <label>猜拳秒數<input type="range" data-k="rpsDur" min="1.2" max="4" step="0.1"><span class="val" data-v="rpsDur"></span></label>
      <label>每拳反擊秒數<input type="range" data-k="reactDur" min="0.3" max="1.5" step="0.05"><span class="val" data-v="reactDur"></span></label>
      <label>拼刀輸入秒數<input type="range" data-k="inputDur" min="1.5" max="5" step="0.1"><span class="val" data-v="inputDur"></span></label>
      <p class="hint">猜拳最後 ${(CONFIG.rps.dur - CONFIG.rps.reveal).toFixed(1)} 秒固定是藏招；離開訓練場數值會還原</p>
      <button type="button" class="tb go" data-copy>📋 複製目前參數</button>
      <div class="msg" data-msg></div>`;
    const $ = sel => P.querySelector(sel);
    const msg = t => { const m = $("[data-msg]"); m.textContent = t; clearTimeout(this.mt); this.mt = setTimeout(() => { m.textContent = ""; }, 1800); };
    const done = el => el.blur?.();                                           // 改完就把焦點還給遊戲（不然 A／S／D 會被選單吃掉）
    P.addEventListener("change", ev => {
      const el = ev.target, k = el.dataset.k;
      if (!k) return;
      if (k === "combo") this.s.combo[Number(el.dataset.i)] = el.value;
      else if (k === "pos0" || k === "pos1") { if (!this.setPos(k === "pos0" ? 0 : 1, Number(el.value))) msg("那格有人或正在空中，換一格"); this.refresh(); }
      else if (el.type === "checkbox") { this.s[k] = el.checked; this.applyConfig(); }
      else if (el.type === "range") this.slide(k, Number(el.value));
      else this.s[k] = el.value;
      done(el);
    });
    P.addEventListener("input", ev => { const el = ev.target; if (el.type === "range") this.slide(el.dataset.k, Number(el.value)); });
    P.addEventListener("pointerup", ev => { if (ev.target.type === "range") done(ev.target); });
    P.addEventListener("click", ev => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.classList.contains("dmg")) { const [i, v] = b.dataset.v.split(":").map(Number); this.setDamage(i, v); msg(`${i ? "木樁" : "我"}損傷設為 ${v}%`); }
      else if (b.dataset.copy !== undefined) this.copy(msg);
      else if (b.classList.contains("go")) { this.jump(b.dataset.v); this.refresh(); msg({ myCombo: "連勝 3/3：你打四套拳", dummyCombo: "木樁連勝 3/3：練反擊", clash: "蓄力 2/2：五連斬", reset: "已重置" }[b.dataset.v] ?? ""); }
      done(b);
    });
  }
  slide(k, v) {
    if (k === "rpsDur") { const hidden = CONFIG.rps.dur - CONFIG.rps.reveal; CONFIG.rps.dur = v; CONFIG.rps.reveal = +Math.max(0.4, v - hidden).toFixed(2); }
    else if (k === "reactDur") CONFIG.combo.reactDur = v;
    else if (k === "inputDur") CONFIG.clashMode.inputDur = v;
    this.refresh();
  }
  async copy(msg) {
    const text = this.snippet();
    try { await navigator.clipboard.writeText(text); msg("📋 已複製！貼給我就能寫進正式版"); }
    catch { window.prompt("複製下面這段：", text); }
  }
  // 面板顯示同步目前數值
  refresh() {
    const P = this.panel;
    if (!P) return;
    const set = (sel, v) => { const el = P.querySelector(sel); if (el) el.value = v; };
    set('[data-k="rps"]', this.s.rps); set('[data-k="defend"]', this.s.defend); set('[data-k="clash"]', this.s.clash);
    this.s.combo.forEach((g, i) => set(`[data-k="combo"][data-i="${i}"]`, g));
    for (const k of ["clashFirst", "noHeat", "debugBox"]) { const el = P.querySelector(`[data-k="${k}"]`); if (el) el.checked = !!this.s[k]; }
    if (this.engine) { set('[data-k="pos0"]', this.engine.f[0].pos); set('[data-k="pos1"]', this.engine.f[1].pos); }
    const vals = { rpsDur: CONFIG.rps.dur, reactDur: CONFIG.combo.reactDur, inputDur: CONFIG.clashMode.inputDur };
    for (const [k, v] of Object.entries(vals)) { set(`[data-k="${k}"]`, v); const o = P.querySelector(`[data-v="${k}"]`); if (o) o.textContent = `${(+v).toFixed(2)}s`; }
  }
}
