// 梭了啦 P2「全桌都在看你笑話」：牌桌上的轉播畫面（字幕條、節目小卡、下注壓力氛圍）
//   · 只吃公開的牌桌資料（publicOf 會拿掉手牌、鎖的牌、讀心結果、能做的動作），只演、不改任何規則或籌碼
//   · 字幕條：放在最上面的標題列（跟原本的提示條同一區）；最多兩則、約 2 秒淡出；左邊留一個小小的「3/9」不讓墩數消失
//   · 節目小卡：放在牌桌中間和底部固定區之間的空位；一行一行出來、點一下就略過；空位不夠就只在標題列出一行（寧可少演，不縮牌桌）
//   · 絕對不蓋：手牌、按鈕、對手資訊、籌碼（底部固定區上面、對手那一格下面才放）
//   · 重新整理、斷線回來：不出聲重建（舊新聞不重播）；換一場（對局編號變了）就換一個導演
//   · 減少動態（系統設定或動畫效果關閉）：不位移、只淡入淡出
import type { LSView } from "../laststand/engine";
import { publicOf } from "../laststand/director/analyze";
import { PROGRAMS } from "../laststand/director/config";
import { Director, type Cast } from "../laststand/director/director";
import { buildReport, type Report } from "../laststand/director/report";
import { Stage, type Showing } from "../laststand/director/scheduler";
import type { Cue } from "../laststand/director/types";
import * as fx from "./fx";

export interface MediaDeps {
  gid(): string | null;           // 這一場的對局編號（同一場雙方一樣）
  cast(): Cast;                   // 雙方暱稱、賭上之物、豪言（照座位）
  reduced(): boolean;             // 減少動態
}
let M: MediaDeps | null = null;
let director: Director | null = null;
let stage = new Stage();
let gid: string | null = null;
let lastHist = 0, lastTrick = 0;
let timer = 0, holdUntil = 0;
let cardShown: string | null = null, cardStart = 0;
let lastView: LSView | null = null;
const $ = (id: string) => document.getElementById(id)!;
const now = () => performance.now();
const CH_LABEL: Record<string, string> = { chat: "聊天室", anchor: "主播", notice: "公告" };
const PROGRAM_LABEL = Object.fromEntries(PROGRAMS.map(p => [p.id, p.label]));

// 驗收用：最近演過什麼（不含任何隱藏資訊；都是畫面上本來就會出現的字）
const played: { id: string; channel: string; title?: string; text: string; at: number; mode: string; pr: number }[] = [];
Object.assign(globalThis, { __hbCast: () => ({ gid, played: played.slice(), press: $("lstable").dataset.press ?? "1", pending: stage.pending }) });

export function mediaInit(deps: MediaDeps) {
  M = deps;
  $("lsCast").addEventListener("click", () => { stage.skipCard(now()); tick(); });
  // P2.5-A：小卡縮成標題列一行時，點那一行也能略過（跟點小卡一樣；一般字幕不能點）
  $("lsTicker").addEventListener("click", () => { if ($("lsTicker").classList.contains("tap")) { stage.skipCard(now()); tick(); } });
  fx.onSettings(() => { if (fx.settings.cast === "off") clearScreen(); });
  // 底部固定區（輪到你時會多出按鈕）、賭盤（翻牌結果）、紀錄展開：空位變了就重新量；放不下就改成標題列一行
  const reflow = () => { if (cardShown || $("lsTicker").classList.contains("on")) tick(); };
  window.addEventListener("resize", reflow);
  if (typeof ResizeObserver !== "undefined") { const ro = new ResizeObserver(reflow); for (const id of ["lsDock", "lsFelt", "lsOpp"]) { const e = document.getElementById(id); if (e) ro.observe(e); } }
}

export function mediaReset() {
  director = null; gid = null; lastHist = 0; lastTrick = 0; holdUntil = 0; lastView = null;
  stage = new Stage();
  clearScreen();
  $("lstable").dataset.press = "1";
}

// 原本的提示條（規則提醒、錯誤）出現時：這段時間字幕條讓位
export function mediaHold(ms: number) {
  holdUntil = Math.max(holdUntil, now() + ms);
  stage.block(holdUntil);
  $("lsTicker").classList.add("hush");
  schedule(ms + 20);
}

