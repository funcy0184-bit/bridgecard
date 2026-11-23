# 《拳刃交鋒》開發紀錄

分支：`feature/fist-duel-proto`（不合併、不部署；上線需專案負責人同意）

## v2（線上對戰＋美術 v1.1／UI v1.2＋一分鐘耐受度）

### 改了哪些檔案
| 檔案 | 內容 |
| --- | --- |
| `fist-online/wrangler.toml`、`worker/index.js`、`worker/gameRoom.js`、`README.md` | 新的獨立 Worker：建房 API、GameRoom Durable Object 權威伺服器 |
| `web/public/fist/src/transport.js` | `WebSocketTransport` 完整實作（時鐘對齊、位置平滑、自動重連）、`createRoom`、`inviteLink` |
| `web/public/fist/src/main.js`、`index.html` | 房間面板（房號、複製邀請連結、P1/P2、READY、倒數、Rematch、離開、斷線提示、延遲）、出招提示開關 |
| `web/public/fist/src/keybar.js`（新） | 底部動態鍵位卡（DOM），配色照 `ART.hud.keyRow.cardStyle` |
| `web/public/fist/src/renderer.js` | 三把武器（大槌子／大剪刀／大布袋）、武器圖集接口、v1.2 架式氣泡、藍招手勢幾何、損傷字四級＋耐受度狀態字、絕命對峙標題；畫布鍵位列移除 |
| `web/public/fist/src/config.js` | `ART` 換成 art_spec v1.2；耐受度數值；`hints`／`status`／`cards`／`net` |
| `web/public/fist/src/engine.js` | `windowGrace`（線上 80ms）、紅區固定兩格、終結技拿公開手勢的武器、蓄力事件只給攻方 |
| `web/public/fist/art_spec.json`、`ART_BIBLE.md` | 換成使用者提供的 v1.2／v1.1 原檔 |

### 耐受度（AI 對 AI 90 場，遊戲時間）
| | 舊數值 | 新數值 |
| --- | --- | --- |
| 單場平均 | 50.7 秒 | 60.4 秒 |
| 中位數 | 36.9 秒 | 48.9 秒 |
| 每條命回合數 | 2.9 | 3.4 |

同級對打：新手 54.8、師兄 55.9、宗師 140.5 秒（宗師彈反率 80%，常互擋）。真人對打時長待人工驗收。

### 測試（L1／L2）
- `node test/fist-engine.mjs`：規則（含延遲寬容、紅區兩格）全過
- `node test/fist-sim.mjs 90`：90 場全打完、無不變量違反
- `node test/fist-online.mjs <網址> --long`：伺服器協定 40 項全過（藏招封包保密、連打上限、判定窗寬容、斷線暫停／重連／超時判勝、Rematch、離開）
- `node test/e2e/fist-app.mjs <網址>`：瀏覽器驗收 45 項全過（教學、AI、同機雙人鍵位卡與提示開關、線上雙開）
- `node test/e2e/fist-check.mjs`：舊原型 proto.html 全過

### 與需求不同／待決定
1. 連打不另送 `MASH_HIT`：攻方每一下按鍵都送上來、由伺服器數，作弊改不了次數；守方收到的「追加命中」事件就是 MASH_HIT 的角色
2. 階段切換用房內計時器（每 1/60 秒推進引擎）；`alarm()` 負責 30 分鐘閒置清房
3. 耐受度狀態字的抖動照需求（±1／±2px 持續抖），數字本身的受擊位移照 v1.2 規格（最多 1px）
4. 紅區固定兩格：守方在崖邊時往台內補一格，可能蓋到攻方腳下

### 待人工驗收（沒有實機，不宣稱通過）
- 真人一分鐘對打的節奏與耐受度手感
- 兩台不同網路的電腦實際連線（延遲 50～200ms 時的倒數對齊、80ms 寬容夠不夠）
- 手機觸控：模擬器（iPhone 13 直拿／橫拿）測過，真手機的手感、多指同按、震動回饋待人工驗收
- 正式 Cloudflare 部署（未部署）

## v2.1（手機觸控按鍵）
- `keybar.js`：鍵位卡本身就是觸控按鍵。按住＝按住鍵（長按贏拳卡 0.3 秒開紅招），放開＝放開鍵；每根手指各自追蹤（同機雙人兩人同時按互不干擾）；連打大卡每一下輪流送左／中／右
- 觸控模式：粗指標裝置（手機、平板）一開就切換，桌機用手指點到也會切；按鍵區移到畫布下方、放大到拇指好按（直拿最多佔 34% 高、橫拿 28%），上排按鈕不蓋 HUD
- 按下有壓縮回饋＋輕震動（支援的 Android 才有）；長按不跳選單、不雙擊放大、不捲動
- 比賽結束點畫面再來一場；教學目標改成觸控說法（「按 ◀ 或 ▶」）
- 桌機不變：鍵位卡仍疊在畫布底部、滑鼠不會誤觸
- 修正：斷線提示第一幀沒有文字
- 測試：`node test/e2e/fist-touch.mjs <網址>` 34 項全過（iPhone 13 直拿／橫拿、桌機）；`fist-app` 回歸全過

