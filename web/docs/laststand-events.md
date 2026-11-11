# 逆命賭局：文案事件判定表與模板使用條件

這份文件由程式產生（`src/laststand/copy/events.ts`、`templates.ts`），兩邊內容一致。原始 V2 文案 `laststand_v2_copywriting.json` 一字不改（測試會比對雜湊）。

判定只用伺服器的對局紀錄；「持有」＝手上籌碼＋疊池裡自己的出資。棄牌的確切牌面只有雙方賽後同意揭露時才拿來判定 bluff_verified。

## 對局中（每墩最多一句）

| 事件 | 判定方式 | 文案數 | 原本有定義 |
|---|---|---|---|
| raise | 某人在本墩做「首次加注」，而且不是梭哈（第 7–9 墩加到上限另算 allin_announced）。actor＝加注者 | 3 | **新補** |
| reraise | 某人「反加」，而且不是梭哈。actor＝反加者 | 3 | **新補** |
| call | 面對加注選擇接戰，而且對方那次不是梭哈（梭哈被接另算 allin_called）。actor＝接戰者 | 2 | **新補** |
| fold | 某人棄牌（本遊戲只有面對加注才能棄牌）。actor＝棄牌者 | 1 | **新補** |
| fold_after_raise | 棄牌，而且棄牌者面對的承諾至少是本墩底注的 2 倍，或是被反加後棄牌（有壓力的棄牌）。actor＝棄牌者 | 2 | **新補** |
| allin_announced | 第 7–9 墩有人把本墩承諾加到上限（梭哈）。actor＝梭哈方 | 2 | **新補** |
| allin_called | 梭哈之後對方接戰。actor＝接戰者 | 2 | **新補** |
| direction_flip | 宣戰權玩家使用翻轉。actor＝翻轉者；directionLabel＝翻轉後的方向 | 1 | **新補** |
| tie | 翻牌同點（不看花色） | 2 | **新補** |
| pool_win | 有人拿走疊池（翻牌贏或對方棄牌，疊池原本不是空的）。actor＝拿走的人 | 1 | **新補** |
| safeguard | 有人宣告保命。actor＝宣告者 | 1 | **新補** |
| insight | 有人使用讀心（結果只有本人看得到）。actor＝使用者 | 1 | **新補** |
| comeback | 這一墩結算前嚴格落後、結算後嚴格領先（看持有）。actor＝新的領先者 | 1 | **新補** |
| final_trick | 第 9 墩開始 | 1 | **新補** |
| chip_zero | 有人在結算、退款之後手上歸零（淘汰）。actor＝歸零的人 | 1 | **新補** |
| vow_echo | 有填賽前豪言的人，在第 5 墩以後某墩結算後持有 ≤ 9 枚（落後 12 枚以上）；每場最多一次。actor＝那個人 | 1 | **新補** |

## 賽後戰報

優先順序（主事件＋一則側事件）：finish_draw > allin_loss > last_trick_comeback > allin_win > bluff_verified > tie_pool > vow_backfire > fold_win > safeguard_save > fold_streak > finish_general

