// 梭了啦：手機牌桌（只畫伺服器給的 LSView；動作送給伺服器判斷，畫面不自己算規則）
// P2.5-A 五區：① 頂列（第幾墩、底注、轉播一行、選單）② 對手名牌 ③ 綠絨牌桌（雙方出牌位＋押的籌碼、本墩方向、疊池、上一墩）
//              ④ 我的名牌＋扇形手牌 ⑤ 行動列（一句問題＋一行小字＋按鈕；完整試算點 ?）
// 畫法：牌、出牌位、籌碼堆、按鈕都是「建一次、之後只改內容」的持久節點（P2.5-B／C 的動畫直接讓它們動）
// 隱藏資訊：對手的出牌位在翻牌前只畫牌背（手機上本來就收不到對手的牌）；我蓋的牌只有自己看得到小標；讀心結果只在自己畫面
// 梭哈一律顯示「每人押到多少」（雙方較少的籌碼），不讓人以為雙方都推出全部
import type { Action, LSEvent, LSView, TrickRecord } from "../laststand/engine";
import { CAT_LABEL, DIR_LABEL, RANK_TEXT, SUITS, TRICKS, catOf, flipDir, rankOf, suitOf } from "../laststand/rules";
import * as fx from "./fx";
import { mediaHold, mediaReset, mediaView } from "./lsmedia";
import type { Command, Reply } from "./solo";

export interface LSDeps {
  act(m: Command, done?: (r: Reply) => void): boolean;
  banner(text: string, ms?: number): void;
  oppName(): string;
  openMenu(): void;
  deny(): void;
}
let D: LSDeps;
let v: LSView | null = null;
let sel = -1;                 // 選好、還沒鎖的牌
let raiseTo = 0;              // 加注金額（每人總承諾）
let raiseOpen = false;        // 加注金額列展開中
let busy = false;             // 動作送出、等伺服器回覆
let holdUntil = 0;            // 整場結束：最後一墩結果先看一下再跳結算
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const lsHas = () => !!v;
// 驗收用：看自己這一邊的梭了啦牌桌（伺服器給的、只有自己看得到的部分）
Object.assign(globalThis, { __hbLS: () => v });
// 整場結束時的籌碼與墩數（結算面板用）
export const lsResult = () => (v?.result ? { stacks: v.stacks, trick: v.result.trick } : null);
export const lsHoldUntil = () => holdUntil;
export function lsReset() {
  v = null; sel = -1; busy = false; holdUntil = 0; raiseTo = 0; raiseOpen = false;
  handNodes.clear();
  $("lsHand").replaceChildren();
  for (const id of ["lsOppSlot", "lsMySlot"]) { const e = $(id); e.replaceChildren(); delete e.dataset.key; e.className = "lsslot"; }
  $("lsLogList").replaceChildren();
  $("lsLast").hidden = true;
  closePanels();
  mediaReset();
}

