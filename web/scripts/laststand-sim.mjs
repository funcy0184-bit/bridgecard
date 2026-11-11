// 《逆命賭局》平衡模擬報告：npm run sim:laststand [每組場數，預設 2000]
// 把 src/laststand/sim.ts 打包成暫存檔再執行；結果印出來，也寫進 docs/laststand-p0-sim.md
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const N = Number(process.argv[2] ?? 2000);
const dir = mkdtempSync(join(tmpdir(), "ls-sim-"));
const out = join(dir, "sim.mjs");
await build({ entryPoints: ["src/laststand/sim.ts"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
const { runPair } = await import(pathToFileURL(out).href);


const names = ["balanced", "conservative", "aggressive", "bluffer", "hoarder", "random"];
const label = n => ({ conservative: "保守", aggressive: "激進加注", random: "隨機", bluffer: "唬牌", hoarder: "保留極端", balanced: "平衡" })[n];
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "—");
const t0 = Date.now();
const pairs = [];
for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) pairs.push(runPair(names[i], names[j], N, i * 10 + j + 1));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const total = pairs.reduce((s, p) => s + p.n, 0);
const L = [];
L.push(`# 逆命賭局 P0 平衡模擬`, ``, `每組 ${N} 場（座位輪流換、第 1 墩宣戰權擲硬幣），共 ${total} 場，${secs} 秒。每一步都檢查 30 枚守恆，沒有任何一場卡住或出現不合法動作。`, ``);

// 1. 勝率矩陣
L.push(`## 1. 勝率（列對行：列的勝率／平手率）`, ``);
L.push(`| | ${names.map(label).join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
for (const a of names) {
  const cells = names.map(b => {
    const p = pairs.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    const win = p.a === a ? p.winA : p.winB;
    return a === b ? `（自己）平 ${pct(p.draw, p.n)}` : `${pct(win, p.n)}／平 ${pct(p.draw, p.n)}`;
  });
  L.push(`| **${label(a)}** | ${cells.join(" | ")} |`);
}
L.push(``);

// 2. 每組節奏
L.push(`## 2. 每場平均（加注＝首次加注；梭哈＝第 7–9 墩加到上限）`, ``);
L.push(`| 對戰 | 加注 | 反加 | 棄牌 | 梭哈 | 梭哈被接 | 同點 | 保命 | 讀心 | 翻轉 | 第 9 墩前結束 |`, `|---|---|---|---|---|---|---|---|---|---|---|`);
const f1 = x => x.toFixed(2);
for (const p of pairs) L.push(`| ${label(p.a)} vs ${label(p.b)} | ${f1(p.avg.raises)} | ${f1(p.avg.reraises)} | ${f1(p.avg.folds)} | ${f1(p.avg.allIns)} | ${f1(p.avg.allInCalled)} | ${f1(p.avg.ties)} | ${f1(p.avg.safeguards)} | ${f1(p.avg.insights)} | ${f1(p.avg.flips)} | ${pct(p.early, p.n)} |`);
L.push(``);

// 3. 提前結束
const early = pairs.reduce((s, p) => s + p.early, 0);
const endT = Array(10).fill(0); for (const p of pairs) p.endTrick.forEach((v, i) => endT[i] += v);
const human = pairs.filter(p => p.a !== "random" && p.b !== "random");
const hn = human.reduce((s, p) => s + p.n, 0);
const hEnd = Array(10).fill(0); for (const p of human) p.endTrick.forEach((v, i) => hEnd[i] += v);
L.push(`## 3. 第 9 墩前就結束的比例`, ``, `全部：${pct(early, total)}；不含隨機型：${pct(human.reduce((s, p) => s + p.early, 0), hn)}`, ``,
  `不含隨機型，結束在：第 4–6 墩 ${pct(hEnd[4] + hEnd[5] + hEnd[6], hn)}、第 7–8 墩 ${pct(hEnd[7] + hEnd[8], hn)}、打滿 9 墩 ${pct(hEnd[9], hn)}`, ``,
  `（逐墩：${hEnd.map((v, i) => i ? `第${i}墩 ${pct(v, hn)}` : null).filter(Boolean).join("、")}）`, ``);

// 4. 中間牌
const card = {}; for (const p of human) for (const [k, v] of Object.entries(p.cardNet)) { const c = (card[k] ??= { n: 0, win: 0, net: 0 }); c.n += v.n; c.win += v.win; c.net += v.net; }
const catName = ["小（2–6）", "中（7–10）", "大（J–A）"];
L.push(`## 4. 鎖哪一類的牌：贏墩率與每次平均淨籌碼（不含隨機型）`, ``, `| 方向 | 分類 | 次數 | 贏墩率 | 平均淨籌碼 |`, `|---|---|---|---|---|`);
for (const d of ["high", "low"]) for (const c of [2, 1, 0]) { const v = card[`${d}:${c}`] ?? { n: 0, win: 0, net: 0 }; L.push(`| ${d === "high" ? "比大" : "比小"} | ${catName[c]} | ${v.n} | ${pct(v.win, v.n)} | ${(v.net / (v.n || 1)).toFixed(2)} |`); }
const midAll = ["high", "low"].map(d => card[`${d}:1`]).reduce((s, v) => ({ n: s.n + v.n, win: s.win + v.win, net: s.net + v.net }), { n: 0, win: 0, net: 0 });
L.push(``, `中間牌合計：贏墩率 ${pct(midAll.win, midAll.n)}、平均淨籌碼 ${(midAll.net / midAll.n).toFixed(2)}`, ``);

// 5. 固定加注
const agg = pairs.filter(p => (p.a === "aggressive") !== (p.b === "aggressive"));
L.push(`## 5. 固定加注（激進加注型：能加就加到上限、從不棄牌）對每種策略`, ``);
for (const p of agg) { const isA = p.a === "aggressive"; const w = isA ? p.winA : p.winB; const o = isA ? p.b : p.a; L.push(`- 對 ${label(o)}：勝 ${pct(w, p.n)}、平 ${pct(p.draw, p.n)}`); }
L.push(``);

// 6. 先手／宣戰權
const mirror = pairs.filter(p => p.a === p.b);
const coinW = mirror.reduce((s, p) => s + p.coinWins, 0), coinD = mirror.reduce((s, p) => s + p.coinDecided, 0);
const role = human.reduce((s, p) => ({ d: s.d + p.roleNet.declarer, f: s.f + p.roleNet.firstBettor }), { d: 0, f: 0 });
const tricksPlayed = human.reduce((s, p) => s + p.endTrick.reduce((a, v, i) => a + v * i, 0), 0);
L.push(`## 6. 先手與宣戰權`, ``,
  `同策略對打（排除平手）：第 1 墩拿宣戰權的座位（共 5 次宣戰權、4 次下注先手）勝率 ${pct(coinW, coinD)}`, ``,
  `每墩平均淨籌碼（不含隨機型，${tricksPlayed} 墩）：宣戰權方 ${(role.d / tricksPlayed).toFixed(3)}、下注先手方 ${(role.f / tricksPlayed).toFixed(3)}（兩者相加 ${((role.d + role.f) / tricksPlayed).toFixed(3)}，應為 0；疊池裡的錢算回各自出資）`, ``);
for (const p of mirror) L.push(`- ${label(p.a)} 對自己：宣戰權座位勝 ${pct(p.coinWins, p.coinDecided)}`);
L.push(``);

// 7. 梭哈逆轉
const b7 = pairs.reduce((s, p) => s + p.behind7, 0), cb = pairs.reduce((s, p) => s + p.comeback, 0), aicb = pairs.reduce((s, p) => s + p.allInComeback, 0);
const hb7 = human.reduce((s, p) => s + p.behind7, 0), hcb = human.reduce((s, p) => s + p.comeback, 0), haicb = human.reduce((s, p) => s + p.allInComeback, 0);
L.push(`## 7. 逆轉（第 7 墩開始時落後，最後贏）`, ``,
  `全部：第 7 墩有人落後 ${pct(b7, total)} 的場次；其中逆轉 ${pct(cb, b7)}；逆轉裡靠贏下被接戰的梭哈 ${pct(aicb, cb)}`, ``,
  `不含隨機型：第 7 墩有人落後 ${pct(hb7, hn)}；其中逆轉 ${pct(hcb, hb7)}；靠梭哈 ${pct(haicb, hcb)}`, ``);
for (const p of human) L.push(`- ${label(p.a)} vs ${label(p.b)}：落後 ${p.behind7} 場、逆轉 ${pct(p.comeback, p.behind7)}、其中靠梭哈 ${pct(p.allInComeback, p.comeback)}`);
// 8. 底注／上限的調整選項（只跑「像人」的策略：平衡、保守、激進加注、保留極端；各組 N 場）
const VARIANTS = [
  { name: "A 企劃書（1/3、2/6、3/梭哈）", stages: [{ ante: 1, cap: 3 }, { ante: 2, cap: 6 }, { ante: 3, cap: -1 }] },
  { name: "B 中段上限降到 4（1/3、2/4、3/梭哈）", stages: [{ ante: 1, cap: 3 }, { ante: 2, cap: 4 }, { ante: 3, cap: -1 }] },
  { name: "C 中段底注 1、上限 4（1/3、1/4、3/梭哈）", stages: [{ ante: 1, cap: 3 }, { ante: 1, cap: 4 }, { ante: 3, cap: -1 }] },
];
const core = ["balanced", "conservative", "aggressive", "hoarder"];
L.push(`## 8. 底注／上限調整選項比較（平衡、保守、激進加注、保留極端互打，每組 ${N} 場）`, ``,
  `| 選項 | 第 4–6 墩就結束 | 第 7–8 墩結束 | 打滿 9 墩 | 第 7 墩落後者逆轉 | 逆轉靠梭哈 | 每場加注 | 每場棄牌 | 激進加注對平衡勝率 |`, `|---|---|---|---|---|---|---|---|---|`);
for (const v of VARIANTS) {
  const ps = [];
  for (let i = 0; i < core.length; i++) for (let j = i; j < core.length; j++) ps.push(runPair(core[i], core[j], N, 900 + i * 10 + j, v.stages));
  const n = ps.reduce((s, p) => s + p.n, 0);
  const e = Array(10).fill(0); for (const p of ps) p.endTrick.forEach((x, i) => e[i] += x);
  const b7v = ps.reduce((s, p) => s + p.behind7, 0), cbv = ps.reduce((s, p) => s + p.comeback, 0), aiv = ps.reduce((s, p) => s + p.allInComeback, 0);
  const avg = k => (ps.reduce((s, p) => s + p.avg[k] * p.n, 0) / n).toFixed(2);
  const ab = ps.find(p => p.a === "balanced" && p.b === "aggressive");
  L.push(`| ${v.name} | ${pct(e[4] + e[5] + e[6], n)} | ${pct(e[7] + e[8], n)} | ${pct(e[9], n)} | ${pct(cbv, b7v)} | ${pct(aiv, cbv)} | ${avg("raises")} | ${avg("folds")} | ${pct(ab.winB, ab.n)} |`);
}
L.push(``, `註：AI 是固定規則的機器人，不會累、不會怕；真人的棄牌率、唬牌成功率會不一樣。這裡看的是「規則結構」有沒有明顯漏洞，數字要等 P4 真人試玩再校正。`);
const md = L.join("\n") + "\n";
mkdirSync("docs", { recursive: true });
writeFileSync("docs/laststand-p0-sim.md", md);
console.log(md);

