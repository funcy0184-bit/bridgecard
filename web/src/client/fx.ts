// 動態回饋的共用零件（MotionTokens ＋ CardMotion 的底層）：設定、彈簧曲線、飛牌、翻牌、落桌、震動、跳字。
// 所有動畫都看同一組設定：動畫強度（關閉／低／標準／強）、快速模式、畫面震動、粒子、手機震動、音量。
import { cardText, isRedCard, rankOf, rankText, SUIT_SYMBOL, suitOf } from "../game/cards";

// ---------------- 設定 ----------------

export type Intensity = 0 | 1 | 2 | 3;
// 特效品質：自動（看實際幀時間）／精簡／標準／完整。只影響裝飾（粒子、常駐動畫、裂痕、大範圍震動），
// 回合提示、勝負、計分、操作時序在任何品質下都一樣
export type Quality = "auto" | "lite" | "standard" | "full";
export type Level = Exclude<Quality, "auto">;
export const QUALITY_LABELS: [Quality, string][] = [["auto", "自動"], ["lite", "精簡"], ["standard", "標準"], ["full", "完整"]];
export interface FxSettings {
  intensity: Intensity;   // 0 關閉 1 低 2 標準 3 強
  fast: boolean;          // 快速動畫模式
  shake: boolean;         // 畫面震動
  particles: boolean;     // 粒子效果
  vibrate: boolean;       // 手機震動
  sfx: number;            // 音效音量 0..1
  music: number;          // 背景音樂音量 0..1
  muted: boolean;         // 一鍵靜音
  coach: boolean;         // 對局中的新手提示（每個階段第一次出現一次）
  quality: Quality;       // 特效品質
  talk: "full" | "lite" | "off";   // 阿元吐槽：正常互動／精簡互動／關閉額外吐槽（規則、錯誤、結算照常顯示）
  cast: "full" | "lite" | "off";   // 梭了啦轉播（聊天室、主播、節目小卡）：正常／精簡（只播重要的）／關閉（規則提示照常）
}
export const INTENSITY_LABELS = ["關閉", "簡化", "標準", "強"];
const KEY = "hb-web-settings";
export const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
type NavExtra = Navigator & { deviceMemory?: number; userActivation?: { hasBeenActive: boolean } };
const nav = (typeof navigator !== "undefined" ? navigator : {}) as NavExtra;
// 低階手機：粒子減半
export const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 2;

export const settings: FxSettings = loadSettings();

function loadSettings(): FxSettings {
  const def: FxSettings = { intensity: reduced ? 1 : 2, fast: false, shake: !reduced, particles: !reduced, vibrate: true, sfx: 0.8, music: 0.15, muted: false, coach: true, quality: "auto", talk: "full", cast: "full" };
  let s: FxSettings = def;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    s = { ...def, ...raw };
    if (raw.speed === 2 && raw.fast === undefined) s.fast = true;   // 舊版「動畫速度：快」
  } catch { /* 用預設值 */ }
  if (![0, 1, 2, 3].includes(s.intensity)) s.intensity = def.intensity;
  if (!["auto", "lite", "standard", "full"].includes(s.quality)) s.quality = "auto";
  if (!["full", "lite", "off"].includes(s.talk)) s.talk = "full";
  if (!["full", "lite", "off"].includes(s.cast)) s.cast = "full";
  s.sfx = clamp01(Number(s.sfx)); s.music = clamp01(Number(s.music));
  return s;
}
function clamp01(n: number) { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5; }

const listeners: (() => void)[] = [];
export function onSettings(fn: () => void) { listeners.push(fn); }
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 無痕模式存不了就算了 */ }
  applySettings();
  for (const fn of listeners) fn();
}

// 強度倍率：關閉 0、低 0.5、標準 1、強 1.45
export const amp = () => [0, 0.5, 1, 1.45][settings.intensity];
export const motionOn = () => settings.intensity > 0;
const speedMult = () => (settings.fast ? 0.6 : 1) * (reduced ? 0.75 : 1);
export const ms = (base: number) => (motionOn() ? base * speedMult() : 1);
export const wait = (t: number) => new Promise<void>(r => setTimeout(r, t));

