// 阿禾的四幕故事（教學）：每一步都是一個固定的牌局（GameSnapshot），
// 玩家出牌、叫牌直接丟進正式的規則引擎 HoneymoonGame —— 能不能出、誰贏這墩、分數多少，
// 都跟連線版／單機版同一套程式算出來，故事裡沒有另外寫一份規則。
//
// 這個檔案不碰畫面（沒有 DOM），測試可以直接跑。
import { Call, Strain, Suit, bidIndex, bidLevel, bidStrain, bidText, cardId, cardText, suitOf, tricksNeeded } from "../game/cards";
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

// 「2♥、沒有加倍、剛好打成，這局 +20 分」—— 數字全部來自計分程式
export function resultLine(r: HandResult): string {
  const how = r.made ? (r.overtricks > 0 ? `多 ${r.overtricks} 墩` : "剛好打成") : `倒 ${r.undertricks} 墩`;
  const who = r.made ? "這局" : "對手";
  return `${bidText(r.bidIndex)}、${r.doubled > 0 ? doubledText(r.doubled) : "沒有加倍"}、${how}，${who} +${r.points} 分`;
}

const SUIT_NAME = ["梅花", "方塊", "紅心", "黑桃"];
// 「紅心當王牌」／「不設王牌（無王）」：無王時絕對不說成哪個花色當王
export const trumpText = (i: number) => bidStrain(i) === Strain.NoTrump ? "不設王牌（無王）" : `${SUIT_NAME[bidStrain(i)]}當王牌`;

// 叫牌送出前的白話：「紅心當王牌，至少要贏 8 墩（6＋2）」
export function bidMeaning(i: number): string {
  return `${trumpText(i)}，至少要贏 ${tricksNeeded(i)} 墩（6＋${bidLevel(i)}）`;
}

// 你點了某個叫牌，阿禾的反應：叫品、墩數都從規則算
export const bidReaction = (i: number) => `「喔？你要叫 ${bidText(i)}，那就得拿到 ${tricksNeeded(i)} 墩喔！」`;

// 這一手能不能王吃：手上沒有對方先出的花色、而且有合約的王牌（用來決定阿禾要不要提示王吃）
export function canRuff(run: StepRun): boolean {
  const g = run.game;
  if (g.leadCard < 0 || g.trump === Strain.NoTrump) return false;
  const hand = g.hands[ME], lead = suitOf(g.leadCard);
  return !hand.some(x => suitOf(x) === lead) && hand.some(x => suitOf(x) === (g.trump as number));
}

// ---------------- 四幕 ----------------

