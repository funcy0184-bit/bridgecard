using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge
{
    public enum Phase { Draw, Bidding, Play, Finished }

    // 純遊戲邏輯，不碰任何 Unity 物件。
    // 連線時只有房主那台會跑這個類別，朋友那邊只收 TableState 和 GameEvent
    public class HoneymoonGame
    {
        public static int Other(int p) => 1 - p;

        public readonly List<Card>[] Hands = { new List<Card>(), new List<Card>() };
        public readonly List<Card>[] TakenFaceUp = { new List<Card>(), new List<Card>() };
        public readonly List<Card> Stock = new List<Card>();
        public readonly int[] TricksWon = new int[2];

        public Phase Phase { get; private set; }
        public int CurrentPlayer { get; private set; }
        public int Leader { get; private set; }
        public Card? LeadCard { get; private set; }
        public Card? FollowCard { get; private set; }
        public bool TrickComplete => LeadCard.HasValue && FollowCard.HasValue;
        public Strain Trump { get; private set; } = Strain.NoTrump;
        public Card? FaceUp => Stock.Count > 0 ? Stock[0] : (Card?)null;

        public Bid? HighestBid { get; private set; }
        public int HighestBidder { get; private set; } = -1;
        public int Declarer { get; private set; } = -1;
        int passesInRow;
        int firstSeat = 1;   // 每局輪流先手，StartNew 會先切換

        // 第二個參數是收件人：-1 = 兩邊都收，0 / 1 = 只給那個座位
        public event Action<GameEvent, int> Emitted;

        readonly Random rng;
        public HoneymoonGame(int? seed = null)
        {
            rng = seed.HasValue ? new Random(seed.Value) : new Random();
        }

        public void StartNew()
        {
            var d = Deck.NewShuffled(rng);
            for (int p = 0; p < 2; p++)
            {
                Hands[p].Clear();
                Hands[p].AddRange(d.GetRange(p * 13, 13));
                Deck.SortHand(Hands[p]);
                TakenFaceUp[p].Clear();
                TricksWon[p] = 0;
            }
            Stock.Clear();
            Stock.AddRange(d.GetRange(26, 26));
            HighestBid = null; HighestBidder = -1; Declarer = -1; passesInRow = 0;
            Trump = Strain.NoTrump;              // 抽牌階段不設王牌
            Phase = Phase.Draw;
            firstSeat = Other(firstSeat);
            Leader = CurrentPlayer = firstSeat;
            LeadCard = FollowCard = null;
            Emit(new GameEvent(GameEventType.NewHand, firstSeat));
        }

        public List<Card> LegalFor(int p) =>
            BridgeRules.LegalPlays(Hands[p], p == Leader ? null : LeadCard);

        public bool PlayCard(int p, Card c)
        {
            if (Phase != Phase.Draw && Phase != Phase.Play) return false;
            if (p != CurrentPlayer || TrickComplete) return false;
            if (!Hands[p].Contains(c)) return false;
            if (!LegalFor(p).Contains(c))
            {
                Emit(new GameEvent(GameEventType.Illegal, p, c.Id), p);
                return false;
            }

            Hands[p].Remove(c);
            bool winning, ruff = false;
            if (p == Leader)
            {
                LeadCard = c;
                CurrentPlayer = Other(p);
                winning = true;
            }
            else
            {
                FollowCard = c;
                winning = BridgeRules.Beats(c, LeadCard.Value, Trump);
                ruff = BridgeRules.IsTrump(c, Trump) && !BridgeRules.IsTrump(LeadCard.Value, Trump);
            }
            Emit(new GameEvent(GameEventType.CardPlayed, p, c.Id, winning ? 1 : 0, ruff ? 1 : 0));
            return true;
        }

        public int TrickWinner() =>
            BridgeRules.Beats(FollowCard.Value, LeadCard.Value, Trump) ? Other(Leader) : Leader;

        // 兩張都出完後，由 GameHost 停頓一下再呼叫
        public void ResolveTrick()
        {
            if (!TrickComplete) return;
            int w = TrickWinner(), l = Other(w);
            Card winCard = w == Leader ? LeadCard.Value : FollowCard.Value;
            bool ruff = w != Leader && BridgeRules.IsTrump(FollowCard.Value, Trump)
                        && !BridgeRules.IsTrump(LeadCard.Value, Trump);

            if (Phase == Phase.Draw)
            {
                Emit(new GameEvent(GameEventType.TrickWon, w, winCard.Id, -1, ruff ? 1 : 0));

                Card up = Stock[0]; Stock.RemoveAt(0);
                Card hidden = Stock[0]; Stock.RemoveAt(0);
                Hands[w].Add(up);
                Hands[l].Add(hidden);
                TakenFaceUp[w].Add(up);
                Deck.SortHand(Hands[0]); Deck.SortHand(Hands[1]);

                Emit(new GameEvent(GameEventType.FaceUpTaken, w, up.Id));
                Emit(new GameEvent(GameEventType.CardDrawn, l, hidden.Id), l);  // 自己看得到摸到什麼
                Emit(new GameEvent(GameEventType.CardDrawn, l), w);             // 對手只知道你摸了一張

                LeadCard = FollowCard = null;
                if (Stock.Count == 0)
                {
                    Phase = Phase.Bidding;
                    CurrentPlayer = firstSeat;
                    Emit(new GameEvent(GameEventType.DrawPhaseOver, firstSeat));
                }
                else Leader = CurrentPlayer = w;
                return;
            }

            TricksWon[w]++;
            Emit(new GameEvent(GameEventType.TrickWon, w, winCard.Id, TricksWon[w], ruff ? 1 : 0));
            LeadCard = FollowCard = null;

            if (Hands[0].Count == 0)
            {
                Phase = Phase.Finished;
                Emit(new GameEvent(GameEventType.GameOver, Declarer,
                    value: TricksWon[Declarer], extra: HighestBid.Value.TricksNeeded));
            }
            else Leader = CurrentPlayer = w;   // 贏的人下一墩先出
        }

        public int MinBidIndex => HighestBid.HasValue ? HighestBid.Value.Index + 1 : 0;

        // bid == null 代表 Pass
        public bool MakeBid(int p, Bid? bid)
        {
            if (Phase != Phase.Bidding || p != CurrentPlayer) return false;

            if (bid.HasValue)
            {
                if (bid.Value.Index < MinBidIndex) return false;
                HighestBid = bid; HighestBidder = p; passesInRow = 0;
                Emit(new GameEvent(GameEventType.BidMade, p, value: bid.Value.Index));
                CurrentPlayer = Other(p);
                return true;
            }

            passesInRow++;
            Emit(new GameEvent(GameEventType.Passed, p));
            if (HighestBid.HasValue) StartPlay();                 // 兩人版：有人叫過，對方一 Pass 就定約
            else if (passesInRow >= 2)
            {
                Emit(new GameEvent(GameEventType.Redeal));
                StartNew();
            }
            else CurrentPlayer = Other(p);
            return true;
        }

        void StartPlay()
        {
            Declarer = HighestBidder;
            Trump = HighestBid.Value.Strain;
            Phase = Phase.Play;
            TricksWon[0] = TricksWon[1] = 0;
            Leader = CurrentPlayer = Other(Declarer);              // 非莊家先出
            Emit(new GameEvent(GameEventType.ContractSet, Declarer, value: HighestBid.Value.Index));
        }

        public TableState ViewFor(int s)
        {
            int o = Other(s);
            bool canPlay = (Phase == Phase.Draw || Phase == Phase.Play) && CurrentPlayer == s && !TrickComplete;
            return new TableState
            {
                seat = s,
                phase = (int)Phase,
                hand = Hands[s].Select(c => c.Id).ToArray(),
                legal = canPlay ? LegalFor(s).Select(c => c.Id).ToArray() : new int[0],
                oppCount = Hands[o].Count,
                faceUp = Phase == Phase.Draw && FaceUp.HasValue ? FaceUp.Value.Id : -1,
                stockCount = Stock.Count,
                leadCard = LeadCard.HasValue ? LeadCard.Value.Id : -1,
                followCard = FollowCard.HasValue ? FollowCard.Value.Id : -1,
                leaderSeat = Leader,
                currentSeat = CurrentPlayer,
                myTricks = TricksWon[s],
                oppTricks = TricksWon[o],
                highestBid = HighestBid.HasValue ? HighestBid.Value.Index : -1,
                highestBidder = HighestBidder,
                declarer = Declarer,
                minBid = MinBidIndex,
                oppTakenFaceUp = TakenFaceUp[o].Select(c => c.Id).ToArray()
            };
        }

        void Emit(GameEvent e, int to = -1) => Emitted?.Invoke(e, to);
    }
}
