// C1 雙方暱稱（瀏覽器真的點畫面）：房主用桌機、朋友用手機
//   1 房主輸入中文暱稱開桌（空白、太長先被擋）  2 朋友點邀請連結：看到誰開的桌、房號帶好，只填自己的暱稱
//   3 另一桌：朋友手動輸入房號加入（也要填自己的暱稱）  4 雙方暱稱同步  5 改名後雙方即時看到（按了準備就鎖）
//   6 兩人同名：名牌標房主／訪客、牌桌上對手名字後面加（房主）／（訪客）  7 空白、過長的提示
//   8 兩人都準備後開打  9 重新整理名字還在  10 桌機與手機  11 對局、結算顯示正確名字、不會冒出阿禾
//   12 重連不會多一個玩家  另外：鍵盤跳出來（畫面變矮）時輸入欄和主要按鈕還點得到
// 用法：先 npx wrangler dev，再 node test/e2e/names-ui.mjs [網址] [截圖資料夾]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:8787", SHOTS = process.argv[3] ?? "test-results";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const browser = await chromium.launch(process.env.HB_PROXY ? { proxy: { server: process.env.HB_PROXY } } : {});
const shot = (P, n) => P.screenshot({ path: `${SHOTS}/nm-${n}.png` });
const S = P => P.evaluate(() => globalThis.__hbState?.() ?? null);
const text = (P, sel) => P.textContent(sel).then(t => (t ?? "").trim());
const until = async (P, fn, arg, ms = 6000) => P.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);

async function phone(kind, label, url = BASE) {
  const ctx = await browser.newContext(kind === "desktop" ? { viewport: { width: 1280, height: 800 } } : { ...devices["iPhone 13"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("hb-story-offered", "1"); } catch { /* */ } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/WebSocket|Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  await p.goto(url);
  return { ctx, p };
}
// 鍵盤跳出來：可視範圍變矮。欄位和按鈕捲得到、點得到（不被切掉、不被蓋住）
async function reachable(P, sels) {
  const out = [];
  for (const sel of sels) {
    await P.locator(sel).scrollIntoViewIfNeeded();
    out.push(await P.$eval(sel, el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit) || hit?.closest("label") === el.closest("label"));
    }));
  }
  return out.every(Boolean);
}
// 照真人的方式點畫面打一步
async function step(P) {
  const s = await S(P);
  if (!s?.st || s.screen !== "table" || s.waiting) return "wait";
  if (await P.isVisible("#result:not([hidden])")) return "result";
  const x = s.st;
  try {
    if (x.phase === 1) {
      if (!(await P.isVisible("#bidPanel.mine"))) return "wait";
      if (x.highestBid < 0) {
        await P.locator("#bidLevels button:not([disabled])").first().click({ timeout: 2000 }); await sleep(80);
        await P.locator("#bidStrains button:not([disabled])").nth(1).click({ timeout: 2000 }); await sleep(120);
        await P.click("#bidConfirm", { timeout: 2000 });
      } else await P.click("#bidPass", { timeout: 2000 });
      return "acted";
    }
    if ((x.phase === 0 || x.phase === 2) && x.currentSeat === x.seat && x.followCard < 0 && x.legal.length) {
      await P.locator(`#hand .card[data-id="${x.legal[0]}"]`).click({ position: { x: 10, y: 34 }, timeout: 2000 }); await sleep(80);
      await P.click("#playBtn", { timeout: 2000 });
      return "acted";
    }
  } catch { return "wait"; }
  return "wait";
}

