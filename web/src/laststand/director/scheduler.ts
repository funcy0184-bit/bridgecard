// 演出排程（純邏輯，時間由外面給）：決定哪一則現在上畫面、哪一則排隊、哪一則丟掉
//   · 字幕區同時最多兩則；節目小卡一次一張（已經開始的小卡不會被打斷，可以略過）
//   · 重要的（優先級高）先上；新來的重要演出會取代「還沒開始」的不重要演出
//   · 同一個頻道有冷卻時間，玩家按太快也不會塞車；排太久的舊新聞直接丟掉
//   · block(until)：這段時間不開始新的演出（例如整場結算的畫面）
import { RHYTHM } from "./config";
import type { Channel, Cue } from "./types";

export interface Showing { cue: Cue; start: number; until: number }
export interface StageView { ticker: Showing[]; card: Showing | null }

const STALE_MS = 4000, STALE_IMPORTANT_MS = 9000;

export class Stage {
  ticker: Showing[] = [];
  card: Showing | null = null;
  private queue: { cue: Cue; at: number }[] = [];
  private lastStart: Partial<Record<Channel, number>> = {};
  private blockedUntil = 0;
  private played = new Set<string>();

  push(cues: Cue[], now: number) {
    for (const cue of cues) {
      if (this.played.has(cue.id) || this.queue.some(q => q.cue.id === cue.id)) continue;      // 同一則不演兩次
      // 重要的來了：還沒開始的不重要演出讓位
      if (cue.priority >= 80) this.queue = this.queue.filter(q => q.cue.priority >= 40 || q.cue.channel === "card");
      // 小卡最多排一張：新的比較重要就換掉排著的那張
      if (cue.channel === "card") {
        const waiting = this.queue.find(q => q.cue.channel === "card");
        if (waiting && waiting.cue.priority >= cue.priority) continue;
        if (waiting) this.queue = this.queue.filter(q => q !== waiting);
      }
      this.queue.push({ cue, at: now });
    }
    this.queue.sort((a, b) => b.cue.priority - a.cue.priority || a.at - b.at);
    if (this.queue.length > RHYTHM.maxQueue) this.queue = this.queue.slice(0, RHYTHM.maxQueue);
  }
  skipCard(now: number) { if (this.card) this.card.until = now; }
  block(until: number) { this.blockedUntil = Math.max(this.blockedUntil, until); }
  clear() { this.ticker = []; this.card = null; this.queue = []; }
  get pending() { return this.queue.length; }

  // 推進到 now：收掉時間到的、開始可以開始的；回傳現在畫面上有什麼，和下一次要醒來的時間
  step(now: number): StageView & { wake: number | null } {
    this.ticker = this.ticker.filter(s => s.until > now);
    if (this.card && this.card.until <= now) this.card = null;
    this.queue = this.queue.filter(q => now - q.at < (q.cue.priority >= 80 ? STALE_IMPORTANT_MS : STALE_MS));
    if (now >= this.blockedUntil) {
      for (const q of [...this.queue]) {
        const c = q.cue, cool = RHYTHM.cooldown[c.channel] ?? 0;
        if (now - (this.lastStart[c.channel] ?? -1e9) < cool) continue;
        if (c.channel === "card") {
          if (this.card) continue;
          this.card = { cue: c, start: now, until: now + c.ttl };
        } else {
          if (this.ticker.length >= RHYTHM.maxTicker) {
            // 滿了：只有很重要的可以換掉最不重要、而且不重要的那一則
            const low = this.ticker.reduce((a, b) => (b.cue.priority < a.cue.priority ? b : a));
            if (!(c.priority >= 80 && low.cue.priority < 40)) continue;
            this.ticker = this.ticker.filter(s => s !== low);
          }
          this.ticker.push({ cue: c, start: now, until: now + c.ttl });
        }
        this.lastStart[c.channel] = now;
        this.played.add(c.id);
        this.queue = this.queue.filter(x => x !== q);
      }
    }
    const times = [...this.ticker.map(s => s.until), this.card?.until ?? Infinity];
    if (this.queue.length) times.push(Math.max(now + 120, this.blockedUntil), ...this.queue.map(q => (this.lastStart[q.cue.channel] ?? -1e9) + (RHYTHM.cooldown[q.cue.channel] ?? 0)));
    const next = Math.min(...times.filter(t => t > now));
    return { ticker: this.ticker, card: this.card, wake: Number.isFinite(next) ? next : null };
  }
}
