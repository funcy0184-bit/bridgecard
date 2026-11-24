// tutorial.js — 四關互動式教學（跑的是真的 engine，不是動畫影片）
//   · 每關：setup（站位、損傷、連勝、過熱、從哪個階段開始）＋ 腳本電腦 ＋ flow（引擎換階段前的掛鉤：重來、換段、停住）＋ 一串目標
//   · v4 四關：前搖讀心與過熱／連勝 3 次進四套拳／逐拳反擊／五連斬拼刀
//   · 畫面頂部只放一行目標；失敗就原地重來，不用看長篇說明
//   · 用法：const tut = new Tutorial({ onTransport, onObjective, onDone }); tut.start();
import { CONFIG } from "./config.js";
import { PH } from "./engine.js";
import { LocalTransport } from "./transport.js";
import { ScriptBot } from "./ai.js";

const S = (p0, p1, extra = {}) => ({ p: [p0, p1], stocks: 9, ...extra });

export const LESSONS = [
  {
    name: "關卡 1：前搖讀心與過熱",
    setup: S({ pos: 3 }, { pos: 5 }, { phase: PH.RPS }),
    setup2: S({ pos: 3, heat: "paper" }, { pos: 5, heat: "rock" }, { phase: PH.RPS, rounds: 1 }),
    // 陪練：第一輪亮石頭；它的石頭過熱後，第二輪改亮剪刀
    script: { [PH.RPS]: v => [{ at: 0.3, btn: v.fighters[1].heat === "rock" ? "M" : "L" }] },
    // 第一輪贏了 → 雙方過熱、再猜一輪；第二輪也贏 → 過關；輸了／平手就重來那一輪
    flow(from, to, e, L) {
      if (from !== PH.REVEAL) return;
      const second = e.rounds >= 2;
      if (e.lastRps.winner !== 0) return { reset: second ? L.setup2 : L.setup };
      return second ? { phase: PH.IDLE } : { phase: PH.RPS };
    },
    goals: [
      { text: "對手亮出『✊ 石頭』架式 —— 在黑影藏招前按 D 出『🖐️ 布』剋它", done: e => e.type === "rps_result" && e.winner === 0, retry: e => e.type === "rps_result" && e.winner !== 0 && "布才剋石頭！再來一次" },
      { text: "你的『🖐️ 布』♨️ 過熱了：這輪不能再出 —— 試按 D 會被鎖住", done: e => (e.type === "deny" && e.p === 0 && e.why === "heat") || (e.type === "stance" && e.p === 0) },
      { text: "對手石頭也過熱，改亮『✌️ 剪刀』—— 用 A 出『✊ 石頭』剋它", done: e => e.type === "rps_result" && e.winner === 0, retry: e => e.type === "rps_result" && e.winner !== 0 && "石頭剋剪刀：按 A" },
      { text: "讀心成功！過熱讓每輪只剩兩招，對手禁用哪招都寫在血條旁", wait: 1.8 },
    ],
  },
  {
    name: "關卡 2：連勝 3 次進四套拳",
    // 你已經連勝 2/3；陪練亮石頭，出布拿下第 3 勝 → 連勝爆發 → 你當攻方打四套拳（陪練不反擊）
    setup: S({ pos: 2, streak: 2 }, { pos: 3 }, { phase: PH.RPS }),
    script: { [PH.RPS]: [{ at: 0.3, btn: "L" }] },
    flow(from, to, e, L) {
      if (from === PH.REVEAL && e.lastRps.winner !== 0) return { reset: L.setup };      // 沒贏：重來
      if (from === PH.RESOLVE) return { phase: PH.IDLE };
    },
    goals: [
      { text: "左上燈號是連勝：你已經 2/3！對手亮『✊ 石頭』—— 按 D 出『🖐️ 布』拿下第 3 勝", done: e => e.type === "combo_start" && e.att === 0, retry: e => e.type === "rps_result" && e.winner !== 0 && "布才剋石頭！再來一次" },
      { text: "🔥 連勝爆發！每一拳出手前，按 A／S／D 決定這拳出什麼（不按就隨機）", done: e => e.type === "combo_pick" && e.p === 0 },
      { text: "對手每一拳都能反擊，所以別讓他猜到 —— 看四拳打完，第 4 拳附帶擊飛！", done: e => e.type === "combo_end" },
      { text: "四套拳打完，連勝歸零；想再打一次就得再連贏 3 次", wait: 1.8 },
    ],
  },
  {
    name: "關卡 3：逐拳反擊",
    // 換你當守方：陪練每一拳都出剪刀；看到頭頂亮 ✌️ 就按 A（✊ 石頭）反擊
    setup: S({ pos: 3, damage: 20 }, { pos: 4, streak: 3 }, { phase: PH.COMBO_PREP, round: { att: 1, winGesture: "scissors" } }),
    script: { [PH.COMBO_PREP]: [{ at: 0.1, btn: "M" }] },
    flow(from, to, e, L) {
      if (from === PH.RESOLVE) return e.round?.result === "counter" ? { phase: PH.IDLE } : { reset: L.setup };
    },
    goals: [
      { text: `換你防守！攻方每一拳出手時頭頂會亮拳種 —— 看到『✌️ 剪刀』就在 ${CONFIG.combo.reactDur} 秒內按 A（✊ 石頭）反擊`, done: e => e.type === "counter" && e.p === 0, retry: e => (e.type === "wrong" || e.type === "timeout") && e.p === 0 && "石頭剋剪刀：按 A，每一拳只認第一下" },
      { text: "反擊成功！剩下的拳全部被打斷，你換位反打一拳", wait: 1.6 },
    ],
  },
  {
    name: "關卡 4：五連斬拼刀",
    // 蓄力直接從 ⚔️ 1/2 開始：再平手一次就觸發五連斬
    setup: S({ pos: 3 }, { pos: 5, damage: 90 }, { phase: PH.RPS, gauge: 1 }),
    setupB: S({ pos: 3 }, { pos: 5, damage: 90 }, { phase: PH.CLASH_INPUT, gauge: 2 }),
    // 陪練：亮石頭；拼刀時慢吞吞地填五下剪刀（最後一下 3.1 秒）
    script: { [PH.RPS]: [{ at: 0.3, btn: "L" }], [PH.CLASH_INPUT]: [1.5, 1.9, 2.3, 2.7, 3.1].map(at => ({ at, btn: "M" })) },
    flow(from, to, e, L) {
      if (from === PH.REVEAL && e.lastRps.winner !== -1) return { reset: L.setup };      // 沒平手：重來
      if (from === PH.CLASH_INPUT && e.cm.first !== 0) return { reset: L.setupB };       // 先手被搶：重填
      if (from === PH.RESOLVE || from === PH.CLASH) return { phase: PH.IDLE };
    },
    goals: [
      { text: "上方的 ⚔️ 1/2 是拼刀蓄力：平手累積 2 次就拼刀（平手不會斷連勝）。對手亮『✊ 石頭』—— 故意也按 A 出石頭！", done: e => e.type === "clash_start", retry: e => e.type === "rps_result" && e.winner !== -1 && "要出一樣的才會平手：按 A" },
      { text: "⚔️ 3.5 秒內連按 5 下填滿劍格（A／S／D 隨你配），搶先填完拿 ⚡ 先手！", done: e => e.type === "clash_first" && e.p === 0, retry: e => e.type === "clash_first" && e.p === 1 && "先手被搶走了！手再快一點" },
      { text: "⚡ 先手到手！看五刀由慢到快對砍 —— 就算同分也是你贏", done: e => e.type === "clash_end" },
      { text: "拼刀結算！贏最多刀的手勢決定大招動畫（✊ 崩山重砸／✌️ 居合十字斬／🖐️ 氣功轟飛），三種威力一樣：+24%、先手再 +6%", wait: 2.0 },
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
    this.transport = new LocalTransport({ setup: L.setup, viewer: 0, speedUp: false, bots: [new ScriptBot(1, L.script)], flow: (from, to, e) => L.flow?.(from, to, e, L) });
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
