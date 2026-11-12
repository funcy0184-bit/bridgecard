// 事件導演：把「新發生的敘事事件」變成要上畫面的演出（彈幕一句、主播一句、公告、節目小卡、中場節目）
//   · 純邏輯、沒有畫面：同樣的對局紀錄＋同一個場次編號 → 一定選到同樣的文案（雙方看到的一樣，重新整理也一樣）
//   · 文案選擇會記得這場用過哪些句子，盡量不重複；重新整理時用 update(..., silent) 從頭重跑一次選擇（不出聲），就接得上
//   · 先篩選「條件符合」的模板，再抽；沒有合適的就安全跳過（不硬湊）
import { DEFAULT_STAKE } from "../../server/protocol";
import { candidates as v2Candidates, fill as v2Fill, type Taste, type Vars as V2Vars } from "../copy/templates";
import { DIR_LABEL, TRICKS, cardText } from "../rules";
import { analyze, type Analysis } from "./analyze";
import { BEAT_PROGRAMS, PRIORITY, RHYTHM, programEnabled } from "./config";
import { LINES, type Tpl } from "./lines";
import type { Beat, BeatType, Channel, Cue, PublicMatch } from "./types";

export interface Cast { names: [string, string]; stakes: [string, string]; vows: [string, string] }

// 32-bit FNV-1a：同樣的字串永遠同樣的數字（抽文案、決定要不要補一句觀眾反應用）
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const chance = (key: string, p: number) => (hash(key) % 1000) / 1000 < p;

// V2 對局中文案對應到這裡的事件（V2 原文、原條件都不動）
const V2_LIVE: Partial<Record<BeatType | "vow_echo", string>> = {
  raise_first: "raise", raise: "raise", reraise: "reraise", call: "call", big_call: "call",
  fold: "fold", big_fold: "fold_after_raise", allin_folded: "fold_after_raise",
  allin_offer: "allin_announced", allin_called: "allin_called", allin_called_final: "allin_called",
  flip: "direction_flip", tie: "tie", pool_taken: "pool_win", safeguard: "safeguard", insight: "insight",
  comeback: "comeback", final_trick: "final_trick", eliminated: "chip_zero", vow_echo: "vow_echo",
};
const V2_CHANNEL: Record<string, Channel> = { chat: "chat", streamer: "chat", tts: "chat", absurd: "chat", deadpan: "notice", announcement: "notice", sports: "anchor" };

type AnyBeat = Beat | (Omit<Beat, "type"> & { type: "vow_echo" });

export class Director {
  private seen = new Set<string>();
  private used = new Set<string>();
  private occ = new Map<string, number>();
  private lastCardTrick = -99;
  private vowEchoed = false;

  constructor(readonly gid: string, public cast: Cast, private taste: Taste = "chat") {}

  // 新的牌桌資料進來：找出新發生的事、決定演什麼。silent＝只更新記憶不出聲（重新整理、斷線回來時用，舊新聞不重播）
  update(m: PublicMatch, silent = false): { cues: Cue[]; analysis: Analysis } {
    const analysis = analyze(m);
    const beats = this.withVowEcho(m, analysis.beats).filter(b => !this.seen.has(b.id));
    for (const b of beats) this.seen.add(b.id);
    const cues: Cue[] = [];
    // 同一個動作（同一墩、同一步）引發的幾件事放在一起：最重要的上主彈幕，第二重要的最多補一句
    const groups = new Map<string, AnyBeat[]>();
    for (const b of beats) { const k = b.id.split(":").slice(0, 2).join(":"); groups.set(k, [...(groups.get(k) ?? []), b]); }
    // 第四墩結算後有中場節目：那一墩的結算讓中場節目當唯一的小卡（看的是整場的事件，重新整理重建時判斷也一樣）
    const midAt4 = analysis.beats.some(b => b.type === "intermission");
    for (const [k, g] of groups) cues.push(...this.cuesFor(g.sort((a, b) => b.priority - a.priority || a.seq - b.seq), m, midAt4 && k === "4:end"));
    return { cues: silent ? [] : trimStep(cues), analysis };
  }

