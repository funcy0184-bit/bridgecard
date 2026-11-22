# 《拳刃交鋒》像素視覺聖經

美術規格 v1.0 · 供角色美術與 Claude Canvas 實作使用

畫面是一座夜色中的浮空石台。玩家先看武者的姿勢猜拳，再看終結提示決定是彈反還是翻滾。**藍招看攻方頭頂，紅招看腳下。** 兩套提示在第一幀就顯示完整形狀和可用按鍵，目標是在 200 ms 內分出操作種類。500 ms 是藍招的輸入時間，200 ms 是辨識測試目標。

## 1　畫面與色盤

在 **480 × 270** 的虛擬畫布上，地台從 `x=72` 到 `x=408`（右界不含），表面在 `y=184`。七格各 **48 px**，每格用接縫區隔，危險區就能精準貼上兩格。地台用深藍灰石、氧化銅扣件與一條亮石緣構成，底部輪廓往深淵收窄。背景上方是低對比夜空，中景放斷崖剪影與橫向薄霧，人物背後保留大片空色。左右留白用來交代墜落和擊落光柱。

角色用俐落黑邊、平塗色塊與少量硬高光。主身體約 **18 × 26 px**，角色加武器收在 48 × 48 px，武器蓄力與出手方向靠輪廓拉開。P1 用赭橘與奶白，肩線厚、腰帶亮。P2 用翠綠與薄荷白，肩線斜、短披片有雙尾。帽緣或肩形保留不同輪廓，即使兩人同時被反白，仍可分辨。角色身上用金屬高光表現材質，藍紅發光由特效層專用。

| 用途 | Hex | 畫面用法 |
| --- | --- | --- |
| 夜空與天際 | `#101625` → `#1C2B41` | 以低對比像素色帶分層，維持武者輪廓。 |
| 遠崖、霧、深淵 | `#232F46`、`#2B3D53`、`#0A0F1A` | 霧帶放在地台後，靠近懸崖下方逐步加深。 |
| 地台 | 暗面 `#243249`、石面 `#394B61`、石緣 `#8495A6`、接縫 `#536579`、銅件 `#796047`、外輪廓 `#111622` | 七格接縫保持同一寬度，最亮的位置放在腳下輪廓。 |
| P1 武者 | 暗 `#713B29`、主 `#D58941`、副 `#FFF0C3`、亮 `#FFF9E8` | 赭橘外套、奶白肩甲或腰帶，亮面集中在上半身。 |
| P2 武者 | 暗 `#23544E`、主 `#4BB381`、副 `#C6F9D8`、亮 `#ECFFF1` | 綠色外套、薄荷白領巾或雙尾披片。 |
| 共用角色色 | 描邊 `#10121B`、鋼 `#A9A9AC`、藏招填色 `#131A2A` | 鋼色亮面保持窄，剪影優先於武器表面細節。 |
| HUD | 底板 `#101827`、文字 `#F4F3EE`、弱化 `#8592A4`、焦點 `#FFF5D8`、力量亮 `#F4D58C`、空槽 `#39475D` | 深底承接數字，力量格使用實心填色和空格外框。 |
| 藍招 | 外框 `#1B477E`、亮框 `#58B6FF`、圖示 `#E4F7FF` | 攻方頭頂出現圓角方框，框內放白色手勢。 |
| 紅招 | 暗輪廓 `#691E37`、邊線 `#FF4F62`、亮芯 `#FFD0A1`、斜紋 `#FF9A78`、地面填色 `#AF263D` | 地面顯示兩格斜線危險帶，攻方肩和武器出現紅色蓄力邊光。 |
| 安全方向 | 亮面 `#FFF5D8`、描邊 `#151822` | 防方腳邊亮出實心方向箭頭，危險紅區上也能讀到方向。 |
| 命中與擊落 | 命中芯 `#FFF7E5`、火花 `#FFC878`；光柱芯 `#FFF3D8`、光柱邊 `#FFBE78`、外焰 `#D77769` | 普通命中用短火花，擊落用米白至琥珀的垂直光柱。 |

損傷顏色用階梯換色。以下是美術分級初值，擊飛和扣命由遊戲規則決定。

