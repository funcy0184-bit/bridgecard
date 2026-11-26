# 《拳刃交鋒》最新進度總覽

> 每完成一個階段，Claude 會更新這份檔案（規則寫在 repo 根目錄 `CLAUDE.md`）。
> 標 `AUTO` 的區塊由 `node web/scripts/fist-status.mjs` 掃描程式與圖檔自動產生；其他區塊手寫。

## 📌 版本資訊
<!-- AUTO:version -->
- 分支：`feature/fist-duel-proto`
- 最新 commit：`5595262`（2026-11-26）拳刃交鋒：新美術規格 JSON 不公開到正式站（.assetsignore）
- 本表產生：2026-11-26（`node web/scripts/fist-status.mjs`；commit 碼是產生當下的 HEAD，本次改動的 commit 會在它之後）
- 正式站：`feature/web-online-v1` → https://bridgecard.funcy0184.workers.dev/fist/（部署需製作人同意）
<!-- /AUTO:version -->

## ✅ 功能進度表

**正式模式（AI／同機雙人／線上／教學）＝ v4 規則**
- [已完成] 猜拳 2.8s（亮招＋藏招）→ 開牌 → 連勝 1、2 單發重擊 → 3 連勝爆發四套拳（逐拳反擊）
- [已完成] 平手累積 2 次 → 五連斬拼刀 → 三種專屬大招（傷害與擊飛統一）
- [已完成] 過熱、越打越快、7 格擂台、3 命、擊飛 KO
- [已完成] 線上房間（Durable Object、斷線重連、藏招不外洩）、AI 分級、教學道場
- [已完成] 開牌／勝利加購圖重新接上預載（之前漏掉）
- [已完成] 修正 KO 時沒有「KO！」大字、還會誤跳「⚡ 加速」橫幅的舊 bug
- [⏳ 待實作] 正式站部署 v4（目前正式站還是更早的版本；需製作人同意）

**🛠️ 訓練場（木樁沙盒）**
- [已完成] 木樁出招控制、四套拳逐拳指定、反擊時機、拼刀預設、一鍵狀態／跳轉、即時調秒數、無限命、複製參數
- [已完成] 木樁美術圖 `dummy_sheet.png` 已接上（待機／被打／出手／擊飛解體）；缺圖時改用程式木人樁＋噴木屑

**v2.0 實驗開關（只在訓練場；「⚡ 一鍵全開 v2.0」）**
- [🧪 訓練場實驗中] 快節奏讀心：按下即鎖定、雙方鎖定即開牌、限時 1.5s
- [🧪 訓練場實驗中] 無格線擂台：受擊滑行、只有飛出畫面才 KO、場外受身回場、前緩後陡擊飛、回合間自動貼近
- [🧪 訓練場實驗中] 痛感提升：單發重擊 +13%
- [🧪 訓練場實驗中] 四套拳 v2：反擊窗 0.75s、前 3 拳原地
- [🧪 訓練場實驗中] 極致打擊感：黑白衝擊幀（反擊剪影 2 幀、第 4 拳／拼刀 2 幀、KO 定格 3 幀）、腳底錨點形變、方向鏡頭踹擊、RGB 錯位、頂部提示放大
- [已完成] 10 組新 VFX、P1／P2 各 12 組擴充動作（含空中回場 `air_recover`）的 PNG 已接上，所有模式生效
- [🧪 訓練場實驗中] 視線中心 UI（`hudV2`）：倒數條下移到 y≈46、連勝火焰在倒數條兩側、過熱鎖 22×22 掛在角色身側（按到抖動冒煙）、反擊盾牌 36×36 浮在攻方頭頂、漫畫大字 4 種（KO＞爆發＞五連斬＞反擊，1.6→0.95→1.0 砸入）、四套拳／五連斬集中線；目前全程式繪製，`ui_v2_pack` 到了自動換圖
- [🧪 訓練場實驗中] 程式特效／動作替身（任何 PNG 缺檔時、且開「極致打擊感」才出現的備援）
- [⏳ 待實作] 手感定案後一鍵套用到正式模式

