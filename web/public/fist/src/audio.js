// audio.js — Web Audio 合成音效（沒有任何音檔）＋把引擎事件翻成聲音
//   Audio.unlock()：第一次按鍵或點擊時呼叫（瀏覽器規定要使用者操作後才能出聲）
//   Audio.handle(events, view)：每一幀把引擎事件和畫面資料丟進來
import { CONFIG } from "./config.js";
import { PH } from "./engine.js";

let ac = null, master = null, noiseBuf = null, hum = null, muted = false;
function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const A = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!A) return;
  ac = new A();
  master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
const ok = () => ac && ac.state === "running" && !muted;
function env(g, t, peak, a, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
function tone(freq, dur, vol, type = "sine", drop = 1, at = 0) {
  if (!ok()) return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (drop !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * drop), t + dur);
  env(g, t, vol, 0.004, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol, freq, type = "bandpass", q = 1, at = 0, sweep = 0) {
  if (!ok()) return;
  const t = ac.currentTime + at, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  env(g, t, vol, 0.003, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5, dur + 0.05);
}

export const Sfx = {
  tick() { tone(1600, 0.03, 0.05, "square"); },
  count(urgent) { tone(urgent ? 1320 : 990, 0.045, urgent ? 0.13 : 0.08, "square"); },
  hide() { noise(0.18, 0.12, 2400, "bandpass", 1, 0, 600); },
  deny() { tone(180, 0.08, 0.08, "square", 0.8); },
  step() { noise(0.05, 0.12, 900, "lowpass"); tone(120, 0.06, 0.12, "sine", 0.6); },
  wobble() { tone(520, 0.08, 0.05, "triangle", 1.3); },
  bump() { tone(90, 0.12, 0.3, "sine", 0.5); noise(0.06, 0.2, 700, "lowpass"); },
  clash() { tone(1850, 0.35, 0.16, "triangle", 0.97); tone(2770, 0.28, 0.1, "sine", 0.99); noise(0.12, 0.35, 5200, "bandpass", 2); tone(140, 0.12, 0.25, "sine", 0.5); },
  punch(power = 1) { tone(110 - 20 * power, 0.14, 0.45 * power, "sine", 0.4); noise(0.07, 0.4 * power, 1200, "lowpass"); noise(0.02, 0.2, 3800, "bandpass", 3); },
  jab(n = 1) { tone(180 + n * 25, 0.05, 0.22, "square", 0.5); noise(0.03, 0.25, 2600 + n * 300, "bandpass", 2); },
  heavy() { tone(70, 0.3, 0.6, "sine", 0.35); noise(0.18, 0.5, 600, "lowpass"); noise(0.03, 0.3, 3000, "bandpass", 2); },
  parry() { tone(2350, 0.45, 0.22, "triangle"); tone(3520, 0.35, 0.12, "sine"); tone(1175, 0.2, 0.1, "square", 1, 0.02); noise(0.05, 0.3, 6000, "highpass"); },
  whoosh() { noise(0.22, 0.2, 800, "bandpass", 0.8, 0, 3200); },
  chargeStart() {
    if (!ok() || hum) return;
    const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = "sawtooth"; o2.type = "sine"; o.frequency.setValueAtTime(55, t); o.frequency.linearRampToValueAtTime(95, t + CONFIG.select.chargeTime); o2.frequency.setValueAtTime(110, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.1);
    f.type = "lowpass"; f.frequency.value = 500;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(t); o2.start(t);
    hum = { o, o2, g };
  },
  chargeStop() { if (!hum) return; const t = ac.currentTime; hum.g.gain.cancelScheduledValues(t); hum.g.gain.setValueAtTime(Math.max(0.0001, hum.g.gain.value), t); hum.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); hum.o.stop(t + 0.1); hum.o2.stop(t + 0.1); hum = null; },
  redReady() { tone(60, 0.5, 0.35, "sawtooth", 1.6); noise(0.3, 0.2, 300, "lowpass"); },
  ko() { tone(55, 0.9, 0.7, "sine", 0.3); noise(0.8, 0.6, 400, "lowpass", 0.7, 0, 80); noise(0.25, 0.4, 2500, "bandpass", 1); tone(880, 0.6, 0.08, "triangle", 0.5, 0.05); },
  land() { noise(0.06, 0.18, 500, "lowpass"); tone(90, 0.08, 0.15, "sine", 0.6); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 0.12, "triangle", 1, i * 0.1)); },
  ok() { tone(880, 0.08, 0.08, "triangle"); tone(1320, 0.12, 0.08, "triangle", 1, 0.07); },
};

// 事件 → 聲音
let lastTick = -1, lastPhase = "";
function handle(events, view) {
  for (const e of events) {
    switch (e.type) {
      case "step": e.bump ? Sfx.bump() : Sfx.step(); break;
      case "wobble": Sfx.wobble(); break;
      case "deny": Sfx.deny(); break;
      case "lock": case "stance": case "finisher_pick": Sfx.tick(); break;
      case "hide": Sfx.hide(); break;
      case "clash": Sfx.clash(); break;
      case "hit": e.kind === "extra" ? Sfx.jab(e.n) : Sfx.punch(e.kind === "counter" ? 1.1 : e.n === 1 ? 0.8 : 1); break;
      case "charge_start": Sfx.chargeStart(); break;
      case "charge_stop": Sfx.chargeStop(); break;
      case "red_ready": Sfx.chargeStop(); Sfx.redReady(); break;
      case "parry": Sfx.parry(); break;
      case "roll": Sfx.whoosh(); break;
      case "finisher_hit": Sfx.heavy(); break;
      case "land": Sfx.land(); break;
      case "ko": Sfx.ko(); break;
      case "gameover": Sfx.win(); break;
      case "phase": if (e.phase !== PH.SELECT) Sfx.chargeStop(); break;
    }
  }
  // 倒數嗒聲：終結判定窗每 0.1 秒一聲；走位／猜拳最後 0.3 秒；最後一下比較尖
  if (!view) return;
  if (view.phase !== lastPhase) { lastPhase = view.phase; lastTick = -1; }
  const C = CONFIG.countdown, left = view.dur - view.t;
  if (view.phase === PH.WINDOW && view.round && !view.round.done) {
    const n = Math.ceil(left / C.tickEvery);
    if (n !== lastTick && n >= 1) { lastTick = n; Sfx.count(left <= C.urgentSec + 0.05); }
  } else if ((view.phase === PH.MOVE || view.phase === PH.RPS) && left > 0 && left <= C.phaseTickLast + 1e-6) {
    const n = Math.ceil(left / C.tickEvery);
    if (n !== lastTick) { lastTick = n; Sfx.count(n === 1); }
  }
}

export const Audio = { unlock, handle, setMuted(m) { muted = m; }, get muted() { return muted; } };
