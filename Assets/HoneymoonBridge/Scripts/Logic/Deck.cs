using System;
using System.Collections.Generic;

namespace HoneymoonBridge
{
    public static class Deck
    {
        public static List<Card> NewShuffled(Random rng)
        {
            var d = new List<Card>(52);
            foreach (Suit s in Enum.GetValues(typeof(Suit)))
                for (int r = 2; r <= 14; r++)
                    d.Add(new Card(s, r));

            // Fisher–Yates 洗牌
            for (int i = d.Count - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (d[i], d[j]) = (d[j], d[i]);
            }
            return d;
        }

        // 手牌排序：♠ ♥ ♦ ♣，同花色由大到小
        public static void SortHand(List<Card> hand) =>
            hand.Sort((a, b) => a.Suit != b.Suit
                ? ((int)b.Suit).CompareTo((int)a.Suit)
                : b.Rank.CompareTo(a.Rank));
    }
}
