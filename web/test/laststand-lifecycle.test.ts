// P2.5-A 收尾：一墩的生命週期（伺服器事件 ↔ 每墩紀錄 ↔ 收到的牌桌畫面）
//   一墩結束時伺服器的順序：Showdown／FoldReveal → Settle／PoolAdd →（PoolRefund）→ 紀錄存檔 →
//   （Eliminated → MatchOver）或（TrickStart 下一墩）→ 最後才送 lsState（已經是下一墩的畫面）
//   這裡檢查：紀錄裡的方向、牌、贏家都跟事件一致、跟比大小規則一致；以及「收到畫面時，方向已經是下一墩的」有多常發生
import { describe, expect, it } from "vitest";
import { STRATEGIES } from "../src/laststand/ai";
import { LastStandGame, LSEvent, actorsNow } from "../src/laststand/engine";
import { compare, seededRng } from "../src/laststand/rules";

const NAMES = Object.keys(STRATEGIES);

describe("P2.5-A：一墩的生命週期（300 場）", () => {
  it("紀錄跟伺服器事件一致；結束畫面的方向就是最後一墩的方向；非最後一墩結算後，畫面的方向已經換成下一墩", () => {
    let tricks = 0, dirChangedAfter = 0, flips = 0, folds = 0, ties = 0, endChecked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const events: LSEvent[] = [];
      const rng = seededRng(seed);
      const g = LastStandGame.newMatch(rng, (e, to) => { if (to < 0 || to === 0) events.push(e); });
      const s = [STRATEGIES[NAMES[seed % NAMES.length]], STRATEGIES[NAMES[(seed * 7 + 2) % NAMES.length]]];
      let guard = 0;
      while (!g.over && ++guard < 400) for (const seat of actorsNow(g)) {
        if (g.over || !actorsNow(g).includes(seat)) continue;
        const before = g.s.history.length;
        g.act(seat, s[seat](g.viewFor(seat), rng));
        if (g.s.history.length > before) {
          // 剛結算完一墩：這時候送給手機的畫面
          const r = g.s.history.at(-1)!, v = g.viewFor(0);
          if (!v.result && v.dir !== r.dir) dirChangedAfter++;
          if (v.result) { expect(v.dir).toBe(r.dir); expect(v.trick).toBe(r.trick); endChecked++; }
        }
      }
      expect(g.over).toBe(true);
      for (const r of g.s.history) {
        tricks++;
        const ev = events.filter(e => e.trick === r.trick);
        const start = ev.find(e => e.type === "TrickStart")!, flip = ev.find(e => e.type === "Flip");
        // 方向：TrickStart 給的原方向，翻轉過就用 Flip 的；紀錄存的是比大小真正用的方向
        expect(r.dir).toBe(flip ? flip.dir : start.dir);
        if (flip) { flips++; expect(r.flippedBy).toBe(flip.seat); }
        if (r.outcome === "fold") {
          folds++;
          const fr = ev.find(e => e.type === "FoldReveal")!, st = ev.find(e => e.type === "Settle")!;
          expect(r.cards).toBeNull();
          expect(r.cats).toEqual(fr.cats);
          expect(r.winner).toBe(st.seat);
          expect(r.folder).toBe(fr.seat);
        } else {
          const sd = ev.find(e => e.type === "Showdown")!;
          expect(r.cards).toEqual(sd.cards);
          expect(r.dir).toBe(sd.dir);
          expect(r.winner).toBe(sd.winner);
          const c = compare(r.cards![0], r.cards![1], r.dir);
          expect(r.winner).toBe(c === 1 ? 0 : c === -1 ? 1 : -1);
          if (r.outcome === "tie") ties++;
        }
      }
    }
    console.log("生命週期", JSON.stringify({ tricks, flips, folds, ties, endChecked, 結算後畫面方向已換成下一墩: dirChangedAfter }));
    expect(endChecked).toBe(300);
    // 舊畫面把上一墩的牌和「這一墩的方向」放在一起：方向不同的情況很常見（所以 A 段要分開顯示）
    expect(dirChangedAfter).toBeGreaterThan(0);
  });
});
