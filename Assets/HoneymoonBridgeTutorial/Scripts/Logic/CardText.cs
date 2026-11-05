using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tutorial
{
    // 用文字寫牌，教學關卡才看得懂：「♠AK5 ♥QJ9 ♦- ♣T832」
    //   花色符號（♠♥♦♣，也接受 S H D C）後面接點數；10 可以寫 T 或 10；「-」= 缺門
    public static class CardText
    {
        const string Ranks = "23456789TJQKA";

        public static List<Card> Parse(string text)
        {
            var cards = new List<Card>();
            if (string.IsNullOrWhiteSpace(text)) return cards;
            Suit? suit = null;
            for (int i = 0; i < text.Length; i++)
            {
                char raw = text[i];
                char ch = char.ToUpperInvariant(raw);
                if (ch == '1' && i + 1 < text.Length && text[i + 1] == '0') { ch = 'T'; i++; }   // 「10」也可以
                switch (ch)
                {
                    case '♠': case 'S': suit = Suit.Spades; continue;
                    case '♥': case 'H': suit = Suit.Hearts; continue;
                    case '♦': case 'D': suit = Suit.Diamonds; continue;
                    case '♣': case 'C': suit = Suit.Clubs; continue;
                    case ' ': case '-': case ',': continue;
                }
                int r = Ranks.IndexOf(ch);
                if (r < 0) throw new ArgumentException($"看不懂的點數「{raw}」：{text}");
                if (!suit.HasValue) throw new ArgumentException($"點數前面要先寫花色：{text}");
                var c = new Card(suit.Value, r + 2);
                if (cards.Contains(c)) throw new ArgumentException($"{c} 重複了：{text}");
                cards.Add(c);
            }
            return cards;
        }

        public static Card One(string text)
        {
            var l = Parse(text);
            if (l.Count != 1) throw new ArgumentException($"要剛好一張牌：{text}");
            return l[0];
        }

        public static string Format(IEnumerable<Card> cards) => string.Join(" ", cards.Select(c => c.ToString()));
    }
}