| 顯示損傷 | 字色 | 次要提示 |
| --- | --- | --- |
| 0–39% | 白 `#F4F6FA` | 24 px 固定字寬數字。 |
| 40–69% | 黃 `#FFE186` | 保持同一字寬與輪廓。 |
| 70–99% | 橘 `#FFAA63` | 同上。 |
| 100% 以上 | 深紅 `#E05266` | 字形頂邊加 1 px 淺紅 `#FFD7D9` 提亮，數字外側飄最多三顆 `#7D374D` 煙點，煙高最多 8 px。 |

## 2　前搖剪影與藏招

架式切換後，**第 0 格就給完整、可辨識的剪影**。後面幾格只讓呼吸、衣角或武器浮動 1–2 px。美術上用 **1,300 ms 公開架式＋500 ms 藏招**作時間分配，切換瞬間以遊戲事件為準。

| 手勢 | 一眼看到的輪廓 | 48 px 畫布內的畫法 |
| --- | --- | --- |
| 石頭 `stance_rock` | **高、重、一整塊。** | 雙手舉起一顆約 11 × 8 px 的方錘頭，置於頭頂前側，錘柄斜過肩。前腿扎穩，背後留空。黑稿會先看到一個明顯高點。 |
| 剪刀 `stance_scissors` | **低、尖、兩條線。** | 蹲低前傾，兩把短刃朝正前方伸出。刀尖相差 4–6 px 高度，中間保留至少 3 px 空隙。避免交叉成單一大方塊。 |
| 布 `stance_paper` | **寬、開、兩個掌面。** | 雙肘向外，一手前上、一手前下，約 5 px 寬的手掌能從前臂分出來。兩掌與胸口留空，能看到一個開放的框形。 |
| 藏招 `stance_hidden` | **雙方都回到收手黑影。** | 到藏招瞬間直接切入共用收手姿勢。清掉上一架式的武器、粒子、殘影與對手可見的手勢圖示。藏招期間可沿用隊伍角標或衣領辨識色，但不能跟著新手勢改輪廓。自己的按鍵列仍能回饋已選手勢。 |

先把三種架式全塗成實色，左右鏡像各看一次。即使拿掉隊伍配色、武器高光和字幕，也應能看出「高方錘、低雙尖、寬雙掌」。如果兩把刀在縮放後黏成一條，先拉開間距。

## 3　兩種終結技的第一幀

| | 藍光普通終結技 | 紅光強化重擊 |
| --- | --- | --- |
| 第一眼的位置 | 攻方頭頂。 | 地面兩格與防方腳邊。 |
| 形狀 | 24 × 24 px 圓角方框，內含 14 × 14 px 猜拳圖示。 | 兩格斜紋警示帶，以及 12 × 10 px 的實心 `◀` 或 `▶`。 |
| 倒數 | 藍框周邊由滿逐段退去，最後一段消失到截止。 | 箭頭下方一條橫向倒數短線，危險帶的斜紋可沿同一方向以 80 ms 一步慢移。 |
| 玩家要按什麼 | 底部三格都切成猜拳圖示。頭頂只顯示攻擊手勢，防方自己找克制鍵。 | 底部兩側切成左右方向，中央灰停。把遊戲已確認可翻滾的方向提亮，並和腳邊的箭頭一致。 |

**藍招。** 從攻方腳底錨點垂直上移 55 px 當圖示中心。在常態地面高度，中心約 `y=129`，武器舉高時也有空間。圖示固定於腳底座標換算的位置，避免跟著頭部動畫上下抖。提示出現第一幀就是全尺寸，倒數圈只負責顯示剩餘時間。藍招接受區間是 `cueAt ≤ now < deadlineAt`，其中 `deadlineAt = cueAt + 500 ms`。畫面不用顯示另外一道 220 ms 內圈。

**紅招。** 攻方蓄力時，地台上緣鎖定相鄰兩格，每格整段填色並蓋 6 px 高斜紋帶。先顯示完整邊界再移動斜紋，危險範圍由程式傳入兩個格子索引，格子位置從提示亮起到收招都固定。防方腳底往安全方向側移 14 px、上移 7 px 放箭頭。左右以螢幕方向解讀，角色轉身後也不翻轉箭頭。紅招建議也以 500 ms 做第一輪手感測試。截止前若確認翻滾成功，先以遊戲判定位置結算，短剩餘時間可從團身幀接到落地，讓畫面跟得上結果。用程式提供的安全方向畫箭頭，如果沒有合法落點，交由規則層處理，畫面不自行猜哪一邊安全。

**提示優先。** 藍框、紅區和方向箭頭都用形狀、位置和時間變化區分。減少動態時保留完整框形、固定斜紋與倒數。藍招與紅招的警示由終結技種類單獨啟用；兩種提示都不被火花、背景煙霧或 HUD 蓋住。

