// 阿元的表情與講話的動態（正式牌桌、故事教學共用）。
// 沒有另外畫表情圖：頭像容器跟著情緒動一下（只動 scale／translate／rotate，跟原本的 transform 疊在一起不打架），
// 旁邊冒一個小記號（！、♪、？、…、＃）一下就收；平常保持穩定，不會一直動。
// 文字：一般淡入、驚訝彈一下、強烈吐槽放大＋小範圍抖動；減少動態效果時只淡入、不抖。
import * as fx from "./fx";
import type { Emo, Tfx } from "./ahe";

const MARK: Record<Emo, string> = { calm: "", smug: "♪", shock: "！", sulk: "＃", think: "？", sigh: "…" };

type K = { frames: Keyframe[]; dur: number; ease: string };
const MOVE: Record<Emo, K | null> = {
  calm: { frames: [{ translate: "0 0" }, { translate: "0 2px" }, { translate: "0 0" }], dur: 320, ease: "ease-in-out" },                           // 點個頭
  smug: { frames: [{ rotate: "0deg", scale: "1" }, { rotate: "-7deg", scale: "1.06" }, { rotate: "0deg", scale: "1" }], dur: 520, ease: "ease-out" }, // 得意地歪頭
  shock: { frames: [{ scale: "1" }, { scale: "1.28" }, { scale: "0.95" }, { scale: "1" }], dur: 420, ease: "cubic-bezier(.2,.9,.3,1.2)" },         // 嚇到放大
  sulk: { frames: [{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "3px 0" }, { translate: "-2px 0" }, { translate: "0 0" }], dur: 360, ease: "linear" }, // 不甘心抖一下
  think: { frames: [{ rotate: "0deg" }, { rotate: "8deg" }, { rotate: "8deg", offset: 0.7 }, { rotate: "0deg" }], dur: 700, ease: "ease-in-out" }, // 歪頭想
  sigh: { frames: [{ translate: "0 0", scale: "1" }, { translate: "0 4px", scale: "0.94" }, { translate: "0 0", scale: "1" }], dur: 640, ease: "ease-in-out" }, // 沉下去
};

// host：放記號的容器（position: relative）；img：要動的頭像
export function emote(host: HTMLElement | null, img: HTMLElement | null, emo: Emo | undefined) {
  if (!host || !img || !emo) return;
  const mark = MARK[emo];
  if (mark) {
    let m = host.querySelector<HTMLElement>(":scope > .emomark");
    if (!m) { m = document.createElement("span"); m.className = "emomark"; m.setAttribute("aria-hidden", "true"); host.appendChild(m); }
    m.textContent = mark;
    m.dataset.emo = emo;
    for (const a of m.getAnimations()) a.cancel();
    m.animate([{ opacity: 0, scale: "0.4", translate: "0 4px" }, { opacity: 1, scale: "1.15", translate: "0 0", offset: 0.18 }, { opacity: 1, scale: "1", offset: 0.75 }, { opacity: 0, scale: "1" }],
      { duration: fx.motionOn() ? fx.ms(1200) : 900, easing: "ease-out", fill: "forwards" });
  }
  const k = MOVE[emo];
  if (!k || !fx.motionOn()) return;
  for (const a of img.getAnimations()) if (a.id === "emo") a.cancel();      // 只取消上一個表情，不動原本的呼吸動畫
  const a = img.animate(k.frames, { duration: fx.ms(k.dur), easing: k.ease });
  a.id = "emo";
}

// 一句話出現的方式：一般淡入、驚訝彈一下、強烈吐槽放大加小抖（精簡品質或減少動態效果：只淡入）
export function textIn(el: HTMLElement, how: Tfx | undefined) {
  if (!fx.motionOn()) return;
  for (const a of el.getAnimations()) if (a.id === "say") a.cancel();
  const lite = fx.quality() === "lite";
  const kind = lite && how === "shout" ? "pop" : how ?? "fade";
  let a: Animation;
  if (kind === "shout") {
    a = el.animate([
      { opacity: 0, scale: "0.7" }, { opacity: 1, scale: "1.14", offset: 0.35 },
      { scale: "1.06", translate: "-2px 0", offset: 0.5 }, { scale: "1.04", translate: "2px 0", offset: 0.62 }, { scale: "1.02", translate: "-1px 0", offset: 0.74 },
      { opacity: 1, scale: "1", translate: "0 0" },
    ], { duration: fx.ms(520), easing: "ease-out" });
  } else if (kind === "pop") {
    a = el.animate([{ opacity: 0, scale: "0.85" }, { opacity: 1, scale: "1.07", offset: 0.6 }, { opacity: 1, scale: "1" }], { duration: fx.ms(320), easing: "cubic-bezier(.2,.9,.3,1.2)" });
  } else {
    a = el.animate([{ opacity: 0, translate: "-4px 0" }, { opacity: 1, translate: "0 0" }], { duration: fx.ms(220), easing: "ease-out" });
  }
  a.id = "say";
}
