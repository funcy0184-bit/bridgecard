// 回饋特效：飛牌、翻牌、發光、震畫面、逐字跳字、手機震動、彩帶。
// 對應 Unity 版的 Tween / TextFX / FloatingText / FeedbackDirector，手感盡量一樣。
import { cardText, isRedCard, rankOf, rankText, SUIT_SYMBOL, suitOf } from "../game/cards";

// ---------------- 設定 ----------------

export type ThemeId = "dusk" | "wine" | "green";
export interface FxSettings { speed: 0 | 1 | 2; shake: boolean; vibrate: boolean; theme: ThemeId; }
const SPEED_MULT = [1.35, 1, 0.7];   // 慢 / 標準 / 快：動畫時間倍率
export const SPEED_LABELS = ["慢", "標準", "快"];
// 牌桌顏色：暮色藍是「來打橋牌」主視覺的顏色；經典綠是第一版的牌桌綠
export const THEMES: { id: ThemeId; label: string; bg: string }[] = [
  { id: "dusk", label: "暮色藍", bg: "#111A2B" },
  { id: "wine", label: "酒紅", bg: "#1F1016" },
  { id: "green", label: "經典綠", bg: "#16302A" },
];
const KEY = "hb-web-settings";
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const settings: FxSettings = loadSettings();

function loadSettings(): FxSettings {
  const def: FxSettings = { speed: 1, shake: !reduced, vibrate: true, theme: "dusk" };
  let s = def;
  try { s = { ...def, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* 用預設值 */ }
  if (!THEMES.some(t => t.id === s.theme)) s.theme = "dusk";
  return s;
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 無痕模式存不了就算了 */ }
  applySpeed();
  applyTheme();
}
export function applyTheme() {
  const t = THEMES.find(x => x.id === settings.theme) ?? THEMES[0];
  if (t.id === "dusk") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
}
export function applySpeed() {
  document.documentElement.style.setProperty("--spd", String(SPEED_MULT[settings.speed] * (reduced ? 0.6 : 1)));
}
export const ms = (base: number) => base * SPEED_MULT[settings.speed] * (reduced ? 0.6 : 1);
export const wait = (t: number) => new Promise<void>(r => setTimeout(r, t));

// ---------------- 牌 ----------------

export function cardEl(id: number, cls = ""): HTMLElement {
  const e = document.createElement("div");
  e.className = `card ${isRedCard(id) ? "red" : ""} ${cls}`;
  const s = SUIT_SYMBOL[suitOf(id)];
  e.innerHTML = `<span class="ix"><b>${rankText(rankOf(id))}</b><i>${s}</i></span><span class="pip">${s}</span>`;
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
  applySpeed();
  applyTheme();
}

export const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// 把元素「釘」在畫面上某個位置（特效層、固定定位），之後再拿去飛
export function pin(el: HTMLElement, at: DOMRect) {
  el.classList.add("flying");
  Object.assign(el.style, { left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`, visibility: "visible" });
  el.style.setProperty("--cw", `${at.width}px`);
  if (el.parentElement !== layer) layer.appendChild(el);
}

// 一個以 (x, y) 為中心、w × h 大小的矩形
export const rectAt = (x: number, y: number, w: number, h: number) => new DOMRect(x - w / 2, y - h / 2, w, h);

// 把一張牌（或牌背）從 from 飛到 to。回傳飛行中的元素，飛完由呼叫者決定要不要移除
export async function fly(el: HTMLElement, from: DOMRect, to: DOMRect,
  opt: { dur?: number; flipAt?: () => void; fade?: boolean; spin?: number; easing?: string } = {}): Promise<HTMLElement> {
  pin(el, from);
  const a = center(from), b = center(to);
  const sx = to.width / from.width, sy = to.height / from.height;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dur = ms(opt.dur ?? 300);
  const spin = opt.spin ?? (Math.random() * 10 - 5);
  const frames: Keyframe[] = [
    { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
    { transform: `translate(${dx * 0.55}px,${dy * 0.55 - 24}px) scale(${(1 + sx) / 2 * 1.08},${(1 + sy) / 2 * 1.08}) rotate(${spin}deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, opacity: opt.fade ? 0 : 1 },
  ];
  if (opt.flipAt) setTimeout(opt.flipAt, dur * 0.45);
  await el.animate(frames, { duration: dur, easing: opt.easing ?? "cubic-bezier(.2,.8,.25,1)", fill: "forwards" }).finished.catch(() => {});
  return el;
}

// 牌背翻成牌面（飛行途中換臉）
// 用獨立的 scale 屬性做翻面，才不會蓋掉飛行用的 transform
export function flipTo(el: HTMLElement, id: number) {
  el.animate([{ scale: "1 1" }, { scale: "0 1" }], { duration: ms(90), fill: "forwards" }).finished.then(() => {
    const face = cardEl(id);
    el.className = face.className + " flying";
    el.replaceChildren(...Array.from(face.childNodes));
    el.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: ms(110), fill: "forwards" });
  }).catch(() => {});
}

