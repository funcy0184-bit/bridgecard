// 一支模擬手機真的點畫面，走完阿禾的四幕故事，再接一局跟電腦的單機對戰：
//   首頁（來打橋牌、第一次玩會問要不要先學）→ 第一幕兩種搶牌＋換一張試試（回到同一手）→ 重新整理續讀
//   → 第二幕叫 2♥ → 第三幕不能出的 ♥2、王吃與墊牌 → 第四幕 8／8、+20 分
//   → 「自己跟電腦打一局」重新發牌 → 打完一整局看到結算 → 中途重新整理回到同一局 → 換牌桌顏色
// 用法：先 npm run dev，再 node test/e2e/story-walk.mjs [網址] [截圖資料夾]
//   換機型：HB_DEVICE="iPhone SE" node test/e2e/story-walk.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const out = process.argv[3] ?? "test-results";
mkdirSync(out, { recursive: true });
const deviceName = process.env.HB_DEVICE ?? "iPhone 13";
const SUIT = ["♣", "♦", "♥", "♠"];
const id = (txt) => { const s = SUIT.indexOf(txt[0]); const r = { J: 11, Q: 12, K: 13, A: 14 }[txt.slice(1)] ?? Number(txt.slice(1)); return s * 13 + r - 2; };

let failures = 0, checks = 0;
function check(ok, msg) { checks++; if (ok) console.log("  ✓", msg); else { failures++; console.log("  ✗", msg); } }

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices[deviceName] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${out}/story-${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).innerText();
// 阿禾的話一個字一個字講出來：等講完再讀
const spoken = async () => { await page.waitForFunction(() => { const e = document.getElementById("spoken"); return !!e && e.textContent === e.dataset.full; }, null, { timeout: 8000 }); return text("#spoken"); };
const handIds = async (sel = "#sHand") => (await page.locator(`${sel} .card`).evaluateAll(els => els.map(e => Number(e.dataset.id))));
const tap = async (card) => { await page.locator(`#sHand .card[data-id="${id(card)}"]`).click(); };
// 阿禾一句一句講：點對話往下一句，直到輪到你（prompt）
const mode = () => page.evaluate(() => document.getElementById("narrator")?.dataset.mode);
const said = () => page.locator("#talkLog").textContent();
async function ready() {
  for (let i = 0; i < 40 && (await mode()) === "intro"; i++) { await page.locator("#spoken").click(); await wait(60); }
  return (await mode()) === "prompt";
}
// 出牌之後：等阿禾開始說明，一句一句點完，直到出現「下一步」按鈕
async function settleStory() {
  await page.waitForFunction(() => ["outro", "done"].includes(document.getElementById("narrator")?.dataset.mode ?? ""), null, { timeout: 15000 });
  for (let i = 0; i < 40 && (await mode()) === "outro"; i++) { await page.locator("#spoken").click(); await wait(60); }
  await page.waitForFunction(() => document.querySelector("#controls .s-emph") !== null, null, { timeout: 5000 });
}

console.log(`裝置：${deviceName}　網址：${base}`);

// ---------------- 首頁 ----------------
console.log("首頁");
await page.goto(base + "/");
check((await page.title()) === "來打橋牌", "網頁標題是「來打橋牌」");
check((await text("#home h1")) === "來打橋牌", "首頁大標題是「來打橋牌」");
check((await text("#chapHead")).includes("第一次玩") && (await text("#storyCardSub")).includes("阿禾帶你打一場"), "封面寫著「第一次玩？」「沒玩過也沒關係，阿禾帶你打一場！」");
check((await page.locator("#home .cv-btn").count()) === 3 && (await page.locator("#home .cv-card").count()) === 4, "封面：故事教學、人機對戰、朋友連線三顆按鈕＋四個篇章");
check(await page.evaluate(() => getComputedStyle(document.getElementById("home")).backgroundImage.includes("gradient")), "封面是米白紙底");
await page.locator("#solo").click();
check(await page.locator("#storyOffer").isVisible(), "第一次按「跟電腦打一局」會先問要不要跟阿禾學");
await shot("01-offer");
await page.locator("#storyOffer a.btn").click();
await page.waitForURL(/\/story\/$/);

