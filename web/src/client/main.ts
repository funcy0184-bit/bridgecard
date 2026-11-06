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
import { breakdown, contractText, declarerPreview, defenderPreview, madePoints, pointsPerUndertrick, PER_OVERTRICK } from "../game/scoring";
import { SeatInfo, ServerMsg, isValidCode, normalizeCode } from "../server/protocol";
import * as fx from "./fx";
import { Connection, LAST_ROOM_KEY, createRoom, forgetRoom, roomInfo, savedToken, store } from "./net";
import { Link, LocalTable, hasUnfinishedSolo } from "./solo";
import { sfx } from "./sound";
import {
  Level, bidChip, bidTier, contractFeedback, contractSlam, doubleFx, flipNumber, hitstop, redoubleFx, rollNumber, stamp, streakGlow,
  trickFeedback, victory,
} from "./feedback";
import { burstAt } from "./particles";
import { renderSettings } from "./settings-ui";

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
let tension = 0;           // 競叫張力 0..1（加碼累積、Pass 釋放、重發歸零）
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
$("goRules").addEventListener("click", () => openModal("rulesModal"));
$("goSettings").addEventListener("click", () => openMenu());

$("create").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("create");
  b.disabled = true; say("開房中…");
  try { enter(await createRoom()); }
  catch (e) { say((e as Error).message, true); }
  finally { b.disabled = false; }
});

$("join").addEventListener("click", async () => {
  const code = normalizeCode(codeInput.value);
  if (!isValidCode(code)) { say("房號是 4 個英文字母或數字", true); fx.deny(codeInput); sfx.deny(); return; }
  say("找房間中…");
  try {
    const info = await roomInfo(code);
    if (!info.exists) { say("找不到這個房號，可能打錯了，或房間已經過期", true); return; }
    if (info.seats?.every(Boolean) && !savedToken(code)) { say("這桌已經坐滿了", true); return; }
    enter(code);
  } catch (e) { say((e as Error).message, true); }
});

function refreshResume() {
  const last = store.get(LAST_ROOM_KEY);
  const b = $("resume");
  b.hidden = !(last && savedToken(last));
  if (!b.hidden) b.textContent = `回到 ${last} 這桌`;
  $("soloSub").textContent = hasUnfinishedSolo() ? "繼續跟阿禾（電腦）的牌局" : "跟阿禾（電腦）打一場";
  refreshStoryCard();
}
$("resume").addEventListener("click", () => { const last = store.get(LAST_ROOM_KEY); if (last) enter(last); });

// 回首頁（或回朋友連線頁顯示錯誤）
function goHome(msg = "", err = false, toOnline = false) {
  conn?.close(); conn = null;
  clearTimeout(resultTimer);
  resultSig.skip = true;
  for (const id of ["result", "menu", "auctionPop", "banner", "storyOffer", "rulesModal"]) $(id).hidden = true;
  history.replaceState(null, "", "/");
  show(toOnline ? "online" : "home");
  say(toOnline ? msg : "", err);
  if (msg && !toOnline) banner(msg, 3200);
  refreshResume();
}

// ---------------- 07 阿禾的故事（教學）入口 ----------------

