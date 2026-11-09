// 手機端主程式：01 首頁主選單 → 06 朋友連線／等朋友 → 02 搶牌 → 03 叫牌 → 04 出牌 → 05 結算。
// 牌桌不管對面是雲端房間（Connection）還是手機上的電腦（LocalTable），收到的訊息都一樣：
// 「事件」放動畫和音效，「狀態」把牌桌畫對（事件一定比狀態先到；最終的贏墩、得分都等權威狀態確認）。
// 手感：卡牌彈簧與讓位、拖曳出牌、分階段飛牌落桌、依真實事件分級的贏墩回饋、分段結算。
import {
  Call, bidText, callText, cardText, isBid, isRedBid, isRedCard, rankOf, suitOf, SUIT_SYMBOL, tricksNeeded,
  bidStrain, bidIndex, bidLevel, Strain, strainText,
} from "../game/cards";
import { GameEvent, Phase, TableState } from "../game/game";
import { beats, isTrump } from "../game/rules";
import { breakdown, contractText, declarerPreview, defenderPreview, madePoints, pointsPerUndertrick, PER_OVERTRICK, type HandResult } from "../game/scoring";
import { SeatInfo, ServerMsg, isValidCode, normalizeCode } from "../server/protocol";
import * as fx from "./fx";
import { Connection, LAST_ROOM_KEY, createRoom, forgetRoom, roomInfo, savedToken, store } from "./net";
import { Link, LocalTable, hasUnfinishedSolo } from "./solo";
import { sfx } from "./sound";
import {
  bidChip, bidTier, contractFeedback, contractSlam, doubleFx, flipNumber, redoubleFx, rollNumber, stamp, streakGlow, victory,
} from "./feedback";
import { ImpactGate, evaluateTrick, playWeight, trickKey, type Impact } from "./impact";
import { PLAY_T, contact, flightMs, presentImpact, pullUp, slamFly } from "./impactfx";
import { burstAt } from "./particles";
import { BUILD, renderSettings } from "./settings-ui";
import { emo, risk as riskOf } from "./tension";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const GOLD = "#F3D488", INK = "#FBF4E4", MUTED = "#D8C7A4", BAD = "#F2A0A0", GOOD = "#B5E3BE", RED = "#F5AAB3";

// ---------------- 狀態 ----------------

let conn: Link | null = null;
let mySeat = -1;
let st: TableState | null = null;
let seats: SeatInfo[] = [];
let started = false;
let selCard = -1, selBid = -1, selLevel = 0, selStrain = -1;
let waiting = false, waitTimer = 0;
let resultShownFor = -1, resultTimer = 0;
let dealing = false;
let lastFaceUp = -1;
let lastTurnText = "";
let bidRevealTimer = 0;    // 抽牌最後一墩的動畫演完才跳出叫牌面板
let auctionShown = 0;      // 叫牌紀錄已經蓋了幾個章
let hoverId = -1;
let pulled = -1;           // 已經送出、等雲端確認的那張牌（先抽起來）
let screen = "home";
const inFlight = new Set<number>();
const freshCards = new Set<number>();
let resultSig = { skip: false };
let streak = 0;            // 你連續贏了幾墩（輸一墩、換階段、新的一局就歸零）
let sawEmptySeat = false, oppWasOffline = false;
let impactGate = new ImpactGate();           // 同一墩的結果只演一次   // 連線提示：真的等過人、對方真的斷過線才講
const chipPending = new Set<number>();   // 叫牌籌碼還在飛：那一邊的叫牌紙卡先不換字
let hoverWant = -1, hoverTimer = 0;

const oppName = () => seats[1 - mySeat]?.name || (mySeat === 0 ? "朋友" : "房主");
const nameOf = (s: number) => s === mySeat ? "你" : oppName();
const myTurn = () => !!st && st.currentSeat === st.seat && !(st.leadCard >= 0 && st.followCard >= 0) && st.phase !== Phase.Finished;
const myBidTurn = () => !!st && st.phase === Phase.Bidding && myTurn();
const canPlayNow = () => !!st && (st.phase === Phase.Draw || st.phase === Phase.Play) && myTurn() && st.legal.length > 0 && !waiting;

// 畫面切換：紙張滑入；牌桌從中心展開。重複進同一個畫面不重播
function show(id: "home" | "online" | "wait" | "table") {
  for (const s of ["home", "online", "wait", "table"]) $(s).hidden = s !== id;
  if (screen === id) return;
  screen = id;
  const el = $(id);
  el.classList.remove("enter", "unfold");
  void el.offsetWidth;
  el.classList.add(id === "table" ? "unfold" : "enter");
  if (id !== "table") sfx.slide();
}

function setWaiting(on: boolean) {
  waiting = on;
  clearTimeout(waitTimer);
  if (on) waitTimer = window.setTimeout(() => { waiting = false; unpull(); }, 3000);   // 保險：3 秒沒回應就解鎖
}

// ---------------- 01 首頁 ----------------

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const homeMsg = $("homeMsg");
nameInput.value = store.get("hb-name") ?? "";
nameInput.addEventListener("change", () => store.set("hb-name", nameInput.value.trim()));
codeInput.addEventListener("input", () => { codeInput.value = normalizeCode(codeInput.value).replace(/[^A-Z0-9]/g, "").slice(0, 4); });
codeInput.addEventListener("keydown", e => { if (e.key === "Enter") $("join").click(); });

function say(msg: string, err = false) { homeMsg.textContent = msg; homeMsg.classList.toggle("err", err); }
const myName = () => { const n = nameInput.value.trim(); if (n) store.set("hb-name", n); return n; };

$("goOnline").addEventListener("click", () => offerStoryFirst(() => { show("online"); refreshResume(); }));
$("onlineBack").addEventListener("click", () => show("home"));
$("goRules").addEventListener("click", () => { $("homeMenu").hidden = true; openModal("rulesModal"); });
$("goSettings").addEventListener("click", () => { $("homeMenu").hidden = true; openMenu(); });
$("goMenu").addEventListener("click", () => openModal("homeMenu"));
// 🔔 最新消息：每個新版本第一次打開前有紅點
const NEWS_KEY = "hb-news-seen";
$("newsDot").hidden = store.get(NEWS_KEY) === BUILD.sha;
$("goNews").addEventListener("click", () => { store.set(NEWS_KEY, BUILD.sha); $("newsDot").hidden = true; openModal("newsModal"); });

$("create").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("create");
  b.disabled = true; say("開桌中…");
  try { enter(await createRoom()); }
  catch (e) { say((e as Error).message, true); }
  finally { b.disabled = false; }
});

$("join").addEventListener("click", async () => {
  const code = normalizeCode(codeInput.value);
  if (!isValidCode(code)) { say("房號是 4 個英文字母或數字喔。", true); fx.deny(codeInput); sfx.deny(); return; }
  say("找這桌中…");
  try {
    const info = await roomInfo(code);
    if (!info.exists) { say("找不到這桌，再確認一下房號。", true); return; }
    if (info.seats?.every(Boolean) && !savedToken(code)) { say("這桌已經坐滿啦。", true); return; }
    enter(code);
  } catch (e) { say((e as Error).message, true); }
});

function refreshResume() {
  const last = store.get(LAST_ROOM_KEY);
  const b = $("resume");
  b.hidden = !(last && savedToken(last));
  if (!b.hidden) b.textContent = `回到 ${last} 這桌`;
  $("soloSub").textContent = hasUnfinishedSolo() ? "繼續上次那局" : "";
  refreshStoryCard();
}
$("resume").addEventListener("click", () => { const last = store.get(LAST_ROOM_KEY); if (last) enter(last); });

// 回首頁（或回朋友連線頁顯示錯誤）
function goHome(msg = "", err = false, toOnline = false) {
  conn?.close(); conn = null;
  clearTimeout(resultTimer);
  resultSig.skip = true;
  for (const id of ["result", "menu", "auctionPop", "banner", "storyOffer", "rulesModal", "homeMenu", "newsModal"]) $(id).hidden = true;
  history.replaceState(null, "", "/");
  show(toOnline ? "online" : "home");
  say(toOnline ? msg : "", err);
  if (msg && !toOnline) banner(msg, 3200);
  refreshResume();
}

// ---------------- 07 阿禾的故事（教學）入口 ----------------

const STORY_KEY = "hb.story.v2";      // 跟 /story/ 用同一個進度鍵
const OFFER_KEY = "hb-story-offered";
function storyProgress(): { page: number; finished: boolean; answers: Record<string, unknown> } | null {
  try {
    const p = JSON.parse(store.get(STORY_KEY) ?? "null");
    return p && p.v === 2 && Number.isInteger(p.page) ? { page: p.page, finished: !!p.finished, answers: p.answers ?? {} } : null;
  } catch { return null; }
}
const ACT_STEPS = [["grab"], ["bid"], ["follow", "ruff"], ["last"]];
const ACT_OF_PAGE = [1, 2, 3, 3, 4];
function refreshStoryCard() {
  const p = storyProgress();
  $("chapHead").textContent = !p ? "第一次玩？" : p.finished ? "想複習哪一幕？" : "接著跟阿禾學";
  $("storyCardSub").textContent = !p ? "沒玩過也沒關係，阿禾帶你打一場！"
    : p.finished ? "四幕都打完了 ✓ 想複習就點下面任何一幕。" : `上次學到第 ${ACT_OF_PAGE[p.page] ?? 1} 幕，點下面接著打。`;
  // 篇章卡片：打完的打勾、下一個要打的框起來
  let next = -1;
  document.querySelectorAll<HTMLElement>(".cv-card").forEach((c, i) => {
    const done = !!p && ACT_STEPS[i].every(id => p.answers[id]);
    c.classList.toggle("done", done);
    if (!done && next < 0) next = i;
  });
  document.querySelectorAll<HTMLElement>(".cv-card").forEach((c, i) => c.classList.toggle("next", i === next && !!p));
}
// 第一次按「跟阿禾打／找朋友玩」：先問要不要跟阿禾學（只問一次）
let offerThen: (() => void) | null = null;
function offerStoryFirst(then: () => void) {
  if (storyProgress() || store.get(OFFER_KEY)) { then(); return; }
  store.set(OFFER_KEY, "1");
  offerThen = then;
  openModal("storyOffer");
}
$("offerSkip").addEventListener("click", () => {
  $("storyOffer").hidden = true;
  const then = offerThen; offerThen = null;
  then?.();
});

// ---------------- 單機：跟電腦打 ----------------

$("solo").addEventListener("click", () => offerStoryFirst(() => enterSolo(false)));

function enterSolo(fresh: boolean) {
  conn?.close();
  resetTable();
  say("");
  history.replaceState(null, "", "/?solo=1");     // 重新整理會回到同一局
  const t = new LocalTable(myName(), fresh);
  conn = t;
  t.onMessage = onMsg;
  t.onStatus = () => {};
  t.open();
}

// ---------------- 連線 ----------------

function resetTable() {
  mySeat = -1; st = null; seats = []; started = false; selCard = selBid = -1; selLevel = 0; selStrain = -1;
  resultShownFor = -1; lastFaceUp = -1; auctionShown = 0; pulled = -1; hoverId = -1;
  inFlight.clear(); freshCards.clear();
  lastTurnText = "";
  handBox.replaceChildren();
  $("oppFan").replaceChildren();
  $("mySlot").replaceChildren();
  $("oppSlot").replaceChildren();
  $("stock").dataset.up = "";
  $("ticker").textContent = "";
  $("plateOpp").classList.remove("in");
  sawEmptySeat = oppWasOffline = false;
  oppStreak = 0; handOnce.clear(); hideQuip();
  impactGate = new ImpactGate();
  sfx.resetStreak();
}

