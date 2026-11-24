// haptics.js — 打到／被打到的手機震動
//   · Android Chrome：navigator.vibrate，依事件分輕重（CONFIG.haptics）
//   · iPhone Safari：不開放網頁控制震動。iOS 18 起點一下「開關樣式的 checkbox」會有系統觸感，
//     這裡用隱藏的 <input type="checkbox" switch> 試著觸發一下輕觸感（力道、長短都不能控制；不一定每次都有）
//   · 只震「跟自己有關」的事件；同機雙人（共用一支手機）兩邊的事件都震
import { CONFIG } from "./config.js";

const H = CONFIG.haptics;
const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
const isIOS = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
let iosLabel = null;
function iosTick() {
  if (typeof document === "undefined") return;
  if (!iosLabel) {
    iosLabel = document.createElement("label");
    iosLabel.setAttribute("aria-hidden", "true");
    iosLabel.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const i = document.createElement("input"); i.type = "checkbox"; i.setAttribute("switch", ""); i.tabIndex = -1;
    iosLabel.appendChild(i); document.body.appendChild(iosLabel);
  }
  iosLabel.click();
}

let on = true, last = 0;
try { const v = localStorage.getItem(H.storageKey); if (v !== null) on = v === "1"; } catch { /* 無痕模式 */ }

export const Haptics = {
  get on() { return on; },
  get supported() { return canVibrate || isIOS; },
  get kind() { return canVibrate ? "vibrate" : isIOS ? "ios" : "none"; },
  set(v) { on = v; try { localStorage.setItem(H.storageKey, v ? "1" : "0"); } catch { /* 無痕模式 */ } },
  buzz(pattern, force = false) {
    if (!on) return false;
    const now = performance.now();
    if (!force && now - last < H.minGapMs) return false;            // 連打太密時合併，避免手機一直嗡
    last = now;
    if (canVibrate) { try { navigator.vibrate(pattern); } catch { /* 不支援 */ } }
    else if (isIOS) iosTick();
    this.lastPattern = pattern;
    return true;
  },
  // 按下按鍵的小回饋：不佔用命中震動的冷卻（不然連打時命中的震動會被吃掉）；iPhone 不另外喀，留給命中
  tap() { if (on && canVibrate) { try { navigator.vibrate(6); } catch { /* 不支援 */ } } },
  // me = 自己的座位；null = 同機雙人共用手機（兩邊都算自己）
  handle(events, me) {
    if (!on) return;
    const mine = p => me === null || p === me;
    for (const e of events) {
      if (e.type === "hit") {
        if (e.kind === "counter" || e.kind === "clash") continue;   // 反擊交給 counter、拼刀大招交給 clash_finisher（同一刻，避免互相蓋掉）
        const took = me !== null && e.p === me;
        if (e.final) this.buzz(took ? H.takeFinisher : H.dealFinisher, true);   // 第 4 拳擊飛
        else this.buzz(took ? H.takeBase : H.dealBase);                         // 重擊、第 1～3 拳
      } else if (e.type === "counter") this.buzz(mine(e.p) ? H.counterMe : H.gotCountered, true);
      else if (e.type === "combo_start") this.buzz(H.burst, true);
      else if (e.type === "clash") this.buzz(H.clash);
      else if (e.type === "clash_cut") this.buzz(H.clash);
      else if (e.type === "clash_finisher") this.buzz(me !== null && e.winner !== me ? H.takeRed : H.dealRed, true);   // 拼刀大招＝最重的震動
      else if (e.type === "ko") this.buzz(me !== null && e.p === me ? H.koMe : H.koThem, true);
    }
  },
};
