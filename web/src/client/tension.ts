// EmotionDirector：情緒張力系統 Pressure → Release。
//   叫牌：Build —— 叫得越高、加倍再加倍，壓力越大（背景陰影加深、牌桌局部聚光、低頻嗡聲）
//   打牌：Sustain —— 壓力跟著「公開的局勢」走：合約還有懸念就繃著，局勢明朗就鬆一點
//   合約結果：Release —— 成功的一方先收束、再瞬間爆發；強度看合約風險（線數、加倍）
// 兩個數字分開管：
//   risk     = 真正的合約風險（只看合約線數與加倍狀態），不會變動
//   pressure = 情緒張力（0..1），只拿來決定畫面、聲音、動畫，絕不影響橋牌判定
// 所有輸入都來自已確認的遊戲事件與公開的牌桌狀態（墩數、合約），不看任何隱藏的牌。
import { bidLevel, tricksNeeded } from "../game/cards";
import type { TableState } from "../game/game";
import * as fx from "./fx";
import { burstAt, shower } from "./particles";
import { drone, sfx } from "./sound";

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));

// 合約風險：線數越高、加倍越多越危險（0..1）—— 跟 Impact 系統共用同一個算法
import { contractRisk as risk } from "./impact";
export { risk };

// 打牌時的懸念：只看公開的墩數。雙方都還有機會、又接近終點 → 壓力高；已經確定 → 放鬆
export function suspense(s: TableState): number {
  if (s.highestBid < 0 || s.declarer < 0) return 0;
  const need = tricksNeeded(s.highestBid), setAt = 14 - need;
  const iDecl = s.declarer === s.seat;
  const decl = iDecl ? s.myTricks : s.oppTricks, def = iDecl ? s.oppTricks : s.myTricks;
  if (decl >= need || def >= setAt) return 0.08;              // 結果已經確定
  const played = decl + def, left = 13 - played;
  const declNeeds = need - decl, defNeeds = setAt - def;       // 兩邊各還差幾墩就定案
  const progress = played / 13;
  const balance = 1 - Math.abs(declNeeds - defNeeds) / (left + 1);   // 勢均力敵
  const close = 1 - Math.min(declNeeds, defNeeds) / Math.max(1, left); // 有人快到了
  const r = risk(s.highestBid, s.doubled);
  return clamp(0.14 + r * 0.25 + 0.3 * balance * progress + 0.25 * close * progress, 0, 0.88);
}

class Director {
  pressure = 0;
  private carry = 0;          // 叫牌帶進打牌的壓力（每打一墩放掉一點）
  private root: HTMLElement | null = null;
  private veil: HTMLElement | null = null;
  private listeners: ((p: number) => void)[] = [];

  attach(root: HTMLElement) {
    this.root = root;
    this.veil = document.createElement("div");
    this.veil.className = "vignette";
    this.veil.setAttribute("aria-hidden", "true");
    root.appendChild(this.veil);
    this.set(0);
  }
  onChange(fn: (p: number) => void) { this.listeners.push(fn); }

  set(p: number) {
    this.pressure = clamp(p);
    this.root?.style.setProperty("--pressure", this.pressure.toFixed(3));
    drone.level(this.pressure);
    for (const fn of this.listeners) fn(this.pressure);
  }
  private raise(to: number) { this.set(Math.max(this.pressure, to)); }

  // ---------- 叫牌：Build Tension ----------
  bid(bid: number, raise: boolean) {
    const tier = bidTier(bidLevel(bid));
    const floor = 0.1 + tier * 0.13;
    this.set(raise ? Math.max(floor, Math.min(0.92, this.pressure + 0.07 + tier * 0.04)) : Math.max(this.pressure, floor));
  }
  double() { this.set(Math.min(0.95, this.pressure + 0.22)); }       // 壓力跳一大格
  redouble() { this.set(Math.min(1, this.pressure + 0.3)); }
  // Pass：如果這一聲結束叫牌，壓力不放掉——直接帶進合約；開場的 Pass 只稍微鬆一點
  pass(endsAuction: boolean) { if (!endsAuction) this.set(this.pressure * 0.85); }
  redeal() { this.set(0); sfx.release(); }
  // 合約確定：壓力帶進打牌階段（至少是合約本身的風險）
  contract(bid: number, doubled: number) { this.carry = Math.max(this.pressure * 0.8, 0.2 + risk(bid, doubled) * 0.5); this.set(this.carry); }

  // ---------- 打牌：Sustain Tension ----------
  sustain(s: TableState) {
    const sus = suspense(s);
    if (sus <= 0.08) { this.carry = 0; this.set(sus); return; }      // 已經定案：放鬆
    const played = s.myTricks + s.oppTricks;
    this.set(Math.max(sus, this.carry * Math.pow(0.88, played)));
  }

  // ---------- 合約結果：Release ----------
  // good = 這個結果對「你」是好事（你是莊家而打成，或你是防守方而擊破）
  async release(good: boolean, r: number, anchor: Element, felt: Element) {
    const power = 0.4 + r * 0.6;   // 高風險合約，釋放更強
    if (!good) {
      // 對方達成：不羞辱、不懲罰，只是安靜地把壓力收掉
      sfx.soft();
      this.set(0.08);
      return;
    }
    // 先收束：畫面往中間收、聲音吸一口氣
    this.veil?.classList.add("converge");
    sfx.inhale();
    await fx.wait(fx.motionOn() ? fx.ms(150) : 0);
    this.veil?.classList.remove("converge");
    // 再瞬間爆發
    this.set(0.05);
    sfx.contract(true);
    sfx.impact(0.5 + power * 0.5);
    fx.flash(0.25 + power * 0.55);
    fx.shockAt(anchor, { size: 200 + power * 160, width: 2 });
    if (power > 0.6) fx.shockAt(anchor, { size: 320 + power * 160, delay: 90, width: 1.5 });
    burstAt(anchor, { count: Math.round(14 + power * 26), kinds: ["star", "dust", "paper", "suit"], speed: 220 + power * 140, life: 1.1 });
    fx.shake(felt, 4 + power * 6, 300);
    if (power > 0.75) shower(Math.round(30 + power * 30));
  }

  // 結算完成：迅速恢復乾淨的桌面
  clear() { this.carry = 0; this.set(0); }
}

export const bidTier = (level: number) => level <= 2 ? 0 : level <= 4 ? 1 : level <= 6 ? 2 : 3;
export const emo = new Director();
