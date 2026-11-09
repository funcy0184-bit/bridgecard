// 一支模擬手機真的點畫面，走完阿禾的四幕十二段教學，再接一局有提示的練習局：
//   第一幕兩種搶牌＋贏家接著先出 → 第二幕叫牌情況 A／B → 第三幕跟牌、王吃／墊牌、♠K／♦A 先出對照、
//   都是王牌、無王 → 第四幕打成與倒一 → 換章節時舊動畫不殘留 → 練習局（對局提示、上一墩、結算）
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

const pick = async (card) => { await page.locator(`#sHand .card[data-id="${id(card)}"]`).click(); await wait(80); };
const confirm = async () => { await page.locator("#sConfirm").click(); };
const fb = () => text("#feedback");
const btn = (name) => page.getByRole("button", { name });
async function playCard(card) { await pick(card); await confirm(); await settleStory(); }

console.log(`裝置：${deviceName}　網址：${base}`);
console.log("首頁");
await page.goto(base + "/");
check((await text("#home h1")) === "來打橋牌", "首頁大標題是「來打橋牌」");
await page.locator("#solo").click();
check(await page.locator("#storyOffer").isVisible(), "第一次按「跟阿禾打」會先問要不要跟阿禾學");
await page.locator("#storyOffer a.btn").click();
await page.waitForURL(/\/story\/$/);
await page.waitForSelector("#sHand .card");

// ---------------- 第一幕 ----------------
console.log("第一幕：搶牌與一墩的完整循環");
check((await text("#title")) === "先來搶牌" && (await text("#tableLabel")).includes("學："), "第一幕：標題與「本段要學什麼」");
const letsGo = btn("好啊，來吧！");
for (let i = 0; i < 8 && !(await letsGo.isVisible()); i++) { await page.locator("#spoken").click(); await wait(60); }
check(await letsGo.isVisible(), "開場有「好啊，來吧！」");
await letsGo.click();
check(await ready(), "開場講完才輪到你");
check((await fb()).includes("你還有♣，請出一張梅花"), "輪到你：說明現在能出什麼（要跟梅花）");
await pick("♣Q");
check((await page.locator("#sHand .card.sel").count()) === 1 && (await text("#sConfirm")).includes("確認出牌 ♣Q"), "點一下只是選牌，出現「確認出牌 ♣Q」");
await pick("♣Q");
check((await page.locator("#sHand .card.sel").count()) === 0 && !(await page.locator("#sConfirm").count()), "再點一下收回，沒有出牌");
await playCard("♣Q");
check((await said()).includes("這就叫一墩"), "阿禾說明什麼是一墩");
check((await fb()).includes("你贏：同樣是梅花") && (await fb()).includes("下一墩由你先出"), "結果三件事：誰贏、為什麼、下一墩誰先出");
await btn("換一張試試").click();
check(await ready() || (await mode()) === "prompt", "換一張試試：直接輪到你");
await playCard("♣4");
check((await fb()).includes("你從牌堆摸到暗牌 ♠6") && (await fb()).includes("下一墩由阿禾先出"), "輸了：摸暗牌 ♠6，下一墩由阿禾先出");
await page.reload(); await page.waitForSelector("#sHand .card");
check((await mode()) === "done" && (await fb()).includes("♠6"), "重新整理：回到同一頁、同一個結果");
await btn(/下一墩：贏家先出/).click();
check(await ready(), "第一幕之二：贏家（你）接著先出");
check((await fb()).includes("你先出牌：這張牌會決定本墩要跟的花色"), "你先出：說明先出的牌決定領出花色");
await playCard("♦K");
check((await fb()).includes("不是領出花色") && (await fb()).includes("進入叫牌"), "明牌 ♥J 不決定跟牌花色；搶完才進入叫牌");

