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
import { CODE_LENGTH, DEFAULT_STAKE, Highlight, MODES, Mode, NAME_MAX, Notice, RoomView, STAKE_MAX, SeatInfo, ServerMsg, checkName, checkStake, isValidCode, nameLength, normalizeCode, normalizeName } from "../server/protocol";
import * as fx from "./fx";
import { Connection, LAST_ROOM_KEY, createRoom, forgetRoom, roomInfo, savedToken, store } from "./net";
import { lsEvent, lsHas, lsHoldUntil, lsInit, lsReset, lsView, lsResult } from "./lstable";
import { Command, Link, LocalTable, Reply, hasUnfinishedSolo } from "./solo";
import { sfx } from "./sound";
import {
  bidChip, bidTier, contractFeedback, contractSlam, doubleFx, flipNumber, redoubleFx, rollNumber, stamp, streakGlow, victory,
} from "./feedback";
import { ImpactGate, evaluateTrick, playWeight, trickKey, type Impact } from "./impact";
import { PLAY_T, contact, flightMs, presentImpact, pullUp, slamFly } from "./impactfx";
import { attachAura, auraConverge, auraUpgrade, resetAura, updateAura } from "./aura";
import { watchPerf } from "./perf";
import { burstAt } from "./particles";
import { BUILD, COACH_KEY, renderSettings } from "./settings-ui";
import { LEAD_ADVICE, SUIT_NAME, followAdvice, illegalReason, trumpWord, whyTrick } from "../game/explain";
import { emo, risk as riskOf } from "./tension";
import { AheBrain, EMOTES, type Facts, type Said } from "./ahe";
import { emoteAllowed, EMOTE_GAP_MS } from "../server/protocol";
import { emote, textIn } from "./ahefx";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const GOLD = "#F3D488", INK = "#FBF4E4", MUTED = "#D8C7A4", BAD = "#F2A0A0", GOOD = "#B5E3BE", RED = "#F5AAB3";

// ---------------- 狀態 ----------------

let conn: Link | null = null;
let mySeat = -1;
let st: TableState | null = null;
let seats: SeatInfo[] = [];
let started = false;
let room: RoomView | null = null;   // 朋友連線：伺服器給的房間狀態（單機是 null）
let lastEid = 0;                    // 收過的最後一個事件序號（重複的不再演一次）
let selCard = -1, selBid = -1, selLevel = 0, selStrain = -1;
let waiting = false, waitTimer = 0;
let resultShownFor = -1, resultTimer = 0;
let dealing = false;
let lastFaceUp = -1;
let lastTurnText = "";
let roomCode = "";
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

// 朋友連線：房主／訪客（同名時用來分辨）
const roleOf = (s: number) => room && s === room.host ? "房主" : "訪客";
const sameNames = () => !!room && !!seats[0]?.name && seats[0].name.toLowerCase() === seats[1]?.name?.toLowerCase();
// 對手的暱稱：兩人同名時後面加（房主）／（訪客）分辨
const oppName = () => {
  const n = seats[1 - mySeat]?.name || (room ? roleOf(1 - mySeat) : mySeat === 0 ? "朋友" : "房主");
  return sameNames() ? `${n}（${roleOf(1 - mySeat)}）` : n;
};
const nameOf = (s: number) => s === mySeat ? "你" : oppName();
const myTurn = () => !!st && st.currentSeat === st.seat && !(st.leadCard >= 0 && st.followCard >= 0) && st.phase !== Phase.Finished;
const myBidTurn = () => !!st && st.phase === Phase.Bidding && myTurn();
const paused = () => room?.status === "PAUSED";      // 朋友連線：有人斷線，牌局暫停（伺服器也會擋）
const canPlayNow = () => !!st && (st.phase === Phase.Draw || st.phase === Phase.Play) && myTurn() && st.legal.length > 0 && !waiting && !paused();

// 畫面切換：紙張滑入；牌桌從中心展開。重複進同一個畫面不重播
type ScreenId = "home" | "online" | "wait" | "table" | "lstable";
const isTable = () => screen === "table" || screen === "lstable";      // 經典牌桌或逆命賭局牌桌
function show(id: ScreenId) {
  for (const s of ["home", "online", "wait", "table", "lstable"]) $(s).hidden = s !== id;
  watchPerf(id === "table");
  if (id !== "table") { resetAura(); closePops(); }
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
  // 保險：太久沒回應就解鎖（朋友連線順便要一次最新狀態；指令本身斷線重連後會用同一個編號重送，不會重複生效）
  if (on) waitTimer = window.setTimeout(() => { waiting = false; unpull(); if (conn && !conn.solo) conn.send({ t: "sync" }); }, conn?.solo ? 3000 : 6000);
}

// ---------------- 01 首頁 ----------------

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const homeMsg = $("homeMsg");
nameInput.value = store.get("hb-name") ?? "";          // 上次用的暱稱（可以改）
codeInput.addEventListener("input", () => { codeInput.value = normalizeCode(codeInput.value).replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH); });
codeInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) $("join").click(); });

function say(msg: string, err = false) { homeMsg.textContent = msg; homeMsg.classList.toggle("err", err); }
const myName = () => normalizeName(nameInput.value);

// ---------------- 暱稱：字數、空白、太長、不允許的符號（伺服器還會再檢查一次） ----------------
// 輸入時即時顯示「幾個字 / 16」，超過就變紅並提示；按「開一桌／加入牌桌」時才擋下空白
function nameField(input: HTMLInputElement, count: HTMLElement, err: HTMLElement) {
  const update = () => {
    const n = nameLength(normalizeName(input.value));
    count.textContent = `${n}/${NAME_MAX}`;
    const over = n > NAME_MAX;
    count.classList.toggle("over", over);
    fieldErr(input, err, over ? `暱稱最多 ${NAME_MAX} 個字，請縮短一點。` : "");   // 正在改：不合格的提示跟著更新
  };
  input.addEventListener("input", update);
  update();
  return update;
}
function fieldErr(input: HTMLInputElement, err: HTMLElement, msg: string) {
  err.textContent = msg;
  err.hidden = !msg;
  input.classList.toggle("bad", !!msg);
  input.setAttribute("aria-invalid", String(!!msg));
}
// 讀出合格的暱稱；不合格就在欄位下面說原因、回傳 null
function readName(input: HTMLInputElement, err: HTMLElement): string | null {
  const v = checkName(input.value);
  if (!v.ok) { fieldErr(input, err, v.msg); fx.deny(input); sfx.deny(); input.focus(); return null; }
  input.value = v.name;
  fieldErr(input, err, "");
  return v.name;
}
const refreshNameCount = nameField(nameInput, $("nameCount"), $("nameErr"));
// 注音／拼音選字時按 Enter 是「選這個字」，不是送出（isComposing／229）
const composing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;
nameInput.addEventListener("keydown", e => { if (e.key === "Enter" && !composing(e)) { e.preventDefault(); (inviteMode ? $("join") : $("create")).click(); } });
const homeName = () => { const n = readName(nameInput, $("nameErr")); if (n) store.set("hb-name", n); return n; };

// ---------------- 從邀請連結進來：房號帶好、看得到是誰開的桌，只要填自己的暱稱 ----------------
let inviteMode = false;
function setInvite(on: boolean) {
  inviteMode = on;
  $("inviteCard").hidden = !on;
  $("inviteExit").hidden = !on;
  $("create").hidden = on;
  $("orLine").hidden = on;
  codeInput.readOnly = on;
  $("join").classList.toggle("wine", on);
  $("join").classList.toggle("paper", !on);
  if (on) $("resume").hidden = true;
}
async function showInvite(code: string) {
  show("online");
  setInvite(true);
  codeInput.value = code;
  say("");
  $("inviteText").textContent = `房號 ${code}，查這桌中…`;
  try {
    const info = await roomInfo(code);
    if (!inviteMode || codeInput.value !== code) return;
    if (!info.exists) { setInvite(false); say("找不到這桌（房號打錯，或這桌已經收掉了）。", true); return; }
    if (info.status === "CLOSED") { setInvite(false); say("這桌已經關了，請朋友再開一桌。", true); return; }
    if (info.started) { setInvite(false); say("這桌已經開打了，請朋友再開一桌。", true); return; }
    const free = (info.seats ?? []).filter(x => !x).length;
    if (!free) { setInvite(false); say("這桌已經坐滿啦。", true); return; }
    const mode = MODES[(info.mode ?? "classic") as Mode]?.label ?? MODES.classic.label;
    $("inviteText").textContent = info.host ? `「${info.host}」開的桌 · ${mode} · 房號 ${code}` : `房號 ${code} · ${mode}`;
    say(nameInput.value ? "暱稱沒問題就按「加入牌桌」。" : "填好你的暱稱，按「加入牌桌」。");
  } catch (e) { say((e as Error).message, true); }
}
$("inviteExit").addEventListener("click", () => { setInvite(false); codeInput.value = ""; say(""); history.replaceState(null, "", "/"); refreshResume(); });

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
  const name = homeName();
  if (!name) return;
  const b = $<HTMLButtonElement>("create");
  b.disabled = true; say("開桌中…");
  try { enter(await createRoom(), name); }
  catch (e) { say((e as Error).message, true); }
  finally { b.disabled = false; }
});

$("join").addEventListener("click", async () => {
  const name = homeName();
  if (!name) return;
  const code = normalizeCode(codeInput.value);
  if (!isValidCode(code)) { say(`房號是 ${CODE_LENGTH} 個英文字母或數字喔。`, true); fx.deny(codeInput); sfx.deny(); return; }
  say("找這桌中…");
  try {
    const info = await roomInfo(code);
    if (!info.exists) { say("找不到這桌，再確認一下房號。", true); return; }
    if (!savedToken(code) && info.started) { say("這桌已經開打了，請朋友再開一桌。", true); return; }
    if (!savedToken(code) && info.seats?.every(Boolean)) { say("這桌已經坐滿啦。", true); return; }
    enter(code, name);
  } catch (e) { say((e as Error).message, true); }
});

function refreshResume() {
  const last = store.get(LAST_ROOM_KEY);
  const b = $("resume");
  b.hidden = inviteMode || !(last && savedToken(last));
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
  for (const id of ["result", "menu", "banner", "storyOffer", "rulesModal", "homeMenu", "newsModal", "pause", "matchEnd", "recap"]) $(id).hidden = true;
  clearInterval(pauseTimer); pauseTimer = 0;
  hideCoach(true);
  history.replaceState(null, "", "/");
  show(toOnline ? "online" : "home");
  say(toOnline ? msg : "", err);
  if (msg && !toOnline) banner(msg, 3200);
  refreshResume();
}

// ---------------- 07 阿禾的故事（教學）入口 ----------------

const STORY_KEY = "hb.story.v4";      // 跟 /story/ 用同一個進度鍵
const OFFER_KEY = "hb-story-offered";
function storyProgress(): { page: number; finished: boolean; answers: Record<string, unknown> } | null {
  try {
    const p = JSON.parse(store.get(STORY_KEY) ?? "null");
    return p && p.v === 4 && Number.isInteger(p.page) ? { page: p.page, finished: !!p.finished, answers: p.answers ?? {} } : null;
  } catch { return null; }
}
const ACT_STEPS = [["grab", "grab2"], ["bid", "bid2"], ["follow", "ruff", "flipA", "flipB", "trumps", "nt"], ["last", "dbl"]];
const ACT_OF_PAGE = [1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4];
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
  lsReset();
  mySeat = -1; st = null; seats = []; started = false; room = null; lastEid = 0; selCard = selBid = -1; selLevel = 0; selStrain = -1;
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

// 進房：新入座的人帶自己的暱稱；拿憑證回來的人用原本的暱稱（伺服器不會拿這次的名字蓋掉）
function enter(code: string, name = myName()) {
  conn?.close();
  resetTable();
  setInvite(false);
  say("連線中…");
  history.replaceState(null, "", `/?room=${code}`);
  const c = new Connection(code, name);
  conn = c;
  c.onMessage = onMsg;
  let dropped = false;
  lastErr = "";
  c.onStatus = s => {
    if (conn !== c) return;
    if (s === "reconnecting") { dropped = true; banner("連線斷了一下，重新連線中…（這時候按的不會送出）"); }
    else if (s === "open") {
      // 真的斷過、而且重新連上了，才說「回來啦」（對手還斷著的話，下面的同步會換成對手斷線的提示）
      if (dropped) banner("連上了！", 1600);
      dropped = false;
    } else if (s === "closed" && (isTable() || screen === "wait")) {
      banner(lastErr || "這個分頁的連線結束了，重新整理一下再進來。");
    }
  };
  c.open();
}