| 事件 | 判定方式 | 文案數 | 原本有定義 |
|---|---|---|---|
| finish_draw | 第 9 墩結算、疊池退完後雙方持有相同 | 3 | 有（補上可驗證的細節） |
| allin_loss | 有被接戰而且分出勝負的梭哈，梭哈方是本場落敗者、輸了那一墩。keyTrick＝最後一次；amount＝梭哈方那墩的承諾 | 9 | 有（補上可驗證的細節） |
| last_trick_comeback | 打滿 9 墩；第 9 墩開始時勝者沒有領先（落後或同分），第 9 墩結算後勝出 | 4 | 有（補上可驗證的細節） |
| allin_win | 有被接戰而且分出勝負的梭哈，梭哈方是本場勝者、贏了那一墩。keyTrick＝最後一次 | 5 | 有（補上可驗證的細節） |
| bluff_verified | 雙方賽後都同意揭露，而且伺服器比對：上面那種棄牌墩裡，棄牌者（敗者）的牌照當墩方向原本會贏 | 3 | 有（補上可驗證的細節） |
| tie_pool | 有同點而且疊池留到下一墩（沒有當墩退款），最大一次疊池雙方合計 ≥ 4 枚。keyTrick＝形成最大疊池的那一墩 | 3 | 有（補上可驗證的細節） |
| vow_backfire | 有勝負，而且敗者的賽前豪言不是空的（只回放原句，不解讀） | 4 | 有（補上可驗證的細節） |
| fold_win | 有一墩是「勝者加注（或反加）、敗者棄牌」。keyTrick＝這種墩裡轉移最多（含疊池）的一墩 | 4 | 有（補上可驗證的細節） |
| safeguard_save | 有人在保命墩輸了，而且省下的籌碼（有效底注 − 1）≥ 2（也就是第 7–9 墩）。actor＝保命者 | 2 | 有（補上可驗證的細節） |
| fold_streak | 敗者本場棄牌 3 次以上 | 1 | **新補** |
| finish_general | 有勝負（不是平手）時一定成立（保底） | 11 | **新補** |

## 修正：會講出「沒發生的事」的模板 → 加使用條件（文字不改）

| 編號 | 原文 | 加上的條件 | 原因 |
|---|---|---|---|
| V2-038 | 等等，剛剛那墩其實會贏？ | revealConsentBoth | 「剛剛那墩其實會贏？」等於暗示牌面勝負：雙方沒同意揭露不能用 |
| V2-040 | 賽前發言已完成事後查核 | loserVowExists | 「賽前發言已完成事後查核」：敗者要真的有填豪言 |
| V2-035 | 領先八墩不是保固服務 | loserLedAllEight | 「領先八墩」：敗者要真的在第 1–8 墩每墩結算後都領先 |
| V2-065 | 【賽後戰況】… | loserLedBeforeFinal | 「在最後一墩前仍保持優勢」：第 9 墩開始時敗者要嚴格領先（同分不算） |
| V2-050 | 本局於最後一墩更換勝者，敬請見諒。 | loserLedBeforeFinal | 「於最後一墩更換勝者」：最後一墩前要有原本領先的人 |
| V2-033 | 末段一球，直接換人領先 | loserLedBeforeKey | 「直接換人領先」：關鍵梭哈前敗者要領先 |
| V2-034 | 原訂勝者名單，現予以更正 | loserLedBeforeKey | 「原訂勝者名單，現予以更正」：關鍵梭哈前敗者要領先 |
| V2-064 | 【名單更正通知】… | loserLedBeforeKey | 「原暫列領先者為{loser}」：關鍵梭哈前敗者要領先 |
| V2-049 | 前面八墩的努力，最後全部進入延長討論。 | keyTrickIsFinal | 「前面八墩的努力」：關鍵梭哈要在第 9 墩 |
| V2-027 | 九墩已結束，「{loserStake}」的事另案處理 | fullNine | 「九墩已結束」：提前淘汰時不成立 |
| V2-069 | 【九墩比賽紀錄】… | fullNine | 「九墩比賽紀錄」：提前淘汰時不成立 |
| V2-068 | 各位，我有個東西想分享。… | fullNine | 「經過九墩的實際測試」：提前淘汰時不成立 |
| V2-061 | 不是，等一下。… | allInWholeStack | 「把{amount}枚全部推進去」：梭哈方推出的要真的是自己全部的籌碼（大籌碼方梭哈不是全部） |
| V2-063 | 我先講，我從來沒有不支持{loser}。… | allInWholeStack | 「他說要全部押上去」：同上 |

## 文案口味對應

| 口味 | 可以用的 style | 最高 tone |
|---|---|---|
| 冷面 | deadpan、announcement、sports | medium |
| 聊天室 | deadpan、announcement、sports、chat、streamer | medium |
| 發癲 | deadpan、announcement、sports、chat、streamer、tts、absurd | heavy |

其他硬規則：必要變數缺任何一個就換模板，不補造；填空只做純文字取代、畫面用 textContent 顯示；未同意揭露時，任何模板都不會用到棄牌牌面。
