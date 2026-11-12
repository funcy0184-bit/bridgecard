// 阿元的嘴（正式對戰）：台詞只在條件符合時出現、頻率有控制、不一直重複、幹話稀有，記憶只記這一場
import { describe, expect, it } from "vitest";
import { AheBrain, EMOTES, MEM_KEY, NONSENSE_MAX, REACTIONS } from "../src/client/ahe";
import { EMOTE_COUNT, emoteAllowed } from "../src/server/protocol";

class Store { m = new Map<string, string>(); get(k: string) { return this.m.get(k) ?? null; } set(k: string, v: string) { this.m.set(k, v); } }
function brain(o: { seed?: number; store?: Store; attitude?: string } = {}) {
  let t = 0, x = o.seed ?? 1;
  const rng = () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
  const store = o.store ?? new Store();
  if (o.attitude) store.set(MEM_KEY, JSON.stringify({ attitude: o.attitude }));
  const b = new AheBrain(rng, () => t, store);
  return { b, store, tick: (ms: number) => { t += ms; } };
}
const allLines = () => REACTIONS.flatMap(r => typeof r.lines === "function"
  ? [r.lines({ n: 3, iDecl: true }, { playerDoubles: 0, playerRuffs: 0, aheDownRow: 0 }), r.lines({ n: 70, iDecl: false, aheAhead: true, playerAhead: true, aheLostLast: true, lastTrickAhe: true }, { playerDoubles: 0, playerRuffs: 0, aheDownRow: 0 })].flat()
  : r.lines);

describe("阿元的台詞庫", () => {
  it("不像客服、不像考卷；每句都短到放得進泡泡", () => {
    for (const l of allLines()) {
      for (const w of ["請選擇", "恭喜您", "您", "此策略", "請執行", "本次", "操作"]) expect(l).not.toContain(w);
      expect([...l].length).toBeLessThanOrEqual(30);
    }
  });
  it("常見事件都有好幾個版本可以換", () => {
    for (const id of ["matchStart", "trickMe", "trickAhe", "faceUpMe", "ruffMe", "ruffAhe", "doubleMe", "madeAhe", "downAhe"]) {
      const lines = new Set(REACTIONS.filter(r => r.id === id && !r.when).flatMap(r => typeof r.lines === "function" ? r.lines({}, { playerDoubles: 0, playerRuffs: 0, aheDownRow: 0 }) : r.lines));
      expect(lines.size, id).toBeGreaterThanOrEqual(2);
    }
  });
  it("五個可以回阿元的話", () => {
    expect(EMOTES.map(e => e.text)).toEqual(["有料喔！", "哭啊！", "別太囂張！", "漂亮！", "再來啊！"]);
  });
});

describe("條件不符就不講", () => {
  it("你被加倍打成才說「我加倍還被你打成」；你自己加倍的不算", () => {
    const { b, tick } = brain();
    expect(b.say("madeMe", { doubled: 1, byPlayer: false })!.text).toMatch(/加倍/);
    tick(10000);
    expect(b.say("madeMe", { doubled: 0, over: 0 })!.text).not.toMatch(/加倍/);
  });
  it("只差一墩才說「就差一墩」；差很多說叫太高", () => {
    const { b, tick } = brain();
    expect(b.say("downMe", { under: 1 })!.text).toBe("哭啊，就差一墩！");
    tick(10000);
    expect(b.say("downMe", { under: 3 })!.text).not.toContain("就差一墩");
  });
  it("超墩才說你太貪心", () => {
    const { b } = brain();
    expect(b.say("madeMe", { over: 2 })!.text).toContain("太貪心");
  });
  it("回話照局勢：阿元領先才說「現在才開始哭喔？」", () => {
    const { b, tick } = brain();
    expect(b.say("emote:cry", { aheAhead: true })!.text).toBe("現在才開始哭喔？");
    tick(10000);
    expect(b.say("emote:cry", { aheAhead: false })!.text).toBe("要哭的是我吧。");
    tick(10000);
    expect(b.say("emote:cocky", { aheAhead: true })!.text).toBe("啊我就真的贏了啊。");
  });
  it("幹話：你沒領先就不說你運氣過分；阿元沒吃虧就不說在研究失敗", () => {
    for (let seed = 1; seed < 60; seed++) {
      const { b } = brain({ seed });
      const s = b.say("nonsense", { playerAhead: false, aheLostLast: false })!;
      expect(s.text).not.toContain("運氣有點過分");
      expect(s.text).not.toContain("研究失敗");
    }
  });
});

