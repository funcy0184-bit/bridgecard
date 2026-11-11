// C1 房間功能的邊界情況（不開瀏覽器，用 WebSocket 直接打伺服器）
//   開房、查房（不含私人資料）、加入、準備／取消、換模式（只有房主、籌碼對決未開放）、
//   重複送同一個指令、第三人、同一個憑證開兩個分頁、房主離開換人當房主、同時按準備只開一場、
//   開打後陌生人進不來、對局中不能用一般離開、協定版本不對、頻率限制（擋猜房號、擋狂開房）
// 用法：先 npx wrangler dev，再 node test/e2e/rooms.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };
const ok = m => console.log("✓ " + m);
let cidN = 0;
const cid = () => `t${Date.now().toString(36)}-${++cidN}`;

function player(code, name, token = null, v = 2) {
  const p = { name, seat: -1, token, room: null, state: null, msgs: [], closed: null, ws: null };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; if (m.s) p.state = m.s; res(); }
      if (m.t === "room") p.room = m.r;
      if (m.t === "state") p.state = m.s;
      if (m.t === "full" || m.t === "gone" || m.t === "closed" || m.t === "error") res();
    };
    p.ws.onclose = e => { p.closed = e.code; res(); };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  // 送一個指令，等它的 ack／reject
  p.cmd = async (o, id = cid()) => {
    const n0 = p.msgs.length;
    p.send({ ...o, cid: id });
    for (let i = 0; i < 100; i++) {
      const r = p.msgs.slice(n0).find(m => (m.t === "ack" || m.t === "reject") && m.cid === id);
      if (r) return r;
      await sleep(20);
    }
    fail(`指令 ${JSON.stringify(o)} 沒有回覆`);
  };
  p.count = t => p.msgs.filter(m => m.t === t).length;
  p.notices = () => p.msgs.filter(m => m.t === "room" && m.notice).map(m => m.notice);
  return p;
}
const newRoom = async () => {
  const r = await fetch(`${BASE}/api/rooms`, { method: "POST" });
  if (r.status !== 200) fail("開房失敗 " + r.status);
  return (await r.json()).code;
};

// ---------- 開房、查房 ----------
const code = await newRoom();
if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/.test(code)) fail("房號格式不對：" + code);
ok(`開房：房號 ${code}（6 碼、不含 0 O 1 I L）`);
{
  const codes = new Set(await Promise.all(Array.from({ length: 8 }, newRoom)));
  if (codes.size !== 8) fail("連開 8 桌出現重複房號");
  ok("連開 8 桌，房號都不一樣");
}
const info0 = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
if (JSON.stringify(info0) !== JSON.stringify({ exists: true, status: "WAITING", seats: [false, false], started: false, host: "", mode: "classic" })) fail("查房結果不對：" + JSON.stringify(info0));
ok("查房只回：在不在、狀態、哪些位子有人、開打了沒、房主暱稱、玩法（沒有憑證、沒有牌局資料）");

// ---------- 加入 ----------
const host = player(code, "阿明"); await host.joined;
if (host.seat !== 0 || !/^[0-9a-f]{48}$/.test(host.token)) fail("房主沒拿到 0 號座位或憑證格式不對");
if (host.room.status !== "WAITING" || host.room.host !== 0 || host.room.mode !== "classic") fail("房主進房後的房間狀態不對");
const guest = player(code.toLowerCase(), "小美"); await guest.joined;      // 小寫房號也進得來
await sleep(150);
if (guest.seat !== 1) fail("朋友不是 1 號座位");
if (host.room.status !== "READY" || !host.notices().includes("joined")) fail("朋友進來後房主沒收到通知或狀態沒變 READY");
for (const p of [host, guest]) {
  const all = JSON.stringify(p.msgs.filter(m => m.t !== "welcome"));
  if (all.includes(host.token) || all.includes(guest.token) || all.includes("tokenHash")) fail("房間廣播裡出現座位憑證");
}
if (JSON.stringify(guest.msgs.find(m => m.t === "welcome")).includes(host.token)) fail("朋友拿到房主的憑證");
ok("朋友用房號加入 1 號座位；兩邊的房間廣播都不含任何人的私人憑證");
if (host.state || guest.state) fail("還沒準備就發牌了");
ok("兩人入座不會自動開打，要等兩邊按準備");

