// 頻率限制：每個來源（IP）一個小 Durable Object，記錄最近的「查不到房間」和「開房」次數。
// 用來擋大量猜房號；正常玩家一次輸錯幾個房號不會被擋。
import { DurableObject } from "cloudflare:workers";

export type LimitKind = "miss" | "create";

export class Limiter extends DurableObject {
  private times: Record<LimitKind, number[]> | null = null;

  private async load() {
    if (!this.times) this.times = (await this.ctx.storage.get<Record<LimitKind, number[]>>("t")) ?? { miss: [], create: [] };
    return this.times;
  }

  // 現在已經超過上限了嗎（不記一次）
  async blocked(kind: LimitKind, limit: number, windowMs: number): Promise<boolean> {
    const t = await this.load();
    const now = Date.now();
    return t[kind].filter(x => now - x < windowMs).length >= limit;
  }

  // 記一次；回傳這一次是否還在上限內
  async hit(kind: LimitKind, limit: number, windowMs: number): Promise<boolean> {
    const t = await this.load();
    const now = Date.now();
    t[kind] = t[kind].filter(x => now - x < windowMs);
    if (t[kind].length >= limit) return false;
    t[kind].push(now);
    await this.ctx.storage.put("t", t);
    await this.ctx.storage.setAlarm(now + windowMs);      // 窗口過了就清掉，不留資料
    return true;
  }

  async alarm() { await this.ctx.storage.deleteAll(); this.times = null; }
}
