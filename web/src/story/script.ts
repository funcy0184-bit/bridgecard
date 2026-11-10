// 阿禾的四幕故事（教學）：每一步都是一個固定的牌局（GameSnapshot），
// 玩家出牌、叫牌直接丟進正式的規則引擎 HoneymoonGame —— 能不能出、誰贏這墩、分數多少，
// 都跟連線版／單機版同一套程式算出來，故事裡沒有另外寫一份規則。
// 台詞有分支：玩家的選擇（開場態度、想不想搶、叫多大、加倍怎麼回）會換成不同的反應，但結果一律照引擎算。
//
// 這個檔案不碰畫面（沒有 DOM），測試可以直接跑。
import { Call, Strain, Suit, bidIndex, bidLevel, bidStrain, bidText, cardId, cardText, rankOf, suitOf, tricksNeeded, SUIT_SYMBOL } from "../game/cards";
import { GameEvent, GameSnapshot, HoneymoonGame, Phase } from "../game/game";
import { HandResult, doubledText, madePoints, pointsPerUndertrick } from "../game/scoring";
import { legalPlays, beats } from "../game/rules";
import { whyTrick } from "../game/explain";

const c = cardId;
const { Clubs: CL, Diamonds: DI, Hearts: HE, Spades: SP } = Suit;

export const ME = 0, AHE = 1;
export const CONTRACT = bidIndex(2, Strain.Hearts);   // 2♥：紅心當王，要贏 8 墩
const S2 = bidIndex(2, Strain.Spades);
const NT1 = bidIndex(1, Strain.NoTrump);
const H4 = bidIndex(4, Strain.Hearts);

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

// 出牌練習：你是莊家、阿禾先出（合約、王牌、墩數依每一段設定）
const contractPlay = (bid: number, p: Partial<GameSnapshot>) => snap({
  phase: Phase.Play, trump: bidStrain(bid),
  highestBid: bid, highestBidder: ME, declarer: ME, doubled: 0,
  auction: [{ seat: ME, call: bid }, { seat: AHE, call: Call.Pass }],
  leader: AHE, currentPlayer: ME, firstSeat: ME,
  ...p,
});

export type StepId = "grab" | "grab2" | "bid" | "bid2" | "follow" | "ruff" | "flipA" | "flipB" | "trumps" | "nt" | "last" | "dbl";
export type Outcome = "win" | "lose" | "contract" | "raise" | "defend" | "followed" | "ruff" | "discard" | "made" | "down";

export interface Step {
  id: StepId;
  act: 0 | 1 | 2 | 3;
  kind: "play" | "bid";
  snapshot: GameSnapshot;
  outcomes: Outcome[];           // 這一步所有「都算對」的結果
  tricks?: number;               // 出牌：這一段要打幾墩（預設 1；第四幕打最後兩墩）
  aheCard?: number;              // 你先出時，阿禾回的牌（固定，才能做對照）；沒寫就照「能出的最小那張」
}

// 你手上的 13 張（第二幕兩種情況共用）
const BID_HANDS: [number[], number[]] = [
  [c(SP, 13), c(SP, 8), c(HE, 14), c(HE, 13), c(HE, 12), c(HE, 10), c(HE, 4), c(HE, 2), c(DI, 10), c(DI, 7), c(DI, 3), c(CL, 14), c(CL, 4)],
  [c(SP, 14), c(SP, 12), c(SP, 11), c(SP, 9), c(SP, 5), c(HE, 9), c(HE, 6), c(DI, 14), c(DI, 12), c(DI, 8), c(CL, 13), c(CL, 10), c(CL, 7)],
];
const bidSnap = () => snap({ phase: Phase.Bidding, trump: Strain.NoTrump, currentPlayer: ME, leader: ME, firstSeat: ME, hands: [BID_HANDS[0].slice(), BID_HANDS[1].slice()] });

export const STEPS: Step[] = [
  // 第一幕之一：阿禾翻開 ♦K、出了 ♣9；你手上 ♣Q、♣4、♥3（♥3 不能出：有梅花要跟）。下一張暗牌是 ♠6（輸的人摸）
  { id: "grab", act: 0, kind: "play", outcomes: ["win", "lose"],
    snapshot: snap({ phase: Phase.Draw, trump: Strain.NoTrump, hands: [[c(CL, 12), c(CL, 4), c(HE, 3)], [c(SP, 7), c(DI, 5)]],
      stock: [c(DI, 13), c(SP, 6), c(HE, 11), c(CL, 2)], leader: AHE, currentPlayer: ME, leadCard: c(CL, 9), firstSeat: AHE }) },
  // 第一幕之二：接著用 ♣Q 贏的那條線 → 贏家（你）下一墩先出；新的明牌 ♥J 不決定跟牌花色
  { id: "grab2", act: 0, kind: "play", outcomes: ["win"],
    snapshot: snap({ phase: Phase.Draw, trump: Strain.NoTrump, hands: [[c(CL, 4), c(HE, 3), c(DI, 13)], [c(SP, 7), c(DI, 5), c(SP, 6)]], takenFaceUp: [[c(DI, 13)], []],
      stock: [c(HE, 11), c(CL, 2)], leader: ME, currentPlayer: ME, leadCard: -1, firstSeat: AHE }) },
  // 第二幕之一：你想叫多大？叫低阿禾 Pass；叫 3 線以上阿禾加倍（你可以再加倍或直接打）；你不叫、阿禾也不叫就重發
  { id: "bid", act: 1, kind: "bid", outcomes: ["contract"], snapshot: bidSnap() },
  // 第二幕之二（競叫）：你叫 2♥，阿禾叫 2♠，再輪到你：叫更高或 Pass
  { id: "bid2", act: 1, kind: "bid", outcomes: ["raise", "defend"], snapshot: bidSnap() },
  // 第三幕：2♠（黑桃是王牌）。阿禾出 ♥A，你有 ♥3 和 ♠2 → 有紅心就得跟，不能王吃
  { id: "follow", act: 2, kind: "play", outcomes: ["followed"],
    snapshot: contractPlay(S2, { hands: [[c(HE, 3), c(SP, 2)], [c(DI, 5)]], leadCard: c(HE, 14), tricksWon: [6, 5] }) },
  // 一樣阿禾出 ♥A，這次你沒有紅心：♠2 王吃，或墊 ♣3
  { id: "ruff", act: 2, kind: "play", outcomes: ["ruff", "discard"],
    snapshot: contractPlay(S2, { hands: [[c(SP, 2), c(CL, 3)], [c(DI, 5)]], leadCard: c(HE, 14), tricksWon: [6, 5] }) },
  // 對照 A（2♥，紅心是王牌）：阿禾先出 ♠K，你沒有黑桃也沒有紅心，手上 ♦A ♣5 → ♠K 贏
  { id: "flipA", act: 2, kind: "play", outcomes: ["lose"],
    snapshot: contractPlay(CONTRACT, { hands: [[c(DI, 14), c(CL, 5)], [c(CL, 4)]], leadCard: c(SP, 13), tricksWon: [6, 5] }) },
  // 對照 B：換你先出 ♦A，阿禾沒有方塊，墊 ♠K → ♦A 贏
  { id: "flipB", act: 2, kind: "play", outcomes: ["win"], aheCard: c(SP, 13),
    snapshot: contractPlay(CONTRACT, { hands: [[c(DI, 14), c(DI, 3)], [c(SP, 13), c(CL, 4)]], leader: ME, currentPlayer: ME, leadCard: -1, tricksWon: [6, 5] }) },
  // 都是王牌：阿禾先出 ♥9，你有 ♥Q（一定要跟紅心）→ 比點數
  { id: "trumps", act: 2, kind: "play", outcomes: ["win"],
    snapshot: contractPlay(CONTRACT, { hands: [[c(HE, 12), c(SP, 5)], [c(CL, 6)]], leadCard: c(HE, 9), tricksWon: [6, 5] }) },
  // 無王：1NT，阿禾先出 ♣K，你沒有梅花 → 沒有王吃，出什麼都贏不了
  { id: "nt", act: 2, kind: "play", outcomes: ["lose"],
    snapshot: contractPlay(NT1, { hands: [[c(HE, 14), c(SP, 2)], [c(DI, 5)]], leadCard: c(CL, 13), tricksWon: [6, 5] }) },
  // 第四幕之一：2♥，你 7 墩、阿禾 4 墩，剩兩墩。阿禾出 ♣K，你有 ♣A、♣3：
  //   ♣A → 拿到第 8 墩打成，最後一墩再多拿一墩（超墩）；♣3 → 這墩輸，最後一墩阿禾出 ♦9、你的 ♣A 墊不贏 → 倒一
  { id: "last", act: 3, kind: "play", outcomes: ["made", "down"], tricks: 2,
    snapshot: contractPlay(CONTRACT, { hands: [[c(CL, 14), c(CL, 3)], [c(DI, 9)]], leadCard: c(CL, 13), tricksWon: [7, 4] }) },
  // 第四幕之二：4♥ 被阿禾加倍，你 8 墩、阿禾 3 墩，剩兩墩。阿禾出 ♠Q，你有 ♠K、♠3：
  //   ♠K → 最後兩墩都拿，剛好 10 墩，加倍打成；♠3 → 這墩輸就只剩 9 墩可能，已經打不成，最後是倒二（加倍）
  { id: "dbl", act: 3, kind: "play", outcomes: ["made", "down"], tricks: 2,
    snapshot: contractPlay(H4, { hands: [[c(SP, 13), c(SP, 3)], [c(DI, 5)]], leadCard: c(SP, 12), tricksWon: [8, 3], doubled: 1,
      auction: [{ seat: ME, call: H4 }, { seat: AHE, call: Call.Double }, { seat: ME, call: Call.Pass }] }) },
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
  history: Trick[];           // 這一段已經打完的墩（第四幕打兩墩）
  done: boolean;
  redeal: boolean;            // 叫牌：兩個人一開始都 Pass → 重發（教學裡回到同一手）
}

