using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 計分規則（docs/SPEC.md 第 1 節）。規格裡的範例原封不動放進來當測試
    public class ScoringTests
    {
        static readonly Bid ThreeHearts = new Bid(3, Strain.Hearts);

        // ---------- 規格範例：3♥ 加倍，要拿 9 墩 ----------

        [Test]
        public void SpecExample_3HeartsDoubled_Take10_DeclarerGets62()
        {
            var r = Scoring.Score(ThreeHearts, 1, declarer: 0, tricksTaken: 10);
            Assert.IsTrue(r.made);
            Assert.AreEqual(0, r.scorer);
            Assert.AreEqual(60, r.contractPoints, "3 × 10 × 2");
            Assert.AreEqual(2, r.overtrickPoints, "超 1 墩 +2，不受加倍影響");
            Assert.AreEqual(62, r.points);
        }

        [Test]
        public void SpecExample_3HeartsDoubled_Take8_DefenderGets20()
        {
            var r = Scoring.Score(ThreeHearts, 1, declarer: 0, tricksTaken: 8);
            Assert.IsFalse(r.made);
            Assert.AreEqual(1, r.scorer, "倒約是防守方得分");
            Assert.AreEqual(1, r.undertricks);
            Assert.AreEqual(20, r.points, "10 × 2");
        }

        [Test]
        public void SpecExample_PreviewLine()
        {
            Assert.AreEqual("目標 9 墩｜打成 60 分｜每倒 1 墩對手得 20 分", Scoring.DeclarerPreview(ThreeHearts, 1));
        }

        // ---------- 其他情況 ----------

        [TestCase(1, Strain.Clubs, 0, 7, 0, 10)]     // 1♣ 剛好打成：1 × 10
        [TestCase(2, Strain.Spades, 0, 8, 0, 20)]    // 2♠ 剛好打成
        [TestCase(1, Strain.NoTrump, 0, 13, 0, 22)]  // 1NT 超 6 墩：10 + 12
        [TestCase(7, Strain.NoTrump, 0, 13, 0, 70)]  // 大滿貫
        [TestCase(2, Strain.Hearts, 2, 9, 0, 82)]    // 2♥ 再加倍超 1：2 × 10 × 4 + 2
        [TestCase(4, Strain.Spades, 0, 7, 1, 30)]    // 4♠ 倒 3：3 × 10
        [TestCase(2, Strain.Hearts, 2, 6, 1, 80)]    // 2♥ 再加倍倒 2：2 × 10 × 4
        [TestCase(7, Strain.Clubs, 1, 0, 1, 260)]    // 7♣ 加倍一墩都沒拿：13 × 10 × 2
        public void Score_Table(int level, Strain strain, int doubled, int taken, int expScorer, int expPoints)
        {
            var r = Scoring.Score(new Bid(level, strain), doubled, declarer: 0, tricksTaken: taken);
            Assert.AreEqual(expScorer, r.scorer);
            Assert.AreEqual(expPoints, r.points);
            Assert.AreEqual(r.points, r.contractPoints + r.overtrickPoints + r.penaltyPoints);
        }

        [Test]
        public void Score_DeclarerSeat1_DownGoesToSeat0()
        {
            var r = Scoring.Score(ThreeHearts, 0, declarer: 1, tricksTaken: 5);
            Assert.AreEqual(0, r.scorer);
            Assert.AreEqual(40, r.points);
        }

        [Test]
        public void Multiplier_Is1_2_4()
        {
            Assert.AreEqual(1, Scoring.Multiplier(0));
            Assert.AreEqual(2, Scoring.Multiplier(1));
            Assert.AreEqual(4, Scoring.Multiplier(2));
        }

        // ---------- 畫面文字 ----------

        [Test]
        public void ContractText_ShowsDoubleState()
        {
            Assert.AreEqual("3♥", Scoring.ContractText(ThreeHearts, 0));
            Assert.AreEqual("3♥ 加倍", Scoring.ContractText(ThreeHearts, 1));
            Assert.AreEqual("3♥ 再加倍", Scoring.ContractText(ThreeHearts, 2));
        }

        [Test]
        public void DefenderPreview_SpeaksFromDefenderSide()
        {
            Assert.AreEqual("電腦目標 9 墩｜打成電腦得 30 分｜每倒 1 墩你得 10 分",
                Scoring.DefenderPreview(ThreeHearts, 0, "電腦"));
        }

        [Test]
        public void Breakdown_Made_ListsEveryLine()
        {
            var r = Scoring.Score(ThreeHearts, 1, declarer: 0, tricksTaken: 10);
            var lines = Scoring.Breakdown(r, mySeat: 0, oppName: "電腦");
            CollectionAssert.AreEqual(new[]
            {
                "合約 3♥ 加倍（你是莊家）",
                "需要 9 墩，拿到 10 墩 → 打成，超 1 墩",
                "合約分：3 線 × 10 × 2 = 60",
                "超墩分：1 墩 × 2 = 2",
                "你 +62 分"
            }, lines);
        }

        [Test]
        public void Breakdown_Down_FromDefenderView()
        {
            var r = Scoring.Score(ThreeHearts, 1, declarer: 1, tricksTaken: 8);
            var lines = Scoring.Breakdown(r, mySeat: 0, oppName: "電腦");
            CollectionAssert.AreEqual(new[]
            {
                "合約 3♥ 加倍（電腦是莊家）",
                "需要 9 墩，拿到 8 墩 → 倒 1 墩",
                "倒約分：1 墩 × 10 × 2 = 20",
                "你 +20 分"
            }, lines);
        }

        [Test]
        public void Breakdown_ExactMake_HasNoOvertrickLine()
        {
            var r = Scoring.Score(ThreeHearts, 0, declarer: 0, tricksTaken: 9);
            var lines = Scoring.Breakdown(r, 0, "電腦");
            Assert.IsFalse(lines.Any(l => l.StartsWith("超墩分")));
            Assert.AreEqual("合約分：3 線 × 10 = 30", lines[2], "沒加倍就不寫 × 1");
        }
    }
}
