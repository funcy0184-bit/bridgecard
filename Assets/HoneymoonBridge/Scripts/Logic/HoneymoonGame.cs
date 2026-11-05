using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge
{
    public enum Phase { Draw, Bidding, Play, Finished }

    // 叫牌紀錄的一筆：誰、叫了什麼（Call 編碼）
    public readonly struct AuctionEntry
    {
        public readonly int Seat;
        public readonly int Call;
        public AuctionEntry(int seat, int call) { Seat = seat; Call = call; }
    }

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

        // ---- 叫牌 ----
        public Bid? HighestBid { get; private set; }
        public int HighestBidder { get; private set; } = -1;
        public int Doubled { get; private set; }            // 0 / 1 加倍 / 2 再加倍
        public int Declarer { get; private set; } = -1;
        public readonly List<AuctionEntry> Auction = new List<AuctionEntry>();
        int passesInRow;
        int firstSeat = 1;   // 每局輪流先手，StartNew 會先切換

        // ---- 整場比賽 ----
        public readonly int TargetScore;
        public readonly int[] Scores = new int[2];
        public int HandsPlayed { get; private set; }        // 已經計分的局數（重發不算）
        public HandResult LastResult { get; private set; }  // 這局打完的明細；打牌中為 null
        public int MatchWinner { get; private set; } = -1;
        public bool MatchOver => MatchWinner >= 0;

        // 第二個參數是收件人：-1 = 兩邊都收，0 / 1 = 只給那個座位
        public event Action<GameEvent, int> Emitted;

        readonly Random rng;
        public HoneymoonGame(int? seed = null, int targetScore = Scoring.DefaultTarget)
        {
            rng = seed.HasValue ? new Random(seed.Value) : new Random();
            TargetScore = targetScore;
        }

        // 新的一場：分數歸零，然後發第一局
        public void StartNewMatch()
        {
            Scores[0] = Scores[1] = 0;
            HandsPlayed = 0;
            MatchWinner = -1;
            StartNew();
        }

        // 發新的一局（分數保留）。整場已經結束的話，自動開新的一場
        public void StartNew()
        {
            if (MatchOver) { StartNewMatch(); return; }

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
            HighestBid = null; HighestBidder = -1; Declarer = -1; Doubled = 0; passesInRow = 0;
            Auction.Clear();
            LastResult = null;
            Trump = Strain.NoTrump;              // 抽牌階段不設王牌
            Phase = Phase.Draw;
            firstSeat = Other(firstSeat);
            Leader = CurrentPlayer = firstSeat;
            LeadCard = FollowCard = null;
            Emit(new GameEvent(GameEventType.NewHand, firstSeat, value: HandsPlayed + 1));
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

            if (Hands[0].Count == 0) FinishHand();
            else Leader = CurrentPlayer = w;   // 贏的人下一墩先出
        }

        void FinishHand()
        {
            Phase = Phase.Finished;
            Emit(new GameEvent(GameEventType.GameOver, Declarer,
                value: TricksWon[Declarer], extra: HighestBid.Value.TricksNeeded));

            var r = Scoring.Score(HighestBid.Value, Doubled, Declarer, TricksWon[Declarer]);
            HandsPlayed++;
            r.handNumber = HandsPlayed;
            Scores[r.scorer] += r.points;
            LastResult = r;
            Emit(new GameEvent(GameEventType.HandScored, r.scorer, value: r.points, extra: Scores[r.scorer]));

            if (Scores[r.scorer] >= TargetScore)
            {
                MatchWinner = r.scorer;
                Emit(new GameEvent(GameEventType.MatchOver, r.scorer,
                    value: Scores[r.scorer], extra: Scores[Other(r.scorer)]));
            }
        }

        // ---------------- 叫牌 ----------------

        public int MinBidIndex => HighestBid.HasValue ? HighestBid.Value.Index + 1 : 0;

        // 防守方（不是目前叫品的人）可以加倍一次
        public bool CanDouble(int p) =>
            Phase == Phase.Bidding && HighestBid.HasValue && HighestBidder != p && Doubled == 0;

        // 被加倍的莊家可以再加倍一次
        public bool CanRedouble(int p) =>
            Phase == Phase.Bidding && HighestBid.HasValue && HighestBidder == p && Doubled == 1;

        public bool IsLegalCall(int p, int call)
        {
            if (Phase != Phase.Bidding || p != CurrentPlayer) return false;
            if (call == Call.Pass) return true;
            if (call == Call.Double) return CanDouble(p);
            if (call == Call.Redouble) return CanRedouble(p);
            return Call.IsBid(call) && call >= MinBidIndex;
        }

        // 舊介面：bid == null 代表 Pass
        public bool MakeBid(int p, Bid? bid) => MakeCall(p, bid.HasValue ? bid.Value.Index : Call.Pass);

        // call：0..34 叫品、Call.Pass、Call.Double、Call.Redouble
        public bool MakeCall(int p, int call)
        {
            if (!IsLegalCall(p, call)) return false;
            Auction.Add(new AuctionEntry(p, call));

            if (Call.IsBid(call))
            {
                HighestBid = Bid.FromIndex(call); HighestBidder = p;
                Doubled = 0;                     // 蓋叫 → 舊合約的加倍狀態清除
                passesInRow = 0;
                Emit(new GameEvent(GameEventType.BidMade, p, value: call));
                CurrentPlayer = Other(p);
                return true;
            }
            if (call == Call.Double)
            {
                Doubled = 1;
                Emit(new GameEvent(GameEventType.Doubled, p, value: HighestBid.Value.Index));
                CurrentPlayer = Other(p);        // 輪到被加倍的莊家：Pass / 再加倍 / 改叫
                return true;
            }
            if (call == Call.Redouble)
            {
                Doubled = 2;
                Emit(new GameEvent(GameEventType.Redoubled, p, value: HighestBid.Value.Index));
                CurrentPlayer = Other(p);        // 輪到加倍的人：Pass / 改叫
                return true;
            }

            passesInRow++;
            Emit(new GameEvent(GameEventType.Passed, p));
            if (HighestBid.HasValue) StartPlay();                 // 已經有合約：一方 Pass 就定約
            else if (passesInRow >= 2)
            {
                Emit(new GameEvent(GameEventType.Redeal));        // 雙方起手都 Pass：重發，分數不變
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
            Emit(new GameEvent(GameEventType.ContractSet, Declarer, value: HighestBid.Value.Index, extra: Doubled));
        }

        // ---------------- 給某個座位看的牌桌 ----------------

        public TableState ViewFor(int s)
        {
            int o = Other(s);
            bool canPlay = (Phase == Phase.Draw || Phase == Phase.Play) && CurrentPlayer == s && !TrickComplete;
            bool myBidTurn = Phase == Phase.Bidding && CurrentPlayer == s;
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
                doubled = Doubled,
                declarer = Declarer,
                minBid = MinBidIndex,
                canDouble = myBidTurn && CanDouble(s),
                canRedouble = myBidTurn && CanRedouble(s),
                auctionSeats = Auction.Select(a => a.Seat).ToArray(),
                auctionCalls = Auction.Select(a => a.Call).ToArray(),
                oppTakenFaceUp = TakenFaceUp[o].Select(c => c.Id).ToArray(),
                myScore = Scores[s],
                oppScore = Scores[o],
                targetScore = TargetScore,
                handNumber = Phase == Phase.Finished ? HandsPlayed : HandsPlayed + 1,
                hasResult = LastResult != null,
                result = LastResult ?? new HandResult(),
                matchWinner = MatchWinner
            };
        }

        void Emit(GameEvent e, int to = -1) => Emitted?.Invoke(e, to);
    }
}