export function start(step: Step): StepRun {
  const game = HoneymoonGame.restore(step.snapshot);
  const run: StepRun = { step, game, events: [], actions: [], trick: null, history: [], done: false, redeal: false };
  game.on((e, to) => { if (to < 0 || to === ME) run.events.push(e); });
  return run;
}

// 叫牌：這一步現在允許你叫什麼
//   bid：一開始 1～4 線任選或 Pass；被阿禾加倍之後只能再加倍或 Pass
//   bid2：先叫 2♥（照劇本），阿禾叫 2♠ 之後可以叫更高（到 3 線）或 Pass
export const MAX_BID_LEVEL = 4;
export function bidAllowed(run: StepRun, call: number): boolean {
  const g = run.game;
  if (!yourTurnToBid(run)) return false;
  if (run.step.id === "bid2") {
    if (run.actions.length === 0) return call === CONTRACT;
    if (call === Call.Pass) return true;
    return call >= 0 && call > g.highestBid && bidLevel(call) <= 3;
  }
  if (g.doubled === 1 && g.highestBidder === ME) return call === Call.Redouble || call === Call.Pass;
  if (call === Call.Pass) return true;
  return call >= 0 && g.isLegalCall(ME, call) && bidLevel(call) <= MAX_BID_LEVEL;
}
export const yourTurnToBid = (run: StepRun) => run.step.kind === "bid" && !run.done && run.game.phase === Phase.Bidding && run.game.currentPlayer === ME;
export const aheDoubled = (run: StepRun) => run.step.id === "bid" && run.game.phase === Phase.Bidding && run.game.doubled === 1 && run.game.highestBidder === ME;

// 第一段：你出牌／叫牌。不合法就 ok = false（出牌時引擎會發 Illegal 事件）
export function act(run: StepRun, a: number): { ok: boolean; events: GameEvent[] } {
  const before = run.events.length;
  if (run.done) return { ok: false, events: [] };
  const g = run.game;
  let ok = false;
  if (run.step.kind === "play") {
    if (run.trick && run.trick.leader === ME) return { ok: false, events: [] };
    if (run.trick && run.trick.follow >= 0) return { ok: false, events: [] };
    const leading = g.leadCard < 0;
    const lead = g.leadCard;
    ok = g.playCard(ME, a);
    if (ok) run.trick = leading ? { leader: ME, lead: a, follow: -1, winner: -1, ruff: false } : { leader: AHE, lead, follow: a, winner: -1, ruff: false };
  } else {
    ok = bidAllowed(run, a) && g.makeCall(ME, a);
  }
  if (ok) run.actions.push(a);
  return { ok, events: run.events.slice(before) };
}

// 你先出時：阿禾回一張（固定的對照牌，或能出的最小那張）
export const needsReply = (run: StepRun) => run.step.kind === "play" && !!run.trick && run.trick.leader === ME && run.trick.follow < 0;
const lowest = (cards: number[]) => cards.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
export function reply(run: StepRun): GameEvent[] {
  const before = run.events.length;
  if (!needsReply(run)) return [];
  const g = run.game;
  const legal = legalPlays(g.hands[AHE], g.leadCard);
  const want = run.step.aheCard;
  const card = want !== undefined && legal.includes(want) ? want : lowest(legal);
  g.playCard(AHE, card);
  run.trick!.follow = card;
  return run.events.slice(before);
}

// 阿禾在叫牌時怎麼回（照劇本，不是 AI）：
//   bid：你不叫 → 我也不叫（重發）；你叫 3 線以上、還沒被加倍 → 我加倍；其他 → Pass
//   bid2：你先叫 2♥ → 我叫 2♠；之後 → Pass
export function aheCall(run: StepRun): number {
  const g = run.game;
  if (run.step.id === "bid2") return g.auction.some(a => a.seat === AHE) ? Call.Pass : S2;
  if (g.highestBid < 0) return Call.Pass;
  if (g.highestBidder === ME && g.doubled === 0 && bidLevel(g.highestBid) >= 3) return Call.Double;
  return Call.Pass;
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
    run.history.push({ ...run.trick });
    const more = run.history.length < (run.step.tricks ?? 1) && g.phase === Phase.Play;
    if (!more) { run.done = true; return run.events.slice(before); }
    // 還有下一墩：贏的人先出；輪到阿禾先出就照「能出的最小那張」出
    run.trick = null;
    if (g.currentPlayer === AHE) {
      const card = lowest(legalPlays(g.hands[AHE], -1));
      g.playCard(AHE, card);
      run.trick = { leader: AHE, lead: card, follow: -1, winner: -1, ruff: false };
    }
  } else {
    if (g.phase === Phase.Bidding && g.currentPlayer === AHE) g.makeCall(AHE, aheCall(run));
    if (run.events.slice(before).some(e => e.type === "Redeal")) { run.redeal = true; return run.events.slice(before); }
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
    if (run.redeal) return null;
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
    case "last": case "dbl": return g.lastResult?.made ? "made" : "down";
    default: return t!.winner === ME ? "win" : "lose";
  }
}

