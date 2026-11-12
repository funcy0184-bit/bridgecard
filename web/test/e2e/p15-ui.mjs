// P1.5 介面驗收（瀏覽器真的點；模擬手機，不是真機）
//   首頁：兩個玩法入口（經典橋牌／梭了啦！這局賭什麼？）都在第一個畫面；點梭了啦播轉場（約 0.6 秒）→ 新玩法選單（兩行標題＋輸了交出來。）
//         減少動態效果：不播轉場直接換；回經典
//   阿元：首頁沒有「阿禾」；只有一顆「跟阿元玩」；第一次問「要我先教你怎麼玩嗎？」→ 先教我一下（教學，結尾直接開打）／直接開打；
//         問過、教學打完（新舊存檔都算）、有打到一半的局 → 直接開打；選單和章節卡有「重新教學」
//   梭了啦選單 → 找朋友開一局：開好的桌自動是梭了啦；契約書：固定標題／欄位名／副標、19 句隨機提示（不連續重複、聚焦就停）、
//         賽前豪言（選填、字數、太衝的字擋下）、預覽、雙方名牌看得到；牌桌上的提示條不蓋對手那一格
// 用法：先 npx wrangler dev，再 node test/e2e/p15-ui.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const text = (P, sel) => P.textContent(sel).then(t => (t ?? "").trim());
const inView = (P, sel) => P.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }, sel);
async function phone(label, { device = "iPhone 13", storage = {}, extra = {} } = {}) {
  const ctx = await browser.newContext({ ...devices[device], ...extra });
  await ctx.addInitScript(st => { if (sessionStorage.getItem("__init")) return; sessionStorage.setItem("__init", "1"); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, storage);
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/WebSocket|Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  await p.goto(BASE + "/");
  return { ctx, p };
}
const SPEC_PH = ["這場，你要賭上什麼？", "你要交出什麼？", "輸了要留下什麼？", "這局拿什麼上桌？", "先說好，輸了交什麼？", "今天打算失去什麼？", "你還有什麼輸得起的？",
  "除了尊嚴，還有什麼？", "請填寫本次失物。", "請提供一項你不該拿來賭的東西。", "你還想保住什麼？", "這東西你確定要押？", "本次預計失去的物品：", "所以，你今天帶了什麼來？",
  "請問這次打算拿什麼抵命？", "有什麼東西是你不能失去的？", "請先登記本次可能遺失的物品。", "你打算拿什麼換一場勝利？", "這個東西，對方知道你拿來賭嗎？"];

// ---------------- 首頁與轉場 ----------------
console.log("首頁：兩個玩法入口、轉場");
{
  const { ctx, p } = await phone("首頁", { device: "iPhone SE" });
  await sleep(700);
  ok(!(await p.evaluate(() => document.body.innerText.includes("阿禾"))), "首頁看不到「阿禾」");
  ok(await inView(p, "#modeClassic") && await inView(p, "#modeShuo") && (await text(p, "#modeShuo")).includes("梭了啦！") && (await text(p, "#modeShuo")).includes("這局賭什麼？"),
    "iPhone SE 第一個畫面就看得到兩個玩法入口（經典橋牌／梭了啦！這局賭什麼？），不用捲");
  ok((await p.getAttribute("#modeClassic", "aria-pressed")) === "true" && (await text(p, "#solo .lbl")).startsWith("跟阿元玩") && !(await p.locator("#storyCard").count()),
    "經典橋牌是目前的玩法；下面只有一顆「跟阿元玩」（跟阿元學／跟阿元打合併）");
  const t0 = Date.now();
  await p.click("#modeShuo");
  const ran = await p.evaluate(() => { const o = document.getElementById("modeFx"); return !o.hidden && o.classList.contains("run"); });
  await p.waitForSelector("#shuo:not([hidden])", { timeout: 2000 });
  const shown = Date.now() - t0;
  await p.waitForSelector("#modeFx", { state: "hidden", timeout: 2000 });
  const done = Date.now() - t0;
  ok(ran && shown >= 450 && shown <= 900 && done <= 1200, `點梭了啦：播轉場（綠牌桌暗下 → 翻牌 → 酒紅暗金 → 換標題），${shown} ms 後進新玩法選單、${done} ms 轉場收完`);
  const anims = await p.evaluate(() => [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    .filter(r => r.type === 7 && r.name.startsWith("mf")).map(r => r.cssText).join(" "));
  ok(!/(width|height|top|left|filter|box-shadow)\s*:/.test(anims.replace(/opacity|transform/g, "")), "轉場只動 transform／opacity（低階手機也順）");
  ok((await text(p, "#shuo h1 .l1")) === "梭了啦！" && (await text(p, "#shuo h1 .l2")) === "這局賭什麼？" && (await text(p, "#shuo .sh-tag")) === "輸了交出來。",
    "新玩法選單：標題兩行「梭了啦！／這局賭什麼？」、副標「輸了交出來。」");
  ok((await p.getAttribute('meta[name="theme-color"]', "content")) === "#3A0D14", "瀏覽器上方的顏色也換成酒紅");
  await p.screenshot({ path: `${SHOTS}/p15-shuo-se.png` });
  await p.click("#shuoHow"); await sleep(300);
  ok(await p.isVisible("#shuoRules") && (await text(p, "#shuoRules")).includes("每人押到「雙方較少的籌碼」"), "「怎麼玩？」：規則小抄（梭哈是每人押到雙方較少的籌碼）");
  await p.click("#shuoRules [data-close]");
  await p.click("#shuoBack"); await p.waitForSelector("#home:not([hidden])");
  ok((await p.getAttribute('meta[name="theme-color"]', "content")) === "#24170F", "回經典橋牌：首頁、顏色換回來");
  await ctx.close();
}
{
  const { ctx, p } = await phone("減少動態", { extra: { reducedMotion: "reduce" } });
  const t0 = Date.now();
  await p.click("#modeShuo");
  await p.waitForSelector("#shuo:not([hidden])", { timeout: 2000 });
  ok(Date.now() - t0 < 400 && await p.isHidden("#modeFx"), `系統「減少動態效果」：不播轉場，直接進新玩法選單（${Date.now() - t0} ms）`);
  await ctx.close();
}

// ---------------- 跟阿元玩：教學分流 ----------------
console.log("跟阿元玩：第一次問要不要教");
{
  const { ctx, p } = await phone("新玩家");
  await p.click("#solo");
  ok(await p.isVisible("#storyOffer") && (await text(p, "#offerQ")).includes("要我先教你怎麼玩嗎？") && (await p.getAttribute("#offerTeach", "href")) === "/story/?then=play",
    "第一次按「跟阿元玩」：阿元問「要我先教你怎麼玩嗎？」；「先教我一下」→ 教學（教完直接開打）");
  await p.click("#offerSkip");
  await p.waitForSelector("#table:not([hidden])", { timeout: 5000 });
  ok(true, "「直接開打」：跳過教學，直接跟阿元對戰");
  await p.goto(BASE + "/?solo=1"); await p.waitForSelector("#table:not([hidden])");
  await p.goto(BASE + "/"); await p.click("#solo");
  await p.waitForSelector("#table:not([hidden])", { timeout: 5000 });
  ok(await p.isHidden("#storyOffer"), "之後再按「跟阿元玩」：不再問，直接開打（有打到一半的局就接著打）");
  await ctx.close();
}
{
  const { ctx, p } = await phone("教學打完", { storage: { "hb.story.v4": JSON.stringify({ v: 4, page: 11, answers: {}, seen: {}, picks: {}, finished: true }) } });
  await sleep(300);
  ok((await text(p, "#chapHead")).includes("複習") && (await p.getAttribute("#reTeach", "href")) === "/story/?act=1" && (await text(p, "#reTeach")).includes("重新教學"),
    "教學打完：章節區是「想複習哪一幕？」，選單有「重新教學」");
  await p.click("#solo");
  await p.waitForSelector("#table:not([hidden])", { timeout: 5000 });
  ok(await p.isHidden("#storyOffer"), "完成過教學：按「跟阿元玩」直接開打，不問");
  await ctx.close();
}
{
  const { ctx, p } = await phone("舊存檔", { storage: { "hb.story.v3": JSON.stringify({ finished: true }) } });
  await p.click("#solo");
  await p.waitForSelector("#table:not([hidden])", { timeout: 5000 });
  ok(await p.isHidden("#storyOffer"), "舊版（v3）存檔打完過教學：一樣直接開打（存檔相容）");
  await ctx.close();
}
{
  const { ctx, p } = await phone("問過的舊玩家", { storage: { "hb-story-offered": "1" } });
  await p.click("#solo");
  await p.waitForSelector("#table:not([hidden])", { timeout: 5000 });
  ok(await p.isHidden("#storyOffer"), "舊版問過「要不要學」的玩家：不重複問");
  await ctx.close();
}
{
  const { ctx, p } = await phone("教到一半", { storage: { "hb.story.v4": JSON.stringify({ v: 4, page: 4, answers: {}, seen: {}, picks: {}, finished: false }) } });
  await p.click("#solo");
  ok(await p.isVisible("#storyOffer"), "教學只學到一半（沒被問過）：第一次按「跟阿元玩」還是會問（先教我一下 = 接著上次學）");
  await p.click("#offerTeach");
  await p.waitForURL(/\/story\/\?then=play$/);
  await p.waitForSelector("#sHand .card", { timeout: 8000 });
  ok(!(await p.evaluate(() => document.body.innerText.includes("阿禾"))), "教學頁看不到「阿禾」");
  await ctx.close();
}

// ---------------- 梭了啦：開桌、契約書、牌桌提示條 ----------------
console.log("梭了啦：找朋友開一局、契約書");
const H = await phone("房主");
await H.p.click("#modeShuo"); await H.p.waitForSelector("#shuo:not([hidden])");
await H.p.click("#shuoCreate"); await H.p.waitForSelector("#online:not([hidden])");
ok((await text(H.p, "#onlineTitle")) === "梭了啦！找朋友開一局", "梭了啦選單 → 找朋友開一局：朋友連線頁標題換成新玩法");
await H.p.fill("#name", "大雞"); await H.p.click("#create");
await H.p.waitForSelector("#contract:not([hidden])", { timeout: 6000 });
ok((await H.p.getAttribute('#modePick [data-mode="laststand"]', "aria-checked")) === "true", "開好的桌自動是「梭了啦！這局賭什麼？」（不用再手動換）");
ok((await text(H.p, "#modePick [data-mode=laststand]")).includes("梭了啦！") && (await text(H.p, "#modePick [data-mode=laststand]")).includes("輸了交出來。"), "等待室的玩法按鈕也是新名稱");
ok((await text(H.p, ".ctitle")) === "賭局契約書" && (await text(H.p, 'label[for="stakeInput"]')) === "賭上之物" && (await text(H.p, ".csub")) === "想要贏，那必須得輸得起。",
  "契約書：標題「賭局契約書」、欄位「賭上之物」、副標「想要贏，那必須得輸得起。」");
const ph = await H.p.evaluate(() => globalThis.__hbPh());
ok(ph.length === 19 && SPEC_PH.every((t, i) => ph[i] === t), "提示句：19 句跟規格一字不差");
const draws = (await H.p.evaluate(() => globalThis.__hbPhDraw(19 * 30))).map(i => ph[i]);
let repeat = 0;
for (let i = 1; i < draws.length; i++) if (draws[i] === draws[i - 1]) repeat++;
const counts = SPEC_PH.map(t => draws.filter(x => x === t).length);
ok(repeat === 0 && Math.min(...counts) >= 29 && Math.max(...counts) <= 31, `連抽 570 句：沒有連續重複；每句出現 ${Math.min(...counts)}～${Math.max(...counts)} 次（一輪 19 句全部輪過才重洗）`);
// 在頁面裡記下每次換句的時間（不受測試程式輪詢延遲影響）
await H.p.evaluate(() => { const el = document.getElementById("stakePh"); window.__phLog = [[performance.now(), el.textContent]];
  new MutationObserver(() => { const t = el.textContent; if (t !== window.__phLog.at(-1)[1]) window.__phLog.push([performance.now(), t]); }).observe(el, { childList: true, characterData: true, subtree: true }); });
await sleep(13000);
const phLog = await H.p.evaluate(() => window.__phLog);
const seen = phLog.map(x => x[1]), gaps = phLog.slice(1).map((x, i) => (x[0] - phLog[i][0]) / 1000);
ok(seen.length >= 3 && seen.every(t => SPEC_PH.includes(t)) && seen.every((t, i) => i === 0 || t !== seen[i - 1]) && gaps.slice(1).every(g => g >= 2.9 && g <= 4.4),
  `空著時每 3～4 秒換一句（13 秒內換了 ${seen.length - 1} 次，間隔 ${gaps.map(g => g.toFixed(1)).join("／")} 秒；含 0.45 秒淡出）：${seen.join("／")}`);
await H.p.click("#stakeInput");
const f0 = await text(H.p, "#stakePh"); await sleep(4300);
ok((await text(H.p, "#stakePh")) === f0, "聚焦輸入框：停止輪播");
await H.p.keyboard.type("阿嬤的藍白拖");
await H.p.click(".ctitle"); await sleep(4300);
ok((await H.p.inputValue("#stakeInput")) === "阿嬤的藍白拖" && await H.p.isHidden("#stakePh"), "有字：不輪播、不蓋掉玩家打的字");
await H.p.fill("#vowInput", "一".repeat(31));
ok((await text(H.p, "#vowErr")).includes("30") && (await text(H.p, "#vowCount")) === "31/30", "賽前豪言超過 30 字：字數變紅、說明原因");
await H.p.fill("#vowInput", "幹 你 娘");
ok((await text(H.p, "#vowErr")).includes("太衝"), "太衝的字（中間插空白也一樣）：擋下並說明");
await H.p.fill("#vowInput", "這局我閉著眼睛都能贏");
ok((await text(H.p, "#stakePreview")) === "本人自願於本場賭局中賭上『阿嬤的藍白拖』。賽前豪言：「這局我閉著眼睛都能贏」", "預覽：賭上之物＋賽前豪言");
await H.p.click("#stakeSeal");
await H.p.waitForFunction(() => document.getElementById("contractState").textContent.includes("已蓋章"), null, { timeout: 4000 });
const code = (await text(H.p, "#bigCode")).replace(/\s/g, "");
const G = await phone("朋友", { device: "Pixel 7", storage: { "hb-story-offered": "1" } });
await G.p.goto(`${BASE}/?room=${code}`);
await G.p.waitForSelector("#online:not([hidden])");
ok((await text(G.p, "#inviteText")).includes("梭了啦！這局賭什麼？"), "邀請連結：看得到是「梭了啦！這局賭什麼？」的桌");
await G.p.fill("#name", "小美"); await G.p.click("#join");
await G.p.waitForSelector("#contract:not([hidden])", { timeout: 6000 });
await G.p.click("#stakeSeal");
await H.p.waitForFunction(() => document.getElementById("plateOppStake").textContent.includes("我最後的尊嚴"), null, { timeout: 4000 });
await G.p.waitForFunction(() => !document.getElementById("plateOppVow").hidden, null, { timeout: 4000 });
ok((await text(G.p, "#plateOppVow")) === "豪言「這局我閉著眼睛都能贏」" && (await H.p.isHidden("#plateOppVow")), "雙方名牌：看得到對方的賭上之物和豪言（沒寫豪言就不顯示）");
await H.p.screenshot({ path: `${SHOTS}/p15-wait.png` });
await H.p.click("#readyBtn"); await sleep(200); await G.p.click("#readyBtn");
await H.p.waitForSelector("#lstable:not([hidden])", { timeout: 6000 });
await H.p.waitForSelector("#banner:not([hidden])", { timeout: 3000 }).catch(() => {});
const geo = await H.p.evaluate(() => {
  const b = document.getElementById("banner"), o = document.getElementById("lsOpp"), m = document.getElementById("lsMenuBtn");
  const rb = b.getBoundingClientRect(), ro = o.getBoundingClientRect(), rm = m.getBoundingClientRect();
  return { shown: !b.hidden, text: b.textContent, overlapOpp: rb.bottom > ro.top + 1, overlapMenu: rb.right > rm.left + 1, b: [rb.top, rb.bottom, rb.right].map(Math.round), o: Math.round(ro.top), m: Math.round(rm.left) };
});
ok(geo.shown && !geo.overlapOpp && !geo.overlapMenu, `牌桌上的提示條（${geo.text}）在標題列：不蓋對手那一格、不蓋選單鈕（提示條 ${geo.b.join("/")}、對手格上緣 ${geo.o}、選單鈕左緣 ${geo.m}）`);
await H.p.screenshot({ path: `${SHOTS}/p15-table-banner.png` });
ok(!(await H.p.evaluate(() => document.body.innerText.includes("阿禾") || document.body.innerText.includes("逆命"))), "牌桌和等待室看不到舊名字（阿禾、逆命賭局）");

ok(errors.length === 0, "全程沒有頁面錯誤" + (errors.length ? "：" + errors.slice(0, 4).join("｜") : ""));
await browser.close();
console.log(fails ? `\n${fails} 項沒過` : "\nP1.5 介面驗收全部通過");
process.exit(fails ? 1 : 0);
