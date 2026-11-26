// procfx.js — 程式繪製的特效、動作姿勢與木樁（缺 PNG 時的即時演出）
//   · PNG 放進 public/fist/ 並打開 CONFIG.ART_PACKS 對應開關 → renderer 自動改用美術圖，這裡就不會被呼叫
//   · 全部以「腳底錨點／貼齊點」為原點、面右繪製；dir＝-1 時水平翻轉
//   · 只畫整數像素的方塊，維持像素風（不開抗鋸齒）

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = k => 1 - (1 - k) * (1 - k);
// 可重現的小亂數（同一個特效每幀長一樣，不會閃爍）
const hash = (n, s = 0) => { const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const px = (g, x, y, w, h, c, a = 1) => { g.globalAlpha = clamp(a, 0, 1); g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
// 粗線段（像素點連成）
function seg(g, x0, y0, x1, y1, c, t = 1, a = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) px(g, x0 + (x1 - x0) * i / n - t / 2, y0 + (y1 - y0) * i / n - t / 2, t, t, c, a);
}
// 圓環（像素點）
function ring(g, x, y, r, c, t = 1, a = 1, sy = 1) {
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i++) { const q = i / n * TAU; px(g, x + Math.cos(q) * r - t / 2, y + Math.sin(q) * r * sy - t / 2, t, t, c, a); }
}
// 扇形弧（a0→a1，半徑 r0→r1 之間填滿）
function fan(g, x, y, r0, r1, a0, a1, c, a = 1, dir = 1) {
  const n = Math.max(8, Math.round((a1 - a0) * r1 * 1.6));
  for (let i = 0; i <= n; i++) {
    const q = a0 + (a1 - a0) * i / n;
    for (let r = r0; r <= r1; r += 1.5) px(g, x + Math.cos(q) * r * dir, y + Math.sin(q) * r, 2, 2, c, a);
  }
}

