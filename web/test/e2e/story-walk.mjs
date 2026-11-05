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
const handIds = async (sel = "#sHand") => (await page.locator(`${sel} .card`).evaluateAll(els => els.map(e => Number(e.dataset.id))));
const tap = async (card) => { await page.locator(`#sHand .card[data-id="${id(card)}"]`).click(); };
const settleStory = () => page.waitForFunction(() => document.querySelector("#controls .s-emph") !== null, null, { timeout: 15000 });

console.log(`裝置：${deviceName}　網址：${base}`);

// ---------------- 首頁 ----------------
console.log("首頁");
await page.goto(base + "/");
check((await page.title()) === "來打橋牌", "網頁標題是「來打橋牌」");
check((await text("#home h1")) === "來打橋牌", "首頁大標題是「來打橋牌」");
check((await text("#storyCardTitle")).includes("第一次玩"), "首頁有「第一次玩？先跟阿禾學」入口");
const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--felt").trim());
check(bg.toUpperCase() !== "#2E5A4E", `牌桌底色不是原本的深綠（現在 ${bg}）`);
await page.locator("#solo").click();
check(await page.locator("#storyOffer").isVisible(), "第一次按「跟電腦打一局」會先問要不要跟阿禾學");
await shot("01-offer");
await page.locator("#storyOffer a.btn").click();
await page.waitForURL(/\/story\/$/);

// ---------------- 第一幕 ----------------
console.log("第一幕：雨停前，先搶一張牌");
await page.waitForSelector("#sHand .card");
check((await text("#title")) === "雨停前，先搶一張牌", "第一幕標題");
check((await text("#sBoard")).includes("阿禾出的牌") && (await text("#sBoard")).includes("贏家拿的明牌"), "桌上分開標「阿禾出的牌」和「贏家拿的明牌」");
const startHand = await handIds();
check(JSON.stringify(startHand) === JSON.stringify([id("♣Q"), id("♣4")]), "手上是 ♣Q、♣4");
await shot("02-act1");
await tap("♣Q");
await settleStory();
let h = await handIds();
check(h.includes(id("♦K")) && h.includes(id("♣4")) && h.length === 2, "出 ♣Q：♦K 進手牌，手上還是 2 張");
check((await page.locator("#sOppFan .card.back").count()) === 2, "阿禾摸了暗牌：只看到 2 張牌背");
check((await page.locator(`.card[data-id="${id("♠6")}"]`).count()) === 0, "阿禾摸的暗牌（♠6）不在畫面上");
check((await text("#spoken")).includes("這就叫一墩"), "阿禾解釋什麼是一墩");
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
check(h.includes(id("♠6")) && (await text("#spoken")).includes("一墩"), "重新整理：回到同一頁、同一個結果");
await shot("04-act1-4-reload");

// ---------------- 第二幕 ----------------
console.log("第二幕：阿禾問，你敢拿幾墩？");
await page.getByRole("button", { name: /下一幕/ }).click();
check((await text("#skip")).includes("搶完 13 次牌"), "提示時間跳轉：搶完 13 次牌");
check((await page.locator("#sHand .card").count()) === 13, "手上 13 張");
check((await page.locator("#sHand .card.hi").count()) === 6, "阿禾指著的六張紅心");
await page.locator('#sBoard button[data-bid="13"]').click();   // 3♠
check(await page.locator("#sCall").isHidden(), "點 3♠：先解釋、不能送出");
check((await text("#feedback")).includes("先說 2♥"), "阿禾提醒先叫 2♥");
await page.locator('#sBoard button[data-bid="7"]').click();    // 2♥
check((await text("#sMean")).includes("我選紅心當王牌，承諾至少贏 8 墩（6＋2）"), "送出前顯示「我選紅心當王牌，承諾至少贏 8 墩（6＋2）」");
await shot("05-act2-select");
await page.locator("#sCall").click();
await settleStory();
check((await text("#spoken")).includes("Pass，我不往上叫了。你說的八墩，就這麼定。"), "阿禾 Pass");
check((await text("#sBoard")).includes("目標 8 墩｜目前 0 墩"), "桌上顯示「目標 8 墩｜目前 0 墩」");
check((await text("#sBoard")).includes("由阿禾先出"), "由阿禾先出");
check((await text("#feedback")).includes("合約") && (await text("#feedback")).includes("莊家"), "這時才介紹合約和莊家");
await shot("06-act2-contract");