function enter(code: string) {
  conn?.close();
  resetTable();
  say("連線中…");
  history.replaceState(null, "", `/?room=${code}`);
  const c = new Connection(code, myName());
  conn = c;
  c.onMessage = onMsg;
  let dropped = false;
  c.onStatus = s => {
    if (s === "reconnecting") { dropped = true; banner("連線斷了一下，重新連線中…"); }
    else if (s === "open") {
      renderPresence();
      // 真的斷過、而且重新連上了，才說「回來啦」
      if (dropped && $("banner").hidden) banner("回來啦！繼續打。", 1800);
      dropped = false;
    }
  };
  c.open();
}

function onMsg(m: ServerMsg) {
  switch (m.t) {
    case "welcome":
      mySeat = m.seat;
      $("roomChip").textContent = conn?.solo ? "單機" : `房號 ${m.code}`;
      break;
    case "lobby": {
      const before = seats.map(s => s?.taken);
      seats = m.seats; started = m.started;
      if (!started) showWait(before);
      renderNames(); renderPresence();
      // 房主等到朋友：真的看過空位、現在兩個人都坐好而且開打了，才說人到齊
      const opp = seats[1 - mySeat];
      if (!started && mySeat >= 0 && !opp?.taken) sawEmptySeat = true;
      if (started && sawEmptySeat && opp?.taken && opp.online) { sawEmptySeat = false; banner("人到齊啦，準備開打！", 1800); }
      break;
    }
    case "event":
      if (st) onEvent(m.e);
      break;
    case "state":
      onState(m.s);
      break;
    case "full":
      forgetRoom(conn?.code ?? "");
      goHome("這桌已經坐滿啦。", true, true);
      break;
    case "gone":
      forgetRoom(conn?.code ?? "");
      goHome("找不到這桌，再確認一下房號。", true, true);
      break;
    case "error":
      banner(m.msg, 2500);
      break;
  }
}

// ---------------- 等朋友：名牌滑入、郵票蓋章 ----------------

function showWait(before: (boolean | undefined)[] = []) {
  if (!conn) return;
  show("wait");
  const big = $("bigCode");
  if (big.dataset.code !== conn.code) {
    big.dataset.code = conn.code;
    big.replaceChildren(...[...conn.code].map((ch, i) => { const s = document.createElement("span"); s.textContent = ch; fx.popIn(s, i * 70); return s; }));
  }
  if (mySeat < 0) return;
  $("plateMeName").textContent = seats[mySeat]?.name || "你";
  ($("plateMe").querySelector("small") as HTMLElement).textContent = mySeat === 0 ? "房主（你）" : "朋友（你）";
  ($("plateOpp").querySelector("small") as HTMLElement).textContent = mySeat === 0 ? "朋友" : "房主";
  const opp = seats[1 - mySeat];
  const plate = $("plateOpp");
  $("plateOppName").textContent = opp?.taken ? opp.name : "還沒來…";
  if (opp?.taken && !plate.classList.contains("in")) {
    plate.classList.add("in");
    fx.slideIn(plate, "right");
    if (!before[1 - mySeat]) { sfx.join(); const em = plate.querySelector("em"); if (em) fx.stampIn(em, 200); }
  }
}
const inviteUrl = () => `${location.origin}/?room=${conn?.code ?? ""}`;
$("share").addEventListener("click", async () => {
  const url = inviteUrl();
  const text = `來打橋牌！我開好一桌了，房號 ${conn?.code}，點連結就能加入。`;
  try {
    if (navigator.share) await navigator.share({ title: "來打橋牌", text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); flashLabel($("share"), "邀請複製好了！"); }
  } catch { /* 使用者取消分享 */ }
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(inviteUrl()); flashLabel($("copy"), "複製好了！"); }
  catch { flashLabel($("copy"), conn?.code ?? ""); }
});
$("cancelWait").addEventListener("click", () => { if (conn) forgetRoom(conn.code); goHome("", false, true); });

function flashLabel(b: HTMLElement, text: string) {
  const old = b.dataset.label ?? b.textContent ?? "";
  b.dataset.label = old;
  b.textContent = text;
  fx.punch(b);
  setTimeout(() => { b.textContent = old; }, 1500);
}

// ---------------- 狀態 → 畫面 ----------------

function onState(s: TableState) {
  const first = !st;
  st = s;
  setWaiting(false);
  if (pulled >= 0 && !s.hand.includes(pulled)) pulled = -1;   // 已經打出去了
  else if (pulled >= 0 && !myTurn()) pulled = -1;
  if ($("table").hidden) show("table");
  if (first) say("");
  render(first);
}

function render(first = false) {
  if (!st) return;
  const s = st;
  $("table").classList.toggle("bidding", s.phase === Phase.Bidding);
  $("table").classList.toggle("finished", s.phase === Phase.Finished);
  $("felt").classList.toggle("drawing", s.phase === Phase.Draw);
  renderTop();
  renderPhase();
  renderOpp(first);
  renderStatus();
  renderCenter(first);
  renderBid(first);
  renderHand(first);
  renderTurn();
  renderActions();
  renderResult(first);
}

function renderNames() {
  // 朋友連線：對面是真人，不用阿禾的郵票；跟阿禾打才是阿禾
  const stamp = conn?.solo ? "/art/stamp-ahe.svg" : "/art/seal.svg";
  for (const img of [$<HTMLImageElement>("oppStamp"), $("plateOpp").querySelector("img")]) if (img && !img.src.endsWith(stamp)) img.src = stamp;
  $("oppName").textContent = oppName();
  $("oppNameTop").textContent = oppName();
  $("bidOppName").textContent = oppName();
  $("rtOppName").textContent = oppName();
}

function renderPresence() {
  const opp = seats[1 - mySeat];
  $("oppDot").classList.toggle("off", !!opp && !opp.online);
  const offline = started && !!opp && !opp.online;
  if (offline) banner(`${oppName()}好像斷線了，等他回來一下。（牌局會保留）`);
  else if (oppWasOffline && started && opp?.online) banner(`${oppName()}回來啦！繼續打。`, 1800);
  else $("banner").hidden = true;
  oppWasOffline = offline;
}

let bannerTimer = 0;
function banner(text: string, autoHide = 0) {
  const b = $("banner");
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bannerTimer);
  if (autoHide) bannerTimer = window.setTimeout(() => { b.hidden = true; }, autoHide);
}

