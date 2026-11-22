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
- 手機：目前只有鍵盤操作（橫拿 844×390 版面不破，但沒有觸控按鍵）
- 正式 Cloudflare 部署（未部署）
