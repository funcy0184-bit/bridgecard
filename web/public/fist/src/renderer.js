// renderer.js — 畫面（只吃 engine.viewFor() 的資料和事件，不改遊戲狀態）
//   · 480×270 邏輯畫布、關閉平滑、整數倍率放大；中文字另外用高解析度畫（才清楚）
//   · 繪製順序（美術聖經 §5）：背景 → 平台 → 紅區填色與斜紋 → 殘影 → 角色 → 命中粒子與 KO → 紅格邊線、藍框、方向箭頭 → HUD
//   · 頓幀只停「演出」：凍結世界層畫面幾十毫秒，HUD 倒數照走（引擎本身不停）
//   · 15 個角色動畫狀態（美術換皮接口，見 ANIM_STATES）；有 Sprite Sheet 就照 ART.spriteAtlas 切格，沒有就程式繪製
import { ART, CONFIG } from "./config.js";
import { PH, PH_LABEL, GLABEL, cellX } from "./engine.js";

export const ANIM_STATES = [
  "idle", "step", "exhausted", "stance_rock", "stance_scissors", "stance_paper", "stance_hidden", "clash",
  "mash_hit", "finisher_blue", "finisher_red", "parry_success", "roll", "hitstun", "knockback",
];
// 15 個狀態對應到切格表的列（mash_hit 交替用 combo_1／combo_2 兩列）
const ATLAS_ROW_OF = s => (s === "mash_hit" ? null : s);

const PAL = ART.palette, FX = ART.effects;
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ms = v => v / 1000;
const mix = (a, b, k) => { const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, "0")).join(""); };

// ---------------- 像素圖示 ----------------
export const GLYPH = {
  rock: ["..............", "...########...", "..##########..", ".############.", ".#.##.##.##.#.", ".############.", ".############.", ".############.", "..##########..", "...########...", "....######....", "....######....", "..............", ".............."],
  scissors: ["#...........#.", "##.........##.", ".##.......##..", "..##.....##...", "...##...##....", "....##.##.....", ".....###......", "....##.##.....", "...##...##....", ".####...####..", "##..##.##..##.", "##..##.##..##.", ".####...####..", ".............."],
  paper: ["...#.#.#.#....", "...#.#.#.#....", "...#.#.#.#....", "...#.#.#.#....", "...#######....", "#..#######....", "##.#######....", ".##########...", "..#########...", "..#########...", "...#######....", "...######.....", "...######.....", ".............."],
  right: ["......#.....", "......##....", "......###...", "##########..", "###########.", "###########.", "##########..", "......###...", "......##....", "......#....."],
};
GLYPH.left = GLYPH.right.map(r => [...r].reverse().join(""));
const DIGIT = {
  "0": ["####", "#..#", "#..#", "#..#", "#..#", "####"], "1": [".#..", "##..", ".#..", ".#..", ".#..", "###."],
  "2": ["####", "...#", "####", "#...", "#...", "####"], "3": ["####", "...#", ".###", "...#", "...#", "####"],
  "4": ["#..#", "#..#", "####", "...#", "...#", "...#"], "5": ["####", "#...", "####", "...#", "...#", "####"],
  "6": ["####", "#...", "####", "#..#", "#..#", "####"], "7": ["####", "...#", "..#.", ".#..", ".#..", ".#.."],
  "8": ["####", "#..#", "####", "#..#", "#..#", "####"], "9": ["####", "#..#", "####", "...#", "...#", "####"],
  "%": ["##..#", "##.#.", "..#..", ".#...", "#..##", "...##"],
};
function drawBitmap(g, rows, x, y, fill, outline, scale = 1) {
  const W = rows[0].length, H = rows.length;
  if (outline) { g.fillStyle = outline; for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (rows[r][c] === "#") for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillRect(x + (c + dx) * scale, y + (r + dy) * scale, scale, scale); }
  g.fillStyle = fill;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (rows[r][c] === "#") g.fillRect(x + c * scale, y + r * scale, scale, scale);
}

