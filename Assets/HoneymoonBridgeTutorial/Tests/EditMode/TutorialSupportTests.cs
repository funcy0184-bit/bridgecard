using System;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;

namespace HoneymoonBridge.Tutorial.Tests
{
    public class CardTextTests
    {
        [Test]
        public void Parse_SuitGroups_TenAsT_Void()
        {
            var l = CardText.Parse("♠AK10 ♥- ♦2 ♣J");
            CollectionAssert.AreEqual(l, CardText.Parse("♠AKT ♦2 ♣J"), "10 跟 T 一樣");
            CollectionAssert.AreEqual(new[]
            {
                new Card(Suit.Spades, 14), new Card(Suit.Spades, 13), new Card(Suit.Spades, 10),
                new Card(Suit.Diamonds, 2), new Card(Suit.Clubs, 11)
            }, l);
        }

        [Test]
        public void Parse_LetterSuits_Work()
        {
            CollectionAssert.AreEqual(CardText.Parse("♠A ♥K"), CardText.Parse("SA HK"));
        }

        [Test]
        public void Parse_RejectsDuplicates_AndJunk()
        {
            Assert.Throws<ArgumentException>(() => CardText.Parse("♠AA"));
            Assert.Throws<ArgumentException>(() => CardText.Parse("♠X"));
            Assert.Throws<ArgumentException>(() => CardText.Parse("A"));
        }
    }

    public class ScenarioBuilderTests
    {
        const string H0 = "♠KQ5 ♥AK7 ♦J84 ♣Q962";
        const string H1 = "♠J93 ♥QJT ♦AQT9 ♣AKT";

        [Test]
        public void Draw_PutsFaceUpOnTop_And26InStock()
        {
            var g = ScenarioBuilder.Draw(0, H0, H1, "♠A");
            Assert.AreEqual(Phase.Draw, g.Phase);
            Assert.AreEqual(0, g.Leader);
            Assert.AreEqual(CardText.One("♠A"), g.FaceUp.Value);
            Assert.AreEqual(26, g.Stock.Count);
            var all = g.Hands[0].Concat(g.Hands[1]).Concat(g.Stock).Select(c => c.Id).ToList();
            Assert.AreEqual(52, all.Distinct().Count(), "52 張牌不重複、不缺");
        }

        [Test]
        public void Draw_OpponentCanLead()
        {
            Assert.AreEqual(1, ScenarioBuilder.Draw(1, H0, H1, "♠A").Leader);
        }

        [Test]
        public void Bidding_StopsAtFirstBidder_WithGivenHands()
        {
            foreach (int first in new[] { 0, 1 })
            {
                var g = ScenarioBuilder.Bidding(first, H0, H1);
                Assert.AreEqual(Phase.Bidding, g.Phase);
                Assert.AreEqual(first, g.CurrentPlayer);
                CollectionAssert.AreEquivalent(CardText.Parse(H0), g.Hands[0]);
                Assert.AreEqual(0, g.TakenFaceUp[0].Count + g.TakenFaceUp[1].Count);
                Assert.AreEqual(0, g.Auction.Count);
            }
        }

        [TestCase(0, 0)]
        [TestCase(0, 1)]
        [TestCase(1, 2)]
        public void Play_ContractThroughRealAuction(int declarer, int doubled)
        {
            var b = new Bid(3, Strain.Hearts);
            var g = ScenarioBuilder.Play(b, declarer, doubled, H0, H1);
            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(declarer, g.Declarer);
            Assert.AreEqual(doubled, g.Doubled);
            Assert.AreEqual(Strain.Hearts, g.Trump);
            Assert.AreEqual(1 - declarer, g.Leader, "非莊家首攻");
            Assert.AreEqual(b.Index, g.Auction[0].Call, "叫牌紀錄從莊家的叫品開始");
        }

        [Test]
        public void Play_Endgame_SetsTricksAndShortHands()
        {
            var g = ScenarioBuilder.Play(new Bid(3, Strain.Hearts), 0, 0, "♠2 ♥A", "♠A ♦K", won0: 8, won1: 3);
            Assert.AreEqual(2, g.Hands[0].Count);
            Assert.AreEqual(8, g.TricksWon[0]);
            Assert.AreEqual(3, g.TricksWon[1]);
        }