// ---------------- MotionTokens：時長、曲線 ----------------

// pull 抽牌、fly 飛行、land 落桌：出牌的三段節奏；hitstop 只給關鍵事件
export const T = { tap: 120, quick: 180, base: 240, pull: 70, fly: 210, land: 180, slow: 360, hitstop: 80, hitstopBig: 100 };
export const EASE = {
  out: "cubic-bezier(.2,.8,.25,1)",
  in: "cubic-bezier(.5,0,.8,.4)",
  snap: "cubic-bezier(.3,1.6,.5,1)",
  spring: "cubic-bezier(.2,1.35,.4,1)",   // 啟動時換成真的彈簧曲線（linear()）
};

// 用彈簧方程式算出一條 CSS linear() 曲線；舊瀏覽器退回帶回彈的 cubic-bezier
function springEasing(stiffness = 230, damping = 17): string {
  if (typeof CSS === "undefined" || !CSS.supports?.("transition-timing-function", "linear(0, 1)")) return EASE.spring;
  let x = 0, v = 0;
  const pts: string[] = [];
  const steps = 48, dt = 0.55 / steps;
  for (let i = 0; i <= steps; i++) {
    pts.push(x.toFixed(3));
    for (let k = 0; k < 4; k++) { const a = -stiffness * (x - 1) - damping * v; v += a * dt / 4; x += v * dt / 4; }
  }
  pts[pts.length - 1] = "1";
  return `linear(${pts.join(", ")})`;
}

// 自動品質現在的等級（perf.ts 依實際幀時間調整）；低階手機從精簡開始
let autoLevel: Level = lowEnd ? "lite" : "standard";
export const getAutoLevel = () => autoLevel;
export function setAutoLevel(l: Level) { if (l === autoLevel) return; autoLevel = l; applySettings(); for (const fn of listeners) fn(); }
// 實際使用的品質：動畫「關閉／簡化」或系統要求減少動態效果 → 一律精簡（效能再好也不覆蓋使用者的偏好）
export function quality(): Level {
  if (settings.intensity <= 1) return "lite";
  return settings.quality === "auto" ? autoLevel : settings.quality;
}
// 裝飾粒子的倍率：精簡 0、標準 1、完整 1.5
export const qFactor = () => ({ lite: 0, standard: 1, full: 1.5 })[quality()];

export function applySettings() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.motion = String(settings.intensity);
  root.dataset.q = quality();
  root.style.setProperty("--spd", String(motionOn() ? speedMult() : 0.01));
  root.style.setProperty("--amp", String(amp()));
}

// ---------------- 牌 ----------------

const CROWN = `<svg class="crown" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 L4 4 L9 9 L12 2 L15 9 L20 4 L22 14 Z" fill="currentColor" opacity=".85"/><path d="M2 15 H22" stroke="currentColor" stroke-width="1.4"/></svg>`;

export function cardEl(id: number, cls = ""): HTMLElement {
  const e = document.createElement("div");
  const r = rankOf(id);
  e.className = `card ${isRedCard(id) ? "red" : ""} ${r >= 11 && r <= 13 ? "face" : ""} ${cls}`;
  const s = SUIT_SYMBOL[suitOf(id)];
  const ix = `<b>${rankText(r)}</b><i>${s}</i>`;
  e.innerHTML = `<span class="ix">${ix}</span>${r >= 11 && r <= 13 ? CROWN : ""}<span class="pip">${s}</span><span class="ix rev">${ix}</span>`;
  e.dataset.id = String(id);
  e.setAttribute("aria-label", cardText(id));
  return e;
}

export function backEl(cls = ""): HTMLElement {
  const e = document.createElement("div");
  e.className = `card back ${cls}`;
  return e;
}

// ---------------- 動畫零件 ----------------

let layer: HTMLElement;
let shakeTarget: HTMLElement;
export function initFx(fxLayer: HTMLElement, shakeRoot: HTMLElement) {
  layer = fxLayer;
  shakeTarget = shakeRoot;
  EASE.spring = springEasing();
  document.documentElement.style.setProperty("--spring", EASE.spring);
  applySettings();
}
export const fxLayer = () => layer;