// ---------------- 固定的一組按鈕 ----------------
// data-a 名稱不變（測試、無障礙都靠它）；raiseopen／cancel 是 P2.5 新增的「展開／收起加注金額列」
// 順序＝畫面上的順序：主按鈕在前（面對加注：接戰、棄牌、反加、讀心；沒人加注：過牌、加注）
const MAIN = ["flip", "noflip", "safe", "nosafe", "lock", "call", "fold", "check", "raiseopen", "insight"] as const;
const RAISE = ["cancel", "minus", "raise", "plus", "max"] as const;
const BTN_CLASS: Record<string, string> = {
  flip: "btn wine", noflip: "btn paper", safe: "btn wine", nosafe: "btn paper", lock: "btn wine", check: "btn paper", raiseopen: "btn wine",
  call: "btn wine", fold: "btn paper", insight: "btn paper eye", cancel: "btn ghost cancel", minus: "step", raise: "btn wine", plus: "step", max: "btn paper max",
};
const B: Record<string, HTMLButtonElement> = {};
let rowMain: HTMLElement, rowRaise: HTMLElement;
function buildButtons() {
  const box = $("lsActions");
  rowMain = document.createElement("div"); rowMain.className = "lsbtns";
  rowRaise = document.createElement("div"); rowRaise.className = "lsraise";
  for (const [row, names] of [[rowMain, MAIN], [rowRaise, RAISE]] as const) for (const a of names) {
    const b = document.createElement("button");
    b.type = "button"; b.className = BTN_CLASS[a]; b.dataset.a = a; b.hidden = true;
    if (a === "minus") { b.textContent = "−"; b.setAttribute("aria-label", "少押一枚"); }
    if (a === "plus") { b.textContent = "＋"; b.setAttribute("aria-label", "多押一枚"); }
    B[a] = b; row.appendChild(b);
  }
  box.replaceChildren(rowMain, rowRaise);
}
// 顯示／隱藏、改字（字一樣就不動，按鈕不會閃）
function show(a: string, on: boolean, label?: string, disabled = false) {
  const b = B[a];
  b.hidden = !on;
  if (!on) return;
  if (label !== undefined && b.dataset.lbl !== label) { b.innerHTML = label; b.dataset.lbl = label; }
  b.disabled = disabled;
}

export function lsInit(deps: LSDeps) {
  // 規則提示條出現時，轉播字幕先讓位
  D = { ...deps, banner: (text, ms) => { deps.banner(text, ms); mediaHold(ms ?? 2600); } };
  buildButtons();
  $("lsMenuBtn").addEventListener("click", () => D.openMenu());
  $("lsHand").addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".lscard");
    if (!b || b.disabled || !v) return;
    sel = Number(b.dataset.id);
    render();
  });
  $("lsActions").addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
    if (!b || b.disabled || !v || busy) return;
    const a = b.dataset.a!;
    const L = v.legal;
    if (a === "raiseopen") { if (L.raise) { raiseOpen = true; raiseTo = Math.max(L.raise[0], Math.min(L.raise[1], raiseTo || L.raise[0])); } return render(); }
    if (a === "cancel") { raiseOpen = false; return render(); }
    if (a === "minus" || a === "plus") {
      if (!L.raise) return;
      raiseTo = Math.max(L.raise[0], Math.min(L.raise[1], raiseTo + (a === "plus" ? 1 : -1)));
      return render();
    }
    if (a === "max" && L.raise) { raiseTo = L.raise[1]; return render(); }
    const action: Action | null =
      a === "flip" ? { t: "flip", flip: true } : a === "noflip" ? { t: "flip", flip: false } :
      a === "safe" ? { t: "safeguard", use: true } : a === "nosafe" ? { t: "safeguard", use: false } :
      a === "lock" ? (sel >= 0 ? { t: "lock", card: sel } : null) :
      a === "check" ? { t: "check" } : a === "call" ? { t: "call" } : a === "fold" ? { t: "fold" } :
      a === "insight" ? { t: "insight" } : a === "raise" ? { t: "raise", to: raiseTo } : null;
    if (action) send(action);
  });
  $("lsLast").addEventListener("click", () => openPanel("lsLogPanel"));
  $("lsHelpBtn").addEventListener("click", () => { if (v) $("lsHelpBody").innerHTML = helpHtml(D.oppName()); openPanel("lsHelpPanel"); });
  for (const id of ["lsLogPanel", "lsHelpPanel"]) {
    const m = $(id);
    m.addEventListener("click", ev => { if (ev.target === m || (ev.target as HTMLElement).closest("[data-close]")) m.hidden = true; });
  }
}
function openPanel(id: string) { if (v) $(id).hidden = false; }
const closePanels = () => { for (const id of ["lsLogPanel", "lsHelpPanel"]) $(id).hidden = true; };

