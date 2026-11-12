// LS_AI=off 時打包用的替身：梭了啦單人測試整段不打包進去（入口、/?lsai=1 都不會出現）
// 只放 main.ts 會引用到的名字；真正的實作在 laststand-solo.ts
export const STRATEGY_NAMES: Record<string, string> = {};
export const SPEED_NAMES: Record<string, string> = {};
export const FIRST_NAMES: Record<string, string> = {};
export const hasUnfinishedLsAi = () => false;
export class LocalLastStandTable {
  constructor() { throw new Error("這個版本沒有梭了啦單人測試"); }
}