export const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
export const rectAt = (x: number, y: number, w: number, h: number) => new DOMRect(x - w / 2, y - h / 2, w, h);

// 把元素「釘」在畫面上某個位置（特效層、固定定位），之後再拿去飛
export function pin(el: HTMLElement, at: DOMRect) {
  el.classList.add("flying");
  Object.assign(el.style, { left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`, visibility: "visible" });
  el.style.setProperty("--cw", `${at.width}px`);
  if (el.parentElement !== layer) layer.appendChild(el);
}

// 出牌飛行：途中微轉、放大、影子變深；可以在半路翻面
export async function fly(el: HTMLElement, from: DOMRect, to: DOMRect,
  opt: { dur?: number; flipAt?: () => void; fade?: boolean; spin?: number; easing?: string; lift?: number } = {}): Promise<HTMLElement> {
  pin(el, from);
  if (!motionOn()) { opt.flipAt?.(); return el; }
  const a = center(from), b = center(to);
  const sx = to.width / from.width, sy = to.height / from.height;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dur = ms(opt.dur ?? T.fly);
  const spin = (opt.spin ?? (Math.random() * 12 - 6)) * Math.min(1.3, amp());
  const peak = 1 + 0.08 * Math.min(1.4, amp());
  const arc = (opt.lift ?? 26) * Math.min(1.3, amp());
  const frames: Keyframe[] = [
    { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" },
    { transform: `translate(${dx * 0.55}px,${dy * 0.55 - arc}px) scale(${(1 + sx) / 2 * peak},${(1 + sy) / 2 * peak}) rotate(${spin}deg)`, opacity: 1, offset: 0.55, filter: "drop-shadow(0 14px 14px rgba(0,0,0,.45))" },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, opacity: opt.fade ? 0 : 1, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" },
  ];
  if (opt.flipAt) setTimeout(opt.flipAt, dur * 0.45);
  await el.animate(frames, { duration: dur, easing: opt.easing ?? EASE.out, fill: "forwards" }).finished.catch(() => {});
  return el;
}

// 落桌：壓縮到約 93% 再彈回 100%（有重量的感覺）
export function land(el: Element, power = 1) {
  if (!motionOn()) return;
  const k = Math.min(1.3, amp()) * power;
  el.animate([
    { scale: "1 1" }, { scale: `${1 + 0.03 * k} ${1 - 0.07 * k}`, offset: 0.28 }, { scale: `${1 - 0.01 * k} ${1 + 0.025 * k}`, offset: 0.62 }, { scale: "1 1" },
  ], { duration: ms(T.land), easing: "ease-out" });
}

// 衝擊波：一圈細細的光環往外擴（落桌、關鍵墩、叫牌、加倍）
export function shockwave(x: number, y: number, o: { color?: string; size?: number; dur?: number; width?: number; delay?: number } = {}) {
  if (!motionOn() || !layer) return;
  const r = document.createElement("div");
  r.className = "shock";
  const size = (o.size ?? 120) * Math.min(1.3, 0.6 + amp() * 0.4);
  Object.assign(r.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`, borderColor: o.color ?? "rgba(240,200,110,.9)", borderWidth: `${o.width ?? 2}px` });
  layer.appendChild(r);
  r.animate([{ scale: "0.15", opacity: 0.95 }, { scale: "1", opacity: 0 }], { duration: ms(o.dur ?? 380), delay: ms(o.delay ?? 0), easing: "cubic-bezier(.15,.7,.3,1)", fill: "both" })
    .finished.then(() => r.remove()).catch(() => r.remove());
}
export function shockAt(el: Element, o: Parameters<typeof shockwave>[2] = {}) {
  const b = el.getBoundingClientRect();
  shockwave(b.left + b.width / 2, b.top + b.height / 2, o);
}

