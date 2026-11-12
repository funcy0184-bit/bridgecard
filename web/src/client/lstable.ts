// 逆命賭局：手機牌桌（只畫伺服器給的 LSView；動作送給伺服器判斷，畫面不自己算規則）
//   上：第幾墩、底注／單人上限；對手籌碼、剩幾張與大中小分布、技能、狀態
//   中：本墩比大／比小與下一墩方向；賭盤（雙方已投入、疊池、可能損失與可能獲得）；上一墩結果
//   下：輪到誰；我的籌碼與牌；目前能做的動作（翻轉、保命、鎖牌、過牌、加注、反加、接戰、棄牌、讀心）
// 梭哈一律顯示「每人押到多少」（雙方較少的籌碼），不讓人以為雙方都推出全部
import type { Action, LSEvent, LSView, TrickRecord } from "../laststand/engine";
import { CAT_LABEL, DIR_LABEL, TRICKS, catOf, flipDir } from "../laststand/rules";
import * as fx from "./fx";
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
let busy = false;             // 動作送出、等伺服器回覆
let holdUntil = 0;            // 整場結束：最後一墩結果先看一下再跳結算
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const lsHas = () => !!v;
// 驗收用：看自己這一邊的逆命牌桌（伺服器給的、只有自己看得到的部分）
Object.assign(globalThis, { __hbLS: () => v });
// 整場結束時的籌碼與墩數（結算面板用）
export const lsResult = () => (v?.result ? { stacks: v.stacks, trick: v.result.trick } : null);
export const lsHoldUntil = () => holdUntil;
export function lsReset() {
  v = null; sel = -1; busy = false; holdUntil = 0; raiseTo = 0;
  for (const id of ["lsHand", "lsActions", "lsLogList", "lsReveal"]) $(id).replaceChildren();
}

export function lsInit(deps: LSDeps) {
  D = deps;
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
}

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

// 伺服器送來的新牌桌
export function lsView(view: LSView) {
  v = view;
  busy = false;
  if (v.phase !== "lock" || v.myLock >= 0 || !v.hand.includes(sel)) sel = -1;
  const L = v.legal;
  if (L.raise) raiseTo = Math.max(L.raise[0], Math.min(L.raise[1], raiseTo || L.raise[0]));
  else raiseTo = 0;
  render();
}

// 對手做了什麼：短短提示一下（輪到誰、多少錢都在畫面上）
export function lsEvent(e: LSEvent) {
  if (!v) return;
  const me = v.seat, opp = D.oppName();
  const who = (s: number) => (s === me ? "你" : opp);
  switch (e.type) {
    case "Flip": if (e.seat !== me) D.banner(`${opp}翻轉了方向：這一墩改成${DIR_LABEL[e.dir!]}`, 2400); break;
    case "Safeguard": D.banner(`${who(e.seat)}宣告保命：這一墩每人只押 1 枚、不能加注`, 2600); break;
    case "Insight": if (e.seat !== me) D.banner(`${opp}用了讀心（只看得到你鎖的是大、中還是小）`, 2600); break;
    case "Raise": if (e.seat !== me && e.allIn) D.banner(`${opp}梭哈：每人押到 ${e.to} 枚`, 2600); break;
    case "PoolRefund": D.banner(`疊池退款：你拿回 ${e.refund![me]} 枚、${opp}拿回 ${e.refund![1 - me]} 枚`, 2800); break;
    case "Eliminated": D.banner(`${who(e.seat)}的籌碼歸零`, 2600); break;
    case "MatchOver": holdUntil = Date.now() + 2600; break;
  }
}

// ---------------- 畫面 ----------------
const catText = (c: [number, number, number]) => `大 ${c[2]}・中 ${c[1]}・小 ${c[0]}`;
const role = (s: number) => (v && s === v.declarer ? "宣戰權" : "下注先手");
function skills(s: number) {
  const used = (b: boolean, name: string) => (b ? `<s>${name}</s>` : name);
  return `技能：${used(v!.flipUsed[s], "翻轉")}・${used(v!.safeUsed[s], "保命")}・${used(v!.insightUsed[s], "讀心")}`;
}