  // ---------------- 一組事件 → 演出 ----------------
  private cuesFor(g: AnyBeat[], m: PublicMatch, noCard = false): Cue[] {
    const out: Cue[] = [];
    const main = g[0];
    if (main.type === "intermission") { const c = this.intermission(m); return c ? [c] : []; }
    if (main.type === "match_start") { const c = this.contract(main); return c ? [c] : []; }
    // 不重要的小事：大多數時候安靜（保留冷場）
    if (main.priority <= 30 && !chance(`${this.gid}:${main.id}:quiet`, 0.4)) return out;
    let cardDone = noCard;
    for (const b of g) {
      if (out.filter(c => c.channel !== "card").length >= 2) break;
      if (b !== main && b.priority < 58) continue;
      // 節目小卡：夠重要、有對應節目、距離上一張夠遠
      if (!cardDone) {
        const progs = BEAT_PROGRAMS[b.type as BeatType] ?? [];
        const gapOk = b.trick - this.lastCardTrick >= RHYTHM.cardGapTricks || b.priority >= 90;
        if (progs.length && b.priority >= RHYTHM.cardMinPriority && gapOk && progs.some(programEnabled)) {
          const t = this.choose(b.type, LINES.filter(x => x.channel === "card" && x.program && programEnabled(x.program)), b);
          if (t) { out.push(this.cue(b, t, "card")); this.lastCardTrick = b.trick; cardDone = true; continue; }
        }
      }
      const t = this.chooseLine(b);
      if (t) out.push(this.cue(b, t, t.channel === "card" ? "anchor" : t.channel));
    }
    // 觀眾反應：下注壓力越高越常補一句
    const lv = Math.max(1, Math.min(4, main.data.level ?? 1)) as 1 | 2 | 3 | 4;
    if (out.length && out.length < 2 && main.priority >= 40 && chance(`${this.gid}:${main.id}:react`, RHYTHM.reactionChance[lv])) {
      const t = this.choose(`react${lv}`, LINES, main);
      if (t) out.push({ ...this.cue(main, t, "chat"), priority: 15, id: `${main.id}:react` });
    }
    return out;
  }

  // 一句話：新寫的文案＋對應的 V2 原文一起當候選
  private chooseLine(b: AnyBeat): Tpl | null {
    const pool = LINES.filter(x => x.channel !== "card");
    const v2 = V2_LIVE[b.type];
    let extra: Tpl[] = [];
    if (v2 && (v2 !== "fold_after_raise" || b.data.pressured)) {
      const vars = this.v2Vars(b);
      extra = v2Candidates(v2, "live", {}, vars, this.taste).map(e => ({ id: e.id, on: b.type as Tpl["on"], channel: V2_CHANNEL[e.style] ?? "chat", lines: [v2Fill(e.text, vars)] }));
    }
    return this.choose(b.type, [...pool, ...extra], b);
  }

  // 抽文案：先篩合格的（事件、條件、變數都要對），再從這場的固定起點輪著用，用過的跳過
  private choose(on: string, pool: Tpl[], b: AnyBeat): Tpl | null {
    const vars = this.vars(b), flags = this.flags(b);
    const ok = pool.filter(t => t.on === on && (t.need ?? []).every(f => flags.has(f)) && !(t.not ?? []).some(f => flags.has(f)) && filled(t, vars));
    if (!ok.length) return null;
    const n = this.occ.get(on) ?? 0;
    this.occ.set(on, n + 1);
    const start = hash(`${this.gid}:${on}`) % ok.length;
    for (let k = 0; k < ok.length; k++) {
      const t = ok[(start + n + k) % ok.length];
      if (!this.used.has(t.id)) { this.used.add(t.id); return t; }
    }
    return ok[(start + n) % ok.length];
  }

  private cue(b: AnyBeat, t: Tpl, channel: Channel): Cue {
    const vars = this.vars(b);
    const lines = t.lines.map(l => (typeof l === "string" ? { text: fill(l, vars) } : { who: l[0], text: fill(l[1], vars) }));
    const important = b.priority >= 80;
    return {
      id: `${b.id}:${t.id}`, beat: b.id, channel, program: t.program, priority: b.priority, level: b.data.level ?? 1,
      title: t.title ? fill(t.title, vars) : undefined, lines,
      ttl: channel === "card" ? Math.min(4200, Math.max(2400, 1200 + 650 * lines.length)) : important ? RHYTHM.importantTtl : RHYTHM.chatTtl, skippable: channel === "card",
    };
  }