// 牌背翻成牌面（飛行途中換臉）；用獨立的 scale 屬性，才不會蓋掉飛行用的 transform
export function flipTo(el: HTMLElement, id: number) {
  const swap = () => {
    const face = cardEl(id);
    el.className = face.className + " flying";
    el.replaceChildren(...Array.from(face.childNodes));
  };
  if (!motionOn()) { swap(); return; }
  el.animate([{ scale: "1 1" }, { scale: "0 1" }], { duration: ms(90), fill: "forwards" }).finished.then(() => {
    swap();
    el.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: ms(110), fill: "forwards" });
  }).catch(() => {});
}

export function punch(el: Element, amount = 0.14, dur = 260) {
  if (!motionOn()) return;
  const a = amount * Math.min(1.4, amp());
  el.animate([{ scale: "1" }, { scale: String(1 + a) }, { scale: String(1 - a * 0.35) }, { scale: "1" }],
    { duration: ms(dur), easing: "ease-out" });
}

// keep：亮完留一圈淡金邊（牌用）；常駐的資訊列用 false，亮完就退掉，不留框
export function glow(el: Element, dur = 520, keep = true) {
  el.animate([
    { boxShadow: "0 0 0 0 rgba(232,190,100,0)", filter: "brightness(1)" },
    { boxShadow: "0 0 0 3px rgba(240,200,110,.95), 0 0 26px 8px rgba(230,180,80,.7)", filter: "brightness(1.12)", offset: 0.35 },
    keep ? { boxShadow: "0 0 0 2px rgba(240,200,110,.55), 0 0 12px 2px rgba(230,180,80,.25)", filter: "brightness(1)" }
      : { boxShadow: "0 0 0 0 rgba(232,190,100,0)", filter: "brightness(1)" },
  ], { duration: ms(dur), fill: keep ? "forwards" : "none" });
}

// 不能出：輕輕左右擺一下（不要太兇）
export function deny(el: Element) {
  const a = motionOn() ? Math.max(0.6, Math.min(1.2, amp())) : 0;
  el.animate([
    { translate: "0 0", rotate: "0deg" }, { translate: `${-5 * a}px 0`, rotate: `${-2 * a}deg` }, { translate: `${4 * a}px 0`, rotate: `${1.5 * a}deg` },
    { translate: `${-2 * a}px 0`, rotate: `${-0.7 * a}deg` }, { translate: "0 0", rotate: "0deg" },
  ], { duration: ms(300), easing: "ease-out" });
}

// 選牌：彈一下
export function bounce(el: Element) {
  if (!motionOn()) return;
  el.animate([{ scale: "1" }, { scale: String(1 + 0.08 * Math.min(1.3, amp())) }, { scale: "0.98" }, { scale: "1" }], { duration: ms(260), easing: "ease-out" });
}

// 局部震動（只震牌桌那一塊）
export function shake(el: Element, ampPx = 8, dur = 260) {
  if (!settings.shake || !motionOn() || quality() === "lite") return;   // 精簡：不做大範圍震動
  const a = ampPx * amp();
  const frames: Keyframe[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const k = 1 - i / n;
    frames.push({ translate: i === n ? "0 0" : `${(Math.random() * 2 - 1) * a * k}px ${(Math.random() * 2 - 1) * a * k}px` });
  }
  el.animate(frames, { duration: ms(dur), easing: "linear" });
}
export function shakeScreen(ampPx = 10, dur = 280) { if (shakeTarget) shake(shakeTarget, ampPx, dur); }

// 背景亮一下（只給 Level 3）
export function flash(strength = 1) {
  if (!motionOn() || !layer) return;
  const f = document.createElement("div");
  f.className = "flash";
  layer.appendChild(f);
  f.animate([{ opacity: 0 }, { opacity: 0.55 * strength * Math.min(1.2, amp()), offset: 0.25 }, { opacity: 0 }], { duration: ms(520), easing: "ease-out" })
    .finished.then(() => f.remove()).catch(() => f.remove());
}

export function buzz(pattern: number | number[]) {
  if (!settings.vibrate) return;
  // 瀏覽器規定：使用者點過畫面之後才能震動（重新整理後還沒點就先不震）
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(pattern); } catch { /* iPhone 不支援 */ }
}