## 4　命中、翻滾與擊落

| 事件 | 起手與接觸 | 視覺頓幀 |
| --- | --- | --- |
| 拼刀 | 接觸點亮 3–5 顆方形火花，兩人各退一步。 | 45 ms，世界層位移上限 1 px。 |
| `combo_1` | 短接近、打點收緊。受擊方一拍輪廓反白，能看清第一段推擠。 | 36 ms，1 px 震動。 |
| `combo_2` | 肩與髖轉得更大，推擠方向明確；用 2–3 張像素殘影接上。 | 48 ms，2 px 震動。 |
| 普通／紅招命中 | 普通終結技用短亮的武器弧；紅招用寬地裂與向外甩開的碎片。落空沿用收招動畫。 | 普通 68 ms／2 px；紅招 86 ms／3 px。 |
| `parry_success` | 接觸點向外擴一個輪廓環，兩人短暫亮邊；頓幀完再演跨身換位。 | 120 ms，局部反白上限 42 ms，2 px 震動。 |
| `roll` | 壓低重心、團身、伸腿落地；方向與按鍵一致。腳邊留 1–2 張暗殘影，讓路線看得懂。 | 連續播放，落點跟隨遊戲結算。 |
| `knockback`／KO | 被打中時身體先順發射向拉長，後續做翻身循環。扣命時在對應場外側豎起光柱。 | 光柱 40 ms 細升、90 ms 亮芯、250 ms 淡出。峰值 22 px，4 px 震動。 |

一般命中只在受擊精靈上反白 **33 ms**。總共最多三張殘影，每隔 24 ms 取樣，從近到遠透明度為 `0.42 / 0.26 / 0.12`，最晚 96 ms 消失。殘影只跟角色色或材質，不帶終結警示色。提示出現時讓世界鏡頭回到穩定位置；頓幀只停角色與命中特效的演出，倒數和輸入仍繼續。KO 由實際扣命事件觸發，左、右光柱建議固定於 `x=16 / 464`。下墜 KO 可沿墜落 x 位置出光柱，鏡頭外時才夾到內側安全邊界。光柱從 `y=224` 往上長，底部 HUD 仍固定。

## 5　三鍵 HUD 與繪製順序

- **左右上角。** P1 從 `(16,12)` 往右對齊，P2 從 `(464,12)` 往左。第一排是 24 px 損傷，第二排放 3 個 `8 × 8 px` 命數圖示，第三排放 3 個 `11 × 5 px` 力量格。三條命可填實或空心，力量使用短橫槓，拿掉顏色依然看得出差別。
- **底部中間。** 三格每格 `30 × 25 px`，間隔 5 px，`topY=232`。從左到右分別為石頭／剪刀／布或左／停用／右。三格位置不換。可在每格下緣顯示玩家原本綁定的按鍵小字。輸入成功時內框往下壓 1 px 並亮一次，無效方向保留暗輪廓。方向鍵位和角色鏡像無關。
- **依階段重用。** 走位和紅招防守顯示方向；猜拳、藏招、攻方可選招時及藍招防守顯示手勢；不能操作時把對應格淡出。在同機雙人原型，底部三格是共用階段圖例，角色頭頂和腳邊提示負責指向當前攻防方；若每人看到自己的 HUD，同一套圖示可依該玩家角色啟用。
- **畫面由後往前。** 背景 → 平台 → 紅區填色與斜紋 → 殘影 → 角色 → 命中粒子與 KO → 紅格邊線、藍框和方向箭頭 → HUD。世界層震動以整數像素位移，平台和世界警示採同一投影，HUD 不跟著震動。
- **保持像素尺寸。** 建議先繪至 `480 × 270` 的邏輯畫布，關閉平滑，再以整數倍率放大。視窗剩餘空間留邊，輸出以整數座標取樣。每次重設 Canvas 尺寸後重新套用平滑設定。

## 6　角色 Sprite Sheet 與動畫幀

角色動畫共 **16 個**，沿用提供的全部狀態名稱。兩名角色各輸出一張透明 PNG，使用同一張切格表。每張 **500 × 800 px**，10 欄 × 16 列，每欄列佔 `50 × 50`，中央是 `48 × 48` 實際畫布，四側各留 1 px 透明間距。每個狀態從該列最左開始，剩下未使用的格子保持透明。角色預設面右，腳底錨點固定在本地 `(24,40)`。需要面左時以錨點鏡像；世界座標只由遊戲邏輯驅動。