function render() {
  if (!v) return;
  const me = v.seat, op = 1 - me, opp = D.oppName(), pool = v.pool[0] + v.pool[1];
  $("lsTrick").textContent = v.result ? "比賽結束" : `第 ${v.trick}／${TRICKS} 墩`;
  $("lsStage").textContent = v.safeguard >= 0 ? `保命墩：每人只押 1 枚` : `底注 ${v.ante} · 單人上限 ${v.allInStage ? `可梭哈（每人最多 ${v.cap}）` : v.cap}`;
  $("lsOppName").textContent = opp;
  $("lsOppTag").textContent = role(op);
  $("lsMyTag").textContent = role(me);
  $("lsOppChips").textContent = String(v.stacks[op]);
  $("lsMyChips").textContent = String(v.stacks[me]);
  $("lsOppCounts").textContent = `剩 ${v.counts[op].reduce((a, b) => a + b, 0)} 張：${catText(v.counts[op])}`;
  $("lsMyCounts").textContent = `剩 ${v.hand.length} 張：${catText(v.counts[me])}`;
  $("lsOppSkills").innerHTML = skills(op);
  $("lsMySkills").innerHTML = skills(me);
  $("lsOppStatus").textContent = oppStatus(opp);
  // 方向
  const big = $("lsDirBig");
  big.textContent = DIR_LABEL[v.dir];
  big.classList.toggle("low", v.dir === "low");
  big.classList.toggle("flipped", v.flippedBy >= 0);
  $("lsDirNote").textContent = v.result ? "" : v.nextDir ? `下一墩：${DIR_LABEL[v.nextDir]}` : "這是最後一墩";
  // 賭盤
  $("lsMyCommit").textContent = String(v.commit[me]);
  $("lsOppCommit").textContent = String(v.commit[op]);
  const pl = $("lsPool");
  pl.hidden = !pool;
  if (pool) pl.textContent = `疊池 ${pool} 枚（你出 ${v.pool[me]}・${opp}出 ${v.pool[op]}）：下一個翻牌贏、或讓對方棄牌的人拿走` + (v.safeguardBlocked ? "；有疊池，這一墩不能保命" : "");
  $("lsRisk").innerHTML = riskHtml(opp, pool);
  renderReveal(opp);
  const turn = $("lsTurn");
  const t = turnText(opp);
  turn.textContent = t.text;
  turn.classList.toggle("mine", t.mine);
  renderHand();
  renderActions(opp, pool);
  renderLog(opp);
}

function oppStatus(opp: string): string {
  const s = v!, op = 1 - s.seat;
  if (s.result) return "";
  if (s.phase === "lock") return s.locked[op] ? `${opp}已鎖牌 🔒` : `${opp}選牌中…`;
  if (s.phase === "bet") {
    const last = [...s.steps].reverse().find(x => x.seat === op);
    if (last) return last.act === "check" ? `${opp}過牌` : last.act === "raise" ? `${opp}${last.reraise ? "反加" : "加注"}到 ${last.to}${last.allIn ? "（梭哈）" : ""}` : last.act === "call" ? `${opp}接戰` : "";
    return `${opp}已鎖牌 🔒`;
  }
  return "";
}

function riskHtml(opp: string, pool: number): string {
  const s = v!, me = s.seat, op = 1 - me;
  if (s.result) return "";
  const poolTxt = pool ? `（＋疊池 ${pool}）` : "";
  if (s.phase === "bet") {
    const mine = s.commit[me], theirs = s.commit[op];
    if (theirs > mine)
      return `若<b>接戰</b>：再補 <b>${theirs - mine}</b> 枚，翻牌贏拿 <b>${theirs}</b> 枚${poolTxt}、輸了損失 <b>${theirs}</b> 枚。<br>若<b>棄牌</b>：損失 <b>${mine}</b> 枚（${esc(opp)}多押的 ${theirs - mine} 枚退回給他）。`;
    return `目前每人押 <b>${mine}</b> 枚：翻牌贏拿 <b>${theirs}</b> 枚${poolTxt}、輸了損失 <b>${mine}</b> 枚。`;
  }
  const stake = s.safeguard >= 0 ? 1 : s.ante, cap = s.safeguard >= 0 ? 1 : s.cap;
  let h = `本墩底注 <b>${stake}</b> 枚（雙方都押），每人最多押到 <b>${cap}</b> 枚。`;
  if (s.allInStage && s.safeguard < 0 && s.cap > s.ante)
    h += `<span class="allin">梭哈＝每人押到 ${s.cap} 枚（雙方較少的籌碼），不是各自把全部推出去。</span>`;
  return h;
}

