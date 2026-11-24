// guide.js — 新手引導：每個階段告訴玩家「現在該按什麼」
//   · 只說該做什麼、不說該出什麼（不會洩露對手藏招，也不是幫你作弊）
//   · seat = 自己的座位；-1 = 同機雙人共用畫面
import { CONFIG } from "./config.js";
import { PH, GLABEL, GICON } from "./engine.js";

export const FLOW = "✊ 猜拳 → 👀 開牌 → 💥 連勝 1、2 重擊 → 🔥 連勝 3 四套拳 → 🛡️ 逐拳反擊（平手累積 2 次 ⚔️ 五連斬拼刀）";

export function coachText(v, seat) {
  if (!v) return "";
  const r = v.round, ph = v.phase, me = seat >= 0 ? v.fighters[seat] : null, P = i => `P${i + 1}`;
  const hidden = ph === PH.RPS && v.t >= (v.reveal ?? 1.3);
  switch (ph) {
    case PH.RPS: {
      const op = seat >= 0 ? v.fighters[1 - seat] : null;
      if (hidden) return "🤫 藏招！最後機會換拳，對手看不到你換了什麼";
      if (me?.heat) return `✊ 猜拳：你的 ${GICON[me.heat]} ♨️ 過熱不能出，從另外兩招選${op?.heat ? `（對手禁用 ${GICON[op.heat]}）` : ""}`;
      return me ? "✊ 猜拳：選一張拳！對手看得到你擺的架式，最後 0.6 秒才藏招" : "✊ 猜拳：兩邊各選一張拳（♨️ 過熱的那招不能出），最後一下會藏招";
    }
    case PH.REVEAL: return "👀 開牌！看清楚誰壓制誰";
    case PH.CLASH_INPUT: {
      const n = v.clash?.count?.[seat] ?? 0;
      const N = CONFIG.CLASH_SEQUENCE_LENGTH, T = CONFIG.clashMode.inputDur;
      if (!me) return `⚔️ 五連斬！兩邊各在 ${T} 秒內連按 ${N} 下填滿劍格，先填完拿 ⚡ 先手`;
      return n >= N ? "⚔️ 填好了！等對手…" : `⚔️ 五連斬！${T} 秒內連按 ${N} 下填滿劍格（${n}/${N}），先填完拿 ⚡ 先手`;
    }
    case PH.CLASH_ANIM: return v.clash?.result ? "⚔️ 勝負已分：主招大招！" : "⚔️ 五刀由慢到快對砍：贏刀多的放大招，同分看 ⚡ 先手";
    case PH.CLASH: return (v.gauge ?? 0) > 0 ? `⚔️ 叮！平手彈開，拼刀蓄力 ${v.gauge}/${v.gaugeMax}` : "⚔️ 平分！各自彈開，馬上下一輪";
    case PH.STRIKE:
      if (!r) return "";
      if (!me) return `💥 ${P(r.att)} 連勝 ${v.fighters[r.att].streak}/${v.streakTarget}：單發重擊，連贏 ${v.streakTarget} 次進四套拳`;
      return r.att === seat ? `💥 連勝 ${v.fighters[seat].streak}/${v.streakTarget}！再贏 ${v.streakTarget - v.fighters[seat].streak} 次就進四套拳` : "😣 被重擊推向崖邊：下一輪贏回來就能斷他的連勝";
    case PH.BURST: return "🔥 連勝爆發！攻方連出 4 拳，守方每拳都有一次反擊機會";
    case PH.COMBO_PREP:
      if (!r) return "";
      if (!me) return `🎯 ${P(r.att)} 選第 ${r.n} 拳（${P(r.def)} 看不到）`;
      return r.att === seat ? `🎯 按一招決定第 ${r.n} 拳出什麼（不按就隨機），對手看不到` : `🛡️ 第 ${r.n} 拳來了：拳種亮出後按「剋制它」的拳反擊`;
    case PH.COMBO_CUE:
      if (!r) return "";
      if (!me) return `🛡️ ${P(r.def)}：按剋制頭頂拳種的拳反擊（只認第一下）`;
      return r.def === seat ? "🛡️ 看攻方頭頂的拳種，按剋制它的拳！只認第一下" : "⏳ 看對手接不接得住…";
    case PH.COMBO_HIT: return "";
    default: return "";
  }
}