export function punch(el: Element, amount = 0.14, dur = 260) {
  el.animate([{ scale: "1" }, { scale: String(1 + amount) }, { scale: String(1 - amount * 0.35) }, { scale: "1" }],
    { duration: ms(dur), easing: "ease-out" });
}

export function glow(el: Element, dur = 520) {
  el.animate([
    { boxShadow: "0 0 0 0 rgba(255,214,102,.0)", filter: "brightness(1)" },
    { boxShadow: "0 0 0 4px rgba(255,214,102,.95), 0 0 26px 8px rgba(255,200,80,.75)", filter: "brightness(1.12)", offset: 0.35 },
    { boxShadow: "0 0 0 2px rgba(255,214,102,.6), 0 0 12px 2px rgba(255,200,80,.3)", filter: "brightness(1)" },
  ], { duration: ms(dur), fill: "forwards" });
}

export function deny(el: Element) {
  el.animate([
    { translate: "0 0" }, { translate: "-7px 0" }, { translate: "6px 0" }, { translate: "-4px 0" }, { translate: "3px 0" }, { translate: "0 0" },
  ], { duration: ms(280) });
  el.animate([{ filter: "none" }, { filter: "sepia(1) saturate(4) hue-rotate(-30deg)" }, { filter: "none" }], { duration: ms(380) });
}

export function shakeScreen(amp = 10, dur = 280) {
  if (!settings.shake || !shakeTarget) return;
  const frames: Keyframe[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const k = 1 - i / n;
    frames.push({ translate: i === n ? "0 0" : `${(Math.random() * 2 - 1) * amp * k}px ${(Math.random() * 2 - 1) * amp * k}px` });
  }
  shakeTarget.animate(frames, { duration: ms(dur), easing: "linear" });
}

export function buzz(pattern: number | number[]) {
  if (!settings.vibrate) return;
  // 瀏覽器規定：使用者點過畫面之後才能震動（重新整理後還沒點就先不震）
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return;
  try { navigator.vibrate?.(pattern); } catch { /* iPhone 不支援 */ }
}

export function flipIn(el: Element) {
  el.animate([{ transform: "rotateY(90deg)", filter: "brightness(1.4)" }, { transform: "rotateY(0deg)", filter: "brightness(1)" }],
    { duration: ms(340), easing: "cubic-bezier(.2,1.4,.4,1)" });
}

export function popIn(el: Element, delay = 0) {
  el.animate([{ scale: "0", opacity: 0 }, { scale: "1.12", opacity: 1, offset: 0.7 }, { scale: "1", opacity: 1 }],
    { duration: ms(320), delay: ms(delay), easing: "ease-out", fill: "backwards" });
}

// 數字滾動（分數變化）
export function countUp(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (from === to) { el.textContent = String(to); return; }
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
    box.className = "popup " + (opt.flags ?? ["pop"]).map(f => "fx-" + f).join(" ");
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top + r.height / 2 - n * (opt.size ?? 36) * 1.1}px`;
    box.style.fontSize = `${opt.size ?? 36}px`;
    if (opt.color) box.style.color = opt.color;
    [...text].forEach((ch, i) => {
      const o = document.createElement("span");
      o.className = "ch";
      o.style.setProperty("--i", String(i));
      const inner = document.createElement("span");
      inner.textContent = ch === " " ? " " : ch;
      o.appendChild(inner);
      box.appendChild(o);
    });
    layer.appendChild(box);
    const hold = ms(opt.hold ?? 750) + [...text].length * ms(30);
    setTimeout(() => {
      box.animate([{ translate: "-50% -50%", opacity: 1 }, { translate: `-50% calc(-50% - ${opt.rise ?? 48}px)`, opacity: 0 }],
        { duration: ms(480), easing: "ease-in", fill: "forwards" }).finished.then(() => {
        box.remove();
        stacks.set(anchor, Math.max(0, (stacks.get(anchor) ?? 1) - 1));
      }).catch(() => box.remove());
    }, hold);
  };
  if (opt.delay) setTimeout(run, ms(opt.delay)); else run();
}

// ---------------- 彩帶（贏得整場） ----------------

export function confetti(count = 70) {
  const colors = ["#D9A23A", "#F3D27A", "#E9F1EC", "#B8233A", "#5FB389"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    p.style.background = colors[i % colors.length];
    p.style.left = `${50 + (Math.random() * 30 - 15)}%`;
    layer.appendChild(p);
    const dx = (Math.random() * 2 - 1) * 220, up = 260 + Math.random() * 260;
    p.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px,${-up}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px,${120 + Math.random() * 200}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 1600 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" }).finished.then(() => p.remove()).catch(() => p.remove());
  }
}
