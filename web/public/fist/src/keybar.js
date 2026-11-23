// keybar.js — 底部動態鍵位卡（DOM，疊在畫布底部 y=224～270 那一條）
//   · 同機雙人：左邊 P1（A/S/D）、右邊 P2（J/K/L）；單人／教學／線上：只顯示自己那組，置中
//   · 依階段換圖示與中文標籤：猜拳 ✊石頭／✌️剪刀／🖐️布（過熱那張反灰蓋「♨️ 過熱」）、拼刀照常三張、連打 🔥狂敲連打！、紅招只亮可翻滾的方向
//   · 卡片狀態與配色照 ART.hud.keyRow.cardStyle：normal／pressed（按下壓縮 85ms）／locked（斜紋、不能按）／parry_guide（藍招克制鍵發光）
//   · parry_guide 只在「出招提示：開」時出現；藍框、紅區、箭頭、鍵位圖示和按下回饋永遠顯示
//   · 藏招期間同機共用螢幕：按下只讓整組一起閃，不洩露按了哪一顆
//   · 觸控（手機）：卡片本身就是按鍵。按住＝按住鍵（長按贏拳鍵 0.3s 開紅招也行），放開＝放開鍵；
//     多指同時按互不干擾；連打大卡每一下輪流送左／中／右，手指連點才都算數
//     觸控模式時鍵位卡移到畫布下方的獨立按鍵區、放大到拇指好按（main.js 依 touchHeight() 讓出空間）
import { ART, CONFIG } from "./config.js";
import { PH, COUNTER, KEY_OF } from "./engine.js";

