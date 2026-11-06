// FeedbackManager ＋ ScoreAnimator：依照「真的發生的遊戲事件」決定回饋強度。
//   Level 1 一般贏墩：順暢就好——小小發光、幾顆金粉、清脆一聲，不停頓、不震
//   Level 2 王吃／關鍵一墩：停頓 80ms、細光環、星芒、輕震、多一層低頻
//   Level 3 合約達成／擊破合約：停頓 100ms、雙光環、較多粒子、背景微亮
//   整場勝利：唯一全力釋放的時刻（紙屑星辰灑下來、大光環、勝利音效）
// 連續贏墩（streak）：音高、數字回彈、桌面光暈一點一點遞增；輸一墩就恢復。
// 叫牌：等級 1–7 分成低／中／高／最高四段；競叫張力會累積，Pass 釋放、重發歸零。
import * as fx from "./fx";
import { burstAt, burst, shower } from "./particles";
import { sfx } from "./sound";

export type Level = 1 | 2 | 3;

// 測試用：記下每一次回饋是被什麼事件、用哪一級觸發（只放在記憶體，不影響遊戲）
export const fxLog: { kind: string; level?: number; mine?: boolean; extra?: number; t: number }[] = [];
function log(kind: string, d: { level?: number; mine?: boolean; extra?: number } = {}) {
  fxLog.push({ kind, ...d, t: Math.round(performance.now()) });
  if (fxLog.length > 400) fxLog.shift();
}
(globalThis as unknown as { __hbFx?: typeof fxLog }).__hbFx = fxLog;

// ---------------- 贏墩 ----------------

export function trickFeedback(level: Level, mine: boolean, card: Element | null, felt: Element, streak = 0) {
  log("trick", { level, mine, extra: streak });
  sfx.win(mine, mine ? streak : 0);
  const boost = mine ? Math.min(4, Math.max(0, streak - 1)) * 0.025 : 0;
  if (card) {
    fx.glow(card, level === 1 ? 420 : level === 2 ? 600 : 720);
    fx.punch(card, level === 1 ? 0.08 + boost : level === 2 ? 0.2 : 0.26, level === 1 ? 220 : 320);
  }
  if (!mine) { if (level >= 2) fx.shake(felt, 2, 180); return; }
  if (!card) return;
  if (level === 1) { burstAt(card, { count: 3 + Math.min(8, streak * 2), kinds: ["dust"], speed: 110, life: 0.55 }); return; }
  fx.shockAt(card, { size: level === 3 ? 170 : 130 });
  burstAt(card, { count: level === 3 ? 22 : 12, kinds: level === 3 ? ["star", "dust", "suit"] : ["star", "dust"], speed: level === 3 ? 260 : 200, life: 0.8 });
  fx.shake(felt, level === 3 ? 7 : 4, level === 3 ? 300 : 220);
  sfx.impact(level === 3 ? 1 : 0.6);
  // Level 3 的全畫面爆發交給 EmotionDirector.release（先收束再爆發）
}

// Hitstop：只給關鍵事件（王吃、關鍵墩 80ms；合約達成 100ms）
export const hitstop = (level: Level) => fx.wait(level === 3 ? fx.T.hitstopBig : level === 2 ? fx.T.hitstop : 0);

// 連勝光暈：0 = 沒有；連贏 2、3、4… 墩越來越亮（輸一墩就收回）
export function streakGlow(felt: HTMLElement, streak: number) {
  felt.style.setProperty("--streak", String(Math.min(1, Math.max(0, (streak - 1) / 4))));
}

// 合約達成／擊破合約（Level 3 的收尾）；對手達成：安靜的失落
export function contractFeedback(good: boolean, anchor: Element, felt: Element) {
  log("contract", { level: 3, mine: good });
  sfx.contract(good);
  if (!good) { fx.shake(felt, 3, 220); return; }
  fx.shockAt(anchor, { size: 260, width: 1.5 });
  burstAt(anchor, { count: 18, kinds: ["star", "dust", "paper"], speed: 280, life: 1.1 });
}

// 整場勝利：唯一全力釋放的時刻
export function victory(el?: Element) {
  log("victory", { level: 4 });
  sfx.victory();
  fx.flash(1.1);
  shower(110);
  if (el) {
    burstAt(el, { count: 36, kinds: ["star", "dust", "suit"], speed: 340 });
    fx.shockAt(el, { size: 320 }); fx.shockAt(el, { size: 460, delay: 120, width: 1.5 });
  }
}

// 印章敲下去：加入房間、結算判定
export function stamp(el: Element, heavy = false) {
  fx.stampIn(el);
  setTimeout(() => {
    if (heavy) sfx.doubleHit(); else sfx.stamp();
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, { count: heavy ? 10 : 5, kinds: ["ink"], speed: 120, gravity: 0, life: 0.45, spread: Math.PI * 2 });
  }, fx.ms(160));
}

// ---------------- 叫牌：逐級升溫 ----------------

