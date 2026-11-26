// renderer.js — 畫面（只吃 engine.viewFor() 的資料和事件，不改遊戲狀態）
//   · 480×270 邏輯畫布、關閉平滑、整數倍率放大；中文字另外用高解析度畫（才清楚）
//   · 繪製順序（美術聖經 §5）：背景 → 平台 → 紅區填色與斜紋 → 殘影 → 角色 → 命中粒子與 KO → 紅格邊線、藍框、方向箭頭 → HUD
//   · 頓幀只停「演出」：凍結世界層畫面幾十毫秒，HUD 倒數照走（引擎本身不停）
//   · 底部鍵位卡改由 keybar.js（DOM）負責；畫布只畫世界、提示與上方 HUD
//   · 15 個角色動畫狀態（美術換皮接口，見 ANIM_STATES）；有 Sprite Sheet 就照 ART.spriteAtlas 切格，沒有就程式繪製
//   · 拼刀另外 10 個狀態（CLASH_STATES）：fighter_p1_clash.png／fighter_p2_clash.png 照 CONFIG.clashAtlas（clash_art_spec.json v2）切格；
//     開牌壓制／受壓、勝利收勢讀 fighter_p*_v3_addon.png（CONFIG.extraAtlas）；
//     勝利大招特效有 vfx_win_*.png 就照 CONFIG.vfx 播放，沒有就用程式繪製（橘紅重砸、青色居合十字、綠色氣功光束）
import { PROC_VFX, FALLBACK_POSE, drawDummy, drawSigilProc } from "./procfx.js";
import { ART, CONFIG } from "./config.js";
import { PH, PH_LABEL, GLABEL, GNAME, GICON, COUNTER, cellX } from "./engine.js";
import { Assets } from "./assets.js";

export const ANIM_STATES = [
  "idle", "step", "exhausted", "stance_rock", "stance_scissors", "stance_paper", "stance_hidden", "clash",
  "mash_hit", "finisher_blue", "finisher_red", "parry_success", "roll", "hitstun", "knockback",
];
export const CLASH_STATES = Object.keys(CONFIG.clashAtlas.animations);
// 拼刀圖集還沒放：借用基礎圖集裡最接近的動作
const CLASH_FALLBACK = { clash_dash: "step", clash_rock: "clash", clash_scissors: "clash", clash_paper: "clash", clash_recoil: "hitstun", clash_first_draw: "clash", clash_win_rock: "finisher_red", clash_win_scissors: "finisher_red", clash_win_paper: "finisher_red", clash_draw: "clash" };
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

// ---------------- 架式氣泡與手勢圖示（ART.telegraphs.stanceBubbles，v1.2） ----------------
//   24×24 對話框（含下方小尾巴）、14×14 手勢幾何；藍招頭頂框沿用同一套手勢幾何、改用藍色盤
const SB = ART.telegraphs.stanceBubbles;
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const BUBBLE = (() => {
  const [W, H] = SB.sizePx, poly = SB.framePolygonPx.map(([x, y]) => [x * (W / (W - 1)), y * (H / (H - 1))]);   // 頂點是像素索引（含）→ 換成邊界座標
  const inside = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => inPoly(x + 0.5, y + 0.5, poly)));
  const at = (x, y) => y >= 0 && y < H && x >= 0 && x < W && inside[y][x];
  const fill = [], rim = [], outline = [];
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    if (at(x, y)) { fill.push([x, y]); if (!at(x, y - 1) || !at(x - 1, y) || !at(x + 1, y)) rim.push([x, y]); }   // 內緣亮線：上緣與左右兩側
    else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) outline.push([x, y]);
  }
  return { fill, rim, outline };
})();
const GLYPH_PIX = {};
for (const [k, v] of Object.entries(SB.variants)) {
  const G = v.geometry, ink = new Set(), acc = new Set();
  for (const [x, y, w, h] of G.inkRects ?? []) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) ink.add(xx + "," + yy);
  for (const poly of G.inkPolygons ?? []) for (let yy = 0; yy < 14; yy++) for (let xx = 0; xx < 14; xx++) if (inPoly(xx + 0.5, yy + 0.5, poly)) ink.add(xx + "," + yy);
  for (const [x, y, w, h] of G.clearRects ?? []) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) ink.delete(xx + "," + yy);
  for (const [x, y, w, h] of G.accentRects ?? []) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { ink.delete(xx + "," + yy); acc.add(xx + "," + yy); }
  GLYPH_PIX[k] = { ink: [...ink].map(p => p.split(",").map(Number)), acc: [...acc].map(p => p.split(",").map(Number)) };
}
const GESTURE_GLYPH = { rock: "rock", scissors: "scissors", paper: "paper", hidden: "hidden" };
function drawGestureGlyph(g, key, x, y, ink, accent) {
  const G = GLYPH_PIX[key]; if (!G) return;
  g.fillStyle = ink; for (const [px, py] of G.ink) g.fillRect(x + px, y + py, 1, 1);
  g.fillStyle = accent; for (const [px, py] of G.acc) g.fillRect(x + px, y + py, 1, 1);
}
function drawBubble(g, x0, y0, key, now, reduced) {
  const v = SB.variants[key]; if (!v) return;
  g.fillStyle = SB.outerOutline; for (const [x, y] of BUBBLE.outline) g.fillRect(x0 + x, y0 + y, 1, 1);
  g.fillStyle = v.panel; for (const [x, y] of BUBBLE.fill) g.fillRect(x0 + x, y0 + y, 1, 1);
  g.fillStyle = v.rim; for (const [x, y] of BUBBLE.rim) g.fillRect(x0 + x, y0 + y, 1, 1);
  const [gx, gy] = SB.glyphOriginPx;
  if (v.mist) {                                                    // 藏招：框內飄一點黑霧（減少動態時固定）
    const M = v.mist, step = reduced && M.staticWhenReducedMotion ? 0 : Math.floor(now * 1000 / M.stepMs);
    g.globalAlpha = M.maxOpacity;
    for (let i = 0; i < M.maxClusters; i++) { const k = (i * 7 + step) % 12; g.fillStyle = M.colors[(i + step) % M.colors.length]; g.fillRect(x0 + 3 + ((k * 5 + i * 3) % 15), y0 + 3 + ((k * 3 + i * 5) % 13), M.clusterSizePx[0], M.clusterSizePx[1]); }
    g.globalAlpha = 1;
  }
  drawGestureGlyph(g, key, x0 + gx, y0 + gy, v.ink, v.accent);
}

// ---------------- 武者（程式繪製／Sprite Sheet） ----------------
const Fighter = (() => {
  const A = ART.spriteAtlas, WA = ART.weaponVariantAtlas, F = PAL.fighters;
  const CA = CONFIG.clashAtlas, XA = CONFIG.extraAtlas, EA = CONFIG.charExtraAtlas, DA = CONFIG.dummyAtlas;
  // 正式圖檔由 assets.js 預載（public/fist/ 下）：基礎 500×800、武器 500×500、拼刀加購 500×450；缺檔就用程式繪製
  //   sheets[i] 可用 Renderer.useSheet 手動覆蓋；沒覆蓋就讀預載好的圖
  const manual = [null, null], PK = ["p1", "p2"];
  const baseOf = i => manual[i] ?? Assets.get(A.imageByPlayer[PK[i]]);
  const weapOf = i => Assets.get(WA.imageByPlayer[PK[i]]);
  const clashOf = i => Assets.get(CA.imageByPlayer[PK[i]]);
  const extraOf = i => Assets.get(XA.imageByPlayer[PK[i]]);
  const charOf = i => Assets.get(EA.imageByPlayer[PK[i]]);                  // 擴充角色動作包（選配）
  const dummyOf = () => Assets.get(DA.imageByPlayer.p1);                      // 訓練場木樁（選配）
  // 加購動作：拼刀專用圖集、開牌／勝利圖集、擴充動作包或木樁圖；圖不在就回傳 null
  const ADDON = [[CA, clashOf], [XA, extraOf], [EA, charOf], [DA, dummyOf]];
  const animOf = state => { for (const [T] of ADDON) if (T.animations[state]) return T.animations[state]; return null; };
  const addonFor = (state, i) => { for (const [T, get] of ADDON) if (T.animations[state]) { const img = get(i); return img ? { img, an: T.animations[state] } : null; } return null; };
  const addonFrame = (an, t) => { const n = Math.floor(t * an.fps); return an.playback === "loop" ? n % an.frames : Math.min(n, an.frames - 1); };
  // 受擊閃白：把那一格 sprite 畫到小畫布、整塊染白（保留角色輪廓），再貼回去
  let tint = null;
  function whiteCell(img, sx, sy, col = PAL.fx.impact.core) {
    if (!tint) { if (typeof document === "undefined") return null; tint = document.createElement("canvas"); tint.width = A.frameWidth; tint.height = A.frameHeight; }
    const t = tint.getContext("2d");
    t.imageSmoothingEnabled = false; t.globalCompositeOperation = "source-over"; t.clearRect(0, 0, tint.width, tint.height);
    t.drawImage(img, sx, sy, A.frameWidth, A.frameHeight, 0, 0, A.frameWidth, A.frameHeight);
    t.globalCompositeOperation = "source-in"; t.fillStyle = col; t.fillRect(0, 0, tint.width, tint.height);
    return tint;
  }
  const ATTACK_STATES = new Set(["clash", "mash_hit", "finisher_blue", "finisher_red"]);
  const STATES_BASE = new Set([...Object.keys(A.animations), "mash_hit"]);       // 基礎圖集畫得出來的動作
  function atlasAnim(state, alt) { return A.animations[ATLAS_ROW_OF(state) ?? (alt ? "combo_2" : "combo_1")]; }
  function frameOf(state, t, f, view) {
    const an = atlasAnim(state, f.anim.alt);
    if (!an) return 0;
    const n = Math.floor(t * an.fps);
    if (an.playback === "loop") return n % an.frames;
    if (an.playback === "hold_last") return Math.min(n, an.frames - 1);
    if (an.playback === "tail_loop") return n < an.frames ? n : an.loopStartFrame + ((n - an.loopStartFrame) % (an.frames - an.loopStartFrame));
    if (state === "finisher_blue" || state === "finisher_red") {                 // 0–7 格對應判定窗，第 8 格在命中事件上
      if (!f.fin) { const k = view?.phase === PH.COMBO_CUE ? clamp(view.t / view.dur, 0, 0.999) : 0; return Math.floor(k * (an.keyFrames.windupLast + 1)); }
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
  // ---- 三把實體武器（美術聖經 v1.1 §2）：石頭＝大槌子、剪刀＝一把張開的 V 字大剪刀、布＝鼓鼓的大布袋 ----
  //   座標都是 48×48 角色格、面右；腳底錨點 (24,40)
  const line = (x0, y0, x1, y1, c, t = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) P(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), t, t, c); };
  const ell = (cx, cy, rx, ry, c) => { for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2))); if (w > 0) P(Math.round(cx - w), Math.round(cy + y), w * 2, 1, c); } };
  const ring = (x, y, c) => { P(x, y, 4, 1, c); P(x, y + 3, 4, 1, c); P(x, y, 1, 4, c); P(x + 3, y, 1, 4, c); };
  const WP = {
    // 大槌子：槌頭 14×9（左上角 hx,hy），長柄接到握點 (gx,gy)
    hammer(hx, hy, gx, gy) {
      line(gx, gy, hx + 7, hy + 4, "B", 2);
      P(hx, hy, 14, 9, "M"); P(hx + 1, hy + 1, 12, 1, "H"); P(hx, hy + 3, 14, 2, "B"); P(hx + 12, hy + 1, 1, 7, "S");
      P(gx - 1, gy - 1, 3, 3, "K"); P(gx - 4, gy + 1, 3, 3, "K");
    },
    // 大剪刀：鉸鏈 (x,y)，刃往前（+x）長 len、刃尖張開 spread（≥4 才看得出 V）；鉸鏈後面兩個柄環
    shears(x, y, spread, len) {
      const up = Math.ceil(spread / 2), dn = spread - up;
      line(x, y - 1, x + len, y - 1 - up, "M", 2); line(x + 1, y - 1, x + len - 1, y - 1 - up, "H");
      line(x, y + 1, x + len, y + 1 + dn, "M", 2);
      ring(x - 7, y - 5, "B"); ring(x - 7, y + 2, "B"); line(x - 4, y - 2, x, y, "B"); line(x - 4, y + 3, x, y + 1, "B");
      P(x - 1, y - 1, 3, 3, "B"); P(x, y, 1, 1, "H");
      P(x - 8, y - 4, 3, 3, "K"); P(x - 8, y + 3, 3, 3, "K");
    },
    // 大布袋：袋口 (mx,my) 收窄打結，袋腹 w×h 往下鼓（lag：袋身慢一拍的偏移）
    sack(mx, my, w, h, lag = 0) {
      const cx = mx + lag, cy = my + 3 + Math.round(h / 2);
      ell(cx, cy, Math.round(w / 2), Math.round(h / 2), "C");
      ell(cx + 2, cy + 2, Math.round(w / 2) - 3, Math.round(h / 2) - 3, "D"); ell(cx - 1, cy - 1, Math.round(w / 2) - 3, Math.round(h / 2) - 3, "C");
      line(cx - 2, cy - Math.round(h / 2) + 3, cx + 1, cy + Math.round(h / 2) - 2, "D");       // 縫線
      P(mx - 2, my, 5, 3, "C"); P(mx - 3, my + 2, 7, 1, "T");                                     // 收窄的袋口＋繩結
      P(mx - 4, my - 1, 3, 3, "K"); P(mx + 2, my - 1, 3, 3, "K");
    },
    armDown(dx, dy) { P(26 + dx, 23 + dy, 3, 8, "P"); P(26 + dx, 31 + dy, 3, 2, "K"); },
  };
  // 攻擊姿勢：kind = clash | jab | sweep | windBlue | hitBlue | windRed | hitRed；r = 後座（像素）
  const ATTACK = {
    rock: {
      clash: (dx, dy, r) => WP.hammer(32 + dx - r, 12 + dy, 26 + dx, 24 + dy),
      jab: (dx, dy, r) => WP.hammer(15 + dx - r, 9 + dy, 34 + dx - r, 25 + dy),                // 槌柄短頂
      sweep: (dx, dy, r) => WP.hammer(32 + dx - r, 27 + dy, 25 + dx, 26 + dy),                 // 轉髖低掃
      windBlue: (dx, dy) => WP.hammer(7 + dx, 3 + dy, 22 + dx, 22 + dy),
      hitBlue: (dx, dy, r) => WP.hammer(33 + dx - r, 23 + dy, 27 + dx, 23 + dy),              // 跨步下砸
      windRed: (dx, dy) => WP.hammer(15 + dx, 0 + dy, 25 + dx, 21 + dy),                      // 拉過頭頂
      hitRed: (dx, dy) => WP.hammer(32 + dx, 31 + dy, 27 + dx, 26 + dy),                      // 砸地、槌頭沉住
    },
    scissors: {
      clash: (dx, dy, r) => WP.shears(33 + dx - r, 23 + dy, 9, 11),
      jab: (dx, dy, r) => WP.shears(35 + dx - r, 24 + dy, 5, 10),                            // 半開刃前刺
      sweep: (dx, dy, r) => WP.shears(33 + dx - r, 24 + dy, 12, 11),                         // 大幅開闔
      windBlue: (dx, dy) => WP.shears(27 + dx, 24 + dy, 12, 10),
      hitBlue: (dx, dy, r) => WP.shears(33 + dx - r, 25 + dy, 1, 14),                        // 瞬間合攏
      windRed: (dx, dy) => WP.shears(30 + dx, 33 + dy, 10, 12),                              // 低身拖開
      hitRed: (dx, dy) => WP.shears(31 + dx, 36 + dy, 2, 15),                                // 貼地橫掃後剪合
    },
    paper: {
      clash: (dx, dy, r) => WP.sack(32 + dx - r, 17 + dy, 14, 11, 3),                        // 袋腹相撞擠扁
      jab: (dx, dy, r) => WP.sack(35 + dx - r, 18 + dy, 10, 9, 3),                           // 袋口短甩
      sweep: (dx, dy, r) => WP.sack(33 + dx - r, 9 + dy, 16, 13, 4),                         // 轉身甩出鼓袋
      windBlue: (dx, dy) => WP.sack(20 + dx, 8 + dy, 14, 12, -4),
      hitBlue: (dx, dy, r) => WP.sack(37 + dx - r, 10 + dy, 16, 16, 2),                      // 袋口罩住對方輪廓
      windRed: (dx, dy) => WP.sack(27 + dx, 2 + dy, 16, 12, 0),                              // 雙手掄起整袋
      hitRed: (dx, dy) => WP.sack(38 + dx, 31 + dy, 20, 6, 0),                               // 拍地壓扁
    },
  };
  const attack = (g, kind, dx, dy, r = 0) => (ATTACK[g] ?? ATTACK.rock)[kind](dx, dy, r);
  const STATES = {
    idle(f, n) { const b = body(f.i, { dy: n === 3 ? 1 : 0 }); WP.armDown(b.dx, b.dy); },
    step(f, n) { const b = body(f.i, { spread: n >= 1 && n <= 3 ? 3 : 1, dx: 1 }); WP.armDown(b.dx, b.dy); },
    exhausted(f, n) { const b = body(f.i, { dy: 3, dx: 2, hx: 2, hy: n === 2 ? 2 : 1, eyes: "shut", mouth: true }); P(27 + b.dx, 25 + b.dy, 3, 8, "P"); P(27 + b.dx, 33 + b.dy, 3, 2, "K"); const y = Math.floor((f.anim.t * 24) % 8); P(14, 10 + y, 1, 2, "fx"); P(32, 12 + ((y + 4) % 8), 1, 2, "fx"); },
    // 架式 6 幀：石頭第 2 格膝蓋吃重、第 4 格抬回；剪刀第 2 格開到最大、第 4 格半合；布袋第 2 格提袋口、第 4 格擠壓回彈
    stance_rock(f, n) { const dip = [0, 0, 1, 1, -1, 0][n] ?? 0; const b = body(f.i, { spread: 2, dy: Math.max(0, dip) }); WP.hammer(11 + b.dx, 0 + b.dy + Math.min(0, dip), 27 + b.dx, 23 + b.dy); },
    stance_scissors(f, n) { const b = body(f.i, { spread: 3, dx: 2, dy: 3 }); WP.shears(34 + b.dx - 2, 25, [6, 8, 10, 8, 6, 7][n] ?? 6, 11); },
    stance_paper(f, n) { const lift = [0, -1, -2, -1, 0, 0][n] ?? 0, lag = [0, 0, -1, -2, -1, 0][n] ?? 0; const b = body(f.i, { spread: 2, dx: 1 }); const sq = n === 4; WP.sack(33 + b.dx, 22 + lift, sq ? 18 : 16, sq ? 13 : 14, 2 + Math.round(lag / 2)); },
    stance_hidden(f, n) { const b = body(f.i, { spread: 1, dy: n === 1 ? 1 : 0 }); P(24 + b.dx, 24 + b.dy, 6, 5, "P"); },
    clash(f) { const b = body(f.i, { spread: 3, dx: -2, eyes: "shut" }); attack(f.stance, "clash", b.dx + 1, b.dy, 0); },
    mash_hit(f) { const alt = f.anim.alt, k = Math.min(1, f.anim.t * 12); const b = body(f.i, { spread: alt ? 5 : 4, dx: alt ? 5 : 3, dy: alt ? 1 : 0 }); attack(f.stance, alt ? "sweep" : "jab", b.dx - 3, b.dy - (alt ? 2 : 0), Math.round(3 * k)); },
    finisher_blue(f) { if (!f.fin) { const b = body(f.i, { spread: 3, dx: -2 }); attack(f.stance, "windBlue", b.dx, b.dy - 2); } else { const b = body(f.i, { spread: 5, dx: 5 }); attack(f.stance, "hitBlue", b.dx - 4, b.dy, 0); } },
    // 紅招：蓄力時肩線亮紅邊光
    finisher_red(f) { if (!f.fin) { const b = body(f.i, { spread: 4, dy: 3 }); attack(f.stance, "windRed", b.dx, b.dy - 3); P(16 + b.dx, 20 + b.dy, 4, 1, "R"); P(27 + b.dx, 20 + b.dy, 4, 1, "R"); } else { const b = body(f.i, { spread: 6, dx: 3, dy: 4 }); attack(f.stance, "hitRed", b.dx - 3, b.dy - 4); } },
    parry_success(f) { const b = body(f.i, { spread: 4, dx: 2 }); P(29 + b.dx, 17 + b.dy, 3, 12, "P"); P(30 + b.dx, 15 + b.dy, 4, 3, "K"); },
    roll(f) { P(15, 24, 18, 16, "P"); P(17, 26, 14, 12, "S"); P(22, 28, 7, 6, "K"); P(21, 26, 9, 2, f.i === 0 ? "W" : "S"); },
    hitstun(f) { const b = body(f.i, { dx: -3, hx: -2, hy: 1, eyes: "x", mouth: true }); P(20 + b.dx, 23 + b.dy, 3, 7, "P"); },
    // ---- 拼刀 10 個動作（程式繪製版） ----
    clash_dash(f, n) { const b = body(f.i, { spread: 5, dx: 4, dy: 2 }); attack(f.stance ?? "rock", "windBlue", b.dx - 2, b.dy - 1); P(6, 30 + (n % 2), 6, 1, "fx"); P(3, 34, 8, 1, "fx"); },
    clash_rock(f, n) { const b = body(f.i, { spread: 4, dx: 3 }); attack("rock", n < 2 ? "windBlue" : "hitBlue", b.dx - 2, b.dy, n < 2 ? 0 : 1); },
    clash_scissors(f, n) { const b = body(f.i, { spread: 4, dx: 4 }); attack("scissors", n < 2 ? "windBlue" : "hitBlue", b.dx - 2, b.dy, n < 2 ? 0 : 1); },
    clash_paper(f, n) { const b = body(f.i, { spread: 4, dx: 3 }); attack("paper", n < 2 ? "windBlue" : "hitBlue", b.dx - 2, b.dy, n < 2 ? 0 : 1); },
    clash_recoil(f, n) { const b = body(f.i, { dx: -4 - Math.min(n, 2), hx: -2, hy: 1, eyes: "x", mouth: true }); attack(f.stance ?? "rock", "clash", b.dx - 2, b.dy + 2, 3); },
    clash_first_draw(f, n) { const b = body(f.i, { spread: 3, dx: 1, dy: n < 3 ? 1 : 0 }); attack(f.stance ?? "rock", "windRed", b.dx, b.dy - 2); P(30 + b.dx, 8 + b.dy, 1, 5, "fx"); P(28 + b.dx, 10 + b.dy, 5, 1, "fx"); },
    clash_win_rock(f, n) { if (!f.fin) { const b = body(f.i, { spread: 2, dy: -2 }); WP.hammer(14 + b.dx, -6 + b.dy, 26 + b.dx, 18 + b.dy); } else { const b = body(f.i, { spread: 6, dx: 3, dy: 4 }); attack("rock", "hitRed", b.dx - 3, b.dy - 4); } },
    clash_win_scissors(f, n) { if (!f.fin) { const b = body(f.i, { spread: 6, dx: 6, dy: 3 }); attack("scissors", "hitBlue", b.dx - 2, b.dy); } else { const b = body(f.i, { spread: 2, dx: -1 }); WP.armDown(b.dx, b.dy); P(28 + b.dx, 22 + b.dy, 2, 10, "M"); } },
    clash_win_paper(f, n) { const b = body(f.i, { spread: 5, dx: f.fin ? 5 : 2, dy: 2 }); attack("paper", f.fin ? "hitRed" : "windRed", b.dx - 3, b.dy - 2); },
    clash_draw(f, n) { const b = body(f.i, { spread: 3, dx: -3, eyes: "shut" }); attack(f.stance ?? "rock", "clash", b.dx - 2, b.dy, 4); },
    knockback(f) { const b = body(f.i, { spread: 5, dx: -3, eyes: "x", mouth: true }); P(14 + b.dx, 18 + b.dy, 6, 3, "P"); P(28 + b.dx, 16 + b.dy, 6, 3, "P"); },
  };
  function colorsFor(f, mode, tint) {
    const p = F["p" + (f.i + 1)];
    if (mode === "hidden") return { P: F.hiddenFill, S: F.hiddenFill, W: p.secondary, H: F.hiddenFill, K: F.hiddenFill, M: F.hiddenFill, B: F.hiddenFill, C: F.hiddenFill, D: F.hiddenFill, T: F.hiddenFill, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
    if (mode === "white") { const w = tint ?? PAL.fx.impact.core; return { P: w, S: w, W: w, H: w, K: w, M: w, B: w, C: w, D: w, T: w, O: w, R: w, fx: w }; }
    return { P: p.primary, S: p.shadow, W: p.secondary, H: p.highlight, K: CONFIG.skin, M: F.neutralSteel, B: PAL.platform.oxidizedBronze, C: CONFIG.cloth.fill, D: CONFIG.cloth.shade, T: CONFIG.cloth.tie, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
  }
  return {
    frameOf, sheets: manual, baseOf, clashOf, animOf, addonFrame,
    has: (state, i) => !!addonFor(state, i),
    // 解析這一幀要畫哪張圖：回傳 { img, row, anim }（anim＝加購圖集動作名；沒有就照基礎圖集）或 null（程式繪製）
    //   state 可以是引擎動作（clash_rock…）或畫面層覆寫的加購動作（reveal_win／clash_charge／victory）
    draw(ctx, f, state, t, x, y, face, opt = {}) {
      g = ctx; OX = Math.round(x); OY = Math.round(y); FACE = face < 0 ? -1 : 1;
      const base = baseOf(f.i), ad = addonFor(state, f.i);
      if (!ad) {
        if (CLASH_FALLBACK[state] && base) state = CLASH_FALLBACK[state];      // 有基礎圖、沒拼刀圖：借最接近的基礎動作
        else if (XA.animations[state] || EA.animations[state] || DA.animations[state] || state === "clash_charge") state = opt.fallbackState ?? "idle";
      }
      let n = ad ? clamp(opt.frame ?? addonFrame(ad.an, t), 0, ad.an.frames - 1) : frameOf(state, t, f, opt.view);
      if (ad && ad.an.flashFrame === n && REDUCED) n = Math.min(ad.an.frames - 1, n + 1);   // 減少動態：跳過閃白格
      if (ad?.an.renderOffsetY) OY += ad.an.renderOffsetY[n] ?? 0;            // 崩山重砸的跳躍：只位移圖，腳底錨點不動
      const rot = state === "knockback" ? (f.rot || t * 10) : state === "roll" ? t * 22 : 0;
      // 以腳底錨點 (pivot) 為原點水平翻轉：ctx.scale(facing, 1)，轉身、換位、落地時腳底不會左右瞬移
      const blit = (img, col, row) => {
        const sx = A.originX + A.strideX * col, sy = A.originY + A.strideY * row;
        const src = opt.white ? whiteCell(img, sx, sy, opt.tint) : img;
        if (!src) return false;
        g.translate(OX, OY); g.scale(FACE, 1);
        if (opt.white) g.drawImage(src, -A.pivot.x, -A.pivot.y);
        else g.drawImage(img, sx, sy, A.frameWidth, A.frameHeight, -A.pivot.x, -A.pivot.y, A.frameWidth, A.frameHeight);
        return true;
      };
      g.save();
      if (opt.alpha !== undefined) g.globalAlpha = opt.alpha;
      if (rot) { g.translate(OX, OY - 14); g.rotate(state === "roll" ? face * rot : -face * rot); g.translate(-OX, -(OY - 14)); }
      g.imageSmoothingEnabled = false;
      let drawn = false;
      if (ad) drawn = blit(ad.img, n, ad.an.row);                                  // 拼刀專用／開牌勝利加購圖集
      else if (base && STATES_BASE.has(state)) {
        const an = atlasAnim(state, f.anim.alt), wsh = weapOf(f.i);
        let img = base, row = an.row, col = n;
        // 大剪刀／大布袋的攻擊動作：讀武器圖集；變體圖還沒好 → 先停在對應武器的架式（不會突然變成槌子）
        const gest = ATTACK_STATES.has(state) ? f.stance : null;
        if (gest === "scissors" || gest === "paper") {
          const key = state === "mash_hit" ? (f.anim.alt ? "combo_2" : "combo_1") : state, v = WA.variantsByGesture[gest]?.[key];
          if (v && wsh) { img = wsh; row = v.row; }
          else { row = A.animations[ART.weapons.byGesture[gest].stanceState].row; col = 0; }
        }
        drawn = blit(img, col, row);
      }
      if (!drawn) {
        parts = [];
        (STATES[state] ?? STATES.idle)(f, n);
        const mode = opt.white ? "white" : state === "stance_hidden" ? "hidden" : "normal";
        flush(colorsFor(f, mode, opt.tint), opt.rim ? PAL.fx.impact.core : mode === "white" ? null : F.outline);
      }
      g.restore();
    },
  };
})();

