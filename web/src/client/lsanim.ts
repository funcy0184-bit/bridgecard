// P2.5-B 牌桌演出：實際的動畫（給 lsstage 的導演用）
//   · 只動 transform／opacity／scale；飛行的牌是放在特效層（#fx）的複製品，用完就移除
//   · 經典模式調好的零件直接用：加速飛行 slamFly、落桌壓扁＋接觸陰影 contact、拍桌聲 slap、翻牌聲 faceUp
//   · 三種等級：full（標準以上）／calm（系統減少動態、動畫「簡化」：不飛不翻，直接到位＋淡入）／off（動畫關閉、背景分頁：直接到終點）
//   · 對手的飛牌只用牌背節點；牌面只在翻牌之後由 lstable 依伺服器送來的牌面建立
import type { TrickRecord } from "../laststand/engine";
import * as fx from "./fx";
import { contact, flightMs, slamFly } from "./impactfx";
import type { StageAnims } from "./lsstage";
import { sfx } from "./sound";

export interface AnimRefs {
  render(): void;
  seat(): number;
  handNode(id: number): HTMLElement | undefined;
}
const $ = (id: string) => document.getElementById(id)!;

export type MotionLevel = "full" | "calm" | "off";
export function motionLevel(): MotionLevel {
  if (typeof document !== "undefined" && document.hidden) return "off";
  if (!fx.motionOn()) return "off";
  if (fx.reduced || fx.settings.intensity <= 1) return "calm";
  return "full";
}

// 正在跑的動畫、飛行中的複製品：取消時一次收乾淨（取消＝回到原本的樣子，快照會重新擺好）
const live = new Set<Animation>();
const clones = new Set<HTMLElement>();
function anim(el: Element, frames: Keyframe[], opt: KeyframeAnimationOptions): Animation {
  const a = el.animate(frames, opt);
  live.add(a);
  a.finished.then(() => live.delete(a), () => live.delete(a));
  return a;
}
const done = (a: Animation) => a.finished.then(() => {}, () => {});
const settle = (el: Element) => Promise.all(el.getAnimations().map(done)).then(() => {});
function clone(el: HTMLElement) { el.classList.add("lsfly"); clones.add(el); return el; }
function drop(el: HTMLElement | null) { if (!el) return; el.remove(); clones.delete(el); }

// 飛行途中翻成牌背（蓋牌＝牌面朝下放到桌上）
function toBack(el: HTMLElement) {
  anim(el, [{ scale: "1 1" }, { scale: "0 1" }], { duration: fx.ms(80), fill: "forwards" }).finished.then(() => {
    el.className = "card back flying lsfly";
    el.replaceChildren();
    anim(el, [{ scale: "0 1" }, { scale: "1 1" }], { duration: fx.ms(100), fill: "forwards" });
  }, () => {});
}
// 淡入（減少動態時代替飛行、翻面）
const fadeIn = (el: Element, dur = 140) => done(anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: "ease-out" }));

