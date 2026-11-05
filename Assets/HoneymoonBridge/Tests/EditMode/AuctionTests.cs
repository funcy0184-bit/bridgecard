using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 叫牌規則（docs/SPEC.md 第 2 節）：蓋叫、加倍、再加倍、Pass 定約、雙 Pass 重發
    public class AuctionTests
    {
        HoneymoonGame g;
        List<GameEvent> log;
        int p, o;   // p = 先叫的人，o = 對手

        static int B(int level, Strain s) => new Bid(level, s).Index;

        [SetUp]
        public void SetUp()
        {
            log = new List<GameEvent>();
            g = new HoneymoonGame(11);
            g.Emitted += (e, to) => log.Add(e);
            g.StartNewMatch();
            TestUtil.FinishDrawPhase(g);
            p = g.CurrentPlayer;
            o = 1 - p;
        }

        [Test]
        public void CannotDouble_BeforeAnyBid()
        {
            Assert.IsFalse(g.MakeCall(p, Call.Double));
            Assert.IsFalse(g.MakeCall(p, Call.Redouble));
        }

        [Test]
        public void CannotDouble_OwnBid()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            g.MakeCall(o, Call.Double);
            Assert.IsFalse(g.CanDouble(p), "莊家不能加倍自己的合約");
        }

        [Test]
        public void Defender_Doubles_ThenPass_SetsDoubledContract()
        {
            Assert.IsTrue(g.MakeCall(p, B(3, Strain.Hearts)));
            Assert.IsTrue(g.CanDouble(o));
            Assert.IsTrue(g.MakeCall(o, Call.Double));
            Assert.AreEqual(1, g.Doubled);
            Assert.AreEqual(p, g.CurrentPlayer, "加倍後輪到被加倍的莊家");
            Assert.IsTrue(g.MakeCall(p, Call.Pass));

            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(p, g.Declarer);
            Assert.AreEqual(1, g.Doubled);
            var set = log.Last(e => e.type == GameEventType.ContractSet);
            Assert.AreEqual(1, set.extra, "ContractSet 要帶加倍狀態");
        }

        [Test]
        public void Declarer_Redoubles_ThenPass_SetsRedoubledContract()
        {
            g.MakeCall(p, B(2, Strain.Spades));
            g.MakeCall(o, Call.Double);
            Assert.IsTrue(g.CanRedouble(p));
            Assert.IsTrue(g.MakeCall(p, Call.Redouble));
            Assert.AreEqual(2, g.Doubled);
            Assert.AreEqual(o, g.CurrentPlayer, "再加倍後輪到加倍的人");
            Assert.IsTrue(g.MakeCall(o, Call.Pass));
            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(2, g.Doubled);
        }

        [Test]
        public void CannotDoubleTwice_OrRedoubleTwice()
        {
            g.MakeCall(p, B(2, Strain.Spades));
            g.MakeCall(o, Call.Double);
            g.MakeCall(p, Call.Redouble);
            Assert.IsFalse(g.MakeCall(o, Call.Double), "已經加倍過了");
            Assert.IsFalse(g.MakeCall(o, Call.Redouble), "加倍的人不能再加倍");
        }

        [Test]
        public void CannotRedouble_WithoutDouble()
        {
            g.MakeCall(p, B(1, Strain.Clubs));
            Assert.IsFalse(g.MakeCall(o, Call.Redouble));
        }

        [Test]
        public void Overcall_ClearsDouble()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            g.MakeCall(o, Call.Double);
            Assert.IsTrue(g.MakeCall(p, B(3, Strain.Clubs)), "被加倍的莊家可以改叫逃走");
            Assert.AreEqual(0, g.Doubled, "蓋叫後舊合約的加倍狀態清除");
            Assert.IsTrue(g.CanDouble(o), "新的合約可以再被加倍一次");
        }

        [Test]
        public void Overcall_AfterRedouble_ClearsIt()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            g.MakeCall(o, Call.Double);
            g.MakeCall(p, Call.Redouble);
            Assert.IsTrue(g.MakeCall(o, B(3, Strain.Spades)));
            Assert.AreEqual(0, g.Doubled);
            Assert.AreEqual(o, g.HighestBidder);
            g.MakeCall(p, Call.Pass);
            Assert.AreEqual(o, g.Declarer);
            Assert.AreEqual(0, g.Doubled);
        }

        [Test]
        public void PassAfterBid_NotDoubled_IsPlainContract()
        {
            g.MakeCall(p, B(1, Strain.NoTrump));
            g.MakeCall(o, Call.Pass);
            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(0, g.Doubled);
        }

        [Test]
        public void FirstPass_ThenBid_ThenPass_SetsContract()
        {
            g.MakeCall(p, Call.Pass);
            Assert.AreEqual(Phase.Bidding, g.Phase);
            g.MakeCall(o, B(1, Strain.Diamonds));
            g.MakeCall(p, Call.Pass);
            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(o, g.Declarer);
        }

        [Test]
        public void BothPassAtStart_Redeals_ScoresUnchanged_AuctionCleared()
        {
            int s0 = g.Scores[0], s1 = g.Scores[1];
            g.MakeCall(p, Call.Pass);
            g.MakeCall(o, Call.Pass);
            Assert.AreEqual(Phase.Draw, g.Phase);
            Assert.AreEqual(s0, g.Scores[0]);
            Assert.AreEqual(s1, g.Scores[1]);
            Assert.AreEqual(0, g.Auction.Count);
            Assert.AreEqual(1, g.ViewFor(0).handNumber, "重發不算一局");
        }

        [Test]
        public void AuctionHistory_IsRecordedInOrder_AndVisibleToBothSeats()
        {
            g.MakeCall(p, Call.Pass);
            g.MakeCall(o, B(1, Strain.Spades));
            g.MakeCall(p, B(2, Strain.Hearts));
            g.MakeCall(o, Call.Double);
            g.MakeCall(p, Call.Redouble);
            g.MakeCall(o, Call.Pass);

            var calls = new[] { Call.Pass, B(1, Strain.Spades), B(2, Strain.Hearts), Call.Double, Call.Redouble, Call.Pass };
            var seats = new[] { p, o, p, o, p, o };
            for (int s = 0; s < 2; s++)
            {
                var v = g.ViewFor(s);
                CollectionAssert.AreEqual(calls, v.auctionCalls, $"座位 {s} 的叫牌紀錄");
                CollectionAssert.AreEqual(seats, v.auctionSeats);
            }
            Assert.AreEqual(Phase.Play, g.Phase, "打牌中叫牌紀錄還在，可以回看");
        }

        [Test]
        public void RejectedCall_IsNotRecorded()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            Assert.IsFalse(g.MakeCall(o, B(1, Strain.NoTrump)));
            Assert.IsFalse(g.MakeCall(p, Call.Pass), "不是 p 的回合");
            Assert.AreEqual(1, g.Auction.Count);
        }

        [Test]
        public void View_CanDoubleFlags_OnlyOnMyTurn()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            Assert.IsTrue(g.ViewFor(o).canDouble);
            Assert.IsFalse(g.ViewFor(p).canDouble, "不是我的回合");
            g.MakeCall(o, Call.Double);
            Assert.IsTrue(g.ViewFor(p).canRedouble);
            Assert.IsFalse(g.ViewFor(o).canRedouble);
            Assert.AreEqual(1, g.ViewFor(o).doubled);
        }

        [Test]
        public void DoubleAndRedouble_EmitEvents()
        {
            g.MakeCall(p, B(2, Strain.Hearts));
            g.MakeCall(o, Call.Double);
            g.MakeCall(p, Call.Redouble);
            var d = log.Single(e => e.type == GameEventType.Doubled);
            var rd = log.Single(e => e.type == GameEventType.Redoubled);
            Assert.AreEqual(o, d.seat);
            Assert.AreEqual(p, rd.seat);
            Assert.AreEqual(B(2, Strain.Hearts), d.value);
        }
    }
}
