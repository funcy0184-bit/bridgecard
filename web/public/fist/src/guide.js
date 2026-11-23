// guide.js — 新手引導：每個階段告訴玩家「現在該按什麼」
//   · 只說該做什麼、不說該出什麼（不會洩露對手藏招，也不是幫你作弊）
//   · seat = 自己的座位；-1 = 同機雙人共用畫面
import { PH, GLABEL } from "./engine.js";

export const FLOW = "👣 走位 → ✊ 猜拳 → 🔥 連打 → 🎯 終結技 → 🛡️ 彈反／🔴 翻滾";

export function coachText(v, seat) {
  if (!v) return "";
  const r = v.round, ph = v.phase, me = seat >= 0 ? v.fighters[seat] : null, P = i => `P${i + 1}`;
  const hidden = ph === PH.RPS && v.t >= (v.reveal ?? 1.3);
  switch (ph) {
    case PH.MOVE:
      if (me?.stun > 0) return "😮‍💨 喘氣硬直中：這輪先別動（同一輪走 2 步會累）";
      if (me?.locked) return "● 已站定，等猜拳開始";
      if (me && me.power < 1) return "🪫 沒氣了走不動：按 ● 原地站定，打完這回合會回氣";
      return me ? "👣 走位：點 ◀ ▶ 移動一格（每步 1 氣、最多 2 步）・● 原地站定" : "👣 走位：P1、P2 各自按 ◀ ▶ 移動（每步 1 氣）・不想動按中間";
    case PH.RPS:
      if (me?.stun > 0) return "😮‍💨 硬直中不能出拳：這回合會隨機出";
      if (hidden) return "🤫 藏招！最後機會換拳，對手看不到你換了什麼";
      return me ? "✊ 猜拳：選一張拳！對手看得到你擺的架式，最後一下才藏招" : "✊ 猜拳：兩邊各選一張拳，最後一下會藏招";
    case PH.CLASH: return "⚔️ 拼刀！同拳平手，回去走位";
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
