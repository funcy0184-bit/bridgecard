// 阿禾在正式對戰時的嘴：事件驅動的台詞庫＋挑台詞的規則（不碰畫面，測試可以直接跑）。
//
// 每一句都綁在「真的發生的事件」上（呼叫的人把真實牌局算好的事實 Facts 傳進來），條件不符的台詞不會被選到。
// 三種口氣：1 自然聊天（最常見）、2 情緒吐槽（有意義的事件才有）、3 莫名其妙的幹話（稀有，一場最多 2 次）。
// 頻率控制：每個事件有機率、冷卻、一場上限；一般閒聊之間至少隔幾秒；最近講過的不重複；幹話跨場也不重複。
// 只是台詞：不影響 AI、出牌、計分或連線同步。

export type Tone = 1 | 2 | 3;
export type Emo = "calm" | "smug" | "shock" | "sulk" | "think" | "sigh";
export type Tfx = "fade" | "pop" | "shout";
export type TalkLevel = "full" | "lite" | "off";      // 正常互動／精簡互動／關閉額外吐槽

// 事件的事實：全部由呼叫的人從真實牌局（TableState、事件）算出來
export interface Facts {
  n?: number;              // 連贏幾墩、差幾墩……
  iDecl?: boolean;         // 你是莊家
  doubled?: number;        // 0／1 加倍／2 再加倍
  under?: number;          // 倒幾墩
  over?: number;           // 超幾墩
  aheAhead?: boolean;      // 整場分數阿禾領先
  playerAhead?: boolean;   // 整場分數你領先
  aheLostLast?: boolean;   // 阿禾剛剛吃虧（輸了這墩、倒約……）
  lastTrickAhe?: boolean;  // 上一墩阿禾贏
  byPlayer?: boolean;      // 加倍是你喊的
}

// 這一場的記憶（整場打完清掉；開場態度來自教學，存在 hb-ahe-mem）
export interface Mem {
  attitude?: string;       // newbie／some／pro
  playerDoubles: number;   // 你這場加倍幾次
  playerRuffs: number;     // 你這場王吃成功幾次
  aheDownRow: number;      // 阿禾當莊連續倒約幾次
}

export interface Said { id: string; text: string; tone: Tone; emo: Emo; fx: Tfx; pri: number }

interface Reaction {
  id: string;
  key?: string;            // 同一個事件不同版本各自計數（一場上限）
  tone: Tone;
  pri: number;             // 1 最重要 … 8 閒聊：規則／整場勝負 > 打成倒約 > 關鍵墩王吃 > 加倍 > 一般贏墩 > 表情互動 > 幹話
  chance: number;          // 觸發機率（正常互動）
  cooldown?: number;       // 同一個事件多久內不再講（毫秒）
  max?: number;            // 一場最多幾次
  perHand?: number;        // 一局最多幾次（加倍、再加倍：優先講一次就好）
  direct?: boolean;        // 回你的話：不受閒聊間隔、一局上限限制（洗版由回話的冷卻管）
  emo: Emo;
  fx?: Tfx;
  when?: (f: Facts, m: Mem) => boolean;
  lines: string[] | ((f: Facts, m: Mem) => string[]);
}

const R = (id: string, tone: Tone, pri: number, chance: number, emo: Emo, lines: Reaction["lines"], o: Partial<Reaction> = {}): Reaction =>
  ({ id, tone, pri, chance, emo, lines, ...o });

// 幹話彩蛋：稀有，條件不對的不會講（例如你沒領先就不說你運氣過分）
const NONSENSE = (f: Facts): string[] => [
  "今天就是明天的昨天。",
  "牌可以重發，人生不能。好啦，這局可以。",
  "人生就像打橋牌，沒有紅心的時候，真的沒有。",
  "做人不能太貪心，打牌可以先想一下。",
  "茶涼了可以再泡，墩輸了就是輸了。",
  "下雨天適合打牌，晴天也是。",
  ...(f.aheLostLast ? ["我剛剛不是輸，我是在研究失敗。", "時間會證明一切，除了我剛剛那張亂出的牌。"] : []),
  ...(f.playerAhead ? ["運氣也是實力的一部分，但你這個運氣有點過分了吧。", "我覺得牌也有心情，今天它們比較喜歡你。"] : []),
];