// ---------------- 第二幕 ----------------
console.log("第二幕：叫牌、合約與首攻");
await btn(/下一幕/).click();
check(await ready(), "第二幕：阿禾講完才輪到你");
await page.locator('#sBoard button[data-bid="13"]').click();       // 3♠
check(await page.locator("#sCall").isHidden() && (await fb()).includes("先叫 2♥"), "點 3♠：先說意思、不能送出，阿禾提醒先叫 2♥");
await page.locator('#sBoard button[data-bid="7"]').click();        // 2♥
check((await text("#sMean")).includes("紅心當王牌，至少要贏 8 墩（6＋2）"), "送出前預覽：紅心當王牌、8 墩（6＋2）");
await page.locator("#sCall").click();
await settleStory();
check((await text("#sBoard")).includes("合約確定") && (await text("#sBoard")).includes("防守方先出"), "情況 A：阿禾 Pass，合約確定，防守方先出");
await btn(/情況 B/).click();
check(await ready(), "情況 B：開始");
await page.locator('#sBoard button[data-bid="7"]').click(); await page.locator("#sCall").click();
await page.waitForFunction(() => document.getElementById("narrator")?.dataset.mode === "prompt" && document.querySelector("#sBoard .sgrid"), null, { timeout: 15000 });
check((await text("#spoken")).includes("我叫 2♠") || (await spoken()).includes("我叫 2♠"), "阿禾叫 2♠，再輪到你");
check(await page.locator('#sBoard button[data-bid="7"]').isDisabled() && !(await page.locator('#sBoard button[data-bid="12"]').isDisabled()), "比 2♠ 低的叫不了，3♥ 可以叫");
check((await text("#sBoard")).includes("還在競叫") || (await page.locator("#sBoard .auct").count()) > 0, "畫面上看得出還在競叫");
await page.locator('#sBoard button[data-bid="-1"]').click(); await page.locator("#sCall").click();
await settleStory();
check((await fb()).includes("你是防守方") && (await text("#sBoard")).includes("阿禾是莊家"), "Pass：阿禾的 2♠ 成立，你是防守方");
await btn("重新叫一次").click(); await ready();
await page.locator('#sBoard button[data-bid="7"]').click(); await page.locator("#sCall").click();
await page.waitForFunction(() => document.getElementById("narrator")?.dataset.mode === "prompt" && document.querySelector("#sBoard .sgrid"), null, { timeout: 15000 });
await page.locator('#sBoard button[data-bid="12"]').click(); await page.locator("#sCall").click();
await settleStory();
check((await fb()).includes("你是莊家，要贏 9 墩"), "叫 3♥：你是莊家、要贏 9 墩");

// ---------------- 第三幕 ----------------
console.log("第三幕：先後順序、跟牌與王牌");
await btn(/下一幕/).click(); await ready();
await pick("♥2");
check((await fb()).includes("你還有♠，這墩必須先跟黑桃") && await page.locator("#sConfirm").isDisabled(), "選到 ♥2：說明原因，「確認出牌」按不下去");
await pick("♠3"); await confirm(); await settleStory();
check((await fb()).includes("阿禾贏") && (await fb()).includes("下一墩由阿禾先出"), "跟牌：阿禾贏，下一墩由阿禾先出");
await btn("換一手試試").click(); await ready();
check((await fb()).includes("可以用紅心王吃，也可以墊牌"), "沒有黑桃：提示可以王吃或墊牌");
await playCard("♥2");
check((await fb()).includes("王吃"), "♥2 王吃");
await btn(/A 不一定贏 K/).click(); await ready();
await playCard("♦A");
check((await fb()).includes("阿禾贏：本墩先出黑桃，你的方塊不是領出花色，也不是王牌"), "對照 A：♠K 贏，♦A 不是黑桃也不是王牌");
await btn("換你先出看看").click(); await ready();
await playCard("♦A");
check((await fb()).includes("你贏：本墩先出方塊") && (await fb()).includes("同樣兩張牌，改變誰先出，領出花色就不同"), "對照 B：♦A 贏，並列回顧");
await btn(/都是王牌/).click(); await ready();
await playCard("♥Q");
check((await fb()).includes("兩張都是王牌"), "都是王牌：比點數");
await btn(/無王/).click(); await ready();
check(!(await fb()).includes("王吃") && (await fb()).includes("本局無王"), "無王：不出現王吃提示");
await playCard("♠2");
check((await fb()).includes("阿禾贏") && (await fb()).includes("本局無王"), "無王：沒有王吃，出什麼都贏不了");

// ---------------- 第四幕 ----------------
console.log("第四幕：打成與倒約");
await btn(/下一幕/).click(); await ready();
await playCard("♣A");
check((await fb()).includes("2♥、沒有加倍、剛好打成，這局 +20 分") && (await fb()).includes("8 比 5"), "情況 A：8 墩打成 +20");
await btn(/差一墩/).click(); await ready();
await playCard("♣K");
check((await fb()).includes("倒 1 墩，對手 +10 分") && (await fb()).includes("即使你拿 7 墩、對手拿 6 墩，你仍未達成承諾的 8 墩"), "情況 B：7 比 6 倒一，對手 +10");
check((await page.locator("#contents .book.done").count()) === 4, "四幕都打勾");
check((await page.locator("#toSolo").getAttribute("href")) === "/?solo=new&coach=1", "結尾：開一場有提示的練習局");

