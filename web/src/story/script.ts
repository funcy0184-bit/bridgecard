// 阿禾的四幕故事（教學）：每一步都是一個固定的牌局（GameSnapshot），
// 玩家出牌、叫牌直接丟進正式的規則引擎 HoneymoonGame —— 能不能出、誰贏這墩、分數多少，
// 都跟連線版／單機版同一套程式算出來，故事裡沒有另外寫一份規則。
//
// 這個檔案不碰畫面（沒有 DOM），測試可以直接跑。
import { Call, Strain, Suit, bidIndex, bidLevel, bidStrain, bidText, cardId, cardText, suitOf, tricksNeeded } from "../game/cards";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { HandResult, doubledText } from "../game/scoring";
import { legalPlays } from "../game/rules";
import { whyTrick } from "../game/explain";

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

// 第三、四幕共用：2♥ 合約、你是莊家（tricksWon 依每一段設定）
const contractPlay = (p: Partial<GameSnapshot>) => snap({
  phase: Phase.Play, trump: Strain.Hearts,
  highestBid: CONTRACT, highestBidder: ME, declarer: ME, doubled: 0,
  auction: [{ seat: ME, call: CONTRACT }, { seat: AHE, call: Call.Pass }],
  leader: AHE, currentPlayer: ME, firstSeat: ME,
  ...p,
});
const NT1 = bidIndex(1, Strain.NoTrump);
const S2 = bidIndex(2, Strain.Spades);

export type StepId = "grab" | "grab2" | "bid" | "bid2" | "follow" | "ruff" | "flipA" | "flipB" | "trumps" | "nt" | "last" | "down";
export type Outcome = "win" | "lose" | "contract" | "raise" | "defend" | "followed" | "ruff" | "discard" | "made" | "down";

export interface Step {
  id: StepId;
  act: 0 | 1 | 2 | 3;
  kind: "play" | "bid";
  snapshot: GameSnapshot;
  outcomes: Outcome[];           // 這一步所有「都算對」的結果
  aheCard?: number;              // 你先出時，阿禾回的牌（固定，才能做對照）；沒寫就照「能出的最小那張」
  aheCalls?: number[];           // 叫牌：阿禾依序的叫牌
}

// 你手上的 13 張（第二幕兩種情況共用）
const BID_HANDS: [number[], number[]] = [
  [c(SP, 13), c(SP, 8), c(HE, 14), c(HE, 13), c(HE, 12), c(HE, 10), c(HE, 4), c(HE, 2), c(DI, 10), c(DI, 7), c(DI, 3), c(CL, 14), c(CL, 4)],
  [c(SP, 14), c(SP, 12), c(SP, 11), c(SP, 9), c(SP, 5), c(HE, 9), c(HE, 6), c(DI, 14), c(DI, 12), c(DI, 8), c(CL, 13), c(CL, 10), c(CL, 7)],
];
const bidSnap = () => snap({ phase: Phase.Bidding, trump: Strain.NoTrump, currentPlayer: ME, leader: ME, firstSeat: ME, hands: [BID_HANDS[0].slice(), BID_HANDS[1].slice()] });

