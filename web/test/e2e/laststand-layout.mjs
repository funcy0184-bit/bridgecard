// 梭了啦版面校正：六種手機大小下走過「賭局契約書 → 牌桌各階段 → 每墩紀錄 → 結算 → 選單」，檢查
//   1. 頁面不會橫向捲動、文字按鈕沒有被自己的框切掉（同 layout-check.mjs 的規則）
//   2. 每個階段最重要的東西整個在螢幕裡、按鈕點得到（被別的東西蓋住也算錯）
// 瀏覽器是朋友（用邀請連結加入）；房主用 WebSocket 直接打，負責換玩法、蓋章、跟著出手
// 等待室是可以捲的表單頁（檢查時像玩家一樣捲到該按鈕）；牌桌不准捲：輪到誰、手牌、按鈕一定要在畫面裡
// 用法：先 npx wrangler dev，再 node test/e2e/laststand-layout.mjs [網址] [截圖資料夾（可省略）]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const SHOTS = process.argv[3] ?? "";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };
const SIZES = [
  ["iPhone SE（第一代）", 320, 568], ["iPhone SE 2／8", 375, 553], ["iPhone 13", 390, 664],
  ["LINE 內建瀏覽器（約）", 390, 600], ["Pixel 7", 412, 839], ["iPhone Pro Max", 430, 739],
];

