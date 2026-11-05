// 手機端主程式：首頁（開房／加入）→ 等朋友 → 牌桌。
// 跟 Unity 版 GameView 一樣的分工：收「事件」放動畫，收「狀態」把牌桌畫對（事件一定比狀態先到）。
import { Call, bidText, callText, cardText, isBid, isRedBid, isRedCard, rankOf, suitOf, SUIT_SYMBOL, tricksNeeded, bidStrain, Strain } from "../game/cards";
import { GameEvent, Phase, TableState } from "../game/game";
import { breakdown, contractText, declarerPreview, defenderPreview, madePoints, pointsPerUndertrick, PER_OVERTRICK } from "../game/scoring";
import { SeatInfo, ServerMsg, isValidCode, normalizeCode } from "../server/protocol";
import * as fx from "./fx";
import { Connection, LAST_ROOM_KEY, createRoom, forgetRoom, roomInfo, savedToken, store } from "./net";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const GOLD = "#F0C25A", INK = "#E9F1EC", MUTED = "#A9C0B7", BAD = "#FF8A8A", GOOD = "#7FD6A2", RED = "#FF9BA8";

// ---------------- 狀態 ----------------

let conn: Connection | null = null;
let mySeat = -1;
let st: TableState | null = null;
let seats: SeatInfo[] = [];
let started = false;
let selCard = -1, selBid = -1;
let waiting = false, waitTimer = 0;
let resultShownFor = -1, resultTimer = 0;
let dealing = false;
let lastFaceUp = -1;
let lastTurnText = "";
let bidRevealTimer = 0;    // 抽牌最後一墩的動畫演完才跳出叫牌面板
const inFlight = new Set<number>();
const freshCards = new Set<number>();

const oppName = () => seats[1 - mySeat]?.name || (mySeat === 0 ? "朋友" : "房主");
const nameOf = (s: number) => s === mySeat ? "你" : oppName();
const myTurn = () => !!st && st.currentSeat === st.seat && !(st.leadCard >= 0 && st.followCard >= 0) && st.phase !== Phase.Finished;
const myBidTurn = () => !!st && st.phase === Phase.Bidding && myTurn();

function show(id: "home" | "wait" | "table") {
  for (const s of ["home", "wait", "table"]) $(s).hidden = s !== id;
}

function setWaiting(on: boolean) {
  waiting = on;
  clearTimeout(waitTimer);
  if (on) waitTimer = window.setTimeout(() => { waiting = false; }, 3000);   // 保險：3 秒沒回應就解鎖
}

// ---------------- 首頁 ----------------

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const homeMsg = $("homeMsg");
nameInput.value = store.get("hb-name") ?? "";
nameInput.addEventListener("change", () => store.set("hb-name", nameInput.value.trim()));
codeInput.addEventListener("input", () => { codeInput.value = normalizeCode(codeInput.value).replace(/[^A-Z0-9]/g, "").slice(0, 4); });
codeInput.addEventListener("keydown", e => { if (e.key === "Enter") $("join").click(); });

function say(msg: string, err = false) { homeMsg.textContent = msg; homeMsg.classList.toggle("err", err); }
const myName = () => { const n = nameInput.value.trim(); if (n) store.set("hb-name", n); return n; };

$("create").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("create");
  b.disabled = true; say("開房中…");
  try { enter(await createRoom()); }
  catch (e) { say((e as Error).message, true); }
  finally { b.disabled = false; }
});