function send(a: Action) {
  busy = true;
  render();
  const sent = D.act({ t: "ls", a }, r => {
    busy = false;
    if (!r.ok && r.code !== "STALE") { D.banner(r.msg, 2600); D.deny(); }
    render();
  });
  if (!sent) { busy = false; render(); }
}

// 伺服器送來的新牌桌（resync＝斷線回來整份重送：轉播不補播舊新聞）
export function lsView(view: LSView, resync = false) {
  const prevKey = v ? `${v.trick}:${v.phase}:${v.steps.length}:${v.toAct}` : "";
  v = view;
  busy = false;
  if (v.phase !== "lock" || v.myLock >= 0 || !v.hand.includes(sel)) sel = -1;
  const L = v.legal;
  if (L.raise) raiseTo = Math.max(L.raise[0], Math.min(L.raise[1], raiseTo || L.raise[0]));
  else raiseTo = 0;
  // 輪到別的決定了：加注金額列收起來
  if (!L.raise || prevKey !== `${v.trick}:${v.phase}:${v.steps.length}:${v.toAct}`) raiseOpen = false;
  render();
  mediaView(view, resync);
}

// 對手做了什麼：短短提示一下（輪到誰、多少錢都在畫面上）
export function lsEvent(e: LSEvent) {
  if (!v) return;
  const me = v.seat, opp = D.oppName();
  const who = (s: number) => (s === me ? "你" : opp);
  switch (e.type) {
    case "Flip": if (e.seat !== me) D.banner(`${opp}翻轉了方向：這一墩改成${DIR_LABEL[e.dir!]}`, 2400); break;
    case "Safeguard": D.banner(`${who(e.seat)}宣告保命：這一墩每人只押 1 枚、不能加注`, 2600); break;
    case "Insight": if (e.seat !== me) D.banner(`${opp}用了讀心（只看得到你蓋的是大、中還是小）`, 2600); break;
    case "Raise": if (e.seat !== me && e.allIn) D.banner(`${opp}梭哈：每人押到 ${e.to} 枚`, 2600); break;
    case "PoolRefund": D.banner(`疊池退款：你拿回 ${e.refund![me]} 枚、${opp}拿回 ${e.refund![1 - me]} 枚`, 2800); break;
    case "Eliminated": D.banner(`${who(e.seat)}的籌碼歸零`, 2600); break;
    case "MatchOver": holdUntil = Date.now() + 2600; closePanels(); break;     // 結算面板要出來了：牌桌上的面板先收
  }
}

// ---------------- 畫面 ----------------
const role = (s: number) => (v && s === v.declarer ? "宣戰權" : "下注先手");
const pipsHtml = (c: [number, number, number]) => `大<b>${c[2]}</b>中<b>${c[1]}</b>小<b>${c[0]}</b>`;
function skills(el: HTMLElement, s: number) {
  const k = `${+v!.flipUsed[s]}${+v!.safeUsed[s]}${+v!.insightUsed[s]}`;
  if (el.dataset.k === k) return;
  el.dataset.k = k;
  const i = (used: boolean, t: string, name: string) => `<i class="${used ? "used" : ""}" title="${name}${used ? "（用過了）" : "（還能用）"}">${t}</i>`;
  el.innerHTML = i(v!.flipUsed[s], "翻", "翻轉") + i(v!.safeUsed[s], "保", "保命") + i(v!.insightUsed[s], "讀", "讀心");
  el.setAttribute("aria-label", `技能：翻轉${v!.flipUsed[s] ? "已用" : "可用"}、保命${v!.safeUsed[s] ? "已用" : "可用"}、讀心${v!.insightUsed[s] ? "已用" : "可用"}`);
}
// 籌碼堆：最多畫 8 枚（數字照實寫在旁邊）
function stack(el: Element, n: number) {
  const want = Math.max(0, Math.min(8, n));
  if (el.childElementCount === want) return;
  el.replaceChildren(...Array.from({ length: want }, (_, i) => { const c = document.createElement("i"); c.className = "lschip"; c.style.bottom = `${i * 3}px`; return c; }));
}

