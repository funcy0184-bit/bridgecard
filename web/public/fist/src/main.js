// main.js — 大廳、模式切換、鍵盤 → Transport、主迴圈（Transport → 音效／畫面）
import { CONFIG } from "./config.js";
import { PH } from "./engine.js";
import { Audio } from "./audio.js";
import { Renderer } from "./renderer.js";
import { LocalTransport, AITransport, WebSocketTransport, makeRoomCode, isRoomCode } from "./transport.js";
import { Tutorial } from "./tutorial.js";

const $ = id => document.getElementById(id);
const screens = ["menu", "difficulty", "online", "game"];
function show(id) { for (const s of screens) $(s).hidden = s !== id; if (id === "game") fit(); }

const renderer = new Renderer($("screen"));
function fit() { const g = $("game"); renderer.resize(g.clientWidth, g.clientHeight - 6); }
addEventListener("resize", fit);

let mode = null, transport = null, tutorial = null, unsub = null, latest = { view: null, events: [] }, keyMap = null, opts = {};

// ---------------- 模式 ----------------
function bind(t) {
  unsub?.(); transport = t; latest = { view: null, events: [] };
  unsub = t.onStateUpdate(msg => { latest.view = msg.view; latest.events.push(...msg.events); });
  renderer.reset();
}
function startMode(m, o = {}) {
  stopMode();
  mode = m; opts = o;
  $("objective").hidden = true; $("skipTut").hidden = true; $("netStatus").hidden = true;
  if (m === "local2p") {
    keyMap = (code) => { for (const [seat, map] of CONFIG.keys.local2p.entries()) if (map[code]) return { seat, btn: map[code] }; return null; };
    renderer.setNames(CONFIG.names);
    bind(new LocalTransport({ viewer: -1 }));
    $("modeTag").textContent = "同機雙人｜P1 A/S/D　P2 J/K/L";
  } else if (m === "ai") {
    keyMap = code => (CONFIG.keys.solo[code] ? { seat: 0, btn: CONFIG.keys.solo[code] } : null);
    renderer.setNames(["玩家", CONFIG.ai[o.level].name]);
    bind(new AITransport({ difficulty: o.level }));
    $("modeTag").textContent = `單人對戰：${CONFIG.ai[o.level].name}｜A/S/D 或 ←↓→`;
  } else if (m === "tutorial") {
    keyMap = code => (CONFIG.keys.solo[code] ? { seat: 0, btn: CONFIG.keys.solo[code] } : null);
    renderer.setNames(["玩家", "陪練木人"]);
    $("modeTag").textContent = "互動教學道場｜A/S/D";
    $("skipTut").hidden = false; $("objective").hidden = false;
    tutorial = new Tutorial({
      onTransport: t => { bind(t); renderer.banner(tutorial.current.name); },
      onObjective: o => { $("objective").textContent = `${o.lesson + 1}/${o.total}｜${o.text}`; $("objective").classList.toggle("retry", o.retry); },
      onDone: skipped => { $("objective").textContent = skipped ? "已跳過教學" : "教學完成！去對戰 AI 試試身手"; setTimeout(() => { if (mode === "tutorial") { stopMode(); show("menu"); } }, skipped ? 300 : 1600); },
    });
    tutorial.start();
  } else if (m === "online") {
    keyMap = code => (CONFIG.keys.solo[code] ? { seat: 0, btn: CONFIG.keys.solo[code] } : null);
    renderer.setNames(CONFIG.names);
    const t = new WebSocketTransport({ room: o.room });
    $("netStatus").hidden = false;
    t.onStatus(s => {
      const msg = { connecting: `房號 ${o.room}：連線中…`, open: `房號 ${o.room}：等待對手…`, joined: `房號 ${o.room}：你是 P${(s.seat ?? 0) + 1}`, peer_online: "對手上線", peer_offline: "對手離線", closed: "連線中斷", error: s.msg }[s.state];
      $("netStatus").textContent = msg ?? s.state;
      if (s.state === "joined") renderer.setNames(CONFIG.names.map((n, i) => (i === s.seat ? `${n}（你）` : n)));
    });
    bind(t);
    $("modeTag").textContent = `線上對戰｜房號 ${o.room}｜A/S/D`;
  }
  show("game");
}
function stopMode() {
  unsub?.(); unsub = null;
  transport?.close(); transport = null;
  tutorial?.transport?.close(); tutorial = null;
  mode = null; latest = { view: null, events: [] };
}

