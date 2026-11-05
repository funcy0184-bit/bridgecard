// SoundManager：所有音效都是用 Web Audio 當場合成的原創聲音（不用任何音效檔）。
//   · 音效、背景音樂分開調音量；一鍵靜音
//   · 同時發聲數有上限、同一種聲音有最短間隔：狂點也不會爆音
//   · 連續的好事件（連贏幾墩）音高會小幅升高，輸一墩就歸位
//   · 手機要等第一次點畫面才能出聲：第一次互動時解鎖
import { settings, onSettings } from "./fx";

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let sfxBus: GainNode, musicBus: GainNode, master: GainNode;
let noise: AudioBuffer | null = null;
let voices = 0;
const MAX_VOICES = 28;
const last = new Map<string, number>();
let streak = 0;

function ensure(): Ctx | null {
  if (ctx) return ctx;
  const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // 一點點壓縮：疊很多聲音也不會破音
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  sfxBus = ctx.createGain(); musicBus = ctx.createGain();
  sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master);
  const len = ctx.sampleRate;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(settings.muted ? 0 : settings.sfx * 0.9, t, 0.02);
  musicBus.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 0.55, t, 0.15);
  if (settings.music > 0 && !settings.muted) music.start(); else music.stop();
}
onSettings(applyVolumes);

// 第一次點畫面時解鎖（iPhone 一定要這樣）
let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  const c = ensure();
  if (!c) return;
  unlocked = true;
  c.resume().catch(() => {});
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b; s.connect(c.destination); s.start(0);
  applyVolumes();
}
if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlockAudio, { once: false, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) { music.stop(); ctx.suspend().catch(() => {}); }
    else { ctx.resume().catch(() => {}); applyVolumes(); }
  });
}

// ---------------- 合成零件 ----------------

function ok(name: string, gap: number): boolean {
  if (!ctx || !unlocked || settings.muted || settings.sfx <= 0) return false;
  if (voices >= MAX_VOICES) return false;
  const now = performance.now();
  if (now - (last.get(name) ?? -1e9) < gap) return false;
  last.set(name, now);
  return true;
}

function track(node: AudioScheduledSourceNode) { voices++; node.onended = () => { voices--; }; }

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// 一段濾過的雜音：紙張摩擦、拍桌、收牌
function hiss(opt: { at?: number; dur: number; vol: number; type?: BiquadFilterType; freq: number; q?: number; sweepTo?: number }) {
  const c = ctx!, t = c.currentTime + (opt.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = opt.type ?? "bandpass";
  f.frequency.setValueAtTime(opt.freq, t);
  if (opt.sweepTo) f.frequency.exponentialRampToValueAtTime(opt.sweepTo, t + opt.dur);
  f.Q.value = opt.q ?? 0.9;
  const g = c.createGain();
  env(g, t, opt.vol, 0.004, opt.dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  track(src);
  src.start(t, Math.random() * 0.5, opt.dur + 0.05);
}

// 一個音：點擊、鈴聲、低頻撞擊
function tone(opt: { at?: number; freq: number; dur: number; vol: number; type?: OscillatorType; drop?: number; attack?: number; partials?: number[] }) {
  const c = ctx!, t = c.currentTime + (opt.at ?? 0);
  const g = c.createGain();
  env(g, t, opt.vol, opt.attack ?? 0.003, opt.dur);
  g.connect(sfxBus);
  for (const [i, mult] of [1, ...(opt.partials ?? [])].entries()) {
    const o = c.createOscillator();
    o.type = opt.type ?? "sine";
    o.frequency.setValueAtTime(opt.freq * mult, t);
    if (opt.drop) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.freq * mult * opt.drop), t + opt.dur);
    if (i > 0) { const pg = c.createGain(); pg.gain.value = 0.35 / i; o.connect(pg); pg.connect(g); } else o.connect(g);
    track(o);
    o.start(t);
    o.stop(t + (opt.attack ?? 0.003) + opt.dur + 0.05);
  }
}

const thump = (at: number, freq: number, vol: number, dur = 0.12) => tone({ at, freq, dur, vol, drop: 0.45 });
const bell = (at: number, freq: number, vol: number, dur = 0.45) => tone({ at, freq, dur, vol, partials: [2.01, 3.02], attack: 0.004 });
const pitch = () => Math.pow(2, Math.min(streak, 5) / 24);   // 連贏：每次升 1/4 音，最多 5 次