function renderTop() {
  const s = st!;
  $("handNo").textContent = `第 ${s.handNumber} 局`;
  fx.countUp($("myScore"), s.myScore);
  fx.countUp($("oppScore"), s.oppScore);
  $("target").textContent = String(s.targetScore);
  renderNames();
  renderMute();
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function trickNo(s: TableState) {
  if (s.phase === Phase.Draw) return Math.min(13, 13 - s.stockCount / 2 + 1);
  return Math.min(13, s.myTricks + s.oppTricks + 1);
}

function renderPhase() {
  const s = st!;
  const txt = s.phase === Phase.Draw ? "前半場｜搶牌" : s.phase === Phase.Bidding ? "叫牌中" : s.phase === Phase.Play ? "後半場｜出牌" : "這局打完了";
  const pt = $("phaseText");
  if (pt.textContent !== txt) { pt.textContent = txt; fx.slideIn($("phaseChip"), "left"); }
  const chip = $("trickChip");
  if (s.phase === Phase.Draw || s.phase === Phase.Play) {
    const n = trickNo(s);
    if (!chip.querySelector(".num")) chip.innerHTML = `第 <span class="num"></span> / 13 墩`;
    flipNumber(chip.querySelector(".num") as HTMLElement, pad2(n), false);
  } else chip.replaceChildren();
  const info = $("infoStrip");
  if ((s.phase === Phase.Play || s.phase === Phase.Finished) && s.highestBid >= 0) {
    info.hidden = false;
    info.innerHTML = `合約 ${contractHtml(s)}<span> · 莊家 <b>${s.declarer === s.seat ? "你" : esc(oppName())}</b> · 要贏 ${tricksNeeded(s.highestBid)} 墩</span>`;
  } else info.hidden = true;
}

function renderOpp(first: boolean) {
  const s = st!;
  $("oppCount").textContent = `${s.oppCount} 張`;
  const fan = $("oppFan");
  const want = Math.min(s.oppCount, 13);
  while (fan.children.length > want) fan.lastElementChild!.remove();
  while (fan.children.length < want) {
    const b = fx.backEl();
    fan.appendChild(b);
    if (dealing && !first) fx.popIn(b, fan.children.length * 35);
  }
  const memo = $("memo");
  memo.replaceChildren();
  if (s.oppTakenFaceUp.length) {
    const lbl = document.createElement("span");
    lbl.textContent = "搶走：";
    memo.appendChild(lbl);
    for (const id of s.oppTakenFaceUp) memo.appendChild(fx.cardEl(id));
  }
}

function contractHtml(s: TableState) {
  const b = s.highestBid;
  const base = isRedBid(b) ? `<span class="red">${bidText(b)}</span>` : bidText(b);
  return s.doubled > 0 ? `${base}<span class="x">${s.doubled >= 2 ? "再加倍" : "加倍"}</span>` : base;
}

function renderStatus() {
  const s = st!;
  const el = $("statusText");
  if (s.phase === Phase.Draw) el.innerHTML = `牌堆還剩 <b>${s.stockCount}</b> 張 · 贏了拿明牌，輸了摸暗牌`;
  else el.textContent = "";
  $("auctionBtn").hidden = !((s.phase === Phase.Play || s.phase === Phase.Finished) && s.auctionCalls.length > 0);
}

function renderCenter(first: boolean) {
  const s = st!;
  // 前半場：明牌（左）＋暗牌堆（右）＋規則小紙條
  const drawing = s.phase === Phase.Draw && s.faceUp >= 0;
  const stock = $("stock");
  if (drawing) {
    if (stock.dataset.up !== String(s.faceUp)) {
      stock.dataset.up = String(s.faceUp);
      stock.replaceChildren();
      const up = document.createElement("div");
      up.className = "faceup";
      up.id = "faceUp";
      const c = fx.cardEl(s.faceUp);
      up.appendChild(c);
      stock.append(up);
      if (!first && lastFaceUp !== s.faceUp) { fx.flipIn(c); fx.glow(c, 600); }
    }
    stock.hidden = false;
  } else { stock.hidden = true; stock.dataset.up = ""; }
  lastFaceUp = s.faceUp;
  const hid = $("hidPile");
  hid.hidden = !drawing;
  if (drawing) {
    const stack = hid.querySelector(".pilestack") as HTMLElement;
    const want = Math.max(1, Math.min(3, Math.ceil((s.stockCount - 1) / 8)));
    if (stack.children.length !== want) stack.replaceChildren(...Array.from({ length: want }, () => fx.backEl()));
    stack.id = "pile";
  }
  $("ruleNote").hidden = !drawing;

  // 後半場：王牌（左）＋墩數（右）
  const playing = (s.phase === Phase.Play || s.phase === Phase.Finished) && s.highestBid >= 0 && s.declarer >= 0;
  $("trumpPanel").hidden = !playing;
  $("tallyPanel").hidden = !playing;
  if (playing) {
    const strain = bidStrain(s.highestBid);
    const t = $("trumpSuit");
    t.textContent = strain === Strain.NoTrump ? "無王" : SUIT_SYMBOL[strain];
    t.className = strain === Strain.Hearts || strain === Strain.Diamonds ? "red" : "";
    t.style.fontSize = strain === Strain.NoTrump ? "20px" : "";
    const iDecl = s.declarer === s.seat;
    $("tallyLabel").textContent = iDecl ? "你已贏" : `${oppName()}已贏`;
    flipNumber($("tallyBig"), String(iDecl ? s.myTricks : s.oppTricks), true, Math.min(4, Math.max(0, streak - 1)) * 0.06);
    $("tallyNeed").textContent = String(tricksNeeded(s.highestBid));
    $("tallyLine").textContent = `你 ${s.myTricks}｜${oppName()} ${s.oppTricks}`;
    if (s.phase === Phase.Play) emo.sustain(s);
  }
  renderTrick();
}

function renderTrick(landed = -1) {
  const s = st!;
  const iLed = s.leaderSeat === s.seat;
  sync($("mySlot"), iLed ? s.leadCard : s.followCard, landed);
  sync($("oppSlot"), iLed ? s.followCard : s.leadCard, landed);
}

function sync(slot: HTMLElement, id: number, landed: number) {
  const cur = slot.firstElementChild as HTMLElement | null;
  if (id < 0 || inFlight.has(id)) { if (cur && (id < 0 || Number(cur.dataset.id) !== id)) slot.replaceChildren(); return; }
  if (cur && Number(cur.dataset.id) === id) return;
  const c = fx.cardEl(id);
  slot.replaceChildren(c);
  if (landed === id) fx.land(c);
}

// ---------------- 手牌：扇形、讓位、彈簧、拖曳 ----------------

const handBox = $("hand");
function handEl(id: number) { return handBox.querySelector<HTMLElement>(`.card[data-id="${id}"]`); }
const fine = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

function renderHand(first = false) {
  const s = st!;
  const ids = s.hand;
  const keep = new Set(ids);
  for (const el of Array.from(handBox.children) as HTMLElement[]) if (!keep.has(Number(el.dataset.id))) el.remove();

  const legal = new Set(s.legal);
  const canPlay = legal.size > 0 && myTurn();
  // 還沒輪到你也可以先選好；輪到你時，先選的牌如果不能出，就放下並說明原因
  if (s.phase !== Phase.Draw && s.phase !== Phase.Play) selCard = -1;
  else if (selCard >= 0 && !ids.includes(selCard)) selCard = -1;
  // 出牌預覽：牌不在手上了、或已經不能出（而且不是正在送出的那張），就收回手上
  if (staged >= 0 && (!ids.includes(staged) || (!canPlayNow() && pulled !== staged))) staged = -1;

  ids.forEach((id, i) => {
    let el = handEl(id);
    const isNew = !el;
    if (!el) {
      el = fx.cardEl(id);
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      handBox.appendChild(el);
    }
    el.classList.toggle("legal", canPlay && legal.has(id) && selCard !== id);
    el.classList.toggle("sel", selCard === id);
    el.classList.toggle("dim", canPlay && !legal.has(id));
    el.classList.toggle("pulled", pulled === id);
    el.classList.toggle("staged", staged === id);
    if (isNew && !first) {
      if (dealing) fx.popIn(el, i * 45);
      else if (freshCards.has(id)) {
        el.classList.add("fresh");
        fx.flipIn(el);
        const e2 = el;
        setTimeout(() => e2.classList.remove("fresh"), fx.ms(1700));
      } else fx.popIn(el);
    }
    el.setAttribute("aria-label", cardText(id) + (canPlay && !legal.has(id) ? "（還不能出）" : ""));
  });
  // 依照順序排 DOM（鍵盤 Tab 也照順序）
  ids.forEach(id => { const el = handEl(id); if (el) handBox.appendChild(el); });
  layoutHand();
  freshCards.clear();
  dealing = false;
}

// 扇形排列；選起來（或滑鼠停住）的那張，左右的牌自然讓位
let baseX: number[] = [];   // 每張牌沒讓位時的位置：滑動選牌用這個對位，才不會跟著讓位抖來抖去
function layoutHand() {
  const cards = Array.from(handBox.children) as HTMLElement[];
  const n = cards.length;
  if (!n) return;
  const W = handBox.clientWidth;
  const cw = parseFloat(getComputedStyle(handBox).getPropertyValue("--cw")) || 60;
  const step = n > 1 ? Math.min(cw * 0.76, (W - cw - 26) / (n - 1)) : 0;   // 兩端留空：旋轉的牌角不出界
  const x0 = (W - (cw + step * Math.max(0, n - 1))) / 2;
  const half = (n - 1) / 2;
  const maxRot = Math.min(9, 2 + n * 0.55) * Math.min(1.2, Math.max(0.4, fx.amp()));
  const idx = (id: number) => cards.findIndex(c => Number(c.dataset.id) === id);
  const si = selCard >= 0 && selCard !== staged ? idx(selCard) : -1;
  const focus = si >= 0 ? si : idx(hoverId);
  const room = focus >= 0 ? Math.max(0, cw * 0.62 - step) : 0;
  baseX = [];
  cards.forEach((el, i) => {
    const id = Number(el.dataset.id);
    const t = half ? (i - half) / half : 0;
    let x = x0 + i * step;
    baseX.push(x);
    el.style.zIndex = String(i + 1);
    if (id === staged) { placeStaged(el, cw); return; }
    if (focus >= 0 && i > focus) x += room * 0.5;
    else if (focus >= 0 && i < focus) x -= room * 0.5;
    let r = t * maxRot;
    if (id === selCard) r *= 0.25;
    else if (id === hoverId) r *= 0.3;
    el.style.setProperty("--x", `${x.toFixed(1)}px`);
    el.style.setProperty("--y", `${(t * t * 7).toFixed(1)}px`);
    el.style.setProperty("--r", `${r.toFixed(2)}deg`);
    el.style.removeProperty("--s");
    el.classList.toggle("hover", id === hoverId && id !== selCard);
  });
}

// 出牌預覽：牌停在桌上「你出的牌」那一格（還沒送出，畫面上標「預覽」）
function placeStaged(el: HTMLElement, cw: number) {
  const hb = handBox.getBoundingClientRect(), slot = $("mySlot").getBoundingClientRect();
  const ch = cw * 1.42;
  const cx = slot.left - hb.left + slot.width / 2, cy = slot.top - hb.top + slot.height / 2;
  el.style.setProperty("--x", `${(cx - cw / 2).toFixed(1)}px`);
  el.style.setProperty("--y", `${(cy - (hb.height - 12 - ch) - ch / 2).toFixed(1)}px`);
  el.style.setProperty("--r", "0deg");
  el.style.setProperty("--s", (slot.width / cw).toFixed(3));
  el.classList.remove("hover");
}

function selectCard(id: number, el: HTMLElement, light = false) {
  if (staged >= 0 && staged !== id) staged = -1;      // 換牌：原本預覽的那張收回手上
  selCard = id;
  hoverId = -1; hoverWant = -1;
  if (light) { sfx.hover(); fx.buzz(4); }            // 手指滑過去：柔和地一張一張升起，不放大型動畫
  else { sfx.select(); fx.buzz(8); }
  renderHand();
  if (!light) fx.bounce(el);
  renderTurn();
  renderActions();
}
function deselect() {
  selCard = -1; staged = -1;
  sfx.hover();
  renderHand(); renderTurn(); renderActions();
}

function playCard(id: number) {
  if (!st || !conn || !canPlayNow()) return;
  if (!st.legal.includes(id)) { illegal(id); return; }
  selCard = -1;
  pulled = id;                 // 先從手牌抽起來，等雲端確認再飛出去
  sfx.lift();
  setWaiting(true);
  renderHand();
  renderActions();
  conn.send({ t: "play", card: id });
}

function unpull() { if (pulled >= 0) { pulled = -1; if (st) renderHand(); } }

// 不能出的原因（不只擺動，還要說清楚）
function reasonFor(): string {
  const s = st;
  if (!s) return "";
  if (s.leadCard >= 0 && s.followCard >= 0) return "這墩還在算，等一下喔。";
  if (!myTurn()) return `等${esc(oppName())}出完這張。`;
  if (s.leaderSeat !== s.seat && s.leadCard >= 0) {
    const su = suitOf(s.leadCard);
    return `你還有 <b>${SUIT_SYMBOL[su]}</b>，要先跟牌。`;
  }
  return "這張還不能出喔。";
}
let whyEl: HTMLElement | null = null, whyTimer = 0;
function showWhy(anchor: HTMLElement, html: string) {
  whyEl?.remove();
  clearTimeout(whyTimer);
  const r = anchor.getBoundingClientRect();
  const w = document.createElement("div");
  w.className = "why";
  w.innerHTML = html;
  w.style.left = `${Math.max(90, Math.min(innerWidth - 90, r.left + r.width / 2))}px`;
  w.style.top = `${r.top - 6}px`;
  document.body.appendChild(w);
  fx.popIn(w);
  whyEl = w;
  whyTimer = window.setTimeout(() => { w.remove(); if (whyEl === w) whyEl = null; }, 1600);
}

function illegal(id: number) {
  const el = handEl(id);
  if (el) { fx.deny(el); showWhy(el, reasonFor()); }
  sfx.deny();
  fx.buzz(40);
  // 順便讓能出的牌亮一下：告訴你可以出哪幾張
  if (st) for (const c of st.legal) { const e = handEl(c); if (e) fx.glow(e, 520); }
}

// ---------------- 選牌與出牌：兩個分開的狀態 ----------------
// 點一下：選起來（再點同一張放下、點別張就換過去）；手指左右滑：跟著手指一張一張選；
// 往上拖：牌貼著手指走，拖到桌上放開 = 出牌預覽（還沒出）；往下拉回或放在別處 = 收回。
// 只有按「確認出牌」才會真的送出。滑動、雙擊、快速連點都不會出牌。
let staged = -1;                       // 出牌預覽中的牌（還沒送出）

function canSelectNow() {
  return !!st && !!conn && (st.phase === Phase.Draw || st.phase === Phase.Play) && !waiting && pulled < 0;
}

function onCardTap(id: number, el: HTMLElement) {
  if (!st || !conn) return;
  if (st.phase !== Phase.Draw && st.phase !== Phase.Play) return;
  if (waiting || pulled >= 0) { fx.bounce(el); return; }     // 正在送出：有反應，但什麼都不改
  if (staged === id) { unstage(); return; }                  // 點預覽中的牌：收回手上（還是選著）
  if (selCard === id) { deselect(); return; }                // 再點同一張：放下
  selectCard(id, el);
  // 不能出的牌也可以選起來看，但說清楚為什麼現在不能出
  if (myTurn() && !st.legal.includes(id)) showWhy(el, reasonFor());
}

function stage(id: number) {
  staged = id; selCard = id;
  sfx.slap(0.7, 0);
  fx.buzz(10);
  renderHand(); renderTurn(); renderActions();
}
function unstage(sound = true) {
  if (staged < 0) return;
  staged = -1;
  if (sound) { sfx.lift(); fx.buzz(6); }
  if (st) { renderHand(); renderTurn(); renderActions(); }
}

// 按「確認出牌」：唯一會送出的地方
function confirmPlay() {
  if (!st || waiting || pulled >= 0) return;                 // 已經送出：不重複送
  const id = staged >= 0 ? staged : selCard;
  if (id < 0) return;
  const el = handEl(id);
  if (!canPlayNow()) { if (el) showWhy(el, reasonFor()); fx.deny($("playBtn")); sfx.deny(); return; }
  if (!st.legal.includes(id)) { illegal(id); return; }
  playCard(id);
}

// ---- 手勢：點擊／水平選牌／往上拖曳／拖曳取消 ----
type Gesture = {
  pid: number; touch: boolean; id: number; el: HTMLElement;
  x0: number; y0: number; t0: number; lx: number; lt: number;
  mode: "idle" | "scrub" | "drag"; vx: number; rot: number; raf: number; over: boolean; wasStaged: boolean;
};
let gest: Gesture | null = null;
const SLOP = { touch: 10, mouse: 5 };          // 手指輕微晃動不算移動
const felt = () => $("felt");

// 手指的 x 對到哪一張牌（用沒讓位的位置，才穩定）
function cardAtX(clientX: number): HTMLElement | null {
  const cards = Array.from(handBox.children) as HTMLElement[];
  if (!cards.length || baseX.length !== cards.length) return null;
  const x = clientX - handBox.getBoundingClientRect().left;
  let k = 0;
  for (let i = 0; i < baseX.length; i++) if (x >= baseX[i]) k = i;
  return cards[k];
}

handBox.addEventListener("pointerdown", ev => {
  if (gest || (ev.pointerType === "mouse" && ev.button !== 0)) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (!el || !st) return;
  ev.preventDefault();                                     // 不選取文字、不拖曳圖片、不捲動頁面
  try { handBox.setPointerCapture(ev.pointerId); } catch { /* 有些瀏覽器不支援 */ }
  const now = performance.now();
  gest = { pid: ev.pointerId, touch: ev.pointerType !== "mouse", id: Number(el.dataset.id), el, x0: ev.clientX, y0: ev.clientY, t0: now,
    lx: ev.clientX, lt: now, mode: "idle", vx: 0, rot: 0, raf: 0, over: false, wasStaged: staged === Number(el.dataset.id) };
});

handBox.addEventListener("pointermove", ev => {
  const g = gest;
  if (g && g.pid === ev.pointerId) {
    const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
    const slop = g.touch ? SLOP.touch : SLOP.mouse;
    const now = performance.now();
    const dt = Math.max(1, now - g.lt);
    g.vx = g.vx * 0.6 + ((ev.clientX - g.lx) / dt) * 0.4;   // 手指速度（px/ms），拿來做一點慣性旋轉
    g.lx = ev.clientX; g.lt = now;
    if (g.mode === "idle" && Math.hypot(dx, dy) > slop && canSelectNow()) {
      if (g.wasStaged || (-dy > slop && -dy > Math.abs(dx) * 0.9)) startDrag(g, g.el);
      else if (Math.abs(dx) > Math.abs(dy) * 1.1) { g.mode = "scrub"; g.y0 = ev.clientY; }
    }
    if (g.mode === "scrub") {
      // 滑到哪張選哪張；手指往上抬一段 → 直接把選中的牌拖起來
      const el = cardAtX(ev.clientX);
      if (el && Number(el.dataset.id) !== selCard) selectCard(Number(el.dataset.id), el, true);
      if (g.y0 - ev.clientY > 28 && selCard >= 0) {
        const sel = handEl(selCard);
        if (sel) { startDrag(g, sel); g.x0 = ev.clientX; g.y0 = ev.clientY; }
      }
    } else if (g.mode === "drag") moveDrag(g, ev.clientX, ev.clientY);
    return;
  }
  // 桌機滑鼠：停在一張牌上 45ms 才升起（快速掃過不會一直抖）
  if (!fine || ev.pointerType !== "mouse") return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  const id = el && Number(el.dataset.id) !== staged ? Number(el.dataset.id) : -1;
  if (id === hoverWant) return;
  hoverWant = id;
  clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (hoverWant === hoverId) return;
    hoverId = hoverWant;
    if (hoverId >= 0 && hoverId !== selCard) sfx.hover();
    layoutHand();
  }, 45);
});

