// 逆命賭局 P1（連線層）：兩條 WebSocket 打好幾場完整九墩
//   賭局契約書（沒蓋章不能準備、空白＝我最後的尊嚴、雙方看得到）、開局、隱藏資訊不外洩、
//   單人重新整理、雙方斷線再回來、版本過期、不合法動作、經典指令在逆命房被擋、
//   梭哈被接、同點疊池、棄牌退回、籌碼歸零、九墩打完、再戰交換第 1 墩宣戰權、同桌戰績（含平手）
// 用法：先 npx wrangler dev，再 node test/e2e/laststand-room.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };
const ok = m => console.log("✓ " + m);
let n = 0, seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function player(code, name, token = null) {
  const p = { name, seat: -1, token, room: null, v: null, ver: 0, gid: null, msgs: [], closed: null };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; p.ver = m.ver; p.gid = m.r.gid; if (m.ls) p.v = m.ls; res(); }
      if (m.t === "room") { p.room = m.r; p.ver = m.r.ver; p.gid = m.r.gid; }
      if (m.t === "lsState") { p.v = m.s; p.ver = m.ver; p.gid = m.gid ?? p.gid; }
      if (m.t === "lsEvent") p.ver = m.ver;
      if (["full", "gone", "error", "closed"].includes(m.t)) res();
    };
    p.ws.onclose = e => { p.closed = e.code; res(); };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  p.cmd = async (o, extra = {}) => {
    const cid = `L${++n}`, k = p.msgs.length;
    p.send({ ...o, cid, ...extra });
    for (let i = 0; i < 200; i++) { const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid); if (r) return r; await sleep(15); }
    fail("沒有回覆：" + JSON.stringify(o));
  };
  // 牌局動作：帶版本和場次；成功後等新的牌桌到（真的網路上 ack 和牌桌分開到）
  p.ls = async a => {
    const r = await p.cmd({ t: "ls", a }, { ver: p.ver, gid: p.gid });
    if (r.t === "ack") for (let i = 0; i < 100 && p.ver < r.ver; i++) await sleep(15);
    return r;
  };
  return p;
}

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
let A = player(code, "大雞"); await A.joined;
let B = player(code, "阿禾"); await B.joined;
let r = await A.cmd({ t: "mode", mode: "laststand" });
if (r.t !== "ack") fail("換成逆命賭局失敗：" + JSON.stringify(r));
r = await A.cmd({ t: "mode", mode: "chips" });
if (r.t !== "reject") fail("舊的「籌碼對決」應該不存在");
await sleep(150);
if (A.room.mode !== "laststand" || B.room.mode !== "laststand") fail("雙方沒看到逆命賭局");
ok("房主把玩法換成逆命賭局，雙方同步（舊的籌碼對決已不存在）");

// ---- 賭局契約書 ----
r = await A.cmd({ t: "ready", ready: true });
if (r.t !== "reject" || !r.msg.includes("契約書")) fail("沒蓋章應該不能準備");
r = await A.cmd({ t: "stake", stake: "<script>" });
if (r.t !== "reject" || r.code !== "STAKE_INVALID") fail("HTML 符號應該被擋");
r = await A.cmd({ t: "stake", stake: "  阿嬤的藍白拖 " });
if (r.t !== "ack") fail("蓋章失敗");
r = await B.cmd({ t: "stake", stake: "" });
if (r.t !== "ack") fail("空白蓋章失敗");
await sleep(150);
if (A.room.seats.map(s => s.stake).join("|") !== "阿嬤的藍白拖|我最後的尊嚴" || B.room.seats[0].stake !== "阿嬤的藍白拖") fail("雙方看不到彼此的賭上之物：" + JSON.stringify(A.room.seats.map(s => s.stake)));
ok("賭局契約書：沒蓋章不能準備、HTML 符號擋下；「阿嬤的藍白拖」去頭尾空白、空白＝「我最後的尊嚴」；雙方都看得到");

r = await B.cmd({ t: "play", card: 0 });
if (r.t !== "reject") fail("逆命房送經典指令應該被擋");

