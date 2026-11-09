// 阿禾的牌店：四幕故事教學的畫面。
// 規則全部交給 script.ts → 正式規則引擎；這裡只負責畫牌桌、放動畫、說台詞、記進度。
// 牌桌只畫「你看得到的」：阿禾的手牌和他摸的暗牌永遠是牌背。
import { SUIT_SYMBOL, bidText, cardText, isRedBid, suitOf, tricksNeeded, Suit } from "../game/cards";
import { GameEvent, Phase, TableState } from "../game/game";
import * as fx from "../client/fx";
import { sfx } from "../client/sound";
import { bidChip, bidTier, contractFeedback, contractSlam } from "../client/feedback";
import { evaluateTrick, playWeight } from "../client/impact";
import { PLAY_T, contact, flightMs, presentImpact, pullUp, slamFly } from "../client/impactfx";
import { burstAt, shower } from "../client/particles";
import { renderSettings } from "../client/settings-ui";
import {
  ACTS, AHE, CONTRACT, LINES, ME, Outcome, STEPS, StepId, StepRun,
  act, bidAllowed, bidMeaning, bidReaction, firstStepOfAct, needsReply, outcomeOf, replay, reply, settle, start, TALK, Line, trumpText, yourTurnToBid,
} from "./script";
import { illegalReason, LEAD_ADVICE, followAdvice } from "../game/explain";
import { Call, Strain, bidLevel } from "../game/cards";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const GOLD = "#F2C46A", BAD = "#FF8A8A", GOOD = "#7FD6A2", MUTED = "#AAB5CC", RED = "#FF9BA8";

// ---------------- 進度（新版儲存鍵：舊的九頁故事進度不會把你帶到錯的地方） ----------------

const KEY = "hb.story.v3";
interface Progress {
  v: 3;
  page: number;
  answers: Partial<Record<StepId, number[]>>;
  seen: Partial<Record<StepId, Outcome[]>>;
  finished: boolean;
}

