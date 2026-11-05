using System;

namespace HoneymoonBridge
{
    public enum Suit { Clubs = 0, Diamonds = 1, Hearts = 2, Spades = 3 }

    // 叫牌用的「花色」多了一個無王，順序剛好就是叫牌大小：♣ < ♦ < ♥ < ♠ < NT
    public enum Strain { Clubs = 0, Diamonds = 1, Hearts = 2, Spades = 3, NoTrump = 4 }

    [Serializable]
    public readonly struct Card : IEquatable<Card>
    {
        public readonly Suit Suit;
        public readonly int Rank; // 2..14，14 = A

        public Card(Suit suit, int rank) { Suit = suit; Rank = rank; }

        public bool IsRed => Suit == Suit.Hearts || Suit == Suit.Diamonds;

        // 0..51 的編號，連線時只傳這個數字就好
        public int Id => (int)Suit * 13 + (Rank - 2);
        public static Card FromId(int id) => new Card((Suit)(id / 13), id % 13 + 2);

        // 大牌點：A4 K3 Q2 J1
        public int Hcp => Rank >= 11 ? Rank - 10 : 0;

        public string RankText => Rank switch
        {
            11 => "J", 12 => "Q", 13 => "K", 14 => "A", _ => Rank.ToString()
        };

        public static string SuitSymbol(Suit s) => s switch
        {
            Suit.Spades => "♠", Suit.Hearts => "♥", Suit.Diamonds => "♦", _ => "♣"
        };

        public override string ToString() => SuitSymbol(Suit) + RankText;

        // 給 TextMeshPro 用的彩色字串（紅心方塊變紅）
        public string ToRichText() => IsRed ? $"<color=#B8233A>{this}</color>" : ToString();

        public bool Equals(Card other) => Suit == other.Suit && Rank == other.Rank;
        public override bool Equals(object obj) => obj is Card c && Equals(c);
        public override int GetHashCode() => (int)Suit * 16 + Rank;
    }

    public readonly struct Bid
    {
        public readonly int Level;      // 1..7
        public readonly Strain Strain;

        public Bid(int level, Strain strain) { Level = level; Strain = strain; }

        // 35 個叫品排成一條線，Index 越大叫品越高
        public int Index => (Level - 1) * 5 + (int)Strain;
        public int TricksNeeded => Level + 6;
        public bool IsRed => Strain == Strain.Hearts || Strain == Strain.Diamonds;

        public static Bid FromIndex(int i) => new Bid(i / 5 + 1, (Strain)(i % 5));

        public override string ToString() =>
            Level + (Strain == Strain.NoTrump ? "NT" : Card.SuitSymbol((Suit)(int)Strain));
    }
}
