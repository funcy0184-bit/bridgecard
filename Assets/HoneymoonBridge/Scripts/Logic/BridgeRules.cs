using System.Collections.Generic;

namespace HoneymoonBridge
{
    // 橋牌三條核心規則都在這：跟花色、同門比大小、王牌壓一切
    public static class BridgeRules
    {
        // led = 這墩領出的牌；null 代表自己是領牌的人，什麼都能出
        public static List<Card> LegalPlays(List<Card> hand, Card? led)
        {
            if (led == null) return new List<Card>(hand);
            var follow = hand.FindAll(c => c.Suit == led.Value.Suit);
            return follow.Count > 0 ? follow : new List<Card>(hand);
        }

        public static bool IsTrump(Card c, Strain trump) =>
            trump != Strain.NoTrump && (int)c.Suit == (int)trump;

        // challenger 能不能壓過目前最大的 current
        public static bool Beats(Card challenger, Card current, Strain trump)
        {
            bool a = IsTrump(challenger, trump);
            bool b = IsTrump(current, trump);
            if (a != b) return a;                       // 王牌 vs 非王牌
            return challenger.Suit == current.Suit       // 同花色才比大小
                   && challenger.Rank > current.Rank;   // 墊別的花色永遠贏不了
        }

        public static int Hcp(IEnumerable<Card> hand)
        {
            int sum = 0;
            foreach (var c in hand) sum += c.Hcp;
            return sum;
        }
    }
}