// 第四幕兩墩的中場：剛打完的那一墩誰贏、現在幾墩、還剩幾墩、還打不打得成（照真的墩數算）
export interface Midway { won: boolean; mine: number; need: number; left: number; reached: boolean; possible: boolean }
export function midway(run: StepRun): Midway | null {
  if (run.done || run.history.length === 0 || run.step.kind !== "play") return null;
  const g = run.game, t = run.history.at(-1)!;
  const need = tricksNeeded(g.highestBid), mine = g.tricksWon[ME], left = 13 - g.tricksWon[ME] - g.tricksWon[AHE];
  return { won: t.winner === ME, mine, need, left, reached: mine >= need, possible: mine + left >= need };
}

// 這一墩為什麼是這個結果（跟正式牌桌同一套說明）
function trickTrump(run: StepRun): number {
  const id = run.step.id;
  return id === "grab" || id === "grab2" ? Strain.NoTrump : (run.game.trump as number);
}
export function trickWhyOf(run: StepRun, t: Trick | null): string {
  if (!t || t.follow < 0 || t.winner < 0) return "";
  const w = whyTrick(t.lead, t.follow, trickTrump(run), t.leader === ME ? "阿禾" : "你");
  return `${t.winner === ME ? "你" : "阿禾"}贏：${w.why}`;
}
export const trickWhy = (run: StepRun) => trickWhyOf(run, run.history.at(-1) ?? run.trick);
export const nextLeader = (run: StepRun) => { const t = run.history.at(-1) ?? run.trick; return t && t.winner >= 0 ? `下一墩由${t.winner === ME ? "你" : "阿禾"}先出。` : ""; };

// 「2♥、沒有加倍、剛好打成，這局 +20 分」—— 數字全部來自計分程式
export function resultLine(r: HandResult): string {
  const how = r.made ? (r.overtricks > 0 ? `多 ${r.overtricks} 墩` : "剛好打成") : `倒 ${r.undertricks} 墩`;
  const who = r.made ? "這局" : "對手";
  return `${bidText(r.bidIndex)}、${r.doubled > 0 ? doubledText(r.doubled) : "沒有加倍"}、${how}，${who} +${r.points} 分`;
}
// 分數怎麼來：只用計分程式的數字
export function scoreLine(r: HandResult): string {
  const mult = r.doubled >= 2 ? "（再加倍 ×4）" : r.doubled === 1 ? "（加倍 ×2）" : "";
  if (r.made) return `合約分 ${bidLevel(r.bidIndex)} 線 × 10${mult ? ` × ${r.doubled >= 2 ? 4 : 2}` : ""} = ${r.contractPoints}` + (r.overtricks ? `，多 ${r.overtricks} 墩 +${r.overtrickPoints}` : "") + `，這局 ${r.points} 分${mult}。`;
  return `倒 ${r.undertricks} 墩 × ${pointsPerUndertrick(r.doubled)} = ${r.points} 分給對手${mult}。`;
}

const SUIT_NAME = ["梅花", "方塊", "紅心", "黑桃"];
// 「紅心當王牌」／「不設王牌（無王）」：無王時絕對不說成哪個花色當王
export const trumpText = (i: number) => bidStrain(i) === Strain.NoTrump ? "不設王牌（無王）" : `${SUIT_NAME[bidStrain(i)]}當王牌`;

// 叫牌送出前的白話：「紅心當王牌，至少要贏 8 墩（6＋2）」
export function bidMeaning(i: number): string {
  if (i === Call.Pass) return "不叫：這次不往上叫";
  if (i === Call.Redouble) return "再加倍：倍率變 ×4，打成拿更多、倒約也賠更多";
  return `${trumpText(i)}，至少要贏 ${tricksNeeded(i)} 墩（6＋${bidLevel(i)}）`;
}

// 你點了某個叫牌，阿禾的反應（叫低穩穩來、叫高嚇一跳、叫無王問你是不是要硬打）
export type BidStyle = "pass" | "low" | "high" | "nt";
export const bidStyle = (i: number): BidStyle => i === Call.Pass ? "pass" : bidStrain(i) === Strain.NoTrump ? "nt" : bidLevel(i) >= 3 ? "high" : "low";
export function bidReaction(i: number): string {
  switch (bidStyle(i)) {
    case "pass": return "「先不叫喔？可以啊，有時候先看看對手怎麼講。」";
    case "nt": return `「欸？不帶王牌？你是想靠實力硬打是不是？${bidText(i)} 要拿 ${tricksNeeded(i)} 墩，而且這局不能靠王吃囉。」`;
    case "high": return `「哦哦哦，這麼敢！叫 ${bidText(i)} 就要真的拿到 ${tricksNeeded(i)} 墩喔。」`;
    default: return `「好，先穩一點。${bidText(i)} 要拿 ${tricksNeeded(i)} 墩，這目標還是得靠你自己打出來。」`;
  }
}

// 這一手能不能王吃：手上沒有對方先出的花色、而且有合約的王牌（用來決定阿禾要不要提示王吃）
export function canRuff(run: StepRun): boolean {
  const g = run.game;
  if (g.leadCard < 0 || g.trump === Strain.NoTrump) return false;
  const hand = g.hands[ME], lead = suitOf(g.leadCard);
  return !hand.some(x => suitOf(x) === lead) && hand.some(x => suitOf(x) === (g.trump as number));
}

// 「我想先比較看看」：在複製出來的牌局上各出一次，看結果；正式的牌局一張牌都沒動
export function preview(run: StepRun): { card: number; winner: number; ruff: boolean; why: string }[] {
  const g = run.game;
  if (g.leadCard < 0 || run.trick) return [];
  return legalPlays(g.hands[ME], g.leadCard).map(card => {
    const lead = g.leadCard;
    const meWins = beats(card, lead, g.trump as number);
    const w = whyTrick(lead, card, g.trump as number, "你");
    return { card, winner: meWins ? ME : AHE, ruff: meWins && suitOf(card) !== suitOf(lead), why: `${meWins ? "你" : "阿禾"}贏：${w.why}` };
  });
}