// 跟 layout-check.mjs 同一套檢查（這裡多排除兩個只在梭了啦牌桌出現的裝飾）
const probe = ([keys, scroll]) => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const issues = [];
  if (document.documentElement.scrollWidth > W + 1) issues.push(`頁面可以橫向捲動（${document.documentElement.scrollWidth}/${W}）`);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#fx, .sr-only, [hidden]") || el.matches("canvas, svg *, option")) continue;
    if (el.closest(".cup, .cv-branch, .frame, .fc, .tc-ace, .seal, .stamp, .clip, .particles, .flash, .shock, .popup, .card.flying, .impactlayer, .aura")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (cs.position !== "fixed" && (r.right > W + 1 || r.left < -1)) {
      let ok = false;
      for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX + s.overflow)) { ok = true; break; } }
      if (!ok) issues.push(`超出螢幕：${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    if (el.childElementCount === 0 && (el.textContent || "").trim()) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) break;
        if (s.overflow === "hidden" || s.overflowX === "hidden" || s.overflowY === "hidden") {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 2 || r.left < ar.left - 2 || r.bottom > ar.bottom + 2) issues.push(`被框切掉：「${el.textContent.trim().slice(0, 12)}」在 ${a.id || a.className}`);
          break;
        }
      }
    }
  }
  for (const k of keys) {
    const el = document.querySelector(k);
    if (!el) { issues.push(`找不到 ${k}`); continue; }
    if (scroll) el.scrollIntoView({ block: "nearest" });     // 可以捲的表單頁：像玩家一樣捲到它
    const r = el.getBoundingClientRect();
    if (r.top < -1 || r.bottom > H + 1 || r.left < -1 || r.right > W + 1) { issues.push(`${k} 不在螢幕裡（${Math.round(r.top)}..${Math.round(r.bottom)} / 高 ${H}）`); continue; }
    // 按鈕要點得到、資訊要看得到：上緣、正中、下緣都不能被別的東西蓋住（底部固定區蓋到上面的資訊也算）
    // 只有短暫的提示條（#banner）不算：它幾秒就收起來
    const name = hit => hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + (typeof hit.className === "string" && hit.className ? "." + hit.className.trim().split(/\s+/).join(".") : "") : "（螢幕外）";
    if (r.width < 2 || r.height < 2) continue;                // 空的（例如還沒輪到你、按鈕列是空的）
    const btn = el.matches("button, a, [role=button]");
    for (const y of btn ? [r.top + r.height / 2] : [r.top + Math.min(4, r.height / 2), r.top + r.height / 2, r.bottom - Math.min(4, r.height / 2)]) {
      const hit = document.elementFromPoint(r.left + r.width / 2, y);
      if (hit && hit.closest("#banner")) continue;
      if (!hit || !(hit === el || el.contains(hit))) { issues.push(`${k} ${btn ? "點不到" : "看不到"}，被 ${name(hit)} 蓋住`); break; }
    }
  }
  return [...new Set(issues)].slice(0, 8);
};

// 房主：WebSocket
function host(code) {
  const p = { seat: -1, room: null, v: null, ver: 0, gid: null, msgs: [], n: 0 };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token: null, name: "大雞" }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") p.seat = m.seat;
      if (m.t === "resync") { p.room = m.r; p.ver = m.ver; p.gid = m.r.gid; if (m.ls) p.v = m.ls; res(); }
      if (m.t === "room") { p.room = m.r; p.ver = m.r.ver; p.gid = m.r.gid; }
      if (m.t === "lsState") { p.v = m.s; p.ver = m.ver; p.gid = m.gid ?? p.gid; }
      if (m.t === "lsEvent") p.ver = m.ver;
    };
  });
  p.cmd = async (o, extra = {}) => {
    const cid = `Y${++p.n}`, k = p.msgs.length;
    p.ws.send(JSON.stringify({ ...o, cid, ...extra }));
    for (let i = 0; i < 300; i++) { const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid); if (r) return r; await sleep(15); }
    fail("房主的指令沒有回覆：" + JSON.stringify(o));
  };
  p.ls = a => p.cmd({ t: "ls", a }, { ver: p.ver, gid: p.gid });
  return p;
}

const b = await chromium.launch();
let total = 0;
for (const [name, w, h] of SIZES) {
  const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
  const H = host(code); await H.joined;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.addInitScript(() => { localStorage.setItem("hb-story-offered", "1"); localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true })); });
  const results = [];
  const check = async (label, keys = [], scroll = false) => {
    await p.waitForTimeout(350);
    const issues = await p.evaluate(probe, [keys, scroll]);
    // P2.5-A：牌桌整個畫面不准捲動
    if (label.startsWith("牌桌")) {
      const sc = await p.evaluate(() => { const t = document.getElementById("lstable"); return [t.scrollHeight, t.clientHeight]; });
      if (sc[0] > sc[1] + 1) issues.push(`牌桌可以捲動（${sc[0]} / ${sc[1]}）`);
    }
    results.push([label, issues]);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/lsl-${w}x${h}-${results.length}.png` });
  };

  await p.goto(`${BASE}/?room=${code}`);
  await p.fill("#name", "小美"); await p.click("#join");
  await p.waitForSelector("#wait:not([hidden])");
  let r = await H.cmd({ t: "mode", mode: "laststand" });
  if (r.t !== "ack") fail("換成梭了啦失敗");
  await p.waitForSelector("#contract:not([hidden])");
  await check("賭局契約書（還沒填）", ["#contract .ctitle", "#contract .csub", "#stakeInput", "#vowInput", "#stakePreview", "#stakeSeal"], true);
  // 模擬鍵盤跳出來（畫面只剩 420 高；模擬器，不是真機）：點輸入框會自己捲進畫面、蓋章捲得到
  await p.setViewportSize({ width: w, height: Math.min(h, 420) });
  await p.click("#stakeInput");
  results.push(["鍵盤跳出（模擬 420 高）：賭上之物", await p.evaluate(() => { const r = document.getElementById("stakeInput").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight ? [] : [`輸入框不在畫面裡（${Math.round(r.top)}..${Math.round(r.bottom)}）`]; })]);
  await p.click("#vowInput");
  await check("鍵盤跳出（模擬 420 高）：豪言＋蓋章", ["#vowInput", "#stakeSeal"], true);
  await p.evaluate(() => document.activeElement?.blur());
  await p.setViewportSize({ width: w, height: h });
  await p.click("#stakeInput"); await p.keyboard.type("阿嬤的藍白拖阿嬤的藍白拖阿嬤的藍白拖阿嬤的藍白拖");   // 24 個字：最長的情況
  await p.fill("#vowInput", "這".repeat(30));                                                          // 豪言也填滿 30 字
  await check("賭局契約書（填滿 24＋30 字）", ["#stakeInput", "#vowInput", "#stakePreview", "#stakeCount", "#vowCount", "#stakeSeal"], true);
  await p.click("#stakeSeal");
  await p.waitForFunction(() => !document.getElementById("readyBtn").disabled, null, { timeout: 4000 });
  await H.cmd({ t: "stake", stake: "我最後的尊嚴我最後的尊嚴我最後的尊嚴我最後的尊嚴", vow: "今天不把你打到懷疑人生我就不叫大雞今天不把你打" });
  await H.cmd({ t: "ready", ready: true });
  await p.waitForTimeout(1300);                              // 蓋章動畫＋平滑捲動
  const readyInView = await p.evaluate(() => { const r = document.getElementById("readyBtn").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  if (!readyInView) results.push(["蓋章之後", ["「準備好了」沒有自己捲進畫面"]]);
  await check("等待室：雙方賭上之物＋豪言＋準備", ["#plateMeStake", "#plateOppStake", "#plateMeVow", "#plateOppVow", "#readyBtn"], true);
  await p.click("#readyBtn");
  await p.waitForSelector("#lstable:not([hidden])");
  await p.waitForTimeout(2600);                 // 開場的提示條自己收起來
  // 每個階段都要看得到：雙方籌碼、本墩方向、雙方已投入、輪到誰、自己的手牌和按鈕
  const info = ["#lsOppChips", "#lsMyChips", "#lsDirBig", "#lsMyCommit", "#lsOppCommit", "#lsTurn", "#lsOppSlot", "#lsMySlot"];
  const core = ["#lsTrick", "#lsMenuBtn", "#lsDirNote", "#lsOppCounts", ...info, "#lsHand", "#lsActions"];
  await check("牌桌：第 1 墩開局", core);

  // 打下去：房主照固定策略（能加就加到頂，讓朋友碰到「面對加注」；面對加注就跟）；朋友在每個新畫面先檢查版面
  const seen = new Set();
  const once = async (key, label, keys) => { if (seen.has(key)) return; seen.add(key); await check(label, keys); };
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    if (await p.locator("#matchEnd:not([hidden])").isVisible()) break;
    const v = H.v;
    if (v && !v.result) {
      const L = v.legal;
      if (L) {
        if (L.flip) { await H.ls({ t: "flip", flip: false }); continue; }
        if (L.safeguard) { await H.ls({ t: "safeguard", use: false }); continue; }
        if (L.lock?.length) { await H.ls({ t: "lock", card: L.lock[0] }); continue; }
        if (L.call) { await H.ls({ t: "call" }); continue; }
        if (L.raise && !seen.has("raiseHost" + v.trick)) { seen.add("raiseHost" + v.trick); await H.ls({ t: "raise", to: L.raise[1] }); continue; }
        if (L.check) { await H.ls({ t: "check" }); continue; }
      }
    }
    const has = a => p.isVisible(`#lsActions [data-a="${a}"]:not([disabled])`);
    const trick = await p.evaluate(() => globalThis.__hbLS?.()?.trick ?? 0);
    if (await has("noflip")) { await once("flip", "牌桌：宣戰權（翻不翻）", [...core, '#lsActions [data-a="flip"]', '#lsActions [data-a="noflip"]']); await p.click('#lsActions [data-a="noflip"]'); }
    else if (await has("nosafe")) { await once("safe", "牌桌：保命（用不用）", [...info, '#lsActions [data-a="safe"]', '#lsActions [data-a="nosafe"]']); await p.click('#lsActions [data-a="nosafe"]'); }
    else if (await p.locator("#lsHand .lscard:not([disabled])").count() && await p.isVisible('#lsActions [data-a="lock"]')) {
      await p.locator("#lsHand .lscard:not([disabled])").first().click();
      await once("lock", "牌桌：選好牌、準備鎖牌", [...info, "#lsRisk", "#lsHand", '#lsActions [data-a="lock"]']);
      await p.click('#lsActions [data-a="lock"]');
    }
    else if (await has("call")) {
      await once(trick >= 7 ? "facing7" : "facing", trick >= 7 ? "牌桌：第 7–9 墩面對梭哈／加注" : "牌桌：面對加注（若接戰／若棄牌）", [...info, "#lsRisk", '#lsActions [data-a="call"]', '#lsActions [data-a="fold"]']);
      await p.click('#lsActions [data-a="call"]');
    }
    else if (await has("raiseopen")) {
      // 加注：先展開金額列（−／加注到／＋／取消；第 7–9 墩多一顆梭哈），量完收起來再過牌
      const key = trick >= 7 ? "raise7" : "raise";
      if (!seen.has(key)) {
        await once(key + "btns", trick >= 7 ? "牌桌：第 7–9 墩輪到你下注" : "牌桌：輪到你下注", [...info, '#lsActions [data-a="check"]', '#lsActions [data-a="raiseopen"]']);
        await p.click('#lsActions [data-a="raiseopen"]');
        await once(key, trick >= 7 ? "牌桌：第 7–9 墩加注金額（可以梭哈）" : "牌桌：加注金額列", [...info, "#lsRisk", '#lsActions [data-a="raise"]', '#lsActions [data-a="minus"]', '#lsActions [data-a="plus"]', '#lsActions [data-a="cancel"]']);
        await p.click('#lsActions [data-a="cancel"]');
      }
      await p.click('#lsActions [data-a="check"]');
    }
    else if (await has("check")) await p.click('#lsActions [data-a="check"]');
    else if (trick >= 2 && !seen.has("reveal") && await p.isVisible("#lsLast.hot")) await once("reveal", "牌桌：上一墩攤在桌上", ["#lsLast", ...info, "#lsHand"]);
    await sleep(120);
  }
  if (!await p.locator("#matchEnd:not([hidden])").isVisible()) fail(`${name}：150 秒內沒打完一場`);
  await check("結算（雙方賭上之物都是 24 字）", ["#meTitle", "#meRematch"]);
  // 每墩紀錄、選單：結算蓋在牌桌上，所以再來一場之後在新的一場看
  await p.click("#meRematch"); await H.cmd({ t: "rematch", ready: true });
  await p.waitForSelector("#matchEnd", { state: "hidden", timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(2600);
  if (await p.isVisible("#lstable:not([hidden])")) {
    // P2.5-A：每墩紀錄、完整試算都是面板（不推動牌桌）
    await p.evaluate(() => { document.getElementById("lsLast").hidden = false; });   // 新的一場還沒有上一墩：直接打開面板看版面
    await p.click("#lsLast"); await check("每墩紀錄（面板）", ["#lsLogPanel .sheet", "#lsLogPanel [data-close]"]);
    await p.click("#lsLogPanel [data-close]");
    await p.click("#lsHelpBtn"); await check("完整試算（? 面板）", ["#lsHelpPanel .sheet", "#lsHelpPanel [data-close]"]);
    await p.click("#lsHelpPanel [data-close]");
    await p.click("#lsMenuBtn"); await check("牌桌選單", ["#menu .sheet"]);
  } else results.push(["再來一場", ["再來一場之後沒有回到梭了啦牌桌"]]);
  if (errors.length) results.push(["頁面錯誤", errors.slice(0, 3)]);

  const bad = results.filter(([, r]) => r.length);
  total += bad.length;
  console.log(`${name}（${w}×${h}）：${bad.length ? `⚠ ${bad.length} 個畫面有問題` : "全部 OK"}（檢查 ${results.length} 個畫面：${results.map(([l]) => l.replace(/^牌桌：/, "")).join("、")}）`);
  for (const [label, r] of bad) { console.log(`   · ${label}`); for (const x of r) console.log(`       - ${x}`); }
  H.ws.close();
  await ctx.close();
}
await b.close();
console.log(total ? `共 ${total} 個畫面要修` : "梭了啦版面校正：每個大小、每個畫面都通過");
process.exit(total ? 1 : 0);