// 送出會改變狀態的指令；連線中斷時送不出去，要讓玩家知道（不會偷偷吃掉）
function act(m: Command, done?: (r: Reply) => void): boolean {
  if (!conn) return false;
  if (conn.command(m, done)) return true;
  banner("連線中斷了，重新連上之後再按一次。", 2400);
  sfx.deny();
  return false;
}

let lastErr = "";
const PLAYING = new Set(["IN_GAME", "PAUSED", "SETTLEMENT", "REMATCH"]);

function onMsg(m: ServerMsg) {
  switch (m.t) {
    case "welcome":
      mySeat = m.seat;
      $("roomChip").textContent = conn?.solo ? "單機" : `房號 ${m.code}`;
      $("roomChip").hidden = false;
      roomCode = conn?.solo ? "solo" : m.code;
      break;
    case "lobby":
      // 單機：兩個位子都坐好，直接開打
      seats = m.seats.map(x => ({ ...x, ready: true, rematch: false, offlineSince: null, stake: "" }));
      started = m.started;
      renderNames(); renderPresence();
      break;
    case "room":
      applyRoom(m.r, m.notice, m.seat);
      break;
    case "resync":
      // 完整快照：直接跳到最新的樣子，不補播之前的動畫
      lastEid = m.eid;
      applyRoom(m.r);
      if (m.s && started) onState(m.s, true);
      if (m.ls && started) onLS(m.ls);
      break;
    case "event":
      if (typeof m.eid === "number") { if (m.eid <= lastEid) break; lastEid = m.eid; }   // 重複收到的不再演一次
      if (st) onEvent(m.e);
      break;
    case "state":
      onState(m.s);
      break;
    case "lsState":
      onLS(m.s);
      break;
    case "lsEvent":
      if (typeof m.eid === "number") { if (m.eid <= lastEid) break; lastEid = m.eid; }   // 重複收到的不再處理
      if (lsHas()) lsEvent(m.e);
      break;
    case "reject":
      onReject(m.code, m.msg);
      break;
    case "recap":
      showRecap(m.gid, m.items);
      break;
    case "full":
      forgetRoom(conn?.code ?? "");
      goHome("這桌已經坐滿或開打了，請朋友再開一桌。", true, true);
      break;
    case "gone":
      forgetRoom(conn?.code ?? "");
      goHome("找不到這桌（房號打錯，或這桌已經收掉了）。", true, true);
      break;
    case "closed":
      forgetRoom(conn?.code ?? "");
      goHome(m.msg, true, true);
      break;
    case "emote":
      // 回個話：自己的已經先顯示了；對方的照他的暱稱顯示（不是阿禾講的）
      if (m.seat !== mySeat && Number.isInteger(m.i) && EMOTES[m.i]) oppEmote(EMOTES[m.i].text);
      break;
    case "error":
      lastErr = m.msg;
      if (m.code === "NAME") {
        // 要坐新位子但暱稱不合格（例如這支手機的舊憑證已經作廢、又沒填暱稱）：回到填暱稱的地方，房號留著
        const code = conn?.code ?? "";
        goHome("", false, true);
        codeInput.value = code;
        fieldErr(nameInput, $("nameErr"), m.msg);
        nameInput.focus();
        break;
      }
      if (m.code === "RATE") goHome(m.msg, true, true);
      else banner(m.msg, m.code === "VERSION" ? 0 : 2600);
      break;
  }
}

// 逆命賭局：伺服器送來的牌桌（只有自己看得到的部分）
function onLS(s: Parameters<typeof lsView>[0]) {
  lsView(s);
  if (started && room?.mode === "laststand" && screen !== "lstable") show("lstable");
  renderPause();
  renderMatchEnd();
}

// 伺服器拒絕了剛剛的指令：解鎖畫面、說原因（過期的不用講，伺服器會接著送最新狀態，畫面直接跳過去）
function onReject(code: string, msg: string) {
  setWaiting(false);
  staged = -1;
  unpull();
  const nb = $<HTMLButtonElement>("nextBtn");
  if (nb.disabled && !$("result").hidden) { nb.disabled = false; if (st) nb.textContent = st.matchWinner >= 0 ? "再來一場！" : "再來一局！"; renderRematch(); }
  if (st) { renderHand(); renderActions(); }
  if (code === "STALE") return;
  banner(msg, 2600);
  sfx.deny();
}

// ---------------- 房間狀態（朋友連線） ----------------

function applyRoom(r: RoomView, notice?: Notice, who = -1) {
  const before = seats.map(x => x?.taken);
  const prevResult = room?.result ?? null;
  const whoName = who >= 0 ? (seats[who]?.name || r.seats[who]?.name || "") : "";
  const wasStarted = started;
  if (r.status === "CLOSED") { forgetRoom(r.code); goHome("這桌已經關了。", true, true); return; }
  const nowStarted = PLAYING.has(r.status);
  // 打完一場、對方離開了：牌桌收起來，回到等人的畫面（座位、房號都還在）
  if (wasStarted && !nowStarted) { const seat = mySeat, eid = lastEid; resetTable(); mySeat = seat; lastEid = eid; $("result").hidden = true; }
  // 再來一場：上一場的牌桌整個收掉，新的一場從頭畫（不接著上一場的動畫）
  if (notice === "started" && wasStarted) { const seat = mySeat, eid = lastEid; resetTable(); mySeat = seat; lastEid = eid; for (const id of ["result", "matchEnd", "pause"]) $(id).hidden = true; }
  skew = r.now - Date.now();
  room = r; seats = r.seats; started = nowStarted;
  if (!started) showWait(before);
  else if (r.mode === "laststand" ? lsHas() && screen !== "lstable" : !!st && screen !== "table") show(r.mode === "laststand" ? "lstable" : "table");
  renderNames(); renderPresence();
  if (notice === "started") banner(wasStarted ? "新的一場，開打！" : "兩邊都準備好了，開打！", 1800);
  else if (who >= 0 && who !== mySeat) roomNotice(notice, whoName || oppName(), prevResult);
  renderRematch();
  if (st && started && screen === "table") { renderHand(); renderTurn(); renderActions(); }   // 暫停／繼續：手牌能不能出跟著變
  renderPause();
  renderMatchEnd();
  renderResStats();
}

function roomNotice(notice: Notice | undefined, name: string, prev: RoomView["result"] = null) {
  switch (notice) {
    case "left":
      // 對手認輸之後離開：結果要講清楚（這時候牌桌已經收起來了）
      if (prev?.reason === "forfeit" && prev.winner === mySeat) banner(`${name}認輸離開了，這場算你贏（戰績記下來了）。`, 4200);
      else banner(`${name}離開了這桌。`, 2600);
      break;
    case "mode": banner(`房主把玩法換成「${MODES[room!.mode].label}」，兩邊都要重新按準備。`, 2800); break;
    case "name": banner(`${name}把暱稱改成「${oppName()}」。`, 2400); break;
    case "forfeit": banner(`${name}認輸離開了，這場算你贏。`, 3200); break;
    case "timeout": banner(`${name}斷線太久，照規則這場算你贏。`, 3200); break;
    case "rematch": if (seats[1 - mySeat]?.rematch) banner(`${name}想再來一場！`, 2200); break;
  }
}

// 整場打完（朋友連線）：「再來一場」要兩個人都按；按鈕顯示現在等誰
function renderRematch() {
  if (!room || !st || st.matchWinner < 0 || $("result").hidden) return;
  const nb = $<HTMLButtonElement>("nextBtn");
  if (nb.disabled) return;
  const me = seats[mySeat], opp = seats[1 - mySeat];
  nb.textContent = me?.rematch ? `等${oppName()}按…（點一下取消）` : opp?.rematch ? `${oppName()}想再來一場！按這裡開打` : "再來一場！";
  nb.classList.toggle("on", !!me?.rematch);
}

