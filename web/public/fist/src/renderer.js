// renderer.js — 畫面（只吃 engine.viewFor() 的資料和事件，不改遊戲狀態）
//   · 480×270 邏輯畫布、關閉平滑、整數倍率放大；中文字另外用高解析度畫（才清楚）
//   · 繪製順序（美術聖經 §5）：背景 → 平台 → 紅區填色與斜紋 → 殘影 → 角色 → 命中粒子與 KO → 紅格邊線、藍框、方向箭頭 → HUD
//   · 頓幀只停「演出」：凍結世界層畫面幾十毫秒，HUD 倒數照走（引擎本身不停）
//   · 底部鍵位卡改由 keybar.js（DOM）負責；畫布只畫世界、提示與上方 HUD
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
  const sheets = [null, null], wsheets = [null, null];
  // 正式圖檔依 imageByPlayer 檔名接入（放在 public/fist/ 下）：基礎圖集 500×800、武器圖集 500×500；沒有就用程式繪製
  const load = (file, w, h, put) => {
    if (typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => { if (img.naturalWidth === w && img.naturalHeight === h) put(img); };
    img.onerror = () => {};
    img.src = new URL(`../${file}`, import.meta.url).href;
  };
  ["p1", "p2"].forEach((p, i) => {
    load(A.imageByPlayer[p], A.imageWidth, A.imageHeight, img => { sheets[i] = img; });
    load(WA.imageByPlayer[p], WA.imageWidth, WA.imageHeight, img => { wsheets[i] = img; });
  });
  const ATTACK_STATES = new Set(["clash", "mash_hit", "finisher_blue", "finisher_red"]);
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
    knockback(f) { const b = body(f.i, { spread: 5, dx: -3, eyes: "x", mouth: true }); P(14 + b.dx, 18 + b.dy, 6, 3, "P"); P(28 + b.dx, 16 + b.dy, 6, 3, "P"); },
  };
  function colorsFor(f, mode) {
    const p = F["p" + (f.i + 1)];
    if (mode === "hidden") return { P: F.hiddenFill, S: F.hiddenFill, W: p.secondary, H: F.hiddenFill, K: F.hiddenFill, M: F.hiddenFill, B: F.hiddenFill, C: F.hiddenFill, D: F.hiddenFill, T: F.hiddenFill, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
    if (mode === "white") { const w = PAL.fx.impact.core; return { P: w, S: w, W: w, H: w, K: w, M: w, B: w, C: w, D: w, T: w, O: w, R: w, fx: w }; }
    return { P: p.primary, S: p.shadow, W: p.secondary, H: p.highlight, K: CONFIG.skin, M: F.neutralSteel, B: PAL.platform.oxidizedBronze, C: CONFIG.cloth.fill, D: CONFIG.cloth.shade, T: CONFIG.cloth.tie, O: F.outline, R: PAL.fx.red.rim, fx: "#9CD8FF" };
  }
  return {
    frameOf, sheets, wsheets,
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
        let img = sh, row = an.row, col = n;
        // 大剪刀／大布袋的攻擊動作：讀武器圖集；變體圖還沒好 → 先停在對應武器的架式（不會突然變成槌子）
        const gest = ATTACK_STATES.has(state) ? f.stance : null;
        if (gest === "scissors" || gest === "paper") {
          const key = state === "mash_hit" ? (f.anim.alt ? "combo_2" : "combo_1") : state, v = WA.variantsByGesture[gest]?.[key];
          if (v && wsheets[f.i]) { img = wsheets[f.i]; row = v.row; }
          else { row = A.animations[ART.weapons.byGesture[gest].stanceState].row; col = 0; }
        }
        g.translate(OX, OY); if (face < 0) g.scale(-1, 1);
        g.drawImage(img, A.originX + A.strideX * col, A.originY + A.strideY * row, A.frameWidth, A.frameHeight, -A.pivot.x, -A.pivot.y, A.frameWidth, A.frameHeight);
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
    this.showHints = true;                                // 出招提示：頭頂拳種氣泡、藏招 ❓（main.js 依設定切換）
    this.dmgFx = [0, 1].map(() => ({ prev: 0, hitAt: 0, smokeAt: 0, sparkAt: 0, parts: [], band: null }));
    this.resize();
  }
  static get ANIM_STATES() { return ANIM_STATES; }
  useSheet(seat, img) { Fighter.sheets[seat] = img; }      // 手動接 Sprite Sheet（500×800，切格表照 ART.spriteAtlas）
  hasSheet(seat) { return !!Fighter.sheets[seat]; }
  setNames(n) { this.names = n; }
  keyPress(btn) { this.keyFlash[btn] = 0.12; }
  reset() { this.fx = []; this.trails = [[], []]; this.combo = null; this.freezeUntil = 0; this.frozen = null; this.dmgFx = [0, 1].map(() => ({ prev: 0, hitAt: 0, smokeAt: 0, sparkAt: 0, parts: [], band: null })); }
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
          this.popup(e.x, CONFIG.floorY - 58 - (e.kind === "extra" ? e.n * 3 : 0), `+${+e.damage.toFixed(1)}%`, PAL.fx.impact.core, e.kind === "extra" ? 8 : 10);
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
    this.drawStanceBubbles(view, now);
    this.drawTelegraphs(view, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHudPixels(view, now, dt);
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
      if (r.gesture) drawGestureGlyph(ctx, GESTURE_GLYPH[r.gesture], x + 5, y + 5, C.core, C.rim);   // 頭頂只顯示攻擊手勢，不顯示克制答案
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
  // 架式氣泡（showHints）：亮招期顯示各自已擺的拳種、藏招期雙方都變 ❓；位置固定在腳底上 55px，靠太近時 P2 往上錯開
  drawStanceBubbles(view, now) {
    if (!this.showHints || view.phase !== PH.RPS) return;
    const hidden = view.t >= CONFIG.rps.reveal, [W] = SB.sizePx, O = SB.onFighterOverlap;
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
      const [pw, ph] = H.powerSizePx;
      for (let i = 0; i < H.powerCount; i++) {
        const px = right ? ax - pw - i * (pw + gap) : ax + i * (pw + gap), py = ay + 40;
        if (i < f.power) { ctx.fillStyle = PAL.fighters.outline; ctx.fillRect(px - 1, py - 1, pw + 2, ph + 2); ctx.fillStyle = PAL.hud.powerFill; ctx.fillRect(px, py, pw, ph); }
        else { ctx.fillStyle = PAL.hud.powerEmpty; ctx.fillRect(px, py, pw, 1); ctx.fillRect(px, py + ph - 1, pw, 1); ctx.fillRect(px, py, 1, ph); ctx.fillRect(px + pw - 1, py, 1, ph); }
      }
    }
    this.drawPhaseBar(view, now);
  }
  digitsWidth(text) { return [...text].reduce((s, ch) => s + (DIGIT[ch]?.[0].length ?? 4) * 4 + 3, 0) - 3; }
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
      if (f.stun > 0) { g.fillStyle = "#9CD8FF"; g.fillText(`硬直 ${f.stun.toFixed(1)}s`, right ? 464 : 16, 91); }
    }
    g.textAlign = "center";
    const fin = ph === PH.WINDOW, left = Math.max(0, view.dur - view.t);
    let label = PH_LABEL[ph] ?? "";
    const deathmatch = view.fighters.some(f => this.shownDamage(f) >= PAL.damageBands[PAL.damageBands.length - 1].minInclusive);
    if (ph === PH.RPS) label = (deathmatch ? CONFIG.deathmatchTitle : label) + (view.t >= CONFIG.rps.reveal ? "・藏招" : "・亮招");
    if (fin && r?.type) label = r.type === "red" ? "翻滾！紅招不可彈反" : "彈反！按克制手勢";
    if (ph === PH.SELECT && r) label = "終結擇：短按選手勢｜長按贏拳鍵＝紅光";
    g.font = `bold ${fin || (deathmatch && ph === PH.RPS) ? 12 : 10}px sans-serif`;
    g.fillStyle = fin ? (r?.type === "red" ? PAL.fx.red.rim : PAL.fx.blue.rim) : deathmatch && ph === PH.RPS ? PAL.fx.red.rim : PAL.hud.label;
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
      g.fillStyle = PAL.hud.label; g.font = "bold 9px sans-serif"; g.fillText(this.touch ? "點畫面再來一場｜右上角回大廳" : "空白鍵再來一場｜Esc 回大廳", CONFIG.W / 2, 142);
    }
  }
}