        [Test]
        public void BadInput_Throws()
        {
            Assert.Throws<ArgumentException>(() => ScenarioBuilder.Draw(0, "♠A", H1, ""), "不足 13 張");
            Assert.Throws<ArgumentException>(() => ScenarioBuilder.Draw(0, H0, H0, ""), "雙方有同樣的牌");
            Assert.Throws<ArgumentException>(() => ScenarioBuilder.Draw(0, H0, H1, "♠K"), "明牌跟手牌重複");
            Assert.Throws<ArgumentException>(() =>
                ScenarioBuilder.Play(new Bid(1, Strain.Clubs), 0, 0, "♠2", "♠A", won0: 5, won1: 5), "張數加墩數不是 13");
        }
    }

    public class BidCoachTests
    {
        static string Hint(HoneymoonGame g) => BidCoach.For(g.ViewFor(0), "電腦");

        [Test]
        public void StrongHearts_SuggestsAHeartBid()
        {
            var g = ScenarioBuilder.Bidding(0, "♠A5 ♥AKQ963 ♦K74 ♣Q8", "♠KQJ9 ♥JT ♦AQT ♣AJ97");
            var h = Hint(g);
            StringAssert.Contains("大牌點 18", h);
            StringAssert.Contains("最長 ♥ 6 張", h);
            StringAssert.IsMatch("建議：叫 \\d♥", h);
        }

        [Test]
        public void OpponentContract_StrongDefence_SuggestsDouble()
        {
            var g = ScenarioBuilder.Bidding(1, "♠KQJT9 ♥A83 ♦AQ5 ♣K4", "♠A8765 ♥KQJ ♦KJ ♣AQJ");
            g.MakeCall(1, new Bid(4, Strain.Spades).Index);
            StringAssert.Contains("可以考慮「加倍」", Hint(g));
        }

        [Test]
        public void NotMyTurn_SaysWait()
        {
            var g = ScenarioBuilder.Bidding(1, "♠KQJT9 ♥A83 ♦AQ5 ♣K4", "♠A8765 ♥KQJ ♦KJ ♣AQJ");
            StringAssert.Contains("等電腦叫牌", Hint(g));
        }

        [Test]
        public void VoidInLedSuit_WithTrump_SuggestsRuff()
        {
            var g = ScenarioBuilder.Play(new Bid(2, Strain.Hearts), 0, 0, "♠K732 ♥J862 ♦AQ943", "♠AQ5 ♥AKQ ♦KJ ♣AKQJ5");
            g.PlayCard(1, CardText.One("♣A"));
            var h = Hint(g);
            StringAssert.Contains("你沒有 ♣", h);
            StringAssert.Contains("出王牌 ♥", h);
            StringAssert.Contains("你還要拿 8 墩", h);
        }

        [Test]
        public void HoldingLedSuit_SaysFollow()
        {
            var g = ScenarioBuilder.Play(new Bid(2, Strain.Hearts), 0, 0, "♠A74 ♥KQJ95 ♦K83 ♣Q6", "♠KQJ ♥A84 ♦AQJ ♣AK83");
            g.PlayCard(1, CardText.One("♠K"));
            StringAssert.Contains("要跟 ♠", Hint(g));
        }

        [Test]
        public void Hint_DoesNotDependOnOpponentsHiddenCards()
        {
            // 玩家這邊看到的一模一樣、只有對手的手牌不同 → 提示必須一字不差
            const string mine = "♠A5 ♥AKQ963 ♦K74 ♣Q8";
            var a = ScenarioBuilder.Bidding(0, mine, "♠KQJ9 ♥JT ♦AQT ♣AJ97");
            var b = ScenarioBuilder.Bidding(0, mine, "♠KQJ2 ♥J2 ♦AQJ ♣AKJ9");
            Assert.AreEqual(Hint(a), Hint(b));
        }

        [Test]
        public void NeverThrows_ThroughManyRealGames()
        {
            for (int seed = 1; seed <= 200; seed++)
            {
                var g = new HoneymoonGame(seed);
                g.StartNewMatch();
                for (int step = 0; step < 400 && g.Phase != Phase.Finished; step++)
                {
                    for (int s = 0; s < 2; s++) BidCoach.For(g.ViewFor(s), "電腦");
                    if (g.TrickComplete) g.ResolveTrick();
                    else if (g.Phase == Phase.Bidding) g.MakeCall(g.CurrentPlayer, SimpleAI.ChooseCall(g, g.CurrentPlayer));
                    else g.PlayCard(g.CurrentPlayer, SimpleAI.ChooseCard(g, g.CurrentPlayer));
                }
                Assert.IsNull(BidCoach.For(g.ViewFor(0), "電腦"), "打完就不該再有提示");
            }
        }
    }