// 新的牌桌畫面進來；resync＝斷線回來、整份重送（不補播之前的事）
export function mediaView(view: LSView, resync = false) {
  if (!M) return;
  const g = M.gid();
  if (!g) return;
  const pub = publicOf(view);
  lastView = view;
  const restarted = g === gid && (view.history.length < lastHist || view.trick < lastTrick);
  let silent = resync;
  if (g !== gid || restarted || !director) {
    // 新的一場：剛開打（什麼都還沒發生）才演開場的契約公證；中途接上就不出聲
    mediaReset();
    gid = g;
    director = new Director(g, M.cast());
    silent = resync || view.history.length > 0 || view.steps.length > 0 || view.trick > 1 || !!view.result;
  } else director.cast = M.cast();
  lastHist = view.history.length; lastTrick = view.trick;
  $("lstable").dataset.calm = M.reduced() ? "1" : "0";
  const { cues, analysis } = director.update(pub, silent);
  const p = analysis.pressure;
  $("lstable").dataset.press = String(view.result ? 1 : p.level);
  $("lstable").dataset.stage = p.stage;
  if (silent || fx.settings.cast === "off") return;
  const keep = fx.settings.cast === "lite" ? cues.filter(c => c.priority >= 60) : cues;
  if (keep.length) stage.push(keep, now());
  tick();                      // 牌桌剛重畫：沒有新演出也重新量一次小卡的位置
}

// 賽後戰報：照規則打完（九墩或有人歸零）才有；認輸、斷線逾時沒有完整戰報
export function mediaReport(footer?: string): Report | null {
  if (!M || !lastView?.result || !gid) return null;
  return buildReport(publicOf(lastView), M.cast(), gid, { footer });
}

// ---------------- 畫面 ----------------
function schedule(ms: number) {
  clearTimeout(timer);
  timer = window.setTimeout(tick, Math.max(16, ms));
}

function tick() {
  // 牌桌還沒顯示（剛開打、畫面還在切換）：先等一下再上，不然量不到空位
  if ($("lstable").hidden || !$("lsDock").getBoundingClientRect().height) { if (stage.pending) schedule(120); return; }
  const t = now();
  if (t >= holdUntil) $("lsTicker").classList.remove("hush");
  const v = stage.step(t);
  const compact = !!v.card && !placeCard(v.card);
  paintTicker(v.ticker, compact ? v.card : null, t);
  paintCard(compact ? null : v.card, t);
  // 下一次：有東西要收、要開始、或小卡要出下一行
  let next = v.wake === null ? Infinity : v.wake - t;
  if (v.card) { const n = nextLineAt(v.card) - t; if (n > 0) next = Math.min(next, n); }
  if (Number.isFinite(next)) schedule(next);
}

// 字幕條：最多兩則；新的那則要兩行的話，舊的先收（不讓字被切一半）
function paintTicker(items: Showing[], cardInTicker: Showing | null, t: number) {
  const box = $("lsTicker");
  const want: { key: string; tag: string; text: string; who?: string; press: number }[] = [];
  if (cardInTicker) {
    const c = cardInTicker.cue, i = shownLines(cardInTicker, t) - 1, l = c.lines[Math.max(0, i)];
    want.push({ key: `${c.id}#${i}`, tag: PROGRAM_LABEL[c.program ?? ""] ?? "節目", text: l.text, who: l.who, press: c.level });
    log(c, "ticker-card", t);
  } else {
    for (const s of items) {
      const c = s.cue;
      want.push({ key: c.id, tag: CH_LABEL[c.channel] ?? "", text: c.lines.map(l => (l.who ? `${l.who}：` : "") + l.text).join(" "), press: c.level });
      log(c, "ticker", t);
    }
  }
  const keys = new Set(want.map(w => w.key));
  // 要收的那則：先脫離排版（停在原位淡出），不會把新的那則擠出框外
  for (const el of Array.from(box.children) as HTMLElement[]) {
    if (!keys.has(el.dataset.k!) && !el.classList.contains("out")) { el.style.top = `${el.offsetTop}px`; el.classList.add("out"); window.setTimeout(() => el.remove(), 380); }
  }
  for (const w of want) {
    if (box.querySelector(`[data-k="${CSS.escape(w.key)}"]:not(.out)`)) continue;
    const el = document.createElement("p");
    el.dataset.k = w.key;
    el.className = "tk" + (w.press >= 3 ? " hot" : "");
    const tag = document.createElement("i");
    tag.textContent = w.who ?? w.tag;
    const tx = document.createElement("span");
    tx.textContent = w.text;
    el.append(tag, tx);
    box.appendChild(el);
  }
  // 放不下（用實際高度算；置中排版超出上面時 scrollHeight 量不到）：最舊的直接收掉，不切半句
  const live = () => (Array.from(box.children) as HTMLElement[]).filter(e => !e.classList.contains("out"));
  const used = () => live().reduce((s, e) => s + e.offsetHeight, 0) + Math.max(0, live().length - 1);
  while (live().length > 1 && used() > box.clientHeight) live()[0].remove();
  box.classList.toggle("on", live().length > 0);
  box.classList.toggle("tap", !!cardInTicker);
  box.setAttribute("aria-label", cardInTicker ? "節目播放中，點一下略過" : "");
  box.style.setProperty("--tk-left", `${Math.ceil($("lsBadge").getBoundingClientRect().width) + 6}px`);
  $("lsBar").classList.toggle("airing", live().length > 0);
}

