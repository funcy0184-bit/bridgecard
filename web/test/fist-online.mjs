// 拳刃交鋒 線上對戰：伺服器協定驗收（兩條真的 WebSocket 連到 wrangler dev）
//   先起後端：cd fist-online && npx wrangler dev --port 8790
//   再跑：node test/fist-online.mjs http://127.0.0.1:8790/ [--long]   （--long 會多跑 15 秒斷線判勝）
//   檢查：建房不重複、房號不存在／房間已滿、READY → 3 秒倒數、藏招期封包保密、連打即時轉發、
//         終結擇手勢保密、判定窗 80ms 寬容、斷線暫停與重連接續、超時判勝、Rematch、離開房間、ping
const BASE = process.argv[2] ?? "http://127.0.0.1:8790/";
const LONG = process.argv.includes("--long");
const FEW = process.argv.includes("--few-rooms");             // 打正式站時用：不連開 12 間（開房有每 10 分鐘 30 間的頻率限制）
const WS = BASE.replace(/^http/, "ws");
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function createRoom() { const r = await fetch(new URL("api/rooms", BASE), { method: "POST" }); return (await r.json()).room; }

// 一位玩家：收下所有訊息、提供等待工具
function player(room, token, name) {
  const p = { msgs: [], seat: -1, token, lobby: null, view: null, events: [], closed: false, err: null };
  p.ws = new WebSocket(`${WS}ws/${room}`);
  p.ready = new Promise((res, rej) => { p.ws.onopen = res; p.ws.onerror = rej; });
  p.emotes = [];
  p.ws.onmessage = ev => {
    const m = JSON.parse(ev.data); m._at = Date.now(); p.msgs.push(m);
    if (m.t === "welcome") { p.seat = m.seat; p.token = m.token; }
    if (m.t === "lobby") p.lobby = m;
    if (m.t === "state") { p.view = m.view; p.events.push(...m.events.map(e => ({ ...e, _phase: m.view.phase, _t: m.view.t }))); }
    if (m.t === "error") p.err = m;
    if (m.t === "emote") p.emotes.push(m);
  };
  p.ws.onclose = ev => { p.closed = true; p.closeCode = ev.code; };
  p.send = o => p.ws.send(JSON.stringify(o));
  p.join = async () => { await p.ready; p.send({ t: "join", token: p.token, name }); await until(() => p.seat >= 0 || p.err); };
  p.tap = async (btn, hold = 30) => { p.send({ t: "input", type: "down", btn }); await sleep(hold); p.send({ t: "input", type: "up", btn }); };
  return p;
}
async function until(cond, ms = 8000, step = 5) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await sleep(step); } return true; }
const phaseIs = (p, ph) => () => p.view?.phase === ph;

console.log("建立房間");
const codes = await Promise.all(Array.from({ length: FEW ? 2 : 12 }, createRoom));
ok(codes.every(c => /^[A-HJ-NP-Z2-9]{4}$/.test(c)), `房號都是 4 碼、不含 0/O/1/I（${codes.slice(0, 4).join(" ")} …）`);
ok(new Set(codes).size === codes.length, `連開 ${codes.length} 間：房號不重複`);

console.log("房號不存在／房間已滿");
{
  const x = player("ZZZZ"); await x.ready; await until(() => x.err || x.closed);
  ok(x.err?.code === "no_room", `不存在的房號：${x.err?.msg}`);
}
const room = await createRoom();
const A = player(room, null, "阿鋒"), B = player(room, null, "<b>翠嵐\u202E超長名字超長名字\u0000</b>");
await A.join(); await B.join();
ok(A.seat === 0 && B.seat === 1 && A.token && B.token, `房主入座 P1、朋友入座 P2（房號 ${room}）`);
{
  const C = player(room); await C.join();
  ok(C.err?.code === "full", `第三人：${C.err?.msg}`);
}

console.log("READY → 3 秒倒數 → 開打");
await until(() => A.lobby?.seats.every(s => s.online));
ok(A.lobby.status === "lobby" && A.lobby.seats.every(s => s.online && !s.ready), "待機：兩人在線、都還沒準備");
A.send({ t: "ready", on: true }); await sleep(150);
ok(A.lobby.status === "lobby" && B.lobby.seats[0].ready, "P1 按 READY：P2 畫面看得到");
B.send({ t: "ready", on: true });
await until(() => A.lobby?.status === "countdown");
const cd = A.lobby.countdownEnd - A.lobby.serverTime;
ok(A.lobby.status === "countdown" && Math.abs(cd - 3000) < 50, `雙方 READY：倒數 ${cd}ms`);
B.send({ t: "ready", on: false }); await sleep(120);
ok(A.lobby.status === "lobby", "倒數中有人取消 READY：回到待機");
B.send({ t: "ready", on: true });
const t0 = Date.now();
await until(phaseIs(A, "PHASE_RPS"), 6000);
ok(A.view?.phase === "PHASE_RPS" && Date.now() - t0 >= 2900, `倒數 3 秒後開打：直接進猜拳（${Date.now() - t0}ms）`);
const st = A.msgs.filter(m => m.t === "state").at(-1);
ok(typeof st.serverTime === "number" && st.phaseEndTime > st.serverTime, `state 附 serverTime／phaseEndTime（剩 ${st.phaseEndTime - st.serverTime}ms）`);