    public class GuideTextTests
    {
        [Test]
        public void ScoringExamples_MatchSpec()
        {
            var t = GuideText.ScoringExamples();
            StringAssert.Contains("3♥ 加倍拿 10 墩 → 莊家 +62（60 + 超墩 2）", t);
            StringAssert.Contains("3♥ 加倍只拿 8 墩 → 防守方 +20（倒 1 墩）", t);
            StringAssert.Contains("2♥ 剛好拿 8 墩 → 莊家 +20", t);
        }

        [Test]
        public void ThreePages_AllHaveText()
        {
            Assert.AreEqual(3, GuideText.PageTitles.Length);
            for (int i = 0; i < 3; i++) Assert.That(GuideText.Page(i).Length, Is.GreaterThan(50));
        }

        // TextMeshPro 會把「<」當成標籤開頭，內文只能出現真正的標籤
        [Test]
        public void RichText_HasOnlyKnownTags()
        {
            var allowed = new Regex("^</?(b|i|size(=[^>]+)?|color(=[^>]+)?)>$");
            for (int i = 0; i < 3; i++)
                foreach (Match m in Regex.Matches(GuideText.Page(i), "<[^<>]*>?"))
                    Assert.IsTrue(allowed.IsMatch(m.Value), $"第 {i} 頁有奇怪的「{m.Value}」");
        }
    }

    public class TutorialSettingsTests
    {
        [Test]
        public void Defaults()
        {
            var s = new TutorialSettings(new MemorySettingsStore());
            Assert.AreEqual(1f, s.AnimSpeed);
            Assert.AreEqual("標準", s.AnimSpeedLabel);
            Assert.IsTrue(s.ScreenShake);
            Assert.IsTrue(s.Hints);
            Assert.AreEqual(0, s.ChaptersDone);
        }

        [Test]
        public void Values_PersistInStore_UnderTutorialKeysOnly()
        {
            var store = new MemorySettingsStore();
            var s = new TutorialSettings(store);
            s.AnimSpeedIndex = 2; s.ScreenShake = false; s.Hints = false; s.MarkChapterDone(3);

            var again = new TutorialSettings(store);
            Assert.AreEqual(1.5f, again.AnimSpeed);
            Assert.IsFalse(again.ScreenShake);
            Assert.IsFalse(again.Hints);
            Assert.IsTrue(again.IsChapterDone(3));
            Assert.IsFalse(again.IsChapterDone(2));

            foreach (var key in new[] { TutorialSettings.AnimSpeedKey, TutorialSettings.ShakeKey, TutorialSettings.HintsKey, TutorialSettings.ChapterKey(3) })
            {
                StringAssert.StartsWith("HoneymoonBridgeTutorial.", key, "教學版的儲存鍵要跟原版分開");
                Assert.IsTrue(store.Has(key), key);
            }
        }

        [Test]
        public void SpeedIsClamped()
        {
            var s = new TutorialSettings(new MemorySettingsStore());
            s.AnimSpeedIndex = 99; Assert.AreEqual(1.5f, s.AnimSpeed);
            s.AnimSpeedIndex = -5; Assert.AreEqual(0.75f, s.AnimSpeed);
        }

        [Test]
        public void ResetProgress_OnlyClearsChapters()
        {
            var s = new TutorialSettings(new MemorySettingsStore());
            s.Hints = false;
            s.MarkChapterDone(1); s.MarkChapterDone(5);
            Assert.AreEqual(2, s.ChaptersDone);
            s.ResetProgress();
            Assert.AreEqual(0, s.ChaptersDone);
            Assert.IsFalse(s.Hints, "重設進度不該動到其他設定");
        }

        [Test]
        public void Changed_FiresOnEveryWrite()
        {
            var s = new TutorialSettings(new MemorySettingsStore());
            int n = 0; s.Changed += () => n++;
            s.Hints = false; s.ScreenShake = true; s.AnimSpeedIndex = 0; s.MarkChapterDone(1);
            Assert.AreEqual(4, n);
        }
    }
}