function turnText(opp: string): { text: string; mine: boolean } {
  const s = v!, me = s.seat, L = s.legal;
  if (s.result) {
    const w = s.result.winner;
    return { text: w < 0 ? `平手（各 ${s.stacks[me]} 枚）` : w === me ? `你贏了這場（${s.stacks[me]}：${s.stacks[1 - me]}）` : `${opp}贏了這場（${s.stacks[1 - me]}：${s.stacks[me]}）`, mine: w === me };
  }
  if (busy) return { text: "送出中…", mine: false };
  switch (s.phase) {
    case "flip": return L.flip ? { text: `你有宣戰權：要不要把這一墩翻成${DIR_LABEL[flipDir(s.dir)]}？（每場一次）`, mine: true } : { text: `${opp}（宣戰權）在決定要不要翻轉方向…`, mine: false };
    case "safeguard": return L.safeguard ? { text: "要不要用保命？這一墩每人只押 1 枚、不能加注（每場一次）", mine: true } : { text: `${opp}在決定要不要用保命…`, mine: false };
    case "lock":
      if (s.myLock < 0) return { text: `選一張牌鎖定（鎖了不能改）${s.locked[1 - me] ? `；${opp}已經鎖好了` : ""}`, mine: true };
      return { text: `你已鎖牌；等${opp}鎖牌…`, mine: false };
    case "bet": {
      if (s.toAct !== me) return { text: `等${opp}回應…`, mine: false };
      const theirs = s.commit[1 - me], mine = s.commit[me];
      if (theirs > mine) return { text: `${opp}${s.steps.filter(x => x.act === "raise").length >= 2 ? "反加" : "加注"}到 ${theirs}：接戰、棄牌${L.raise ? "或反加" : ""}`, mine: true };
      return { text: s.steps.some(x => x.act === "check") ? `${opp}過牌：你可以過牌（直接翻牌）或加注` : "你先下注：過牌或加注", mine: true };
    }
  }
  return { text: "", mine: false };
}

function renderHand() {
  const s = v!, box = $("lsHand");
  const canPick = s.phase === "lock" && s.myLock < 0 && !busy;
  box.replaceChildren(...s.hand.map(id => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lscard" + (id === sel ? " sel" : "") + (id === s.myLock ? " locked" : "");
    b.dataset.id = String(id);
    b.disabled = !canPick;
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(id === sel || id === s.myLock));
    b.appendChild(fx.cardEl(id, "mini"));
    const cap = document.createElement("small");
    cap.textContent = id === s.myLock ? "已鎖" : CAT_LABEL[catOf(id)];
    b.appendChild(cap);
    return b;
  }));
}

function btn(a: string, text: string, cls = "paper", disabled = false) {
  return `<button type="button" class="btn ${cls}" data-a="${a}"${disabled ? " disabled" : ""}>${text}</button>`;
}

function renderActions(opp: string, pool: number) {
  const s = v!, me = s.seat, L = s.legal, box = $("lsActions");
  const h: string[] = [];
  if (!s.result && !busy) {
    if (L.flip) {
      h.push(btn("flip", `翻成${DIR_LABEL[flipDir(s.dir)]}`, "wine"), btn("noflip", `不翻（照${DIR_LABEL[s.dir]}）`));
      h.push(`<p class="note">翻轉只改這一墩，每人一場一次。</p>`);
    } else if (L.safeguard) {
      h.push(btn("safe", "用保命", "wine"), btn("nosafe", "不用"));
      h.push(`<p class="note">保命：這一墩每人只押 1 枚、不能加注；一方用了另一方不能再用。</p>`);
    } else if (L.lock.length) {
      h.push(btn("lock", sel >= 0 ? `鎖定這張（${CAT_LABEL[catOf(sel)]}）` : "先點一張牌", "wine wide", sel < 0));
      h.push(`<p class="note">鎖了就不能改；翻牌前對方只看得到你「已鎖牌」。</p>`);
    } else if (s.phase === "bet" && s.toAct === me) {
      if (L.check) h.push(btn("check", "過牌"));
      if (L.call) h.push(btn("call", `接戰（補 ${s.commit[1 - me] - s.commit[me]}）`, "wine"), btn("fold", `棄牌（輸 ${s.commit[me]}）`));
      if (L.insight) h.push(btn("insight", "讀心（看對方鎖的是大中小）"));
      if (L.raise) {
        const [lo, hi] = L.raise, x = raiseTo, allIn = s.allInStage && x === hi;
        const word = L.call ? "反加到" : "加注到";
        h.push(`<div class="lsraise">${btn("minus", "−", "step", x <= lo).replace('class="btn step"', 'class="step"')}${btn("raise", allIn ? `梭哈：每人押 ${x}` : `${word} ${x}`, allIn ? "wine allin" : "wine")}${btn("plus", "＋", "step", x >= hi).replace('class="btn step"', 'class="step"')}</div>`);
        if (s.allInStage && x !== hi) h.push(btn("max", `直接梭哈（每人 ${hi}）`, "paper wide"));
        const poolTxt = pool ? `＋疊池 ${pool}` : "";
        h.push(`<p class="note">押到 ${x}：${esc(opp)}接戰 → 贏 +${x}${poolTxt}／輸 −${x}；${esc(opp)}棄牌 → +${s.commit[1 - me]}${poolTxt}</p>`);
      }
      if (s.insight >= 0) h.push(`<p class="note">讀心：${esc(opp)}鎖的是「${CAT_LABEL[s.insight]}」牌（只有你看得到）</p>`);
    }
  }
  box.innerHTML = h.join("");
}