function startDrag(g: Gesture, el: HTMLElement) {
  g.mode = "drag";
  g.el = el; g.id = Number(el.dataset.id);
  if (selCard !== g.id && !g.wasStaged) selectCard(g.id, el, true);
  el.classList.add("dragging");
  sfx.lift();
  fx.buzz(6);
  $("mySlot").classList.add("drop");
  const tick = () => {                                     // 拖曳時的慣性旋轉：跟著手指速度微微傾斜，停下來就慢慢回正
    if (gest !== g || g.mode !== "drag") return;
    const want = Math.max(-10, Math.min(10, g.vx * 9));
    g.rot += (want - g.rot) * 0.22;
    g.vx *= 0.9;
    g.el.style.rotate = `${g.rot.toFixed(2)}deg`;
    g.raf = requestAnimationFrame(tick);
  };
  g.raf = requestAnimationFrame(tick);
}
function overTable(x: number, y: number) {
  const r = felt().getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom - 6;
}
function moveDrag(g: Gesture, x: number, y: number) {
  g.el.style.translate = `${(x - g.x0).toFixed(1)}px ${(y - g.y0).toFixed(1)}px`;     // 牌貼著手指走
  const over = overTable(x, y);
  if (over !== g.over) { g.over = over; $("mySlot").classList.toggle("over", over); if (over) fx.buzz(5); }
}
function endDrag(g: Gesture, x: number, y: number, cancelled: boolean) {
  cancelAnimationFrame(g.raf);
  $("mySlot").classList.remove("drop", "over");
  const el = g.el, id = g.id;
  el.classList.remove("dragging");
  // 清掉拖曳位移：牌會用彈簧動畫回到該去的位置（預覽格或手牌）
  el.style.translate = "";
  el.style.rotate = "";
  const wantStage = !cancelled && overTable(x, y);
  if (wantStage) {
    if (!canPlayNow() || !st!.legal.includes(id)) {         // 不能出：放開後退回手上，說清楚原因
      if (staged === id) staged = -1;
      if (st!.legal.includes(id) || !myTurn()) { showWhy(el, reasonFor()); fx.deny(el); sfx.deny(); } else illegal(id);
      renderHand(); renderTurn(); renderActions();
      return;
    }
    if (staged !== id) stage(id); else renderHand();
  } else if (staged === id) unstage();                       // 預覽的牌往下拉回手上
  else renderHand();
}

let lastPointerEnd = -1e9;
const pointerEnd = (ev: PointerEvent) => {
  const g = gest;
  if (!g || g.pid !== ev.pointerId) return;
  gest = null;
  lastPointerEnd = performance.now();
  try { handBox.releasePointerCapture(ev.pointerId); } catch { /* 已經放掉了 */ }
  if (g.mode === "drag") endDrag(g, ev.clientX, ev.clientY, ev.type === "pointercancel");
  else if (g.mode === "idle" && ev.type === "pointerup") onCardTap(g.id, g.el);   // 沒移動 = 點擊
  // 水平選牌放開：停在最後選到的那張
};
handBox.addEventListener("pointerup", pointerEnd);
handBox.addEventListener("pointercancel", pointerEnd);
handBox.addEventListener("lostpointercapture", ev => { if (gest && gest.pid === ev.pointerId) pointerEnd(new PointerEvent("pointercancel", { pointerId: ev.pointerId, clientX: gest.lx, clientY: gest.y0 })); });
handBox.addEventListener("pointerleave", () => { hoverWant = -1; clearTimeout(hoverTimer); if (hoverId >= 0 && !gest) { hoverId = -1; layoutHand(); } });
handBox.addEventListener("contextmenu", ev => ev.preventDefault());   // 長按不要跳出選單
// 只有「沒有經過按壓手勢」的點擊才在這裡處理（例如讀螢幕軟體、輔助工具）；手指／滑鼠的點擊已經在放開時處理過了
handBox.addEventListener("click", ev => {
  if (ev.detail > 0 || performance.now() - lastPointerEnd < 80) return;    // 真的手指／滑鼠點擊 detail ≥ 1，已經處理過
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el) onCardTap(Number(el.dataset.id), el);
});
handBox.addEventListener("dragstart", ev => ev.preventDefault());
// 鍵盤：Enter／空白鍵選牌、左右鍵換牌；送出一樣要按「確認出牌」
handBox.addEventListener("keydown", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (!el) return;
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onCardTap(Number(el.dataset.id), el); }
  else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    ev.preventDefault();
    const sib = (ev.key === "ArrowLeft" ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null;
    if (sib) { sib.focus(); if (canSelectNow()) selectCard(Number(sib.dataset.id), sib, true); }
  }
});
window.addEventListener("resize", () => { if (st) layoutHand(); });

// ---------------- 提示／出牌按鈕 ----------------

// 提示：跟電腦一樣的簡單判斷，但只看你看得到的東西
function hintCard(s: TableState): number {
  const legal = s.legal;
  if (!legal.length) return -1;
  const lead = s.leaderSeat === s.seat ? -1 : s.leadCard;
  const trump = s.phase === Phase.Draw ? Strain.NoTrump : bidStrain(s.highestBid);
  const byRank = (l: number[]) => l.slice().sort((a, b) => rankOf(a) - rankOf(b));
  const lowest = (l: number[]) => { const nt = l.filter(c => !isTrump(c, trump)); return byRank(nt.length ? nt : l)[0]; };
  if (s.phase === Phase.Draw) {
    const want = s.faceUp >= 0 && rankOf(s.faceUp) >= 10;
    if (lead < 0) return want ? byRank(legal).at(-1)! : lowest(legal);
    const win = legal.filter(c => beats(c, lead, trump));
    return want && win.length ? byRank(win)[0] : lowest(legal);
  }
  if (lead < 0) {
    const aces = legal.filter(c => rankOf(c) === 14 && !isTrump(c, trump));
    if (aces.length) return aces[0];
    const bySuit = new Map<number, number[]>();
    for (const c of legal) bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) ?? []), c]);
    return byRank([...bySuit.values()].sort((a, b) => b.length - a.length)[0])[0];
  }
  const win = legal.filter(c => beats(c, lead, trump));
  return win.length ? lowest(win) : lowest(legal);
}

$("hintBtn").addEventListener("click", () => {
  if (!st || !canPlayNow()) { fx.deny($("hintBtn")); sfx.deny(); return; }
  const id = hintCard(st);
  const el = handEl(id);
  if (!el) return;
  selectCard(id, el);
  el.classList.remove("hinted"); void el.offsetWidth; el.classList.add("hinted");
  burstAt(el, { count: 6, kinds: ["dust"], speed: 90, life: 0.6 });
});
$("playBtn").addEventListener("click", confirmPlay);

function renderActions() {
  const s = st;
  const ok = !!s && canPlayNow();
  $<HTMLButtonElement>("hintBtn").disabled = !ok;
  const pb = $<HTMLButtonElement>("playBtn");
  const pick = staged >= 0 ? staged : selCard;
  const legalPick = !!s && pick >= 0 && s.legal.includes(pick);
  pb.disabled = !ok || !legalPick;                         // 不能出的牌、不是你的回合：按不下去
  pb.textContent = pick >= 0 ? `確認出牌 ${cardText(pick)}` : "確認出牌";
  pb.classList.toggle("glint", ok && legalPick);
  pb.classList.toggle("ready", ok && legalPick && staged >= 0);
}

// ---------------- 輪到誰 ----------------