function render() {
  if (!v) return;
  const me = v.seat, op = 1 - me, opp = D.oppName(), pool = v.pool[0] + v.pool[1];
  // ① 頂列
  $("lsTrick").textContent = v.result ? "比賽結束" : `第 ${v.trick}／${TRICKS} 墩`;
  $("lsStage").textContent = v.result ? "" : v.safeguard >= 0 ? "保命墩・每人 1 枚" : `底注 ${v.ante}・${v.allInStage ? "可梭哈" : `上限 ${v.cap}`}`;
  $("lsBadge").textContent = (!$("lsTestTag").hidden ? "測試・" : "") + (v.result ? "終" : `${v.trick}/${TRICKS}`);
  // ② 對手名牌
  $("lsOppName").textContent = opp;
  $("lsOppSeal").textContent = [...opp][0] ?? "";
  $("lsOppTag").textContent = role(op);
  $("lsOppStatus").textContent = oppStatus();
  $("lsOppChips").textContent = String(v.stacks[op]);
  const left = v.counts[op].reduce((a, b) => a + b, 0), inHand = left - (v.locked[op] ? 1 : 0);
  const backs = $("lsOppBacks");
  if (backs.childElementCount !== inHand) backs.replaceChildren(...Array.from({ length: inHand }, () => fx.backEl()));
  $("lsOppCounts").innerHTML = pipsHtml(v.counts[op]);
  $("lsOppCounts").title = `${opp}還沒用掉的牌（含桌上蓋著的）`;
  skills($("lsOppSkills"), op);
  // ③ 牌桌
  renderFelt(opp, pool);
  // 我的名牌
  $("lsMyTag").textContent = role(me);
  $("lsMyChips").textContent = String(v.stacks[me]);
  skills($("lsMySkills"), me);
  // ④ 手牌 ⑤ 行動列
  renderHand();
  renderAsk(opp, pool);
  renderActions();
  renderLog(opp);
}

function oppStatus(): string {
  const s = v!, op = 1 - s.seat;
  if (s.result) return "";
  if (s.phase === "flip" && s.toAct === op) return "想翻轉嗎…";
  if (s.phase === "safeguard" && s.toAct === op) return "想保命嗎…";
  if (s.phase === "lock") return s.locked[op] ? "已蓋牌" : "選牌中…";
  if (s.phase === "bet") {
    const last = [...s.steps].reverse().find(x => x.seat === op);
    if (last) return last.act === "check" ? "過牌" : last.act === "raise" ? `${last.reraise ? "反加" : "加注"}到 ${last.to}${last.allIn ? "（梭哈）" : ""}` : last.act === "call" ? "接戰" : "";
    return s.toAct === op ? "思考中…" : "";
  }
  return "";
}

// 上一墩要不要攤在桌上：新的一墩還沒有人蓋牌之前（或整場結束），兩個出牌位翻開上一墩的牌
function revealing(): TrickRecord | null {
  const s = v!, r = s.history.at(-1);
  if (!r) return null;
  if (s.result) return r;
  return !s.locked[0] && !s.locked[1] && s.phase !== "bet" ? r : null;
}