// ---------------- 第一幕 ----------------
console.log("第一幕：先來搶牌");
await page.waitForSelector("#sHand .card");
check((await text("#title")) === "先來搶牌", "第一幕標題：先來搶牌");
// 開場：旁白和阿禾一句一句講，最後一句是阿禾的問題
check((await mode()) === "intro", "一進來先是開場對話（不是直接出題）");
// 開場講到「先從最簡單的開始」時，多一顆「好啊，來吧！」可以按
const letsGo = page.getByRole("button", { name: "好啊，來吧！" });
for (let i = 0; i < 8 && !(await letsGo.isVisible()); i++) { await page.locator("#spoken").click(); await wait(60); }
check(await letsGo.isVisible() && (await spoken()).includes("先從最簡單的開始"), "開場：阿禾說「來，先從最簡單的開始」，可以按「好啊，來吧！」");
await letsGo.click(); await wait(80);
check((await mode()) === "intro" && !(await letsGo.isVisible()), "按「好啊，來吧！」往下一句（還在開場、按鈕收起來）");
let introLines = 0;
for (let i = 0; i < 20 && (await mode()) === "intro"; i++) {
  const before = (await page.locator("#spoken").getAttribute("data-full")) ?? "";
  await page.locator("#spoken").click(); await wait(40);          // 第一下：講完這句
  if ((await page.locator("#spoken").getAttribute("data-full")) === before) { await page.locator("#spoken").click(); await wait(60); }   // 第二下：下一句
  introLines++;
}
check(introLines >= 3 && (await mode()) === "prompt", `開場一句一句講完（點了 ${introLines} 句）才輪到你`);
check((await said()).includes("第一次來喔"), "阿禾開場：欸，第一次來喔？");
check((await text("#sBoard")).includes("阿禾出的牌") && (await text("#sBoard")).includes("贏的人拿這張"), "桌上分開標「阿禾出的牌」和「贏的人拿這張」");
const startHand = await handIds();
check(JSON.stringify(startHand) === JSON.stringify([id("♣Q"), id("♣4")]), "手上是 ♣Q、♣4");
await shot("02-act1");
await tap("♣Q");
await settleStory();
let h = await handIds();
check(h.includes(id("♦K")) && h.includes(id("♣4")) && h.length === 2, "出 ♣Q：♦K 進手牌，手上還是 2 張");
check((await page.locator("#sOppFan .card.back").count()) === 2, "阿禾摸了暗牌：只看到 2 張牌背");
check((await page.locator(`.card[data-id="${id("♠6")}"]`).count()) === 0, "阿禾摸的暗牌（♠6）不在畫面上");
check((await said()).includes("這就叫一墩"), "阿禾一句一句解釋什麼是一墩");
await shot("03-act1-q");
await page.getByRole("button", { name: "換一張試試" }).click();
check(JSON.stringify(await handIds()) === JSON.stringify(startHand), "換一張試試：回到同一手 ♣Q、♣4");
await tap("♣4");
await settleStory();
h = await handIds();
check(h.includes(id("♠6")) && h.includes(id("♣Q")), "出 ♣4：摸到暗牌 ♠6、♣Q 留在手上");
check((await text("#sBoard")).includes("歸阿禾"), "明牌 ♦K 歸阿禾");
check((await text("#feedback")).includes("兩種出法你都看過了"), "兩種搶牌都試過");
await page.reload();
await page.waitForSelector("#sHand .card");
h = await handIds();
check(h.includes(id("♠6")) && (await said()).includes("一墩") && (await mode()) === "done", "重新整理：回到同一頁、同一個結果");
await shot("04-act1-4-reload");

// ---------------- 第二幕 ----------------
console.log("第二幕：阿禾問，你敢拿幾墩？");
await page.getByRole("button", { name: /下一幕/ }).click();
check((await text("#skip")).includes("13 次牌搶完了"), "提示時間跳轉：13 次牌搶完了");
check(await page.locator(".actcard").count() > 0, "換幕時牌桌上浮出「第二幕」紙條");
check(await ready(), "第二幕：阿禾說完才輪到你");
check((await page.locator("#sHand .card").count()) === 13, "手上 13 張");
check((await page.locator("#sHand .card.hi").count()) === 6, "阿禾指著的六張紅心");
await page.locator('#sBoard button[data-bid="13"]').click();   // 3♠
check(await page.locator("#sCall").isHidden(), "點 3♠：先解釋、不能送出");
check((await text("#feedback")).includes("你要叫 3♠，那就得拿到 9 墩") && (await text("#feedback")).includes("先叫 2♥"), "點 3♠：阿禾照 3♠ 算墩數，再提醒先叫 2♥");
await page.locator('#sBoard button[data-bid="7"]').click();    // 2♥
check((await text("#sMean")).includes("紅心當王牌，至少要贏 8 墩（6＋2）") && (await text("#feedback")).includes("你要叫 2♥，那就得拿到 8 墩喔"), "送出前顯示「紅心當王牌，至少要贏 8 墩」，阿禾：「喔？你要叫 2♥…」");
await shot("05-act2-select");
await page.locator("#sCall").click();
await settleStory();
check((await said()).includes("我 Pass，不往上叫了。") && (await said()).includes("好，合約定了。等等可要說到做到！"), "阿禾 Pass、合約定了");
check(await page.evaluate(() => (globalThis.__hbFx || []).some(x => x.kind === "bid") && (globalThis.__hbFx || []).some(x => x.kind === "contractSet")), "叫牌用新的籌碼演出、合約蓋章定格");
check((await text("#sBoard")).includes("要贏 8 墩｜已贏 0 墩"), "桌上顯示「要贏 8 墩｜已贏 0 墩」");
check((await text("#sBoard")).includes("由阿禾先出"), "由阿禾先出");
check((await text("#feedback")).includes("合約") && (await text("#feedback")).includes("莊家"), "這時才介紹合約和莊家");
await shot("06-act2-contract");