// ---------------- 第三幕 ----------------
console.log("第三幕：那張小紅心，該現在用嗎？");
await page.getByRole("button", { name: /下一幕/ }).click();
await tap("♥2");
await wait(400);
check((await text("#spoken")).includes("先看看手上的黑桃。你還跟得出來，這墩得跟。"), "有黑桃還出 ♥2：阿禾提醒要跟");
check(await page.locator(`#sHand .card[data-id="${id("♥2")}"]`).evaluate(e => e.classList.contains("dim")), "♥2 變暗（現在不能出）");
check((await page.locator("#slotMe .card").count()) === 0, "不能出的牌沒有上桌");
await shot("07-act3-illegal");
await tap("♠3");
await settleStory();
check(await page.locator("#slotOpp").evaluate(e => e.classList.contains("won")), "改出 ♠3：阿禾的 ♠A 拿走這墩");
await page.getByRole("button", { name: /換一手試試/ }).click();
check((await text("#skip")).includes("換一手試試"), "切換時標示「換一手試試」");
check(JSON.stringify(await handIds()) === JSON.stringify([id("♥2"), id("♣3")]), "手裡換成 ♥2 和 ♣3");
await tap("♥2");
await settleStory();
check((await text("#spoken")).includes("王吃"), "出 ♥2：王吃");
check(await page.locator("#slotMe").evaluate(e => e.classList.contains("won")), "王吃贏下這墩");
await shot("08-act3-ruff");
await page.getByRole("button", { name: "換一張試試" }).click();
await tap("♣3");
await settleStory();
check(JSON.stringify(await handIds()) === JSON.stringify([id("♥2")]), "墊 ♣3：阿禾拿墩，♥2 留在手上");
check((await text("#feedback")).includes("兩種你都試過了"), "王吃、墊牌都試過");

// ---------------- 第四幕 ----------------
console.log("第四幕：最後一墩，你來收桌");
await page.getByRole("button", { name: /下一幕/ }).click();
check((await text("#skip")).includes("跳到尾盤"), "明示「跳到尾盤，剩最後一墩」");
check((await text("#tally")).replace(/\s/g, "") === "7／8", "一開始 7／8");
await tap("♣A");
await settleStory();
check((await text("#tally")).replace(/\s/g, "") === "8／8", "出 ♣A 之後 8／8");
check((await text("#feedback")).includes("2♥、未加倍、剛好達成，本局 +20 分"), "顯示「2♥、未加倍、剛好達成，本局 +20 分」");
check((await text("#feedback")).includes("8 比 5"), "最後雙方 8 比 5");
check((await text("#spoken")).includes("你答應八墩，剛好八墩，這就叫打成。"), "阿禾：這就叫打成");
check((await page.locator("#contents .book.done").count()) === 4, "目錄四幕都打勾");
await shot("09-act4-made");

// ---------------- 單機對戰 ----------------
console.log("自己跟電腦打一局");
await page.evaluate(() => localStorage.setItem("hb-web-settings", JSON.stringify({ speed: 2, shake: false, vibrate: false, theme: "dusk" })));
await page.locator("#toSolo").click();
await page.waitForURL(/\?solo=1$/);
await page.waitForSelector("#hand .card");
check((await text("#roomChip")) === "單機 · 跟電腦", "進入單機牌桌");
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
    if (head.includes("輪到你叫牌")) {
      await page.locator("#bidGrid button").first().click();
      await page.locator("#bidConfirm").click();
    } else await page.locator("#bidPass").click();
    await wait(300);
    continue;
  }
  const legal = page.locator("#hand .card.legal");
  const myTurn = (await page.locator("#turnLine").getAttribute("class")) === "turn" && (await legal.count()) > 0;
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
    await c.click({ position: { x: 10, y: 34 } });
    await c.click({ position: { x: 10, y: 34 } });
    tricks++;
    await wait(250);
    continue;
  }
  await wait(200);
}
check(await page.locator("#result").isVisible(), `打完一整局，跳出結算（你出了 ${tricks} 張牌）`);
const res = await text("#resBody");
check(/合約 .+（.+是莊家）/.test(res) && /\+\d+ 分/.test(res), "結算有合約、墩數和分數");
await shot("11-solo-result");
await page.locator("#nextBtn").click();
await page.waitForFunction(() => document.querySelector("#handNo")?.textContent === "第 2 局", null, { timeout: 10000 });
check(true, "按「下一局」重新發牌：第 2 局");

// ---------------- 牌桌顏色 ----------------
console.log("牌桌顏色");
await page.locator("#menuBtn").click();
await page.getByRole("button", { name: "酒紅" }).click();
check((await page.evaluate(() => document.documentElement.dataset.theme)) === "wine", "選單換成酒紅");
await page.reload();
await page.waitForSelector("#hand .card");
check((await page.evaluate(() => document.documentElement.dataset.theme)) === "wine", "重新整理後還是酒紅");
await shot("12-wine");
await page.goto(base + "/story/");
check((await page.evaluate(() => document.documentElement.dataset.theme)) === "wine", "故事頁也跟著換顏色");
await page.goto(base + "/");
check((await text("#storyCardTitle")).includes("再聽一次"), "首頁入口變成「再聽一次阿禾的故事」");
check((await text("#solo")).includes("繼續"), "首頁可以繼續跟電腦的牌局");

check(errors.length === 0, `主控台沒有錯誤${errors.length ? "：" + errors.join(" | ") : ""}`);
await browser.close();
console.log(`\n${checks - failures}/${checks} 項通過`);
process.exit(failures ? 1 : 0);