function loadProgress(): Progress {
  const p: Progress = { v: 3, page: 0, answers: {}, seen: {}, finished: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!s || s.v !== 3) return p;
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
const NO_BID = -99;
let selBid = NO_BID;          // 選起來、還沒送出的叫牌（Pass 是 -1，所以「沒選」用 -99）
let retryLine = "";         // 出了不能出的牌：阿禾的提醒
let triedIllegal = false;   // 試過不能出的牌之後，才把不能出的牌變暗
let justFinished = false;
let selCard = -1;           // 選起來、還沒確認的牌
let epoch = 0;              // 換段落就 +1：舊段落的動畫回呼、延遲都作廢
const fresh = new Set<number>();
// 只在「同一段」還有效時才執行（跳過、重播、換章節後，舊的延遲不會跑進新段落）
function later(fn: () => void, ms: number) { const my = epoch; setTimeout(() => { if (my === epoch) fn(); }, ms); }
function clearStage() {
  epoch++;
  clearInterval(typing); typing = 0;
  document.querySelectorAll(".actcard, #fx .popup, #fx .card.flying, #fx .bidchip, #fx .shock").forEach(e => e.remove());
}

// 對話：intro（旁白＋阿禾一句一句帶進來）→ prompt（輪到你）→ outro（阿禾一句一句說明）→ done
type Mode = "intro" | "prompt" | "outro" | "done";
let mode: Mode = "prompt";
let lines: Line[] = [];
let li = 0;
let autoTimer = 0;
let talkLog: Line[] = [];
let shownAct = -1;

const view = (): TableState => run.game.viewFor(ME);
const step = () => run.step;

function goto(page: number, scroll = true, skipIntro = false) {
  page = Math.max(0, Math.min(STEPS.length - 1, page));
  progress.page = page;
  save();
  const st = STEPS[page];
  const ans = progress.answers[st.id];
  clearStage();
  run = (ans && replay(st, ans)) || start(st);
  busy = false; selBid = NO_BID; selCard = -1; retryLine = ""; triedIllegal = false; justFinished = false;
  fresh.clear();
  talkLog = [];
  clearTimeout(autoTimer);
  const o = outcomeOf(run);
  if (run.done && o) {
    // 已經打過：直接看結果（重新整理也回到這裡）
    lines = TALK[st.id].outro(o, run); li = lines.length - 1; mode = "done";
    talkLog = lines.slice();
  } else if (skipIntro) {
    lines = [TALK[st.id].intro.at(-1)!]; li = 0; mode = "prompt";
  } else {
    lines = TALK[st.id].intro; li = 0; mode = lines.length > 1 ? "intro" : "prompt";
  }
  if (st.act !== shownAct && !run.done && !skipIntro) actCard(st.act);
  shownAct = st.act;
  render();
  fx.slideIn($("narrator"), "right");
  if (scroll) {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    $("title").focus({ preventScroll: true });
  }
}

function retryStep() {
  delete progress.answers[step().id];
  save();
  goto(progress.page, false, true);
  $("stable").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function restartStory() {
  progress.answers = {};
  progress.seen = {};
  goto(0);
}

function record() {
  if (!run.done) return;            // 還在競叫中：不算完成（章節打勾只看真的做完的段落）
  const o = outcomeOf(run);
  const id = step().id;
  progress.answers[id] = run.actions.slice();
  if (o) progress.seen[id] = [...new Set([...(progress.seen[id] ?? []), o])];
  if (id === "down") progress.finished = true;
  save();
}

// ---------------- 畫面 ----------------

function render() {
  const st = step(), L = LINES[st.id], A = ACTS[st.act];
  document.title = `${A.no}・${A.title}｜來打橋牌`;
  $("place").textContent = L.place;
  const inAct = STEPS.filter(x => x.act === st.act);
  $("actNo").textContent = A.no + (inAct.length > 1 ? ` · ${inAct.indexOf(st) + 1}／${inAct.length}` : "");
  $("title").textContent = A.title;
  $("setting").textContent = "";        // 場景說明改由旁白一句一句講
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
  // 先出的人：這一墩已經開始就看 trick，還沒開始看牌局（阿禾已經先出了一張，或輪到你先出）
  const aheLeads = t ? t.leader === AHE : v.leadCard >= 0;
  const aheCard = t ? (t.leader === AHE ? t.lead : t.follow) : v.leadCard;
  const myCard = t ? (t.leader === ME ? t.lead : t.follow) : -1;
  const won = run.done && t ? t.winner : -1;

  if (st.id === "grab" || st.id === "grab2") {
    // 獎勵明牌（壓在牌堆上）：贏家拿走；它不決定這墩跟什麼花色
    const upEv = run.events.find(e => e.type === "FaceUpTaken");
    const upBox = document.createElement("div");
    upBox.className = "upwrap";
    const pile = document.createElement("div");
    pile.className = "pile";
    pile.id = "pile";
    pile.append(fx.backEl(), fx.backEl());
    upBox.append(pile, slot("slotUp", upEv ? -1 : v.faceUp, { empty: upEv ? (upEv.seat === ME ? "→ 你" : "→ 阿禾") : "" }));
    board.appendChild(figure(upEv ? `明牌 ${cardText(upEv.card)} ${upEv.seat === ME ? "歸你" : "歸阿禾"}` : "獎品：贏的人拿走", upBox, "up"));
    const rule = document.createElement("div");
    rule.className = "vrule";
    board.appendChild(rule);
  }
  board.appendChild(figure(`阿禾 · ${aheLeads ? "①先出" : "②後出"}`, slot("slotOpp", aheCard, { won: won === AHE, empty: aheLeads ? "" : "② 阿禾" })));
  board.appendChild(figure(`你 · ${aheLeads ? "②後出" : "①先出"}`, slot("slotMe", myCard, { won: won === ME, empty: aheLeads ? "② 換你" : "① 你先出" })));

  if (st.id === "last" || st.id === "down") {
    const need = tricksNeeded(v.highestBid);
    const tally = document.createElement("div");
    tally.className = "tally";
    tally.id = "tallyBox";
    tally.innerHTML = `<span>已贏 ／ 要贏（墩）</span><strong id="tally">${v.myTricks} ／ ${need}</strong><small>阿禾 ${v.oppTricks} 墩</small>` +
      (run.done && v.result ? `<em class="pts">${v.result.made ? "這局" : "阿禾"} +${v.result.points} 分</em>` : "");
    board.appendChild(tally);
  }
}

function renderBidBoard(v: TableState) {
  const board = $("sBoard");
  board.replaceChildren();
  const calls = v.auctionCalls.map((c, i) => `<span>${v.auctionSeats[i] === ME ? "你" : "阿禾"} <b class="${c >= 0 && isRedBid(c) ? "red" : ""}">${c >= 0 ? bidText(c) : "Pass"}</b></span>`);
  if (yourTurnToBid(run) && !busy) {
    // 叫牌格（1～3 線）：還在競叫中；送出前先解釋
    const box = document.createElement("div");
    box.className = "sbid";
    if (calls.length) { const a = document.createElement("div"); a.className = "auct mini"; a.innerHTML = calls.join("<i>→</i>") + "<i>→</i><span class=\"wait\">你…</span>"; box.appendChild(a); }
    const grid = document.createElement("div");
    grid.className = "sgrid";
    for (let i = 0; i < 15; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = bidText(i);
      b.dataset.bid = String(i);
      if (isRedBid(i)) b.classList.add("red");
      if (i === CONTRACT && run.actions.length === 0) b.classList.add("goal");
      if (i === selBid) b.classList.add("sel");
      b.disabled = v.highestBid >= 0 && i <= v.highestBid;          // 一定要比前面叫的高
      grid.appendChild(b);
    }
    const mean = document.createElement("p");
    mean.className = "smean";
    mean.id = "sMean";
    mean.innerHTML = selBid !== NO_BID ? `${selBid >= 0 ? `叫 <b>${bidText(selBid)}</b>` : "<b>不叫 Pass</b>"}：${bidMeaning(selBid)}` : "點一個叫牌，這裡會先告訴你它的意思";
    const call = document.createElement("button");
    call.type = "button";
    call.className = "btn gold";
    call.id = "sCall";
    call.textContent = selBid >= 0 ? `確定叫 ${bidText(selBid)}` : "確定不叫（Pass）";
    call.hidden = !(selBid !== NO_BID && bidAllowed(run, selBid));
    const small = document.createElement("p");
    small.className = "smore";
    const passOk = bidAllowed(run, Call.Pass);
    if (passOk) {
      const pass = document.createElement("button");
      pass.type = "button"; pass.className = "sgridpass" + (selBid === Call.Pass ? " sel" : ""); pass.dataset.bid = String(Call.Pass); pass.textContent = "不叫 Pass";
      small.appendChild(pass);
    } else small.textContent = "正式打的時候最多叫到 7 線；叫得越高，要贏的墩越多。";
    box.append(grid, mean, call, small);
    board.appendChild(box);
    return;
  }
  // 等阿禾／合約已確定：叫牌紀錄＋合約
  const plate = document.createElement("div");
  plate.className = "splate";
  const list = calls.slice();
  if (!run.done) list.push(`<span class="wait">${yourTurnToBid(run) ? "你…" : "阿禾…"}</span>`);
  plate.innerHTML = `<div class="auct">${list.join("<i>→</i>")}</div>`;
  if (run.done && v.declarer >= 0) {
    const need = tricksNeeded(v.highestBid);
    const iDecl = v.declarer === ME;
    plate.innerHTML +=
      `<div class="big ${isRedBid(v.highestBid) ? "red" : ""}">${bidText(v.highestBid)}</div>` +
      `<div class="who">合約確定 · ${iDecl ? "你" : "阿禾"}是莊家 · ${trumpText(v.highestBid)}</div>` +
      `<div class="goal" id="goal">${iDecl ? "你" : "阿禾"}要贏 ${need} 墩｜已贏 ${iDecl ? v.myTricks : v.oppTricks} 墩</div>` +
      `<div class="lead">由${v.leaderSeat === AHE ? "阿禾" : "你"}先出（防守方先出）</div>`;
  } else if (!run.done) plate.innerHTML += `<div class="who">還在競叫中</div>`;
  board.appendChild(plate);
}

function renderStat(v: TableState) {
  const st = step(), el = $("sStat");
  if (st.kind === "bid") { el.innerHTML = run.done ? "" : yourTurnToBid(run) ? "叫牌 · 輪到你叫" : "叫牌 · 等阿禾"; return; }
  if (v.phase === Phase.Draw || st.id === "grab" || st.id === "grab2") { el.innerHTML = "搶牌 · 沒有王牌，同花色比大小 · 不算合約墩數"; return; }
  const iDecl = v.declarer === ME;
  el.innerHTML = `合約 <b class="${isRedBid(v.highestBid) ? "red" : ""}">${bidText(v.highestBid)}</b> · ${iDecl ? "你" : "阿禾"}是莊家 · ${trumpText(v.highestBid)} · 你 <b>${v.myTricks}</b> : <b>${v.oppTricks}</b> 阿禾（墩）`;
}

function renderHand(v: TableState) {
  const st = step(), box = $("sHand");
  const legal = new Set(v.legal);
  const canPlay = st.kind === "play" && !run.trick && !run.done && !busy && mode !== "intro" && v.legal.length > 0;
  box.classList.toggle("locked", !canPlay);
  box.replaceChildren(...v.hand.map(id => {
    const el = fx.cardEl(id);
    el.setAttribute("role", "button");
    el.tabIndex = canPlay ? 0 : -1;
    const bad = canPlay && !legal.has(id);
    el.classList.toggle("legal", canPlay && legal.has(id) && selCard !== id);
    el.classList.toggle("dim", bad);
    el.classList.toggle("sel", canPlay && selCard === id);
    if (st.kind === "bid" && suitOf(id) === Suit.Hearts) el.classList.add("hi");   // 阿禾指著的那排紅心
    if (fresh.has(id)) { el.classList.add("fresh"); fx.popIn(el, 60); }
    el.setAttribute("aria-label", cardText(id) + (bad ? "（還不能出）" : ""));
    return el;
  }));
  fresh.clear();
  layoutHand(box, v.hand.length);
  $("handNote").textContent = canPlay ? (legal.size < v.hand.length ? "亮起來的能出；打叉的還不能出" : "點一張選牌，再按「確認出牌」") : `${v.hand.length} 張`;
}

function layoutHand(box: HTMLElement, n: number) {
  const W = box.clientWidth;
  const cw = parseFloat(getComputedStyle(box).getPropertyValue("--cw")) || 58;
  const gap = 8;
  const step = n > 1 ? Math.min(cw + gap, (W - cw - 4) / (n - 1)) : cw;
  box.style.setProperty("--ov", `${cw - step}px`);
}

// ---------------- 阿禾說：一個字一個字講（點一下就講完） ----------------

let typing = 0, typedTarget = "";
let typedDone: (() => void) | null = null;
function speak(el: HTMLElement, text: string, done?: () => void) {
  if (typedTarget === text && el.dataset.full === text) { if (!typing) done?.(); else typedDone = done ?? null; return; }   // 同一句話不重播
  typedTarget = text;
  el.dataset.full = text;
  clearInterval(typing);
  typing = 0;
  typedDone = done ?? null;
  if (!fx.motionOn()) { el.textContent = text; typedDone?.(); return; }
  const chars = [...text];
  let i = 0;
  el.textContent = "";
  fx.slideIn(el, "up");
  typing = window.setInterval(() => {
    i = Math.min(chars.length, i + 1);
    el.textContent = chars.slice(0, i).join("");
    if (i % 3 === 1) sfx.type();
    if (i >= chars.length) { clearInterval(typing); typing = 0; typedDone?.(); }
  }, fx.settings.fast ? 14 : 26);
}
function finishTyping() {
  if (!typing) return;
  clearInterval(typing);
  typing = 0;
  $("spoken").textContent = typedTarget;
  typedDone?.();
}

// 幕間：牌桌上浮出「第二幕・…」的紙條
function actCard(i: number) {
  const a = ACTS[i];
  const c = document.createElement("div");
  c.className = "actcard";
  const small = document.createElement("small"); small.textContent = a.no;
  const b = document.createElement("b"); b.textContent = a.title;
  c.append(small, b);
  $("stable").appendChild(c);
  sfx.slide();
  const dur = fx.motionOn() ? fx.ms(1500) : 900;
  c.animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0", offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0, translate: "0 -6px" }],
    { duration: dur, easing: "ease-out", fill: "forwards" }).finished.then(() => c.remove()).catch(() => c.remove());
}

// 一句講完：intro／outro 會自己往下一句（點一下對話可以立刻往下）
function readTime(t: string) { return (fx.settings.fast ? 700 : 1300) + [...t].length * (fx.settings.fast ? 22 : 42); }
// 對話只在玩家點的時候往下（不自動翻頁）
function scheduleAuto() {
  clearTimeout(autoTimer);
}
void readTime;
function advance() {
  clearTimeout(autoTimer);
  if (typing) { finishTyping(); return; }
  if (mode === "intro") {
    li++;
    if (li >= lines.length - 1) { li = lines.length - 1; mode = "prompt"; }
  } else if (mode === "outro") {
    li++;
    if (li >= lines.length) { li = lines.length - 1; mode = "done"; }
  } else return;
  sfx.type();
  renderNarrator();
  if (mode === "prompt" || mode === "done") revealNarrator();
}
// 點牌桌時阿禾還在講：直接跳到輪到你
function skipToPrompt() {
  if (mode !== "intro") return;
  clearTimeout(autoTimer);
  finishTyping();
  li = lines.length - 1;
  mode = "prompt";
  renderNarrator();
}
function skipTalk() {
  clearTimeout(autoTimer);
  finishTyping();
  if (mode === "intro") skipToPrompt();
  else if (mode === "outro") { li = lines.length - 1; mode = "done"; renderNarrator(); }
}
function startOutro() {
  const o = outcomeOf(run);
  if (!o) { render(); return; }
  lines = TALK[step().id].outro(o, run); li = 0; mode = "outro";
  render();
}
function logLine(ln: Line) {
  const last = talkLog.at(-1);
  if (!last || last.text !== ln.text) talkLog.push(ln);
  $("talkLog").textContent = talkLog.map(l => (l.who === "ahe" ? "阿禾：" : "") + l.text).join("\n");
}
function sayLine(ln: Line) {
  $("who").textContent = ln.who === "ahe" ? "阿禾" : "旁白";
  $("narrator").classList.toggle("narr", ln.who === "narr");
  logLine(ln);
  speak($("spoken"), ln.text, scheduleAuto);
}

function renderNarrator() {
  const st = step(), L = LINES[st.id];
  const o = outcomeOf(run);
  const spoken = $("spoken"), more = $("more"), fb = $("feedback");
  $("narrator").dataset.mode = mode;
  clearTimeout(autoTimer);
  if (mode === "intro" || mode === "outro") {
    sayLine(lines[li]);
    more.textContent = mode === "intro" ? "點一下繼續 ▸（點牌桌可以直接開始）" : "點一下繼續 ▸";
    more.className = "tapnext";
    fb.className = ""; fb.textContent = "";
  } else if (mode === "done" && run.done && o) {
    sayLine(lines[li] ?? { who: "ahe", text: L.reply(o) });
    more.textContent = "";
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
    sayLine({ who: "ahe", text: retryLine });
    more.textContent = "換另一張試試。";
    more.className = "hint";
    fb.className = "retry";
    fb.textContent = illegalReason(run.game.hands[ME], run.game.leadCard, selCard) ?? "";
  } else {
    const second = st.id === "bid2" && run.actions.length === 1;      // 情況 B：阿禾叫 2♠ 之後
    sayLine({ who: "ahe", text: second ? L.ask2! : L.ask });
    more.textContent = second ? L.hint2! : L.hint;
    more.className = "hint";
    if (st.kind === "bid" && selBid !== NO_BID) {
      // 你點了哪個叫牌，阿禾就照那個叫牌回你；不允許的再補一句
      const ok = bidAllowed(run, selBid);
      fb.className = ok ? "ok" : "retry";
      const r = bidReaction(selBid);
      fb.textContent = `阿禾：${!ok && L.nudge ? r.replace(/」$/, L.nudge + "」") : r}`;
      more.textContent = "";          // 已經選了：操作提示收起來，讓阿禾的話和牌桌都看得到
    } else if (st.kind === "play" && selCard >= 0) {
      // 選了牌：可以出就提示確認，不能出就說具體原因
      const why = illegalReason(run.game.hands[ME], run.game.leadCard < 0 ? null : run.game.leadCard, selCard);
      fb.className = why ? "retry" : "ok";
      fb.textContent = why ?? `選了 ${cardText(selCard)}：按「確認出牌」送出，或再點一下收回。`;
      more.textContent = "";
    } else if (st.kind === "play") {
      // 現在能出什麼（跟正式牌桌同一套說明）
      const g = run.game;
      const trump = g.phase === Phase.Draw ? Strain.NoTrump : (g.trump as number);
      fb.className = "info";
      fb.textContent = g.leadCard < 0 ? LEAD_ADVICE : followAdvice(g.hands[ME], g.leadCard, trump, g.phase === Phase.Draw);
    } else { fb.className = ""; fb.textContent = ""; }
  }
  void spoken;
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
  if (mode === "intro" || mode === "outro") {
    const cta = lines[li]?.cta;
    if (cta) box.appendChild(btn(cta, "s-emph", () => { finishTyping(); advance(); }));      // 例如開場的「好啊，來吧！」
    box.appendChild(btn(mode === "intro" ? "跳過，直接開始" : "跳過對話", "s-minor", skipTalk));
  } else if (!run.done && st.kind === "play" && selCard >= 0 && !busy && !run.trick) {
    // 選牌 → 確認出牌（跟正式牌桌一樣）：送出前可以再點一下收回
    const legalSel = !illegalReason(run.game.hands[ME], run.game.leadCard < 0 ? null : run.game.leadCard, selCard);
    const b = btn(`確認出牌 ${cardText(selCard)}`, "s-emph", () => void playSelected());
    b.id = "sConfirm";
    b.disabled = !legalSel;
    box.appendChild(b);
  } else if (run.done && o) {
    if (st.id === "down") {
      const a = document.createElement("a");
      a.className = "s-emph";
      a.href = "/?solo=new&coach=1";        // 開一局有對局提示的練習
      a.id = "toSolo";
      a.innerHTML = '開一場有提示的練習局 <span aria-hidden="true">→</span>';
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
  if (r.bottom > innerHeight - 40 || r.top < 0) $("spoken").scrollIntoView({ block: "center", behavior: fx.settings.fast || !fx.motionOn() ? "auto" : "smooth" });
}

// ---------------- 出牌 ----------------

const anchor = (who: number) => $(who === ME ? "aMe" : "aOpp");

// 點一張牌：選起來（再點一下收回、點別張換過去）；按「確認出牌」才真的出
function onCardTap(id: number, el: HTMLElement) {
  if (mode === "intro") { skipToPrompt(); fx.bounce(el); return; }
  if (busy || step().kind !== "play" || run.trick || run.done) return;
  retryLine = "";
  if (selCard === id) { selCard = -1; sfx.hover(); renderHand(view()); renderNarrator(); return; }
  selCard = id;
  const why = illegalReason(run.game.hands[ME], run.game.leadCard < 0 ? null : run.game.leadCard, id);
  if (why) {
    // 不能出的牌：可以選起來看，但說清楚為什麼不能出
    fx.deny(el); sfx.deny(); fx.buzz(40);
    retryLine = LINES[step().id].illegal ?? "「這張還不能出喔。」";
    triedIllegal = true;
  } else { sfx.select(); fx.buzz(8); }
  renderHand(view());
  renderNarrator();
}

async function playSelected() {
  const id = selCard;
  if (busy || id < 0 || step().kind !== "play" || run.trick || run.done) return;
  const el = document.querySelector<HTMLElement>(`#sHand .card[data-id="${id}"]`);
  const r = act(run, id);
  if (!r.ok || !el) return;
  const my = epoch;
  busy = true;
  retryLine = "";
  selCard = -1;
  fx.buzz(10);
  renderNarrator();
  // 1. 從手上抽離 → 加速拍到「你出的牌」：落桌壓扁、陰影擴散、回彈（跟正式牌桌同一套重量感）
  const ruff = r.events.some(e => e.type === "CardPlayed" && e.extra === 1);
  const weight = playWeight(id, ruff, view());
  const from = el.getBoundingClientRect();
  const to = $("slotMe").getBoundingClientRect();
  el.style.visibility = "hidden";
  const flying = fx.cardEl(id);
  fx.pin(flying, from);
  const pulledRect = new DOMRect(from.left, from.top - (fx.motionOn() ? 18 : 0), from.width, from.height);
  sfx.slap(weight, ((fx.motionOn() ? fx.ms(PLAY_T.pull) : 0) + flightMs(PLAY_T.fly + 30, weight)) / 1000);
  await pullUp(flying, -18, true, weight);
  await slamFly(flying, pulledRect, to, { dur: PLAY_T.fly + 30, weight, lift: 18 });
  flying.remove();
  if (my !== epoch) return;
  renderTable();
  const mine = $("slotMe").firstElementChild;
  if (mine) contact(mine, $("stable"), weight);
  // 你先出的話：阿禾跟著出一張（他看到你出的花色才決定）
  if (needsReply(run)) {
    await fx.wait(fx.ms(650));
    if (my !== epoch) return;
    const evs = reply(run);
    const played = evs.find(e => e.type === "CardPlayed" && e.seat === AHE);
    if (played) {
      const fan = $("sOppFan");
      const src = (fan.lastElementChild as HTMLElement | null) ?? fan;
      const f = src.getBoundingClientRect();
      const back = fx.backEl();
      sfx.slap(1, (fx.motionOn() ? fx.ms(PLAY_T.pull) + flightMs(PLAY_T.fly + 40) : 0) / 1000);
      await slamFly(back, f, $("slotOpp").getBoundingClientRect(), { dur: PLAY_T.fly + 40, lift: 24, flipAt: () => fx.flipTo(back, played.card) });
      back.remove();
      if (my !== epoch) return;
      renderTable();
      const opp = $("slotOpp").firstElementChild;
      if (opp) contact(opp, $("stable"), 1);
    }
  }
  // 結果還沒確認：王吃的大字和重擊留給結算這一墩的時候（教學裡多停一下，讓你看清楚兩張牌）
  await fx.wait(fx.ms(ruff ? 800 : 700));
  if (my !== epoch) return;
  // 2. 結算這一墩（規則確認了誰贏，才依局勢決定衝擊等級）
  const before = view();                       // 這一墩結算「之前」的牌桌：拿來判斷這墩有多重要
  const evs = settle(run);
  await animateSettle(evs, before);
  if (my !== epoch) return;
  record();
  busy = false;
  startOutro();
  if (justFinished) { const t = document.getElementById("tally"); if (t) fx.punch(t, 0.3, 420); }
  revealNarrator();
}

async function animateSettle(evs: GameEvent[], before: TableState) {
  const won = evs.find(e => e.type === "TrickWon");
  let hold = 0;
  if (won) {
    const card = $(won.seat === ME ? "slotMe" : "slotOpp").firstElementChild as HTMLElement | null;
    const other = $(won.seat === ME ? "slotOpp" : "slotMe").firstElementChild as HTMLElement | null;
    const im = evaluateTrick(won, before);
    hold = presentImpact(im, { felt: $("stable"), winner: card, loser: other, markers: [document.getElementById("tallyBox")] });
    if (im.kind === "ruff" || (won.extra === 1 && im.tier >= 2))
      fx.popup("王吃！", anchor(won.seat), { size: won.seat === ME ? 60 : 36, color: won.seat === ME ? GOLD : MUTED, flags: ["pop", "shake"], hold: 800, delay: 80 + (fx.motionOn() ? im.hitstop : 0) });
    if (hold) await fx.wait(hold);
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
    sfx.faceUp(meWon);
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
        sfx.draw();
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
    setTimeout(() => { contractFeedback(made, $("aCenter"), $("stable")); if (made) shower(50); }, fx.ms(600));
    if (scored) setTimeout(() => sfx.scoreHit(), fx.ms(1150));
    fx.buzz(made ? [30, 50, 30, 50, 120] : [220]);
    await fx.wait(fx.ms(1500));
    return;
  }
  await fx.wait(fx.ms(650));
}

// ---------------- 叫牌 ----------------

function selectBid(i: number) {
  if (mode === "intro") { skipToPrompt(); return; }
  if (busy || run.done || !yourTurnToBid(run)) return;
  selBid = selBid === i ? NO_BID : i;          // 再點一下收回
  sfx.select();
  fx.buzz(8);
  renderTable();
  renderNarrator();
  const b = document.querySelector<HTMLElement>(`#sBoard button[data-bid="${i}"]`);
  if (b) fx.punch(b, 0.15, 200);
}

async function confirmBid() {
  const call = selBid;
  if (busy || call === NO_BID || !bidAllowed(run, call)) return;
  const r = act(run, call);
  if (!r.ok) return;
  const my = epoch;
  busy = true;
  selBid = NO_BID;
  fx.buzz(15);
  renderTable();
  renderNarrator();
  // 叫牌籌碼：從你這邊上浮，落到叫牌紀錄上你那一格（跟正式牌桌同一套演出）；Pass 只蓋個章
  const spans = document.querySelectorAll("#sBoard .splate .auct span");
  const mine = spans[run.actions.length === 1 ? 0 : spans.length - 2] ?? null;
  if (call >= 0 && mine) await bidChip(bidText(call), isRedBid(call), bidTier(bidLevel(call)), $("aMe").getBoundingClientRect(), mine, $("stable"), 0.15);
  else { fx.popup("Pass", $("aMe"), { size: 28, color: MUTED }); sfx.pass(); }
  if (my !== epoch) return;
  await fx.wait(fx.ms(650));
  if (my !== epoch) return;
  // 阿禾照劇本回應（Pass 或往上叫）
  const evs = settle(run);
  const aheBid = evs.find(e => e.type === "BidMade" && e.seat === AHE);
  if (aheBid) { fx.popup(bidText(aheBid.value), $("aOpp"), { size: 34, color: isRedBid(aheBid.value) ? RED : GOLD, flags: ["pop"] }); sfx.bid(bidTier(bidLevel(aheBid.value)), 0.3); }
  else if (evs.some(e => e.type === "Passed" && e.seat === AHE)) { fx.popup("Pass", $("aOpp"), { size: 30, color: MUTED }); sfx.pass(); }
  renderTable();
  await fx.wait(fx.ms(420));
  if (my !== epoch) return;
  if (!run.done) {
    // 還在競叫：輪到你再選一次（阿禾已經說話了）
    busy = false;
    record();
    renderTable();
    renderNarrator();
    revealNarrator();
    return;
  }
  // 合約確定：在牌桌中央蓋章，再落進合約欄
  const v = view();
  await contractSlam(bidText(v.highestBid), isRedBid(v.highestBid), `莊家：${v.declarer === ME ? "你" : "阿禾"} · 要贏 ${tricksNeeded(v.highestBid)} 墩`, 0, $("stable"), document.querySelector("#sBoard .splate .big"));
  if (my !== epoch) return;
  const g = document.getElementById("goal");
  if (g) fx.punch(g, 0.12, 320);
  await fx.wait(fx.ms(300));
  if (my !== epoch) return;
  record();
  busy = false;
  startOutro();
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
$("narrator").addEventListener("click", ev => {
  if ((ev.target as HTMLElement).closest("button, a")) return;
  if (mode === "intro" || mode === "outro") advance(); else finishTyping();
});
const setDlg = $<HTMLDialogElement>("setDlg");
$("setBtn").addEventListener("click", () => { renderSettings($("setBox")); setDlg.showModal(); sfx.slide(); });
$("setClose").addEventListener("click", () => setDlg.close());
setDlg.addEventListener("click", ev => { if (ev.target === setDlg) setDlg.close(); });
document.addEventListener("pointerdown", ev => {
  const b = (ev.target as HTMLElement).closest(".s-emph, .s-minor, .s-back, .book, .notes, .snav a, #restart, .btn");
  if (b) sfx.press();
}, { passive: true });
// 章節目錄：手機上是從下面滑上來的抽屜，電腦上捲到下面
const narrow = () => matchMedia("(max-width: 700px)").matches;
$("navChapters").addEventListener("click", ev => {
  ev.preventDefault();
  if (narrow()) { document.body.classList.toggle("show-chapters"); if (document.body.classList.contains("show-chapters")) fx.slideIn($("contentsBox"), "up"); return; }
  $("contentsBox").scrollIntoView({ behavior: "smooth", block: "start" });
  fx.punch($("contents"), 0.03, 300);
});
$("closeChapters").addEventListener("click", () => document.body.classList.remove("show-chapters"));
$("contents").addEventListener("click", () => document.body.classList.remove("show-chapters"));
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
// 首頁的篇章卡片：/story/?act=2 直接到第二幕
{
  const a = Number(new URLSearchParams(location.search).get("act"));
  if (a >= 1 && a <= ACTS.length) { history.replaceState(null, "", "/story/"); goto(firstStepOfAct(a - 1), false); }
  else goto(progress.page, false);
}
