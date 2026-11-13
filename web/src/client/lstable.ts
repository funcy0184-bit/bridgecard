// 梭了啦：手機牌桌（只畫伺服器給的 LSView；動作送給伺服器判斷，畫面不自己算規則）
// P2.5-A 五區：① 頂列（第幾墩、底注、轉播一行、選單）② 對手名牌 ③ 綠絨牌桌（雙方出牌位＋押的籌碼、本墩方向、疊池、上一墩）
//              ④ 我的名牌＋扇形手牌 ⑤ 行動列（一句問題＋一行小字＋按鈕；完整試算點 ?）
// 畫法：牌、出牌位、籌碼堆、按鈕都是「建一次、之後只改內容」的持久節點（P2.5-B／C 的動畫直接讓它們動）
// 隱藏資訊：對手的出牌位在翻牌前只畫牌背（手機上本來就收不到對手的牌）；我蓋的牌只有自己看得到小標；讀心結果只在自己畫面
// 梭哈一律顯示「每人押到多少」（雙方較少的籌碼），不讓人以為雙方都推出全部
import type { Action, LSEvent, LSView, TrickRecord } from "../laststand/engine";
import { CAT_LABEL, DIR_LABEL, RANK_TEXT, SUITS, TRICKS, allInStage, catOf, flipDir, rankOf, suitOf } from "../laststand/rules";
import * as fx from "./fx";
import { betChips, domAnims, insightScan } from "./lsanim";
import { mediaHold, mediaReset, mediaView } from "./lsmedia";
import { TableStage } from "./lsstage";
import { sfx } from "./sound";
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
// 一墩的生命週期：結算 → 翻牌 → 判勝負 → 看結果 → 收牌 → 清桌 → 下一墩
//   P2.5-A 定下流程（展示用剛存進紀錄的那一墩，因為伺服器一結算就送「下一墩」的牌桌）；
//   P2.5-B 起由牌桌演出導演（lsstage）決定什麼時候換畫面：只有一條佇列、一個取消鍵，沒有另外的展示計時器；
//   重新整理、斷線回來不重播；點牌桌可以略過
const stage = new TableStage(domAnims({ render: () => render(), seat: () => v?.seat ?? 0, handNode: id => handNodes.get(id) }));
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const lsHas = () => !!v;
// 驗收用：看自己這一邊的梭了啦牌桌（伺服器給的、只有自己看得到的部分）
Object.assign(globalThis, { __hbLS: () => v, __hbLSStage: () => stage.info(), __hbLSIdle: () => stage.idle() });
// 整場結束時的籌碼與墩數（結算面板用）
export const lsResult = () => (v?.result ? { stacks: v.stacks, trick: v.result.trick } : null);
export const lsHoldUntil = () => holdUntil;
export function lsReset() {
  v = null; sel = -1; busy = false; holdUntil = 0; raiseTo = 0; raiseOpen = false;
  stage.cancelAll();
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
  // B2：按住手牌往上拖到牌桌放開＝蓋這張（拖的時候牌跟著手指）；沒拖過門檻就彈回去、當成一般的點選
  const hand = $("lsHand");
  let drag: { b: HTMLButtonElement; id: number; x: number; y: number; pid: number; moved: boolean } | null = null, swallow = false;
  hand.addEventListener("pointerdown", ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".lscard");
    if (!b || b.disabled || !v || busy || !v.legal.lock.length) return;
    drag = { b, id: Number(b.dataset.id), x: ev.clientX, y: ev.clientY, pid: ev.pointerId, moved: false };
  });
  hand.addEventListener("pointermove", ev => {
    if (!drag || ev.pointerId !== drag.pid) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && dy > -10) return;
    if (!drag.moved) { drag.moved = true; try { drag.b.setPointerCapture(drag.pid); } catch { /* 沒關係 */ } drag.b.classList.add("drag"); if (sel !== drag.id) { sel = drag.id; sfx.lift(); render(); } }
    drag.b.style.translate = `${dx}px ${Math.min(0, dy)}px`;
    drag.b.classList.toggle("armed", ev.clientY < $("lsFelt").getBoundingClientRect().bottom + 6);
  });
  const endDrag = (ev: PointerEvent, cancel: boolean) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    swallow = true; setTimeout(() => { swallow = false; }, 0);
    const armed = !cancel && d.b.classList.contains("armed");
    d.b.classList.remove("drag", "armed");
    if (armed && v && !busy && v.legal.lock.includes(d.id)) {
      // 從手指放開的位置直接飛上桌（演出導演量的是這張牌現在的位置）
      stage.myLock(d.id);
      d.b.style.translate = "";
      send({ t: "lock", card: d.id });
    } else d.b.style.translate = "";
  };
  hand.addEventListener("pointerup", ev => endDrag(ev, false));
  hand.addEventListener("pointercancel", ev => endDrag(ev, true));
  hand.addEventListener("click", ev => {
    if (swallow) { ev.preventDefault(); return; }
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".lscard");
    if (!b || b.disabled || !v) return;
    const id = Number(b.dataset.id);
    if (id !== sel) sfx.lift();
    sel = id;
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
    if (!action) return;
    // 蓋牌：按下那一幀就開始飛（伺服器確認前停在出牌位；被拒絕就飛回手牌）
    if (action.t === "lock") stage.myLock(action.card);
    send(action);
  });
  $("lsLast").addEventListener("click", ev => { ev.stopPropagation(); openPanel("lsLogPanel"); });
  // 展示上一墩結果時，點牌桌直接開始下一墩
  $("lsFelt").addEventListener("click", () => { if (showing()) stage.skip(); });
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
    if (!r.ok && a.t === "lock") stage.myLockFailed();
    if (!r.ok && r.code !== "STALE") { D.banner(r.msg, 2600); D.deny(); }
    render();
  });
  if (!sent) { busy = false; if (a.t === "lock") stage.myLockFailed(); render(); }
}

