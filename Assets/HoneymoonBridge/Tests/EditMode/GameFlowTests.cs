using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 遊戲流程：抽牌 → 叫牌 → 打牌 的狀態機
    public class GameFlowTests
    {
        static HoneymoonGame NewGame(int seed, List<GameEvent> log = null)
        {
            var g = new HoneymoonGame(seed);
            if (log != null) g.Emitted += (e, to) => log.Add(e);
            g.StartNew();
            return g;
        }

        static void FinishDrawPhase(HoneymoonGame g) => TestUtil.FinishDrawPhase(g);

        [Test]
        public void StartNew_Deals13Each_And26InStock()
        {
            var g = NewGame(1);
            Assert.AreEqual(Phase.Draw, g.Phase);
            Assert.AreEqual(13, g.Hands[0].Count);
            Assert.AreEqual(13, g.Hands[1].Count);
            Assert.AreEqual(26, g.Stock.Count);
            Assert.AreEqual(Strain.NoTrump, g.Trump, "抽牌階段全程無王");
        }

        [Test]
        public void StartNew_FirstSeatAlternatesEachHand()
        {
            var g = NewGame(1);
            int first = g.Leader;
            g.StartNew();
            Assert.AreEqual(1 - first, g.Leader);
        }

        [Test]
        public void DrawPhase_Lasts13Tricks_ThenBidding()
        {
            var g = NewGame(7);
            int tricks = 0;
            while (g.Phase == Phase.Draw)
            {
                if (g.TrickComplete) { g.ResolveTrick(); tricks++; }
                else g.PlayCard(g.CurrentPlayer, SimpleAI.ChooseCard(g, g.CurrentPlayer));
            }
            Assert.AreEqual(13, tricks);
            Assert.AreEqual(Phase.Bidding, g.Phase);
            Assert.AreEqual(0, g.Stock.Count);
        }

        [Test]
        public void Bidding_BothPassAtStart_Redeals()
        {
            var log = new List<GameEvent>();
            var g = NewGame(3, log);
            FinishDrawPhase(g);
            int p = g.CurrentPlayer;
            Assert.IsTrue(g.MakeBid(p, null));
            Assert.AreEqual(Phase.Bidding, g.Phase, "只有一人 Pass 還不能重發");
            Assert.IsTrue(g.MakeBid(1 - p, null));
            Assert.IsTrue(log.Any(e => e.type == GameEventType.Redeal));
            Assert.AreEqual(Phase.Draw, g.Phase);
            Assert.AreEqual(26, g.Stock.Count);
        }

        [Test]
        public void Bidding_PassAfterBid_SetsContract_NonDeclarerLeads()
        {
            var g = NewGame(4);
            FinishDrawPhase(g);
            int p = g.CurrentPlayer;
            Assert.IsTrue(g.MakeBid(p, new Bid(2, Strain.Hearts)));
            Assert.IsTrue(g.MakeBid(1 - p, null));
            Assert.AreEqual(Phase.Play, g.Phase);
            Assert.AreEqual(p, g.Declarer);
            Assert.AreEqual(Strain.Hearts, g.Trump);
            Assert.AreEqual(1 - p, g.Leader, "由非莊家首攻");
        }

        [Test]
        public void Bidding_Overcall_ChangesDeclarer()
        {
            var g = NewGame(5);
            FinishDrawPhase(g);
            int p = g.CurrentPlayer;
            Assert.IsTrue(g.MakeBid(p, new Bid(1, Strain.Spades)));
            Assert.IsTrue(g.MakeBid(1 - p, new Bid(2, Strain.Clubs)));
            Assert.IsTrue(g.MakeBid(p, null));
            Assert.AreEqual(1 - p, g.Declarer);
            Assert.AreEqual(new Bid(2, Strain.Clubs).Index, g.HighestBid.Value.Index);
        }

        [Test]
        public void Bidding_RejectsLowerOrEqualBid_AndOutOfTurn()
        {
            var g = NewGame(6);
            FinishDrawPhase(g);
            int p = g.CurrentPlayer;
            Assert.IsFalse(g.MakeBid(1 - p, new Bid(1, Strain.Clubs)), "不是你的回合");
            Assert.IsTrue(g.MakeBid(p, new Bid(2, Strain.Hearts)));
            Assert.IsFalse(g.MakeBid(1 - p, new Bid(2, Strain.Hearts)), "同樣的叫品不能再叫");
            Assert.IsFalse(g.MakeBid(1 - p, new Bid(2, Strain.Diamonds)), "比目前低的叫品不能叫");
            Assert.IsTrue(g.MakeBid(1 - p, new Bid(2, Strain.Spades)));
        }

        [Test]
        public void Play_IllegalCard_IsRejected_AndOnlyReportedToThatSeat()
        {
            var routed = new List<(GameEvent e, int to)>();
            var g = new HoneymoonGame(8);
            g.Emitted += (e, to) => routed.Add((e, to));
            g.StartNew();

            // 一直打到跟牌的人「有首引花色，手上也有別的花色」為止，試著不跟
            for (int guard = 0; guard < 200; guard++)
            {
                if (g.Phase != Phase.Draw) break;
                if (g.TrickComplete) { g.ResolveTrick(); continue; }
                int p = g.CurrentPlayer;
                if (p != g.Leader)
                {
                    var legal = g.LegalFor(p);
                    var bad = g.Hands[p].Where(c => !legal.Contains(c)).ToList();
                    if (bad.Count > 0)
                    {
                        int count = g.Hands[p].Count;
                        Assert.IsFalse(g.PlayCard(p, bad[0]));
                        Assert.AreEqual(count, g.Hands[p].Count);
                        var ev = routed.Last();
                        Assert.AreEqual(GameEventType.Illegal, ev.e.type);
                        Assert.AreEqual(p, ev.to, "非法出牌只通知本人");
                        return;
                    }
                }
                g.PlayCard(p, SimpleAI.ChooseCard(g, p));
            }
            Assert.Inconclusive("這個種子沒有出現能測非法出牌的局面");
        }

        [Test]
        public void DrawPhase_HiddenCard_OnlyVisibleToDrawer()
        {
            var routed = new List<(GameEvent e, int to)>();
            var g = new HoneymoonGame(9);
            g.Emitted += (e, to) => routed.Add((e, to));
            g.StartNew();
            FinishDrawPhase(g);

            var drawn = routed.Where(r => r.e.type == GameEventType.CardDrawn).ToList();
            Assert.AreEqual(26, drawn.Count, "13 墩 × 每墩兩個版本（本人 / 對手）");
            foreach (var (e, to) in drawn)
            {
                Assert.AreNotEqual(-1, to, "暗牌事件不能廣播");
                if (to == e.seat) Assert.GreaterOrEqual(e.card, 0, "本人要看得到摸到什麼");
                else Assert.AreEqual(-1, e.card, "對手不能看到暗牌");
            }
        }

        [Test]
        public void SameSeed_SameWholeGame()
        {
            var a = GameSimulator.PlayOne(12345);
            var b = GameSimulator.PlayOne(12345);
            Assert.AreEqual(a.Declarer, b.Declarer);
            Assert.AreEqual(a.TricksTaken, b.TricksTaken);
            Assert.AreEqual(a.TricksNeeded, b.TricksNeeded);
            Assert.AreEqual(a.Steps, b.Steps);
        }
    }
}