## v2.2（暱稱、表情、新手引導、震動、越打越快）
- **越打越快**（`CONFIG.speed`、engine）：整場每 3 回合升一級、第 10 回合起最快；走位 1.2→0.85、亮招 1.3→0.9、藏招 0.5→0.4、連打 0.65→0.5、終結擇 0.45→0.4、判定窗 0.5→0.4 秒。掉命不退級。教學不加速。HUD 顯示 ⚡ Lv.N、升級跳「⚡ 加速！」
  - AI 對 AI 90 場：平均 59.5 秒（加速前 60.4）、最長 204 秒（加速前 259）、每條命 3.7 回合
- **暱稱**：線上畫面填，最多 8 個字，存這台瀏覽器；伺服器清掉控制字元／零寬／方向字元與 `<>`。沒填過暱稱的人點邀請連結，先停在填暱稱畫面（房號已帶好）
- **表情**：固定 8 個（😂 😡 👍 🔥 😱 🙏 🤡 GG），上排 😀 打開，或鍵盤 1～8；伺服器每人 1.5 秒一個、只認清單上的；⚙️ 可隱藏對手表情
- **新手引導**（`guide.js`）：每個階段一行「現在該按什麼」，只說動作不說答案；線上由房主在房間面板設雙方預設，每人可在 ⚙️ 只改自己的；倒數時顯示整回合流程
- **震動**（`haptics.js`）：打到／被打到／彈反／KO 各有震法；Android 用 navigator.vibrate；iPhone Safari 不開放網頁震動，只能試著觸發一下系統觸感（力道不可控，未在真機確認）
- 上排改成 ⚙️ 設定（出招提示／新手引導／震動／對手表情），主選單也有三個開關
- 修正：按鍵小回饋會吃掉命中震動的冷卻；彈反反擊的震動會蓋掉彈反的「噠噠」
- 測試：fist-engine（加速 10 項）、fist-online 45 項、fist-app 56 項、fist-touch 38 項（含震動紀錄）、proto 全過

### 待人工驗收
- 真手機：震動手感（Android）、iPhone 是否真的有觸感、加速後最快 0.4 秒判定窗人手來不來得及

## 上線：併入「來打橋牌」主站（/fist/）
- 網址：`https://bridgecard.funcy0184.workers.dev/fist/`；首頁「經典橋牌／梭了啦」下面新增整列「拳刃交鋒」入口，遊戲選單有「← 回來打橋牌」
- 主站 Worker：新 Durable Object `GameRoom`（綁定 `FIST_ROOMS`、migration v3，正式與 staging 都加）；`/fist/api/*`、`/fist/ws/*` 交給 `src/server/fist/route.js`；開房共用主站 Limiter（create）
- 伺服器程式搬到 `web/src/server/fist/`（gameRoom.js、route.js），獨立的 fist-online 共用同一份
- `web/public/.assetsignore`：美術規格文件不公開
- 修正：倒數 3 秒／斷線 15 秒在時鐘估計差幾 ms 時會閃出「4」「16」
- L3 回歸（部署前）：typecheck、vitest 255、主站 e2e 25 支全過（feel-check 長任務 103ms 一次、重跑 84ms 通過；lsai-gate 用正式建置模式 LS_AI=dev 通過）；拳刃交鋒 engine／online 45／app 57／touch 38／proto 全過
  - layout-check 在第 6 個尺寸逾時：正式版 8447325 同一處也逾時，非本次造成，另案處理
- 已部署：正式分支 `feature/web-online-v1` 由 `8447325` 快轉到 `5410d7a`（備份 `backup/web-online-v1-8447325`），推上後約 30 秒正式站生效
- 正式站驗證（2026-11-23）：fist-app 57 項全過（延遲約 55ms）、fist-online 40 項全過（`--few-rooms`；第一次跑時「反擊 +10%」是測試在網路延遲下讀太快，已改成等原攻方畫面更新）、主站 rooms.mjs 開房／入座／開打全正常
  - rooms.mjs「一直猜房號會被擋」在正式站沒被擋：本機通過、這次沒改 Limiter；最可能是測試環境的代理出口 IP 會換，待用固定網路再確認
- 待人工驗收：手機實際遊玩（觸控、震動、引導、兩支手機連線、斷線重連）