// ---------------- 拼刀勝利特效圖（vfx_win_*.png：一張橫條 frames 格；沒有就程式繪製） ----------------
const VFX = (() => {
  const imgOf = key => Assets.get(CONFIG.vfx[key]?.file);
  // 第幾格：clip（片段，可循環）或整條播一次（hold_last）；超過播放長度回傳 -1（不畫）
  function frameAt(v, age, clip) {
    const c = clip && v.clips?.[clip], start = c ? c.start : 0, len = c ? c.end - c.start + 1 : v.frames, n = Math.floor(age * v.fps);
    if (c?.loop || (!c && v.loop)) return start + (n % len);
    return n < len ? start + n : -1;
  }
  return {
    has: key => !!imgOf(key),
    duration(key, clip) { const v = CONFIG.vfx[key], c = clip && v.clips?.[clip]; return (c ? c.end - c.start + 1 : v.frames) / v.fps; },
    // dir＝-1 時以貼齊點為軸水平翻轉；回傳 false＝沒圖（呼叫端改用程式繪製）
    draw(ctx, key, age, x, y, dir = 1, clip = null) {
      const v = CONFIG.vfx[key], img = imgOf(key);
      if (!img) return false;
      const n = frameAt(v, age, clip);
      if (n < 0) return true;
      const [px, py] = v.pivot ?? [v.anchor === "front" ? 0 : v.frameW / 2, v.anchor === "foot" ? v.frameH : v.frameH / 2];
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(x), Math.round(y)); if (dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, n * v.frameW, 0, v.frameW, v.frameH, -px, -py, v.frameW, v.frameH);
      ctx.restore();
      return true;
    },
  };
})();