// ================= 第 1 桌：房主（桌機）開桌，朋友（手機）點邀請連結 =================
console.log("房主輸入暱稱開桌");
const H = await phone("desktop", "房主-桌機");
await H.p.click("#goOnline");
await H.p.waitForSelector("#online:not([hidden])");
await H.p.fill("#name", "");
await H.p.click("#create");
ok(await H.p.isVisible("#online:not([hidden])") && (await text(H.p, "#nameErr")).includes("請先填你的暱稱"), `空白暱稱按「開一桌」：擋下來，提示「${await text(H.p, "#nameErr")}」`);
await H.p.fill("#name", "一二三四五六七八九十一二三四五六七");
ok((await text(H.p, "#nameCount")) === "17/16" && (await H.p.getAttribute("#nameCount", "class")).includes("over") && (await text(H.p, "#nameErr")).includes("縮短"), `17 個字：字數「${await text(H.p, "#nameCount")}」變紅、提示縮短`);
await H.p.click("#create");
ok(await H.p.isVisible("#online:not([hidden])"), "太長的暱稱按「開一桌」：不會開桌");
await H.p.fill("#name", "  阿明  ");
ok((await text(H.p, "#nameCount")) === "2/16" && (await H.p.isHidden("#nameErr")), "改成「阿明」：字數 2/16、提示消失");
// 注音選字時按 Enter（isComposing）：是選字，不是送出
await H.p.dispatchEvent("#name", "keydown", { key: "Enter", isComposing: true, bubbles: true });
await sleep(400);
ok(await H.p.isVisible("#online:not([hidden])"), "注音／拼音選字中按 Enter：不會被當成「開一桌」");
await H.p.click("#create");
await H.p.waitForSelector("#wait:not([hidden])");
const code = (await text(H.p, "#bigCode")).replace(/\s/g, "");
await until(H.p, () => document.getElementById("plateMeName").textContent === "阿明");
ok((await text(H.p, "#plateMeName")) === "阿明" && (await text(H.p, "#plateMe small")).includes("房主"), `等待畫面看得到自己的名字「${await text(H.p, "#plateMeName")}」、標示「${await text(H.p, "#plateMe small")}」（房號 ${code}）`);
ok(await H.p.evaluate(() => localStorage.getItem("hb-name")) === "阿明", "記住這次的暱稱（下次自動帶出來，可以改）");

console.log("朋友點邀請連結（手機）");
const G = await phone("mobile", "朋友-手機", `${BASE}/?room=${code}`);
await G.p.waitForSelector("#online:not([hidden])");
await until(G.p, () => document.getElementById("inviteText").textContent.includes("開的桌"));
ok(await G.p.isVisible("#inviteCard:not([hidden])") && (await text(G.p, "#inviteText")).includes("「阿明」開的桌"), `看到房間簡介：「${await text(G.p, "#inviteText")}」`);
ok(await G.p.inputValue("#code") === code && await G.p.$eval("#code", el => el.readOnly) && await G.p.isHidden("#create"), "房號已經帶好（不用再輸入）、沒有「開一桌」來搗亂");
ok((await G.p.inputValue("#name")) === "", "朋友的暱稱欄是空的（不會帶到房主的名字）");
await G.p.click("#join");
ok(await G.p.isVisible("#online:not([hidden])") && (await text(G.p, "#nameErr")).includes("請先填你的暱稱"), "沒填暱稱按「加入牌桌」：擋下來");
// 鍵盤跳出來：畫面變矮，暱稱欄和「加入牌桌」還點得到
await G.p.setViewportSize({ width: 390, height: 420 });
await G.p.focus("#name");
ok(await reachable(G.p, ["#name", "#join"]), "鍵盤跳出來（可視高度 420）：暱稱欄和「加入牌桌」捲得到、點得到");
await shot(G.p, "invite-keyboard");
await G.p.setViewportSize({ width: 390, height: 664 });
await G.p.fill("#name", "小美");
await shot(G.p, "invite");
await G.p.click("#join");
await G.p.waitForSelector("#wait:not([hidden])");
await until(H.p, () => document.getElementById("plateOppName").textContent === "小美");
await until(G.p, () => document.getElementById("plateOppName").textContent === "阿明");
ok((await text(H.p, "#plateOppName")) === "小美" && (await text(G.p, "#plateOppName")) === "阿明" && (await text(G.p, "#plateMeName")) === "小美",
  `加入成功：房主看到「${await text(H.p, "#plateOppName")}」、朋友看到自己「${await text(G.p, "#plateMeName")}」和房主「${await text(G.p, "#plateOppName")}」`);
ok((await text(G.p, "#plateMe small")).includes("訪客") && (await text(G.p, "#plateOpp small")).includes("房主"), "朋友那邊標示：自己是訪客、對方是房主");

