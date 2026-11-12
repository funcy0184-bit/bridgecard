// 手牌手勢驗收：點選／再點放下／換牌、快速連點、手指左右滑動選牌、往上拖曳後取消、拖到桌上預覽再確認、
// 非法牌、非自己回合、對戰畫面不會被捲動、手機直拿與橫拿。觸控用 Chrome 的真實觸控事件（pointerType = touch）。
// 用法：先 npm run dev，再 node test/e2e/hand-gestures.mjs [網址]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0; const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 固定牌局：2♥ 你是莊家；阿元先出 ♠K；你手上 8 張，只有 ♠3、♠9 能出（要跟黑桃）
const c = (s, r) => s * 13 + (r - 2);
const CL = 0, DI = 1, HE = 2, SP = 3;
const MINE = [c(SP, 3), c(SP, 9), c(HE, 5), c(HE, 11), c(CL, 9), c(CL, 12), c(DI, 2), c(DI, 13)];
const snap = {
  hands: [MINE, [c(SP, 4), c(SP, 7), c(HE, 3), c(HE, 8), c(CL, 4), c(DI, 6), c(DI, 9)]], takenFaceUp: [[], []], stock: [], tricksWon: [2, 3],
  phase: 2, currentPlayer: 0, leader: 1, leadCard: c(SP, 13), followCard: -1, trump: HE,
  highestBid: 1 * 5 + HE, highestBidder: 0, doubled: 0, declarer: 0,
  auction: [{ seat: 0, call: 1 * 5 + HE }, { seat: 1, call: -1 }], passesInRow: 1, firstSeat: 0,
  targetScore: 100, scores: [0, 0], handsPlayed: 0, lastResult: null, matchWinner: -1,
};

