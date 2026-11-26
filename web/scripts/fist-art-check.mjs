// 拳刃交鋒 美術交付檢查：讀 public/fist/*spec*.json，核對每張 PNG 的實際尺寸
//   用法：node web/scripts/fist-art-check.mjs [資料夾]（預設 web/public/fist）
//   ✓ 相符　✗ 尺寸不符　？ 缺檔；有 ✗ 或 ？ 時結束碼為 1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/fist"));
const pngSize = f => { const b = fs.readFileSync(f); return b.toString("ascii", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };

// 從任意結構的規格 JSON 找出 { file: "*.png", width/height 或 frameWidth×frames } 的項目
function entries(node, out = []) {
  if (Array.isArray(node)) node.forEach(n => entries(n, out));
  else if (node && typeof node === "object") {
    if (typeof node.file === "string" && node.file.endsWith(".png")) {
      const w = node.width ?? node.imageWidth ?? (node.frameWidth && node.frames ? node.frameWidth * node.frames : null);
      const h = node.height ?? node.imageHeight ?? node.frameHeight ?? null;
      out.push({ file: node.file, w, h });
    }
    if (node.imageByPlayer) for (const f of Object.values(node.imageByPlayer)) out.push({ file: f, w: node.imageWidth ?? null, h: node.imageHeight ?? null });
    for (const [k, v] of Object.entries(node)) if (k !== "file" && typeof v === "string" && v.endsWith(".png") && !node.imageByPlayer) out.push({ file: v, w: null, h: null });   // 只寫檔名的引用：至少檢查存在
    for (const [k, n] of Object.entries(node)) if (k !== "preview") entries(n, out);   // 預覽圖（preview）不算遊戲素材
  }
  return out;
}

let bad = 0;
const specs = fs.readdirSync(dir).filter(f => /spec.*\.json$/.test(f)).sort();
if (!specs.length) { console.log(`在 ${dir} 找不到 *spec*.json`); process.exit(1); }
for (const s of specs) {
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(dir, s), "utf8")); } catch (e) { console.log(`\n${s}\n  ✗ JSON 格式錯誤：${e.message}`); bad++; continue; }
  const all = entries(json), list = [...new Set(all.map(e => e.file))].map(f => all.find(e => e.file === f && e.w != null) ?? all.find(e => e.file === f));
  console.log(`\n${s}（${list.length} 張）`);
  for (const e of list) {
    const p = path.join(dir, e.file);
    if (!fs.existsSync(p)) { console.log(`  ？ ${e.file} 缺檔`); bad++; continue; }
    const sz = pngSize(p);
    if (!sz) { console.log(`  ✗ ${e.file} 不是 PNG`); bad++; continue; }
    const ok = (e.w == null || sz[0] === e.w) && (e.h == null || sz[1] === e.h);
    console.log(`  ${ok ? "✓" : "✗"} ${e.file} ${sz[0]}×${sz[1]}${ok ? "" : `（規格 ${e.w}×${e.h}）`}`);
    if (!ok) bad++;
  }
}
console.log(bad ? `\n✗ ${bad} 項要處理` : "\n全部相符");
process.exit(bad ? 1 : 0);
