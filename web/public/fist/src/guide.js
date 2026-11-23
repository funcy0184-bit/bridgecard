// guide.js — 新手引導：每個階段告訴玩家「現在該按什麼」
//   · 只說該做什麼、不說該出什麼（不會洩露對手藏招，也不是幫你作弊）
//   · seat = 自己的座位；-1 = 同機雙人共用畫面
import { PH, GLABEL, GICON } from "./engine.js";

export const FLOW = "✊ 猜拳 → 👀 開牌 → 🔥 連打 → 🎯 終結技 → 🛡️ 彈反／🔴 翻滾（平手 ⚔️ 拼刀）";

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
      if (!me) return "⚔️ 拼刀！兩邊各在 3 秒內連按 3 下填滿劍格，先填完拿 ⚡ 先手";
      return n >= 3 ? "⚔️ 填好了！等對手…" : `⚔️ 拼刀！3 秒內連按 3 下填滿劍格（${n}/3），先填完拿 ⚡ 先手`;
    }
    case PH.CLASH_ANIM: return "⚔️ 三刀對砍：贏刀多的重砍對手，平分看 ⚡ 先手";
    case PH.CLASH: return "⚔️ 平手彈開，馬上下一輪";
    case PH.MASH:
      if (!r) return "";
      if (!me) return `🔥 ${P(r.att)} 贏拳！狂按任意鍵追加連擊（最多 4 拳）`;
      return r.att === seat ? "🔥 你贏拳了！狂點追加連擊（最多 4 拳）" : "😣 被壓著打！下一步準備接招";
    case PH.SELECT:
      if (!r) return "";
      if (!me) return `🎯 ${P(r.att)} 選終結技（按住贏拳鍵 0.3 秒＝紅光）・${P(r.def)} 準備接招`;
      return r.att === seat ? `🎯 選終結技：點一張換手勢・按住「${GLABEL[r.winGesture] ?? ""}」0.3 秒＝紅光（要 2 氣）` : "👀 對手選招中：等一下看頭頂藍框或腳下紅區";
    case PH.WINDOW:
      if (!r?.type) return "";
      if (!me) return r.type === "blue" ? `🛡️ ${P(r.def)}：按剋制藍框的拳彈反（只有一次）` : `🔴 ${P(r.def)}：紅光擋不住，往箭頭方向翻滾`;
      if (r.def !== seat) return "⏳ 看對手接不接得住…";
      return r.type === "blue" ? "🛡️ 藍框！按剋制它的拳彈反（只有一次機會）" : "🔴 紅光擋不住！往亮起的方向翻滾";
    default: return "";
  }
}