console.log("輸入只在對戰中收");
A.send({ t: "input", type: "down", btn: "X" }); A.send({ t: "nonsense" }); A.ws.send("{bad json");
await sleep(50);
ok(!A.closed && !B.closed, "壞封包被忽略、連線不斷");

console.log("猜拳：亮招即時轉發、藏招絕不轉發");
await until(() => A.view?.phase === "PHASE_RPS" && A.view.t > 0.05, 4000);
await sleep(150); await B.tap("R");                                  // 亮招期：P2 擺布
await until(() => A.events.some(e => e.type === "stance" && e.p === 1));
const pub = A.events.find(e => e.type === "stance" && e.p === 1);
ok(pub?.gesture === "paper" && A.view.fighters[1].stance === "paper", "亮招期（前 2.2 秒）：P2 擺『布』即時轉給 P1 播前搖");
await A.tap("L");                                                     // P1 先擺石頭
await until(() => A.view.phase === "PHASE_RPS" && A.view.t >= A.view.reveal + 0.05, 4000);
const before = A.events.length;
await B.tap("M");                                                     // 藏招期：P2 偷換剪刀
await sleep(60); await A.tap("L");
await until(() => A.events.some(e => e.type === "rps_result"), 3000);
const hiddenLeak = A.events.slice(before).filter(e => e.type === "stance" && e.p === 1);
const viewsDuringHidden = A.msgs.filter(m => m.t === "state" && m.view.phase === "PHASE_RPS" && m.view.t >= m.view.reveal);
ok(hiddenLeak.length === 0, "最後 0.6 秒藏招：P2 換招的 stance 事件沒有送到 P1");
ok(viewsDuringHidden.length > 0 && viewsDuringHidden.every(m => m.view.fighters[1].stance === "hidden" && m.view.fighters[1].anim.state !== "stance_scissors"), `藏招期 P1 收到的 ${viewsDuringHidden.length} 張畫面，P2 一律是 hidden`);
const rawLeak = A.msgs.filter(m => m.t === "state" && m.view.phase === "PHASE_RPS" && m.view.t >= m.view.reveal).some(m => JSON.stringify(m).includes("scissors"));
ok(!rawLeak, "藏招期 P1 收到的原始封包裡完全找不到「scissors」");
const res = A.events.find(e => e.type === "rps_result");
ok(res && res.stances[1] === "scissors" && res.winner === 0, `鎖定結算才一起公佈：P1 石頭 vs P2 剪刀 → P1 贏（${res?.stances}）`);

console.log("連打：伺服器數按鍵、即時轉發守方");
await until(() => A.msgs.some(m => m.t === "state" && m.view.phase === "PHASE_REVEAL"), 3000);
ok(A.msgs.some(m => m.t === "state" && m.view.phase === "PHASE_REVEAL" && m.view.rps?.winner === 0), "開牌停頓：雙方都收到結果（P1 石頭壓制剪刀）");
await until(phaseIs(A, "PHASE_MASH"), 2000);
ok(A.view.fighters[0].heat === "rock" && B.view.fighters[0].heat === "rock" && A.view.fighters[1].heat === "scissors", "過熱同步：雙方都看得到 P1 禁用石頭、P2 禁用剪刀");
for (let i = 0; i < 14; i++) await A.tap(["L", "M", "R"][i % 3], 12);
await until(() => B.events.some(e => e.type === "mash_end"), 2000);
const extras = B.events.filter(e => e.type === "hit" && e.kind === "extra");
ok(extras.length === 4, `守方即時收到 ${extras.length} 次追加命中（狂按 14 下，伺服器卡在上限 4）`);
const end = B.events.find(e => e.type === "mash_end");
ok(end?.extra === 4 && end.combo === 6, `連打結算：保底 2 ＋ 追加 4 = ${end?.combo} HIT`);
const dmg = B.view.fighters[1].damage;