// 台詞庫：同一個事件可以有多個版本；有記憶條件的放前面（符合就優先）
export const REACTIONS: Reaction[] = [
  // ---- 開場、換局 ----
  R("matchStart", 1, 6, 1, "smug", ["你不是說你超強？來，證明給我看。"], { key: "matchStart:pro", when: (_f, m) => m.attitude === "pro", max: 1 }),
  R("matchStart", 1, 6, 1, "calm", ["別緊張，我會手下留情……大概。"], { key: "matchStart:newbie", when: (_f, m) => m.attitude === "newbie", max: 1 }),
  R("matchStart", 1, 6, 0.9, "smug", ["來啊，今天打幾場？", "坐啊坐啊，牌我洗好了。", "今天手感不錯，你要小心喔。"]),
  R("aheLeads", 1, 7, 0.35, "calm", ["那我先來囉。", "我先出啦。", "看好喔。"], { cooldown: 60000 }),
  R("nextHand", 1, 7, 0.3, "calm", ["下一局。", "來，繼續。", "洗牌洗牌。"], { cooldown: 60000 }),
  R("rematch", 1, 6, 1, "smug", f => f.aheLostLast ? ["好，剛剛那場不算。", "來啊，我還沒打夠。"] : ["來啊，我還沒打夠。", "再一場？好啊。"]),

  // ---- 一般贏墩（低機率） ----
  R("trickMe", 1, 7, 0.12, "think", ["欸，可以喔。", "這張出得不錯。", "好啦，這墩給你。"], { cooldown: 9000 }),
  R("trickAhe", 1, 7, 0.1, "smug", ["這墩我收下啦。", "謝啦。", "嘿，我的。"], { cooldown: 9000 }),

  // ---- 搶牌：重要的明牌 ----
  R("faceUpMe", 2, 6, 0.45, "sulk", ["欸！那張我也想要欸。", "可惡，被你搶走了。", "那張很好欸，你運氣不錯。"], { cooldown: 12000 }),
  R("faceUpAhe", 1, 7, 0.3, "smug", ["嘿嘿，這張我的了。", "謝謝招待。"], { cooldown: 12000 }),

  // ---- 王吃（較高機率） ----
  R("ruffMe", 2, 4, 1, "shock", ["不是欸，你到底還有幾張王牌？"], { key: "ruffMe:many", when: (_f, m) => m.playerRuffs >= 3, max: 1, fx: "shout" }),
  R("ruffMe", 2, 4, 0.85, "shock", ["哭啊！這樣也行？", "不是欸，你王吃我？", "靠，被吃了。"], { fx: "shout", perHand: 2 }),
  R("ruffAhe", 2, 4, 0.75, "smug", ["嘿嘿，沒想到吧。", "王牌就是拿來用的。", "不好意思，我沒有那個花色。"], { fx: "pop", perHand: 2 }),

  // ---- 連贏（這一局內；連勝中斷就不講） ----
  R("streakMe", 2, 5, 1, "shock", f => ["你今天是不是有偷練？", `欸欸欸，連贏 ${f.n} 墩了喔。`], { max: 3, fx: "pop" }),
  R("streakAhe", 2, 5, 1, "smug", ["我今天手感不錯喔。", "這幾墩我就不客氣了。"], { max: 3 }),

  // ---- 關鍵墩、逆轉 ----
  R("keyMe", 2, 4, 1, "shock", ["不是吧！這墩也被你拿走！", "等等等等，怎麼會這樣？"], { fx: "shout" }),
  R("keyAhe", 2, 4, 1, "smug", ["好險，差點就被你翻了。", "這墩很重要，我拿了。"], { fx: "pop" }),
  R("reversal", 2, 4, 1, "shock", ["等等等等，怎麼會這樣？", "欸，被你追過去了？"], { max: 2, fx: "shout" }),

  // ---- 快打成／達標／確定打不成 ----
  R("nearDecl", 1, 5, 1, "think", f => f.iDecl ? ["就差一墩了欸。", "再一墩……你該不會真的要打成吧？"] : ["再一墩我就打成了。", "就快了喔。"]),
  R("reached", 2, 3, 1, "sulk", f => f.iDecl ? ["好啦，你達標了。剩下的看你能多拿幾墩。"] : ["達標！剩下的我慢慢收。"], { when: () => true }),
  R("setLocked", 2, 3, 1, "smug", f => f.iDecl ? ["這局你已經打不成囉。"] : ["好啦，這局算你守住了。"]),

  // ---- 叫牌、加倍 ----
  R("bidHighMe", 2, 5, 0.8, "shock", ["你這麼敢喔？", "喔？你這麼有把握？"], { fx: "pop" }),
  R("bidRaiseAhe", 1, 6, 0.6, "smug", ["那我再叫高一點。", "想得美，我叫更高。"]),
  R("doubleMe", 2, 4, 1, "shock", ["你是不是很喜歡加倍啊？"], { key: "doubleMe:fan", when: (_f, m) => m.playerDoubles >= 2, max: 1, perHand: 1, fx: "pop" }),
  R("doubleMe", 2, 4, 1, "shock", ["蛤？你要加倍？", "你加倍我？好啊。"], { perHand: 1, fx: "pop" }),
  R("redoubleMe", 2, 4, 1, "shock", ["不是，你玩這麼大？", "蛤！！你還再加倍？"], { perHand: 1, fx: "shout" }),
  R("doubleAhe", 2, 4, 1, "smug", ["欸，我覺得你這局做不到喔。我加倍！", "那我可要加倍了。"], { perHand: 1, fx: "pop" }),
  R("redoubleAhe", 2, 4, 1, "smug", ["加倍我？我再加倍！"], { perHand: 1, fx: "shout" }),
  R("contractMe", 1, 6, 0.7, "think", ["好，這局就看你了。", "說好的墩數喔，別忘了。"]),
  R("contractAhe", 1, 6, 0.5, "smug", ["這局我來，你守好喔。", "看我說到做到。"]),

  // ---- 一局結束（莊家打成／倒約） ----
  R("madeMe", 2, 3, 1, "sulk", ["哭啊，我加倍還被你打成！", "我都加倍了你還打成？"], { key: "madeMe:dbl", when: f => !!f.doubled && !f.byPlayer, fx: "shout" }),
  R("madeMe", 2, 3, 1, "sulk", ["欸，還多拿喔？你是不是太貪心了。"], { key: "madeMe:over", when: f => (f.over ?? 0) > 0 }),
  R("madeMe", 2, 3, 1, "shock", ["有料喔，真的打成了。", "好啦，算你厲害。"], { fx: "pop" }),
  R("downMe", 2, 3, 1, "smug", ["哎呀，被加倍還沒打成，這下比較痛了。"], { key: "downMe:dbl", when: f => !!f.doubled && !f.byPlayer }),
  R("downMe", 2, 3, 1, "smug", ["哭啊，就差一墩！"], { key: "downMe:one", when: f => f.under === 1, fx: "pop" }),
  R("downMe", 2, 3, 1, "smug", ["這次真的叫太高了啦。", "哎呀，這局有點慘喔。"]),
  R("madeAhe", 2, 3, 1, "smug", ["你加倍我也照樣打成，嘿嘿。"], { key: "madeAhe:dbl", when: f => !!f.doubled && !!f.byPlayer, fx: "pop" }),
  R("madeAhe", 2, 3, 1, "smug", ["嘿嘿，這局我有說到做到吧。", "打成！今天狀況不錯。"]),
  R("downAhe", 2, 3, 1, "sigh", ["我今天到底在叫什麼東西……"], { key: "downAhe:row", when: (_f, m) => m.aheDownRow >= 2, max: 1 }),
  R("downAhe", 2, 3, 1, "sulk", ["可惡，就差一墩。"], { key: "downAhe:one", when: f => f.under === 1 }),
  R("downAhe", 2, 3, 1, "sulk", ["好啦，我承認我剛剛叫太大。", "可惡，這局被你守住了。"]),

  // ---- 整場勝負（結算單上那一句；照整場分差和你開場說的話） ----
  R("matchMe", 2, 2, 1, "sulk", ["好啦，你剛剛說你很強還真的不是亂講。"], { key: "matchMe:pro", when: (_f, m) => m.attitude === "pro" }),
  R("matchMe", 2, 2, 1, "sulk", f => (f.n ?? 0) <= 20 ? ["差一點！可惡。"] : (f.n ?? 0) >= 60 ? ["你到底是不是新手啊？"] : ["好啦，這場算你厲害。"]),
  R("matchAhe", 2, 2, 1, "smug", ["你不是說你很強嗎？好啦，下一場再證明。"], { key: "matchAhe:pro", when: (_f, m) => m.attitude === "pro" }),
  R("matchAhe", 2, 2, 1, "smug", f => (f.n ?? 0) <= 20 ? ["呼！這局差點翻車。"] : ["這次換我贏啦！", "今天手感太好了，不好意思啦。"]),

  // ---- 你回個話（表情）：阿禾照現在的局勢回 ----
  R("emote:nice", 1, 7, 1, "smug", f => f.lastTrickAhe ? ["嘿嘿，你現在才知道？"] : ["你是在誇我還是誇你自己？", "欸，謝啦。"], { direct: true }),
  R("emote:cry", 2, 7, 1, "smug", f => f.aheAhead ? ["現在才開始哭喔？"] : ["要哭的是我吧。"], { direct: true }),
  R("emote:cocky", 2, 7, 1, "smug", f => f.aheAhead ? ["啊我就真的贏了啊。"] : ["我哪有囂張，我現在很低調。"], { direct: true }),
  R("emote:pretty", 1, 7, 1, "smug", ["欸，謝啦。", "我也覺得。"], { direct: true }),
  R("emote:again", 1, 7, 1, "smug", ["來啊，誰怕誰。", "好啊，我還沒打夠。"], { direct: true }),

  // ---- 幹話（稀有；一場最多 2 次；跨場不重複） ----
  R("nonsense", 3, 8, 1, "think", NONSENSE),
];

