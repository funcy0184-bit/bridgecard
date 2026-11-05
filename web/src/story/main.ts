// 阿禾的牌店：四幕故事教學的畫面。
// 規則全部交給 script.ts → 正式規則引擎；這裡只負責畫牌桌、放動畫、說台詞、記進度。
// 牌桌只畫「你看得到的」：阿禾的手牌和他摸的暗牌永遠是牌背。
import { SUIT_SYMBOL, bidText, cardText, isRedBid, suitOf, tricksNeeded, Suit } from "../game/cards";
import { GameEvent, TableState } from "../game/game";
import * as fx from "../client/fx";
import {
  ACTS, AHE, CONTRACT, LINES, ME, Outcome, STEPS, StepId, StepRun,
  act, bidMeaning, firstStepOfAct, outcomeOf, replay, settle, start,
} from "./script";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const GOLD = "#F2C46A", BAD = "#FF8A8A", GOOD = "#7FD6A2", MUTED = "#AAB5CC", RED = "#FF9BA8";

// ---------------- 進度（新版儲存鍵：舊的九頁故事進度不會把你帶到錯的地方） ----------------

const KEY = "hb.story.v2";
interface Progress {
  v: 2;
  page: number;
  answers: Partial<Record<StepId, number[]>>;
  seen: Partial<Record<StepId, Outcome[]>>;
  finished: boolean;
}

function loadProgress(): Progress {
  const p: Progress = { v: 2, page: 0, answers: {}, seen: {}, finished: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!s || s.v !== 2) return p;
    if (Number.isInteger(s.page) && STEPS[s.page]) p.page = s.page;
    for (const st of STEPS) {
      const a = s.answers?.[st.id];
      if (Array.isArray(a) && a.every((x: unknown) => Number.isInteger(x)) && replay(st, a)?.done) p.answers[st.id] = a;
      const seen = s.seen?.[st.id];
      if (Array.isArray(seen)) p.seen[st.id] = seen.filter((o: Outcome) => st.outcomes.includes(o));
    }
    p.finished = !!s.finished;
  } catch { /* 存檔壞了就從頭開始 */ }
  return p;
}
const progress = loadProgress();
function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* 無痕模式：這次看完就不記了 */ } }

// ---------------- 目前這一步 ----------------

let run: StepRun = start(STEPS[0]);
let busy = false;           // 動畫播放中：先不收點擊
let selBid = -1;
let retryLine = "";         // 出了不能出的牌：阿禾的提醒
let triedIllegal = false;   // 試過不能出的牌之後，才把不能出的牌變暗
let justFinished = false;
const fresh = new Set<number>();

const view = (): TableState => run.game.viewFor(ME);
const step = () => run.step;

function goto(page: number, scroll = true) {
  page = Math.max(0, Math.min(STEPS.length - 1, page));
  progress.page = page;
  save();
  const st = STEPS[page];
  const ans = progress.answers[st.id];
  run = (ans && replay(st, ans)) || start(st);
  busy = false; selBid = -1; retryLine = ""; triedIllegal = false; justFinished = false;
  fresh.clear();
  render();
  if (scroll) {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    $("title").focus({ preventScroll: true });
  }
}