// ---------- 準備／取消準備 ----------
let r = await host.cmd({ t: "ready", ready: true });
if (r.t !== "ack") fail("房主按準備被拒：" + JSON.stringify(r));
await sleep(100);
if (!guest.room.seats[0].ready || guest.room.status !== "READY") fail("朋友沒看到房主準備好");
r = await host.cmd({ t: "ready", ready: false });
await sleep(100);
if (r.t !== "ack" || guest.room.seats[0].ready) fail("房主取消準備沒生效");
ok("準備、取消準備：雙方即時看到");

// ---------- 重複送同一個指令 ----------
{
  const id = cid();
  const a = await host.cmd({ t: "ready", ready: true }, id);
  const roomsBefore = guest.count("room");
  const b = await host.cmd({ t: "ready", ready: true }, id);
  await sleep(150);
  if (a.t !== "ack" || b.t !== "ack") fail("同一個指令重送應該回同一個結果");
  if (guest.count("room") !== roomsBefore) fail("同一個指令重送又廣播了一次");
  const c1 = await guest.cmd({ t: "mode", mode: "classic" }, "dup-mode");
  const c2 = await guest.cmd({ t: "mode", mode: "classic" }, "dup-mode");
  if (c1.t !== "reject" || c2.t !== "reject" || c1.code !== c2.code || c1.msg !== c2.msg) fail("被拒的指令重送應該回同一個拒絕");
  ok("同一個指令編號重送：回同一個結果、不重複生效、不重複廣播（成功和被拒都一樣）");
  await host.cmd({ t: "ready", ready: false });
}

// ---------- 模式 ----------
r = await guest.cmd({ t: "mode", mode: "classic" });
if (r.t !== "reject" || r.code !== "NOT_HOST") fail("朋友應該不能換模式");
r = await host.cmd({ t: "mode", mode: "chips" });
if (r.t !== "reject" || r.code !== "MODE_UNAVAILABLE" || !r.msg.includes("籌碼對決")) fail("籌碼對決應該回「還沒開放」");
r = await host.cmd({ t: "mode", mode: "bogus" });
if (r.t !== "reject" || r.code !== "BAD_REQUEST") fail("亂傳模式應該被拒");
if (host.room.mode !== "classic") fail("模式被亂改了");
ok("模式：只有房主能換；籌碼對決回「還沒開放」、不會冒充；亂傳的模式被拒");

// ---------- 第三人、打錯房號、協定版本 ----------
const third = player(code, "路人"); await third.joined;
if (!third.msgs.some(m => m.t === "full") || third.closed !== 4409 && third.closed !== null) fail("第三個人竟然進得來");
ok("第三個人進不來（坐滿）");
const forged = player(code, "阿明", "0".repeat(48)); await forged.joined;
if (!forged.msgs.some(m => m.t === "full")) fail("亂編的憑證應該進不來");
ok("亂編一個憑證、用房主的暱稱：一樣進不來（暱稱不是身分）");
const ghost = player("ZZZZZZ", "x"); await ghost.joined;
if (!ghost.msgs.some(m => m.t === "gone")) fail("不存在的房號應該回 gone");
const old = player(code, "x", null, 1); await old.joined;
if (!old.msgs.some(m => m.t === "error" && m.code === "VERSION")) fail("舊版協定應該被告知要重新整理");
ok("打錯房號回「找不到」；舊版畫面連進來會被告知重新整理");

// ---------- 同一個憑證開兩個分頁 ----------
const host2 = player(code, "阿明", host.token); await host2.joined;
await sleep(200);
if (host2.seat !== 0) fail("同一個憑證應該回到 0 號座位");
if (host2.msgs.find(m => m.t === "welcome").token !== host.token) fail("重連不該換新憑證");
if (host.closed !== 4000) fail("舊分頁應該被停下來（4000）");
if (!host.msgs.some(m => m.t === "error" && m.msg.includes("別的分頁"))) fail("舊分頁應該被告知原因");
ok("同一個人開第二個分頁：新的接手，舊的被停下來並說明原因；座位、憑證不變");