**場景／UI 美術包**
- [⏳ 待補圖] `ui_v2_pack`（9 張 UI PNG＋`ui_v2_spec.json`）：程式已接好；圖進 Git 後照 JSON 校正 `config.js` 的 `uiV2`（尤其 `ui_rps_big` 格式、火焰格數），再把 `ART_PACKS.uiV2` 改 true
- [⏳ 待補圖] `stage_v2_pack`（擂台、日景／血月背景、`floor_y_offset`）：規格與圖都還沒進 Git，尚未接

## 🎨 美術與特效掛載表
<!-- AUTO:art -->
| 類別 | 檔名 | 尺寸 | 狀態 |
|---|---|---|---|
| 角色基礎 | `fighter_p1.png` | 500×800 | ✅ 已接 PNG |
| 角色基礎 | `fighter_p2.png` | 500×800 | ✅ 已接 PNG |
| 武器變體 | `fighter_p1_weapons.png` | 500×500 | ✅ 已接 PNG |
| 武器變體 | `fighter_p2_weapons.png` | 500×500 | ✅ 已接 PNG |
| 拼刀加購 | `fighter_p1_clash.png` | 500×500 | ✅ 已接 PNG |
| 拼刀加購 | `fighter_p2_clash.png` | 500×500 | ✅ 已接 PNG |
| 開牌／勝利 | `fighter_p1_v3_addon.png` | 500×450 | ✅ 已接 PNG |
| 開牌／勝利 | `fighter_p2_v3_addon.png` | 500×450 | ✅ 已接 PNG |
| 擴充動作 12 組 | `fighter_p1_extra.png` | 500×600 | ✅ 已接 PNG |
| 擴充動作 12 組 | `fighter_p2_extra.png` | 500×600 | ✅ 已接 PNG |
| 訓練場木樁 | `dummy_sheet.png` | 500×200 | ✅ 已接 PNG |
| 特效 前層 | `vfx_sparks.png` | 240×48（5 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_slash.png` | 320×64（5 格 24fps） | ✅ 已接 PNG |
| 特效 後層 | `vfx_red_crack.png` | 576×32（6 格 16fps） | ✅ 已接 PNG |
| 特效 後層 | `vfx_ko_pillar.png` | 384×270（6 格 16fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_clash_spark.png` | 240×48（5 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_first_draw_star.png` | 96×24（4 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_win_rock_slam.png` | 576×64（6 格 18fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_win_scissors_cross.png` | 576×96（6 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_win_paper_beam.png` | 768×64（6 格 20fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_hit_light.png` | 240×48（5 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_hit_heavy.png` | 384×64（6 格 22fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_counter_flash.png` | 480×80（6 格 24fps） | ✅ 已接 PNG |
| 特效 後層 | `vfx_streak_aura.png` | 384×64（6 格 14fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_overheat_smoke.png` | 160×32（5 格 12fps） | ✅ 已接 PNG |
| 特效 後層 | `vfx_dust_dash.png` | 240×32（5 格 20fps） | ✅ 已接 PNG |
| 特效 後層 | `vfx_dust_land.png` | 240×24（5 格 18fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_smear_rock.png` | 256×64（4 格 24fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_smear_scissors.png` | 256×64（4 格 28fps） | ✅ 已接 PNG |
| 特效 前層 | `vfx_smear_paper.png` | 256×64（4 格 24fps） | ✅ 已接 PNG |
| UI v2 | `ui_timer_frame.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_rps_big.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_overheat_lock.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_streak_flames.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_callout_burst.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_callout_counter.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_callout_clash.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_callout_ko.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| UI v2 | `ui_speedlines.png` | 待 ui_v2_spec.json | 🎨 程式繪製已運作（訓練場「視線中心 UI」開關；待補 PNG） |
| 場景 | stage_platform_*、bg_sky_*、parallax/（stage_v2_pack） | — | ⏳ 規格與圖都還沒進 Git |

**要請 GPT 補的圖（直接複製）：** `ui_timer_frame.png`、`ui_rps_big.png`、`ui_overheat_lock.png`、`ui_streak_flames.png`、`ui_callout_burst.png`、`ui_callout_counter.png`、`ui_callout_clash.png`、`ui_callout_ko.png`、`ui_speedlines.png`

> 🎨 的程式特效／替身只在訓練場打開「極致打擊感」開關時出現；PNG 放進 `web/public/fist/` 並把 `config.js` 的 `ART_PACKS` 對應開關改 true，就會自動換成美術圖（所有模式）。
<!-- /AUTO:art -->

## ⚙️ 核心手感數值快照
<!-- AUTO:numbers -->
| 項目 | 正式（v4） | 訓練場 v2.0 |
|---|---|---|
| 猜拳限時 | 2.8s（亮招 2.2s＋藏招 0.6s） | 1.5s，雙方鎖定 0.08s 後開牌 |
| 開牌停頓 | 0.55s | 0.22s |
| 單發重擊 | +8%、推 1 格、0.7s | +13%、滑行、0.5s |
| 四套拳 | 選拳 0.55s → 反擊窗 0.9s，傷害 5/5/5/9% | 反擊窗 0.75s，前 3 拳原地 |
| 反擊 | +10%、頓幀 150ms | 同左＋2 幀剪影衝擊 |
| 五連斬 | 平手 2 次觸發、輸入 3.5s、大招 +24%（先手 +6%） | 同左 |
| 擊飛初速 | V = 150 × (1 + 損傷/100)，重力 900 | V = 95 × (1 + (損傷/100)^1.35 × 1.45)，重力 520、空阻 0.3 |
| KO 條件 | 落在台外 | 飛出畫面四邊（左右 26px、上 70px） |
| 回場 | 無 | 下墜且水平速度 < 60 → 二段跳 300 |
| 越打越快 | 每 3 回合升一級，最多 Lv.4 | 同左（猜拳限時固定） |
<!-- /AUTO:numbers -->

## 📝 待我實測清單與已知小問題

**請進訓練場 → 按「⚡ 一鍵全開 v2.0」實測（含新的視線中心 UI）：**
0. **視線中心 UI**：倒數條在角色頭頂上方（y≈46）夠不夠醒目？漫畫大字會不會擋到角色？集中線會不會太吵？
1. **反擊剪影幀**：木樁打我四套拳時在任一拳反擊成功 → 應看到 2 幀「黑底＋白剪影＋青金十字」。會不會太刺眼？
2. **四套拳美術動作**：我打四套拳（木樁不反擊）→ 4 拳的 GPT 動作、命中星芒／衝擊環、殘影位置有沒有對齊？
3. **KO 定格**：把木樁設 135%、站第 7 格，直接測我打四套拳 → 先定格 3 幀黑白，光柱才炸出來。節奏對嗎？
4. **回場**：木樁 0%～45% 站台邊吃第 4 拳 → 飛出平台、翻滾二段跳回來、落地揚塵。回場會不會太容易？
5. **空中回場**：新的 `air_recover` 動作配回場揚塵，翻轉方向對不對？

**已知小問題**
- 揮擊殘影的貼齊點是估的，真圖到了可能要微調幾像素
- v2 單發重擊的大字副標還寫「往崖邊推 1 格」（無格線模式其實是滑行），手感定案後一起改文案
- 過熱蒸氣：瀏覽器截圖只確認到「♨️ 禁用」標示，蒸氣本身要你肉眼看一下
- `taunt_ready`（開局挑釁）已被你的美術提交換成 `air_recover`，開局目前沒有挑釁動作
- 真機（手機）手感與效能尚未驗收