// 翻面：用獨立的 rotate 屬性（y 軸），不會蓋掉手牌排版用的 transform
export function flipIn(el: Element) {
  if (!motionOn()) return;
  el.animate([{ rotate: "y 90deg", filter: "brightness(1.4)" }, { rotate: "y 0deg", filter: "brightness(1)" }],
    { duration: ms(340), easing: "cubic-bezier(.2,1.4,.4,1)" });
}

export function popIn(el: Element, delay = 0) {
  if (!motionOn()) return;
  el.animate([{ scale: "0", opacity: 0 }, { scale: "1.1", opacity: 1, offset: 0.7 }, { scale: "1", opacity: 1 }],
    { duration: ms(320), delay: ms(delay), easing: "ease-out", fill: "backwards" });
}

// 紙張滑入（畫面切換、對話框、結算單）
export function slideIn(el: Element, from: "right" | "left" | "up" = "right", delay = 0) {
  if (!motionOn()) return;
  const t = from === "up" ? "0 28px" : from === "left" ? "-26px 0" : "26px 0";
  const r = from === "up" ? "0deg" : from === "left" ? "-1.2deg" : "1.2deg";
  el.animate([{ translate: t, rotate: r, opacity: 0 }, { translate: "0 0", rotate: "0deg", opacity: 1 }],
    { duration: ms(T.slow), delay: ms(delay), easing: EASE.spring, fill: "backwards" });
}

// 蓋章：從大到小用力壓下去
export function stampIn(el: Element, delay = 0) {
  if (!motionOn()) return;
  el.animate([
    { scale: "1.9", rotate: "-14deg", opacity: 0 }, { scale: "0.92", rotate: "-4deg", opacity: 1, offset: 0.55 },
    { scale: "1.04", rotate: "-5deg", offset: 0.8 }, { scale: "1", rotate: "-4deg", opacity: 1 },
  ], { duration: ms(300), delay: ms(delay), easing: "ease-out", fill: "backwards" });
}

// 數字滾動（分數變化）
export function countUp(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (from === to || !motionOn()) { el.textContent = String(to); return; }
  const t0 = performance.now(), dur = ms(700);
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  punch(el, 0.3, 420);
}

// ---------------- 跳字 ----------------

export type TextFlag = "pop" | "wave" | "shake" | "jelly";
export interface PopupOpt { color?: string; size?: number; flags?: TextFlag[]; hold?: number; delay?: number; rise?: number; }

const stacks = new WeakMap<Element, number>();

// 一個字一個字彈出來，可以加波浪／抖動，停一下再往上飄走
export function popup(text: string, anchor: Element, opt: PopupOpt = {}) {
  const run = () => {
    const r = anchor.getBoundingClientRect();
    const n = stacks.get(anchor) ?? 0;
    stacks.set(anchor, n + 1);
    const box = document.createElement("div");
    box.className = "popup " + (motionOn() ? (opt.flags ?? ["pop"]).map(f => "fx-" + f).join(" ") : "");
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top + r.height / 2 - n * (opt.size ?? 36) * 1.1}px`;
    box.style.fontSize = `${opt.size ?? 36}px`;
    if (opt.color) box.style.color = opt.color;
    [...text].forEach((ch, i) => {
      const o = document.createElement("span");
      o.className = "ch";
      o.style.setProperty("--i", String(i));
      const inner = document.createElement("span");
      inner.textContent = ch === " " ? " " : ch;
      o.appendChild(inner);
      box.appendChild(o);
    });
    layer.appendChild(box);
    const hold = Math.max(ms(opt.hold ?? 750), 500) + [...text].length * ms(30);
    setTimeout(() => {
      box.animate([{ translate: "-50% -50%", opacity: 1 }, { translate: `-50% calc(-50% - ${motionOn() ? opt.rise ?? 48 : 0}px)`, opacity: 0 }],
        { duration: Math.max(ms(480), 200), easing: "ease-in", fill: "forwards" }).finished.then(() => {
        box.remove();
        stacks.set(anchor, Math.max(0, (stacks.get(anchor) ?? 1) - 1));
      }).catch(() => box.remove());
    }, hold);
  };
  if (opt.delay) setTimeout(run, ms(opt.delay)); else run();
}