export const ACTS = [
  { no: "第一幕", title: "先來搶牌", sub: "搶牌 · 什麼是一墩", symbol: "♦" },
  { no: "第二幕", title: "你敢叫幾墩？", sub: "叫牌 · 合約與莊家", symbol: "♥" },
  { no: "第三幕", title: "王牌派上用場", sub: "跟牌 · 王吃", symbol: "♠" },
  { no: "第四幕", title: "說到做到", sub: "打成 · 計分", symbol: "♣" },
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
const NEED = tricksNeeded(CONTRACT);

// 你從牌堆摸到的那張暗牌（只有你輸掉這墩才會有）
const myDraw = (run: StepRun) => run.events.find(e => e.type === "CardDrawn" && e.seat === ME && e.card >= 0);

export const LINES: Record<StepId, Lines> = {
  grab: {
    place: "台南 · 下雨的騎樓",
    table: "搶牌 · 這段沒有王牌",
    setting: "外面下著雨。你走進巷口的小牌店躲雨，店主阿禾把茶杯挪開，空出一個位子。他翻開 ♦K，又出了 ♣9。",
    ask: "「明牌是 ♦K，這墩贏的人拿走。我出了 ♣9，來，換你出一張試試！」",
    hint: "點手上一張牌，放上桌。",
    reply: o => o === "win" ? "「漂亮！這張明牌是你的了。」" : "「嘿，這張被我拿走啦。」",
    more: () => "「一人出一張、比一次大小，這就叫一墩。」",
    explain: (run, o) => {
      const t = run.trick!;
      const up = run.events.find(e => e.type === "FaceUpTaken")!;
      const drew = myDraw(run);
      const n = run.game.hands[ME].length;
      return o === "win"
        ? `你的 ${ct(t.follow)} 比 ${ct(t.lead)} 大，這墩是你的：明牌 ${ct(up.card)} 進了你的手牌。阿禾輸了，從牌堆摸一張暗牌（只有他看得到）。你手上還是 ${n} 張。`
        : `你的 ${ct(t.follow)} 比 ${ct(t.lead)} 小，這墩被阿禾拿走：明牌 ${ct(up.card)} 歸他。你從牌堆摸到暗牌 ${drew ? ct(drew.card) : "一張"}，${ct(c(CL, 12))} 還留在你手上。你手上還是 ${n} 張。`;
    },
    tried: seen => seen.length >= 2
      ? "兩種出法你都看過了：出大牌搶明牌，或留著大牌、讓阿禾拿。正式打的時候要這樣搶 13 墩，這段不算分。"
      : "兩種出法都可以。按「換一張試試」，看看另一種結果。正式打的時候要這樣搶 13 墩，這段不算分。",
    next: "下一幕：你敢叫幾墩？",
    retry: "換一張試試",
  },
  bid: {
    place: "巷口牌店 · 茶涼了一點",
    table: "叫牌 · 你打算贏幾墩？",
    skip: "⏩ 快轉：13 次牌搶完了，你們手上各有 13 張。",
    setting: "茶杯裡的熱氣淡了些。阿禾看了一眼你的手牌，指了指那一排紅心。",
    ask: "「來，你想叫幾線？」",
    hint: "點桌上的 2♥ 試試，送出前會先告訴你它的意思。",
    nudge: "不過這手紅心最多，今天先叫 2♥ 吧。",   // 接在阿禾的反應後面，同一句話
    reply: () => "「我 Pass，不往上叫了。」",
    explain: run => {
      const g = run.game, bid = g.highestBid >= 0 ? g.highestBid : CONTRACT;
      return `${bidText(bid)} 就是這局的「合約」：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩。` +
        `負責打成合約的人叫「莊家」，就是你；接下來由${g.leader === AHE ? "阿禾" : "你"}先出第一張。`;
    },
    next: "下一幕：王牌派上用場",
    retry: "重新叫一次",
  },
  follow: {
    place: "巷口牌店 · 紅心是王",
    table: "合約 2♥ · 紅心是王牌",
    setting: "合約是 2♥。阿禾先出了 ♠A，你手上剩 ♠3 和 ♥2。",
    ask: "「我出 ♠A，換你。」",
    hint: "點一張牌出牌。",
    illegal: "「等等，你還有這個花色，要先跟牌喔。」",
    reply: () => "「有黑桃就要出黑桃。這墩我收下啦。」",
    explain: run => {
      const t = run.trick!;
      return `${ct(t.lead)} 比 ${ct(t.follow)} 大，阿禾拿走這墩。對方先出什麼花色，你手上有就一定要跟，這時候紅心王牌也不能拿出來吃。`;
    },
    next: "換一手試試",
    retry: "重來這手",
  },
  ruff: {
    place: "巷口牌店 · 紅心是王",
    table: "合約 2♥ · 紅心是王牌",
    skip: "↻ 換一手試試",
    setting: "還是 2♥ 合約，阿禾一樣先出 ♠A。這次你手上是 ♥2 和 ♣3，一張黑桃都沒有。",
    ask: "「欸，機會來了！你沒有黑桃，可以試試看出王牌。」",
    hint: "兩張都能出，點一張試試。",
    reply: o => o === "ruff" ? "「對！就是這樣！」" : "「這墩讓給我啦。你的 ♥2 還留著，等更需要的時候再用。」",
    explain: (run, o) => {
      const t = run.trick!;
      return o === "ruff"
        ? `你沒有黑桃，就能改出別的花色。用王牌壓過別的花色，叫「王吃」：${ct(t.follow)} 贏了 ${ct(t.lead)}，這墩是你的。`
        : `你沒有黑桃，出了別的花色，這叫「墊牌」。墊牌贏不了，阿禾拿走這墩；你的王牌 ${ct(c(HE, 2))} 還在手上。`;
    },
    tried: seen => seen.length >= 2
      ? "兩種你都試過了：現在就王吃拿下這墩，或先把王牌留著。"
      : "兩種都可以。按「換一張試試」比比看。",
    next: "下一幕：說到做到",
    retry: "換一張試試",
  },
  last: {
    place: "巷口牌店 · 雨停了",
    table: "合約 2♥ · 最後一墩",
    skip: "⏩ 快轉到最後一墩。",
    setting: "窗外的雨停了。還是 2♥ 合約，你已經贏了 7 墩，阿禾贏了 5 墩。阿禾把 ♣K 放上桌。",
    ask: "「就差一墩了，加油！換你。」",
    hint: "點你最後一張牌。",
    reply: o => o === "made" ? "「喔！還真的被你打成了！」" : "「哎呀，這局沒打成。」",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      return `${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}。` +
        `（打成的分數 = 線數 × 10，這手 ${bidLevel(r.bidIndex)} 線就是 ${r.contractPoints} 分；每多贏 1 墩再加 2 分。）`;
    },
    retry: "我想再練一下",
  },
};

