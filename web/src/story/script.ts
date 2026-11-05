// 阿禾的四幕故事（教學）：每一步都是一個固定的牌局（GameSnapshot），
// 玩家出牌、叫牌直接丟進正式的規則引擎 HoneymoonGame —— 能不能出、誰贏這墩、分數多少，
// 都跟連線版／單機版同一套程式算出來，故事裡沒有另外寫一份規則。
//
// 這個檔案不碰畫面（沒有 DOM），測試可以直接跑。
import { Call, Strain, Suit, bidIndex, bidLevel, bidStrain, bidText, cardId, cardText, tricksNeeded } from "../game/cards";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { HandResult, doubledText } from "../game/scoring";

const c = cardId;
const { Clubs: CL, Diamonds: DI, Hearts: HE, Spades: SP } = Suit;

export const ME = 0, AHE = 1;
export const CONTRACT = bidIndex(2, Strain.Hearts);   // 2♥：紅心當王，要贏 8 墩

// ---------------- 固定牌局 ----------------

function snap(p: Partial<GameSnapshot>): GameSnapshot {
  return {
    hands: [[], []], takenFaceUp: [[], []], stock: [], tricksWon: [0, 0],
    phase: Phase.Draw, currentPlayer: ME, leader: ME, leadCard: -1, followCard: -1, trump: Strain.NoTrump,
    highestBid: -1, highestBidder: -1, doubled: 0, declarer: -1, auction: [], passesInRow: 0, firstSeat: AHE,
    targetScore: 100, scores: [0, 0], handsPlayed: 0, lastResult: null, matchWinner: -1,
    ...p,
  };
}

// 第三、四幕共用：2♥ 合約、你是莊家、阿禾已經先出了一張
const contractPlay = (p: Partial<GameSnapshot>) => snap({
  phase: Phase.Play, trump: Strain.Hearts,
  highestBid: CONTRACT, highestBidder: ME, declarer: ME, doubled: 0,
  auction: [{ seat: ME, call: CONTRACT }, { seat: AHE, call: Call.Pass }],
  leader: AHE, currentPlayer: ME, firstSeat: ME,
  ...p,
});

export type StepId = "grab" | "bid" | "follow" | "ruff" | "last";
export type Outcome = "win" | "lose" | "contract" | "followed" | "ruff" | "discard" | "made" | "down";

export interface Step {
  id: StepId;
  act: 0 | 1 | 2 | 3;
  kind: "play" | "bid";
  snapshot: GameSnapshot;
  outcomes: Outcome[];           // 這一步所有「都算對」的結果（例如搶牌：搶到、讓出）
}

export const STEPS: Step[] = [
  {
    // 第一幕：阿禾翻開 ♦K、出了 ♣9；你手上 ♣Q、♣4。下一張暗牌是 ♠6（輸的人摸）
    id: "grab", act: 0, kind: "play", outcomes: ["win", "lose"],
    snapshot: snap({
      phase: Phase.Draw, trump: Strain.NoTrump,
      hands: [[c(CL, 12), c(CL, 4)], [c(HE, 7)]],
      stock: [c(DI, 13), c(SP, 6), c(HE, 11), c(CL, 2)],
      leader: AHE, currentPlayer: ME, leadCard: c(CL, 9), firstSeat: AHE,
    }),
  },
  {
    // 第二幕：搶完 13 墩，各 13 張。你有六張紅心，先叫
    id: "bid", act: 1, kind: "bid", outcomes: ["contract"],
    snapshot: snap({
      phase: Phase.Bidding, trump: Strain.NoTrump, currentPlayer: ME, leader: ME, firstSeat: ME,
      hands: [
        [c(SP, 13), c(SP, 8), c(HE, 14), c(HE, 13), c(HE, 12), c(HE, 10), c(HE, 4), c(HE, 2), c(DI, 10), c(DI, 7), c(DI, 3), c(CL, 14), c(CL, 4)],
        [c(SP, 14), c(SP, 12), c(SP, 11), c(SP, 9), c(SP, 5), c(HE, 9), c(HE, 6), c(DI, 14), c(DI, 12), c(DI, 8), c(CL, 13), c(CL, 10), c(CL, 7)],
      ],
    }),
  },
  {
    // 第三幕之一：阿禾出 ♠A，你有 ♠3 和 ♥2 → 有黑桃就得跟
    id: "follow", act: 2, kind: "play", outcomes: ["followed"],
    snapshot: contractPlay({ hands: [[c(SP, 3), c(HE, 2)], [c(DI, 5)]], leadCard: c(SP, 14) }),
  },
  {
    // 第三幕之二：換一手，你有 ♥2 和 ♣3、沒有黑桃 → 王吃或墊牌都可以
    id: "ruff", act: 2, kind: "play", outcomes: ["ruff", "discard"],
    snapshot: contractPlay({ hands: [[c(HE, 2), c(CL, 3)], [c(DI, 5)]], leadCard: c(SP, 14) }),
  },
  {
    // 第四幕：尾盤，你 7 墩、阿禾 5 墩；阿禾出 ♣K，你最後一張 ♣A
    id: "last", act: 3, kind: "play", outcomes: ["made", "down"],
    snapshot: contractPlay({ hands: [[c(CL, 14)], []], leadCard: c(CL, 13), tricksWon: [7, 5] }),
  },
];