// 小卡一行一行出來：照小卡的時間平均分（至少 0.5 秒、最多 1.1 秒一行），最後一行停久一點
const lineStep = (s: Showing) => Math.max(500, Math.min(1100, (s.until - s.start - 900) / Math.max(1, s.cue.lines.length - 1)));
const shownLines = (s: Showing, t: number) => Math.min(s.cue.lines.length, 1 + Math.floor((t - s.start) / lineStep(s)));
const nextLineAt = (s: Showing) => (shownLines(s, now()) >= s.cue.lines.length ? Infinity : s.start + shownLines(s, now()) * lineStep(s));

// 小卡的位置：對手那一格、方向、賭盤、紀錄的下面，到底部固定區的上面；放不下回傳 false
// P2.5-A：牌桌占滿中間，沒有空位放小卡 → 一律用「標題列一行」的精簡模式；
//   P2.5-E 會在牌桌裡指定一個 #lsCastZone（重大事件才進桌面），有它才放完整小卡
function zone() {
  const z = document.getElementById("lsCastZone")!.getBoundingClientRect();
  return { top: z.top, bottom: z.bottom };
}
function placeCard(s?: Showing): boolean {
  if (!document.getElementById("lsCastZone")) return false;
  const el = $("lsCast"), z = zone();
  const h = z.bottom - z.top;
  if (h < 64) return false;
  el.style.top = `${Math.round(z.top)}px`;
  el.style.maxHeight = `${Math.round(Math.min(h, 220))}px`;
  void s;
  return true;
}

function paintCard(s: Showing | null, t: number) {
  const el = $("lsCast");
  if (!s) {
    if (cardShown && !el.classList.contains("out")) { el.classList.add("out"); window.setTimeout(() => { if (!cardShown) el.hidden = true; }, 380); }
    cardShown = null;
    return;
  }
  const c = s.cue;
  if (cardShown !== c.id) {
    cardShown = c.id; cardStart = s.start;
    el.hidden = false;
    el.classList.remove("out");
    el.dataset.program = c.program ?? "";
    el.classList.toggle("mid", c.id === "4:intermission");
    const label = PROGRAM_LABEL[c.program ?? ""] ?? "節目";
    $("lsCastProg").textContent = c.title?.includes(label) ? "LIVE" : label;     // 標題已經有節目名就不重複
    $("lsCastTitle").textContent = c.title ?? "";
    $("lsCastLines").replaceChildren();
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    log(c, "card", t);
  }
  void cardStart;
  const list = $("lsCastLines");
  const n = shownLines(s, t);
  while (list.children.length < n) {
    const l = c.lines[list.children.length];
    const li = document.createElement("li");
    if (l.who) { const w = document.createElement("i"); w.textContent = l.who; li.appendChild(w); }
    const tx = document.createElement("span");
    tx.textContent = l.text;
    li.appendChild(tx);
    list.appendChild(li);
  }
  // 空間不夠就讓舊的對白往上收掉（不縮字、不切半行）
  while (list.children.length > 1 && list.scrollHeight > list.clientHeight + 1) list.firstElementChild!.remove();
}

function clearScreen() {
  clearTimeout(timer);
  $("lsTicker").replaceChildren();
  $("lsTicker").classList.remove("on", "hush");
  $("lsBar").classList.remove("airing");
  const el = $("lsCast");
  el.hidden = true; el.classList.remove("out");
  $("lsCastLines").replaceChildren();
  cardShown = null;
  stage.clear();
}

function log(c: Cue, mode: string, t: number) {
  if (played.some(p => p.id === c.id)) return;
  played.push({ id: c.id, channel: c.channel, title: c.title, text: c.lines.map(l => (l.who ? `${l.who}：` : "") + l.text).join("／"), at: Math.round(t), mode, pr: c.priority });
  if (played.length > 80) played.shift();
}