console.log("終結擇保密 → 判定窗延遲寬容");
await until(phaseIs(A, "PHASE_FINISHER_SELECT"), 2000);
await A.tap("R");                                                     // 攻方短按：普通終結改成布
await sleep(80);
ok(B.view.round.gesture === null && !B.events.some(e => e.type === "finisher_pick"), "守方在終結擇看不到攻方選了什麼");
await until(phaseIs(B, "PHASE_FINISHER_WINDOW"), 2000);
ok(B.view.round.gesture === "paper" && B.view.round.type === "blue", "判定窗亮起：手勢公開（布）");
// 等到 0.5 秒倒數走完之後才按（模擬玩家在畫面內按到、封包晚 ~40ms 才到）
const w = B.msgs.filter(m => m.t === "state" && m.view.phase === "PHASE_FINISHER_WINDOW")[0];
await sleep(Math.max(0, w.phaseEndTime - w.serverTime + 25));
B.send({ t: "input", type: "down", btn: "M" });                       // 剪刀剋布
await until(() => B.events.some(e => ["parry", "timeout", "wrong"].includes(e.type)), 2000);
B.send({ t: "input", type: "up", btn: "M" });
ok(B.events.some(e => e.type === "parry" && e.p === 1), "倒數歸零後 ~25ms 抵達的正確按鍵：伺服器寬容 80ms，判定彈反成功");
await until(() => A.view.fighters[0].damage === 10, 2000);                 // 原攻方的畫面隔一個網路延遲才到
ok(A.view.fighters[0].damage === 10 && B.view.fighters[1].damage === dmg, `反擊 +10%（P1 ${A.view.fighters[0].damage}%）`);

console.log("暱稱、表情、房主設定");
{
  const names = A.lobby.seats.map(s => s.name);
  ok(names[0] === "阿鋒", `P1 暱稱：${names[0]}`);
  ok(names[1] === "b翠嵐超長名字超" && [...names[1]].length === 8 && !/[<>\u202E\u0000]/.test(names[1]), `P2 暱稱清洗：去掉 <> 與方向／控制字元、最多 8 個字（「${names[1]}」）`);
  A.send({ t: "emote", i: 2 }); A.send({ t: "emote", i: 3 });            // 第二個在 1.5 秒內：丟掉
  B.send({ t: "emote", i: 99 }); B.send({ t: "emote", i: "x" });
  await sleep(200);
  ok(B.emotes.length === 1 && B.emotes[0].seat === 0 && B.emotes[0].i === 2, "表情：轉給對手；1.5 秒內連發只算一次；不在清單上的丟掉");
  ok(A.emotes.length === 1, "發的人自己也收到（畫面上自己頭頂也冒泡）");
  const before = A.lobby.settings?.guide;
  B.send({ t: "settings", guide: !before }); await sleep(120);
  ok(A.lobby.settings.guide === before, "非房主不能改新手引導設定");
}

console.log("拼刀：伺服器保密序列、只廣播格數與先手");
{
  const rc = await createRoom(), X = player(rc), Y = player(rc);
  await X.join(); await Y.join();
  X.send({ t: "ready", on: true }); Y.send({ t: "ready", on: true });
  await until(() => X.view?.phase === "PHASE_RPS" && X.view.t > 0.1, 6000);
  await X.tap("R"); await Y.tap("R");                                  // 布對布：平手
  await until(phaseIs(X, "PHASE_CLASH_INPUT"), 6000);
  ok(X.view?.phase === "PHASE_CLASH_INPUT", "線上平手 → 拼刀預輸入");
  const mark = Y.msgs.length;
  await X.tap("M", 15); await X.tap("M", 15); await X.tap("L", 15);    // X 先填完：剪 剪 石
  await until(() => Y.events.some(e => e.type === "clash_first"), 2000);
  const ymsgs = Y.msgs.slice(mark).filter(m => m.t === "state");
  ok(Y.events.some(e => e.type === "clash_first" && e.p === 0) && ymsgs.some(m => m.view.clash?.count[0] === 3 && m.view.clash.first === 0), "對手收到：P1 填滿 3 格、搶到 ⚡ 先手");
  ok(ymsgs.length > 0 && ymsgs.every(m => m.view.phase !== "PHASE_CLASH_INPUT" || m.view.clash.seq[0] === null) && !ymsgs.filter(m => m.view.phase === "PHASE_CLASH_INPUT").some(m => m.events.some(e => e.type === "clash_pick")), "預輸入期間對手收到的封包裡沒有 P1 的序列內容");
  ok(X.view.clash.seq[0]?.join() === "scissors,scissors,rock", "自己看得到自己填了什麼");
  await Y.tap("L", 15); await Y.tap("L", 15); await Y.tap("L", 15);
  await until(phaseIs(Y, "PHASE_CLASH_ANIM"), 2000);
  ok(Y.view.clash.seq[0]?.join() === "scissors,scissors,rock", "雙方填完 → 對砍：序列全公開");
  X.ws.close(); Y.ws.close();
}

console.log("ping");
A.send({ t: "ping", c: 123 });
await until(() => A.msgs.some(m => m.t === "pong" && m.c === 123));
ok(A.msgs.some(m => m.t === "pong" && m.c === 123 && typeof m.s === "number"), "pong 回傳伺服器時間");