function renderTurn() {
  const s = st!;
  const line = $("turnLine");
  let text = "", hint = "", mine = false;
  if (s.phase === Phase.Finished) text = "";
  else if (myTurn() && s.phase !== Phase.Bidding) {
    mine = true;
    text = "換你出牌";
    const following = s.leaderSeat !== s.seat && s.leadCard >= 0;
    if (staged >= 0) hint = "預覽中：按「確認出牌」送出，點牌收回";
    else if (selCard >= 0) hint = s.legal.includes(selCard) ? "按「確認出牌」送出，或拖到桌上預覽" : `${cardText(selCard)} 現在不能出，換一張吧`;
    else if (following) {
      const su = suitOf(s.leadCard);
      const has = s.hand.some(c => suitOf(c) === su);
      const sym = `<span class="${su === 1 || su === 2 ? "red" : ""}">${SUIT_SYMBOL[su]}</span>`;
      // 只有真的能王吃（有合約王牌、手上也有）才提王牌
      const trump = s.phase === Phase.Play ? bidStrain(s.highestBid) : Strain.NoTrump;
      const canRuff = trump !== Strain.NoTrump && s.hand.some(c => suitOf(c) === trump);
      hint = has ? `跟 ${sym}：手上有就要先跟` : `你沒有 ${sym}，可以墊別的牌${canRuff ? "，或出王牌王吃" : ""}`;
    } else hint = s.phase === Phase.Draw ? `贏了這墩就拿走 ${s.faceUp >= 0 ? cardText(s.faceUp) : "明牌"}` : "你先出，出哪張都可以";
  } else if (s.phase !== Phase.Bidding && !(s.leadCard >= 0 && s.followCard >= 0)) {
    text = selCard >= 0 ? `換${oppName()}出牌…（你先選好 ${cardText(selCard)} 了）` : `換${oppName()}出牌…`;
  }
  const key = text + "|" + hint + "|" + mine;
  if (key === lastTurnText) return;
  const was = lastTurnText.split("|")[0];
  lastTurnText = key;
  line.className = "turn" + (mine ? " mine" : " wait");
  line.replaceChildren();
  if (mine) {
    const tt = document.createElement("span");
    tt.className = "tt";
    [...text].forEach((ch, i) => { const sp = document.createElement("span"); sp.className = "ch"; sp.style.setProperty("--i", String(i)); sp.textContent = ch; tt.appendChild(sp); });
    line.appendChild(tt);
    if (hint) { const h = document.createElement("span"); h.className = "hint"; h.innerHTML = hint; line.appendChild(h); }
    if (was !== text) { fx.popIn(tt); fx.buzz(12); }
  } else line.textContent = text;
}

// ---------------- 03 叫牌面板：階數＋花色 ----------------

const levelBtns: HTMLButtonElement[] = [];
const strainBtns: HTMLButtonElement[] = [];
for (let lv = 1; lv <= 7; lv++) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = String(lv);
  b.addEventListener("click", () => pickLevel(lv));
  $("bidLevels").appendChild(b);
  levelBtns.push(b);
}
for (let s = 0; s < 5; s++) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = strainText(s);
  b.setAttribute("aria-label", ["梅花", "方塊", "紅心", "黑桃", "無王"][s]);
  if (s === Strain.Hearts || s === Strain.Diamonds) b.classList.add("red");
  b.addEventListener("click", () => pickStrain(s));
  $("bidStrains").appendChild(b);
  strainBtns.push(b);
}
$("bidConfirm").addEventListener("click", () => { if (selBid >= 0) sendCall(selBid); });
$("bidPass").addEventListener("click", () => sendCall(Call.Pass));
$("bidDouble").addEventListener("click", () => { if (st) sendCall(st.canRedouble ? Call.Redouble : Call.Double); });

const legalBid = (i: number) => !!st && i >= st.minBid && i < 35;
function pickLevel(lv: number) {
  if (!myBidTurn() || waiting) return;
  if (!legalBid(bidIndex(lv, Strain.NoTrump))) return;
  selLevel = lv;
  if (selStrain >= 0 && legalBid(bidIndex(lv, selStrain))) selBid = bidIndex(lv, selStrain);
  else { selStrain = -1; selBid = -1; }
  sfx.select();
  renderBid();
  fx.bounce(levelBtns[lv - 1]);
}
function pickStrain(s: number) {
  if (!myBidTurn() || waiting) return;
  if (!selLevel) { let lv = 1; while (lv <= 7 && !legalBid(bidIndex(lv, s))) lv++; if (lv > 7) return; selLevel = lv; }
  const i = bidIndex(selLevel, s);
  if (!legalBid(i)) return;
  if (selBid === i) { sendCall(i); return; }    // 同一個花色點兩次 = 叫出去
  selStrain = s; selBid = i;
  sfx.select();
  fx.buzz(8);
  renderBid();
  fx.bounce(strainBtns[s]);
}

function sendCall(call: number) {
  if (!myBidTurn() || waiting || !conn) return;
  selBid = -1; selStrain = -1;
  setWaiting(true);
  conn.send({ t: "call", call });
}

function callHtml(c: number) {
  if (c === Call.Double || c === Call.Redouble) return `<span class="x">${callText(c)}</span>`;
  return isBid(c) && isRedBid(c) ? `<span class="red">${callText(c)}</span>` : callText(c);
}

function renderBid(first = false) {
  const s = st!;
  const panel = $("bidPanel");
  const bidding = s.phase === Phase.Bidding;
  if (!bidding) { clearTimeout(bidRevealTimer); bidRevealTimer = 0; panel.hidden = true; selBid = -1; selLevel = 0; selStrain = -1; auctionShown = 0; return; }
  if (panel.hidden) {
    if (!first && !bidRevealTimer) {
      bidRevealTimer = window.setTimeout(() => {
        panel.hidden = false;
        fx.slideIn(panel, "up");
        sfx.slide();
        if (st) renderBid(true);
      }, fx.ms(1100));
    }
    if (!first) return;
    panel.hidden = false;
  }
  bidRevealTimer = 0;
  const mine = myBidTurn();
  if (panel.classList.contains("mine") !== mine) {
    panel.classList.toggle("mine", mine);
    if (mine) { fx.punch(panel, 0.02, 260); fx.buzz(12); }
  }
  if (!mine) { selBid = -1; selStrain = -1; selLevel = 0; }
  else if (!selLevel || !legalBid(bidIndex(selLevel, Strain.NoTrump))) { selLevel = Math.min(7, Math.floor(s.minBid / 5) + 1); selStrain = -1; selBid = -1; }

  // 你 vs 對手：雙方最後一次叫的
  const lastOf = (seat: number) => { for (let i = s.auctionCalls.length - 1; i >= 0; i--) if (s.auctionSeats[i] === seat) return s.auctionCalls[i]; return null; };
  panel.style.setProperty("--tension", emo.pressure.toFixed(2));
  for (const [id, seat] of [["bidMeCard", s.seat], ["bidOppCard", 1 - s.seat]] as const) {
    if (chipPending.has(seat)) continue;
    const b = $(id).querySelector("b") as HTMLElement;
    const c = lastOf(seat);
    b.textContent = c === null ? "—" : callText(c);
    b.className = c !== null && isBid(c) && isRedBid(c) ? "red" : "";
  }
  const head = $("bidContract");
  head.classList.toggle("wait", s.highestBid < 0);
  if (s.highestBid >= 0) {
    head.innerHTML = `現在最高：${contractHtml(s)}`;
    $("bidHighSub").textContent = `${nameOf(s.highestBidder)}叫的 · 叫 ${bidLevel(s.highestBid)} 線要贏 ${tricksNeeded(s.highestBid)} 墩`;
  } else {
    head.textContent = mine ? "換你叫牌" : `換${oppName()}想一下…`;
    $("bidHighSub").textContent = "兩個人都不叫的話，就重新發牌";
  }

  // 叫牌紀錄：一個一個蓋章
  const strip = $("auctionStrip");
  if (!s.auctionCalls.length) { strip.innerHTML = `<span class="ph">叫過的牌會記在這裡</span>`; auctionShown = 0; }
  else {
    if (auctionShown === 0 || strip.querySelector(".ph")) strip.replaceChildren();
    for (let i = strip.children.length; i < s.auctionCalls.length; i++) {
      const sp = document.createElement("span");
      if (s.auctionSeats[i] === s.seat) sp.className = "me";
      sp.innerHTML = `${esc(nameOf(s.auctionSeats[i]))} ${callHtml(s.auctionCalls[i])}`;
      strip.appendChild(sp);
      if (i >= auctionShown && !first) fx.stampIn(sp);
    }
    auctionShown = s.auctionCalls.length;
    strip.scrollLeft = strip.scrollWidth;
  }

  levelBtns.forEach((b, i) => {
    const lv = i + 1;
    b.disabled = !mine || !legalBid(bidIndex(lv, Strain.NoTrump));
    b.classList.toggle("sel", mine && lv === selLevel);
  });
  strainBtns.forEach((b, sIdx) => {
    b.disabled = !mine || !selLevel || !legalBid(bidIndex(selLevel, sIdx));
    b.classList.toggle("sel", mine && sIdx === selStrain && selBid >= 0);
  });

  const confirm = $<HTMLButtonElement>("bidConfirm");
  confirm.disabled = !mine || selBid < 0;
  confirm.textContent = selBid >= 0 ? `確定叫 ${bidText(selBid)}` : "確定叫牌";
  confirm.classList.toggle("glint", mine && selBid >= 0);
  $<HTMLButtonElement>("bidPass").disabled = !mine;
  const dbl = $<HTMLButtonElement>("bidDouble");
  dbl.disabled = !mine || !(s.canDouble || s.canRedouble);
  dbl.textContent = s.canRedouble ? "再加倍" : "加倍";

  $("bidPreview").innerHTML = bidPreview(s, mine);
}

// 新手不用背公式：直接算給你看這一叫押多少
function bidPreview(s: TableState, mine: boolean): string {
  const opp = esc(oppName());
  const cur = s.highestBid;
  if (!mine) {
    const wait = `<small>換${opp}想一下…</small>`;
    if (cur < 0) return wait;
    return wait + "<br>" + (s.highestBidder === s.seat ? declarerPreview(cur, s.doubled) : defenderPreview(cur, s.doubled, opp));
  }
  if (selBid >= 0)
    return `叫 ${bidText(selBid)}：${declarerPreview(selBid, 0)}<br><small>多贏 1 墩再 +${PER_OVERTRICK} 分｜再點一次花色，或按「確定叫 ${bidText(selBid)}」</small>`;
  if (cur < 0) return "先選叫幾線，再選王牌，這裡會算給你看這局押多少分<br><small>叫 N 線 = 要贏 N + 6 墩</small>";
  if (s.canRedouble) return `${opp}對你加倍了！確定再加倍？這局倍率會變成 4 倍。<br><small>再加倍 → ${declarerPreview(cur, 2)}</small>`;
  if (s.canDouble)
    return `${defenderPreview(cur, s.doubled, opp)}<br><small>確定加倍？這局輸贏都更刺激了：打成${opp}拿 ${madePoints(cur, 1)} 分，每倒 1 墩你拿 ${pointsPerUndertrick(1)} 分</small>`;
  return s.highestBidder === s.seat ? declarerPreview(cur, s.doubled) : defenderPreview(cur, s.doubled, opp);
}

// ---------------- 叫牌紀錄（打牌中回看） ----------------

$("auctionBtn").addEventListener("click", () => {
  const s = st;
  if (!s) return;
  $("auctionList").innerHTML = s.auctionCalls.map((c, i) => `<li>${esc(nameOf(s.auctionSeats[i]))}　${callHtml(c)}</li>`).join("");
  openModal("auctionPop");
});

// ---------------- 05 結算：分段演出 ----------------

function renderResult(first: boolean) {
  const s = st!;
  if (s.phase !== Phase.Finished || !s.hasResult || !s.result) {
    $("result").hidden = true;
    clearTimeout(resultTimer);
    resultShownFor = -1;
    return;
  }
  if (resultShownFor === s.result.handNumber) return;
  resultShownFor = s.result.handNumber;
  clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => { void showResult(first); }, first ? 200 : fx.ms(2600));   // 先讓「打成！」大字演完
}

