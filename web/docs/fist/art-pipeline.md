# 美術交付規格（GPT 請照這份做）

## 通用規則
- **像素圖**：PNG、RGBA、透明背景、不要半透明羽化邊（alpha 只能 0 或 255）、遊戲會用最近鄰縮放。
- **畫布**：遊戲邏輯解析度 480×270。
- **角色格**：每格 50×50（可畫範圍內縮 1px＝48×48），腳底錨點在格內 **(24, 40)**，一律**面向右**畫（程式會以錨點翻轉）。
- **角色圖集**：每列一個動作、從第 0 欄開始往右排、最多 10 欄；沒用到的格子全透明。寬 = 500，高 = 列數 × 50。
- **特效**：一張橫條，每格同尺寸，由左到右；在 JSON 寫 `frameWidth／frameHeight／frames／fps／pivotPx／layer（front 或 behind）／loop`。
- **檔名**：全小寫、底線分隔；P1／P2 用 `_p1`／`_p2`；不要空白和中文。

## 每一包一定要附 JSON 規格
檔名 `<包名>_spec.json`，放在跟 PNG 同一層（`web/public/fist/`）。最少要有：

```json
{
  "schemaVersion": "1.0",
  "sheets": {
    "fighter_p1_extra.png": { "file": "fighter_p1_extra.png", "width": 500, "height": 600, "frameWidth": 50, "frameHeight": 50, "rows": 12 }
  },
  "fighterAnimations": {
    "idle_tired": { "row": 0, "frames": 4, "fps": 7, "loop": true },
    "streak_1_hit": { "row": 3, "frames": 5, "fps": 18, "loop": false, "events": [{ "frame": 2, "event": "contactPose" }] }
  }
}
```
特效包用 `"sheets": { "vfx_xxx": { "file", "width", "height", "frameWidth", "frameHeight", "frames", "fps", "layer", "loop", "pivotPx", "anchor" } }`（參考 `vfx_mega_spec.json`）。

**命中格一定要標**（`contactPose` 或 `contactFrame`）：程式靠它把畫面對齊到真的命中時刻。

## 附帶的 JS
GPT 可以附「建議的接法」JS，但 Claude 會**逐檔比對、合併進現有程式**，不會整份覆蓋（現有程式有訓練場、線上、教學等邏輯）。附的 JS 請放在 `art-drop/<包名>/reference/`，不要直接放進 `src/`。

## 交付方式
1. 解壓後確認路徑是 `web/public/fist/...`（**不要出現兩層** `web/public/fist/web/public/fist/`）。
2. 推到 `art/<包名>` 分支（或用 GitHub 網頁「Add file → Upload files」上傳到該分支）。
3. 自己先跑檢查（有 Node 的話）：
   ```bash
   node web/scripts/fist-art-check.mjs
   ```
   會列出每個 JSON 寫到的 PNG：✓ 尺寸相符、✗ 尺寸不符、？缺檔。
4. 跟 Claude 說分支名。

## 已有的規格檔
| 檔案 | 內容 |
|---|---|
| `art_spec.json`、`ART_BIBLE.md` | 基礎角色、調色盤、擂台座標 |
| `vfx_spec.json` | 第一批特效 |
| `clash_art_spec.json` | 五連斬拼刀圖集＋大招特效 |
| `char_expansion_spec.json` | 擴充角色動作 12 組＋木樁 |
| `vfx_mega_spec.json` | 特效全家桶 10 張 |
| `stage_ui_spec.json`、`ui_motion_spec.json` | ⬜ 還沒進 Git |

（這些 JSON 在 `.assetsignore` 裡，正式站不會公開。）
