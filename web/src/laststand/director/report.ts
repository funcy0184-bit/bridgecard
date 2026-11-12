// 梭了啦 P2-C 賽後戰報：只用這場的公開紀錄（雙方都看過的事）＋雙方的暱稱、賭上之物、豪言
//   · 同一場（同一個對局編號）一定產生同一份戰報：雙方手機上看到的一樣、重新整理也一樣
//   · 內容：標題、結果、關鍵一注、本場最荒謬的真實操作、記仇小本本、契約清算、（V2）賽事單位聲明、結語
//   · V2 原文（標題、punchline、long）照原文套用，條件照 V2 的 requires＋EXTRA_REQUIRES；新寫的在 report-lines.ts
//   · 純文字：畫面一律用 textContent 顯示；玩家填的字原樣放進去，不當 HTML
//   · 沒有翻開的牌、棄牌那墩的牌面、讀心結果一律不會出現（只看公開紀錄；棄牌牌面只有雙方同意揭露才看，這裡不看）
import { DEFAULT_STAKE } from "../../server/protocol";
import { summarize, type MatchEvent } from "../copy/events";
import { candidates, fill as v2Fill, type Taste, type Vars as V2Vars } from "../copy/templates";
import { DIR_LABEL, cardText } from "../rules";
import { analyze } from "./analyze";
import { fill, hash, type Cast } from "./director";
import { R_ABSURD, R_CLOSING, R_CLOSING_DRAW, R_CONTRACT, R_HABITS, R_KEYBET, R_RESULT, R_TITLES, type RTpl } from "./report-lines";
import type { Beat, PublicMatch } from "./types";

export interface ReportSection { key: "result" | "keyBet" | "absurd" | "habits" | "contract" | "statement" | "closing"; label: string; lines: string[] }
export interface Report { gid: string; title: string; sections: ReportSection[]; text: string; ids: string[] }

// 標題：V2 的賽後事件 vs 新寫的條件標題，各有一個分數，挑分數最高、而且有合格句子的那一類
const V2_TITLE_SCORE: Partial<Record<MatchEvent, number>> = {
  finish_draw: 100, allin_loss: 94, last_trick_comeback: 93, allin_win: 90, bluff_verified: 85, vow_backfire: 76,
  tie_pool: 70, fold_win: 58, safeguard_save: 56, fold_streak: 52, finish_general: 10,
};
// 本場最荒謬：照荒謬程度
const ABSURD_SCORE: Record<string, number> = {
  insight_fold: 9, flip_lost: 8, fold_after_raiser: 7, raise_streak_more: 7, allin_folded: 6, safeguard_won: 6, tie_pool_grow: 5, fold_streak3: 5, lose_streak3: 4,
};

