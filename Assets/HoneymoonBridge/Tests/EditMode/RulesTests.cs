using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 規則的單元測試：每一條都對應 README「規則」章節的一句話
    public class RulesTests
    {
        static Card C(Suit s, int r) => new Card(s, r);

        // ---------- 牌與叫品 ----------

        [Test]
        public void CardId_RoundTripsAll52()
        {
            for (int id = 0; id < 52; id++)
                Assert.AreEqual(id, Card.FromId(id).Id);
        }

        [Test]
        public void Hcp_IsA4K3Q2J1()
        {
            Assert.AreEqual(4, C(Suit.Spades, 14).Hcp);
            Assert.AreEqual(3, C(Suit.Spades, 13).Hcp);
            Assert.AreEqual(2, C(Suit.Spades, 12).Hcp);
            Assert.AreEqual(1, C(Suit.Spades, 11).Hcp);
            Assert.AreEqual(0, C(Suit.Spades, 10).Hcp);
            Assert.AreEqual(10, BridgeRules.Hcp(new[] { C(Suit.Clubs, 14), C(Suit.Hearts, 13), C(Suit.Hearts, 12), C(Suit.Diamonds, 11) }));
        }

        [Test]
        public void Bid_OrderIsClubsDiamondsHeartsSpadesNoTrump_ThenNextLevel()
        {
            Assert.Less(new Bid(1, Strain.Clubs).Index, new Bid(1, Strain.Diamonds).Index);
            Assert.Less(new Bid(1, Strain.Spades).Index, new Bid(1, Strain.NoTrump).Index);
            Assert.Less(new Bid(1, Strain.NoTrump).Index, new Bid(2, Strain.Clubs).Index);
            for (int i = 0; i < 35; i++) Assert.AreEqual(i, Bid.FromIndex(i).Index);
        }

        [TestCase(1, 7)]
        [TestCase(2, 8)]
        [TestCase(3, 9)]
        [TestCase(7, 13)]
        public void Bid_TricksNeeded_IsLevelPlusSix(int level, int needed)
        {
            Assert.AreEqual(needed, new Bid(level, Strain.Hearts).TricksNeeded);
        }

        // ---------- 牌堆 ----------

        [Test]
        public void Deck_Has52UniqueCards()
        {
            var d = Deck.NewShuffled(new Random(1));
            Assert.AreEqual(52, d.Count);
            Assert.AreEqual(52, d.Select(c => c.Id).Distinct().Count());
        }

        [Test]
        public void Deck_SameSeed_SameShuffle()
        {
            var a = Deck.NewShuffled(new Random(42)).Select(c => c.Id);
            var b = Deck.NewShuffled(new Random(42)).Select(c => c.Id);
            CollectionAssert.AreEqual(a, b);
        }

        [Test]
        public void SortHand_SpadesHeartsDiamondsClubs_HighToLow()
        {
            var h = new List<Card> { C(Suit.Clubs, 2), C(Suit.Spades, 3), C(Suit.Hearts, 14), C(Suit.Spades, 14), C(Suit.Diamonds, 9) };
            Deck.SortHand(h);
            CollectionAssert.AreEqual(
                new[] { C(Suit.Spades, 14), C(Suit.Spades, 3), C(Suit.Hearts, 14), C(Suit.Diamonds, 9), C(Suit.Clubs, 2) }, h);
        }

        // ---------- 跟牌 ----------

        [Test]
        public void LegalPlays_Leader_CanPlayAnything()
        {
            var h = new List<Card> { C(Suit.Spades, 2), C(Suit.Hearts, 5) };
            Assert.AreEqual(2, BridgeRules.LegalPlays(h, null).Count);
        }

        [Test]
        public void LegalPlays_MustFollowSuit_WhenAble()
        {
            var h = new List<Card> { C(Suit.Spades, 2), C(Suit.Hearts, 5), C(Suit.Hearts, 9) };
            var legal = BridgeRules.LegalPlays(h, C(Suit.Hearts, 14));
            CollectionAssert.AreEquivalent(new[] { C(Suit.Hearts, 5), C(Suit.Hearts, 9) }, legal);
        }

        [Test]
        public void LegalPlays_Void_CanDiscardOrRuff()
        {
            var h = new List<Card> { C(Suit.Spades, 2), C(Suit.Clubs, 5) };
            Assert.AreEqual(2, BridgeRules.LegalPlays(h, C(Suit.Hearts, 14)).Count);
        }

        // ---------- 比大小 ----------

        [Test]
        public void Beats_SameSuit_HigherRankWins()
        {
            Assert.IsTrue(BridgeRules.Beats(C(Suit.Hearts, 13), C(Suit.Hearts, 12), Strain.NoTrump));
            Assert.IsFalse(BridgeRules.Beats(C(Suit.Hearts, 2), C(Suit.Hearts, 3), Strain.NoTrump));
        }

        [Test]
        public void Beats_OffSuitDiscard_NeverWins()
        {
            Assert.IsFalse(BridgeRules.Beats(C(Suit.Spades, 14), C(Suit.Hearts, 2), Strain.NoTrump));
            Assert.IsFalse(BridgeRules.Beats(C(Suit.Spades, 14), C(Suit.Hearts, 2), Strain.Clubs));
        }

        [Test]
        public void Beats_SmallTrump_RuffsBigNonTrump()
        {
            Assert.IsTrue(BridgeRules.Beats(C(Suit.Clubs, 2), C(Suit.Hearts, 14), Strain.Clubs));
            Assert.IsFalse(BridgeRules.Beats(C(Suit.Hearts, 14), C(Suit.Clubs, 2), Strain.Clubs));
        }

        [Test]
        public void Beats_NoTrump_HasNoTrumpSuit()
        {
            foreach (Suit s in Enum.GetValues(typeof(Suit)))
                Assert.IsFalse(BridgeRules.IsTrump(C(s, 14), Strain.NoTrump));
        }
    }
}