// 玩家可以回的話（純社交：不影響牌局）
export const EMOTES = [
  { key: "nice", text: "有料喔！" },
  { key: "cry", text: "哭啊！" },
  { key: "cocky", text: "別太囂張！" },
  { key: "pretty", text: "漂亮！" },
  { key: "again", text: "再來啊！" },
] as const;

export const NONSENSE_MAX = 2;          // 一場最多幾句幹話
export const HAND_IDLE_MAX = 3;          // 一局最多幾句閒聊（優先序 5 以上）
export const HAND_MAX = 6;               // 一局最多幾句（打成倒約、整場勝負這種大事例外）
const GAP_IDLE = 5000;                   // 閒聊（優先序 6 以上）之間至少隔多久
const GAP_ANY = 1200;                    // 任何兩句之間至少隔多久（重要事件例外）
const RECENT = 8;                        // 最近講過的幾句不重複
const NONSENSE_RECENT = 6;               // 跨場：最近講過的幾句幹話不重複

export interface MemStore { get(k: string): string | null; set(k: string, v: string): void }
export const MEM_KEY = "hb-ahe-mem";

export class AheBrain {
  level: TalkLevel = "full";
  mem: Mem = { playerDoubles: 0, playerRuffs: 0, aheDownRow: 0 };
  private lastAt = new Map<string, number>();
  private count = new Map<string, number>();
  private recent: string[] = [];
  private lastSaidAt = -1e9;
  private nonsense = 0;
  private handTotal = 0;
  private handIdle = 0;
  private handCount = new Map<string, number>();