export function buildReport(m: PublicMatch, cast: Cast, gid: string, o: { taste?: Taste; footer?: string } = {}): Report | null {
  const res = m.result;
  if (!res) return null;
  const taste = o.taste ?? "chat";
  const { beats, stats } = analyze(m);
  const n = cast.names, ids: string[] = [];
  const draw = res.winner < 0, W = res.winner, L = draw ? -1 : 1 - res.winner;
  const stake = (s: number) => cast.stakes[s]?.trim() || DEFAULT_STAKE;
  const pick = <T extends RTpl>(key: string, pool: T[]): T => pool[hash(`${gid}:report:${key}`) % pool.length];
  const use = (tp: RTpl, vars: Record<string, string>) => { ids.push(tp.id); return fill(tp.text, vars); };
  const base: Record<string, string> = { p0: n[0], p1: n[1] };
  if (!draw) { base.win = n[W]; base.lose = n[L]; }
  const who = (s: number): Record<string, string> => (s >= 0 ? { p: n[s], o: n[1 - s] } : {});

  // 持有（手上＋疊池裡自己的出資）：每一墩結算後
  const hist = [...m.history].sort((a, b) => a.trick - b.trick);
  const after = (r: (typeof hist)[number]): [number, number] => [r.stacksAfter[0] + r.poolAfter[0], r.stacksAfter[1] + r.poolAfter[1]];
  const last = hist.at(-1)!;
  const fin = last.stacksAfter;

  // ---------------- V2：賽後事件、條件、變數 ----------------
  const sum = summarize({ history: m.history, result: res, folded: [] }, { vows: cast.vows, revealConsentBoth: false });
  const v2Vars = (e?: { keyTrick?: number; amount?: number; actor?: number; directionLabel?: string }): V2Vars => {
    const v: V2Vars = {};
    if (!draw) { v.winner = n[W]; v.loser = n[L]; v.loserStake = stake(L); if (cast.vows[L]?.trim()) v.loserVow = cast.vows[L].trim(); }
    if (e?.keyTrick) v.keyTrick = String(e.keyTrick);
    if (e?.amount !== undefined) v.amount = String(e.amount);
    if (e?.actor !== undefined && e.actor >= 0) v.actor = n[e.actor];
    if (e?.directionLabel) v.directionLabel = e.directionLabel;
    return v;
  };
  // order：要試的事件（照順序）；沒給就照 V2 的優先順序
  const v2 = (phase: "title" | "punchline" | "long", order?: MatchEvent[]): { text: string; event: MatchEvent } | null => {
    const list = order ? order.flatMap(t => sum.events.filter(e => e.type === t)) : sum.events;
    for (const e of list) {
      const vars = v2Vars(e);
      const c = candidates(e.type, phase, sum.facts, vars, taste);
      if (!c.length) continue;
      const x = c[hash(`${gid}:report:v2:${phase}:${e.type}`) % c.length];
      ids.push(x.id);
      return { text: v2Fill(x.text, vars), event: e.type };
    }
    return null;
  };

  // ---------------- 標題 ----------------
  const p2: { key: string; score: number; vars: Record<string, string> }[] = [];
  if (!draw) {
    // 勝者最多落後幾枚（每墩結算後看）
    let worst = 0, from = 0;
    for (const r of hist) { const h = after(r); const d = h[W] - h[L]; if (d < worst) { worst = d; from = h[W]; } }
    if (-worst >= 6) p2.push({ key: "bigComeback", score: 92, vars: { gap: String(-worst), from: String(from) } });
    if (res.reason === "elimination" && res.trick <= 6) p2.push({ key: "earlyKO", score: 88, vars: { trick: String(res.trick) } });
  }
  const streaker = [0, 1].filter(s => stats.seats[s].maxRaiseStreak >= 4).sort((a, b) => stats.seats[b].maxRaiseStreak - stats.seats[a].maxRaiseStreak)[0];
  if (streaker !== undefined) p2.push({ key: "raiseStreak", score: 80, vars: { ...who(streaker), streak: String(stats.seats[streaker].maxRaiseStreak) } });
  const insF = beats.find(b => b.type === "insight_fold");
  if (insF) p2.push({ key: "insightFold", score: 74, vars: { ...who(insF.seat) } });
  if (stats.maxPool.size >= 6) p2.push({ key: "bigPool", score: 72, vars: { pool: String(stats.maxPool.size) } });
  const flipL = beats.filter(b => b.type === "flip_lost").at(-1);
  if (flipL) p2.push({ key: "flipLost", score: 66, vars: { ...who(flipL.seat) } });
  const folder = [0, 1].filter(s => stats.seats[s].folds >= 4).sort((a, b) => stats.seats[b].folds - stats.seats[a].folds)[0];
  if (folder !== undefined) p2.push({ key: "manyFolds", score: 62, vars: { ...who(folder), n: String(stats.seats[folder].folds) } });
  p2.sort((a, b) => b.score - a.score);
  const topV2 = sum.events.find(e => candidates(e.type, "title", sum.facts, v2Vars(e), taste).length);
  const v2Score = topV2 ? V2_TITLE_SCORE[topV2.type] ?? 0 : -1;
  let title: string, titleEvent: MatchEvent | null = null;
  if (p2.length && p2[0].score > v2Score) title = use(pick(`title:${p2[0].key}`, R_TITLES[p2[0].key]), { ...base, ...p2[0].vars });
  else { const x = topV2 ? v2("title", [topV2.type]) : null; title = x?.text ?? (draw ? "平手" : `${n[W]}獲勝`); titleEvent = x?.event ?? null; }

  // ---------------- 結果 ----------------
  const resultLine = draw
    ? use(R_RESULT.draw, { ...base, h0: String(fin[0]) })
    : res.reason === "elimination"
      ? use(R_RESULT.elimination, { ...base, trick: String(res.trick) })
      : use(R_RESULT.nine, { ...base, h0: String(fin[0]), h1: String(fin[1]) });

  // ---------------- 關鍵一注：雙方都押進去、而且翻了牌的最大一注 ----------------
  const kb = stats.biggestBet;
  const keyLines: string[] = [];
  if (kb) {
    const r = hist.find(x => x.trick === kb.trick)!;
    const raised = r.steps.some(s => s.act === "raise");
    const v = { ...base, trick: String(kb.trick), amount: String(kb.amount), allin: kb.allIn ? "（梭哈）" : "", dir: DIR_LABEL[r.dir] };
    if (!raised && kb.amount <= r.ante) keyLines.push(use(pick("key:small", R_KEYBET.small), v));
    else if (kb.winner < 0) keyLines.push(use(pick("key:tie", R_KEYBET.tie), v));
    else {
      const cards = r.cards!;
      keyLines.push(use(pick("key:won", R_KEYBET.won), { ...v, win: n[kb.winner], cardW: cardText(cards[kb.winner]), cardL: cardText(cards[1 - kb.winner]) }));
      keyLines.push(use(pick("key:tail", R_KEYBET.tail), v));
    }
  }

  // ---------------- 本場最荒謬的真實操作 ----------------
  type Cand = { kind: string; b: Beat; vars: Record<string, string> };
  const cands: Cand[] = [];
  for (const b of beats) {
    const v = { ...base, ...who(b.seat), trick: String(b.trick) };
    if (b.type === "insight_fold") cands.push({ kind: "insight_fold", b, vars: v });
    else if (b.type === "flip_lost" && b.data.dir) cands.push({ kind: "flip_lost", b, vars: { ...v, dir: DIR_LABEL[b.data.dir] } });
    else if (b.type === "fold_after_raiser") cands.push({ kind: "fold_after_raiser", b, vars: { ...v, n: String(b.data.count ?? 0) } });
    else if (b.type === "raise_streak_more") cands.push({ kind: "raise_streak_more", b, vars: { ...v, streak: String(b.data.streak), from: String(b.trick - (b.data.streak ?? 0) + 1) } });
    else if (b.type === "allin_folded") cands.push({ kind: "allin_folded", b, vars: { ...v, amount: String(b.data.to) } });
    else if (b.type === "safeguard_result" && b.data.winner === b.seat) cands.push({ kind: "safeguard_won", b, vars: v });
    else if (b.type === "tie_pool_grow") cands.push({ kind: "tie_pool_grow", b, vars: { ...v, pool: String(b.data.pool) } });
    else if (b.type === "fold_streak3") cands.push({ kind: "fold_streak3", b, vars: { ...v, from: String(b.trick - 2) } });
    else if (b.type === "lose_streak3") cands.push({ kind: "lose_streak3", b, vars: v });
  }
  // 連續加注只留最長的那一次
  cands.sort((a, b) => ABSURD_SCORE[b.kind] - ABSURD_SCORE[a.kind] || (b.b.data.streak ?? 0) - (a.b.data.streak ?? 0) || b.b.trick - a.b.trick);
  const ab = cands[0];
  const absurd = ab ? use(pick(`absurd:${ab.kind}`, R_ABSURD[ab.kind]), ab.vars) : use(R_ABSURD.none[0], base);

  // ---------------- 記仇小本本：每人最多兩條、全部最多三條；兩邊都有的話各至少一條 ----------------
  type Habit = { seat: number; kind: string; w: number; vars: Record<string, string> };
  const habits: Habit[] = [];
  for (const s of [0, 1]) {
    const st = stats.seats[s], v = { ...base, ...who(s) };
    if (st.raises >= 4) habits.push({ seat: s, kind: "manyRaises", w: 10 + st.raises, vars: { ...v, n: String(st.raises) } });
    if (st.raises === 0 && stats.tricksSettled >= 5) habits.push({ seat: s, kind: "noRaise", w: 9, vars: v });
    if (st.folds >= 3) habits.push({ seat: s, kind: "manyFolds", w: 8 + st.folds, vars: { ...v, n: String(st.folds) } });
    if (st.allIns >= 1) habits.push({ seat: s, kind: "allIns", w: 7 + st.allIns, vars: { ...v, n: String(st.allIns) } });
    if (st.allInCalls >= 1) habits.push({ seat: s, kind: "calledAllIn", w: 6 + st.allInCalls, vars: { ...v, n: String(st.allInCalls) } });
    if (st.maxLoseStreak >= 3) habits.push({ seat: s, kind: "loseStreak", w: 5 + st.maxLoseStreak, vars: { ...v, n: String(st.maxLoseStreak) } });
    const fl = st.flips.at(-1);
    if (fl && fl.outcome !== "pending" && fl.outcome !== "tie") habits.push({ seat: s, kind: fl.outcome === "won" ? "flipWon" : "flipLost", w: 4, vars: v });
    if (st.won > st.lost && st.won >= 3) habits.push({ seat: s, kind: "winsMore", w: 1, vars: { ...v, n: String(st.won), m: String(st.lost) } });
  }
  habits.sort((a, b) => b.w - a.w || a.seat - b.seat);
  const chosen: Habit[] = [];
  for (const s of [0, 1]) { const h = habits.find(x => x.seat === s); if (h) chosen.push(h); }
  for (const h of habits) { if (chosen.length >= 3) break; if (!chosen.includes(h) && chosen.filter(x => x.seat === h.seat).length < 2) chosen.push(h); }
  chosen.sort((a, b) => b.w - a.w);
  const habitLines = chosen.map(h => use(pick(`habit:${h.kind}:${h.seat}`, R_HABITS[h.kind]), h.vars));

  // ---------------- 契約清算 ----------------
  const contract: string[] = [];
  if (draw) contract.push(use(R_CONTRACT.draw, base));
  else contract.push(use(stake(L) === DEFAULT_STAKE ? R_CONTRACT.payDefault : R_CONTRACT.pay, { ...base, stake: stake(L) }));
  for (const s of [0, 1]) {
    const vow = cast.vows[s]?.trim();
    if (!vow) continue;
    contract.push(use(draw ? R_CONTRACT.vowDraw : s === W ? R_CONTRACT.vowWon : R_CONTRACT.vowLost, { ...base, ...who(s), vow }));
  }
  contract.push(use(R_CONTRACT.note, base));

  // ---------------- V2 賽事單位聲明（長篇）與結語 ----------------
  //   聲明：先跟標題同一件事，再照 V2 的優先順序（疊池那種中途的事排最後）；結語：跟標題同一件事，不然用一般收尾
  //   豪言已經在契約清算列出來了：結語不再重複講豪言
  const rest = sum.events.map(e => e.type).filter(t => t !== "tie_pool" && t !== titleEvent);
  const statement = v2("long", [...(titleEvent ? [titleEvent] : []), ...rest, "tie_pool"]);
  const ending: MatchEvent[] = [...(titleEvent && titleEvent !== "vow_backfire" ? [titleEvent] : []), "finish_draw", "finish_general"];
  const closing = v2("punchline", ending)?.text ?? use(pick("closing", draw ? R_CLOSING_DRAW : R_CLOSING), base);

  const sections: ReportSection[] = [
    { key: "result", label: "結果", lines: [resultLine] },
    ...(keyLines.length ? [{ key: "keyBet" as const, label: "關鍵一注", lines: keyLines }] : []),
    { key: "absurd", label: "本場最荒謬", lines: [absurd] },
    ...(habitLines.length ? [{ key: "habits" as const, label: "記仇小本本", lines: habitLines }] : []),
    { key: "contract", label: "契約清算", lines: contract },
    ...(statement ? [{ key: "statement" as const, label: "賽事單位聲明", lines: statement.text.split("\n") }] : []),
    { key: "closing", label: "結語", lines: [closing] },
  ];
  const text = [
    "《梭了啦！這局賭什麼？》賽後戰報",
    `【${title}】`,
    "",
    ...sections.flatMap(s => (s.key === "closing" ? ["", `— ${s.lines[0]}`] : s.lines.length === 1 && s.key !== "statement" ? [`${s.label}｜${s.lines[0]}`] : ["", s.label, ...s.lines.map(l => (s.key === "statement" ? l : `・${l}`))])),
    ...(o.footer ? ["", o.footer] : []),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return { gid, title, sections, text, ids };
}