export const STEPS: Step[] = [
  // 第一幕之一：阿禾翻開 ♦K、出了 ♣9；你手上 ♣Q、♣4。下一張暗牌是 ♠6（輸的人摸）
  { id: "grab", act: 0, kind: "play", outcomes: ["win", "lose"],
    snapshot: snap({ phase: Phase.Draw, trump: Strain.NoTrump, hands: [[c(CL, 12), c(CL, 4)], [c(HE, 7)]],
      stock: [c(DI, 13), c(SP, 6), c(HE, 11), c(CL, 2)], leader: AHE, currentPlayer: ME, leadCard: c(CL, 9), firstSeat: AHE }) },
  // 第一幕之二：接著用 ♣Q 贏的那條線 → 贏家（你）下一墩先出；新的明牌 ♥J 不決定跟牌花色
  { id: "grab2", act: 0, kind: "play", outcomes: ["win"],
    snapshot: snap({ phase: Phase.Draw, trump: Strain.NoTrump, hands: [[c(CL, 4), c(DI, 13)], [c(HE, 7), c(SP, 6)]], takenFaceUp: [[c(DI, 13)], []],
      stock: [c(HE, 11), c(CL, 2)], leader: ME, currentPlayer: ME, leadCard: -1, firstSeat: AHE }) },
  // 第二幕之一（情況 A）：你叫 2♥，阿禾 Pass，合約成立
  { id: "bid", act: 1, kind: "bid", outcomes: ["contract"], snapshot: bidSnap(), aheCalls: [Call.Pass] },
  // 第二幕之二（情況 B）：你叫 2♥，阿禾叫 2♠，再輪到你：叫更高或 Pass
  { id: "bid2", act: 1, kind: "bid", outcomes: ["raise", "defend"], snapshot: bidSnap(), aheCalls: [S2, Call.Pass] },
  // 第三幕：阿禾出 ♠A，你有 ♠3 和 ♥2 → 有黑桃就得跟
  { id: "follow", act: 2, kind: "play", outcomes: ["followed"],
    snapshot: contractPlay({ hands: [[c(SP, 3), c(HE, 2)], [c(DI, 5)]], leadCard: c(SP, 14), tricksWon: [6, 5] }) },
  // 你有 ♥2 和 ♣3、沒有黑桃 → 王吃或墊牌都可以
  { id: "ruff", act: 2, kind: "play", outcomes: ["ruff", "discard"],
    snapshot: contractPlay({ hands: [[c(HE, 2), c(CL, 3)], [c(DI, 5)]], leadCard: c(SP, 14), tricksWon: [6, 5] }) },
  // 對照 A：阿禾先出 ♠K，你沒有黑桃也沒有紅心，手上 ♦A ♣5 → ♠K 贏
  { id: "flipA", act: 2, kind: "play", outcomes: ["lose"],
    snapshot: contractPlay({ hands: [[c(DI, 14), c(CL, 5)], [c(CL, 4)]], leadCard: c(SP, 13), tricksWon: [6, 5] }) },
  // 對照 B：換你先出 ♦A，阿禾沒有方塊，墊 ♠K → ♦A 贏
  { id: "flipB", act: 2, kind: "play", outcomes: ["win"], aheCard: c(SP, 13),
    snapshot: contractPlay({ hands: [[c(DI, 14), c(DI, 3)], [c(SP, 13), c(CL, 4)]], leader: ME, currentPlayer: ME, leadCard: -1, tricksWon: [6, 5] }) },
  // 都是王牌：阿禾先出 ♥9，你有 ♥Q（一定要跟紅心）→ 比點數
  { id: "trumps", act: 2, kind: "play", outcomes: ["win"],
    snapshot: contractPlay({ hands: [[c(HE, 12), c(SP, 5)], [c(CL, 6)]], leadCard: c(HE, 9), tricksWon: [6, 5] }) },
  // 無王：1NT，阿禾先出 ♣K，你沒有梅花 → 沒有王吃，出什麼都贏不了
  { id: "nt", act: 2, kind: "play", outcomes: ["lose"],
    snapshot: snap({ phase: Phase.Play, trump: Strain.NoTrump, highestBid: NT1, highestBidder: ME, declarer: ME, doubled: 0,
      auction: [{ seat: ME, call: NT1 }, { seat: AHE, call: Call.Pass }], leader: AHE, currentPlayer: ME, firstSeat: ME,
      hands: [[c(HE, 14), c(SP, 2)], [c(DI, 5)]], leadCard: c(CL, 13), tricksWon: [6, 5] }) },
  // 第四幕之一：你 7 墩、阿禾 5 墩；阿禾出 ♣K，你最後一張 ♣A → 8 墩打成
  { id: "last", act: 3, kind: "play", outcomes: ["made"],
    snapshot: contractPlay({ hands: [[c(CL, 14)], []], leadCard: c(CL, 13), tricksWon: [7, 5] }) },
  // 第四幕之二：你 7 墩、阿禾 5 墩；阿禾出 ♣A，你最後一張 ♣K → 7 比 6，倒一
  { id: "down", act: 3, kind: "play", outcomes: ["down"],
    snapshot: contractPlay({ hands: [[c(CL, 13)], []], leadCard: c(CL, 14), tricksWon: [7, 5] }) },
];

export const stepIndex = (id: StepId) => STEPS.findIndex(s => s.id === id);

// ---------------- 跑一步 ----------------

export interface Trick { leader: number; lead: number; follow: number; winner: number; ruff: boolean; }

export interface StepRun {
  step: Step;
  game: HoneymoonGame;
  events: GameEvent[];        // 只收「你看得到的」事件：阿禾摸到哪張暗牌不會進來
  actions: number[];          // 被接受的動作（存進度、重新整理時重播用）
  trick: Trick | null;        // 這一墩：結果留在桌上給你看
  done: boolean;
}

export function start(step: Step): StepRun {
  const game = HoneymoonGame.restore(step.snapshot);
  const run: StepRun = { step, game, events: [], actions: [], trick: null, done: false };
  game.on((e, to) => { if (to < 0 || to === ME) run.events.push(e); });
  return run;
}

