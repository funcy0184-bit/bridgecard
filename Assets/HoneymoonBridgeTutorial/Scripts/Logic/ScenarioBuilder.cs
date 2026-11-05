using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tutorial
{
    // 把一副「正式規則」的 HoneymoonGame 擺成教學需要的固定牌局。
    // 只用原版公開的東西：Hands / Stock / TakenFaceUp / TricksWon 這幾個公開的 List 和陣列，
    // 加上 StartNewMatch / StartNew / MakeCall / PlayCard / ResolveTrick。原版程式碼一行都不用改。
    //
    // 座位 0 = 玩家，座位 1 = 對手（電腦）
    public static class ScenarioBuilder
    {
        public const int Seed = 20261105;   // 固定種子：同一關每次擺出來都一樣

        // 抽牌階段，leader 先出。stockTop = 牌堆最上面幾張（第一張就是明牌），其餘自動補滿 26 張
        public static HoneymoonGame Draw(int leader, string hand0, string hand1, string stockTop)
        {
            var h0 = CardText.Parse(hand0);
            var h1 = CardText.Parse(hand1);
            var top = CardText.Parse(stockTop);
            RequireCount(h0, 13, "玩家手牌");
            RequireCount(h1, 13, "對手手牌");
            RequireDisjoint(h0, h1, top);

            var g = NewWithLeader(leader);
            SetHands(g, h0, h1);
            var used = new HashSet<Card>(h0.Concat(h1).Concat(top));
            var rest = Enumerable.Range(0, 52).Select(Card.FromId).Where(c => !used.Contains(c));
            g.Stock.Clear();
            g.Stock.AddRange(top);
            g.Stock.AddRange(rest);
            if (g.Stock.Count != 26) throw new InvalidOperationException("牌堆應該剛好 26 張");
            return g;
        }

        // 叫牌階段，firstBidder 先叫。抽牌階段先用電腦快轉打完，再把雙方手牌換成指定的牌
        public static HoneymoonGame Bidding(int firstBidder, string hand0, string hand1)
        {
            var h0 = CardText.Parse(hand0);
            var h1 = CardText.Parse(hand1);
            RequireCount(h0, 13, "玩家手牌");
            RequireCount(h1, 13, "對手手牌");
            RequireDisjoint(h0, h1, new List<Card>());

            var g = NewWithLeader(firstBidder);
            while (g.Phase == Phase.Draw)
            {
                if (g.TrickComplete) g.ResolveTrick();
                else g.PlayCard(g.CurrentPlayer, SimpleAI.ChooseCard(g, g.CurrentPlayer));
            }
            if (g.Phase != Phase.Bidding || g.CurrentPlayer != firstBidder)
                throw new InvalidOperationException("快轉後應該停在叫牌階段、輪到指定的人先叫");
            SetHands(g, h0, h1);
            g.TakenFaceUp[0].Clear();   // 快轉時拿的明牌跟指定手牌無關，記牌小抄清掉才不會混淆
            g.TakenFaceUp[1].Clear();
            return g;
        }

        // 打牌階段。照正常叫牌流程定約（莊家叫 contract，對手加倍／莊家再加倍，最後 Pass），
        // 所以叫牌紀錄、首攻的人都跟真的一樣。won0 / won1 = 雙方已經拿到的墩數（殘局用）
        public static HoneymoonGame Play(Bid contract, int declarer, int doubled, string hand0, string hand1,
                                         int won0 = 0, int won1 = 0)
        {
            var h0 = CardText.Parse(hand0);
            var h1 = CardText.Parse(hand1);
            if (h0.Count != h1.Count) throw new ArgumentException("雙方手牌張數要一樣");
            if (h0.Count + won0 + won1 != 13) throw new ArgumentException("手牌張數 + 已拿墩數要等於 13");
            RequireDisjoint(h0, h1, new List<Card>());

            // 先用 13 張的假手牌走完叫牌，再換成指定的（殘局可能只剩幾張）
            var g = Bidding(declarer, FillTo13(h0, h1, 0), FillTo13(h0, h1, 1));
            int other = HoneymoonGame.Other(declarer);
            Must(g.MakeCall(declarer, contract.Index), "莊家叫牌");
            if (doubled >= 1) Must(g.MakeCall(other, Call.Double), "對手加倍");
            if (doubled >= 2) Must(g.MakeCall(declarer, Call.Redouble), "莊家再加倍");
            Must(g.MakeCall(doubled == 1 ? declarer : other, Call.Pass), "Pass 定約");
            if (g.Phase != Phase.Play) throw new InvalidOperationException("應該已經進入打牌階段");

            SetHands(g, h0, h1);
            g.TricksWon[0] = won0;
            g.TricksWon[1] = won1;
            return g;
        }

        // ---------------- 小工具 ----------------

        static HoneymoonGame NewWithLeader(int leader)
        {
            var g = new HoneymoonGame(Seed);
            g.StartNewMatch();             // 新的一場第一局：座位 0 先出
            if (leader == 1) g.StartNew(); // 每局輪流先出，再發一次就換座位 1
            if (g.Leader != leader) throw new InvalidOperationException("先出的人不對");
            return g;
        }

        static void SetHands(HoneymoonGame g, List<Card> h0, List<Card> h1)
        {
            g.Hands[0].Clear(); g.Hands[0].AddRange(h0); Deck.SortHand(g.Hands[0]);
            g.Hands[1].Clear(); g.Hands[1].AddRange(h1); Deck.SortHand(g.Hands[1]);
        }

        // 殘局只有幾張牌，叫牌時先用其他沒用到的牌補到 13 張
        static string FillTo13(List<Card> h0, List<Card> h1, int seat)
        {
            var mine = new List<Card>(seat == 0 ? h0 : h1);
            var used = new HashSet<Card>(h0.Concat(h1));
            var spare = Enumerable.Range(0, 52).Select(Card.FromId).Where(c => !used.Contains(c)).ToList();
            int offset = seat == 0 ? 0 : 13;
            for (int i = offset; mine.Count < 13; i++) mine.Add(spare[i]);
            return CardText.Format(mine);
        }

        static void RequireCount(List<Card> l, int n, string what)
        {
            if (l.Count != n) throw new ArgumentException($"{what}要 {n} 張，現在 {l.Count} 張：{CardText.Format(l)}");
        }

        static void RequireDisjoint(List<Card> a, List<Card> b, List<Card> c)
        {
            var all = a.Concat(b).Concat(c).ToList();
            var dup = all.GroupBy(x => x).Where(x => x.Count() > 1).Select(x => x.Key).ToList();
            if (dup.Count > 0) throw new ArgumentException("同一張牌出現兩次：" + CardText.Format(dup));
        }

        static void Must(bool ok, string what)
        {
            if (!ok) throw new InvalidOperationException($"擺牌局時「{what}」失敗");
        }
    }
}