console.log("改名（等待畫面）");
await H.p.click("#renameBtn");
await H.p.waitForSelector("#renameBox:not([hidden])");
ok((await H.p.inputValue("#renameInput")) === "阿明", "按「改名」：名牌換成輸入欄，帶出原本的名字");
await H.p.fill("#renameInput", "");
await H.p.click("#renameOk");
ok((await text(H.p, "#renameErr")).includes("請先填你的暱稱"), "改成空白：擋下來");
await H.p.fill("#renameInput", "阿明哥");
await H.p.click("#renameOk");
await until(G.p, () => document.getElementById("plateOppName").textContent === "阿明哥");
{
  // 伺服器先回房主「改好了」、再廣播給兩邊；兩支手機各自的連線誰先到不一定，所以兩邊都等一下（最多 3 秒）
  await until(H.p, () => document.getElementById("plateMeName").textContent === "阿明哥" && document.getElementById("renameBox").hidden, null, 3000);
  const v = { guestSees: await text(G.p, "#plateOppName"), hostPlate: await text(H.p, "#plateMeName"), boxHidden: await H.p.isHidden("#renameBox") };
  ok(v.guestSees === "阿明哥" && v.hostPlate === "阿明哥" && v.boxHidden, `房主改成「阿明哥」：朋友那邊即時更新 ${JSON.stringify(v)}`);
}
ok((await text(G.p, "#banner")).includes("阿明把暱稱改成「阿明哥」"), `朋友看到提示「${await text(G.p, "#banner")}」`);
// 朋友在手機上改名：鍵盤跳出來時輸入欄和「好」按鈕還點得到
await G.p.setViewportSize({ width: 390, height: 420 });
await G.p.click("#renameBtn");
await G.p.waitForSelector("#renameBox:not([hidden])");
ok(await reachable(G.p, ["#renameInput", "#renameOk"]), "手機改名、鍵盤跳出來：輸入欄和「好」按鈕捲得到、點得到");
await shot(G.p, "rename-keyboard");
await G.p.fill("#renameInput", "小美美");
await G.p.click("#renameOk");
await G.p.setViewportSize({ width: 390, height: 664 });
await until(H.p, () => document.getElementById("plateOppName").textContent === "小美美");
ok((await text(H.p, "#plateOppName")) === "小美美", "朋友改成「小美美」：房主那邊即時更新");
await G.p.click("#readyBtn");
await until(G.p, () => document.getElementById("renameBtn").hidden);
ok(await G.p.isHidden("#renameBtn"), "朋友按了準備：「改名」按鈕收起來（要先取消準備才能改）");
await shot(H.p, "wait-renamed");

console.log("開打、重新整理、對局中的名字");
await H.p.click("#readyBtn");
await Promise.all([H.p.waitForSelector("#table:not([hidden])"), G.p.waitForSelector("#table:not([hidden])")]);
await sleep(800);
const names = async P => ({ opp: await text(P, "#oppName"), top: await text(P, "#oppNameTop"), bid: await text(P, "#bidOppName"), rt: await text(P, "#rtOppName") });
const nh = await names(H.p), ng = await names(G.p);
ok(Object.values(nh).every(v => v === "小美美") && Object.values(ng).every(v => v === "阿明哥"), `牌桌上的對手名字（名牌、比分、叫牌、結算）：房主看到 ${JSON.stringify(nh)}，朋友看到 ${JSON.stringify(ng)}`);
await H.p.reload();
await H.p.waitForSelector("#table:not([hidden])", { timeout: 10000 });
await until(G.p, () => globalThis.__hbState?.().room?.status === "IN_GAME", null, 8000);
const sH = await S(H.p), sG = await S(G.p);
ok(sH.room.seats.map(s => s.name).join() === "阿明哥,小美美" && sG.room.seats.map(s => s.name).join() === "阿明哥,小美美" && sH.room.seats.filter(s => s.taken).length === 2,
  "房主重新整理：名字還是「阿明哥」、朋友那邊沒變，也沒有多一個玩家");
