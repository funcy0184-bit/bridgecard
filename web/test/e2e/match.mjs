// C2 雲端權威的完整一場（經典牌局）：從準備一路打到有人到目標分數、整場結算、再來一場
//   每一步檢查兩邊一致（分數、墩數、階段、輪到誰、版本），而且不外洩：
//   對手手牌只有張數、牌堆不送、對手摸的暗牌看不到、房間廣播沒有憑證、沒入座的連線拿不到任何牌局資料
// 叫牌會混著加倍、再加倍（只要規則允許），讓計分走到不同的路
// 用法：先 npx wrangler dev，再 node test/e2e/match.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };
const ok = m => console.log("✓ " + m);
// TableState 只能有這些欄位（對手手牌、牌堆不在裡面）
const ALLOWED = new Set(["seat", "phase", "hand", "legal", "oppCount", "faceUp", "stockCount", "leadCard", "followCard", "leaderSeat", "currentSeat",
  "myTricks", "oppTricks", "oppTakenFaceUp", "myTakenFaceUp", "highestBid", "highestBidder", "declarer", "minBid", "doubled", "canDouble", "canRedouble",
  "auctionSeats", "auctionCalls", "myScore", "oppScore", "targetScore", "handNumber", "hasResult", "result", "matchWinner"]);

let n = 0;
function player(code, name, token = null) {
  const p = { name, seat: -1, token, state: null, room: null, ver: 0, gid: null, msgs: [], states: [] };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; p.ver = m.ver; p.gid = m.r.gid; if (m.s) p.state = m.s; res(); }
      if (m.t === "room") { p.room = m.r; p.ver = m.r.ver; p.gid = m.r.gid; }
      if (m.t === "state") { p.state = m.s; p.ver = m.ver; p.gid = m.gid ?? p.gid; p.states.push({ ver: m.ver, s: m.s }); }
      if (m.t === "event") p.ver = m.ver;
      if (["full", "gone", "error"].includes(m.t)) res();
    };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  p.cmd = async o => {
    const cid = `m${++n}`, k = p.msgs.length;
    p.send({ ...o, cid });
    for (let i = 0; i < 150; i++) {
      const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid);
      if (r) return r;
      await sleep(20);
    }
    fail("沒有回覆：" + JSON.stringify(o));
  };
  p.game = o => p.cmd({ ...o, ver: p.ver, gid: p.gid });
  return p;
}

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
const A = player(code, "阿明"); await A.joined;
const B = player(code, "小美"); await B.joined;

// 沒入座的連線（沒送 hello）什麼都拿不到
{
  const spy = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  const got = [];
  spy.onmessage = ev => got.push(JSON.parse(ev.data));
  await new Promise(r => { spy.onopen = r; });
  for (const o of [{ t: "sync" }, { t: "recap" }, { t: "play", card: 0 }, { t: "ready", ready: true }]) spy.send(JSON.stringify(o));
  await sleep(300);
  if (got.some(m => m.t !== "error")) fail("沒入座的連線拿到了資料：" + JSON.stringify(got));
  spy.close();
  ok("沒入座的連線送 sync／recap／出牌／準備：只會收到「請先進房」，拿不到任何牌局資料");
}

await Promise.all([A.cmd({ t: "ready", ready: true }), B.cmd({ t: "ready", ready: true })]);
for (let i = 0; i < 50 && !(A.state && B.state); i++) await sleep(50);
const gid1 = A.gid;

let checks = 0, doubles = 0, redoubles = 0, hands = new Set();
const p2 = [A, B];
function consistent() {
  const [a, b] = [A.state, B.state];
  if (!a || !b || A.ver !== B.ver) return;
  checks++;
  for (const s of [a, b]) for (const k of Object.keys(s)) if (!ALLOWED.has(k)) fail("牌桌狀態多了不該送的欄位：" + k);
  if (a.hand.some(c => b.hand.includes(c))) fail("兩邊手牌重疊");
  if (a.oppCount !== b.hand.length || b.oppCount !== a.hand.length) fail("對手張數對不上");
  if (a.myScore !== b.oppScore || a.oppScore !== b.myScore) fail("分數不一致");
  if (a.myTricks !== b.oppTricks || a.oppTricks !== b.myTricks) fail("墩數不一致");
  if (a.phase !== b.phase || a.currentSeat !== b.currentSeat || a.handNumber !== b.handNumber || a.stockCount !== b.stockCount) fail("階段／輪到誰／局數／牌堆張數不一致");
  if (a.highestBid !== b.highestBid || a.doubled !== b.doubled || a.declarer !== b.declarer) fail("叫牌狀態不一致");
  if (a.faceUp !== b.faceUp) fail("明牌不一致");
}

