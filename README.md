# 蜜月橋牌（Unity）

雙人橋牌遊戲：先抽牌、再叫牌、最後打牌。可以跟電腦打，也可以開房找朋友連線。

- 開發規格與路線圖：[`docs/SPEC.md`](docs/SPEC.md)
- 目前進度：① 專案基準 ✅ → **② 完整對戰** ✅ → ③ 章節與介面 → ④ AI 與連線

---

## 從零開始跑起來

### 需要的東西

- Unity Hub + **Unity 6（6000.0 LTS）**
  - `ProjectSettings/ProjectVersion.txt` 寫的是 6000.0.23f1。裝的是其他 6000.0.x 也可以，Hub 問要不要換版本時按繼續
- 一套中文字型的 `.ttf`，推薦 [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)

### 步驟

1. 下載這個 repo
   ```bash
   git clone https://github.com/funcy0184-bit/bridgecard.git
   ```
2. Unity Hub › **Add › Add project from disk**，選 `bridgecard` 資料夾，用 Unity 6 打開
   - 第一次打開會照 `Packages/manifest.json` 自動安裝 Netcode for GameObjects、Multiplayer Services、uGUI、Test Framework，要等幾分鐘
   - 如果 Package Manager 說某個版本找不到，到 Window › Package Manager 把那個套件改成最新版就好
3. Window › TextMeshPro › **Import TMP Essential Resources**
4. 中文字型：把 `.ttf` 拖進 `Assets` → 右鍵 › Create › TextMeshPro › **Font Asset**
   → Project Settings › TextMeshPro › Settings，把 **Default Font Asset** 換成剛剛做的字型
   （如果 ♠♥♦♣ 顯示成方框，到那個 Font Asset 的 **Fallback Font Assets** 加一個有這些符號的字型）
5. 上方選單 **蜜月橋牌 › 一鍵建立場景**
6. 按 Play，先選「單機 vs 電腦」

> **每次拉了新版本、畫面多了按鈕或面板，都要重跑一次「一鍵建立場景」**，舊場景不會自己長出新元件（缺欄位時 Console 會報 NullReference）。

> 第一次打開後，Unity 會幫每個檔案產生 `.meta`。**把這些 `.meta` 也一起 commit**，不然換電腦打開時，場景和 prefab 會找不到腳本。

### 跟朋友連線

1. Edit › Project Settings › Services，把專案連到你的 Unity Cloud 帳號
2. 自己測試：Window › Multiplayer › Multiplayer Play Mode，開一個虛擬玩家
   - 主視窗按「開房間」，拿到代碼
   - 虛擬玩家的視窗輸入代碼，按「加入」

---

## 測試

規則和遊戲流程都在 `Logic` 資料夾，是純 C#，不需要 Unity 就能測。測試有兩種跑法，跑的是**同一份程式碼**。

### A. 在 Unity 裡跑

Window › General › **Test Runner** › EditMode › Run All

### B. 不開 Unity，用 .NET 8 跑（GitHub 每次 push 也會自動跑）

```bash
dotnet test tools/LogicTests
```

### 測試內容

| 檔案 | 檢查什麼 |
|---|---|
| `RulesTests` | 牌的編號、大牌點、叫品大小、洗牌、跟花色、比大小、王吃 |
| `GameFlowTests` | 發牌、輪流先手、抽牌 13 墩、雙 Pass 重發、定約、非莊家首攻、非法出牌只通知本人、暗牌不外洩 |
| `ScoringTests` | 規格裡的計分範例原封不動當測試（3♥ 加倍 62 分／倒 1 得 20 分）、倍率、明細文字、試算文字 |
| `AuctionTests` | 加倍只有防守方能叫、再加倍只有被加倍的莊家能叫、蓋叫清除加倍、Pass 定約、叫牌紀錄 |
| `MatchTests` | 分數累計到下一局、先到 100 分結束整場、結束後開新的一場 |
| `SimulationTests` | 大量對打，每一步都檢查下面這些不變量 |

模擬有兩種玩法：**AI**（兩邊都是電腦，接近真實對局）和 **隨機**（兩邊亂叫、亂加倍、亂出合法的牌，專門把冷門的分支跑出來）。
每種都跑 5,000 局單局 + 500 整場（打到有人 100 分）。每一步都會檢查：

