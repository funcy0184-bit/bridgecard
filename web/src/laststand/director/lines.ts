// 梭了啦 P2 文案庫（新寫的；V2 原文不在這裡，照舊放在 copy/laststand_v2_copywriting.json，一字不改）
//   on：哪一件事會叫出這則（只有真的發生的事會叫）；need／not：額外條件（director.ts 的 flagsOf 算）
//   填空：{p} 主角、{o} 對手、{to} 每人押到幾、{amount} 實際移動、{pool} 疊池、{streak} 連續幾墩、{count} 第幾次、
//         {trick} 第幾墩、{dir} 比大／比小、{win}/{lose} 這一墩的贏家／輸家、{lead}/{trail} 領先／落後的人、{gap} 差幾枚、
//         {hp}/{ho} 主角／對手持有、{from} 原本、{now} 現在、{p0}/{p1}/{stake0}/{stake1}/{vow} 契約、{cardW}/{cardL} 翻開的牌
//   語氣：平常冷靜、一本正經講幹話；玩家越荒謬，賽事單位越認真；不要每句都硬塞笑點
import type { BeatType, Channel, ProgramId } from "./types";

export type Who = string;
export interface Tpl {
  id: string;
  on: BeatType | `react${1 | 2 | 3 | 4}` | `mid:${"raise" | "trail" | "pool" | "expert"}` | "vow_echo";
  channel: Channel;
  program?: ProgramId;
  title?: string;
  lines: (string | [Who, string])[];
  need?: string[];
  not?: string[];
}

const chat = (id: string, on: Tpl["on"], text: string, need?: string[], not?: string[]): Tpl => ({ id, on, channel: "chat", lines: [text], need, not });
const anchor = (id: string, on: Tpl["on"], text: string, need?: string[], not?: string[]): Tpl => ({ id, on, channel: "anchor", lines: [text], need, not });
const notice = (id: string, on: Tpl["on"], text: string, need?: string[], not?: string[]): Tpl => ({ id, on, channel: "notice", lines: [text], need, not });
const card = (id: string, on: Tpl["on"], program: ProgramId, title: string, lines: Tpl["lines"], need?: string[], not?: string[]): Tpl => ({ id, on, channel: "card", program, title, lines, need, not });