// ---- 一直打：多場直到每種情況都看過 ----
const seen = { allInCalled: 0, tie: 0, poolTaken: 0, foldExcess: 0, elimination: 0, nine: 0, draw: 0, refund: 0, flip: 0, safeguard: 0, insight: 0 };
let leakChecks = 0, refreshed = false, bothDropped = false, staleChecked = false, illegalChecked = false;
const coins = [];
const policy = (v, p) => {
  const L = v.legal;
  if (L.flip) return { t: "flip", flip: rnd() < 0.25 };
  if (L.safeguard) return { t: "safeguard", use: rnd() < 0.25 };
  if (L.lock.length) return { t: "lock", card: L.lock[Math.floor(rnd() * L.lock.length)] };
  if (L.insight && rnd() < 0.3) return { t: "insight" };
  if (L.raise && rnd() < (v.allInStage ? 0.6 : 0.45)) return { t: "raise", to: rnd() < 0.6 ? L.raise[1] : L.raise[0] };
  if (L.call) return rnd() < 0.72 ? { t: "call" } : { t: "fold" };
  if (L.check) return { t: "check" };
  return null;
};

for (let match = 1; match <= 14; match++) {
  if (match > 1) {
    // 再戰：兩個人都按再來一場
    await A.cmd({ t: "rematch", ready: true }); await B.cmd({ t: "rematch", ready: true });
  } else {
    await A.cmd({ t: "ready", ready: true }); await B.cmd({ t: "ready", ready: true });
  }
  for (let i = 0; i < 100 && !(A.v?.trick === 1 && B.v?.trick === 1 && A.room.status === "IN_GAME" && !A.v.result); i++) await sleep(20);
  if (A.v?.trick !== 1) fail(`第 ${match} 場沒開局`);
  coins.push(A.v.declarer);
  if (match === 1) {
    if (A.v.hand.length !== 9 || B.v.hand.length !== 9 || A.v.hand.some(c => B.v.hand.includes(c))) fail("發牌不對");
    if (JSON.stringify(A.msgs.filter(m => m.t === "lsState").at(-1)).includes('"hands"')) fail("牌桌狀態帶了雙方手牌");
    ok(`開局：各 9 張、互不重疊；第 1 墩宣戰權在座位 ${A.v.declarer}`);
  }
  let steps = 0;
  while (!A.v.result) {
    const a = A.v, b = B.v;
    // 一致與不外洩：籌碼、疊池、階段一樣；看不到對手手牌；30 枚守恆
    if (a.trick === b.trick && a.phase === b.phase && JSON.stringify(a.stacks) === JSON.stringify(b.stacks)) {
      leakChecks++;
      if (a.hand.some(c => b.hand.includes(c))) fail("兩邊手牌重疊");
      if (a.myLock >= 0 && b.myLock >= 0 && a.myLock === b.myLock) fail("鎖牌外洩？");
      const tot = a.stacks[0] + a.stacks[1] + a.commit[0] + a.commit[1] + a.pool[0] + a.pool[1];
      if (tot !== 30) fail(`籌碼不守恆：${tot}`);
    }
    // 第 1 場：測重新整理、雙方斷線、版本過期、不合法動作
    if (match === 1 && !refreshed && a.trick === 2 && a.phase === "lock" && a.myLock >= 0) {
      const before = JSON.stringify({ h: a.hand, s: a.stacks, l: a.myLock, t: a.trick });
      A.ws.close(); await sleep(200);
      A = player(code, "大雞", A.token); await A.joined; await sleep(150);
      if (JSON.stringify({ h: A.v.hand, s: A.v.stacks, l: A.v.myLock, t: A.v.trick }) !== before) fail("重新整理後牌桌不一樣");
      refreshed = true;
      ok("鎖了牌之後重新整理：回到同一墩，手牌、籌碼、已鎖的牌都一樣（還是只有自己看得到）");
      continue;
    }
    if (match === 1 && !bothDropped && a.trick === 4 && a.phase === "bet") {
      const before = JSON.stringify({ a: A.v.hand, b: B.v.hand, s: A.v.stacks, c: A.v.commit });
      A.ws.close(); B.ws.close(); await sleep(400);
      const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
      A = player(code, "大雞", A.token); await A.joined;
      if (A.room.status !== "PAUSED") fail("一個人回來時應該是暫停：" + A.room.status);
      B = player(code, "阿禾", B.token); await B.joined; await sleep(200);
      if (A.room.status !== "IN_GAME") fail("兩人都回來應該繼續");
      if (JSON.stringify({ a: A.v.hand, b: B.v.hand, s: A.v.stacks, c: A.v.commit }) !== before) fail("雙方斷線再回來牌桌不一樣");
      bothDropped = true;
      ok(`下注中雙方都斷線（查房：${info.status}）→ 一個回來是暫停、兩個都回來繼續；手牌、籌碼、本墩投入都一樣`);
      continue;
    }
    const actor = a.toAct >= 0 ? (a.toAct === A.seat ? A : B) : (!a.locked[A.seat] ? A : B);
    const v = actor.v;
    if (match === 1 && !staleChecked && v.legal.lock.length) {
      const x = await actor.cmd({ t: "ls", a: { t: "lock", card: v.hand[0] } }, { ver: actor.ver - 1, gid: actor.gid });
      if (x.t !== "reject" || x.code !== "STALE") fail("版本過期應該被拒");
      const other = actor === A ? B : A;
      const y = await actor.ls({ t: "lock", card: other.v.hand[0] });
      if (y.t !== "reject" || y.code !== "ILLEGAL") fail("鎖別人的牌應該被拒");
      const z = await other.ls({ t: "check" });
      if (z.t !== "reject") fail("還在鎖牌時下注應該被拒");
      staleChecked = illegalChecked = true;
      ok("版本過期被拒並同步；鎖對手的牌、還沒輪到就下注都被拒");
    }
    const act = policy(v, actor);
    if (!act) { await sleep(30); continue; }
    const res = await actor.ls(act);
    if (res.t !== "ack") { if (res.code === "STALE") { await sleep(50); continue; } fail(`正常動作被拒：${JSON.stringify(act)} → ${JSON.stringify(res)}`); }
    if (++steps > 300) fail("一場走太多步");
  }
  await sleep(200);
  // 這一場的紀錄
  const h = A.v.history;
  for (const t of h) {
    if (t.allIn >= 0 && t.outcome !== "fold") seen.allInCalled++;
    if (t.outcome === "tie") seen.tie++;
    if (t.poolTaken > 0) seen.poolTaken++;
    if (t.excessReturned > 0) seen.foldExcess++;
    if (t.refund) seen.refund++;
    if (t.flippedBy >= 0) seen.flip++;
    if (t.safeguardBy >= 0) seen.safeguard++;
    if (t.insight.some(Boolean)) seen.insight++;
    if (t.outcome === "fold" && t.cards !== null) fail("棄牌墩出現了確切牌面");
  }
  const res = A.v.result;
  if (res.reason === "elimination") seen.elimination++; else seen.nine++;
  if (res.winner < 0) seen.draw++;
  // 對手摸不到的：棄牌的確切牌面沒有出現在任何事件裡
  const foldTricks = new Set(h.filter(t => t.outcome === "fold").map(t => t.trick));
  // 只看這一場的事件（同一條連線上也有前幾場的事件）
  for (const P of [A, B]) for (const m of P.msgs) if (m.t === "lsEvent" && m.gid === A.gid && foldTricks.has(m.e.trick) && (m.e.type === "Showdown" || (m.e.cards && m.e.type !== "TrickStart"))) fail("棄牌墩送出了牌面：" + JSON.stringify(m) + " 那一墩：" + JSON.stringify(h.find(t => t.trick === m.e.trick)?.outcome));
  if (A.room.status !== "SETTLEMENT" || A.room.result?.reason !== res.reason) fail("房間沒進結算");
  if (A.room.stats.played !== match) fail(`同桌戰績應該是 ${match} 場：${JSON.stringify(A.room.stats)}`);
  console.log(`  第 ${match} 場：${res.reason === "elimination" ? `第 ${res.trick} 墩有人歸零` : "九墩打完"}、${res.winner < 0 ? "平手" : `座位 ${res.winner} 勝`}（${A.v.stacks.join("：")}）`);
  const done = seen.allInCalled && seen.tie && seen.poolTaken && seen.foldExcess && seen.elimination && seen.nine;
  if (done && match >= 3) break;
}
ok(`一致性檢查 ${leakChecks} 次：兩邊籌碼／階段一致、手牌不重疊、30 枚守恆；棄牌墩沒有送出牌面`);
for (const k of ["allInCalled", "tie", "poolTaken", "foldExcess", "elimination", "nine"]) if (!seen[k]) fail(`沒看到：${k}`);
ok(`真的打到：梭哈被接 ${seen.allInCalled}、同點 ${seen.tie}、疊池被拿走 ${seen.poolTaken}、棄牌退回 ${seen.foldExcess}、疊池退款 ${seen.refund}、籌碼歸零結束 ${seen.elimination}、九墩打完 ${seen.nine}（平手 ${seen.draw}）；翻轉 ${seen.flip}、保命 ${seen.safeguard}、讀心 ${seen.insight}`);
for (let i = 1; i < coins.length; i++) if (coins[i] === coins[i - 1]) fail(`再戰沒有交換第 1 墩宣戰權：${coins}`);
ok(`再戰交換第 1 墩宣戰權：${coins.join(" → ")}`);
console.log("全部通過");
process.exit(0);
