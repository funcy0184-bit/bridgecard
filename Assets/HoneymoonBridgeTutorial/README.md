# 蜜月橋牌 · 教學版

「章節教學 + 自由對戰」的新版入口，跟原版放在同一個 Unity 專案裡，**兩個版本可以分別打開來比較**。

- 分支：`feature/guided-tutorial-v1`
- 開工基準：`claude/awesome-pasteur-058wty` @ `b9dd62a767f40c576de034ede9b90484fde501fe`（② 完整對戰）
- 規則：**只新增檔案**。原版的場景、腳本、Prefab、特效、README、套件、ProjectSettings 全部保持原狀

---

## 怎麼打開

第一次在這個分支打開專案，Unity 的前置步驟跟原版 README 一樣（TMP Essential Resources、中文字型設成 TMP 預設字型）。做過的話就不用再做。

| | 原版 | 教學版 |
|---|---|---|
| 建立場景 | 選單 **蜜月橋牌 › 一鍵建立場景** | 選單 **蜜月橋牌教學版 › 建立教學場景** |
| 場景檔 | `Assets/HoneymoonBridge/HoneymoonBridge.unity` | `Assets/HoneymoonBridgeTutorial/HoneymoonBridgeTutorial.unity` |
| 進去會看到 | 開場選單：單機／開房間／加入 | 主選單：開始對戰／章節教學／設定／遊戲介紹 |

- 兩個場景都在 Project 視窗雙擊打開，按 Play 就能玩。要比較就輪流打開。
- **「建立教學場景」只會建一次**。場景已經存在時，它只會幫你在 Project 視窗選取那個場景，不會重建，也不會覆寫你手動調整過的東西。真的想重建，請自己先刪除或改名那個場景檔。
- 教學場景**沒有加進 Build Settings**（不動 ProjectSettings）。在編輯器裡按 Play 不受影響；之後要打包教學版時，再自己加進 File › Build Settings。

---

## 新版有什麼

### 主選單

| 入口 | 內容 |
|---|---|
| 開始對戰 | 人機對戰、建立房間（拿房號給朋友）、輸入房號加入 |
| 章節教學 | 五章，完成的章節會標「已完成」 |
| 設定 | 動畫速度（慢／標準／快）、畫面震動（開／關）、教學提示（開／關）、重設教學進度 |
| 遊戲介紹 | 玩法簡介、規則速查、計分範例 |

牌桌右上角有「暫停」：繼續、遊戲介紹、設定、回主選單。單機和教學時會凍結時間；連線時對方還在打，所以只蓋上選單、不停時間。

### 章節教學

| 章 | 玩家實際做什麼 |
|---|---|
| 一・搶明牌 | 第一題明牌是 ♠A，要出大牌把它搶下來（輸了要重來）。第二題明牌只是 ♣2，自己決定要不要花 ♦A 去搶，兩種選擇都會解釋 |
| 二・叫出合約 | 第一題只收 2♥，畫面說明「要拿 8 墩」。第二題對手先叫 4♠，看叫牌紀錄、按「加倍」 |
| 三・跟牌與王吃 | 第一題有首引的黑桃，一定要跟（不能出的牌會被擋下來）。第二題缺梅花，用小紅心王吃掉 ♣A，觸發原版的「王吃！」震動和跳字 |
| 四・讀懂計分板 | 合約 3♥、已經拿 8 墩的殘局，打最後兩墩：一次剛好打成（30 分）、一次超 1 墩（32 分） |
| 五・第一場挑戰 | 跟簡單電腦打完整的一局，白話提示可以在牌桌上開關。結算面板直接「下一局」就能繼續累計分數 |

### 牌桌上的白話提示

人機對戰、連線和第五章，牌桌上方會有一個「白話提示」框（可以關掉）：

- 抽牌：這張明牌值不值得搶
- 叫牌：你的大牌點、最長花色、估計能拿幾墩、建議叫什麼，以及能加倍時值不值得加倍
- 打牌：還要拿幾墩、這一墩要跟哪門、缺門時能不能王吃

提示只看你自己看得到的東西（`TableState`），不會偷看對手的牌。有測試確認：對手手牌不同、你看到的一樣時，提示一字不差。

---

## 怎麼做到「不改原版」

| 需要的功能 | 做法 |
|---|---|
| 牌桌畫面、動畫、跳字、震動 | 直接沿用原版的 `GameView`、`CardView`、`FeedbackDirector`、`TextFX`。新場景裡放同樣的元件，用新版的建場景工具接線 |
| 人機對戰、連線 | 直接沿用原版的 `GameHost`、`LocalTable`、`NetTable`（透過 `ITableClient` 介面） |
| 教學關卡的固定牌局 | `TutorialTable` 實作同一個 `ITableClient`，原版 `GameView` 不知道自己在教學。牌局用原版公開的 `Hands`／`Stock`／`TricksWon` 擺好，之後照正式規則跑 |
| 動畫速度 | `Time.timeScale`，原版所有動畫、停頓、電腦思考時間會一起變 |
| 畫面震動開關 | `ShakeGate` 掛在牌桌上，關掉時在 `LateUpdate` 把位置拉回原點；原版 `FeedbackDirector` 不用改 |
| 設定儲存 | `PlayerPrefs`，鍵名一律是 `HoneymoonBridgeTutorial.` 開頭，跟原版分開 |

---

## 資料夾

```
Assets/HoneymoonBridgeTutorial/
├─ Scripts/
│  ├─ Logic/    純 C#（自己一個 asmdef）：關卡、牌局擺法、白話提示、遊戲介紹文字、設定
│  ├─ Runtime/  Unity 元件：TutorialApp（總控）、TutorialMenu、TutorialDirector、TutorialTable、CoachPanel、ShakeGate
│  └─ Editor/   建立教學場景的工具
├─ Tests/EditMode/   教學版的測試（Unity Test Runner 也看得到）
├─ Prefabs/          「建立教學場景」第一次執行時產生
└─ HoneymoonBridgeTutorial.unity   同上

tools/HoneymoonBridgeTutorial/
├─ TutorialTests/          不開 Unity 跑教學版測試
├─ TutorialCompileCheck/   用假 Unity API 編譯原版 + 教學版全部腳本
└─ check_tutorial_wiring.py  檢查建場景工具的接線欄位、只寫新版路徑、不覆寫既有場景
```

## 測試

```bash
dotnet test tools/HoneymoonBridgeTutorial/TutorialTests
```

```bash
dotnet build tools/HoneymoonBridgeTutorial/TutorialCompileCheck
```

```bash
python3 tools/HoneymoonBridgeTutorial/check_tutorial_wiring.py
```

- 每一題都用「標準解法」和「錯誤示範」實際打一次：標準解法一定過關，錯誤示範會被擋下或要求重來
- 第四章兩題設計成「不管出哪張合法的牌，結果都一樣」，保證一定看得到 30 分和 32 分的差別
- 遊戲介紹的計分範例直接呼叫正式的 `Scoring` 算，規則改了會自動跟著變
- 原版的 GitHub Actions 照常跑原版的測試；教學版的檢查目前要手動跑（加 CI 要新增一個 workflow 檔，還沒做，要的話跟我說）
