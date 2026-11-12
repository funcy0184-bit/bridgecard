// 逆命賭局：斷線逾時判輸、選單認輸離開（跟經典牌局共用房間的斷線時間軸，這裡確認逆命房也照規則走）
//   自己開一個 wrangler dev（斷線時間軸用 --var 縮短），跑完關掉，不用先 npm run dev
//   1. 打到第 2 墩，朋友斷線：房主看到暫停 → 逾時判朋友輸、只記一場；朋友回來看得到結果、看不到房主的牌
//   2. 再來一場（第 1 墩宣戰權換人）→ 房主從選單認輸離開：朋友贏、只多記一場；接著離開，座位讓出來
// 用法：node test/e2e/laststand-forfeit.mjs [埠號]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.argv[2] ?? "8794";
const BASE = `http://127.0.0.1:${PORT}`, WS = BASE.replace(/^http/, "ws");
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = mkdtempSync(join(tmpdir(), "hb-lsforfeit-"));
const T = { NOTICE_MS: 2000, CHOICE_MS: 4000, FORFEIT_MS: 9000, SEAT_HOLD_MS: 6000, RESUME_KEEP_MS: 25000, RECORD_KEEP_MS: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server = null;
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
}
const fail = async m => { console.error("✗ " + m); await stop(); rmSync(DIR, { recursive: true, force: true }); process.exit(1); };
const ok = m => console.log("✓ " + m);
const until = async (f, what, ms = 5000) => { for (let t = 0; t < ms; t += 25) { if (f()) return; await sleep(25); } await fail("等不到：" + what); };

let n = 0;
function player(code, name, token = null) {
  const p = { name, seat: -1, token, room: null, v: null, ver: 0, gid: null, msgs: [], closed: null };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; p.ver = m.ver; p.gid = m.r.gid; p.v = m.ls ?? null; res(); }
      if (m.t === "room") { p.room = m.r; p.ver = m.r.ver; p.gid = m.r.gid; }
      if (m.t === "lsState") { p.v = m.s; p.ver = m.ver; p.gid = m.gid ?? p.gid; }
      if (m.t === "lsEvent") p.ver = m.ver;
    };
    p.ws.onclose = e => { p.closed = e.code; res(); };
  });
  p.cmd = async (o, extra = {}) => {
    const cid = `F${++n}`, k = p.msgs.length;
    p.ws.send(JSON.stringify({ ...o, cid, ...extra }));
    for (let i = 0; i < 300; i++) { const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid); if (r) return r; await sleep(15); }
    await fail("沒有回覆：" + JSON.stringify(o));
  };
  p.ls = async a => {
    const r = await p.cmd({ t: "ls", a }, { ver: p.ver, gid: p.gid });
    if (r.t === "ack") for (let i = 0; i < 100 && p.ver < r.ver; i++) await sleep(15);
    return r;
  };
  return p;
}
// 雙方都照最單純的打法：不翻、不保命、鎖第一張、過牌（面對加注就跟）
async function step(P) {
  const L = P.v?.legal;
  if (!L || P.v.result) return false;
  if (L.flip) return (await P.ls({ t: "flip", flip: false })).t === "ack";
  if (L.safeguard) return (await P.ls({ t: "safeguard", use: false })).t === "ack";
  if (L.lock.length) return (await P.ls({ t: "lock", card: L.lock[0] })).t === "ack";
  if (L.call) return (await P.ls({ t: "call" })).t === "ack";
  if (L.check) return (await P.ls({ t: "check" })).t === "ack";
  return false;
}
async function playUntilTrick(A, B, trick) {
  for (let i = 0; i < 200 && (A.v?.trick ?? 0) < trick; i++) { const a = await step(A), b = await step(B); if (!a && !b) await sleep(30); }
  if ((A.v?.trick ?? 0) < trick) await fail(`打不到第 ${trick} 墩`);
}