// ---------- 房主離開 → 朋友變房主；新的人補位 ----------
r = await host2.cmd({ t: "leave" });
await sleep(200);
if (r.t !== "ack" || host2.closed !== 4001) fail("房主離開應該 ack 並關閉連線");
if (guest.room.host !== 1 || guest.room.status !== "WAITING" || guest.room.seats[0].taken) fail("房主離開後應該換朋友當房主、回 WAITING");
if (!guest.notices().includes("left")) fail("朋友沒收到「房主離開」");
const back = player(code, "阿明", host.token); await back.joined;
await sleep(100);
const backTok = back.msgs.find(m => m.t === "welcome")?.token;
if (!backTok || backTok === host.token || guest.room.host !== 1) fail("離開之後舊憑證應該作廢（回來只能當新的人、拿新憑證，房主也不會換回去）");
if ((await back.cmd({ t: "leave" })).t !== "ack") fail("新的人離開失敗");
await sleep(100);
ok("房主開局前離開：讓出座位、朋友變房主、房間回到等人；舊憑證作廢（拿它回來只會被當成新的人）");
const newcomer = player(code, "小華"); await newcomer.joined;
await sleep(150);
if (newcomer.seat !== 0 || guest.room.host !== 1 || guest.room.status !== "READY") fail("新的人應該補 0 號空位，房主還是朋友");
ok("新的人補空位，房主不變");

// ---------- 同時按準備：只開一場 ----------
const [ra, rb] = await Promise.all([newcomer.cmd({ t: "ready", ready: true }), guest.cmd({ t: "ready", ready: true })]);
await sleep(500);
if (ra.t !== "ack" || rb.t !== "ack") fail("同時按準備有人被拒");
const started = [newcomer, guest].map(p => p.notices().filter(n => n === "started").length);
if (started.join() !== "1,1") fail("同時按準備應該剛好開一場：" + started);
const newHands = [newcomer, guest].map(p => p.msgs.filter(m => m.t === "event" && m.e.type === "NewHand").length);
if (newHands.join() !== "1,1") fail("應該剛好發一次牌：" + newHands);
if (newcomer.room.status !== "IN_GAME" || !newcomer.room.gid || newcomer.room.gid !== guest.room.gid) fail("開局後狀態或場次編號不對");
if (!newcomer.state || newcomer.state.hand.some(c => guest.state.hand.includes(c))) fail("開局後手牌不對或外洩");
ok("兩個人同時按準備：剛好開一場、只發一次牌、兩邊同一個場次編號");

// ---------- 開打之後 ----------
const late = player(code, "遲到的人"); await late.joined;
if (!late.msgs.some(m => m.t === "full")) fail("開打後陌生人應該進不來");
r = await guest.cmd({ t: "leave" });
if (r.t !== "reject" || r.code !== "BAD_STATE") fail("對局中一般離開應該被拒（要用認輸離開）");
r = await guest.cmd({ t: "ready", ready: false });
if (r.t !== "reject") fail("對局中不能改準備");
r = await newcomer.cmd({ t: "mode", mode: "classic" });
if (r.t !== "reject") fail("對局中不能換模式");
const info1 = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
if (info1.status !== "IN_GAME" || !info1.started) fail("查房應該看得到已開打");
ok("開打之後：陌生人進不來、一般離開／改準備／換模式都被拒、查房看得到已開打");

// ---------- 頻率限制 ----------
// 本機測試：用不同的來源位址（正式環境由 Cloudflare 填，用戶端改不了）
{
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  const H = { "CF-Connecting-IP": ip };
  let blockedAt = -1;
  for (let i = 1; i <= 40; i++) {
    const res = await fetch(`${BASE}/api/rooms/Z${String(i).padStart(5, "Z").replace(/[^A-Z2-9]/g, "Z")}`, { headers: H });
    if (res.status === 429) { blockedAt = i; break; }
  }
  if (blockedAt < 0) fail("一直猜房號都沒被擋");
  const real = await fetch(`${BASE}/api/rooms/${code}`, { headers: H });
  if (real.status !== 429) fail("被擋之後連真的房號也應該先擋");
  const other = await fetch(`${BASE}/api/rooms/${code}`, { headers: { "CF-Connecting-IP": "198.51.100.3" } });
  if (other.status !== 200) fail("別的來源不應該被擋");
  ok(`猜房號：同一個來源查不到 ${blockedAt - 1} 次之後第 ${blockedAt} 次被擋（429）；別的來源不受影響；正常輸錯幾次不會被擋`);
  const ip2 = `192.0.2.${Math.floor(Math.random() * 200) + 20}`;
  let createBlocked = -1;
  for (let i = 1; i <= 40; i++) {
    const res = await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "CF-Connecting-IP": ip2 } });
    if (res.status === 429) { createBlocked = i; break; }
  }
  if (createBlocked < 0) fail("狂開房沒被擋");
  ok(`狂開房：同一個來源第 ${createBlocked} 次被擋（429）`);
}

console.log("全部通過");
process.exit(0);