function renderFelt(opp: string, pool: number) {
  const s = v!, me = s.seat, op = 1 - me, r = revealing();
  // 出牌位
  const mySlot = $("lsMySlot"), oppSlot = $("lsOppSlot");
  if (r) {
    const won = r.winner === me, lost = r.winner === op;
    if (r.cards) {
      setSlot(mySlot, `face:${r.cards[me]}`, () => [fx.cardEl(r.cards![me])], won ? "win" : lost ? "lose" : "");
      setSlot(oppSlot, `face:${r.cards[op]}`, () => [fx.cardEl(r.cards![op])], lost ? "win" : won ? "lose" : "");
    } else {
      const cat = (c: number) => () => { const d = document.createElement("div"); d.className = "lscat"; d.textContent = CAT_LABEL[c]; return [d]; };
      setSlot(mySlot, `cat:${r.cats[me]}`, cat(r.cats[me]), won ? "win" : lost ? "lose" : "");
      setSlot(oppSlot, `cat:${r.cats[op]}`, cat(r.cats[op]), lost ? "win" : won ? "lose" : "");
    }
  } else {
    // 我的：蓋了 → 牌背＋只有自己看得到的小標；該我蓋 → 虛線框亮起
    if (s.myLock >= 0) setSlot(mySlot, `back:${s.myLock}`, () => [fx.backEl(), peek(s.myLock)]);
    else if (s.phase === "lock") setSlot(mySlot, "empty:ask", () => [lbl("蓋牌區")], "empty ask");
    else setSlot(mySlot, "empty", () => [], "empty");
    // 對手的：翻牌前只畫牌背；讀心看到的分類只在自己畫面
    const ins = s.insight >= 0 ? s.insight : -1;
    if (s.locked[op]) setSlot(oppSlot, `back:${ins}`, () => [fx.backEl(), ...(ins >= 0 ? [insightTag(ins)] : [])]);
    else if (s.phase === "lock") setSlot(oppSlot, "empty:wait", () => [lbl("選牌中")], "empty");
    else setSlot(oppSlot, "empty", () => [], "empty");
  }
  // 押的籌碼（本墩承諾）
  for (const [seat, bet] of [[me, "lsMyBet"], [op, "lsOppBet"]] as const) {
    const n = s.commit[seat], el = $(bet);
    stack(el.querySelector(".lsstack")!, n);
    el.classList.toggle("zero", !n);
  }
  $("lsMyCommit").textContent = String(s.commit[me]);
  $("lsOppCommit").textContent = String(s.commit[op]);
  $("lsOppCommitWho").textContent = `${opp}押`;
  // 方向
  const big = $("lsDirBig");
  big.textContent = DIR_LABEL[s.dir];
  big.classList.toggle("low", s.dir === "low");
  big.classList.toggle("flipped", s.flippedBy >= 0);
  $("lsDir").classList.toggle("canflip", s.legal.flip);
  $("lsDirNote").textContent = s.result ? "" : s.nextDir ? `下一墩 ${DIR_LABEL[s.nextDir]}` : "最後一墩";
  // 疊池
  const pl = $("lsPool");
  pl.hidden = !pool;
  if (pool) { stack(pl.querySelector(".lsstack")!, pool); $("lsPoolText").textContent = `疊池 ${pool}${s.safeguardBlocked ? "・不能保命" : ""}`; }
  // 上一墩（點了看每墩紀錄）
  const last = s.history.at(-1), lb = $("lsLast");
  lb.hidden = !last;
  if (last) {
    const html = `${r ? `第 ${last.trick} 墩` : "上一墩"}：${shortResult(last, opp)}`;
    if (lb.dataset.h !== html) { lb.innerHTML = html; lb.dataset.h = html; }
    lb.classList.toggle("hot", !!r);
    lb.setAttribute("aria-label", `${lb.textContent}。點一下看每墩紀錄`);
  }
}
// 牌面寫法跟牌上印的一樣：點數在前、花色在後（Q♠）
const face = (id: number) => `${RANK_TEXT[rankOf(id)] ?? rankOf(id)}${SUITS[suitOf(id)]}`;
const lbl = (t: string) => { const e = document.createElement("span"); e.className = "lbl"; e.textContent = t; return e; };
function peek(id: number) { const e = document.createElement("span"); e.className = "lspeek" + (id >= 13 && id < 39 ? " red" : ""); e.textContent = face(id); e.title = "你蓋的牌（只有你看得到）"; return e; }
function insightTag(c: number) { const e = document.createElement("span"); e.className = "lsinsight"; e.textContent = `讀心：${CAT_LABEL[c]}`; return e; }
// 出牌位：內容沒變就不重畫（之後的動畫靠這個判斷「換牌了」）
function setSlot(el: HTMLElement, key: string, make: () => Node[], cls = "") {
  el.className = `lsslot ${cls}`.trim();
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...make());
}
function shortResult(r: TrickRecord, opp: string): string {
  const me = v!.seat, o = esc(opp), pool = r.poolTaken ? `＋疊池 ${r.poolTaken}` : "";
  if (r.outcome === "tie") return `同點，各 ${r.poolAdded[me]} 枚進疊池`;
  if (r.outcome === "fold") return r.folder === me ? `你棄牌 <b class="lose">−${r.transfer}</b>` : `${o}棄牌，你 <b class="win">+${r.transfer}${pool}</b>`;
  return r.winner === me ? `你贏 <b class="win">+${r.transfer}${pool}</b>` : `${o}贏，你 <b class="lose">−${r.transfer}</b>`;
}

