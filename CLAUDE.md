# 專案協作規則（Claude 每次都要遵守）

## 《拳刃交鋒》（web/public/fist/）
- **每完成一個階段的開發或改動，順手更新 `web/docs/fist/STATUS.md`：**
  1. 跑 `node web/scripts/fist-status.mjs`（自動更新版本、美術掛載表、數值快照）
  2. 手動更新「✅ 功能進度表」與「📝 待我實測清單與已知小問題」
  3. 跟程式改動一起 commit
- 規格與分工見 `web/docs/fist/README.md`（GPT 美術／Gemini 企劃／Claude 程式）。
- v2.0 新規則一律先做成 `CONFIG.V2_EXPERIMENTS` 開關，只在訓練場開啟；開關全關時正式模式（AI／同機／線上／教學）行為必須跟原本一致。
- 不要跑 AI 模擬對戰（`test/fist-sim.mjs`），手感由製作人實測。
- 開發分支 `feature/fist-duel-proto`；正式站 `feature/web-online-v1`，合併／部署前要製作人同意，先備份 `backup/web-online-v1-<sha>`、只快轉、不強推。
- 缺美術圖時不要寫死導致 404：選配圖靠 `CONFIG.ART_PACKS` 開關，缺圖走程式繪製。
- 測試原則：不刪既有測試、不放寬斷言、沒跑的不能說通過、真機驗收不能用模擬取代。
