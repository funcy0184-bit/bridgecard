// main.js — 大廳、模式切換、鍵盤 → Transport、主迴圈（Transport → 音效／畫面／鍵位卡）、線上房間 UI
import { CONFIG } from "./config.js";
import { PH } from "./engine.js";
import { Audio } from "./audio.js";
import { Renderer } from "./renderer.js";
import { KeyBar } from "./keybar.js";
import { LocalTransport, AITransport, WebSocketTransport, createRoom, inviteLink, isRoomCode } from "./transport.js";
import { Tutorial } from "./tutorial.js";

const $ = id => document.getElementById(id);
const screens = ["menu", "difficulty", "online", "game"];
function show(id) { for (const s of screens) $(s).hidden = s !== id; if (id === "game") fit(); }

const renderer = new Renderer($("screen"));
const keybar = new KeyBar($("keybar"));
function fit() {
  const g = $("game"), pad = touch ? keybar.touchLayout(innerWidth, innerHeight).height : 0;
  const top = touch ? document.querySelector("#game .bar").offsetHeight : 0;   // 觸控：上排按鈕不蓋 HUD
  g.style.paddingBottom = `${pad}px`; g.style.paddingTop = `${top}px`;           // 觸控：畫布讓出按鍵區與上排按鈕
  renderer.resize(g.clientWidth, g.clientHeight - pad - top - 6);
  keybar.place($("screen"), renderer.scale);
}
addEventListener("resize", fit);

// ---------------- 觸控（手機）：鍵位卡變成按鍵 ----------------
//   粗指標裝置（手機、平板）一開就是觸控模式；桌機用手指點到也會切過去
let touch = false;
function setTouch(on) {
  if (touch === on) return;
  touch = on; keybar.setTouch(on); renderer.touch = on; document.body.classList.toggle("touch", on);
  if (!$("game").hidden) fit();
}
addEventListener("pointerdown", e => { if (e.pointerType === "touch") setTouch(true); }, { capture: true });
keybar.onInput = (seat, type, btn) => {
  Audio.unlock();
  if (type === "down") { keybar.press(seat, btn, latest.view); try { navigator.vibrate?.(8); } catch { /* 不支援震動 */ } }
  sender()?.sendInput({ seat, type, btn });
};
// 比賽結束：點畫面再來一場（線上走房間面板的 Rematch）
$("screen").addEventListener("pointerdown", () => { if (mode && mode !== "online" && latest.view?.phase === PH.GAMEOVER) startMode(mode, opts); });
const touchText = t => (touch ? t.replace(/A／S／D/g, "三顆鍵").replace(/按 A（◀）/g, "按 ◀ 左翻").replace(/按 A（石頭）/g, "按 ✊ 石頭").replace(/按 D 出『布』/g, "按 🖐️ 布").replace(/按 A 或 D/g, "按 ◀ 或 ▶") : t);
const TEAM = ["#FFF0C3", "#C6F9D8"];

// ---------------- 出招提示開關（存在這台瀏覽器；線上也只影響本機畫面） ----------------
let showHints = CONFIG.hints.default;
try { const v = localStorage.getItem(CONFIG.hints.storageKey); if (v !== null) showHints = v === "1"; } catch { /* 無痕模式 */ }
function setHints(on) {
  showHints = on; renderer.showHints = on; keybar.showHints = on;
  for (const b of document.querySelectorAll("[data-go=hints]")) { b.textContent = `出招提示：${on ? "開" : "關"}`; b.setAttribute("aria-pressed", String(on)); }
  try { localStorage.setItem(CONFIG.hints.storageKey, on ? "1" : "0"); } catch { /* 無痕模式 */ }
}
setHints(showHints);
if (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches) setTouch(true);

let mode = null, transport = null, tutorial = null, unsub = null, latest = { view: null, events: [] }, keyMap = null, opts = {};
let net = null;                                                    // 線上：{ seat, lobby, rtt, room }