// 上一墩的結果：新的一墩還沒開始下注前都看得到（翻牌：雙方的牌；棄牌：只看得到分類）
function renderReveal(opp: string) {
  const s = v!, box = $("lsReveal"), r = s.history.at(-1);
  const show = !!r && (s.phase !== "bet" || !!s.result);
  box.hidden = !show;
  if (!show || !r) return;
  box.replaceChildren(...revealNodes(r, opp));
}
function revealNodes(r: TrickRecord, opp: string): Node[] {
  const s = v!, me = s.seat, op = 1 - me;
  const fig = (label: string, inner: Node) => { const f = document.createElement("figure"); f.appendChild(inner); const c = document.createElement("figcaption"); c.textContent = label; f.appendChild(c); return f; };
  const catBox = (c: number) => { const d = document.createElement("div"); d.className = "cat"; d.textContent = CAT_LABEL[c]; return d; };
  const nodes: Node[] = [];
  if (r.cards) { nodes.push(fig("你", fx.cardEl(r.cards[me], "mini")), fig(opp, fx.cardEl(r.cards[op], "mini"))); }
  else { nodes.push(fig("你", catBox(r.cats[me])), fig(opp, catBox(r.cats[op]))); }
  const p = document.createElement("p");
  p.innerHTML = `第 ${r.trick} 墩 ${DIR_LABEL[r.dir]}：${resultHtml(r, opp)}`;
  nodes.push(p);
  return nodes;
}
function resultHtml(r: TrickRecord, opp: string): string {
  const me = v!.seat, op = 1 - me, o = esc(opp);
  const pool = r.poolTaken ? `＋疊池 ${r.poolTaken}` : "";
  let t: string;
  if (r.outcome === "tie") t = `同點！雙方各 <b>${r.poolAdded[me]}</b> 枚進疊池`;
  else if (r.outcome === "fold") {
    t = r.folder === me ? `你棄牌，<b>−${r.transfer}</b>` : `${o}棄牌，你 <b>+${r.transfer}${pool}</b>`;
    if (r.excessReturned) t += `（${r.winner === me ? "你" : o}多押的 ${r.excessReturned} 枚退回）`;
    t += "；雙方的牌只公開大中小";
  } else t = r.winner === me ? `你贏，<b>+${r.transfer}${pool}</b>` : `${o}贏，你 <b>−${r.transfer}</b>`;
  if (r.refund) t += `；疊池退款（你 ${r.refund.amounts[me]}、${o} ${r.refund.amounts[op]}）`;
  return t;
}

function renderLog(opp: string) {
  const s = v!, me = s.seat, list = $("lsLogList");
  list.replaceChildren(...s.history.map(r => {
    const li = document.createElement("li");
    const tags = [r.flippedBy >= 0 ? "翻轉" : "", r.safeguardBy >= 0 ? "保命" : "", r.allIn >= 0 ? "梭哈" : ""].filter(Boolean).join("・");
    li.innerHTML = `<b>第 ${r.trick} 墩 ${DIR_LABEL[r.dir]}</b>${tags ? `（${tags}）` : ""}：${resultHtml(r, opp)}　<small>${r.stacksAfter[me]}：${r.stacksAfter[1 - me]}</small>`;
    return li;
  }));
}