export const stepIndex = (id: StepId) => STEPS.findIndex(s => s.id === id);

// ---------------- 跑一步 ----------------

export interface Trick { lead: number; follow: number; winner: number; ruff: boolean; }

export interface StepRun {
  step: Step;
  game: HoneymoonGame;
  events: GameEvent[];        // 只收「你看得到的」事件：阿禾摸到哪張暗牌不會進來
  actions: number[];          // 被接受的動作（存進度、重新整理時重播用）
  trick: Trick | null;        // 剛打完的那一墩：結果留在桌上給你看
  done: boolean;
}

export function start(step: Step): StepRun {
  const game = HoneymoonGame.restore(step.snapshot);
  const run: StepRun = { step, game, events: [], actions: [], trick: null, done: false };
  game.on((e, to) => { if (to < 0 || to === ME) run.events.push(e); });
  return run;
}

// 第一段：你出牌／叫牌。不合法就 ok = false（出牌時引擎會發 Illegal 事件）
export function act(run: StepRun, a: number): { ok: boolean; events: GameEvent[] } {
  const before = run.events.length;
  if (run.done || run.trick) return { ok: false, events: [] };
  const g = run.game;
  let ok = false;
  if (run.step.kind === "play") {
    const lead = g.leadCard;
    ok = g.playCard(ME, a);
    if (ok) run.trick = { lead, follow: a, winner: -1, ruff: false };
  } else {
    // 故事只收 2♥（別的叫品畫面上會先解釋，但不送出）
    ok = a === CONTRACT && g.makeCall(ME, a);
  }
  if (ok) run.actions.push(a);
  return { ok, events: run.events.slice(before) };
}

// 第二段：結算這一墩（出牌）／阿禾回應（叫牌：Pass）
export function settle(run: StepRun): GameEvent[] {
  const before = run.events.length;
  if (run.done || (run.step.kind === "play" && !run.trick)) return [];
  const g = run.game;
  if (run.step.kind === "play") {
    g.resolveTrick();
    const won = run.events.slice(before).find(e => e.type === "TrickWon");
    run.trick!.winner = won ? won.seat : -1;
    run.trick!.ruff = !!won && won.extra === 1;
  } else {
    g.makeCall(AHE, Call.Pass);
  }
  run.done = true;
  return run.events.slice(before);
}

// 重新整理後：照存起來的動作重播一次，回到同一個結果
export function replay(step: Step, actions: number[]): StepRun | null {
  const run = start(step);
  for (const a of actions) {
    if (run.done) return null;
    if (!act(run, a).ok) return null;
    settle(run);
  }
  return run;
}

export function outcomeOf(run: StepRun): Outcome | null {
  if (!run.done) return null;
  const g = run.game, t = run.trick;
  switch (run.step.id) {
    case "grab": return t!.winner === ME ? "win" : "lose";
    case "bid": return g.declarer === ME ? "contract" : null;
    case "follow": return "followed";
    case "ruff": return t!.ruff ? "ruff" : "discard";
    case "last": return g.lastResult?.made ? "made" : "down";
  }
}

// 「2♥、未加倍、剛好達成，本局 +20 分」—— 數字全部來自計分程式
export function resultLine(r: HandResult): string {
  const how = r.made ? (r.overtricks > 0 ? `超 ${r.overtricks} 墩` : "剛好達成") : `倒 ${r.undertricks} 墩`;
  const who = r.made ? "本局" : "對手";
  return `${bidText(r.bidIndex)}、${r.doubled > 0 ? doubledText(r.doubled) : "未加倍"}、${how}，${who} +${r.points} 分`;
}