$("join").addEventListener("click", async () => {
  const code = normalizeCode(codeInput.value);
  if (!isValidCode(code)) { say("房號是 4 個英文字母或數字", true); return; }
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
}
$("resume").addEventListener("click", () => { const last = store.get(LAST_ROOM_KEY); if (last) enter(last); });

function goHome(msg = "", err = false) {
  conn?.close(); conn = null;
  clearTimeout(resultTimer);
  for (const id of ["result", "menu", "auctionPop", "banner"]) $(id).hidden = true;
  history.replaceState(null, "", "/");
  show("home"); say(msg, err); refreshResume();
}

// ---------------- 連線 ----------------

function enter(code: string) {
  conn?.close();
  mySeat = -1; st = null; seats = []; started = false; selCard = selBid = -1; resultShownFor = -1; lastFaceUp = -1;
  inFlight.clear(); freshCards.clear();
  say("連線中…");
  history.replaceState(null, "", `/?room=${code}`);
  conn = new Connection(code, myName());
  conn.onMessage = onMsg;
  conn.onStatus = s => {
    if (s === "reconnecting") banner("連線中斷，重新連線中…");
    else if (s === "open") renderPresence();
  };
  conn.open();
}

function onMsg(m: ServerMsg) {
  switch (m.t) {
    case "welcome":
      mySeat = m.seat;
      $("roomChip").textContent = `房號 ${m.code}`;
      break;
    case "lobby":
      seats = m.seats; started = m.started;
      if (!started) showWait();
      renderNames(); renderPresence();
      break;
    case "event":
      if (st) onEvent(m.e);
      break;
    case "state":
      onState(m.s);
      break;
    case "full":
      forgetRoom(conn?.code ?? "");
      goHome("這桌已經坐滿了", true);
      break;
    case "gone":
      forgetRoom(conn?.code ?? "");
      goHome("找不到這個房號，可能打錯了，或房間已經過期", true);
      break;
    case "error":
      banner(m.msg, 2500);
      break;
  }
}

// ---------------- 等朋友 ----------------

function showWait() {
  if (!conn) return;
  show("wait");
  const big = $("bigCode");
  if (big.dataset.code !== conn.code) {
    big.dataset.code = conn.code;
    big.replaceChildren(...[...conn.code].map((ch, i) => { const s = document.createElement("span"); s.textContent = ch; fx.popIn(s, i * 70); return s; }));
  }
}
const inviteUrl = () => `${location.origin}/?room=${conn?.code ?? ""}`;
$("share").addEventListener("click", async () => {
  const url = inviteUrl();
  const text = `來跟我打蜜月橋牌！房號 ${conn?.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "蜜月橋牌", text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); flashLabel($("share"), "已複製邀請！"); }
  } catch { /* 使用者取消分享 */ }
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(inviteUrl()); flashLabel($("copy"), "已複製！"); }
  catch { flashLabel($("copy"), conn?.code ?? ""); }
});
$("cancelWait").addEventListener("click", () => { if (conn) forgetRoom(conn.code); goHome(); });

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
  if ($("table").hidden) show("table");
  if (first) say("");
  render(first);
}

function render(first = false) {
  if (!st) return;
  $("table").classList.toggle("bidding", st.phase === Phase.Bidding);
  renderTop();
  renderOpp(first);
  renderStatus();
  renderCenter(first);
  renderBid(first);
  renderHand(first);
  renderTurn();
  renderResult(first);
}

function renderNames() {
  $("oppName").textContent = oppName();
  $("oppNameTop").textContent = oppName();
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
  const txt = contractText(b, s.doubled);
  return isRedBid(b) ? `<span class="red">${txt}</span>` : txt;
}

function renderStatus() {
  const s = st!;
  const el = $("statusText");
  if (s.phase === Phase.Draw) el.innerHTML = `抽牌階段 · 牌堆剩 <b>${s.stockCount}</b> 張`;
  else if (s.phase === Phase.Bidding) el.textContent = "叫牌階段";
  else if (s.declarer >= 0) {
    const need = tricksNeeded(s.highestBid);
    el.innerHTML = `${s.declarer === s.seat ? "你" : esc(oppName())}要 <b>${need}</b> 墩 · 你 <b>${s.myTricks}</b> · ${esc(oppName())} <b>${s.oppTricks}</b>`;
  } else el.textContent = "";
  $("auctionBtn").hidden = !((s.phase === Phase.Play || s.phase === Phase.Finished) && s.auctionCalls.length > 0);
}

function renderCenter(first: boolean) {
  const s = st!;
  // 牌堆＋明牌（抽牌階段）
  const stock = $("stock");
  if (s.phase === Phase.Draw && s.faceUp >= 0) {
    if (stock.dataset.up !== String(s.faceUp)) {
      stock.dataset.up = String(s.faceUp);
      stock.replaceChildren();
      const pile = document.createElement("div");
      pile.className = "pile";
      pile.id = "pile";
      for (let i = 0; i < Math.min(3, Math.ceil(s.stockCount / 8)); i++) pile.appendChild(fx.backEl());
      const up = document.createElement("div");
      up.className = "faceup";
      up.id = "faceUp";
      const c = fx.cardEl(s.faceUp);
      up.appendChild(c);
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = "明牌";
      stock.append(pile, up, lbl);
      if (!first && lastFaceUp !== s.faceUp) fx.flipIn(c);
    }
    stock.hidden = false;
  } else { stock.hidden = true; stock.dataset.up = ""; }
  lastFaceUp = s.faceUp;

  // 合約小牌
  const chip = $("contractChip");
  if ((s.phase === Phase.Play || s.phase === Phase.Finished) && s.highestBid >= 0) {
    chip.hidden = false;
    chip.innerHTML = `${contractHtml(s)}<small>${s.declarer === s.seat ? "你" : esc(oppName())}是莊家</small>`;
  } else chip.hidden = true;

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
  if (landed === id) fx.punch(c, 0.12, 240);
}

// ---------------- 手牌 ----------------

const handBox = $("hand");

function handEl(id: number) { return handBox.querySelector<HTMLElement>(`.card[data-id="${id}"]`); }

function renderHand(first = false) {
  const s = st!;
  const ids = s.hand;
  const keep = new Set(ids);
  for (const el of Array.from(handBox.children) as HTMLElement[]) if (!keep.has(Number(el.dataset.id))) el.remove();

  const W = handBox.clientWidth;
  const cw = parseFloat(getComputedStyle(handBox).getPropertyValue("--cw")) || 60;
  const n = ids.length;
  const step = n > 1 ? Math.min(cw * 0.74, (W - cw - 8) / (n - 1)) : 0;
  const x0 = (W - (cw + step * Math.max(0, n - 1))) / 2;
  const legal = new Set(s.legal);
  const canPlay = legal.size > 0;
  if (!canPlay || !legal.has(selCard)) selCard = -1;

  ids.forEach((id, i) => {
    let el = handEl(id);
    const isNew = !el;
    if (!el) {
      el = fx.cardEl(id);
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      handBox.appendChild(el);
    }
    el.style.setProperty("--x", `${x0 + i * step}px`);
    el.style.zIndex = String(i + 1);
    el.classList.toggle("legal", canPlay && legal.has(id) && selCard !== id);
    el.classList.toggle("sel", selCard === id);
    el.classList.toggle("dim", canPlay && !legal.has(id));
    if (isNew && !first) {
      if (dealing) fx.popIn(el, i * 45);
      else if (freshCards.has(id)) {
        el.classList.add("fresh");
        fx.popIn(el, 650);
        const e2 = el;
        setTimeout(() => e2.classList.remove("fresh"), fx.ms(1700));
      } else fx.popIn(el);
    }
    el.setAttribute("aria-label", cardText(id) + (canPlay && !legal.has(id) ? "（現在不能出）" : ""));
  });
  // 依照順序排 DOM（鍵盤 Tab 也照順序）
  ids.forEach(id => { const el = handEl(id); if (el) handBox.appendChild(el); });
  freshCards.clear();
  dealing = false;
}

function onCardTap(id: number, el: HTMLElement) {
  if (!st || waiting || !conn) return;
  if (st.phase !== Phase.Draw && st.phase !== Phase.Play) return;
  if (!myTurn()) { fx.deny(el); return; }
  if (!st.legal.includes(id)) {
    fx.deny(el);
    fx.buzz(50);
    fx.popup(`要先跟 ${SUIT_SYMBOL[suitOf(st.leadCard)]}！`, $("turnLine"), { size: 24, color: BAD, flags: ["pop", "shake"], hold: 500 });
    return;
  }
  if (selCard === id) {       // 第二次點同一張 = 出牌
    selCard = -1;
    setWaiting(true);
    conn.send({ t: "play", card: id });
    return;
  }
  selCard = id;
  fx.buzz(8);
  renderHand();
  renderTurn();
}

handBox.addEventListener("click", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el) onCardTap(Number(el.dataset.id), el);
});
handBox.addEventListener("keydown", ev => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".card");
  if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onCardTap(Number(el.dataset.id), el); }
});
window.addEventListener("resize", () => { if (st) renderHand(); });

// ---------------- 輪到誰 ----------------

function renderTurn() {
  const s = st!;
  const line = $("turnLine");
  let text = "", hint = "", mine = false;
  if (s.phase === Phase.Finished) text = "";
  else if (myTurn()) {
    mine = true;
    if (s.phase === Phase.Bidding) text = "輪到你叫牌";
    else {
      text = s.leaderSeat === s.seat ? "輪到你出牌" : "輪到你跟牌";
      hint = selCard >= 0 ? `再點一次 ${cardText(selCard)} 出牌` : "點一張牌";
    }
  } else if (!(s.leadCard >= 0 && s.followCard >= 0)) {
    text = `等${oppName()}${s.phase === Phase.Bidding ? "叫牌" : "出牌"}…`;
  }
  const key = text + "|" + hint + "|" + mine;
  if (key === lastTurnText) return;
  const was = lastTurnText.split("|")[0];
  lastTurnText = key;
  line.className = "turn" + (mine ? "" : " wait");
  line.replaceChildren();
  if (mine) {
    [...text].forEach((ch, i) => { const sp = document.createElement("span"); sp.className = "ch"; sp.style.setProperty("--i", String(i)); sp.textContent = ch; line.appendChild(sp); });
    if (hint) { const h = document.createElement("span"); h.className = "hint"; h.textContent = hint; line.appendChild(h); }
    if (was !== text) { fx.popIn(line); fx.buzz(12); }
  } else line.textContent = text;
}

// ---------------- 叫牌面板 ----------------

const grid = $("bidGrid");
const bidButtons: HTMLButtonElement[] = [];
for (let i = 0; i < 35; i++) {
  const b = document.createElement("button");
  b.textContent = bidText(i);
  if (isRedBid(i)) b.classList.add("red");
  b.addEventListener("click", () => selectBid(i));
  grid.appendChild(b);
  bidButtons.push(b);
}
$("bidConfirm").addEventListener("click", () => { if (selBid >= 0) sendCall(selBid); });
$("bidPass").addEventListener("click", () => sendCall(Call.Pass));
$("bidDouble").addEventListener("click", () => { if (st) sendCall(st.canRedouble ? Call.Redouble : Call.Double); });

function selectBid(i: number) {
  if (!myBidTurn() || waiting || i < st!.minBid) return;
  if (selBid === i) { sendCall(i); return; }   // 同一格點兩次 = 確定
  selBid = i;
  fx.buzz(8);
  renderBid();
  fx.punch(bidButtons[i], 0.15, 200);
}

function sendCall(call: number) {
  if (!myBidTurn() || waiting || !conn) return;
  selBid = -1;
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
  if (!bidding) { clearTimeout(bidRevealTimer); bidRevealTimer = 0; panel.hidden = true; selBid = -1; return; }
  if (panel.hidden) {
    if (!first && !bidRevealTimer) {
      bidRevealTimer = window.setTimeout(() => {
        panel.hidden = false;
        fx.popIn(panel);
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
    if (mine) { fx.punch(panel, 0.03, 260); fx.buzz(12); }
  }
  if (!mine || selBid < s.minBid) selBid = -1;

  bidButtons.forEach((b, i) => {
    b.disabled = !mine || i < s.minBid;
    b.classList.toggle("sel", i === selBid);
  });
  const head = $("bidContract");
  head.classList.toggle("wait", !mine && s.highestBid < 0);
  head.innerHTML = s.highestBid >= 0
    ? `目前 ${esc(nameOf(s.highestBidder))} ${contractHtml(s)}`
    : mine ? "輪到你叫牌" : `等${esc(oppName())}叫牌…`;

  const strip = $("auctionStrip");
  strip.innerHTML = s.auctionCalls.length
    ? s.auctionCalls.map((c, i) => `<span class="${s.auctionSeats[i] === s.seat ? "me" : ""}">${esc(nameOf(s.auctionSeats[i]))} ${callHtml(c)}</span>`).join("")
    : `<span>叫牌紀錄會出現在這裡</span>`;
  strip.scrollLeft = strip.scrollWidth;

  const confirm = $<HTMLButtonElement>("bidConfirm");
  confirm.disabled = !mine || selBid < 0;
  confirm.textContent = selBid >= 0 ? `叫 ${bidText(selBid)}` : "叫";
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
    return `叫 ${bidText(selBid)}：${declarerPreview(selBid, 0)}<br><small>超墩每墩 +${PER_OVERTRICK} 分｜再點一次或按「叫 ${bidText(selBid)}」送出</small>`;
  if (cur < 0) return "點一個叫品，這裡會算給你看這局押多少分<br><small>叫 N 線 = 要拿 N + 6 墩</small>";
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
  $("auctionPop").hidden = false;
});

// ---------------- 結算 ----------------

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
  resultTimer = window.setTimeout(showResult, first ? 200 : fx.ms(2600));   // 先讓「打成！」大字演完
}

function showResult() {
  const s = st;
  if (!s || !s.result || s.phase !== Phase.Finished) return;
  const r = s.result;
  const matchOver = s.matchWinner >= 0;
  const iWon = s.matchWinner === s.seat;
  const title = $("resTitle");
  title.textContent = matchOver ? (iWon ? "你贏得整場！" : `${oppName()}贏得整場`) : `第 ${r.handNumber} 局結算`;
  title.className = matchOver && iWon ? "win" : "";

  const lines = breakdown(r, s.seat, oppName());
  const body = $("resBody");
  body.replaceChildren(...lines.map((t, i) => {
    const d = document.createElement("div");
    d.textContent = t;
    d.style.setProperty("--i", String(i));
    if (i === lines.length - 1) d.className = "pts" + (r.scorer === s.seat ? "" : " opp");
    return d;
  }));
  $("resTotal").innerHTML = `總分　你 <b>${s.myScore}</b> · ${esc(oppName())} <b>${s.oppScore}</b>　<small>（先到 ${s.targetScore} 分）</small>` +
    (matchOver ? `<br>共打了 ${r.handNumber} 局` :
      `<br>你還差 ${Math.max(0, s.targetScore - s.myScore)} 分 · ${esc(oppName())}還差 ${Math.max(0, s.targetScore - s.oppScore)} 分`);
  const next = $<HTMLButtonElement>("nextBtn");
  next.disabled = false;
  next.textContent = matchOver ? "再來一場" : "下一局";
  $("result").hidden = false;
  if (matchOver && iWon) { fx.confetti(90); fx.popup("冠軍！", title, { size: 44, color: GOLD, flags: ["pop", "wave"], hold: 1200 }); }
}

$("nextBtn").addEventListener("click", () => {
  const b = $<HTMLButtonElement>("nextBtn");
  b.disabled = true;
  b.textContent = "發牌中…";
  conn?.send({ t: "next" });
});

// ---------------- 事件 → 動畫與回饋 ----------------

const myAnchor = () => $("myAnchor");
const oppAnchor = () => $("oppAnchor");
const centerAnchor = () => $("centerAnchor");

function tick(html: string) {
  const t = $("ticker");
  t.innerHTML = html;
  t.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: fx.ms(220) });
}
const cardHtml = (id: number) => isRedCard(id) ? `<span class="red">${cardText(id)}</span>` : cardText(id);

function onEvent(e: GameEvent) {
  const me = e.seat === mySeat;
  const side = me ? myAnchor() : oppAnchor();
  const who = esc(nameOf(e.seat));
  switch (e.type) {
    case "NewHand":
      newHandReset();
      dealing = true;
      fx.popup(e.value > 0 ? `第 ${e.value} 局 · 發牌！` : "發牌！", centerAnchor(), { size: 30, color: INK, flags: ["pop"], hold: 600 });
      tick(`第 ${e.value} 局開始，${me ? "你" : esc(oppName())}先出`);
      break;

    case "CardPlayed":
      flyPlayed(e);
      if (e.extra === 1) {
        // 王吃：整場最爽的瞬間
        fx.popup("王吃！", side, { size: 64, color: GOLD, flags: ["pop", "shake"], hold: 800, delay: 220 });
        setTimeout(() => fx.shakeScreen(16, 320), fx.ms(260));
        fx.buzz([30, 40, 70]);
        tick(`${who}用王牌 ${cardHtml(e.card)} 吃！`);
      } else tick(`${who}出了 ${cardHtml(e.card)}`);
      break;

    case "TrickWon":
      collectTrick(e);
      if (e.value >= 0) {
        fx.popup(me ? "+1 墩" : `${oppName()} +1`, side, { size: 26, color: me ? GOOD : MUTED, delay: 300 });
        if (st && st.declarer === e.seat && st.highestBid >= 0 && e.value === tricksNeeded(st.highestBid))
          fx.popup(me ? "合約達成！" : `${oppName()}的合約達成了`, centerAnchor(), { size: 40, color: me ? GOLD : BAD, flags: ["pop", "wave"], hold: 1100, delay: 600 });
      }
      break;

    case "FaceUpTaken":
      takeFaceUp(e);
      if (rankOf(e.card) >= 11)
        fx.popup(me ? `搶到 ${cardText(e.card)}！` : `${cardText(e.card)} 被搶走`, side,
          { size: 30, color: me ? GOLD : BAD, flags: me ? ["pop", "wave"] : ["pop"], delay: 420 });
      tick(`${who}拿走明牌 ${cardHtml(e.card)}`);
      break;

    case "CardDrawn":
      drawHidden(me);
      if (me && e.card >= 0) { freshCards.add(e.card); const c = e.card; setTimeout(() => tick(`你摸到 ${cardHtml(c)}`), fx.ms(700)); }
      break;

    case "DrawPhaseOver":
      fx.popup("牌堆抽完 · 開始叫牌", centerAnchor(), { size: 28, color: INK, flags: ["pop", "wave"], hold: 1000, delay: 900 });
      fx.buzz(20);
      break;

    case "BidMade": {
      const raise = !!st && st.highestBid >= 0;
      fx.popup(raise ? `加碼 ${bidText(e.value)}` : bidText(e.value), side,
        { size: 40, color: isRedBid(e.value) ? RED : INK, flags: raise ? ["pop", "shake"] : ["pop"] });
      fx.buzz(15);
      break;
    }
    case "Passed":
      fx.popup("Pass", side, { size: 28, color: MUTED });
      break;

    case "Doubled":
      fx.popup("加倍！", side, { size: 54, color: me ? GOLD : BAD, flags: ["pop", "shake"], hold: 900 });
      fx.shakeScreen(10, 260);
      fx.buzz([40, 30, 40]);
      break;

    case "Redoubled":
      fx.popup("再加倍！！", side, { size: 60, color: me ? GOLD : BAD, flags: ["pop", "shake"], hold: 1000 });
      fx.shakeScreen(16, 320);
      fx.buzz([50, 30, 50, 30, 90]);
      break;

    case "ContractSet": {
      const d = Math.max(0, e.extra);
      fx.popup(`合約 ${contractText(e.value, d)}`, centerAnchor(),
        { size: 42, color: GOLD, flags: d > 0 ? ["pop", "wave", "shake"] : ["pop", "wave"], hold: 1300 });
      const trump = bidStrain(e.value);
      tick(`${who}是莊家，要拿 ${tricksNeeded(e.value)} 墩${trump === Strain.NoTrump ? "（無王）" : `，${SUIT_SYMBOL[trump]} 是王牌`}`);
      break;
    }
    case "GameOver": {
      const made = e.value >= e.extra;
      const good = me === made;    // 我是莊家且打成，或對方是莊家且倒約
      fx.popup(made ? "打成！" : `倒 ${e.extra - e.value} 墩`, centerAnchor(),
        { size: 76, color: good ? GOLD : BAD, flags: made ? ["pop", "wave"] : ["pop", "shake"], hold: 1500, delay: 600 });
      setTimeout(() => fx.shakeScreen(good ? 10 : 18, 360), fx.ms(700));
      fx.buzz(good ? [30, 50, 30, 50, 120] : [220]);
      break;
    }
    case "HandScored":
      fx.popup(me ? `+${e.value} 分` : `${oppName()} +${e.value} 分`, side,
        { size: me ? 40 : 28, color: me ? GOLD : MUTED, flags: me ? ["pop", "wave"] : ["pop"], hold: 1000, delay: 1300 });
      break;

    case "Illegal": {
      const el = handEl(e.card);
      if (el) fx.deny(el);
      fx.popup("要先跟同花色！", myAnchor(), { size: 24, color: BAD, flags: ["pop", "shake"] });
      setWaiting(false);
      break;
    }
    case "Redeal":
      fx.popup("雙方都 Pass · 重發", centerAnchor(), { size: 28, color: MUTED, hold: 900 });
      break;
  }
}

function newHandReset() {
  $("mySlot").replaceChildren();
  $("oppSlot").replaceChildren();
  $("result").hidden = true;
  clearTimeout(resultTimer);
  resultShownFor = -1;
  selCard = selBid = -1;
  inFlight.clear();
  handBox.replaceChildren();
  $("oppFan").replaceChildren();
  $("stock").dataset.up = "";
  lastFaceUp = -1;
}

// 出牌：我的牌從手上飛出去；對手的牌從他手上飛出來、途中翻面
function flyPlayed(e: GameEvent) {
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
  fx.fly(el, from, to, { dur: 300, flipAt: me ? undefined : () => fx.flipTo(el, e.card) }).then(f => {
    inFlight.delete(e.card);
    f.remove();
    if (st) renderTrick(e.card);
  });
}

// 收墩：贏的那張發金光、啵一下，然後兩張一起飛向贏家
function collectTrick(e: GameEvent) {
  const winnerMe = e.seat === mySeat;
  const dest = (winnerMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  const target = fx.rectAt(c.x, winnerMe ? dest.top + 20 : c.y, 30, 42);
  for (const slot of [$("mySlot"), $("oppSlot")]) {
    const card = slot.firstElementChild as HTMLElement | null;
    if (!card) continue;
    const r = card.getBoundingClientRect();
    const clone = card.cloneNode(true) as HTMLElement;
    fx.pin(clone, r);
    slot.replaceChildren();
    const isWinner = Number(card.dataset.id) === e.card;
    if (isWinner) { fx.glow(clone); fx.punch(clone, 0.2, 320); }
    setTimeout(() => {
      fx.fly(clone, r, target, { dur: 360, fade: true, easing: "cubic-bezier(.5,0,.8,.4)" }).then(f => f.remove());
    }, fx.ms(isWinner ? 420 : 380));
  }
}

// 抽牌階段：明牌發光飛向贏家
function takeFaceUp(e: GameEvent) {
  const up = document.querySelector<HTMLElement>("#faceUp .card");
  if (!up) return;
  const r = up.getBoundingClientRect();
  const clone = up.cloneNode(true) as HTMLElement;
  fx.pin(clone, r);
  up.style.visibility = "hidden";
  fx.glow(clone, 600);
  const winnerMe = e.seat === mySeat;
  const dest = (winnerMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  setTimeout(() => {
    fx.fly(clone, r, fx.rectAt(c.x, winnerMe ? dest.top + 30 : c.y, 40, 57), { dur: 420, fade: true }).then(f => f.remove());
  }, fx.ms(300));
}

// 輸墩的人摸一張暗牌：牌背從牌堆飛到他手上
function drawHidden(toMe: boolean) {
  const pile = document.getElementById("pile");
  if (!pile) return;
  const r = (pile.lastElementChild ?? pile).getBoundingClientRect();
  const dest = (toMe ? handBox : $("oppFan")).getBoundingClientRect();
  const c = fx.center(dest);
  const back = fx.backEl();
  setTimeout(() => {
    fx.fly(back, r, fx.rectAt(c.x, toMe ? dest.top + 40 : c.y, 34, 48), { dur: 380, fade: true }).then(f => f.remove());
  }, fx.ms(450));
}

// ---------------- 選單 ----------------

function renderMenu() {
  const seg = $("speedSeg");
  seg.replaceChildren(...fx.SPEED_LABELS.map((l, i) => {
    const b = document.createElement("button");
    b.textContent = l;
    b.setAttribute("aria-pressed", String(fx.settings.speed === i));
    b.addEventListener("click", () => { fx.settings.speed = i as 0 | 1 | 2; fx.saveSettings(); renderMenu(); });
    return b;
  }));
  $("shakeToggle").setAttribute("aria-pressed", String(fx.settings.shake));
  $("shakeToggle").setAttribute("aria-label", `畫面震動：${fx.settings.shake ? "開" : "關"}`);
  $("buzzToggle").setAttribute("aria-pressed", String(fx.settings.vibrate));
  $("buzzToggle").setAttribute("aria-label", `手機震動：${fx.settings.vibrate ? "開" : "關"}`);
}
$("menuBtn").addEventListener("click", () => { renderMenu(); $("menu").hidden = false; });
$("shakeToggle").addEventListener("click", () => {
  fx.settings.shake = !fx.settings.shake; fx.saveSettings(); renderMenu();
  if (fx.settings.shake) fx.shakeScreen(8, 220);
});
$("buzzToggle").addEventListener("click", () => {
  fx.settings.vibrate = !fx.settings.vibrate; fx.saveSettings(); renderMenu();
  fx.buzz(40);
});
$("leaveBtn").addEventListener("click", () => goHome("你的座位會保留，按「回到這桌」就能回去"));
for (const m of ["menu", "auctionPop"]) {
  const modal = $(m);
  modal.addEventListener("click", ev => {
    if (ev.target === modal || (ev.target as HTMLElement).closest("[data-close]")) modal.hidden = true;
  });
}

// ---------------- 小工具 ----------------

function esc(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

// ---------------- 啟動 ----------------

fx.initFx($("fx"), $("app"));
{
  const room = normalizeCode(new URLSearchParams(location.search).get("room") ?? "");
  if (isValidCode(room)) {
    codeInput.value = room;
    if (savedToken(room)) enter(room);
    else say(`朋友邀請你加入 ${room} 這桌，填好暱稱按「加入」`);
  }
  refreshResume();
}
