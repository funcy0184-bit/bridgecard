// 設定面板（牌桌選單、首頁「設定」、故事頁共用）：切換和滑桿都要立刻有回應，但演出強度低。
import * as fx from "./fx";
import { sfx } from "./sound";

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
  sl.textContent = "動畫強度";
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
    toggle("快速動畫模式", () => s.fast, v => { s.fast = v; }),
    toggle("畫面震動", () => s.shake, v => { s.shake = v; }, () => { if (s.shake) fx.shake(box, 5, 220); }),
    toggle("粒子效果", () => s.particles, v => { s.particles = v; }),
    slider("音效音量", () => s.sfx, v => { s.sfx = v; }, () => sfx.select()),
    slider("背景音樂", () => s.music, v => { s.music = v; }, () => {}),
    toggle("手機震動", () => s.vibrate, v => { s.vibrate = v; }, () => fx.buzz(30)),
  );
  if (fx.reduced) {
    const note = document.createElement("p");
    note.className = "setnote";
    note.textContent = "你的手機開了「減少動態效果」，預設用低強度、不震動；想要的話可以在這裡打開。";
    box.appendChild(note);
  }
}