| 列索引 | 狀態 | 幀數／FPS | 主要動作與播放方式 |
| ---: | --- | ---: | --- |
| 0 | `idle` | 6／10 | 站姿、吸氣、落肩；循環。腳底固定。 |
| 1 | `step` | 5／24 | 壓腳 → 蹬地 → 側移 → 落腳 → 回穩。第 1 格蹬、第 3 格落。 |
| 2 | `exhausted` | 6／12 | 二連移動後剎步，彎腰喘氣，肩下沉再抬頭。腳底留在第二步終點。實際能恢復輸入的時點由遊戲狀態切換。 |
| 3 | `stance_rock` | 4／12 | 第 0 格已舉起高方錘。後續只讓錘柄和肩下沉 1 px。循環。 |
| 4 | `stance_scissors` | 4／12 | 第 0 格就亮出雙刃尖，前傾蓄勢，保留雙尖間距。循環。 |
| 5 | `stance_paper` | 4／12 | 第 0 格雙掌已展開，吸氣時手掌輕移。循環。 |
| 6 | `stance_hidden` | 4／8 | 第 0 格直接換成收手黑影；只留小幅衣角變化，最後一格維持到藏招結束。 |
| 7 | `clash` | 5／24 | 第 1 格武器接觸，第 3 格雙方彈開。火花由程式產生。 |
| 8 | `combo_1` | 5／24 | 壓身、跨步、短打。第 2 格接觸，第 4 格收臂。 |
| 9 | `combo_2` | 6／24 | 轉髖、上步、大幅揮擊。第 3 格接觸，第 5 格回收。 |
| 10 | `finisher_blue` | 10／16 | 第 0–7 格是蓄力，第 8 格命中，第 9 格收招。頭頂手勢框走獨立特效層。 |
| 11 | `finisher_red` | 10／16 | 第 0–7 格先壓身蓄力再升武器，第 8 格重砸，第 9 格隨重量回收。紅區和箭頭由程式繪製。 |
| 12 | `parry_success` | 6／24 | 第 0 格接招，第 1 格架住，第 3 格跨身，第 5 格落位。換位座標跟遊戲事件。 |
| 13 | `roll` | 6／24 | 第 0 格蹲，第 2 格團身，第 4 格腳踩地，第 5 格起身。 |
| 14 | `hitstun` | 4／20 | 第 0 格肩先退，第 2 格踉蹌，最後一格守到允許恢復。 |
| 15 | `knockback` | 6／18 | 第 0 格發射，第 1 格抽身，第 2–5 格在空中循環。落地或出界事件終止。 |

切圖用 0 起算。假設 `animation = spec.spriteAtlas.animations[state]`，第 `f` 格用 `sx = 1 + 50*f` 與 `sy = 1 + 50*animation.row`，源矩形寬高都是 48。將腳底 `(24,40)` 對齊遊戲角色位置。JSON 裡的 `contact` 錨點是建議的火花位置。遊戲若已提供雙方實際接觸點，火花以該座標為準。

第一批圖的藍招可共用跨步揮擊，猜拳屬性由頭頂圖示顯示；紅招先共用雙手下砸。若後續要讓每種普通終結技真的揮不同武器，再為 `finisher_blue` 加圖像變體，沿用相同的時間軸和 HUD。

## 7　交給 Claude 的串接約定

[`art_spec.json`](art_spec.json) 是視覺設定。所有時間一律毫秒、位置一律虛擬像素。`palette.damageBands` 以顯示整數損傷值套色，`maxInclusive: null` 表示以上所有值。`powerCount`、`stockCount` 管 HUD 格數，當前填滿幾格讀對戰狀態。

遊戲向畫面提供 `phase`、`cueAt`、`deadlineAt`、`attackerId`、`defenderId`、招式手勢、危險格索引及安全翻滾方向。畫面以遊戲時鐘和這些欄位顯示提示，下個畫面更新時立刻顯示正確剩餘量。全部結束時間以遊戲邏輯為準，Sprite FPS 都是建議播放速度。以預設 16 FPS 播放時，終結技的前八格正好 500 ms；如果測試改了時窗，把第 0–7 格映射到新的提示時間，第 8 格仍在接觸事件上播放。命中、彈反、換位和 KO 只在程式確認事件後播對應演出。`hold_last` 代表播放完停最後一格，`tail_loop` 代表首段只播一次，從 `loopStartFrame` 開始循環，`event_driven` 代表接觸幀和結算事件對齊。正式圖檔完成後依 JSON 的 `imageByPlayer` 檔名接入。