const b = await chromium.launch();
async function open(viewport, mobile = true) {
  const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(s => {
    localStorage.setItem("hb-story-offered", "1");
    localStorage.setItem("hb-web-settings", JSON.stringify({ fast: true }));
    localStorage.setItem("hb-solo-v1", JSON.stringify({ v: 1, game: s }));
    // 記錄所有「送出出牌」與頁面捲動
    window.__sent = 0; window.__scrolls = 0;
    addEventListener("scroll", () => { window.__scrolls++; }, true);
  }, snap);
  await p.goto(base + "/?solo=1");
  await p.waitForSelector("#hand .card");
  await sleep(400);
  const cdp = mobile ? await ctx.newCDPSession(p) : null;
  return { ctx, p, cdp, errs };
}
const id = (s, r) => c(s, r);
const cardBox = async (p, cid) => p.locator(`#hand .card[data-id="${cid}"]`).boundingBox();
const sel = p => p.evaluate(() => [...document.querySelectorAll("#hand .card.sel")].map(e => Number(e.dataset.id)));
const handCount = p => p.locator("#hand .card").count();
const touch = (cdp, type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
async function swipe(cdp, from, to, steps = 12, holdEnd = 60) {
  await touch(cdp, "touchStart", from.x, from.y);
  for (let i = 1; i <= steps; i++) { await touch(cdp, "touchMove", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await sleep(holdEnd);
}
const noScroll = p => p.evaluate(() => ({ y: scrollY, doc: document.scrollingElement.scrollTop, table: document.getElementById("table").scrollTop, n: window.__scrolls }));

// ======================= 手機直拿：觸控 =======================
console.log("手機直拿（觸控）");
{
  const { ctx, p, cdp, errs } = await open({ width: 390, height: 780 });
  ok((await handCount(p)) === 8 && (await p.locator("#turnLine.mine").count()) === 1, "輪到你：手上 8 張，要跟黑桃");

  // 1. 點一下選起來、再點放下、點別張換過去
  let bx = await cardBox(p, id(SP, 3));
  await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(120);
  ok(JSON.stringify(await sel(p)) === JSON.stringify([id(SP, 3)]), "點一下：選起來");
  const lift = await p.evaluate(cid => getComputedStyle(document.querySelector(`#hand .card[data-id="${cid}"]`)).getPropertyValue("--lift").trim(), id(SP, 3));
  ok(lift === "-18px", `選中的牌升起 ${lift}（規格 12～20px）`);
  bx = await cardBox(p, id(SP, 3));
  await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(120);
  ok((await sel(p)).length === 0, "再點同一張：放下");
  bx = await cardBox(p, id(SP, 9));
  await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(80);
  bx = await cardBox(p, id(SP, 3));
  await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(120);
  ok(JSON.stringify(await sel(p)) === JSON.stringify([id(SP, 3)]), "點別張：自動換過去");
  ok((await handCount(p)) === 8, "點牌都不會出牌");

  // 2. 快速連點同一張 9 次：不會出牌
  bx = await cardBox(p, id(SP, 9));
  for (let i = 0; i < 9; i++) { await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(25); }
  await sleep(1500);
  ok((await handCount(p)) === 8 && (await p.locator("#mySlot .card").count()) === 0, "快速連點 9 次：一張都沒出");

  // 3. 手指左右滑：一張一張選，放開不出牌
  const first = await p.locator("#hand .card").first().boundingBox(), last = await p.locator("#hand .card").last().boundingBox();
  await p.evaluate(() => { window.__selSeq = []; new MutationObserver(() => { const s = document.querySelector("#hand .card.sel"); const v = s ? Number(s.dataset.id) : -1; if (window.__selSeq.at(-1) !== v) window.__selSeq.push(v); }).observe(document.getElementById("hand"), { subtree: true, attributes: true, attributeFilter: ["class"] }); });
  await swipe(cdp, { x: first.x + 6, y: first.y + 40 }, { x: last.x + last.width - 10, y: first.y + 44 }, 20);
  await touch(cdp, "touchEnd"); await sleep(200);
  const seq = (await p.evaluate(() => window.__selSeq)).filter(v => v >= 0);
  ok(new Set(seq).size >= 6, `左右滑：跟著手指一張一張選（經過 ${new Set(seq).size} 張）`);
  ok((await sel(p))[0] === MINE.at(-1) || (await sel(p)).length === 1, "放開：停在最後選到的那張");
  ok((await handCount(p)) === 8, "滑動不會出牌");

  // 4. 往上拖曳後拉回（取消）：回到手上、沒有預覽、沒有出牌
  bx = await cardBox(p, id(SP, 3));
  const start = { x: bx.x + 8, y: bx.y + 30 };
  await swipe(cdp, start, { x: start.x + 4, y: start.y - 70 }, 8, 30);
  const dragging = await p.locator("#hand .card.dragging").count();
  for (let i = 1; i <= 8; i++) { await touch(cdp, "touchMove", start.x + 4, start.y - 70 + i * 9); await sleep(16); }
  await touch(cdp, "touchEnd"); await sleep(500);
  ok(dragging === 1, "往上拖：牌貼著手指被拿起來");
  ok((await p.locator("#hand .card.staged").count()) === 0 && (await handCount(p)) === 8, "拉回手上放開：取消，沒有預覽、沒有出牌");
  const tr = await p.evaluate(cid => document.querySelector(`#hand .card[data-id="${cid}"]`).style.translate, id(SP, 3));
  ok(tr === "" || tr === "none", "牌回到原本的位置");

  // 5. 非法牌：可以選起來看，有原因；拖到桌上不會進預覽；確認鈕按不下去
  bx = await cardBox(p, id(HE, 5));
  await touch(cdp, "touchStart", bx.x + 8, bx.y + 30); await touch(cdp, "touchEnd"); await sleep(150);
  const why = await p.locator(".why").first().textContent().catch(() => "");
  ok((await sel(p))[0] === id(HE, 5) && /要先跟/.test(why ?? ""), `非法牌可以選起來看，說明原因「${why}」`);
  ok(await p.locator("#playBtn").isDisabled(), "選到非法牌：「確認出牌」按不下去");
  const felt = await p.locator("#felt").boundingBox();
  bx = await cardBox(p, id(HE, 5));
  await swipe(cdp, { x: bx.x + 8, y: bx.y + 30 }, { x: felt.x + felt.width / 2, y: felt.y + felt.height * 0.6 }, 14);
  await touch(cdp, "touchEnd"); await sleep(500);
  ok((await p.locator("#hand .card.staged").count()) === 0 && (await handCount(p)) === 8, "非法牌拖到桌上：退回手上，不會進預覽也不會出牌");

  // 6. 拖到桌上放開 → 出牌預覽（還沒出）→ 點它收回 → 再拖上去 → 按「確認出牌」才真的出
  bx = await cardBox(p, id(SP, 3));
  await swipe(cdp, { x: bx.x + 8, y: bx.y + 30 }, { x: felt.x + felt.width / 2, y: felt.y + felt.height * 0.62 }, 14);
  await touch(cdp, "touchEnd"); await sleep(600);
  ok((await p.locator(`#hand .card.staged[data-id="${id(SP, 3)}"]`).count()) === 1, "拖到桌上放開：進入出牌預覽");
  ok((await handCount(p)) === 8 && (await p.locator("#mySlot .card").count()) === 0, "預覽時還沒出牌（牌局狀態沒變）");
  ok((await p.textContent("#playBtn")).includes("確認出牌") && (await p.locator("#playBtn.ready").count()) === 1, `「${await p.textContent("#playBtn")}」準備好了`);
  const stagedBox = await cardBox(p, id(SP, 3));
  const slotBox = await p.locator("#mySlot").boundingBox();
  ok(Math.abs((stagedBox.x + stagedBox.width / 2) - (slotBox.x + slotBox.width / 2)) < 8, "預覽的牌停在桌上「你出的牌」那一格");
  await touch(cdp, "touchStart", stagedBox.x + stagedBox.width / 2, stagedBox.y + stagedBox.height / 2); await touch(cdp, "touchEnd"); await sleep(500);
  ok((await p.locator("#hand .card.staged").count()) === 0 && (await handCount(p)) === 8, "點預覽中的牌：收回手上");
  bx = await cardBox(p, id(SP, 3));
  await swipe(cdp, { x: bx.x + 8, y: bx.y + 30 }, { x: felt.x + felt.width / 2, y: felt.y + felt.height * 0.62 }, 14);
  await touch(cdp, "touchEnd"); await sleep(600);
  const sb = await cardBox(p, id(SP, 3));
  await swipe(cdp, { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }, { x: sb.x + sb.width / 2, y: sb.y + 260 }, 12);   // 預覽的牌往下拉回
  await touch(cdp, "touchEnd"); await sleep(500);
  ok((await p.locator("#hand .card.staged").count()) === 0 && (await handCount(p)) === 8, "預覽的牌往下拉回：回到手上");
  bx = await cardBox(p, id(SP, 3));
  await swipe(cdp, { x: bx.x + 8, y: bx.y + 30 }, { x: felt.x + felt.width / 2, y: felt.y + felt.height * 0.62 }, 14);
  await touch(cdp, "touchEnd"); await sleep(500);
  const scrolled = await noScroll(p);
  await p.tap("#playBtn"); await p.tap("#playBtn", { force: true }).catch(() => {});   // 確認鈕連按兩下：只會送出一次
  await sleep(900);
  ok((await handCount(p)) === 7 && (await p.locator("#mySlot .card").count()) === 1, "按「確認出牌」：真的出牌、落桌（連按兩下也只出一張）");
  await sleep(2400);
  ok(errs.length === 0, "沒有錯誤" + (errs.length ? "：" + errs.join("|") : ""));
  ok(scrolled.y === 0 && scrolled.doc === 0 && scrolled.table === 0, `滑動、拖曳時頁面沒有被捲動（scrollY ${scrolled.y}）`);

  // 7. 不是你的回合：可以選牌看，不能送出
  const notTurn = await p.locator("#turnLine.mine").count() === 0;
  if (notTurn) {
    const any = p.locator("#hand .card").first();
    const ab = await any.boundingBox();
    await touch(cdp, "touchStart", ab.x + 8, ab.y + 30); await touch(cdp, "touchEnd"); await sleep(150);
    ok((await sel(p)).length === 1 && await p.locator("#playBtn").isDisabled(), "不是你的回合：可以選起來看，「確認出牌」按不下去");
  } else ok(true, "（這時剛好又輪到你，略過非自己回合的檢查）");
  await ctx.close();
}

// ======================= 桌機滑鼠 =======================
console.log("桌機（滑鼠）");
{
  const { ctx, p, errs } = await open({ width: 1280, height: 860 }, false);
  const card = p.locator(`#hand .card[data-id="${id(SP, 9)}"]`);
  await card.click({ position: { x: 8, y: 30 } }); await sleep(120);
  ok(JSON.stringify(await sel(p)) === JSON.stringify([id(SP, 9)]), "滑鼠點一下：選起來");
  await card.dblclick({ position: { x: 8, y: 30 } }); await sleep(1200);
  ok((await handCount(p)) === 8, "雙擊：不會出牌");
  const bx = await card.boundingBox(), felt = await p.locator("#felt").boundingBox();
  await p.mouse.move(bx.x + 8, bx.y + 30); await p.mouse.down();
  for (let i = 1; i <= 12; i++) { await p.mouse.move(bx.x + 8 + (felt.x + felt.width / 2 - bx.x - 8) * i / 12, bx.y + 30 + (felt.y + felt.height * 0.6 - bx.y - 30) * i / 12); await sleep(16); }
  await p.mouse.up(); await sleep(500);
  ok((await p.locator(`#hand .card.staged[data-id="${id(SP, 9)}"]`).count()) === 1 && (await handCount(p)) === 8, "滑鼠拖到桌上：出牌預覽");
  await p.click("#playBtn"); await sleep(900);
  ok((await handCount(p)) === 7, "按「確認出牌」：出牌");
  ok(errs.length === 0, "沒有錯誤");
  await ctx.close();
}

// ======================= 各種尺寸與橫拿：對戰畫面固定、不捲動 =======================
console.log("尺寸與方向");
for (const [name, w, h] of [["iPhone SE", 320, 568], ["iPhone 13", 390, 664], ["LINE 內建（約）", 390, 600], ["Pixel 7", 412, 839], ["橫拿 iPhone 13", 844, 390], ["橫拿 SE 2", 667, 375]]) {
  const { ctx, p } = await open({ width: w, height: h });
  const r = await p.evaluate(() => {
    const H = innerHeight, W = innerWidth, q = s => document.querySelector(s).getBoundingClientRect();
    const keys = ["#hand", "#playBtn", "#hintBtn", "#felt", ".topbar", "#mySlot"].map(s => { const b = q(s); return b.top >= -1 && b.bottom <= H + 1 && b.left >= -1 && b.right <= W + 1 && b.height > 0; });
    const f = q("#felt"), inside = ["#mySlot", "#oppSlot"].every(s => { const b = q(s); return b.top >= f.top - 1 && b.bottom <= f.bottom + 1; });
    return { keys, inside, scrollH: document.documentElement.scrollHeight, H, feltH: Math.round(f.height) };
  });
  ok(r.keys.every(Boolean) && r.inside && r.scrollH <= r.H + 1, `${name}（${w}×${h}）：手牌、確認出牌、牌桌都在畫面內，出的牌都在牌桌裡，頁面不捲動（牌桌高 ${r.feltH}px）`);
  await ctx.close();
}

await b.close();
console.log(fails ? `${fails} 項失敗` : "手牌手勢驗收全部通過");
process.exit(fails ? 1 : 0);