ok((await text(H.p, "#oppName")) === "小美美", "重新整理後房主牌桌上的對手名字還是「小美美」");
// 回個話：對方看到的是暱稱，不是阿禾
await G.p.click("#talkBtn"); await sleep(150);
await G.p.locator('#emoteList button[data-emote="pretty"]').click();
await until(H.p, () => !document.getElementById("quip").hidden);
ok((await text(H.p, "#quip")).includes("小美美"), `回個話：房主看到「${await text(H.p, "#quip")}」`);
// 打一局到結算：輪到誰、結算都用暱稱
let sawTurn = "";
for (let i = 0; i < 400; i++) {
  if (await H.p.isVisible("#result:not([hidden])") && await G.p.isVisible("#result:not([hidden])")) break;
  for (const P of [H.p, G.p]) {
    const r = await step(P);
    if (r === "acted") for (let k = 0; k < 30 && (await S(P))?.waiting; k++) await sleep(100);
  }
  const t = await text(H.p, "#turnLine");
  if (!sawTurn && t.includes("小美美")) sawTurn = t;
  await sleep(120);
}
ok(!!sawTurn, `輪到對手時的提示用暱稱：「${sawTurn}」`);
await H.p.waitForSelector("#result:not([hidden])", { timeout: 10000 });
await sleep(3500);
const resH = await text(H.p, "#resSheet"), resG = await text(G.p, "#resSheet");
ok(resH.includes("小美美") && resG.includes("阿明哥") && !resH.includes("阿禾") && !resG.includes("阿禾"), "結算單上用雙方暱稱、沒有阿禾");
await shot(G.p, "result");
const aheH = await H.p.evaluate(() => (globalThis.__hbAhe ?? []).length), aheG = await G.p.evaluate(() => (globalThis.__hbAhe ?? []).length);
ok(aheH === 0 && aheG === 0, "朋友連線全程阿禾一句都沒講");

// ================= 第 2 桌：兩人同名，朋友手動輸入房號 =================
console.log("兩人同名（朋友手動輸入房號）");
const X = await phone("mobile", "小明-房主");
await X.p.click("#goOnline"); await X.p.fill("#name", "小明"); await X.p.click("#create");
await X.p.waitForSelector("#wait:not([hidden])");
const code2 = (await text(X.p, "#bigCode")).replace(/\s/g, "");
const Y = await phone("desktop", "小明-訪客");
await Y.p.click("#goOnline");
await Y.p.fill("#name", "小明");
await Y.p.fill("#code", code2.toLowerCase());
ok(await Y.p.isVisible("#create:not([hidden])") && await Y.p.isHidden("#inviteCard"), "手動輸入房號：一般的找朋友畫面（暱稱也要自己填）");
await Y.p.click("#join");
await Y.p.waitForSelector("#wait:not([hidden])");
await until(X.p, () => document.getElementById("plateOppName").textContent === "小明");
ok((await text(X.p, "#plateMe small")).includes("房主") && (await text(X.p, "#plateOpp small")) === "訪客" && (await text(Y.p, "#plateMe small")).includes("訪客") && (await text(Y.p, "#plateOpp small")) === "房主",
  `名牌：房主那邊「${await text(X.p, "#plateMe small")} / ${await text(X.p, "#plateOpp small")}」，訪客那邊「${await text(Y.p, "#plateMe small")} / ${await text(Y.p, "#plateOpp small")}」`);
await shot(Y.p, "same-name-wait");
await X.p.click("#readyBtn"); await sleep(300); await Y.p.click("#readyBtn");
await Promise.all([X.p.waitForSelector("#table:not([hidden])"), Y.p.waitForSelector("#table:not([hidden])")]);
await sleep(800);
ok((await text(X.p, "#oppName")) === "小明（訪客）" && (await text(Y.p, "#oppName")) === "小明（房主）", `牌桌上分得出來：房主看到「${await text(X.p, "#oppName")}」、訪客看到「${await text(Y.p, "#oppName")}」`);
await shot(X.p, "same-name-table");

await browser.close();
if (errors.length) { console.log(errors.join("\n")); fails++; }
ok(!errors.length, "全程沒有頁面錯誤");
console.log(fails ? `\n${fails} 項沒過` : "\n雙方暱稱驗收全部通過");
process.exit(fails ? 1 : 0);
