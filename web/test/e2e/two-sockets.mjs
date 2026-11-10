// 不開瀏覽器，用兩條 WebSocket 模擬兩支手機打完一整局（含斷線重連、第三人擠不進來）
// 用法：先 npm run dev，再 node test/e2e/two-sockets.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };

function player(code, name, token = null) {
  const p = { name, seat: -1, token, state: null, events: [], ws: null, closedCode: null, msgs: [] };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.ready = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; res(); }
      if (m.t === "state") p.state = m.s;
      if (m.t === "resync" && m.s) p.state = m.s;          // 第 2 版：進房／重連時一次給完整快照
      if (m.t === "event") p.events.push(m.e);
      if (m.t === "full" || m.t === "gone") res();
    };
    p.ws.onclose = e => { p.closedCode = e.code; res(); };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  return p;
}

// 只看自己的 TableState 做決定（跟真的手機一樣）
function act(p) {
  const s = p.state;
  if (!s || s.currentSeat !== s.seat) return false;
  if (s.phase === 1) {                       // 叫牌：先叫的人叫最低，之後都 Pass
    p.send({ t: "call", call: s.highestBid < 0 ? s.minBid : -1 });
    return true;
  }
  if ((s.phase === 0 || s.phase === 2) && s.legal.length && s.followCard < 0) {
    p.send({ t: "play", card: s.legal[0] });
    return true;
  }
  return false;
}

const res = await fetch(`${BASE}/api/rooms`, { method: "POST" });
const { code } = await res.json();
if (!/^[A-Z2-9]{6}$/.test(code)) fail("房號格式不對：" + code);
console.log("✓ 開房成功，房號", code);

const host = player(code, "阿明"); await host.ready;
let guest = player(code, "小美"); await guest.ready;
if (host.seat !== 0 || guest.seat !== 1) fail("座位分配錯");
await sleep(200);
if (host.state || guest.state) fail("還沒按準備就發牌了");
host.send({ t: "ready", ready: true, cid: "r-host" }); guest.send({ t: "ready", ready: true, cid: "r-guest" });
await sleep(400);
if (!host.state || !guest.state) fail("兩人都按準備了卻沒發牌");
console.log("✓ 兩人入座、都按準備、雲端發牌：房主", host.state.hand.length, "張，朋友", guest.state.hand.length, "張");

const third = player(code, "路人"); await third.ready;
if (!third.msgs.some(m => m.t === "full")) fail("第三個人竟然進得來");
console.log("✓ 第三個人進不來（房間已滿）");

const ghost = player("ZZZZZZ", "x"); await ghost.ready;
if (!ghost.msgs.some(m => m.t === "gone")) fail("不存在的房號應該回 gone");
console.log("✓ 打錯房號會被告知房間不存在");

// 回個話：轉給兩邊（標座位，不是阿禾講的）；連點只過第一句；亂傳的編號丟掉；牌局不受影響
{
  const before = JSON.stringify(host.state), evBefore = guest.events.length;
  const got = () => guest.msgs.filter(m => m.t === "emote");
  for (let k = 0; k < 5; k++) host.send({ t: "emote", i: 1 });
  host.send({ t: "emote", i: 99 }); host.send({ t: "emote", i: -1 }); host.send({ t: "emote", i: "x" });
  await sleep(400);
  if (got().length !== 1 || got()[0].seat !== 0 || got()[0].i !== 1) fail(`回個話：連點 5 次應該只轉 1 句（收到 ${JSON.stringify(got())}）`);
  if (!host.msgs.some(m => m.t === "emote" && m.seat === 0)) fail("回個話：自己也要收到（確認送出）");
  await sleep(2600);
  host.send({ t: "emote", i: 3 });
  await sleep(400);
  if (got().length !== 2 || got()[1].i !== 3) fail("回個話：隔 2.5 秒之後可以再說一句");
  if (JSON.stringify(host.state) !== before || guest.events.length !== evBefore) fail("回個話不應該改變牌局");
  console.log("✓ 回個話：轉給對方（標座位）、連點只過第一句、亂傳的編號丟掉、牌局不受影響");
}

let reconnected = false, leakChecks = 0;
for (let i = 0; i < 4000; i++) {
  // 兩邊同時看到的手牌不能有交集（不外洩）
  if (host.state && guest.state) {
    const a = new Set(host.state.hand);
    if (guest.state.hand.some(c => a.has(c))) fail("兩邊手牌重疊或外洩");
    leakChecks++;
  }
  if (host.state?.hasResult && guest.state?.hasResult && host.state.phase === 3) break;

  // 打到打牌階段中間，朋友斷線再用憑證連回來
  if (!reconnected && guest.state?.phase === 2 && guest.state.myTricks + guest.state.oppTricks === 3) {
    const tok = guest.token, seat = guest.seat, before = guest.state.hand.join();
    guest.ws.close(); await sleep(300);
    const back = player(code, "小美", tok); await back.ready;
    await sleep(300);
    if (back.seat !== seat) fail("重連後座位變了");
    if (!back.state || back.state.hand.join() !== before) fail("重連後手牌不一樣");
    guest = back;
    reconnected = true;
    console.log("✓ 朋友打到一半斷線，用憑證連回原座位，手牌一張不差");
  }

  if (!act(host) && !act(guest)) await sleep(60); else await sleep(25);
}
const r = host.state?.result;
if (!host.state?.hasResult || !r) fail("沒有打到結算");
console.log(`✓ 打完一整局：合約 ${r.bidIndex}，莊家座位 ${r.declarer} 拿 ${r.tricksTaken}/${r.tricksNeeded} 墩，座位 ${r.scorer} +${r.points} 分`);
if (host.state.myScore !== guest.state.oppScore) fail("雙方看到的分數不一致");
console.log(`✓ 雙方分數一致：房主 ${host.state.myScore} · 朋友 ${host.state.oppScore}（檢查不外洩 ${leakChecks} 次）`);

if (!reconnected) fail("沒有測到重連");
const drawnToHost = host.events.filter(e => e.type === "CardDrawn" && e.seat === 1);
if (drawnToHost.some(e => e.card >= 0)) fail("房主收到朋友摸的暗牌");
console.log("✓ 房主收到的事件裡，朋友摸的暗牌全部是看不見的（-1）");

host.send({ t: "next" }); await sleep(400);
if (host.state.phase !== 0 || host.state.handNumber !== 2) fail("下一局沒開始");
console.log("✓ 按「下一局」開始第 2 局，分數保留：", host.state.myScore, ":", host.state.oppScore);
const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
console.log("✓ 查房間：", JSON.stringify(info));
console.log("全部通過");
process.exit(0);