function retryStep() {
  delete progress.answers[step().id];
  save();
  goto(progress.page, false);
  $("stable").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function restartStory() {
  progress.answers = {};
  progress.seen = {};
  goto(0);
}

function record() {
  const o = outcomeOf(run);
  const id = step().id;
  progress.answers[id] = run.actions.slice();
  if (o) progress.seen[id] = [...new Set([...(progress.seen[id] ?? []), o])];
  if (id === "last") progress.finished = true;
  save();
}

// ---------------- 畫面 ----------------

function render() {
  const st = step(), L = LINES[st.id], A = ACTS[st.act];
  document.title = `${A.no}・${A.title}｜來打橋牌`;
  $("place").textContent = L.place;
  $("actNo").textContent = A.no + (st.id === "follow" ? " · 之一" : st.id === "ruff" ? " · 之二" : "");
  $("title").textContent = A.title;
  $("setting").textContent = L.setting;
  $("progLabel").innerHTML = `第 <b>${st.act + 1}</b> 幕 / ${ACTS.length}`;
  $("progFill").style.width = `${((progress.page + (run.done ? 1 : 0.4)) / STEPS.length) * 100}%`;
  $("tableLabel").textContent = L.table;
  const skip = $("skip");
  skip.hidden = !L.skip;
  skip.textContent = L.skip ?? "";
  renderTable();
  renderNarrator();
  renderContents();
}

function renderTable() {
  const v = view(), st = step();
  $("stable").dataset.step = st.id;
  // 阿禾：只有牌背和張數
  const fan = $("sOppFan");
  const n = Math.min(13, v.oppCount);
  while (fan.children.length > n) fan.lastElementChild!.remove();
  while (fan.children.length < n) fan.appendChild(fx.backEl());
  $("sOppCount").textContent = String(v.oppCount);
  if (st.kind === "bid") renderBidBoard(v); else renderTrickBoard(v);
  renderStat(v);
  renderHand(v);
}

function slot(id: string, card: number, opts: { won?: boolean; empty?: string } = {}) {
  const s = document.createElement("div");
  s.className = "slot" + (card < 0 ? " empty" : "") + (opts.won ? " won" : "");
  s.id = id;
  if (card >= 0) s.appendChild(fx.cardEl(card));
  else if (opts.empty) s.textContent = opts.empty;
  if (opts.won) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "贏"; s.appendChild(t); }
  return s;
}

function figure(caption: string, el: HTMLElement, cls = "") {
  const f = document.createElement("figure");
  f.className = "lab " + cls;
  const c = document.createElement("figcaption");
  c.textContent = caption;
  f.append(c, el);
  return f;
}

function renderTrickBoard(v: TableState) {
  const st = step(), t = run.trick, board = $("sBoard");
  board.replaceChildren();
  const lead = t ? t.lead : v.leadCard;
  const mine = t ? t.follow : -1;
  const won = run.done && t ? t.winner : -1;

  if (st.id === "grab") {
    // 贏家拿的明牌（壓在牌堆上）
    const upEv = run.events.find(e => e.type === "FaceUpTaken");
    const upBox = document.createElement("div");
    upBox.className = "upwrap";
    const pile = document.createElement("div");
    pile.className = "pile";
    pile.id = "pile";
    pile.append(fx.backEl(), fx.backEl());
    upBox.append(pile, slot("slotUp", upEv ? -1 : v.faceUp, { empty: upEv ? (upEv.seat === ME ? "→ 你" : "→ 阿禾") : "" }));
    board.appendChild(figure(upEv ? `明牌 ${cardText(upEv.card)} ${upEv.seat === ME ? "歸你" : "歸阿禾"}` : "贏家拿的明牌", upBox, "up"));
    const rule = document.createElement("div");
    rule.className = "vrule";
    board.appendChild(rule);
  }
  board.appendChild(figure("阿禾出的牌", slot("slotOpp", lead, { won: won === AHE })));
  board.appendChild(figure("你出的牌", slot("slotMe", mine, { won: won === ME, empty: "輪到你" })));

  if (st.id === "last") {
    const need = tricksNeeded(v.highestBid);
    const tally = document.createElement("div");
    tally.className = "tally";
    tally.id = "tallyBox";
    tally.innerHTML = `<span>你的墩數 ／ 目標</span><strong id="tally">${v.myTricks} ／ ${need}</strong><small>阿禾 ${v.oppTricks} 墩</small>` +
      (run.done && v.result ? `<em class="pts">本局 +${v.result.points} 分</em>` : "");
    board.appendChild(tally);
  }
}

