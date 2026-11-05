using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tutorial.Tests
{
    // 每一題都用「標準解法」和「錯誤示範」實際打一次：
    // 標準解法一定要過關，錯誤示範要被擋下來或要求重來。改題目後跑這支就知道題目有沒有壞掉。
    public class TutorialCatalogTests
    {
        static Card C(string s) => CardText.One(s);
        static Lesson L(int chapter, int index) => TutorialCatalog.Get(chapter).Lessons[index];

        // 一直推進到這題結束。玩家的動作由 call / card 決定；對手照劇本走
        static TutorialSession Run(Lesson lesson, Func<HoneymoonGame, int> call = null, Func<HoneymoonGame, Card> card = null)
        {
            var s = new TutorialSession(lesson);
            s.Start();
            for (int guard = 0; guard < 500 && !s.Finished; guard++)
            {
                if (s.NeedsResolve) s.Resolve();
                else if (s.OpponentToAct) s.OpponentAct();
                else if (s.PlayerToAct)
                {
                    if (s.Game.Phase == Phase.Bidding)
                        Assert.IsNull(s.TryCall(call(s.Game)), "玩家的叫法被擋下來了");
                    else
                        Assert.IsNull(s.TryPlay(card(s.Game)), "玩家的出牌被擋下來了");
                }
                else Assert.Fail($"卡住了：phase={s.Game.Phase}，輪到 {s.Game.CurrentPlayer}");
            }
            Assert.IsTrue(s.Finished, "500 步內沒有結束");
            return s;
        }

        static void AssertNoLeak(TutorialSession s)
        {
            foreach (var e in s.Events)
                if (e.type == GameEventType.CardDrawn && e.seat == TutorialSession.Opponent)
                    Assert.AreEqual(-1, e.card, "玩家收到了對手摸到的暗牌");
        }

        // ---------------- 整體 ----------------

        [Test]
        public void Catalog_HasFiveChapters_InOrder()
        {
            CollectionAssert.AreEqual(new[] { 1, 2, 3, 4, 5 }, TutorialCatalog.Chapters.Select(c => c.Number));
            Assert.AreEqual("第三章・跟牌與王吃", TutorialCatalog.Get(3).Heading);
            Assert.IsTrue(TutorialCatalog.Get(5).IsFreePlay);
            foreach (var ch in TutorialCatalog.Chapters.Where(c => !c.IsFreePlay))
                Assert.AreEqual(2, ch.Lessons.Count, ch.Heading);
        }

        [Test]
        public void EveryLesson_SetsUpAValidTable()
        {
            foreach (var ch in TutorialCatalog.Chapters)
                foreach (var lesson in ch.Lessons)
                {
                    var g = lesson.Setup();
                    var all = g.Hands[0].Concat(g.Hands[1]).Concat(g.Stock).ToList();
                    Assert.AreEqual(all.Count, all.Distinct().Count(), $"{lesson.Title}：有重複的牌");
                    Assert.AreEqual(g.Hands[0].Count, g.Hands[1].Count, $"{lesson.Title}：雙方張數不同");
                    Assert.IsFalse(string.IsNullOrWhiteSpace(lesson.Instruction), lesson.Title);
                    Assert.IsNotNull(lesson.Evaluate, lesson.Title);
                    var expected = lesson.EndsAt == LessonEnd.ContractSet ? Phase.Bidding : (Phase?)null;
                    if (expected.HasValue) Assert.AreEqual(expected.Value, g.Phase, lesson.Title);
                }
        }

        [Test]
        public void SetupIsDeterministic()
        {
            foreach (var lesson in TutorialCatalog.Chapters.SelectMany(c => c.Lessons))
            {
                var a = lesson.Setup(); var b = lesson.Setup();
                CollectionAssert.AreEqual(a.Hands[0], b.Hands[0], lesson.Title);
                CollectionAssert.AreEqual(a.Hands[1], b.Hands[1], lesson.Title);
                CollectionAssert.AreEqual(a.Stock, b.Stock, lesson.Title);
            }
        }

        // ---------------- 第一章 ----------------

        [Test]
        public void Ch1_L1_LeadAce_GrabsFaceUpSpadeAce()
        {
            var s = Run(L(1, 0), card: g => C("♥A"));
            Assert.IsTrue(s.Verdict.Passed, s.Verdict.Message);
            CollectionAssert.Contains(s.Game.Hands[0], C("♠A"), "贏墩的人要拿到明牌 ♠A");
            AssertNoLeak(s);
        }

        [Test]
        public void Ch1_L1_LeadLowClub_LosesFaceUp_AndMustRetry()
        {
            var s = Run(L(1, 0), card: g => C("♣2"));
            Assert.IsFalse(s.Verdict.Passed);
            StringAssert.Contains("再試一次", s.Verdict.Message);
            CollectionAssert.Contains(s.Game.Hands[1], C("♠A"));
            AssertNoLeak(s);
        }

        [Test]
        public void Ch1_L2_OpponentLeadsDiamondNine_BothChoicesPass()
        {
            var spend = Run(L(1, 1), card: g => C("♦A"));
            Assert.IsTrue(spend.Verdict.Passed);
            StringAssert.Contains("留到打牌階段", spend.Verdict.Message);
            var opp = spend.Events.First(e => e.type == GameEventType.CardPlayed);
            Assert.AreEqual(TutorialSession.Opponent, opp.seat);
            Assert.AreEqual(C("♦9").Id, opp.card, "照劇本對手要先出 ♦9");

            var save = Run(L(1, 1), card: g => C("♦3"));
            Assert.IsTrue(save.Verdict.Passed);
            StringAssert.Contains("聰明", save.Verdict.Message);
            CollectionAssert.Contains(save.Game.Hands[0], C("♦A"));
        }

        // ---------------- 第二章 ----------------

        [Test]
        public void Ch2_L1_OnlyTwoHeartsIsAccepted()
        {
            var s = new TutorialSession(L(2, 0));
            s.Start();
            Assert.IsTrue(s.PlayerToAct);
            StringAssert.Contains("請叫 2♥", s.TryCall(Call.Pass));
            Assert.IsNull(s.TryCall(new Bid(2, Strain.Hearts).Index), "2♥ 本身不該被擋");
        }

        [Test]
        public void Ch2_L1_WrongBid_IsRejected_StateUnchanged()
        {
            var s = new TutorialSession(L(2, 0));
            s.Start();
            var hint = s.TryCall(new Bid(3, Strain.Hearts).Index);
            StringAssert.Contains("9 墩", hint);
            Assert.AreEqual(0, s.Game.Auction.Count, "被擋下的叫法不能記進叫牌紀錄");
            Assert.IsTrue(s.PlayerToAct);
        }

        [Test]
        public void Ch2_L1_BidTwoHearts_ContractSet()
        {
            var s = Run(L(2, 0), call: g => new Bid(2, Strain.Hearts).Index);
            Assert.IsTrue(s.Verdict.Passed, s.Verdict.Message);
            Assert.AreEqual(Phase.Play, s.Game.Phase);
            Assert.AreEqual(0, s.Game.Declarer);
            Assert.AreEqual(new Bid(2, Strain.Hearts).Index, s.Game.HighestBid.Value.Index);
            StringAssert.Contains("8 墩", s.Verdict.Message);
        }

        [Test]
        public void Ch2_L2_OpponentOpensFourSpades_PlayerMustDouble()
        {
            var s = new TutorialSession(L(2, 1));
            s.Start();
            Assert.IsTrue(s.OpponentToAct, "這題對手先叫");
            s.OpponentAct();
            Assert.AreEqual(new Bid(4, Strain.Spades).Index, s.Game.Auction[0].Call);
            StringAssert.Contains("加倍", s.TryCall(Call.Pass));
            StringAssert.Contains("加倍", s.TryCall(new Bid(5, Strain.Spades).Index));
            Assert.IsNull(s.TryCall(Call.Double));
            while (!s.Finished && s.OpponentToAct) s.OpponentAct();
            Assert.IsTrue(s.Verdict.Passed, s.Verdict?.Message);
            Assert.AreEqual(1, s.Game.Doubled);
            Assert.AreEqual(TutorialSession.Opponent, s.Game.Declarer);
        }

        // ---------------- 第三章 ----------------

        [Test]
        public void Ch3_L1_MustFollowSpade_IllegalCardBouncesWithIllegalEvent()
        {
            var s = new TutorialSession(L(3, 0));
            s.Start();
            Assert.IsTrue(s.OpponentToAct, "非莊家首攻");
            s.OpponentAct();
            Assert.AreEqual(C("♠K"), s.Game.LeadCard.Value);

            Assert.IsNull(s.TryPlay(C("♥K")), "沒跟花色交給正式規則處理（發 Illegal 事件）");
            CollectionAssert.Contains(s.Game.Hands[0], C("♥K"), "沒跟花色的牌不能被出掉");
            Assert.AreEqual(GameEventType.Illegal, s.Events.Last().type);
            Assert.IsTrue(s.PlayerToAct);
        }

        [TestCase("♠A", "贏下這一墩")]
        [TestCase("♠7", "規則你做對了")]
        public void Ch3_L1_AnySpadePasses(string card, string expect)
        {
            var s = Run(L(3, 0), card: g => C(card));
            Assert.IsTrue(s.Verdict.Passed);
            StringAssert.Contains(expect, s.Verdict.Message);
        }

        [Test]
        public void Ch3_L2_DiscardIsRejected_RuffPassesWithRuffEvent()
        {
            var s = new TutorialSession(L(3, 1));
            s.Start();
            s.OpponentAct();
            Assert.AreEqual(C("♣A"), s.Game.LeadCard.Value);
            StringAssert.Contains("紅心", s.TryPlay(C("♠K")));
            CollectionAssert.Contains(s.Game.Hands[0], C("♠K"));

            Assert.IsNull(s.TryPlay(C("♥2")));
            var played = s.Events.Last(e => e.type == GameEventType.CardPlayed);
            Assert.AreEqual(1, played.extra, "要觸發原本的「王吃」事件（震動、跳字）");
            s.Resolve();
            Assert.IsTrue(s.Verdict.Passed, s.Verdict.Message);
            StringAssert.Contains("王吃", s.Verdict.Message);
        }

        // ---------------- 第四章 ----------------

        [Test]
        public void Ch4_L1_ExactMake_Is30Points()
        {
            var s = Run(L(4, 0), card: g => g.LegalFor(0)[0]);
            Assert.IsTrue(s.Verdict.Passed, s.Verdict.Message);
            Assert.AreEqual(Phase.Finished, s.Game.Phase);
            Assert.AreEqual(9, s.Game.TricksWon[0]);
            Assert.AreEqual(30, s.Game.LastResult.points);
            StringAssert.Contains("30", s.Verdict.Message);
        }

        [Test]
        public void Ch4_L2_OneOvertrick_Is32Points()
        {
            var s = Run(L(4, 1), card: g => g.LegalFor(0)[0]);
            Assert.IsTrue(s.Verdict.Passed, s.Verdict.Message);
            Assert.AreEqual(10, s.Game.TricksWon[0]);
            Assert.AreEqual(32, s.Game.LastResult.points);
            Assert.AreEqual(2, s.Game.LastResult.overtrickPoints);
        }

        [Test]
        public void Ch4_BothLessons_AreForced_NoMatterWhichLegalCard()
        {
            // 殘局設計成「怎麼出結果都一樣」，玩家不會因為選錯牌而看不到要教的分數
            foreach (var pick in new Func<List<Card>, Card>[] { l => l[0], l => l[l.Count - 1] })
            {
                Assert.AreEqual(30, Run(L(4, 0), card: g => pick(g.LegalFor(0))).Game.LastResult.points);
                Assert.AreEqual(32, Run(L(4, 1), card: g => pick(g.LegalFor(0))).Game.LastResult.points);
            }
        }

        // ---------------- 其他 ----------------

        [Test]
        public void RestartingALesson_ResetsEverything()
        {
            var s = new TutorialSession(L(1, 0));
            s.Start();
            s.TryPlay(C("♣2"));
            s.Start();
            Assert.IsFalse(s.Finished);
            Assert.AreEqual(0, s.Events.Count);
            Assert.AreEqual(13, s.Game.Hands[0].Count);
            Assert.IsTrue(s.PlayerToAct);
        }

        [Test]
        public void PlayerCannotAct_OnOpponentsTurn()
        {
            var s = new TutorialSession(L(2, 1));
            s.Start();
            Assert.IsNotNull(s.TryCall(Call.Pass));
            Assert.AreEqual(0, s.Game.Auction.Count);
        }
    }
}
