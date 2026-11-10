// C4 保存與一致性（伺服器自己開、自己關：模擬房間在對局中途重開機）
//   牌局指令驗證：不是你的回合、手上沒有的牌、不能出的牌（附原因）、版本過期、場次不對
//   同一個指令重送不重複生效（重開機之後也一樣）；狀態版本、事件序號連續不重複
//   對局中途伺服器整個重開：兩人用憑證回來，手牌、版本、事件序號都接得上，接著打完、開下一局
// 用法：node test/e2e/persist.mjs [埠號，預設 8795]（會自己在暫存資料夾開一個 wrangler dev，跑完關掉）
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.argv[2] ?? "8795";
const BASE = `http://127.0.0.1:${PORT}`, WS = BASE.replace(/^http/, "ws");
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = mkdtempSync(join(tmpdir(), "hb-persist-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server = null;
const fail = m => { console.error("✗ " + m); stop().finally(() => process.exit(1)); throw new Error(m); };
const ok = m => console.log("✓ " + m);

async function start() {
  server = spawn("npx", ["wrangler", "dev", "--port", PORT, "--persist-to", DIR], { cwd: WEB, detached: true, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + "/")).ok) return; } catch { /* 還沒好 */ } await sleep(500); }
  fail("伺服器沒起來");
}
async function stop() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* 已經停了 */ }
  server = null;
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/"); } catch { return; } await sleep(250); }
}

let n = 0;
function player(code, name, token = null) {
  const p = { name, seat: -1, token, state: null, room: null, ver: 0, gid: null, eids: [], msgs: [], closed: null };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; p.ver = m.ver; p.gid = m.r.gid; if (m.s) p.state = m.s; res(); }
      if (m.t === "room") { p.room = m.r; p.ver = m.r.ver; p.gid = m.r.gid; }
      if (m.t === "state") { p.state = m.s; p.ver = m.ver; }
      if (m.t === "event") { p.eids.push(m.eid); p.ver = m.ver; }
      if (m.t === "full" || m.t === "gone" || m.t === "error") res();
    };
    p.ws.onclose = e => { p.closed = e.code; res(); };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  p.cmd = async (o, cid = `c${++n}`) => {
    const k = p.msgs.length;
    p.send({ ...o, cid });
    for (let i = 0; i < 150; i++) {
      const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid);
      if (r) return r;
      await sleep(20);
    }
    fail(`沒有回覆：${JSON.stringify(o)}`);
  };
  // 牌局指令：帶我看到的版本和場次
  p.game = (o, cid) => p.cmd({ ...o, ver: p.ver, gid: p.gid }, cid);
  return p;
}
const turnOf = ps => ps.find(p => p.state && p.state.currentSeat === p.state.seat && p.state.followCard < 0 && p.state.phase !== 3);
// 每個人收到的事件序號要一路遞增；兩個人合起來要從 1 連到最後、沒有洞（私人事件只給一邊）
function checkEids(ps, label) {
  for (const p of ps) for (let i = 1; i < p.eids.length; i++) if (!(p.eids[i] > p.eids[i - 1])) fail(`${label}：${p.name} 收到的事件序號沒有遞增（${p.eids[i - 1]} → ${p.eids[i]}）`);
  const all = [...new Set(ps.flatMap(p => p.eids))].sort((a, b) => a - b);
  for (let i = 0; i < all.length; i++) if (all[i] !== i + 1) fail(`${label}：事件序號有洞或重複（第 ${i + 1} 個是 ${all[i]}）`);
  return all.length;
}
async function step(ps) {
  const p = turnOf(ps);
  if (!p) { await sleep(60); return; }
  const s = p.state;
  const r = s.phase === 1 ? await p.game({ t: "call", call: s.highestBid < 0 ? s.minBid : -1 }) : await p.game({ t: "play", card: s.legal[0] });
  if (r.t !== "ack") { if (r.code === "STALE") { await sleep(50); return; } fail(`正常出牌被拒：${JSON.stringify(r)}`); }
  await sleep(15);
}