// ---------------- 結算的話：只看真的結果（誰當莊家、打成沒、加倍幾次、超／倒幾墩、整場分差） ----------------
const CLOSE_MARGIN = 20;   // 整場分差在一個普通合約（20 分）以內：險勝
const BIG_MARGIN = 60;     // 分差 60 分以上：大勝
function handTitle(r: HandResult, me: number, opp: string): string {
  const iDecl = r.declarer === me;
  if (r.made) {
    if (!iDecl) return `${opp}打成了`;
    if (r.doubled >= 2) return "這局真的有你的！";
    if (r.doubled === 1) return "這樣也被你打成了！";
    if (r.overtricks > 0) return `還多拿了 ${r.overtricks} 墩，賺到了！`;
    return "漂亮，打成了！";
  }
  if (!iDecl) return `${opp}倒約了，守得好！`;
  if (r.doubled > 0) return "這下虧大了，下局再拚！";
  return r.undertricks === 1 ? "哎呀，差一點。" : `哎呀，差了 ${r.undertricks} 墩。`;
}
function matchTitle(iWon: boolean, margin: number, opp: string): string {
  if (!iWon) return `${opp}贏了這場`;
  return margin <= CLOSE_MARGIN ? "好險！贏了！" : margin >= BIG_MARGIN ? "今天手感很猛喔！" : "這桌你說了算！";
}
function matchQuip(iWon: boolean, margin: number): string {
  if (iWon) return "好啦，這場算你厲害。";
  return margin <= CLOSE_MARGIN ? "呼，差點被你追上。" : "這次換我贏啦！";
}

async function showResult(instant: boolean) {
  const s = st;
  if (!s || !s.result || s.phase !== Phase.Finished) return;
  resultSig.skip = true;
  const sig = { skip: instant || !fx.motionOn() };
  resultSig = sig;
  const r = s.result;
  const me = s.seat;
  const matchOver = s.matchWinner >= 0;
  const iWon = s.matchWinner === me;
  const iDecl = r.declarer === me;
  const good = r.scorer === me;
  const opp = oppName();

  $("resRibbon").textContent = matchOver ? "整場打完了！" : "這局打得怎麼樣？";
  const title = $("resTitle");
  const margin = Math.abs(s.myScore - s.oppScore);
  title.textContent = matchOver ? matchTitle(iWon, margin, opp) : handTitle(r, me, opp);
  title.className = ((matchOver ? iWon : good) ? "" : "lose") + ([...title.textContent].length > 8 ? " long" : "");
  // 阿禾的一句話：只有跟阿禾打、整場打完才講（朋友連線時對面是真人）
  const quip = $("resQuip");
  const q = conn?.solo && matchOver ? matchQuip(iWon, margin) : "";
  quip.hidden = !q;
  quip.textContent = q ? `阿禾：「${q}」` : "";
  void iDecl;
  $("rsContract").innerHTML = isRedBid(r.bidIndex) ? `<span class="red">${contractText(r.bidIndex, r.doubled)}</span>` : contractText(r.bidIndex, r.doubled);
  $("rsNeed").textContent = String(r.tricksNeeded);
  $("rsTaken").textContent = "";
  $("resVerdict").innerHTML = `<span class="${r.made ? "" : "down"}">${r.made ? (r.overtricks ? `打成 超${r.overtricks}` : "打成") : `倒 ${r.undertricks} 墩`}</span>`;
  $("resPtsLabel").textContent = `${r.scorer === me ? "你" : opp}這局拿到`;
  $("resBand").classList.toggle("opp", !good);
  $("resPoints").textContent = "+0";
  const lines = breakdown(r, me, opp);
  $("resBody").replaceChildren(...lines.map((t, i) => {
    const d = document.createElement("div");
    d.textContent = t;
    if (i === lines.length - 1) d.className = "pts";
    return d;
  }));
  const before = [s.myScore - (r.scorer === me ? r.points : 0), s.oppScore - (r.scorer === me ? 0 : r.points)];
  $("rtMe").textContent = String(before[0]);
  $("rtOpp").textContent = String(before[1]);
  $("totMe").classList.toggle("lead", s.myScore > s.oppScore);
  $("totOpp").classList.toggle("lead", s.oppScore > s.myScore);
  $("resTotal").innerHTML = matchOver
    ? `<span class="won">${iWon ? "你" : esc(opp)}先到 ${s.targetScore} 分，拿下這場！</span><br>總共打了 ${r.handNumber} 局`
    : `先到 <b>${s.targetScore}</b> 分的人贏 · 你還差 ${Math.max(0, s.targetScore - s.myScore)} 分，${esc(opp)}還差 ${Math.max(0, s.targetScore - s.oppScore)} 分`;
  const next = $<HTMLButtonElement>("nextBtn");
  next.disabled = false;
  next.textContent = matchOver ? "再來一場！" : "再來一局！";
  $("result").hidden = false;
  $("skipHint").hidden = sig.skip;
  emo.clear();

  // 一步一步亮出來：合約 → 目標 → 實得 → 判定 → 得分 → 明細 → 總分 → 勝利
  const steps = ["rsC", "rsN", "rsT", "resVerdict", "resBand", "resBody", "totMe", "totOpp", "resTotal"];
  for (const id of steps) $(id).classList.toggle("pending", !sig.skip);
  let beatNo = 0;
  const showStep = async (id: string, pause: number, beat = true) => {
    const el = $(id);
    el.classList.remove("pending");
    if (!sig.skip) {
      el.classList.remove("reveal"); void el.offsetWidth; el.classList.add("reveal");
      if (beat) sfx.beat(beatNo++);
      await fx.wait(fx.ms(pause));
    }
  };
  // 1～4：合約、目標、實得、判定——一項一拍，節奏清楚
  await showStep("rsC", 320);
  await showStep("rsN", 320);
  await showStep("rsT", 0);
  await rollNumber($("rsTaken"), 0, r.tricksTaken, { dur: 360, signal: sig });
  if (!sig.skip) await fx.wait(fx.ms(260));
  $("resVerdict").classList.remove("pending");
  if (!sig.skip) {
    const v = $("resVerdict").firstElementChild as HTMLElement;
    stamp(v, !r.made);
    setTimeout(() => { if (good) sfx.contract(true); else sfx.soft(); }, fx.ms(180));
    await fx.wait(fx.ms(560));
  }
  // 5～6：得分開始加速（不重擊，留給總分）
  await showStep("resBand", 0, false);
  await rollNumber($("resPoints"), 0, r.points, { prefix: "+", dur: Math.min(520, 140 + r.points * 6), signal: sig });
  await showStep("resBody", 160, false);
  // 7：總分一次重擊收尾
  await showStep("totMe", 0, false);
  await showStep("totOpp", 0, false);
  await Promise.all([
    rollNumber($("rtMe"), before[0], s.myScore, { dur: 420, hit: r.scorer === me, signal: sig }),
    rollNumber($("rtOpp"), before[1], s.oppScore, { dur: 420, hit: r.scorer !== me, signal: sig }),
  ]);
  if (!sig.skip && good) {
    // 高風險合約成功：光芒、粒子、衝擊都更強（風險只看合約線數與加倍）
    const pw = 0.4 + 0.6 * riskOf(r.bidIndex, r.doubled);
    const tgt = $(r.scorer === me ? "rtMe" : "rtOpp");
    burstAt(tgt, { count: Math.round(10 + 26 * pw), kinds: pw > 0.7 ? ["dust", "star", "suit"] : ["dust", "star"], speed: 180 + 120 * pw });
    fx.shockAt(tgt, { size: 120 + 160 * pw });
    if (pw > 0.7) { fx.flash(0.3 * pw); sfx.impact(pw); }
  }
  await showStep("resTotal", 0);
  for (const id of steps) $(id).classList.remove("pending");
  $("skipHint").hidden = true;
  if (resultSig !== sig) return;
  $("rtMe").textContent = String(s.myScore);
  $("rtOpp").textContent = String(s.oppScore);
  $("resPoints").textContent = `+${r.points}`;
  $("rsTaken").textContent = String(r.tricksTaken);
  if (matchOver && iWon) {
    victory($("resTitle"));
    fx.popup("冠軍！", $("resTitle"), { size: 44, color: GOLD, flags: ["pop", "wave"], hold: 1200 });
  } else if (matchOver) sfx.soft();
}

// 點一下結算單：跳過動畫，直接看結果
$("resSheet").addEventListener("click", ev => {
  if ((ev.target as HTMLElement).closest("button")) return;
  resultSig.skip = true;
});

$("nextBtn").addEventListener("click", () => {
  const b = $<HTMLButtonElement>("nextBtn");
  resultSig.skip = true;
  b.disabled = true;
  b.textContent = "發牌中…";
  conn?.send({ t: "next" });
});
$("resHome").addEventListener("click", () => {
  resultSig.skip = true;
  goHome(conn?.solo ? "這局幫你存好了，按「跟阿禾打」就能接著打。" : "位子幫你留著，到「找朋友玩」按「回到這桌」就能回去。");
});

// ---------------- 事件 → 動畫與回饋（強度依真實事件分級） ----------------

const myAnchor = () => $("myAnchor");
const oppAnchor = () => $("oppAnchor");
const centerAnchor = () => $("centerAnchor");

function tick(html: string) {
  const t = $("ticker");
  t.innerHTML = html;
  if (fx.motionOn()) t.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 0.85, translate: "0 0" }], { duration: fx.ms(220) });
}
const cardHtml = (id: number) => isRedCard(id) ? `<span class="red">${cardText(id)}</span>` : cardText(id);

// ---------------- 阿禾的一句話（只有跟阿禾打；朋友連線時對面是真人，不會冒出阿禾） ----------------
// 一般贏墩大多只有動畫和音效；王吃、關鍵墩、連贏、快打成才比較會開口。
// 小泡泡浮在阿禾旁邊，不擋操作；講完一句要隔一陣子，最近講過的不重複。
let quipTimer = 0, lastQuipAt = -1e9;
const quipSaidAt = new Map<string, number>();
const handOnce = new Set<string>();     // 這一局只講一次的（連贏、快打成）
let oppStreak = 0;                      // 阿禾連續贏了幾墩
function aheSay(text: string, o: { key?: boolean; chance?: number; delay?: number; once?: string } = {}) {
  if (!conn?.solo) return;
  const now = performance.now();
  if (o.once && handOnce.has(o.once)) return;
  if (!o.key && now - lastQuipAt < 6000) return;                     // 不要一直講（關鍵墩例外）
  if (now - (quipSaidAt.get(text) ?? -1e9) < 45000) return;          // 同一句話短時間不重複
  if (o.chance !== undefined && Math.random() >= o.chance) return;  // 一般事件：偶爾才講
  lastQuipAt = now;
  quipSaidAt.set(text, now);
  if (o.once) handOnce.add(o.once);
  setTimeout(() => {
    if (!conn?.solo) return;
    const q = $("quip");
    q.innerHTML = `<span class="sr-only">阿禾：</span>${esc(text)}`;
    q.hidden = false;
    if (fx.motionOn()) q.animate([{ opacity: 0, translate: "-6px 0", scale: "0.92" }, { opacity: 1, translate: "0 0", scale: "1" }], { duration: fx.ms(220), easing: "cubic-bezier(.2,.9,.3,1.2)" });
    clearTimeout(quipTimer);
    quipTimer = window.setTimeout(() => { q.hidden = true; }, fx.settings.fast ? 1900 : 2800);
  }, fx.ms(o.delay ?? 0));
}
function hideQuip() { clearTimeout(quipTimer); $("quip").hidden = true; }

