using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tutorial
{
    public enum LessonEnd
    {
        FirstTrickResolved,   // 第一墩結算完就評分
        ContractSet,          // 叫牌結束、定約那一刻評分
        HandFinished          // 整局打完評分
    }

    public sealed class LessonVerdict
    {
        public bool Passed;
        public string Message;
        public static LessonVerdict Pass(string msg) => new LessonVerdict { Passed = true, Message = msg };
        public static LessonVerdict Retry(string msg) => new LessonVerdict { Passed = false, Message = msg };
    }

    // 評分時看得到的東西：牌局本身 + 玩家（座位 0）收到的所有事件
    public sealed class LessonContext
    {
        public readonly HoneymoonGame Game;
        public readonly IReadOnlyList<GameEvent> Events;
        public LessonContext(HoneymoonGame g, IReadOnlyList<GameEvent> events) { Game = g; Events = events; }

        public GameEvent FirstTrickWon => Events.FirstOrDefault(e => e.type == GameEventType.TrickWon);
        public bool PlayerWonFirstTrick => FirstTrickWon != null && FirstTrickWon.seat == TutorialSession.Player;
        public Card? PlayerFirstCard
        {
            get
            {
                var e = Events.FirstOrDefault(x => x.type == GameEventType.CardPlayed && x.seat == TutorialSession.Player);
                return e == null ? (Card?)null : Card.FromId(e.card);
            }
        }
        public bool PlayerFirstCardIs(string card) => PlayerFirstCard.HasValue && PlayerFirstCard.Value.Equals(CardText.One(card));
        public bool PlayerRuffed => Events.Any(e => e.type == GameEventType.CardPlayed && e.seat == TutorialSession.Player && e.extra == 1);
    }

    // 一題
    public sealed class Lesson
    {
        public string Title;
        public string Instruction;                       // 開場說明
        public Func<HoneymoonGame> Setup;                // 擺出固定牌局
        public LessonEnd EndsAt;
        public Func<HoneymoonGame, int> OpponentCall;    // 對手的叫牌劇本；null 或回傳不合法 → 用 SimpleAI
        public Func<HoneymoonGame, Card?> OpponentCard;  // 對手的出牌劇本；null 或回傳 null → 用 SimpleAI
        public Func<HoneymoonGame, int, string> CheckCall;  // 回傳提示字 = 這題不收這個叫法；null = 可以
        public Func<HoneymoonGame, Card, string> CheckCard;
        public Func<LessonContext, LessonVerdict> Evaluate;
    }

    // 一章
    public sealed class Chapter
    {
        public int Number;
        public string Title;
        public string Goal;
        public bool IsFreePlay;                          // 第五章：直接跟電腦打完整的一局
        public List<Lesson> Lessons = new List<Lesson>();
        public string Heading => $"第{"一二三四五六七八九"[Number - 1]}章・{Title}";
    }

    // 不碰 Unity 的「教學關卡執行器」：牌局、對手劇本、玩家動作的檢查、評分。
    // Unity 那邊（TutorialTable）只負責節奏（停頓、動畫），規則全部在這裡，所以可以直接測試
    public sealed class TutorialSession
    {
        public const int Player = 0, Opponent = 1;

        public readonly Lesson Lesson;
        public HoneymoonGame Game { get; private set; }
        public LessonVerdict Verdict { get; private set; }   // null = 這題還在進行
        public bool Finished => Verdict != null;

        readonly List<GameEvent> events = new List<GameEvent>();
        public IReadOnlyList<GameEvent> Events => events;

        // 只轉送「玩家看得到」的事件（廣播 + 只給座位 0 的），跟正式對戰一樣不會洩漏對手的暗牌
        public event Action<GameEvent> PlayerEvent;

        int tricksResolved;

        public TutorialSession(Lesson lesson) { Lesson = lesson; }

        public void Start()
        {
            if (Game != null) Game.Emitted -= OnEmit;
            Game = Lesson.Setup();
            Game.Emitted += OnEmit;
            events.Clear();
            Verdict = null;
            tricksResolved = 0;
        }

        void OnEmit(GameEvent e, int to)
        {
            if (to == Opponent) return;
            events.Add(e);
            PlayerEvent?.Invoke(e);
        }

        bool Acting => Game.Phase == Phase.Draw || Game.Phase == Phase.Bidding || Game.Phase == Phase.Play;
        public bool NeedsResolve => !Finished && Game.TrickComplete;
        public bool OpponentToAct => !Finished && !Game.TrickComplete && Acting && Game.CurrentPlayer == Opponent;
        public bool PlayerToAct => !Finished && !Game.TrickComplete && Acting && Game.CurrentPlayer == Player;

        public void Resolve()
        {
            if (!NeedsResolve) return;
            Game.ResolveTrick();
            tricksResolved++;
            if (Lesson.EndsAt == LessonEnd.FirstTrickResolved && tricksResolved == 1) Evaluate();
            else if (Lesson.EndsAt == LessonEnd.HandFinished && Game.Phase == Phase.Finished) Evaluate();
        }

        public void OpponentAct()
        {
            if (!OpponentToAct) return;
            if (Game.Phase == Phase.Bidding)
            {
                int call = Lesson.OpponentCall != null ? Lesson.OpponentCall(Game) : SimpleAI.ChooseCall(Game, Opponent);
                if (!Game.IsLegalCall(Opponent, call)) call = SimpleAI.ChooseCall(Game, Opponent);
                Game.MakeCall(Opponent, call);
                CheckContract();
                return;
            }
            Card? scripted = Lesson.OpponentCard?.Invoke(Game);
            Card c = scripted.HasValue && Game.LegalFor(Opponent).Contains(scripted.Value)
                ? scripted.Value
                : SimpleAI.ChooseCard(Game, Opponent);
            Game.PlayCard(Opponent, c);
        }

        // 回傳 null = 已經照做；否則回傳給玩家看的提示（這題不收這個叫法，牌局不變）
        public string TryCall(int call)
        {
            if (!PlayerToAct || Game.Phase != Phase.Bidding) return "還沒輪到你叫牌";
            if (!Game.IsLegalCall(Player, call)) return "這個叫法現在不能用";
            var hint = Lesson.CheckCall?.Invoke(Game, call);
            if (hint != null) return hint;
            Game.MakeCall(Player, call);
            CheckContract();
            return null;
        }

        // 回傳 null = 已經處理（照做，或是沒跟花色 → 遊戲本身會發 Illegal 事件，畫面自己會抖）
        public string TryPlay(Card c)
        {
            if (!PlayerToAct || (Game.Phase != Phase.Draw && Game.Phase != Phase.Play)) return "還沒輪到你出牌";
            if (!Game.Hands[Player].Contains(c)) return "這張牌不在你手上";
            if (!Game.LegalFor(Player).Contains(c)) { Game.PlayCard(Player, c); return null; }
            var hint = Lesson.CheckCard?.Invoke(Game, c);
            if (hint != null) return hint;
            Game.PlayCard(Player, c);
            return null;
        }

        void CheckContract()
        {
            if (Lesson.EndsAt == LessonEnd.ContractSet && Game.Phase == Phase.Play) Evaluate();
        }

        void Evaluate()
        {
            Verdict = Lesson.Evaluate(new LessonContext(Game, events))
                      ?? LessonVerdict.Retry("這題沒有評分規則");
        }
    }
}