// ---------------- 模式 ----------------
function bind(t) {
  unsub?.(); transport = t; latest = { view: null, events: [] };
  unsub = t.onStateUpdate(msg => { latest.view = msg.view; latest.events.push(...msg.events); });
  renderer.reset();
}
function startMode(m, o = {}) {
  stopMode();
  mode = m; opts = o;
  for (const id of ["objective", "skipTut", "room", "pauseBox", "countdown", "ping"]) $(id).hidden = true;
  const solo = code => (CONFIG.keys.solo[code] ? { seat: mode === "online" ? net?.seat ?? -1 : 0, btn: CONFIG.keys.solo[code] } : null);
  if (m === "local2p") {
    keyMap = code => { for (const [seat, map] of CONFIG.keys.local2p.entries()) if (map[code]) return { seat, btn: map[code] }; return null; };
    renderer.setNames(CONFIG.names);
    keybar.setup([0, 1].map(i => ({ seat: i, keys: CONFIG.keyLabel[i], title: CONFIG.names[i], color: TEAM[i] })));
    bind(new LocalTransport({ viewer: -1 }));
    $("modeTag").textContent = "同機雙人｜P1 A/S/D　P2 J/K/L";
  } else if (m === "ai") {
    keyMap = solo;
    renderer.setNames(["玩家", CONFIG.ai[o.level].name]);
    keybar.setup([{ seat: 0, keys: CONFIG.keyLabel[0], title: "你（A/S/D 或 ←↓→）", color: TEAM[0] }]);
    bind(new AITransport({ difficulty: o.level }));
    $("modeTag").textContent = `單人對戰：${CONFIG.ai[o.level].name}`;
  } else if (m === "tutorial") {
    keyMap = solo;
    renderer.setNames(["玩家", "陪練木人"]);
    keybar.setup([{ seat: 0, keys: CONFIG.keyLabel[0], title: "你（A/S/D）", color: TEAM[0] }]);
    $("modeTag").textContent = "互動教學道場";
    $("skipTut").hidden = false; $("objective").hidden = false;
    tutorial = new Tutorial({
      onTransport: t => { bind(t); renderer.banner(tutorial.current.name); },
      onObjective: ob => { $("objective").textContent = `${ob.lesson + 1}/${ob.total}｜${touchText(ob.text)}`; $("objective").classList.toggle("retry", ob.retry); },
      onDone: skipped => { $("objective").textContent = skipped ? "已跳過教學" : "教學完成！去對戰 AI 試試身手"; setTimeout(() => { if (mode === "tutorial") { stopMode(); show("menu"); } }, skipped ? 300 : 1600); },
    });
    tutorial.start();
  } else if (m === "online") {
    keyMap = solo;
    net = { seat: -1, lobby: null, rtt: null, room: o.room };
    renderer.setNames(CONFIG.names);
    keybar.setup([{ seat: -1, keys: CONFIG.keyLabel[0], title: "連線中…", color: "#8592A4" }]);
    $("rcCode").textContent = o.room; $("rcLink").textContent = inviteLink(o.room); $("rcMsg").textContent = "連線中…"; $("rcCopy").textContent = "📋 一鍵複製邀請連結";
    $("room").hidden = false; $("ping").hidden = false; $("ping").textContent = "-- ms"; $("rcReady").hidden = true;
    const t = new WebSocketTransport({ room: o.room });
    t.onStatus(onNet);
    bind(t);
    $("modeTag").textContent = `線上對戰｜房號 ${o.room}`;
    renderRoom();
  }
  show("game");
}
function stopMode() {
  keybar.releaseAll();
  unsub?.(); unsub = null;
  transport?.close(); transport = null;
  tutorial?.transport?.close(); tutorial = null;
  mode = null; latest = { view: null, events: [] }; net = null;
  keybar.clear();
}
function backToMenu() {
  if (mode === "online") { transport?.leave?.(); transport = null; clearRoomUrl(); }
  stopMode(); show("menu");
}