// ---------------- 第三幕 ----------------
console.log("第三幕：那張小紅心，該現在用嗎？");
await page.getByRole("button", { name: /下一幕/ }).click();
check(await ready(), "第三幕：阿禾說完才輪到你");
await tap("♥2");
await wait(400);
check((await spoken()).includes("等等，你還有這個花色，要先跟牌喔。"), "有黑桃還出 ♥2：阿禾提醒要先跟牌");
check(await page.locator(`#sHand .card[data-id="${id("♥2")}"]`).evaluate(e => e.classList.contains("dim")), "♥2 變暗（現在不能出）");
check((await page.locator("#slotMe .card").count()) === 0, "不能出的牌沒有上桌");
await shot("07-act3-illegal");
await tap("♠3");
await settleStory();
check(await page.locator("#slotOpp").evaluate(e => e.classList.contains("won")), "改出 ♠3：阿禾的 ♠A 拿走這墩");
await page.getByRole("button", { name: /換一手試試/ }).click();
check((await text("#skip")).includes("換一手試試"), "切換時標示「換一手試試」");
await ready();
check(JSON.stringify(await handIds()) === JSON.stringify([id("♥2"), id("♣3")]), "手裡換成 ♥2 和 ♣3");
await tap("♥2");
await settleStory();
check((await said()).includes("王吃"), "出 ♥2：王吃");
check(await page.locator("#slotMe").evaluate(e => e.classList.contains("won")), "王吃贏下這墩");
await shot("08-act3-ruff");
await page.getByRole("button", { name: "換一張試試" }).click();
check((await mode()) === "prompt", "換一張試試：不用再聽一次開場，直接輪到你");
await tap("♣3");
await settleStory();
check(JSON.stringify(await handIds()) === JSON.stringify([id("♥2")]), "墊 ♣3：阿禾拿墩，♥2 留在手上");
check((await text("#feedback")).includes("兩種你都試過了"), "王吃、墊牌都試過");

// ---------------- 第四幕 ----------------
console.log("第四幕：最後一墩，你來收桌");
await page.getByRole("button", { name: /下一幕/ }).click();
check((await text("#skip")).includes("快轉到最後一墩"), "明示「快轉到最後一墩」");
await ready();
check((await text("#tally")).replace(/\s/g, "") === "7／8", "一開始 7／8");
await tap("♣A");
await settleStory();
check((await text("#tally")).replace(/\s/g, "") === "8／8", "出 ♣A 之後 8／8");
check((await text("#feedback")).includes("2♥、沒有加倍、剛好打成，這局 +20 分"), "顯示「2♥、沒有加倍、剛好打成，這局 +20 分」");
check((await text("#feedback")).includes("8 比 5"), "最後雙方 8 比 5");
check((await said()).includes("還真的被你打成了") && (await said()).includes("這就叫『打成』"), "阿禾：還真的被你打成了、這就叫打成");
check((await said()).includes("要不要真的打一局") && (await text("#toSolo")).includes("來啊，開打") && (await page.getByRole("button", { name: "我想再練一下" }).count()) === 1, "結尾：阿禾邀你真的打一局，按鈕「來啊，開打！」「我想再練一下」");
check((await page.locator("#contents .book.done").count()) === 4, "目錄四幕都打勾");
await shot("09-act4-made");