// ---------------- 換章節不殘留 ----------------
console.log("跳過、重播、換章節不殘留");
await page.evaluate(() => { const b = [...document.querySelectorAll("#contents .book")][2]; b.click(); });   // 第三幕（之前打過：先重來這手）
await wait(200);
if ((await mode()) === "done") await btn("重來這手").click();
await ready();
await pick("♠3"); await confirm();
await wait(120);
await page.evaluate(() => { const b = [...document.querySelectorAll("#contents .book")][0]; b.click(); });   // 出牌途中換到第一幕
await wait(2500);
const st1 = await page.evaluate(() => ({ title: document.getElementById("title").textContent, opp: document.querySelector("#slotOpp .card")?.getAttribute("aria-label"), me: document.querySelector("#slotMe .card")?.getAttribute("aria-label") ?? "", flying: document.querySelectorAll("#fx .card.flying").length }));
check(st1.title === "先來搶牌" && st1.opp === "♣9" && st1.me !== "♠3" && st1.flying === 0, `出牌途中換章節：第三幕的 ♠3 沒有跑進第一幕（${JSON.stringify(st1)}）`);
check(!(await said()).includes("有黑桃就要出黑桃"), "舊段落的對話沒有出現");

// ---------------- 練習局 ----------------
console.log("練習局（有提示）");
await page.goto(base + "/?solo=new&coach=1");
await page.waitForSelector("#hand .card");
await page.evaluate(() => { window.__coach = []; new MutationObserver(() => { const t = document.getElementById("coachTitle").textContent; if (t && window.__coach.at(-1) !== t) window.__coach.push(t); }).observe(document.getElementById("coach"), { subtree: true, childList: true, characterData: true, attributes: true }); });
await wait(600);
check((await text("#coachTitle")).includes("搶牌開始"), "練習局：搶牌開始的提示");
check((await text("#phaseChip")).includes("搶牌") && (await page.locator("#phaseChip li.now").innerText()) === "搶牌", "整局流程：現在在「搶牌」");
let turns = 0, sawLast = false, sawOrder = false, sawReason = false;
const t0 = Date.now();
while (Date.now() - t0 < 180000 && !(await page.locator("#result").isVisible())) {
  if (await page.locator("#bidPanel.mine").isVisible()) {
    if ((await text("#bidContract")).includes("換你叫牌")) { await page.locator("#bidLevels button:not([disabled])").first().click(); await page.locator("#bidStrains button:not([disabled])").first().click(); await page.locator("#bidConfirm").click(); }
    else await page.locator("#bidPass").click();
    await wait(300); continue;
  }
  const tl = await page.locator("#turnLine").innerText();
  if (/①.*→.*②/.test(tl)) sawOrder = true;
  if (/贏這墩/.test(tl) && /下一墩|最後一墩|搶牌結束/.test(tl)) sawReason = true;
  if (!sawLast && !(await page.locator("#lastTrickBtn").isHidden())) {
    await page.locator("#lastTrickBtn").click(); await wait(250);
    sawLast = (await text("#ltWhy")).includes("贏") && (await text("#ltSuit")).length > 0 && (await page.locator("#ltLead .card").count()) === 1;
    await page.locator("#lastTrickPop [data-close]").click(); await wait(150);
  }
  const mine = ((await page.locator("#turnLine").getAttribute("class")) ?? "").includes("mine") && (await page.locator("#hand .card.legal").count()) > 0;
  if (mine) { await page.locator("#hintBtn").click(); await page.locator("#playBtn").click(); turns++; await wait(250); continue; }
  await wait(150);
}
check(await page.locator("#result").isVisible(), `打完一整局（你出了 ${turns} 張）`);
check(sawOrder, "每墩顯示「① 誰先出 → ② 換誰」");
check(sawReason, "每墩結束顯示誰贏、為什麼、下一墩誰先出");
check(sawLast, "「上一墩」可以回看：雙方出牌、領出花色、原因");
const coachSeen = await page.evaluate(() => window.__coach);
check(["搶牌結束，開始叫牌", "合約成立", "第一墩結束"].every(t => coachSeen.includes(t)), `對局提示依階段出現（${coachSeen.join("、")}）`);
check(!(await page.locator("#resCoach").isHidden()), "結算單裡有「結算怎麼算」的提示");
await shot("practice-result");

check(errors.length === 0, "全程沒有頁面錯誤" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
console.log(`\n${checks - failures}/${checks} 項通過`);
process.exit(failures ? 1 : 0);
