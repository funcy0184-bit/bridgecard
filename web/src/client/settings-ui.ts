// 設定面板（牌桌選單、首頁「設定」、故事頁共用）：切換和滑桿都要立刻有回應，但演出強度低。
import * as fx from "./fx";
import { sfx } from "./sound";

declare const __BUILD__: { sha: string; at: string } | undefined;
export const BUILD = typeof __BUILD__ !== "undefined" && __BUILD__ ? __BUILD__ : { sha: "dev", at: "" };

// 回報問題時貼給 Claude 的資訊：版本、網址、裝置、螢幕、設定（不含任何個人資料或牌局內容）
export function reportText(): string {
  const s = fx.settings;
  return [
    "【來打橋牌 回報資訊】",
    `版本：${BUILD.sha}${BUILD.at ? `（${BUILD.at}）` : ""}`,
    `頁面：${location.pathname}${location.search}`,
    `畫面大小：${innerWidth}×${innerHeight}（像素比 ${devicePixelRatio}）`,
    `裝置：${navigator.userAgent}`,
    `設定：動畫${fx.INTENSITY_LABELS[s.intensity]}${s.fast ? "＋加快" : ""}、震動${s.shake ? "開" : "關"}、粒子${s.particles ? "開" : "關"}、音效 ${Math.round(s.sfx * 100)}、音樂 ${Math.round(s.music * 100)}${s.muted ? "、靜音" : ""}`,
  ].join("\n");
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void, onChange?: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting";
  const name = document.createElement("span");
  name.textContent = label;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "toggle";
  const sync = () => { b.setAttribute("aria-pressed", String(get())); b.setAttribute("aria-label", `${label}：${get() ? "開" : "關"}`); };
  sync();
  b.addEventListener("click", () => {
    set(!get()); fx.saveSettings(); sync();
    sfx.toggle(get());
    fx.punch(b, 0.08, 200);
    onChange?.();
  });
  row.append(name, b);
  return row;
}

function slider(label: string, get: () => number, set: (v: number) => void, preview: () => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "setting";
  const name = document.createElement("span");
  name.textContent = label;
  const wrap = document.createElement("span");
  wrap.className = "range";
  const r = document.createElement("input");
  r.type = "range"; r.min = "0"; r.max = "100"; r.step = "5";
  r.value = String(Math.round(get() * 100));
  const out = document.createElement("output");
  out.textContent = r.value;
  const paint = () => r.style.setProperty("--p", `${r.value}%`);
  paint();
  let t = 0;
  r.addEventListener("input", () => {
    set(Number(r.value) / 100); out.textContent = r.value; paint();
    clearTimeout(t);
    t = window.setTimeout(() => { fx.saveSettings(); preview(); }, 90);
  });
  wrap.append(r, out);
  row.append(name, wrap);
  return row;
}

export function renderSettings(box: HTMLElement) {
  const s = fx.settings;
  box.replaceChildren();

  const seg = document.createElement("div");
  seg.className = "setting";
  const sl = document.createElement("span");
  sl.textContent = "動畫效果";
  const group = document.createElement("div");
  group.className = "seg";
  fx.INTENSITY_LABELS.forEach((l, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = l;
    b.setAttribute("aria-pressed", String(s.intensity === i));
    b.addEventListener("click", () => {
      s.intensity = i as fx.Intensity; fx.saveSettings();
      for (const x of Array.from(group.children)) x.setAttribute("aria-pressed", String(x === b));
      sfx.select();
      fx.bounce(b);
    });
    group.appendChild(b);
  });
  seg.append(sl, group);

  box.append(
    seg,
    toggle("加快動畫", () => s.fast, v => { s.fast = v; }),
    toggle("畫面震動", () => s.shake, v => { s.shake = v; }, () => { if (s.shake) fx.shake(box, 5, 220); }),
    toggle("粒子特效", () => s.particles, v => { s.particles = v; }),
    slider("音效", () => s.sfx, v => { s.sfx = v; }, () => sfx.select()),
    slider("背景音樂", () => s.music, v => { s.music = v; }, () => {}),
    toggle("手機震動", () => s.vibrate, v => { s.vibrate = v; }, () => fx.buzz(30)),
  );
  // 版本、回報、重設
  const foot = document.createElement("div");
  foot.className = "setfoot";
  const ver = document.createElement("small");
  ver.textContent = `版本 ${BUILD.sha}${BUILD.at ? ` · ${BUILD.at}` : ""}`;
  const copy = document.createElement("button");
  copy.type = "button"; copy.className = "btn paper small"; copy.textContent = "遇到問題？告訴我們";
  copy.title = "複製這支手機的版本、畫面大小和設定，連同截圖一起傳過來";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reportText()); copy.textContent = "回報資訊複製好了，連同截圖傳過來"; }
    catch { copy.textContent = "這個瀏覽器不能複製，截圖這一頁就好"; }
    sfx.select();
  });
  const reset = document.createElement("button");
  reset.type = "button"; reset.className = "btn ghost small"; reset.textContent = "重設這支手機的進度";
  reset.addEventListener("click", () => {
    if (!confirm("要清掉這支手機上的教學進度、跟阿禾打到一半的那局，還有「第一次玩」的提示嗎？（設定會留著，朋友的牌桌不受影響）")) return;
    for (const k of ["hb.story.v2", "hb-solo-v1", "hb-story-offered", "hb-news-seen"]) { try { localStorage.removeItem(k); } catch { /* 無痕模式 */ } }
    location.href = "/";
  });
  foot.append(ver, copy, reset);
  box.appendChild(foot);
  if (fx.reduced) {
    const note = document.createElement("p");
    note.className = "setnote";
    note.textContent = "你的手機開了「減少動態效果」，所以先用簡化動畫、不震動；想要的話可以在這裡打開。";
    box.appendChild(note);
  }
}
