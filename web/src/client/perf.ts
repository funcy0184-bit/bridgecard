// 自動特效品質：只在對局畫面、選了「自動」時量實際幀時間，依一段時間的平均升降一級。
//   · 每 2 秒算一次平均（超過 250ms 的空檔不算，例如切到背景）
//   · 連續 2 段平均 > 24ms（約 42fps 以下）才降一級；連續 5 段 < 18ms 才升一級
//   · 改過之後冷卻 8 秒，避免一次卡頓就降級、或來回升降造成閃動
//   · 頁面在背景、離開對局、改成手動品質、或動畫關閉／簡化時，迴圈停止
import * as fx from "./fx";

const ORDER: fx.Level[] = ["lite", "standard", "full"];
const MAX = fx.lowEnd ? 1 : 2;           // 低階手機最多到標準
let raf = 0, last = 0, acc = 0, n = 0, winStart = 0, slow = 0, quick = 0, cool = 0, active = false;
export const perfStats = { avg: 0, windows: 0, changes: 0, level: fx.getAutoLevel() as string };
(globalThis as unknown as { __hbPerf?: typeof perfStats }).__hbPerf = perfStats;

const wanted = () => active && fx.settings.quality === "auto" && fx.settings.intensity >= 2 && typeof document !== "undefined" && !document.hidden;

function loop(t: number) {
  if (!wanted()) { raf = 0; return; }
  const dt = t - last;
  last = t;
  if (dt > 0 && dt < 250) { acc += dt; n++; }
  if (t - winStart >= 2000) {
    if (n >= 20) judge(acc / n, t);
    acc = 0; n = 0; winStart = t;
  }
  raf = requestAnimationFrame(loop);
}

function judge(avg: number, t: number) {
  perfStats.avg = Math.round(avg * 10) / 10;
  perfStats.windows++;
  if (avg > 24) { slow++; quick = 0; } else if (avg < 18) { quick++; slow = 0; } else { slow = 0; quick = 0; }
  if (t < cool) return;
  const cur = ORDER.indexOf(fx.getAutoLevel());
  let next = cur;
  if (slow >= 2 && cur > 0) next = cur - 1;
  else if (quick >= 5 && cur < MAX) next = cur + 1;
  if (next === cur) return;
  fx.setAutoLevel(ORDER[next]);
  perfStats.level = ORDER[next]; perfStats.changes++;
  slow = 0; quick = 0; cool = t + 8000;
}

function start() {
  if (raf || !wanted()) return;
  last = performance.now(); winStart = last; acc = 0; n = 0;
  raf = requestAnimationFrame(loop);
}

// 進入／離開對局時呼叫
export function watchPerf(on: boolean) {
  active = on;
  if (on) start(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    // 背景：暫停裝飾動畫（CSS 看 .paused），回來時不補播
    document.documentElement.classList.toggle("paused", document.hidden);
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } } else start();
  });
  fx.onSettings(() => { if (wanted()) start(); });
}
