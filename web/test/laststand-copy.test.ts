// 《逆命賭局》文案事件判定與模板條件：原文不動、每個事件都有判定、會講錯事的句子被擋下、未同意揭露不洩漏棄牌
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LastStandGame } from "../src/laststand/engine";
import { EVENT_RULES, MATCH_PRIORITY, holdingsAfter, liveEventsOfTrick, summarize } from "../src/laststand/copy/events";
import { ENTRIES, EXTRA_REQUIRES, ORIGINAL, TASTES, Taste, Vars, candidates, fill } from "../src/laststand/copy/templates";
import { playMatch } from "../src/laststand/sim";
import { STRATEGIES } from "../src/laststand/ai";
import { Dir, compare } from "../src/laststand/rules";

const C = (rank: number, suit = 0) => suit * 13 + (rank - 2);

describe("原始文案資料保留不動", () => {
  it("74 則、編號連續；檔案內容沒被改；額外條件只加在 requires，文字一字不改", () => {
    const text = readFileSync("src/laststand/copy/laststand_v2_copywriting.json", "utf8");
    // 跟使用者提供的原始檔（laststand_v2_copywriting.json）位元組完全相同
    expect(createHash("sha256").update(text).digest("hex")).toBe("865d8a09ad82290735cde15aca887513ae6f28dafec4f47883c3f94026a7becf");
    expect(ORIGINAL).toEqual(JSON.parse(text).entries);
    expect(ORIGINAL.map(e => e.id)).toEqual(Array.from({ length: 74 }, (_, i) => `V2-${String(i + 1).padStart(3, "0")}`));
    ENTRIES.forEach((e, i) => { expect(e.text).toBe(ORIGINAL[i].text); expect(e.event).toBe(ORIGINAL[i].event); });
    for (const id of ["V2-038", "V2-035", "V2-065", "V2-033", "V2-034", "V2-064", "V2-049", "V2-027", "V2-069", "V2-068", "V2-061", "V2-063", "V2-040"])
      expect(EXTRA_REQUIRES[id], id).toBeTruthy();
  });
  it("每一個用到的事件都有判定方式（含原本沒定義的 18 個）", () => {
    for (const e of ORIGINAL) expect(EVENT_RULES[e.event], e.event).toBeTruthy();
    for (const k of ["comeback", "fold_streak", "vow_echo", "allin_announced", "allin_called", "fold_after_raise", "pool_win", "final_trick", "chip_zero"])
      expect(EVENT_RULES[k as keyof typeof EVENT_RULES]).toBeTruthy();
    expect(MATCH_PRIORITY[1]).toBe("allin_loss");
  });
});

