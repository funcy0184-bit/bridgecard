// 出牌重量感與局勢衝擊的「畫面＋聲音」：
//   Layer A（slamFly + contact）：每一張牌落桌都有重量 —— 抽離、加速、落桌壓扁、陰影擴散、回彈、拍桌聲
//   Layer B（presentImpact）：規則已經確認結果（TrickWon）才演；強度完全照 impact.ts 算出來的 Tier
//
// 特效層放在牌桌（felt）裡、牌的「下面」：裂痕、壓痕、接觸陰影不會蓋住牌的數字和花色；
// 位置用當下卡牌的實際位置算，換手機大小、旋轉螢幕都對得上；每一個特效元素演完就移除，不會累積。
// 「簡化」動畫（含系統的減少動態效果）不畫裂痕、下沉、大衝擊波；「關閉」只留文字、聲音與必要的提示。
import * as fx from "./fx";
import { sfx } from "./sound";
import { burstAt } from "./particles";
import { logFx } from "./feedback";
import { legacyLevel, type Impact } from "./impact";
import { SUIT_SYMBOL, suitOf } from "../game/cards";

const full = () => fx.motionOn() && fx.settings.intensity >= 2 && fx.quality() !== "lite";   // 精簡品質：不畫裂痕、下沉、大衝擊波
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// 牌桌裡的特效層（在牌的下面）
function layerOf(felt: HTMLElement): HTMLElement {
  let l = felt.querySelector<HTMLElement>(":scope > .impactlayer");
  if (!l) {
    l = document.createElement("div");
    l.className = "impactlayer";
    l.setAttribute("aria-hidden", "true");
    felt.prepend(l);
  }
  return l;
}
// 某個元素中心點，換算成特效層裡的座標
function localCenter(layer: HTMLElement, el: Element) {
  const a = layer.getBoundingClientRect(), b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2 - a.left, y: b.top + b.height / 2 - a.top, w: b.width, h: b.height };
}
function spawn(layer: HTMLElement, cls: string, x: number, y: number, w: number, h: number): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  Object.assign(d.style, { left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` });
  layer.appendChild(d);
  return d;
}
const done = (a: Animation, el: Element) => a.finished.then(() => el.remove()).catch(() => el.remove());

// ======================= Layer A：出牌本體 =======================

// 時間（毫秒，會再乘上動畫速度）：抽離 → 飛行 → 接觸壓縮 → 回彈，總長約 300–450ms
export const PLAY_T = { pull: 60, fly: 200, squash: 55, rebound: 125 };

// 從手牌抽離：往上提一點、微微放大（同時有一點紙張摩擦聲）
export function pullUp(el: HTMLElement, dy: number, mine: boolean, weight = 1): Promise<void> {
  sfx.swish(weight);
  if (!fx.motionOn()) return Promise.resolve();
  return el.animate([{ translate: "0 0", scale: "1" }, { translate: `0 ${dy}px`, scale: mine ? "1.06" : "1" }],
    { duration: fx.ms(PLAY_T.pull), easing: "cubic-bezier(.2,.9,.3,1)" }).finished.then(() => {}, () => {});
}

// 飛行時間：重的牌稍微快一點（呼叫的人拿這個數字排程拍桌聲，聲音和落桌同一瞬間）
export const flightMs = (base: number, weight = 1) => fx.motionOn() ? fx.ms(base * (1 - Math.min(0.15, (weight - 1) * 0.3))) : 0;

// 飛向牌桌：先慢、後快（落桌前加速），影子先拉高再收緊
export async function slamFly(el: HTMLElement, from: DOMRect, to: DOMRect,
  o: { dur?: number; weight?: number; lift?: number; flipAt?: () => void } = {}): Promise<HTMLElement> {
  fx.pin(el, from);
  if (!fx.motionOn()) { o.flipAt?.(); return el; }
  const w = o.weight ?? 1;
  const a = fx.center(from), b = fx.center(to);
  const sx = to.width / from.width, sy = to.height / from.height;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dur = flightMs(o.dur ?? PLAY_T.fly, w);
  const k = Math.min(1.3, fx.amp());
  const spin = (Math.random() * 10 - 5) * k;
  const arc = (o.lift ?? 22) * k;
  const peak = 1 + 0.07 * Math.min(1.4, fx.amp());
  const frames: Keyframe[] = [
    { transform: "translate(0,0) scale(1) rotate(0deg)", filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" },
    { transform: `translate(${dx * 0.3}px,${dy * 0.3 - arc}px) scale(${((1 + sx) / 2) * peak},${((1 + sy) / 2) * peak}) rotate(${spin}deg)`, offset: 0.42, filter: "drop-shadow(0 16px 14px rgba(0,0,0,.45))" },
    { transform: `translate(${dx * 0.93}px,${dy * 0.93}px) scale(${sx * 1.03},${sy * 1.03}) rotate(${spin * 0.15}deg)`, offset: 0.86, filter: "drop-shadow(0 7px 6px rgba(0,0,0,.42))" },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" },
  ];
  if (o.flipAt) setTimeout(o.flipAt, dur * 0.4);
  // 整段用「加速」的曲線：越接近桌面越快
  await el.animate(frames, { duration: dur, easing: "cubic-bezier(.45,.02,.8,.5)", fill: "forwards" }).finished.catch(() => {});
  return el;
}

// 落桌：接觸那一下壓扁（40–70ms）→ 回彈（90–140ms），桌面接觸陰影往外擴散。不是橡皮、不過度彈跳
export function contact(landed: Element, felt: HTMLElement, weight = 1) {
  logFx("play", { tier: 0, extra: Math.round(weight * 100) });
  if (!fx.motionOn()) return;
  const k = Math.min(1.3, fx.amp()) * weight;
  const total = PLAY_T.squash + PLAY_T.rebound;
  landed.animate([
    { scale: "1 1" },
    { scale: `${1 + 0.035 * k} ${1 - 0.08 * k}`, offset: PLAY_T.squash / total },
    { scale: `${1 - 0.012 * k} ${1 + 0.028 * k}`, offset: 0.66 },
    { scale: "1 1" },
  ], { duration: fx.ms(total), easing: "ease-out" });
  // 接觸陰影：一團深色往外擴、淡掉（在牌的下面）
  const layer = layerOf(felt);
  const c = localCenter(layer, landed);
  const sh = spawn(layer, "cshadow", c.x, c.y + c.h * 0.06, c.w * 1.6, c.h * 1.1);
  done(sh.animate([{ scale: "0.55", opacity: Math.min(0.75, 0.5 * weight) }, { scale: "1.35", opacity: 0 }],
    { duration: fx.ms(300 + 60 * (weight - 1)), easing: "cubic-bezier(.1,.7,.3,1)" }), sh);
}

// ======================= Layer B：牌局結果 =======================

export interface ImpactTargets {
  felt: HTMLElement;                 // 牌桌（震動、下沉只動這一塊，不是整個網頁）
  winner: HTMLElement | null;        // 贏的那張牌
  loser?: HTMLElement | null;        // 旁邊另一張牌（關鍵墩時一起抖一下）
  markers?: (Element | null)[];      // 合約欄、墩數：Tier 4 時亮起來
  streak?: number;                   // 你連贏幾墩（只影響一般贏墩的音高）
}

// 回傳：呼叫的人要停多久（hit stop）再把牌收走
export function presentImpact(im: Impact, t: ImpactTargets): number {
  logFx("impact", { tier: im.tier, mine: im.winnerMe, what: im.kind });
  logFx("trick", { level: legacyLevel(im.tier), mine: im.winnerMe, extra: t.streak ?? 0 });   // 舊的分級紀錄（驗收用）
  const { felt, winner } = t;
  const good = im.good, mine = im.winnerMe;
  const layer = layerOf(felt);
  const at = winner ? localCenter(layer, winner) : { x: layer.clientWidth / 2, y: layer.clientHeight / 2, w: 60, h: 86 };
  const hs = fx.motionOn() ? fx.ms(im.hitstop) : 0;

  // ---- 聲音：贏墩的收牌聲 + 依等級疊上低頻、裂聲、回響（對齊落點那一瞬間） ----
  sfx.win(mine, mine ? t.streak ?? 0 : 0);
  if (im.tier === 1 && good) sfx.slap(1.12, 0);
  if (im.tier >= 2) {
    if (im.kind === "ruff") sfx.ruff(0); else sfx.boom(im.tier === 2 ? 0.55 : im.tier === 3 ? 0.85 : 1);
    if (full() && im.crack !== "none") sfx.crack(im.crack === "gold" ? "gold" : im.tier >= 3 ? "ink" : "hairline", 0.02);
    if (im.tier >= 3 && !good) setTimeout(() => sfx.sinkDown(im.tier === 4 ? 1 : 0.8), fx.ms(120));
    if (im.tier === 4 && good) setTimeout(() => sfx.resonance(), fx.ms(hs + 160));
  }
  // 手機震動（不支援就算了）
  fx.buzz(([[8], [12], [20, 30, 40], [30, 40, 90], [40, 30, 60, 40, 140]] as number[][])[im.tier]);

  if (!fx.motionOn()) return 0;

  // ---- 贏的那張牌：再壓一下（重要事件在壓到底那一瞬間定格） ----
  if (winner) {
    const p = [0.05, 0.08, 0.13, 0.17, 0.2][im.tier] * Math.min(1.3, fx.amp());
    const press = winner.animate([
      { scale: "1" }, { scale: `${1 + p * 0.6} ${1 - p * 0.55}`, offset: 0.28 }, { scale: `${1 + p * 0.5}`, offset: 0.6 }, { scale: "1" },
    ], { duration: fx.ms(im.tier >= 3 ? 420 : 300), easing: "ease-out" });
    if (hs > 0) setTimeout(() => { press.pause(); setTimeout(() => press.play(), hs); }, fx.ms(im.tier >= 3 ? 110 : 80));
    fx.glow(winner, [380, 460, 600, 720, 820][im.tier]);
    if (im.tier === 1) winner.animate([{ rotate: "0deg" }, { rotate: "-1.2deg" }, { rotate: "0.8deg" }, { rotate: "0deg" }], { duration: fx.ms(200) });   // 只抖這張牌，不震牌桌
    // 深一點的接觸陰影
    if (im.tier >= 1) {
      const sh = spawn(layer, "cshadow", at.x, at.y + at.h * 0.06, at.w * (1.7 + im.tier * 0.15), at.h * (1.15 + im.tier * 0.1));
      done(sh.animate([{ scale: "0.6", opacity: Math.min(0.85, 0.45 + im.tier * 0.1) }, { scale: "1.4", opacity: 0 }],
        { duration: fx.ms(360 + im.tier * 60), easing: "cubic-bezier(.1,.7,.3,1)" }), sh);
    }
  }
  if (im.tier === 0) return 0;

  // ---- 環形衝擊：等級越高越大、越快；沉重的結果用灰暗的圈 ----
  if (winner) {
    const ring = good ? "rgba(240,205,120,.9)" : "rgba(205,195,175,.45)";
    const big = full();
    const sizes = [0, 110, 150, 200, 240][im.tier] * (big ? 1 : 0.75);
    fx.shockAt(winner, { size: sizes, width: im.tier >= 3 ? 2.2 : 1.4, dur: im.tier >= 3 ? 320 : 360, color: ring });
    if (big && im.tier >= 3) fx.shockAt(winner, { size: sizes * 1.6, width: 1.2, dur: 420, delay: hs + 40, color: ring });
    if (big && im.tier === 4 && good) fx.shockAt(winner, { size: sizes * 2.3, width: 1, dur: 520, delay: hs + 120, color: "rgba(255,226,150,.8)" });
  }
  // 只有好事才放粒子；簡化模式少一點
  if (winner && good && mine) {
    const n = [0, 4, 10, 16, 24][im.tier] * (full() ? 1 : 0.4);
    if (n >= 1) burstAt(winner, { count: Math.round(n), kinds: im.tier >= 3 ? ["star", "dust", "suit"] : im.tier === 2 ? ["star", "dust"] : ["dust"], speed: 110 + im.tier * 45, life: 0.55 + im.tier * 0.1 });
  }
  if (im.tier === 1) return 0;

  // ======== 以下只給 Tier 2 以上：壓痕、裂痕、下沉、定格 ========
  if (full()) {
    dent(layer, at.x, at.y, im.tier, good);
    if (im.kind === "ruff" && winner?.dataset.id) sigil(layer, at.x, at.y, SUIT_SYMBOL[suitOf(Number(winner.dataset.id))], good);
    if (good) rays(layer, at.x, at.y, im.tier);
    if (im.crack !== "none") crack(layer, at.x, at.y, im.crack, im.power, good, at.w);
    if (im.tier >= 3) sink(felt, layer, im.tier, im.power, good);
    // 合約定案的好結果：震動交給接下來的「釋放」（EmotionDirector.release），這裡不重複震
    if (fx.settings.shake && !(im.tier >= 3 && good)) fx.shake(felt, [0, 0, 2.5, 5, 7][im.tier] * (good ? 1 : 0.75), im.tier >= 3 ? 320 : 200);
    // 旁邊那張牌也跟著被震一下
    if (im.tier >= 3 && t.loser) t.loser.animate([{ rotate: "0deg" }, { rotate: "-2.4deg" }, { rotate: "1.6deg" }, { rotate: "-0.6deg" }, { rotate: "0deg" }], { duration: fx.ms(280), delay: fx.ms(60) });
  }
  // 決勝：合約欄、墩數亮起來
  if (im.tier === 4 && good) for (const m of t.markers ?? []) if (m) { setTimeout(() => { fx.glow(m, 900); fx.punch(m, 0.12, 360); }, fx.ms(hs + 80)); }
  return hs;
}

// ---- 壓痕：一圈深色往外推開，邊緣有一點亮 ----
function dent(layer: HTMLElement, x: number, y: number, tier: number, good: boolean) {
  const size = [0, 0, 120, 170, 210][tier];
  const d = spawn(layer, `dent${good ? "" : " somber"}`, x, y, size, size * 0.8);
  done(d.animate([{ scale: "0.55", opacity: 0.7 }, { scale: "1", opacity: 0.55, offset: 0.25 }, { scale: "1.15", opacity: 0 }],
    { duration: fx.ms(tier >= 3 ? 560 : 420), easing: "cubic-bezier(.15,.7,.3,1)" }), d);
}

// ---- 放射線：好事才有（王吃、連贏延續、關鍵墩、合約），一個元素、只動 transform／opacity ----
function rays(layer: HTMLElement, x: number, y: number, tier: number) {
  const size = [0, 0, 220, 300, 380][tier];
  const r = spawn(layer, "rays", x, y, size, size);
  done(r.animate([{ scale: "0.35", rotate: "0deg", opacity: 0 }, { scale: "0.9", opacity: 0.55, offset: 0.25 }, { scale: "1.25", rotate: "18deg", opacity: 0 }],
    { duration: fx.ms(tier >= 3 ? 700 : 520), easing: "cubic-bezier(.2,.7,.3,1)" }), r);
}

// ---- 王吃：王牌花色的紋樣從牌下面浮出來 ----
function sigil(layer: HTMLElement, x: number, y: number, sym: string, good: boolean) {
  const s = spawn(layer, `sigil${good ? "" : " somber"}`, x, y, 160, 160);
  s.textContent = sym;
  done(s.animate([{ scale: "0.6", opacity: 0 }, { scale: "1", opacity: 0.4, offset: 0.25 }, { scale: "1.3", opacity: 0 }],
    { duration: fx.ms(560), easing: "ease-out" }), s);
}

// ---- 桌面下沉：牌桌往下一沉、四周暗一下，再彈回 ----
function sink(felt: HTMLElement, layer: HTMLElement, tier: number, power: number, good: boolean) {
  const depth = (tier === 4 ? 0.022 : 0.013) + 0.006 * power;
  felt.animate([{ scale: "1" }, { scale: String(1 - depth), offset: 0.22 }, { scale: String(1 + depth * 0.18), offset: 0.62 }, { scale: "1" }],
    { duration: fx.ms(good ? 380 : 520), easing: "ease-out" });
  const shade = spawn(layer, "sinkshade", layer.clientWidth / 2, layer.clientHeight / 2, layer.clientWidth, layer.clientHeight);
  done(shade.animate([{ opacity: 0 }, { opacity: tier === 4 ? 0.75 : 0.5, offset: 0.2 }, { opacity: 0 }], { duration: fx.ms(good ? 420 : 640), easing: "ease-out" }), shade);
}

// ---- 裂痕：從落點往外長出的放射狀細線（墨線／金色），長完停一下就淡掉（300–600ms），不會留在桌上 ----
type Pt = [number, number];
function branch(x: number, y: number, ang: number, len: number, step: number, wobble: number): Pt[] {
  const pts: Pt[] = [[x, y]];
  let a = ang, cx = x, cy = y, l = 0;
  while (l < len) {
    const s = step * rand(0.7, 1.3);
    a += rand(-wobble, wobble);
    cx += Math.cos(a) * s; cy += Math.sin(a) * s; l += s;
    pts.push([cx, cy]);
  }
  return pts;
}
const plen = (p: Pt[]) => p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0);
const pd = (p: Pt[]) => "M" + p.map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L");

export function crack(layer: HTMLElement, x: number, y: number, kind: "hairline" | "ink" | "gold", power: number, good: boolean, cardW = 60) {
  const W = layer.clientWidth, H = layer.clientHeight;
  if (W < 10 || H < 10) return;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", `crack ${kind}${good ? "" : " somber"}`);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const scale = Math.max(0.7, Math.min(1.3, Math.min(W, H) / 320));
  const n = kind === "hairline" ? 3 + Math.round(power * 2) : kind === "ink" ? 6 + Math.round(power * 3) : 8 + Math.round(power * 4);
  const maxLen = (kind === "hairline" ? 46 + 30 * power : kind === "ink" ? 80 + 60 * power : 120 + 90 * power) * scale;
  const r0 = cardW * 0.42;                       // 從牌的邊緣底下開始長，露出來的部分在牌的四周
  const grow = kind === "hairline" ? 90 : kind === "ink" ? 120 : 150;
  const life = kind === "hairline" ? 380 : kind === "ink" ? 540 : 640;
  const lines: { p: Pt[]; w: number; delay: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rand(-0.35, 0.35);
    const len = maxLen * rand(0.55, 1);
    const p = branch(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0, ang, len, 9 * scale, 0.32);
    const w = kind === "hairline" ? 0.9 : kind === "ink" ? 1.5 : 1.6;
    lines.push({ p, w, delay: rand(0, 25) });
    // 分岔（墨線、金色才有）
    if (kind !== "hairline" && p.length > 5) {
      const j = Math.floor(p.length * rand(0.35, 0.65));
      const [bx, by] = p[j];
      const side = Math.random() < 0.5 ? -1 : 1;
      lines.push({ p: branch(bx, by, ang + side * rand(0.5, 0.95), len * rand(0.3, 0.5), 7 * scale, 0.38), w: w * 0.65, delay: 40 + rand(0, 30) });
    }
  }
  const make = (d: string, cls: string, width: number, L: number, delay: number, dx = 0) => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    path.setAttribute("stroke-width", String(width));
    if (dx) path.setAttribute("transform", `translate(${dx} ${dx})`);
    path.style.strokeDasharray = `${L}`;
    path.style.strokeDashoffset = `${L}`;
    svg.appendChild(path);
    path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: fx.ms(grow), delay: fx.ms(delay), easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
  };
  for (const { p, w, delay } of lines) {
    const d = pd(p), L = plen(p) + 1;
    if (kind === "gold") { make(d, "glow", w * 3.2, L, delay); make(d, "core", w, L, delay); }
    else { make(d, "edge", w * 1.2, L, delay, 0.9); make(d, "core", w, L, delay); }
  }
  layer.appendChild(svg);
  done(svg.animate([{ opacity: 1 }, { opacity: 1, offset: (grow + 90) / life }, { opacity: 0 }], { duration: fx.ms(life), easing: "ease-in" }), svg);
}