function renderBidBoard(v: TableState) {
  const board = $("sBoard");
  board.replaceChildren();
  if (run.actions.length === 0) {
    // 叫品（1～3 線），送出前先解釋
    const box = document.createElement("div");
    box.className = "sbid";
    const grid = document.createElement("div");
    grid.className = "sgrid";
    for (let i = 0; i < 15; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = bidText(i);
      b.dataset.bid = String(i);
      if (isRedBid(i)) b.classList.add("red");
      if (i === CONTRACT) b.classList.add("goal");
      if (i === selBid) b.classList.add("sel");
      b.disabled = busy;
      grid.appendChild(b);
    }
    const mean = document.createElement("p");
    mean.className = "smean";
    mean.id = "sMean";
    mean.innerHTML = selBid >= 0 ? `叫 <b>${bidText(selBid)}</b>：${bidMeaning(selBid)}` : "點一個叫品，這裡會先說它的意思";
    const call = document.createElement("button");
    call.type = "button";
    call.className = "btn gold";
    call.id = "sCall";
    call.textContent = `叫 ${bidText(CONTRACT)}`;
    call.hidden = selBid !== CONTRACT;
    const small = document.createElement("p");
    small.className = "smore";
    small.textContent = "正式對局可以叫到 7 線；叫得越高，要贏的墩越多。";
    box.append(grid, mean, call, small);
    board.appendChild(box);
    return;
  }
  // 叫出去了：叫牌紀錄＋合約
  const plate = document.createElement("div");
  plate.className = "splate";
  const calls = v.auctionCalls.map((c, i) => `<span>${v.auctionSeats[i] === ME ? "你" : "阿禾"} <b class="${c >= 0 && isRedBid(c) ? "red" : ""}">${c >= 0 ? bidText(c) : "Pass"}</b></span>`);
  if (!run.done) calls.push(`<span class="wait">阿禾…</span>`);
  plate.innerHTML = `<div class="auct">${calls.join("<i>→</i>")}</div>`;
  if (run.done && v.declarer >= 0) {
    const need = tricksNeeded(v.highestBid);
    plate.innerHTML +=
      `<div class="big ${isRedBid(v.highestBid) ? "red" : ""}">${bidText(v.highestBid)}</div>` +
      `<div class="who">合約 · ${v.declarer === ME ? "你" : "阿禾"}是莊家 · ${SUIT_SYMBOL[Suit.Hearts]} 是王牌</div>` +
      `<div class="goal" id="goal">目標 ${need} 墩｜目前 ${v.myTricks} 墩</div>` +
      `<div class="lead">由${v.leaderSeat === AHE ? "阿禾" : "你"}先出</div>`;
  }
  board.appendChild(plate);
}

function renderStat(v: TableState) {
  const st = step(), el = $("sStat");
  if (st.id === "grab") el.innerHTML = "搶牌階段 · 沒有王牌，同花色比大小";
  else if (st.id === "bid") el.innerHTML = run.done ? "" : "叫牌階段 · 你先叫";
  else if (st.id === "last") el.innerHTML = `合約 <b class="red">2♥</b> · 你是莊家 · 你 <b>${v.myTricks}</b> : <b>${v.oppTricks}</b> 阿禾`;
  else el.innerHTML = `合約 <b class="red">2♥</b> · 你是莊家 · 紅心是王牌`;
}

function renderHand(v: TableState) {
  const st = step(), box = $("sHand");
  const legal = new Set(v.legal);
  const canPlay = st.kind === "play" && !run.trick && !run.done && !busy && v.legal.length > 0;
  box.classList.toggle("locked", !canPlay);
  box.replaceChildren(...v.hand.map(id => {
    const el = fx.cardEl(id);
    el.setAttribute("role", "button");
    el.tabIndex = canPlay ? 0 : -1;
    const bad = canPlay && !legal.has(id);
    el.classList.toggle("legal", canPlay && legal.has(id) && triedIllegal);
    el.classList.toggle("dim", bad && triedIllegal);
    if (st.id === "bid" && suitOf(id) === Suit.Hearts) el.classList.add("hi");   // 阿禾指著的那排紅心
    if (fresh.has(id)) { el.classList.add("fresh"); fx.popIn(el, 60); }
    el.setAttribute("aria-label", cardText(id) + (bad && triedIllegal ? "（現在不能出）" : ""));
    return el;
  }));
  fresh.clear();
  layoutHand(box, v.hand.length);
  $("handNote").textContent = canPlay ? (triedIllegal ? "變暗的牌現在不能出" : "點一張出牌") : `${v.hand.length} 張`;
}