const STORY_KEY = "hb.story.v2";      // 跟 /story/ 用同一個進度鍵
const OFFER_KEY = "hb-story-offered";
function storyProgress(): { page: number; finished: boolean } | null {
  try {
    const p = JSON.parse(store.get(STORY_KEY) ?? "null");
    return p && p.v === 2 && Number.isInteger(p.page) ? { page: p.page, finished: !!p.finished } : null;
  } catch { return null; }
}
const ACT_OF_PAGE = [1, 2, 3, 3, 4];
function refreshStoryCard() {
  const p = storyProgress();
  $("storyCardTitle").textContent = !p ? "故事教學" : p.finished ? "再聽一次故事" : "繼續故事教學";
  $("storyCardSub").textContent = !p ? "第一次玩？跟阿禾邊玩邊學，約 5 分鐘"
    : p.finished ? "四幕都完成了 ✓ 隨時回來複習" : `上次看到第 ${ACT_OF_PAGE[p.page] ?? 1} 幕`;
  $("solo").classList.toggle("lead", !!p);
  $("storyCard").classList.toggle("lead", !p);
}
// 第一次按「開始對戰／朋友連線」：先問要不要跟阿禾學（只問一次）
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
  c.onStatus = s => {
    if (s === "reconnecting") banner("連線中斷，重新連線中…");
    else if (s === "open") renderPresence();
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
      goHome("這桌已經坐滿了", true, true);
      break;
    case "gone":
      forgetRoom(conn?.code ?? "");
      goHome("找不到這個房號，可能打錯了，或房間已經過期", true, true);
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
  $("plateOppName").textContent = opp?.taken ? opp.name : "等待中…";
  if (opp?.taken && !plate.classList.contains("in")) {
    plate.classList.add("in");
    fx.slideIn(plate, "right");
    if (!before[1 - mySeat]) { sfx.join(); const em = plate.querySelector("em"); if (em) fx.stampIn(em, 200); }
  }
}
const inviteUrl = () => `${location.origin}/?room=${conn?.code ?? ""}`;
$("share").addEventListener("click", async () => {
  const url = inviteUrl();
  const text = `來打橋牌！跟我打一場蜜月橋牌，房號 ${conn?.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "來打橋牌", text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); flashLabel($("share"), "已複製邀請！"); }
  } catch { /* 使用者取消分享 */ }
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(inviteUrl()); flashLabel($("copy"), "已複製！"); }
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
  $("oppName").textContent = oppName();
  $("oppNameTop").textContent = oppName();
  $("bidOppName").textContent = oppName();
  $("rtOppName").textContent = oppName();
}

function renderPresence() {
  const opp = seats[1 - mySeat];
  $("oppDot").classList.toggle("off", !!opp && !opp.online);
  if (started && opp && !opp.online) banner(`${oppName()} 斷線了，等他回來…（牌局會保留）`);
  else $("banner").hidden = true;
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
  const txt = s.phase === Phase.Draw ? "前半場｜搶牌" : s.phase === Phase.Bidding ? "叫牌階段" : s.phase === Phase.Play ? "後半場｜出牌" : "本局結束";
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
    info.innerHTML = `合約 ${contractHtml(s)}<span> · 莊家 <b>${s.declarer === s.seat ? "你" : esc(oppName())}</b> · 目標 ${tricksNeeded(s.highestBid)} 墩</span>`;
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
    lbl.textContent = "拿走：";
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
  if (s.phase === Phase.Draw) el.innerHTML = `牌堆剩 <b>${s.stockCount}</b> 張 · 贏墩拿明牌、輸墩摸暗牌`;
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
    $("tallyLabel").textContent = iDecl ? "你的墩數" : `${oppName()}墩數`;
    flipNumber($("tallyBig"), String(iDecl ? s.myTricks : s.oppTricks), true, Math.min(4, Math.max(0, streak - 1)) * 0.06);
    $("tallyNeed").textContent = String(tricksNeeded(s.highestBid));
    $("tallyLine").textContent = `你 ${s.myTricks}｜${oppName()} ${s.oppTricks}`;
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
  else if (canPlay && selCard >= 0 && !legal.has(selCard)) {
    const old = selCard;
    selCard = -1;
    setTimeout(() => { const el = handEl(old); if (el) showWhy(el, reasonFor()); }, 0);
  }

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
    if (isNew && !first) {
      if (dealing) fx.popIn(el, i * 45);
      else if (freshCards.has(id)) {
        el.classList.add("fresh");
        fx.flipIn(el);
        const e2 = el;
        setTimeout(() => e2.classList.remove("fresh"), fx.ms(1700));
      } else fx.popIn(el);
    }
    el.setAttribute("aria-label", cardText(id) + (canPlay && !legal.has(id) ? "（現在不能出）" : ""));
  });
  // 依照順序排 DOM（鍵盤 Tab 也照順序）
  ids.forEach(id => { const el = handEl(id); if (el) handBox.appendChild(el); });
  layoutHand();
  freshCards.clear();
  dealing = false;
}

// 扇形排列；滑鼠移到哪張，右邊的牌往旁邊讓位，避免重疊難選
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
  const hi = cards.findIndex(c => Number(c.dataset.id) === hoverId);
  const room = hi >= 0 ? Math.max(0, cw * 0.6 - step) : 0;
  cards.forEach((el, i) => {
    const id = Number(el.dataset.id);
    const t = half ? (i - half) / half : 0;
    let x = x0 + i * step;
    if (hi >= 0 && i > hi) x += room;
    else if (hi >= 0 && i < hi) x -= room * 0.35;
    let r = t * maxRot;
    if (id === selCard) r = (id % 2 ? 3 : -3);
    else if (id === hoverId) r *= 0.3;
    el.style.setProperty("--x", `${x.toFixed(1)}px`);
    el.style.setProperty("--y", `${(t * t * 7).toFixed(1)}px`);
    el.style.setProperty("--r", `${r.toFixed(2)}deg`);
    el.style.zIndex = String(i + 1);
    el.classList.toggle("hover", id === hoverId && id !== selCard);
  });
}

function selectCard(id: number, el: HTMLElement) {
  selCard = id;
  hoverId = -1; hoverWant = -1;
  sfx.select();
  fx.buzz(8);
  renderHand();
  fx.bounce(el);
  renderTurn();
  renderActions();
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
  if (s.leadCard >= 0 && s.followCard >= 0) return "這墩結算中，等一下";
  if (!myTurn()) return `還沒輪到你，等${esc(oppName())}出牌`;
  if (s.leaderSeat !== s.seat && s.leadCard >= 0) {
    const su = suitOf(s.leadCard);
    return `你手上還有 <b>${SUIT_SYMBOL[su]}</b>，這墩要先跟 <b>${SUIT_SYMBOL[su]}</b>`;
  }
  return "這張現在不能出";
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

function onCardTap(id: number, el: HTMLElement) {
  if (!st || !conn) return;
  if (st.phase !== Phase.Draw && st.phase !== Phase.Play) return;
  if (waiting || pulled >= 0) { fx.bounce(el); return; }      // 正在出牌：有反應，但不重複送出
  if (!myTurn()) {
    // 還沒輪到你：可以先選好，點下去立刻有反應；再點一次才說明為什麼還不能出
    if (selCard === id) { fx.deny(el); sfx.deny(); showWhy(el, reasonFor()); return; }
    selectCard(id, el);
    return;
  }
  if (!st.legal.includes(id)) { illegal(id); return; }
  if (selCard === id) { playCard(id); return; }   // 第二次點同一張 = 出牌
  selectCard(id, el);
}

// 拖曳：把牌往上拖超過一段距離放開 = 出牌；沒拖夠就彈回去
let drag: { id: number; el: HTMLElement; x0: number; y0: number; lx: number; on: boolean; pid: number } | null = null;
let suppressClick = false;
handBox.addEventListener("pointerdown", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (!el || !st) return;
  drag = { id: Number(el.dataset.id), el, x0: ev.clientX, y0: ev.clientY, lx: ev.clientX, on: false, pid: ev.pointerId };
});
handBox.addEventListener("pointermove", ev => {
  if (drag && drag.pid === ev.pointerId) {
    const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.on && Math.hypot(dx, dy) > 9 && canPlayNow() && st!.legal.includes(drag.id)) {
      drag.on = true;
      drag.el.classList.add("dragging");
      try { drag.el.setPointerCapture(ev.pointerId); } catch { /* 有些瀏覽器不支援 */ }
      sfx.lift();
    }
    if (drag.on) {
      const vx = ev.clientX - drag.lx;
      drag.lx = ev.clientX;
      drag.el.style.translate = `${dx}px ${Math.min(30, dy)}px`;
      drag.el.style.rotate = `${Math.max(-12, Math.min(12, vx * 1.2))}deg`;
      return;
    }
  }
  if (!fine || ev.pointerType !== "mouse") return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  const id = el ? Number(el.dataset.id) : -1;
  if (id === hoverWant) return;
  hoverWant = id;
  clearTimeout(hoverTimer);
  // 滑鼠快速掃過一整排不會讓牌一直抖：停在一張牌上 45ms 才升起
  hoverTimer = window.setTimeout(() => {
    if (hoverWant === hoverId) return;
    hoverId = hoverWant;
    if (hoverId >= 0) sfx.hover();
    layoutHand();
  }, 45);
});
const endDrag = (ev: PointerEvent) => {
  if (!drag || drag.pid !== ev.pointerId) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  const dy = ev.clientY - d.y0;
  d.el.classList.remove("dragging");
  d.el.style.translate = "";
  d.el.style.rotate = "";
  if (ev.type === "pointerup" && dy < -55) playCard(d.id);
};
handBox.addEventListener("pointerup", endDrag);
handBox.addEventListener("pointercancel", endDrag);
handBox.addEventListener("pointerleave", () => { hoverWant = -1; clearTimeout(hoverTimer); if (hoverId >= 0 && !drag) { hoverId = -1; layoutHand(); } });
handBox.addEventListener("click", ev => {
  if (suppressClick) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el) onCardTap(Number(el.dataset.id), el);
});
handBox.addEventListener("keydown", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onCardTap(Number(el.dataset.id), el); }
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
$("playBtn").addEventListener("click", () => { if (selCard >= 0) playCard(selCard); });

function renderActions() {
  const s = st;
  const ok = !!s && canPlayNow();
  $<HTMLButtonElement>("hintBtn").disabled = !ok;
  const pb = $<HTMLButtonElement>("playBtn");
  pb.disabled = !ok || selCard < 0;
  pb.textContent = selCard >= 0 ? `出 ${cardText(selCard)}` : "出牌";
  pb.classList.toggle("glint", ok && selCard >= 0);
}

// ---------------- 輪到誰 ----------------

function renderTurn() {
  const s = st!;
  const line = $("turnLine");
  let text = "", hint = "", mine = false;
  if (s.phase === Phase.Finished) text = "";
  else if (myTurn() && s.phase !== Phase.Bidding) {
    mine = true;
    text = "輪到你出牌";
    const following = s.leaderSeat !== s.seat && s.leadCard >= 0;
    if (selCard >= 0) hint = `再點一次 ${cardText(selCard)}，或按「出牌」`;
    else if (following) {
      const su = suitOf(s.leadCard);
      const has = s.hand.some(c => suitOf(c) === su);
      const sym = `<span class="${su === 1 || su === 2 ? "red" : ""}">${SUIT_SYMBOL[su]}</span>`;
      hint = has ? `請跟出 ${sym}（有則必須跟牌）` : `你沒有 ${sym}，可以墊牌${s.phase === Phase.Play && bidStrain(s.highestBid) !== Strain.NoTrump ? "或出王牌" : ""}`;
    } else hint = s.phase === Phase.Draw ? `贏這墩拿明牌 ${s.faceUp >= 0 ? cardText(s.faceUp) : ""}` : "你先出，任何一張都可以";
  } else if (s.phase !== Phase.Bidding && !(s.leadCard >= 0 && s.followCard >= 0)) {
    text = selCard >= 0 ? `等${oppName()}出牌…（已先選 ${cardText(selCard)}）` : `等${oppName()}出牌…`;
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
  panel.style.setProperty("--tension", tension.toFixed(2));
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
    head.innerHTML = `目前最高叫牌 ${contractHtml(s)}`;
    $("bidHighSub").textContent = `${nameOf(s.highestBidder)}叫的 · 叫 ${bidLevel(s.highestBid)} 線需取得 ${tricksNeeded(s.highestBid)} 墩`;
  } else {
    head.textContent = mine ? "輪到你叫牌" : `等${oppName()}叫牌…`;
    $("bidHighSub").textContent = "雙方一開始都 Pass 就重新發牌";
  }

  // 叫牌紀錄：一個一個蓋章
  const strip = $("auctionStrip");
  if (!s.auctionCalls.length) { strip.innerHTML = `<span class="ph">叫牌紀錄會蓋在這裡</span>`; auctionShown = 0; }
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
  confirm.textContent = selBid >= 0 ? `叫 ${bidText(selBid)}` : "叫牌";
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
    const wait = `<small>等${opp}叫牌…</small>`;
    if (cur < 0) return wait;
    return wait + "<br>" + (s.highestBidder === s.seat ? declarerPreview(cur, s.doubled) : defenderPreview(cur, s.doubled, opp));
  }
  if (selBid >= 0)
    return `叫 ${bidText(selBid)}：${declarerPreview(selBid, 0)}<br><small>超墩每墩 +${PER_OVERTRICK} 分｜再點一次花色或按「叫 ${bidText(selBid)}」送出</small>`;
  if (cur < 0) return "先選階數、再選花色，這裡會算給你看這局押多少分<br><small>叫 N 線 = 要拿 N + 6 墩</small>";
  if (s.canRedouble) return `${opp}對你加倍了！<br>再加倍 → ${declarerPreview(cur, 2)}`;
  if (s.canDouble)
    return `${defenderPreview(cur, s.doubled, opp)}<br>加倍 → 打成${opp}得 ${madePoints(cur, 1)} 分｜每倒 1 墩你得 ${pointsPerUndertrick(1)} 分`;
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

  $("resRibbon").textContent = matchOver ? "整場結算" : `第 ${r.handNumber} 局結算`;
  const title = $("resTitle");
  title.textContent = matchOver ? (iWon ? "你獲勝！" : `${opp}獲勝`)
    : r.made ? (iDecl ? "合約達成！" : `${opp}打成了`) : (iDecl ? `倒 ${r.undertricks} 墩` : "成功擊破！");
  title.className = good ? "" : "lose";
  $("rsContract").innerHTML = isRedBid(r.bidIndex) ? `<span class="red">${contractText(r.bidIndex, r.doubled)}</span>` : contractText(r.bidIndex, r.doubled);
  $("rsNeed").textContent = String(r.tricksNeeded);
  $("rsTaken").textContent = "";
  $("resVerdict").innerHTML = `<span class="${r.made ? "" : "down"}">${r.made ? (r.overtricks ? `打成 超${r.overtricks}` : "打成") : `倒 ${r.undertricks} 墩`}</span>`;
  $("resPtsLabel").textContent = `${r.scorer === me ? "你" : opp} 本局得分`;
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
    ? `<span class="won">${iWon ? "你" : esc(opp)}先達 ${s.targetScore} 分，贏得整場！</span><br>共打了 ${r.handNumber} 局`
    : `先得 <b>${s.targetScore}</b> 分者獲勝 · 你還差 ${Math.max(0, s.targetScore - s.myScore)} 分 · ${esc(opp)}還差 ${Math.max(0, s.targetScore - s.oppScore)} 分`;
  const next = $<HTMLButtonElement>("nextBtn");
  next.disabled = false;
  next.textContent = matchOver ? "再來一場" : "下一局";
  $("result").hidden = false;
  $("skipHint").hidden = sig.skip;

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
    setTimeout(() => { if (good) sfx.contract(true); else sfx.defeat(); }, fx.ms(180));
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
  if (!sig.skip && good) { burstAt($(r.scorer === me ? "rtMe" : "rtOpp"), { count: 14, kinds: ["dust", "star"], speed: 200 }); fx.shockAt($(r.scorer === me ? "rtMe" : "rtOpp"), { size: 140 }); }
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
  } else if (matchOver) sfx.defeat();
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
  goHome(conn?.solo ? "這局幫你存好了，按「開始對戰」就能接著打" : "你的座位會保留，在「朋友連線」按「回到這桌」就能回去");
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

// 這一墩算幾級：只看真的發生的事
function trickLevel(e: GameEvent, s: TableState): { level: Level; text: string } {
  if (s.phase !== Phase.Play || s.declarer < 0) return { level: 1, text: "" };
  const need = tricksNeeded(s.highestBid);
  const setAt = 14 - need;                        // 防守方拿到這麼多墩，合約就倒了
  const winnerDecl = e.seat === s.declarer;
  const playedBefore = s.myTricks + s.oppTricks;  // 狀態還沒更新，是這墩之前的數字
  const left = 13 - playedBefore;                 // 包含這一墩
  const declBefore = s.declarer === s.seat ? s.myTricks : s.oppTricks;
  if (winnerDecl && e.value === need) return { level: 3, text: "合約達成" };
  if (!winnerDecl && e.value === setAt) return { level: 3, text: "合約擊破" };
  if (winnerDecl && need - declBefore === left) return { level: 2, text: "關鍵一墩" };   // 一墩都不能丟還是拿下來了
  if (e.extra === 1) return { level: 2, text: "王吃" };
  return { level: 1, text: "" };
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
      streak = 0; streakGlow($("felt"), 0);
      tension = 0;
      fx.popup(e.value > 0 ? `第 ${e.value} 局 · 發牌！` : "發牌！", centerAnchor(), { size: 28, color: INK, flags: ["pop"], hold: 600 });
      tick(`第 ${e.value} 局開始，${me ? "你" : esc(oppName())}先出`);
      break;

    case "CardPlayed": {
      const landAt = flyPlayed(e);
      if (e.extra === 1) {
        // 王吃：字和聲音都在落桌那一瞬間；重的回饋留給贏墩（Level 2）
        fx.popup("王吃！", side, { size: 54, color: GOLD, flags: ["pop", "shake"], hold: 800, delay: landAt });
        sfx.ruff(fx.ms(landAt) / 1000);
        fx.buzz([30, 40, 70]);
        tick(`${who}用王牌 ${cardHtml(e.card)} 吃！`);
      } else tick(`${who}出了 ${cardHtml(e.card)}`);
      break;
    }

    case "TrickWon": {
      const lv = st ? trickLevel(e, st) : { level: 1 as Level, text: "" };
      void collectTrick(e, lv.level, lv.text);
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
      streak = 0; streakGlow($("felt"), 0); tension = 0;
      // 放在上方的階段橫幅，不要蓋住等一下跳出來的叫牌面板
      fx.popup("搶牌結束 · 開始叫牌", $("phaseChip"), { size: 20, color: GOLD, flags: ["pop"], hold: 900, delay: 700 });
      setTimeout(() => sfx.stamp(), fx.ms(900));
      fx.buzz(20);
      break;

    case "BidMade": {
      // 叫牌逐級升溫：等級越高越重；雙方一直加碼，張力就一直疊上去
      const raise = !!st && st.highestBid >= 0;
      const tier = bidTier(bidLevel(e.value));
      tension = raise ? Math.min(1, tension + 0.16 + tier * 0.06) : tier * 0.12;
      $("bidPanel").style.setProperty("--tension", tension.toFixed(2));
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
      if (tension > 0.05) {
        // Pass：張力釋放
        tension *= 0.4;
        $("bidPanel").style.setProperty("--tension", tension.toFixed(2));
        setTimeout(() => sfx.release(), fx.ms(90));
      }
      break;

    case "Doubled":
      // 加倍：紅色衝擊、低頻敲擊、短暫局部震動
      tension = Math.min(1, tension + 0.3);
      $("bidPanel").style.setProperty("--tension", tension.toFixed(2));
      fx.popup("加倍！", side, { size: 50, color: "#F08A96", flags: ["pop", "shake"], hold: 900 });
      doubleFx($(me ? "bidMeCard" : "bidOppCard"), $("felt"));
      fx.buzz([40, 30, 40]);
      break;

    case "Redoubled":
      // 再加倍：雙重衝擊波、金紅粒子、短促亮光、更重的音效
      tension = 1;
      $("bidPanel").style.setProperty("--tension", "1");
      fx.popup("再加倍！！", side, { size: 54, color: GOLD, flags: ["pop", "shake"], hold: 1000 });
      redoubleFx($(me ? "bidMeCard" : "bidOppCard"), $("felt"));
      fx.buzz([50, 30, 50, 30, 90]);
      break;

    case "ContractSet": {
      // 合約確定：在牌桌中央蓋下去，再一次重擊定格到上方的合約欄（保留加倍狀態）
      const d = Math.max(0, e.extra);
      tension = 0;
      const sub = `莊家 ${nameOf(e.seat)} · 目標 ${tricksNeeded(e.value)} 墩`;
      setTimeout(() => {
        const strip = $("infoStrip");
        void contractSlam(contractText(e.value, d), isRedBid(e.value), sub, d, $("felt"), strip.hidden ? null : strip);
      }, fx.ms(60));
      setTimeout(() => sfx.slide(), fx.ms(900));
      const trump = bidStrain(e.value);
      tick(`${who}是莊家，要拿 ${tricksNeeded(e.value)} 墩${trump === Strain.NoTrump ? "（無王）" : `，${SUIT_SYMBOL[trump]} 是王牌`}`);
      break;
    }
    case "GameOver": {
      const made = e.value >= e.extra;
      const good = me === made;    // 我是莊家且打成，或對方是莊家且倒約
      fx.popup(made ? "打成！" : `倒 ${e.extra - e.value} 墩`, centerAnchor(),
        { size: 70, color: good ? GOLD : BAD, flags: made ? ["pop", "wave"] : ["pop", "shake"], hold: 1500, delay: 650 });
      setTimeout(() => fx.shake($("felt"), good ? 6 : 9, 320), fx.ms(700));
      fx.buzz(good ? [30, 50, 30, 50, 120] : [220]);
      break;
    }
    case "HandScored":
      fx.popup(me ? `+${e.value} 分` : `${oppName()} +${e.value} 分`, side,
        { size: me ? 36 : 26, color: me ? GOLD : MUTED, flags: me ? ["pop", "wave"] : ["pop"], hold: 1000, delay: 1400 });
      break;

    case "Illegal":
      setWaiting(false);
      unpull();
      illegal(e.card);
      break;

    case "Redeal":
      fx.popup("雙方都 Pass · 重發", centerAnchor(), { size: 26, color: MUTED, hold: 900 });
      tension = 0;
      sfx.release();
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
  const pull = fx.motionOn() ? fx.T.pull : 0;
  const flight = me ? fx.T.fly : fx.T.fly + 50;
  const landAt = pull + flight;
  // 1. 抽牌
  fx.pin(el, from);
  const dy = me ? -20 : 10;
  const pulledRect = new DOMRect(from.left, from.top + (fx.motionOn() ? dy : 0), from.width, from.height);
  sfx.land(me ? 1 : 0.8, fx.ms(landAt) / 1000);
  const go = () => fx.fly(el, pulledRect, to, { dur: flight, lift: me ? 16 : 26, flipAt: me ? undefined : () => fx.flipTo(el, e.card) }).then(f => {
    // 3. 落桌
    inFlight.delete(e.card);
    f.remove();
    if (st) renderTrick(e.card);
    const landed = slot.firstElementChild;
    if (landed) {
      fx.land(landed);
      fx.shockAt(landed, { size: 84, width: 1.2, dur: 260, color: "rgba(240,220,170,.55)" });
      burstAt(landed, { count: 3, kinds: ["dust"], speed: 60, life: 0.35, gravity: 30 });
    }
  });
  if (pull) {
    el.animate([{ translate: "0 0", scale: "1" }, { translate: `0 ${dy}px`, scale: me ? "1.06" : "1" }],
      { duration: fx.ms(pull), easing: "cubic-bezier(.2,.9,.3,1)" }).finished.then(go, go);
  } else void go();
  return landAt;
}

// 收墩：勝方的牌放大發光 →（重要事件停一下）→ 兩張一起收向勝方；墩數跳動
async function collectTrick(e: GameEvent, level: Level, label: string) {
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
  const drawing = e.value < 0;
  // 連續贏墩：音高、回彈、桌面光暈遞增；輸一墩就恢復
  streak = winnerMe ? streak + 1 : 0;
  streakGlow(felt, streak);
  trickFeedback(drawing ? 1 : level, winnerMe, winner, felt, streak);
  if (winnerMe && streak >= 3) fx.popup(`連贏 ${streak} 墩`, myAnchor(), { size: 18 + Math.min(4, streak - 3) * 2, color: GOLD, flags: ["pop"], delay: 520 });
  if (!drawing) {
    const good = winnerMe;
    if (level === 3 && label) {
      const text = label === "合約達成" ? (winnerMe ? "合約達成！" : `${oppName()}合約達成`) : (winnerMe ? "合約擊破！" : "合約被擊破");
      fx.popup(text, centerAnchor(), { size: 40, color: good ? GOLD : BAD, flags: good ? ["pop", "wave"] : ["pop"], hold: 1100, delay: 240 });
      setTimeout(() => contractFeedback(good, centerAnchor(), felt), fx.ms(220));
    } else if (level === 2 && label && label !== "王吃") {
      fx.popup(winnerMe ? `${label}！` : label, centerAnchor(), { size: 30, color: winnerMe ? GOLD : MUTED, flags: ["pop"], delay: 200 });
    }
    fx.popup(winnerMe ? "贏得此墩 +1" : `${oppName()} +1 墩`, winnerMe ? myAnchor() : oppAnchor(),
      { size: winnerMe ? 24 : 20, color: winnerMe ? GOOD : MUTED, delay: 300 });
  }
  if (!drawing && level >= 2) await hitstop(level);
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
  $("leaveBtn").textContent = conn?.solo ? "回主選單" : "離開這桌";
  openModal("menu");
}
$("menuBtn").addEventListener("click", openMenu);
function renderMute() { $("muteBtn").textContent = fx.settings.muted ? "🔇" : "🔊"; $("muteBtn").setAttribute("aria-label", fx.settings.muted ? "取消靜音" : "靜音"); }
$("muteBtn").addEventListener("click", () => { fx.settings.muted = !fx.settings.muted; fx.saveSettings(); renderMute(); sfx.toggle(!fx.settings.muted); });
renderMute();
$("leaveBtn").addEventListener("click", () =>
  goHome(conn?.solo ? "這局幫你存好了，按「開始對戰」就能接著打" : "你的座位會保留，在「朋友連線」按「回到這桌」就能回去"));
$("restartSolo").addEventListener("click", () => {
  $("menu").hidden = true;
  if (conn instanceof LocalTable) conn.restart();     // 會發 NewHand：牌桌照新局的流程清空重畫
});
for (const m of ["menu", "auctionPop", "rulesModal", "storyOffer"]) {
  const modal = $(m);
  modal.addEventListener("click", ev => {
    if (ev.target === modal || (ev.target as HTMLElement).closest("[data-close]")) modal.hidden = true;
  });
}

// 按鈕：按下去像厚紙卡（音效＋手機輕震）
document.addEventListener("pointerdown", ev => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>(".btn, .strip, .icon, .back");
  if (b && !(b as HTMLButtonElement).disabled) { sfx.press(); fx.buzz(6); }
}, { passive: true });

// ---------------- 小工具 ----------------

function esc(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

// ---------------- 啟動 ----------------

fx.initFx($("fx"), $("app"));
{
  const params = new URLSearchParams(location.search);
  const room = normalizeCode(params.get("room") ?? "");
  const solo = params.get("solo");
  if (solo === "new" || solo === "1") enterSolo(solo === "new");   // 故事最後的「自己跟電腦打一局」= new：重新發牌
  else if (isValidCode(room)) {
    codeInput.value = room;
    if (savedToken(room)) enter(room);
    else { show("online"); say(`朋友邀請你加入 ${room} 這桌，填好暱稱按「加入」`); }
  }
  refreshResume();
  // 首頁的紙卡依序滑入
  if (screen === "home") {
    fx.slideIn($("titleCard"), "up");
    Array.from(document.querySelectorAll("#home .strip")).forEach((el, i) => fx.slideIn(el, i % 2 ? "left" : "right", 80 + i * 60));
  }
}
