// C1 雙方暱稱（不開瀏覽器，用 WebSocket 直接打伺服器）
//   新入座一定要有合格暱稱（空白、太長、HTML 符號都擋）；查房看得到房主暱稱（邀請畫面用）；
//   改名只能改自己的、按了準備或開打後鎖定、同步給對方；重連帶別的名字不會改名、不會多一個玩家；
//   兩人同名照樣入座；認輸結算 → 再來一場，名字都還在
// 用法：先 npx wrangler dev，再 node test/e2e/names.mjs [http://127.0.0.1:8787]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("✗ " + m); process.exit(1); };
const ok = m => console.log("✓ " + m);
let n = 0;
function player(code, name, token = null) {
  const p = { name, seat: -1, token, room: null, msgs: [], closed: null };
  p.ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  p.joined = new Promise(res => {
    p.ws.onopen = () => p.ws.send(JSON.stringify({ t: "hello", v: 2, token, name }));
    p.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      p.msgs.push(m);
      if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
      if (m.t === "resync") { p.room = m.r; res(); }
      if (m.t === "room") p.room = m.r;
      if (["full", "gone", "error", "closed"].includes(m.t)) res();
    };
    p.ws.onclose = e => { p.closed = e.code; res(); };
  });
  p.send = o => p.ws.send(JSON.stringify(o));
  p.cmd = async o => {
    const cid = `n${++n}`, k = p.msgs.length;
    p.send({ ...o, cid });
    for (let i = 0; i < 150; i++) { const r = p.msgs.slice(k).find(m => (m.t === "ack" || m.t === "reject") && m.cid === cid); if (r) return r; await sleep(20); }
    fail("沒有回覆：" + JSON.stringify(o));
  };
  p.names = () => p.room.seats.map(s => s.name);
  return p;
}
const newRoom = async () => (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()).code;

const code = await newRoom();
// ---- 新入座一定要有合格暱稱 ----
for (const [bad, why] of [["", "空白"], ["   ", "只有空白"], [undefined, "沒帶"], ["一".repeat(17), "17 個字"], ["<img src=x>", "HTML 符號"]]) {
  const p = player(code, bad); await p.joined;
  const e = p.msgs.find(m => m.t === "error");
  if (!e || e.code !== "NAME" || p.seat >= 0) fail(`暱稱「${why}」應該被擋：${JSON.stringify(p.msgs)}`);
  await sleep(50);
}
const info0 = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
if (info0.seats.some(Boolean)) fail("被擋的人不該佔到座位");
ok("空白、只有空白、沒帶暱稱、17 個字、HTML 符號：都被擋下（說明原因），不會佔座位");

const A = player(code, "  阿明  "); await A.joined;
if (A.names()[0] !== "阿明") fail("頭尾空白應該去掉：" + A.names()[0]);
const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
if (info.host !== "阿明" || info.mode !== "classic") fail("查房應該看得到房主暱稱和玩法：" + JSON.stringify(info));
if (JSON.stringify(info).includes(A.token)) fail("查房帶了憑證");
ok(`房主「阿明」入座（頭尾空白去掉）；邀請畫面查房看得到：${JSON.stringify(info)}`);

const B = player(code, "小美"); await B.joined;
await sleep(150);
if (A.names().join() !== "阿明,小美" || B.names().join() !== "阿明,小美") fail("雙方暱稱沒同步：" + A.names() + " / " + B.names());
ok("朋友用自己的暱稱「小美」加入，兩邊都看到「阿明、小美」（不是預設名、不是房主的名字）");