  constructor(private rng: () => number = Math.random, private now: () => number = () => Date.now(), private store?: MemStore) {
    this.newMatch();
  }

  private saved(): { attitude?: string; nonsense?: string[] } {
    try { return JSON.parse(this.store?.get(MEM_KEY) ?? "{}") ?? {}; } catch { return {}; }
  }

  // 新的一場：記憶清空（開場態度留著）
  newMatch() {
    this.mem = { attitude: this.saved().attitude, playerDoubles: 0, playerRuffs: 0, aheDownRow: 0 };
    this.count.clear();
    this.nonsense = 0;
    this.newHand();
  }
  // 新的一局：這一局的講話額度重算
  newHand() { this.handTotal = 0; this.handIdle = 0; this.handCount.clear(); }

  // 記下這一場發生的事（只記雙方都看得到的事）
  note(kind: "playerDouble" | "playerRuff" | "aheHand", made = false) {
    if (kind === "playerDouble") this.mem.playerDoubles++;
    else if (kind === "playerRuff") this.mem.playerRuffs++;
    else this.mem.aheDownRow = made ? 0 : this.mem.aheDownRow + 1;
  }

  // 依事件挑一句；條件不符、太頻繁、這個等級不講 → null
  say(id: string, f: Facts = {}): Said | null {
    if (this.level === "off") return null;
    const t = this.now();
    for (const r of REACTIONS) {
      if (r.id !== id || (r.when && !r.when(f, this.mem))) continue;
      const key = r.key ?? r.id;
      if (r.max !== undefined && (this.count.get(key) ?? 0) >= r.max) continue;
      if (r.perHand !== undefined && (this.handCount.get(r.id) ?? 0) >= r.perHand) return null;
      if (r.cooldown && t - (this.lastAt.get(r.id) ?? -1e12) < r.cooldown) return null;
      if (this.level === "lite" && !r.direct && (r.pri > 4 || r.tone === 3)) return null;
      if (r.tone === 3 && this.nonsense >= NONSENSE_MAX) return null;
      if (!r.direct && r.pri >= 5 && this.handIdle >= HAND_IDLE_MAX) return null;     // 這一局閒聊夠多了
      if (!r.direct && r.pri >= 4 && this.handTotal >= HAND_MAX) return null;         // 這一局講夠多了（大事例外）
      const gap = r.pri <= 4 ? 0 : r.direct ? 0 : r.pri >= 6 ? GAP_IDLE : GAP_ANY;
      if (t - this.lastSaidAt < gap) return null;
      const chance = this.level === "lite" && !r.direct ? r.chance * 0.7 : r.chance;     // 回你的話一定回
      if (chance < 1 && this.rng() >= chance) return null;
      const all = typeof r.lines === "function" ? r.lines(f, this.mem) : r.lines;
      if (!all.length) return null;
      const avoid = r.tone === 3 ? [...this.recent, ...(this.saved().nonsense ?? [])] : this.recent;
      const fresh = all.filter(x => !avoid.includes(x));
      const pool = fresh.length ? fresh : all.slice().sort((a, b) => this.recent.indexOf(a) - this.recent.indexOf(b));
      const text = fresh.length ? pool[Math.floor(this.rng() * pool.length) % pool.length] : pool[0];
      this.count.set(key, (this.count.get(key) ?? 0) + 1);
      if (!r.direct) { this.handTotal++; if (r.pri >= 5) this.handIdle++; }
      this.handCount.set(r.id, (this.handCount.get(r.id) ?? 0) + 1);
      this.lastAt.set(r.id, t);
      this.lastSaidAt = t;
      this.recent = [...this.recent.filter(x => x !== text), text].slice(-RECENT);
      if (r.tone === 3) {
        this.nonsense++;
        try {
          const m = this.saved();
          m.nonsense = [...(m.nonsense ?? []).filter(x => x !== text), text].slice(-NONSENSE_RECENT);
          this.store?.set(MEM_KEY, JSON.stringify(m));
        } catch { /* 無痕模式 */ }
      }
      return { id, text, tone: r.tone, emo: r.emo, fx: r.fx ?? (r.tone === 1 ? "fade" : "pop"), pri: r.pri };
    }
    return null;
  }
}
