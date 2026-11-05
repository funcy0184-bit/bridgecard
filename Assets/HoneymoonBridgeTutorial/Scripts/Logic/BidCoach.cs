using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tutorial
{
    // 「白話提示」：把牌桌狀態翻成一兩句人話，告訴新手現在該想什麼。
    // 只看 TableState（= 玩家自己看得到的東西），不會偷看對手的牌。
    public static class BidCoach
    {
        // 跟 SimpleAI 一樣的安全邊際：預估墩數要比需要的多這麼多才建議叫
        const float SuitSafety = 0.35f;
        const float NtSafety = 0.9f;
        const float DoubleEdge = 1.0f;     // 我預估能拿的墩數，比「讓他倒約要的墩數」多 1 墩以上才建議加倍
        const float RedoubleEdge = 1.5f;

        static readonly Strain[] AllStrains = { Strain.Clubs, Strain.Diamonds, Strain.Hearts, Strain.Spades, Strain.NoTrump };

        // 回傳 null = 這個時間點沒什麼好提示的
        public static string For(TableState s, string oppName)
        {
            if (s == null) return null;
            switch (s.Phase)
            {
                case Phase.Draw: return DrawHint(s, oppName);
                case Phase.Bidding: return BiddingHint(s, oppName);
                case Phase.Play: return PlayHint(s, oppName);
                default: return null;
            }
        }

        static List<Card> Hand(TableState s) => s.hand.Select(Card.FromId).ToList();
        static string StrainText(Strain st) => st == Strain.NoTrump ? "無王" : Card.SuitSymbol((Suit)(int)st);
        static float Safety(Strain st) => st == Strain.NoTrump ? NtSafety : SuitSafety;
        static string F(float x) => x.ToString("0.0");

        // ---------------- 抽牌 ----------------

        static string DrawHint(TableState s, string opp)
        {
            if (!s.IsMyTurn || s.faceUp < 0) return null;
            var up = Card.FromId(s.faceUp);
            bool leading = s.leaderSeat == s.seat;
            bool worth = up.Rank >= 10;
            string about = worth
                ? $"明牌 {up} 是好牌（10 以上），值得搶：贏這墩就拿走它。"
                : $"明牌 {up} 不太值錢，不用浪費大牌搶，出小牌讓{opp}拿也可以。";
            return leading ? about + "\n你先出，可以出任何一張。" : about + "\n有首引的花色就要跟。";
        }

        // ---------------- 叫牌 ----------------

        public static string HandSummary(List<Card> hand)
        {
            int hcp = BridgeRules.Hcp(hand);
            var longest = hand.GroupBy(c => c.Suit)
                              .OrderByDescending(g => g.Count()).ThenByDescending(g => (int)g.Key).First();
            return $"你的牌：大牌點 {hcp}（A=4 K=3 Q=2 J=1）｜最長 {Card.SuitSymbol(longest.Key)} {longest.Count()} 張";
        }

        static string BiddingHint(TableState s, string opp)
        {
            var hand = Hand(s);
            var lines = new List<string> { HandSummary(hand) };

            // 每一門當王，預估自己當莊家能拿幾墩（跟電腦用同一條公式）
            var est = AllStrains.ToDictionary(st => st, st => SimpleAI.EstimateTricks(hand, st));
            var bestSuit = AllStrains.Where(st => st != Strain.NoTrump).OrderByDescending(st => est[st]).First();
            lines.Add($"估計你當莊家：{StrainText(bestSuit)} 當王約 {F(est[bestSuit])} 墩｜無王約 {F(est[Strain.NoTrump])} 墩");

            if (!s.IsMyTurn)
            {
                lines.Add($"等{opp}叫牌…");
                return string.Join("\n", lines);
            }

            Bid? cur = s.highestBid >= 0 ? Bid.FromIndex(s.highestBid) : (Bid?)null;

            if (s.canRedouble && cur.HasValue)
            {
                var b = cur.Value;
                float mine = est[b.Strain] - Safety(b.Strain);
                lines.Add(mine >= b.TricksNeeded + RedoubleEdge
                    ? $"{opp}對你加倍了，但你估計能拿 {F(est[b.Strain])} 墩，比要的 {b.TricksNeeded} 墩多 → 有把握就「再加倍」，分數 ×4。"
                    : $"{opp}對你加倍了。你估計 {F(est[b.Strain])} 墩，要 {b.TricksNeeded} 墩 → 沒把握就 Pass，或改叫別的叫品逃走。");
                return string.Join("\n", lines);
            }

            if (s.canDouble && cur.HasValue)
            {
                var b = cur.Value;
                float mine = est[b.Strain];   // 他當王的那一門，我手上越多他越難打
                int theyCanLose = 13 - b.TricksNeeded;
                lines.Add(mine - DoubleEdge > theyCanLose
                    ? $"{opp}叫 {b} 要拿 {b.TricksNeeded} 墩。你估計自己能拿約 {F(mine)} 墩，他頂多只能輸 {theyCanLose} 墩 → 很可能倒約，可以考慮「加倍」。"
                    : $"{opp}叫 {b} 要拿 {b.TricksNeeded} 墩，看起來他打得成。想搶合約就叫更高，不然 Pass。");
            }

            var suggestion = SuggestBid(s, est);
            if (suggestion.HasValue)
            {
                var b = suggestion.Value;
                lines.Add($"建議：叫 {b}（要拿 {b.TricksNeeded} 墩）。{StrainText(b.Strain)}是你最有把握的一門。");
            }
            else if (!cur.HasValue)
                lines.Add("牌力普通，Pass 也可以；雙方都 Pass 會重發，分數不變。");
            else if (!s.canDouble)
                lines.Add($"再叫更高風險太大 → 建議 Pass，讓{opp}去打。");

            return string.Join("\n", lines);
        }

        // 找「安全邊際內、最低能叫」的叫品；沒有就回傳 null（建議 Pass）
        static Bid? SuggestBid(TableState s, Dictionary<Strain, float> est)
        {
            Bid? best = null;
            float bestMargin = float.MinValue;
            foreach (var st in AllStrains)
            {
                int lv = 1;
                while (lv <= 7 && new Bid(lv, st).Index < s.minBid) lv++;
                if (lv > 7) continue;
                float margin = est[st] - Safety(st) - (lv + 6);
                if (margin < 0) continue;
                if (margin > bestMargin) { bestMargin = margin; best = new Bid(lv, st); }
            }
            return best;
        }

        // ---------------- 打牌 ----------------

        static string PlayHint(TableState s, string opp)
        {
            var lines = new List<string>();
            if (s.highestBid >= 0 && s.declarer >= 0)
            {
                var b = Bid.FromIndex(s.highestBid);
                if (s.declarer == s.seat)
                {
                    int left = Math.Max(0, b.TricksNeeded - s.myTricks);
                    lines.Add(left > 0 ? $"合約 {b}：你還要拿 {left} 墩。" : $"合約 {b} 已經打成了！之後每多一墩 +{Scoring.PerOvertrick} 分。");
                }
                else
                {
                    int toSet = Math.Max(0, 13 - b.TricksNeeded + 1 - s.myTricks);
                    lines.Add(toSet > 0 ? $"{opp}的合約 {b}：你再拿 {toSet} 墩，他就倒約了。" : $"{opp}已經倒約了！你每多拿一墩都多得分。");
                }
            }

            if (!s.IsMyTurn) return lines.Count > 0 ? string.Join("\n", lines) : null;

            bool leading = s.leaderSeat == s.seat;
            if (leading)
                lines.Add("你先出：可以出任何一張。");
            else if (s.leadCard >= 0)
            {
                var led = Card.FromId(s.leadCard).Suit;
                var hand = Hand(s);
                bool hasTrump = s.highestBid >= 0 && Bid.FromIndex(s.highestBid).Strain != Strain.NoTrump;
                Suit trump = hasTrump ? (Suit)(int)Bid.FromIndex(s.highestBid).Strain : Suit.Clubs;
                if (hand.Any(c => c.Suit == led))
                    lines.Add($"要跟 {Card.SuitSymbol(led)}：有首引的花色一定要跟。");
                else if (hasTrump && led != trump && hand.Any(c => c.Suit == trump))
                    lines.Add($"你沒有 {Card.SuitSymbol(led)}：可以墊一張小牌，或出王牌 {Card.SuitSymbol(trump)} 吃下來。");
                else
                    lines.Add($"你沒有 {Card.SuitSymbol(led)}：墊一張用不到的小牌。");
            }
            return string.Join("\n", lines);
        }
    }
}
