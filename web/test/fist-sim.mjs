// 拳刃交鋒：AI 對 AI 整場模擬（純邏輯，不開瀏覽器）
//   檢查：每場都會結束、兩人永遠不同格、力量 0～3、損傷不為負、紅招只在力量 ≥ 2 時出現、每個階段都有走到
//   用法：node test/fist-sim.mjs [場數]
import { Engine, PH } from "../public/fist/src/engine.js";
import { AIPlayer } from "../public/fist/src/ai.js";
import { mulberry32 } from "../public/fist/src/engine.js";

const N = Number(process.argv[2] ?? 60), STEP = 1 / 120;
const levels = ["easy", "mid", "master"];
const tally = { games: 0, rounds: 0, clash: 0, clashMode: 0, clashFirst: 0, clashWin: 0, heatDeny: 0, reveal: 0, parry: 0, roll: 0, red: 0, ko: 0, extra: 0, maxCombo: 0, phases: new Set(), wins: {}, timeoutGames: 0 };
const secs = [], secsBy = {};
const bad = [];
for (let g = 0; g < N; g++) {
  const rng = mulberry32(1000 + g);
  const la = levels[g % 3], lb = levels[Math.floor(g / 3) % 3];
  const e = new Engine({ rng });
  const bots = [new AIPlayer(0, la, rng), new AIPlayer(1, lb, rng)];
  for (const b of bots) b.attach({ view: () => e.viewFor(b.seat), input: (t, btn) => e.input(b.seat, t, btn) });
  let t = 0;
  while (e.phase !== PH.GAMEOVER && t < 600) {
    for (const b of bots) b.update(STEP);
    const evs = e.step(STEP); t += STEP;
    tally.phases.add(e.phase);
    for (const ev of evs) {
      if (ev.type === "rps_result") tally.rounds++;
      if (ev.type === "clash") tally.clash++;
      if (ev.type === "clash_start") tally.clashMode++;
      if (ev.type === "clash_first") tally.clashFirst++;
      if (ev.type === "clash_end" && ev.winner >= 0) tally.clashWin++;
      if (ev.type === "rps_result") tally.reveal++;
      if (ev.type === "deny" && ev.why === "heat") { tally.heatDeny++; bad.push(`第 ${g} 場：AI 按了過熱的鍵`); }
      if (ev.type === "rps_result" && ev.heat.some((h, i) => h && ev.stances[i] === h)) bad.push(`第 ${g} 場：出了過熱的招 ${ev.stances}／${ev.heat}`);
      if (ev.type === "parry") tally.parry++;
      if (ev.type === "roll") tally.roll++;
      if (ev.type === "red_ready") { tally.red++; }
      if (ev.type === "ko") tally.ko++;
      if (ev.type === "hit" && ev.kind === "extra") { tally.extra++; tally.maxCombo = Math.max(tally.maxCombo, ev.combo); }
    }
    const [a, b] = e.f;
    if (!a.out && !b.out && a.pos === b.pos) bad.push(`第 ${g} 場：兩人同格 ${a.pos}（${e.phase}）`);
    for (const f of e.f) { if (f.power < 0 || f.power > 3) bad.push(`第 ${g} 場：力量 ${f.power}`); if (f.damage < 0) bad.push(`第 ${g} 場：損傷 ${f.damage}`); }
    if (bad.length > 5) break;
  }
  if (e.phase !== PH.GAMEOVER) { tally.timeoutGames++; bad.push(`第 ${g} 場（${la} vs ${lb}）600 秒沒打完，停在 ${e.phase}`); }
  else { secs.push(t); const mk = [la, lb].sort().join("-"); (secsBy[mk] ??= []).push(t); tally.games++; const k = `${[la, lb][e.winner]}`; tally.wins[k] = (tally.wins[k] ?? 0) + 1; }
}
console.log(JSON.stringify({ ...tally, phases: [...tally.phases].sort() }, null, 0));
// 單場時長（遊戲時間）：目標 60～75 秒
const stat = a => { const s = [...a].sort((x, y) => x - y); return { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), median: +s[Math.floor(s.length / 2)].toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
if (secs.length) {
  console.log("單場秒數（全部）", JSON.stringify(stat(secs)), "｜每場回合", (tally.rounds / tally.games).toFixed(1), "｜每條命回合", (tally.rounds / tally.ko).toFixed(1));
  for (const [k, a] of Object.entries(secsBy).sort()) console.log(`  ${k.padEnd(12)} ${JSON.stringify(stat(a))}`);
}
if (bad.length) { console.log("問題：\n" + bad.slice(0, 10).join("\n")); process.exit(1); }
console.log("模擬全部正常");
