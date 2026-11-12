// P2-C 賽後戰報：只講真的發生的事、同一場一定同一份、雙方看到的一樣、不洩漏沒翻開的牌、V2 原文照原文
import { describe, expect, it } from "vitest";
import { STRATEGIES } from "../src/laststand/ai";
import { LastStandGame, LSView, actorsNow } from "../src/laststand/engine";
import { cardText, seededRng } from "../src/laststand/rules";
import { DEFAULT_STAKE } from "../src/server/protocol";
import { publicOf } from "../src/laststand/director/analyze";
import type { Cast } from "../src/laststand/director/director";
import { buildReport } from "../src/laststand/director/report";
import { ORIGINAL } from "../src/laststand/copy/templates";

const NAMES = Object.keys(STRATEGIES);
const CASTS: Cast[] = [
  { names: ["大雞", "小美"], stakes: ["", ""], vows: ["", ""] },
  { names: ["阿明", "阿華"], stakes: ["一杯珍奶", "洗一週碗"], vows: ["這局我閉著眼睛都能贏", ""] },
  { names: ["<b>P1</b>", "P2"], stakes: ["<img src=x onerror=alert(1)>", "幫對方按讚"], vows: ["", "輸了我直播吃辣"] },
];
function run(seed: number) {
  const rng = seededRng(seed);
  const g = LastStandGame.newMatch(rng);
  const s = [STRATEGIES[NAMES[seed % NAMES.length]], STRATEGIES[NAMES[(seed * 5 + 1) % NAMES.length]]];
  let guard = 0;
  while (!g.over && ++guard < 400) for (const seat of actorsNow(g)) { if (g.over || !actorsNow(g).includes(seat)) continue; const r = g.act(seat, s[seat](g.viewFor(seat), rng)); if (!r.ok) throw new Error(r.msg); }
  return g;
}
const V2_IDS = new Set(ORIGINAL.map(e => e.id));

describe("P2-C 賽後戰報 × 300 場", () => {
  it("每一場都有戰報；同一場同一份；雙方看到的一樣；沒有沒填的變數；不提沒翻開的牌；契約、結果跟真的一樣", () => {
    const used = new Map<string, number>();
    const titles = new Map<string, number>();
    let v2Titles = 0, statements = 0, draws = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const g = run(seed);
      const cast = CASTS[seed % CASTS.length];
      const v0: LSView = g.viewFor(0), v1: LSView = g.viewFor(1);
      const a = buildReport(publicOf(v0), cast, `rep-${seed}`)!;
      const b = buildReport(publicOf(v1), cast, `rep-${seed}`)!;
      expect(a).not.toBeNull();
      expect(b).toEqual(a);
      expect(buildReport(publicOf(v0), cast, `rep-${seed}`)).toEqual(a);
      expect(a.text).not.toMatch(/\{\w+\}/);
      expect(a.title.length).toBeGreaterThan(0);
      // 沒翻開的牌：棄牌墩的牌、手上剩下的牌，一律不會出現
      const shown = new Set(v0.history.flatMap(r => r.cards ?? []));
      const all = [...g.s.hands[0], ...g.s.hands[1], ...g.s.history.flatMap(r => r.cards ?? []), ...g.s.folded.flatMap(f => f.cards)];
      for (const c of all) if (!shown.has(c)) expect(a.text.includes(cardText(c)), `第 ${seed} 場提到沒翻開的 ${cardText(c)}`).toBe(false);
      // 結果
      const res = g.s.result!, fin = g.s.history.at(-1)!.stacksAfter;
      const result = a.sections.find(s => s.key === "result")!.lines[0];
      if (res.winner < 0) { draws++; expect(result).toContain("平手"); expect(a.text).toContain("雙方契約各自保留"); }
      else {
        expect(result).toContain(`${cast.names[res.winner]}獲勝`);
        if (res.reason === "nine") expect(result).toContain(`${cast.names[0]} ${fin[0]} 枚`);
        else expect(result).toContain(`第 ${res.trick} 墩，${cast.names[1 - res.winner]}籌碼歸零`);
        // 契約：敗者交出自己的賭上之物（原樣）
        const st = cast.stakes[1 - res.winner].trim() || DEFAULT_STAKE;
        expect(a.sections.find(s => s.key === "contract")!.lines[0]).toContain(`${cast.names[1 - res.winner]}`);
        expect(a.sections.find(s => s.key === "contract")!.lines[0]).toContain(`『${st}』`);
      }
      // 豪言原樣
      for (const s of [0, 1]) if (cast.vows[s]) expect(a.text).toContain(`『${cast.vows[s]}』`);
      // 關鍵一注：跟紀錄裡「翻了牌、雙方都押進去」最大的一注一樣
      const matched = g.s.history.filter(r => r.outcome === "showdown" || r.outcome === "tie").map(r => Math.min(r.commit[0], r.commit[1]));
      const kb = a.sections.find(s => s.key === "keyBet");
      if (matched.length) expect(kb!.lines[0]).toContain(`各押 ${Math.max(...matched)} 枚`);
      for (const id of a.ids) used.set(id, (used.get(id) ?? 0) + 1);
      titles.set(a.title, (titles.get(a.title) ?? 0) + 1);
      if (a.ids.some(id => V2_IDS.has(id) && ORIGINAL.find(e => e.id === id)!.phase === "title")) v2Titles++;
      if (a.sections.some(s => s.key === "statement")) statements++;
    }
    const v2Used = [...used.keys()].filter(id => V2_IDS.has(id)).length, p2Used = [...used.keys()].filter(id => !V2_IDS.has(id)).length;
    console.log("P2-C 戰報統計", JSON.stringify({ matches: 300, draws, v2Titles, statements, distinctTitles: titles.size, v2TemplatesUsed: v2Used, p2TemplatesUsed: p2Used, topTitles: [...titles].sort((a, b) => b[1] - a[1]).slice(0, 6) }));
    expect(titles.size).toBeGreaterThan(10);
  });

  it("V2 原文：戰報裡用到的 V2 句子，填空之後跟原文逐字一致（只換變數）", () => {
    const g = run(7);
    const cast = CASTS[1];
    const r = buildReport(publicOf(g.viewFor(0)), cast, "rep-v2")!;
    const v2 = r.ids.filter(id => V2_IDS.has(id));
    expect(v2.length).toBeGreaterThan(0);
    for (const id of v2) {
      const e = ORIGINAL.find(x => x.id === id)!;
      const re = new RegExp("^" + e.text.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, "(.+?)") + "$", "s");
      const hit = r.title === "" ? false : [r.title, ...r.sections.flatMap(s => [s.lines.join("\n"), ...s.lines])].some(t => re.test(t));
      expect(hit, `${id} 原文沒有逐字出現`).toBe(true);
    }
  });

  it("比賽還沒結束：不產生戰報（結果類的東西只在結算之後）", () => {
    const rng = seededRng(3);
    const g = LastStandGame.newMatch(rng);
    expect(buildReport(publicOf(g.viewFor(0)), CASTS[0], "x")).toBeNull();
  });

  it("範例（給人看文案節奏用）", () => {
    for (const seed of [11, 42, 77]) {
      const g = run(seed);
      console.log(`\n—— 第 ${seed} 場 ——\n` + buildReport(publicOf(g.viewFor(0)), CASTS[seed % 3], `sample-${seed}`)!.text);
    }
  });
});