export const LINES: Tpl[] = [
  // ================= 即時：聊天室、主播、公告 =================
  // 第一次加注
  chat("P2-001", "raise_first", "欸？開始了喔。"),
  chat("P2-002", "raise_first", "第一次加注，現場氣氛突然有了。"),
  chat("P2-003", "raise_first", "{p}按了加注。大家先不要慌。"),
  chat("P2-004", "raise_first", "這是在試水溫，還是真的有東西？"),
  anchor("P2-005", "raise_first", "{p}決定讓這一墩有點意義。"),
  chat("P2-006", "raise_first", "注意，有人開始認真了。"),
  // 之後的普通加注
  chat("P2-010", "raise", "{p}又加了。"),
  chat("P2-011", "raise", "這已經是{p}本場第 {count} 次加注。"),
  chat("P2-012", "raise", "這顆按鈕今天特別忙。"),
  chat("P2-013", "raise", "又來了又來了。"),
  // 連續三墩加注
  chat("P2-020", "raise_streak3", "他是不是不會按過牌？"),
  chat("P2-021", "raise_streak3", "連續三墩加注，{p}的手指已經有自己的想法了。"),
  anchor("P2-022", "raise_streak3", "{p}連續三墩加注，賽事單位開始做筆記。"),
  chat("P2-023", "raise_streak3", "請問一下，過牌那顆是壞掉了嗎？"),
  chat("P2-024", "raise_streak3", "第三墩了，過牌按鈕表示：我還在。"),
  // 連續四墩以上（記仇）
  notice("P2-030", "raise_streak_more", "相關單位已不再感到意外。"),
  anchor("P2-031", "raise_streak_more", "{p}連續第 {streak} 墩加注，本台決定不再另行報導。"),
  chat("P2-032", "raise_streak_more", "{p}又加注了。這句我們可以直接存起來重播。"),
  chat("P2-033", "raise_streak_more", "連續 {streak} 墩，加注對他來說已經是一種生活方式。"),
  chat("P2-034", "raise_streak_more", "好啦，我們知道了。"),
  // 反加
  chat("P2-040", "reraise", "你不服，他也不服。"),
  chat("P2-041", "reraise", "反加！這一墩突然變成私人恩怨。"),
  anchor("P2-042", "reraise", "{p}反加到 {to} 枚，現場空氣凝結。"),
  chat("P2-043", "reraise", "好，現在雙方都很有意見。"),
  chat("P2-044", "reraise", "請問兩位平常講話也這樣嗎？"),
  // 加到有效上限
  chat("P2-050", "raise_cap", "這邊是有必要押成這樣？"),
  anchor("P2-051", "raise_cap", "{p}直接加到這一墩的上限 {to} 枚，沒有猶豫。"),
  chat("P2-052", "raise_cap", "上限就在那裡，{p}就去了。"),
  chat("P2-053", "raise_cap", "加到頂了。按鈕表示右邊已經沒有了。"),
  // 高額出價（對方還沒回答）
  anchor("P2-060", "big_offer", "{p}要把這一墩押到每人 {to} 枚！{o}還在考慮。"),
  anchor("P2-061", "big_offer", "{p}出價：每人 {to} 枚。現在看{o}接不接。"),
  anchor("P2-062", "big_offer", "{to} 枚！{p}提出了，{o}還沒回答。"),
  // 梭哈出價（對方還沒回答）
  anchor("P2-070", "allin_offer", "{p}梭哈：每人押到 {to} 枚！{o}還在考慮。"),
  anchor("P2-071", "allin_offer", "梭了！{p}把這一墩推到每人 {to} 枚，球在{o}手上。"),
  anchor("P2-072", "allin_offer", "{p}說要梭。全場安靜，等{o}回答。"),
  chat("P2-073", "allin_offer", "每人 {to} 枚？{o}你先深呼吸。"),
  // 接戰
  chat("P2-080", "call", "{p}接了。"),
  chat("P2-081", "call", "跟。很好，很穩。"),
  chat("P2-082", "call", "雙方各押 {to} 枚，翻牌見。"),
  anchor("P2-085", "big_call", "{p}居然跟了！現在雙方各押 {to} 枚。"),
  anchor("P2-086", "big_call", "接了！雙方各押 {to} 枚，誰都別想反悔。"),
  chat("P2-087", "big_call", "跟了跟了！{to} 枚對 {to} 枚！"),
  anchor("P2-088", "big_call", "{p}接戰。這一墩正式變成大事。"),
  // 梭哈被接
  anchor("P2-090", "allin_called", "{p}接了梭哈！雙方各押 {to} 枚。"),
  anchor("P2-091", "allin_called", "接了！這一墩每人 {to} 枚，各位請坐好。"),
  notice("P2-092", "allin_called", "梭哈已被接戰。賽事單位請大家保持冷靜，主要是請自己保持冷靜。"),
  chat("P2-093", "allin_called", "這不是演習，雙方各押 {to} 枚。"),
  // 第九墩梭哈被接
  anchor("P2-095", "allin_called_final", "各位，這邊真的沒下一墩可以補了。"),
  anchor("P2-096", "allin_called_final", "第九墩梭哈被接，雙方各押 {to} 枚。後面沒有了，真的沒有了。"),
  chat("P2-097", "allin_called_final", "最後一墩、各押 {to} 枚，這就是全部了。"),
  // 梭哈沒人接
  anchor("P2-100", "allin_folded", "{p}沒有接梭哈，這一墩到此為止。"),
  chat("P2-101", "allin_folded", "梭哈的人表示：我還沒表演完欸。"),
  chat("P2-102", "allin_folded", "{p}選擇保留實力。或保留籌碼，看你怎麼說。"),
  // 有壓力的棄牌
  anchor("P2-105", "big_fold", "{p}在每人 {to} 枚前面停下來了。"),
  chat("P2-106", "big_fold", "這個價錢，{p}不買。"),
  chat("P2-107", "big_fold", "壓力太大，{p}先撤。"),
  // 棄牌
  chat("P2-110", "fold", "喔，突然想通了。"),
  chat("P2-111", "fold", "{p}棄牌，帶著一部分的尊嚴離開。"),
  chat("P2-112", "fold", "撤退也是一種戰術，大概。"),
  chat("P2-113", "fold", "{p}：這墩不算，下一墩再說。"),
  chat("P2-114", "fold", "懂得放下，是一種成熟。"),
  // 連續三墩棄牌
  anchor("P2-120", "fold_streak3", "這位選手今天主要負責保護籌碼。"),
  chat("P2-121", "fold_streak3", "{p}連續三墩棄牌，籌碼保育成效良好。"),
  chat("P2-122", "fold_streak3", "三連棄。{p}的牌好像都不太想上場。"),
  chat("P2-123", "fold_streak3", "{p}：我只是在等一手好牌。（第三墩）"),
  // 讀心後棄牌
  chat("P2-130", "insight_fold", "他看完之後決定尊重對手。"),
  chat("P2-131", "insight_fold", "讀心、看完、棄牌。資訊確實有被使用。"),
  chat("P2-132", "insight_fold", "{p}用了讀心，然後……就沒有然後了。"),
  chat("P2-133", "insight_fold", "知道得越多，籌碼留得越多。{p}如是說。"),
  // 一直加注的人第一次棄牌（記仇）
  notice("P2-140", "fold_after_raiser", "經過長時間的觀察，他終於發現其他按鈕也可以按。"),
  anchor("P2-141", "fold_after_raiser", "{p}加注 {count} 次之後第一次棄牌。賽事單位已記錄此歷史時刻。"),
  chat("P2-142", "fold_after_raiser", "原來{p}也會棄牌。今天又學到了一課。"),
  // 保命
  chat("P2-150", "safeguard", "這個操作充滿求生意志。"),
  notice("P2-151", "safeguard", "{p}保命：這一墩每人只押 1 枚，不能加注。"),
  chat("P2-152", "safeguard", "保命。聽起來很有道理，看起來也很有道理。"),
  chat("P2-153", "safeguard", "穩一點好，穩一點好。"),
  chat("P2-155", "safeguard_result", "保命墩，{p}還順手贏了。", ["won"]),
  anchor("P2-156", "safeguard_result", "保命省下 {amount} 枚。輸是輸了，但輸得很省。", ["lost", "saved2"]),
  chat("P2-157", "safeguard_result", "保命墩，{p}少輸一點。", ["lost"], ["saved2"]),
  chat("P2-158", "safeguard_result", "保命墩同點。保命保得非常徹底。", ["tieTrick"]),
  // 翻轉、翻轉後輸
  chat("P2-160", "flip", "{p}把這一墩翻成{dir}。"),
  chat("P2-161", "flip", "今天的大小，由{p}決定。"),
  chat("P2-170", "flip_lost", "規則是他改的，牌也是他輸的。"),
  chat("P2-171", "flip_lost", "{p}親手翻的方向，親手輸掉，完整度很高。"),
  anchor("P2-172", "flip_lost", "翻轉後落敗。這個決定目前由{p}本人全權負責。"),
  // 讀心
  chat("P2-180", "insight", "{p}用了讀心。看到什麼只有他知道。"),
  chat("P2-181", "insight", "讀心！{p}偷看了一下對面鎖的是大、中還是小。"),
  // 同點、疊池
  chat("P2-190", "tie", "他們兩個到底在幹嘛？"),
  notice("P2-191", "tie", "同點！雙方押的全部進疊池，現在 {pool} 枚。"),
  chat("P2-192", "tie", "一樣大。這一墩的結論是：沒有結論。"),
  chat("P2-193", "tie", "我就說他們很有默契。"),
  chat("P2-200", "tie_pool_grow", "上一墩的問題還沒處理完欸。"),
  notice("P2-201", "tie_pool_grow", "疊池又長大了：現在 {pool} 枚。"),
  chat("P2-202", "tie_pool_grow", "同點再同點，疊池 {pool} 枚，越疊越高。"),
  anchor("P2-210", "pool_taken", "{p}把疊池 {amount} 枚一起帶走。"),
  chat("P2-211", "pool_taken", "疊池終於有主人了：{p}。"),
  // 大幅移動、結果
  anchor("P2-220", "big_swing", "{p}這一墩少了 {amount} 枚。"),
  chat("P2-221", "big_swing", "這一墩動到 {amount} 枚，帳本翻頁了。"),
  anchor("P2-230", "big_result", "翻牌！{win}的{cardW}對上{lose}的{cardL}，{win}拿下這一墩。", ["decidedTrick"]),
  anchor("P2-231", "big_result", "翻牌結果：{win}贏下各押 {amount} 枚的這一墩。", ["decidedTrick"]),
  anchor("P2-235", "big_result", "翻牌！同點，各押 {amount} 枚全部進疊池。", ["tieTrick"]),
  // 連輸、逆轉
  chat("P2-240", "lose_streak3", "{p}已經連續輸掉三墩了。"),
  chat("P2-241", "lose_streak3", "三連敗。{p}：我在醞釀。"),
  chat("P2-250", "comeback", "等等，現在誰領先？"),
  anchor("P2-251", "comeback", "逆轉！{p}現在領先，{hp} 比 {ho}。"),
  chat("P2-252", "comeback", "{p}超車了。剛剛落後的人，現在領先了。"),
  // 退款、最後一墩、歸零、結束
  notice("P2-260", "refund", "疊池退款：沒人拿得走，就各自拿回去。"),
  notice("P2-261", "refund", "疊池依規定退回雙方。賽事單位表示：帳是平的。"),
  notice("P2-265", "final_trick", "第九墩。最後一墩，大家把握。"),
  anchor("P2-266", "final_trick", "最後一墩。打完這一墩，今天就有結論了。"),
  notice("P2-270", "eliminated", "{p}籌碼歸零。"),
  notice("P2-275", "match_over", "比賽結束：{win}獲勝。", ["decided"]),
  notice("P2-276", "match_over", "比賽結束：雙方平手。", ["draw"]),
  // 豪言回放（V2 的 vow_echo 之外的新句）
  chat("P2-280", "vow_echo", "開局好像有人說過「{vow}」？"),
  chat("P2-281", "vow_echo", "{p}賽前說過：「{vow}」——我只是複誦。"),

  // ================= 觀眾反應（依下注壓力，補在主彈幕後面）=================
  chat("P2-300", "react1", "嗯。"),
  chat("P2-301", "react1", "有在看，有在看。"),
  chat("P2-302", "react1", "先記下來。"),
  chat("P2-310", "react2", "有點東西喔。"),
  chat("P2-311", "react2", "這墩開始有味道了。"),
  chat("P2-312", "react2", "觀眾席有人坐直了。"),
  chat("P2-320", "react3", "現場開始騷動。"),
  chat("P2-321", "react3", "我先去倒杯水，你們不要動。"),
  chat("P2-322", "react3", "這邊可以先暫停一下嗎？"),
  chat("P2-323", "react3", "我心跳比籌碼還多。"),
  chat("P2-330", "react4", "聊天室已經失控。"),
  chat("P2-331", "react4", "大家冷靜，主要是我要冷靜。"),
  chat("P2-332", "react4", "我站起來了，我不知道為什麼。"),
  chat("P2-333", "react4", "這不是牌局，這是人生。"),

  // ================= 節目小卡：體育台 =================
  card("P2-400", "lose_streak3", "sports", "體育台｜賽中連線", [
    ["主播", "目前{p}已經連續失去三墩。"], ["球評", "是的，這對他的獲勝計畫造成了一定程度的影響。"],
    ["主播", "請問該如何改善？"], ["球評", "首先應該停止輸掉比賽。"]]),
  card("P2-401", "lose_streak3", "sports", "體育台｜賽中連線", [
    ["主播", "{p}連輸三墩，你怎麼看？"], ["球評", "我看到的是，連續三墩都沒有贏。"],
    ["主播", "這跟連輸三墩有什麼不同？"], ["球評", "沒有不同，所以我很擔心。"]]),
  card("P2-402", "lose_streak3", "sports", "體育台｜數據時間", [
    ["主播", "{p}這三墩都輸給了{o}。"], ["球評", "從數據來看，{o}比較常贏。"],
    ["主播", "這個數據怎麼來的？"], ["球評", "我數的。"]]),
  card("P2-410", "comeback", "sports", "體育台｜緊急插播", [
    ["主播", "等等，現在誰領先？"], ["球評", "{p}。"], ["主播", "剛剛不是{o}嗎？"], ["球評", "剛剛是剛剛。"]]),
  card("P2-411", "comeback", "sports", "體育台｜逆轉時刻", [
    ["主播", "{p}完成逆轉，目前 {hp} 比 {ho}。"], ["球評", "我一直相信他會比較多。"],
    ["主播", "你上一墩說他沒機會。"], ["球評", "那是上一墩的我。"]]),
  card("P2-412", "comeback", "sports", "體育台｜賽中分析", [
    ["球評", "這就是比賽，籌碼會從一邊跑到另一邊。"], ["主播", "這不就是規則嗎？"], ["球評", "對，所以很精彩。"]]),
  card("P2-420", "allin_called_final", "sports", "體育台｜決勝時刻", [
    ["主播", "第九墩，梭哈被接，雙方各押 {to} 枚。"], ["球評", "這一墩之後，就沒有下一墩了。"],
    ["主播", "所以？"], ["球評", "所以這是最後一墩。"]]),
  card("P2-421", "allin_called_final", "sports", "體育台｜決勝時刻", [
    ["主播", "各位，這邊真的沒下一墩可以補了。"], ["球評", "我建議雙方把握這一墩。"], ["主播", "他們也沒有別墩可以把握了。"]]),
  card("P2-430", "big_result", "sports", "體育台｜翻牌回放", [
    ["主播", "翻牌！{win}贏下各押 {amount} 枚的這一墩。"], ["球評", "關鍵在於他的牌比較{dirword}。"],
    ["主播", "這一墩本來就是{dir}。"], ["球評", "對，所以是關鍵。"]], ["decidedTrick"]),
  card("P2-431", "big_result", "sports", "體育台｜翻牌回放", [
    ["主播", "{win}拿下這一墩，{lose}這邊各押了 {amount} 枚。"], ["球評", "這種時候，牌比較好的人通常會贏。"], ["主播", "通常？"], ["球評", "這一墩是。"]], ["decidedTrick"]),

  // ================= 節目小卡：財經台 =================
  card("P2-500", "big_swing", "finance", "財經台｜盤中快報", [
    "{p}持有籌碼出現明顯下跌，由 {from} 枚來到 {now} 枚。", "市場目前保持高度關注。",
    ["分析師", "籌碼減少的主要原因，是因為他失去了籌碼。"]]),
  card("P2-501", "big_swing", "finance", "財經台｜盤中快報", [
    "{win}持有籌碼單墩上漲 {amount} 枚，市場一片看好。", ["分析師", "建議持有者繼續持有。"],
    ["主播", "那沒有持有的人呢？"], ["分析師", "建議開始持有。"]]),
  card("P2-502", "big_swing", "finance", "財經台｜盤中快報", [
    "本台快報：{p}的籌碼部位遭遇修正。", ["分析師", "這是一次健康的回檔。"], ["主播", "他少了 {amount} 枚。"], ["分析師", "對，非常健康。"]]),
  card("P2-510", "pool_taken", "finance", "財經台｜併購快訊", [
    "疊池 {amount} 枚，正式由{p}收購。", ["分析師", "這是本場重要的一筆併購案。"], ["主播", "收購價多少？"], ["分析師", "翻贏一墩。"]]),
  card("P2-511", "pool_taken", "finance", "財經台｜併購快訊", [
    "{p}一口氣帶走疊池 {amount} 枚。", ["分析師", "長期持有疊池的策略，終於有人出場了。"]]),
  card("P2-520", "tie_pool_grow", "finance", "財經台｜市場觀察", [
    "疊池規模來到 {pool} 枚，目前無人認領。", ["分析師", "我們預期它會繼續被放在那裡，直到有人拿走。"]]),
  card("P2-521", "tie_pool_grow", "finance", "財經台｜市場觀察", [
    "疊池再度擴大至 {pool} 枚。", ["主播", "這筆錢現在是誰的？"], ["分析師", "目前是大家的。"], ["主播", "大家是誰？"], ["分析師", "就他們兩個。"]]),

  // ================= 節目小卡：賭桌法庭 =================
  card("P2-600", "reraise", "court", "賭桌法庭｜當庭訊問", [
    ["法官", "被告{p}是否承認自己按下反加注？"], ["被告", "……"], ["法官", "本庭已取得相關按鈕紀錄。"]]),
  card("P2-601", "reraise", "court", "賭桌法庭｜當庭訊問", [
    ["法官", "{p}，你在{o}加注之後反加到 {to} 枚，有什麼要說的？"], ["被告", "我不服。"], ["法官", "本庭看得出來。"]]),
  card("P2-602", "reraise", "court", "賭桌法庭｜第一審", [
    ["檢方", "被告在第 {trick} 墩反加注。"], ["法官", "反加注犯法嗎？"], ["檢方", "不犯法。"],
    ["法官", "那你為什麼要說？"], ["檢方", "因為很可疑。"]]),
  card("P2-610", "flip_lost", "court", "賭桌法庭｜當庭訊問", [
    ["法官", "被告{p}，這一墩的方向是誰改的？"], ["被告", "我。"], ["法官", "這一墩是誰輸的？"], ["被告", "……我。"], ["法官", "本庭沒有其他問題。"]]),
  card("P2-611", "flip_lost", "court", "賭桌法庭｜判決", [
    ["檢方", "被告把方向改成{dir}，隨後落敗。"], ["法官", "這叫什麼？"], ["檢方", "自主管理。"]]),
  card("P2-620", "insight_fold", "court", "賭桌法庭｜當庭訊問", [
    ["法官", "被告{p}使用讀心之後棄牌，請問看到了什麼？"], ["被告", "不能說。"], ["法官", "那你為什麼棄牌？"], ["被告", "因為我看到了。"]]),
  card("P2-621", "insight_fold", "court", "賭桌法庭｜判決", [
    ["法官", "讀心之後棄牌，本庭認定被告具備基本的風險意識。"], ["書記官", "要記錄下來嗎？"], ["法官", "記。這很難得。"]]),

  // ================= 節目小卡：契約公證處（開局）=================
  card("P2-700", "match_start", "notary", "契約公證處｜本場契約確認", [
    ["公證人", "契約公證處確認，本場賭上之物為：{p0}『{stake0}』，{p1}『{stake1}』。"],
    ["公證人", "至於『{stakeX}』的原主人是否知情，本處目前沒有收到相關說明。"]], [], ["bothDefault"]),
  card("P2-701", "match_start", "notary", "契約公證處｜本場契約確認", [
    ["公證人", "本場賭上之物：{p0}『{stake0}』，{p1}『{stake1}』。"],
    ["公證人", "本處已完成登記。登記費用為零，後果請自行負擔。"]]),
  card("P2-702", "match_start", "notary", "契約公證處｜本場契約確認", [
    ["公證人", "雙方都賭上了『我最後的尊嚴』。"], ["公證人", "本處提醒：此物品一經輸出，恕不退換。"]], ["bothDefault"]),
  card("P2-703", "match_start", "notary", "契約公證處｜賽前聲明", [
    ["公證人", "{p0}『{stake0}』、{p1}『{stake1}』，契約成立。"],
    ["公證人", "另外，{vowSeat}的賽前聲明，本處已原句記錄在案：『{vow}』"]], ["hasVow"]),

  // ================= 第四墩後中場節目（先篩選合格的，再抽）=================
  card("P2-800", "mid:raise", "breaking", "突發！賽事單位介入調查", [
    "經統計，{p}已連續 {streak} 墩加注。", "本桌已要求相關人員說明。", "目前無人願意說明。"]),
  card("P2-801", "mid:raise", "breaking", "突發！賽事單位介入調查", [
    "{p}前四墩加注 {count} 次，已超過本桌一般水準。", "記者詢問本桌一般水準是多少。", "賽事單位表示，本桌沒有一般水準，所以都超過。"]),
  card("P2-810", "mid:trail", "sports", "中場球評｜落後分析", [
    ["主播", "目前{trail}處於落後，你認為他下半場應該怎麼調整？"], ["球評", "最重要的是拿到更多籌碼。"],
    ["主播", "具體怎麼拿？"], ["球評", "從對面那裡。"]]),
  card("P2-811", "mid:trail", "sports", "中場球評｜落後分析", [
    ["主播", "{trail}落後 {gap} 枚。"], ["球評", "好消息是，還有五墩。"], ["主播", "壞消息呢？"], ["球評", "{lead}也還有五墩。"]]),
  card("P2-820", "mid:pool", "breaking", "賽事經費異常通知", [
    "賽事單位發現，部分籌碼尚未完成分配。", "經查，相關籌碼仍留在疊池中。", "請雙方於下半場自行處理。"]),
  card("P2-821", "mid:pool", "breaking", "賽事經費異常通知", [
    "本桌疊池目前尚有 {pool} 枚。", "經費來源：雙方。", "經費用途：待定。"]),
  card("P2-830", "mid:expert", "sports", "中場專家分析", [
    ["記者", "請問你對目前局勢有什麼看法？"], ["球評", "其實我們可以發現，現在籌碼比較多的那位，確實擁有比較多的籌碼。"],
    ["記者", "非常精闢的分析，謝謝。"]], ["leading"]),
  card("P2-831", "mid:expert", "sports", "中場專家分析", [
    ["記者", "下半場的關鍵是什麼？"], ["球評", "下半場。"], ["記者", "可以再具體一點嗎？"], ["球評", "第五墩到第九墩。"]]),
  card("P2-832", "mid:expert", "sports", "中場專家分析", [
    ["記者", "目前雙方持有一樣多，你怎麼看？"], ["球評", "這代表兩個人目前一樣多。"], ["記者", "……謝謝。"]], ["level"]),
];