// 伺服器送來的新牌桌（resync＝斷線回來整份重送：轉播不補播舊新聞）
export function lsView(view: LSView, resync = false) {
  const prevKey = v ? `${v.trick}:${v.phase}:${v.steps.length}:${v.toAct}` : "";
  const prevHist = v ? v.history.length : -1;
  v = view;
  // 剛結算完一墩（紀錄多了一筆）：先展示結果；重新整理、斷線回來、換一場就不展示
  if (resync || prevHist < 0 || view.history.length < prevHist) stage.cancelAll();
  else if (view.history.length > prevHist) stage.trickEnd(view.history.at(-1)!, !!view.result);
  // 我的蓋牌確認：快照裡鎖的就是這張，或這張已經不在手上（保命墩不用下注，蓋完馬上結算，快照直接是下一墩）
  const fid = stage.flyingId();
  if (fid >= 0 && (view.myLock === fid || !view.hand.includes(fid))) stage.myLockConfirmed(fid);
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
    case "Locked": if (e.seat !== me) stage.oppLock(); break;
    // P2.5-C：籌碼推上桌（快照先擺好數字，下一幀籌碼從餘額飛到押注位）
    case "Ante": requestAnimationFrame(() => { betChips(true, e.amount ?? 0); betChips(false, e.amount ?? 0); }); break;
    case "Raise": case "Call": {
      const add = (e.to ?? 0) - (v.commit[e.seat] ?? 0);
      requestAnimationFrame(() => betChips(e.seat === me, add));
      break;
    }
    case "InsightResult": if (e.seat === me) requestAnimationFrame(() => insightScan()); break;
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
// 攤牌停留期間（showing）整張桌子講的都是「剛結算的那一墩」：墩數、底注、身分都用那一墩的紀錄，下一墩的資訊等清桌後才出現
const role = (s: number, r: TrickRecord | null = null) => (s === (r ? r.declarer : v?.declarer) ? "宣戰權" : "下注先手");
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

// P2.5-C：桌上看到的錢。一墩剛結算、籌碼還沒收完之前，顯示結算前的樣子（從那一墩的紀錄算回來：
//   下注時籌碼已經從餘額扣到桌上，所以結算前的餘額＝開局餘額−本墩承諾；疊池在一墩之中不會變）
function money(): { stacks: [number, number]; commit: [number, number]; pool: number } {
  const s = v!, R = stage.presenting();
  if (R && !stage.paid()) return { stacks: [R.startStacks[0] - R.commit[0], R.startStacks[1] - R.commit[1]], commit: R.commit, pool: R.poolBefore[0] + R.poolBefore[1] };
  return { stacks: s.stacks, commit: s.commit, pool: s.pool[0] + s.pool[1] };
}

function render() {
  if (!v) return;
  const M = money();
  if (stage.paid()) $("lsFelt").classList.remove("paying");     // 籌碼收完了：押注位、疊池照結算後的顯示
  const me = v.seat, op = 1 - me, opp = D.oppName(), pool = M.pool;
  // ① 頂列
  const R = showing() ? stage.presenting() : null;
  const trick = R ? R.trick : v.trick, ante = R ? R.ante : v.ante, cap = R ? R.cap : v.cap, safe = R ? R.safeguardBy >= 0 : v.safeguard >= 0;
  $("lsTrick").textContent = v.result ? "比賽結束" : `第 ${trick}／${TRICKS} 墩`;
  $("lsStage").textContent = v.result ? "" : safe ? "保命墩・每人 1 枚" : `底注 ${ante}・${allInStage(trick) ? "可梭哈" : `上限 ${cap}`}`;
  $("lsBadge").textContent = (!$("lsTestTag").hidden ? "測試・" : "") + (v.result ? "終" : `${trick}/${TRICKS}`);
  // ② 對手名牌
  $("lsOppName").textContent = opp;
  $("lsOppSeal").textContent = [...opp][0] ?? "";
  $("lsOppTag").textContent = role(op, R);
  $("lsOppStatus").textContent = R ? "" : oppStatus();
  $("lsOppChips").textContent = String(M.stacks[op]);
  const left = v.counts[op].reduce((a, b) => a + b, 0), inHand = left - (v.locked[op] ? 1 : 0);
  const backs = $("lsOppBacks");
  if (backs.childElementCount !== inHand) backs.replaceChildren(...Array.from({ length: inHand }, () => fx.backEl()));
  $("lsOppCounts").innerHTML = pipsHtml(v.counts[op]);
  $("lsOppCounts").title = `${opp}還沒用掉的牌（含桌上蓋著的）`;
  skills($("lsOppSkills"), op);
  // ③ 牌桌
  renderFelt(opp, pool);
  // 我的名牌
  $("lsMyTag").textContent = role(me, R);
  $("lsMyChips").textContent = String(M.stacks[me]);
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
// 出牌位要不要攤開某一墩：整場結束＝最後一墩；剛結算完＝展示中的那一墩；其他時候出牌區是這一墩的（清空、蓋牌）
function revealing(): TrickRecord | null {
  const s = v!;
  if (s.result) return s.history.at(-1) ?? null;
  return showing() ? stage.presenting() : null;
}
// 正在展示剛結算的那一墩（整場結束不算：最後一墩一直留在桌上）
const showing = () => !!stage.presenting() && !!v && !v.result;
// 勝負揭曉了沒（翻牌那一下還不能先亮金框、先寫結果）
const verdictOn = () => !stage.presenting() || stage.verdictShown();

function renderFelt(opp: string, pool: number) {
  const s = v!, me = s.seat, op = 1 - me, r = revealing();
  // 出牌位
  const mySlot = $("lsMySlot"), oppSlot = $("lsOppSlot"), ph = stage.phase();
  // 一墩剛結算、翻牌還沒開演（前面還有演出在排）：出牌位維持原樣，不讓下一墩的空位先閃出來
  if (ph === "pre") { /* 不動出牌位 */ }
  else if (r) {
    // 翻牌那一下、收牌途中不畫金框／變暗；勝負揭曉後才畫
    const vc = verdictOn() && ph !== "collect";
    const won = vc && r.winner === me, lost = vc && r.winner === op;
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
    // 飛行中（incoming）：快照的牌背先放好但藏著，牌飛到了才現身
    if (s.myLock >= 0) setSlot(mySlot, `back:${s.myLock}`, () => [fx.backEl(), peek(s.myLock)], stage.isIncoming("me") ? "incoming" : "");
    else if (s.phase === "lock") setSlot(mySlot, "empty:ask", () => [lbl("蓋牌區")], "empty ask");
    else setSlot(mySlot, "empty", () => [], "empty");
    // 對手的：翻牌前只畫牌背；讀心看到的分類只在自己畫面
    const ins = s.insight >= 0 ? s.insight : -1;
    if (s.locked[op]) setSlot(oppSlot, `back:${ins}`, () => [fx.backEl(), ...(ins >= 0 ? [insightTag(ins)] : [])], stage.isIncoming("opp") ? "incoming" : "");
    else if (s.phase === "lock") setSlot(oppSlot, "empty:wait", () => [lbl("選牌中")], "empty");
    else setSlot(oppSlot, "empty", () => [], "empty");
  }
  // 押的籌碼（本墩承諾）
  for (const [seat, bet] of [[me, "lsMyBet"], [op, "lsOppBet"]] as const) {
    const n = money().commit[seat], el = $(bet);
    stack(el.querySelector(".lsstack")!, n);
    el.classList.toggle("zero", !n);
  }
  $("lsMyCommit").textContent = String(money().commit[me]);
  $("lsOppCommit").textContent = String(money().commit[op]);
  $("lsOppCommitWho").textContent = `${opp}押`;
  $("lsOppOwner").textContent = opp;
  // 方向：攤開某一墩的時候，用那一墩自己的方向（不會把上一墩的牌配上這一墩的方向）
  const dir = r ? r.dir : s.dir, flipped = r ? r.flippedBy >= 0 : s.flippedBy >= 0;
  const big = $("lsDirBig");
  big.textContent = DIR_LABEL[dir];
  big.classList.toggle("low", dir === "low");
  big.classList.toggle("flipped", flipped);
  $("lsDir").classList.toggle("canflip", !r && s.legal.flip);
  $("lsDir").classList.toggle("past", !!r);
  $("lsDirNote").textContent = r ? `第 ${r.trick} 墩` : s.nextDir ? `下一墩 ${DIR_LABEL[s.nextDir]}` : "最後一墩";
  // 疊池
  const pl = $("lsPool");
  pl.hidden = !pool;
  if (pool) { stack(pl.querySelector(".lsstack")!, pool); $("lsPoolText").textContent = `疊池 ${pool}${s.safeguardBlocked ? "・不能保命" : ""}`; }
  // 上一墩（點了看每墩紀錄）
  const last = s.history.at(-1), lb = $("lsLast");
  lb.hidden = !last;
  if (last) {
    const html = r && !verdictOn() ? `第 ${r.trick} 墩・${DIR_LABEL[r.dir]}：翻牌…` : `${r ? `第 ${last.trick} 墩・${DIR_LABEL[last.dir]}` : "上一墩"}：${shortResult(last, opp)}`;
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
  const canPick = s.phase === "lock" && s.myLock < 0 && !busy && !s.result && !showing() && stage.flyingId() < 0;
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
    b.classList.toggle("away", id === stage.flyingId());        // 正在飛向桌面的那張：手牌裡先藏起來
    b.setAttribute("aria-selected", String(id === sel));
    b.disabled = !canPick;
    if (box.children[i] !== b) box.insertBefore(b, box.children[i] ?? null);
  });
  // 等對手蓋牌、或整場結束（剩下的牌不會再打）：手牌變暗
  box.classList.toggle("wait", (s.phase === "lock" && s.myLock >= 0) || !!s.result);
}

// P2.5-D 首次提示：每種決定第一次遇到時，小字換成一句教學（看過就不再出現；存在這台手機上）
const TIPS: Record<string, string> = {
  lock: "點一張牌再按「蓋牌」，或直接把牌往上拖到桌上。蓋了就不能換。",
  flip: "宣戰權：把這一墩的方向反過來（比大↔比小）。每場只能用一次。",
  safe: "保命：這一墩雙方都只押 1 枚，輸了也只輸 1 枚。每場只能用一次。",
  facing: "對手加注了：「接戰」補到一樣多再翻牌；「棄牌」只輸掉你已經押的。按鈕上的小字就是會補／會輸多少。",
  bet: "「過牌」就直接翻牌比大小；想多贏一點就「加注」。完整試算按右邊的「?」。",
};
let tipsSeen: Set<string> | null = null;
let tipShown = "";           // 這一個決定已經在顯示哪一則（同一個決定重畫不換字）
let tipKey = "";
function tip(k: string): string | null {
  if (!tipsSeen) { try { tipsSeen = new Set(JSON.parse(localStorage.getItem("hb-ls-tips") ?? "[]")); } catch { tipsSeen = new Set(); } }
  const key = `${v!.trick}:${v!.phase}:${v!.steps.length}`;
  if (tipKey === key && tipShown === k) return TIPS[k];
  if (tipsSeen.has(k)) return null;
  tipsSeen.add(k); tipKey = key; tipShown = k;
  try { localStorage.setItem("hb-ls-tips", JSON.stringify([...tipsSeen])); } catch { /* 無痕模式 */ }
  return TIPS[k];
}

// ⑤ 一句問題＋一行小字
function renderAsk(opp: string, pool: number) {
  const s = v!, me = s.seat, L = s.legal, o = esc(opp);
  const poolTxt = pool ? `（＋疊池 ${pool}）` : "";
  const theirs = s.commit[1 - me], mine = s.commit[me];
  let q = "", sm = "", mineTurn = false;
  if (s.result && !verdictOn()) {
    const R = stage.presenting()!;
    q = `第 ${R.trick} 墩${DIR_LABEL[R.dir]}：翻牌！`;
  } else if (s.result) {
    const w = s.result.winner;
    q = w < 0 ? `平手（各 ${s.stacks[me]} 枚）` : w === me ? `你贏了這場（${s.stacks[me]}：${s.stacks[1 - me]}）` : `${opp}贏了這場（${s.stacks[1 - me]}：${s.stacks[me]}）`;
  } else if (showing()) {
    const R = stage.presenting()!;
    q = verdictOn() ? `第 ${R.trick} 墩${DIR_LABEL[R.dir]}：${shortResult(R, opp).replace(/<[^>]+>/g, "")}` : `第 ${R.trick} 墩${DIR_LABEL[R.dir]}：翻牌！`;
    sm = "點牌桌直接下一墩";
  } else if (busy) q = "送出中…";
  else switch (s.phase) {
    // P2.5-D：一句話只講「現在要你決定什麼」；小字只放做決定需要的數字；第一次遇到某個決定時，小字換成一次性的提示
    case "flip":
      if (L.flip) { mineTurn = true; q = `這墩${DIR_LABEL[s.dir]}。要翻成${DIR_LABEL[flipDir(s.dir)]}嗎？`; sm = tip("flip") ?? "你有宣戰權：翻了只改這一墩，每場一次。"; }
      else q = `${opp}在想要不要翻方向…`;
      break;
    case "safeguard":
      if (L.safeguard) { mineTurn = true; q = "這墩要保命嗎？"; sm = tip("safe") ?? "用了這墩每人只押 1 枚、不能加注；每場一次。"; }
      else q = `${opp}在想要不要保命…`;
      break;
    case "lock":
      if (s.myLock < 0) {
        mineTurn = true;
        q = "挑一張牌蓋到桌上";
        sm = tip("lock") ?? `${DIR_LABEL[s.dir]}：${s.dir === "high" ? "點數越大越好" : "點數越小越好"}${s.locked[1 - me] ? `；${o}已經蓋好了` : ""}。`;
      }
      else q = `等${opp}出牌…`;
      break;
    case "bet":
      if (s.toAct !== me) { q = `等${opp}決定…`; break; }
      mineTurn = true;
      if (raiseOpen && L.raise) {
        const x = raiseTo, allIn = s.allInStage && x === L.raise[1];
        q = allIn ? `梭哈：每人押到 ${x}？` : `${L.call ? "反加" : "加"}到 ${x}？`;
        sm = `${o}接戰：翻牌贏 <b>+${x}</b>${poolTxt}、輸 <b>−${x}</b>；${o}棄牌：你 <b>+${theirs}</b>${poolTxt}`;
      } else if (theirs > mine) {
        q = `${opp}${s.steps.filter(x => x.act === "raise").length >= 2 ? "反加" : "加"}到 ${theirs}，跟不跟？`;
        sm = tip("facing") ?? `接戰：翻牌${DIR_LABEL[s.dir]}，贏 <b>+${theirs}</b>、輸 <b>−${theirs}</b>${poolTxt}`;
      } else {
        q = s.steps.some(x => x.act === "check") ? `${opp}過牌了。你要加注嗎？` : "要加注嗎？";
        sm = tip("bet") ?? `不加就直接翻牌：贏 <b>+${theirs}</b>、輸 <b>−${mine}</b>${poolTxt}`;
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
  if (!s.result && !busy && !showing()) {
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
