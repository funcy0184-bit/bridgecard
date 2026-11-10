// C4 斷線、重新整理、重連（兩支模擬手機真的點畫面；斷線時間軸縮短：提示 2.5 秒、可以選 5 秒、判中離 14 秒）
// 自己開一個 wrangler dev（暫存資料夾、縮短時間），跑完關掉。情境：
//   等待室：房主重新整理還是房主；開局前斷線太久座位讓出來、回來重新入座；朋友用邀請連結加入
//   第 1 局：搶牌中重新整理、叫牌中重新整理、剛加倍完就斷線、出牌第 9 墩斷線（暫停面板 → 可以選 → 繼續等 → 回來）、
//            結算動畫中重新整理
//   第 2 局：兩個人都斷線再回來、同一個人開第二個分頁、伺服器整個重開（兩支手機自己連回來）、
//            斷線超過時限 → 照規則判（只算一次，戰績不重複）→ 兩人都按再來一場
//   第 2 場：選單「認輸離開」→ 對手看到結果、回到等人；每一步都檢查沒有頁面錯誤、不重播動畫
//   過期：沒人的房間過了保留時間就收掉
// 用法：node test/e2e/reconnect.mjs [埠號，預設 8796] [截圖資料夾]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const PORT = process.argv[2] ?? "8796", SHOTS = process.argv[3] ?? "test-results";
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = mkdtempSync(join(tmpdir(), "hb-reconnect-"));
const T = { NOTICE_MS: 2500, CHOICE_MS: 5000, FORFEIT_MS: 14000, SEAT_HOLD_MS: 6000, RESUME_KEEP_MS: 25000, RECORD_KEEP_MS: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server = null, browser = null;
const errors = [];
async function start() {
  const vars = Object.entries(T).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
  server = spawn("npx", ["wrangler", "dev", "--port", PORT, "--persist-to", DIR, ...vars], { cwd: WEB, detached: true, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + "/")).ok) return; } catch { /* 還沒好 */ } await sleep(500); }
  throw new Error("伺服器沒起來");
}
async function stop() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* 已經停了 */ }
  server = null;
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/"); } catch { return; } await sleep(250); }
}
async function bail(msg) {
  console.error("✗ " + msg);
  try { for (const [P, n] of [[A, "A"], [B, "B"]]) if (P && !P.isClosed()) await P.screenshot({ path: `${SHOTS}/rc-fail-${n}.png` }); } catch { /* 截不到 */ }
  if (errors.length) console.error(errors.join("\n"));
  await browser?.close(); await stop(); rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}
const ok = m => console.log("✓ " + m);
const shot = (P, n) => P.screenshot({ path: `${SHOTS}/rc-${n}.png` });
const S = P => P.evaluate(() => globalThis.__hbState?.() ?? null);
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(150); } await bail("等不到：" + what); };
const waitText = (P, sel, text, ms, what) => P.waitForFunction(([s, t]) => document.querySelector(s)?.textContent?.includes(t), [sel, text], { timeout: ms }).catch(() => bail(what));
const impacts = P => P.evaluate(() => (globalThis.__hbFx || []).filter(x => x.kind === "impact").map(x => x.key ?? `${x.what}:${x.tier}`));