await start();
try {
  const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
  const A = player(code, "大雞"); await A.joined;
  let B = player(code, "阿禾"); await B.joined;
  if ((await A.cmd({ t: "mode", mode: "laststand" })).t !== "ack") await fail("換不成逆命賭局");
  await A.cmd({ t: "stake", stake: "阿嬤的藍白拖" }); await B.cmd({ t: "stake", stake: "" });
  await A.cmd({ t: "ready", ready: true }); await B.cmd({ t: "ready", ready: true });
  await until(() => A.v && B.v && A.room.status === "IN_GAME", "開局");
  const coin1 = A.v.declarer;
  await playUntilTrick(A, B, 2);
  const before = { stacks: A.v.stacks.slice(), trick: A.v.trick };

  // ---- 1. 朋友斷線 → 暫停 → 逾時判輸 ----
  B.ws.close();
  await until(() => A.room.status === "PAUSED", "朋友斷線後房主看到暫停", 4000);
  const t0 = Date.now();
  await until(() => A.room.result, "斷線逾時判輸", T.FORFEIT_MS + 8000);
  const waited = Date.now() - t0;
  if (A.room.result.reason !== "timeout" || A.room.result.winner !== A.seat) await fail("逾時判輸的結果不對：" + JSON.stringify(A.room.result));
  if (A.room.status !== "SETTLEMENT") await fail("判輸之後應該是結算：" + A.room.status);
  const st = A.room.stats;
  if (st.played !== 1 || st.wins[A.seat] !== 1) await fail("戰績應該剛好 1 場、房主贏：" + JSON.stringify(st));
  ok(`第 ${before.trick} 墩朋友斷線：房主看到暫停，約 ${(waited / 1000).toFixed(1)} 秒後逾時判朋友輸（設定 ${T.FORFEIT_MS / 1000} 秒），戰績只記 1 場`);

  // 朋友用憑證回來：看得到結果、手上的牌還是自己的、看不到房主的牌
  B = player(code, "阿禾", B.token); await B.joined;
  if (B.seat !== 1 || !B.room.result || B.room.result.winner !== A.seat) await fail("朋友回來應該看到自己被判輸：" + JSON.stringify(B.room.result));
  if (B.v) {
    const mine = new Set(B.v.hand), theirs = A.v.hand;
    if (theirs.some(c => mine.has(c))) await fail("朋友回來看到房主的牌");
    if (JSON.stringify(B.v).includes(`"hands"`)) await fail("朋友收到整副牌的資料");
  }
  await sleep(500);
  if (A.room.stats.played !== 1) await fail("朋友回來之後戰績被多記：" + JSON.stringify(A.room.stats));
  ok("朋友回來：看到這場被判輸、只看得到自己的牌；戰績還是 1 場（不重複）");

  // ---- 2. 再來一場 → 房主選單認輸離開 ----
  await A.cmd({ t: "rematch", ready: true }); await B.cmd({ t: "rematch", ready: true });
  await until(() => A.room.status === "IN_GAME" && A.v && !A.v.result && A.v.trick === 1, "再來一場開局");
  if (A.v.declarer === coin1) await fail("再戰沒有交換第 1 墩宣戰權");
  if (A.v.stacks.join() !== "15,15") await fail("再戰籌碼沒重設：" + A.v.stacks);
  ok(`再來一場：第 1 墩宣戰權換人（${coin1} → ${A.v.declarer}），籌碼 15：15`);
  await playUntilTrick(A, B, 2);
  const r = await A.cmd({ t: "leave", forfeit: true });
  if (r.t !== "ack") await fail("認輸離開被拒：" + JSON.stringify(r));
  await until(() => B.room.result || B.room.status === "WAITING", "朋友收到認輸");
  const fr = B.msgs.filter(m => m.t === "room" && m.notice === "forfeit");
  if (!fr.length) await fail("朋友沒收到「認輸」通知");
  const last = fr.at(-1).r;
  if (!last.result || last.result.winner !== B.seat || last.result.reason !== "forfeit") await fail("認輸的結果不對：" + JSON.stringify(last.result));
  if (last.stats.played !== 2 || last.stats.wins[B.seat] !== 1) await fail("戰績應該是 2 場、各贏 1：" + JSON.stringify(last.stats));
  // 畫面上認輸之後會接著送一般離開（跟經典牌局一樣）：座位讓出來，朋友回到等人
  if ((await A.cmd({ t: "leave" })).t !== "ack") await fail("認輸之後離開被拒");
  await until(() => B.room.status === "WAITING" && !B.room.seats[0]?.taken, "房主離開後朋友回到等人");
  ok("房主從選單認輸離開：朋友贏（forfeit）、收到通知、戰績 2 場各贏 1；房主離開後座位讓出來，朋友回到等人");
  console.log("逆命賭局斷線判輸／認輸全部通過");
} finally {
  await stop();
  rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
