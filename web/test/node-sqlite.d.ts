// 測試用：Node 內建 SQLite 的最小型別（專案沒有裝 @types/node，只宣告測試用到的部分）
declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  interface Statement {
    all(...params: Value[]): unknown[];
    get(...params: Value[]): unknown;
    run(...params: Value[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }
}