// ---------------- 鍵盤 ----------------
const held = new Set();
addEventListener("keydown", e => {
  Audio.unlock();
  if (mode && e.code === "Escape") { stopMode(); show("menu"); return; }
  if (mode && e.code === "Space") { e.preventDefault(); if (latest.view?.phase === PH.GAMEOVER) startMode(mode, opts); return; }
  if (mode && e.code === "Backquote") { $("debug").hidden = !$("debug").hidden; return; }
  if (!mode || !keyMap) return;
  const k = keyMap(e.code);
  if (!k) return;
  e.preventDefault();
  if (e.repeat || held.has(e.code)) return;                     // 自動重複不算新按下（引擎也會再擋一次）
  held.add(e.code);
  renderer.keyPress(k.btn);
  (tutorial?.transport ?? transport)?.sendInput({ seat: k.seat, type: "down", btn: k.btn });
});
addEventListener("keyup", e => {
  if (!held.delete(e.code) || !keyMap) return;
  const k = keyMap(e.code);
  if (k) (tutorial?.transport ?? transport)?.sendInput({ seat: k.seat, type: "up", btn: k.btn });
});
addEventListener("blur", () => {                                // 視窗失焦：把按著的鍵都放開
  for (const code of held) { const k = keyMap?.(code); if (k) (tutorial?.transport ?? transport)?.sendInput({ seat: k.seat, type: "up", btn: k.btn }); }
  held.clear();
});

// ---------------- 主迴圈 ----------------
let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
  if (tutorial) tutorial.update(dt); else transport?.update(dt);
  if (latest.view) {
    const evs = latest.events.splice(0);
    Audio.handle(evs, latest.view);
    renderer.draw(latest.view, evs, nowMs / 1000, dt);
    if (!$("debug").hidden) $("debug").textContent = debugText(latest.view);
  }
  requestAnimationFrame(frame);
}
function debugText(v) {
  const r = v.round;
  return [`${v.phase} t=${v.t.toFixed(2)}/${v.dur}`,
    ...v.fighters.map(f => `P${f.i + 1} 格${f.pos} 氣${f.power} ${f.damage}% 命${f.stocks} 硬直${f.stun.toFixed(2)} 步${f.steps} ${f.stance ?? "-"} ${f.anim.state}`),
    r ? `攻P${r.att + 1} 贏拳${r.winGesture} 終結${r.gesture ?? "?"} 紅${r.red} 連打${r.hits}+${r.extra} ${r.type ?? ""} ${r.result ?? ""}` : "",
    `Sprite：P1 ${renderer.hasSheet(0) ? "PNG" : "程式繪製"}／P2 ${renderer.hasSheet(1) ? "PNG" : "程式繪製"}`].join("\n");
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
  else if (go === "online") show("online");
  else if (go === "menu") { stopMode(); show("menu"); }
  else if (go.startsWith("ai:")) startMode("ai", { level: go.slice(3) });
  else if (go === "create") { const code = makeRoomCode(); setRoomUrl(code); startMode("online", { room: code }); }
  else if (go === "join") joinRoom($("roomInput").value);
  else if (go === "skip") tutorial?.skip();
});
$("roomInput").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CONFIG.net.roomCodeLength); });
$("roomInput").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(e.target.value); });
function joinRoom(code) {
  code = (code ?? "").toUpperCase().trim();
  if (!isRoomCode(code)) { $("roomError").textContent = `房號是 ${CONFIG.net.roomCodeLength} 碼英數字`; return; }
  $("roomError").textContent = "";
  setRoomUrl(code); startMode("online", { room: code });
}
function setRoomUrl(code) { const u = new URL(location.href); u.searchParams.set("room", code); history.replaceState(null, "", u); $("roomLink").textContent = u.href; }

// 網址帶 ?room=XXXX：直接進那個房間
const qRoom = new URLSearchParams(location.search).get("room")?.toUpperCase();
if (qRoom && isRoomCode(qRoom)) { show("online"); $("roomInput").value = qRoom; joinRoom(qRoom); }
else show("menu");

// 驗收／除錯用
globalThis.__fist = { get view() { return latest.view; }, get transport() { return tutorial?.transport ?? transport; }, get tutorial() { return tutorial; }, startMode, stopMode, renderer, CONFIG };