for (let i = 0; i < 40000; i++) {
  consistent();
  if (A.state?.matchWinner >= 0 && B.state?.matchWinner >= 0) break;
  const p = p2.find(x => x.state && x.state.currentSeat === x.state.seat && x.state.followCard < 0 && x.state.phase !== 3);
  if (A.state?.phase === 3 && B.state?.phase === 3 && A.state.matchWinner < 0 && A.ver === B.ver) {
    hands.add(A.state.handNumber);
    const r = await B.game({ t: "next" });
    if (r.t !== "ack" && r.code !== "STALE") fail("下一局被拒：" + JSON.stringify(r));
    await sleep(80);
    continue;
  }
  if (!p) { await sleep(25); continue; }
  const s = p.state;
  let r;
  if (s.phase === 1) {
    // 叫牌：先叫的叫最低；能加倍、再加倍就試（每局最多一次），其他 Pass
    const call = s.canRedouble ? -3 : s.canDouble && (s.handNumber % 2 === 1) ? -2 : s.highestBid < 0 ? s.minBid : -1;
    if (call === -2) doubles++; if (call === -3) redoubles++;
    r = await p.game({ t: "call", call });
  } else r = await p.game({ t: "play", card: s.legal[(s.handNumber + s.myTricks) % s.legal.length] });
  if (r.t !== "ack" && r.code !== "STALE") fail("正常的動作被拒：" + JSON.stringify(r));
}
const w = A.state.matchWinner;
if (w < 0) fail("沒打完一整場");
await sleep(300);
ok(`打完一整場：${hands.size + 1} 局，加倍 ${doubles} 次、再加倍 ${redoubles} 次，一致性檢查 ${checks} 次全部通過（狀態欄位、手牌不重疊、張數、分數、墩數、階段、叫牌、明牌）`);
ok(`整場結果：座位 ${w} 先到 ${A.state.targetScore} 分（${A.state.myScore}:${A.state.oppScore}）`);

// 對手摸的暗牌看不到；房間廣播沒有憑證
for (const p of p2) {
  const peek = p.msgs.filter(m => m.t === "event" && m.e.type === "CardDrawn" && m.e.seat !== p.seat && m.e.card >= 0);
  if (peek.length) fail(`${p.name}看到了對手摸的暗牌`);
  const rooms = JSON.stringify(p.msgs.filter(m => m.t === "room" || m.t === "resync").map(m => m.r));
  if (rooms.includes(A.token) || rooms.includes(B.token) || rooms.includes("tokenHash") || rooms.includes("pid")) fail("房間廣播帶了憑證或內部編號");
}
ok("兩邊收到的事件裡，對手摸的暗牌全部是看不見的；房間廣播沒有憑證、沒有內部編號");

// 整場結算 → 戰績
if (A.room.status !== "SETTLEMENT" || A.room.result?.winner !== w || A.room.result?.reason !== "target") fail("整場結算狀態不對：" + JSON.stringify(A.room.result));
if (A.room.stats.played !== 1 || A.room.stats.wins[w] !== 1) fail("戰績沒有記一場：" + JSON.stringify(A.room.stats));
let r = await A.game({ t: "next" });
if (r.t !== "reject") fail("整場結束後不能按下一局（要按再來一場）");
ok(`整場結算：狀態 SETTLEMENT、照規則先到目標分數；同桌戰績記 1 場（座位 ${w} 贏）`);

// 再來一場：兩個人都按
r = await A.cmd({ t: "rematch", ready: true });
await sleep(150);
if (r.t !== "ack" || B.room.status !== "REMATCH" || !B.room.seats[A.seat].rematch) fail("一個人按再來一場：對方應該看到");
r = await B.cmd({ t: "rematch", ready: true });
await sleep(400);
if (r.t !== "ack" || A.room.status !== "IN_GAME" || A.gid === gid1 || !A.gid) fail("兩個人都按：應該開新的一場、換新的場次編號");
if (A.state.myScore !== 0 || A.state.oppScore !== 0 || A.state.handNumber !== 1 || A.state.matchWinner !== -1) fail("新的一場分數沒歸零");
if (A.room.stats.played !== 1) fail("再來一場不該多記戰績");
ok("再來一場：兩個人都按才開；新的場次編號、分數歸零、戰績還是 1 場");

// 回顧只給入座的人，而且只有公開資訊（Phase 6 會再加畫面）
const k = A.msgs.length;
A.send({ t: "recap", gid: gid1 });
await sleep(300);
const rc = A.msgs.slice(k).find(m => m.t === "recap");
if (!rc || rc.gid !== gid1 || !rc.items.length) fail("拿不到上一場的回顧");
ok(`上一場的精彩回顧 ${rc.items.length} 則：${rc.items.map(x => x.kind).join("、")}`);
console.log("全部通過");
process.exit(0);