const SUIT_NAME = ["梅花", "方塊", "紅心", "黑桃"];

// 叫品送出前的白話：「我選紅心當王牌，承諾至少贏 8 墩（6＋2）」
export function bidMeaning(i: number): string {
  const s = bidStrain(i), lv = bidLevel(i);
  const trump = s === Strain.NoTrump ? "我不設王牌（無王）" : `我選${SUIT_NAME[s]}當王牌`;
  return `${trump}，承諾至少贏 ${tricksNeeded(i)} 墩（6＋${lv}）`;
}

// ---------------- 四幕 ----------------

export const ACTS = [
  { no: "第一幕", title: "雨停前，先搶一張牌", sub: "搶牌 · 什麼是一墩", symbol: "♦" },
  { no: "第二幕", title: "阿禾問，你敢拿幾墩？", sub: "叫牌 · 合約與莊家", symbol: "♥" },
  { no: "第三幕", title: "那張小紅心，該現在用嗎？", sub: "跟牌 · 王吃", symbol: "♠" },
  { no: "第四幕", title: "最後一墩，你來收桌", sub: "打成 · 計分", symbol: "♣" },
] as const;

export const firstStepOfAct = (act: number) => STEPS.findIndex(s => s.act === act);

// ---------------- 台詞 ----------------
// 先讓你出牌，再用阿禾的一句話＋牌桌上的變化說明結果

export interface Lines {
  place: string;
  table: string;
  skip?: string;                 // 時間跳轉／換一手的提示
  setting: string;
  ask: string;                   // 出牌前：阿禾的問題（每個畫面只問一件事）
  hint: string;                  // 出牌前：一行操作提示
  illegal?: string;              // 出了不能出的牌
  nudge?: string;                // 叫牌：點了 2♥ 以外的叫品
  reply: (o: Outcome) => string;                 // 出牌後：阿禾的一句話
  more?: (o: Outcome) => string;                 // 出牌後：阿禾補一句
  explain: (run: StepRun, o: Outcome) => string; // 出牌後：牌桌上發生了什麼
  tried?: (seen: Outcome[]) => string;           // 兩種都合法時：提醒換一張試試
  next?: string;
  retry: string;
}

const ct = cardText;

