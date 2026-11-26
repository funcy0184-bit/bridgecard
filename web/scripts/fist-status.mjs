// 拳刃交鋒 STATUS.md 自動區塊更新：版本資訊、美術掛載表、核心數值快照
//   用法：node web/scripts/fist-status.mjs
//   · 只改 web/docs/fist/STATUS.md 裡 <!-- AUTO:xxx --> … <!-- /AUTO:xxx --> 之間的內容；手寫區塊（功能進度、待實測）原樣保留
//   · 美術表直接掃 web/public/fist/ 的實際 PNG（存在？尺寸對？開關開了？），不是照抄規格
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, "../public/fist");
const STATUS = path.join(HERE, "../docs/fist/STATUS.md");
const { ART, CONFIG } = await import(new URL("../public/fist/src/config.js", import.meta.url));
const { PROC_VFX } = await import(new URL("../public/fist/src/procfx.js", import.meta.url));

const git = (...args) => { try { return execFileSync("git", args, { cwd: HERE, encoding: "utf8" }).trim(); } catch { return "?"; } };
const pngSize = f => { try { const b = fs.readFileSync(f); return b.toString("ascii", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; } catch { return null; } };

// ---------- 1. 版本 ----------
const version = [
  `- 分支：\`${git("rev-parse", "--abbrev-ref", "HEAD")}\``,
  `- 最新 commit：\`${git("rev-parse", "--short", "HEAD")}\`（${git("log", "-1", "--format=%cs")}）${git("log", "-1", "--format=%s").slice(0, 60)}`,
  `- 本表產生：${new Date().toISOString().slice(0, 10)}（\`node web/scripts/fist-status.mjs\`；commit 碼是產生當下的 HEAD，本次改動的 commit 會在它之後）`,
  `- 正式站：\`feature/web-online-v1\` → https://bridgecard.funcy0184.workers.dev/fist/（部署需製作人同意）`,
].join("\n");

// ---------- 3. 美術掛載表 ----------
const rows = [];
const add = (group, file, w, h, pack, fallback) => {
  const sz = pngSize(path.join(PUB, file)), on = !pack || CONFIG.ART_PACKS?.[pack];
  let st;
  if (sz && w && (sz[0] !== w || sz[1] < h || (pack !== "vfx" && sz[1] !== h))) st = `❌ 尺寸不符（${sz[0]}×${sz[1]}，要 ${w}×${h}）`;
  else if (sz && on) st = "✅ 已接 PNG";
  else if (sz) st = `⚠️ 有 PNG，但 \`ART_PACKS.${pack}\` 還沒開`;
  else st = fallback;
  rows.push(`| ${group} | \`${file}\` | ${w}×${h} | ${st} |`);
};
const atlas = (group, A, pack, fallback) => { for (const p of ["p1", "p2"]) add(group, A.imageByPlayer[p], A.imageWidth, A.imageHeight, pack, fallback); };
atlas("角色基礎", ART.spriteAtlas, null, "❌ 缺圖（程式畫小人）");
atlas("武器變體", ART.weaponVariantAtlas, null, "❌ 缺圖（停在架式）");
atlas("拼刀加購", CONFIG.clashAtlas, null, "❌ 缺圖（借基礎動作）");
atlas("開牌／勝利", CONFIG.extraAtlas, null, "❌ 缺圖（照基礎動作）");
atlas("擴充動作 12 組", CONFIG.charExtraAtlas, CONFIG.charExtraAtlas.pack, "🎨 程式替身已運作（基礎動作＋位移形變；待補 PNG）");
add("訓練場木樁", CONFIG.dummyAtlas.imageByPlayer.p1, CONFIG.dummyAtlas.imageWidth, CONFIG.dummyAtlas.imageHeight, CONFIG.dummyAtlas.pack, "🎨 程式木人樁已運作（待補 PNG）");
for (const [key, v] of Object.entries(CONFIG.vfx)) {
  const fb = PROC_VFX[key] ? "🎨 程式特效已運作（待補 PNG）" : "❌ 缺圖（舊程式特效）";
  const sz = pngSize(path.join(PUB, v.file)), on = !v.pack || CONFIG.ART_PACKS?.[v.pack], w = v.frameW * v.frames;
  const st = sz && (sz[0] < w || sz[1] < v.frameH) ? `❌ 尺寸不符（${sz[0]}×${sz[1]}，至少 ${w}×${v.frameH}）` : sz && on ? "✅ 已接 PNG" : sz ? `⚠️ 有 PNG，但 \`ART_PACKS.${v.pack}\` 還沒開` : fb;
  rows.push(`| 特效 ${v.layer === "back" ? "後層" : "前層"} | \`${v.file}\` | ${w}×${v.frameH}（${v.frames} 格 ${v.fps}fps） | ${st} |`);
}
for (const [k, f] of Object.entries(CONFIG.uiV2.files)) {               // 視線中心 UI（尺寸以 ui_v2_spec.json 為準）
  const sz = pngSize(path.join(PUB, f)), on = CONFIG.ART_PACKS?.uiV2;
  rows.push(`| UI v2 | \`${f}\` | ${sz ? `${sz[0]}×${sz[1]}` : "待 ui_v2_spec.json"} | ${sz && on ? "✅ 已接 PNG" : sz ? "⚠️ 有 PNG，但 \`ART_PACKS.uiV2\` 還沒開" : "🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG）"} |`);
}
const missing = rows.filter(r => !r.includes("✅")).map(r => r.split("|")[2].trim()).join("、");
const art = [
  "| 類別 | 檔名 | 尺寸 | 狀態 |", "|---|---|---|---|", ...rows,
  ...Object.values(CONFIG.stageV2.files).map(f => `| 擂台 v2 | \`${f}\` | 待 stage_v2_spec.json | ${pngSize(path.join(PUB, f)) ? (CONFIG.ART_PACKS?.stageV2 ? "✅ 已接 PNG" : "⚠️ 有 PNG，但 \`ART_PACKS.stageV2\` 還沒開") : "🎨 程式繪製已運作（訓練場「雙時段擂台」開關；待補 PNG）"} |`),
  "",
  `**要請 GPT 補的圖（直接複製）：** ${missing || "（全部到齊）"}`,
  "",
  "> 🎨 的程式特效／替身只在訓練場打開「極致打擊感」開關時出現；PNG 放進 `web/public/fist/` 並把 `config.js` 的 `ART_PACKS` 對應開關改 true，就會自動換成美術圖（所有模式）。",
].join("\n");

// ---------- 4. 數值快照 ----------
const V = CONFIG.V2, C = CONFIG.combo, M = CONFIG.clashMode, R = CONFIG.resolve;
const numbers = [
  "| 項目 | 正式（v4） | 訓練場 v2.0 |", "|---|---|---|",
  `| 猜拳限時 | ${CONFIG.rps.dur}s（亮招 ${CONFIG.rps.reveal}s＋藏招 ${+(CONFIG.rps.dur - CONFIG.rps.reveal).toFixed(2)}s） | ${V.rpsDur}s，雙方鎖定 ${V.lockRevealDelay}s 後開牌 |`,
  `| 開牌停頓 | ${CONFIG.reveal.dur}s | ${V.revealDur}s |`,
  `| 單發重擊 | +${CONFIG.strike.damage}%、推 ${CONFIG.strike.push} 格、${CONFIG.strike.dur}s | +${V.strikeDamage}%、滑行、${V.strikeDur}s |`,
  `| 四套拳 | 選拳 ${C.prepDur}s → 反擊窗 ${C.reactDur}s，傷害 ${C.hitDamage.join("/")}% | 反擊窗 ${V.comboReact}s，前 3 拳原地 |`,
  `| 反擊 | +${C.counterDamage}%、頓幀 ${C.counterHitstopMs}ms | 同左＋2 幀剪影衝擊 |`,
  `| 五連斬 | 平手 ${CONFIG.CLASH_TRIGGER_TIES} 次觸發、輸入 ${M.inputDur}s、大招 +${M.winDamage}%（先手 +${M.firstBonus}%） | 同左 |`,
  `| 擊飛初速 | V = ${R.vBase} × (1 + 損傷/${R.damageDiv})，重力 ${R.gravity} | V = ${V.BASE_KNOCKBACK} × (1 + (損傷/100)^${V.kbExp} × ${V.kbMul})，重力 ${V.gravity}、空阻 ${V.airDrag} |`,
  `| KO 條件 | 落在台外 | 飛出畫面四邊（左右 ${V.koMarginX}px、上 ${V.koMarginTop}px） |`,
  `| 回場 | 無 | 下墜且水平速度 < ${V.recoverVx} → 二段跳 ${V.recoverJump} |`,
  `| 越打越快 | 每 ${CONFIG.speed.roundsPerLevel} 回合升一級，最多 Lv.${CONFIG.speed.maxLevel + 1} | 同左（猜拳限時固定） |`,
].join("\n");

// ---------- 寫回 ----------
const blocks = { version, art, numbers };
let md = fs.existsSync(STATUS) ? fs.readFileSync(STATUS, "utf8") : "";
for (const [k, body] of Object.entries(blocks)) {
  const re = new RegExp(`<!-- AUTO:${k} -->[\\s\\S]*?<!-- /AUTO:${k} -->`);
  const block = `<!-- AUTO:${k} -->\n${body}\n<!-- /AUTO:${k} -->`;
  if (!re.test(md)) { console.error(`STATUS.md 找不到 AUTO:${k} 區塊`); process.exit(1); }
  md = md.replace(re, block);
}
fs.writeFileSync(STATUS, md);
console.log(`已更新 ${path.relative(process.cwd(), STATUS)}（美術 ${rows.length} 項，其中 ${rows.filter(r => r.includes("✅")).length} 項已接 PNG）`);