// 擴充包：連勝氣場出現的階段；揮刀殘影貼齊點（相對腳底錨點：槌握點、刃口、掌心）
const AURA_PH = new Set([PH.BURST, PH.COMBO_PREP, PH.COMBO_CUE, PH.COMBO_HIT]);
const SMEAR_AT = { rock: [2, -16], scissors: [16, -17], paper: [11, -20] };
const FIN_COLOR = { rock: "#FF6A3D", scissors: "#5FE6FF", paper: "#7CF29A" };
// 拼刀特效（程式繪製；k＝0→1 播放進度）。有 vfx 圖檔時大招改播圖
const CLASH_FX = {
  pv(g, p, a, k) { PROC_VFX[p.key].draw(g, p.x, p.y, p.dir ?? 1, k, k * p.max, p.seed); },   // 程式特效（缺 PNG 時）
  vs(g, p, a, k) { VFX.draw(g, p.key, k * p.max, p.x, p.y, p.dir ?? 1, p.clip ?? null); },   // 一般特效圖（火花、刀光、地裂、KO 光柱）
  wave(g, p, a, k) { const r = 10 + k * 150; g.globalAlpha = a; g.strokeStyle = "#FFFFFF"; g.lineWidth = 4 * a + 1; g.beginPath(); g.ellipse(p.x, CONFIG.floorY - 24, r, r * 0.55, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = a * 0.35; g.fillStyle = "#FFFFFF"; g.fill(); },
  star(g, p, a, k) { if (VFX.draw(g, "vfx_first_draw_star", k * p.max, p.x, p.y, p.dir ?? 1)) return; const r = 6 + k * 26; g.globalAlpha = a; g.fillStyle = "#FFD45A"; g.fillRect(Math.round(p.x - r), Math.round(p.y) - 1, Math.round(r * 2), 3); g.fillRect(Math.round(p.x) - 1, Math.round(p.y - r), 3, Math.round(r * 2)); g.fillStyle = "#FFF6D0"; g.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5); },
  speed(g, p, a) { g.globalAlpha = a * 0.5; g.fillStyle = "#DDE8FF"; for (let i = 0; i < 9; i++) { const y = 70 + ((i * 37 + Math.floor(p.life * 300)) % 140); g.fillRect(((i * 97) % CONFIG.W), y, 40, 1); } },
  streak(g, p, a) { g.globalAlpha = a; g.fillStyle = "#5FE6FF"; const x = Math.min(p.x0, p.x1), w = Math.abs(p.x1 - p.x0); g.fillRect(Math.round(x), CONFIG.floorY - 26, Math.round(w), 3); g.fillStyle = "#FFFFFF"; g.fillRect(Math.round(x), CONFIG.floorY - 25, Math.round(w), 1); },
  slam(g, p, a, k) {
    const r = 8 + k * 70; g.globalAlpha = a; g.strokeStyle = "#FF6A3D"; g.lineWidth = 3; g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.25, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "#FFB15A"; g.lineWidth = 1; g.beginPath(); g.ellipse(p.x, p.y, r * 0.6, r * 0.15, 0, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = a * 0.8; g.fillStyle = "#FF6A3D"; g.fillRect(Math.round(p.x - 6 * a), p.y - 90, Math.round(12 * a), 90);   // 由上而下的砸擊光柱
  },
  cross(g, p, a, k) {
    const r = 10 + k * 48; g.globalAlpha = a; g.translate(p.x, p.y); g.rotate(Math.PI / 4);
    g.fillStyle = "#5FE6FF"; g.fillRect(-r, -3, r * 2, 6); g.fillRect(-3, -r, 6, r * 2);
    g.fillStyle = "#FFFFFF"; g.fillRect(-r * 0.8, -1, r * 1.6, 2); g.fillRect(-1, -r * 0.8, 2, r * 1.6);
  },
  pbeam(g, p, a, k) {
    const len = 30 + Math.min(1, k * 3) * 520, h = 22 * a + 6, x = p.dir > 0 ? p.x + 8 : p.x - 8 - len;
    g.globalAlpha = a * 0.9; g.fillStyle = "#3ED27A"; g.fillRect(Math.round(x), Math.round(p.y - h / 2), Math.round(len), Math.round(h));
    g.fillStyle = "#C8FFD8"; g.fillRect(Math.round(x), Math.round(p.y - h / 6), Math.round(len), Math.max(1, Math.round(h / 3)));
  },
};

// ---------------- Renderer ----------------
export class Renderer {
  constructor(canvas) {
    this.screen = canvas; this.sctx = canvas.getContext("2d");
    this.buf = document.createElement("canvas"); this.buf.width = CONFIG.W; this.buf.height = CONFIG.H;
    this.ctx = this.buf.getContext("2d");
    this.scale = 1; this.dpr = 1;
    this.fx = []; this.trails = [[], []]; this.trailClock = [0, 0]; this.lastXY = [null, null];
    this.freezeUntil = 0; this.frozen = null; this.shake = { amp: 0, until: 0 };
    this.flashF = [0, 0]; this.rimT = [0, 0]; this.keyFlash = { L: 0, M: 0, R: 0 }; this.combo = null;
    this.callout = null; this.goFlash = -9; this.bigNum = { v: null, at: 0 }; this.streakAt = [-9, -9]; this.cueAt = -9;   // v4：中央回饋大字、出招！、大倒數、連勝燈
    this.cam = { zoom: 1, x: CONFIG.W / 2, y: CONFIG.H / 2 };
    this.lb = 0; this.impactLeft = 0; this.gaugeAt = -9; this.gaugeFullAt = -9; this.tiebreakAt = -9; this.finText = null;   // 拼刀：黑邊、衝擊幀、蓄力閃爍
    this.stars = Array.from({ length: 46 }, () => ({ x: (Math.random() * CONFIG.W) | 0, y: (Math.random() * 110) | 0, tw: Math.random() * 6 }));
    this.names = CONFIG.names.slice();
    this.showHints = true;                                // 出招提示：頭頂拳種氣泡、藏招 ❓（main.js 依設定切換）
    this.dmgFx = [0, 1].map(() => ({ prev: 0, hitAt: 0, smokeAt: 0, sparkAt: 0, parts: [], band: null }));
    this.act = [null, null]; this.wclock = 0; this.heatAt = [-9, -9];
    this.sq = [null, null]; this.kickV = null; this.rgbUntil = -9; this.cool = [null, null]; this.sig = [null, null];   // v2 打擊感：角色形變、方向鏡頭踹擊、RGB 錯位   // 擴充動作包：畫面層一次性動作（播完交回引擎動作）；wclock＝世界時鐘（頓幀時停）
    this.resize();
  }
  static get ANIM_STATES() { return ANIM_STATES; }
  useSheet(seat, img) { Fighter.sheets[seat] = img; }      // 手動接 Sprite Sheet（500×800，切格表照 ART.spriteAtlas）
  hasSheet(seat) { return !!Fighter.baseOf(seat); }
  setNames(n) { this.names = n; }
  keyPress(btn) { this.keyFlash[btn] = 0.12; }
  reset() { this.callout = null; this.goFlash = -9; this.lb = 0; this.impactLeft = 0; this.finText = null; this.fx = []; this.trails = [[], []]; this.combo = null; this.freezeUntil = 0; this.frozen = null; this.dmgFx = [0, 1].map(() => ({ prev: 0, hitAt: 0, smokeAt: 0, sparkAt: 0, parts: [], band: null })); this.act = [null, null]; }
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
          this.kick(px, e.shakeMs ? ms(e.shakeMs) : ms(d) + 0.06, now, e.vertical);
          break;
        }
        case "step": if (e.bump) { this.spark((cellX(e.from) + cellX(e.to)) / 2, CONFIG.floorY - 22, PAL.fx.impact.spark, 4, 1.6); this.popup((cellX(e.from) + cellX(e.to)) / 2, CONFIG.floorY - 52, "頂撞！", PAL.fx.impact.spark, 9); this.kick(1, 0.06, now); } break;
        case "lock": { const f = view.fighters[e.p]; this.popup(f.x, CONFIG.floorY - 58, "鎖定", PAL.hud.muted, 8); if (e.fast) { this.ring(f.x + f.face * 8, CONFIG.floorY - 24, PAL.fx.impact.core); this.squash(e.p, "attack"); } break; }   // v2：鎖定當幀微閃光（不透露拳種）
        case "hide": this.trails = [[], []]; break;                                           // 藏招第一幀：清掉殘影
        // （開牌結果改由畫面中央的大字顯示，不在頭上另外冒小字）
        case "clash":
          if (e.wave) { this.fx.push({ k: "wave", x: e.x, life: 0.55, max: 0.55 }); this.popup(e.x, CONFIG.floorY - 72, "平分！各自彈開", PAL.fx.impact.core, 12); this.kick(3, 0.16, now); }
          else { if (!this.sprite("vfx_clash_spark", e.x, CONFIG.floorY - 26) && !this.sprite("vfx_sparks", e.x, CONFIG.floorY - 26)) this.spark(e.x, CONFIG.floorY - 26, PAL.fx.impact.core, 8, 2.4); this.vspark(e.x, CONFIG.floorY - 26, 6); this.popup(e.x, CONFIG.floorY - 64, "叮！", PAL.fx.impact.core, 16); }
          break;
        case "gauge": if (e.full) { this.gaugeFullAt = now; this.kick(2, 0.12, now); } else if (e.gauge > 0) this.gaugeAt = now; break;
        case "hit": {
          this.flashF[e.p] = 1;                                                   // 受擊閃白 1 幀
          const big = e.kind === "strike" || e.final || e.kind === "counter", n = big ? 10 : 6;
          const hx = e.x - (e.toward ?? 1) * 8, hy = CONFIG.floorY - 24, att = 1 - e.p;
          // 擴充包：命中特效（第 1～2 拳輕擊星芒；重擊、第 3～4 拳、反打衝擊環）＋攻方動作對齊接觸格；沒圖照舊
          const hk = e.kind === "combo" ? (e.n <= 2 ? "vfx_hit_light" : "vfx_hit_heavy") : e.kind === "strike" || e.kind === "counter" ? "vfx_hit_heavy" : null;
          if (!(hk && this.sprite(hk, hx, hy, e.toward ?? 1)) && !this.sprite("vfx_sparks", hx, hy, e.toward ?? 1)) this.spark(hx, hy, PAL.fx.impact.spark, n, 2.4);
          if (e.kind === "strike") this.play(att, "streak_1_hit");
          else if (e.kind === "combo") this.play(att, e.n >= CONFIG.combo.hits ? "combo4_hit4_launch" : `combo4_hit${e.n}`);
          if (e.kind === "strike" || (e.kind === "combo" && !e.final)) this.sprite("vfx_dust_dash", view.fighters[e.p].x, CONFIG.floorY, e.toward ?? 1);   // 被推一格：揚塵
          if (this.juice()) {                                                    // v2：攻方拉長前傾、受擊方壓扁、鏡頭往擊飛方向踹
            const heavy = e.kind === "strike" || e.final || e.kind === "counter" || e.kind === "clash";
            this.squash(att, "attack"); this.squash(e.p, "hurt"); this.kickCam(e.toward ?? 1, heavy);
            if (e.final) { this.triggerImpactFrame(CONFIG.V2.impact.comboFinal); this.rgb(now); }
            if (e.kind === "clash") this.triggerImpactFrame(CONFIG.V2.impact.clash);
          }
          if (e.kind === "strike" || e.kind === "combo") {                    // 揮擊殘影：依攻方這一拳的拳種，疊在角色前方
            const A = view.fighters[att], g = e.kind === "strike" ? view.round?.winGesture : view.round?.gesture, o = SMEAR_AT[g];
            if (A && o) this.sprite("vfx_smear_" + g, A.x + A.face * o[0], A.y + o[1], A.face);
          }
          if (e.p === CONFIG.trainingDummySeat) for (let i = 0; i < 7; i++) this.fx.push({ k: "chip", x: e.x, y: CONFIG.floorY - 26 + Math.random() * 10, vx: (e.toward ?? 1) * (40 + Math.random() * 90), vy: -60 - Math.random() * 90, life: 0.5, max: 0.5 });   // 木樁噴木屑
          if (CONFIG.trainingDummySeat >= 0 && e.kind !== "clash") this.play(CONFIG.trainingDummySeat, e.p === CONFIG.trainingDummySeat ? "dummy_hit" : "dummy_attack");
          if (big) this.sprite("vfx_slash", e.x, CONFIG.floorY - 24, e.toward ?? 1);
          this.popup(e.x, CONFIG.floorY - 60, `+${+e.damage.toFixed(1)}%`, PAL.fx.impact.core, big ? 12 : 10);
          const me = view.seat, took = me >= 0 && e.p === me;
          if (e.kind === "strike") this.say(took ? "😣 吃了一記重擊" : "💥 連勝重擊！", `+${e.damage}%・往崖邊推 1 格`, "#FFB15A", now);
          else if (e.kind === "combo") {
            const why = this.miss && now - this.miss.at < 0.3 ? `${this.miss.why}！` : "";
            this.say(e.final ? `💥 ${why}第 ${e.n} 拳・擊飛！` : took ? `😣 ${why}吃第 ${e.n} 拳` : `👊 第 ${e.n} 拳命中！`, `+${e.damage}%${e.final ? "・強力擊飛" : `・還剩 ${CONFIG.combo.hits - e.n} 拳`}`, e.final ? PAL.fx.red.core : "#FFB15A", now, e.final ? 1.1 : 0.8);
            this.miss = null;
          }
          break;
        }
        case "counter": {                                                         // 反擊成功：沿用彈反的白框閃光＋鈴聲
          if (this.sprite("vfx_counter_flash", e.x, CONFIG.floorY - 24)) { if (!REDUCED && VFX.has("vfx_counter_flash") && !this.juice()) this.impactLeft = Math.max(this.impactLeft, 2); }   // 打擊感開著時改用剪影衝擊幀（不疊反色）   // 擴充包：反擊十字閃＋黑白衝擊幀
          else this.sprite("vfx_sparks", e.x, CONFIG.floorY - 24);
          this.play(e.p, "counter_break", "parryFrame"); this.comic("counter", now);
          this.triggerImpactFrame(CONFIG.V2.impact.counter, "silhouette", { x: e.x, y: CONFIG.floorY - 24 }); this.rgb(now);   // 黑底＋白剪影＋青金十字
          this.rimT = [ms(FX.parryFlash.durationMs), ms(FX.parryFlash.durationMs)]; this.ring(e.x, CONFIG.floorY - 24, PAL.fx.impact.core);
          const me = view.seat;
          this.say(me === e.p ? "🛡️ 反擊成功！" : me === e.att ? "😱 被反擊了！" : `🛡️ P${e.p + 1} 反擊成功！`, `第 ${e.n} 拳就斷掉連打・換位反打`, PAL.hud.focusOutline, now);
          this.kick(3, 0.15, now);
          break;
        }
        case "wrong": case "timeout": if (e.n) this.miss = { why: e.type === "wrong" ? "按錯" : "來不及", at: now }; break;   // 併進下一個「吃拳」大字
        case "streak": {
          this.streakAt[e.p] = now;
          const n = e.streak[e.p], T = view.streakTarget ?? CONFIG.STREAK_TARGET, who = view.seat < 0 ? `P${e.p + 1} ` : e.p === view.seat ? "" : "對手";
          if (e.why === "win" && n >= T) this.play(e.p, "streak_burst", null);   // 擴充包：連勝爆氣
          if (e.why === "broken") { this.broke = { who: view.seat < 0 ? `P${e.p + 1} ` : e.p === view.seat ? "你的" : "對手", at: now }; break; }
          const cut = this.broke && now - this.broke.at < 0.1 ? `・${this.broke.who}連勝中斷` : ""; this.broke = null;   // 同一刻斷掉的連勝併進副標
          if (e.why === "win") this.say(n >= T ? `🔥 ${who}連勝 ${n}/${T}！` : `🔥 ${who}連勝 ${n}/${T}`, (n >= T ? "連勝爆發！進入四套拳" : `再贏 ${T - n} 次進四套拳`) + cut, n >= T ? PAL.fx.red.core : "#FFB15A", now);
          break;
        }
        case "combo_start": this.comic("burst", now); this.say("🔥 連勝爆發！", "四連擊開始！", PAL.fx.red.core, now, 1.1); this.kick(3, 0.2, now); this.trails = [[], []]; break;
        case "combo_cue": this.cueAt = now; break;
        case "recover": {                                                     // v2：受身翻轉二段跳（air_recover 動作＋往擂台方向的衝刺揚塵）
          this.play(e.p, "air_recover", null);
          this.sprite("vfx_dust_dash", e.x, e.y, Math.sign(CONFIG.W / 2 - e.x) || 1);
          this.popup(e.x, e.y - 30, "回場！", PAL.hud.focusOutline, 9); this.spark(e.x, e.y, PAL.fx.impact.spark, 8, 2); this.squash(e.p, "land"); break; }
        case "engage": if (this.juice()) for (const f of view.fighters) if (!f.out) this.sprite("vfx_dust_dash", f.x, CONFIG.floorY, Math.sign(e.x - f.x) || f.face); break;   // 回合前貼近：小衝刺揚塵
        case "dust": if (!this.sprite("vfx_dust_dash", e.x, CONFIG.floorY, e.dir)) this.spark(e.x, CONFIG.floorY - 1, PAL.platform.topEdge, 2, 1); break;   // v2：滑行揚塵
        case "land": this.squash(e.p, "land"); if (!this.sprite("vfx_dust_land", e.x, CONFIG.floorY)) this.spark(e.x, CONFIG.floorY, PAL.platform.topEdge, 4, 1.2); break;
        case "ko": {
          this.comic("ko", now);                                                          // v2：先定格 3 幀黑白衝擊，光柱再炸出來
          const hold = this.juice() ? CONFIG.V2.impact.ko / 60 : 0;
          if (hold) { this.triggerImpactFrame(CONFIG.V2.impact.ko); this.rgb(now + hold); this.freezeUntil = Math.max(this.freezeUntil, now + hold); this.frozen = null; }
          if (!this.sprite("vfx_ko_pillar", e.x, CONFIG.H - 1, e.x > CONFIG.W / 2 ? -1 : 1, null, hold)) this.fx.push({ k: "beam", x: e.x, at: now + hold, max: ms(FX.koBlast.durationMs) });   // 光柱依出界的左右邊緣翻轉
          this.kick(FX.cameraShakePx.ko, 0.2, now); this.popup(clamp(e.x, 60, CONFIG.W - 60), 96, "KO！", PAL.fx.ko.core, 22); this.trails = [[], []];   // （舊版這幾句被誤包進註解：KO 沒大字、還會掉進「加速」分支）
          break;
        }
        case "speed_up": this.banner(`⚡ 加速！速度 Lv.${e.lv + 1}`, PAL.fx.red.rim); this.kick(1, 0.1, now); break;
        case "phase":
          if (e.phase === PH.RPS) this.combo = null; if (e.phase === PH.REVEAL) this.goFlash = now; break;   // 猜拳倒數 3、2、1 之後：「出招！」
        case "heat": {                                                        // 過熱解除：紅叉縮小淡出＋冷卻白蒸氣
          this.prevHeat ??= [null, null];
          e.heat.forEach((g, i) => { if (this.prevHeat[i] && !g) this.cool[i] = { at: now, g: this.prevHeat[i] }; this.prevHeat[i] = g; });
          break;
        }
        case "rps_result": if (this.hud2() && e.winner >= 0) this.sigBreak = { at: now, p: 1 - e.winner, g: e.stances[1 - e.winner], done: false }; break;
        case "deny":
          if (e.why === "heat" && this.hud2()) {                               // v2：燙手排斥 — 肩後噴一團濃白蒸氣
            const f = view.fighters[e.p], S = CONFIG.rpsAura.shoulder;
            for (let k = 0; k < 7; k++) this.fx.push({ k: "spark", x: f.x + f.face * S.dx + (Math.random() - 0.5) * 8, y: f.y + S.dy - 8, vx: (Math.random() - 0.5) * 50, vy: -60 - Math.random() * 60, life: 0.45, max: 0.45, color: "#F4F4F0" });
          }
        if (e.why === "heat") { const f = view.fighters[e.p]; this.popup(f.x, CONFIG.floorY - 60, "♨️ 過熱！", "#FF9A62", 9); this.play(e.p, "overheat_shake", null); this.heatAt[e.p] = this.wclock; } break;
        case "clash_start": this.comic("clash", now); this.cutText = { text: `⚔️ 五連斬！${CONFIG.clashMode.inputDur} 秒內輸入 ${e.n ?? CONFIG.CLASH_SEQUENCE_LENGTH} 招`, at: now, color: PAL.fx.impact.spark, life: 1.1 }; this.kick(2, 0.12, now); this.finText = null; break;
        case "clash_first": {                                                     // ⚡ 先手：金色十字星芒＋徽章（畫在劍格上方）
          this.kick(1, 0.08, now); this.firstAt = now;
          const f = view.fighters[e.p], FD = CONFIG.clashAtlas.animations.clash_first_draw, A = ART.spriteAtlas;
          const sx = f.x + f.face * (FD.starCellPx[0] - A.pivot.x), sy = CONFIG.floorY + (FD.starCellPx[1] - A.pivot.y);   // 拔刀格（第 2 格）的刀柄位置
          if (!(Fighter.clashOf(e.p) && this.sprite("vfx_first_draw_star", sx, sy, f.face, null, FD.starFrame / FD.fps))) this.fx.push({ k: "star", x: f.x + f.face * 9, y: CONFIG.floorY - 24, dir: f.face, life: 0.45, max: 0.45 });
          break;
        }
        case "clash_dash": this.fx.push({ k: "speed", life: e.dur + 0.1, max: e.dur + 0.1 }); for (const f of view.fighters) if (!f.out) this.sprite("vfx_dust_dash", f.x, CONFIG.floorY, f.face); break;
        case "clash_cut": {
          if (e.winner < 0) { this.sprite("vfx_clash_spark", e.x, CONFIG.floorY - 26); this.vspark(e.x, CONFIG.floorY - 26, 10); }   // 平刀：火花垂直噴發
          else {                                                                  // 勝刀：火花＋刀光（朝敗方），敗方白閃 1 幀後滑
            const w = view.fighters[e.winner], dir = Math.sign(view.fighters[1 - e.winner].x - w.x) || 1;
            if (!this.sprite("vfx_clash_spark", e.x, CONFIG.floorY - 26, dir) && !this.sprite("vfx_sparks", e.x, CONFIG.floorY - 26, dir)) this.spark(e.x, CONFIG.floorY - 26, PAL.fx.impact.spark, 10 + e.n * 2, 2.6);
            if (!Fighter.clashOf(1 - e.winner)) { this.sprite("vfx_slash", e.x, CONFIG.floorY - 26, dir); this.flashF[1 - e.winner] = 1; }   // 有拼刀圖：clash_recoil 第 0 格本身就是閃白
          }
          for (const f of view.fighters) {                                       // 擴充包：揮刀殘影（槌握點／刃口／掌心）
            const gst = view.clash?.seq?.[f.i]?.[e.n - 1], o = SMEAR_AT[gst];
            if (o && !f.out) this.sprite("vfx_smear_" + gst, f.x + f.face * o[0], f.y + o[1], f.face);
          }
          if (e.impact && !REDUCED) this.impactLeft = e.impact;                    // 第 5 刀：黑白反色衝擊幀
          const me = view.seat, res = e.winner < 0 ? "平" : me >= 0 ? (e.winner === me ? "勝" : "敗") : `P${e.winner + 1} 勝`;
          this.cutText = { life: 0.42, text: `第${e.n}刀 ${res}`, at: now, color: e.winner < 0 ? PAL.hud.label : me >= 0 ? (e.winner === me ? PAL.hud.powerFill : PAL.fx.red.rim) : PAL.fighters["p" + (e.winner + 1)].secondary };
          break;
        }
        case "clash_result": {
          const F = CONFIG.clashMode.finisher[e.main];
          if (e.tiebreak) { this.tiebreakAt = now; this.finText = { text: "⚡ 先手絕殺！", sub: `【${F.name}】`, at: now, color: PAL.hud.powerFill }; }
          else this.finText = { text: `【${F.name}】`, sub: `${e.score[0]} : ${e.score[1]}`, at: now, color: FIN_COLOR[e.main] };
          break;
        }
        case "clash_pass": { const w = view.fighters[e.p]; this.fx.push({ k: "streak", x0: w.x - (e.x - w.x), x1: e.x, life: 0.22, max: 0.22 }); this.sprite("vfx_slash", (w.x + e.x) / 2, CONFIG.floorY - 26, Math.sign(e.x - w.x) || 1);
          const L = view.fighters[1 - e.p], V = CONFIG.vfx.vfx_win_scissors_cross;      // 穿身那刻記下對手胸口；炸開格（burstFrame）對齊命中
          this.crossAt = this.sprite("vfx_win_scissors_cross", L.x, CONFIG.floorY - 22, Math.sign(L.x - w.x) || 1, null, (view.clash?.hitAt ?? view.t) - view.t - V.burstFrame / V.fps);
          break; }
        case "clash_finisher": {
          const fy = CONFIG.floorY;
          if (e.main === "rock" && this.sprite("vfx_win_rock_slam", e.x, fy, e.toward)) this.zoneDebris(e.x);                    // 震地裂岩：貼敗方腳底
          else if (e.main === "scissors" && this.crossAt) this.crossAt = false;                                                // 十字已在穿身時排好
          else if (e.main === "paper" && this.sprite("vfx_win_paper_beam", e.wx + e.toward * (CONFIG.clashMode.finisher.paper.palmCellPx[0] - ART.spriteAtlas.pivot.x), fy + (CONFIG.clashMode.finisher.paper.palmCellPx[1] - ART.spriteAtlas.pivot.y), e.toward)) {}   // 從勝方掌心往朝向發射
          else if (e.main === "rock") { this.fx.push({ k: "slam", x: e.x, y: fy, age: 0, life: 0.5, max: 0.5 }); for (let i = 0; i < 10; i++) this.fx.push({ k: "debris", x: e.x + (Math.random() - 0.5) * 40, y: fy, vx: (Math.random() - 0.5) * 200, vy: -120 - Math.random() * 160, life: 0.5, max: 0.5 }); }
          else if (e.main === "scissors") this.fx.push({ k: "cross", x: e.x, y: fy - 24, age: 0, life: 0.45, max: 0.45 });
          else this.fx.push({ k: "pbeam", x: e.wx, y: fy - 22, dir: e.toward, age: 0, life: 0.55, max: 0.55 });
          break;
        }
        case "skid": this.spark(e.x, CONFIG.floorY, "#7CF29A", 6, 1.6); break;
        case "clash_end": if (e.winner < 0) this.finText = null; break;
      }
    }
  }
  kick(px, dur, now, vertical = false) { if (REDUCED || !px) return; if (px >= this.shake.amp || now > this.shake.until) this.shake = { amp: px, until: now + dur, vertical }; }
  // 特效圖：有圖就排進 fx（依 CONFIG.vfx[key].layer 前後分層）並回傳 true；沒圖回傳 false，呼叫端照舊用程式繪製
  sprite(key, x, y, dir = 1, clip = null, wait = 0) {
    if (!VFX.has(key)) {                                                   // 沒 PNG：v2 打擊感開著就改用程式特效（PNG 一放進來自動切回美術圖）
      const P = PROC_VFX[key];
      if (!P || P.loop || !this.juice()) return false;
      this.fx.push({ k: "pv", key, x, y, dir, layer: CONFIG.vfx[key].layer, life: P.dur, max: P.dur, wait: Math.max(0, wait), seed: Math.random() * 100 });
      return true;
    }
    const d = VFX.duration(key, clip);
    this.fx.push({ k: "vs", key, x, y, dir, clip, layer: CONFIG.vfx[key].layer, life: d, max: d, wait: Math.max(0, wait) });
    return true;
  }
  // 擴充動作包：畫面層一次性動作。sync＝"contactFrame"（預設，事件那一刻剛好是命中格）／"parryFrame"／null（從第 0 格播）
  //   圖不在（或不是這個座位的木樁）就不做事，照舊播引擎動作
  play(i, state, sync = "contactFrame") {
    if (i < 0) return false;
    if (state.startsWith("dummy_") !== (CONFIG.trainingDummySeat === i)) return false;
    if (!Fighter.has(state, i) && !state.startsWith("dummy_") && !(this.juice() && FALLBACK_POSE[state])) return false;   // 缺圖：木樁一律程式繪製；武者動作要開打擊感才用姿勢替身
    const an = Fighter.animOf(state), k = (sync && an[sync]) || 0;
    this.act[i] = { state, at: this.wclock - k / an.fps, end: this.wclock + (an.frames - k) / an.fps };
    return true;
  }
  // ---- v2 打擊感（CONFIG.V2_EXPERIMENTS.juice；減少動態時全部不做）----
  juice() { return !!CONFIG.V2_EXPERIMENTS?.juice && !REDUCED; }
  // ---- 視線中心 UI v2（CONFIG.V2_EXPERIMENTS.hudV2）：有 ui_v2 的 PNG 就畫圖，沒有就程式繪製 ----
  hud2() { return !!CONFIG.V2_EXPERIMENTS?.hudV2; }
  // ---- 雙時段擂台（CONFIG.V2_EXPERIMENTS.stageV2）：每幀依局面決定，重開對局自然回日景 ----
  stage2() { return !!CONFIG.V2_EXPERIMENTS?.stageV2; }
  stageImg(k) { return CONFIG.ART_PACKS?.stageV2 ? Assets.get(CONFIG.stageV2.files[k]) : null; }
  stageMood(view) {
    const alive = view.fighters.filter(f => !f.out || f.stocks > 0);
    const blood = view.phase !== PH.GAMEOVER ? view.fighters.some(f => f.stocks === 1) : view.fighters.some(f => f.stocks <= 1);
    return { blood, cracked: blood || alive.some(f => f.damage >= CONFIG.stageV2.crackedAt) };
  }
  uiImg(k) { return CONFIG.ART_PACKS?.uiV2 ? Assets.get(CONFIG.uiV2.files[k]) : null; }
  // 漫畫爆發大字：KO ＞ 爆發 ＞ 五連斬 ＞ 反擊（低優先不蓋掉正在播的高優先）
  comic(kind, now) {
    if (!this.hud2()) return;
    const P = CONFIG.uiV2.calloutPriority, c = this.comicFx;
    if (c && this.comicLive(now) && P[c.kind] > P[kind]) return;
    this.comicFx = { kind, at: now };
  }
  comicLife(kind) { const L = CONFIG.uiV2.layout.callout; return L.holdMs[kind] / 1000 + L.out; }
  comicLive(now) { const c = this.comicFx; return !!c && now - c.at < this.comicLife(c.kind); }
  // 漫畫大字目前佔的範圍（給倒數框、頭頂盾牌閃避用）；沒有就 null
  comicRect(now) {
    if (!this.comicLive(now)) return null;
    const k = this.comicFx.kind, [cx, cy] = CONFIG.uiV2.layout.callout.center[k], [w, h] = CONFIG.uiV2.sizes["callout" + k[0].toUpperCase() + k.slice(1)];
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  rpsFrame(img, g) { const R = CONFIG.uiV2.rps; return [(R.frameByGesture[g] ?? R.frameByGesture.unknown) * R.frameW, 0, R.frameW, R.frameH]; }
  // 統一的黑白衝擊幀：invert＝全畫面高對比黑白反色；silhouette＝黑底＋角色純白剪影＋青金十字閃（at＝閃光中心）
  triggerImpactFrame(frames, mode = "invert", at = null) {
    if (!this.juice()) return;
    if (mode === "silhouette") { this.silLeft = Math.max(this.silLeft ?? 0, frames); this.silAt = at; }
    else this.impactLeft = Math.max(this.impactLeft, frames);
  }
  drawSilhouette() {
    const ctx = this.ctx, W = CONFIG.W, H = CONFIG.H;
    ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(-80, -80, W + 160, H + 160);
    for (const d of this.lastDraw ?? []) if (d) {
      if (d.dummy) drawDummy(ctx, d.x, d.y, d.f.face, d.state, d.t, true);
      else Fighter.draw(ctx, d.f, d.state, d.t, d.x, d.y, d.f.face, { white: true, view: d.view, frame: d.frame });
    }
    const a = this.silAt;
    if (a) { ctx.fillStyle = "#5FE6FF"; ctx.fillRect(Math.round(a.x) - 70, Math.round(a.y) - 1, 140, 3); ctx.fillStyle = "#FFD45A"; ctx.fillRect(Math.round(a.x) - 1, Math.round(a.y) - 46, 3, 92); ctx.fillStyle = "#FFF"; ctx.fillRect(Math.round(a.x) - 3, Math.round(a.y) - 3, 6, 6); }
    ctx.restore();
  }
  squash(i, kind) { if (this.juice() && i >= 0) this.sq[i] = { at: this.wclock, s: CONFIG.V2.squash[kind] }; }
  kickCam(dir, heavy) { if (!this.juice()) return; const [a, b] = CONFIG.V2.kickPx; this.kickV = { dx: (dir || 1) * (heavy ? b : a), at: this.wclock }; }
  rgb(now) { if (this.juice()) this.rgbUntil = now + CONFIG.V2.rgbDur; }
  // 以腳底錨點為中心做彈簧形變（拉長前傾／壓扁）：值 = 1 + (目標−1) × e^(−k t) cos(w t)
  squashXf(f) {
    const q = this.sq[f.i];
    if (!q || !this.juice()) return null;
    const S = CONFIG.V2.squash, t = this.wclock - q.at, a = Math.exp(-S.k * t) * Math.cos(S.w * t);
    if (Math.abs(a) < 0.01 && t > 0.1) { this.sq[f.i] = null; return null; }
    return [1 + (q.s[0] - 1) * a, 1 + (q.s[1] - 1) * a, q.s[2] * a * f.face];
  }
  zoneDebris(x) { for (let i = 0; i < 10; i++) this.fx.push({ k: "debris", x: x + (Math.random() - 0.5) * 40, y: CONFIG.floorY, vx: (Math.random() - 0.5) * 200, vy: -120 - Math.random() * 160, life: 0.5, max: 0.5 }); }
  // 中央回饋大字（連勝、重擊、吃拳、反擊）：彈出放大、停一下、淡出
  say(text, sub, color, now, life = 0.95) { this.callout = { text, sub, color, at: now, life }; }
  vspark(x, y, n) { for (let i = 0; i < n; i++) this.fx.push({ k: "spark", x: x + (Math.random() - 0.5) * 4, y, vx: (Math.random() - 0.5) * 30, vy: -(140 + Math.random() * 160) * (i % 2 ? 1 : -0.6), life: 0.25 + Math.random() * 0.15, max: 0.4, color: PAL.fx.impact.core }); }
  spark(x, y, color, n, speed) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * speed * 50; this.fx.push({ k: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 25, life: 0.18 + Math.random() * 0.18, max: 0.36, color }); } }
  ring(x, y, color) { this.fx.push({ k: "ring", x, y, life: 0.3, max: 0.3, color }); }
  popup(x, y, text, color, size) { this.fx.push({ k: "text", x, y, text, color, size, life: 0.9, max: 0.9 }); }
  emote(seat, text) { this.fx = this.fx.filter(p => !(p.k === "emote" && p.seat === seat)); this.fx.push({ k: "emote", seat, text, life: CONFIG.emoteShowMs / 1000, max: CONFIG.emoteShowMs / 1000 }); }   // 表情泡泡：頭頂 2 秒
  banner(text, color = PAL.hud.focusOutline) { this.fx.push({ k: "banner", text, color, life: 1.6, max: 1.6 }); }
  zoneBlast(zone = []) {                                    // 紅招地裂：有圖就在危險區中央播 impact 片段（一張 96px＝兩格），沒圖畫舊裂紋；碎石照噴
    const img = zone.length && this.sprite("vfx_red_crack", (cellX(Math.min(...zone)) + cellX(Math.max(...zone))) / 2, CONFIG.floorY, 1, "impact");
    for (const c of zone) { if (!img) this.fx.push({ k: "crack", c, life: 0.5, max: 0.5 }); for (let i = 0; i < 6; i++) this.fx.push({ k: "debris", x: cellX(c) + (Math.random() - 0.5) * 30, y: CONFIG.floorY, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 120, life: 0.45, max: 0.45 }); } }

  // ---- 一幀 ----
  draw(view, events, now, dt) {
    if (!view) return;
    this.onEvents(events, view, now);
    const frozen = now < this.freezeUntil;
    if (frozen && !this.frozen) this.frozen = structuredClone(view);
    if (!frozen) this.frozen = null;
    const world = this.frozen ?? view;                    // 頓幀：世界層停在那一刻；HUD 用最新的
    const vdt = frozen ? 0 : dt;
    this.wclock += vdt;
    this.updateFx(vdt, dt);
    this.updateTrails(world, vdt);
    this.updateCam(view, dt);
    for (const k in this.keyFlash) this.keyFlash[k] = Math.max(0, this.keyFlash[k] - dt);
    for (const i of [0, 1]) { this.rimT[i] = Math.max(0, this.rimT[i] - dt); }

    const ctx = this.ctx, cam = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false; this.sctx.imageSmoothingEnabled = false;   // 每幀鎖定銳利像素（縮放、換分頁後瀏覽器可能重設）
    if (this.stage2()) { const m = this.stageMood(view), k = Math.min(1, dt / CONFIG.stageV2.fadeSec); this.bloodK = (this.bloodK ?? 0) + ((m.blood ? 1 : 0) - (this.bloodK ?? 0)) * (REDUCED ? 1 : k * 3); this.cracked = m.cracked; }
    else { this.bloodK = 0; this.cracked = false; }
    this.drawBackground(now);
    const amp = now < this.shake.until ? this.shake.amp : 0;
    const vert = amp && this.shake.vertical, sx = amp && !vert ? Math.round((Math.random() * 2 - 1) * amp) : 0, sy = amp ? Math.round((Math.random() * 2 - 1) * amp * (vert ? 1.6 : 1)) : 0;
    const kx = this.kickV ? Math.round(this.kickV.dx * Math.exp(-CONFIG.V2.kickDecay * (this.wclock - this.kickV.at))) : 0;   // v2 方向鏡頭踹擊
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, Math.round(CONFIG.W / 2 - cam.x * cam.zoom) + sx + kx, Math.round(CONFIG.H / 2 - cam.y * cam.zoom) + sy);
    this.drawStage(world);
    this.drawTrails(world);
    this.drawSpotlight(view);
    this.drawFx(now, "back");                                 // 角色後方：紅招地裂、KO 光柱
    this.drawFighters(world);                                 // 角色本體（含殘影、受擊閃白）
    this.drawFx(now, "front");                                // 角色前方：火花、刀光、先手金星、主招大招
    if (this.silLeft > 0) { this.silLeft--; this.drawSilhouette(); }   // 反擊剪影衝擊幀（世界層，HUD 照常）
    if (this.hud2()) { this.drawShoulderHeat(world, now); this.drawSigils(world, now); }   // v2：身前招式印記＋肩後過熱（取代頭頂泡泡與角落文字）
    else this.drawStanceBubbles(view, now);
    this.drawTelegraphs(view, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (now < this.rgbUntil && this.juice()) this.drawRgbSplit(CONFIG.V2.rgbPx);   // v2：反擊／第 4 拳／KO 微色散
    this.drawLetterbox(view, dt, now);
    if (this.hud2()) this.drawSpeedlines(view, now);
    this.drawHudPixels(view, now, dt);
    if (this.impactLeft > 0) {                                           // 黑白反色衝擊幀（每畫一幀扣一格）
      this.impactLeft--;
      ctx.save(); ctx.globalCompositeOperation = "difference"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
      ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H); ctx.restore();
    }
    const s = this.scale * this.dpr, sctx = this.sctx;
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.imageSmoothingEnabled = false;
    sctx.drawImage(this.buf, 0, 0, this.screen.width, this.screen.height);
    sctx.setTransform(s, 0, 0, s, 0, 0);
    this.drawHudText(sctx, view, now);
  }
  updateFx(vdt, dt) {
    for (const p of this.fx) {
      if (p.wait > 0) { p.wait -= vdt; continue; }                       // 延遲出現的特效（對齊動畫的某一格）；頓幀時一起凍結
      if (p.k === "beam") continue;
      if (p.k === "text" || p.k === "banner" || p.k === "emote") { p.life -= dt; if (p.k === "text") p.y -= 18 * dt; continue; }
      p.life -= vdt;
      if (p.k === "spark" || p.k === "debris" || p.k === "chip") { p.vy += 500 * vdt; p.x += p.vx * vdt; p.y += p.vy * vdt; }
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
      const last = this.lastXY[i], moving = last && (Math.abs(f.x - last[0]) + Math.abs(f.y - last[1]) > 1.2) && ["knockback", "roll", "parry_success", "mash_hit", "hitstun", "clash_dash", "clash_win_scissors", "clash_win_paper"].includes(f.anim.state);
      this.lastXY[i] = [f.x, f.y];
      if (!moving || vdt === 0 || f.out) return;
      this.trailClock[i] += vdt;
      if (this.trailClock[i] >= ms(T.sampleIntervalMs)) { this.trailClock[i] = 0; this.trails[i].unshift({ f: structuredClone(f), age: 0 }); this.trails[i].length = Math.min(this.trails[i].length, max); }
    });
  }
  updateCam(view, dt) {
    const c = this.cam, [a, b] = view.fighters, clash = view.phase === PH.CLASH_ANIM && view.clash, focus = [PH.BURST, PH.COMBO_PREP, PH.COMBO_CUE, PH.COMBO_HIT].includes(view.phase) || !!clash;
    const target = clash ? view.clash.zoom ?? 1 : focus ? CONFIG.feel.zoomCombo : 1;      // 四套拳推近；拼刀逐刀推近 1.22→1.45
    const tx = focus ? (a.x + b.x) / 2 : CONFIG.W / 2, ty = focus ? CONFIG.floorY - 46 : CONFIG.H / 2;
    const k = 1 - Math.exp((clash ? 16 : CONFIG.feel.zoomLerp) * -dt);
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
    if (this.stage2()) this.drawSkyV2(time);
  }
  // 日景／血月天空：有 PNG 就整張鋪（日景打底、血月依 bloodK 淡入）；沒有就在原本夜空上程式疊色
  drawSkyV2(time) {
    const ctx = this.ctx, k = this.bloodK ?? 0, day = this.stageImg("skyDay"), blood = this.stageImg("skyBlood");
    if (day) ctx.drawImage(day, 0, 0, CONFIG.W, CONFIG.H);
    if (blood && k > 0) { ctx.globalAlpha = k; ctx.drawImage(blood, 0, 0, CONFIG.W, CONFIG.H); ctx.globalAlpha = 1; return; }
    if (k <= 0.01 || blood) return;
    ctx.save();
    ctx.globalAlpha = 0.55 * k; ctx.fillStyle = "#5A0712"; ctx.fillRect(0, 0, CONFIG.W, 200);                 // 整片天空染紅
    ctx.globalAlpha = 0.35 * k; ctx.fillStyle = "#B0182A"; ctx.fillRect(0, 120, CONFIG.W, 80);
    const mx = 362, my = 118, pulse = REDUCED ? 0 : Math.sin(time * 1.6) * 1.5;                                 // 血月＋光暈
    for (let r = 34; r > 0; r -= 6) { ctx.globalAlpha = k * 0.08; ctx.fillStyle = "#FF3A3A"; ctx.beginPath(); ctx.arc(mx, my, 20 + r + pulse, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = k; ctx.fillStyle = "#E8283A"; ctx.beginPath(); ctx.arc(mx, my, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#FF8A7A"; ctx.beginPath(); ctx.arc(mx - 5, my - 5, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9A1020"; ctx.fillRect(mx + 4, my + 3, 5, 3); ctx.fillRect(mx - 9, my + 8, 4, 2);
    ctx.globalAlpha = 0.5 * k; ctx.fillStyle = "#2A0408"; for (let x = 0; x < CONFIG.W; x += 2) { const h = 34 + Math.round(Math.sin(x * 0.021) * 12 + Math.sin(x * 0.067) * 5); ctx.fillRect(x, 200 - h, 2, h); }   // 遠山壓暗
    ctx.restore();
  }
  drawStage(view) {
    const ctx = this.ctx, PF = PAL.platform, L = CONFIG.stageX, R = ART.stage.rightXExclusive, Y = CONFIG.floorY, W = CONFIG.cellW;
    if (this.stage2()) {                                                    // v2 擂台圖：頂邊對齊踩踏面（floorY＋floorYOffset），水平置中在擂台範圍
      const img = this.stageImg(this.cracked ? "platCracked" : "platNormal");
      if (img) { ctx.drawImage(img, Math.round((L + R) / 2 - img.naturalWidth / 2), Y + CONFIG.stageV2.floorYOffset); return; }
    }
    for (let i = 0; i < 6; i++) { const inset = 4 + i * 6, y = Y + 16 + i * 4; ctx.fillStyle = PF.outline; ctx.fillRect(L + inset - 1, y, R - L - inset * 2 + 2, 5); ctx.fillStyle = i % 2 ? PF.stoneShadow : mix(PF.stoneShadow, PF.outline, 0.3); ctx.fillRect(L + inset, y, R - L - inset * 2, 4); }
    ctx.fillStyle = PF.outline; ctx.fillRect(L - 1, Y - 1, R - L + 2, 18);
    for (let i = 0; i < CONFIG.cells; i++) {
      const x = L + i * W;
      ctx.fillStyle = PF.stoneMid; ctx.fillRect(x, Y, W, 12); ctx.fillStyle = PF.stoneShadow; ctx.fillRect(x, Y + 12, W, 4);
      ctx.fillStyle = PF.topEdge; ctx.fillRect(x, Y, W, 2);
      ctx.fillStyle = PF.oxidizedBronze; ctx.fillRect(x + W / 2 - 3, Y + 7, 2, 2); ctx.fillRect(x + W / 2 + 1, Y + 7, 2, 2);
      if (i > 0) { ctx.fillStyle = PF.tileSeam; ctx.fillRect(x, Y, 1, 16); }
    }
    if (this.stage2() && this.cracked) {                                    // 裂紋擂台（程式繪製）：鋸齒裂縫＋血月時裂縫透紅光
      const glow = (this.bloodK ?? 0) > 0.3;
      for (let c = 0; c < 9; c++) {
        let x = L + 14 + c * ((R - L - 28) / 8) + ((c * 37) % 11) - 5, y = Y;
        for (let s = 0; s < 6; s++) {
          const nx = x + ((c * 13 + s * 7) % 5) - 2, ny = y + 2 + ((c + s) % 3);
          ctx.fillStyle = "#0C0608"; ctx.fillRect(Math.min(x, nx), y, Math.abs(nx - x) + 2, ny - y + 1);
          ctx.fillStyle = glow ? "#FF3A3A" : "#C9CDD8"; ctx.fillRect(Math.max(x, nx) + 2, y, 1, ny - y + 1);   // 裂縫一側的亮邊（血月時透紅光）
          x = nx; y = ny; if (y > Y + 14) break;
        }
      }
      ctx.fillStyle = "rgba(10,6,8,.25)"; ctx.fillRect(L, Y + 2, R - L, 14);
    }
    for (const f of view.fighters) if (!f.out && !f.air) { const c = clamp(Math.floor((f.x - L) / W), 0, CONFIG.cells - 1); ctx.globalAlpha = 0.35; ctx.fillStyle = PAL.fighters["p" + (f.i + 1)].highlight; ctx.fillRect(L + c * W + 1, Y, W - 2, 1); ctx.globalAlpha = 1; }
  }
  cue(view) { const r = view.round; return view.phase === PH.COMBO_CUE && r?.gesture ? r : null; }
  animTime(view, f, state) {
    const a = this.act[f.i];
    if (a && state === a.state) return this.wclock - a.at;
    if (state === "dummy_ko" || state === "dummy_idle") return f.anim.t;
    return view.phase === PH.COMBO_CUE ? f.anim.t * CONFIG.combo.slowmo : f.anim.t; }   // 反擊窗：畫面慢動作（只影響畫面）   // 終結擇起就進慢動作（只影響畫面）
  stateFor(view, f) {
    const dummy = CONFIG.trainingDummySeat === f.i;
    const a = this.act[f.i], live = a && this.wclock < a.end;
    if (dummy) return f.anim.state === "knockback" ? "dummy_ko" : live ? a.state : "dummy_idle";   // 訓練場木樁：擊飛時旋轉解體（停最後一格）
    if (live) return a.state;           // 擴充動作：播完交回引擎
    {                                                          // 有加購圖：開牌壓制／受壓、五連斬蓄勢、比賽勝利
      const want = view.phase === PH.REVEAL && view.rps && view.rps.winner >= 0 ? (view.rps.winner === f.i ? "reveal_win" : "reveal_lose")
        : view.phase === PH.CLASH_INPUT && f.anim.state === "idle" ? "clash_charge"
        : view.phase === PH.GAMEOVER && view.winner === f.i && !f.out ? "victory" : null;
      if (want && Fighter.has(want, f.i)) return want;
    }
    const st = view.phase === PH.RPS && view.t >= (view.reveal ?? CONFIG.rps.reveal) && f.anim.state.startsWith("stance_") ? "stance_hidden" : f.anim.state;   // 藏招：雙方都回到收手黑影
    if (st !== "idle") return st;
    const I = CONFIG.charExtraAtlas.idle;                      // 待機優先序：崖邊失衡 > 單膝硬撐 > 彎腰喘息 > 一般待機（缺圖逐級往下退）
    for (const [want, on] of [["cliff_teeter", I.edgeTiles.includes(f.pos)], ["idle_critical", f.damage >= I.criticalMin], ["idle_tired", f.damage >= I.tiredMin]]) if (on && (Fighter.has(want, f.i) || (this.juice() && FALLBACK_POSE[want]))) return want;
    return st;
  }
  // 拼刀圖集的「對時」：回傳 { state, frame, y } 覆寫，或 null（照引擎動作播）
  //   · 對砍：下一刀前 contactFrame/fps 秒開始播那一刀的前搖，判定那一刻剛好是接觸格；判定後從接觸格往後播
  //   · 勝方大招：fxAt→hitAt 之間把 0..impactFrame-1 等比例攤開（居合：衝刺期間播到 crossFrame 穿身格），命中那刻＝impactFrame
  clashPose(view, f) {
    const C = view.clash, CA = CONFIG.clashAtlas.animations;
    if (!C || !Fighter.clashOf(f.i)) return null;
    if (view.phase === PH.CLASH_ANIM && C.stage === "cuts" && C.cutAt) {
      const k = C.cut, g = k < C.cutAt.length ? C.seq[f.i]?.[k] : null;
      if (g) {
        const an = CA["clash_" + g], lead = C.cutAt[k] - view.t, wind = an.contactFrame / an.fps;
        if (lead <= wind) return { state: "clash_" + g, frame: an.contactFrame - Math.ceil(lead * an.fps - 1e-6) };
      }
      const st = f.anim.state;
      if (CA[st]?.contactFrame !== undefined) return { state: st, frame: CA[st].contactFrame + Math.floor(f.anim.t * CA[st].fps) };
      return null;
    }
    const R = C.result;
    if (!R || R.winner !== f.i) return null;
    const st = "clash_win_" + R.main, an = CA[st], y = CONFIG.floorY;     // 大招期間腳底固定在地面（跳躍靠圖內位移）
    if (view.phase === PH.CLASH_ANIM) {
      if (view.t < C.fxAt) return { state: st, frame: 0, y };
      const Fm = CONFIG.clashMode.finisher[R.main], span = Math.max(0.01, C.hitAt - C.fxAt), e = view.t - C.fxAt;
      let fr;
      if (an.crossFrame !== undefined && Fm.dash) fr = e < Fm.dash ? (e / Fm.dash) * an.crossFrame : an.crossFrame + ((e - Fm.dash) / Math.max(0.01, span - Fm.dash)) * (an.impactFrame - an.crossFrame);
      else fr = (e / span) * an.impactFrame;
      return { state: st, frame: Math.min(an.impactFrame - 1, Math.floor(fr)), y };
    }
    if (view.phase === PH.RESOLVE && view.round?.type === "clash") return { state: st, frame: an.impactFrame + Math.floor(view.t * an.fps), y: f.y };
    return null;
  }
  // 驗收用：50×50 格框（綠）＋腳底錨點 (24, 40)（紅點）
  drawSpriteBox(f, state) {
    const ctx = this.ctx, A = ART.spriteAtlas, x = Math.round(f.x), y = Math.round(f.y);
    const x0 = x - A.pivot.x - A.originX, y0 = y - A.pivot.y - A.originY;
    ctx.save(); ctx.globalAlpha = 1; ctx.strokeStyle = "#39FF6A"; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, A.strideX - 1, A.strideY - 1);
    ctx.fillStyle = "#FF2A2A"; ctx.fillRect(x - 1, y - 1, 3, 3);
    if (state) { ctx.font = "6px monospace"; ctx.textAlign = "center"; ctx.fillStyle = Fighter.animOf(state) && Fighter.has(state, f.i) ? "#39FF6A" : "#9AA4B8"; ctx.fillText(state, x, y0 - 2); }   // 目前動作名（綠＝加購圖、灰＝基礎圖／程式繪製）
    ctx.restore();
  }
  drawTrails(view) {
    const al = FX.motionTrail.alphaNewestToOldest;
    this.trails.forEach(tr => tr.forEach((s, i) => { if (s.f.i === CONFIG.trainingDummySeat) return; const st = this.stateFor(view, s.f); Fighter.draw(this.ctx, s.f, st, this.animTime(view, s.f, st), s.f.x, s.f.y, s.f.face, { alpha: al[i] ?? 0.1, view }); }));
  }
  // 拼刀：背景壓暗 60%（畫在角色後面）
  clashScene(view) { return view.phase === PH.CLASH_INPUT || view.phase === PH.CLASH_ANIM || (view.phase === PH.RESOLVE && view.round?.type === "clash" && view.t < 0.9); }
  drawSpotlight(view) {
    if (!this.lb) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(4,6,12,${CONFIG.clashMode.dim * this.lb})`; ctx.fillRect(-60, -60, CONFIG.W + 120, CONFIG.H + 120);
  }
  // 電影黑邊 18px：滑入／滑出（螢幕座標，不跟鏡頭縮放）
  drawLetterbox(view, dt, now) {
    const target = this.clashScene(view) ? 1 : 0;
    this.lb += (target - this.lb) * (1 - Math.exp(-14 * dt)); if (Math.abs(this.lb - target) < 0.01) this.lb = target;
    const ctx = this.ctx, h = Math.round(CONFIG.clashMode.letterboxPx * this.lb);
    if (h > 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, CONFIG.W, h); ctx.fillRect(0, CONFIG.H - h, CONFIG.W, h); }
    const tb = now - this.tiebreakAt;                                       // 先手絕殺：0.25s 金光
    if (tb >= 0 && tb < CONFIG.clashMode.tiebreakSlow + 0.15) { ctx.fillStyle = `rgba(255,205,80,${0.28 * (1 - tb / (CONFIG.clashMode.tiebreakSlow + 0.15))})`; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H); }
  }
  drawFighters(view) {
    const ctx = this.ctx;
    for (const f of view.fighters) {
      if (f.out) { if (this.lastDraw) this.lastDraw[f.i] = null; continue; }
      let x = f.x, y = f.y;
      ctx.fillStyle = "rgba(10,15,26,.55)"; ctx.fillRect(Math.round(x) - 10, CONFIG.floorY, 20, 2);
      const dummy = CONFIG.trainingDummySeat === f.i, dummyArt = dummy && Fighter.has("dummy_idle", f.i);
      const pose = dummy ? null : this.clashPose(view, f);
      const state = pose?.state ?? this.stateFor(view, f), t = this.animTime(view, f, state), frame = pose?.frame;
      if (AURA_PH.has(view.phase) && view.round?.att === f.i && !VFX.draw(ctx, "vfx_streak_aura", this.wclock, x, y, f.face) && this.juice()) { ctx.save(); PROC_VFX.vfx_streak_aura.draw(ctx, x, y, f.face, 0, this.wclock); ctx.restore(); }   // 擴充包：連勝氣場（爆發＋四套拳，貼攻方腳底、角色後方）
      if (pose?.y !== undefined) y = pose.y;
      // 擴充動作缺圖：換成基礎動作＋位移／形變（FALLBACK_POSE）；PNG 放進來後 Fighter.has 為真就直接畫美術圖
      if (this.hud2() && !REDUCED && this.wclock - this.heatAt[f.i] < 0.2) { const k = (this.wclock - this.heatAt[f.i]) / 0.2; x += Math.sin(this.wclock * 120) * 2 * (1 - k) - f.face * 2 * Math.sin(Math.PI * k); }   // 燙手：±2px 抖動＋微幅後縮
      const fp = !dummy && !pose && FALLBACK_POSE[state] && !Fighter.has(state, f.i) ? FALLBACK_POSE[state] : null;
      let drawState = state, xf = this.squashXf(f);
      if (fp) {
        const an = Fighter.animOf(state), T = an ? an.frames / an.fps : 1, k = an?.playback === "loop" ? (t % T) / T : clamp(t / T, 0, 1), q = fp.xf(k, t, f);
        drawState = fp.base(k) ?? f.anim.state;
        x += q.dx * f.face; y += q.dy;
        const b = xf ?? [1, 1, 0]; xf = [b[0] * q.sx, b[1] * q.sy, b[2] + q.sk * f.face];
      }
      if (xf) { ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.transform(xf[0], 0, xf[2], xf[1], 0, 0); ctx.translate(-Math.round(x), -Math.round(y)); }
      const proc = dummy && !dummyArt;                                       // 訓練場木樁：有 dummy_sheet.png 用美術圖，沒有就程式畫木人樁
      if (proc) drawDummy(ctx, x, y, f.face, state, t);
      else Fighter.draw(ctx, f, drawState, t, x, y, f.face, { rim: this.rimT[f.i] > 0 && !REDUCED, view, frame });
      if (this.flashF[f.i] > 0) { this.flashF[f.i]--; if (!REDUCED) { if (proc) drawDummy(ctx, x, y, f.face, state, t, true); else Fighter.draw(ctx, f, drawState, t, x, y, f.face, { white: true, alpha: FX.impactFrameFlash.maxOpacity, view, frame }); } }   // 受擊閃白：只亮 1 幀
      if (this.hud2() && !REDUCED && !proc && this.wclock - this.heatAt[f.i] < 0.12) Fighter.draw(ctx, f, drawState, t, x, y, f.face, { white: true, tint: "#FF2A2A", alpha: 0.55, view, frame });   // v2：燙手——角色閃一下暗紅
      if (xf) ctx.restore();
      (this.lastDraw ??= [])[f.i] = { f, state: proc ? state : drawState, t, x, y, frame, view, dummy: proc };
      if (this.wclock - this.heatAt[f.i] < 0.6) {                          // 擴充包：過熱蒸氣貼槌頭排氣口（有過熱動作就逐格跟著槌頭）
        const v = CONFIG.charExtraAtlas.animations.overheat_shake.ventCellPx, A = ART.spriteAtlas;
        const k = state === "overheat_shake" ? clamp(Fighter.addonFrame(Fighter.animOf(state), t), 0, v.length - 1) : 0;
        const sx = x + f.face * (v[k][0] - A.pivot.x), sy = y + (v[k][1] - A.pivot.y);
        if (!VFX.draw(ctx, "vfx_overheat_smoke", this.wclock - this.heatAt[f.i], sx, sy, f.face) && this.juice()) { ctx.save(); PROC_VFX.vfx_overheat_smoke.draw(ctx, sx, sy, f.face, 0, this.wclock - this.heatAt[f.i]); ctx.restore(); }
      }
      if (CONFIG.DEBUG_SPRITE_BOX) this.drawSpriteBox(f, state);
      if (f.deny > 0) { ctx.globalAlpha = Math.min(1, f.deny * 3); ctx.fillStyle = PAL.fx.red.rim; ctx.fillRect(Math.round(x) - 8, Math.round(y) - 46, 16, 1); ctx.globalAlpha = 1; }
    }
  }
  drawRgbSplit(px) {
    const c = (this.rgbBuf ??= document.createElement("canvas")); c.width = CONFIG.W; c.height = CONFIG.H;
    const g = c.getContext("2d"), ctx = this.ctx;
    for (const [col, dx] of [["#ff0000", px], ["#0000ff", -px]]) {
      g.globalCompositeOperation = "copy"; g.drawImage(this.buf, 0, 0);
      g.globalCompositeOperation = "multiply"; g.fillStyle = col; g.fillRect(0, 0, CONFIG.W, CONFIG.H);
      g.globalCompositeOperation = "destination-in"; g.drawImage(this.buf, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45; ctx.drawImage(c, dx, 0); ctx.restore();
    }
  }
  drawFx(now, layer) {
    const ctx = this.ctx;
    for (const p of this.fx) {
      if (p.wait > 0 || (p.layer ?? (p.k === "beam" || p.k === "crack" ? "back" : "front")) !== layer) continue;
      const a = p.life !== undefined ? clamp(p.life / p.max, 0, 1) : 1;
      if (p.k === "spark") { ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); }
      else if (p.k in CLASH_FX) { ctx.save(); CLASH_FX[p.k](ctx, p, a, 1 - a); ctx.restore(); }
      else if (p.k === "chip") { ctx.globalAlpha = a; ctx.fillStyle = "#B07A3E"; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); ctx.fillStyle = "#7A4E22"; ctx.fillRect(Math.round(p.x) + 1, Math.round(p.y) + 1, 1, 1); }
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
    if (t < 0) return;                                                  // v2：KO 先定格衝擊幀，光柱晚一點才出
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
  // 四套拳拳種提示：攻方頭頂藍框亮出這一拳（彈出放大），外框倒數由滿退去、最後 0.15s 紅閃
  drawTelegraphs(view, now) {
    const r = this.cue(view);
    if (!r) return;
    const ctx = this.ctx, left = clamp((view.dur - view.t) / view.dur, 0, 1), urgent = view.dur - view.t <= CONFIG.countdown.urgentSec, blink = urgent && Math.floor(now * 20) % 2 === 0;
    const att = view.fighters[r.att], T = ART.telegraphs.blueParry, S = T.frameSizePx[0], C = PAL.fx.blue;
    const pop = REDUCED ? 0 : Math.max(0, 1 - (now - this.cueAt) * 6);
    let sc = 1 + pop * 0.6, cx = Math.round(att.x), cy = CONFIG.floorY + T.offsetPx[1];
    if (this.hud2()) {                                                     // v2：36×36 盾牌，底邊中心＝攻方腳底往上 56、跟著角色、微幅脈動；被漫畫大字擋到就往旁邊讓
      const L = CONFIG.uiV2.layout.shield, Z = L.size;
      sc = (Z / S) * (1 + pop * 0.4 + (REDUCED ? 0 : Math.sin(now * 14) * 0.05));
      cx = Math.round(clamp(att.x, L.clampX[0], L.clampX[1])); cy = Math.round(att.y + L.dy - Z / 2);
      const R = this.comicRect(now);
      if (R && cx + Z / 2 > R.x && cx - Z / 2 < R.x + R.w && cy + Z / 2 > R.y && cy - Z / 2 < R.y + R.h)
        cx = cx < R.x + R.w / 2 ? Math.round(R.x - L.gap - Z / 2) : Math.round(R.x + R.w + L.gap + Z / 2);
      const img = this.uiImg("rpsBig");
      if (img) {
        const k = Math.round(Z * sc * S / Z);
        ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, ...this.rpsFrame(img, r.gesture), Math.round(cx - k / 2), Math.round(cy - k / 2), k, k);
        ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-S / 2, -S / 2); this.perimeter(0, 0, S, left, blink ? PAL.fx.red.rim : urgent ? C.core : C.rim, 2); ctx.restore();
        return;
      }
    }
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-S / 2, -S / 2);
    this.roundRect(-1, -1, S + 2, S + 2, C.outline); this.roundRect(0, 0, S, S, "#0E2747");
    this.perimeter(0, 0, S, left, blink ? PAL.fx.red.rim : urgent ? C.core : C.rim, 2);
    drawGestureGlyph(ctx, GESTURE_GLYPH[r.gesture], 5, 5, C.core, C.rim);
    ctx.restore();
  }
  // 架式氣泡（showHints）：亮招期顯示各自已擺的拳種、藏招期雙方都變 ❓；位置固定在腳底上 55px，靠太近時 P2 往上錯開
  drawStanceBubbles(view, now) {
    if (!this.showHints || view.phase !== PH.RPS) return;
    const hidden = view.t >= (view.reveal ?? CONFIG.rps.reveal), [W] = SB.sizePx, O = SB.onFighterOverlap;
    const items = view.fighters.map(f => ({ f, key: hidden ? "hidden" : ["rock", "scissors", "paper"].includes(f.stance) ? f.stance : null })).filter(o => o.key && !o.f.out);
    const close = items.length === 2 && Math.abs(items[0].f.x - items[1].f.x) < O.minCenterGapPx;
    for (const { f, key } of items) {
      const x0 = clamp(Math.round(f.x - W / 2), 0, CONFIG.W - W);
      const y0 = Math.round(CONFIG.floorY + SB.offsetPx[1] - W / 2) - (close && f.i === 1 ? O.maxVerticalStaggerPx : 0);
      drawBubble(this.ctx, x0, y0, key, now, REDUCED);
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
  // 損傷數字：依 ART.palette.damageBands 換色、描邊、陰影；受擊時照該級 motion 位移；粒子畫在數字後面
  drawDigits(text, x, y, band, alignRight) {
    const ctx = this.ctx, scale = 4, cwOf = ch => (DIGIT[ch]?.[0].length ?? 4) * scale + 3, D = ART.hud.damageText;
    const w = [...text].reduce((s, ch) => s + cwOf(ch), 0) - 3;
    const x0 = alignRight ? x - w : x;
    const cells = []; let cx = x0;
    for (const ch of text) { const rows = DIGIT[ch]; if (rows) rows.forEach((r, ri) => [...r].forEach((c, ci) => { if (c === "#") cells.push([cx + ci * scale, y + ri * scale, ri, ci, rows]); })); cx += cwOf(ch); }
    const [sx, sy] = D.shadowOffsetPx, o = D.outlineWidthPx;
    ctx.fillStyle = band.shadow; for (const [px, py] of cells) ctx.fillRect(px + sx - o, py + sy - o, scale + o * 2, scale + o * 2);
    ctx.fillStyle = band.outline; for (const [px, py] of cells) ctx.fillRect(px - o, py - o, scale + o * 2, scale + o * 2);
    ctx.fillStyle = band.fill; for (const [px, py] of cells) ctx.fillRect(px, py, scale, scale);
    if (band.topRim) { ctx.fillStyle = band.topRim; for (const [px, py, ri, ci, rows] of cells) if (ri === 0 || rows[ri - 1][ci] !== "#") ctx.fillRect(px, py, scale, D.topRimWidthPx); }
    return { x0, w };
  }
  bandOf(dmg) { return PAL.damageBands.find(b => dmg >= b.minInclusive && (b.maxInclusive === null || dmg <= b.maxInclusive)) ?? PAL.damageBands[0]; }
  shownDamage(f) { return Math.max(ART.hud.damageText.clampDisplayedValueMin, Math.floor(f.damage + 1e-6)); }
  // 損傷粒子（火花、裂痕、煙）：依分級設定產生；layer = behind_text
  hudParticles(i, band, box, ay, now, increased) {
    const st = this.dmgFx[i], right = i === 1, list = st.parts;
    const corners = { lower: [[box.x0 - 2, ay + 24], [box.x0 + box.w + 1, ay + 24]], upper: [[box.x0 - 2, ay - 1], [box.x0 + box.w + 1, ay - 1]] };
    const tips = [];
    for (const P of band.particles) {
      if (P.kind === "crack") {                                     // 階梯狀分岔裂痕：分級期間常駐（減少動態也保留）
        corners.upper.forEach(([cx, cy], k) => {
          const dir = k === 0 ? -1 : 1, len = P.lengthRangePx[0] + ((i * 3 + k * 5) % (P.lengthRangePx[1] - P.lengthRangePx[0] + 1));
          let x = cx, y = cy;
          for (let n = 0; n < len; n++) { this.ctx.fillStyle = P.colors[0]; this.ctx.fillRect(x, y, 1, 1); if (n === Math.floor(len / 2)) { this.ctx.fillStyle = P.colors[1]; this.ctx.fillRect(x + dir, y + 1, 1, 1); this.ctx.fillRect(x + dir * 2, y + 2, 1, 1); } if (n % 2) y -= 1; else x += dir; }
          tips.push([x, y]);
        });
      }
    }
    for (const P of band.particles) {
      if (P.kind === "spark" && increased && !(REDUCED && !ART.hud.damageText.reducedMotion.animateParticles)) {
        const from = P.anchor === "crack_tips" && tips.length ? tips : corners.lower;
        for (let n = 0; n < P.count; n++) { const [cx, cy] = from[n % from.length], dir = cx < box.x0 ? -1 : 1, life = P.lifetimeMs / 1000; list.push({ k: "spark", x: cx, y: cy, vx: dir * P.travelPx[0] / life * (0.6 + 0.4 * Math.random()), vy: P.travelPx[1] / life, life, max: life, color: P.colors[n % P.colors.length], size: P.sizeRangePx[0] + (n % 2) * (P.sizeRangePx[1] - P.sizeRangePx[0]) }); }
      }
      if (P.kind === "smoke") {
        if (REDUCED) {                                                // 減少動態：保留瀕死煙的固定剪影
          this.ctx.globalAlpha = P.maxOpacity; this.ctx.fillStyle = P.colors[0];
          this.ctx.fillRect(right ? box.x0 - 6 : box.x0 + box.w + 3, ay - 3, 3, 2); this.ctx.fillRect(right ? box.x0 - 3 : box.x0 + box.w, ay - 7, 2, 2); this.ctx.globalAlpha = 1;
        } else if (now - st.smokeAt >= P.spawnIntervalMs / 1000 && list.filter(q => q.k === "smoke").length < P.maxAlive) {
          st.smokeAt = now; const life = P.lifetimeMs / 1000, sz = P.sizeRangePx[0] + Math.floor(Math.random() * (P.sizeRangePx[1] - P.sizeRangePx[0] + 1));
          list.push({ k: "smoke", x: box.x0 + Math.random() * box.w, y: ay - 1, vx: P.travelPx[0] / life * (Math.random() < 0.5 ? -1 : 1), vy: P.travelPx[1] / life, life, max: life, color: P.colors[Math.floor(Math.random() * P.colors.length)], size: sz, op: P.maxOpacity });
        }
      }
    }
  }
  drawHudFx(dt) {
    const ctx = this.ctx;
    for (const st of this.dmgFx) {
      for (const q of st.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; }
      st.parts = st.parts.filter(q => q.life > 0);
      for (const q of st.parts) { const a = clamp(q.life / q.max, 0, 1); ctx.globalAlpha = q.k === "smoke" ? q.op * a : a; ctx.fillStyle = q.color; ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.k === "smoke" ? Math.max(1, q.size - 1) : q.size); }
    }
    ctx.globalAlpha = 1;
  }
  drawHudPixels(view, now, dt) {
    const ctx = this.ctx, H = ART.hud.playerPanels;
    this.drawHudFx(dt);
    for (const f of view.fighters) {
      const right = f.i === 1, ax = right ? H.p2.anchorX : H.p1.anchorX, ay = H.p1.anchorY;
      const dmg = this.shownDamage(f), band = this.bandOf(dmg), st = this.dmgFx[f.i];
      const increased = dmg > st.prev; if (increased) st.hitAt = now; st.prev = dmg; st.band = band;
      // 受擊位移：依分級 motion.offsetsPx 每 frameMs 走一格（減少動態：不動）
      let [ox, oy] = [0, 0];
      const M = band.motion;
      if (!REDUCED && M.trigger === "damage_increase" && st.hitAt) { const k = Math.floor((now - st.hitAt) * 1000 / M.frameMs); if (k < M.offsetsPx.length) [ox, oy] = M.offsetsPx[k]; }
      const text = `${Math.min(999, dmg)}%`;
      const box = { x0: right ? ax - this.digitsWidth(text) : ax, w: this.digitsWidth(text) };
      this.hudParticles(f.i, band, box, ay, now, increased);
      this.drawDigits(text, ax + ox, ay + oy, band, right);
      const [sw, sh] = H.stockSizePx, gap = H.iconGapPx, team = PAL.fighters["p" + (f.i + 1)];
      for (let i = 0; i < H.stockCount; i++) {
        const sx = right ? ax - sw - i * (sw + gap) : ax + i * (sw + gap), sy = ay + 28;
        ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(sx - 1, sy - 1, sw + 2, sh + 2);
        if (i < f.stocks) { ctx.fillStyle = team.primary; ctx.fillRect(sx, sy, sw, sh); ctx.fillStyle = team.highlight; ctx.fillRect(sx, sy, sw, 1); }
        else { ctx.fillStyle = team.shadow; ctx.fillRect(sx, sy, sw, 1); ctx.fillRect(sx, sy + sh - 1, sw, 1); ctx.fillRect(sx, sy, 1, sh); ctx.fillRect(sx + sw - 1, sy, 1, sh); }
      }
      // 連勝燈 0/3：亮燈＝已連贏幾次；剛亮的那顆彈一下；集滿（四套拳中）整排閃
      const T = view.streakTarget ?? CONFIG.STREAK_TARGET, lw = 10, lh = 7, pop = REDUCED ? 0 : Math.max(0, 1 - (now - this.streakAt[f.i]) * 4);
      if (!this.hud2()) for (let i = 0; i < T; i++) {                      // hudV2：改成倒數條兩側的連勝火焰
        const lx = right ? ax - lw - i * (lw + 3) : ax + i * (lw + 3), ly = ay + 40, lit = i < f.streak, fresh = lit && i === f.streak - 1 && pop > 0;
        const grow = fresh ? Math.round(pop * 2) : 0;
        ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(lx - 1 - grow, ly - 1 - grow, lw + 2 + grow * 2, lh + 2 + grow * 2);
        if (lit) { const full = f.streak >= T && Math.floor(now * 8) % 2 === 0; ctx.fillStyle = full ? "#FFF1B8" : "#FF8A3D"; ctx.fillRect(lx - grow, ly - grow, lw + grow * 2, lh + grow * 2); ctx.fillStyle = "#FFD27A"; ctx.fillRect(lx - grow, ly - grow, lw + grow * 2, 2); }
        else { ctx.fillStyle = "#2A2F3D"; ctx.fillRect(lx, ly, lw, lh); }
      }
    }
  }
  digitsWidth(text) { return [...text].reduce((s, ch) => s + (DIGIT[ch]?.[0].length ?? 4) * 4 + 3, 0) - 3; }
  urgent(view) { const left = view.dur - view.t; return view.phase === PH.COMBO_CUE ? left <= CONFIG.countdown.urgentSec : (view.phase === PH.RPS || view.phase === PH.CLASH_INPUT || view.phase === PH.COMBO_PREP) && left <= CONFIG.countdown.phaseTickLast; }
  timed(view) { return view.dur > 0 && [PH.RPS, PH.CLASH_INPUT, PH.COMBO_PREP, PH.COMBO_CUE].includes(view.phase); }
  // ---- 頂部大型提示（v4）：面板＝「現在要幹嘛」大字＋倒數條；中央＝大號倒數（3、2、1 → 出招！）；回饋大字 ----
  promptFor(view) {
    const ph = view.phase, r = view.round, me = view.seat, P = i => `P${i + 1}`;
    const hidden = ph === PH.RPS && view.t >= (view.reveal ?? CONFIG.rps.reveal);
    const dm = view.fighters.some(f => this.shownDamage(f) >= PAL.damageBands[PAL.damageBands.length - 1].minInclusive);
    const gold = PAL.hud.powerFill, blue = PAL.fx.blue.rim, red = PAL.fx.red.rim, cyan = "#5FE6FF", orange = "#FFB15A";
    switch (ph) {
      case PH.RPS: return hidden ? { text: "🤫 藏招！最後機會換拳", color: PAL.hud.label } : { text: dm ? "⚡ 絕命對峙！出拳！" : me < 0 ? "✊ 雙方出拳！" : "✊ 出拳！按一招擺架式", color: dm ? red : gold };
      case PH.REVEAL: return { text: "👀 開牌！", color: gold };
      case PH.CLASH: return { text: (view.gauge ?? 0) > 0 ? `⚔️ 叮！平手（蓄力 ${view.gauge}/${view.gaugeMax}）` : "⚔️ 平分！各自彈開", color: cyan };
      case PH.CLASH_INPUT: return { text: `⚔️ 五連斬！連按 ${CONFIG.CLASH_SEQUENCE_LENGTH} 招`, color: cyan };
      case PH.CLASH_ANIM: return { text: view.clash?.result ? "⚔️ 主招大招！" : "⚔️ 五刀對砍", color: cyan };
      case PH.STRIKE: return { text: !r ? "" : me === r.att ? "💥 連勝重擊！" : me === r.def ? "😣 吃一記重擊" : `💥 ${P(r.att)} 連勝重擊`, color: orange };
      case PH.BURST: return { text: "🔥 連勝爆發！四連擊開始！", color: PAL.fx.red.core };
      case PH.COMBO_PREP: return { text: !r ? "" : me === r.att ? `🎯 第 ${r.n} 拳：按一招決定出什麼！` : me === r.def ? `🛡️ 第 ${r.n} 拳來了，準備反擊…` : `🎯 ${P(r.att)} 第 ${r.n} 拳選拳中`, color: orange };
      case PH.COMBO_CUE: {
        if (!r) return null;
        const ans = r.gesture ? GNAME[COUNTER[r.gesture]] : "";
        if (me === r.def || me < 0) return { text: `🛡️ ${me < 0 ? P(r.def) + " " : ""}反擊！${this.showHints && ans ? `按 ${ans}` : "按剋制它的拳"}`, color: blue };
        return { text: `👊 第 ${r.n} 拳出手：看對手接不接得住`, color: blue };
      }
      case PH.COMBO_HIT: return { text: r ? `👊 第 ${r.n} 拳命中` : "", color: orange };
      default: return null;
    }
  }
  // ---- 視線中心 UI v2（座標照 ui_v2_spec.json 的 recommended_layout）----
  //   g＝高解析度 HUD 畫布（邏輯座標 480×270）：倒數框 (150,46)、連勝火焰 (54,63)／(406,63)、大號倒數 y≈94、漫畫大字 y 84～95
  drawHudV2(g, view, now) {
    const U = CONFIG.uiV2.layout, P = this.promptFor(view), ph = view.phase, timed = this.timed(view), left = Math.max(0, view.dur - view.t);
    const comic = this.comicLive(now), T = U.timer, cx = T.x + T.w / 2;
    g.save(); g.imageSmoothingEnabled = false; g.textAlign = "center"; g.lineJoin = "round";
    if (P?.text && !comic) {                                               // 階段標題：倒數框正上方
      g.font = "900 11px sans-serif"; g.lineWidth = 3; g.strokeStyle = PAL.fighters.outline; g.strokeText(P.text, cx, U.prompt.cy); g.fillStyle = P.color; g.fillText(P.text, cx, U.prompt.cy);
    }
    if (timed && !comic) {                                                 // 倒數框：底軌 → 剩餘條（從右往左縮）→ 框圖；最後 0.5 秒轉紅閃爍
      const k = clamp(left / view.dur, 0, 1), urgent = left <= T.urgentSec, blink = urgent && Math.floor(now * 16) % 2 === 0, img = this.uiImg("timerFrame"), [fx, fy, fw, fh] = T.fill;
      let c = ph === PH.COMBO_CUE ? "#4FC3FF" : ph === PH.CLASH_INPUT ? "#5FE6FF" : ph === PH.COMBO_PREP ? "#FFB15A" : "#FFD23A";
      if (urgent) c = blink ? "#FFFFFF" : "#FF3A3A";
      g.fillStyle = "#141826"; g.fillRect(fx, fy, fw, fh);
      g.fillStyle = c; g.fillRect(fx, fy, Math.round(fw * k), fh); g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(fx, fy, Math.round(fw * k), 2);
      if (img) g.drawImage(img, T.x, T.y);
      else { g.strokeStyle = urgent ? "#FF3A3A" : "#F2C14E"; g.lineWidth = 2; g.strokeRect(T.x + 1, T.y + 1, T.w - 2, T.h - 2); }
    }
    // 連勝火焰：一勝點一盞，最多 3 盞；沒點的畫空槽
    const S = U.streak, F = CONFIG.uiV2.flames, fimg = this.uiImg("streakFlames");
    for (const f of view.fighters) for (let i = 0; i < S.slots; i++) {
      const [bx, by] = f.i === 0 ? S.p1First : S.p2First, x = bx + i * S.stepX[f.i], y = by, lit = i < f.streak;
      if (!lit) { g.strokeStyle = "rgba(255,255,255,.28)"; g.lineWidth = 1; g.strokeRect(x + 4.5, y + 8.5, F.frameW - 9, F.frameH - 10); continue; }
      const fr = REDUCED ? 0 : Math.floor(now * F.fps + i) % F.frames;
      if (fimg) { g.drawImage(fimg, fr * F.frameW, 0, F.frameW, F.frameH, x, y, F.frameW, F.frameH); continue; }
      const mx = x + F.frameW / 2, my = y + F.frameH - 3, h = 14 + (REDUCED ? 0 : Math.sin(now * 14 + i * 2) * 3);
      g.fillStyle = "#FF6A2A"; g.beginPath(); g.moveTo(mx - 6, my); g.quadraticCurveTo(mx - 7, my - h / 2, mx, my - h); g.quadraticCurveTo(mx + 7, my - h / 2, mx + 6, my); g.fill();
      g.fillStyle = "#FFD45A"; g.beginPath(); g.moveTo(mx - 3, my); g.quadraticCurveTo(mx - 3, my - h / 3, mx, my - h / 2); g.quadraticCurveTo(mx + 3, my - h / 3, mx + 3, my); g.fill();
    }
    // 大號倒數（3、2、1／反擊窗小數／出招！）：漫畫大字出現時讓位
    let big = null, bigColor = PAL.hud.focusOutline;
    if (ph === PH.RPS || ph === PH.CLASH_INPUT) big = String(Math.max(1, Math.ceil(left - 1e-6)));
    // （反擊窗不顯示大號小數：頭頂盾牌外圈＋倒數框已在跑秒，避免壓到盾牌）
    if (ph === PH.REVEAL && now - this.goFlash < 0.55) { big = "出招！"; bigColor = PAL.hud.powerFill; }
    if (big !== null && !comic) {
      if (big !== this.bigNum.v) this.bigNum = { v: big, at: now };
      const pop = REDUCED ? 0 : Math.max(0, 1 - (now - this.bigNum.at) * 5), sc = 1 + pop * 0.5;
      g.save(); g.translate(cx, U.bigNum.y); g.scale(sc, sc); g.font = `900 ${big.length > 3 ? 18 : 22}px sans-serif`;
      g.lineWidth = 4; g.strokeStyle = PAL.fighters.outline; g.strokeText(big, 0, 0); g.fillStyle = timed && left <= T.urgentSec && Math.floor(now * 16) % 2 === 0 ? PAL.fx.red.rim : bigColor; g.fillText(big, 0, 0); g.restore();
    }
    if (comic) this.drawComic(g, now);
    else {                                                                 // 一般回饋字（吃拳、重擊…）：漫畫大字沒出現時才顯示
      const C = this.callout;
      if (C && now - C.at < C.life) {
        const age = now - C.at, pop = REDUCED ? 0 : Math.max(0, 1 - age * 7), a = Math.min(1, (C.life - age) * 4);
        g.save(); g.globalAlpha = a; g.translate(cx, U.feedbackY); g.scale(1 + pop * 0.5, 1 + pop * 0.5); g.font = "900 15px sans-serif";
        g.fillStyle = "rgba(10,14,24,.72)"; g.fillRect(-118, -16, 236, C.sub ? 30 : 22);
        g.lineWidth = 3; g.strokeStyle = PAL.fighters.outline; g.strokeText(C.text, 0, 0); g.fillStyle = C.color; g.fillText(C.text, 0, 0);
        if (C.sub) { g.font = "bold 9px sans-serif"; g.fillStyle = PAL.hud.label; g.fillText(C.sub, 0, 11); }
        g.restore();
      }
    }
    g.restore();
  }
  // 漫畫爆發大字：1.6 → 0.95 → 1.0 砸入（約 0.14s），停留 holdMs 後淡出往上滑；中心照 JSON（反擊 y=95、KO y=84）
  drawComic(g, now) {
    const c = this.comicFx, L = CONFIG.uiV2.layout.callout, age = now - c.at, hold = L.holdMs[c.kind] / 1000;
    const sc = REDUCED ? 1 : age < 0.07 ? 1.6 - 0.65 * (age / 0.07) : age < 0.14 ? 0.95 + 0.05 * ((age - 0.07) / 0.07) : 1;
    const out = clamp((age - hold) / L.out, 0, 1), key = "callout" + c.kind[0].toUpperCase() + c.kind.slice(1), img = this.uiImg(key), [x, y] = L.center[c.kind];
    g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = 1 - out; g.translate(x, y - out * 14); g.scale(sc, sc);
    if (img) g.drawImage(img, -Math.round(img.naturalWidth / 2), -Math.round(img.naturalHeight / 2));
    else {
      const V = { burst: ["連勝爆發！", "#FF6A3D"], counter: ["反擊！", "#2EC8F0"], clash: ["五連斬！", "#F2B632"], ko: ["K.O.！", "#FF2A4A"] }[c.kind];
      g.beginPath();
      for (let i = 0; i < 20; i++) { const q = i / 20 * Math.PI * 2, r = i % 2 ? 0.72 : 1; g.lineTo(Math.cos(q) * 96 * r, Math.sin(q) * 24 * r); }
      g.closePath(); g.fillStyle = V[1]; g.fill(); g.lineWidth = 3; g.strokeStyle = "#0A0A12"; g.stroke();
      g.font = "900 22px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 5; g.strokeStyle = "#0A0A12"; g.strokeText(V[0], 0, 1); g.fillStyle = "#FFFFFF"; g.fillText(V[0], 0, 1);
    }
    g.restore();
  }
  // 過熱鎖招：角色背側上方 22×22（ui_rps_big 那一格＋ui_overheat_lock 疊在同一範圍），按到過熱招時抖動冒煙；只在猜拳／開牌時顯示
  drawHeatIcons(view, now) {
    if (view.phase !== PH.RPS && view.phase !== PH.REVEAL) return;
    const ctx = this.ctx, L = CONFIG.uiV2.layout.heatIcon, Sz = L.size, rimg = this.uiImg("rpsBig"), limg = this.uiImg("overheatLock");
    for (const f of view.fighters) {
      if (!f.heat || f.out || !CONFIG.overheat.enabled) continue;
      const shake = this.wclock - this.heatAt[f.i] < 0.4 && !REDUCED, dx = shake ? Math.round(Math.sin(now * 90) * 2) : 0;
      const x = Math.round(clamp(f.x - f.face * L.dx, Sz / 2 + 2, CONFIG.W - Sz / 2 - 2) - Sz / 2) + dx, y = Math.round(f.y + L.dy - Sz / 2);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      if (rimg) ctx.drawImage(rimg, ...this.rpsFrame(rimg, f.heat), x, y, Sz, Sz);
      else { this.roundRect(x - 1, y - 1, Sz + 2, Sz + 2, "#2A0E10"); this.roundRect(x, y, Sz, Sz, "#4A1A1C"); ctx.translate(x + 2, y + 2); ctx.scale((Sz - 4) / 24, (Sz - 4) / 24); drawGestureGlyph(ctx, GESTURE_GLYPH[f.heat], 5, 5, "#FFD6C8", "#FF9A62"); ctx.setTransform(1, 0, 0, 1, 0, 0); }
      ctx.restore(); ctx.save(); ctx.imageSmoothingEnabled = false;
      if (limg) ctx.drawImage(limg, x, y, Sz, Sz);
      else { ctx.strokeStyle = "#FF2A2A"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + Sz - 3, y + Sz - 3); ctx.moveTo(x + Sz - 3, y + 3); ctx.lineTo(x + 3, y + Sz - 3); ctx.stroke(); }
      ctx.restore();
      if (shake) { const age = this.wclock - this.heatAt[f.i]; if (!VFX.draw(ctx, "vfx_overheat_smoke", age, x + Sz / 2, y + 4, f.face)) { ctx.save(); PROC_VFX.vfx_overheat_smoke.draw(ctx, x + Sz / 2, y + 4, f.face, 0, age); ctx.restore(); } }
    }
  }
  // ---- 身前招式印記（rps_aura_*.png；缺圖程式繪製）----
  //   猜拳：看得到的招 → 該招印記；鎖定但藏著 → 紫金聚氣；開牌：贏方印記放大衝向對手、輸方碎成像素消散；四套拳反擊窗：攻方印記 ×1.25、脈動加快
  sigilAt(f) { const O = CONFIG.rpsAura.offset; return [f.x + f.face * O[0], f.y + O[1]]; }
  drawAura(key, t, x, y, face, scale = 1, alpha = 1) {
    const A = CONFIG.rpsAura, S = A.sheets[key], img = CONFIG.ART_PACKS?.rpsAura ? Assets.get(S.file) : null, ctx = this.ctx;
    ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(x), Math.round(y)); ctx.scale(face * scale, scale);
    if (img) { const n = Math.floor(t * S.fps) % S.frames; ctx.drawImage(img, n * A.frame, 0, A.frame, A.frame, -A.pivot[0], -A.pivot[1], A.frame, A.frame); }
    else drawSigilProc(ctx, key, t, A.colors[key]);
    ctx.restore();
  }
  drawSigils(view, now) {
    const A = CONFIG.rpsAura, ph = view.phase, r = view.round, G = ["rock", "scissors", "paper"];
    for (const f of view.fighters) {
      if (f.out) { this.sig[f.i] = null; continue; }
      let key = null, scale = 1, fpsMul = 1, [x, y] = this.sigilAt(f), alpha = 1;
      if (ph === PH.RPS) key = G.includes(f.stance) ? f.stance : f.picked ? "lock" : null;
      else if (ph === PH.REVEAL && view.rps) {
        key = view.rps.stances[f.i];
        const w = view.rps.winner, k = clamp(view.t / view.dur, 0, 1);
        if (w === f.i) { const o = view.fighters[1 - f.i]; x += (o.x - f.x) * 0.55 * k * k; scale = 1 + 0.7 * k; }   // 贏方：放大衝向對手
        else if (w >= 0) { if (this.sigBreak && !this.sigBreak.done && this.sigBreak.p === f.i) { this.sigBreak.done = true; const c = A.colors[key]; for (let i = 0; i < 16; i++) this.fx.push({ k: "spark", x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 120, life: 0.5, max: 0.5, color: i % 2 ? c[0] : c[1] }); } key = null; }   // 輸方：碎成像素粒子
      } else if (ph === PH.COMBO_CUE && r?.att === f.i && r.gesture) { key = r.gesture; scale = A.cueScale; fpsMul = A.cueFpsMul; }
      const cur = this.sig[f.i];
      if (!key) { this.sig[f.i] = null; continue; }
      if (!cur || cur.key !== key) this.sig[f.i] = { key, at: now };
      const age = now - this.sig[f.i].at, pop = REDUCED ? 1 : age < A.popSec ? A.popFrom - (A.popFrom - 1) * (age / A.popSec) : 1;
      const pulse = REDUCED || ph !== PH.COMBO_CUE ? 1 : 1 + Math.sin(now * 16) * 0.06;
      this.drawAura(key, age * fpsMul, x, y, f.face, scale * pop * pulse, alpha);
    }
  }
  // ---- 肩後過熱：暗灰底招式圖示＋粗黑邊紅叉、持續冒煙＋暗紅呼吸光；按到過熱鍵 → 紅叉 1.45× 爆跳晃動；解除 → 縮小淡出＋冷卻白蒸氣 ----
  drawShoulderHeat(view, now) {
    const ctx = this.ctx, S = CONFIG.rpsAura.shoulder, Z = S.size, rimg = this.uiImg("rpsBig"), limg = this.uiImg("overheatLock");
    const icon = (f, g, cx, cy, sc, a) => {
      ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(cx), Math.round(cy)); ctx.scale(sc, sc);
      this.roundRect(-Z / 2 - 1, -Z / 2 - 1, Z + 2, Z + 2, "#0A0A12"); this.roundRect(-Z / 2, -Z / 2, Z, Z, "#3A3D46");
      if (rimg) { ctx.filter = "grayscale(1) brightness(1.15)"; ctx.drawImage(rimg, ...this.rpsFrame(rimg, g), -Z / 2 + 2, -Z / 2 + 2, Z - 4, Z - 4); ctx.filter = "none"; }
      else { ctx.save(); ctx.translate(-Z / 2 + 2, -Z / 2 + 2); ctx.scale((Z - 4) / 24, (Z - 4) / 24); drawGestureGlyph(ctx, GESTURE_GLYPH[g], 5, 5, "#D8DAE0", "#9AA0AA"); ctx.restore(); }
      if (limg) ctx.drawImage(limg, -Z / 2, -Z / 2, Z, Z);
      else for (const [c, w] of [["#0A0A12", 5], ["#FF2A2A", 2.5]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(-Z / 2 + 3, -Z / 2 + 3); ctx.lineTo(Z / 2 - 3, Z / 2 - 3); ctx.moveTo(Z / 2 - 3, -Z / 2 + 3); ctx.lineTo(-Z / 2 + 3, Z / 2 - 3); ctx.stroke(); }
      ctx.restore();
    };
    for (const f of view.fighters) {
      if (f.out) continue;
      const cx = clamp(f.x + f.face * S.dx, Z / 2 + 2, CONFIG.W - Z / 2 - 2), cy = f.y + S.dy;
      const c = this.cool[f.i];
      if (c && !f.heat) {                                                   // 解除：縮小淡出＋冷卻白蒸氣圈
        const k = (now - c.at) / S.coolSec;
        if (k < 1) { icon(f, c.g, cx, cy, 1 - k * 0.7, 1 - k); ctx.save(); for (let i = 0; i < 10; i++) { const q = i / 10 * Math.PI * 2, rr = 6 + k * 16; ctx.globalAlpha = (1 - k) * 0.8; ctx.fillStyle = "#EAF6FF"; ctx.fillRect(Math.round(cx + Math.cos(q) * rr), Math.round(cy - 6 + Math.sin(q) * rr * 0.6), 2, 2); } ctx.restore(); }
        else this.cool[f.i] = null;
        continue;
      }
      if (!f.heat || !CONFIG.overheat.enabled) continue;
      const age = this.wclock - this.heatAt[f.i], press = age < S.pressSec;
      if (!REDUCED) { ctx.save(); ctx.globalAlpha = 0.18 + 0.1 * Math.sin(now * 4); ctx.fillStyle = "#FF2A2A"; ctx.fillRect(Math.round(cx - Z / 2 - 3), Math.round(cy - Z / 2 - 3), Z + 6, Z + 6); ctx.restore(); }   // 暗紅呼吸光
      if (!VFX.draw(ctx, "vfx_overheat_smoke", this.wclock * (REDUCED ? 0.5 : 1), cx, cy - Z / 2 + 2, f.face)) { ctx.save(); PROC_VFX.vfx_overheat_smoke.draw(ctx, cx, cy - Z / 2 + 2, f.face, 0, this.wclock); ctx.restore(); }   // 持續冒煙
      const sc = press && !REDUCED ? 1 + (S.pressPop - 1) * (1 - age / S.pressSec) : 1, dx = press && !REDUCED ? Math.sin(now * 90) * 2 : 0;
      icon(f, f.heat, cx + dx, cy, sc, 1);
    }
  }
  // 動漫集中線：四套拳與五連斬期間；每 3 幀翻轉／抖動；減少動態＝靜態半透明
  drawSpeedlines(view, now) {
    const on = [PH.BURST, PH.COMBO_PREP, PH.COMBO_CUE, PH.COMBO_HIT, PH.CLASH_ANIM].includes(view.phase);
    if (!on) return;
    const ctx = this.ctx, W = CONFIG.W, H = CONFIG.H, step = REDUCED ? 0 : Math.floor((this.slFrame = (this.slFrame ?? 0) + 1) / 3), img = this.uiImg("speedlines");
    ctx.save(); ctx.globalAlpha = REDUCED ? 0.25 : 0.85;
    if (img) {
      const fx = step % 2 ? -1 : 1, fy = (step >> 1) % 2 ? -1 : 1, j = REDUCED ? 0 : (step % 3) - 1;
      ctx.translate(W / 2 + j, H / 2); ctx.scale(fx, fy); ctx.drawImage(img, -W / 2, -H / 2, W, H);
    } else {
      ctx.fillStyle = "#FFFFFF";
      for (let i = 0; i < 64; i++) {                                     // 中央留空（橢圓半徑約 130×78）給角色與大字
        const h = Math.sin(i * 91.7 + step * 13.1) * 43758.5, r = h - Math.floor(h), q = (i / 64 + r * 0.012) * Math.PI * 2;
        const inner = 0.5 + r * 0.22, cx = W / 2, cy = H / 2 + 6, ex = Math.cos(q), ey = Math.sin(q), w = 0.012 + r * 0.02;
        ctx.beginPath(); ctx.moveTo(cx + ex * 260 * inner, cy + ey * 150 * inner);
        ctx.lineTo(cx + Math.cos(q - w) * 420, cy + Math.sin(q - w) * 260); ctx.lineTo(cx + Math.cos(q + w) * 420, cy + Math.sin(q + w) * 260); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  drawTopPrompt(g, view, now) {
    const P = this.promptFor(view), ph = view.phase, timed = this.timed(view), left = Math.max(0, view.dur - view.t);
    const urgent = timed && this.urgent(view), blink = urgent && Math.floor(now * 20) % 2 === 0;
    const W = 240, x0 = CONFIG.W / 2 - W / 2, y0 = 3, H = timed ? 36 : 26;
    if (P?.text) {
      const fresh = this.callout && now - this.callout.at < 0.25;                  // 有回饋時面板框閃一下
      g.save();
      g.fillStyle = "rgba(10,14,24,.9)"; g.fillRect(x0, y0, W, H);
      g.lineWidth = fresh ? 2.5 : 1.5; g.strokeStyle = blink ? PAL.fx.red.rim : fresh ? "#FFFFFF" : P.color; g.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
      g.textAlign = "center"; g.textBaseline = "alphabetic"; g.font = "900 14px sans-serif";
      let size = 14; while (size > 10 && g.measureText(P.text).width > W - 14) { size -= 1; g.font = `900 ${size}px sans-serif`; }
      g.fillStyle = PAL.fighters.outline; g.fillText(P.text, CONFIG.W / 2 + 1, y0 + 18 + 1); g.fillStyle = P.color; g.fillText(P.text, CONFIG.W / 2, y0 + 18);
      if (timed) {                                                                 // 倒數條：粗、對比高，藏招期變灰、最後一小段紅閃
        const bw = W - 24, bx = x0 + 12, by = y0 + 25, k = clamp(left / view.dur, 0, 1);
        let c = ph === PH.COMBO_CUE ? PAL.fx.blue.rim : ph === PH.CLASH_INPUT ? "#5FE6FF" : ph === PH.COMBO_PREP ? "#FFB15A" : PAL.hud.powerFill;
        if (ph === PH.RPS && view.t >= (view.reveal ?? CONFIG.rps.reveal)) c = PAL.hud.muted;
        if (urgent) c = blink ? PAL.fx.red.rim : PAL.hud.focusOutline;
        g.fillStyle = "#1B2132"; g.fillRect(bx, by, bw, 6); g.fillStyle = c; g.fillRect(bx, by, Math.round(bw * k), 6);
        if (ph === PH.RPS) { g.fillStyle = PAL.hud.focusOutline; g.fillRect(bx + Math.round(bw * (1 - (view.reveal ?? CONFIG.rps.reveal) / view.dur)), by - 2, 1.5, 10); }   // 藏招開始的刻度
      }
      g.restore();
    }
    if (view.speedLv > 0 && timed) { g.textAlign = "center"; g.font = "bold 8px sans-serif"; g.fillStyle = PAL.fx.red.rim; g.fillText(`⚡ 速度 Lv.${view.speedLv + 1}`, CONFIG.W / 2 + 62, 54); }
    // 中央大號倒數：猜拳／五連斬顯示整數（3、2、1），四套拳反擊窗顯示小數；猜拳結束接「出招！」
    let big = null, bigColor = PAL.hud.focusOutline;
    const cutBusy = this.cutText && now - this.cutText.at < this.cutText.life;   // 五連斬開頭的大字還在：先不疊倒數
    if (ph === PH.RPS || (ph === PH.CLASH_INPUT && !cutBusy)) big = String(Math.max(1, Math.ceil(left - 1e-6)));
    else if (ph === PH.COMBO_CUE) { big = left.toFixed(1); bigColor = PAL.fx.blue.rim; }
    const goAge = now - this.goFlash;
    if (ph === PH.REVEAL && goAge < 0.55) { big = "出招！"; bigColor = PAL.hud.powerFill; }
    if (big !== null) {
      if (big !== this.bigNum.v) this.bigNum = { v: big, at: now };
      const pop = REDUCED ? 0 : Math.max(0, 1 - (now - this.bigNum.at) * 5), sc = 1 + pop * 0.5;
      g.save(); g.translate(CONFIG.W / 2, 84); g.scale(sc, sc);
      g.textAlign = "center"; g.font = `900 ${big.length > 3 ? 26 : 30}px sans-serif`; g.lineJoin = "round";
      g.lineWidth = 4; g.strokeStyle = PAL.fighters.outline; g.strokeText(big, 0, 0);
      g.fillStyle = urgent && blink ? PAL.fx.red.rim : bigColor; g.fillText(big, 0, 0);
      g.restore();
    }
    // 中央回饋大字（連勝、重擊、吃拳、反擊）
    const C = this.callout;
    if (C && now - C.at < C.life) {
      const age = now - C.at, pop = REDUCED ? 0 : Math.max(0, 1 - age * 7), a = Math.min(1, (C.life - age) * 4);
      g.save(); g.globalAlpha = a; g.translate(CONFIG.W / 2, 104); g.scale(1 + pop * 0.6, 1 + pop * 0.6);   // 在大倒數下方、角色頭上傷害數字上方
      g.textAlign = "center"; g.font = "900 20px sans-serif"; g.lineJoin = "round";
      g.fillStyle = "rgba(10,14,24,.72)"; g.fillRect(-140, -22, 280, C.sub ? 38 : 30);
      g.lineWidth = 3; g.strokeStyle = PAL.fighters.outline; g.strokeText(C.text, 0, 0); g.fillStyle = C.color; g.fillText(C.text, 0, 0);
      if (C.sub) { g.font = "bold 10px sans-serif"; g.fillStyle = PAL.hud.label; g.fillText(C.sub, 0, 13); }
      g.restore();
    }
  }
  // ---- 耐受度狀態字（% 數字下方；四級樣式依 ART.palette.damageBands，動態依 CONFIG.status） ----
  //   穩如泰山：靜止｜腳步微晃：受擊彈跳縮放｜搖搖欲墜！：持續 ±1px 低頻抖動＋微弱火花｜瀕死！！：±2px 高頻震動＋紅白閃爍＋黑煙
  drawStatusLabel(g, f, now) {
    const st = this.dmgFx[f.i], band = st.band ?? this.bandOf(this.shownDamage(f)), L = ART.hud.damageText.statusLabel, S = CONFIG.status;
    const right = f.i === 1, H = ART.hud.playerPanels, ax = (right ? H.p2.anchorX : H.p1.anchorX) + L.offsetFromPanelAnchorPx[0], ay = H.p1.anchorY + L.offsetFromPanelAnchorPx[1];
    const crit = band.id === "critical";
    let text = band.label, size = L.fontSizePx, dx = 0, dy = 0, scale = 1, fill = band.fill;
    if (crit) { size += 2; if (Math.floor(now / S.altEverySec) % 2) text = S.criticalAlt; }
    if (!REDUCED) {
      const J = S.jitter[band.id];
      if (J) { const k = Math.floor(now * J.hz) + f.i * 7; dx = ((k * 37) % 3 - 1) * J.px; dy = ((k * 53) % 3 - 1) * (J.px > 1 ? 1 : 0); }
      if (band.id === "wobbling" && st.hitAt && now - st.hitAt < S.popMs / 1000) scale = 1 + 0.35 * Math.sin(Math.PI * (now - st.hitAt) / (S.popMs / 1000));
      if (crit && (now % S.flashEverySec) < S.flashMs / 1000) fill = "#FFFFFF";
      if (band.id === "teetering" && now - st.sparkAt > 0.45) {          // 微弱像素火花
        st.sparkAt = now; const w = 52;
        st.parts.push({ k: "spark", x: right ? ax - Math.random() * w : ax + Math.random() * w, y: ay + 2, vx: (Math.random() - 0.5) * 20, vy: -18, life: 0.3, max: 0.3, color: Math.random() < 0.5 ? "#FFD194" : "#F07848", size: 1 });
      }
      if (crit && now - st.sparkAt > 0.22) {                              // 字旁飄黑煙
        st.sparkAt = now;
        st.parts.push({ k: "smoke", x: right ? ax - 10 - Math.random() * 50 : ax + 10 + Math.random() * 50, y: ay + 4, vx: (Math.random() - 0.5) * 6, vy: -16, life: 0.55, max: 0.55, color: Math.random() < 0.5 ? "#251C2B" : "#151520", size: 2 + Math.floor(Math.random() * 2), op: 0.45 });
      }
    }
    g.save();
    g.translate(ax + dx, ay + dy + size); if (scale !== 1) { g.translate(right ? -20 : 20, -size / 2); g.scale(scale, scale); g.translate(right ? 20 : -20, size / 2); }
    g.textAlign = right ? "right" : "left"; g.textBaseline = "alphabetic"; g.font = `900 ${size}px sans-serif`; g.lineJoin = "round";
    g.fillStyle = band.shadow; g.fillText(text, 1, 1);
    g.lineWidth = crit ? 3 : 2; g.strokeStyle = band.outline; g.strokeText(text, 0, 0);
    g.fillStyle = fill; g.fillText(text, 0, 0);
    if (band.topRim) { g.save(); g.beginPath(); g.rect(right ? -200 : 0, -size, 200, Math.max(1, size * 0.22)); g.clip(); g.fillStyle = band.topRim; g.fillText(text, 0, 0); g.restore(); }
    g.restore();
  }

  // ---- HUD（高解析度文字） ----
  drawHudText(g, view, now) {
    const ph = view.phase, r = view.round, cam = this.cam, toScreen = (x, y) => [(x - cam.x) * cam.zoom + CONFIG.W / 2, (y - cam.y) * cam.zoom + CONFIG.H / 2];
    g.textBaseline = "alphabetic";
    for (const f of view.fighters) this.drawStatusLabel(g, f, now);
    g.font = "bold 7px sans-serif";
    for (const f of view.fighters) {
      const right = f.i === 1, team = PAL.fighters["p" + (f.i + 1)];
      g.textAlign = right ? "right" : "left"; g.fillStyle = team.secondary;
      g.fillText(this.names[f.i] + (view.seat === f.i ? "（你）" : ""), right ? 464 : 16, 81);
      if (f.heat && !this.hud2()) {                                     // 過熱公開：對手禁用哪招（v2 改成肩後紅叉印記）
        const who = view.seat < 0 ? `P${f.i + 1} 禁用` : f.i === view.seat ? "你禁用" : "對手禁用";
        g.font = "bold 8px sans-serif"; g.fillStyle = "#FF9A62"; g.fillText(`♨️ ${who}：${GICON[f.heat]}`, right ? 464 : 16, 92); g.font = "bold 7px sans-serif";
      }
    }
    for (const f of view.fighters) {                                    // 連勝燈旁的字：「🔥 連勝 2/3」
      const right = f.i === 1, H = ART.hud.playerPanels, T = view.streakTarget ?? CONFIG.STREAK_TARGET, x = right ? H.p2.anchorX - T * 13 - 4 : H.p1.anchorX + T * 13 + 4;
      g.textAlign = right ? "right" : "left"; g.font = "bold 8px sans-serif"; g.fillStyle = f.streak >= T ? "#FFF1B8" : f.streak ? "#FFB15A" : PAL.hud.muted;
      g.fillText(`🔥 連勝 ${f.streak}/${T}`, x, 59);
    }
    if (this.hud2()) this.drawHudV2(g, view, now);
    else if (this.juice()) { const k = CONFIG.V2.hudScale; g.save(); g.translate(CONFIG.W / 2, 0); g.scale(k, k); g.translate(-CONFIG.W / 2, 0); this.drawTopPrompt(g, view, now); g.restore(); }   // v2：放大頂部提示
    else this.drawTopPrompt(g, view, now);
    // 開牌停頓：中央放大結果（🖐️ 布 壓制 ✊ 石頭！）
    if (ph === PH.REVEAL && view.rps) {
      const [s0, s1] = view.rps.stances, w = view.rps.winner, pop = Math.max(0, 1 - view.t * 5);
      const line = w < 0 ? `${GNAME[s0]} 平手 ${GNAME[s1]}` : `${GNAME[view.rps.stances[w]]} 壓制 ${GNAME[view.rps.stances[1 - w]]}！`;
      const sub = w < 0 ? "⚔️ 平手 → 拼刀！" : view.seat < 0 ? `P${w + 1} 贏拳 → 連打` : w === view.seat ? "你贏拳！準備連打" : "對手贏拳：準備接招";
      g.save(); g.translate(CONFIG.W / 2, 128); g.scale(1 + pop * 0.35, 1 + pop * 0.35);
      g.fillStyle = "rgba(16,24,39,.86)"; g.fillRect(-150, -26, 300, 46);
      g.strokeStyle = w < 0 ? PAL.hud.label : PAL.hud.powerFill; g.lineWidth = 1.5; g.strokeRect(-150, -26, 300, 46);
      g.textAlign = "center"; g.font = "900 17px sans-serif"; g.fillStyle = PAL.fighters.outline; g.fillText(line, 1, 1);
      g.fillStyle = w < 0 ? PAL.hud.label : PAL.hud.focusOutline; g.fillText(line, 0, 0);
      g.font = "bold 9px sans-serif"; g.fillStyle = w < 0 ? PAL.fx.impact.spark : PAL.hud.powerFill; g.fillText(sub, 0, 14);
      g.restore();
    }
    // 拼刀蓄力 ⚔️ 0/2：上方中央（1/2 閃爍、2/2 金光爆開）
    if (ph !== PH.GAMEOVER && ph !== PH.IDLE && view.gaugeMax) {
      const gv = view.gauge ?? 0, full = gv >= view.gaugeMax, fa = now - this.gaugeFullAt, fl = now - this.gaugeAt;
      const blink = !full && gv > 0 && fl < 1.2 && Math.floor(fl * 10) % 2 === 0, burst = full && fa < 0.6 ? 1 - fa / 0.6 : 0;
      const gx = CONFIG.W / 2 - 62, gy = 54;                            // 頂部提示面板正下方左側
      if (burst && !REDUCED) { g.globalAlpha = burst; g.fillStyle = "#FFD45A"; g.beginPath(); g.arc(gx, gy - 3, 6 + (1 - burst) * 22, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      g.save(); g.translate(gx, gy); if (burst) g.scale(1 + burst * 0.5, 1 + burst * 0.5);
      g.textAlign = "center"; g.font = "bold 8px sans-serif"; g.fillStyle = PAL.fighters.outline; g.fillText(`⚔️ ${gv}/${view.gaugeMax}`, 1, 1);
      g.fillStyle = full ? "#FFD45A" : blink ? PAL.fx.impact.core : gv > 0 ? PAL.fx.impact.spark : PAL.hud.muted; g.fillText(`⚔️ ${gv}/${view.gaugeMax}`, 0, 0);
      g.restore();
    }
    // 拼刀：雙方頭上五個劍格（自己看得到填了什麼，對手只看到格數；對砍時全公開）＋ ⚡ 先手
    if (view.clash && !view.clash.result) {                              // 勝負宣布後讓位給大招字幕
      const C = view.clash, N = C.n ?? CONFIG.CLASH_SEQUENCE_LENGTH, w = 12, gap = 2, span = N * w + (N - 1) * gap;
      const [p0, p1] = view.fighters.map(f => cellX(f.pos)), mid = (p0 + p1) / 2, half = Math.max(Math.abs(p1 - p0) / 2, span / 2 + 6);
      for (const f of view.fighters) {
        if (f.out) continue;
        const ax = mid + (cellX(f.pos) >= cellX(view.fighters[1 - f.i].pos) ? 1 : -1) * half;   // 固定在兩人原本的格子上方，太近就往外撐開（不會疊在一起）
        const [sx, sy] = toScreen(clamp(ax, span / 2 + 4, CONFIG.W - span / 2 - 4), CONFIG.floorY - 74), x0 = sx - span / 2;
        for (let k = 0; k < N; k++) {
          const x = x0 + k * (w + gap), g0 = C.seq[f.i]?.[k], filled = k < C.count[f.i], cur = view.phase === PH.CLASH_ANIM && C.cut === k + 1;
          g.fillStyle = cur ? "rgba(255,245,216,.95)" : "rgba(16,24,39,.9)"; g.fillRect(x, sy - w, w, w);
          g.strokeStyle = filled ? PAL.hud.powerFill : PAL.hud.muted; g.lineWidth = 1; g.strokeRect(x + 0.5, sy - w + 0.5, w - 1, w - 1);
          g.textAlign = "center"; g.font = "9px sans-serif";
          if (g0) g.fillText(GICON[g0], x + w / 2, sy - 3);
          else if (filled) { g.fillStyle = PAL.hud.powerFill; g.fillRect(x + 4, sy - w + 4, w - 8, w - 8); }
          else { g.fillStyle = PAL.hud.muted; g.fillText("_", x + w / 2, sy - 3); }
          if (view.phase === PH.CLASH_ANIM && k < C.cut) { const r = C.cuts[k]; g.font = "bold 7px sans-serif"; g.fillStyle = r < 0 ? PAL.hud.muted : r === f.i ? PAL.hud.powerFill : PAL.fx.red.rim; g.fillText(r < 0 ? "平" : r === f.i ? "勝" : "敗", x + w / 2, sy + 8); }
        }
        if (C.first === f.i) { const pp = this.firstAt ? Math.max(0, 1 - (now - this.firstAt) * 5) : 0; g.font = `900 ${Math.round(9 + pp * 6)}px sans-serif`; g.textAlign = "center"; g.fillStyle = PAL.fighters.outline; g.fillText("⚡ 先手！", sx + 1, sy - w - 3); g.fillStyle = PAL.hud.powerFill; g.fillText("⚡ 先手！", sx, sy - w - 4); }
      }
      if (view.phase === PH.CLASH_ANIM) { g.textAlign = "center"; g.font = "bold 11px sans-serif"; g.fillStyle = PAL.hud.label; g.fillText(`${C.score[0]} : ${C.score[1]}`, CONFIG.W / 2, 82); }
    }
    if (this.finText && (ph === PH.CLASH_ANIM || ph === PH.RESOLVE) && now - this.finText.at < 1.6) {   // 大招名／先手絕殺（電影字幕）
      const T = this.finText, age = now - T.at, pop = Math.max(0, 1 - age * 6), a = Math.min(1, (1.6 - age) * 3);
      g.save(); g.globalAlpha = a; g.translate(CONFIG.W / 2, 118); g.scale(1 + pop * 0.6, 1 + pop * 0.6);
      g.textAlign = "center"; g.font = "900 22px sans-serif"; g.fillStyle = PAL.fighters.outline; g.fillText(T.text, 2, 2); g.fillStyle = T.color; g.fillText(T.text, 0, 0);
      if (T.sub) { g.font = "bold 10px sans-serif"; g.fillStyle = PAL.hud.label; g.fillText(T.sub, 0, 15); }
      g.restore();
    } else if (this.cutText && now - this.cutText.at < this.cutText.life && !(this.hud2() && this.comicLive(now))) {     // 第1刀 勝／敗／平（大字，放在劍格上方）；漫畫大字出現時讓位
      const a = 1 - (now - this.cutText.at) / this.cutText.life, pop = Math.max(0, 1 - (now - this.cutText.at) * 8);
      g.save(); g.globalAlpha = Math.min(1, a * 2); g.translate(CONFIG.W / 2, 64); g.scale(1 + pop * 0.5, 1 + pop * 0.5);
      g.textAlign = "center"; g.font = "900 20px sans-serif"; g.fillStyle = PAL.fighters.outline; g.fillText(this.cutText.text, 2, 2); g.fillStyle = this.cutText.color; g.fillText(this.cutText.text, 0, 0);
      g.restore();
    }
    // 連打 HIT COMBO 計數
    for (const p of this.fx) {
      if (p.k === "text") {
        const a = clamp(p.life / p.max, 0, 1), [sx, sy] = toScreen(p.x, p.y);
        g.globalAlpha = a; g.textAlign = "center"; g.font = `bold ${p.size}px sans-serif`;
        g.fillStyle = PAL.fighters.outline; g.fillText(p.text, sx + 1, sy + 1); g.fillStyle = p.color; g.fillText(p.text, sx, sy);
      } else if (p.k === "emote") {
        const f = view.fighters[p.seat]; if (!f || f.out) continue;
        const a = clamp(p.life / p.max * 4, 0, 1), pop = Math.max(0, 1 - (p.max - p.life) * 8), [sx, sy] = toScreen(f.x, CONFIG.floorY - 84);
        const big = p.text.length <= 2 && !/^[A-Z]+$/.test(p.text);
        g.save(); g.globalAlpha = a; g.translate(Math.round(sx), Math.round(sy - pop * 4)); g.scale(1 + pop * 0.3, 1 + pop * 0.3);
        g.font = `bold ${big ? 16 : 11}px sans-serif`; const w = Math.max(24, g.measureText(p.text).width + 10);
        g.fillStyle = "rgba(244,243,238,.95)"; g.fillRect(-w / 2, -16, w, 20); g.beginPath(); g.moveTo(-3, 4); g.lineTo(3, 4); g.lineTo(0, 8); g.fill();
        g.strokeStyle = PAL.fighters["p" + (p.seat + 1)].primary; g.lineWidth = 1.5; g.strokeRect(-w / 2, -16, w, 20);
        g.fillStyle = "#10121B"; g.textAlign = "center"; g.fillText(p.text, 0, big ? 1 : -2);
        g.restore();
      } else if (p.k === "banner") {
        if (this.callout && now - this.callout.at < this.callout.life) p.life = Math.min(p.life, 0.2);   // 中央大字出現：橫幅讓位
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
      g.fillStyle = PAL.hud.label; g.font = "bold 9px sans-serif"; g.fillText(this.touch ? "點畫面再來一場｜右上角回大廳" : "空白鍵再來一場｜Esc 回大廳", CONFIG.W / 2, 142);
    }
  }
}