// 叫牌：這一步現在允許你叫什麼（教學不放加倍，加倍放在延伸說明）
export function bidAllowed(run: StepRun, call: number): boolean {
  const g = run.game, first = run.actions.length === 0;
  if (run.step.id === "bid" || first) return call === CONTRACT;           // 先說 2♥
  if (call === Call.Pass) return true;
  return call >= 0 && call > g.highestBid && bidLevel(call) <= 3;
}
export const yourTurnToBid = (run: StepRun) => run.step.kind === "bid" && !run.done && run.game.phase === Phase.Bidding && run.game.currentPlayer === ME;

// 第一段：你出牌／叫牌。不合法就 ok = false（出牌時引擎會發 Illegal 事件）
export function act(run: StepRun, a: number): { ok: boolean; events: GameEvent[] } {
  const before = run.events.length;
  if (run.done) return { ok: false, events: [] };
  const g = run.game;
  let ok = false;
  if (run.step.kind === "play") {
    if (run.trick) return { ok: false, events: [] };
    const leading = g.leadCard < 0;
    const lead = g.leadCard;
    ok = g.playCard(ME, a);
    if (ok) run.trick = leading ? { leader: ME, lead: a, follow: -1, winner: -1, ruff: false } : { leader: AHE, lead, follow: a, winner: -1, ruff: false };
  } else {
    ok = yourTurnToBid(run) && bidAllowed(run, a) && g.makeCall(ME, a);
  }
  if (ok) run.actions.push(a);
  return { ok, events: run.events.slice(before) };
}

// 你先出時：阿禾回一張（固定的對照牌，或能出的最小那張）
export const needsReply = (run: StepRun) => run.step.kind === "play" && !!run.trick && run.trick.leader === ME && run.trick.follow < 0;
export function reply(run: StepRun): GameEvent[] {
  const before = run.events.length;
  if (!needsReply(run)) return [];
  const g = run.game;
  const legal = legalPlays(g.hands[AHE], g.leadCard);
  const want = run.step.aheCard;
  const card = want !== undefined && legal.includes(want) ? want : legal.slice().sort((a, b) => (a % 13) - (b % 13))[0];
  g.playCard(AHE, card);
  run.trick!.follow = card;
  return run.events.slice(before);
}

// 第二段：結算這一墩（出牌）／阿禾回應（叫牌）
export function settle(run: StepRun): GameEvent[] {
  const before = run.events.length;
  if (run.done) return [];
  const g = run.game;
  if (run.step.kind === "play") {
    if (!run.trick) return [];
    if (needsReply(run)) reply(run);
    g.resolveTrick();
    const won = run.events.slice(before).find(e => e.type === "TrickWon");
    run.trick.winner = won ? won.seat : -1;
    run.trick.ruff = !!won && won.extra === 1;
    run.done = true;
  } else {
    const calls = run.step.aheCalls ?? [Call.Pass];
    if (g.phase === Phase.Bidding && g.currentPlayer === AHE) {
      const k = g.auction.filter(x => x.seat === AHE).length;
      g.makeCall(AHE, calls[Math.min(k, calls.length - 1)]);
    }
    run.done = g.phase !== Phase.Bidding;
  }
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
    case "bid": return g.declarer === ME ? "contract" : null;
    case "bid2": return g.declarer === ME ? "raise" : "defend";
    case "follow": return "followed";
    case "ruff": return t!.ruff ? "ruff" : "discard";
    case "last": case "down": return g.lastResult?.made ? "made" : "down";
    default: return t!.winner === ME ? "win" : "lose";
  }
}

// 這一墩為什麼是這個結果（跟正式牌桌同一套說明）
export function trickWhy(run: StepRun): string {
  const t = run.trick;
  if (!t || t.follow < 0 || t.winner < 0) return "";
  const trump = run.game.phase === Phase.Draw || run.step.id === "grab" || run.step.id === "grab2" ? Strain.NoTrump : (run.game.trump as number);
  const w = whyTrick(t.lead, t.follow, trump, t.leader === ME ? "阿禾" : "你");
  return `${t.winner === ME ? "你" : "阿禾"}贏：${w.why}`;
}
export const nextLeader = (run: StepRun) => run.trick && run.trick.winner >= 0 ? `下一墩由${run.trick.winner === ME ? "你" : "阿禾"}先出。` : "";

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
  if (i === Call.Pass) return "不叫：這次不往上叫";
  return `${trumpText(i)}，至少要贏 ${tricksNeeded(i)} 墩（6＋${bidLevel(i)}）`;
}