// 收一墩之後阿禾要不要講話：一墩最多一句，重要的先講
function trickQuip(e: GameEvent, s: TableState, im: Impact) {
  if (!conn?.solo || s.phase !== Phase.Play || s.declarer < 0) return;
  const winnerMe = e.seat === s.seat;
  const iDecl = s.declarer === s.seat;
  const need = tricksNeeded(s.highestBid);
  const declBefore = iDecl ? s.myTricks : s.oppTricks;          // 狀態還沒更新：這墩之前
  const declAfter = declBefore + (e.seat === s.declarer ? 1 : 0);
  const defAfter = (iDecl ? s.oppTricks : s.myTricks) + (e.seat === s.declarer ? 0 : 1);
  const stillOpen = defAfter < 14 - need;                          // 防守方還沒把合約打倒
  const delay = 520;
  if (im.outcome === "set") { aheSay(winnerMe ? "好啦，這局算你厲害。" : "哎呀，差一點。", { key: true, delay }); return; }
  if (im.outcome === "made") return;                               // 打成的大場面交給特效和結算單
  if (im.kind === "pivot") { aheSay(winnerMe ? "喔？這樣也行！" : "好險，差點就被你翻了。", { key: true, delay }); return; }
  if (e.extra === 1) { aheSay(winnerMe ? "哇，這樣也能搶！" : "嘿，沒想到吧！", { chance: 0.75, delay }); return; }
  if (stillOpen && need - declAfter === 1) { aheSay(iDecl ? "再一墩就夠了。" : "就快了喔。", { once: "near", delay }); return; }
  if (winnerMe && streak >= 3) { aheSay("欸，你今天手感不錯喔。", { once: "streakMe", delay }); return; }
  if (!winnerMe && oppStreak >= 3) { aheSay("這幾墩我就不客氣了。", { once: "streakOpp", delay }); return; }
  // 一般贏墩：大多不講。你跟在阿禾後面把這墩搶下來，才偶爾稱讚一句
  if (winnerMe && s.leaderSeat !== s.seat) aheSay("欸，這張出得漂亮。", { chance: 0.25, delay });
  else if (!winnerMe) aheSay("這墩我收下啦。", { chance: 0.2, delay });
}


function onEvent(e: GameEvent) {
  const me = e.seat === mySeat;
  const side = me ? myAnchor() : oppAnchor();
  const who = esc(nameOf(e.seat));
  switch (e.type) {
    case "NewHand":
      newHandReset();
      dealing = true;
      sfx.slide();
      sfx.resetStreak();
      streak = 0; oppStreak = 0; streakGlow($("felt"), 0);
      handOnce.clear(); hideQuip();
      impactGate = new ImpactGate();
      emo.clear();
      fx.popup(e.value > 0 ? `第 ${e.value} 局 · 發牌！` : "發牌！", centerAnchor(), { size: 28, color: INK, flags: ["pop"], hold: 600 });
      tick(`第 ${e.value} 局開始，${me ? "你" : esc(oppName())}先出`);
      if (!me) aheSay("那我先來囉。", { chance: 0.5, delay: 1100 });
      break;

    case "CardPlayed":
      // Layer A：每一張牌都重重拍在桌上（王牌稍微重一點）。結果還沒確認，所以這裡不放「王吃」的大特效
      flyPlayed(e);
      tick(e.extra === 1 ? `${who}出王牌 ${cardHtml(e.card)}` : `${who}出了 ${cardHtml(e.card)}`);
      break;

    case "TrickWon": {
      // Layer B：規則已經確認誰贏這墩，才依局勢決定衝擊等級；同一墩只演一次
      if (!st || !impactGate.once(trickKey(st))) break;
      const im = evaluateTrick(e, st);
      void collectTrick(e, im);
      trickQuip(e, st, im);
      break;
    }

    case "FaceUpTaken":
      takeFaceUp(e);
      sfx.faceUp(me);
      if (rankOf(e.card) >= 11 || me)
        fx.popup(me ? `搶到 ${cardText(e.card)}！` : `${cardText(e.card)} 被${oppName()}拿走`, side,
          { size: me ? 28 : 22, color: me ? GOLD : MUTED, flags: me ? ["pop", "wave"] : ["pop"], delay: 420 });
      tick(`${who}拿走明牌 ${cardHtml(e.card)}`);
      break;

    case "CardDrawn":
      drawHidden(me);
      if (me && e.card >= 0) { freshCards.add(e.card); const c = e.card; setTimeout(() => tick(`你摸到暗牌 ${cardHtml(c)}`), fx.ms(700)); }
      break;

    case "DrawPhaseOver":
      streak = 0; oppStreak = 0; streakGlow($("felt"), 0); emo.clear();
      // 放在上方的階段橫幅，不要蓋住等一下跳出來的叫牌面板
      fx.popup("牌搶完了，來叫牌！", $("phaseChip"), { size: 20, color: GOLD, flags: ["pop"], hold: 900, delay: 700 });
      setTimeout(() => sfx.stamp(), fx.ms(900));
      fx.buzz(20);
      break;

    case "BidMade": {
      // 叫牌逐級升溫：等級越高越重；雙方一直加碼，張力就一直疊上去
      const raise = !!st && st.highestBid >= 0;
      const tier = bidTier(bidLevel(e.value));
      // 阿禾的反應：你叫到 4 線以上（要贏 10 墩以上）才問你是不是很有把握；阿禾蓋過你的叫牌才說要叫高一點
      if (me && bidLevel(e.value) >= 4) aheSay("喔？你這麼有把握？", { key: true, delay: 700 });
      else if (!me && raise && st!.highestBidder === st!.seat) aheSay("那我再叫高一點。", { chance: 0.6, delay: 500 });
      emo.bid(e.value, raise);
      const tension = emo.pressure;
      const target = $(me ? "bidMeCard" : "bidOppCard");
      const visible = !$("bidPanel").hidden && target.getBoundingClientRect().width > 0;
      if (raise) fx.popup("加碼！", side, { size: 20 + tier * 4, color: tier >= 2 ? GOLD : INK, flags: tier >= 2 ? ["pop", "shake"] : ["pop"], delay: 40 });
      if (visible) {
        chipPending.add(e.seat);
        void bidChip(bidText(e.value), isRedBid(e.value), tier, side.getBoundingClientRect(), target, $("felt"), tension).then(() => {
          chipPending.delete(e.seat);
          if (st) renderBid();
          fx.punch($("bidContract"), 0.08 + tier * 0.05, 300);
        });
      } else sfx.bid(tier, tension);
      fx.buzz(10 + tier * 8);
      break;
    }
    case "Passed":
      fx.popup("Pass", side, { size: 26, color: MUTED });
      sfx.pass();
      {
        // 這一聲 Pass 如果結束叫牌，壓力不放掉、直接帶進合約；開場的 Pass 才稍微鬆一點
        const ends = !!st && st.highestBid >= 0;
        emo.pass(ends);
        if (!ends && emo.pressure > 0.05) setTimeout(() => sfx.release(), fx.ms(90));
      }
      break;

    case "Doubled":
      // 加倍：紅色衝擊、低頻敲擊、短暫局部震動
      emo.double();
      if (!me) aheSay("那我可要加倍了。", { key: true, delay: 500 });
      fx.popup("加倍！", side, { size: 50, color: "#F08A96", flags: ["pop", "shake"], hold: 900 });
      doubleFx($(me ? "bidMeCard" : "bidOppCard"), $("felt"));
      fx.buzz([40, 30, 40]);
      break;

    case "Redoubled":
      // 再加倍：雙重衝擊波、金紅粒子、短促亮光、更重的音效
      emo.redouble();
      if (me) aheSay("你還敢再加倍？行！", { key: true, delay: 600 });
      fx.popup("再加倍！！", side, { size: 54, color: GOLD, flags: ["pop", "shake"], hold: 1000 });
      redoubleFx($(me ? "bidMeCard" : "bidOppCard"), $("felt"));
      fx.buzz([50, 30, 50, 30, 90]);
      break;

    case "ContractSet": {
      // 合約確定：在牌桌中央蓋下去，再一次重擊定格到上方的合約欄（保留加倍狀態）
      const d = Math.max(0, e.extra);
      emo.contract(e.value, d);
      const sub = `莊家：${nameOf(e.seat)} · 要贏 ${tricksNeeded(e.value)} 墩`;
      setTimeout(() => {
        const strip = $("infoStrip");
        void contractSlam(contractText(e.value, d), isRedBid(e.value), sub, d, $("felt"), strip.hidden ? null : strip);
      }, fx.ms(60));
      setTimeout(() => sfx.slide(), fx.ms(900));
      const trump = bidStrain(e.value);
      tick(`好，合約定了！${who}當莊家，要贏 ${tricksNeeded(e.value)} 墩${trump === Strain.NoTrump ? "（無王）" : `，${SUIT_SYMBOL[trump]} 是王牌`}`);
      // 你當莊家：阿禾把壓力丟回給你；阿禾當莊家、由你先出時就不多話
      if (me) aheSay("好，這局就看你了。", { key: true, delay: 1600 });
      break;
    }
    case "GameOver": {
      const made = e.value >= e.extra;
      const good = me === made;    // 我是莊家且打成，或對方是莊家且倒約
      // 失敗時不放羞辱或懲罰特效：字小一點、顏色柔和、不震
      fx.popup(made ? "打成！" : `倒 ${e.extra - e.value} 墩`, centerAnchor(),
        { size: good ? 70 : 40, color: good ? GOLD : MUTED, flags: good ? ["pop", "wave"] : ["pop"], hold: 1500, delay: 650 });
      if (good) { setTimeout(() => fx.shake($("felt"), 6, 320), fx.ms(700)); fx.buzz([30, 50, 30, 50, 120]); }
      break;
    }
    case "HandScored":
      fx.popup(me ? `+${e.value} 分` : `${oppName()} +${e.value} 分`, side,
        { size: me ? 36 : 26, color: me ? GOLD : MUTED, flags: me ? ["pop", "wave"] : ["pop"], hold: 1000, delay: 1400 });
      break;

    case "Illegal":
      setWaiting(false);
      staged = -1;
      unpull();
      illegal(e.card);
      break;

    case "Redeal":
      fx.popup("都不叫？那重新發牌吧。", centerAnchor(), { size: 22, color: MUTED, hold: 1100 });
      emo.redeal();
      sfx.slide();
      break;
  }
}

function newHandReset() {
  $("mySlot").replaceChildren();
  $("oppSlot").replaceChildren();
  $("result").hidden = true;
  resultSig.skip = true;
  clearTimeout(resultTimer);
  resultShownFor = -1;
  selCard = selBid = -1; selLevel = 0; selStrain = -1; pulled = -1; auctionShown = 0;
  inFlight.clear();
  handBox.replaceChildren();
  $("oppFan").replaceChildren();
  $("stock").dataset.up = "";
  lastFaceUp = -1;
}

