// P2 事件導演 × 大量電腦對局：每一步都餵給導演，檢查
//   · 雙方看到的公開資料一模一樣（導演跑在誰的手機上都演一樣的戲）
//   · 演出不提到還沒翻開的牌、沒有沒填到的 {變數}
//   · 中場節目：打超過第四墩的對局剛好一次，提前結束的不播
//   · 斷線重整（中途從畫面重建、不出聲）後，接下來的演出跟一路看下來的一模一樣
//   · 同一場裡同一句話盡量不重複；統計每場大約演多少
import { describe, expect, it } from "vitest";
import { STRATEGIES } from "../src/laststand/ai";
import { Action, LastStandGame, LSView, actorsNow } from "../src/laststand/engine";
import { cardText, seededRng } from "../src/laststand/rules";
import { publicOf } from "../src/laststand/director/analyze";
import { Director, type Cast } from "../src/laststand/director/director";
import type { Cue } from "../src/laststand/director/types";

const NAMES = Object.keys(STRATEGIES);
const CASTS: Cast[] = [
  { names: ["大雞", "小美"], stakes: ["", ""], vows: ["", ""] },
  { names: ["阿明", "阿華"], stakes: ["一杯珍奶", "洗一週碗"], vows: ["這局我閉著眼睛都能贏", ""] },
  { names: ["P1", "P2"], stakes: ["", "幫對方按讚"], vows: ["", "輸了我直播吃辣"] },
];
const texts = (cs: Cue[]) => cs.map(c => [c.title ?? "", ...c.lines.map(l => (l.who ? `${l.who}：` : "") + l.text)].join("／"));

function run(seed: number) {
  const rng = seededRng(seed);
  const g = LastStandGame.newMatch(rng);
  const s0 = STRATEGIES[NAMES[seed % NAMES.length]], s1 = STRATEGIES[NAMES[(seed * 7 + 3) % NAMES.length]];
  const views: LSView[] = [g.viewFor(0)];
  const sides: [LSView, LSView][] = [[g.viewFor(0), g.viewFor(1)]];
  let guard = 0;
  while (!g.over && ++guard < 400) {
    for (const seat of actorsNow(g)) {
      if (g.over || !actorsNow(g).includes(seat)) continue;
      const a: Action = (seat ? s1 : s0)(g.viewFor(seat), rng);
      const r = g.act(seat, a);
      if (!r.ok) throw new Error(`第 ${seed} 場不合法：${r.msg}`);
      views.push(g.viewFor(0));
      sides.push([g.viewFor(0), g.viewFor(1)]);
    }
  }
  return { g, views, sides, hands: [...g.s.hands[0], ...g.s.hands[1], ...g.s.history.flatMap(r => r.cards ?? [])] };
}

describe("P2 事件導演 × 300 場電腦對局", () => {
  const N = 300;
  const stats = { beats: 0, cues: 0, cards: 0, chat: 0, anchor: 0, notice: 0, mids: 0, longMatches: 0, dupLines: 0, lines: 0, maxCuesOneStep: 0, programs: {} as Record<string, number> };

  it("每一步：公開資料雙方一致、不提未翻開的牌、沒有沒填的變數；中場節目剛好一次", () => {
    for (let seed = 1; seed <= N; seed++) {
      const { g, views, sides } = run(seed);
      const cast = CASTS[seed % CASTS.length];
      const d = new Director(`sim-${seed}`, cast);
      const allCards = new Set<number>();
      for (const v of views) for (const c of v.hand) allCards.add(c);
      for (const [a, b] of sides) for (const c of b.hand) allCards.add(c), void a;
      const shown = new Set<string>();
      let beatsN = 0;
      for (let i = 0; i < views.length; i++) {
        const [v0, v1] = sides[i];
        expect(publicOf(v1)).toEqual(publicOf(v0));
        const { cues, analysis } = d.update(publicOf(v0));
        beatsN = analysis.beats.length;
        const revealed = new Set(v0.history.flatMap(r => r.cards ?? []));
        const ts = texts(cues);
        stats.maxCuesOneStep = Math.max(stats.maxCuesOneStep, cues.length);
        expect(cues.filter(c => c.channel === "card").length).toBeLessThanOrEqual(1);
        if (analysis.beats.some(b => b.type === "intermission") && v0.history.length === 4 && sides[i - 1]?.[0].history.length === 3) expect(cues.filter(c => c.channel === "card").map(c => c.id)).toEqual(["4:intermission"]);
        for (const t of ts) {
          expect(t).not.toMatch(/\{\w+\}/);
          for (const c of allCards) if (!revealed.has(c)) expect(t.includes(cardText(c)), `第 ${seed} 場提到還沒翻的 ${cardText(c)}：${t}`).toBe(false);
        }
        for (const c of cues) {
          stats.cues++;
          if (c.channel === "card") { stats.cards++; stats.programs[c.program ?? "?"] = (stats.programs[c.program ?? "?"] ?? 0) + 1; }
          else stats[c.channel]++;
          if (c.id === "4:intermission") stats.mids++;
          if (c.channel !== "card") for (const l of c.lines) { stats.lines++; if (shown.has(l.text)) stats.dupLines++; shown.add(l.text); }
        }
      }
      stats.beats += beatsN;
      if (g.s.result!.trick > 4) stats.longMatches++;
    }
    expect(stats.mids).toBe(stats.longMatches);
    const per = (x: number) => +(x / N).toFixed(1);
    const report = {
      matches: N, beatsPerMatch: per(stats.beats), cuesPerMatch: per(stats.cues), cardsPerMatch: per(stats.cards),
      chat: per(stats.chat), anchor: per(stats.anchor), notice: per(stats.notice), programs: stats.programs,
      intermissions: `${stats.mids}/${stats.longMatches}`, repeatedLineRate: +(stats.dupLines / Math.max(1, stats.lines)).toFixed(3), maxCuesOneStep: stats.maxCuesOneStep,
    };
    console.log("P2 導演統計", JSON.stringify(report));
    // 節奏：每場有戲但不洗版；一個動作最多一張小卡＋兩句
    expect(report.cuesPerMatch).toBeGreaterThan(6);
    expect(report.cuesPerMatch).toBeLessThan(45);
    expect(stats.maxCuesOneStep).toBeLessThanOrEqual(1 + 3);
    expect(report.repeatedLineRate).toBeLessThan(0.08);
  }, 120_000);

  it("斷線重整：從任何一步不出聲重建後，接下來的演出跟一路看下來的一模一樣", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { views } = run(seed);
      const cast = CASTS[seed % CASTS.length];
      const full = new Director(`re-${seed}`, cast);
      const per = views.map(v => texts(full.update(publicOf(v)).cues));
      const k = 1 + (seed * 13) % (views.length - 1);
      const d = new Director(`re-${seed}`, cast);
      d.update(publicOf(views[k]), true);
      const after: string[][] = views.slice(k + 1).map(v => texts(d.update(publicOf(v)).cues));
      expect(after, `第 ${seed} 場從第 ${k} 步重建`).toEqual(per.slice(k + 1));
    }
  }, 60_000);

  it("同一場、同一個對局編號：兩台手機各自跑導演，選到的文案完全一樣", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { sides } = run(seed);
      const cast = CASTS[seed % CASTS.length];
      const a = new Director(`two-${seed}`, cast), b = new Director(`two-${seed}`, cast);
      for (const [v0, v1] of sides) expect(texts(b.update(publicOf(v1)).cues)).toEqual(texts(a.update(publicOf(v0)).cues));
    }
  });
});