// 你點了某個叫牌，阿禾的反應：叫品、墩數都從規則算
export const bidReaction = (i: number) => i === Call.Pass ? "「不叫也行，那就照我說的。」" : `「喔？你要叫 ${bidText(i)}，那就得拿到 ${tricksNeeded(i)} 墩喔！」`;

// 這一手能不能王吃：手上沒有對方先出的花色、而且有合約的王牌（用來決定阿禾要不要提示王吃）
export function canRuff(run: StepRun): boolean {
  const g = run.game;
  if (g.leadCard < 0 || g.trump === Strain.NoTrump) return false;
  const hand = g.hands[ME], lead = suitOf(g.leadCard);
  return !hand.some(x => suitOf(x) === lead) && hand.some(x => suitOf(x) === (g.trump as number));
}

// ---------------- 四幕 ----------------

export const ACTS = [
  { no: "第一幕", title: "先來搶牌", sub: "搶牌 · 一墩 · 贏家先出", symbol: "♦" },
  { no: "第二幕", title: "你敢叫幾墩？", sub: "叫牌 · 合約與莊家 · 首攻", symbol: "♥" },
  { no: "第三幕", title: "王牌派上用場", sub: "跟牌 · 王吃 · 誰先出", symbol: "♠" },
  { no: "第四幕", title: "說到做到", sub: "打成 · 倒約 · 計分", symbol: "♣" },
] as const;

export const firstStepOfAct = (act: number) => STEPS.findIndex(s => s.act === act);

// ---------------- 台詞 ----------------
// 每一段：學什麼（table）→ 現在的局面（setting／旁白）→ 你做什麼（ask＋hint）→ 結果與原因（explain）→ 接下來誰行動

export interface Lines {
  place: string;
  table: string;                 // 本段要學什麼
  skip?: string;                 // 時間跳轉／換一手的提示
  setting: string;
  ask: string;                   // 出牌前：阿禾的問題（每個畫面只問一件事）
  hint: string;                  // 出牌前：一行操作提示
  ask2?: string;                 // 叫牌情況 B：阿禾叫 2♠ 之後
  hint2?: string;
  illegal?: string;              // 選了不能出的牌
  nudge?: string;                // 叫牌：點了不允許的叫品
  reply: (o: Outcome) => string;
  more?: (o: Outcome) => string;
  explain: (run: StepRun, o: Outcome) => string;   // 結果區：完整的原因（含下一墩誰先出）
  tried?: (seen: Outcome[]) => string;
  next?: string;
  retry: string;
}

const ct = cardText;
const NEED = tricksNeeded(CONTRACT);
const myDraw = (run: StepRun) => run.events.find(e => e.type === "CardDrawn" && e.seat === ME && e.card >= 0);
const withNext = (run: StepRun) => [trickWhy(run), nextLeader(run)].filter(Boolean).join(" ");