// 出牌三段節奏：抽牌（往上抽出一點）→ 飛行（微轉、影子變化）→ 落桌（壓到 93% 再彈回＋桌面小衝擊）
// 拍桌聲用音訊時鐘排在落桌那一瞬間，不等動畫結束。回傳幾毫秒後落桌（給王吃的字和聲音對時）
function flyPlayed(e: GameEvent): number {
  const me = e.seat === mySeat;
  const slot = $(me ? "mySlot" : "oppSlot");
  const to = slot.getBoundingClientRect();
  inFlight.add(e.card);
  let from: DOMRect, el: HTMLElement;
  if (me) {
    const h = handEl(e.card);
    from = h ? h.getBoundingClientRect() : to;
    if (h) h.style.visibility = "hidden";
    el = fx.cardEl(e.card);
  } else {
    const fan = $("oppFan");
    const src = (fan.lastElementChild as HTMLElement | null) ?? fan;
    from = src.getBoundingClientRect();
    if (fan.lastElementChild) fan.lastElementChild.remove();
    el = fx.backEl();
  }
  if (pulled === e.card) pulled = -1;
  // 重量：大牌、王牌、高風險合約稍微重一點（只影響手感，跟這墩會不會贏無關）
  const weight = playWeight(e.card, e.extra === 1, st);
  const pull = fx.motionOn() ? fx.ms(PLAY_T.pull) : 0;
  const flightBase = me ? PLAY_T.fly : PLAY_T.fly + 40;
  const landAt = pull + flightMs(flightBase, weight);
  // 1. 抽離手牌（紙張摩擦聲）
  fx.pin(el, from);
  const dy = me ? -20 : 10;
  const pulledRect = new DOMRect(from.left, from.top + (fx.motionOn() ? dy : 0), from.width, from.height);
  sfx.slap(weight, landAt / 1000);                 // 拍桌聲跟落桌排在同一個時鐘上
  const go = () => slamFly(el, pulledRect, to, { dur: flightBase, weight, lift: me ? 16 : 26, flipAt: me ? undefined : () => fx.flipTo(el, e.card) }).then(f => {
    // 3. 落桌：壓扁 → 陰影擴散 → 回彈
    inFlight.delete(e.card);
    f.remove();
    if (st) renderTrick(e.card);
    const landed = slot.firstElementChild;
    if (landed) contact(landed, $("felt"), weight);
  });
  // 2. 加速飛向牌桌
  void pullUp(el, dy, me, weight).then(go);
  return landAt;
}

// 收墩：勝方的牌放大發光 →（重要事件停一下）→ 兩張一起收向勝方；墩數跳動
async function collectTrick(e: GameEvent, im: Impact) {
  const winnerMe = e.seat === mySeat;
  const felt = $("felt");
  const cards: { card: HTMLElement; r: DOMRect; win: boolean }[] = [];
  for (const slot of [$("mySlot"), $("oppSlot")]) {
    const card = slot.firstElementChild as HTMLElement | null;
    if (!card) continue;
    const r = card.getBoundingClientRect();
    const clone = card.cloneNode(true) as HTMLElement;
    fx.pin(clone, r);
    slot.replaceChildren();
    cards.push({ card: clone, r, win: Number(card.dataset.id) === e.card });
  }
  const winner = cards.find(c => c.win)?.card ?? null;
  const loser = cards.find(c => !c.win)?.card ?? null;
  const drawing = e.value < 0;
  // 連續贏墩：音高、回彈、桌面光暈遞增；輸一墩就恢復
  streak = winnerMe ? streak + 1 : 0;
  oppStreak = winnerMe ? 0 : oppStreak + 1;
  streakGlow(felt, streak);
  // Layer B：依 Impact 等級演出（壓痕、裂痕、下沉、定格…），回傳要定格多久
  const hold = presentImpact(im, { felt, winner, loser, markers: [$("infoStrip"), $("tallyPanel")], streak: winnerMe ? streak : 0 });
  const hs = hold > 0 ? hold : 0;
  const msBase = (t: number) => (fx.motionOn() ? t : 0);
  if (winnerMe && streak >= 3) fx.popup(`連贏 ${streak} 墩`, myAnchor(), { size: 18 + Math.min(4, streak - 3) * 2, color: GOLD, flags: ["pop"], delay: 520 });
  if (!drawing) {
    const good = im.good;
    if (im.outcome) {
      // 合約定案（Tier 3／4）：先重擊、定格，接著把叫牌以來累積的壓力釋放出來（沉重的一方只收掉壓力）
      const made = im.outcome === "made";
      const text = im.kind === "match" && good ? (im.comeback ? "逆轉！" : "決勝一墩！")
        : made ? (winnerMe ? "打成了！" : `${oppName()}打成了`) : (winnerMe ? `${oppName()}倒約了！` : "倒約了…");
      const r0 = riskOf(st?.highestBid ?? -1, st?.doubled ?? 0);
      const power = im.tier === 4 ? Math.max(r0, 0.85) : r0;
      fx.popup(text, centerAnchor(), { size: good ? 40 + Math.round(power * 14) : 28, color: good ? GOLD : MUTED, flags: good ? ["pop", "wave"] : ["pop"], hold: 1100, delay: (good ? 380 : 240) + msBase(im.hitstop) });
      setTimeout(() => void emo.release(good, power, centerAnchor(), felt), fx.ms(200) + hs);
    } else if (im.tier === 2 && im.label) {
      // 王吃、關鍵一墩、加倍局再一墩：結果確認了才亮字
      const ruff = im.kind === "ruff";
      fx.popup(im.label.endsWith("！") ? im.label : (winnerMe ? `${im.label}！` : im.label), ruff ? (winnerMe ? myAnchor() : oppAnchor()) : centerAnchor(),
        { size: ruff ? (winnerMe ? 50 : 34) : 30, color: winnerMe ? GOLD : MUTED, flags: winnerMe ? ["pop", "shake"] : ["pop"], hold: ruff ? 800 : 600, delay: 120 + msBase(im.hitstop) });
    }
    fx.popup(winnerMe ? "+1 墩" : `${oppName()} +1 墩`, winnerMe ? myAnchor() : oppAnchor(),
      { size: winnerMe ? 24 : 20, color: winnerMe ? GOOD : MUTED, delay: 300 + msBase(im.hitstop) });
  }
  if (hs) await fx.wait(hs + fx.ms(30));          // 定格：等壓到底的那一下停完，再把牌收走
  const dest = (winnerMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  const target = fx.rectAt(c.x, winnerMe ? dest.top + 20 : c.y, 30, 42);
  for (const { card, r, win } of cards) {
    setTimeout(() => {
      fx.fly(card, r, target, { dur: 340, fade: true, easing: fx.EASE.in, lift: 10 }).then(f => f.remove());
    }, fx.ms(win ? 420 : 380));
  }
}

// 抽牌階段：明牌發光飛向贏家（亮一點的提示音）
function takeFaceUp(e: GameEvent) {
  const up = document.querySelector<HTMLElement>("#faceUp .card");
  if (!up) return;
  const r = up.getBoundingClientRect();
  const clone = up.cloneNode(true) as HTMLElement;
  fx.pin(clone, r);
  up.style.visibility = "hidden";
  fx.glow(clone, 600);
  const winnerMe = e.seat === mySeat;
  if (winnerMe) burstAt(up, { count: rankOf(e.card) >= 11 ? 16 : 8, kinds: ["dust", "star"], speed: 180 });
  const dest = (winnerMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  setTimeout(() => {
    fx.fly(clone, r, fx.rectAt(c.x, winnerMe ? dest.top + 30 : c.y, 40, 57), { dur: 420, fade: true }).then(f => f.remove());
  }, fx.ms(300));
}

// 輸墩的人摸一張暗牌：牌背從牌堆飛到他手上（摸到的牌在手上翻開）
function drawHidden(toMe: boolean) {
  const pile = document.getElementById("pile");
  if (!pile) return;
  const r = (pile.lastElementChild ?? pile).getBoundingClientRect();
  const dest = (toMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  const back = fx.backEl();
  setTimeout(() => {
    sfx.draw();
    fx.fly(back, r, fx.rectAt(c.x, toMe ? dest.top + 40 : c.y, 34, 48), { dur: 380, fade: true }).then(f => f.remove());
  }, fx.ms(450));
}

// ---------------- 08 設定、靜音、選單 ----------------

function openModal(id: string) {
  const m = $(id);
  m.hidden = false;
  sfx.slide();
}
function openMenu() {
  renderSettings($("settingsBox"));
  const inTable = screen === "table" && !!conn;
  $("menuTitle").textContent = inTable ? "選單" : "設定";
  $("leaveBtn").hidden = !inTable;
  $("restartSolo").hidden = !(inTable && conn?.solo);
  $("leaveBtn").textContent = conn?.solo ? "回首頁" : "離開這桌";
  openModal("menu");
}
$("menuBtn").addEventListener("click", openMenu);
function renderMute() { $("muteBtn").textContent = fx.settings.muted ? "🔇" : "🔊"; $("muteBtn").setAttribute("aria-label", fx.settings.muted ? "取消靜音" : "靜音"); }
$("muteBtn").addEventListener("click", () => { fx.settings.muted = !fx.settings.muted; fx.saveSettings(); renderMute(); sfx.toggle(!fx.settings.muted); });
renderMute();
$("leaveBtn").addEventListener("click", () => {
  // 朋友連線：先問一聲（位子會留著）；跟阿禾打會自動存檔，直接回首頁
  if (!conn?.solo && !confirm("確定要離開這桌嗎？（位子會幫你留著）")) return;
  goHome(conn?.solo ? "這局幫你存好了，按「跟阿禾打」就能接著打。" : "位子幫你留著，到「找朋友玩」按「回到這桌」就能回去。");
});
$("restartSolo").addEventListener("click", () => {
  if (!confirm("要重新開始嗎？這局進度不會保留。")) return;
  $("menu").hidden = true;
  if (conn instanceof LocalTable) conn.restart();     // 會發 NewHand：牌桌照新局的流程清空重畫
});
for (const m of ["menu", "auctionPop", "rulesModal", "storyOffer", "homeMenu", "newsModal"]) {
  const modal = $(m);
  modal.addEventListener("click", ev => {
    if (ev.target === modal || (ev.target as HTMLElement).closest("[data-close]")) modal.hidden = true;
  });
}

// 按鈕：按下去像厚紙卡（音效＋手機輕震）
document.addEventListener("pointerdown", ev => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>(".btn, .strip, .icon, .back, .cv-btn, .cv-card, .cv-icon");
  if (b && !(b as HTMLButtonElement).disabled) { const w = b.closest("#bidPanel") ? emo.pressure : 0; sfx.press(w); fx.buzz(6 + Math.round(w * 14)); }
}, { passive: true });

// ---------------- 小工具 ----------------

function esc(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

// ---------------- 啟動 ----------------

fx.initFx($("fx"), $("app"));
emo.attach($("app"));
emo.onChange(p => $("bidPanel").style.setProperty("--tension", p.toFixed(2)));
{
  const params = new URLSearchParams(location.search);
  const room = normalizeCode(params.get("room") ?? "");
  const solo = params.get("solo");
  if (solo === "new" || solo === "1") enterSolo(solo === "new");   // 故事最後的「自己跟電腦打一局」= new：重新發牌
  else if (isValidCode(room)) {
    codeInput.value = room;
    if (savedToken(room)) enter(room);
    else { show("online"); say(`朋友找你打牌！房號 ${room}，填好名字按「加入牌桌」。`); }
  }
  refreshResume();
  // 封面：標題、三顆按鈕、四張篇章卡依序淡入
  if (screen === "home") {
    fx.slideIn($("titleCard"), "up");
    Array.from(document.querySelectorAll("#home .cv-btn")).forEach((el, i) => fx.slideIn(el, "up", 90 + i * 70));
    Array.from(document.querySelectorAll("#home .cv-card")).forEach((el, i) => fx.slideIn(el, "up", 320 + i * 60));
  }
}
