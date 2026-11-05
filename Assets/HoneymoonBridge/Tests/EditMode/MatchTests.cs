using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 多局累計、先到目標分贏得整場
    public class MatchTests
    {
        [Test]
        public void NewMatch_StartsAtZero_Hand1()
        {
            var g = new HoneymoonGame(1);
            g.StartNewMatch();
            var v = g.ViewFor(0);
            Assert.AreEqual(0, v.myScore);
            Assert.AreEqual(0, v.oppScore);
            Assert.AreEqual(100, v.targetScore);
            Assert.AreEqual(1, v.handNumber);
            Assert.IsFalse(v.hasResult);
            Assert.AreEqual(-1, v.matchWinner);
        }

        [Test]
        public void FinishedHand_AddsPointsToScorerOnly_AndEmitsHandScored()
        {
            var log = new List<GameEvent>();
            var g = new HoneymoonGame(2);
            g.Emitted += (e, to) => log.Add(e);
            g.StartNewMatch();
            TestUtil.PlayHandWithContract(g, new Bid(1, Strain.NoTrump));

            Assert.AreEqual(Phase.Finished, g.Phase);
            var r = g.LastResult;
            Assert.IsNotNull(r);
            Assert.AreEqual(1, r.handNumber);
            Assert.AreEqual(r.points, g.Scores[r.scorer]);
            Assert.AreEqual(0, g.Scores[1 - r.scorer]);

            var scored = log.Single(e => e.type == GameEventType.HandScored);
            Assert.AreEqual(r.scorer, scored.seat);
            Assert.AreEqual(r.points, scored.value);

            var v = g.ViewFor(r.scorer);
            Assert.IsTrue(v.hasResult);
            Assert.AreEqual(r.points, v.myScore);
            Assert.AreEqual(1, v.handNumber, "打完第 1 局時畫面還是顯示第 1 局");
        }

        [Test]
        public void ScoresCarryOver_ToNextHand()
        {
            var g = new HoneymoonGame(3);
            g.StartNewMatch();
            TestUtil.PlayHandWithContract(g, new Bid(1, Strain.Clubs));
            int s0 = g.Scores[0], s1 = g.Scores[1];
            Assert.IsFalse(g.MatchOver);

            g.StartNew();
            Assert.AreEqual(s0, g.Scores[0]);
            Assert.AreEqual(s1, g.Scores[1]);
            Assert.AreEqual(2, g.ViewFor(0).handNumber);
            Assert.IsNull(g.LastResult, "新的一局還沒有明細");
        }

        [Test]
        public void ReachingTarget_EndsMatch()
        {
            var log = new List<GameEvent>();
            var g = new HoneymoonGame(4, targetScore: 1);    // 任何得分都會到 1 分
            g.Emitted += (e, to) => log.Add(e);
            g.StartNewMatch();
            TestUtil.PlayHandWithContract(g, new Bid(2, Strain.Spades));

            Assert.IsTrue(g.MatchOver);
            Assert.AreEqual(g.LastResult.scorer, g.MatchWinner);
            var over = log.Single(e => e.type == GameEventType.MatchOver);
            Assert.AreEqual(g.MatchWinner, over.seat);
            Assert.AreEqual(g.Scores[g.MatchWinner], over.value);
            Assert.AreEqual(g.MatchWinner, g.ViewFor(0).matchWinner);
        }

        [Test]
        public void AfterMatchOver_StartNew_BeginsFreshMatch()
        {
            var g = new HoneymoonGame(5, targetScore: 1);
            g.StartNewMatch();
            TestUtil.PlayHandWithContract(g, new Bid(1, Strain.Hearts));
            Assert.IsTrue(g.MatchOver);

            g.StartNew();
            Assert.IsFalse(g.MatchOver);
            Assert.AreEqual(0, g.Scores[0]);
            Assert.AreEqual(0, g.Scores[1]);
            Assert.AreEqual(1, g.ViewFor(0).handNumber);
        }

        [Test]
        public void HighScoresNotYetAtTarget_DoNotEndMatch()
        {
            var g = new HoneymoonGame(6, targetScore: 10000);
            g.StartNewMatch();
            for (int i = 0; i < 5; i++)
            {
                TestUtil.PlayHandWithContract(g, new Bid(1, Strain.Clubs));
                Assert.IsFalse(g.MatchOver);
                g.StartNew();
            }
            Assert.AreEqual(6, g.ViewFor(0).handNumber);
        }
    }
}