export const LINES: Record<StepId, Lines> = {
  grab: {
    place: "台南 · 下雨的騎樓",
    table: "學：一墩怎麼比、明牌暗牌去哪",
    setting: "外面下著雨。你走進巷口的小牌店躲雨，店主阿禾把茶杯挪開，空出一個位子。他翻開 ♦K，又出了 ♣9。",
    ask: "「明牌是 ♦K，這墩贏的人拿走。我出了 ♣9，來，換你出一張試試！」",
    hint: "選一張牌，按「確認出牌」。",
    reply: o => o === "win" ? "「漂亮！這張明牌是你的了。」" : "「嘿，這張被我拿走啦。」",
    more: () => "「一人出一張、比一次大小，這就叫一墩。」",
    explain: (run, o) => {
      const up = run.events.find(e => e.type === "FaceUpTaken")!;
      const drew = myDraw(run);
      const n = run.game.hands[ME].length;
      return `${trickWhy(run)} ` + (o === "win"
        ? `明牌 ${ct(up.card)} 進了你的手牌；阿禾從牌堆摸一張暗牌（只有他看得到）。各出一張、再補一張，你手上還是 ${n} 張。${nextLeader(run)}`
        : `明牌 ${ct(up.card)} 被阿禾拿走。你從牌堆摸到暗牌 ${drew ? ct(drew.card) : "一張"}，${ct(c(CL, 12))} 還留在你手上。你手上還是 ${n} 張。${nextLeader(run)}`);
    },
    tried: seen => seen.length >= 2
      ? "兩種出法你都看過了：出大牌搶明牌，或留著大牌、讓阿禾拿。"
      : "兩種出法都可以。按「換一張試試」，看看另一種結果。",
    next: "下一墩：贏家先出",
    retry: "換一張試試",
  },
  grab2: {
    place: "台南 · 下雨的騎樓",
    table: "學：贏家下一墩先出",
    skip: "↪ 接著用 ♣Q 贏的那條線打下一墩",
    setting: "你用 ♣Q 贏了上一墩、拿走 ♦K。牌堆翻開新的明牌 ♥J。",
    ask: "「這墩你先出：你出的牌，決定這墩要跟什麼花色。」",
    hint: "你先出，出哪張都可以。選好按「確認出牌」。",
    reply: () => "「我沒有你出的那個花色，只好墊一張。這墩你的。」",
    explain: run => `${trickWhy(run)} 你拿走明牌 ♥J，阿禾摸走最後一張暗牌。牌堆空了，搶牌結束（真正的牌局會搶滿 13 次）。搶牌的墩不算合約，接下來進入叫牌。`,
    next: "下一幕：你敢叫幾墩？",
    retry: "重打這墩",
  },
  bid: {
    place: "巷口牌店 · 茶涼了一點",
    table: "學：叫牌＝說好要贏幾墩（情況 A）",
    skip: "⏩ 快轉：13 次牌搶完了，你們手上各有 13 張。",
    setting: "茶杯裡的熱氣淡了些。阿禾看了一眼你的手牌，指了指那一排紅心。",
    ask: "「來，你想叫幾線？」",
    hint: "點桌上的 2♥ 試試，送出前會先告訴你它的意思。",
    nudge: "不過這手紅心最多，今天先叫 2♥ 吧。",
    reply: () => "「我 Pass，不往上叫了。」",
    explain: run => {
      const g = run.game, bid = g.highestBid >= 0 ? g.highestBid : CONTRACT;
      return `${bidText(bid)} 就是這局的「合約」：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩（6＋${bidLevel(bid)}）。` +
        `負責打成合約的人叫「莊家」，就是你；我是防守方。第一墩由防守方（阿禾）先出。合約定了，出牌時就不能再改。`;
    },
    next: "情況 B：對方叫更高",
    retry: "重新叫一次",
  },
  bid2: {
    place: "巷口牌店 · 茶涼了一點",
    table: "學：還在競叫 vs 合約已確定（情況 B）",
    setting: "同一手牌，再叫一次。",
    ask: "「同一手牌，你一樣先叫 2♥。」",
    hint: "點 2♥、按「確定叫 2♥」。",
    ask2: "「我叫 2♠。同樣 2 線，叫牌時 ♠ 比 ♥ 高一階。你要叫得更高，還是 Pass？」",
    hint2: "點一個比 2♠ 高的叫牌（例如 3♥），或選「不叫 Pass」；送出前會先說它代表什麼。叫牌順位 ♣<♦<♥<♠<無王 只用在叫牌，出牌時花色沒有大小。",
    nudge: "要比 2♠ 高才能叫，或是 Pass。",
    reply: o => o === "raise" ? "「好，你叫得比我高，我 Pass。合約定了。」" : "「你 Pass，那就照我的 2♠。合約定了。」",
    explain: (run, o) => {
      const g = run.game, bid = g.highestBid;
      const base = o === "raise"
        ? `合約 ${bidText(bid)}：${trumpText(bid)}，你是莊家，要贏 ${tricksNeeded(bid)} 墩。叫得越高，要贏的墩越多。第一墩由防守方（阿禾）先出。`
        : `合約 ${bidText(bid)}：${trumpText(bid)}，阿禾是莊家、要贏 ${tricksNeeded(bid)} 墩；你是防守方，要阻止他。第一墩由防守方——你——先出。`;
      return base + "競叫中可以一直往上叫；有人叫了、另一個人 Pass，合約就確定，出牌時不能再換。一開始兩個人都 Pass，這手牌重新發。（加倍、再加倍是進階玩法，速查裡有。）";
    },
    tried: seen => seen.length >= 2 ? "兩種你都試過了：叫更高自己當莊家，或 Pass 讓對方當莊家。" : "也可以按「重新叫一次」，試試另一種選擇。",
    next: "下一幕：王牌派上用場",
    retry: "重新叫一次",
  },
  follow: {
    place: "巷口牌店 · 紅心是王",
    table: "學：有領出花色就要跟",
    setting: "合約是 2♥。阿禾先出了 ♠A，你手上剩 ♠3 和 ♥2。",
    ask: "「我出 ♠A，換你。」",
    hint: "有黑桃就要跟黑桃。選一張、按「確認出牌」。",
    illegal: "「等等，你還有這個花色，要先跟牌喔。」",
    reply: () => "「有黑桃就要出黑桃。這墩我收下啦。」",
    explain: run => `${withNext(run)} 對方先出什麼花色，你手上有就一定要跟——這時候紅心王牌也不能拿出來吃。`,
    next: "換一手試試",
    retry: "重來這手",
  },
  ruff: {
    place: "巷口牌店 · 紅心是王",
    table: "學：沒有領出花色：王吃或墊牌",
    skip: "↻ 換一手試試",
    setting: "還是 2♥ 合約，阿禾一樣先出 ♠A。這次你手上是 ♥2 和 ♣3，一張黑桃都沒有。",
    ask: "「欸，機會來了！你沒有黑桃，可以試試看出王牌。」",
    hint: "兩張都能出：♥2 王吃，或墊 ♣3。",
    reply: o => o === "ruff" ? "「對！就是這樣！」" : "「這墩讓給我啦。你的 ♥2 還留著，等更需要的時候再用。」",
    explain: (run, o) => `${withNext(run)} ` + (o === "ruff"
      ? "沒有領出花色時，用王牌壓過去叫「王吃」。"
      : "沒有領出花色時出別的花色叫「墊牌」：墊牌贏不了，但王牌保住了。"),
    tried: seen => seen.length >= 2 ? "兩種你都試過了：現在就王吃，或先把王牌留著。" : "兩種都可以。按「換一張試試」比比看。",
    next: "下一段：A 不一定贏 K",
    retry: "換一張試試",
  },
  flipA: {
    place: "巷口牌店 · 紅心是王",
    table: "學：誰先出，就決定領出花色（對照 A）",
    setting: "還是紅心當王牌。阿禾先出 ♠K；你手上是 ♦A 和 ♣5，沒有黑桃，也沒有紅心。",
    ask: "「你沒有黑桃，倒是有 ♦A。A 比 K 大——出 ♦A 看看？」",
    hint: "選 ♦A、按「確認出牌」。",
    reply: () => "「♠K 贏。不是 A 不夠大，是 ♦A 不是黑桃。」",
    explain: run => `${withNext(run)} 這墩先出的是黑桃，所以只看黑桃，或王牌（紅心）。`,
    next: "換你先出看看",
    retry: "再出一次",
  },
  flipB: {
    place: "巷口牌店 · 紅心是王",
    table: "學：誰先出，就決定領出花色（對照 B）",
    setting: "同樣兩張牌，換你先出。你手上 ♦A 和 ♦3；阿禾沒有方塊。",
    ask: "「這次你先出：出 ♦A。」",
    hint: "選 ♦A、按「確認出牌」。",
    reply: () => "「這次你的方塊贏。我沒有方塊，只好墊 ♠K。」",
    explain: run => `${withNext(run)} 對照：情況 A 阿禾先出 ♠K、你出 ♦A → ♠K 贏；情況 B 你先出方塊、阿禾出 ♠K → 方塊贏。同樣兩張牌，改變誰先出，領出花色就不同。不是先出的人一定贏，而是先出的人決定跟牌花色。`,
    next: "小練習：都是王牌",
    retry: "再出一次",
  },
  trumps: {
    place: "巷口牌店 · 紅心是王",
    table: "學：都是王牌，比點數",
    setting: "阿禾先出王牌 ♥9；你手上有 ♥Q 和 ♠5。",
    ask: "「我出 ♥9，是王牌。你手上有紅心，要怎麼出？」",
    hint: "有紅心就要跟紅心。選好按「確認出牌」。",
    illegal: "「等等，你還有紅心，要先跟紅心喔。有領出花色時，不能隨便改出別的。」",
    reply: () => "「都是王牌，比點數：你的 ♥Q 比我的 ♥9 大。」",
    explain: run => `${withNext(run)} 同花色時，後出的較大牌可以贏；有領出花色時要先跟，不能任意改出王牌或其他花色。`,
    next: "小練習：無王",
    retry: "再出一次",
  },
  nt: {
    place: "巷口牌店 · 無王",
    table: "學：無王沒有王吃",
    setting: "換一個合約：1NT（無王）。阿禾先出 ♣K；你手上 ♥A 和 ♠2，沒有梅花。",
    ask: "「無王就是沒有王牌。你沒有梅花——這次能王吃嗎？」",
    hint: "選一張、按「確認出牌」看看。",
    reply: () => "「無王沒有王吃：你沒有梅花，出什麼都贏不了 ♣K。」",
    explain: run => `${withNext(run)} 無王時一樣要跟領出花色；沒有的話只能墊牌，其他花色點數再大也贏不了。`,
    next: "下一幕：說到做到",
    retry: "再出一次",
  },
  last: {
    place: "巷口牌店 · 雨停了",
    table: "學：打成（情況 A）",
    skip: "⏩ 快轉到最後一墩。",
    setting: "窗外的雨停了。2♥ 合約，你已經贏了 7 墩，阿禾贏了 5 墩。阿禾把 ♣K 放上桌，你最後一張是 ♣A。",
    ask: "「就差一墩了，加油！換你。」",
    hint: "選 ♣A、按「確認出牌」。",
    reply: o => o === "made" ? "「喔！還真的被你打成了！」" : "「哎呀，這局沒打成。」",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      return `${trickWhy(run)} ${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}。` +
        `打成的分數 = 線數 × 10：這手 ${bidLevel(r.bidIndex)} 線就是 ${r.contractPoints} 分；每多贏 1 墩再加 2 分（加倍 ×2、再加倍 ×4）。`;
    },
    next: "情況 B：差一墩",
    retry: "再出一次",
  },
  down: {
    place: "巷口牌店 · 雨停了",
    table: "學：倒約（情況 B）",
    setting: "同樣 2♥，換一個結局：你 7 墩、阿禾 5 墩。最後一墩阿禾先出 ♣A，你最後一張是 ♣K。",
    ask: "「最後一墩，我先出 ♣A。換你。」",
    hint: "選 ♣K、按「確認出牌」。",
    reply: () => "「哎呀，這局差了 1 墩。」",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      return `${trickWhy(run)} ${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}：即使你拿 ${g.tricksWon[ME]} 墩、對手拿 ${g.tricksWon[AHE]} 墩，你仍未達成承諾的 ${r.tricksNeeded} 墩。` +
        `倒約時，對手每少一墩拿 10 分（加倍 ×2、再加倍 ×4）。`;
    },
    retry: "我想再練一下",
  },
};

