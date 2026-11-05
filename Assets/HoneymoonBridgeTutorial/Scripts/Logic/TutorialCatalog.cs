using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tutorial
{
    // 五章教學的內容。每一題都讓玩家親手做一個動作，牌局是固定的，所以每個人看到的都一樣。
    // 改題目只要動這支；TutorialCatalogTests 會幫你檢查每一題的「標準解法」真的過得了關。
    public static class TutorialCatalog
    {
        static Bid B(int level, Strain s) => new Bid(level, s);
        static Card C(string s) => CardText.One(s);

        public static readonly List<Chapter> Chapters = new List<Chapter>
        {
            new Chapter
            {
                Number = 1, Title = "搶明牌", Goal = "抽牌階段：贏墩的人拿明牌，輸的人摸暗牌",
                Lessons = { GrabGoodFaceUp(), LowFaceUpChoice() }
            },
            new Chapter
            {
                Number = 2, Title = "叫出合約", Goal = "叫牌：要拿幾墩、誰當王、要不要加倍",
                Lessons = { BidTwoHearts(), DoubleTheirContract() }
            },
            new Chapter
            {
                Number = 3, Title = "跟牌與王吃", Goal = "打牌：有首引的花色要跟，缺門可以出王吃",
                Lessons = { MustFollowSuit(), RuffWithSmallTrump() }
            },
            new Chapter
            {
                Number = 4, Title = "讀懂計分板", Goal = "剛好打成和多拿一墩，分數差多少",
                Lessons = { EndgameExact(), EndgameOvertrick() }
            },
            new Chapter
            {
                Number = 5, Title = "第一場挑戰", Goal = "跟簡單電腦打一局完整的牌：抽牌、叫牌、打牌一次走完",
                IsFreePlay = true
            },
        };

        public static Chapter Get(int number) => Chapters.First(c => c.Number == number);

        // ================= 第一章・搶明牌 =================

        static Lesson GrabGoodFaceUp() => new Lesson
        {
            Title = "搶下好牌",
            Instruction =
                "明牌是 ♠A，超值的一張！這一墩你先出。\n" +
                "規則：贏墩的人拿走明牌，輸的人只能摸一張暗牌。出一張對手壓不過的大牌，把 ♠A 搶回家。\n" +
                "提示：你的 ♥A 是紅心最大的牌。",
            Setup = () => ScenarioBuilder.Draw(leader: 0,
                hand0: "♠KQ5 ♥AK7 ♦J84 ♣Q962",
                hand1: "♠J93 ♥QJT ♦AQT9 ♣AKT",
                stockTop: "♠A"),
            EndsAt = LessonEnd.FirstTrickResolved,
            Evaluate = ctx => ctx.PlayerWonFirstTrick
                ? LessonVerdict.Pass("搶到 ♠A 了！\n贏墩的人拿明牌，輸的人摸一張暗牌，而且你看不到他摸到什麼。")
                : LessonVerdict.Retry("被對手壓過去了，♠A 被他拿走。\n再試一次：出你最大的牌比較穩，例如 ♥A。")
        };

        static Lesson LowFaceUpChoice() => new Lesson
        {
            Title = "要不要花大牌去搶？",
            Instruction =
                "這次明牌只是 ♣2，沒什麼價值。對手先出了 ♦9。\n" +
                "你手上的方塊有 ♦A 和 ♦3：用 ♦A 搶，還是出 ♦3 讓他拿？自己決定。",
            Setup = () => ScenarioBuilder.Draw(leader: 1,
                hand0: "♠AK4 ♥Q852 ♦A3 ♣KJ74",
                hand1: "♠QJ5 ♥KJ4 ♦KQ9 ♣AQT8",
                stockTop: "♣2"),
            OpponentCard = g => g.LeadCard == null ? C("♦9") : (Card?)null,
            EndsAt = LessonEnd.FirstTrickResolved,
            Evaluate = ctx => ctx.PlayerFirstCardIs("♦A")
                ? LessonVerdict.Pass("你用 ♦A 搶到了 ♣2。\n不過 A 是最大的牌，留到打牌階段可以穩穩贏一墩。明牌不值錢時，讓對手拿也沒關係，你還能摸一張暗牌，說不定更好。")
                : LessonVerdict.Pass("聰明！♣2 不值得花一張 A 去搶。\n你留住了 ♦A，還摸到一張暗牌，說不定比 ♣2 更好。")
        };

        // ================= 第二章・叫出合約 =================

        static Lesson BidTwoHearts() => new Lesson
        {
            Title = "叫 2♥",
            Instruction =
                "叫牌就是喊出：要拿幾墩、哪一門當王。\n" +
                "你的紅心有 6 張，大牌點 18（A=4 K=3 Q=2 J=1），很適合讓紅心當王。叫 2♥ 代表要拿 2 + 6 = 8 墩。\n" +
                "點叫牌面板上的 2♥，下面會算出這一叫押多少分，再按「叫 2♥」送出。",
            Setup = () => ScenarioBuilder.Bidding(firstBidder: 0,
                hand0: "♠A5 ♥AKQ963 ♦K74 ♣Q8",
                hand1: "♠KQJ9 ♥JT ♦AQT ♣AJ97"),
            OpponentCall = g => Call.Pass,
            CheckCall = (g, call) =>
            {
                int want = B(2, Strain.Hearts).Index;
                if (call == want) return null;
                if (call == Call.Pass) return "這題先練習叫牌：請叫 2♥。";
                if (Call.IsBid(call))
                {
                    var b = Bid.FromIndex(call);
                    return $"這題請叫 2♥（2 線、紅心當王）。\n叫 {b} 要拿 {b.TricksNeeded} 墩，跟這題要練的不一樣。";
                }
                return "這題請叫 2♥。";
            },
            EndsAt = LessonEnd.ContractSet,
            Evaluate = ctx => ctx.Game.Declarer == TutorialSession.Player
                ? LessonVerdict.Pass("合約 2♥ 成立！你是莊家，要拿 8 墩（2 + 6）。\n打成得 20 分，每多拿 1 墩 +2 分；每少 1 墩，對手得 10 分。")
                : LessonVerdict.Retry("合約沒有變成你的 2♥，再試一次。")
        };

        static Lesson DoubleTheirContract() => new Lesson
        {
            Title = "讀叫牌紀錄、選擇加倍",
            Instruction =
                "這次對手先叫。看左邊的叫牌紀錄：他叫了 4♠，要拿 4 + 6 = 10 墩。\n" +
                "再看你的手牌：黑桃 K Q J 10 9 都在你這裡，他當王的黑桃被你卡住了。\n" +
                "覺得他打不成，就按「加倍」：他倒約時你得的分數 ×2。",
            Setup = () => ScenarioBuilder.Bidding(firstBidder: 1,
                hand0: "♠KQJT9 ♥A83 ♦AQ5 ♣K4",
                hand1: "♠A8765 ♥KQJ ♦KJ ♣AQJ"),
            OpponentCall = g => g.HighestBid.HasValue ? Call.Pass : B(4, Strain.Spades).Index,
            CheckCall = (g, call) =>
            {
                if (call == Call.Double) return null;
                if (call == Call.Pass)
                    return "先別放過他！他要拿 10 墩，可是黑桃 K Q J 10 9 都在你手上。\n按「加倍」，讓他倒約時你得的分數翻倍。";
                return "這題練習加倍，不用自己改叫。按「加倍」。";
            },
            EndsAt = LessonEnd.ContractSet,
            Evaluate = ctx => ctx.Game.Doubled == 1 && ctx.Game.Declarer == TutorialSession.Opponent
                ? LessonVerdict.Pass("加倍成功！合約變成 4♠ 加倍：他每倒 1 墩，你得 20 分（原本 10 分）。\n不過如果他打成，他會得 80 分。加倍就是在賭他打不成。")
                : LessonVerdict.Retry("合約沒有變成「4♠ 加倍」，再試一次。")
        };

        // ================= 第三章・跟牌與王吃 =================

        static Lesson MustFollowSuit() => new Lesson
        {
            Title = "有首引的花色就要跟",
            Instruction =
                "合約 2♥，你是莊家，所以由對手先出（首攻）。他出了 ♠K。\n" +
                "你手上還有黑桃，規則是「有首引的花色就要跟」，只能出黑桃。浮起來的牌就是現在能出的牌，點其他牌會被擋下來。",
            Setup = () => ScenarioBuilder.Play(B(2, Strain.Hearts), declarer: 0, doubled: 0,
                hand0: "♠A74 ♥KQJ95 ♦K83 ♣Q6",
                hand1: "♠KQJ ♥A84 ♦AQJ ♣AK83"),
            OpponentCard = g => g.LeadCard == null ? C("♠K") : (Card?)null,
            EndsAt = LessonEnd.FirstTrickResolved,
            Evaluate = ctx => ctx.PlayerFirstCardIs("♠A")
                ? LessonVerdict.Pass("對！有首引的花色就一定要跟。\n你用 ♠A 贏下這一墩，下一墩換你先出。")
                : LessonVerdict.Pass("對！有首引的花色就一定要跟。\n這墩被 ♠K 拿走沒關係，規則你做對了。想贏的話，可以出比他大的 ♠A。")
        };

        static Lesson RuffWithSmallTrump() => new Lesson
        {
            Title = "缺門時用王牌吃",
            Instruction =
                "這次對手出 ♣A。你手上一張梅花都沒有（缺門），這時可以墊別門的牌，也可以出王牌。\n" +
                "合約是 2♥，紅心就是王牌。用你的紅心吃掉他的 A！",
            Setup = () => ScenarioBuilder.Play(B(2, Strain.Hearts), declarer: 0, doubled: 0,
                hand0: "♠K732 ♥J862 ♦AQ943",
                hand1: "♠AQ5 ♥AKQ ♦KJ ♣AKQJ5"),
            OpponentCard = g => g.LeadCard == null ? C("♣A") : (Card?)null,
            CheckCard = (g, c) => c.Suit == Suit.Hearts
                ? null
                : "試試看出紅心（王牌）！你沒有梅花，可以出王牌吃掉他的 ♣A。",
            EndsAt = LessonEnd.FirstTrickResolved,
            Evaluate = ctx => ctx.PlayerRuffed && ctx.PlayerWonFirstTrick
                ? LessonVerdict.Pass("王吃！合約是紅心當王，再小的王牌也比別門的 A 大。\n缺門的時候，記得找機會出王。")
                : LessonVerdict.Retry("這墩沒有用王牌吃下來，再試一次：出一張紅心。")
        };

        // ================= 第四章・讀懂計分板 =================

        const string EndgameIntro = "殘局練習：合約 3♥（紅心當王），你是莊家，要拿 9 墩。\n你已經拿了 8 墩、對手 3 墩，最後 2 墩決定結果。";

        static Lesson EndgameExact() => new Lesson
        {
            Title = "剛好打成",
            Instruction = EndgameIntro + "\n打完會跳出計分板，看看分數怎麼算。",
            Setup = () => ScenarioBuilder.Play(B(3, Strain.Hearts), declarer: 0, doubled: 0,
                hand0: "♠2 ♥A", hand1: "♠A ♦K", won0: 8, won1: 3),
            OpponentCard = g => g.LeadCard == null && g.Hands[1].Contains(C("♠A")) ? C("♠A") : (Card?)null,
            EndsAt = LessonEnd.HandFinished,
            Evaluate = ctx =>
            {
                var r = ctx.Game.LastResult;
                return r != null && r.made && r.overtricks == 0
                    ? LessonVerdict.Pass($"剛好拿到 9 墩：打成！\n合約分 3 線 × 10 = {r.contractPoints} 分，沒有超墩，這局你得 {r.points} 分。")
                    : LessonVerdict.Retry("結果跟預期的不一樣，再打一次看看。");
            }
        };

        static Lesson EndgameOvertrick() => new Lesson
        {
            Title = "多拿一墩",
            Instruction = EndgameIntro + "\n這次你手上兩張都是王牌。多拿一墩差多少分？打完看看計分板。",
            Setup = () => ScenarioBuilder.Play(B(3, Strain.Hearts), declarer: 0, doubled: 0,
                hand0: "♥AK", hand1: "♠A ♦K", won0: 8, won1: 3),
            OpponentCard = g => g.LeadCard == null && g.Hands[1].Contains(C("♠A")) ? C("♠A") : (Card?)null,
            EndsAt = LessonEnd.HandFinished,
            Evaluate = ctx =>
            {
                var r = ctx.Game.LastResult;
                return r != null && r.made && r.overtricks == 1
                    ? LessonVerdict.Pass($"拿到 10 墩，超 1 墩：合約分 {r.contractPoints} + 超墩 {r.overtrickPoints} = {r.points} 分。\n超墩每墩只多 2 分，所以先把合約打成最重要。")
                    : LessonVerdict.Retry("結果跟預期的不一樣，再打一次看看。");
            }
        };
    }
}