// ---------------- 線上房間 ----------------
function onNet(s) {
  if (!net) return;
  if (s.state === "connecting") $("rcMsg").textContent = "連線中…";
  else if (s.state === "reconnecting") { $("rcMsg").textContent = `連線中斷，重新連線中…（第 ${s.retry} 次）`; $("ping").textContent = "重連中"; }
  else if (s.state === "joined") {
    net.seat = s.seat; $("rcMsg").textContent = "";
    keybar.setSeat(0, s.seat); keybar.setTitle(0, `你是 P${s.seat + 1}（A/S/D）`);
  } else if (s.state === "lobby") { net.lobby = s.lobby; renderRoom(); }
  else if (s.state === "ping") { net.rtt = s.rtt; const p = $("ping"); p.textContent = `${s.rtt} ms`; p.dataset.q = s.rtt < 80 ? "good" : s.rtt < 160 ? "ok" : "bad"; }
  else if (s.state === "error") { $("rcMsg").textContent = s.msg; $("room").hidden = false; if (s.code === "no_room" || s.code === "full") $("rcReady").hidden = true; }
  else if (s.state === "closed") { $("rcMsg").textContent = s.code === 4000 ? "這個座位在別的分頁開啟了，這裡先斷線" : "連線已關閉"; $("room").hidden = false; }
}
function renderRoom() {
  const L = net?.lobby, me = net?.seat ?? -1;
  if (!L) { $("rcOver").hidden = true; for (const i of [0, 1]) $("seat" + i).textContent = `P${i + 1}　…`; $("rcHead").textContent = "連線中…"; return; }
  const st = L.status;
  $("room").hidden = !(st === "lobby" || st === "over");
  $("countdown").hidden = st !== "countdown";
  $("pauseBox").hidden = st !== "paused";
  tickRoomUi();                                                       // 倒數／斷線秒數：顯示的同一刻就填好文字，不留空白一幀
  L.seats.forEach((s, i) => {
    const el = $("seat" + i);
    el.className = `seat${s.online ? " on" : ""}${(st === "over" ? s.rematch : s.ready) ? " ready" : ""}`;
    const who = `P${i + 1} ${CONFIG.names[i].replace(/^P\d\s*/, "")}${i === me ? "（你）" : ""}`;
    const state = !s.taken ? "等待加入…" : !s.online ? "斷線中…" : st === "over" ? (s.rematch ? "想再來一局" : "結算中") : s.ready ? "READY ✔" : "準備中";
    const a = document.createElement("b"); a.textContent = who; const b = document.createElement("span"); b.textContent = state;
    el.replaceChildren(a, b);
  });
  const mine = me >= 0 ? L.seats[me] : null;
  $("rcReady").hidden = st !== "lobby" || me < 0;
  $("rcReady").querySelector("b").textContent = mine?.ready ? "取消準備" : "READY";
  $("rcReady").classList.toggle("on", !!mine?.ready);
  $("rcOver").hidden = st !== "over";
  $("rcRematch").querySelector("b").textContent = mine?.rematch ? "等對手按…" : "再來一局（Rematch）";
  let head = "";
  if (st === "over" && L.winner >= 0) head = L.winner === me ? "你贏了！" : "你輸了…";
  if (st === "over" && L.reason === "disconnect") head += L.winner === me ? "（對手斷線超過 15 秒）" : "（斷線超時）";
  if (st === "over" && L.reason === "leave" && L.winner === me) head += "（對手離開房間）";
  if (st === "lobby" && L.reason === "leave" && L.winner === me) head = "對手離開了：等新朋友加入，或再分享一次連結";
  $("rcHead").textContent = head || (L.seats.every(s => s.online) ? "兩位都到了，按 READY 開打" : "把邀請連結傳給朋友");
}
// 每幀更新：倒數 3 秒、斷線 15 秒
function tickRoomUi() {
  const L = net?.lobby;
  if (!L || !transport?.serverNow) return;
  const now = transport.serverNow();
  if (L.status === "countdown") $("countdown").textContent = String(Math.max(1, Math.ceil((L.countdownEnd - now) / 1000)));
  if (L.status === "paused") {
    const sec = Math.max(0, Math.ceil((L.pauseUntil - now) / 1000));
    $("pauseBox").textContent = L.pauseSeat === net.seat ? `重新連線中… ${sec} 秒` : `對手斷線，等待重連 ${sec} 秒...`;
  }
}
function setRoomUrl(code) { history.replaceState(null, "", inviteLink(code)); }
function clearRoomUrl() { const u = new URL(location.href); if (u.searchParams.has("room")) { u.searchParams.delete("room"); history.replaceState(null, "", u); } }
async function copyInvite() {
  const link = $("rcLink").textContent;
  try { await navigator.clipboard.writeText(link); $("rcCopy").textContent = "✅ 已複製！傳給朋友吧"; }
  catch { const r = document.createRange(); r.selectNodeContents($("rcLink")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $("rcCopy").textContent = "已選取連結，按 Ctrl+C 複製"; }
}

// ---------------- 鍵盤 ----------------
const held = new Set();
const sender = () => tutorial?.transport ?? transport;
addEventListener("keydown", e => {
  Audio.unlock();
  if (e.target instanceof HTMLInputElement) return;
  if (mode && e.code === "Escape") { backToMenu(); return; }
  if (mode && e.code === "Space") {
    e.preventDefault();
    if (latest.view?.phase === PH.GAMEOVER) { if (mode === "online") { if (net?.lobby?.status === "over") transport.rematch(); } else startMode(mode, opts); }
    return;
  }
  if (mode && e.code === "Backquote") { $("debug").hidden = !$("debug").hidden; return; }
  if (!mode || !keyMap) return;
  const k = keyMap(e.code);
  if (!k || k.seat < 0) return;
  e.preventDefault();
  if (e.repeat || held.has(e.code)) return;                     // 自動重複不算新按下（引擎也會再擋一次）
  held.add(e.code);
  keybar.press(k.seat, k.btn, latest.view);
  sender()?.sendInput({ seat: k.seat, type: "down", btn: k.btn });
});
addEventListener("keyup", e => {
  if (!held.delete(e.code) || !keyMap) return;
  const k = keyMap(e.code);
  if (k && k.seat >= 0) sender()?.sendInput({ seat: k.seat, type: "up", btn: k.btn });
});
addEventListener("blur", () => {                                // 視窗失焦：把按著的鍵都放開
  for (const code of held) { const k = keyMap?.(code); if (k && k.seat >= 0) sender()?.sendInput({ seat: k.seat, type: "up", btn: k.btn }); }
  held.clear();
});

// ---------------- 主迴圈 ----------------
let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
  if (tutorial) tutorial.update(dt); else transport?.update(dt);
  if (mode === "online") tickRoomUi();
  $("keybar").hidden = !latest.view;                              // 還沒有畫面（線上待機）時不顯示空卡
  if (latest.view) {
    const evs = latest.events.splice(0);
    Audio.handle(evs, latest.view);
    renderer.draw(latest.view, evs, nowMs / 1000, dt);
    keybar.update(latest.view);
    if (!$("debug").hidden) $("debug").textContent = debugText(latest.view);
  }
  requestAnimationFrame(frame);
}
function debugText(v) {
  const r = v.round;
  return [`${v.phase} t=${v.t.toFixed(2)}/${v.dur}`,
    ...v.fighters.map(f => `P${f.i + 1} 格${f.pos} 氣${f.power} ${f.damage}% 命${f.stocks} 硬直${f.stun.toFixed(2)} 步${f.steps} ${f.stance ?? "-"} ${f.anim.state}`),
    r ? `攻P${r.att + 1} 贏拳${r.winGesture} 終結${r.gesture ?? "?"} 紅${r.red} 連打${r.hits}+${r.extra} ${r.type ?? ""} ${r.result ?? ""}` : "",
    `Sprite：P1 ${renderer.hasSheet(0) ? "PNG" : "程式繪製"}／P2 ${renderer.hasSheet(1) ? "PNG" : "程式繪製"}`,
    net ? `線上：P${net.seat + 1}　${net.lobby?.status ?? "-"}　${net.rtt ?? "-"}ms` : ""].join("\n");
}
requestAnimationFrame(frame);

