# 拳刃交鋒：線上對戰後端（fist-online）

獨立的 Cloudflare Worker，跟「來打橋牌」主站（`web/wrangler.jsonc`）完全分開，主站的自動部署不會帶到這裡。

> **正式版已內建在「來打橋牌」主站：`https://bridgecard.funcy0184.workers.dev/fist/`**（主站 Worker 的 `/fist/api/*`、`/fist/ws/*`）。
> 這個資料夾是「獨立部署」備案，跟主站共用同一份伺服器程式。

```
fist-online/
├── wrangler.toml        Worker 設定：靜態檔指向 ../web/public/fist，/api/* 與 /ws/* 交給 Worker
└── worker/index.js      入口；房間伺服器與路由在 web/src/server/fist/（gameRoom.js、route.js，主站共用）
```

前端串接在 `web/public/fist/src/transport.js` 的 `WebSocketTransport`，房間畫面在 `main.js`／`index.html`。

## 本機雙開瀏覽器測試

1. 安裝相依（第一次）：在 `fist-online/` 執行 `npm i -D wrangler`（或用專案裡已有的 wrangler）
2. 啟動：`npx wrangler dev --port 8790`
3. 瀏覽器 A 開 `http://127.0.0.1:8790/` → 線上對戰 → 建立房間 → 按「一鍵複製邀請連結」
4. 瀏覽器 B（另一個分頁或無痕視窗）貼上連結 → 自動加入成為 P2
5. 兩邊都按 READY → 倒數 3 秒開打（A/S/D 或 ←↓→）
6. 測斷線：關掉 B 的分頁 → A 會看到「對手斷線，等待重連 15 秒...」；15 秒內重新打開同一個連結（同一個分頁重整也行）就接續，超時 A 判勝
7. 比賽結束：雙方都按「再來一局」原地重開；「離開房間」回大廳

自動化驗收（需要先完成步驟 2）：

```
node web/test/fist-online.mjs http://127.0.0.1:8790/            # 伺服器協定（兩條真的 WebSocket）
node web/test/fist-online.mjs http://127.0.0.1:8790/ --long     # 加跑 15 秒斷線判勝與 Rematch
node web/test/e2e/fist-app.mjs http://127.0.0.1:8790/           # 瀏覽器驗收（含線上雙開）
```

## 協定與規則重點

- 房號：4 碼大寫英數，排除 `0 O 1 I`；Worker 建房時由 Durable Object 的 storage 判斷是否已被佔用，撞號就換
- 時間軸：伺服器每 1/120 秒推進引擎，六個階段切換都由伺服器時鐘決定；每則 `state` 附 `serverTime`、`phaseEndTime`，前端用 ping/pong 估時鐘差對齊倒數條
- 隱藏資訊：每個座位只收 `engine.viewFor(自己)`；藏招期（猜拳最後 0.5 秒）的換招、終結擇的手勢、蓄力起手都不送對手，鎖定結算才公佈
- 連打：攻方每一下按鍵都送上來，伺服器自己數「每 2 下追加 1 拳、上限 4 拳」，命中事件即時廣播給守方
- 判定窗延遲寬容：伺服器多收 80ms（`CONFIG.net.windowGraceMs`），畫面倒數仍是 0.5 秒
- 心跳：每 15 秒 ping/pong，右上角顯示 ms
- 斷線：對戰中斷線 → 暫停 15 秒；帶同一個 token（存在分頁的 sessionStorage）回來就接續，超時判留在房內的人獲勝
- 閒置 30 分鐘沒人在線：`alarm()` 清掉房間，房號釋出

## 部署（Cloudflare 後台一鍵連 GitHub，跟主站一樣）

1. Cloudflare 後台 → **Workers & Pages** → **Create** → **Import a repository** → 選 `funcy0184-bit/bridgecard`
2. 設定：
   - Project name：`fist-duel`（要跟 `wrangler.toml` 的 `name` 一樣）
   - Production branch：`feature/fist-duel-proto`
   - Root directory（Advanced settings → Path）：`fist-online`
   - Build command：留空；Deploy command：`npx wrangler deploy`（預設值）
3. 按 **Deploy**，約 1 分鐘後網址是 `https://fist-duel.<你的帳戶子網域>.workers.dev`
4. 之後推到 `feature/fist-duel-proto` 就會自動重新部署

或在自己的電腦：`cd fist-online && npm install && npx wrangler login && npx wrangler deploy`

- 只上傳 `web/public/fist` 的遊戲檔；`ART_BIBLE.md`、`art_spec.json` 由 `web/public/fist/.assetsignore` 排除不公開
- 跟「來打橋牌」主站（`bridgecard` Worker）完全分開：不同 Worker、不同 Durable Object、不影響主站