// ---------------- 事件音效 ----------------

export const sfx = {
  hover() { if (ok("hover", 55)) hiss({ dur: 0.045, vol: 0.05, freq: 4200, q: 0.7 }); },
  select() {
    if (!ok("select", 35)) return;
    hiss({ dur: 0.035, vol: 0.2, freq: 3000, q: 1.2 });
    tone({ freq: 2300, dur: 0.03, vol: 0.05, type: "triangle" });
  },
  deny() {
    if (!ok("deny", 120)) return;
    tone({ freq: 210, dur: 0.09, vol: 0.09, type: "triangle", drop: 0.8 });
    tone({ at: 0.07, freq: 170, dur: 0.1, vol: 0.07, type: "triangle", drop: 0.8 });
  },
  lift() { if (ok("lift", 40)) hiss({ dur: 0.06, vol: 0.09, freq: 2400, sweepTo: 3600 }); },
  // 出牌：卡牌拍落木桌
  land(power = 1) {
    if (!ok("land", 30)) return;
    hiss({ dur: 0.07, vol: 0.32 * power, type: "lowpass", freq: 1400, q: 0.5 });
    thump(0, 150, 0.32 * power, 0.11);
    tone({ at: 0.002, freq: 900, dur: 0.02, vol: 0.05 * power, type: "triangle" });
  },
  // 贏墩：紙牌收攏＋金屬 Click（連贏會一點一點變高）
  win(mine: boolean) {
    if (!ok("win", 60)) return;
    hiss({ dur: 0.16, vol: mine ? 0.18 : 0.12, freq: 1600, sweepTo: 4200, q: 0.7 });
    if (mine) {
      streak++;
      const p = pitch();
      tone({ at: 0.08, freq: 2637 * p, dur: 0.07, vol: 0.12, partials: [1.5] });
      tone({ at: 0.11, freq: 3951 * p, dur: 0.09, vol: 0.07 });
    } else {
      streak = 0;
      tone({ at: 0.08, freq: 880, dur: 0.07, vol: 0.06, type: "triangle" });
    }
  },
  resetStreak() { streak = 0; },
  // 關鍵一墩：多一層低頻衝擊
  impact(vol = 1) {
    if (!ok("impact", 80)) return;
    thump(0, 95, 0.5 * vol, 0.22);
    hiss({ dur: 0.18, vol: 0.18 * vol, type: "lowpass", freq: 700 });
  },
  ruff() {
    if (!ok("ruff", 80)) return;
    thump(0, 80, 0.5, 0.25);
    bell(0.03, 1318, 0.12, 0.5);
    bell(0.05, 1976, 0.08, 0.55);
  },
  // 搶到明牌：亮亮的提示音；被搶走：低一點
  faceUp(mine: boolean) {
    if (!ok("faceUp", 80)) return;
    if (mine) { bell(0, 1568, 0.13, 0.35); bell(0.07, 2093, 0.11, 0.45); }
    else tone({ freq: 660, dur: 0.18, vol: 0.07, type: "triangle", drop: 0.85 });
  },
  draw() { if (ok("draw", 60)) hiss({ dur: 0.09, vol: 0.14, freq: 2000, sweepTo: 1200 }); },
  // 叫牌：小印章敲下去
  stamp() {
    if (!ok("stamp", 60)) return;
    thump(0, 120, 0.35, 0.1);
    hiss({ dur: 0.03, vol: 0.22, freq: 2600, q: 1.4 });
    tone({ at: 0.01, freq: 520, dur: 0.05, vol: 0.06, type: "triangle" });
  },
  pass() { if (ok("pass", 60)) tone({ freq: 330, dur: 0.08, vol: 0.09, type: "triangle", drop: 0.9 }); },
  // 加倍：厚重的雙擊；再加倍：三下
  double(times = 2) {
    if (!ok("double", 120)) return;
    for (let i = 0; i < times; i++) { thump(i * 0.11, 82, 0.5, 0.16); hiss({ at: i * 0.11, dur: 0.05, vol: 0.2, type: "lowpass", freq: 900 }); }
  },
  // 合約達成：上升音階＋金屬共鳴
  contract(good: boolean) {
    if (!ok("contract", 200)) return;
    if (good) {
      [523, 659, 784, 1047].forEach((f, i) => bell(i * 0.075, f, 0.13, 0.5));
      bell(0.32, 2093, 0.07, 0.9);
      hiss({ at: 0.3, dur: 0.5, vol: 0.05, type: "highpass", freq: 6000 });
    } else {
      [392, 330, 262].forEach((f, i) => tone({ at: i * 0.11, freq: f, dur: 0.28, vol: 0.09, type: "triangle" }));
    }
  },
  // 分數累積：隨進度升高的 Tick
  tick(progress = 0) {
    if (!ok("tick", 22)) return;
    tone({ freq: 1100 * Math.pow(2, Math.min(1, progress) * 0.75), dur: 0.025, vol: 0.06, type: "square" });
  },
  scoreHit() {
    if (!ok("scoreHit", 120)) return;
    thump(0, 110, 0.42, 0.16);
    bell(0.01, 1047, 0.12, 0.4); bell(0.02, 1568, 0.08, 0.45);
  },
  victory() {
    if (!ok("victory", 400)) return;
    [523, 659, 784].forEach(f => bell(0, f, 0.1, 0.9));
    [1047, 1319, 1568, 2093].forEach((f, i) => bell(0.12 + i * 0.07, f, 0.09, 0.8));
    hiss({ at: 0.1, dur: 0.7, vol: 0.05, type: "highpass", freq: 7000 });
  },
  defeat() {
    if (!ok("defeat", 400)) return;
    [349, 294, 233].forEach((f, i) => tone({ at: i * 0.16, freq: f, dur: 0.38, vol: 0.08, type: "triangle" }));
  },
  // 按鈕：厚紙卡按下去／放開
  press() { if (ok("press", 30)) { hiss({ dur: 0.03, vol: 0.12, type: "lowpass", freq: 1800 }); thump(0, 180, 0.08, 0.05); } },
  toggle(on: boolean) { if (ok("toggle", 40)) tone({ freq: on ? 1320 : 880, dur: 0.04, vol: 0.06, type: "triangle" }); },
  slide() { if (ok("slide", 120)) hiss({ dur: 0.2, vol: 0.08, freq: 1800, sweepTo: 3200, q: 0.6 }); },
  join() { if (!ok("join", 150)) return; thump(0, 120, 0.3, 0.1); bell(0.05, 1175, 0.1, 0.35); bell(0.12, 1568, 0.09, 0.4); },
  type() { if (ok("type", 45)) hiss({ dur: 0.015, vol: 0.035, freq: 3500, q: 2 }); },
};