// 你手上的花色張數與大牌（第二幕「這個我不會」：只看你自己的手牌）
export function handSummary(hand: number[]): string {
  const n = [0, 0, 0, 0];
  for (const x of hand) n[suitOf(x)]++;
  const order = [SP, HE, DI, CL];
  const counts = order.map(s => `${SUIT_SYMBOL[s]} ${n[s]} 張`).join("、");
  const big = hand.filter(x => rankOf(x) >= 12).map(cardText);
  return `你現在：${counts}；大牌有 ${big.length ? big.join(" ") : "沒有"}。`;
}

// ---------------- 四幕 ----------------

export const ACTS = [
  { no: "第一幕", title: "先來搶牌", sub: "搶牌 · 一墩 · 贏家先出", symbol: "♦" },
  { no: "第二幕", title: "這局你敢叫多大？", sub: "叫牌 · 加倍 · 合約與首攻", symbol: "♥" },
  { no: "第三幕", title: "王牌派上用場", sub: "跟牌 · 王吃 · 誰先出", symbol: "♠" },
  { no: "第四幕", title: "說到做到", sub: "打成 · 超墩 · 倒約 · 加倍", symbol: "♣" },
] as const;

export const firstStepOfAct = (act: number) => STEPS.findIndex(s => s.act === act);

// ---------------- 台詞 ----------------
// 阿禾的口氣：像巷口牌店的朋友，偶爾嘴砲、偶爾講幹話；規則一定講對。
// 每一段：情境 → 你的選擇 → 阿禾的反應 → 真的結果 → 原因 → 繼續／重試

export type Emo = "calm" | "smug" | "shock" | "sulk" | "think" | "sigh";
export type Tfx = "fade" | "pop" | "shout";
// 選項：label 是按鈕上的字；card／call 代表「直接幫你選起這張牌／這個叫牌」（之後一樣要按確認）；
// do: "redouble" | "play" 是加倍後的回應（按了就送出）；info 只是想多聽一點，不動牌局
export interface Choice { key: string; label: string; card?: number; call?: number; do?: "redouble" | "play" | "solo" | "chapters"; info?: boolean }
export interface Line { who: "ahe" | "narr"; text: string; cta?: string; emo?: Emo; fx?: Tfx; ask?: string; choices?: Choice[] }
const A = (text: string, o: Partial<Line> = {}): Line => ({ who: "ahe", text, ...o });
const N = (text: string): Line => ({ who: "narr", text });

// 玩家這一路的選擇（開場態度、想不想搶、怎麼叫）：存在進度裡，阿禾之後偶爾會提起
export type Picks = Partial<Record<string, string>>;
export interface Ctx { picks: Picks; egg?: boolean; bidCall?: number }

export interface Lines {
  place: string;
  table: string;                 // 本段要學什麼
  skip?: string;                 // 時間跳轉／換一手的提示
  ask: string;                   // 出牌前：阿禾的問題（每個畫面只問一件事）
  hint: string;                  // 出牌前：一行操作提示
  ask2?: string;                 // 第二墩／叫牌第二輪
  hint2?: string;
  illegal?: (run: StepRun) => string[];   // 選了不能出的牌：阿禾一句一句講
  nudge?: string;                // 叫牌：點了不允許的叫品
  explain: (run: StepRun, o: Outcome) => string;   // 結果區：完整的原因（含下一墩誰先出）
  tried?: (seen: Outcome[]) => string;
  next?: string;
  retry: string;
}

const ct = cardText;
const NEED = tricksNeeded(CONTRACT);
const myDraw = (run: StepRun) => run.events.find(e => e.type === "CardDrawn" && e.seat === ME && e.card >= 0);
const withNext = (run: StepRun) => [trickWhy(run), nextLeader(run)].filter(Boolean).join(" ");
const leadSuit = (run: StepRun) => { const t = run.history.at(-1) ?? run.trick; const lc = t ? t.lead : run.game.leadCard; return lc >= 0 ? suitOf(lc) : -1; };
// 不能出的牌：照真的領出花色講
const illegalLines = (run: StepRun): string[] => {
  const s = suitOf(run.game.leadCard), nm = SUIT_NAME[s];
  return [`「欸欸欸！等等！」`, `「你還有${nm}啦，不能偷跑。」`, `「人家先出${nm}，你有${nm}就要跟。」`];
};