function layoutHand(box: HTMLElement, n: number) {
  const W = box.clientWidth;
  const cw = parseFloat(getComputedStyle(box).getPropertyValue("--cw")) || 58;
  const gap = 8;
  const step = n > 1 ? Math.min(cw + gap, (W - cw - 4) / (n - 1)) : cw;
  box.style.setProperty("--ov", `${cw - step}px`);
}

// ---------------- 阿禾說 ----------------

function renderNarrator() {
  const st = step(), L = LINES[st.id];
  const o = outcomeOf(run);
  const spoken = $("spoken"), more = $("more"), fb = $("feedback");
  if (run.done && o) {
    spoken.textContent = L.reply(o);
    more.textContent = L.more?.(o) ?? "";
    more.className = "more";
    fb.className = "ok";
    fb.replaceChildren(document.createTextNode(L.explain(run, o)));
    if (L.tried) {
      const t = document.createElement("span");
      t.className = "tried";
      t.textContent = L.tried(progress.seen[st.id] ?? [o]);
      fb.appendChild(t);
    }
  } else if (retryLine) {
    spoken.textContent = retryLine;
    more.textContent = "改出另一張試試。";
    more.className = "hint";
    fb.className = "retry";
    fb.textContent = `對方先出 ${SUIT_SYMBOL[suitOf(run.game.leadCard)]}，你手上還有 ${SUIT_SYMBOL[suitOf(run.game.leadCard)]}，這墩就要跟 ${SUIT_SYMBOL[suitOf(run.game.leadCard)]}。`;
  } else {
    spoken.textContent = L.ask;
    more.textContent = L.hint;
    more.className = "hint";
    if (st.kind === "bid" && selBid >= 0 && selBid !== CONTRACT && L.nudge) {
      fb.className = "retry";
      fb.textContent = `阿禾：${L.nudge}`;
    } else { fb.className = ""; fb.textContent = ""; }
  }
  renderControls(o);
}

function btn(text: string, cls: string, onClick: () => void, arrow = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  if (arrow) b.insertAdjacentHTML("beforeend", ' <span aria-hidden="true">→</span>');
  b.addEventListener("click", onClick);
  return b;
}

function renderControls(o: Outcome | null) {
  const box = $("controls"), st = step(), L = LINES[st.id];
  box.replaceChildren();
  if (run.done && o) {
    if (st.id === "last") {
      const a = document.createElement("a");
      a.className = "s-emph";
      a.href = "/?solo=new";        // 重新發牌，開一局正常的單機對戰
      a.id = "toSolo";
      a.innerHTML = '自己跟電腦打一局 <span aria-hidden="true">→</span>';
      box.append(a, btn(L.retry, "s-minor", restartStory));
    } else {
      box.append(btn(L.next!, "s-emph", () => goto(progress.page + 1), true), btn(L.retry, "s-minor", retryStep));
    }
  }
  if (progress.page > 0) box.appendChild(btn("上一頁", "s-back", () => goto(progress.page - 1)));
}

function renderContents() {
  $("contents").replaceChildren(...ACTS.map((a, i) => {
    const pages = STEPS.filter(s => s.act === i);
    const complete = pages.every(s => progress.answers[s.id]);
    const active = step().act === i;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "book" + (active ? " on" : "") + (complete ? " done" : "");
    if (active) b.setAttribute("aria-current", "step");
    b.innerHTML = `<span class="bi${i < 2 ? " r" : ""}" aria-hidden="true">${a.symbol}</span>` +
      `<span class="bt"><b>${a.no}・${a.title}</b><small>${a.sub}</small></span>` +
      `<span class="bm" aria-label="${complete ? "已完成" : "前往"}">${complete ? "✓" : "›"}</span>`;
    b.addEventListener("click", () => goto(firstStepOfAct(i)));
    return b;
  }));
}

function revealNarrator() {
  const r = $("spoken").getBoundingClientRect();
  if (r.bottom > innerHeight - 40 || r.top < 0) $("spoken").scrollIntoView({ block: "center", behavior: fx.settings.speed === 2 ? "auto" : "smooth" });
}

// ---------------- 出牌 ----------------

const anchor = (who: number) => $(who === ME ? "aMe" : "aOpp");