// ④ 手牌：每張牌一個節點（用牌當 key）；蓋到桌上的那張不在手牌裡
const handNodes = new Map<number, HTMLButtonElement>();
function renderHand() {
  const s = v!, box = $("lsHand");
  const cards = s.hand.filter(id => id !== s.myLock);
  const canPick = s.phase === "lock" && s.myLock < 0 && !busy && !s.result;
  for (const [id, el] of handNodes) if (!cards.includes(id)) { el.remove(); handNodes.delete(id); }
  cards.forEach((id, i) => {
    let b = handNodes.get(id);
    if (!b) {
      b = document.createElement("button");
      b.type = "button"; b.className = "lscard"; b.dataset.id = String(id);
      b.setAttribute("role", "option");
      b.setAttribute("aria-label", `${face(id)}（${CAT_LABEL[catOf(id)]}）`);
      b.appendChild(fx.cardEl(id));
      handNodes.set(id, b);
    }
    b.classList.toggle("sel", id === sel);
    b.setAttribute("aria-selected", String(id === sel));
    b.disabled = !canPick;
    if (box.children[i] !== b) box.insertBefore(b, box.children[i] ?? null);
  });
  box.classList.toggle("wait", s.phase === "lock" && s.myLock >= 0 && !s.result);
}

// ⑤ 一句問題＋一行小字
function renderAsk(opp: string, pool: number) {
  const s = v!, me = s.seat, L = s.legal, o = esc(opp);
  const poolTxt = pool ? `（＋疊池 ${pool}）` : "";
  const theirs = s.commit[1 - me], mine = s.commit[me];
  let q = "", sm = "", mineTurn = false;
  if (s.result) {
    const w = s.result.winner;
    q = w < 0 ? `平手（各 ${s.stacks[me]} 枚）` : w === me ? `你贏了這場（${s.stacks[me]}：${s.stacks[1 - me]}）` : `${opp}贏了這場（${s.stacks[1 - me]}：${s.stacks[me]}）`;
  } else if (busy) q = "送出中…";
  else switch (s.phase) {
    case "flip":
      if (L.flip) { mineTurn = true; q = `你有宣戰權：這墩${DIR_LABEL[s.dir]}，要翻成${DIR_LABEL[flipDir(s.dir)]}嗎？`; sm = "翻轉只改這一墩，每場一次。"; }
      else q = `${opp}在決定要不要翻轉方向…`;
      break;
    case "safeguard":
      if (L.safeguard) { mineTurn = true; q = "要用保命嗎？"; sm = "這墩每人只押 1 枚、不能加注；每場一次。"; }
      else q = `${opp}在決定要不要用保命…`;
      break;
    case "lock":
      if (s.myLock < 0) { mineTurn = true; q = "選一張牌蓋到桌上"; sm = `${DIR_LABEL[s.dir]}：${s.dir === "high" ? "點數越大越好" : "點數越小越好"}。蓋了就不能換${s.locked[1 - me] ? `；${o}已經蓋好了` : ""}。`; }
      else q = `等${opp}蓋牌…`;
      break;
    case "bet":
      if (s.toAct !== me) { q = `等${opp}回應…`; break; }
      mineTurn = true;
      if (raiseOpen && L.raise) {
        const x = raiseTo, allIn = s.allInStage && x === L.raise[1];
        q = allIn ? `梭哈：每人押到 ${x}` : `${L.call ? "反加" : "加注"}到 ${x}？`;
        sm = `${o}接戰：翻牌贏 <b>+${x}</b>${poolTxt}、輸 <b>−${x}</b>；${o}棄牌：你 <b>+${theirs}</b>${poolTxt}`;
      } else if (theirs > mine) {
        q = `${opp}${s.steps.filter(x => x.act === "raise").length >= 2 ? "反加" : "加注"}到 ${theirs}，你要跟嗎？`;
        sm = `接戰：翻牌${DIR_LABEL[s.dir]}，贏 <b>+${theirs}</b>、輸 <b>−${theirs}</b>${poolTxt}`;
      } else {
        q = s.steps.some(x => x.act === "check") ? `${opp}過牌。要加注嗎？` : "要加注嗎？";
        sm = `現在每人押 ${mine}：翻牌贏 <b>+${theirs}</b>、輸 <b>−${mine}</b>${poolTxt}`;
      }
      if (s.insight >= 0 && !raiseOpen) sm += `${sm ? "；" : ""}讀心：${o}蓋的是「${CAT_LABEL[s.insight]}」`;
      break;
  }
  const t = $("lsTurn");
  t.textContent = q;
  t.classList.toggle("mine", mineTurn);
  $("lsAsk").classList.toggle("mine", mineTurn);
  const r = $("lsRisk");
  if (r.dataset.h !== sm) { r.innerHTML = sm; r.dataset.h = sm; }
}

