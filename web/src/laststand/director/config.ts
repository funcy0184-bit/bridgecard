// 事件導演的可調設定：優先級、冷卻、顯示時間、節目註冊。要調節奏改這裡，不要改畫面程式
import type { BeatType, Channel, ProgramId } from "./types";

// 優先級（數字越大越重要）：100 比賽結果／關鍵逆轉、90 決勝梭哈被接、80 重大反加／特殊結果、60 連續行為、40 普通加注棄牌、20 聊天室
export const PRIORITY: Record<BeatType, number> = {
  match_over: 100, eliminated: 100, comeback: 96,
  allin_called_final: 92, allin_called: 90, big_result: 88, allin_folded: 86,
  reraise: 80, allin_offer: 80, big_call: 78, intermission: 75, big_offer: 74, match_start: 72,
  tie_pool_grow: 66, pool_taken: 64, flip_lost: 62, insight_fold: 62, tie: 60,
  raise_streak3: 60, raise_streak_more: 58, fold_streak3: 60, fold_after_raiser: 60, lose_streak3: 60, raise_cap: 58,
  big_swing: 55, big_fold: 55, refund: 50, final_trick: 48, safeguard_result: 45,
  raise_first: 40, fold: 40, safeguard: 40, raise: 30, flip: 30, insight: 30, call: 20,
};

// 要等這一墩結算才確定的事
export const SETTLED: ReadonlySet<BeatType> = new Set<BeatType>([
  "tie", "tie_pool_grow", "flip_lost", "safeguard_result", "pool_taken", "big_swing", "big_result",
  "lose_streak3", "comeback", "refund", "eliminated", "intermission", "match_over",
]);
// 可以當賽後戰報素材的事
export const REPORTABLE: ReadonlySet<BeatType> = new Set<BeatType>([
  "raise_streak3", "raise_streak_more", "reraise", "allin_offer", "allin_called", "allin_called_final", "allin_folded",
  "fold_streak3", "insight_fold", "fold_after_raiser", "tie", "tie_pool_grow", "flip_lost", "pool_taken", "big_result",
  "lose_streak3", "comeback", "eliminated", "safeguard_result",
]);
// 哪些事可以叫出哪個節目的小卡（第一個優先）
export const BEAT_PROGRAMS: Partial<Record<BeatType, ProgramId[]>> = {
  match_start: ["notary"],
  reraise: ["court"], flip_lost: ["court"], insight_fold: ["court"],
  lose_streak3: ["sports"], comeback: ["sports"], allin_called_final: ["sports"], big_result: ["sports"],
  big_swing: ["finance"], pool_taken: ["finance"], tie_pool_grow: ["finance"],
};

// 節目註冊：12 種先登記，P2 只啟用 4 種
export interface ProgramDef { id: ProgramId; label: string; enabled: boolean }
export const PROGRAMS: ProgramDef[] = [
  { id: "sports", label: "體育台", enabled: true },
  { id: "breaking", label: "突發新聞", enabled: true },      // P2 只用在第四墩後的中場節目
  { id: "court", label: "賭桌法庭", enabled: true },
  { id: "finance", label: "財經台", enabled: true },
  { id: "weather", label: "氣象預報", enabled: false },
  { id: "audit", label: "稽核調查局", enabled: false },
  { id: "support", label: "客服中心", enabled: false },
  { id: "lecture", label: "專家講座", enabled: false },
  { id: "street", label: "街頭訪問", enabled: false },
  { id: "counsel", label: "情感諮商", enabled: false },
  { id: "notary", label: "契約公證處", enabled: true },
  { id: "awards", label: "頒獎典禮", enabled: false },
];
export const programEnabled = (id: ProgramId) => PROGRAMS.some(p => p.id === id && p.enabled);

// 節奏
export const RHYTHM = {
  chatTtl: 2000,              // 一般彈幕約 2 秒淡出
  importantTtl: 3000,         // 重要事件（優先級 ≥ 80）稍微久一點
  cardTtl: 3200,              // 節目小卡（實際照行數：1.2 秒＋每行 0.65 秒，2.4～4.2 秒）
  intermissionTtl: 3000,      // 中場節目（約 3 秒、可以略過、不擋操作）
  maxTicker: 2,               // 字幕區同時最多兩則
  maxQueue: 4,                // 排隊最多幾則（多的丟掉最不重要的）
  maxLinesPerStep: 3,         // 同一個動作引發的演出：字幕最多幾句（另外最多一張小卡），多的丟掉最不重要的
  cooldown: { chat: 900, anchor: 1400, notice: 600, card: 4000 } as Record<Channel, number>,
  cardMinPriority: 60,        // 小卡至少要這個優先級
  cardGapTricks: 2,           // 兩張節目小卡之間至少隔幾墩（優先級 ≥ 90 不受限）
  reactionChance: [0, 0.25, 0.4, 0.6, 0.8],   // 依下注壓力（1～4）補一則觀眾反應的機率
};

// 下注壓力（只控制演出，不改任何下注金額或規則）
export const PRESSURE = {
  midRaiseRatio: 2,           // 加到底注的 2 倍以上 → 中壓
  highAmount: 4,              // 有效下注或提出的金額 ≥ 4 枚 → 高壓
  highPool: 4,                // 疊池 ≥ 4 枚 → 高壓
  highShare: 0.4,             // 金額達到較少那方籌碼的 40% → 高壓
  decisiveFrom: 7,            // 第 7 墩以後、一墩就能改變領先／淘汰 → 決勝
};