export const LINES: Record<StepId, Lines> = {
  grab: {
    place: "台南 · 下雨的騎樓",
    table: "學：一墩怎麼比、明牌暗牌去哪",
    ask: "「我出 ♣9。換你，出一張。」",
    hint: "選一張牌，按「確認出牌」。",
    illegal: illegalLines,
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
    ask: "「這墩你先出。你出什麼花色，這墩就跟什麼。」",
    hint: "你先出，出哪張都可以。選好按「確認出牌」。",
    explain: run => `${trickWhy(run)} 翻開的明牌 ♥J 只是獎品，不是領出花色。你拿走明牌 ♥J，阿禾摸走最後一張暗牌。牌堆空了，搶牌結束（真正的牌局會搶滿 13 次）。搶牌的墩不算合約，接下來進入叫牌。`,
    next: "下一幕：這局你敢叫多大？",
    retry: "重打這墩",
  },
  bid: {
    place: "巷口牌店 · 茶涼了一點",
    table: "學：叫牌＝說好要贏幾墩；加倍、再加倍",
    skip: "⏩ 快轉：13 次牌搶完了，你們手上各有 13 張。",
    ask: "「你想叫多大？」",
    hint: "點一個叫牌（下面寫著要贏幾墩），送出前會先告訴你它的意思；也可以不叫。",
    ask2: "「我加倍！」",
    hint2: "選「再加倍」、「直接打」，或先問加倍是什麼。",
    nudge: "這一關最多叫到 4 線喔。",
    explain: run => {
      const g = run.game, bid = g.highestBid;
      const d = g.doubled;
      return `${bidText(bid)}${d ? `（${doubledText(d)}）` : ""} 就是這局的「合約」：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩（6＋${bidLevel(bid)}）。` +
        `負責打成合約的人叫「莊家」，就是你；阿禾是防守方。第一墩由防守方（阿禾）先出。` +
        (d ? `被${doubledText(d)}：打成拿 ${madePoints(bid, d)} 分（沒加倍是 ${madePoints(bid, 0)}），每倒一墩對手拿 ${pointsPerUndertrick(d)} 分。` : "") +
        "合約定了，出牌時就不能再改。";
    },
    next: "下一段：對方叫更高",
    retry: "重新叫一次",
  },
  bid2: {
    place: "巷口牌店 · 茶涼了一點",
    table: "學：還在競叫 vs 合約已確定",
    ask: "「同一手牌，你一樣先叫 2♥。」",
    hint: "點 2♥、按「確定叫 2♥」。",
    ask2: "「我叫 2♠。同樣 2 線，叫牌時 ♠ 比 ♥ 高一階。你要叫更高，還是 Pass？」",
    hint2: "點一個比 2♠ 高的叫牌（例如 3♥），或選「不叫 Pass」。叫牌順位 ♣<♦<♥<♠<無王 只用在叫牌，出牌時花色沒有大小。",
    nudge: "要比 2♠ 高才能叫，或是 Pass。",
    explain: (run, o) => {
      const g = run.game, bid = g.highestBid;
      const base = o === "raise"
        ? `合約 ${bidText(bid)}：${trumpText(bid)}，你是莊家，要贏 ${tricksNeeded(bid)} 墩。叫得越高，要贏的墩越多。第一墩由防守方（阿禾）先出。`
        : `合約 ${bidText(bid)}：${trumpText(bid)}，阿禾是莊家、要贏 ${tricksNeeded(bid)} 墩；你是防守方，要阻止他。第一墩由防守方——你——先出。`;
      return base + "競叫中可以一直往上叫；有人叫了、另一個人 Pass，合約就確定，出牌時不能再換。一開始兩個人都 Pass，這手牌重新發。";
    },
    tried: seen => seen.length >= 2 ? "兩種你都試過了：叫更高自己當莊家，或 Pass 讓對方當莊家。" : "也可以按「重新叫一次」，試試另一種選擇。",
    next: "下一幕：王牌派上用場",
    retry: "重新叫一次",
  },
  follow: {
    place: "巷口牌店 · 黑桃是王",
    table: "學：有領出花色就要跟（王牌也一樣）",
    ask: "「我出 ♥A，換你。」",
    hint: "有紅心就要跟紅心。點下面的選項或直接點牌。",
    illegal: () => ["「欸欸欸！！」", "「你還有紅心啊！」", "「不能看到王牌就想直接丟啦。」"],
    explain: run => `${withNext(run)} 對方先出什麼花色，你手上有就一定要跟——這時候黑桃王牌也不能拿出來吃。`,
    next: "換一手：沒有紅心",
    retry: "重來這手",
  },
  ruff: {
    place: "巷口牌店 · 黑桃是王",
    table: "學：沒有領出花色：王吃或墊牌",
    skip: "↻ 換一手試試",
    ask: "「我出 ♥A，換你。」",
    hint: "兩張都能出：♠2 王吃，或墊 ♣3。也可以先比較看看。",
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
    ask: "「你沒有黑桃，倒是有 ♦A。A 比 K 大——出 ♦A 看看？」",
    hint: "選 ♦A、按「確認出牌」。",
    explain: run => `${withNext(run)} 這墩先出的是黑桃，所以只看黑桃，或王牌（紅心）。`,
    next: "換你先出看看",
    retry: "再出一次",
  },
  flipB: {
    place: "巷口牌店 · 紅心是王",
    table: "學：誰先出，就決定領出花色（對照 B）",
    ask: "「這次你先出：出 ♦A。」",
    hint: "選 ♦A、按「確認出牌」。",
    explain: run => `${withNext(run)} 對照：情況 A 阿禾先出 ♠K、你出 ♦A → ♠K 贏；情況 B 你先出方塊、阿禾出 ♠K → 方塊贏。同樣兩張牌，改變誰先出，領出花色就不同。不是先出的人一定贏，而是先出的人決定跟牌花色。`,
    next: "小練習：都是王牌",
    retry: "再出一次",
  },
  trumps: {
    place: "巷口牌店 · 紅心是王",
    table: "學：都是王牌，比點數",
    ask: "「我出 ♥9，是王牌。你手上有紅心，要怎麼出？」",
    hint: "有紅心就要跟紅心。選好按「確認出牌」。",
    illegal: () => ["「等等，你還有紅心。」", "「有領出花色的時候，不能隨便改出別的。」"],
    explain: run => `${withNext(run)} 同花色時，後出的較大牌可以贏；有領出花色時要先跟，不能任意改出王牌或其他花色。`,
    next: "小練習：無王",
    retry: "再出一次",
  },
  nt: {
    place: "巷口牌店 · 無王",
    table: "學：無王沒有王吃",
    ask: "「無王就是沒有王牌。你沒有梅花——這次能王吃嗎？」",
    hint: "選一張、按「確認出牌」看看。",
    explain: run => `${withNext(run)} 無王時一樣要跟領出花色；沒有的話只能墊牌，其他花色點數再大也贏不了。`,
    next: "下一幕：說到做到",
    retry: "再出一次",
  },
  last: {
    place: "巷口牌店 · 雨停了",
    table: "學：打成、超墩、倒約",
    skip: "⏩ 快轉到最後兩墩。",
    ask: "「你該不會真的要打成吧？」",
    hint: "♣A、♣3 都是梅花，兩張都能出。你決定。",
    hint2: "最後一張了，選好按「確認出牌」。",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      const base = `${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}。${scoreLine(r)}`;
      return r.made ? base
        : `${base} 即使你拿 ${g.tricksWon[ME]} 墩、對手拿 ${g.tricksWon[AHE]} 墩，你仍未達成承諾的 ${r.tricksNeeded} 墩。`;
    },
    tried: seen => seen.length >= 2 ? "兩種結局你都看過了：大牌先用，打成還超墩；大牌留太久，最後反而用不到。" : "按「再打一次」，換另一張看看。",
    next: "下一段：被加倍的時候",
    retry: "再打一次",
  },
  dbl: {
    place: "巷口牌店 · 雨停了",
    table: "學：被加倍時打成或倒約",
    ask: "「換你。」",
    hint: "♠K、♠3 都是黑桃，兩張都能出。你決定。",
    hint2: "最後一張了，選好按「確認出牌」。",
    explain: run => {
      const g = run.game, r = g.lastResult!;
      return `${resultLine(r)}。最後是 ${g.tricksWon[ME]} 比 ${g.tricksWon[AHE]}，要 ${r.tricksNeeded} 墩。${scoreLine(r)}`;
    },
    tried: seen => seen.length >= 2 ? "兩種你都看過了：被加倍打成，分數翻倍；被加倍倒約，賠的也翻倍。" : "按「再打一次」，換另一張看看。",
    retry: "再打一次",
  },
};

// ---------------- 一句一句講 ----------------
// 前情很短，最後一句是阿禾的問題；有 choices 的那句會出現選項，選了就插入那個選項的回應

const ATT: Choice[] = [{ key: "newbie", label: "完全不會。" }, { key: "some", label: "知道一點點。" }, { key: "pro", label: "我超強，來啊。" }];
const GRAB: Choice[] = [{ key: "go", label: "搶啊，當然搶！" }, { key: "keep", label: "先不要，留牌比較重要。" }, { key: "how", label: "等等，到底怎麼搶？", info: true }];
const PLAN: Choice[] = [{ key: "go", label: "我覺得可以拚一下。" }, { key: "pass", label: "我先不叫。", call: Call.Pass }, { key: "help", label: "等等，這個我不會。" }];
const DBL: Choice[] = [{ key: "rdbl", label: "再加倍！", do: "redouble" }, { key: "play", label: "好，直接打。", do: "play" }, { key: "what", label: "等等，加倍什麼意思？", info: true }];
const FOLLOW: Choice[] = [{ key: "ok", label: "出 ♥3。", card: c(HE, 3) }, { key: "ruff", label: "出 ♠2 王吃。", card: c(SP, 2) }, { key: "why", label: "等等，為什麼不能亂出？", info: true }];
const RUFF: Choice[] = [{ key: "ruff", label: "出 ♠2 王吃。", card: c(SP, 2) }, { key: "discard", label: "出 ♣3。", card: c(CL, 3) }, { key: "compare", label: "我想先比較看看。", info: true }];
const EGG: Choice[] = [{ key: "huh", label: "蛤？你在講什麼？" }];
const END: Choice[] = [{ key: "play", label: "來啊，打一場！", do: "solo" }, { key: "more", label: "我還想再練一下。", do: "chapters" }, { key: "cheat", label: "你剛剛是不是偷放水？", info: true }];