## 8　AI 生圖英文 Prompt

**Prompt A · 武者設計與前搖剪影參考**

```text
Create an original 2D pixel-art concept sheet for a side-view 1v1 browser platform fighter. Show two full-body martial artists, both in strict profile facing screen right, on a plain slate background. Use a crisp 16-bit arcade sprite aesthetic with hand-placed hard square pixels, 1-pixel stepped outlines, flat cel shading, and restrained readable detail. Give fighter A a burnt-ochre jacket (#D58941), ivory shoulder plate and belt (#FFF0C3), a squared shoulder silhouette, and dark outline (#10121B). Give fighter B a jade jacket (#4BB381), pale mint collar and split short cloak (#C6F9D8), and a low angled shoulder silhouette. They have identical sprite scale and comparable reach. Design them to remain readable in a native 48-by-48 pixel frame, with the body about 18 by 26 pixels and room for the weapon. Show each fighter in three clearly distinct windup poses at the same foot baseline: (1) ROCK, a broad rectangular hammer head raised above the shoulder, with one high block silhouette; (2) SCISSORS, a low forward lean with two parallel pointed short blades separated by a visible dark gap; (3) PAPER, elbows wide and both flat palms visible, one high and one low, with open negative space between the palms and torso. Arrange the same three poses in a second pass as solid black silhouettes. Keep the figures original, clean, and readable even at thumbnail size. No labels, no environmental scenery, no UI, no ground effects, no large bloom, no anti-aliasing, no painterly textures, no perspective or three-quarter views.
```

**Prompt B · 紅招 Sprite Strip 候選稿**

```text
Create a game sprite strip for the red finisher of the attached original ochre fighter. Preserve the reference character's head, face, ivory shoulder plate, belt, proportions, pixel clusters, and hammer shape in every frame. Strict 2D side view, facing screen right throughout. Exactly ten frames in one horizontal row on a transparent background, visual target canvas 500 pixels by 50 pixels. Each slot is 50 by 50 pixels with a centered 48-by-48 pixel active frame and a 1-pixel transparent border on all sides. Use local foot pivot (24, 40) within the active frame as a shared baseline in all frames. Frame 0: low planted ready pose. Frame 1: knees compress. Frame 2: shift the hammer back. Frame 3: rotate the shoulder and grip. Frame 4: raise the hammer overhead. Frame 5: settle under the hammer. Frame 6: hold the loaded arc. Frame 7: lean into the last windup. Frame 8: heavy downward strike, with the hammer still entirely inside the cell. Frame 9: low heavy follow-through with the front foot planted. Keep body scale fixed. Use clean hand-placed pixel clusters, hard alpha edges, and the reference palette. No text, numbers, grid lines, background, floor, drop shadow, camera changes, duplicated frames, interpolated blur, or cropping. Exclude hit sparks, danger stripes, glows, arrows, and motion trails so the game can draw those separately.
```

用 Prompt B 的格式一次做一個狀態，把幀數、動作和角色參考換掉。生圖是動作候選稿。最終需人工校正透明底、固定腳底、武器長度、實際畫布尺寸及逐格位置，再排入正式表格；光效、HUD 和傷害字不烘進 PNG。左右鏡像用程式跑一次，確認接觸點也跟著翻。

## 9　驗收時看哪裡

1. **200 ms 辨識測試。** 從開頭只放 200 ms 提示後遮畫面，讓試玩者選「彈反」或「翻滾」。將普通版與灰階版隨機交錯，並覆蓋中央、右崖、左崖、雙方靠很近。先以至少 90% 分對作原型目標；另記錄完整視窗內的真正按鍵成功率。
2. **同一套提示連續看。** 紅招的兩格面積從開始到命中維持一致，紅箭頭和底部方向永遠吻合。藏招第一幀移除上一手勢的武器殘影。兩人靠近時，藍框仍掛在正確攻方上方。
3. **像素與時間。** 用 1× 和 2× 檢查輪廓、斜紋與數字。驗證讀入 JSON 後，每個狀態都能切到指定格；命中與彈反凍結時畫面倒數仍跟遊戲時鐘。最後用灰階與減少動態各跑一場，確認警示認得出來。