// ---------------- 斷線暫停（朋友連線）：30 秒清楚提示、2 分鐘可以選、超過時限照規則判 ----------------
// 時間都用伺服器的鐘（手機的鐘可能不準）：skew = 伺服器時間 − 手機時間
let skew = 0, pauseTimer = 0, pauseHiddenFor = "";
const serverNow = () => Date.now() + skew;
const mmss = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const minutes = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)} 分鐘` : `${Math.round(ms / 1000)} 秒`;

function renderPause() {
  const r = room, opp = seats[1 - mySeat];
  const on = !!r && r.status === "PAUSED" && isTable() && !!opp?.taken && opp.offlineSince !== null && seats[mySeat]?.offlineSince === null;
  if (!on) { $("pause").hidden = true; clearInterval(pauseTimer); pauseTimer = 0; return; }
  if (!pauseTimer) pauseTimer = window.setInterval(renderPause, 1000);
  const t = r!.timing, now = serverNow();
  // 中離倒數從伺服器說的時間點算（兩邊都斷過線時，是從你回來才開始）
  const start = r!.forfeitAt !== null && r!.forfeitSeat === 1 - mySeat ? r!.forfeitAt - t.forfeit : opp!.offlineSince!;
  const gone = now - start;
  const stage = gone >= t.choice ? 2 : gone >= t.notice ? 1 : 0;
  if (stage === 0) { $("pause").hidden = true; return; }   // 剛斷線：上面的提示條就夠了（常常馬上就回來）
  const key = `${start}:${stage}`;
  const name = oppName();
  $("pauseTitle").textContent = `${name}斷線了`;
  $("pauseText").textContent = stage === 2
    ? `已經等了 ${minutes(gone)}。可以繼續等，或先離開（牌局幫你留著，${name}回來後你再回到這桌接著打）。`
    : `牌局先暫停，${name}回來就能接著打（剛剛打到哪裡都留著）。`;
  $("pauseClock").textContent = r!.forfeitAt !== null
    ? `已經等了 ${mmss(gone)} · 再 ${mmss(r!.forfeitAt - now)} 沒回來，照規則這場算你贏`
    : `已經等了 ${mmss(gone)}`;
  $("pauseChoice").hidden = stage < 2;
  $("pauseHide").hidden = stage >= 2;
  const was = $("pause").hidden;
  $("pause").hidden = pauseHiddenFor === key;
  if (was && !$("pause").hidden) sfx.slide();
}
$("pauseHide").addEventListener("click", () => { pauseHiddenFor = currentPauseKey(); $("pause").hidden = true; });
$("pauseWait").addEventListener("click", () => { pauseHiddenFor = currentPauseKey(); $("pause").hidden = true; banner(`好，繼續等${oppName()}。`, 1600); });
$("pauseLeave").addEventListener("click", () => {
  goHome(`牌局幫你留著。${oppName()}回來之後，到「找朋友玩」按「回到這桌」就能接著打。`);
});
function currentPauseKey() {
  const r = room, opp = seats[1 - mySeat];
  if (!r || !opp || opp.offlineSince === null) return "";
  const start = r.forfeitAt !== null && r.forfeitSeat === 1 - mySeat ? r.forfeitAt - r.timing.forfeit : opp.offlineSince;
  const gone = serverNow() - start;
  return `${start}:${gone >= r.timing.choice ? 2 : 1}`;
}

// 整場因為認輸或斷線逾時結束（照規則打到目標分數的，用原本的結算單）
function renderMatchEnd() {
  const r = room;
  const ls = r?.mode === "laststand";
  // 逆命賭局：九墩打完、有人歸零也用這個面板（經典牌局照規則打完的用原本的結算單）
  const on = !!r && (r.status === "SETTLEMENT" || r.status === "REMATCH") && !!r.result && (ls ? screen === "lstable" : r.result.reason !== "target" && screen === "table");
  if (!on) { $("matchEnd").hidden = true; return; }
  if (ls && Date.now() < lsHoldUntil()) {                  // 最後一墩的結果先看一下
    $("matchEnd").hidden = true;
    window.setTimeout(renderMatchEnd, lsHoldUntil() - Date.now() + 30);
    return;
  }
  $("result").hidden = true;
  const winner = r!.result!.winner, iWon = winner === mySeat, opp = oppName(), why = r!.result!.reason;
  $("meTitle").textContent = winner < 0 ? "平手" : iWon ? "這場算你贏" : `這場算${opp}贏`;
  const fin = ls ? lsResult() : null;
  $("meText").textContent = why === "forfeit"
    ? (iWon ? `${opp}認輸了。` : `你認輸了，這場算${opp}贏。`)
    : why === "timeout"
      ? (iWon ? `${opp}斷線超過 ${minutes(r!.timing.forfeit)} 沒回來，照規則這場算你贏。` : `你斷線超過 ${minutes(r!.timing.forfeit)}，照規則這場算${opp}贏。`)
      : why === "elimination" && fin
        ? `第 ${fin.trick} 墩，${winner === mySeat ? `${opp}的` : "你的"}籌碼歸零。`
        : fin ? `九墩打完：你 ${fin.stacks[mySeat]} 枚、${opp} ${fin.stacks[1 - mySeat]} 枚。` : "";
  const w = r!.stats.wins, d = r!.stats.draws;
  const stakes = ls ? `賭上之物：你『${seats[mySeat]?.stake || DEFAULT_STAKE}』・${opp}『${seats[1 - mySeat]?.stake || DEFAULT_STAKE}』（僅供遊戲敘事）\n` : "";
  $("meStats").textContent = `${stakes}同桌戰績：你 ${w[mySeat]} 勝 · ${opp} ${w[1 - mySeat]} 勝${d ? ` · 平 ${d}` : ""}（共 ${r!.stats.played} 場）`;
  const b = $<HTMLButtonElement>("meRematch");
  const me = seats[mySeat], other = seats[1 - mySeat];
  b.disabled = !other?.taken || meBusy;
  b.textContent = !other?.taken ? `${opp}已經離開了` : me?.rematch ? `等${opp}按…（點一下取消）` : other.rematch ? `${opp}想再來一場！按這裡開打` : "再來一場！";
  $("meRecap").hidden = !r!.gid || ls;
  if ($("matchEnd").hidden) { $("matchEnd").hidden = false; sfx.slide(); }
}
let meBusy = false;
$("meRematch").addEventListener("click", () => {
  if (meBusy) return;
  meBusy = true; renderMatchEnd();
  if (!act({ t: "rematch", ready: !seats[mySeat]?.rematch }, () => { meBusy = false; renderMatchEnd(); })) { meBusy = false; renderMatchEnd(); }
});
$("meLeave").addEventListener("click", () => leaveRoom("你離開了這桌。"));

// 離開這桌（整場已經結束、或開局前）：讓出座位、這支手機忘掉這桌
function leaveRoom(msg: string) {
  const c = conn;
  if (c instanceof Connection && c.isOpen) c.command({ t: "leave" });   // 送出就走（連線關掉前一定會先送出去）
  if (c) forgetRoom(c.code);
  goHome(msg);
}

// ---------------- 同桌戰績、精彩回顧（朋友連線） ----------------
// 戰績只算現在這兩個人（座位憑證，不是暱稱）、確認打完或照規則判的場次；有人離開座位就是另一組
// 顯示在：整場結算單、認輸／逾時的結果面板、對局中的選單。回顧只用兩邊都看過的公開資訊（伺服器整理）
function statsLine(r: RoomView): string {
  const s = r.stats;
  if (!s.played) return "";
  const opp = oppName(), w = s.wins;
  let t = `同桌戰績：你 ${w[mySeat]} 勝 · ${opp} ${w[1 - mySeat]} 勝（共 ${s.played} 場）`;
  if (s.streak && s.streak.n >= 2) t += ` · ${s.streak.seat === mySeat ? "你" : opp}連贏 ${s.streak.n} 場`;
  return t;
}
// 結算單（整場打完）也顯示同桌戰績＋回顧按鈕
function renderResStats() {
  const on = !!room && !!st && st.matchWinner >= 0 && !!room.stats.played;
  $("resStats").hidden = !on;
  $("recapBtn").hidden = !on;
  if (on) $("resStats").textContent = statsLine(room!);
}

let recapFor = "";
function openRecap() {
  const r = room;
  if (!r?.gid || !conn) return;
  recapFor = r.gid;
  $("recapSub").textContent = "整理中…";
  $("recapList").replaceChildren();
  openModal("recap");
  if (!conn.send({ t: "recap", gid: r.gid })) $("recapSub").textContent = "連線中斷了，重新連上再看。";
}
function showRecap(gid: string, items: Highlight[]) {
  if (gid !== recapFor || $("recap").hidden) return;
  $("recapSub").textContent = items.length ? "這一場的關鍵時刻（只看兩邊都看過的牌）" : "這場沒什麼大轉折，下一場打出精彩的！";
  $("recapList").replaceChildren(...items.map(h => {
    const li = document.createElement("li");
    const p = document.createElement("p");
    p.textContent = h.text;
    li.appendChild(p);
    if (h.cards) {
      const rc = document.createElement("div");
      rc.className = "rc";
      h.cards.forEach((id, i) => {
        const f = document.createElement("figure");
        f.appendChild(miniCard(id));
        const cap = document.createElement("figcaption");
        const seat = h.seats?.[i] ?? -1;
        cap.textContent = seat === mySeat ? "你" : seat >= 0 ? oppName() : "";
        f.appendChild(cap);
        rc.appendChild(f);
      });
      li.appendChild(rc);
    }
    return li;
  }));
}
$("recapBtn").addEventListener("click", ev => { ev.stopPropagation(); openRecap(); });
$("meRecap").addEventListener("click", openRecap);

// ---------------- 等朋友：名牌滑入、郵票蓋章、準備、玩法 ----------------

let readyBusy = false;
function showWait(before: (boolean | undefined)[] = []) {
  if (!conn) return;
  show("wait");
  const big = $("bigCode");
  if (big.dataset.code !== conn.code) {
    big.dataset.code = conn.code;
    big.replaceChildren(...[...conn.code].map((ch, i) => { const s = document.createElement("span"); s.textContent = ch; fx.popIn(s, i * 70); return s; }));
  }
  if (mySeat < 0 || !room) return;
  const me = seats[mySeat], opp = seats[1 - mySeat];
  const role = roleOf;
  $("plateMeName").textContent = me?.name || "你";
  // 改名：開局前、還沒按準備才能改（只能改自己的）
  const canRename = (room.status === "WAITING" || room.status === "READY") && !me?.ready && !renameBusy;
  $("renameBtn").hidden = !canRename || !$("renameBox").hidden;
  if (!canRename && !$("renameBox").hidden && me?.ready) closeRename();
  ($("plateMe").querySelector("small") as HTMLElement).textContent = `${role(mySeat)}（你）`;
  ($("plateOpp").querySelector("small") as HTMLElement).textContent = role(1 - mySeat);
  plateTag($("plateMe"), me);
  // 逆命賭局：名牌下面寫賭上之物（還沒簽就說還沒簽）
  const lsMode = room.mode === "laststand";
  for (const [id, s] of [["plateMeStake", me], ["plateOppStake", opp]] as const) {
    const el = $(id);
    el.hidden = !lsMode || !s?.taken;
    el.textContent = s?.stake ? `賭上『${s.stake}』` : "契約還沒簽";
    el.classList.toggle("unsigned", !s?.stake);
  }
  renderContract();
  const plate = $("plateOpp");
  $("plateOppName").textContent = opp?.taken ? opp.name : "還沒來…";
  plateTag(plate, opp);
  if (opp?.taken && !plate.classList.contains("in")) {
    plate.classList.add("in");
    fx.slideIn(plate, "right");
    if (!before[1 - mySeat]) { sfx.join(); const em = plate.querySelector("em"); if (em) fx.stampIn(em, 200); }
  } else if (!opp?.taken) plate.classList.remove("in");
  renderModes();
  const rb = $<HTMLButtonElement>("readyBtn");
  const needSign = room.mode === "laststand" && !me?.stake;
  rb.disabled = room.status !== "READY" || readyBusy || !!(opp && !opp.online) || needSign;
  rb.textContent = me?.ready ? "取消準備" : "準備好了";
  rb.classList.toggle("on", !!me?.ready);
  rb.setAttribute("aria-pressed", String(!!me?.ready));
  const on = (t: string, dots: boolean) => { $("waitText").textContent = t; $("waitDots").hidden = !dots; };
  if (!opp?.taken) on("還差一個人，把房號或連結傳給朋友", true);
  else if (!opp.online) on(`${opp.name}連線中斷，等他回來`, true);
  else if (needSign) on("先在賭局契約書上蓋章，再按「準備好了」", false);
  else if (room.mode === "laststand" && !opp.stake) on(`${opp.name}還在寫契約…`, true);
  else if (me?.ready && opp.ready) on("兩邊都準備好了，開打！", false);
  else if (me?.ready) on(`等${opp.name}按準備`, true);
  else if (opp.ready) on(`${opp.name}準備好了，換你按「準備好了」`, false);
  else on("兩個人都按「準備好了」就開打", false);
}
function plateTag(el: HTMLElement, s: SeatInfo | undefined) {
  const em = el.querySelector("em");
  if (!em) return;
  em.textContent = !s?.taken ? "已入座" : !s.online ? "斷線中" : s.ready ? "準備好了" : "已入座";
  em.classList.toggle("ready", !!s?.taken && s.online && s.ready);
  em.classList.toggle("off", !!s?.taken && !s.online);
}
function renderModes() {
  if (!room) return;
  const host = room.host === mySeat;
  document.querySelectorAll<HTMLButtonElement>("#modePick .mode").forEach(b => {
    const md = b.dataset.mode as Mode;
    const on = room!.mode === md;
    b.setAttribute("aria-checked", String(on));
    b.classList.toggle("on", on);
    b.classList.toggle("locked", !MODES[md]?.enabled);
    b.classList.toggle("guest", !host);
  });
  $("modeNote").textContent = host ? "你是房主，玩法你來選（換了要重新準備）。" : "玩法由房主選（換了要重新準備）。";
}
// 改暱稱：名牌換成輸入欄（鍵盤跳出來時輸入欄和按鈕在畫面上半部，不會被擋住）
let renameBusy = false;
const renameInput = $<HTMLInputElement>("renameInput");
const refreshRenameCount = nameField(renameInput, $("renameCount"), $("renameErr"));
function openRename() {
  renameInput.value = seats[mySeat]?.name ?? "";
  fieldErr(renameInput, $("renameErr"), "");
  refreshRenameCount();
  $("plateMe").hidden = true;
  $("renameBox").hidden = false;
  $("renameBtn").hidden = true;
  renameInput.focus();
  renameInput.select();
}
function closeRename() {
  $("renameBox").hidden = true;
  $("plateMe").hidden = false;
  if (screen === "wait") showWait();
}
$("renameBtn").addEventListener("click", openRename);
$("renameCancel").addEventListener("click", closeRename);
renameInput.addEventListener("keydown", e => { if (e.key === "Enter" && composing(e)) e.preventDefault(); });   // 選字中的 Enter 不送出
$("renameBox").addEventListener("submit", ev => {
  ev.preventDefault();
  if (renameBusy) return;
  const name = readName(renameInput, $("renameErr"));
  if (!name) return;
  if (name === seats[mySeat]?.name) { closeRename(); return; }
  renameBusy = true;
  $<HTMLButtonElement>("renameOk").disabled = true;
  const sent = act({ t: "name", name }, r => {
    renameBusy = false;
    $<HTMLButtonElement>("renameOk").disabled = false;
    if (r.ok) { store.set("hb-name", name); nameInput.value = name; refreshNameCount(); closeRename(); banner(`暱稱改成「${name}」了。`, 1600); }
    else fieldErr(renameInput, $("renameErr"), r.msg);
  });
  if (!sent) { renameBusy = false; $<HTMLButtonElement>("renameOk").disabled = false; }
});

// ---------------- 逆命賭局：賭局契約書 ----------------
// 提示文字在兩句之間輪播（3～4 秒、淡入淡出）；點了輸入框、正在打字、已經有字就停；不碰玩家打的字
// 系統設定「減少動態效果」或遊戲裡關掉動畫時不輪播
const STAKE_PH = ["這場，你要賭上什麼？", "你要交出什麼？"];
const stakeInput = $<HTMLInputElement>("stakeInput");
const stakePh = $("stakePh");
let phIdx = Math.random() < 0.5 ? 0 : 1, phTimer = 0, stakeBusy = false, stakeTouched = false;
stakePh.textContent = STAKE_PH[phIdx];
const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches || !fx.motionOn(); } catch { return !fx.motionOn(); } };
function phTick() {
  clearTimeout(phTimer);
  const idle = !stakeInput.value && document.activeElement !== stakeInput && !$("contract").hidden && screen === "wait" && !document.hidden;
  if (!idle || reduceMotion()) return;
  phTimer = window.setTimeout(() => {
    if (stakeInput.value || document.activeElement === stakeInput) return;
    stakePh.classList.add("fade");
    phTimer = window.setTimeout(() => {
      phIdx = (phIdx + 1) % STAKE_PH.length;
      stakePh.textContent = STAKE_PH[phIdx];
      stakePh.classList.remove("fade");
      phTick();
    }, 450);
  }, 3000 + Math.random() * 1000);
}
function refreshStake() {
  const raw = stakeInput.value, me = seats[mySeat];
  stakePh.hidden = !!raw;
  const chk = checkStake(raw);
  const shown = chk.ok ? chk.stake : normalizeName(raw);
  $("stakePreview").textContent = `本人自願於本場賭局中賭上『${shown}』。`;
  const n = nameLength(normalizeName(raw));
  $("stakeCount").textContent = `${n}/${STAKE_MAX}`;
  $("stakeCount").classList.toggle("over", n > STAKE_MAX);
  fieldErr(stakeInput, $("stakeErr"), chk.ok ? "" : chk.msg);
  const signed = !!me?.stake && chk.ok && me.stake === chk.stake;
  $("stakeSeal").classList.toggle("signed", signed);
  const st = $("contractState");
  st.textContent = signed ? "已蓋章 ✓" : me?.stake ? "改過了：要重新蓋章" : "尚未蓋章";
  st.classList.toggle("done", signed);
}
function renderContract() {
  const on = room?.mode === "laststand" && (room.status === "WAITING" || room.status === "READY");
  $("contract").hidden = !on;
  if (!on) { clearTimeout(phTimer); return; }
  const me = seats[mySeat];
  $("contractName").textContent = me?.name || "你";
  // 重新整理後把簽過的內容帶回來（只在玩家還沒動過輸入框、而且是空的時候；預設值不帶，讓提示文字輪播）
  if (!stakeTouched && !stakeInput.value && me?.stake && me.stake !== DEFAULT_STAKE) stakeInput.value = me.stake;
  const locked = !!me?.ready;
  stakeInput.readOnly = locked;
  $<HTMLButtonElement>("stakeSeal").disabled = locked || stakeBusy;
  refreshStake();
  phTick();
}
stakeInput.addEventListener("input", () => { stakeTouched = true; refreshStake(); clearTimeout(phTimer); if (!stakeInput.value) phTick(); });
stakeInput.addEventListener("focus", () => { clearTimeout(phTimer); stakePh.classList.remove("fade"); });
stakeInput.addEventListener("blur", () => phTick());
stakeInput.addEventListener("keydown", e => { if (e.key === "Enter" && composing(e)) e.preventDefault(); });   // 選字中的 Enter 不送出
document.addEventListener("visibilitychange", () => { if (screen === "wait") phTick(); });
$("contract").addEventListener("submit", ev => {
  ev.preventDefault();
  if (stakeBusy || !room) return;
  const chk = checkStake(stakeInput.value);
  if (!chk.ok) { fieldErr(stakeInput, $("stakeErr"), chk.msg); fx.deny(stakeInput); sfx.deny(); return; }
  stakeBusy = true;
  $<HTMLButtonElement>("stakeSeal").disabled = true;
  const sent = act({ t: "stake", stake: stakeInput.value }, r => {
    stakeBusy = false;
    if (r.ok) { fx.stampIn($("stakeSeal")); fx.buzz(14); stakeInput.blur(); }
    else fieldErr(stakeInput, $("stakeErr"), r.msg);
    renderContract();
  });
  if (!sent) { stakeBusy = false; renderContract(); }
});

lsInit({ act, banner, oppName, openMenu: () => openMenu(), deny: () => sfx.deny() });

$("modePick").addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".mode");
  if (!b || !room) return;
  const md = b.dataset.mode as Mode;
  if (!MODES[md]) return;
  if (room.host !== mySeat) { banner("玩法由房主選喔。", 1800); fx.deny(b); return; }
  if (!MODES[md].enabled) { banner(`${MODES[md].label}還在做，先用${MODES.classic.label}。`, 2400); fx.deny(b); sfx.deny(); return; }
  if (room.mode === md) return;
  act({ t: "mode", mode: md });
});
$("readyBtn").addEventListener("click", () => {
  if (!room || readyBusy) return;
  const want = !seats[mySeat]?.ready;
  readyBusy = true;
  showWait();
  const sent = act({ t: "ready", ready: want }, r => {
    readyBusy = false;
    if (!r.ok) banner(r.msg, 2400);
    if (screen === "wait") showWait();
  });
  if (!sent) { readyBusy = false; showWait(); }
  else if (want) fx.punch($("readyBtn"));
});
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
// 離開這桌（開局前）：請伺服器讓出座位；連不上的話就只在這支手機忘掉（伺服器 10 分鐘後也會讓出來）
$("cancelWait").addEventListener("click", () => {
  const c = conn;
  if (!(c instanceof Connection) || !c.isOpen) { if (c) forgetRoom(c.code); goHome("", false, true); return; }
  const b = $<HTMLButtonElement>("cancelWait");
  b.disabled = true;
  c.command({ t: "leave" }, r => {
    b.disabled = false;
    if (r.ok || r.code === "NOT_SEATED") { forgetRoom(c.code); goHome("你離開了這桌。", false, true); }
    else banner(r.msg, 2600);
  });
});

function flashLabel(b: HTMLElement, text: string) {
  const old = b.dataset.label ?? b.textContent ?? "";
  b.dataset.label = old;
  b.textContent = text;
  fx.punch(b);
  setTimeout(() => { b.textContent = old; }, 1500);
}

// ---------------- 狀態 → 畫面 ----------------

// jump：斷線回來、版本過期時伺服器給的完整快照 → 直接畫成最新的樣子，不補播中間的動畫
function onState(s: TableState, jump = false) {
  if (jump && st) {
    inFlight.clear(); freshCards.clear(); chipPending.clear();
    staged = -1; selCard = -1; dealing = false;
    clearTimeout(bidRevealTimer); bidRevealTimer = 0;
    auctionShown = s.auctionCalls.length;
  }
  const first = !st || jump;
  st = s;
  setWaiting(false);
  if (pulled >= 0 && !s.hand.includes(pulled)) pulled = -1;   // 已經打出去了
  else if (pulled >= 0 && !myTurn()) pulled = -1;
  if ($("table").hidden) { show("table"); renderPause(); renderMatchEnd(); }
  if (first) say("");
  // 跟阿禾打、剛開的一場（第一局、還沒出過牌）：開場那一句。發牌事件在第一次畫牌桌之前就到了，所以在這裡補講
  if (first && conn?.solo && s.handNumber === 1 && s.phase === Phase.Draw && s.myScore === 0 && s.oppScore === 0 && s.stockCount === 26 && s.leadCard < 0) {
    brain.newMatch(); dealNo++;
    causeEv = { type: "NewHand", seat: s.leaderSeat, card: -1, value: 1, extra: 0 } as GameEvent;
    ahe("matchStart", {}, 900);
  }
  render(first);
}

function render(first = false) {
  if (!st) return;
  const s = st;
  if (s.phase === Phase.Draw) coach("draw", "搶牌開始", "每一墩贏的人拿走翻開的明牌，輸的人摸一張暗牌。這段不算分，搶的是下一階段的好牌。");
  $("table").classList.toggle("bidding", s.phase === Phase.Bidding);
  $("table").classList.toggle("finished", s.phase === Phase.Finished);
  $("felt").classList.toggle("drawing", s.phase === Phase.Draw);
  renderTop();
  renderPhase();
  renderOpp(first);
  renderCenter(first);
  renderTrickInfo();
  refreshAura();
  renderBid(first);
  renderHand(first);
  renderTurn();
  renderActions();
  renderResult(first);
  if (!$("recordPop").hidden) renderRecord();
}

function renderNames() {
  // 朋友連線：對面是真人，不用阿禾的郵票；跟阿禾打才是阿禾
  const stamp = conn?.solo ? "/art/stamp-ahe.svg" : "/art/seal.svg";
  for (const img of [$<HTMLImageElement>("oppStamp"), $("plateOpp").querySelector("img")]) if (img && !img.src.endsWith(stamp)) img.src = stamp;
  $("oppName").textContent = oppName();
  $("oppNameTop").textContent = oppName();
  $("recOppName").textContent = oppName();
  $("bidOppName").textContent = oppName();
  $("rtOppName").textContent = oppName();
}

// 對手斷線／回來：只收自己貼上去的提示（別的提示不會被這裡蓋掉）
let presenceMsg = false;
function renderPresence() {
  const opp = seats[1 - mySeat];
  $("oppDot").classList.toggle("off", !!opp?.taken && !opp.online);
  const offline = started && !!opp?.taken && !opp.online;
  if (offline) {
    banner(room?.status === "PAUSED" ? `${oppName()}斷線了，牌局先暫停，等他回來。（牌局會保留）` : `${oppName()}好像斷線了，等他回來一下。`);
    presenceMsg = true;
  } else if (presenceMsg) {
    presenceMsg = false;
    if (oppWasOffline && started && opp?.online) banner(`${oppName()}回來啦！繼續打。`, 1800);
    else $("banner").hidden = true;
  }
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

// 整局流程：① 搶牌 → ② 叫牌 → ③ 出牌 → ④ 結算；每一格都可以點開看一句話說明（不影響牌局）
const STAGES = [
  { title: "先來搶牌", text: "前面這 13 墩先不算分。贏的人拿明牌，輸的人摸暗牌。想拿到好牌，就得想辦法搶贏！" },
  { title: "這局敢叫多大？", text: "看看自己手上的牌，決定你有把握拿幾墩。叫得越高，成功的話分數越多，但失敗也可能付出代價。" },
  { title: "正式開打", text: "輪流出牌，能跟花色就要跟。想辦法完成合約，或阻止對手打成！" },
  { title: "來算分吧", text: "看合約有沒有打成，再按照墩數、加倍和目前模式計算結果。" },
] as const;
const stageOf = (s: TableState) => s.phase === Phase.Draw ? 0 : s.phase === Phase.Bidding ? 1 : s.phase === Phase.Play ? 2 : 3;

function renderPhase() {
  const s = st!;
  const txt = s.phase === Phase.Draw ? "前半場｜搶牌" : s.phase === Phase.Bidding ? "叫牌中" : s.phase === Phase.Play ? "後半場｜出牌" : "這局打完了";
  const pt = $("phaseText");
  const step = stageOf(s);
  if (pt.textContent !== txt) {
    pt.textContent = txt;
    $("phaseChip").querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("done", i < step); li.classList.toggle("now", i === step);
      const b = li.querySelector("button");
      if (b) { if (i === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); }
    });
    const now = $("phaseChip").querySelector("li.now");
    if (now) fx.punch(now, 0.12, 320);
  }
  renderKeyInfo();
}

// 第二排：這個階段最重要的一兩個數字（搶牌：第幾次；叫牌：目前最高、輪到誰；出牌：合約、王牌、莊家已贏／目標）
function renderKeyInfo() {
  const s = st!;
  const k = $("keyInfo");
  const opp = esc(oppName());
  let kind = "none", html = "";
  if (s.phase === Phase.Draw) {
    kind = "draw";
    html = `<b class="km">搶牌中</b><span class="kn"><b class="num"></b><small> / 13</small></span>`;
  } else if (s.phase === Phase.Bidding) {
    kind = "bid";
    html = `<b class="km">叫牌中</b><span class="ks">${s.highestBid >= 0 ? `最高 ${contractHtml(s)}` : "還沒人叫"}<i>·</i>${myBidTurn() ? `<b class="me">輪到你</b>` : `等${opp}`}</span>`;
  } else if (s.highestBid >= 0 && s.declarer >= 0) {
    kind = "play";
    const iDecl = s.declarer === s.seat;
    const strain = bidStrain(s.highestBid);
    const trump = strain === Strain.NoTrump ? "無王" : `王牌 <span class="${strain === Strain.Hearts || strain === Strain.Diamonds ? "red" : ""}">${SUIT_SYMBOL[strain]}</span>`;
    html = `<b class="km">${contractHtml(s)}</b><small class="kt">${trump}</small>`
      + `<span class="ks">莊家 <b class="${iDecl ? "me" : "op"}">${iDecl ? "你" : opp}</b> <b class="num"></b><small> / ${tricksNeeded(s.highestBid)} 墩</small>${iDecl ? "" : `<em class="def">你防守</em>`}</span>`;
  }
  if (k.dataset.key !== kind + html) { k.dataset.key = kind + html; k.dataset.kind = kind; k.innerHTML = html; }
  const num = k.querySelector(".num") as HTMLElement | null;
  if (num) flipNumber(num, String(kind === "draw" ? trickNo(s) : s.declarer === s.seat ? s.myTricks : s.oppTricks), kind === "play", kind === "play" ? Math.min(4, Math.max(0, streak - 1)) * 0.06 : 0);
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
  $("recordLbl").textContent = s.phase === Phase.Draw ? "已搶明牌" : "牌局紀錄";
}

function contractHtml(s: TableState) {
  const b = s.highestBid;
  const base = isRedBid(b) ? `<span class="red">${bidText(b)}</span>` : bidText(b);
  return s.doubled > 0 ? `${base}<span class="x">${s.doubled >= 2 ? "再加倍" : "加倍"}</span><span class="mult" title="計分倍率">×${s.doubled >= 2 ? 4 : 2}</span>` : base;
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
  // 後半場：合約、王牌、墩數都在上方第二排；桌面只放牌，留出呼吸空間
  if (s.phase === Phase.Play && s.highestBid >= 0 && s.declarer >= 0) emo.sustain(s);
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

  renderSuitCount();
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
  if (!act({ t: "play", card: id })) { setWaiting(false); unpull(); }
}

function unpull() { if (pulled >= 0) { pulled = -1; if (st) renderHand(); } }

// 不能出的原因（不只擺動，還要說清楚）
function reasonFor(): string {
  const s = st;
  if (!s) return "";
  if (paused()) return `${esc(oppName())}斷線了，牌局先暫停，等他回來。`;
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

// ---------------- 對局提示（第一次到每個階段出現一次；設定裡可以關掉或重看） ----------------
// 浮在阿禾那一列上面，不遮手牌、確認出牌和牌桌；幾秒後自己收起來，也可以按「知道了」
type CoachId = "draw" | "bid" | "contract" | "firstTrick" | "result";
let coachSeen = new Set<CoachId>(JSON.parse(store.get(COACH_KEY) ?? "[]") as CoachId[]);
let coachTimer = 0;
const coachQueue: [CoachId, string, string][] = [];
function coachOnce(id: CoachId): boolean {
  if (!fx.settings.coach || coachSeen.has(id)) return false;
  coachSeen.add(id);
  store.set(COACH_KEY, JSON.stringify([...coachSeen]));
  return true;
}
function coach(id: CoachId, title: string, text: string) {
  if (!coachOnce(id)) return;
  if (!$("coach").hidden) { coachQueue.push([id, title, text]); return; }
  showCoach(title, text);
}
function showCoach(title: string, text: string) {
  $("coachTitle").textContent = title;
  $("coachText").textContent = text;
  const c = $("coach");
  c.hidden = false;
  fx.slideIn(c, "up");
  clearTimeout(coachTimer);
  coachTimer = window.setTimeout(() => hideCoach(), Math.max(5200, 2600 + text.length * 70));
}
function hideCoach(all = false) {
  clearTimeout(coachTimer);
  $("coach").hidden = true;
  if (all) { coachQueue.length = 0; return; }
  const next = coachQueue.shift();
  if (next) setTimeout(() => showCoach(next[1], next[2]), 250);
}
$("coachOk").addEventListener("click", () => hideCoach());
window.addEventListener("hb-coach-reset", () => { coachSeen = new Set(); });

// 常駐氣氛：只看真的加倍狀態和局內連續贏墩（不加分、不追蹤連勝局數）
function refreshAura() {
  const s = st;
  if (!s) { resetAura(); return; }
  const live = s.phase === Phase.Bidding || s.phase === Phase.Play || s.phase === Phase.Finished;
  updateAura({ doubled: live ? s.doubled : 0, myStreak: streak, oppStreak, playing: s.phase === Phase.Play }, { opp: oppName() });
}

// 這一墩：誰先出（①）、誰後出（②）、領出花色；出牌格標上名字和先後
function renderTrickInfo() {
  const s = st!;
  const active = s.phase === Phase.Draw || s.phase === Phase.Play;
  const meLead = s.leaderSeat === s.seat;
  const opp = oppName();
  $("mySlot").dataset.label = active ? `你 ${meLead ? "①先出" : "②後出"}` : "";
  $("oppSlot").dataset.label = active ? `${opp} ${meLead ? "②後出" : "①先出"}` : "";
}

// 剛結束的那一墩：桌上只講一句「誰贏、下一墩誰先出」；為什麼贏放在「?」和牌局紀錄裡
let trickShow: { line: string; title: string; why: string; next: string; until: number; good: boolean } | null = null;
let trickShowTimer = 0;
const trickShowing = () => !!trickShow && performance.now() < trickShow.until && selCard < 0 && staged < 0;

// 這一局每一墩公開出過的牌（搶牌、出牌分開記；只記雙方打出來的牌和翻開的明牌，不記暗牌）
interface TrickRec { draw: boolean; no: number; leader: number; lead: number; follow: number; winner: number; trump: number; faceUp: number }
let trickLog: { key: string; list: TrickRec[] } = { key: "", list: [] };
const LOG_KEY = "hb-trick-log";
const logKey = (s: TableState) => `${roomCode}|${s.seat}|${s.handNumber}`;
function syncLog(s: TableState) {
  const k = logKey(s);
  if (trickLog.key === k) return;
  trickLog = { key: k, list: [] };
  try { const saved = JSON.parse(sessionStorage.getItem(LOG_KEY) ?? "null"); if (saved?.key === k && Array.isArray(saved.list)) trickLog = saved; } catch { /* 無痕模式 */ }
}
function saveLog() { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(trickLog)); } catch { /* 無痕模式 */ } }

function recordTrick(e: GameEvent, s: TableState) {
  if (s.leadCard < 0 || s.followCard < 0) return;
  const draw = s.phase === Phase.Draw;
  const trump = s.phase === Phase.Play ? bidStrain(s.highestBid) : Strain.NoTrump;
  const followerName = nameOf(1 - s.leaderSeat);
  const w = whyTrick(s.leadCard, s.followCard, trump, followerName);
  const winner = nameOf(e.seat), winnerMe = e.seat === s.seat;
  const lastPlay = s.phase === Phase.Play && s.myTricks + s.oppTricks === 12;
  const lastDraw = draw && s.stockCount <= 2;
  const won = winnerMe ? "這墩你贏了！" : `這墩${winner}贏了，`;
  const line = lastPlay ? `${won}接著結算。` : lastDraw ? `${won}搶牌結束，接著叫牌。` : winnerMe ? `${won}下一墩你先出。` : `${won}下一墩${winner}先出。`;
  let next = lastPlay ? "這是最後一墩，接著結算。" : lastDraw ? "搶牌結束，接著叫牌。" : `下一墩由${winner}先出。`;
  if (draw && s.faceUp >= 0) next += `${winner}拿走明牌 ${cardText(s.faceUp)}，${nameOf(1 - e.seat)}摸一張暗牌。`;
  trickShow = { line, title: `${winner}贏這墩`, why: w.why, next, until: performance.now() + (fx.settings.fast ? 1900 : 2700), good: winnerMe };
  syncLog(s);
  trickLog.list.push({ draw, no: trickNo(s), leader: s.leaderSeat, lead: s.leadCard, follow: s.followCard, winner: e.seat, trump, faceUp: draw ? s.faceUp : -1 });
  saveLog();
  clearTimeout(trickShowTimer);
  trickShowTimer = window.setTimeout(() => { if (st) { renderTurn(); renderTrickInfo(); } }, (trickShow.until - performance.now()) + 40);
}

// 輪到誰、現在要做什麼：桌上只講一句（你先出／你跟牌／等對手／判定中／這墩結束），規則細節按旁邊的「?」
let tipTitle = "", tipBody = "";
const JUDGE = (trump: number) => trump === Strain.NoTrump
  ? "同花色比點數；後出的人沒跟領出花色，就贏不了（本局無王，沒有王吃）。"
  : `同花色比點數；後出的人沒有領出花色時，出${SUIT_NAME[trump]}（王牌）可以王吃，墊其他花色就贏不了。`;
function renderTurn() {
  const s = st!;
  const line = $("turnLine");
  const opp = oppName();
  let cls = "wait", text = "";
  tipTitle = ""; tipBody = "";
  const active = s.phase === Phase.Draw || s.phase === Phase.Play;
  const draw = s.phase === Phase.Draw;
  const meLead = s.leaderSeat === s.seat;
  const trump = s.phase === Phase.Play ? bidStrain(s.highestBid) : Strain.NoTrump;
  if (!active) text = "";
  else if (s.leadCard < 0 && trickShowing()) {
    cls = "done"; text = trickShow!.line;
    tipTitle = trickShow!.title; tipBody = `${trickShow!.why}\n${trickShow!.next}`;
  } else if (s.leadCard >= 0 && s.followCard >= 0) {
    cls = "wait judge"; text = "看看這墩誰贏…";
    tipTitle = "怎麼判定"; tipBody = `領出花色是第一張牌的花色：${SUIT_SYMBOL[suitOf(s.leadCard)]}${SUIT_NAME[suitOf(s.leadCard)]}。\n${draw ? JUDGE(Strain.NoTrump).replace("本局無王", "搶牌階段沒有王牌") : JUDGE(trump)}`;
  } else if (myTurn()) {
    cls = "mine";
    const pick = staged >= 0 ? staged : selCard;
    const bad = pick >= 0 && !s.legal.includes(pick) ? illegalReason(s.hand, s.leadCard, pick) : null;
    if (bad) { cls = "mine bad"; text = bad; }
    else if (staged >= 0) text = "預覽中：按「確認出牌」送出。";
    else text = meLead ? "換你出牌。" : `${opp}出了 ${cardText(s.leadCard)}，換你跟牌。`;
    tipTitle = meLead ? "你先出牌" : "跟牌規則";
    const lead = LEAD_ADVICE.replace(/^你先出牌：/, "");
    tipBody = meLead ? (draw && s.faceUp >= 0 ? `${lead}\n贏了拿走明牌 ${cardText(s.faceUp)}，輸了摸一張暗牌。` : lead)
      : followAdvice(s.hand, s.leadCard, trump, draw);
    if (pick >= 0 && !bad) tipBody += "\n點同一張牌可以收回，或往上拖到桌上預覽。";
  } else {
    text = `等${opp}一下…`;
    tipTitle = "現在輪到誰";
    tipBody = s.leadCard < 0 ? `這墩由${opp}先出，你後出。${selCard >= 0 ? `（你先選好 ${cardText(selCard)} 了）` : ""}` : `你先出了 ${cardText(s.leadCard)}，換${opp}跟牌。`;
  }
  if (!$("tipPop").hidden) fillTip();
  const key = cls + "|" + text;
  if (key === lastTurnText) return;
  const was = lastTurnText;
  lastTurnText = key;
  line.className = "turn " + cls;
  let tt = line.querySelector(".tt") as HTMLElement | null;
  if (!tt) {
    tt = document.createElement("span"); tt.className = "tt";
    const q = document.createElement("button");
    q.type = "button"; q.className = "qbtn"; q.textContent = "?"; q.setAttribute("aria-label", "為什麼？看規則說明");
    q.addEventListener("click", ev => { ev.stopPropagation(); if ($("tipPop").hidden) openTip(); else closeTip(); });
    line.append(tt, q);
  }
  line.hidden = !text;
  tt.replaceChildren();
  // 輪到你、而且是短句：字一個一個輕輕跳；長句（理由）就安靜顯示
  if (cls === "mine" && [...text].length <= 6) [...text].forEach((ch, i) => { const sp = document.createElement("span"); sp.className = "ch"; sp.style.setProperty("--i", String(i)); sp.textContent = ch; tt!.appendChild(sp); });
  else tt.textContent = text;
  if (cls.startsWith("mine") && !was.startsWith("mine")) {
    fx.popIn(tt); fx.buzz(12);
    // 輪到你：提示和你的手牌區短暫亮一下
    if (fx.motionOn()) handBox.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.18)" }, { filter: "brightness(1)" }], { duration: fx.ms(520) });
  }
}

// ---------------- 按需展開：階段說明、「?」規則說明、牌局紀錄（都不影響牌局進度） ----------------
let stageOpen = -1;
function closeStage() { stageOpen = -1; $("stagePop").hidden = true; $("phaseChip").querySelectorAll("button").forEach(b => b.removeAttribute("aria-expanded")); }
function openStage(i: number, btn: HTMLElement) {
  closeTip(); closeRecord();
  stageOpen = i;
  const pop = $("stagePop");
  $("stageTitle").textContent = STAGES[i].title;
  $("stageText").textContent = STAGES[i].text;
  const top = $("table").querySelector(".topbar") as HTMLElement;
  pop.style.top = `${top.offsetTop + top.offsetHeight + 4}px`;
  pop.hidden = false;
  const tr = $("table").getBoundingClientRect(), br = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.setProperty("--ax", `${Math.max(16, Math.min(pr.width - 16, br.left + br.width / 2 - pr.left))}px`);
  void tr;
  btn.setAttribute("aria-expanded", "true");
  popIn(pop);
  sfx.select();
}
$("phaseChip").addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("button[data-stage]") as HTMLElement | null;
  if (!b) return;
  const i = Number(b.dataset.stage);
  if (stageOpen === i) closeStage(); else openStage(i, b);
});

function fillTip() { $("tipTitle").textContent = tipTitle; $("tipText").textContent = tipBody; }
function openTip() {
  if (!tipBody) return;
  closeStage(); closeRecord();
  fillTip();
  const pop = $("tipPop"), line = $("turnLine"), table = $("table");
  pop.style.bottom = `${table.clientHeight - line.offsetTop + 6}px`;
  pop.hidden = false;
  popIn(pop);
  sfx.select();
}
function closeTip() { $("tipPop").hidden = true; }

let recTab: "mine" | "opp" | "tricks" | "auction" | "" = "";
function openRecord() {
  closeStage(); closeTip();
  const pop = $("recordPop"), table = $("table");
  pop.style.top = `${$("oppArea").offsetTop}px`;
  pop.style.bottom = `${table.clientHeight - $("turnLine").offsetTop + 4}px`;
  pop.hidden = false;
  $("recordBtn").setAttribute("aria-expanded", "true");
  if (!recTab) recTab = st?.phase === Phase.Draw ? "opp" : "tricks";
  renderRecord();
  popIn(pop);
  sfx.slide();
}
function closeRecord() { $("recordPop").hidden = true; $("recordBtn").setAttribute("aria-expanded", "false"); }
$("recordBtn").addEventListener("click", ev => { ev.stopPropagation(); if ($("recordPop").hidden) openRecord(); else closeRecord(); });
$("recordPop").querySelector(".rectabs")!.addEventListener("click", ev => {
  const b = (ev.target as HTMLElement).closest("button[data-tab]") as HTMLElement | null;
  if (!b) return;
  recTab = b.dataset.tab as typeof recTab;
  renderRecord();
});

const miniCard = (id: number) => { const c = fx.cardEl(id); c.classList.add("mini"); return c; };
function renderRecord() {
  const s = st;
  if (!s) return;
  syncLog(s);
  $("cntMine").textContent = String(s.myTakenFaceUp.length);
  $("cntOpp").textContent = String(s.oppTakenFaceUp.length);
  $("recordPop").querySelectorAll<HTMLElement>(".rectabs button").forEach(b => { const on = b.dataset.tab === recTab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  const body = $("recBody");
  body.replaceChildren();
  const note = (t: string) => { const p = document.createElement("p"); p.className = "recnote"; p.textContent = t; body.appendChild(p); };
  if (recTab === "mine" || recTab === "opp") {
    const list = recTab === "mine" ? s.myTakenFaceUp : s.oppTakenFaceUp;
    const who = recTab === "mine" ? "你" : oppName();
    if (!list.length) { note(s.phase === Phase.Draw ? `${who}還沒搶到明牌。` : `這局${who}沒有搶到明牌。`); return; }
    note(`${who}搶到的明牌（翻開過、大家都看過的牌），共 ${list.length} 張：`);
    const grid = document.createElement("div"); grid.className = "recgrid";
    for (const id of list) grid.appendChild(miniCard(id));
    body.appendChild(grid);
    if (recTab === "mine") note("輸的時候摸到的暗牌不會列在這裡（它們已經在你的手牌裡）。");
    return;
  }
  if (recTab === "auction") {
    if (!s.auctionCalls.length) { note(s.phase === Phase.Draw ? "搶牌結束後才開始叫牌。" : "還沒有人叫牌。"); return; }
    const ol = document.createElement("ol"); ol.className = "alist";
    ol.innerHTML = s.auctionCalls.map((c, i) => `<li>${esc(nameOf(s.auctionSeats[i]))}　${callHtml(c)}</li>`).join("");
    body.appendChild(ol);
    return;
  }
  // 出牌紀錄：最新的在上面；前半場（搶牌）和後半場（出牌）分開編號
  if (!trickLog.list.length) { note("這局還沒有打完的墩。"); return; }
  let group = "";
  for (const t of [...trickLog.list].reverse()) {
    const g = t.draw ? "前半場・搶牌（不算合約）" : "後半場・出牌";
    if (g !== group) { group = g; const h = document.createElement("h4"); h.textContent = g; body.appendChild(h); }
    const row = document.createElement("div"); row.className = "recrow";
    const w = whyTrick(t.lead, t.follow, t.trump, nameOf(1 - t.leader));
    const head = document.createElement("div"); head.className = "rh";
    const no = document.createElement("b"); no.textContent = t.draw ? `搶牌第 ${t.no} 次` : `第 ${t.no} 墩`;
    const res = document.createElement("span"); res.className = t.winner === s.seat ? "won" : "lost"; res.textContent = `${nameOf(t.winner)}贏`;
    head.append(no, res);
    const cards = document.createElement("div"); cards.className = "rc";
    for (const [id, who, ord] of [[t.lead, t.leader, "①先出"], [t.follow, 1 - t.leader, "②後出"]] as const) {
      const f = document.createElement("figure"); f.appendChild(miniCard(id));
      const cap = document.createElement("figcaption"); cap.textContent = `${nameOf(who)} ${ord}`; f.appendChild(cap);
      cards.appendChild(f);
    }
    const why = document.createElement("p"); why.className = "rw";
    why.textContent = `領出 ${SUIT_SYMBOL[suitOf(t.lead)]}${SUIT_NAME[suitOf(t.lead)]}｜${t.draw ? "搶牌沒有王牌" : trumpWord(t.trump)}：${w.why}${t.faceUp >= 0 ? ` 明牌 ${cardText(t.faceUp)} 歸${nameOf(t.winner)}。` : ""}`;
    row.append(head, cards, why);
    body.appendChild(row);
  }
}

function popIn(el: HTMLElement) {
  if (fx.motionOn()) el.animate([{ opacity: 0, translate: "0 -6px" }, { opacity: 1, translate: "0 0" }], { duration: fx.ms(180), easing: "ease-out" });
}
function closePops() { closeStage(); closeTip(); closeRecord(); closeEmote(); }
// 點空白處、✕、Esc 都能收起來；收起來就回到原本的牌局
document.addEventListener("pointerdown", ev => {
  const t = ev.target as HTMLElement;
  if (stageOpen >= 0 && !t.closest("#stagePop, #phaseChip")) closeStage();
  if (!$("tipPop").hidden && !t.closest("#tipPop, .qbtn")) closeTip();
  if (!$("recordPop").hidden && !t.closest("#recordPop, #recordBtn")) closeRecord();
  if (!$("emotePop").hidden && !t.closest("#emotePop, #talkBtn")) closeEmote();
}, true);
document.addEventListener("keydown", ev => { if (ev.key === "Escape") closePops(); });
$("stagePop").querySelector("[data-pclose]")!.addEventListener("click", closeStage);
$("tipPop").querySelector("[data-tclose]")!.addEventListener("click", closeTip);
$("recordPop").querySelector("[data-rclose]")!.addEventListener("click", closeRecord);

// 手牌花色張數：只算你自己的手牌（你本來就知道的資訊）；變化時那個數字輕輕彈一下
function renderSuitCount() {
  const s = st!;
  const box = $("suitCount");
  if (!box.childElementCount) {
    for (const su of [3, 2, 1, 0]) {
      const sp = document.createElement("span");
      sp.className = `sc s${su}${su === 1 || su === 2 ? " red" : ""}`;
      sp.innerHTML = `<i>${SUIT_SYMBOL[su]}</i><b></b>`;
      box.appendChild(sp);
    }
  }
  const n = [0, 0, 0, 0];
  for (const c of s.hand) n[suitOf(c)]++;
  box.hidden = s.hand.length === 0;
  for (const sp of box.querySelectorAll<HTMLElement>(".sc")) {
    const su = Number(sp.className.match(/s(\d)/)![1]);
    const b = sp.querySelector("b")!;
    const v = String(n[su]);
    sp.classList.toggle("zero", n[su] === 0);
    if (b.textContent === v) continue;
    const had = b.textContent !== "";
    b.textContent = v;
    if (had && fx.motionOn()) {
      b.animate([{ scale: "1" }, { scale: "1.5" }, { scale: "1" }], { duration: fx.ms(300), easing: fx.EASE.spring });
      sp.classList.remove("hit"); void sp.offsetWidth; sp.classList.add("hit");
    }
  }
  box.setAttribute("aria-label", `你的手牌 ${s.hand.length} 張：黑桃 ${n[3]}、紅心 ${n[2]}、方塊 ${n[1]}、梅花 ${n[0]}`);
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
  if (paused()) { banner(`${oppName()}斷線了，牌局先暫停，等他回來再叫。`, 2400); sfx.deny(); return; }
  selBid = -1; selStrain = -1;
  setWaiting(true);
  if (!act({ t: "call", call })) setWaiting(false);
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
  const sub = $("bidHighSub");
  if (s.highestBid >= 0) {
    head.innerHTML = `現在最高：${contractHtml(s)}<small>（要贏 ${tricksNeeded(s.highestBid)} 墩）</small>`;
    sub.textContent = mine ? "換你：叫更高，或 Pass" : `等${oppName()}決定…`;
  } else {
    head.textContent = mine ? "換你叫牌" : `換${oppName()}想一下…`;
    sub.textContent = "";
  }
  sub.classList.toggle("me", mine);

  // 叫牌紀錄：一個一個蓋章
  const strip = $("auctionStrip");
  strip.hidden = !s.auctionCalls.length;
  if (!s.auctionCalls.length) { strip.replaceChildren(); auctionShown = 0; }
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
  if (cur < 0) return "<small>叫 N 線 = 要贏 N + 6 墩</small>";
  if (s.canRedouble) return `${opp}對你加倍了！確定再加倍？這局倍率會變成 4 倍。<br><small>再加倍 → ${declarerPreview(cur, 2)}</small>`;
  if (s.canDouble)
    return `${defenderPreview(cur, s.doubled, opp)}<br><small>確定加倍？這局輸贏都更刺激了：打成${opp}拿 ${madePoints(cur, 1)} 分，每倒 1 墩你拿 ${pointsPerUndertrick(1)} 分</small>`;
  return s.highestBidder === s.seat ? declarerPreview(cur, s.doubled) : defenderPreview(cur, s.doubled, opp);
}


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
// 結算單上阿禾的一句：整場結束（照分差和你開場說的話）／這局讓你逆轉／偶爾一句幹話
function resultQuip(s: TableState, r: HandResult, matchOver: boolean, iWon: boolean, margin: number): string {
  if (!conn?.solo) return "";
  brain.level = fx.settings.talk;
  const me = s.seat;
  causeEv = null;
  const log = (id: string, said: Said | null) => { if (said) aheLog.push({ id, text: said.text, cause: "result", me: r.scorer === me, extra: matchOver ? 1 : 0, value: margin, card: -1, hand: r.handNumber, deal: dealNo }); return said?.text ?? ""; };
  if (matchOver) { matchEndedWinner = s.matchWinner; return log(iWon ? "matchMe" : "matchAhe", brain.say(iWon ? "matchMe" : "matchAhe", { n: margin })); }
  const before = [s.myScore - (r.scorer === me ? r.points : 0), s.oppScore - (r.scorer === me ? 0 : r.points)];
  if (r.scorer === me && before[0] <= before[1] && s.myScore > s.oppScore) return log("reversal", brain.say("reversal", {}));
  if (Math.random() < 0.15) return log("nonsense", brain.say("nonsense", { aheAhead: s.oppScore > s.myScore, playerAhead: s.myScore > s.oppScore, aheLostLast: r.scorer === me }));
  return "";
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
  // 結算的提示放在結算單裡（不另外蓋一層）
  $("resCoach").hidden = !coachOnce("result");
  const title = $("resTitle");
  const margin = Math.abs(s.myScore - s.oppScore);
  title.textContent = matchOver ? matchTitle(iWon, margin, opp) : handTitle(r, me, opp);
  title.className = ((matchOver ? iWon : good) ? "" : "lose") + ([...title.textContent].length > 8 ? " long" : "");
  // 阿禾的一句話：只有跟阿禾打、整場打完才講（朋友連線時對面是真人）
  const quip = $("resQuip");
  const q = resultQuip(s, r, matchOver, iWon, margin);
  quip.hidden = !q;
  quip.textContent = q ? `阿禾：「${q}」` : "";
  void iDecl;
  $("rsContract").innerHTML = isRedBid(r.bidIndex) ? `<span class="red">${contractText(r.bidIndex, r.doubled)}</span>` : contractText(r.bidIndex, r.doubled);
  $("rsNeed").textContent = String(r.tricksNeeded);
  $("rsTaken").textContent = "";
  (($("resMore") as HTMLDetailsElement).open = false);     // 詳細計分預設收起來，想看再點開
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
  renderResStats();
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
  // 朋友連線、整場打完：兩個人都按「再來一場」才開新的一場（再按一次是取消）
  if (room && st && st.matchWinner >= 0) {
    b.disabled = true;
    if (!act({ t: "rematch", ready: !seats[mySeat]?.rematch }, () => { b.disabled = false; renderRematch(); })) b.disabled = false;
    return;
  }
  const label = b.textContent;
  b.disabled = true;
  b.textContent = "發牌中…";
  if (!act({ t: "next" })) { b.disabled = false; b.textContent = label; }
});
$("resHome").addEventListener("click", () => {
  resultSig.skip = true;
  // 朋友連線、整場已經打完：離開就讓出座位（戰績留在這桌）；還沒打完就幫你留著位子
  if (room && st && st.matchWinner >= 0) { leaveRoom("你離開了這桌。"); return; }
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
let quipTimer = 0, quipPri = 9, quipUntil = 0;
const handOnce = new Set<string>();     // 這一局只講一次的（連贏、快打成）
let oppStreak = 0;                      // 阿禾連續贏了幾墩
// 阿禾的嘴：台詞、條件、機率、冷卻、一場上限都在 ahe.ts；這裡只把「真的發生的事」交給它
const brain = new AheBrain(Math.random, () => performance.now(), { get: k => store.get(k), set: (k, v) => store.set(k, v) });
let matchEndedWinner = -1;              // 上一場誰贏（-1：還沒打完過）——「再來一場」時阿禾的反應
const scoreFacts = (): Facts => st ? { aheAhead: st.oppScore > st.myScore, playerAhead: st.myScore > st.oppScore } : {};
// 只有跟阿禾打才講（朋友連線時對面是真人）；同一時間只有一個泡泡，正在講重要的就不插嘴
// 驗收用：每一句是被哪個事件觸發的（測試拿來比對台詞跟真的牌局一致）
let causeEv: GameEvent | null = null;
const aheLog: { id: string; text: string; cause: string; me: boolean; extra: number; value: number; card: number; hand: number; deal: number }[] = [];
let dealNo = 0;                          // 第幾次發牌（重發也算）：驗收時用來算「一局講幾句」
(globalThis as unknown as { __hbAhe?: typeof aheLog }).__hbAhe = aheLog;
// 驗收用：看自己這一邊的牌桌與房間（只有自己看得到的東西）、模擬網路斷掉
Object.assign(globalThis, {
  __hbState: () => ({ st, room, seat: mySeat, screen, waiting }),
  __hbDrop: () => { if (conn instanceof Connection) conn.simulateDrop(); },
});
function ahe(id: string, f: Facts = {}, delay = 0): boolean {
  if (!conn?.solo) return false;
  brain.level = fx.settings.talk;
  const said = brain.say(id, f);
  if (!said) return false;
  const c = causeEv;
  aheLog.push({ id, text: said.text, cause: c?.type ?? "", me: !!c && c.seat === mySeat, extra: c?.extra ?? 0, value: c?.value ?? 0, card: c?.card ?? -1, hand: st?.handNumber ?? 0, deal: dealNo });
  if (aheLog.length > 300) aheLog.shift();
  showQuip(said, delay);
  return true;
}
function showQuip(said: Said, delay: number) {
  setTimeout(() => {
    if (!conn?.solo) return;
    const now = performance.now();
    if (now < quipUntil && said.pri > quipPri) return;
    const q = $("quip");
    q.innerHTML = `<span class="sr-only">阿禾：</span>${esc(said.text)}`;
    q.hidden = false;
    q.dataset.tone = String(said.tone);
    textIn(q, said.fx);
    emote($("oppArea").querySelector<HTMLElement>(".who"), $("oppStamp"), said.emo);
    const dur = Math.min(2600, Math.max(1500, 1100 + [...said.text].length * 70)) * (fx.settings.fast ? 0.8 : 1);
    quipPri = said.pri; quipUntil = now + dur;
    clearTimeout(quipTimer);
    quipTimer = window.setTimeout(() => { q.hidden = true; quipPri = 9; }, dur);
  }, fx.ms(delay));
}
function hideQuip() { clearTimeout(quipTimer); $("quip").hidden = true; quipPri = 9; quipUntil = 0; }

// ---------------- 回個話：五句短句（純社交：不影響牌局、AI、計分或同步） ----------------
const myEmotes: number[] = [];          // 我最近回話的時間（防洗版：間隔 2.5 秒、20 秒內最多 4 句）
let myQuipTimer = 0, talkTimer = 0;
for (const [i, e] of EMOTES.entries()) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = e.text; b.dataset.emote = e.key;
  b.addEventListener("click", () => sendEmote(i));
  $("emoteList").appendChild(b);
}
function openEmote() {
  closePops();
  const pop = $("emotePop"), opp = $("oppArea");
  pop.style.top = `${opp.offsetTop + opp.offsetHeight + 2}px`;
  pop.hidden = false;
  $("talkBtn").setAttribute("aria-expanded", "true");
  popIn(pop);
  sfx.select();
}
function closeEmote() { $("emotePop").hidden = true; $("talkBtn").setAttribute("aria-expanded", "false"); }
$("talkBtn").addEventListener("click", ev => { ev.stopPropagation(); if ($("emotePop").hidden) openEmote(); else closeEmote(); });
function sendEmote(i: number) {
  const now = Date.now();
  closeEmote();
  if (!emoteAllowed(myEmotes, now)) { fx.deny($("talkBtn")); return; }
  myEmotes.push(now);
  while (myEmotes.length > 8) myEmotes.shift();
  const e = EMOTES[i];
  showMyQuip(e.text);
  // 冷卻中：按鈕先變淡，避免連點
  const tb = $<HTMLButtonElement>("talkBtn");
  tb.disabled = true;
  clearTimeout(talkTimer);
  talkTimer = window.setTimeout(() => { tb.disabled = false; }, EMOTE_GAP_MS);
  if (conn?.solo) {
    // 阿禾照現在的局勢回你一句
    const last = trickLog.list.at(-1);
    causeEv = null;
    ahe(`emote:${e.key}`, { ...scoreFacts(), lastTrickAhe: !!last && last.winner !== mySeat }, 750);
  } else conn?.send({ t: "emote", i });
}
function showMyQuip(text: string) {
  const q = $("myQuip");
  q.innerHTML = `<span class="who">你</span>${esc(text)}`;
  q.hidden = false;
  textIn(q, "pop");
  clearTimeout(myQuipTimer);
  myQuipTimer = window.setTimeout(() => { q.hidden = true; }, fx.settings.fast ? 1700 : 2200);
}
function oppEmote(text: string) {
  const q = $("quip");
  q.innerHTML = `<b>${esc(oppName())}</b>：${esc(text)}`;
  q.hidden = false;
  q.dataset.tone = "1";
  textIn(q, "pop");
  clearTimeout(quipTimer);
  quipTimer = window.setTimeout(() => { q.hidden = true; }, 2200);
}

// 收一墩之後阿禾要不要講話：一墩最多一句，重要的先講
function trickQuip(e: GameEvent, s: TableState, im: Impact) {
  if (!conn?.solo) return;
  const winnerMe = e.seat === s.seat;
  const delay = 520;
  const facts: Facts = { ...scoreFacts(), aheLostLast: winnerMe, lastTrickAhe: !winnerMe };
  if (s.phase !== Phase.Play || s.declarer < 0) {
    // 搶牌：一般贏墩偶爾講；很少很少會冒一句幹話
    if (!ahe(winnerMe ? "trickMe" : "trickAhe", facts, delay) && Math.random() < 0.04) ahe("nonsense", facts, delay);
    return;
  }
  const ruff = e.extra === 1;
  if (ruff && winnerMe) brain.note("playerRuff");
  const iDecl = s.declarer === s.seat;
  const need = tricksNeeded(s.highestBid);
  const declBefore = iDecl ? s.myTricks : s.oppTricks;          // 狀態還沒更新：這墩之前
  const declAfter = declBefore + (e.seat === s.declarer ? 1 : 0);
  const defAfter = (iDecl ? s.oppTricks : s.myTricks) + (e.seat === s.declarer ? 0 : 1);
  const stillOpen = defAfter < 14 - need;                          // 防守方還沒把合約打倒
  const lastTrick = s.myTricks + s.oppTricks === 12;
  if (im.outcome === "made" || im.outcome === "set") {
    // 合約在這墩定案：還有墩數就講「達標／打不成了」（不提前結束）；最後一墩交給一局結束那一句
    if (!lastTrick) ahe(im.outcome === "made" ? "reached" : "setLocked", { iDecl }, delay);
    return;
  }
  if (im.kind === "pivot") { ahe(winnerMe ? "keyMe" : "keyAhe", facts, delay); return; }
  if (ruff) { ahe(winnerMe ? "ruffMe" : "ruffAhe", facts, delay); return; }
  if (stillOpen && need - declAfter === 1 && !handOnce.has("near")) { handOnce.add("near"); ahe("nearDecl", { iDecl }, delay); return; }
  if (winnerMe && streak >= 3 && !handOnce.has("streakMe")) { handOnce.add("streakMe"); ahe("streakMe", { n: streak }, delay); return; }
  if (!winnerMe && oppStreak >= 3 && !handOnce.has("streakOpp")) { handOnce.add("streakOpp"); ahe("streakAhe", { n: oppStreak }, delay); return; }
  // 一般贏墩：大多不講
  if (!ahe(winnerMe ? "trickMe" : "trickAhe", facts, delay) && Math.random() < 0.04) ahe("nonsense", facts, delay);
}


function onEvent(e: GameEvent) {
  causeEv = e;
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
      brain.newHand();
      dealNo++;
      if (e.value <= 1) {
        // 新的一場：阿禾的記憶清空（教學裡說的開場態度留著）
        const again = matchEndedWinner >= 0;
        brain.newMatch();
        ahe(again ? "rematch" : "matchStart", { aheLostLast: matchEndedWinner === mySeat }, 900);
        matchEndedWinner = -1;
      } else if (!(me ? ahe("nextHand", {}, 1100) : ahe("aheLeads", {}, 1100)) && Math.random() < 0.06) ahe("nonsense", scoreFacts(), 1400);
      break;

    case "CardPlayed":
      // Layer A：每一張牌都重重拍在桌上（王牌稍微重一點）。結果還沒確認，所以這裡不放「王吃」的大特效
      trickShow = null;
      flyPlayed(e);
      tick(e.extra === 1 ? `${who}出王牌 ${cardHtml(e.card)}` : `${who}出了 ${cardHtml(e.card)}`);
      break;

    case "TrickWon": {
      // Layer B：規則已經確認誰贏這墩，才依局勢決定衝擊等級；同一墩只演一次
      if (!st || !impactGate.once(trickKey(st))) break;
      recordTrick(e, st);
      if (st.phase === Phase.Play && st.myTricks + st.oppTricks === 0) {
        const w = nameOf(e.seat);
        coach("firstTrick", "第一墩結束", `${w}贏了這墩，所以下一墩由${w}先出。誰贏誰先出，不是固定輪流。`);
      }
      let im = evaluateTrick(e, st);
      // 連贏延續（你在後半場連贏到第 3 墩以上）：一般贏墩升一級演出，並寫出真正的原因
      if (im.tier === 1 && e.seat === mySeat && st.phase === Phase.Play && streak + 1 >= 3)
        im = { ...im, tier: 2, kind: "trick", label: `連贏 ${streak + 1} 墩`, crack: "none", hitstop: 40 };
      void collectTrick(e, im);
      trickQuip(e, st, im);
      break;
    }

    case "FaceUpTaken":
      takeFaceUp(e);
      sfx.faceUp(me);
      if (rankOf(e.card) >= 12) ahe(me ? "faceUpMe" : "faceUpAhe", scoreFacts(), 600);
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
      coach("bid", "搶牌結束，開始叫牌", "說出這局要贏幾墩：叫 N 線＝要贏 N＋6 墩，花色就是王牌。一方叫了、另一方 Pass，合約就定了。");
      fx.popup("牌搶完了，來叫牌！", $("phaseChip"), { size: 20, color: GOLD, flags: ["pop"], hold: 900, delay: 700 });
      setTimeout(() => sfx.stamp(), fx.ms(900));
      fx.buzz(20);
      break;

    case "BidMade": {
      // 叫牌逐級升溫：等級越高越重；雙方一直加碼，張力就一直疊上去
      const raise = !!st && st.highestBid >= 0;
      const tier = bidTier(bidLevel(e.value));
      // 阿禾的反應：你叫到 4 線以上（要贏 10 墩以上）才問你是不是很有把握；阿禾蓋過你的叫牌才說要叫高一點
      if (me && (bidLevel(e.value) >= 4 || (raise && st!.highestBidder !== st!.seat))) ahe("bidHighMe", {}, 700);
      else if (!me && raise && st!.highestBidder === st!.seat) ahe("bidRaiseAhe", {}, 500);
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
      // 加倍：紅色衝擊、低頻敲擊、短暫局部震動；桌緣進入升溫狀態（×2 徽章蓋章）
      emo.double();
      setTimeout(() => { refreshAura(); auraUpgrade(1, document.querySelector("#bidContract .mult, #keyInfo .mult")); }, fx.ms(520));
      if (me) { brain.note("playerDouble"); ahe("doubleMe", {}, 500); } else ahe("doubleAhe", {}, 500);
      fx.popup("加倍！", side, { size: 50, color: "#F08A96", flags: ["pop", "shake"], hold: 900 });
      doubleFx($(me ? "bidMeCard" : "bidOppCard"), $("felt"));
      fx.buzz([40, 30, 40]);
      break;

    case "Redoubled":
      // 再加倍：雙重衝擊波、金紅粒子、短促亮光、更重的音效；桌緣進入高壓狀態（×4 徽章蓋章）
      emo.redouble();
      setTimeout(() => { refreshAura(); auraUpgrade(2, document.querySelector("#bidContract .mult, #keyInfo .mult")); }, fx.ms(560));
      ahe(me ? "redoubleMe" : "redoubleAhe", {}, 600);
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
        void contractSlam(contractText(e.value, d), isRedBid(e.value), sub, d, $("felt"), $("keyInfo"));
      }, fx.ms(60));
      setTimeout(() => sfx.slide(), fx.ms(900));
      const trump = bidStrain(e.value);
      tick(`好，合約定了！${who}當莊家，要贏 ${tricksNeeded(e.value)} 墩${trump === Strain.NoTrump ? "（無王）" : `，${SUIT_SYMBOL[trump]} 是王牌`}`);
      {
        const t = bidStrain(e.value), first = nameOf(1 - e.seat);
        coach("contract", "合約成立", `${nameOf(e.seat)}當莊家，要贏 ${tricksNeeded(e.value)} 墩，${t === Strain.NoTrump ? "本局無王" : `${SUIT_SYMBOL[t]} 是王牌`}。第一墩由莊家的對手（${first}）先出。`);
      }
      ahe(me ? "contractMe" : "contractAhe", {}, 1600);
      break;
    }
    case "GameOver": {
      const made = e.value >= e.extra;
      const good = me === made;    // 我是莊家且打成，或對方是莊家且倒約
      // 失敗時不放羞辱或懲罰特效：字小一點、顏色柔和、不震
      const iDecl = e.seat === mySeat;
      const text = made ? (iDecl ? "打成！" : `${oppName()}打成`) : (iDecl ? `倒 ${e.extra - e.value} 墩` : "守住了！");
      fx.popup(text, centerAnchor(), { size: good ? 70 : 40, color: good ? GOLD : MUTED, flags: good ? ["pop", "wave"] : ["pop"], hold: 1500, delay: 650 });
      {
        // 阿禾對這一局的反應：誰當莊、打成沒、加倍是誰喊的、超／倒幾墩，全部照真的結果
        const d = st?.doubled ?? 0;
        const f: Facts = { doubled: d, byPlayer: !iDecl, under: Math.max(0, e.extra - e.value), over: Math.max(0, e.value - e.extra) };
        if (!iDecl) brain.note("aheHand", made);
        ahe(iDecl ? (made ? "madeMe" : "downMe") : (made ? "madeAhe" : "downAhe"), f, 1300);
      }
      const r0 = riskOf(st?.highestBid ?? -1, st?.doubled ?? 0);
      if (good) {
        // 蓄力（桌緣往中間收）→ 停頓 → 爆發 → 收斂到結算單
        setTimeout(() => auraConverge(), fx.ms(420));
        setTimeout(() => void emo.release(true, Math.max(r0, (st?.doubled ?? 0) > 0 ? 0.8 : r0), centerAnchor(), $("felt")), fx.ms(900));
        fx.buzz([30, 50, 30, 50, 120]);
      } else setTimeout(() => void emo.release(false, r0, centerAnchor(), $("felt")), fx.ms(700));
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
  refreshAura();
  // Layer B：依 Impact 等級演出（壓痕、裂痕、下沉、定格…），回傳要定格多久
  const hold = presentImpact(im, { felt, winner, loser, markers: [$("keyInfo")], streak: winnerMe ? streak : 0 });
  const hs = hold > 0 ? hold : 0;
  const msBase = (t: number) => (fx.motionOn() ? t : 0);
  if (winnerMe && streak >= 3) fx.popup(`連贏 ${streak} 墩`, myAnchor(), { size: 18 + Math.min(4, streak - 3) * 2, color: GOLD, flags: ["pop"], delay: 520 });
  if (!drawing) {
    const good = im.good;
    if (im.outcome) {
      // 合約定案（Tier 3／4）：重擊、定格。還沒打完：只說「合約已達標／倒約已確定」（之後的墩還會影響超墩和計分），
      // 完整的爆發留給整局結束（GameOver）——一局只爆一次
      const made = im.outcome === "made";
      const lastTrick = (st?.myTricks ?? 0) + (st?.oppTricks ?? 0) === 12;
      const declSide = made ? winnerMe : !winnerMe;    // 定案的是誰的合約
      const text = im.kind === "match" && good ? (im.comeback ? "逆轉！" : "決勝一墩！")
        : lastTrick ? "" : made ? (winnerMe ? "合約已達標！" : `${oppName()}的合約已達標`) : (winnerMe ? `${oppName()}倒約已確定` : "倒約已確定…");
      void declSide;
      const r0 = riskOf(st?.highestBid ?? -1, st?.doubled ?? 0);
      const power = im.tier === 4 ? Math.max(r0, 0.85) : r0;
      if (text) fx.popup(text, centerAnchor(), { size: good ? 34 + Math.round(power * 10) : 26, color: good ? GOLD : MUTED, flags: good ? ["pop", "wave"] : ["pop"], hold: 1100, delay: (good ? 380 : 240) + msBase(im.hitstop) });
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
  const inTable = isTable() && !!conn;
  $("menuTitle").textContent = inTable ? "選單" : "設定";
  $("leaveBtn").hidden = !inTable;
  $("restartSolo").hidden = !(inTable && conn?.solo);
  const live = inTable && !conn?.solo && (room?.status === "IN_GAME" || room?.status === "PAUSED");
  $("forfeitBtn").hidden = !live;
  // 同桌戰績（再來一場打第二場以後，選單裡看得到這兩個人到目前的戰績）
  const sl = inTable && !conn?.solo && room ? statsLine(room) : "";
  $("menuStats").hidden = !sl;
  $("menuStats").textContent = sl;
  $("leaveBtn").textContent = conn?.solo ? "回首頁" : live ? "暫時離開（位子留著）" : "離開這桌";
  openModal("menu");
}
$("menuBtn").addEventListener("click", openMenu);
function renderMute() {
  const b = $("muteBtn"), m = fx.settings.muted;
  b.classList.toggle("muted", m);
  b.setAttribute("aria-pressed", String(m));
  b.title = m ? "現在靜音（點一下打開聲音）" : "聲音開著（點一下靜音）";
}
$("muteBtn").addEventListener("click", () => { fx.settings.muted = !fx.settings.muted; fx.saveSettings(); renderMute(); sfx.toggle(!fx.settings.muted); });
renderMute();
$("leaveBtn").addEventListener("click", () => {
  // 朋友連線：先問一聲（位子會留著）；跟阿禾打會自動存檔，直接回首頁
  const live = !conn?.solo && (room?.status === "IN_GAME" || room?.status === "PAUSED");
  if (!conn?.solo && room && !live && room.status !== "WAITING" && room.status !== "READY") { leaveRoom("你離開了這桌。"); return; }   // 整場已經結束：直接讓座
  if (live && !confirm(`確定要暫時離開嗎？位子會幫你留著；不過${oppName()}在線上的話，${minutes(room!.timing.forfeit)}內沒回來，照規則這場算${oppName()}贏。`)) return;
  if (!conn?.solo && !live && !confirm("確定要離開這桌嗎？（位子會幫你留著）")) return;
  goHome(conn?.solo ? "這局幫你存好了，按「跟阿禾打」就能接著打。" : "位子幫你留著，到「找朋友玩」按「回到這桌」就能回去。");
});
// 認輸離開：先確認；伺服器判自己負（只算一次）→ 讓出座位 → 回首頁
$("forfeitBtn").addEventListener("click", () => {
  const opp = oppName();
  if (!confirm(`確定要認輸離開嗎？這場會算${opp}贏，戰績會記下來。`)) return;
  $("menu").hidden = true;
  act({ t: "leave", forfeit: true }, r => {
    if (r.ok || r.code === "BAD_STATE") leaveRoom(`你認輸了，這場算${opp}贏。`);
    else banner(r.msg, 2600);
  });
});
$("restartSolo").addEventListener("click", () => {
  if (!confirm("要重新開始嗎？這局進度不會保留。")) return;
  $("menu").hidden = true;
  if (conn instanceof LocalTable) conn.restart();     // 會發 NewHand：牌桌照新局的流程清空重畫
});
for (const m of ["menu", "rulesModal", "storyOffer", "homeMenu", "newsModal", "recap"]) {
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
attachAura($("felt"), $("actions"), $("oppArea"));
emo.onChange(p => $("bidPanel").style.setProperty("--tension", p.toFixed(2)));
{
  const params = new URLSearchParams(location.search);
  const room = normalizeCode(params.get("room") ?? "");
  const solo = params.get("solo");
  // 從教學最後的「開一場有提示的練習局」進來：對局提示打開、全部重新提示一次
  if (params.get("coach") === "1") { store.del(COACH_KEY); coachSeen = new Set(); fx.settings.coach = true; fx.saveSettings(); }
  if (solo === "new" || solo === "1") enterSolo(solo === "new");   // 故事最後的「自己跟電腦打一局」= new：重新發牌
  else if (isValidCode(room)) {
    codeInput.value = room;
    if (savedToken(room)) enter(room);          // 這支手機坐過這桌：直接回原座位（原本的暱稱）
    else void showInvite(room);                 // 邀請連結：房號帶好，只要填自己的暱稱
  }
  refreshResume();
  // 封面：標題、三顆按鈕、四張篇章卡依序淡入
  if (screen === "home") {
    fx.slideIn($("titleCard"), "up");
    Array.from(document.querySelectorAll("#home .cv-btn")).forEach((el, i) => fx.slideIn(el, "up", 90 + i * 70));
    Array.from(document.querySelectorAll("#home .cv-card")).forEach((el, i) => fx.slideIn(el, "up", 320 + i * 60));
  }
}