export const ASKS: Record<string, Choice[]> = { attitude: ATT, grab: GRAB, plan: PLAN, dbl: DBL, follow: FOLLOW, ruff: RUFF, egg: EGG, end: END };

// 選了某個選項之後，阿禾怎麼回（只講話；牌、叫牌一律照引擎）
export function answer(ask: string, key: string, run: StepRun, ctx: Ctx): Line[] {
  switch (`${ask}:${key}`) {
    case "attitude:newbie": return [A("「沒事，我一開始也不會。」"), A("「呃，好像是廢話。」", { emo: "sigh" }), A("「來啦，打一場比較快。」")];
    case "attitude:some": return [A("「哦？有底子喔。」", { emo: "think" }), A("「那我就不客氣了。」", { emo: "smug" }), A("「開玩笑的，先教你怎麼搶牌。」")];
    case "attitude:pro": return [A("「真的假的？」", { emo: "shock", fx: "pop" }), A("「好，那我先相信你。」"), A("「等等輸了不要哭喔。」", { emo: "smug" })];
    case "grab:go": return [A("「有野心喔。」", { emo: "smug" }), A("「來，看看你要出哪張。」")];
    case "grab:keep": return [A("「哦？走保守路線？」", { emo: "think" }), A("「也行啦，不是每張都值得拚。」")];
    case "grab:how": return [A("「欸很簡單啦。」"), A("「我們一人出一張，贏的人拿明牌。」"), A("「輸的人也有牌，只是得摸暗的。」"), A("「所以你想拿這張，就得想辦法贏這墩。前半場沒有王牌，同花色比點數。」")];
    case "plan:go": return [A("「哦？有信心欸。」", { emo: "shock" }), A("「叫 N 線就是要贏 N＋6 墩，花色就是王牌；NT 是無王。下面每一格都寫著要贏幾墩。」")];
    case "plan:pass": return [A("「先不叫喔？」", { emo: "think" }), A("「可以啊，有時候先看看對手怎麼講。」")];
    case "plan:help": return [A("「好啦，我教你看。」"), A("「你先看看哪個花色比較多，有沒有幾張大牌。」"),
      A(`「${handSummary(run.game.hands[ME])}」`), A("「但花色多不代表一定贏，這個等等你打就知道。想好就叫，不叫也行。」")];
    case "dbl:rdbl": return [A("「蛤！！！」", { emo: "shock", fx: "shout" }), A("「你認真的？」"), A("「好好好，這局有意思了。」", { emo: "smug" })];
    case "dbl:play": return [A("「好，那就來吧。」"), A("「看誰比較會打。」", { emo: "smug" })];
    case "dbl:what": {
      const bid = run.game.highestBid;
      return [A("「簡單講，就是這局風險變大了。」"), A("「你打成會拿更多分，但沒做到也更傷。」"),
        A(`「像你這個 ${bidText(bid)}：沒加倍打成 ${madePoints(bid, 0)} 分，加倍變 ${madePoints(bid, 1)}、再加倍變 ${madePoints(bid, 2)}。倒一墩，本來我拿 ${pointsPerUndertrick(0)}，加倍變 ${pointsPerUndertrick(1)}、再加倍 ${pointsPerUndertrick(2)}。」`)];
    }
    case "follow:ruff": return LINES.follow.illegal!(run).map(t => A(t, { emo: "shock", fx: "pop" }));
    case "follow:why": return [A("「因為我先出的是紅心。」"), A("「你手上還有紅心，就要跟紅心。」"), A("「等你真的沒有紅心，才可以出其他花色。」")];
    case "ruff:compare": return [...preview(run).map(p => A(`「出 ${ct(p.card)}：${p.why}」`, { emo: "think" })), A("「這只是看看，還沒出喔。你選哪個？」")];
    case "egg:huh": return [A("「沒事，我突然想到。」", { emo: "sigh" }), A("「來，下一關。」")];
    case "end:cheat": return [A("「我？放水？」", { emo: "shock", fx: "pop" }), A("「你想太多了。」", { emo: "smug" }), A("「……好啦，有一點點。」", { emo: "sigh" })];
  }
  return [];
}

// 開場態度：之後阿禾偶爾提一下
const recall = (ctx: Ctx, pro: string, newbie: string): Line[] =>
  ctx.picks.attitude === "pro" ? [A(pro, { emo: "smug" })] : ctx.picks.attitude === "newbie" ? [A(newbie)] : [];

export interface Talk {
  intro: (ctx: Ctx) => Line[];
  mid?: (run: StepRun, ctx: Ctx) => Line[];                 // 兩墩的段落：第一墩打完（最後一句是下一個問題）
  outro: (o: Outcome, run: StepRun, ctx: Ctx) => Line[];
}