// ---------------- 10 組特效（key 跟 CONFIG.vfx 同名；dur＝秒；loop 的由呼叫端一直畫） ----------------
//   draw(g, x, y, dir, k, age, seed)：k＝0→1 進度（loop 的 k 用 age 自己算）
export const PROC_VFX = {
  // 1. 連勝氣場（後層、循環）：攻方背後往上竄的火焰
  vfx_streak_aura: {
    dur: 0.6, loop: true,
    draw(g, x, y, dir, k, age) {
      const pulse = 0.5 + Math.sin(age * 10) * 0.15;
      for (let r = 0; r < 3; r++) px(g, x - 14 + r * 2, y - 44 + r * 3, 28 - r * 4, 44 - r * 3, r === 2 ? "#FFB15A" : "#FF5A2A", pulse * (0.10 + r * 0.06));   // 背後光暈
      for (let i = 0; i < 26; i++) {
        const life = (age * 1.7 + hash(i, 1)) % 1, side = i % 2 ? 1 : -1, ox = side * (5 + hash(i, 2) * 11) + Math.sin(age * 7 + i) * 2;
        const w = 5 - life * 3, h = (7 + hash(i, 3) * 6) * (1 - life * 0.4), yy = y - 4 - life * 50;
        const col = life < 0.3 ? "#FFF1A8" : life < 0.6 ? "#FF9A2A" : "#D8283A";
        px(g, x + ox - dir * life * 6 - w / 2, yy - h, w, h, col, (1 - life) * 0.9);
      }
      px(g, x - 16, y - 2, 32, 3, "#FF6A3D", pulse);
    },
  },
  // 2. 衝刺／受擊滑行揚塵（後層）：往移動反方向拖出的煙
  vfx_dust_dash: {
    dur: 0.32,
    draw(g, x, y, dir, k, age, s) {
      for (let i = 0; i < 6; i++) {
        const o = i * 5 + easeOut(k) * 10, r = 2 + i * 0.6 + k * 4;
        px(g, x - dir * o - r, y - r * 1.2 - hash(i, s) * 3, r * 2, r * 1.4, i % 2 ? "#C9C2B2" : "#9E978A", (1 - k) * (0.75 - i * 0.08));
      }
    },
  },
  // 3. 落地氣浪（後層）：往左右噴散
  vfx_dust_land: {
    dur: 0.34,
    draw(g, x, y, dir, k) {
      for (const d of [-1, 1]) for (let i = 0; i < 4; i++) {
        const o = 4 + easeOut(k) * (14 + i * 6), r = 2.5 + k * 3 - i * 0.3;
        px(g, x + d * o - r, y - r - i * 0.8, r * 2, r * 1.3, i % 2 ? "#D8D0BE" : "#A79F90", (1 - k) * 0.8);
      }
      px(g, x - 10 - k * 8, y - 1, 20 + k * 16, 1, "#FFFFFF", (1 - k) * 0.6);
    },
  },
  // 4. 輕擊星芒（前層）：白黃銳利十字＋斜刺
  vfx_hit_light: {
    dur: 0.2,
    draw(g, x, y, dir, k, age, s) {
      const L = 4 + Math.sin(Math.PI * k) * 12, rot = hash(1, s) * 0.6;
      for (let i = 0; i < 4; i++) { const q = rot + i * Math.PI / 2; seg(g, x, y, x + Math.cos(q) * L, y + Math.sin(q) * L, i % 2 ? "#FFF6C8" : "#FFFFFF", 2, 1 - k * 0.6); }
      for (let i = 0; i < 4; i++) { const q = rot + Math.PI / 4 + i * Math.PI / 2; seg(g, x, y, x + Math.cos(q) * L * 0.55, y + Math.sin(q) * L * 0.55, "#FFD45A", 1, 1 - k); }
      px(g, x - 2, y - 2, 4, 4, "#FFFFFF", 1 - k);
    },
  },
  // 5. 重擊衝擊環（前層）：多層橘紅環＋放射光刺
  vfx_hit_heavy: {
    dur: 0.3,
    draw(g, x, y, dir, k, age, s) {
      ring(g, x, y, 4 + easeOut(k) * 22, "#FFB15A", 2, 1 - k);
      ring(g, x, y, 2 + easeOut(clamp(k * 1.4, 0, 1)) * 14, "#FF5A2A", 2, 1 - k);
      if (k < 0.5) ring(g, x, y, 3 + k * 10, "#FFFFFF", 1, 1 - k * 2);
      for (let i = 0; i < 8; i++) {
        const q = i / 8 * TAU + hash(i, s) * 0.3, r0 = 6 + k * 14, r1 = r0 + 8 * (1 - k) + 2;
        seg(g, x + Math.cos(q) * r0, y + Math.sin(q) * r0, x + Math.cos(q) * r1, y + Math.sin(q) * r1, i % 2 ? "#FFE58A" : "#FF8A2A", 2, 1 - k);
      }
    },
  },
  // 6. 反擊十字閃（前層）：青金雙色十字大閃光＋擴散震波
  vfx_counter_flash: {
    dur: 0.32,
    draw(g, x, y, dir, k) {
      const w = (1 - k) * 3 + 1, L = 10 + easeOut(k) * 50;
      px(g, x - L, y - w / 2, L * 2, w, "#5FE6FF", 1 - k);
      px(g, x - w / 2, y - L * 0.8, w, L * 1.6, "#FFD45A", 1 - k);
      px(g, x - L * 0.6, y - 0.5, L * 1.2, 1, "#FFFFFF", 1 - k);
      ring(g, x, y, 6 + easeOut(k) * 34, "#9CF6FF", 2, (1 - k) * 0.9, 0.6);
      ring(g, x, y, 4 + easeOut(k) * 22, "#FFE58A", 1, 1 - k, 0.6);
      px(g, x - 4, y - 4, 8, 8, "#FFFFFF", 1 - k * 1.5);
    },
  },
  // 7. 過熱蒸氣（前層、循環）：灰白蒸氣往上飄＋小火星
  vfx_overheat_smoke: {
    dur: 0.6, loop: true,
    draw(g, x, y, dir, k, age) {
      for (let i = 0; i < 7; i++) {
        const life = (age * 1.6 + hash(i, 5)) % 1, r = 1.5 + life * 3.5;
        px(g, x + (hash(i, 6) - 0.5) * 6 + Math.sin(age * 4 + i) * 2 + dir * life * 3 - r, y - life * 20 - r, r * 2, r * 2, i % 2 ? "#E8E6E0" : "#B8B4AC", (1 - life) * 0.7);
      }
      for (let i = 0; i < 3; i++) { const life = (age * 2.4 + hash(i, 8)) % 1; px(g, x + (hash(i, 9) - 0.5) * 8, y - life * 14, 1, 1, "#FF9A3A", 1 - life); }
    },
  },
  // 8. 揮擊殘影（Smear Frame）：石頭厚重橘紅扇形、剪刀青藍交叉、布翠綠螺旋
  vfx_smear_rock: {
    dur: 0.18,
    draw(g, x, y, dir, k) {
      const a0 = -1.9, a1 = -1.9 + easeOut(k) * 2.4;
      fan(g, x, y, 10, 22, a0, a1, "#FF6A3D", (1 - k) * 0.85, dir);
      fan(g, x, y, 18, 24, a0, a1, "#FFD45A", (1 - k) * 0.7, dir);
    },
  },
  vfx_smear_scissors: {
    dur: 0.16,
    draw(g, x, y, dir, k) {
      const L = 8 + easeOut(k) * 16, a = 1 - k;
      seg(g, x - dir * L, y - L * 0.7, x + dir * L, y + L * 0.7, "#5FE6FF", 2, a);
      seg(g, x - dir * L, y + L * 0.7, x + dir * L, y - L * 0.7, "#5FE6FF", 2, a);
      seg(g, x - dir * L * 0.8, y - L * 0.55, x + dir * L * 0.8, y + L * 0.55, "#FFFFFF", 1, a);
      seg(g, x - dir * L * 0.8, y + L * 0.55, x + dir * L * 0.8, y - L * 0.55, "#FFFFFF", 1, a);
    },
  },
  vfx_smear_paper: {
    dur: 0.22,
    draw(g, x, y, dir, k) {
      for (let j = 0; j < 3; j++) {
        const r = 5 + j * 5 + easeOut(k) * 8, a0 = k * 6 + j * 2.1;
        for (let i = 0; i < 10; i++) { const q = a0 + i * 0.35; px(g, x + dir * (Math.cos(q) * r + k * 10), y + Math.sin(q) * r * 0.7, 2, 2, j === 1 ? "#C8FFD6" : "#7CF29A", (1 - k) * (1 - i / 12)); }
      }
    },
  },
};

