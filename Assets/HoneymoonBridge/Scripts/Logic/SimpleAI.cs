using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge
{
    // 很陽春的電腦：能玩，但不算聰明。之後可以從這裡慢慢加強
    public static class SimpleAI
    {
        static Card Lowest(List<Card> l) => l.OrderBy(c => c.Rank).First();
        static Card Highest(List<Card> l) => l.OrderByDescending(c => c.Rank).First();

        public static Card ChooseCard(HoneymoonGame g, int p)
        {
            var opts = g.LegalFor(p);
            bool leading = p == g.Leader;

            if (g.Phase == Phase.Draw)
            {
                // 明牌是 10 以上才去搶
                bool want = g.FaceUp.HasValue && g.FaceUp.Value.Rank >= 10;
                if (leading) return want ? Highest(opts) : Lowest(opts);
                var win = opts.FindAll(c => BridgeRules.Beats(c, g.LeadCard.Value, g.Trump));
                return want && win.Count > 0 ? Lowest(win) : Lowest(opts);
            }

            if (leading)
            {
                var aces = opts.FindAll(c => c.Rank == 14 && !BridgeRules.IsTrump(c, g.Trump));
                if (aces.Count > 0) return aces[0];
                var longest = opts.GroupBy(c => c.Suit).OrderByDescending(gr => gr.Count()).First().ToList();
                return Lowest(longest);
            }

            // 跟牌：能贏就用最小的贏，贏不了就丟最小的非王牌
            var winners = opts.FindAll(c => BridgeRules.Beats(c, g.LeadCard.Value, g.Trump));
            if (winners.Count > 0) return Lowest(winners);
            var nonTrump = opts.FindAll(c => !BridgeRules.IsTrump(c, g.Trump));
            return Lowest(nonTrump.Count > 0 ? nonTrump : opts);
        }

        // 預估墩數的係數，是用 3000 局模擬對打做線性回歸算出來的（SimpleAI 自己打的結果）
        //   有王：2.70 + 0.142×點力 + 0.780×王牌張數
        //   無王：4.44 + 0.221×點力（誤差比有王大，所以要多留一點安全邊際）
        public static float EstimateTricks(List<Card> hand, Strain s)
        {
            int hcp = BridgeRules.Hcp(hand);
            if (s == Strain.NoTrump) return 4.44f + 0.221f * hcp;
            int len = hand.Count(c => (int)c.Suit == (int)s);
            return 2.70f + 0.142f * hcp + 0.780f * len;
        }

        const float SuitSafety = 0.35f;   // 預估要比需要的墩數多這麼多才敢叫
        const float NtSafety = 0.9f;
        const float OpenFloor = 6.4f;     // 還沒人叫時，預估到這個數就先開叫 1 階，避免動不動全 Pass 重發

        // 回傳 null = Pass
        public static Bid? ChooseBid(HoneymoonGame g, int p)
        {
            var h = g.Hands[p];
            bool nobodyBid = g.MinBidIndex == 0;
            Bid? best = null;
            float bestMargin = float.MinValue;

            for (int s = 0; s < 5; s++)
            {
                var strain = (Strain)s;
                float est = EstimateTricks(h, strain);
                float safety = strain == Strain.NoTrump ? NtSafety : SuitSafety;

                int lv = 1;
                while (lv <= 7 && (lv - 1) * 5 + s < g.MinBidIndex) lv++;
                if (lv > 7) continue;

                float margin = est - safety - (lv + 6);
                bool openAnyway = nobodyBid && lv == 1 && est >= OpenFloor;
                if (margin < 0 && !openAnyway) continue;

                if (margin > bestMargin) { bestMargin = margin; best = new Bid(lv, strain); }
            }
            if (!best.HasValue) return null;

            // 直接跳到安全範圍內最高的階數（兩人局只有一來一回，慢慢加碼沒意義）
            var bs = best.Value.Strain;
            float bestEst = EstimateTricks(h, bs) - (bs == Strain.NoTrump ? NtSafety : SuitSafety);
            int jump = Math.Min(7, (int)Math.Floor(bestEst) - 6);
            return new Bid(Math.Max(best.Value.Level, jump), bs);
        }
    }
}