const CS = ART.hud.keyRow.cardStyle, BTN = ["L", "M", "R"];
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function injectStyle() {
  if (document.getElementById("keybarStyle")) return;
  const v = (k, st) => Object.entries(st).filter(([, x]) => typeof x === "string" && x.startsWith("#")).map(([n, x]) => `--${k}-${n}:${x};`).join("");
  const G = CS.states.parry_guide.glow, steps = G.alphaSteps;
  const css = `
  #keybar { position: fixed; display: flex; justify-content: center; align-items: center; gap: calc(var(--u) * 18px); pointer-events: none; z-index: 2; ${Object.entries(CS.states).map(([k, st]) => v(k, st)).join("")} }
  #keybar.two { justify-content: space-between; padding: 0 calc(var(--u) * 10px); }
  .kgroup { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 2px); }
  .kcap { font: 800 calc(var(--u) * 6.5px)/1 "Noto Sans TC", sans-serif; color: var(--cap, #8592A4); letter-spacing: .08em; }
  .kcards { display: flex; gap: calc(var(--u) * 4px); }
  .kcard, .kmash { position: relative; box-sizing: border-box; height: calc(var(--u) * 33px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 1px);
    border: calc(var(--u) * 1px) solid var(--normal-outer); background: var(--normal-fill); color: var(--normal-glyph);
    box-shadow: inset 0 0 0 calc(var(--u) * 1px) var(--normal-rim), inset 0 calc(var(--u) * 1px) 0 calc(var(--u) * 1px) var(--normal-highlight), 0 calc(var(--u) * ${CS.states.normal.bottomBevelPx}px) 0 var(--normal-shadow);
    clip-path: polygon(${CS.cornerCutPx * 2}px 0, calc(100% - ${CS.cornerCutPx * 2}px) 0, 100% ${CS.cornerCutPx * 2}px, 100% calc(100% - ${CS.cornerCutPx * 2}px), calc(100% - ${CS.cornerCutPx * 2}px) 100%, ${CS.cornerCutPx * 2}px 100%, 0 calc(100% - ${CS.cornerCutPx * 2}px), 0 ${CS.cornerCutPx * 2}px);
    transition: transform 60ms ease-out, opacity 120ms; }
  .kcard { width: calc(var(--u) * 46px); }
  .kmash { width: calc(var(--u) * 146px); }
  .kl { font: 900 calc(var(--u) * 9px)/1 "Noto Sans TC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; white-space: nowrap; }
  .kmash .kl { font-size: calc(var(--u) * 12px); }
  .kk { font: 800 calc(var(--u) * 6px)/1 ui-monospace, monospace; opacity: .75; }
  .ksub { position: absolute; top: calc(var(--u) * -8px); font: 800 calc(var(--u) * 5.5px)/1 "Noto Sans TC", sans-serif; color: #FF9A78; white-space: nowrap; }
  .kcard.pressed, .kmash.pressed { transform: translateY(calc(var(--u) * ${CS.states.pressed.offsetYPx}px)) scale(.9); background: var(--pressed-fill); color: var(--pressed-glyph);
    box-shadow: inset 0 0 0 calc(var(--u) * 1px) var(--pressed-rim), inset 0 calc(var(--u) * 1px) 0 calc(var(--u) * 1px) var(--pressed-highlight), 0 calc(var(--u) * ${CS.states.pressed.bottomBevelPx}px) 0 var(--pressed-shadow); transition: none; }
  .kcard.chosen { box-shadow: inset 0 0 0 calc(var(--u) * 1.5px) var(--pressed-rim), 0 calc(var(--u) * 2px) 0 var(--normal-shadow); }
  .kcard.locked { background: repeating-linear-gradient(135deg, var(--locked-fill) 0 calc(var(--u) * 2px), ${CS.states.locked.hatch.color} calc(var(--u) * 2px) calc(var(--u) * ${CS.states.locked.hatch.periodPx}px)); color: var(--locked-glyph);
    box-shadow: inset 0 0 0 calc(var(--u) * 1px) var(--locked-rim), 0 calc(var(--u) * ${CS.states.locked.bottomBevelPx}px) 0 var(--locked-shadow); opacity: .78; }
  .kcard.locked .kl { opacity: .7; }
  .kcard.parry { background: var(--parry_guide-fill); color: var(--parry_guide-glyph); box-shadow: inset 0 0 0 calc(var(--u) * 1px) var(--parry_guide-rim), 0 0 0 calc(var(--u) * ${G.widthPx}px) rgba(88,182,255,var(--glow, ${G.reducedMotionAlpha})), 0 calc(var(--u) * 2px) 0 var(--parry_guide-shadow); }
  .kcard.parry::after { content: ""; position: absolute; inset: 0; border: calc(var(--u) * 1.5px) solid ${G.color}; opacity: ${REDUCED ? G.reducedMotionAlpha : 1}; ${REDUCED ? "" : `animation: kglow ${G.stepMs * steps.length}ms steps(1) infinite;`} }
  @keyframes kglow { ${steps.map((a, i) => `${(i / steps.length * 100).toFixed(1)}% { opacity: ${a}; }`).join(" ")} }
  .kgroup.pulse .kcard { transform: scale(.94); transition: none; }
  .kmash { background: #3A1E12; color: #FFE186; box-shadow: inset 0 0 0 calc(var(--u) * 1px) #F2AB52, 0 calc(var(--u) * 2px) 0 #1A0D08; ${REDUCED ? "" : "animation: kmash 160ms steps(2) infinite;"} }
  @keyframes kmash { 50% { filter: brightness(1.25); } }
  .kgroup.out { opacity: .35; }
  .kcard.heat { background: #23262E; color: #9AA0AA; filter: grayscale(.85); box-shadow: inset 0 0 0 calc(var(--u) * 1px) #4A4F5A, 0 calc(var(--u) * 1px) 0 #0C111B; }
  .kcard.heat .kl { color: #FF9A62; filter: none; }
  .kcard.heat .ksub { color: #8592A4; }
  .kcard.heat::before, .kcard.heat::after { content: ""; position: absolute; top: calc(var(--u) * 2px); width: calc(var(--u) * 4px); height: calc(var(--u) * 4px); border-radius: 50%; background: rgba(170,176,188,.5); ${REDUCED ? "opacity: .4;" : "animation: ksmoke 1.4s ease-out infinite;"} }
  .kcard.heat::before { left: 30%; } .kcard.heat::after { left: 60%; animation-delay: .7s; }
  @keyframes ksmoke { 0% { transform: translateY(0) scale(.6); opacity: .7; } 100% { transform: translateY(calc(var(--u) * -10px)) scale(1.6); opacity: 0; } }
  .kcard.nope { animation: knope .18s steps(3); }
  @keyframes knope { 33% { transform: translateX(calc(var(--u) * -2px)); } 66% { transform: translateX(calc(var(--u) * 2px)); } }
  #keybar.touch { pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; padding: 6px 12px calc(6px + env(safe-area-inset-bottom)); box-sizing: border-box; background: linear-gradient(#0A0F1A00, #0A0F1A 18%); }
  #keybar.touch .kcard, #keybar.touch .kmash { cursor: pointer; touch-action: none; -webkit-tap-highlight-color: transparent; }
  #keybar.touch .kk { display: none; }
  #keybar.touch .kcard.locked { opacity: .55; }`;
  const el = document.createElement("style"); el.id = "keybarStyle"; el.textContent = css; document.head.appendChild(el);
}

