// 常駐對局氣氛：牌桌慢慢進入「危險狀態」。只看真的牌局狀態：
//   · 加倍（×2）、再加倍（×4）：照規則的實際倍率；保留到這局結算
//   · 局內連續贏墩（3 墩以上）：你連贏 → 暗金；對方連贏 → 酒紅（是壓力，不是你在贏）；中斷就退去
//   · 不增加任何分數，也不追蹤「連勝局數」（專案沒有這個狀態）
// 一套主要氣氛（heat 0／1／2 + 顏色）＋小標記說明原因，不把多套特效疊在一起。
// 畫面：桌緣的內光（只動 opacity）、沿著上下邊緣移動的一道光（只動 transform）、高壓時的低透明度花色紋章；
// 元素只建一次、重複使用；精簡品質是靜態桌緣；頁面在背景時暫停。
import * as fx from "./fx";
import { sfx } from "./sound";

export interface AuraState { doubled: number; myStreak: number; oppStreak: number; playing: boolean; }

let felt: HTMLElement | null = null;
let myChip: HTMLElement | null = null, oppChip: HTMLElement | null = null;
let lastKey = "";
export const auraLog: { heat: number; tone: string; t: number }[] = [];
(globalThis as unknown as { __hbAura?: typeof auraLog }).__hbAura = auraLog;

export function attachAura(f: HTMLElement, myHost: HTMLElement, oppArea: HTMLElement) {
  felt = f;
  if (!f.querySelector(":scope > .aura")) {
    const a = document.createElement("div");
    a.className = "aura";
    a.setAttribute("aria-hidden", "true");
    a.innerHTML = '<i class="ag"></i><i class="ar"></i><i class="ac"></i>';
    f.prepend(a);
  }
  const chip = (host: HTMLElement, cls: string) => {
    const c = document.createElement("span");
    c.className = `streakchip ${cls}`;
    c.hidden = true;
    host.appendChild(c);
    return c;
  };
  myChip = chip(myHost, "me");          // 放在確認出牌那一列上方（手牌容器會重排，不能放裡面）
  oppChip = chip(oppArea, "opp");
}

// 算出主要氣氛，套到牌桌上；回傳是不是升級了（給呼叫的人決定要不要蓋章）
export function updateAura(s: AuraState, names: { opp: string }): void {
  if (!felt) return;
  const d = s.doubled;
  const me3 = s.playing && s.myStreak >= 3, opp3 = s.playing && s.oppStreak >= 3;
  const heat = d >= 2 ? 2 : d === 1 || me3 || opp3 ? 1 : 0;
  const tone = d >= 2 ? "wine" : opp3 && !me3 ? "wine" : "gold";
  const key = `${heat}|${tone}`;
  felt.dataset.heat = String(heat);
  felt.dataset.tone = tone;
  if (key !== lastKey) { lastKey = key; auraLog.push({ heat, tone, t: Math.round(performance.now()) }); if (auraLog.length > 200) auraLog.shift(); }
  // 連贏標記：放在連贏的那一方旁邊（真的連贏幾墩就寫幾墩）
  setChip(myChip, me3 ? `你連贏 ${s.myStreak} 墩` : "");
  setChip(oppChip, opp3 ? `${names.opp}連贏 ${s.oppStreak} 墩` : "");
}

function setChip(c: HTMLElement | null, text: string) {
  if (!c) return;
  if (c.textContent === text && c.hidden === !text) return;
  const appear = !!text && c.hidden;
  c.textContent = text;
  c.hidden = !text;
  if (appear) fx.stampIn(c);
}

// 加倍／再加倍的那一下：牌桌短暫收縮、倍率徽章蓋章、回彈；之後交給低成本的常駐動畫
export function auraUpgrade(level: number, badge: Element | null) {
  if (!felt) return;
  if (badge) fx.stampIn(badge);
  sfx.stamp();
  if (!fx.motionOn()) return;
  felt.animate([{ scale: "1" }, { scale: String(1 - 0.012 * level) }, { scale: String(1 + 0.004 * level) }, { scale: "1" }], { duration: fx.ms(420), easing: "ease-out" });
}

// 合約結果揭曉：桌緣累積的氣氛往中間收（之後交給 EmotionDirector 的爆發）
export function auraConverge() {
  if (!felt || !fx.motionOn()) return;
  const a = felt.querySelector(":scope > .aura");
  if (!a) return;
  a.animate([{ scale: "1", opacity: 1 }, { scale: "0.9", opacity: 0.9, offset: 0.6 }, { scale: "1", opacity: 0 }], { duration: fx.ms(520), easing: "cubic-bezier(.5,0,.6,1)" });
}

// 離開對局、新的一局、重播教學：全部退去
export function resetAura() {
  if (felt) { felt.dataset.heat = "0"; felt.dataset.tone = "gold"; }
  lastKey = "";
  setChip(myChip, ""); setChip(oppChip, "");
}