async function onCardTap(id: number, el: HTMLElement) {
  if (busy || step().kind !== "play" || run.trick || run.done) return;
  const r = act(run, id);
  if (!r.ok) {
    if (r.events.some(e => e.type === "Illegal")) {
      fx.deny(el);
      fx.buzz(50);
      fx.popup(`要先跟 ${SUIT_SYMBOL[suitOf(run.game.leadCard)]}！`, $("aMe"), { size: 24, color: BAD, flags: ["pop", "shake"], hold: 500 });
      retryLine = LINES[step().id].illegal ?? "「這張現在不能出。」";
      triedIllegal = true;
      renderHand(view());
      renderNarrator();
    }
    return;
  }
  busy = true;
  retryLine = "";
  fx.buzz(10);
  renderNarrator();
  // 1. 從手上飛到「你出的牌」
  const from = el.getBoundingClientRect();
  const to = $("slotMe").getBoundingClientRect();
  el.style.visibility = "hidden";
  const flying = fx.cardEl(id);
  await fx.fly(flying, from, to, { dur: 320 });
  renderTable();
  flying.remove();
  const mine = $("slotMe").firstElementChild;
  if (mine) fx.punch(mine, 0.12, 240);
  const ruff = r.events.some(e => e.type === "CardPlayed" && e.extra === 1);
  if (ruff) {
    fx.popup("王吃！", $("aMe"), { size: 60, color: GOLD, flags: ["pop", "shake"], hold: 800, delay: 120 });
    setTimeout(() => fx.shakeScreen(14, 320), fx.ms(180));
    fx.buzz([30, 40, 70]);
  }
  await fx.wait(fx.ms(ruff ? 900 : 600));
  // 2. 結算這一墩
  const evs = settle(run);
  await animateSettle(evs);
  record();
  busy = false;
  render();
  if (justFinished) { const t = document.getElementById("tally"); if (t) fx.punch(t, 0.3, 420); }
  revealNarrator();
}

async function animateSettle(evs: GameEvent[]) {
  const won = evs.find(e => e.type === "TrickWon");
  if (won) {
    const card = $(won.seat === ME ? "slotMe" : "slotOpp").firstElementChild as HTMLElement | null;
    if (card) { fx.glow(card, 700); fx.punch(card, 0.18, 320); }
  }
  const up = evs.find(e => e.type === "FaceUpTaken");
  if (up) {
    // 明牌飛向贏家；輸的人從牌堆摸一張牌背
    const meWon = up.seat === ME;
    const upCard = document.querySelector<HTMLElement>("#slotUp .card");
    const dest = (meWon ? $("sHand") : $("sOppFan")).getBoundingClientRect();
    const c = fx.center(dest);
    if (upCard) {
      const r = upCard.getBoundingClientRect();
      const clone = upCard.cloneNode(true) as HTMLElement;
      fx.pin(clone, r);
      upCard.style.visibility = "hidden";
      fx.glow(clone, 600);
      setTimeout(() => {
        fx.fly(clone, r, fx.rectAt(c.x, meWon ? dest.top + 40 : c.y, r.width * 0.8, r.height * 0.8), { dur: 460 }).then(f => f.remove());
      }, fx.ms(320));
    }
    fx.popup(meWon ? `搶到 ${cardText(up.card)}！` : `${cardText(up.card)} 被阿禾拿走`, anchor(up.seat),
      { size: 28, color: meWon ? GOLD : MUTED, flags: meWon ? ["pop", "wave"] : ["pop"], delay: 380 });
    if (meWon) fresh.add(up.card);
    const drew = evs.find(e => e.type === "CardDrawn");
    const pile = document.getElementById("pile");
    if (drew && pile) {
      const r = (pile.lastElementChild ?? pile).getBoundingClientRect();
      const dest2 = (drew.seat === ME ? $("sHand") : $("sOppFan")).getBoundingClientRect();
      const c2 = fx.center(dest2);
      setTimeout(() => {
        fx.fly(fx.backEl(), r, fx.rectAt(c2.x, drew.seat === ME ? dest2.top + 44 : c2.y, 34, 48), { dur: 420, fade: true }).then(f => f.remove());
      }, fx.ms(620));
      if (drew.seat === ME && drew.card >= 0) fresh.add(drew.card);
    }
    await fx.wait(fx.ms(1150));
    return;
  }
  if (won) fx.popup(won.seat === ME ? "+1 墩" : "阿禾 +1 墩", anchor(won.seat), { size: 26, color: won.seat === ME ? GOOD : MUTED, delay: 250 });
  const over = evs.find(e => e.type === "GameOver");
  if (over) {
    justFinished = true;
    const made = over.value >= over.extra;
    fx.popup(made ? "打成！" : `倒 ${over.extra - over.value} 墩`, $("aCenter"),
      { size: 70, color: made ? GOLD : BAD, flags: made ? ["pop", "wave"] : ["pop", "shake"], hold: 1300, delay: 450 });
    const scored = evs.find(e => e.type === "HandScored");
    if (scored) fx.popup(`+${scored.value} 分`, anchor(scored.seat), { size: 36, color: GOLD, flags: ["pop", "wave"], hold: 900, delay: 1100 });
    setTimeout(() => { fx.shakeScreen(10, 360); if (made) fx.confetti(60); }, fx.ms(600));
    fx.buzz(made ? [30, 50, 30, 50, 120] : [220]);
    await fx.wait(fx.ms(1500));
    return;
  }
  await fx.wait(fx.ms(650));
}