// 翻牌：出牌位裡已經是牌面（lstable 依伺服器資料畫好），上面蓋一張牌背轉過去、牌面從側邊轉回來
function flipIn(slot: HTMLElement, delay: number, lv: MotionLevel, mine: boolean): Promise<void> {
  const face = slot.firstElementChild as HTMLElement | null;
  if (!face || lv === "off") return Promise.resolve();
  const cover = fx.backEl("lsflipback");
  slot.appendChild(cover);
  if (lv === "calm") {
    const a = anim(cover, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay, fill: "both" });
    return done(a).then(() => { cover.remove(); sfx.faceUp(mine); });
  }
  const half = fx.ms(130);
  const a1 = anim(cover, [{ transform: "perspective(520px) rotateY(0deg) scale(1)" }, { transform: "perspective(520px) rotateY(90deg) scale(1.08)" }],
    { duration: half, delay, easing: "cubic-bezier(.5,0,.9,.6)", fill: "both" });
  const a2 = anim(face, [{ transform: "perspective(520px) rotateY(-90deg) scale(1.08)" }, { transform: "perspective(520px) rotateY(0deg) scale(1)" }],
    { duration: half, delay: delay + half, easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" });
  done(a1).then(() => { cover.remove(); sfx.faceUp(mine); });
  return Promise.all([done(a1), done(a2)]).then(() => { cover.remove(); });
}

export function domAnims(r: AnimRefs): StageAnims {
  let mine: HTMLElement | null = null;      // 我的蓋牌飛行中的複製品
  return {
    instant: () => motionLevel() === "off",
    away: () => typeof document !== "undefined" && document.hidden,
    render: () => r.render(),
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as number),
    nextFrame: fn => requestAnimationFrame(() => fn()),

    // 我的蓋牌：抽離 → 弧線加速飛向出牌位、半路翻成牌背 → 落桌壓扁回彈＋接觸陰影；拍桌聲排在落桌那一刻
    async myFly(id) {
      const node = r.handNode(id), slot = $("lsMySlot"), lv = motionLevel();
      sfx.swish(1);
      if (lv !== "full" || !node) {
        sfx.slap(1);
        return;                                   // 減少動態：不飛（出牌位的牌背直接出現，lstable 會淡入）
      }
      const from = node.getBoundingClientRect();
      const c = clone(fx.cardEl(id));
      mine = c;
      fx.pin(c, from);
      // 抽離：往上提一點、微微放大
      const pull = anim(c, [{ translate: "0 0", scale: "1" }, { translate: "0 -10px", scale: "1.06" }], { duration: fx.ms(70), easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" });
      await done(pull);
      if (mine !== c) return;
      pull.cancel();
      const lifted = new DOMRect(from.left - from.width * 0.03, from.top - 10 - from.height * 0.03, from.width * 1.06, from.height * 1.06);
      const to = slot.getBoundingClientRect();
      sfx.slap(1.1, flightMs(240) / 1000);
      await slamFly(c, lifted, to, { dur: 240, lift: 26, flipAt: () => toBack(c) });
      if (mine !== c) return;
      contact(c, $("lsFelt"), 1.1);
      await settle(c);
      // 驗收用：落桌那一刻複製品和出牌位的位置（誤差要很小，交接才不會跳一下）
      const cb = c.getBoundingClientRect(), sb = slot.getBoundingClientRect();
      (globalThis as Record<string, unknown>).__hbLSLand = { dx: Math.abs(cb.left + cb.width / 2 - sb.left - sb.width / 2), dy: Math.abs(cb.top + cb.height / 2 - sb.top - sb.height / 2), dw: Math.abs(cb.width - sb.width) };
    },
    myRest() { drop(mine); mine = null; },
    async myBack(id) {
      const c = mine;
      mine = null;
      sfx.deny();
      if (!c) return;
      const node = r.handNode(id);
      const to = (node ?? $("lsHand")).getBoundingClientRect();
      if (motionLevel() === "full") {
        const from = c.getBoundingClientRect();
        for (const a of c.getAnimations()) a.cancel();
        const face = fx.cardEl(id);
        c.className = face.className + " flying lsfly";
        c.replaceChildren(...Array.from(face.childNodes));
        await fx.fly(c, from, to, { dur: 220, lift: 12 });
      }
      drop(c);
    },

    // 對手蓋牌：從對手名牌的牌背堆飛一張牌背出來，落桌輕一點
    async oppLand() {
      const slot = $("lsOppSlot"), lv = motionLevel();
      if (lv === "off") return;
      if (lv === "calm") { slot.classList.remove("incoming"); sfx.slap(0.8); await fadeIn(slot); return; }
      const backs = $("lsOppBacks");
      const src = (backs.lastElementChild ?? backs) as HTMLElement;
      const from = src.getBoundingClientRect(), to = slot.getBoundingClientRect();
      if (!from.width || !to.width) { slot.classList.remove("incoming"); return; }
      const c = clone(fx.backEl());
      const ob = $("lsOpp").getBoundingClientRect();
      (globalThis as Record<string, unknown>).__hbLSOppFrom = { inNameplate: from.top >= ob.top - 1 && from.bottom <= ob.bottom + 1 && from.left >= ob.left - 1 && from.right <= ob.right + 1 };
      sfx.slap(0.8, flightMs(260, 0.8) / 1000);
      await slamFly(c, from, to, { dur: 260, weight: 0.8, lift: 16 });
      contact(c, $("lsFelt"), 0.7);
      await settle(c);
      drop(c);
    },

    // 翻牌：對手先、我晚 120ms
    async reveal(rec) {
      const lv = motionLevel();
      if (lv === "off") return;
      await Promise.all([flipIn($("lsOppSlot"), 0, lv, false), flipIn($("lsMySlot"), fx.ms(120), lv, true)]);
      void rec;
    },

    // 判勝負：贏的那張震一下、落桌聲；同點兩張輕輕一頓
    async verdict(rec) {
      const lv = motionLevel();
      if (lv === "off") return;
      const me = r.seat(), my = $("lsMySlot"), opp = $("lsOppSlot");
      const win = rec.winner === me ? my : rec.winner === 1 - me ? opp : null;
      // 大墩（梭哈、或一墩輸贏 6 枚以上）：加一圈光環、低沉的一聲
      const big = rec.allIn >= 0 || rec.transfer + rec.poolTaken >= 6;
      if (win && big && lv === "full") { fx.shockAt(win, { size: 150 }); sfx.boom(0.55); }
      if (win) {
        sfx.land(rec.winner === me ? 0.9 : 0.6);
        if (lv === "full") await done(anim(win, [{ scale: "1.04" }, { scale: "1.13" }, { scale: "1" }, { scale: "1.04" }], { duration: fx.ms(280), easing: "ease-out" }));
        else await fx.wait(200);
      } else {
        sfx.land(0.5);
        if (lv === "full") await Promise.all([my, opp].map(el => done(anim(el, [{ translate: "0 0" }, { translate: "0 3px" }, { translate: "0 0" }], { duration: fx.ms(200), easing: "ease-out" }))));
        else await fx.wait(200);
      }
    },

    // 收牌：兩張牌收到贏家的名牌；同點收進中間的疊池
    async collect(rec, quick) {
      const lv = motionLevel();
      if (lv === "off") return;
      const me = r.seat(), slots = [$("lsOppSlot"), $("lsMySlot")];
      const pool = $("lsPool");
      const target = rec.winner === me ? $("lsMe") : rec.winner === 1 - me ? $("lsOpp") : !pool.hidden ? pool : $("lsDir");
      const tb = target.getBoundingClientRect(), tx = tb.left + tb.width / 2, ty = tb.top + tb.height / 2;
      for (const s of slots) s.classList.remove("win", "lose");
      sfx.swish(0.8);
      const dur = quick ? 170 : fx.ms(320);
      await Promise.all(slots.map((s, i) => {
        const c = s.firstElementChild as HTMLElement | null;
        if (!c) return Promise.resolve();
        if (lv === "calm") return done(anim(c, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }));
        const b = c.getBoundingClientRect(), dx = tx - (b.left + b.width / 2), dy = ty - (b.top + b.height / 2);
        return done(anim(c, [
          { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
          { transform: `translate(${dx * 0.35}px,${dy * 0.35 - 6}px) scale(.92) rotate(${i ? -4 : 4}deg)`, opacity: 1, offset: 0.4 },
          { transform: `translate(${dx}px,${dy}px) scale(.5) rotate(${i ? -8 : 8}deg)`, opacity: 0 },
        ], { duration: dur, delay: i * 40, easing: "cubic-bezier(.5,0,.8,.5)", fill: "forwards" }));
      }));
    },

    // 清桌：新的空出牌位淡入
    cleared() {
      if (motionLevel() === "off") return;
      for (const id of ["lsOppSlot", "lsMySlot"]) fadeIn($(id), 160);
    },

    clearFx() {
      for (const a of [...live]) { try { a.cancel(); } catch { /* 已經結束 */ } }
      live.clear();
      for (const c of [...clones]) drop(c);
      mine = null;
      for (const id of ["lsOppSlot", "lsMySlot"]) document.getElementById(id)?.querySelector(".lsflipback")?.remove();
    },
  };
}

// B2：讀心（只有自己看得到）：一道光掃過對手蓋著的牌
export function insightScan() {
  const slot = document.getElementById("lsOppSlot");
  if (!slot || motionLevel() !== "full") return;
  const bar = document.createElement("i");
  bar.className = "lsscan";
  slot.appendChild(bar);
  sfx.lift();
  anim(bar, [{ transform: "translateY(-110%)", opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { transform: "translateY(110%)", opacity: 0 }],
    { duration: fx.ms(520), easing: "ease-in-out" }).finished.then(() => bar.remove(), () => bar.remove());
}