try {
  await start();
  ok(`伺服器起來了（暫存資料：${DIR}）`);
  const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
  let A = player(code, "阿明"); await A.joined;
  let B = player(code, "小美"); await B.joined;
  await Promise.all([A.cmd({ t: "ready", ready: true }), B.cmd({ t: "ready", ready: true })]);
  for (let i = 0; i < 50 && !(A.state && B.state); i++) await sleep(50);
  if (!A.state || !B.state) fail("沒有開局");
  ok(`開局：房號 ${code}，版本 ${A.ver}`);

  // ---- 牌局指令驗證 ----
  const P = turnOf([A, B]), Q = P === A ? B : A;
  let r = await Q.game({ t: "play", card: Q.state.legal[0] ?? Q.state.hand[0] });
  if (r.t !== "reject" || r.code !== "NOT_YOUR_TURN") fail("不是你的回合應該被拒：" + JSON.stringify(r));
  r = await P.game({ t: "play", card: Q.state.hand[0] });
  if (r.t !== "reject" || r.code !== "ILLEGAL") fail("出別人手上的牌應該被拒");
  r = await P.game({ t: "play", card: 999 });
  if (r.t !== "reject" || r.code !== "ILLEGAL") fail("亂傳的牌應該被拒");
  const verBefore = P.ver, k = P.msgs.length;
  r = await P.cmd({ t: "play", card: P.state.legal[0], ver: P.ver - 1, gid: P.gid });
  await sleep(100);
  if (r.t !== "reject" || r.code !== "STALE") fail("版本過期應該被拒");
  if (!P.msgs.slice(k).some(m => m.t === "resync")) fail("版本過期之後應該送完整快照");
  r = await P.cmd({ t: "play", card: P.state.legal[0], ver: P.ver, gid: "not-this-match" });
  if (r.t !== "reject" || r.code !== "STALE") fail("場次不對應該被拒");
  if (P.ver !== verBefore) fail("被拒的指令改到版本了");
  ok("牌局指令：不是你的回合、別人手上的牌、亂傳的牌、版本過期（接著送完整快照）、場次不對，全部被拒，牌局沒動");

  // ---- 同一個指令重送 ----
  const card = P.state.legal[0], handLen = P.state.hand.length;
  const evQ = Q.msgs.filter(m => m.t === "event" && m.e.type === "CardPlayed").length;
  const first = await P.game({ t: "play", card }, "dup-play");
  await sleep(150);
  const verAfter = P.ver;
  const again = await P.cmd({ t: "play", card, ver: verAfter - 1, gid: P.gid }, "dup-play");      // 跟第一次一模一樣（舊版本）
  await sleep(150);
  if (first.t !== "ack" || again.t !== "ack") fail("重送同一個出牌應該都回成功");
  if (P.state.hand.length !== handLen - 1) fail("同一張牌被出了兩次？");
  if (Q.msgs.filter(m => m.t === "event" && m.e.type === "CardPlayed").length !== evQ + 1) fail("對手收到兩次出牌");
  if (P.ver !== verAfter) fail("重送改到版本了");
  ok("同一個出牌指令重送：回同一個成功、牌只出一次、對手只看到一次、版本不變");

  // ---- 打到出牌階段第 4 墩，看非法跟牌 ----
  let illegalSeen = false;
  for (let i = 0; i < 4000; i++) {
    const s = A.state;
    if (s.phase === 2 && s.myTricks + s.oppTricks === 4 && s.leadCard < 0) break;
    const p = turnOf([A, B]);
    // 有機會就試一次「有那個花色卻不跟」
    if (!illegalSeen && p && p.state.leadCard >= 0 && (p.state.phase === 0 || p.state.phase === 2)) {
      const lead = Math.floor(p.state.leadCard / 13);
      const off = p.state.hand.find(c => Math.floor(c / 13) !== lead);
      if (off !== undefined && p.state.hand.some(c => Math.floor(c / 13) === lead)) {
        const x = await p.game({ t: "play", card: off });
        if (x.t !== "reject" || x.code !== "ILLEGAL" || !x.msg) fail("沒跟牌應該被拒而且說原因：" + JSON.stringify(x));
        illegalSeen = x.msg;
        continue;
      }
    }
    await step([A, B]);
  }
  if (!illegalSeen) fail("沒測到不跟牌");
  ok(`不跟牌被拒，原因：「${illegalSeen}」`);
  await sleep(300);
  const nEv = checkEids([A, B], "重開機前");
  const lastVer = A.ver, lastEid = Math.max(...A.eids, ...B.eids);
  const handA = A.state.hand.join(), handB = B.state.hand.join();
  if (A.ver !== B.ver) fail("兩邊看到的版本不一樣");
  ok(`重開機前：版本 ${lastVer}、事件 ${nEv} 個（序號 1～${lastEid} 連續、不重複），兩邊版本一致`);

  // ---- 伺服器整個重開 ----
  await stop();
  await sleep(300);
  if (A.closed === null || B.closed === null) fail("伺服器關了，連線應該斷掉");
  await start();
  const tokA = A.token, tokB = B.token;
  const A2 = player(code, "阿明", tokA); await A2.joined;
  if (A2.room?.status !== "PAUSED") fail(`只有一個人回來時應該是 PAUSED（現在 ${A2.room?.status}）`);
  const B2 = player(code, "小美", tokB); await B2.joined;
  await sleep(200);
  if (A2.seat !== A.seat || B2.seat !== B.seat) fail("重開機後座位變了");
  if (A2.state.hand.join() !== handA || B2.state.hand.join() !== handB) fail("重開機後手牌不一樣");
  if (A2.ver !== lastVer) fail(`重開機後版本不一樣：${lastVer} → ${A2.ver}`);
  const rs = A2.msgs.find(m => m.t === "resync");
  if (rs.eid !== lastEid) fail(`重開機後事件序號不一樣：${lastEid} → ${rs.eid}`);
  if (A2.room.status !== "IN_GAME") fail("兩人都回來應該繼續 IN_GAME");
  ok(`伺服器重開：一個人先回來是暫停、兩人都回來繼續；座位、手牌、版本 ${A2.ver}、事件序號 ${rs.eid} 全部接得上`);
  const re = await A2.cmd({ t: "play", card, ver: verAfter - 1, gid: A2.gid }, "dup-play");
  if (re.t !== "ack" || A2.ver !== lastVer) fail("重開機後重送舊指令應該回原本的結果、不生效");
  ok("重開機之後再重送同一個出牌指令：還是回原本的成功、不重複生效");

  // ---- 接著打完、開下一局 ----
  A2.eids = [...A.eids]; B2.eids = [...B.eids];
  for (let i = 0; i < 4000 && !(A2.state.phase === 3 && A2.state.hasResult); i++) await step([A2, B2]);
  if (A2.state.phase !== 3) fail("重開機後打不完");
  await sleep(200);
  const total = checkEids([A2, B2], "重開機前後合起來");
  if (A2.state.myScore !== B2.state.oppScore || A2.state.oppScore !== B2.state.myScore) fail("兩邊分數不一致");
  ok(`重開機後接著打完：事件 ${total} 個，序號前後連續、沒有重用；兩邊分數一致 ${A2.state.myScore}:${A2.state.oppScore}`);
  if (A2.state.matchWinner < 0) {
    const seenVer = A2.ver;                         // 兩個人幾乎同時按下一局：都帶同一個版本
    r = await B2.game({ t: "next" });
    const dup = await A2.cmd({ t: "next", ver: seenVer, gid: A2.gid });
    await sleep(300);
    if (r.t !== "ack" || A2.state.handNumber !== 2 || A2.state.phase !== 0) fail("下一局沒開");
    if (dup.t !== "reject" || dup.code !== "STALE") fail("同時按下一局，第二下應該被當成過期（不會連開兩局）：" + JSON.stringify(dup));
    ok("按下一局開第 2 局；另一個人慢一步按的下一局被當成過期，不會連開兩局");
  }
  console.log("全部通過");
} catch (e) {
  if (!String(e?.message ?? "").length) console.error(e);
  await stop();
  rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}
await stop();
rmSync(DIR, { recursive: true, force: true });
process.exit(0);
