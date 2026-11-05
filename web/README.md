# 蜜月橋牌 · 網頁連線版

你按「開房」→ 把房號傳給朋友 → 朋友打開網址輸入房號 → 兩個人各用自己的手機、自己的網路打同一桌。

- **雲端負責**洗牌、記輪到誰、判斷誰贏、計分；每支手機只會收到**自己的牌**，誰都偷看不到對方
- 朋友**不用註冊**任何帳號；家裡電腦可以關機
- 重新整理或斷線，回來還是同一桌（座位憑證存在手機上）
- 規則跟 Unity 版一模一樣（② 完整對戰：加倍／再加倍、計分、先到 100 分）

| | |
|---|---|
| 分支 | `feature/web-online-v1` |
| 開工基準 | `claude/awesome-pasteur-058wty` @ `b9dd62a767f40c576de034ede9b90484fde501fe` |
| 改到的舊檔案 | 0 個（全部都在新的 `web/` 資料夾） |

---

## 部署到 Cloudflare（第一次大約 5 分鐘）

用 Cloudflare 的「接 GitHub」功能，不用把任何密碼交給別人。之後每次 push 到這個分支，網站會自動更新。

1. 登入 [Cloudflare 後台](https://dash.cloudflare.com/) → 左邊 **Workers & Pages** → **Create** → 選 **Import a repository**
2. 連結 GitHub，選 `funcy0184-bit/bridgecard`
3. 設定這幾格（其他保持預設）：

   | 欄位 | 填什麼 |
   |---|---|
   | Project name | `bridgecard`（**一定要跟 `wrangler.jsonc` 裡的 `name` 一樣**） |
   | Production branch | `feature/web-online-v1` |
   | Root directory（Path） | `web` |
   | Build command | 留空（`wrangler.jsonc` 裡已經寫了） |
   | Deploy command | `npx wrangler deploy`（預設值） |

4. 按 **Deploy**。跑完會給你一個網址，長得像 `https://bridgecard.你的帳號.workers.dev`
5. 用手機打開那個網址 → 開房 → 把房號傳給朋友

> 後台的按鈕名稱 Cloudflare 偶爾會改。找不到的話，跟 Claude 說你卡在哪一步、畫面上有哪些選項。

### 費用

兩個人玩完全在免費額度內：免費方案每天 10 萬次請求，「房間」用的是免費方案也能用的 SQLite 版 Durable Objects。一局牌大約幾百則訊息。

---

## 在自己電腦上跑（開發用）

需要 Node.js 20 以上。

```bash
cd web
```

```bash
npm install
```

```bash
npm run dev
```

打開 http://localhost:8787 ，再開一個**無痕視窗**（模擬第二支手機），一邊開房、一邊輸入房號。

## 測試

```bash
npm test
```

```bash
npm run typecheck
```

- `npm test`：規則單元測試（規格裡的計分範例原封不動當測試）＋ AI 對打 300 整場 ＋ 隨機亂叫亂打 300 整場，每一步檢查 52 張守恆、不外洩、計分、勝負
- 兩支手機的端對端測試要先 `npm run dev`，另開一個終端機跑：

```bash
node test/e2e/two-sockets.mjs
```

```bash
node test/e2e/two-phones.mjs http://127.0.0.1:8787 test-results
```

  - `two-sockets.mjs`：不開瀏覽器，兩條連線打完一整局；中途斷線重連、第三個人擠不進來、打錯房號
  - `two-phones.mjs`：兩支模擬手機（預設 iPhone 13 + Pixel 7）真的點畫面，從開房一路打到結算，順便截圖到 `test-results/`。換機型：`HB_DEVICE_A="iPhone SE" HB_DEVICE_B="Galaxy S9+" node test/e2e/two-phones.mjs`

---

## 架構

```
手機 A ──┐                         ┌─ Room（Durable Object，一個房間一個）
         ├─ WebSocket ─ Worker ────┤    · 持有真正的牌局（src/game）
手機 B ──┘   /api/rooms/:code/ws    │    · 檢查每個動作合不合法
                                    │    · 每個座位只送它看得到的事件和牌桌
                                    └─   · 狀態存雲端，睡著再醒來也不會掉
```

| 資料夾 | 內容 |
|---|---|
| `src/game/` | 規則：牌、跟花色、王吃、叫牌（含加倍）、計分、整場勝負、簡單電腦。跟 Unity 版 `Logic/` 一一對應，雲端和手機共用 |
| `src/server/` | `worker.ts` 開房、查房、轉接 WebSocket；`room.ts` 房間本體；`protocol.ts` 手機 ↔ 雲端的訊息格式 |
| `src/client/` | 手機畫面：`main.ts` 牌桌與流程、`fx.ts` 動畫與回饋、`net.ts` 連線與自動重連 |
| `public/` | `index.html`、`style.css`；`app.js` 由 `npm run build` 產生（部署時自動跑） |
| `test/` | 規則測試、兩支手機的端對端測試 |

### 動畫與回饋（對應 Unity 版的手感）

出牌飛行落地「啵」、對手的牌飛出來途中翻面、贏墩金光後收走、明牌翻面與搶走、暗牌從牌堆飛到手上、王吃大字＋震畫面、加倍／再加倍抖字、「輪到你」Q 彈字、出錯牌抖一下、打成波浪字、分數滾動、整場勝利彩帶；Android 會配合手機震動。選單裡可以調動畫速度、關掉畫面震動和手機震動；手機開了「減少動態效果」會自動收斂。

### 第一版還沒做

- 斷線時由電腦接手（現在是等對方回來，牌局會保留）
- 跟電腦單機打（「橋牌入門小桌」裡有單機版）
- 音效
- 房號是 4 碼；朋友加入前，拿到房號的人都能坐進去（坐滿後就進不來了）。房間沒人連線 24 小時後自動清掉
