// 梭了啦 P2「全桌都在看你笑話」：事件導演的型別
//   規則事件（engine.ts 的 LSEvent／TrickRecord）＝真的發生了什麼；這裡的「敘事事件」(Beat) 只是把公開事實整理成可以拿來演的素材
//   敘事事件永遠不會回頭改規則、改籌碼、改勝負
import type { BetStep, LSView, Phase, TrickRecord } from "../engine";
import type { Dir } from "../rules";

// 公開的對局資料：雙方都看得到、可以拿來演的部分（不含任何人的手牌、鎖的牌、讀心結果）
export interface PublicMatch {
  trick: number; phase: Phase; toAct: number; declarer: number; firstBettor: number;
  dir: Dir; nextDir: Dir | null; flippedBy: number; safeguard: number;
  ante: number; cap: number; allInStage: boolean;
  stacks: [number, number]; commit: [number, number]; pool: [number, number];
  insightUsed: [boolean, boolean];
  steps: BetStep[];                 // 這一墩到目前為止的下注
  history: TrickRecord[];           // 打完的墩（翻牌才有牌面；棄牌只有大中小）
  result: LSView["result"];
}

// 事件種類：narrative＝只演出（P2）；challenge／social 留給 P5（失控賭局）、P6（多人派對），
// 那些會影響規則的事件將來一定要由伺服器權威引擎驗證與結算，不能靠這裡的資料改遊戲狀態
export type BeatKind = "narrative" | "challenge" | "social";

export type BeatType =
  | "match_start" | "final_trick"
  | "flip" | "safeguard" | "insight"
  | "raise_first" | "raise" | "raise_streak3" | "raise_streak_more" | "reraise" | "raise_cap"
  | "big_offer" | "allin_offer"
  | "call" | "big_call" | "allin_called" | "allin_called_final"
  | "fold" | "fold_streak3" | "insight_fold" | "fold_after_raiser" | "allin_folded" | "big_fold"
  | "tie" | "tie_pool_grow" | "flip_lost" | "safeguard_result" | "pool_taken" | "big_swing" | "big_result"
  | "lose_streak3" | "comeback" | "refund" | "eliminated"
  | "intermission" | "match_over";

// 一件可以拿來演的事（全部都是公開、已經發生、可以驗證的事實）
export interface Beat {
  id: string;                 // 對局內唯一、而且穩定：同一件事不管是即時看到還是重新整理後重建，都是同一個 id
  seq: number;                // 這場的第幾件事（照發生順序）
  type: BeatType;
  kind: BeatKind;
  trick: number;              // 發生在第幾墩
  seat: number;               // 主角（-1＝雙方／沒有特定的人）
  priority: number;           // 數字越大越重要（照 config.ts）
  settled: boolean;           // 要等這一墩結算完才確定的事（翻轉後輸、逆轉、同點……）
  reportable: boolean;        // 可以當賽後戰報的素材
  data: BeatData;             // 演出要用的公開數字
}
export interface BeatData {
  to?: number;                // 加注到幾（每人押到幾；對方還沒接戰前只是「提出」）
  amount?: number;            // 實際移動的籌碼
  pool?: number;              // 疊池合計
  streak?: number;            // 連續幾墩
  count?: number;             // 累積第幾次
  stacks?: [number, number];  // 這件事之後雙方手上
  before?: [number, number];  // 這一墩開始時雙方持有
  after?: [number, number];   // 這一墩結算後雙方持有（手上＋疊池裡自己的出資）
  pressured?: boolean;        // 有壓力的棄牌：面對的承諾 ≥ 底注 2 倍，或被反加（V2 fold_after_raise 的條件）
  winner?: number;            // 這一墩誰贏（-1 同點）
  level?: number;             // 下注壓力（1～4）
  dir?: Dir;
  cards?: [number, number];   // 只有翻牌時才有（已經公開）
  reason?: string;
}

// 頻道：聊天室、主播（一句）、公告、節目小卡
export type Channel = "chat" | "anchor" | "notice" | "card";
// 12 種節目；P2 先完整做 4 種（體育台、財經台、賭桌法庭、契約公證處），其他先註冊、不啟用
export type ProgramId =
  | "sports" | "breaking" | "court" | "finance" | "weather" | "audit"
  | "support" | "lecture" | "street" | "counsel" | "notary" | "awards";

// 一則要上畫面的演出（純文字；畫面一律用 textContent 顯示）
export interface Cue {
  id: string;                 // 同一則演出不會出現兩次
  beat: string;               // 來自哪件事
  channel: Channel;
  program?: ProgramId;
  priority: number;
  level: number;              // 演出時的下注壓力（1～4）
  title?: string;             // 小卡標題
  lines: { who?: string; text: string }[];
  ttl: number;                // 預計顯示多久（毫秒）
  skippable: boolean;
}