console.log("斷線：暫停 → 重連無縫接續");
await until(() => A.view?.phase === "PHASE_RPS" && A.view.t > 0.05, 6000);
const snap = { ...A.view.fighters[1] }, tokenB = B.token;
B.ws.close();
await until(() => A.lobby?.status === "paused");
ok(A.lobby.status === "paused" && A.lobby.pauseSeat === 1 && Math.abs(A.lobby.pauseUntil - A.lobby.serverTime - 15000) < 100, "對手斷線：暫停、倒數 15 秒等重連");
const nStates = A.msgs.filter(m => m.t === "state").length;
await sleep(400);
ok(A.msgs.filter(m => m.t === "state").length === nStates, "暫停中伺服器不推進遊戲");
A.send({ t: "input", type: "down", btn: "L" }); A.send({ t: "input", type: "up", btn: "L" });
const B2 = player(room, tokenB); await B2.join();
await until(() => B2.view && A.lobby?.status === "playing");
ok(B2.seat === 1 && A.lobby.status === "playing", "帶原本的 token 回來：回到 P2、對戰繼續");
ok(B2.view.fighters[1].damage === snap.damage && B2.view.fighters[1].stocks === snap.stocks, `狀態接續（P2 損傷 ${B2.view.fighters[1].damage}%、${B2.view.fighters[1].stocks} 命）`);
ok(A.view.fighters[0].stance === null && !A.view.fighters[0].picked, "暫停時送的按鍵不算");

if (LONG) {
  console.log("斷線超過 15 秒：留在房內的人獲勝");
  B2.ws.close();
  await until(() => A.lobby?.status === "over", 17000, 50);
  ok(A.lobby.status === "over" && A.lobby.winner === 0 && A.lobby.reason === "disconnect", "超時：P1 判勝");
  ok(A.view.phase === "PHASE_GAMEOVER" && A.view.winner === 0, "畫面進比賽結束");
  console.log("再來一局（Rematch）");
  const B3 = player(room); await B3.join();
  ok(B3.seat === 1 && A.lobby.status === "over", "朋友重新加入：房間還在結算畫面");
  A.send({ t: "rematch" }); await sleep(120);
  ok(A.lobby.status === "over" && B3.lobby.seats[0].rematch, "只有一方按 Rematch：等另一位");
  B3.send({ t: "rematch" });
  await until(() => A.lobby?.status === "countdown");
  ok(A.lobby.status === "countdown", "雙方都按 Rematch：原地倒數重開");
  await until(phaseIs(B3, "PHASE_RPS"), 6000);
  ok(B3.view?.phase === "PHASE_RPS" && B3.view.fighters.every(f => f.stocks === 3 && f.damage === 0), `新的一場：3 命、0%（${JSON.stringify(B3.view?.fighters.map(f => [f.stocks, f.damage]))} ${B3.view?.phase}）`);
  B3.ws.close();
} else console.log("  （略過 15 秒斷線判勝：加 --long 才跑）");

console.log("離開房間／再來一局");
{
  const r2 = await createRoom(), P = player(r2), Q = player(r2);
  await P.join(); await Q.join();
  P.send({ t: "ready", on: true }); Q.send({ t: "ready", on: true });
  await until(phaseIs(P, "PHASE_RPS"), 6000);
  Q.send({ t: "leave" });
  await until(() => P.lobby?.winner === 0, 3000);
  ok(P.lobby.winner === 0 && P.lobby.reason === "leave" && !P.lobby.seats[1].taken, "對戰中離開：對手判勝、座位空出");
  ok(P.view.phase === "PHASE_GAMEOVER", "畫面進比賽結束");
  const R = player(r2); await R.join();
  ok(R.seat === 1, "新朋友可以坐進空出的 P2");
  P.send({ t: "ready", on: true }); R.send({ t: "ready", on: true });
  await until(phaseIs(R, "PHASE_RPS"), 6000);
  ok(R.view?.phase === "PHASE_RPS", "原房間直接再開一場（免重建房）");
}
{
  const r3 = await createRoom(), P = player(r3), Q = player(r3);
  await P.join(); await Q.join();
  P.send({ t: "ready", on: true }); Q.send({ t: "ready", on: true });
  await until(phaseIs(P, "PHASE_RPS"), 6000);
  Q.send({ t: "rematch" }); await sleep(100);
  ok(P.lobby.status === "playing" && !P.lobby.seats[1].rematch, "對戰中按 Rematch 無效");
  P.ws.close(); Q.ws.close();
}

for (const p of [A, B2]) try { p.ws.close(); } catch {}
console.log(fails ? `\n✗ ${fails} 項沒過` : "\n全部通過");
process.exit(fails ? 1 : 0);