// 跑很多場 AI 對局，產生戰報事實，檢查每一句可以用的文案都對得上真的發生的事
describe("文案只講真的發生過的事（AI 對局 1200 場）", () => {
  const names = Object.keys(STRATEGIES);
  const vowsOf = (i: number): [string, string] => [i % 3 === 0 ? "我不可能輸" : "", i % 4 === 0 ? "你最好不要哭" : ""];
  const runs: { g: LastStandGame; consent: boolean; vows: [string, string] }[] = [];
  for (let i = 0; i < 1200; i++) {
    const { g } = playMatch(STRATEGIES[names[i % names.length]], STRATEGIES[names[(i * 7 + 3) % names.length]], 5000 + i);
    runs.push({ g, consent: i % 2 === 0, vows: vowsOf(i) });
  }

  it("事實自己重算一次：九墩、領先、梭哈全推、逆轉都跟紀錄一致", () => {
    let checked = 0;
    for (const { g, consent, vows } of runs) {
      const s = g.s, h = s.history, { facts, events } = summarize(s, { vows, revealConsentBoth: consent });
      expect(facts.fullNine).toBe(s.result!.trick === 9);
      if (facts.draw) { expect(events.map(e => e.type)).toEqual(["finish_draw"]); continue; }
      const W = facts.winner, L = facts.loser;
      for (const ev of events) {
        const r = ev.keyTrick ? h[ev.keyTrick - 1] : null;
        switch (ev.type) {
          case "allin_loss": expect(r!.allIn).toBe(L); expect(r!.outcome).toBe("showdown"); expect(r!.winner).toBe(W);
            expect(facts.allInWholeStack).toBe(r!.commit[L] === r!.startStacks[L]); break;
          case "allin_win": expect(r!.allIn).toBe(W); expect(r!.winner).toBe(W); {
            const b = holdingsAfter(h, r!.trick - 1); expect(facts.loserLedBeforeKey).toBe(b[L] > b[W]); expect(facts.keyTrickIsFinal).toBe(r!.trick === 9); } break;
          case "last_trick_comeback": { expect(facts.fullNine).toBe(true); const b = holdingsAfter(h, 8); expect(b[W]).toBeLessThanOrEqual(b[L]); } break;
          case "fold_win": expect(r!.outcome).toBe("fold"); expect(r!.folder).toBe(L); expect(r!.steps.some(x => x.act === "raise" && x.seat === W)).toBe(true); break;
          case "bluff_verified": {
            expect(consent).toBe(true);
            const f = s.folded.find(x => x.trick === r!.trick)!;
            expect(compare(f.cards[L], f.cards[W], r!.dir as Dir)).toBe(1); } break;
          case "tie_pool": expect(r!.outcome).toBe("tie"); expect(r!.refund).toBeNull(); expect(r!.poolAfter[0] + r!.poolAfter[1]).toBeGreaterThanOrEqual(4); break;
          case "safeguard_save": expect(r!.safeguardBy).toBe(ev.actor); expect(r!.winner).toBe(1 - ev.actor!); expect(r!.ante - r!.stake).toBeGreaterThanOrEqual(2); break;
          case "vow_backfire": expect(vows[L]).not.toBe(""); break;
          case "fold_streak": expect(h.filter(x => x.outcome === "fold" && x.folder === L).length).toBeGreaterThanOrEqual(3); break;
        }
        checked++;
      }
      if (facts.loserLedAllEight) for (let t = 1; t <= 8; t++) { const x = holdingsAfter(h, t); expect(x[L]).toBeGreaterThan(x[W]); }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("可以用的句子：不會在提前結束時講「九墩」「八墩」；梭哈「全部」只在真的全推時；未同意揭露不出現「原本會贏」類句子；變數一定填得滿", () => {
    const seen = new Set<string>();
    for (const { g, consent, vows } of runs) {
      const { facts, events } = summarize(g.s, { vows, revealConsentBoth: consent });
      const names: [string, string] = ["大雞", "小美"];
      for (const ev of events) {
        const vars: Vars = {
          winner: facts.winner >= 0 ? names[facts.winner] : undefined, loser: facts.loser >= 0 ? names[facts.loser] : undefined,
          loserStake: "阿嬤的藍白拖", loserVow: facts.loser >= 0 && vows[facts.loser] ? vows[facts.loser] : undefined,
          keyTrick: ev.keyTrick ? String(ev.keyTrick) : undefined, amount: ev.amount !== undefined ? String(ev.amount) : undefined,
        };
        for (const taste of Object.keys(TASTES) as Taste[]) for (const phase of ["title", "punchline", "long"] as const) {
          for (const e of candidates(ev.type, phase, facts, vars, taste)) {
            seen.add(e.id);
            const text = fill(e.text, vars);
            expect(text, e.id).not.toMatch(/\{\w+\}/);
            if (!facts.fullNine) expect(text, e.id).not.toMatch(/九墩|八墩/);
            if (/全部推|全部押/.test(e.text)) expect(facts.allInWholeStack, e.id).toBe(true);
            if (/會贏|能贏/.test(e.text)) expect(consent, e.id).toBe(true);
            if (/領先|優勢|勝者名單|更換勝者/.test(e.text) && ev.type !== "finish_general") expect(facts.loserLedBeforeFinal || facts.loserLedBeforeKey || facts.loserLedAllEight, e.id).toBe(true);
          }
        }
      }
    }
    // 大部分賽後文案在這些對局裡真的有機會被用到
    expect(seen.size).toBeGreaterThan(30);
  });
});

describe("對局中的事件判定（指定牌局）", () => {
  const H = (cards: number[]) => cards;
  it("梭哈被接、同點進疊池、下一墩拿走疊池、領先換人", () => {
    const A = H([C(14, 0), C(9, 0), C(8, 0), C(13, 0), C(10, 0), C(7, 0), C(6, 0), C(5, 0), C(4, 0)]);
    const B = H([C(9, 1), C(14, 1), C(12, 1), C(11, 1), C(10, 1), C(8, 1), C(6, 1), C(3, 1), C(2, 1)]);
    const g = LastStandGame.setup({ hands: [A, B], directions: Array(9).fill("high") as Dir[], coin: 0 });
    const s = g.s;
    s.stacks = [10, 20]; s.trick = 6;
    (g as unknown as { beginTrick(): void }).beginTrick();
    const pass = () => { while (s.phase === "flip" || s.phase === "safeguard") g.act(s.toAct, s.phase === "flip" ? { t: "flip", flip: false } : { t: "safeguard", use: false }); };
    pass(); g.act(0, { t: "lock", card: C(9, 0) }); g.act(1, { t: "lock", card: C(9, 1) });        // 第 7 墩：9 對 9 同點（雙方過牌）
    g.act(g.firstBettor(), { t: "check" }); g.act(1 - g.firstBettor(), { t: "check" });
    expect(liveEventsOfTrick(s.history, 7).map(e => e.type)).toContain("tie");
    pass(); g.act(0, { t: "lock", card: C(14, 0) }); g.act(1, { t: "lock", card: C(12, 1) });       // 第 8 墩：A 贏，拿走疊池
    const fb = g.firstBettor();
    g.act(fb, { t: "raise", to: g.legal(fb).raise![1] }); g.act(1 - fb, { t: "call" });
    const ev = liveEventsOfTrick(s.history, 8);
    expect(ev.map(e => e.type)).toEqual(expect.arrayContaining(["allin_announced", "allin_called", "pool_win"]));
    expect(ev.find(e => e.type === "pool_win")!.actor).toBe(0);
    const comeback = ev.find(e => e.type === "comeback");
    expect(comeback?.actor).toBe(0);                                 // 原本 10：20 落後，結算後領先
  });
  it("豪言回收：有填豪言的人第 5 墩以後持有 ≤ 9 才觸發；沒填的人不會", () => {
    const g = LastStandGame.setup({ hands: [[C(2, 0), C(3, 0), C(4, 0), C(5, 0), C(6, 0), C(7, 0), C(8, 0), C(9, 0), C(10, 0)], [C(14, 1), C(13, 1), C(12, 1), C(11, 1), C(10, 1), C(9, 1), C(8, 1), C(7, 1), C(6, 1)]],
      directions: Array(9).fill("high") as Dir[], coin: 0 });
    const s = g.s;
    for (let t = 1; t <= 6 && !g.over; t++) {
      while (s.phase === "flip" || s.phase === "safeguard") g.act(s.toAct, s.phase === "flip" ? { t: "flip", flip: false } : { t: "safeguard", use: false });
      g.act(0, { t: "lock", card: s.hands[0][0] }); g.act(1, { t: "lock", card: s.hands[1][0] });
      if (s.phase === "bet") { const fb = g.firstBettor(); g.act(fb, { t: "check" }); g.act(1 - fb, { t: "check" }); }     // 只押底注，慢慢輸
    }
    const t = s.history.findIndex((r, i) => i + 1 >= 5 && r.stacksAfter[0] + r.poolAfter[0] <= 9) + 1;
    expect(t).toBeGreaterThanOrEqual(5);
    expect(liveEventsOfTrick(s.history, t, ["我不可能輸", ""]).some(e => e.type === "vow_echo" && e.actor === 0)).toBe(true);
    expect(liveEventsOfTrick(s.history, t, ["", ""]).some(e => e.type === "vow_echo")).toBe(false);
    expect(liveEventsOfTrick(s.history, t, ["我不可能輸", ""], true).some(e => e.type === "vow_echo")).toBe(false);
  });
});