// ---------------- 一句一句講 ----------------
// 前情很短，最後一句是阿禾的問題；完整的原因放在結果區（explain）

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
      A("「前半場沒有王牌，同花色比點數。我們要想辦法搶到想要的牌。」"),
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
        A(o === "win" ? "「贏的人下一墩先出——我們接著打。」" : "「贏的人下一墩先出，這次是我。我們接著看你贏的那條線怎麼打。」"),
      ];
    },
  },
  grab2: {
    intro: [
      N("接著用 ♣Q 贏的那條線：你拿走了 ♦K，牌堆翻開新的明牌 ♥J。"),
      A("「贏的人下一墩先出，所以這次換你先出。」"),
      A("「翻開的 ♥J 是獎品，不是領出牌——它不決定這墩要跟什麼花色。」"),
      A(LINES.grab2.ask),
    ],
    outro: () => [
      A(LINES.grab2.reply("win")),
      A("「明牌 ♥J 是紅心，但這墩要跟的是你出的花色。」"),
      A("「前半場沒有王牌，搶到的墩也不算合約。牌搶完，才開始叫牌。」"),
    ],
  },
  bid: {
    intro: [
      N("快轉一下：13 次牌搶完了，你們手上各有 13 張。"),
      A("「現在換叫牌了。簡單說，就是先講好你這局打算贏幾墩。」"),
      A(`「像 2♥，就是紅心當王牌，而且你至少要贏 ${NEED} 墩（6＋2）。王牌是什麼，等等教你。」`),
      A("「叫得高，成功的話分數比較多；但沒做到，對手就有分數拿。」"),
      A(LINES.bid.ask),
    ],
    outro: (_o, run) => {
      const g = run.game, bid = g.highestBid >= 0 ? g.highestBid : CONTRACT;
      return [
        A(LINES.bid.reply("contract")),
        A("「好，合約定了。等等可要說到做到！」"),
        A(`「你叫的 ${bidText(bid)} 就是這局的『合約』：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩。」`),
        A("「負責打成合約的人叫『莊家』，就是你；我是『防守方』，由我先出第一張。」"),
      ];
    },
  },
  bid2: {
    intro: [
      A("「再來一次。這次我可不會一直 Pass 喔。」"),
      A(LINES.bid2.ask),
    ],
    outro: (o, run) => [
      A(LINES.bid2.reply(o)),
      A("「還在競叫時可以往上叫；合約一確定，這局就照它打，出牌時不能再改。」"),
      A(o === "defend" ? `「這局我是莊家、要贏 ${tricksNeeded(run.game.highestBid)} 墩；你是防守方——防守方先出第一張。」` : "「你是莊家，我是防守方——防守方先出第一張。」"),
    ],
  },
  follow: {
    intro: [
      N("開始出牌了。合約是 2♥，紅心是王牌。"),
      A("「接下來教你一個很好用的東西，就是王牌！不過先記得：平常要跟著先出的花色出牌。」"),
      N("阿禾放下 ♠A。你手上剩 ♠3 和 ♥2。"),
      A(LINES.follow.ask),
    ],
    outro: () => [
      A(LINES.follow.reply("followed")),
      A("「對方先出什麼花色，你手上有，就一定要跟。王牌很強沒錯，但你還有黑桃的時候，還輪不到它。」"),
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
    ] : [
      A(LINES.ruff.reply("discard")),
      A("「什麼時候王吃、什麼時候留著，就是橋牌好玩的地方。」"),
    ],
  },
  flipA: {
    intro: [
      N("還是紅心當王牌。阿禾先出 ♠K。"),
      N("你手上是 ♦A 和 ♣5：沒有黑桃，也沒有紅心。"),
      A(LINES.flipA.ask),
    ],
    outro: () => [
      A(LINES.flipA.reply("lose")),
      A("「這墩先出的是黑桃，只看黑桃或王牌。♦A 兩個都不是，點數再大也沒用。」"),
    ],
  },
  flipB: {
    intro: [
      A("「同樣兩張牌，這次換你先出。」"),
      N("你手上是 ♦A 和 ♦3；阿禾手上沒有方塊。"),
      A(LINES.flipB.ask),
    ],
    outro: () => [
      A(LINES.flipB.reply("win")),
      A("「同樣兩張牌，改變誰先出，領出花色就不同。」"),
      A("「不是先出的人一定贏，而是先出的人決定跟牌花色。」"),
    ],
  },
  trumps: {
    intro: [
      N("紅心王牌。阿禾先出 ♥9。"),
      A(LINES.trumps.ask),
    ],
    outro: () => [
      A(LINES.trumps.reply("win")),
      A("「同花色比點數；兩張都是王牌，也一樣比點數。」"),
    ],
  },
  nt: {
    intro: [
      N("換一個合約：1NT，無王。"),
      A("「無王就是沒有王牌。我先出 ♣K。」"),
      A(LINES.nt.ask),
    ],
    outro: () => [
      A(LINES.nt.reply("lose")),
      A("「沒有王牌的時候，就只看領出花色。」"),
    ],
  },
  last: {
    intro: [
      N("快轉到最後。窗外的雨停了。"),
      A(`「還記得你剛剛叫的合約嗎？${bidText(CONTRACT)}，要贏 ${NEED} 墩。你已經拿了 7 墩，我 5 墩。」`),
      N("阿禾把 ♣K 放上桌，看著你。"),
      A(LINES.last.ask),
    ],
    outro: (o, run) => {
      const r = run.game.lastResult;
      if (o === "down") return [A(LINES.last.reply("down"))];
      return [
        A(LINES.last.reply("made")),
        ...(r && r.overtricks > 0 ? [A("「還多贏了幾墩，可以喔！」")] : []),
        A(`「你說要 ${r?.tricksNeeded ?? NEED} 墩，就真的拿到 ${r ? run.game.tricksWon[ME] : NEED} 墩，這就叫『打成』。」`),
        A(`「分數是線數乘 10：這手 ${bidLevel(r?.bidIndex ?? CONTRACT)} 線，就是 ${r?.contractPoints ?? 0} 分。多贏一墩再加 2 分。」`),
      ];
    },
  },
  down: {
    intro: [
      A("「同樣 2♥，換一個結局。這次你 7 墩、我 5 墩。」"),
      N("最後一墩，阿禾先出 ♣A。你最後一張是 ♣K。"),
      A(LINES.down.ask),
    ],
    outro: (_o, run) => {
      const g = run.game;
      return [
        A(LINES.down.reply("down")),
        A(`「你拿 ${g.tricksWon[ME]} 墩、我 ${g.tricksWon[AHE]} 墩——你比較多，但你說的是 ${NEED} 墩。」`),
        A(`「少拿的墩叫『倒約』，分數給對手：這次我拿 ${g.lastResult?.points ?? 10} 分。」`),
        A("「好啦，基本上就是這樣！搶牌、叫牌、跟牌、王吃、打成、倒約，你都碰過了。」"),
        N("阿禾把牌收齊，重新洗了一次。"),
        A("「來，要不要真的打一局？我在旁邊提示你。這次我可不會放水喔。」"),
      ];
    },
  },
};
