# 蜜月橋牌（Unity）

雙人橋牌遊戲：先抽牌、再叫牌、最後打牌。可以跟電腦打，也可以開房找朋友連線。

- 開發規格與路線圖：[`docs/SPEC.md`](docs/SPEC.md)
- 目前進度：**① 專案基準** ✅（② 完整對戰 → ③ 章節與介面 → ④ AI 與連線）

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
| `SimulationTests` | 5,000 局電腦對打。每一步都檢查下面這些不變量 |

5,000 局模擬每一步都會檢查：

- **52 張牌守恆**：手牌 + 牌堆 + 已出的牌，不多不少、不重複
- **不外洩**：雙方的畫面和收到的事件，都看不到對手的手牌和暗牌
- **擋得住**：沒跟花色、搶回合、叫比較低的叫品、墩滿了還出牌，全部會被拒絕
- **獨立裁判**：不靠遊戲本身的規則程式，另外判斷有沒有跟花色、誰贏這墩，兩邊答案必須一樣
- **流程正確**：抽牌階段贏的人拿明牌、墩數加總是 13、贏墩的人領下一墩、一定會結束

### 失敗時重播那一局

每一局都用固定的亂數種子（第 i 局 = `20261105 + i`），所以每次跑的結果都一樣。失敗時會印出：

```
[seed=20261187] 手上有 ♠ 卻出了 ♥3，沒有跟花色
重播這一局：HB_SEED=20261187 dotnet test tools/LogicTests --filter ReplaySeed
```

複製那行指令就能只重跑那一局，用來 debug。

| 環境變數 | 用途 | 預設 |
|---|---|---|
| `HB_GAMES` | 模擬幾局 | 5000 |
| `HB_BASE_SEED` | 從哪個種子開始 | 20261105 |
| `HB_SEED` | 只重播這一局 | — |

```bash
HB_GAMES=50000 HB_BASE_SEED=1 dotnet test tools/LogicTests --filter Simulate
```

---

## 目前的規則（v0，計分和加倍在 ② 加上）

1. 每人發 13 張，剩下 26 張是牌堆，最上面那張翻開（明牌）
2. **抽牌階段**：打 13 墩，全程無王。贏墩的人拿明牌，輸的人摸下一張暗牌。這 13 墩不計分
3. **叫牌階段**：叫品由低到高是 ♣ < ♦ < ♥ < ♠ < NT，然後才是下一線。雙方一開始都 Pass 就重發；有人叫了之後，另一方 Pass 就定約
4. **打牌階段**：非莊家首攻；有首引的花色就要跟，缺門可以墊牌或出王。莊家要拿到「線數 + 6」墩

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
tools/LogicTests/    不開 Unity 跑測試用的 .NET 專案
docs/SPEC.md         第一版開發規格
```