// ---- 改名 ----
let r = await A.cmd({ t: "name", name: "阿明明" });
await sleep(150);
if (r.t !== "ack" || B.names()[0] !== "阿明明") fail("房主改名，朋友沒即時看到");
if (!B.msgs.some(m => m.t === "room" && m.notice === "name" && m.seat === 0)) fail("朋友沒收到改名通知");
r = await B.cmd({ t: "name", name: "小美美", seat: 0 });          // 想改別人的：伺服器只看連線本身的座位
await sleep(150);
if (r.t !== "ack" || A.names().join() !== "阿明明,小美美") fail("改名只能改自己的：" + A.names());
for (const [bad, code2] of [["", "NAME_INVALID"], ["一".repeat(17), "NAME_INVALID"], ["<b>", "NAME_INVALID"]]) {
  r = await A.cmd({ t: "name", name: bad });
  if (r.t !== "reject" || r.code !== code2) fail(`改成「${bad}」應該被拒`);
}
if (A.names()[0] !== "阿明明") fail("被拒的改名不該生效");
ok("改名：房主改「阿明明」朋友即時看到；朋友就算帶了別人的座位也只改到自己；空白／太長／HTML 被拒、名字不變");

await A.cmd({ t: "ready", ready: true });
r = await A.cmd({ t: "name", name: "準備後改名" });
if (r.t !== "reject" || r.code !== "NAME_LOCKED") fail("按了準備之後改名應該被拒");
await A.cmd({ t: "ready", ready: false });
r = await A.cmd({ t: "name", name: "阿明" });
if (r.t !== "ack") fail("取消準備之後應該可以改名");
ok("按了準備就不能改（要先取消準備）；取消之後可以改");

// ---- 重連：帶別的名字也不會改名、不會多一個玩家 ----
B.ws.close(); await sleep(200);
const B2 = player(code, "冒充的名字", B.token); await B2.joined;
await sleep(150);
if (B2.seat !== 1 || B2.names().join() !== "阿明,小美美" || A.names().join() !== "阿明,小美美") fail("重連後名字被改了：" + A.names());
if (A.room.seats.filter(s => s.taken).length !== 2) fail("重連多出一個玩家");
const third = player(code, "小美美"); await third.joined;
if (!third.msgs.some(m => m.t === "full")) fail("同名的第三人不該進得來");
ok("朋友重新整理（hello 帶了別的名字）：還是 1 號座位、還是「小美美」；沒有多一個玩家；跟她同名的第三人進不來");

// ---- 開打：名字鎖定 ----
await Promise.all([A.cmd({ t: "ready", ready: true }), B2.cmd({ t: "ready", ready: true })]);
await sleep(400);
if (A.room.status !== "IN_GAME") fail("沒開局");
r = await B2.cmd({ t: "name", name: "對局中改名" });
if (r.t !== "reject" || r.code !== "NAME_LOCKED") fail("對局中改名應該被拒");
// 認輸 → 結算 → 再來一場：名字都還在
r = await B2.cmd({ t: "leave", forfeit: true });
await sleep(200);
if (r.t !== "ack" || A.room.status !== "SETTLEMENT") fail("認輸沒結算");
r = await A.cmd({ t: "name", name: "結算時改名" });
if (r.t !== "reject" || r.code !== "NAME_LOCKED") fail("這一場結算時也不能改名");
await A.cmd({ t: "rematch", ready: true }); await B2.cmd({ t: "rematch", ready: true });
await sleep(400);
if (A.room.status !== "IN_GAME" || A.names().join() !== "阿明,小美美" || B2.names().join() !== "阿明,小美美") fail("再來一場名字不對：" + A.names());
ok("開打後、結算時改名都被拒（鎖到這一場結束）；認輸結算、再來一場之後名字都還在");

// ---- 兩人同名 ----
const code2 = await newRoom();
const X = player(code2, "小明"); await X.joined;
const Y = player(code2, "小明"); await Y.joined;
await sleep(150);
if (X.seat !== 0 || Y.seat !== 1 || X.names().join() !== "小明,小明" || X.room.host !== 0) fail("同名兩人應該都能入座（0 號是房主）");
ok("兩人都叫「小明」：照樣各自入座，房間資訊標得出誰是房主（畫面用房主／訪客分辨）");
console.log("全部通過");
process.exit(0);