// ---------------- 擴充動作缺圖時：用基礎圖集的動作＋位移／形變做出差異 ----------------
//   base(f)：要畫哪個基礎動作（null＝照引擎目前動作）；xf(k, t, f)：{ dx, dy, sx, sy, sk }（dx 以面向為正、sk＝前傾）
const Z = { dx: 0, dy: 0, sx: 1, sy: 1, sk: 0 };
const pose = o => ({ ...Z, ...o });
export const FALLBACK_POSE = {
  idle_tired: { base: () => "exhausted", xf: (k, t) => pose({ dy: 1, sy: 0.96 + Math.sin(t * 5) * 0.03, sk: 0.06 }) },                       // 彎腰喘息
  idle_critical: { base: () => "exhausted", xf: (k, t) => pose({ dy: 3, sy: 0.88, sk: 0.12, dx: Math.sin(t * 31) * 0.6 }) },                 // 單膝硬撐＋發抖
  cliff_teeter: { base: () => "idle", xf: (k, t) => pose({ sk: Math.sin(t * 9) * 0.24, dx: Math.sin(t * 9) * 1.5 }) },                       // 崖邊前後晃
  streak_1_hit: { base: () => "finisher_blue", xf: k => pose({ dx: Math.sin(Math.PI * k) * 9, sk: Math.sin(Math.PI * k) * 0.22 }) },         // 跨步重擊
  streak_burst: { base: () => "clash", xf: (k, t) => { const s = 1 + Math.sin(Math.PI * k) * 0.18; return pose({ sx: s, sy: s, dy: -Math.sin(Math.PI * k) * 3, dx: Math.sin(t * 60) * (1 - k) }); } },   // 爆氣
  combo4_hit1: { base: () => "mash_hit", xf: k => pose({ dx: easeOut(Math.min(1, k * 2)) * 8 * (1 - k * 0.5), sk: 0.2 * (1 - k) }) },        // 突進直拳：往前衝
  combo4_hit2: { base: () => "mash_hit", xf: k => k < 0.35 ? pose({ dy: 3, sy: 0.84, sk: -0.05 }) : pose({ dy: -Math.sin(Math.PI * (k - 0.35) / 0.65) * 9, sy: 1.14, sk: -0.12, dx: 3 }) },   // 低身上鉤：先蹲再往上
  combo4_hit3: { base: () => "mash_hit", xf: k => { const c = Math.cos(TAU * k); return pose({ sx: Math.sign(c || 1) * Math.max(0.35, Math.abs(c)), dx: 5 * Math.sin(Math.PI * k), sk: 0.1 }); } },   // 轉身橫掃：原地轉一圈
  combo4_hit4_launch: { base: () => "finisher_red", xf: k => pose({ dx: Math.sin(Math.PI * k) * 14, dy: -Math.sin(Math.PI * k) * 11, sk: 0.3 * Math.sin(Math.PI * k), sx: 1.12 }) },   // 跨步躍起轟飛
  counter_break: { base: k => (k < 0.35 ? "parry_success" : "mash_hit"), xf: k => k < 0.35 ? pose({ dx: -5 * k / 0.35, sk: -0.18 }) : pose({ dx: -5 + 14 * easeOut((k - 0.35) / 0.65), sk: 0.24 }) },   // 架開再反打
  overheat_shake: { base: () => null, xf: (k, t) => pose({ dx: Math.sin(t * 80) * 1.6 * (1 - k), sk: Math.sin(t * 50) * 0.05 }) },         // 武器過熱發抖
  air_recover: { base: () => "roll", xf: k => pose({ sx: 1 - Math.sin(Math.PI * k) * 0.15, sy: 1 + Math.sin(Math.PI * k) * 0.15, sk: 0.2 * Math.sin(Math.PI * k) }) },   // 空中受身翻轉（缺圖時用翻滾＋拉長）
};