export class KeyBar {
  constructor(root) {
    this.root = root; this.groups = []; this.showHints = true; this.touch = false; this.onInput = null; this.active = new Map();
    injectStyle();
    root.addEventListener("contextmenu", e => e.preventDefault());              // 長按不跳選單
  }
  // 觸控按鍵：pointerdown＝按下、pointerup／cancel／失去捕捉＝放開（每根手指各自追蹤）
  bindTouch(g, el, btnOf) {
    el.addEventListener("pointerdown", e => {
      if (!this.touch && e.pointerType === "mouse") return;                       // 桌機滑鼠不搶鍵盤的工作（觸控模式下才收）
      e.preventDefault();
      if (g.seat < 0 || this.active.has(e.pointerId)) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ }
      const btn = btnOf();
      this.active.set(e.pointerId, { seat: g.seat, btn });
      this.onInput?.(g.seat, "down", btn);
    });
    const up = e => { const a = this.active.get(e.pointerId); if (!a) return; this.active.delete(e.pointerId); this.onInput?.(a.seat, "up", a.btn); };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, up);
  }
  releaseAll() { for (const [, a] of this.active) this.onInput?.(a.seat, "up", a.btn); this.active.clear(); }
  setTouch(on) { this.touch = on; this.root.classList.toggle("touch", on); for (const g of this.groups) { g.sig = ""; this.caption(g); } }
  // 觸控按鍵區高度（px）：卡片 33u ＋ 標題 ＋ 上下留白；最多佔畫面高度 34%
  touchLayout(w, h) {
    const n = Math.max(1, this.groups.length), cardsW = n * (46 * 3 + 4 * 2) + (n - 1) * 18 + 20;
    const u = Math.max(1, Math.min(2.4, (w - 24) / cardsW, (h * (h > w ? 0.34 : 0.28) - 18) / 43));   // 橫拿少佔一點高度
    return { u, height: Math.round(43 * u + 18) };
  }
  /** @param {Array<{seat:number, keys:{L:string,M:string,R:string}, title:string, color?:string}>} groups */
  setup(groups) {
    this.root.innerHTML = ""; this.groups = [];
    this.root.classList.toggle("two", groups.length > 1);
    for (const g of groups) {
      const el = document.createElement("div"); el.className = "kgroup"; el.dataset.seat = g.seat;
      el.innerHTML = `<div class="kcap" style="--cap:${g.color ?? "#8592A4"}"></div><div class="kcards">${BTN.map(b => `<div class="kcard" data-btn="${b}"><span class="ksub"></span><span class="kl"></span><span class="kk">${g.keys[b]}</span></div>`).join("")}<div class="kmash" hidden><span class="kl"></span><span class="kk">${BTN.map(b => g.keys[b]).join(" ")} 任意鍵</span></div></div>`;
      this.root.appendChild(el);
      const G = { ...g, el, cards: Object.fromEntries(BTN.map(b => [b, el.querySelector(`.kcard[data-btn="${b}"]`)])), mash: el.querySelector(".kmash"), sig: "", rot: 0 };
      this.groups.push(G);
      this.caption(G);
      for (const b of BTN) this.bindTouch(G, G.cards[b], () => b);
      this.bindTouch(G, G.mash, () => BTN[G.rot = (G.rot + 1) % 3]);              // 連打：每一下輪流送不同鍵
    }
  }
  clear() { this.releaseAll(); this.setup([]); }
  setSeat(i, seat) { const g = this.groups[i]; if (g) { g.seat = seat; g.el.dataset.seat = seat; g.sig = ""; } }
  setTitle(i, title) { const g = this.groups[i]; if (g) { g.title = title; this.caption(g); } }
  caption(g) { g.el.querySelector(".kcap").textContent = this.touch ? g.title.replace(/（[^）]*）/g, "") : g.title; }   // 觸控時拿掉鍵盤說明
  // 疊在畫布底部那一條（邏輯座標 y=224～270），大小跟著畫布倍率
  place(canvas, scale) {
    if (this.touch) {                                                             // 觸控：畫布下方獨立按鍵區
      const { u, height } = this.touchLayout(innerWidth, innerHeight);
      Object.assign(this.root.style, { left: "0px", top: "", bottom: "0px", width: "100%", height: `${height}px` });
      this.root.style.setProperty("--u", String(u));
      return;
    }
    const r = canvas.getBoundingClientRect(), top = 224 * scale;
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top + top}px`, width: `${r.width}px`, height: `${r.height - top}px` });
    this.root.style.setProperty("--u", String(Math.max(0.75, scale)));
  }
  press(seat, btn, view) {
    const g = this.groups.find(x => x.seat === seat);
    if (!g) return;
    const shared = view && view.seat < 0 && view.phase === PH.RPS && view.t >= (view.reveal ?? CONFIG.rps.reveal);   // 同機藏招：整組閃，不說是哪顆
    const el = shared ? null : g.mash.hidden ? g.cards[btn] : g.mash;
    const heat = el && el.classList.contains("heat");
    const target = el ?? g.el, cls = heat ? "nope" : el ? "pressed" : "pulse";
    target.classList.remove(cls); void target.offsetWidth; target.classList.add(cls);
    clearTimeout(target._kt); target._kt = setTimeout(() => target.classList.remove(cls), CS.states.pressed.durationMs + 30);
  }
  // 依目前畫面算每張卡的標籤與狀態（只在有變化時動 DOM）
  update(view) {
    if (!view) return;
    for (const g of this.groups) {
      if (g.seat < 0) continue;
      const st = this.stateFor(view, g.seat), sig = JSON.stringify(st) + this.showHints;
      if (sig === g.sig) continue;
      g.sig = sig;
      g.el.classList.toggle("out", !!st.out);
      g.mash.hidden = !st.mash;
      for (const b of BTN) {
        const c = g.cards[b], s = st.cards[b];
        c.hidden = !!st.mash;
        const keep = ["pressed", "nope"].filter(k => c.classList.contains(k));   // 換狀態時保留正在播的按下回饋（不然選拳那一下的壓縮會被吃掉）
        c.className = `kcard ${s.state}`; for (const k of keep) c.classList.add(k);
        c.querySelector(".kl").textContent = s.label || "　";
        c.querySelector(".ksub").textContent = s.sub ?? "";
      }
      if (st.mash) g.mash.querySelector(".kl").textContent = CONFIG.cards.mash;
    }
  }
  stateFor(view, seat) {
    const f = view.fighters[seat], r = view.round, ph = view.phase, C = CONFIG.cards;
    const cards = {}, set = (labels, state = "normal") => { for (const b of BTN) cards[b] = { label: labels[b], state }; };
    set(C.rps, "locked");
    if (!f || f.out) return { cards, out: true };
    if (ph === PH.RPS) {
      set(C.rps);
      if (["rock", "scissors", "paper"].includes(f.stance)) cards[KEY_OF[f.stance]].state = "chosen";   // 自己的已選手勢（共用螢幕藏招時 view 已遮掉）
      if (f.heat) cards[KEY_OF[f.heat]] = { label: C.heat, state: "heat", sub: C.rps[KEY_OF[f.heat]] };   // ♨️ 過熱：這輪不能出
    } else if (ph === PH.CLASH_INPUT) {                                   // 拼刀預輸入：三張都能按（過熱不限制），顯示填了幾格
      const n = view.clash?.count?.[seat] ?? 0;
      set(C.rps, n >= CONFIG.clashMode.slots ? "locked" : "normal");
      cards.M.sub = `劍格 ${n}/${CONFIG.clashMode.slots}`;
    } else if (ph === PH.MASH && r) {
      if (r.att === seat) return { cards, mash: true };
    } else if (ph === PH.SELECT && r) {
      if (r.att === seat) { set(C.rps); if (f.power >= CONFIG.select.redCost) cards[r.winKey].sub = "長按＝紅光"; }
    } else if (ph === PH.WINDOW && r?.type && r.def === seat) {
      if (r.done) set(r.type === "red" ? C.roll : C.rps, "locked");                   // 判定窗只認第一下：按過就鎖
      else if (r.type === "blue") { set(C.rps); if (this.showHints && r.gesture) cards[KEY_OF[COUNTER[r.gesture]]].state = "parry"; }
      else { set(C.roll, "locked"); if (r.dirs.includes(-1)) cards.L.state = "normal"; if (r.dirs.includes(1)) cards.R.state = "normal"; }
    } else if (ph === PH.WINDOW && r?.type === "red") set(C.roll, "locked");
    return { cards };
  }
}