  // ---------------- 開局：契約公證處 ----------------
  private contract(b: AnyBeat): Cue | null {
    const t = this.choose("match_start", LINES.filter(x => x.channel === "card"), b);
    return t ? this.cue(b, t, "card") : null;
  }

  // ---------------- 第四墩後：中場節目（先篩合格的類型，再抽；都不合格才播通用的專家分析） ----------------
  private intermission(m: PublicMatch): Cue | null {
    const upTo4: PublicMatch = { ...m, trick: 4, phase: "over", steps: [], history: m.history.filter(r => r.trick <= 4), result: null };
    const st = analyze(upTo4).stats;
    const h = st.holdings, gap = Math.abs(h[0] - h[1]);
    const raiser = [0, 1].filter(s => st.seats[s].maxRaiseStreak >= 3).sort((a, b) => st.seats[b].raises - st.seats[a].raises)[0];
    const types: { key: Tpl["on"]; b: Partial<Beat> }[] = [];
    if (raiser !== undefined) types.push({ key: "mid:raise", b: { seat: raiser, data: { streak: st.seats[raiser].maxRaiseStreak, count: st.seats[raiser].raises } } });
    if (gap >= 4) types.push({ key: "mid:trail", b: { seat: h[0] < h[1] ? 0 : 1, data: { after: [h[0], h[1]] } } });
    const r4 = m.history.find(r => r.trick === 4);
    const pool = r4 ? r4.poolAfter[0] + r4.poolAfter[1] : 0;
    if (pool > 0) types.push({ key: "mid:pool", b: { seat: -1, data: { pool } } });
    if (!types.length) types.push({ key: "mid:expert", b: { seat: -1, data: { after: [h[0], h[1]] } } });
    const pick = types[hash(`${this.gid}:intermission`) % types.length];
    const beat: Beat = { id: "4:intermission", seq: 0, type: "intermission", kind: "narrative", trick: 4, seat: pick.b.seat ?? -1, priority: PRIORITY.intermission, settled: true, reportable: false, data: pick.b.data ?? {} };
    const t = this.choose(pick.key, LINES.filter(x => x.channel === "card"), beat);
    if (!t) return null;
    return { ...this.cue(beat, t, "card"), id: "4:intermission", ttl: RHYTHM.intermissionTtl, priority: PRIORITY.intermission };
  }

  // 豪言回放：有填豪言的人，第 5 墩以後某墩結算後持有 ≤ 9 枚（每場最多一次；跟 V2 vow_echo 同一個條件）
  private withVowEcho(m: PublicMatch, beats: Beat[]): AnyBeat[] {
    if (this.vowEchoed) return beats;
    for (const r of [...m.history].sort((a, b) => a.trick - b.trick)) {
      if (r.trick < 5) continue;
      const after = [r.stacksAfter[0] + r.poolAfter[0], r.stacksAfter[1] + r.poolAfter[1]];
      const p = [0, 1].find(s => this.cast.vows[s]?.trim() && after[s] <= 9);
      if (p === undefined) continue;
      const last = beats.filter(b => b.trick === r.trick).reduce((x, b) => Math.max(x, b.seq), 0);
      const echo: AnyBeat = { id: `${r.trick}:end:vow_echo`, seq: last + 0.5, type: "vow_echo", kind: "narrative", trick: r.trick, seat: p, priority: 58, settled: true, reportable: true, data: {} };
      this.vowEchoed = true;
      return [...beats, echo].sort((a, b) => a.seq - b.seq);
    }
    return beats;
  }