// ---------------- 訓練場木人樁（dummy_sheet.png 缺圖時） ----------------
//   原點＝木座中心（腳底錨點）；state：dummy_idle／dummy_hit／dummy_attack／dummy_ko；t＝這個動作播了幾秒
//   white＝受擊閃白（整隻畫白）
export function drawDummy(g, x, y, face, state, t, white = false) {
  const C = white ? { wood: "#FFF", dark: "#FFF", light: "#FFF", band: "#FFF", base: "#FFF", ink: "#FFF" }
    : { wood: "#B07A3E", dark: "#7A4E22", light: "#D9A062", band: "#E03A3A", base: "#5E4A36", ink: "#2A1A0C" };
  let rot = Math.sin(t * 3) * 0.04, arm = 0, headUp = 0, spin = 0;
  if (state === "dummy_hit") rot = -face * 0.5 * Math.exp(-6 * t) * Math.cos(14 * t);          // 被打：往後仰再彈回
  else if (state === "dummy_attack") arm = Math.sin(Math.PI * clamp(t / 0.3, 0, 1));            // 木棒手往前戳
  else if (state === "dummy_ko") { spin = t * 14; headUp = Math.min(18, t * 40); rot = 0; }     // 旋轉解體：頭飛起、身體轉
  g.save(); g.globalAlpha = 1; g.imageSmoothingEnabled = false;
  g.translate(Math.round(x), Math.round(y));
  px(g, -9, -3, 18, 3, C.base); px(g, -7, -4, 14, 1, C.dark);                                   // 木座
  g.rotate(rot + (state === "dummy_ko" ? Math.sin(spin) * 0.6 : 0));
  if (face < 0) g.scale(-1, 1);
  px(g, -3, -32, 6, 29, C.wood); px(g, -3, -32, 2, 29, C.light); px(g, 2, -32, 1, 29, C.dark);  // 樁身
  for (const yy of [-26, -18, -10]) px(g, -3, yy, 6, 1, C.dark);                                 // 年輪紋
  const ax = 3 + arm * 9;                                                                         // 木棒手（前：會戳出去；後：短樁）
  px(g, 3, -24, ax, 3, C.dark); px(g, 3 + ax - 2, -25, 3, 5, C.wood);
  px(g, -8, -22, 5, 3, C.dark);
  g.translate(0, -headUp);
  px(g, -5, -42, 10, 10, C.wood); px(g, -5, -42, 3, 10, C.light); px(g, 4, -42, 1, 10, C.dark);  // 頭
  px(g, -6, -39, 12, 2, C.band); px(g, -9, -38, 3, 1, C.band); px(g, -10, -36, 2, 1, C.band);    // 紅頭帶＋飄帶
  px(g, 1, -36, 2, 1, C.ink);                                                                    // 眼睛一條線
  g.restore();
}

// 一次性特效的長度
export const procDur = key => PROC_VFX[key]?.dur ?? 0;