// ---------------- 武者（程式繪製／Sprite Sheet） ----------------
const Fighter = (() => {
  const A = ART.spriteAtlas, F = PAL.fighters;
  const sheets = [null, null];
  ["p1", "p2"].forEach((p, i) => {
    if (typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => { if (img.naturalWidth === A.imageWidth && img.naturalHeight === A.imageHeight) sheets[i] = img; };
    img.onerror = () => {};
    img.src = new URL(`../${A.imageByPlayer[p]}`, import.meta.url).href;
  });
  function atlasAnim(state, alt) { return A.animations[ATLAS_ROW_OF(state) ?? (alt ? "combo_2" : "combo_1")]; }
  function frameOf(state, t, f, view) {
    const an = atlasAnim(state, f.anim.alt);
    if (!an) return 0;
    const n = Math.floor(t * an.fps);
    if (an.playback === "loop") return n % an.frames;
    if (an.playback === "hold_last") return Math.min(n, an.frames - 1);
    if (an.playback === "tail_loop") return n < an.frames ? n : an.loopStartFrame + ((n - an.loopStartFrame) % (an.frames - an.loopStartFrame));
    if (state === "finisher_blue" || state === "finisher_red") {                 // 0–7 格對應判定窗，第 8 格在命中事件上
      if (!f.fin) { const k = view?.phase === PH.WINDOW ? clamp(view.t / view.dur, 0, 0.999) : 0; return Math.floor(k * (an.keyFrames.windupLast + 1)); }
      return Math.min(an.frames - 1, an.keyFrames.contact + Math.floor(t * an.fps * 0.5));
    }
    return Math.min(an.frames - 1, (an.keyFrames.contact ?? 0) + n);             // event_driven：事件發生時從接觸格開始
  }
  let g, OX, OY, FACE, parts;
  const P = (x, y, w, h, c) => parts.push([x, y, w, h, c]);
  function flush(colors, outline) {
    const wx = (x, w) => (FACE > 0 ? OX + (x - 24) : OX - (x - 24) - w), wy = y => OY + (y - 40);
    if (outline) { g.fillStyle = outline; for (const [x, y, w, h, c] of parts) if (c !== "fx") g.fillRect(Math.round(wx(x, w) - 1), Math.round(wy(y) - 1), w + 2, h + 2); }
    for (const [x, y, w, h, c] of parts) { g.fillStyle = colors[c] ?? c; g.fillRect(Math.round(wx(x, w)), Math.round(wy(y)), w, h); }
    parts = [];
  }
  function body(i, o = {}) {
    const dx = o.dx ?? 0, dy = o.dy ?? 0, sp = o.spread ?? 0, hx = dx + (o.hx ?? 0), hy = dy + (o.hy ?? 0);
    if (i === 1) { P(13 + dx, 23 + dy, 3, 9, "S"); P(10 + dx, 25 + dy, 3, 7, "W"); }
    P(18 - sp, 32, 5, 8, "S"); P(25 + sp, 32, 5, 8, "S"); P(17 - sp, 38, 6, 2, "O"); P(25 + sp, 38, 7, 2, "O");
    P(17 + dx, 21 + dy, 13, 12, "P"); P(17 + dx, 21 + dy, 3, 12, "S"); P(17 + dx, 29 + dy, 13, 2, i === 0 ? "W" : "S");
    if (i === 0) P(15 + dx, 20 + dy, 8, 4, "W"); else { P(19 + dx, 20 + dy, 10, 2, "W"); P(17 + dx, 22 + dy, 3, 2, "W"); }
    P(19 + hx, 12 + hy, 9, 9, "K");
    if (i === 0) { P(17 + hx, 11 + hy, 13, 2, "S"); P(19 + hx, 8 + hy, 9, 3, "S"); } else { P(18 + hx, 10 + hy, 10, 3, "S"); P(20 + hx, 7 + hy, 4, 3, "S"); }
    if (o.eyes === "x") { P(25 + hx, 15 + hy, 1, 1, "O"); P(27 + hx, 15 + hy, 1, 1, "O"); P(26 + hx, 16 + hy, 1, 1, "O"); P(25 + hx, 17 + hy, 1, 1, "O"); P(27 + hx, 17 + hy, 1, 1, "O"); }
    else if (o.eyes === "shut") P(25 + hx, 16 + hy, 3, 1, "O"); else P(26 + hx, 15 + hy, 1, 2, "O");
    if (o.mouth) P(25 + hx, 19 + hy, 2, 1, "O");
    return { dx, dy };
  }
  const W = {
    rockHigh(dx, dy) { P(26 + dx, 13 + dy, 3, 9, "P"); P(21 + dx, 14 + dy, 3, 8, "S"); P(24 + dx, 11 + dy, 5, 3, "K"); P(23 + dx, 13 + dy, 2, 2, "B"); P(21 + dx, 15 + dy, 2, 2, "B"); P(19 + dx, 17 + dy, 2, 2, "B"); P(25 + dx, 2 + dy, 11, 8, "M"); P(26 + dx, 3 + dy, 9, 1, "H"); P(25 + dx, 9 + dy, 11, 1, "B"); },
    rockSwing(dx, dy, r) { P(28 + dx, 23 + dy, 4 + r, 3, "P"); P(31 + dx + r, 22 + dy, 3, 4, "K"); P(34 + dx + r, 23 + dy, 4, 2, "B"); P(37 + dx + r, 18 + dy, 9, 10, "M"); P(38 + dx + r, 19 + dy, 7, 1, "H"); },
    blades(dx, dy, r) { P(29 + dx, 24 + dy, 5 + r, 3, "P"); P(29 + dx, 28 + dy, 4 + r, 3, "S"); P(33 + dx + r, 24 + dy, 2, 3, "K"); P(32 + dx + r, 28 + dy, 2, 3, "K"); P(35 + dx + r, 23 + dy, 9, 2, "M"); P(35 + dx + r, 23 + dy, 9, 1, "H"); P(44 + dx + r, 24 + dy, 1, 1, "M"); P(34 + dx + r, 28 + dy, 8, 2, "M"); P(34 + dx + r, 28 + dy, 8, 1, "H"); P(42 + dx + r, 29 + dy, 1, 1, "M"); },
    palms(dx, dy, r) { P(28 + dx, 18 + dy, 4 + r, 3, "P"); P(32 + dx + r, 13 + dy, 5, 7, "K"); P(37 + dx + r, 14 + dy, 1, 5, "K"); P(28 + dx, 29 + dy, 4 + r, 3, "S"); P(32 + dx + r, 29 + dy, 5, 7, "K"); P(37 + dx + r, 30 + dy, 1, 5, "K"); },
    armDown(dx, dy) { P(26 + dx, 23 + dy, 3, 8, "P"); P(26 + dx, 31 + dy, 3, 2, "K"); },
  };
  const weaponOf = (st, dx, dy, r) => (st === "scissors" ? W.blades(dx, dy, r) : st === "paper" ? W.palms(dx, dy, r) : W.rockSwing(dx, dy, r));
  const STATES = {
    idle(f, n) { const b = body(f.i, { dy: n === 3 ? 1 : 0 }); W.armDown(b.dx, b.dy); },
    step(f, n) { const b = body(f.i, { spread: n >= 1 && n <= 3 ? 3 : 1, dx: 1 }); W.armDown(b.dx, b.dy); },
    exhausted(f, n) { const b = body(f.i, { dy: 3, dx: 2, hx: 2, hy: n === 2 ? 2 : 1, eyes: "shut", mouth: true }); P(27 + b.dx, 25 + b.dy, 3, 8, "P"); P(27 + b.dx, 33 + b.dy, 3, 2, "K"); const y = Math.floor((f.anim.t * 24) % 8); P(14, 10 + y, 1, 2, "fx"); P(32, 12 + ((y + 4) % 8), 1, 2, "fx"); },
    stance_rock(f, n) { const b = body(f.i, { spread: 2, dy: n % 2 }); W.rockHigh(b.dx, b.dy); },
    stance_scissors(f, n) { const b = body(f.i, { spread: 3, dx: 2, dy: 3 }); W.blades(b.dx, b.dy + (n % 2), 1); },
    stance_paper(f, n) { const b = body(f.i, { spread: 2, dx: 1 }); W.palms(b.dx, b.dy + (n === 2 ? 1 : 0), 0); },
    stance_hidden(f, n) { const b = body(f.i, { spread: 1, dy: n === 1 ? 1 : 0 }); P(24 + b.dx, 24 + b.dy, 6, 5, "P"); },
    clash(f) { const b = body(f.i, { spread: 3, dx: -2, eyes: "shut" }); weaponOf(f.stance, b.dx + 1, b.dy, 2); },
    mash_hit(f, n) { const alt = f.anim.alt, k = Math.min(1, f.anim.t * 12); const b = body(f.i, { spread: alt ? 5 : 4, dx: alt ? 5 : 3, dy: alt ? 1 : 0 }); weaponOf(f.stance, b.dx, b.dy - (alt ? 2 : 0), Math.round((alt ? 7 : 5) * (1 - k * 0.4))); },
    finisher_blue(f) { if (!f.fin) { const b = body(f.i, { spread: 3, dx: -2 }); weaponOf(f.stance, b.dx - 6, b.dy - 2, 0); } else { const b = body(f.i, { spread: 5, dx: 5 }); weaponOf(f.stance, b.dx, b.dy, 8); } },
    finisher_red(f) { if (!f.fin) { const b = body(f.i, { spread: 4, dy: 3 }); W.rockHigh(b.dx, b.dy - 2); P(24, 1, 13, 1, "R"); P(36, 2, 1, 8, "R"); P(15, 19, 1, 5, "R"); } else { const b = body(f.i, { spread: 6, dx: 3, dy: 4 }); P(28 + b.dx, 27 + b.dy, 6, 3, "P"); P(33 + b.dx, 29 + b.dy, 12, 10, "M"); P(34 + b.dx, 30 + b.dy, 10, 1, "H"); } },
    parry_success(f) { const b = body(f.i, { spread: 4, dx: 2 }); P(29 + b.dx, 17 + b.dy, 3, 12, "P"); P(30 + b.dx, 15 + b.dy, 4, 3, "K"); },
    roll(f) { P(15, 24, 18, 16, "P"); P(17, 26, 14, 12, "S"); P(22, 28, 7, 6, "K"); P(21, 26, 9, 2, f.i === 0 ? "W" : "S"); },
    hitstun(f) { const b = body(f.i, { dx: -3, hx: -2, hy: 1, eyes: "x", mouth: true }); P(20 + b.dx, 23 + b.dy, 3, 7, "P"); },
    knockback(f) { const b = body(f.i, { spread: 5, dx: -3, eyes: "x", mouth: true }); P(14 + b.dx, 18 + b.dy, 6, 3, "P"); P(28 + b.dx, 16 + b.dy, 6, 3, "P"); },
  };
  function colorsFor(f, mode) {
    const p = F["p" + (f.i + 1)];
    if (mode === "hidden") return { P: F.hiddenFill, S: F.hiddenFill, W: p.secondary, H: F.hiddenFill, K: F.hiddenFill, M: F.hiddenFill, B: F.hiddenFill, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
    if (mode === "white") { const w = PAL.fx.impact.core; return { P: w, S: w, W: w, H: w, K: w, M: w, B: w, O: w, R: w, fx: w }; }
    return { P: p.primary, S: p.shadow, W: p.secondary, H: p.highlight, K: CONFIG.skin, M: F.neutralSteel, B: PAL.platform.oxidizedBronze, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
  }
  return {
    frameOf, sheets,
    draw(ctx, f, state, t, x, y, face, opt = {}) {
      g = ctx; OX = Math.round(x); OY = Math.round(y); FACE = face;
      const n = frameOf(state, t, f, opt.view);
      const rot = state === "knockback" ? (f.rot || t * 10) : state === "roll" ? t * 22 : 0;
      g.save();
      if (opt.alpha !== undefined) g.globalAlpha = opt.alpha;
      if (rot) { g.translate(OX, OY - 14); g.rotate(state === "roll" ? face * rot : -face * rot); g.translate(-OX, -(OY - 14)); }
      const sh = sheets[f.i];
      if (sh && !opt.white) {
        const an = atlasAnim(state, f.anim.alt);
        g.translate(OX, OY); if (face < 0) g.scale(-1, 1);
        g.drawImage(sh, A.originX + A.strideX * n, A.originY + A.strideY * an.row, A.frameWidth, A.frameHeight, -A.pivot.x, -A.pivot.y, A.frameWidth, A.frameHeight);
      } else {
        parts = [];
        (STATES[state] ?? STATES.idle)(f, n);
        const mode = opt.white ? "white" : state === "stance_hidden" ? "hidden" : "normal";
        flush(colorsFor(f, mode), opt.rim ? PAL.fx.impact.core : mode === "white" ? null : F.outline);
      }
      g.restore();
    },
  };
})();

// ---------------- Renderer ----------------
export class Renderer {
  constructor(canvas) {
    this.screen = canvas; this.sctx = canvas.getContext("2d");
    this.buf = document.createElement("canvas"); this.buf.width = CONFIG.W; this.buf.height = CONFIG.H;
    this.ctx = this.buf.getContext("2d");
    this.scale = 1; this.dpr = 1;
    this.fx = []; this.trails = [[], []]; this.trailClock = [0, 0]; this.lastXY = [null, null];
    this.freezeUntil = 0; this.frozen = null; this.shake = { amp: 0, until: 0 };
    this.flashT = [0, 0]; this.rimT = [0, 0]; this.keyFlash = { L: 0, M: 0, R: 0 }; this.combo = null;
    this.cam = { zoom: 1, x: CONFIG.W / 2, y: CONFIG.H / 2 };
    this.stars = Array.from({ length: 46 }, () => ({ x: (Math.random() * CONFIG.W) | 0, y: (Math.random() * 110) | 0, tw: Math.random() * 6 }));
    this.names = CONFIG.names.slice();
    this.resize();
  }
  static get ANIM_STATES() { return ANIM_STATES; }
  useSheet(seat, img) { Fighter.sheets[seat] = img; }      // 手動接 Sprite Sheet（500×800，切格表照 ART.spriteAtlas）
  hasSheet(seat) { return !!Fighter.sheets[seat]; }
  setNames(n) { this.names = n; }
  keyPress(btn) { this.keyFlash[btn] = 0.12; }
  reset() { this.fx = []; this.trails = [[], []]; this.combo = null; this.freezeUntil = 0; this.frozen = null; }
  resize(availW = innerWidth, availH = innerHeight) {
    const dpr = globalThis.devicePixelRatio || 1, fit = Math.min(availW / CONFIG.W, availH / CONFIG.H);
    this.scale = fit >= 1 ? Math.floor(fit) : fit;          // 整數倍率；視窗剩下的空間留邊
    this.dpr = dpr;
    this.screen.style.width = `${Math.round(CONFIG.W * this.scale)}px`; this.screen.style.height = `${Math.round(CONFIG.H * this.scale)}px`;
    this.screen.width = Math.round(CONFIG.W * this.scale * dpr); this.screen.height = Math.round(CONFIG.H * this.scale * dpr);
    this.ctx.imageSmoothingEnabled = false; this.sctx.imageSmoothingEnabled = false;
  }

  // ---- 事件 → 演出 ----
  onEvents(events, view, now) {
    for (const e of events) {
      switch (e.type) {
        case "hitstop": {
          const d = e.ms ?? FX.hitstopMs[e.ev] ?? 0, px = e.shake ?? FX.cameraShakePx[e.ev] ?? 0;
          if (d > 0 && now * 1000 + d > this.freezeUntil * 1000) { this.freezeUntil = now + ms(d); this.frozen = null; }
          this.kick(px, ms(d) + 0.06, now);
          break;
        }
        case "step": if (e.bump) { this.spark((cellX(e.from) + cellX(e.to)) / 2, CONFIG.floorY - 22, PAL.fx.impact.spark, 4, 1.6); this.popup((cellX(e.from) + cellX(e.to)) / 2, CONFIG.floorY - 52, "頂撞！", PAL.fx.impact.spark, 9); this.kick(1, 0.06, now); } break;
        case "lock": { const f = view.fighters[e.p]; this.popup(f.x, CONFIG.floorY - 58, "鎖定", PAL.hud.muted, 8); break; }
        case "deny": if (e.why === "power") { const f = view.fighters[e.p]; this.popup(f.x, CONFIG.floorY - 58, "沒氣了", "#FFAA63", 8); } break;
        case "hide": this.trails = [[], []]; break;                                           // 藏招第一幀：清掉殘影
        case "rps_result": view.fighters.forEach((f, i) => this.popup(f.x, CONFIG.floorY - 66, GLABEL[e.stances[i]] + (e.random[i] ? "（隨機）" : ""), PAL.fighters["p" + (i + 1)].secondary, 12)); break;
        case "clash": this.spark(e.x, CONFIG.floorY - 24, PAL.fx.impact.spark, 5, 2.2); this.popup(e.x, CONFIG.floorY - 64, "拼刀！", PAL.fx.impact.core, 14); break;
        case "hit": {
          this.flashT[e.p] = ms(FX.impactFrameFlash.durationMs);
          const n = e.kind === "extra" ? 4 + e.n * 2 : 6;
          this.spark(e.x - (e.toward ?? 1) * 8, CONFIG.floorY - 24 - (e.kind === "extra" ? Math.random() * 10 : 0), e.kind === "extra" ? PAL.fx.impact.core : PAL.fx.impact.spark, n, e.kind === "extra" ? 2.8 : 2.2);
          this.popup(e.x, CONFIG.floorY - 58 - (e.kind === "extra" ? e.n * 3 : 0), `+${e.damage}%`, PAL.fx.impact.core, e.kind === "extra" ? 8 : 10);
          if (e.combo !== undefined && view.round) this.combo = { n: e.combo, at: now, x: view.fighters[view.round.att].x, extra: e.kind === "extra" };
          break;
        }
        case "red_ready": { const f = view.fighters[e.p]; this.popup(f.x, CONFIG.floorY - 70, "紅光強化！", PAL.fx.red.rim, 12); this.kick(2, 0.1, now); break; }
        case "parry": this.rimT = [ms(FX.parryFlash.durationMs), ms(FX.parryFlash.durationMs)]; this.ring(e.x, CONFIG.floorY - 24, PAL.fx.impact.core); this.popup(e.x, CONFIG.floorY - 72, "完美彈反！", PAL.hud.focusOutline, 14); break;
        case "roll": this.zoneBlast(e.zone); this.popup(cellX(e.to), CONFIG.floorY - 58, "閃過！", PAL.fx.safeArrow.fill, 12); break;
        case "finisher_hit": if (e.red) this.zoneBlast(e.zone); this.spark(e.x, CONFIG.floorY - 24, e.red ? PAL.fx.red.core : PAL.fx.impact.spark, e.red ? 12 : 7, 3); this.popup(e.x, CONFIG.floorY - 64, `+${e.damage}%`, e.red ? PAL.fx.red.core : PAL.fx.blue.core, 12); break;
        case "land": this.spark(e.x, CONFIG.floorY, PAL.platform.topEdge, 4, 1.2); break;
        case "ko": this.fx.push({ k: "beam", x: e.x, at: now, max: ms(FX.koBlast.durationMs) }); this.kick(FX.cameraShakePx.ko, 0.2, now); this.popup(clamp(e.x, 60, CONFIG.W - 60), 96, "KO！", PAL.fx.ko.core, 22); this.trails = [[], []]; break;
        case "round_end": this.popup(CONFIG.W / 2, 110, "雙方 +1 氣", PAL.hud.powerFill, 9); break;
        case "phase": if (e.phase === PH.MOVE) this.combo = null; break;
      }
    }
  }
  kick(px, dur, now) { if (REDUCED || !px) return; if (px >= this.shake.amp || now > this.shake.until) this.shake = { amp: px, until: now + dur }; }
  spark(x, y, color, n, speed) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * speed * 50; this.fx.push({ k: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 25, life: 0.18 + Math.random() * 0.18, max: 0.36, color }); } }
  ring(x, y, color) { this.fx.push({ k: "ring", x, y, life: 0.3, max: 0.3, color }); }
  popup(x, y, text, color, size) { this.fx.push({ k: "text", x, y, text, color, size, life: 0.9, max: 0.9 }); }
  banner(text, color = PAL.hud.focusOutline) { this.fx.push({ k: "banner", text, color, life: 1.6, max: 1.6 }); }
  zoneBlast(zone = []) { for (const c of zone) { this.fx.push({ k: "crack", c, life: 0.5, max: 0.5 }); for (let i = 0; i < 6; i++) this.fx.push({ k: "debris", x: cellX(c) + (Math.random() - 0.5) * 30, y: CONFIG.floorY, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 120, life: 0.45, max: 0.45 }); } }

  // ---- 一幀 ----
  draw(view, events, now, dt) {
    if (!view) return;
    this.onEvents(events, view, now);
    const frozen = now < this.freezeUntil;
    if (frozen && !this.frozen) this.frozen = structuredClone(view);
    if (!frozen) this.frozen = null;
    const world = this.frozen ?? view;                    // 頓幀：世界層停在那一刻；HUD 用最新的
    const vdt = frozen ? 0 : dt;
    this.updateFx(vdt, dt);
    this.updateTrails(world, vdt);
    this.updateCam(view, dt);
    for (const k in this.keyFlash) this.keyFlash[k] = Math.max(0, this.keyFlash[k] - dt);
    for (const i of [0, 1]) { this.flashT[i] = Math.max(0, this.flashT[i] - dt); this.rimT[i] = Math.max(0, this.rimT[i] - dt); }

    const ctx = this.ctx, cam = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground(now);
    const amp = now < this.shake.until ? this.shake.amp : 0;
    const sx = amp ? Math.round((Math.random() * 2 - 1) * amp) : 0, sy = amp ? Math.round((Math.random() * 2 - 1) * amp) : 0;
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, Math.round(CONFIG.W / 2 - cam.x * cam.zoom) + sx, Math.round(CONFIG.H / 2 - cam.y * cam.zoom) + sy);
    this.drawStage(world);
    this.drawHazardFill(view, now);
    this.drawTrails(world);
    this.drawFighters(world);
    this.drawFx(now);
    this.drawHazardEdges(view);
    this.drawTelegraphs(view, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHudPixels(view, now);
    const s = this.scale * this.dpr, sctx = this.sctx;
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.imageSmoothingEnabled = false;
    sctx.drawImage(this.buf, 0, 0, this.screen.width, this.screen.height);
    sctx.setTransform(s, 0, 0, s, 0, 0);
    this.drawHudText(sctx, view, now);
  }
  updateFx(vdt, dt) {
    for (const p of this.fx) {
      if (p.k === "beam") continue;
      if (p.k === "text" || p.k === "banner") { p.life -= dt; if (p.k === "text") p.y -= 18 * dt; continue; }
      p.life -= vdt;
      if (p.k === "spark" || p.k === "debris") { p.vy += 500 * vdt; p.x += p.vx * vdt; p.y += p.vy * vdt; }
    }
    const now = performance.now() / 1000;
    this.fx = this.fx.filter(p => (p.k === "beam" ? now - p.at < p.max : p.life > 0));
  }
  // 殘影：最多 3 張、每 24ms 取樣、96ms 消失（減少動態：1 張）
  updateTrails(view, vdt) {
    const T = FX.motionTrail, max = REDUCED ? FX.reducedMotion?.trailMaxAfterimages ?? 1 : T.maxAfterimages;
    view.fighters.forEach((f, i) => {
      const tr = this.trails[i];
      for (const s of tr) s.age += vdt;
      this.trails[i] = tr.filter(s => s.age < ms(T.lifetimeMs));
      const last = this.lastXY[i], moving = last && (Math.abs(f.x - last[0]) + Math.abs(f.y - last[1]) > 1.2) && ["knockback", "roll", "parry_success", "mash_hit", "hitstun"].includes(f.anim.state);
      this.lastXY[i] = [f.x, f.y];
      if (!moving || vdt === 0 || f.out) return;
      this.trailClock[i] += vdt;
      if (this.trailClock[i] >= ms(T.sampleIntervalMs)) { this.trailClock[i] = 0; this.trails[i].unshift({ f: structuredClone(f), age: 0 }); this.trails[i].length = Math.min(this.trails[i].length, max); }
    });
  }
  updateCam(view, dt) {
    const c = this.cam, [a, b] = view.fighters, focus = view.phase === PH.MASH;
    const target = focus ? CONFIG.feel.zoomMash : 1;      // 只在連打推近；終結提示出現時鏡頭回穩（規格 §4）
    const tx = focus ? (a.x + b.x) / 2 : CONFIG.W / 2, ty = focus ? CONFIG.floorY - 46 : CONFIG.H / 2;
    const k = 1 - Math.exp(-CONFIG.feel.zoomLerp * dt);
    c.zoom += (target - c.zoom) * k; c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    if (!focus && Math.abs(c.zoom - 1) < 0.004) { c.zoom = 1; c.x = CONFIG.W / 2; c.y = CONFIG.H / 2; }
  }

  // ---- 世界 ----
  drawBackground(time) {
    const ctx = this.ctx, B = PAL.background;
    for (let i = 0; i < 10; i++) { ctx.fillStyle = mix(B.skyTop, B.skyHorizon, i / 9); ctx.fillRect(0, i * 16, CONFIG.W, 17); }
    ctx.fillStyle = B.skyHorizon; ctx.fillRect(0, 160, CONFIG.W, CONFIG.H - 160);
    for (const s of this.stars) { ctx.globalAlpha = 0.25 + 0.2 * Math.sin(time * 1.5 + s.tw); ctx.fillStyle = PAL.hud.muted; ctx.fillRect(s.x, s.y, 1, 1); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = B.distantCliffs;
    for (let x = 0; x < CONFIG.W; x += 2) { const h = 34 + Math.round(Math.sin(x * 0.021) * 12 + Math.sin(x * 0.067) * 5 + (x % 46 < 6 ? 6 : 0)); ctx.fillRect(x, 200 - h, 2, h + 70); }
    ctx.fillStyle = B.mist;
    for (let i = 0; i < 3; i++) { const y = 150 + i * 14, off = Math.round((time * (4 + i * 2)) % 64); for (let x = -64 + off; x < CONFIG.W; x += 64) ctx.fillRect(x, y, 40 - i * 6, 2); }
    for (let i = 0; i < 4; i++) { ctx.fillStyle = mix(B.mist, B.abyss, (i + 1) / 4); ctx.fillRect(0, 214 + i * 8, CONFIG.W, 8); }
    ctx.fillStyle = B.abyss; ctx.fillRect(0, 246, CONFIG.W, CONFIG.H - 246);
  }
  drawStage(view) {
    const ctx = this.ctx, PF = PAL.platform, L = CONFIG.stageX, R = ART.stage.rightXExclusive, Y = CONFIG.floorY, W = CONFIG.cellW;
    for (let i = 0; i < 6; i++) { const inset = 4 + i * 6, y = Y + 16 + i * 4; ctx.fillStyle = PF.outline; ctx.fillRect(L + inset - 1, y, R - L - inset * 2 + 2, 5); ctx.fillStyle = i % 2 ? PF.stoneShadow : mix(PF.stoneShadow, PF.outline, 0.3); ctx.fillRect(L + inset, y, R - L - inset * 2, 4); }
    ctx.fillStyle = PF.outline; ctx.fillRect(L - 1, Y - 1, R - L + 2, 18);
    for (let i = 0; i < CONFIG.cells; i++) {
      const x = L + i * W;
      ctx.fillStyle = PF.stoneMid; ctx.fillRect(x, Y, W, 12); ctx.fillStyle = PF.stoneShadow; ctx.fillRect(x, Y + 12, W, 4);
      ctx.fillStyle = PF.topEdge; ctx.fillRect(x, Y, W, 2);
      ctx.fillStyle = PF.oxidizedBronze; ctx.fillRect(x + W / 2 - 3, Y + 7, 2, 2); ctx.fillRect(x + W / 2 + 1, Y + 7, 2, 2);
      if (i > 0) { ctx.fillStyle = PF.tileSeam; ctx.fillRect(x, Y, 1, 16); }
    }
    for (const f of view.fighters) if (!f.out && !f.air) { const c = clamp(Math.floor((f.x - L) / W), 0, CONFIG.cells - 1); ctx.globalAlpha = 0.35; ctx.fillStyle = PAL.fighters["p" + (f.i + 1)].highlight; ctx.fillRect(L + c * W + 1, Y, W - 2, 1); ctx.globalAlpha = 1; }
  }
  cue(view) { const r = view.round; return view.phase === PH.WINDOW && r && r.type ? r : null; }
  drawHazardFill(view, now) {
    const r = this.cue(view);
    if (!r || r.type !== "red") return;
    const ctx = this.ctx, T = ART.telegraphs.redRoll, Y = CONFIG.floorY, W = CONFIG.cellW, band = ART.stage.dangerTopBandHeightPx;
    const step = REDUCED ? 0 : Math.floor(view.t * 1000 / T.hazardHatchStepMs);
    for (const c of r.zone) {
      const x = CONFIG.stageX + (c - 1) * W;
      ctx.globalAlpha = T.hazardFillOpacity; ctx.fillStyle = PAL.fx.red.floorFill; ctx.fillRect(x, Y, W, 16); ctx.globalAlpha = 1;
      ctx.fillStyle = PAL.fx.red.outline; ctx.fillRect(x, Y, W, band);
      ctx.fillStyle = PAL.fx.red.hatch;
      for (let yy = 0; yy < band; yy++) for (let xx = 0; xx < W; xx++) if (((xx + yy + step) % T.hazardHatchPeriodPx) < 2) ctx.fillRect(x + xx, Y + yy, 1, 1);
    }
  }
  drawHazardEdges(view) {
    const r = this.cue(view);
    if (!r || r.type !== "red" || !r.zone.length) return;
    const ctx = this.ctx, Y = CONFIG.floorY, W = CONFIG.cellW, a = Math.min(...r.zone), b = Math.max(...r.zone), x0 = CONFIG.stageX + (a - 1) * W, x1 = CONFIG.stageX + b * W;
    ctx.fillStyle = PAL.fx.red.outline; ctx.fillRect(x0 - 1, Y - 2, x1 - x0 + 2, 1); ctx.fillRect(x0 - 1, Y + 16, x1 - x0 + 2, 1);
    ctx.fillStyle = PAL.fx.red.rim; ctx.fillRect(x0, Y - 1, x1 - x0, 1); ctx.fillRect(x0, Y + 15, x1 - x0, 1); ctx.fillRect(x0, Y - 1, 1, 17); ctx.fillRect(x1 - 1, Y - 1, 1, 17);
  }
  animTime(view, f) { return view.phase === PH.WINDOW ? f.anim.t * CONFIG.window.slowmo : f.anim.t; }   // 判定窗：慢動作（只影響畫面）
  stateFor(view, f) { return view.phase === PH.RPS && view.t >= CONFIG.rps.reveal && f.anim.state.startsWith("stance_") ? "stance_hidden" : f.anim.state; }   // 藏招：雙方都回到收手黑影
  drawTrails(view) {
    const al = FX.motionTrail.alphaNewestToOldest;
    this.trails.forEach(tr => tr.forEach((s, i) => Fighter.draw(this.ctx, s.f, this.stateFor(view, s.f), this.animTime(view, s.f), s.f.x, s.f.y, s.f.face, { alpha: al[i] ?? 0.1, view })));
  }
  drawFighters(view) {
    const ctx = this.ctx;
    for (const f of view.fighters) {
      if (f.out) continue;
      let x = f.x, y = f.y;
      if (f.wobble > 0) { const k = f.wobble / CONFIG.move.wobbleTime; x += Math.round(Math.sin(k * 30) * 2 * k + (f.wobbleDir || 0) * 2 * k); }
      ctx.fillStyle = "rgba(10,15,26,.55)"; ctx.fillRect(Math.round(x) - 10, CONFIG.floorY, 20, 2);
      const state = this.stateFor(view, f), t = this.animTime(view, f);
      if (f.redGlow && !REDUCED) { ctx.globalAlpha = 0.25 + 0.15 * Math.sin(performance.now() / 50); ctx.fillStyle = PAL.fx.red.rim; ctx.fillRect(Math.round(x) - 14, Math.round(y) - 42, 28, 42); ctx.globalAlpha = 1; }   // 紅光強化：全身泛紅
      Fighter.draw(ctx, f, state, t, x, y, f.face, { rim: this.rimT[f.i] > 0 && !REDUCED, view });
      if (this.flashT[f.i] > 0 && !REDUCED) Fighter.draw(ctx, f, state, t, x, y, f.face, { white: true, alpha: FX.impactFrameFlash.maxOpacity, view });
      if (f.deny > 0) { ctx.globalAlpha = Math.min(1, f.deny * 3); ctx.fillStyle = PAL.fx.red.rim; ctx.fillRect(Math.round(x) - 8, Math.round(y) - 46, 16, 1); ctx.globalAlpha = 1; }
    }
  }
  drawFx(now) {
    const ctx = this.ctx;
    for (const p of this.fx) {
      const a = p.life !== undefined ? clamp(p.life / p.max, 0, 1) : 1;
      if (p.k === "spark") { ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); }
      else if (p.k === "debris") { ctx.globalAlpha = a; ctx.fillStyle = PAL.platform.stoneMid; ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 2); ctx.fillStyle = PAL.platform.topEdge; ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 1); }
      else if (p.k === "crack") { ctx.globalAlpha = a; ctx.fillStyle = PAL.fx.red.core; const x = CONFIG.stageX + (p.c - 1) * CONFIG.cellW; for (let i = 0; i < 6; i++) ctx.fillRect(x + 6 + i * 7, CONFIG.floorY + 2 + (i % 3) * 3, 4, 1); }
      else if (p.k === "ring") { const r = Math.round((1 - a) * 22 + 4); ctx.globalAlpha = a; ctx.fillStyle = p.color; for (let i = 0; i < 24; i++) { const t = i / 24 * Math.PI * 2; ctx.fillRect(Math.round(p.x + Math.cos(t) * r), Math.round(p.y + Math.sin(t) * r), 1, 1); } }
      else if (p.k === "beam") this.drawBeam(p, now);
    }
    ctx.globalAlpha = 1;
  }
  // KO 光柱：40ms 細升 → 90ms 亮芯 → 250ms 淡出，峰值 22px，從 y=224 往上
  drawBeam(p, now) {
    const ctx = this.ctx, K = FX.koBlast, t = (now - p.at) * 1000, bottom = ART.stage.koBeamBottomY;
    let w, h, a;
    if (t < K.chargeMs) { w = 2; h = bottom * (t / K.chargeMs); a = 1; }
    else if (t < K.chargeMs + K.coreMs) { w = K.beamMaxWidthPx; h = bottom; a = 1; }
    else { const k = (t - K.chargeMs - K.coreMs) / K.fadeMs; w = Math.max(2, Math.round(K.beamMaxWidthPx * (1 - k * 0.6))); h = bottom; a = 1 - k; }
    ctx.globalAlpha = clamp(a, 0, 1);
    const top = bottom - h;
    ctx.fillStyle = PAL.fx.ko.outer; ctx.fillRect(Math.round(p.x - w / 2), top, Math.round(w), h);
    ctx.fillStyle = PAL.fx.ko.rim; ctx.fillRect(Math.round(p.x - w * 0.32), top, Math.max(1, Math.round(w * 0.64)), h);
    ctx.fillStyle = PAL.fx.ko.core; ctx.fillRect(Math.round(p.x - w * 0.14), top, Math.max(1, Math.round(w * 0.28)), h);
    ctx.globalAlpha = 1;
  }
  // 藍框（攻方腳底上 55px）與紅招安全箭頭（防方腳邊 ±14、−7），倒數由滿退去、最後 0.15s 紅閃
  drawTelegraphs(view, now) {
    const r = this.cue(view);
    if (!r) return;
    const ctx = this.ctx, left = clamp((view.dur - view.t) / view.dur, 0, 1), urgent = view.dur - view.t <= CONFIG.countdown.urgentSec, blink = urgent && Math.floor(now * 20) % 2 === 0;
    if (r.type === "blue") {
      const att = view.fighters[r.att], T = ART.telegraphs.blueParry, S = T.frameSizePx[0];
      const x = Math.round(att.x) - S / 2, y = CONFIG.floorY + T.offsetPx[1] - S / 2, C = PAL.fx.blue;
      this.roundRect(x - 1, y - 1, S + 2, S + 2, C.outline); this.roundRect(x, y, S, S, "#0E2747");
      this.perimeter(x, y, S, left, blink ? PAL.fx.red.rim : urgent ? C.core : C.rim, 2);
      if (r.gesture) drawBitmap(ctx, GLYPH[r.gesture], x + 5, y + 5, C.core, C.outline);
    } else {
      const def = view.fighters[r.def], T = ART.telegraphs.redRoll;
      for (const d of r.dirs) {
        const ax = Math.round(def.x + d * T.safeArrowOffsetAbsPx[0] - T.safeArrowSizePx[0] / 2), ay = Math.round(CONFIG.floorY + T.safeArrowOffsetAbsPx[1] - T.safeArrowSizePx[1] / 2);
        drawBitmap(ctx, d < 0 ? GLYPH.left : GLYPH.right, ax, ay - 2, blink ? PAL.fx.red.rim : PAL.fx.safeArrow.fill, PAL.fx.safeArrow.outline);
        ctx.fillStyle = PAL.fx.safeArrow.outline; ctx.fillRect(ax - 3, ay + 10, 18, 4);
        ctx.fillStyle = blink ? PAL.fx.red.rim : PAL.fx.safeArrow.fill; ctx.fillRect(ax - 2, ay + 11, Math.round(16 * left), 2);
      }
    }
  }
  roundRect(x, y, w, h, c) { const ctx = this.ctx; ctx.fillStyle = c; ctx.fillRect(x + 2, y, w - 4, h); ctx.fillRect(x, y + 2, w, h - 4); ctx.fillRect(x + 1, y + 1, w - 2, h - 2); }
  perimeter(x, y, S, k, color, th) {
    const pts = [], a = S - 4;
    for (let i = 0; i < a; i++) pts.push([x + 2 + i, y]);
    for (let i = 0; i < a; i++) pts.push([x + S - th, y + 2 + i]);
    for (let i = 0; i < a; i++) pts.push([x + S - 3 - i, y + S - th]);
    for (let i = 0; i < a; i++) pts.push([x, y + S - 3 - i]);
    const start = Math.floor(a / 2), n = Math.round(pts.length * k);
    this.ctx.fillStyle = color;
    for (let i = 0; i < n; i++) { const [px, py] = pts[(start + i) % pts.length]; this.ctx.fillRect(px, py, th, th); }
  }

  // ---- HUD（像素） ----
  drawDigits(text, x, y, band, alignRight) {
    const ctx = this.ctx, scale = 4, cwOf = ch => (DIGIT[ch]?.[0].length ?? 4) * scale + 3;
    const w = [...text].reduce((s, ch) => s + cwOf(ch), 0) - 3;
    let cx = alignRight ? x - w : x;
    for (const ch of text) {
      const rows = DIGIT[ch];
      if (rows) {
        drawBitmap(ctx, rows, cx, y, band.fill, PAL.fighters.outline, scale);
        if (band.topRim) { ctx.fillStyle = band.topRim; rows.forEach((r, ri) => [...r].forEach((c, ci) => { if (c === "#" && (ri === 0 || rows[ri - 1][ci] !== "#")) ctx.fillRect(cx + ci * scale, y + ri * scale, scale, 1); })); }
      }
      cx += cwOf(ch);
    }
    return { x0: alignRight ? x - w : x, w };
  }
  drawHudPixels(view, now) {
    const ctx = this.ctx, H = ART.hud.playerPanels;
    for (const f of view.fighters) {
      const right = f.i === 1, ax = right ? H.p2.anchorX : H.p1.anchorX, ay = H.p1.anchorY;
      const band = PAL.damageBands.find(b => f.damage >= b.minInclusive && (b.maxInclusive === null || f.damage <= b.maxInclusive));
      const box = this.drawDigits(`${Math.min(999, f.damage)}%`, ax, ay, band, right);
      if (band.smoke && !REDUCED) {
        const S = FX.damageSmoke;
        for (let i = 0; i < S.maxPuffsPerPlayer; i++) { const k = (now * 0.8 + i / S.maxPuffsPerPlayer) % 1; ctx.globalAlpha = S.maxOpacity * (1 - k); ctx.fillStyle = band.smokeColor; ctx.fillRect(right ? box.x0 - 6 - i * 3 : box.x0 + box.w + 4 + i * 3, ay + 6 - Math.round(k * S.maxHeightPx), 2, 2); }
        ctx.globalAlpha = 1;
      }
      const [sw, sh] = H.stockSizePx, gap = H.iconGapPx, team = PAL.fighters["p" + (f.i + 1)];
      for (let i = 0; i < H.stockCount; i++) {
        const sx = right ? ax - sw - i * (sw + gap) : ax + i * (sw + gap), sy = ay + 28;
        ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(sx - 1, sy - 1, sw + 2, sh + 2);
        if (i < f.stocks) { ctx.fillStyle = team.primary; ctx.fillRect(sx, sy, sw, sh); ctx.fillStyle = team.highlight; ctx.fillRect(sx, sy, sw, 1); }
        else { ctx.fillStyle = team.shadow; ctx.fillRect(sx, sy, sw, 1); ctx.fillRect(sx, sy + sh - 1, sw, 1); ctx.fillRect(sx, sy, 1, sh); ctx.fillRect(sx + sw - 1, sy, 1, sh); }
      }
      const [pw, ph] = H.powerSizePx;
      for (let i = 0; i < H.powerCount; i++) {
        const px = right ? ax - pw - i * (pw + gap) : ax + i * (pw + gap), py = ay + 40;
        if (i < f.power) { ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(px - 1, py - 1, pw + 2, ph + 2); ctx.fillStyle = PAL.hud.powerFill; ctx.fillRect(px, py, pw, ph); }
        else { ctx.fillStyle = PAL.hud.powerEmpty; ctx.fillRect(px, py, pw, 1); ctx.fillRect(px, py + ph - 1, pw, 1); ctx.fillRect(px, py, 1, ph); ctx.fillRect(px + pw - 1, py, 1, ph); }
      }
    }
    this.drawPhaseBar(view, now);
    this.drawKeyRow(view);
  }
  urgent(view) { const left = view.dur - view.t; return view.phase === PH.WINDOW ? left <= CONFIG.countdown.urgentSec : (view.phase === PH.MOVE || view.phase === PH.RPS) && left <= CONFIG.countdown.phaseTickLast; }
  timed(view) { return view.dur > 0 && [PH.MOVE, PH.RPS, PH.MASH, PH.SELECT, PH.WINDOW].includes(view.phase); }
  drawPhaseBar(view, now) {
    if (!this.timed(view)) return;
    const ctx = this.ctx, ph = view.phase, fin = ph === PH.WINDOW, left = clamp(view.dur - view.t, 0, view.dur), k = left / view.dur;
    const W = fin ? CONFIG.countdown.bigBarW : 120, H = fin ? 7 : 5, x = Math.round(CONFIG.W / 2 - W / 2), y = 26;
    const urgent = this.urgent(view), blink = urgent && Math.floor(now * 20) % 2 === 0;
    let color = PAL.hud.powerFill;
    if (fin) color = view.round?.type === "red" ? PAL.fx.red.rim : PAL.fx.blue.rim;
    if (ph === PH.MASH) color = PAL.fx.impact.spark;
    if (ph === PH.SELECT) color = view.round?.charging ? PAL.fx.red.rim : PAL.fx.blue.rim;
    if (ph === PH.RPS && view.t >= CONFIG.rps.reveal) color = PAL.hud.muted;
    if (urgent) color = blink ? PAL.fx.red.rim : PAL.hud.focusOutline;
    ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(x - 2, y - 2, W + 4, H + 4);
    ctx.fillStyle = PAL.hud.plate; ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
    ctx.fillStyle = color; ctx.fillRect(x, y, Math.round(W * k), H);
    ctx.fillStyle = PAL.hud.plate;
    for (let s = 0.1; s < view.dur - 1e-6; s += 0.1) ctx.fillRect(x + Math.round(W * (s / view.dur)), y, 1, H);
    if (ph === PH.RPS) { ctx.fillStyle = PAL.hud.focusOutline; ctx.fillRect(x + Math.round(W * (1 - CONFIG.rps.reveal / CONFIG.rps.dur)), y - 3, 1, H + 6); }
  }
  keyIcons(view) {
    const ph = view.phase, r = view.round, I = ART.hud.keyRow.iconsByPhase;
    if (ph === PH.MOVE) return { set: I.step, mid: "lock" };
    if (ph === PH.RPS) return { set: view.t >= CONFIG.rps.reveal ? I.hidden_commit : I.standoff };
    if (ph === PH.MASH) return { set: ["rock", "scissors", "paper"], mash: true };
    if (ph === PH.SELECT) return { set: I.finisher_select };
    if (ph === PH.WINDOW && r?.type) return r.type === "red" ? { set: I.red_roll, lit: r.dirs } : { set: I.blue_parry };
    return { set: I.resolution };
  }
  drawKeyRow(view) {
    const ctx = this.ctx, K = ART.hud.keyRow, [kw, kh] = K.keySizePx, x0 = K.centerX - (kw * 3 + K.gapPx * 2) / 2, y0 = K.topY;
    const { set, mid, lit, mash } = this.keyIcons(view), btns = ["L", "M", "R"];
    const hiddenPhase = view.phase === PH.RPS && view.t >= CONFIG.rps.reveal;
    const mine = view.seat >= 0 ? view.fighters[view.seat] : null;
    set.forEach((icon, i) => {
      const x = x0 + i * (kw + K.gapPx), active = icon !== "inactive" || (i === 1 && mid === "lock");
      const dirOk = !lit || (icon === "left_arrow" ? lit.includes(-1) : icon === "right_arrow" ? lit.includes(1) : true);
      const sharedHidden = hiddenPhase && view.seat < 0;                 // 同機雙人：藏招時共用按鍵列不能洩露手勢
      const pressed = this.keyFlash[btns[i]] > 0 && !sharedHidden;
      const chosen = mine && view.phase === PH.RPS && mine.stance && mine.stance !== "hidden" && ["rock", "scissors", "paper"][i] === mine.stance;   // 自己的已選手勢
      const dy = pressed ? 1 : 0;
      ctx.globalAlpha = active && dirOk ? 1 : 0.35;
      ctx.fillStyle = chosen ? PAL.hud.focusOutline : PAL.fighters.outline; ctx.fillRect(x - 1, y0 - 1, kw + 2, kh + 2);
      ctx.fillStyle = PAL.hud.plate; ctx.fillRect(x, y0, kw, kh);
      ctx.fillStyle = pressed ? PAL.hud.focusOutline : mash ? PAL.fx.impact.spark : active && dirOk ? PAL.hud.muted : PAL.hud.powerEmpty;
      ctx.fillRect(x + 1, y0 + 1 + dy, kw - 2, 1); ctx.fillRect(x + 1, y0 + kh - 2 + dy, kw - 2, 1); ctx.fillRect(x + 1, y0 + 1 + dy, 1, kh - 3); ctx.fillRect(x + kw - 2, y0 + 1 + dy, 1, kh - 3);
      const glyph = icon === "left_arrow" ? GLYPH.left : icon === "right_arrow" ? GLYPH.right : GLYPH[icon];
      if (glyph) drawBitmap(ctx, glyph, x + Math.round((kw - glyph[0].length) / 2), y0 + 2 + dy + Math.round((kh - 10 - glyph.length) / 2), active && dirOk ? PAL.hud.label : PAL.hud.muted, PAL.fighters.outline);
      else if (mid === "lock" && i === 1) { ctx.fillStyle = PAL.hud.muted; ctx.fillRect(x + 11, y0 + 7 + dy, 8, 6); ctx.fillRect(x + 12, y0 + 4 + dy, 1, 3); ctx.fillRect(x + 17, y0 + 4 + dy, 1, 3); ctx.fillRect(x + 12, y0 + 4 + dy, 6, 1); }
      ctx.globalAlpha = 1;
    });
  }

  // ---- HUD（高解析度文字） ----
  drawHudText(g, view, now) {
    const ph = view.phase, r = view.round, cam = this.cam, toScreen = (x, y) => [(x - cam.x) * cam.zoom + CONFIG.W / 2, (y - cam.y) * cam.zoom + CONFIG.H / 2];
    g.textBaseline = "alphabetic";
    g.font = "bold 7px sans-serif";
    for (const f of view.fighters) {
      const right = f.i === 1, team = PAL.fighters["p" + (f.i + 1)];
      g.textAlign = right ? "right" : "left"; g.fillStyle = team.secondary;
      g.fillText(this.names[f.i] + (view.seat === f.i ? "（你）" : ""), right ? 464 : 16, 66);
      if (f.stun > 0) { g.fillStyle = "#9CD8FF"; g.fillText(`硬直 ${f.stun.toFixed(1)}s`, right ? 464 : 16, 76); }
    }
    g.textAlign = "center";
    const fin = ph === PH.WINDOW, left = Math.max(0, view.dur - view.t);
    let label = PH_LABEL[ph] ?? "";
    if (ph === PH.RPS) label += view.t >= CONFIG.rps.reveal ? "・藏招" : "・亮招";
    if (fin && r?.type) label = r.type === "red" ? "翻滾！紅招不可彈反" : "彈反！按克制手勢";
    if (ph === PH.SELECT && r) label = "終結擇：短按選手勢｜長按贏拳鍵＝紅光";
    g.font = `bold ${fin ? 12 : 10}px sans-serif`;
    g.fillStyle = fin ? (r?.type === "red" ? PAL.fx.red.rim : PAL.fx.blue.rim) : PAL.hud.label;
    if (label) g.fillText(label, CONFIG.W / 2, 20);
    if (this.timed(view)) {
      const urgent = this.urgent(view);
      g.font = `bold ${fin ? 13 : 9}px monospace`;
      g.fillStyle = urgent ? (Math.floor(now * 20) % 2 ? PAL.fx.red.rim : PAL.hud.focusOutline) : PAL.hud.label;
      g.fillText(left.toFixed(fin ? 2 : 1), CONFIG.W / 2, fin ? 48 : 43);
    }
    // 連打 HIT COMBO 計數
    if (this.combo && (ph === PH.MASH || ph === PH.SELECT || now - this.combo.at < 0.8)) {
      const age = now - this.combo.at, pop = Math.max(0, 1 - age * 6), [sx, sy] = toScreen(this.combo.x, CONFIG.floorY - 74);
      g.save(); g.translate(sx, sy); g.scale(1 + pop * 0.5, 1 + pop * 0.5);
      g.font = "bold 13px sans-serif"; g.fillStyle = PAL.fighters.outline; g.fillText(`${this.combo.n} HIT COMBO!`, 1, 1);
      g.fillStyle = this.combo.n >= 6 ? PAL.fx.red.core : PAL.fx.impact.spark; g.fillText(`${this.combo.n} HIT COMBO!`, 0, 0);
      g.restore();
    }
    const K = ART.hud.keyRow, [kw, kh] = K.keySizePx, x0 = K.centerX - (kw * 3 + K.gapPx * 2) / 2;
    g.font = "bold 6px monospace"; g.fillStyle = PAL.hud.muted;
    ["L", "M", "R"].forEach((b, i) => g.fillText(view.seat >= 0 ? CONFIG.keyLabel[0][b] : `${CONFIG.keyLabel[0][b]}·${CONFIG.keyLabel[1][b]}`, x0 + i * (kw + K.gapPx) + kw / 2, K.topY + kh - 2));
    // 兩側：誰該做什麼
    g.font = "bold 7px sans-serif";
    for (const f of view.fighters) {
      const right = f.i === 1, Kl = CONFIG.keyLabel[view.seat >= 0 ? 0 : f.i];
      if (view.seat >= 0 && f.i !== view.seat) continue;              // 單人／線上只提示自己
      let tip = "";
      if (ph === PH.MOVE) tip = f.locked ? "已鎖定" : f.steps >= CONFIG.move.maxSteps ? "步數用完" : `${Kl.L}◀ ${Kl.M}鎖定 ${Kl.R}▶ 每步1氣`;
      else if (ph === PH.RPS) tip = f.stun > 0 ? "硬直中：按鍵鎖死" : `${Kl.L}石 ${Kl.M}剪 ${Kl.R}布`;
      else if (ph === PH.MASH && r) tip = f.i === r.att ? "狂按任意鍵追加連擊！" : "被壓著打…";
      else if (ph === PH.SELECT && r) tip = f.i === r.att ? (f.power >= CONFIG.select.redCost ? `短按選手勢｜長按${Kl[r.winKey]}＝紅光` : "短按選終結手勢") : "準備防守…";
      else if (fin && r?.type) tip = f.i === r.def ? (r.type === "blue" ? "按克制手勢！只有一次" : `往 ${r.dirs.map(d => (d < 0 ? Kl.L + "◀" : Kl.R + "▶")).join(" 或 ")} 翻滾！`) : "";
      g.textAlign = right && view.seat < 0 ? "right" : "left";
      g.fillStyle = fin && r?.def === f.i ? PAL.hud.focusOutline : PAL.hud.label;
      g.fillText(tip, right && view.seat < 0 ? 464 : 16, 252);
    }
    for (const p of this.fx) {
      if (p.k === "text") {
        const a = clamp(p.life / p.max, 0, 1), [sx, sy] = toScreen(p.x, p.y);
        g.globalAlpha = a; g.textAlign = "center"; g.font = `bold ${p.size}px sans-serif`;
        g.fillStyle = PAL.fighters.outline; g.fillText(p.text, sx + 1, sy + 1); g.fillStyle = p.color; g.fillText(p.text, sx, sy);
      } else if (p.k === "banner") {
        if (ph === PH.MASH && this.combo?.n) p.life = Math.min(p.life, 0.2);   // 連打開打：標題讓位給 HIT COMBO
        const a = clamp(p.life / p.max, 0, 1);
        g.globalAlpha = Math.min(1, a * 2); g.textAlign = "center"; g.font = "bold 16px sans-serif";
        g.fillStyle = "rgba(16,24,39,.8)"; g.fillRect(0, 104, CONFIG.W, 28); g.fillStyle = p.color; g.fillText(p.text, CONFIG.W / 2, 124);
      }
    }
    g.globalAlpha = 1;
    if (ph === PH.GAMEOVER && view.winner >= 0) {
      const team = PAL.fighters["p" + (view.winner + 1)];
      g.fillStyle = "rgba(16,24,39,.85)"; g.fillRect(0, 96, CONFIG.W, 56);
      g.textAlign = "center"; g.fillStyle = team.primary; g.font = "bold 22px sans-serif";
      g.fillText(`${this.names[view.winner]} 勝利！`, CONFIG.W / 2, 124);
      g.fillStyle = PAL.hud.label; g.font = "bold 9px sans-serif"; g.fillText("空白鍵再來一場｜Esc 回大廳", CONFIG.W / 2, 142);
    }
  }
}