describe("頻率控制：不吵", () => {
  it("一般贏墩有冷卻；閒聊之間至少隔幾秒；重要事件不受閒聊間隔限制", () => {
    const { b, tick } = brain({ seed: 7 });
    let said = 0;
    for (let i = 0; i < 40; i++) { if (b.say("trickMe")) said++; tick(1000); }
    expect(said).toBeLessThanOrEqual(5);            // 40 秒最多幾句
    expect(b.say("doubleMe")).not.toBeNull();        // 加倍：馬上講，不受閒聊間隔限制
  });
  it("一局講話有上限：閒聊最多 3 句、全部最多 6 句；打成倒約、整場勝負例外；新的一局重算", () => {
    const { b, tick } = brain({ seed: 11 });
    let idle = 0;
    for (let i = 0; i < 30; i++) { if (b.say("contractMe") || b.say("faceUpMe") || b.say("bidRaiseAhe")) idle++; tick(20000); }
    expect(idle).toBeLessThanOrEqual(3);
    let total = idle;
    for (const id of ["doubleMe", "redoubleMe", "doubleAhe", "keyMe", "keyAhe", "redoubleAhe"]) { if (b.say(id)) total++; tick(3000); }
    expect(total).toBeLessThanOrEqual(6);
    expect(b.say("madeMe", {})).not.toBeNull();       // 大事照講
    b.newHand();
    tick(20000);
    expect(b.say("doubleAhe")).not.toBeNull();
  });
  it("加倍、再加倍：一局只講一次", () => {
    const { b, tick } = brain();
    expect(b.say("doubleAhe")).not.toBeNull();
    tick(20000);
    expect(b.say("doubleAhe")).toBeNull();
    b.newHand();
    expect(b.say("doubleAhe")).not.toBeNull();
  });
  it("最近講過的不重複", () => {
    const { b, tick } = brain({ seed: 3 });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { seen.push(b.say("ruffAhe", {})?.text ?? "x"); tick(20000); }
    expect(new Set(seen).size).toBe(3);
  });
  it("幹話一場最多 2 句；新的一場重算；跨場最近講過的不重複", () => {
    const { b, store, tick } = brain({ seed: 5 });
    const a: string[] = [];
    for (let i = 0; i < 10; i++) { const s = b.say("nonsense", {}); if (s) a.push(s.text); tick(60000); }
    expect(a.length).toBe(NONSENSE_MAX);
    b.newMatch();
    const c: string[] = [];
    for (let i = 0; i < 10; i++) { const s = b.say("nonsense", {}); if (s) c.push(s.text); tick(60000); }
    expect(c.length).toBe(NONSENSE_MAX);
    for (const x of c) expect(a).not.toContain(x);
    expect(JSON.parse(store.get(MEM_KEY)!).nonsense.length).toBeLessThanOrEqual(6);
  });
  it("精簡：只講重要的（王吃、加倍、打成倒約、整場勝負），沒有幹話；關閉：都不講", () => {
    const { b, tick } = brain({ seed: 9 });
    b.level = "lite";
    expect(b.say("trickMe")).toBeNull();
    expect(b.say("nonsense")).toBeNull();
    expect(b.say("madeAhe")).not.toBeNull();
    tick(10000);
    b.level = "off";
    expect(b.say("madeAhe")).toBeNull();
    expect(b.say("matchMe", { n: 5 })).toBeNull();
  });
});

describe("這一場的記憶", () => {
  it("你這場加倍第二次：「你是不是很喜歡加倍啊？」（只講一次）", () => {
    const { b, tick } = brain();
    b.note("playerDouble");
    expect(b.say("doubleMe")!.text).not.toContain("很喜歡加倍");
    tick(10000); b.newHand();
    b.note("playerDouble");
    expect(b.say("doubleMe")!.text).toBe("你是不是很喜歡加倍啊？");
    tick(10000); b.newHand();
    b.note("playerDouble");
    expect(b.say("doubleMe")!.text).not.toContain("很喜歡加倍");
  });
  it("你王吃第三次：「你到底還有幾張王牌？」", () => {
    const { b } = brain();
    for (let i = 0; i < 3; i++) b.note("playerRuff");
    expect(b.say("ruffMe")!.text).toContain("到底還有幾張王牌");
  });
  it("阿元當莊連續倒約兩次：「我今天到底在叫什麼東西……」；打成一次就歸零", () => {
    const { b, tick } = brain();
    b.note("aheHand", false); b.note("aheHand", false);
    expect(b.say("downAhe", { under: 2 })!.text).toBe("我今天到底在叫什麼東西……");
    tick(10000);
    b.note("aheHand", true); b.note("aheHand", false);
    expect(b.say("downAhe", { under: 2 })!.text).not.toContain("在叫什麼");
  });
  it("教學裡說「我超強」：開場、整場結束都會提；新的一場記憶清空，但態度留著", () => {
    const { b, tick } = brain({ attitude: "pro" });
    expect(b.say("matchStart")!.text).toContain("你不是說你超強");
    tick(10000);
    expect(b.say("matchAhe", { n: 80 })!.text).toContain("你不是說你很強嗎");
    b.note("playerDouble"); b.note("playerDouble");
    b.newMatch();
    expect(b.mem.playerDoubles).toBe(0);
    expect(b.mem.attitude).toBe("pro");
  });
  it("整場結束：照分差講（險勝、大勝）", () => {
    const { b, tick } = brain();
    expect(b.say("matchMe", { n: 10 })!.text).toBe("差一點！可惡。");
    tick(10000);
    expect(b.say("matchMe", { n: 90 })!.text).toBe("你到底是不是新手啊？");
    tick(10000);
    expect(b.say("matchAhe", { n: 10 })!.text).toBe("呼！這局差點翻車。");
  });
});

describe("回個話", () => {
  it("短句數量跟伺服器一致；防洗版：間隔 2.5 秒、20 秒內最多 4 句", () => {
    expect(EMOTES.length).toBe(EMOTE_COUNT);
    expect(emoteAllowed([], 0)).toBe(true);
    expect(emoteAllowed([0], 1000)).toBe(false);
    expect(emoteAllowed([0], 2600)).toBe(true);
    expect(emoteAllowed([0, 3000, 6000, 9000], 12000)).toBe(false);
    expect(emoteAllowed([0, 3000, 6000, 9000], 21000)).toBe(true);
  });
  it("阿元回你的話：不受閒聊間隔和一局上限限制，但關閉吐槽就不回", () => {
    const { b, tick } = brain();
    for (let i = 0; i < 6; i++) { b.say("contractMe"); b.say("faceUpMe"); tick(30000); }
    expect(b.say("emote:pretty")).not.toBeNull();
    tick(3000);
    expect(b.say("emote:again")).not.toBeNull();
    b.level = "lite";
    tick(3000);
    expect(b.say("emote:nice", { lastTrickAhe: true })!.text).toBe("嘿嘿，你現在才知道？");
    b.level = "off";
    expect(b.say("emote:cry")).toBeNull();
  });
});