  // ---------------- 填空的值、條件 ----------------
  private vars(b: AnyBeat): Record<string, string> {
    const n = this.cast.names, d = b.data, s = b.seat;
    const v: Record<string, string> = { trick: String(b.trick), p0: n[0], p1: n[1] };
    if (s >= 0) { v.p = n[s]; v.o = n[1 - s]; }
    if (d.to !== undefined) v.to = String(d.to);
    if (d.amount !== undefined) v.amount = String(d.amount);
    if (d.pool !== undefined) v.pool = String(d.pool);
    if (d.streak !== undefined) v.streak = String(d.streak);
    if (d.count !== undefined) v.count = String(d.count);
    if (d.dir) { v.dir = DIR_LABEL[d.dir]; v.dirword = d.dir === "high" ? "大" : "小"; }
    if (d.winner !== undefined && d.winner >= 0) { v.win = n[d.winner]; v.lose = n[1 - d.winner]; if (d.cards) { v.cardW = cardText(d.cards[d.winner]); v.cardL = cardText(d.cards[1 - d.winner]); } }
    const hold = d.after;
    if (hold) {
      if (s >= 0) { v.hp = String(hold[s]); v.ho = String(hold[1 - s]); }
      if (hold[0] !== hold[1]) { const l = hold[0] > hold[1] ? 0 : 1; v.lead = n[l]; v.trail = n[1 - l]; v.gap = String(Math.abs(hold[0] - hold[1])); }
      if (s >= 0 && d.before) { v.from = String(d.before[s]); v.now = String(hold[s]); }
    }
    // 契約
    const st = this.cast.stakes.map(x => x?.trim() || DEFAULT_STAKE);
    v.stake0 = st[0]; v.stake1 = st[1];
    const custom = [0, 1].filter(i => st[i] !== DEFAULT_STAKE);
    v.stakeX = custom.length ? st[custom.length === 1 ? custom[0] : hash(`${this.gid}:stakeX`) % 2] : st[0];
    const vs = [0, 1].filter(i => this.cast.vows[i]?.trim());
    if (b.type === "vow_echo" && s >= 0 && this.cast.vows[s]?.trim()) v.vow = this.cast.vows[s].trim();
    else if (vs.length) { const i = vs.length === 1 ? vs[0] : vs[hash(`${this.gid}:vow`) % 2]; v.vow = this.cast.vows[i].trim(); v.vowSeat = n[i]; }
    return v;
  }
  private flags(b: AnyBeat): Set<string> {
    const f = new Set<string>(), d = b.data, s = b.seat;
    if (d.winner !== undefined) {
      if (d.winner < 0) f.add("tieTrick"); else f.add("decidedTrick");
      if (s >= 0 && d.winner === s) f.add("won");
      if (s >= 0 && d.winner >= 0 && d.winner !== s) f.add("lost");
    }
    if ((d.amount ?? 0) >= 2) f.add("saved2");
    if (b.type === "match_over") f.add(d.winner !== undefined && d.winner >= 0 ? "decided" : "draw");
    const st = this.cast.stakes.map(x => x?.trim() || DEFAULT_STAKE);
    if (st[0] === DEFAULT_STAKE && st[1] === DEFAULT_STAKE) f.add("bothDefault");
    if (this.cast.vows.some(x => x?.trim())) f.add("hasVow");
    if (d.after) f.add(d.after[0] === d.after[1] ? "level" : "leading");
    if (b.trick === TRICKS) f.add("isFinal");
    return f;
  }
  private v2Vars(b: AnyBeat): V2Vars {
    const v: V2Vars = {};
    if (b.seat >= 0) v.actor = this.cast.names[b.seat];
    if (b.data.to !== undefined) v.amount = String(b.data.to);
    if (b.data.dir) v.directionLabel = DIR_LABEL[b.data.dir];
    return v;
  }
}

// 同一個動作引發的演出不洗版：最多一張小卡（中場節目優先）＋ RHYTHM.maxLinesPerStep 句，丟掉最不重要的，其餘照原本順序
//   只裁輸出、不影響文案記憶（選句子的過程照常跑完），所以重新整理重建時選到的句子還是一樣
function trimStep(cues: Cue[]): Cue[] {
  const rank = (c: Cue) => (c.id === "4:intermission" ? 1000 : c.priority);
  const cards = cues.filter(c => c.channel === "card").sort((a, b) => rank(b) - rank(a)).slice(0, 1);
  const lines = cues.filter(c => c.channel !== "card").map((c, i) => ({ c, i })).sort((a, b) => b.c.priority - a.c.priority || a.i - b.i).slice(0, RHYTHM.maxLinesPerStep);
  const keep = new Set<Cue>([...cards, ...lines.map(x => x.c)]);
  return cues.filter(c => keep.has(c));
}

// 填空：純文字取代；模板裡每個 {變數} 都要有值，不然這個模板不能用（不補造）
export const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
function filled(t: Tpl, vars: Record<string, string>): boolean {
  const all = [t.title ?? "", ...t.lines.map(l => (typeof l === "string" ? l : l[1]))].join("");
  return [...all.matchAll(/\{(\w+)\}/g)].every(x => typeof vars[x[1]] === "string" && vars[x[1]].length > 0);
}