async function newPhone(ctx, label, url = BASE) {
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  page.on("console", m => { if (m.type() === "error" && !/WebSocket|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  page.on("dialog", d => d.accept());           // 確認框（認輸、暫時離開）一律按確定
  await page.goto(url);
  return page;
}
// 斷網：先把連線關掉（跟真的斷線走同一條路），再讓這支手機沒有網路；回來：網路恢復，手機自己連回去
async function drop(P, ctx) { await P.evaluate(() => globalThis.__hbDrop?.()); await ctx.setOffline(true); }
async function back(ctx) { await ctx.setOffline(false); }

// 照真人的方式點畫面打一步（只在輪到自己、而且牌局沒暫停時）
async function step(P, { double = false } = {}) {
  const s = await S(P);
  if (!s?.st || s.screen !== "table") return "wait";
  if (await P.isVisible("#result:not([hidden])")) return "result";
  if (await P.isVisible("#matchEnd:not([hidden])")) return "ended";
  const x = s.st;
  if (s.room && s.room.status !== "IN_GAME") return "wait";
  if (s.waiting) return "wait";
  try {
    if (x.phase === 1) {
      if (!(await P.isVisible("#bidPanel.mine"))) return "wait";
      if (x.highestBid < 0) {
        await P.locator("#bidLevels button:not([disabled])").first().click({ timeout: 2000 }); await sleep(100);
        await P.locator("#bidStrains button:not([disabled])").nth(1).click({ timeout: 2000 }); await sleep(150);
        await P.click("#bidConfirm", { timeout: 2000 });
        return "acted";
      }
      if (double && x.canDouble && await P.isEnabled("#bidDouble")) { await P.click("#bidDouble", { timeout: 2000 }); return "doubled"; }
      await P.click("#bidPass", { timeout: 2000 });
      return "acted";
    }
    if ((x.phase === 0 || x.phase === 2) && x.currentSeat === x.seat && x.followCard < 0 && x.legal.length) {
      const id = x.legal[0];
      await P.locator(`#hand .card[data-id="${id}"]`).click({ position: { x: 10, y: 34 }, timeout: 2000 }); await sleep(100);
      await P.click("#playBtn", { timeout: 2000 });
      return "acted";
    }
  } catch { return "wait"; }
  return "wait";
}
// 兩支手機輪流打，直到 cond() 成立；onStep 可以在某一步之後插手
async function playUntil(cond, what, opts = {}, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    for (const P of [A, B]) {
      const r = await step(P, opts);
      // 動作送出後，等伺服器確認的新狀態到了再往下判斷（不然會搶在結果前面）
      if (r === "acted") for (let i = 0; i < 30 && (await S(P))?.waiting; i++) await sleep(100);
      if (opts.onStep && await opts.onStep(P, r)) return;
      if (r === "acted" || r === "doubled") await sleep(260);
    }
    await sleep(120);
  }
  await bail("打不到：" + what);
}
const tricks = s => s.st.myTricks + s.st.oppTricks;

let A, B, ctxA, ctxB;
try {
  await start();
  ok(`伺服器起來了（斷線時間軸縮短：${JSON.stringify(T)}）`);
  // 過期用：開一桌沒人的房，最後檢查有沒有被收掉
  const ghostCode = (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()).code;

  browser = await chromium.launch();
  ctxA = await browser.newContext({ ...devices["iPhone 13"] });
  ctxB = await browser.newContext({ ...devices["Pixel 7"] });
  for (const c of [ctxA, ctxB]) await c.addInitScript(() => { try { localStorage.setItem("hb-story-offered", "1"); } catch { /* */ } });
  A = await newPhone(ctxA, "房主");
  await A.click("#goOnline"); await A.fill("#name", "阿明"); await A.click("#create");
  await A.waitForSelector("#wait:not([hidden])");
  const code = (await A.textContent("#bigCode")).trim();
  // 朋友點邀請連結
  B = await newPhone(ctxB, "朋友", `${BASE}/?room=${code}`);
  await B.waitForSelector("#online:not([hidden])");
  await B.fill("#name", "小美"); await B.click("#join");
  await B.waitForSelector("#wait:not([hidden])");
  await waitText(A, "#plateOppName", "小美", 5000, "房主沒看到朋友入座");
  ok(`朋友點邀請連結加入（房號 ${code}）`);

  // ---- 等待室：房主重新整理 ----
  await A.reload();
  await A.waitForSelector("#wait:not([hidden])", { timeout: 8000 });
  await waitText(A, "#plateMe small", "房主", 5000, "房主重新整理後不是房主了");
  await waitText(B, "#plateOpp em", "已入座", 5000, "朋友那邊沒看到房主回來");
  ok("等待室：房主重新整理，回來還是房主、朋友那邊看到他回來");

  // ---- 開局前斷線太久：座位讓出來；回來重新入座 ----
  await B.close();
  await waitText(A, "#plateOpp em", "斷線中", 5000, "房主沒看到朋友斷線");
  await waitText(A, "#plateOppName", "還沒來", T.SEAT_HOLD_MS + 6000, "開局前斷線太久，座位沒讓出來");
  ok(`開局前斷線超過 ${T.SEAT_HOLD_MS / 1000} 秒：座位讓出來（房主那邊顯示還沒來）`);
  B = await newPhone(ctxB, "朋友", `${BASE}/?room=${code}`);   // 這支手機還記得這桌：直接連回去，當成新的人坐空位
  await B.waitForSelector("#wait:not([hidden])", { timeout: 8000 });
  await waitText(A, "#plateOppName", "小美", 5000, "朋友回來沒重新入座");
  ok("朋友再打開連結：重新入座（舊憑證已作廢，拿到新的）");

  // ---- 開打 ----
  await A.click("#readyBtn"); await sleep(300); await B.click("#readyBtn");
  await Promise.all([A.waitForSelector("#table:not([hidden])"), B.waitForSelector("#table:not([hidden])")]);
  ok("兩邊按準備，進牌桌");

  // ---- 第 1 局：搶牌中重新整理 ----
  await playUntil(async () => (await S(A))?.st?.stockCount <= 20, "搶牌第 4 墩");
  await until(async () => !(await S(B)).waiting && !(await S(A)).waiting, 5000, "動作還在送");
  const before4 = (await S(B)).st;
  await B.reload();
  await B.waitForSelector("#table:not([hidden])", { timeout: 10000 });
  await until(async () => (await S(B))?.st?.hand?.length === before4.hand.length, 8000, "朋友重新整理後手牌回來");
  const after4 = (await S(B)).st;
  if (after4.hand.join() !== before4.hand.join() || after4.stockCount !== before4.stockCount) await bail("搶牌中重新整理：手牌或牌堆不一樣");
  if ((await impacts(B)).length) await bail("重新整理後重播了之前的贏墩演出");
  ok(`搶牌中朋友重新整理：手牌 ${after4.hand.length} 張一張不差、牌堆 ${after4.stockCount} 張，沒有重播之前的演出`);

  // ---- 叫牌中重新整理 ----
  // 第一個人叫完就停（才有叫牌紀錄可以比對；另一個人還沒動，等一下才能測加倍）
  const firstCall = async () => ((await S(A))?.st?.auctionCalls?.length ?? 0) >= 1;
  await playUntil(firstCall, "叫牌", { onStep: firstCall });
  await A.waitForSelector("#bidPanel:not([hidden])", { timeout: 5000 });
  await sleep(400);
  const bidBefore = (await S(A)).st;
  await A.reload();
  await A.waitForSelector("#table:not([hidden])", { timeout: 10000 });
  await A.waitForSelector("#bidPanel:not([hidden])", { timeout: 8000 }).catch(() => bail("叫牌中重新整理：叫牌面板沒回來"));
  const bidAfter = (await S(A)).st;
  if (bidAfter.auctionCalls.join() !== bidBefore.auctionCalls.join() || bidAfter.phase !== 1) await bail("叫牌中重新整理：叫牌紀錄不一樣");
  ok(`叫牌中房主重新整理：叫牌面板和紀錄（${bidAfter.auctionCalls.length} 個叫品）都回來`);

  // ---- 剛加倍完就斷線 ----
  let doubler = null;
  await playUntil(async () => !!doubler || (await S(A)).st.phase !== 1, "加倍", {
    double: true,
    onStep: async (P, r) => { if (r === "doubled") { doubler = P; await drop(P, P === A ? ctxA : ctxB); return true; } return false; },
  });
  if (!doubler) await bail("沒有機會加倍");
  const other = doubler === A ? B : A;
  await waitText(other, "#banner", "斷線", 5000, "對手沒看到斷線提示");
  await sleep(1500);
  await back(doubler === A ? ctxA : ctxB);
  await until(async () => (await S(doubler))?.room?.status === "IN_GAME" && (await S(other))?.room?.status === "IN_GAME", 15000, "加倍後斷線回來繼續");
  const [d1, d2] = [(await S(A)).st, (await S(B)).st];
  if (d1.doubled !== 1 || d2.doubled !== 1) await bail(`加倍後斷線：加倍狀態不一致（${d1.doubled}/${d2.doubled}）`);
  ok("剛按加倍就斷網：對手看到斷線提示、牌局暫停；回來之後兩邊都是「已加倍」、繼續叫牌");

  // ---- 出牌第 9 墩斷線：暫停面板 → 可以選 → 繼續等 → 回來 ----
  // 打到出牌第 9 墩以後（「剛好第 9 墩開頭」那一瞬間很短，輪詢可能剛好錯過，所以第 9 墩之後都算）
  const late = async () => { const s = await S(A); return s.st.phase === 2 && tricks(s) >= 8; };
  await playUntil(late, "出牌第 9 墩", { onStep: late });
  await drop(B, ctxB);
  await waitText(A, "#banner", "暫停", 5000, "房主沒看到暫停提示");
  await A.waitForSelector("#pause:not([hidden])", { timeout: T.NOTICE_MS + 4000 }).catch(() => bail("斷線超過提示時間，沒出現暫停面板"));
  await shot(A, "pause-notice");
  await A.waitForSelector("#pauseChoice:not([hidden])", { timeout: T.CHOICE_MS + 4000 }).catch(() => bail("斷線超過可以選的時間，沒出現選項"));
  const clock = await A.textContent("#pauseClock");
  if (!/再 \d+:\d\d 沒回來/.test(clock)) await bail("暫停面板沒有中離倒數：" + clock);
  await shot(A, "pause-choice");
  await A.click("#pauseWait");
  await sleep(300);
  if (await A.isVisible("#pause:not([hidden])")) await bail("按繼續等之後面板沒收起來");
  await back(ctxB);
  await waitText(A, "#banner", "回來啦", 10000, "朋友回來，房主沒看到「回來啦」");
  ok(`出牌第 ${tricks(await S(A)) + 1} 墩斷網：房主先看到暫停提示 → ${T.NOTICE_MS / 1000} 秒出現暫停面板 → ${T.CHOICE_MS / 1000} 秒可以選（倒數：${clock.trim()}）→ 按繼續等 → 朋友回來繼續`);

  // ---- 結算動畫中重新整理 ----
  await playUntil(async () => await A.isVisible("#result:not([hidden])"), "第 1 局結算");
  await A.reload();
  await A.waitForSelector("#result:not([hidden])", { timeout: 10000 }).catch(() => bail("結算中重新整理：結算單沒回來"));
  await sleep(600);
  const [rA, rB] = [(await S(A)).st, (await S(B)).st];
  if (rA.myScore !== rB.oppScore || rA.oppScore !== rB.myScore) await bail("結算中重新整理：分數不一致");
  ok(`結算動畫中房主重新整理：結算單直接出來，分數一致（${rA.myScore}:${rA.oppScore}）`);
  const matchOver1 = rA.matchWinner >= 0;
  await B.click("#nextBtn");
  if (matchOver1) { await waitText(A, "#nextBtn", "想再來一場", 5000, "房主沒看到再來一場"); await A.click("#nextBtn"); }
  await until(async () => (await S(A)).st?.phase === 0 && !(await A.isVisible("#result:not([hidden])")), 10000, "下一局");

  // ---- 第 2 局：兩個人都斷線再回來 ----
  await playUntil(async () => (await S(A))?.st?.stockCount <= 22, "第 2 局搶牌");
  await until(async () => !(await S(B)).waiting && !(await S(A)).waiting, 5000, "動作還在送");
  const both = [(await S(A)).st, (await S(B)).st];
  await drop(A, ctxA); await drop(B, ctxB);
  await sleep(3000);
  await back(ctxA); await back(ctxB);
  await until(async () => (await S(A))?.room?.status === "IN_GAME" && (await S(B))?.room?.status === "IN_GAME", 15000, "兩人都回來繼續");
  if ((await S(A)).st.hand.join() !== both[0].hand.join() || (await S(B)).st.hand.join() !== both[1].hand.join()) await bail("兩人都斷線再回來：手牌不一樣");
  if (await A.isVisible("#matchEnd:not([hidden])")) await bail("兩人都斷線不應該判中離");
  ok("兩個人都斷網 3 秒再回來：沒有人被判中離、手牌都一樣、繼續打");

  // ---- 同一個人開第二個分頁 ----
  const A2 = await newPhone(ctxA, "房主-分頁2", `${BASE}/?room=${code}`);
  await A2.waitForSelector("#table:not([hidden])", { timeout: 10000 });
  await waitText(A, "#banner", "別的分頁", 5000, "舊分頁沒被告知");
  await A.close();
  A = A2;
  ok("房主在第二個分頁打開同一桌：新分頁接手牌桌，舊分頁停下來並說明原因");

  // ---- 伺服器整個重開：兩支手機自己連回來 ----
  await playUntil(async () => (await S(A))?.st?.stockCount <= 18, "多打幾墩");
  await until(async () => !(await S(B)).waiting && !(await S(A)).waiting, 5000, "動作還在送");
  const pre = [(await S(A)).st, (await S(B)).st];
  await stop();
  await waitText(A, "#banner", "重新連線", 8000, "伺服器關了，畫面沒說在重連");
  await start();
  await until(async () => (await S(A))?.room?.status === "IN_GAME" && (await S(B))?.room?.status === "IN_GAME", 40000, "伺服器重開後兩邊自己連回來");
  if ((await S(A)).st.hand.join() !== pre[0].hand.join() || (await S(B)).st.hand.join() !== pre[1].hand.join()) await bail("伺服器重開後手牌不一樣");
  await playUntil(async () => (await S(A))?.st?.stockCount <= 16, "伺服器重開後接著打");
  ok("伺服器整個重開：兩支手機自己重連（退避＋抖動）、手牌一樣、接著打");

  // ---- 斷線超過時限：照規則判（只算一次） ----
  await until(async () => !(await S(B)).waiting && !(await S(A)).waiting, 5000, "動作還在送");
  await drop(B, ctxB);
  await A.waitForSelector("#matchEnd:not([hidden])", { timeout: T.FORFEIT_MS + 8000 }).catch(() => bail("斷線超過時限沒有判"));
  await waitText(A, "#meTitle", "這場算你贏", 3000, "房主那邊結果不對");
  const statsA = (await A.textContent("#meStats")).trim();
  await shot(A, "timeout-win");
  await back(ctxB);
  await B.waitForSelector("#matchEnd:not([hidden])", { timeout: 15000 }).catch(() => bail("朋友回來沒看到結果"));
  await waitText(B, "#meTitle", "這場算阿明贏", 3000, "朋友那邊結果不對");
  await waitText(B, "#meText", "斷線超過", 3000, "朋友那邊沒說原因");
  const statsB = (await B.textContent("#meStats")).trim();
  // 第 1 局就有人到目標分數的話，前面已經打完一場（那一場照規則記過了）
  const want = matchOver1 ? 2 : 1;
  if (!statsA.includes(`共 ${want} 場`) || !statsB.includes(`共 ${want} 場`)) await bail(`戰績重複或沒記（應該共 ${want} 場）：${statsA} / ${statsB}`);
  await shot(B, "timeout-lose");
  // 精彩回顧：結果面板上按一下就看得到（只有公開資訊）
  await B.click("#meRecap");
  await B.waitForSelector("#recap:not([hidden])", { timeout: 3000 }).catch(() => bail("回顧面板沒打開"));
  await B.waitForFunction(() => !document.getElementById("recapSub").textContent.includes("整理中"), null, { timeout: 4000 }).catch(() => bail("回顧沒有送回來"));
  const nItems = await B.locator("#recapList li").count();
  await shot(B, "recap");
  await B.click("#recap [data-close]");
  ok(`結果面板的「精彩回顧」：${nItems ? `${nItems} 則` : "這場沒有大轉折（顯示鼓勵的話）"}`);
  ok(`朋友斷線超過 ${T.FORFEIT_MS / 1000} 秒：照規則判房主贏；朋友回來看到「你斷線超過…」；戰績只記一次（${statsA}）`);

  // ---- 再來一場 ----
  await A.click("#meRematch");
  await waitText(B, "#meRematch", "想再來一場", 5000, "朋友沒看到再來一場");
  await B.click("#meRematch");
  await until(async () => { const s = await S(A); return s?.room?.status === "IN_GAME" && s.st?.handNumber === 1 && s.st.myScore === 0; }, 10000, "再來一場");
  if (await A.isVisible("#matchEnd:not([hidden])")) await bail("再來一場後結果面板沒收");
  ok("兩人都按再來一場：新的一場從第 1 局開始");

  // ---- 選單：認輸離開 ----
  await sleep(800);
  await A.click("#menuBtn");
  await A.waitForSelector("#forfeitBtn:not([hidden])");
  await waitText(A, "#menuStats", `共 ${want} 場`, 2000, "選單裡沒有同桌戰績");
  if (!(await A.textContent("#leaveBtn")).includes("暫時離開")) await bail("對局中的選單應該有「暫時離開」");
  await A.click("#forfeitBtn");
  await A.waitForSelector("#home:not([hidden])", { timeout: 8000 }).catch(() => bail("認輸之後沒回首頁"));
  await waitText(A, "#banner", "你認輸了", 3000, "房主沒看到認輸結果");
  await B.waitForSelector("#wait:not([hidden])", { timeout: 8000 }).catch(() => bail("對手認輸離開後，朋友沒回到等人"));
  await waitText(B, "#banner", "認輸離開了，這場算你贏", 3000, "朋友沒看到對手認輸的結果");
  await shot(B, "forfeit-wait");
  ok("房主從選單「認輸離開」（有確認）：回首頁看到結果；朋友看到「認輸離開了，這場算你贏」，回到等人");

  // ---- 過期 ----
  const gone = await fetch(`${BASE}/api/rooms/${ghostCode}`);
  if (gone.status !== 404) await bail(`沒人的房間過了 ${T.RESUME_KEEP_MS / 1000} 秒應該收掉（${gone.status}）`);
  ok(`沒人的房間過了保留時間（測試用 ${T.RESUME_KEEP_MS / 1000} 秒）就收掉`);

  if (errors.length) await bail("頁面有錯誤：\n" + errors.join("\n"));
  ok("全程沒有頁面錯誤");
  console.log("全部通過");
} catch (e) {
  await bail(String(e?.stack ?? e));
}
await browser.close();
await stop();
rmSync(DIR, { recursive: true, force: true });
process.exit(0);
