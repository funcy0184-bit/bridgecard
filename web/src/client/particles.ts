// ParticleEffects：金粉、星芒、紙屑、小花色、印章墨跡。
// 一張全螢幕 canvas，只有在有粒子時才跑動畫迴圈；粒子總數有上限，低階手機自動減半。
import { amp, lowEnd, settings } from "./fx";

export type Kind = "dust" | "star" | "paper" | "suit" | "ink";
interface P {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  life: number; max: number; size: number; rot: number; vr: number;
  kind: Kind; color: string; glyph: string;
}

const GOLD = ["#F3D488", "#E2B860", "#C99A4B", "#FFF1C9"];
const PAPER = ["#F1E3C4", "#E6D2A8", "#8A2D3A", "#2F4A3B", "#D9C49A"];
const SUITS = ["♠", "♥", "♦", "♣"];
const MAX = 240;

let canvas: HTMLCanvasElement | null = null;
let c2d: CanvasRenderingContext2D | null = null;
let ps: P[] = [];
let raf = 0, lastT = 0, dpr = 1;

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "particles";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  c2d = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}

export interface BurstOpt {
  count?: number; kinds?: Kind[]; colors?: string[];
  speed?: number; spread?: number; angle?: number; gravity?: number; life?: number; size?: number;
}

export const enabled = () => settings.particles && settings.intensity > 0;

// 從 (x, y) 噴出一團粒子；angle/spread 用弧度（預設往四面八方）
export function burst(x: number, y: number, o: BurstOpt = {}) {
  if (!enabled()) return;
  ensure();
  const n = Math.round((o.count ?? 18) * Math.min(1.4, amp()) * (lowEnd ? 0.5 : 1));
  const kinds = o.kinds ?? ["dust", "star"];
  for (let i = 0; i < n && ps.length < MAX; i++) {
    const kind = kinds[i % kinds.length];
    const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
    const sp = (o.speed ?? 260) * (0.35 + Math.random() * 0.75);
    const colors = o.colors ?? (kind === "paper" ? PAPER : kind === "ink" ? ["#5A1720", "#7A2732"] : GOLD);
    const life = (o.life ?? 0.9) * (0.6 + Math.random() * 0.6);
    ps.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      g: o.gravity ?? (kind === "paper" ? 420 : kind === "dust" ? 120 : 240),
      drag: kind === "dust" ? 2.2 : kind === "paper" ? 1.4 : 1.8,
      life, max: life,
      size: (o.size ?? 1) * (kind === "dust" ? 1.6 + Math.random() * 2.2 : kind === "star" ? 4 + Math.random() * 5 : kind === "paper" ? 4 + Math.random() * 5 : kind === "suit" ? 10 + Math.random() * 6 : 3 + Math.random() * 5),
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 10,
      kind, color: colors[Math.floor(Math.random() * colors.length)],
      glyph: SUITS[Math.floor(Math.random() * 4)],
    });
  }
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(loop); }
}

// 從元素中心噴
export function burstAt(el: Element, o: BurstOpt = {}) {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, o);
}

// 勝利：紙屑和金粉從上面灑下來
export function shower(count = 70) {
  if (!enabled()) return;
  for (let i = 0; i < 6; i++) {
    burst(innerWidth * (0.1 + 0.16 * i), -10, { count: count / 6, kinds: ["paper", "dust", "star", "suit"], angle: Math.PI / 2, spread: 0.9, speed: 160, gravity: 260, life: 2.2 });
  }
}

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 === 0 ? r : r * 0.28;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function loop(t: number) {
  const ctx = c2d!;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ps = ps.filter(p => (p.life -= dt) > 0);
  for (const p of ps) {
    p.vx -= p.vx * p.drag * dt;
    p.vy -= p.vy * p.drag * dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const k = p.life / p.max;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    switch (p.kind) {
      case "dust":
        ctx.shadowColor = p.color; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
        break;
      case "star":
        ctx.shadowColor = "#F3D488"; ctx.shadowBlur = 8;
        star(ctx, p.size * (0.7 + 0.3 * Math.sin(t / 60 + p.size)));
        break;
      case "paper":
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) + 0.15);
        ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        break;
      case "suit":
        ctx.fillStyle = p.glyph === "♥" || p.glyph === "♦" ? "#9C2F3C" : "#2B2118";
        ctx.font = `${p.size}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.glyph, 0, 0);
        break;
      case "ink":
        ctx.globalAlpha *= 0.85;
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.size * 0.9, p.size * 0.3, p.size * 0.45, 0, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (ps.length) raf = requestAnimationFrame(loop);
  else { raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
