// FeedbackManager ＋ ScoreAnimator：依照「真的發生的遊戲事件」決定回饋強度。
//   Level 1 一般互動：卡牌微彈、小陰影、短音效、幾顆金粉
//   Level 2 重要事件（王吃、關鍵一墩、最後一墩、加倍）：局部金光、快速縮放、小粒子、低幅震動、兩層音效
//   Level 3 重大獎勵（合約達成、擊破合約、整場勝利）：短暫 Hitstop、大數字、局部衝擊、星辰紙屑、背景亮一下
import * as fx from "./fx";
import { burstAt, burst, shower } from "./particles";
import { sfx } from "./sound";

export type Level = 1 | 2 | 3;

// 贏墩的特效（敗方用低一階、比較安靜的版本，不放勝利粒子）
export function trickFeedback(level: Level, mine: boolean, card: Element | null, felt: Element) {
  sfx.win(mine);
  if (card) {
    fx.glow(card, level >= 2 ? 700 : 520);
    fx.punch(card, level === 1 ? 0.14 : 0.24, level === 1 ? 260 : 340);
  }
  if (!mine) {
    if (level >= 2) fx.shake(felt, 3, 200);
    return;
  }
  if (card) burstAt(card, { count: level === 1 ? 8 : level === 2 ? 18 : 34, kinds: level === 1 ? ["dust"] : ["dust", "star"], speed: level === 1 ? 140 : 240, life: 0.7 });
  if (level >= 2) { fx.shake(felt, level === 3 ? 9 : 5, level === 3 ? 320 : 220); sfx.impact(level === 3 ? 1 : 0.6); }
  if (level === 3) {
    fx.flash(0.8);
    if (card) burstAt(card, { count: 22, kinds: ["paper", "suit", "star"], speed: 300, life: 1.2 });
  }
}

// Hitstop：重大事件前停一下下（40–70ms）
export const hitstop = (level: Level) => fx.wait(level === 3 ? 70 : level === 2 ? 45 : 0);

// 合約達成／擊破合約（Level 3）、對手達成（安靜的失落）
export function contractFeedback(good: boolean, anchor: Element, felt: Element) {
  sfx.contract(good);
  if (!good) { fx.shake(felt, 3, 220); return; }
  fx.flash(1);
  fx.shake(felt, 10, 340);
  burstAt(anchor, { count: 40, kinds: ["star", "dust", "paper", "suit"], speed: 340, life: 1.3 });
}

// 整場勝利：紙屑星辰灑下來＋勝利音效
export function victory(el?: Element) {
  sfx.victory();
  fx.flash(1.1);
  shower(90);
  if (el) burstAt(el, { count: 30, kinds: ["star", "dust"], speed: 320 });
}

// 印章敲下去：叫牌、加倍、加入房間
export function stamp(el: Element, heavy = false) {
  fx.stampIn(el);
  setTimeout(() => {
    if (heavy) sfx.double(); else sfx.stamp();
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, { count: heavy ? 10 : 5, kinds: ["ink"], speed: 120, gravity: 0, life: 0.45, spread: Math.PI * 2 });
  }, fx.ms(160));
}

// ---------------- ScoreAnimator ----------------

// 數字滾動到目標，越跑越快，每一步 Tick 一下；最後一下重擊。可以被 skip() 直接跳到結果
export function rollNumber(el: HTMLElement, from: number, to: number, opt: { dur?: number; prefix?: string; hit?: boolean; signal?: { skip: boolean } } = {}): Promise<void> {
  const fmt = (n: number) => `${opt.prefix ?? ""}${n}`;
  el.dataset.v = String(to);
  if (from === to || !fx.motionOn() || opt.signal?.skip) { el.textContent = fmt(to); return Promise.resolve(); }
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
        fx.punch(el, 0.28, 360);
        if (opt.hit) sfx.scoreHit();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

// 小數字翻頁（墩數 5 → 6）：舊的往上翻走、新的從下面彈上來，放大一下
export function flipNumber(el: HTMLElement, text: string, tick = true) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!fx.motionOn()) return;
  el.animate([
    { translate: "0 0.5em", opacity: 0, scale: "1.3" }, { translate: "0 -0.08em", opacity: 1, scale: "1.18", offset: 0.6 }, { translate: "0 0", scale: "1" },
  ], { duration: fx.ms(320), easing: fx.EASE.spring });
  if (tick) sfx.tick(0.4);
}
