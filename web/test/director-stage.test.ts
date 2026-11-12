// P2 演出排程：字幕最多兩則、小卡一次一張、冷卻、重要的插隊、舊新聞丟掉、不重複、可以略過（時間全部由測試給）
import { describe, expect, it } from "vitest";
import { RHYTHM } from "../src/laststand/director/config";
import { Stage } from "../src/laststand/director/scheduler";
import type { Channel, Cue } from "../src/laststand/director/types";

let n = 0;
const cue = (channel: Channel, priority: number, id = `c${++n}`): Cue =>
  ({ id, beat: id, channel, priority, level: 1, lines: [{ text: id }], ttl: channel === "card" ? RHYTHM.cardTtl : RHYTHM.chatTtl, skippable: channel === "card" });
const ids = (v: { ticker: { cue: Cue }[]; card: { cue: Cue } | null }) => ({ ticker: v.ticker.map(s => s.cue.id), card: v.card?.cue.id ?? null });

describe("P2 演出排程", () => {
  it("同一個頻道有冷卻：兩則彈幕不會同時冒出來；字幕區最多兩則，時間到就淡出", () => {
    const st = new Stage();
    st.push([cue("chat", 40, "a"), cue("chat", 40, "b"), cue("chat", 40, "c")], 0);
    expect(ids(st.step(0)).ticker).toEqual(["a"]);
    expect(ids(st.step(RHYTHM.cooldown.chat)).ticker).toEqual(["a", "b"]);
    // 字幕區滿了：c 等 a 淡出
    expect(ids(st.step(RHYTHM.cooldown.chat * 2)).ticker).toEqual(["a", "b"]);
    expect(ids(st.step(RHYTHM.chatTtl)).ticker).toEqual(["b", "c"]);
    const end = st.step(RHYTHM.chatTtl + RHYTHM.cooldown.chat + RHYTHM.chatTtl);
    expect(end.ticker).toEqual([]);
    expect(end.wake).toBeNull();
  });

  it("重要的先上；重要的來了，還沒開始的不重要閒聊直接讓位", () => {
    const st = new Stage();
    st.push([cue("chat", 20, "閒聊1"), cue("chat", 20, "閒聊2")], 0);
    st.push([cue("anchor", 90, "梭哈被接")], 10);
    expect(st.pending).toBe(1);
    expect(ids(st.step(10)).ticker).toEqual(["梭哈被接"]);
  });

  it("字幕區滿了：很重要的（≥80）可以擠掉最不重要（<40）的那則；普通的不行", () => {
    const st = new Stage();
    st.push([cue("chat", 20, "x"), cue("notice", 30, "y")], 0);
    expect(ids(st.step(0)).ticker).toEqual(["y", "x"]);            // 排隊照重要程度
    st.push([cue("chat", 60, "普通")], 1000);
    expect(ids(st.step(1000)).ticker).toEqual(["y", "x"]);
    st.push([cue("anchor", 92, "決勝")], 1100);
    expect(ids(st.step(1100)).ticker).toEqual(["y", "決勝"]);
  });

  it("節目小卡一次一張、開始了就不會被打斷；可以略過；排隊最多一張（留比較重要的）", () => {
    const st = new Stage();
    st.push([cue("card", 62, "法庭")], 0);
    expect(ids(st.step(0)).card).toBe("法庭");
    st.push([cue("card", 64, "財經")], 100);
    st.push([cue("card", 96, "體育台逆轉")], 200);
    expect(st.pending).toBe(1);                                    // 財經被更重要的換掉
    expect(ids(st.step(300)).card).toBe("法庭");                    // 不打斷
    st.skipCard(400);
    // 略過後：小卡還在冷卻（從法庭開始算 4 秒）
    expect(ids(st.step(400)).card).toBeNull();
    expect(ids(st.step(RHYTHM.cooldown.card)).card).toBe("體育台逆轉");
  });

  it("同一則演出不會出現兩次（重送、重新整理後又推一次都一樣）", () => {
    const st = new Stage();
    const a = cue("chat", 40, "same");
    st.push([a, a], 0);
    expect(st.pending).toBe(1);
    st.step(0);
    st.push([a], 50);
    expect(st.pending).toBe(0);
  });

  it("排太久的舊新聞直接丟掉（一般 4 秒、重要的 9 秒）", () => {
    const st = new Stage();
    st.block(10000);
    st.push([cue("chat", 40, "舊"), cue("anchor", 88, "重要")], 0);
    st.step(5000);
    expect(st.pending).toBe(1);
    st.step(9500);
    expect(st.pending).toBe(0);
  });

  it("block：結算畫面期間不開始新的演出，時間到才開始；wake 告訴畫面下次什麼時候要再推一下", () => {
    const st = new Stage();
    st.block(1500);
    st.push([cue("chat", 40, "等等")], 1000);
    const v = st.step(1000);
    expect(v.ticker).toEqual([]);
    expect(v.wake).toBe(1500);
    expect(ids(st.step(1500)).ticker).toEqual(["等等"]);
  });

  it("排隊不會無限長：最多 RHYTHM.maxQueue 則，丟最不重要的", () => {
    const st = new Stage();
    st.block(5000);
    st.push([40, 20, 60, 30, 50, 45].map((p, i) => cue("chat", p, `q${i}`)), 0);
    expect(st.pending).toBe(RHYTHM.maxQueue);
  });
});