- **52 張牌守恆**：手牌 + 牌堆 + 已出的牌，不多不少、不重複
- **不外洩**：雙方的畫面和收到的事件，都看不到對手的手牌和暗牌
- **擋得住**：沒跟花色、搶回合、叫比較低的叫品、不能加倍時加倍、墩滿了還出牌，全部會被拒絕
- **獨立裁判**：不靠遊戲本身的程式碼，另外判斷有沒有跟花色、誰贏這墩、每一種叫法合不合法、這局該誰得幾分，答案必須跟遊戲一樣
- **流程正確**：抽牌階段贏的人拿明牌、墩數加總是 13、贏墩的人領下一墩、一定會結束
- **帳對得起來**：每局分數加總 = 總分，只有得分方加分，到 100 分的那一刻整場結束

### 失敗時重播那一局

每一局都用固定的亂數種子（第 i 局 = `20261105 + i`），所以每次跑的結果都一樣。失敗時會印出：

```
[seed=20261187] 3♥ 加倍 拿 10 墩：應該座位 0 得 62，實際座位 0 得 64
重播：HB_SEED=20261187 HB_POLICY=AI dotnet test tools/LogicTests --filter ReplaySeed
```

複製那行指令就能只重跑那一局，用來 debug。

| 環境變數 | 用途 | 預設 |
|---|---|---|
| `HB_GAMES` | 單局模擬跑幾局 | 5000 |
| `HB_MATCHES` | 整場模擬跑幾場 | 500 |
| `HB_BASE_SEED` | 從哪個種子開始 | 20261105 |
| `HB_SEED` | 只重播這一局 | — |
| `HB_POLICY` | 重播時用 `AI` 還是 `Random` | AI |
| `HB_MATCH` | 設成 `1` = 重播整場而不是單局 | — |

```bash
HB_GAMES=50000 HB_BASE_SEED=1 dotnet test tools/LogicTests --filter Simulate
```

### 不開 Unity 先抓畫面程式的錯

畫面、連線、場景工具這些腳本要 Unity 才能編譯。為了在 GitHub 上也能先擋掉打錯字，另外有兩個檢查（push 時會自動跑）：

```bash
dotnet build tools/UnityCompileCheck
```

```bash
python3 tools/check_wiring.py
```

- `UnityCompileCheck`：用手寫的「假 Unity API」（只有型別和方法簽名）編譯全部腳本，欄位打錯、型別不合會直接報錯。它只照目前用到的 API 寫，**最後還是以 Unity Console 為準**。
- `check_wiring.py`：場景工具是用字串指定要接哪個欄位，打錯字編譯器抓不到，這支會一個一個對。

---

## 目前的規則

完整規格見 [`docs/SPEC.md`](docs/SPEC.md)。

1. 每人發 13 張，剩下 26 張是牌堆，最上面那張翻開（明牌）
2. **抽牌階段**：打 13 墩，全程無王。贏墩的人拿明牌，輸的人摸下一張暗牌。這 13 墩不計分
3. **叫牌階段**：叫品由低到高是 ♣ < ♦ < ♥ < ♠ < NT，然後才是下一線
   - 雙方一開始都 Pass → 重發，分數不變
   - 有合約之後，對手可以蓋叫、**加倍**或 Pass；被加倍的莊家可以 **再加倍**、改叫或 Pass
   - 有人蓋叫，舊合約的加倍就清掉
   - 有合約之後，只要一方 Pass 就定約
4. **打牌階段**：非莊家首攻；有首引的花色就要跟，缺門可以墊牌或出王。莊家要拿到「線數 + 6」墩
5. **計分**：打成 → 莊家得「線數 × 10 × 倍率」+ 每超 1 墩 2 分；倒約 → 防守方每倒 1 墩得「10 × 倍率」。倍率：沒加倍 ×1、加倍 ×2、再加倍 ×4
6. **整場**：每局只有得分的一方加分，先到 **100 分** 的人贏（`GameHost` 的 `targetScore` 可以改）

## 資料夾

```
Assets/HoneymoonBridge/
├─ Scripts/
│  ├─ Logic/   規則、洗牌、電腦 AI、遊戲狀態機（純 C#，自己一個 asmdef，不碰 Unity）
│  ├─ Core/    單機和連線共用的「莊家機台」，控制節奏（停頓時間在這裡調）
│  ├─ Net/     連線：開房、加入、傳畫面
│  ├─ View/    牌桌畫面、出牌飛行動畫
│  ├─ FX/      補間動畫、逐字特效、跳字、回饋導演（調手感主要改 FeedbackDirector）
│  └─ Editor/  一鍵建立場景的工具，不會打包進遊戲
└─ Tests/EditMode/   規則測試和 5,000 局模擬（Unity 和 .NET 共用）
tools/LogicTests/         不開 Unity 跑測試用的 .NET 專案
tools/UnityCompileCheck/  用假 Unity API 編譯全部腳本，先抓打錯字
tools/check_wiring.py     檢查場景工具接線的欄位名稱
docs/SPEC.md              第一版開發規格
```