// ---------------- 一句一句講：開場、每一幕的前情、出牌後的反應、結尾 ----------------
// 每個畫面先由旁白和阿禾一句一句帶進來，最後一句就是阿禾的問題（輪到你出牌）；
// 你出牌之後，阿禾再一句一句說明剛才發生了什麼。台詞只講真的發生的事。

export interface Line { who: "ahe" | "narr"; text: string; cta?: string; }   // cta：這句講完多一顆「回答」按鈕
const A = (text: string, cta?: string): Line => (cta ? { who: "ahe", text, cta } : { who: "ahe", text });
const N = (text: string): Line => ({ who: "narr", text });

export const TALK: Record<StepId, { intro: Line[]; outro: (o: Outcome, run: StepRun) => Line[] }> = {
  grab: {
    intro: [
      N("外面下著雨。你收起傘，走進巷口一間小小的牌店。"),
      A("「欸，第一次來喔？要不要打場橋牌？不會也沒關係，我教你。」"),
      A("「規則聽起來有點多，但打一場就懂了。來，先從最簡單的開始。」", "好啊，來吧！"),
      N("店主阿禾把茶杯挪開，從牌堆翻開一張 ♦K，又從手裡出了 ♣9。"),
      A("「你看，桌上有張翻開的牌。這張叫明牌，這一墩贏的人，就能把它拿走。」"),
      A("「輸的人則是從牌堆摸一張暗牌，摸到什麼就看運氣啦。」"),
      A("「所以前半場，我們要想辦法搶到想要的牌。」"),
      A(LINES.grab.ask),
    ],
    outro: (o, run) => {
      const drew = myDraw(run);
      return [
        A(LINES.grab.reply(o)),
        A(LINES.grab.more!(o)),
        A(o === "win"
          ? "「這墩我輸了，所以換我從牌堆摸一張暗牌，只有我看得到喔。」"
          : `「沒事，你還能摸一張暗牌。${drew ? `你摸到的是 ${ct(drew.card)}，` : ""}${ct(c(CL, 12))} 也還留著。」`),
        A("「正式打的時候要這樣搶 13 墩，這段不算分，搶的是好牌。」"),
        A("「好，搶牌大概就是這樣！接下來要決定這局你想叫多大。」"),
      ];
    },
  },
  bid: {
    intro: [
      N("快轉一下：13 次牌搶完了，你們手上各有 13 張。"),
      A("「現在換叫牌了。簡單說，就是先講好你這局打算贏幾墩。」"),
      A(`「像 2♥，就是紅心當王牌，而且你至少要贏 ${NEED} 墩。王牌是什麼，等等教你。」`),
      A("「叫得高，成功的話分數比較多；但沒做到，對手就有分數拿。」"),
      N("阿禾看了一眼你的手牌，指了指那一排紅心。"),
      A("「你紅心有六張，不錯喔。先看看手上的牌，再決定要叫多高。」"),
      A(LINES.bid.ask),
    ],
    outro: (_o, run) => {
      const g = run.game, bid = g.highestBid >= 0 ? g.highestBid : CONTRACT;
      const iDecl = g.declarer === ME || g.declarer < 0;
      return [
        A(LINES.bid.reply("contract")),
        A("「好，合約定了。等等可要說到做到！」"),
        A(`「你叫的 ${bidText(bid)} 就是這局的『合約』：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩。」`),
        A(iDecl
          ? `「負責打成合約的人叫『莊家』，就是你；我是『防守方』，${g.leader === ME ? "由你先出第一張" : "由我先出第一張"}。」`
          : "「這局我是莊家，你是防守方。」"),
      ];
    },
  },
  follow: {
    intro: [
      N("開始出牌了。合約是 2♥，紅心是王牌。"),
      A("「接下來教你一個很好用的東西，就是王牌！」"),
      A("「不過先記得：平常要跟著先出的花色出牌。」"),
      N("阿禾放下 ♠A。你手上剩 ♠3 和 ♥2。"),
      A(LINES.follow.ask),
    ],
    outro: () => [
      A(LINES.follow.reply("followed")),
      A("「對方先出什麼花色，你手上有，就一定要跟。」"),
      A("「王牌很強沒錯，但你還有黑桃的時候，還輪不到它出場。」"),
    ],
  },
  ruff: {
    intro: [
      A("「同一張 ♠A，我們換一手牌看看。」"),
      N("這次你手上是 ♥2 和 ♣3，一張黑桃都沒有。"),
      A("「如果你沒有那個花色，就可以用王牌搶這一墩。這就叫王吃。」"),
      A(LINES.ruff.ask),
    ],
    outro: o => o === "ruff" ? [
      A(LINES.ruff.reply("ruff")),
      A("「手上沒有對方出的花色，用王牌壓過去，這就是『王吃』。再小的王牌，也比別的花色的 A 大。」"),
      A("「學會王吃之後，局面就更有意思了。」"),
    ] : [
      A(LINES.ruff.reply("discard")),
      A("「沒有那個花色時出別的牌，叫『墊牌』。墊牌贏不了，但王牌保住了。」"),
      A("「什麼時候王吃、什麼時候留著，就是橋牌好玩的地方。」"),
    ],
  },
  last: {
    intro: [
      N("快轉到最後。窗外的雨停了。"),
      A(`「還記得你剛剛叫的合約嗎？${bidText(CONTRACT)}，要贏 ${NEED} 墩。現在就看你能不能打成！」`),
      A("「只要贏到目標墩數，就算成功。你已經拿了 7 墩，我 5 墩。」"),
      N("阿禾把 ♣K 放上桌，看著你。"),
      A(LINES.last.ask),
    ],
    outro: (o, run) => {
      const r = run.game.lastResult;
      const won = run.game.tricksWon[ME];
      if (o === "down") return [
        A(LINES.last.reply("down")),
        A(r ? `「你說要 ${r.tricksNeeded} 墩，結果差了 ${r.undertricks} 墩，這叫『倒約』，分數會給對手。」` : "「沒拿到說好的墩數，這叫『倒約』，分數會給對手。」"),
        A("「沒關係，再來一次就好。」"),
      ];
      return [
        A(LINES.last.reply("made")),
        ...(r && r.overtricks > 0 ? [A("「還多贏了幾墩，可以喔！」")] : []),
        A(`「你說要 ${r?.tricksNeeded ?? NEED} 墩，就真的拿到 ${r ? won : NEED} 墩，這就叫『打成』。」`),
        A(`「分數是線數乘 10：這手 ${bidLevel(r?.bidIndex ?? CONTRACT)} 線，就是 ${r?.contractPoints ?? 0} 分。多贏一墩再加 2 分。」`),
        A("「好啦，基本上就是這樣！」"),
        N("阿禾把牌收齊，重新洗了一次。"),
        A("「你已經可以自己打一場了。來，要不要真的打一局？這次我可不會放水喔。」"),
      ];
    },
  },
};