// ⑤ 按鈕：固定一組，依階段顯示（一次最多 4 顆；加注展開成金額列）
function renderActions() {
  const s = v!, me = s.seat, L = s.legal;
  for (const a of [...MAIN, ...RAISE]) B[a].hidden = true;
  let mainOn = false, raiseOn = false;
  if (!s.result && !busy) {
    if (L.flip) {
      show("flip", true, `翻成${DIR_LABEL[flipDir(s.dir)]}`); show("noflip", true, `照${DIR_LABEL[s.dir]}`); mainOn = true;
    } else if (L.safeguard) {
      show("safe", true, "用保命<small>這墩只押 1</small>"); show("nosafe", true, "不用"); mainOn = true;
    } else if (L.lock.length) {
      show("lock", true, sel >= 0 ? `蓋牌（${face(sel)}）` : "先點一張牌", sel < 0); mainOn = true;
    } else if (s.phase === "bet" && s.toAct === me) {
      const theirs = s.commit[1 - me], mine = s.commit[me];
      if (raiseOpen && L.raise) {
        const [lo, hi] = L.raise, x = raiseTo, allIn = s.allInStage && x === hi;
        show("cancel", true, "取消");
        show("minus", true, undefined, x <= lo);
        show("raise", true, allIn ? `梭哈<small>每人押 ${x}</small>` : `${L.call ? "反加到" : "加注到"} ${x}`);
        B.raise.classList.toggle("allin", allIn);
        show("plus", true, undefined, x >= hi);
        if (s.allInStage && x !== hi) show("max", true, "梭哈");
        raiseOn = true;
      } else {
        if (L.check) show("check", true, "過牌<small>直接翻牌</small>");
        if (L.call) show("call", true, `接戰<small>補 ${theirs - mine}</small>`);
        if (L.fold) show("fold", true, `棄牌<small>輸 ${mine}</small>`);
        if (L.raise) show("raiseopen", true, `${L.call ? "反加" : "加注"}<small>到 ${L.raise[0]}${L.raise[1] > L.raise[0] ? `～${L.raise[1]}` : ""}</small>`);
        B.raiseopen.className = L.call ? "btn paper" : "btn wine";
        if (L.insight) show("insight", true, "讀心");
        mainOn = true;
      }
    }
  }
  rowMain.hidden = !mainOn;
  rowRaise.hidden = !raiseOn;
}