export const LINES: Record<StepId, Lines> = {
  grab: {
    place: "台南 · 下雨的騎樓",
    table: "搶牌 · 這一墩沒有王牌",
    setting: "雨落在台南的騎樓。你走進巷口的小牌店躲雨，店主阿禾把茶杯往旁邊挪，空出一個位子。他從牌堆翻開 ♦K，又從自己手裡出了 ♣9。",
    ask: "「這張方塊 K，贏的人帶走。我出了梅花 9。你想花哪張牌來搶？」",
    hint: "點你手上的一張牌，放上桌。",
    reply: () => "「我們各出一張、比出一次輸贏，這就叫一墩。」",
    more: () => "「剛才這墩決定誰拿哪張牌。出一張、補一張，手上張數一樣。」",
    explain: (run, o) => {
      const t = run.trick!;
      const up = run.events.find(e => e.type === "FaceUpTaken")!;
      const drew = run.events.find(e => e.type === "CardDrawn");
      const n = run.game.hands[ME].length;
      return o === "win"
        ? `你的 ${ct(t.follow)} 比 ${ct(t.lead)} 大，這墩歸你：明牌 ${ct(up.card)} 進了你的手牌。阿禾從牌堆摸一張暗牌，只有他看得到。你手上還是 ${n} 張。`
        : `你的 ${ct(t.follow)} 比 ${ct(t.lead)} 小，這墩歸阿禾：明牌 ${ct(up.card)} 被他拿走。你從牌堆摸到暗牌 ${drew && drew.card >= 0 ? ct(drew.card) : "一張"}，${ct(c(CL, 12))} 還留在你手上。你手上還是 ${n} 張。`;
    },
    tried: seen => seen.length >= 2
      ? "兩種出法你都看過了：花大牌搶明牌，或把大牌留著、讓阿禾拿。正式對局要這樣搶 13 墩，這些墩數不算進後半場的合約。"
      : "兩種出法都合法。按「換一張試試」，看看另一種結果。正式對局要這樣搶 13 墩，這些墩數不算進後半場的合約。",
    next: "下一幕：說個目標",
    retry: "換一張試試",
  },
  bid: {
    place: "巷口牌店 · 茶涼了一點",
    table: "叫牌 · 說出你的目標",
    skip: "⏩ 搶完 13 次牌，你們手上各有 13 張。",
    setting: "茶杯裡的熱氣淡了些。阿禾把你的手牌攤開，指了指排在一起的紅心。",
    ask: "「接下來的 13 墩，你打算拿幾墩？你可以先說個目標。」",
    hint: "點桌上的 2♥，送出前會先告訴你它代表什麼。",
    nudge: "「這手紅心最多張。今天先說 2♥ 就好。」",
    reply: () => "「Pass，我不往上叫了。你說的八墩，就這麼定。」",
    explain: run => {
      const g = run.game;
      return `${bidText(g.highestBid)} 成了這局的「合約」：紅心當王牌，你要贏到 ${tricksNeeded(g.highestBid)} 墩。` +
        `說出合約、負責完成它的人叫「莊家」——就是你。接下來由${g.leader === AHE ? "阿禾" : "你"}先出第一張。`;
    },
    next: "下一幕：出牌",
    retry: "重新叫一次",
  },
  follow: {
    place: "巷口牌店 · 紅心是王",
    table: "合約 2♥ · 紅心是王牌",
    setting: "合約仍是 2♥。阿禾先出了 ♠A，你手上剩 ♠3 和 ♥2。",
    ask: "「我出黑桃 A，換你。」",
    hint: "點一張牌出牌。",
    illegal: "「先看看手上的黑桃。你還跟得出來，這墩得跟。」",
    reply: () => "「有黑桃就出黑桃。這墩我收下了。」",
    explain: run => {
      const t = run.trick!;
      return `${ct(t.lead)} 比 ${ct(t.follow)} 大，阿禾拿走這墩。對方先出什麼花色，你手上有就一定要跟——這時紅心王牌也不能拿出來吃。`;
    },
    next: "換一手試試",
    retry: "重來這手",
  },
  ruff: {
    place: "巷口牌店 · 紅心是王",
    table: "合約 2♥ · 紅心是王牌",
    skip: "↻ 換一手試試",
    setting: "同一個 2♥ 合約，阿禾仍先出 ♠A。這次你手裡換成 ♥2 和 ♣3，一張黑桃都沒有。",
    ask: "「這次你沒有黑桃。想現在拿這墩，還是把紅心留著？」",
    hint: "兩張都能出，點一張試試。",
    reply: o => o === "ruff"
      ? "「王吃！紅心是我們說好的王牌，最小的 ♥2 也壓得過 ♠A。」"
      : "「這墩讓給我。你的 ♥2 還留著，等更需要的時候再用。」",
    explain: (run, o) => {
      const t = run.trick!;
      return o === "ruff"
        ? `你沒有黑桃，可以改出別的花色。用王牌壓過別的花色叫「王吃」：${ct(t.follow)} 贏了 ${ct(t.lead)}，這墩歸你。`
        : `你沒有黑桃，出了別的花色（叫「墊牌」）。墊牌贏不了，阿禾拿這墩；你的王牌 ${ct(c(HE, 2))} 還在手上。`;
    },
    tried: seen => seen.length >= 2
      ? "兩種你都試過了：現在王吃拿下這墩，或先把王牌留著。"
      : "兩種都可以。按「換一張試試」比比看。",
    next: "下一幕：最後一墩",
    retry: "換一張試試",
  },
  last: {
    place: "巷口牌店 · 雨停了",
    table: "合約 2♥ · 最後一墩",
    skip: "⏩ 跳到尾盤，剩最後一墩。",
    setting: "窗外的雨停了。同一個 2♥ 合約，你已經贏了 7 墩，阿禾贏了 5 墩。阿禾把 ♣K 放在桌上。",
    ask: "「你還差一墩，就剩這兩張。換你了。」",
    hint: "點你最後一張牌。",
    reply: o => o === "made" ? "「你答應八墩，剛好八墩，這就叫打成。」" : "「差了一點，這叫倒約。」",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      return `${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}。` +
        `（打成的分數 = 線數 × 10，這手 ${bidLevel(r.bidIndex)} 線就是 ${r.contractPoints} 分；每多贏 1 墩再加 2 分。）`;
    },
    retry: "再練一次",
  },
};
