# 事件 → 動作 → 特效 → UI 對照表

> 給 GPT（美術）和 Gemini（企劃）看：遊戲裡「哪一刻」會發生什麼，美術要準備什麼。
> 時間軸都以「事件發生那一刻＝0」計；**命中格（contactFrame）會被對齊到事件那一刻**，所以前搖畫多長都可以，但命中格要標清楚。
> 狀態欄：✅ 已有圖已接、🔌 程式已接等圖、⬜ 還沒做

## 角色動作（50×50 格、腳底錨點 (24,40)、面右，左邊自動翻轉）

| 遊戲事件 | 誰 | 動作名 | 圖集 | 狀態 |
|---|---|---|---|---|
| 待機 | 雙方 | `idle` | fighter_p*.png | ✅ |
| 損傷 ≥60% 待機 | 雙方 | `idle_tired` | fighter_p*_extra.png 第 0 列 | ✅ |
| 損傷 ≥110% 待機 | 雙方 | `idle_critical` | extra 第 1 列 | ✅ |
| 站第 1／7 格 | 雙方 | `cliff_teeter`（優先於上面兩個） | extra 第 2 列 | ✅ |
| 猜拳擺架式 | 雙方 | `stance_rock／scissors／paper`、藏招 `stance_hidden` | fighter_p*.png | ✅ |
| 開牌壓制／受壓 | 勝／敗 | `reveal_win`／`reveal_lose` | fighter_p*_v3_addon.png | ✅ |
| 連勝 1、2 重擊 | 攻方 | `streak_1_hit`（接觸格 2） | extra 第 3 列 | ✅ |
| 連勝 3 爆發 | 攻方 | `streak_burst`（爆氣格 3） | extra 第 4 列 | ✅ |
| 四套拳第 1～4 拳 | 攻方 | `combo4_hit1～3`、`combo4_hit4_launch` | extra 第 5～8 列 | ✅ |
| 被打 | 守方 | `hurt`、擊飛 `knockback` | fighter_p*.png | ✅ |
| 反擊成功 | 反擊方 | `counter_break`（架開格 1、反打格 4） | extra 第 9 列 | ✅ |
| 按到過熱的招 | 按的人 | `overheat_shake`（每格槌頭排氣口座標） | extra 第 10 列 | ✅ |
| 場外回場 | 回場的人 | `air_recover` | extra 第 11 列 | ✅ |
| 五連斬蓄勢／衝刺／對砍／彈開 | 雙方 | `clash_charge／dash／rock／scissors／paper／recoil` | fighter_p*_clash.png | ✅ |
| 五連斬大招 | 勝方 | `clash_win_rock／scissors／paper` | clash 第 7～9 列 | ✅ |
| 比賽勝利 | 勝方 | `victory` | v3_addon 第 8 列 | ✅ |
| 訓練場木樁 | P2 | `dummy_idle／hit／attack／ko` | dummy_sheet.png | ✅ |

## 特效（一張橫條、由左到右；layer：back＝角色後、front＝角色前）

| 遊戲事件 | 特效 | 貼在哪 | 層 | 狀態 |
|---|---|---|---|---|
| 一般命中 | `vfx_sparks`（缺 mega 包時） | 命中點 | front | ✅ |
| 四套拳第 1～2 拳 | `vfx_hit_light` | 命中點 | front | ✅ |
| 重擊、第 3～4 拳、反打 | `vfx_hit_heavy` | 命中點 | front | ✅ |
| 反擊成功 | `vfx_counter_flash`＋2 幀黑白衝擊 | 兩人中間 | front | ✅ |
| 爆發＋四套拳期間 | `vfx_streak_aura`（循環） | 攻方腳底 | back | ✅ |
| 按到過熱 | `vfx_overheat_smoke`（循環 0.6s） | 槌頭排氣口 | front | ✅ |
| 拼刀衝刺、被推 | `vfx_dust_dash` | 腳底，朝移動方向 | back | ✅ |
| 擊飛落地 | `vfx_dust_land` | 腳底 | back | ✅ |
| 五連斬每一刀 | `vfx_smear_rock／scissors／paper` | 握點／刃口／掌心 | 全部 front | ✅ |
| 拼刀相撞 | `vfx_clash_spark` | 兩刀交會 | front | ✅ |
| 先手拔刀 | `vfx_first_draw_star` | 刀柄 | front | ✅ |
| 大招 | `vfx_win_rock_slam／scissors_cross／paper_beam` | 敗方腳底／胸口／勝方掌心 | front | ✅ |
| 紅區地裂 | `vfx_red_crack` | 危險格 | back | ✅ |
| KO | `vfx_ko_pillar` | 出界那一側 | back | ✅ |

## 場景與 UI（規格還沒進 Git）

| 情境 | 要的東西 | 狀態 |
|---|---|---|
| 一般對戰 | 日景天空＋parallax、正常七格擂台 | ⬜ |
| 任一方損傷 ≥110% | 裂紋擂台 | ⬜ |
| 任一方剩最後一命 | 血月天空＋裂紋擂台 | ⬜ |
| 重開對局 | 回日景、正常擂台 | ⬜ |
| 中央大字 | 優先序 KO > 爆發 > 反擊，逐格毫秒照 `ui_motion_spec.json` | ⬜ |
| 四套拳、五連斬 | 集中線（中央留空） | ⬜ |
| 連勝 | 火燈動畫 | ⬜（現在是程式畫的燈） |
| 按鍵卡片 | 按下動畫；**同機雙人藏招時不能看出按了哪一招** | ⬜ |

## 引擎事件欄位（Claude 用；企劃要新增事件就在這裡加一列）

| 事件 | 欄位 | 發生時機 |
|---|---|---|
| `stance` | p, gesture（藏招時只給自己） | 猜拳中按鍵 |
| `deny` | p, why: "heat" | 按到過熱的招 |
| `streak` | p, streak[], why: win／broken／spent／respawn | 連勝改變 |
| `hit` | p（被打的人）, kind: strike／combo／counter／clash, damage, x, toward, n, final | 命中那一刻 |
| `combo_start`／`combo_cue`／`combo_end` | n, gesture, how | 四套拳流程 |
| `counter` | p（反擊方）, att, n, gesture, x | 反擊成功 |
| `clash_*` | first, cut, winner, main… | 五連斬流程 |
| `land`／`ko` | p, x, pos／stocks | 落地／出界 |
