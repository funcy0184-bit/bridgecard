// tutorial.js — 四關互動式教學（跑的是真的 engine，不是動畫影片）
//   · 每關：setup（站位、損傷、力量、從哪個階段開始）＋ 腳本電腦 ＋ flow（引擎換階段前的掛鉤：重來、換段、停住）＋ 一串目標
//   · 畫面頂部只放一行目標；失敗就原地重來，不用看長篇說明
//   · 用法：const tut = new Tutorial({ onTransport, onObjective, onDone }); tut.start();
import { CONFIG } from "./config.js";
import { PH } from "./engine.js";
import { LocalTransport } from "./transport.js";
import { ScriptBot } from "./ai.js";

const S = (p0, p1, extra = {}) => ({ p: [p0, p1], stocks: 9, ...extra });

export const LESSONS = [
  {
    name: "關卡 1：走位與硬直",
    setup: S({ pos: 3, power: 3 }, { pos: 6, power: 3 }, { phase: PH.MOVE }),
    script: {},
    // 這關只練走位：走位結束不進猜拳，直接再來一輪走位（力量補滿）
    flow(from, to, e) { if (from === PH.MOVE) { e.f[0].power = 3; e.f[1].power = 3; return { phase: PH.MOVE }; } },
    goals: [
      { text: "按 A 或 D 走一步（每步扣 1 氣）", done: e => e.type === "step" && e.p === 0 && !e.bump },
      { text: "同一輪連走 2 步：第 2 步落地會喘氣硬直", done: e => e.type === "stun" && e.p === 0 },
      { text: "硬直中按鍵鎖死、不能換招 —— 等它喘完", done: e => e.type === "stun_end" && e.p === 0 },
    ],
  },
  {
    name: "關卡 2：前搖讀心",
    setup: S({ pos: 3, power: 2 }, { pos: 5, power: 2 }, { phase: PH.RPS }),
    script: { [PH.RPS]: [{ at: 0.2, btn: "L" }] },                     // AI 固定亮石頭
    flow(from, to, e) { if (from === PH.RPS) return e.lastRps?.winner === 0 ? { phase: PH.IDLE } : { phase: PH.RPS }; },
    goals: [
      { text: "對手亮出『石頭』架式 —— 在黑影藏招前按 D 出『布』", done: e => e.type === "rps_result" && e.winner === 0, retry: e => e.type === "rps_result" && e.winner !== 0 && "布才剋石頭！再來一次" },
    ],
  },
  {
    name: "關卡 3：連打與藍光彈反",
    setup: S({ pos: 3, power: 2 }, { pos: 4, power: 2 }, { phase: PH.MASH, round: { att: 0, winGesture: "paper" } }),
    setupB: S({ pos: 3, power: 2, damage: 30 }, { pos: 4, power: 2 }, { phase: PH.WINDOW, round: { att: 1, gesture: "scissors" } }),
    script: {},
    flow(from, to, e, L) {
      if (from === PH.MASH) return e.round.extra >= CONFIG.mash.maxExtra ? { reset: L.setupB } : { reset: L.setup };
      if (from === PH.RESOLVE) return e.round?.result === "parry" ? { phase: PH.IDLE } : { reset: L.setupB };
    },
    goals: [
      { text: "猜拳贏了！狂按 A／S／D 打滿 4 次追加連擊", done: e => e.type === "mash_end" && e.extra >= CONFIG.mash.maxExtra, retry: e => e.type === "mash_end" && e.extra < CONFIG.mash.maxExtra && `只追加 ${e.extra} 拳，再快一點！` },
      { text: "換你防守：AI 藍光出『剪刀』—— 按 A（石頭）彈反！", done: e => e.type === "parry" && e.p === 0, retry: e => (e.type === "wrong" || e.type === "timeout") && e.p === 0 && "石頭剋剪刀：按 A，慢動作裡只有一次機會" },
      { text: "完美彈反！雙方換位、你反打一記重拳", wait: 1.4 },
    ],
  },
  {
    name: "關卡 4：崖邊零氣閃紅招",
    setup: S({ pos: 7, power: 0, damage: 110 }, { pos: 6, power: 2 }, { phase: PH.WINDOW, round: { att: 1, red: true } }),
    script: {},
    flow(from, to, e, L) { if (from === PH.RESOLVE) return e.round?.result === "roll" ? { phase: PH.IDLE } : { reset: L.setup }; },
    goals: [
      { text: "紅招不能彈反！看腳下箭頭：按 A（◀）翻滾回台內", done: e => e.type === "roll" && e.p === 0, retry: e => (e.type === "wrong" || e.type === "timeout" || e.type === "ko") && e.p === 0 && "看腳下亮的方向！0 氣也能翻滾" },
      { text: "逃生成功！翻滾能穿過對手", wait: 1.4 },
    ],
  },
];

export class Tutorial {
  constructor({ onTransport, onObjective, onDone } = {}) {
    this.onTransport = onTransport ?? (() => {}); this.onObjective = onObjective ?? (() => {}); this.onDone = onDone ?? (() => {});
    this.lesson = -1; this.goal = 0; this.waitLeft = 0; this.say = null; this.transport = null; this.finished = false;
  }
  start(i = 0) { this.load(i); }
  load(i) {
    this.transport?.close();
    if (i >= LESSONS.length) { this.finished = true; this.transport = null; this.onDone(); return; }
    const L = LESSONS[i];
    this.lesson = i; this.goal = 0; this.waitLeft = 0; this.say = null;
    this.transport = new LocalTransport({ setup: L.setup, viewer: 0, bots: [new ScriptBot(1, L.script)], flow: (from, to, e) => L.flow?.(from, to, e, L) });
    this.transport.onStateUpdate(msg => this.watch(msg));
    this.onTransport(this.transport, L);
    this.emitObjective();
  }
  skip() { this.transport?.close(); this.transport = null; this.finished = true; this.onDone(true); }
  get current() { return LESSONS[this.lesson]; }
  emitObjective() {
    const L = this.current, g = L?.goals[this.goal];
    if (!g) return;
    this.onObjective({ lesson: this.lesson, total: LESSONS.length, name: L.name, text: this.say ?? g.text, retry: !!this.say, step: this.goal, steps: L.goals.length });
  }
  // 看事件判斷目標達成／要重來
  watch({ events }) {
    const L = this.current, g = L?.goals[this.goal];
    if (!g) return;
    for (const e of events) {
      if (g.done?.(e)) { this.advance(); return; }
      const msg = g.retry?.(e);
      if (msg) { this.say = msg; this.sayUntil = performance.now() + 1800; this.emitObjective(); }
    }
    if (this.say && performance.now() > this.sayUntil) { this.say = null; this.emitObjective(); }
  }
  advance() {
    const L = this.current;
    this.goal++; this.say = null;
    if (this.goal >= L.goals.length) { this.load(this.lesson + 1); return; }
    const g = L.goals[this.goal];
    if (g.wait) this.waitLeft = g.wait;
    this.emitObjective();
  }
  update(dt) {
    this.transport?.update(dt);
    if (this.waitLeft > 0) { this.waitLeft -= dt; if (this.waitLeft <= 0) this.advance(); }
  }
}