// ---------------- 單機對戰 ----------------
console.log("自己跟電腦打一局");
await page.evaluate(() => localStorage.setItem("hb-web-settings", JSON.stringify({ speed: 2, shake: false, vibrate: false, theme: "dusk" })));
await page.locator("#toSolo").click();
await page.waitForURL(/\?solo=1$/);
await page.waitForSelector("#hand .card");
check((await text("#roomChip")) === "單機", "進入單機牌桌");
check((await text("#oppName")) === "阿禾", "對手是阿禾（電腦）");
check((await page.locator("#hand .card").count()) === 13 && (await text("#handNo")) === "第 1 局", "重新發牌：第 1 局、13 張");
await shot("10-solo-start");

let reloaded = false, tricks = 0;
const t0 = Date.now();
while (Date.now() - t0 < 180000) {
  if (await page.locator("#result").isVisible()) break;
  const panelMine = await page.locator("#bidPanel.mine").isVisible();
  if (panelMine) {
    const head = await text("#bidContract");
    if (head.includes("換你叫牌")) {
      await page.locator("#bidLevels button:not([disabled])").first().click();
      await page.locator("#bidStrains button:not([disabled])").first().click();
      await page.locator("#bidConfirm").click();
    } else await page.locator("#bidPass").click();
    await wait(300);
    continue;
  }
  const legal = page.locator("#hand .card.legal");
  const myTurn = ((await page.locator("#turnLine").getAttribute("class")) ?? "").includes("mine") && (await legal.count()) > 0;
  if (myTurn) {
    if (!reloaded && tricks === 4) {
      const before = (await handIds("#hand")).sort((a, b) => a - b);
      await page.reload();
      await page.waitForSelector("#hand .card");
      await wait(300);
      const after = (await handIds("#hand")).sort((a, b) => a - b);
      check(JSON.stringify(before) === JSON.stringify(after), "打到一半重新整理：回到同一局、同一手牌");
      reloaded = true;
      continue;
    }
    // 手牌會疊在一起：點每張牌露出來的左上角（跟真人一樣）
    const pick = Number(await legal.first().getAttribute("data-id"));
    const c = page.locator(`#hand .card[data-id="${pick}"]`);
    await c.click({ position: { x: 10, y: 34 } });          // 選牌
    await page.locator("#playBtn").click();                  // 確認出牌
    tricks++;
    await wait(250);
    continue;
  }
  await wait(200);
}
check(await page.locator("#result").isVisible(), `打完一整局，跳出結算（你出了 ${tricks} 張牌）`);
// 結算是分段演出：點一下結算單跳過，跳過後必須直接是最後的正確結果
await page.locator("#resSheet").click({ position: { x: 30, y: 120 } });
await page.waitForFunction(() => !document.querySelector("#result .pending"), null, { timeout: 5000 });
const finalOk = await page.evaluate(() => document.getElementById("rtMe")?.textContent === document.getElementById("myScore")?.dataset.v
  && document.getElementById("rtOpp")?.textContent === document.getElementById("oppScore")?.dataset.v);
check(finalOk, "點一下跳過結算動畫：總分直接是正確的最終數字");
const res = await text("#resBody");
check(/合約 .+（.+是莊家）/.test(res) && /\+\d+ 分/.test(res), "結算有合約、墩數和分數");
await shot("11-solo-result");
await page.locator("#nextBtn").click();
await page.waitForFunction(() => document.querySelector("#handNo")?.textContent === "第 2 局", null, { timeout: 10000 });
check(true, "按「再來一局！」重新發牌：第 2 局");

// ---------------- 08 設定 ----------------
console.log("設定");
await page.locator("#menuBtn").click();
await page.locator("#settingsBox .seg button", { hasText: "強" }).click();
check((await page.evaluate(() => document.documentElement.dataset.motion)) === "3", "動畫強度改成「強」立刻生效");
await page.locator("#settingsBox .seg button", { hasText: "關閉" }).click();
check((await page.evaluate(() => document.documentElement.dataset.motion)) === "0", "動畫強度可以關閉");
await shot("12-settings");
await page.reload();
await page.waitForSelector("#hand .card");
check((await page.evaluate(() => document.documentElement.dataset.motion)) === "0", "重新整理後設定還在");
await page.goto(base + "/story/");
check((await page.evaluate(() => document.documentElement.dataset.motion)) === "0", "故事頁也用同一份設定");
await page.goto(base + "/");
check((await text("#storyCardSub")).includes("四幕都打完了") && (await page.locator(".cv-card.done").count()) === 4, "封面四個篇章都打勾");
check((await text("#soloSub")).includes("繼續"), "「跟阿禾打」按鈕提示可以繼續上次那局");

check(errors.length === 0, `主控台沒有錯誤${errors.length ? "：" + errors.join(" | ") : ""}`);
await browser.close();
console.log(`\n${checks - failures}/${checks} 項通過`);
process.exit(failures ? 1 : 0);
