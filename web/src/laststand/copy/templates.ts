// 《逆命賭局》文案模板的使用條件
//   · 原始 V2 文案（laststand_v2_copywriting.json）一字不改；這裡只「另外」加條件
//   · 原本的 event／phase／requires／privacy 是硬條件；這裡再補上會讓句子講錯事的額外條件（EXTRA_REQUIRES）
//   · 必要變數缺任何一個就換別的模板，不補造
//   · 填空只做純文字取代；畫面一律用 textContent 顯示（不當 HTML）
import raw from "./laststand_v2_copywriting.json";
import type { Facts, LiveEvent, MatchEvent } from "./events";

export interface Entry {
  id: string; event: LiveEvent | MatchEvent; phase: "live" | "title" | "punchline" | "long";
  style: string; tone: "light" | "medium" | "heavy"; text: string; variables: string[]; requires: string[]; weight: number; privacy: string;
}
export const ORIGINAL: readonly Entry[] = (raw as { entries: Entry[] }).entries;

export type Requirement = keyof Facts;
// 原文會講到「沒保證發生的事」→ 加條件（文字不改）
export const EXTRA_REQUIRES: Record<string, { requires: Requirement[]; why: string }> = {
  "V2-038": { requires: ["revealConsentBoth"], why: "「剛剛那墩其實會贏？」等於暗示牌面勝負：雙方沒同意揭露不能用" },
  "V2-040": { requires: ["loserVowExists"], why: "「賽前發言已完成事後查核」：敗者要真的有填豪言" },
  "V2-035": { requires: ["loserLedAllEight"], why: "「領先八墩」：敗者要真的在第 1–8 墩每墩結算後都領先" },
  "V2-065": { requires: ["loserLedBeforeFinal"], why: "「在最後一墩前仍保持優勢」：第 9 墩開始時敗者要嚴格領先（同分不算）" },
  "V2-050": { requires: ["loserLedBeforeFinal"], why: "「於最後一墩更換勝者」：最後一墩前要有原本領先的人" },
  "V2-033": { requires: ["loserLedBeforeKey"], why: "「直接換人領先」：關鍵梭哈前敗者要領先" },
  "V2-034": { requires: ["loserLedBeforeKey"], why: "「原訂勝者名單，現予以更正」：關鍵梭哈前敗者要領先" },
  "V2-064": { requires: ["loserLedBeforeKey"], why: "「原暫列領先者為{loser}」：關鍵梭哈前敗者要領先" },
  "V2-049": { requires: ["keyTrickIsFinal"], why: "「前面八墩的努力」：關鍵梭哈要在第 9 墩" },
  "V2-027": { requires: ["fullNine"], why: "「九墩已結束」：提前淘汰時不成立" },
  "V2-069": { requires: ["fullNine"], why: "「九墩比賽紀錄」：提前淘汰時不成立" },
  "V2-068": { requires: ["fullNine"], why: "「經過九墩的實際測試」：提前淘汰時不成立" },
  "V2-061": { requires: ["allInWholeStack"], why: "「把{amount}枚全部推進去」：梭哈方推出的要真的是自己全部的籌碼（大籌碼方梭哈不是全部）" },
  "V2-063": { requires: ["allInWholeStack"], why: "「他說要全部押上去」：同上" },
};
// 套用額外條件後的模板（原文不動）
export const ENTRIES: readonly Entry[] = ORIGINAL.map(e => {
  const x = EXTRA_REQUIRES[e.id];
  return x ? { ...e, requires: [...new Set([...e.requires, ...x.requires])] } : e;
});

// 文案口味（房間共同選擇）→ 可以用哪些 style、最高到什麼 tone
export type Taste = "deadpan" | "chat" | "unhinged";
export const TASTE_LABEL: Record<Taste, string> = { deadpan: "冷面", chat: "聊天室", unhinged: "發癲" };
export const TASTES: Record<Taste, { styles: string[]; maxTone: number }> = {
  deadpan: { styles: ["deadpan", "announcement", "sports"], maxTone: 1 },
  chat: { styles: ["deadpan", "announcement", "sports", "chat", "streamer"], maxTone: 1 },
  unhinged: { styles: ["deadpan", "announcement", "sports", "chat", "streamer", "tts", "absurd"], maxTone: 2 },
};
const TONE = { light: 0, medium: 1, heavy: 2 } as const;

export type Vars = Partial<Record<"actor" | "amount" | "directionLabel" | "keyTrick" | "loser" | "loserStake" | "loserVow" | "winner", string>>;

// 這一句現在能不能用：事件、段落、口味、條件、變數都要對
export function usable(e: Entry, event: string, phase: Entry["phase"], facts: Partial<Facts>, vars: Vars, taste: Taste): boolean {
  if (e.event !== event || e.phase !== phase || e.privacy !== "public") return false;
  const t = TASTES[taste];
  if (!t.styles.includes(e.style) || TONE[e.tone] > t.maxTone) return false;
  if (!e.requires.every(r => facts[r as Requirement] === true)) return false;
  return e.variables.every(v => typeof vars[v as keyof Vars] === "string" && vars[v as keyof Vars]!.length > 0);
}
export function candidates(event: string, phase: Entry["phase"], facts: Partial<Facts>, vars: Vars, taste: Taste): Entry[] {
  return ENTRIES.filter(e => usable(e, event, phase, facts, vars, taste));
}
// 填空：純文字取代（沒提供的變數在 usable 就擋掉了）
export const fill = (text: string, vars: Vars) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k as keyof Vars] ?? m);