// 1–2 線低、3–4 中、5–6 高、7 最高
export const bidTier = (level: number) => level <= 2 ? 0 : level <= 4 ? 1 : level <= 6 ? 2 : 3;

// 叫牌籌碼：從叫牌的人那邊上浮 →（高等級停一下）→ 快速落到他的叫牌紙卡 → 壓縮回彈
// 回傳的 Promise 在落桌那一刻完成（畫面在那時才換上新的叫品）
export async function bidChip(text: string, red: boolean, tier: number, from: DOMRect, target: Element, felt: Element, tension = 0): Promise<void> {
  log("bid", { level: tier, extra: Math.round(tension * 100) });
  const tr = target.getBoundingClientRect();
  if (!fx.motionOn() || !fx.fxLayer()) {
    sfx.bid(tier, tension);
    fx.punch(target, 0.1 + tier * 0.05, 260);
    return;
  }
  const chip = document.createElement("div");
  chip.className = `bidchip t${tier}${red ? " red" : ""}`;
  chip.textContent = text;
  const size = 50 + tier * 4;
  const sx = from.left + from.width / 2, sy = from.top + from.height / 2;
  Object.assign(chip.style, { left: `${sx - size / 2}px`, top: `${sy - size / 2}px`, width: `${size}px`, height: `${size}px`, fontSize: `${17 + tier * 2}px` });
  fx.fxLayer().appendChild(chip);
  const k = Math.min(1.3, fx.amp());
  // 1. 上浮
  await chip.animate([{ translate: "0 0", scale: "0.6", opacity: 0 }, { translate: `0 ${-18 * k}px`, scale: "1.12", opacity: 1 }],
    { duration: fx.ms(90), easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" }).finished.catch(() => {});
  // 1.5 高等級：極短停頓（蓄力）
  if (tier >= 2) await fx.wait(tier === 3 ? 80 : 50);
  // 2. 快速落桌（聲音排在落桌那一瞬間）
  const dx = tr.left + tr.width / 2 - sx, dy = tr.top + tr.height / 2 - sy;
  const drop = fx.ms(150);
  sfx.bid(tier, tension, drop / 1000);
  await chip.animate([{ translate: `0 ${-18 * k}px`, scale: "1.12" }, { translate: `${dx}px ${dy}px`, scale: "0.92" }],
    { duration: drop, easing: "cubic-bezier(.55,0,.9,.45)", fill: "forwards" }).finished.catch(() => {});
  // 3. 壓縮回彈＋依等級的衝擊
  chip.animate([{ scale: "0.92" }, { scale: `${1.1 + 0.03 * tier} ${0.84 - 0.02 * tier}`, offset: 0.3 }, { scale: "0.97 1.05", offset: 0.65 }, { scale: "1" }],
    { duration: fx.ms(180), easing: "ease-out", fill: "forwards", composite: "replace" });
  fx.punch(target, 0.1 + tier * 0.06, 260 + tier * 30);
  if (tier >= 1) fx.glow(target, 380 + tier * 120);
  // 加碼是在累積壓力，不是慶祝：粒子只做提示，等級最高也不到勝利的份量
  const counts = [2, 6, 10, 14][tier];
  burstAt(target, { count: counts, kinds: tier === 0 ? ["dust"] : tier === 1 ? ["dust", "star"] : ["star", "dust", "ink"], speed: 110 + tier * 40, life: 0.55 + tier * 0.08 });
  if (tier >= 2) {
    fx.shockAt(target, { size: 100 + tier * 40 });
    fx.shake(felt, tier === 3 ? 5 : 3, 200);
    if (tier === 3) fx.shockAt(target, { size: 230, delay: 80, width: 1.5 });
  }
  setTimeout(() => {
    chip.animate([{ opacity: 1 }, { opacity: 0, scale: "0.8" }], { duration: fx.ms(200), fill: "forwards" }).finished.then(() => chip.remove()).catch(() => chip.remove());
  }, fx.ms(220));
}

// 加倍：紅色衝擊、低頻敲擊、短暫局部震動
export function doubleFx(target: Element, felt: Element) {
  log("double", { level: 2 });
  sfx.doubleHit();
  fx.stampIn(target);
  fx.shockAt(target, { size: 170, color: "rgba(196,48,62,.95)", width: 3 });
  burstAt(target, { count: 12, kinds: ["ink", "dust"], colors: ["#B8233A", "#7A2732", "#E8939E"], speed: 200, life: 0.6 });
  fx.shake(felt, 6, 260);
}

// 再加倍：雙重衝擊波、金紅粒子、短促亮光、更重的音效
export function redoubleFx(target: Element, felt: Element) {
  log("redouble", { level: 3 });
  sfx.redoubleHit();
  fx.stampIn(target);
  fx.shockAt(target, { size: 170, color: "rgba(240,200,110,.95)", width: 3 });
  fx.shockAt(target, { size: 260, color: "rgba(196,48,62,.9)", width: 3, delay: 100 });
  burstAt(target, { count: 22, kinds: ["star", "dust", "ink"], colors: ["#F3D488", "#E2B860", "#B8233A", "#7A2732"], speed: 260, life: 0.8 });
  fx.flash(0.4);
  fx.shake(felt, 9, 320);
}

// 合約定格：最後的合約在牌桌中央蓋下去，再一次俐落地落進上方的合約欄（保留加倍狀態）
export async function contractSlam(contract: string, red: boolean, sub: string, doubled: number, from: Element, target: Element | null) {
  log("contractSet", { level: doubled ? 3 : 2, extra: doubled });
  const f = from.getBoundingClientRect();
  if (!fx.motionOn() || !fx.fxLayer()) { sfx.contractSlam(doubled); if (target) fx.punch(target, 0.12, 300); return; }
  const seal = document.createElement("div");
  seal.className = "contractseal" + (doubled ? " dbl" : "");
  const small = document.createElement("small"); small.textContent = "合約";
  const b = document.createElement("b"); b.textContent = contract; if (red) b.className = "red";
  const em = document.createElement("em"); em.textContent = sub;
  seal.append(small, b, em);
  fx.fxLayer().appendChild(seal);
  const w = seal.offsetWidth, h = seal.offsetHeight;
  const cx = f.left + f.width / 2, cy = f.top + f.height / 2;
  Object.assign(seal.style, { left: `${cx - w / 2}px`, top: `${cy - h / 2}px` });
  sfx.contractSlam(doubled);
  await seal.animate([{ scale: "1.9", rotate: "-10deg", opacity: 0 }, { scale: "0.94", rotate: "-3deg", opacity: 1, offset: 0.6 }, { scale: "1", rotate: "-3deg", opacity: 1 }],
    { duration: fx.ms(220), easing: "ease-out", fill: "forwards" }).finished.catch(() => {});
  fx.shockwave(cx, cy, { size: 200 });
  burst(cx, cy, { count: 10, kinds: ["dust", "star"], speed: 180 });
  await fx.wait(fx.ms(420));
  if (target) {
    const t = target.getBoundingClientRect();
    const dx = t.left + t.width / 2 - cx, dy = t.top + t.height / 2 - cy;
    await seal.animate([{ translate: "0 0", scale: "1", rotate: "-3deg", opacity: 1 }, { translate: `${dx}px ${dy}px`, scale: String(Math.max(0.35, Math.min(1, t.height / h))), rotate: "0deg", opacity: 0.25 }],
      { duration: fx.ms(300), easing: "cubic-bezier(.55,0,.85,.4)", fill: "forwards" }).finished.catch(() => {});
    sfx.impactAt(0, 0.5);
    fx.punch(target, 0.14, 320);
    fx.glow(target, 600);
  }
  seal.remove();
}

// ---------------- ScoreAnimator ----------------

// 數字滾動到目標，越跑越快，每一步 Tick 一下；hit = 最後重擊一下。可以被 skip() 直接跳到結果
export function rollNumber(el: HTMLElement, from: number, to: number, opt: { dur?: number; prefix?: string; hit?: boolean; signal?: { skip: boolean } } = {}): Promise<void> {
  const fmt = (n: number) => `${opt.prefix ?? ""}${n}`;
  el.dataset.v = String(to);
  if (from === to || !fx.motionOn() || opt.signal?.skip) { el.textContent = fmt(to); if (opt.hit && from !== to && !opt.signal?.skip) sfx.scoreHit(); return Promise.resolve(); }
  const steps = Math.min(Math.abs(to - from), 24);
  const dur = fx.ms(opt.dur ?? Math.min(900, 160 + steps * 45));
  return new Promise(resolve => {
    const t0 = performance.now();
    let lastShown = from;
    const frame = (t: number) => {
      if (opt.signal?.skip) { el.textContent = fmt(to); resolve(); return; }
      const k = Math.min(1, (t - t0) / dur);
      const eased = k * k;   // 漸強：越後面跳得越快
      const v = Math.round(from + (to - from) * eased);
      if (v !== lastShown) { lastShown = v; el.textContent = fmt(v); sfx.tick(k); }
      if (k < 1) requestAnimationFrame(frame);
      else {
        el.textContent = fmt(to);
        fx.punch(el, opt.hit ? 0.34 : 0.16, opt.hit ? 420 : 260);
        if (opt.hit) sfx.scoreHit();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

// 小數字翻頁（墩數 5 → 6）：舊的往上翻走、新的從下面彈上來；boost = 連勝時回彈更大
export function flipNumber(el: HTMLElement, text: string, tick = true, boost = 0) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!fx.motionOn()) return;
  const peak = 1.18 + boost;
  el.animate([
    { translate: "0 0.5em", opacity: 0, scale: String(peak + 0.12) }, { translate: "0 -0.08em", opacity: 1, scale: String(peak), offset: 0.6 }, { translate: "0 0", scale: "1" },
  ], { duration: fx.ms(320 + boost * 300), easing: fx.EASE.spring });
  if (tick) sfx.tick(0.4 + boost);
}