// ---------------- 背景音樂：慢慢的八音盒（當場生成，不用音樂檔） ----------------

const music = (() => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let next = 0, step = 0;
  // C 大調五聲音階的小旋律，配一個很淡的低音
  const chords = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]];
  const scale = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5];
  const BEAT = 0.62;
  function note(t: number, f: number, vol: number, dur: number) {
    const c = ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(musicBus);
    for (const [m, v] of [[1, 1], [2, 0.25], [4.01, 0.06]] as const) {
      const o = c.createOscillator();
      o.type = "sine"; o.frequency.value = f * m;
      const og = c.createGain(); og.gain.value = v;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function schedule() {
    if (!ctx) return;
    while (next < ctx.currentTime + 1.2) {
      const bar = Math.floor(step / 8) % chords.length, beat = step % 8;
      const ch = chords[bar];
      if (beat === 0) for (const f of ch) note(next, f / 2, 0.05, BEAT * 7);
      if (beat % 2 === 0 || Math.random() < 0.35) {
        const pool = Math.random() < 0.6 ? ch.map(f => f * 2) : scale;
        note(next, pool[Math.floor(Math.random() * pool.length)], 0.07, BEAT * 3);
      }
      next += BEAT; step++;
    }
  }
  return {
    start() {
      if (!ctx || timer || !unlocked) return;
      next = ctx.currentTime + 0.2;
      timer = setInterval(schedule, 300);
      schedule();
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
})();