export const TALK: Record<StepId, Talk> = {
  grab: {
    intro: () => [
      N("外面下著雨。你收起傘，走進巷口一間小小的牌店。"),
      A("「欸！新來的喔？」", { emo: "shock", fx: "pop" }),
      A("「會打橋牌嗎？」", { ask: "attitude", choices: ATT }),
      N("阿禾把茶杯挪開，從牌堆翻開一張 ♦K，又從手裡出了 ♣9。"),
      A("「喔，這張不錯欸。」", { emo: "think" }),
      A("「想不想把它搶走？」", { ask: "grab", choices: GRAB }),
      A(LINES.grab.ask),
    ],
    outro: (o, run, ctx) => {
      const drew = myDraw(run);
      const g = ctx.picks.grab;
      const first: Line[] = o === "win"
        ? g === "keep" ? [A("「欸，不是說要保守？」", { emo: "shock", fx: "pop" }), A("「嘴巴說不要，手倒是很誠實。這張歸你。」", { emo: "sulk" })]
          : [A("「哦哦哦！漂亮！」", { emo: "shock", fx: "pop" }), A("「好，這張歸你。」", { emo: "sulk" })]
        : g === "keep" ? [A("「這張你沒拿到，不過大牌還留在手上。」", { emo: "think" }), A("「值不值得，就看你後面怎麼打。」")]
          : g === "go" ? [A("「欸嘿，這張我拿走啦。」", { emo: "smug" }), A("「不是想搶就一定搶得到喔。」", { emo: "smug" })]
            : [A("「欸嘿，這張我拿走啦。」", { emo: "smug" })];
      return [
        ...first,
        A("「一人出一張、比一次大小，這就叫一墩。」"),
        A(o === "win"
          ? "「這墩我輸了，所以換我從牌堆摸一張暗牌，只有我看得到喔。」"
          : `「你輸了，從牌堆摸一張暗牌：${drew ? `你摸到 ${ct(drew.card)}，` : ""}${ct(c(CL, 12))} 也還留著。」`),
        A(o === "win" ? "「贏的人下一墩先出——我們接著打。」" : "「贏的人下一墩先出，這次是我。我們接著看你贏的那條線怎麼打。」"),
      ];
    },
  },
  grab2: {
    intro: () => [
      N("接著用 ♣Q 贏的那條線：你拿走了 ♦K，牌堆翻開新的明牌 ♥J。"),
      A("「贏的人下一墩先出，所以這次換你。」"),
      A("「翻開的 ♥J 是獎品，不是領出牌——它不決定這墩要跟什麼花色。」"),
      A(LINES.grab2.ask),
    ],
    outro: (_o, run, ctx) => {
      const t = run.history.at(-1)!;
      const followed = suitOf(t.follow) === suitOf(t.lead);
      return [
        A(followed ? `「我有${SUIT_NAME[suitOf(t.lead)]}，可惜比你小。這墩你的。」` : "「我沒有你出的那個花色，只好墊一張。這墩你的。」", { emo: "sigh" }),
        A("「明牌 ♥J 是紅心，但這墩要跟的是你出的花色。」"),
        A("「好，大概就是這樣。」"),
        A("「贏了拿明牌，輸了摸暗牌。前半場沒有王牌，搶到的墩也不算合約。」"),
        A("「搶到好牌當然爽，但也別把大牌全部亂丟。」"),
        ...(ctx.egg ? [A("「今天就是明天的昨天。」", { emo: "think", ask: "egg", choices: EGG })] : []),
      ];
    },
  },
  bid: {
    intro: ctx => [
      N("快轉一下：13 次牌搶完了，你們手上各有 13 張。"),
      A("「好，牌搶完了。」"),
      A("「來，看看你現在有多大的本錢。」"),
      ...recall(ctx, "「你不是說你超強？這關應該難不倒你吧。」", "「別緊張，叫錯也不會怎樣，這裡是練習。」"),
      A("「這局你覺得自己能贏幾墩？」", { ask: "plan", choices: PLAN }),
      A(LINES.bid.ask),
    ],
    outro: (_o, run) => {
      const g = run.game, bid = g.highestBid;
      const d = g.doubled;
      return [
        A("「好，合約就這樣定了。」"),
        A("「剛剛講得很大聲，等等可別軟掉喔。」", { emo: "smug" }),
        A(`「你叫的 ${bidText(bid)} 就是這局的『合約』：${trumpText(bid)}，你要贏到 ${tricksNeeded(bid)} 墩。」`),
        ...(d ? [A(`「而且被${doubledText(d)}了：打成拿 ${madePoints(bid, d)} 分，倒一墩我拿 ${pointsPerUndertrick(d)} 分。」`, { emo: d >= 2 ? "shock" : "smug" })] : []),
        A("「負責打成合約的人叫『莊家』，就是你；我是『防守方』，由我先出第一張。」"),
      ];
    },
  },
  bid2: {
    intro: () => [
      A("「再來一次。這次我可不會一直 Pass 喔。」", { emo: "smug" }),
      A(LINES.bid2.ask),
    ],
    outro: (o, run) => [
      A(o === "raise" ? "「好啦好啦，你叫得比我高，我 Pass。合約定了。」" : "「你 Pass，那就照我的 2♠。合約定了。」", { emo: o === "raise" ? "sulk" : "smug" }),
      A("「還在競叫時可以往上叫；合約一確定，這局就照它打，出牌時不能再改。」"),
      A(o === "defend" ? `「這局我是莊家、要贏 ${tricksNeeded(run.game.highestBid)} 墩；你是防守方——防守方先出第一張。」` : "「你是莊家，我是防守方——防守方先出第一張。」"),
    ],
  },
  follow: {
    intro: ctx => [
      N("開始出牌。這次練習的合約是 2♠——黑桃是王牌。"),
      A("「來，接下來教你一招很煩的。」"),
      A("「王吃。」", { fx: "pop" }),
      A("「尤其被別人王吃的時候，真的會很想翻桌。」", { emo: "sulk" }),
      ...recall(ctx, "「超強的人應該早就會了吧？那就當複習。」", "「完全不會的人，現在已經在學王吃了欸。」"),
      N("阿禾放下 ♥A。你手上剩 ♥3 和 ♠2。"),
      A(LINES.follow.ask, { ask: "follow", choices: FOLLOW }),
    ],
    outro: () => [
      A("「對！先跟紅心。」"),
      A("「這墩雖然輸了，但規則就是這樣。」"),
      A("「對方先出什麼花色，你手上有，就一定要跟。黑桃王牌很強沒錯，但你還有紅心的時候，還輪不到它。」"),
    ],
  },
  ruff: {
    intro: () => [
      A("「同一張 ♥A，我們換一手牌看看。」"),
      N("這次你手上是 ♠2 和 ♣3，一張紅心都沒有。"),
      A(LINES.ruff.ask, { ask: "ruff", choices: RUFF }),
    ],
    outro: (o, run) => {
      const t = run.history.at(-1)!;
      return o === "ruff" ? [
        A("「靠！！！！」", { emo: "shock", fx: "shout" }),
        A("「不是欸！」", { emo: "shock" }),
        A(`「我${SUIT_NAME[suitOf(t.lead)]} ${ct(t.lead).slice(1)} 被你${SUIT_NAME[suitOf(t.follow)]} ${ct(t.follow).slice(1)} 吃掉？」`, { emo: "sulk", fx: "pop" }),
        A("「哭啊，你這樣打我要怎麼贏！」", { emo: "sulk", fx: "shout" }),
        A("「對啦，這就叫王吃。」"),
        A(`「沒${SUIT_NAME[suitOf(t.lead)]}的時候，${SUIT_NAME[run.game.trump as number]}王牌就可以派上用場。」`),
      ] : [
        A(`「可以，因為你已經沒有${SUIT_NAME[suitOf(t.lead)]}了。」`),
        A("「不過這張不是王牌，這墩就不會被你搶走。」", { emo: "smug" }),
        A("「你的 ♠2 還留著，等更需要的時候再用。」"),
      ];
    },
  },
  flipA: {
    intro: () => [
      N("換回 2♥：紅心當王牌。阿禾先出 ♠K。"),
      N("你手上是 ♦A 和 ♣5：沒有黑桃，也沒有紅心。"),
      A(LINES.flipA.ask, { emo: "smug" }),
    ],
    outro: () => [
      A("「♠K 贏。不是 A 不夠大，是 ♦A 不是黑桃。」", { emo: "smug" }),
      A("「這墩先出的是黑桃，只看黑桃或王牌。♦A 兩個都不是，點數再大也沒用。」"),
    ],
  },
  flipB: {
    intro: () => [
      A("「同樣兩張牌，這次換你先出。」"),
      N("你手上是 ♦A 和 ♦3；阿禾手上沒有方塊。"),
      A(LINES.flipB.ask),
    ],
    outro: () => [
      A("「這次你的方塊贏。我沒有方塊，只好墊 ♠K。」", { emo: "sigh" }),
      A("「同樣兩張牌，改變誰先出，領出花色就不同。」"),
      A("「不是先出的人一定贏，而是先出的人決定跟牌花色。」"),
    ],
  },
  trumps: {
    intro: () => [
      N("紅心王牌。阿禾先出 ♥9。"),
      A(LINES.trumps.ask),
    ],
    outro: () => [
      A("「都是王牌，比點數：你的 ♥Q 比我的 ♥9 大。」", { emo: "sigh" }),
      A("「同花色比點數；兩張都是王牌，也一樣比點數。」"),
    ],
  },
  nt: {
    intro: () => [
      N("換一個合約：1NT，無王。"),
      A("「無王就是沒有王牌。我先出 ♣K。」"),
      A(LINES.nt.ask),
    ],
    outro: () => [
      A("「無王沒有王吃：你沒有梅花，出什麼都贏不了 ♣K。」", { emo: "smug" }),
      A("「沒有王牌的時候，就只看領出花色。」"),
      A("「看到沒，王牌很煩吧。」"),
      A("「但也別太早全部用光。」"),
      A("「不然等你真的需要的時候，就只能在那邊哭。」", { emo: "smug" }),
    ],
  },
  last: {
    intro: ctx => [
      N("快轉到最後。窗外的雨停了。"),
      A("「好啦，最後一關。」"),
      A("「還記得你剛剛叫多大嗎？」", { emo: "think" }),
      ...(ctx.bidCall !== undefined && ctx.bidCall >= 0 && ctx.bidCall !== CONTRACT
        ? [A(`「你剛剛叫的是 ${bidText(ctx.bidCall)}。這關先用 ${bidText(CONTRACT)} 來算，道理一樣。」`)]
        : [A(`「${bidText(CONTRACT)}：紅心當王牌，要贏 ${NEED} 墩。」`)]),
      A("「現在就看你到底有沒有料。」", { emo: "smug" }),
      N(`你已經拿 7 墩、阿禾 4 墩，還剩兩墩。阿禾放下 ♣K；你手上是 ♣A 和 ♣3。`),
      A("「欸欸欸，還差一墩！」", { emo: "shock", fx: "pop" }),
      A(LINES.last.ask),
    ],
    mid: run => {
      const m = midway(run)!;
      return m.won
        ? [A("「哦哦哦哦哦！！！」", { emo: "shock", fx: "shout" }), A("「居然！！！！」", { emo: "shock", fx: "shout" }), A("「不是，你真的打成了？」", { emo: "shock" }), A("「好啦，算你厲害。」", { emo: "sulk" }),
          A(`「${m.mine} 墩到手。最後一張也出吧，看能不能多拿。」`)]
        : [A("「呼，這墩還好被我拿到。」", { emo: "smug" }),
          A(m.reached ? "「不過你已經達標了。」" : m.possible ? `「還剩 ${m.left} 墩，你還差 ${m.need - m.mine} 墩——拿到就打成。」` : `「剩 ${m.left} 墩、你還差 ${m.need - m.mine} 墩，這局已經打不成了。」`),
          A(`「我出 ${ct(run.trick!.lead)}，換你。」`)];
    },
    outro: (o, run) => {
      const g = run.game, r = g.lastResult!;
      if (o === "made") return [
        ...(r.overtricks > 0 ? [A("「欸，還多拿喔？」", { emo: "shock" }), A("「你是不是太貪心了。」", { emo: "sulk" }), A("「好啦，這些也會算分。」")] : [A("「好啦，打成就是打成。」", { emo: "sigh" })]),
        A(`「你說要 ${r.tricksNeeded} 墩，結果拿到 ${g.tricksWon[ME]} 墩，這就叫『打成』。」`),
        A(`「${scoreLine(r)}」`),
      ];
      return [
        ...(r.undertricks === 1 ? [A("「哭啊，就差一墩！」", { emo: "smug", fx: "pop" })] : [A("「哎呀，沒打成。」"), A("「這次真的叫太高了啦。」", { emo: "smug" })]),
        A("「♣A 留到最後，結果被我的方塊閃過去，墊了也贏不了。」"),
        A(`「你拿 ${g.tricksWon[ME]} 墩、我 ${g.tricksWon[AHE]} 墩——你比較多，但你說的是 ${r.tricksNeeded} 墩。」`),
        A(`「少拿的墩叫『倒約』，分數給對手：這次我拿 ${r.points} 分。」`, { emo: "smug" }),
      ];
    },
  },
  dbl: {
    intro: () => [
      A("「再來一局狠的。」", { emo: "smug" }),
      N("合約 4♥，被阿禾加倍了。你要贏 10 墩，現在 8 墩、阿禾 3 墩，還剩兩墩。"),
      A("「我都加倍了，你最好是打得成啦。」", { emo: "smug" }),
      N("阿禾放下 ♠Q；你手上是 ♠K 和 ♠3。"),
      A(LINES.dbl.ask),
    ],
    mid: run => {
      const m = midway(run)!;
      return m.won
        ? [A("「欸……等等。」", { emo: "think" }), A(`「你 ${m.mine} 墩了，還差 ${m.need - m.mine} 墩喔，不要太早高興。」`), A("「出吧。」")]
        : [A("「呼，這墩我拿了。」", { emo: "smug" }),
          A(m.possible ? `「還剩 ${m.left} 墩，你還差 ${m.need - m.mine} 墩。」` : `「剩 ${m.left} 墩、你還差 ${m.need - m.mine} 墩——這局已經打不成了。最後一墩還是要打完。」`),
          A(`「我出 ${ct(run.trick!.lead)}，換你。」`)];
    },
    outro: (o, run) => {
      const r = run.game.lastResult!;
      const end = [
        A("「好啦，大概就是這樣。」"),
        A("「現在你應該知道怎麼打了。」"),
        A("「但知道規則跟真的會打，是兩回事喔。」", { emo: "smug", ask: "end", choices: END }),
      ];
      if (o === "made") return [
        A("「不是吧……」", { emo: "shock" }),
        A("「我都加倍了你還打成？」", { emo: "shock", fx: "pop" }),
        A("「你是不是專門來砸我店的。」", { emo: "sulk" }),
        A(`「${scoreLine(r)}」`),
        ...end,
      ];
      return [
        A("「哎呀，這下比較痛了。」"),
        A("「被加倍還沒打成，分數就送出去了。」"),
        A(`「${scoreLine(r)}」`),
        A("「不過沒事，下一局繼續拚。」"),
        ...end,
      ];
    },
  },
};

// 兩個人都不叫：重發（教學裡發回同一手，讓你再選一次）
export const REDEAL_LINES: Line[] = [
  A("「蛤，我們兩個都不叫？」", { emo: "shock" }),
  A("「好啦，重發一局。」", { emo: "sigh" }),
  N("阿禾把牌收回去洗了洗，又發了一次。"),
  A("「……欸怎麼又是同一手？算了，就當你運氣好。」", { emo: "think" }),
];
// 阿禾加倍（你叫 3 線以上）
export const DOUBLE_LINES: Line[] = [
  A("「欸，我覺得你這局做不到喔。」", { emo: "smug" }),
  A(LINES.bid.ask2!, { emo: "smug", fx: "shout", ask: "dbl", choices: DBL }),
];