// 完整試算與規則（點 ?）
function helpHtml(opp: string): string {
  const s = v!, me = s.seat, op = 1 - me, o = esc(opp), pool = s.pool[0] + s.pool[1];
  const poolTxt = pool ? `（＋疊池 ${pool}）` : "";
  let h = "";
  if (s.phase === "bet") {
    const mine = s.commit[me], theirs = s.commit[op];
    h = theirs > mine
      ? `<p>若<b>接戰</b>（補 ${theirs - mine}）：翻牌贏 <b>+${theirs}</b>${poolTxt}／輸 <b>−${theirs}</b></p><p>若<b>棄牌</b>：<b>−${mine}</b>（${o}多押的 ${theirs - mine} 枚退回給${o}）</p>`
      : `<p>目前每人押 <b>${mine}</b> 枚：翻牌贏 <b>+${theirs}</b>${poolTxt}／輸 <b>−${mine}</b></p>`;
  } else if (!s.result) {
    const stake = s.safeguard >= 0 ? 1 : s.ante, cap = s.safeguard >= 0 ? 1 : s.cap;
    h = `<p>本墩底注 <b>${stake}</b> 枚（雙方都押），每人最多押到 <b>${cap}</b> 枚。</p>`;
  }
  if (s.allInStage && s.safeguard < 0 && s.cap > s.ante) h += `<p class="allin">梭哈＝每人押到 ${s.cap} 枚（雙方較少的籌碼），不是各自把全部推出去。</p>`;
  if (pool) h += `<p>疊池 ${pool} 枚（你出 ${s.pool[me]}・${o}出 ${s.pool[op]}）：下一個翻牌贏、或讓對方棄牌的人拿走${s.safeguardBlocked ? "；有疊池，這一墩不能保命" : ""}。</p>`;
  h += `<ul><li>這墩${DIR_LABEL[s.dir]}：${s.dir === "high" ? "點數大的贏" : "點數小的贏"}；同點進疊池。</li><li>牌型：大＝J～A、中＝7～10、小＝2～6（讀心只看得到這個）。</li>
    <li>宣戰權：每場一次，把這一墩的方向翻過來。保命：每場一次，這一墩每人只押 1 枚。讀心：每場一次，對方加注後看對方蓋的是大中小。</li></ul>`;
  return h;
}

function renderLog(opp: string) {
  const s = v!, me = s.seat, list = $("lsLogList");
  if (list.childElementCount === s.history.length) return;
  list.replaceChildren(...s.history.map(r => {
    const li = document.createElement("li");
    const tags = [r.flippedBy >= 0 ? "翻轉" : "", r.safeguardBy >= 0 ? "保命" : "", r.allIn >= 0 ? "梭哈" : ""].filter(Boolean).join("・");
    const cards = r.cards ? `：你 ${face(r.cards[me])}・${esc(opp)} ${face(r.cards[1 - me])}` : `：你「${CAT_LABEL[r.cats[me]]}」・${esc(opp)}「${CAT_LABEL[r.cats[1 - me]]}」（棄牌只公開大中小）`;
    li.innerHTML = `<b>第 ${r.trick} 墩 ${DIR_LABEL[r.dir]}</b>${tags ? `（${tags}）` : ""}${cards}　${shortResult(r, opp)}${r.refund ? `；疊池退款` : ""}　<small>${r.stacksAfter[me]}：${r.stacksAfter[1 - me]}</small>`;
    return li;
  }));
}
