# 《拳刃交鋒》團隊規格總入口

> 這個資料夾是 **GPT（美術）、Gemini（企劃架構）、Claude（程式）** 三方共用的唯一規格來源。
> 任何人要改規則、交美術、改程式，先看這裡；看完照「交接規則」把東西推進 Git，不要只靠聊天附件（已經掉過兩次檔）。

| 文件 | 誰主寫 | 誰要讀 | 內容 |
|---|---|---|---|
| [README.md](README.md) | Claude 維護 | 全部 | 分工、分支、交接流程、資料夾地圖 |
| [game-rules.md](game-rules.md) | Gemini 定案 → Claude 同步數字 | 全部 | 目前規則（v4）、流程、所有秒數與傷害（真正數值以 `config.js` 為準） |
| [feel-plan.md](feel-plan.md) | Claude 草擬 → Gemini／製作人決策 | 全部 | **手感重規劃**：問題診斷、v5 方向、要拍板的選項、實驗步驟 |
| [event-contract.md](event-contract.md) | Claude 維護 | GPT、Gemini | 遊戲裡會發生的事件 → 角色動作 → 特效 → UI 對照（美術要做什麼、在哪一刻播） |
| [art-pipeline.md](art-pipeline.md) | Claude 定格式、GPT 照做 | GPT、Claude | 圖檔格式、檔名、JSON 規格寫法、交付與自動檢查 |

製作人（你）＝最後拍板。三個 AI 之間的意見衝突，一律寫進 `feel-plan.md` 的「待決策」表，由製作人選。

---

## 1. 分工

| 角色 | 負責 | 不碰 | 交付物 |
|---|---|---|---|
| **製作人** | 定方向、拍板、真機手感測試 | — | 決策（在待決策表打勾）、試玩回饋 |
| **Gemini：企劃架構** | 規則、節奏、數值、關卡／模式、教學內容、手感目標 | 不直接改 `src/*.js` | 改 `game-rules.md`／`feel-plan.md`（用「提案」區塊），數值表 |
| **GPT：美術** | 角色圖集、特效、場景、UI 圖、對應的 JSON 規格 | 不改程式邏輯；附帶的 JS 只當「參考」 | PNG＋`*_spec.json`，照 `art-pipeline.md` |
| **Claude：程式** | `web/public/fist/src/*`、測試、接美術、部署準備 | 不自己改規則方向（只提案） | commit、測試結果、規格同步、實測截圖 |

### 一句話交接口訣
- Gemini 改「**要什麼**」（規則、數字、感覺目標）
- GPT 改「**長怎樣**」（圖、特效、時間軸）
- Claude 改「**怎麼動**」（程式），並把前兩者的數字同步回 `config.js`

---

## 2. 分支與資料夾

| 分支 | 用途 | 誰推 |
|---|---|---|
| `feature/fist-duel-proto` | 開發主線（測試都過才推） | Claude |
| `art/<包名>`（例：`art/stage-ui-v1`） | 美術交付：GPT 產出 → 製作人推上來 | 製作人 |
| `design/<主題>`（例：`design/feel-v5`） | 企劃提案：只改 `web/docs/fist/*.md` | 製作人／Gemini |
| `feature/web-online-v1` | **正式站**（自動部署到 /fist/）；只有製作人同意才合併 | Claude（經同意） |

```
web/
├─ docs/fist/                ← 你正在看的規格
├─ public/fist/
│  ├─ index.html
│  ├─ src/                   ← 程式（Claude）
│  │  ├─ config.js           ← ★ 所有數字的唯一來源（秒數、傷害、圖集切格表）
│  │  ├─ engine.js           ← 規則（線上、AI、教學共用）
│  │  ├─ renderer.js         ← 畫面、特效、HUD
│  │  ├─ assets.js           ← 圖片預載、缺圖降級
│  │  └─ training.js …
│  ├─ *.png                  ← 美術圖（GPT）
│  └─ *_spec.json            ← 美術規格（GPT 寫、Claude 抄進 config.js）
└─ scripts/fist-art-check.mjs ← 美術交付自動檢查
```

---

## 3. 交付流程（避免檔案在聊天室掉包）

1. **GPT 產出** → 製作人把整包解壓後，路徑對齊 `web/public/fist/`，推到 `art/<包名>` 分支（或在 GitHub 網頁上傳到該分支）。
2. 在聊天裡跟 Claude 說「`art/<包名>` 好了」。
3. Claude：
   1. `node web/scripts/fist-art-check.mjs` 核對 PNG 尺寸 vs JSON（不符就回報給 GPT 改，不硬接）
   2. 合併進 `feature/fist-duel-proto`、打開 `config.js` 的 `ART_PACKS` 開關
   3. 跑測試＋從遊戲入口實際觸發、截圖
   4. 回報：掛了哪些、哪些沒驗證
4. 企劃改動同理：推 `design/<主題>`，Claude 讀完把數字同步進 `config.js`。

---

## 4. 目前狀態（2026-11）

| 項目 | 狀態 |
|---|---|
| 規則 v4（3 連勝四套拳、逐拳反擊、五連斬拼刀、過熱） | ✅ 開發分支；正式站還是舊版 |
| 訓練場（木樁沙盒、即時調秒數） | ✅ 開發分支 |
| 美術：基礎角色、武器、拼刀、開牌勝利、9 張特效 | ✅ 已掛 |
| 美術：擴充角色動作、木樁、VFX 全家桶 10 張 | ⏳ 程式已接、**圖還沒進 Git**（`ART_PACKS` 關著） |
| 美術：場景（7 格擂台、parallax、血月）、動態 UI | ⏳ 規格與圖都還沒進 Git |
| 手感 | ❌ 製作人覺得「打起來不是要的感覺」→ 見 [feel-plan.md](feel-plan.md) |
| 真機（手機）驗收 | ❌ 未做 |