// ---------------- 叫牌 ----------------

function selectBid(i: number) {
  if (busy || run.done || run.actions.length) return;
  if (selBid === i && i === CONTRACT) { confirmBid(); return; }   // 同一格點兩次 = 送出（跟正式牌桌一樣）
  selBid = i;
  fx.buzz(8);
  renderTable();
  renderNarrator();
  const b = document.querySelector<HTMLElement>(`#sBoard button[data-bid="${i}"]`);
  if (b) fx.punch(b, 0.15, 200);
}

async function confirmBid() {
  if (busy || selBid !== CONTRACT) return;
  const r = act(run, CONTRACT);
  if (!r.ok) return;
  busy = true;
  fx.popup(bidText(CONTRACT), $("aMe"), { size: 44, color: RED, flags: ["pop"] });
  fx.buzz(15);
  renderTable();
  renderNarrator();
  await fx.wait(fx.ms(950));
  settle(run);
  fx.popup("Pass", $("aOpp"), { size: 30, color: MUTED });
  renderTable();
  await fx.wait(fx.ms(500));
  fx.popup(`合約 ${bidText(CONTRACT)}`, $("aCenter"), { size: 40, color: GOLD, flags: ["pop", "wave"], hold: 1000 });
  const g = document.getElementById("goal");
  if (g) fx.punch(g, 0.12, 320);
  await fx.wait(fx.ms(700));
  record();
  busy = false;
  render();
  revealNarrator();
}

// ---------------- 事件綁定 ----------------

$("sHand").addEventListener("click", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el) onCardTap(Number(el.dataset.id), el);
});
$("sHand").addEventListener("keydown", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onCardTap(Number(el.dataset.id), el); }
});
$("sBoard").addEventListener("click", ev => {
  const t = ev.target as HTMLElement;
  const b = t.closest<HTMLButtonElement>("button[data-bid]");
  if (b && !b.disabled) { selectBid(Number(b.dataset.bid)); return; }
  if (t.closest("#sCall")) confirmBid();
});
$("restart").addEventListener("click", restartStory);
$("navChapters").addEventListener("click", ev => {
  ev.preventDefault();
  $("contentsBox").scrollIntoView({ behavior: "smooth", block: "start" });
  fx.punch($("contents"), 0.03, 300);
});
const notes = $<HTMLDialogElement>("notes");
$("notesBtn").addEventListener("click", () => notes.showModal());
$("notesClose").addEventListener("click", () => notes.close());
notes.addEventListener("click", ev => { if (ev.target === notes) notes.close(); });
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (!busy) layoutHand($("sHand"), view().hand.length); }, 120);
});

// ---------------- 啟動 ----------------

fx.initFx($("fx"), $("stable"));
goto(progress.page, false);