// ---------------- 大廳 ----------------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  Audio.unlock();
  const go = b.dataset.go;
  if (go === "tutorial") startMode("tutorial");
  else if (go === "difficulty") show("difficulty");
  else if (go === "local2p") startMode("local2p");
  else if (go === "online") { $("roomError").textContent = ""; show("online"); }
  else if (go === "menu") backToMenu();
  else if (go.startsWith("ai:")) startMode("ai", { level: go.slice(3) });
  else if (go === "create") createAndJoin(b);
  else if (go === "join") joinRoom($("roomInput").value);
  else if (go === "skip") tutorial?.skip();
  else if (go === "hints") { setHints(!showHints); b.blur(); }
  else if (go === "ready") { transport?.setReady?.(!net?.lobby?.seats[net.seat]?.ready); b.blur(); }
  else if (go === "rematch") { transport?.rematch?.(); b.blur(); }
  else if (go === "leave") backToMenu();
  else if (go === "copy") copyInvite();
});
async function createAndJoin(btn) {
  $("roomError").textContent = ""; btn.disabled = true;
  try { const code = await createRoom(); setRoomUrl(code); startMode("online", { room: code, host: true }); }
  catch (err) { $("roomError").textContent = err instanceof TypeError || /JSON|Unexpected|405|404|501/.test(String(err)) ? "連不上伺服器：線上對戰要用 fist-online 後端開（npx wrangler dev），見 fist-online/README.md" : err.message; }
  finally { btn.disabled = false; }
}
$("roomInput").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CONFIG.net.roomCodeLength); });
$("roomInput").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(e.target.value); });
function joinRoom(code) {
  code = (code ?? "").toUpperCase().trim();
  if (!isRoomCode(code)) { $("roomError").textContent = `房號是 ${CONFIG.net.roomCodeLength} 碼英數字（不會有 0、O、1、I）`; return; }
  $("roomError").textContent = "";
  setRoomUrl(code); startMode("online", { room: code });
}

// 網址帶 ?room=XXXX：直接進那個房間
const qRoom = new URLSearchParams(location.search).get("room")?.toUpperCase();
if (qRoom && isRoomCode(qRoom)) { $("roomInput").value = qRoom; joinRoom(qRoom); }
else show("menu");

// 驗收／除錯用
globalThis.__fist = { get view() { return latest.view; }, get transport() { return tutorial?.transport ?? transport; }, get tutorial() { return tutorial; }, get net() { return net; }, get showHints() { return showHints; }, get touch() { return touch; }, setHints, setTouch, startMode, stopMode, renderer, keybar, CONFIG };
