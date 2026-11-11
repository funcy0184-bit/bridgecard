// 測試用：Node 內建模組的最小型別（專案沒有裝 @types/node，只宣告測試用到的部分）
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:crypto" {
  interface Hash { update(data: string): Hash; digest(enc: "hex"): string }
  export function createHash(alg: "sha256"): Hash;
}
