using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tests
{
    // 對打模擬器：每一步都檢查規則不變量，出錯時丟出帶「亂數種子」的例外，
    // 拿那個種子就能一模一樣重播那一局（同一個種子 → 同樣的洗牌、同樣的決策）。
    //
    // 兩種玩法：
    //   AI     = 兩邊都是 SimpleAI（接近真實對局）
    //   Random = 兩邊都隨機挑合法動作，很常加倍、再加倍、蓋叫、叫到 7 線，專門把冷門的分支跑出來
    public enum Policy { AI, Random }

    public static class GameSimulator
    {
        public const int MaxRedeals = 50;   // 連續重發超過這麼多次就當作卡死
        public const int MaxHandsPerMatch = 300;

        public class Result
        {
            public int Seed;
            public int Redeals;
            public int Declarer;
            public int TricksTaken;
            public int TricksNeeded;
            public int Doubled;
            public int Scorer;
            public int Points;
            public int Steps;
            public bool Made => TricksTaken >= TricksNeeded;
        }

        public class MatchResult
        {
            public int Seed;
            public int Winner;
            public int[] Scores = new int[2];
            public List<Result> Hands = new List<Result>();
        }

        public class InvariantViolation : Exception
        {
            public readonly int Seed;
            public InvariantViolation(int seed, string replay, string msg)
                : base($"[seed={seed}] {msg}\n重播：{replay}")
            {
                Seed = seed;
            }
        }

        public static string ReplayCommand(int seed, Policy policy, bool match) =>
            $"HB_SEED={seed} HB_POLICY={policy}{(match ? " HB_MATCH=1" : "")} dotnet test tools/LogicTests --filter ReplaySeed";

        // 單局（新的一場的第一局）
        public static Result PlayOne(int seed, Policy policy = Policy.AI)
        {
            var run = new Runner(seed, policy, false, Scoring.DefaultTarget);
            run.Game.StartNewMatch();
            return run.PlayHand();
        }

        // 一整場：一直打到有人先到 target 分
        public static MatchResult PlayMatch(int seed, Policy policy = Policy.AI, int target = Scoring.DefaultTarget)
        {
            var run = new Runner(seed, policy, true, target);
            var g = run.Game;
            var m = new MatchResult { Seed = seed };
            g.StartNewMatch();
            while (true)
            {
                m.Hands.Add(run.PlayHand());
                if (g.MatchOver) break;
                if (m.Hands.Count >= MaxHandsPerMatch) run.Fail($"打了 {MaxHandsPerMatch} 局還沒有人到 {target} 分");
                g.StartNew();
            }
            m.Winner = g.MatchWinner;
            m.Scores[0] = g.Scores[0]; m.Scores[1] = g.Scores[1];

            // 整場的帳要對得起來：每局分數加總 = 總分
            for (int s = 0; s < 2; s++)
            {
                int sum = m.Hands.Where(h => h.Scorer == s).Sum(h => h.Points);
                if (sum != g.Scores[s]) run.Fail($"座位 {s} 每局分數加總 {sum} ≠ 總分 {g.Scores[s]}");
            }
            if (g.Scores[m.Winner] < target) run.Fail("贏家總分沒到目標分");
            if (g.Scores[1 - m.Winner] >= target) run.Fail("輸家總分也到了目標分");
            return m;
        }

        // ================================================================

        class Runner
        {
            public readonly HoneymoonGame Game;
            readonly int seed;
            readonly Policy policy;
            readonly bool match;
            readonly Random rng;                         // 隨機策略用，跟洗牌的亂數分開
            readonly HashSet<int> played = new HashSet<int>();
            readonly List<GameEvent>[] inbox = { new List<GameEvent>(), new List<GameEvent>() };
            readonly List<GameEvent> handEvents = new List<GameEvent>();
            int redeals;

            public Runner(int seed, Policy policy, bool match, int target)
            {
                this.seed = seed; this.policy = policy; this.match = match;
                Game = new HoneymoonGame(seed, target);
                rng = new Random(unchecked(seed * 7919 + 17));
                Game.Emitted += OnEmit;
            }

            public void Fail(string msg) => throw new InvariantViolation(seed, ReplayCommand(seed, policy, match), msg);

            void OnEmit(GameEvent e, int to)
            {
                if (to < 0) { inbox[0].Add(e); inbox[1].Add(e); }
                else if (to == 0 || to == 1) inbox[to].Add(e);
                else Fail($"事件 {e.type} 的收件人 {to} 不合法");
                if (to < 0) handEvents.Add(e);

                if (e.type == GameEventType.CardPlayed) played.Add(e.card);
                if (e.type == GameEventType.NewHand) { played.Clear(); handEvents.Clear(); handEvents.Add(e); }
                if (e.type == GameEventType.Redeal) redeals++;
            }

            public Result PlayHand()
            {
                var g = Game;
                var res = new Result { Seed = seed };
                var auction = new AuctionReferee();
                int[] scoresBefore = { g.Scores[0], g.Scores[1] };
                redeals = 0;

                while (g.Phase != Phase.Finished)
                {
                    if (++res.Steps > 5000) Fail("超過 5000 步還沒結束，可能卡死");
                    if (redeals > MaxRedeals) Fail($"連續重發超過 {MaxRedeals} 次");
                    if (g.Scores[0] != scoresBefore[0] || g.Scores[1] != scoresBefore[1]) Fail("局還沒打完分數就變了");

                    CheckConservation();
                    CheckViews();
                    CheckInbox();

                    int p = g.CurrentPlayer;
                    int o = HoneymoonGame.Other(p);

                    if (g.TrickComplete)
                    {
                        // 兩張都出完，還沒結算前，誰都不能再出
                        if (g.Hands[p].Count > 0 && g.PlayCard(p, g.Hands[p][0])) Fail("墩已滿還能出牌");
                        ResolveAndCheck();
                        continue;
                    }

                    if (g.Phase == Phase.Bidding) { BidStep(auction, p, o); continue; }
                    if (g.Phase == Phase.Draw && auction.Calls.Count > 0) auction = new AuctionReferee();   // 重發了

                    PlayStep(p, o);
                }

                CheckInbox();
                if (g.Hands[0].Count != 0 || g.Hands[1].Count != 0) Fail("結束時手上還有牌");
                if (g.TricksWon[0] + g.TricksWon[1] != 13) Fail($"打牌階段總墩數 {g.TricksWon[0] + g.TricksWon[1]} ≠ 13");
                if (g.Declarer < 0 || !g.HighestBid.HasValue) Fail("結束了卻沒有莊家或合約");

                res.Redeals = redeals;
                res.Declarer = g.Declarer;
                res.TricksTaken = g.TricksWon[g.Declarer];
                res.TricksNeeded = g.HighestBid.Value.TricksNeeded;
                res.Doubled = g.Doubled;
                CheckScoring(res, scoresBefore);
                return res;
            }

            // ---------------- 叫牌 ----------------

            void BidStep(AuctionReferee auction, int p, int o)
            {
                var g = Game;

                // 遊戲的狀態要跟裁判自己記的一模一樣
                if ((g.HighestBid.HasValue ? g.HighestBid.Value.Index : -1) != auction.Highest) Fail("目前叫品跟裁判不同");
                if (g.HighestBidder != auction.Bidder) Fail("目前叫品的人跟裁判不同");
                if (g.Doubled != auction.Doubled) Fail($"加倍狀態 {g.Doubled} 跟裁判的 {auction.Doubled} 不同");
                var view = g.ViewFor(p);
                if (!view.auctionCalls.SequenceEqual(auction.Calls.Select(c => c.call)) ||
                    !view.auctionSeats.SequenceEqual(auction.Calls.Select(c => c.seat)))
                    Fail("畫面上的叫牌紀錄跟實際叫的不同");
                if (view.canDouble != auction.IsLegal(p, Call.Double)) Fail("畫面的「可以加倍」跟裁判不同");
                if (view.canRedouble != auction.IsLegal(p, Call.Redouble)) Fail("畫面的「可以再加倍」跟裁判不同");
                if (g.ViewFor(o).canDouble || g.ViewFor(o).canRedouble) Fail("不是自己的回合卻能加倍");

                // 每一種叫法，遊戲判斷的合不合法都要跟裁判一樣
                var probes = new List<int> { Call.Pass, Call.Double, Call.Redouble, 0, 34 };
                if (auction.Highest >= 0) probes.Add(auction.Highest);
                if (auction.Highest + 1 <= 34) probes.Add(auction.Highest + 1);
                foreach (var c in probes)
                {
                    if (g.IsLegalCall(p, c) != auction.IsLegal(p, c))
                        Fail($"「{Call.Text(c)}」合不合法：遊戲說 {g.IsLegalCall(p, c)}，裁判說 {auction.IsLegal(p, c)}");
                    if (g.IsLegalCall(o, c)) Fail($"不是自己的回合卻能叫「{Call.Text(c)}」");
                }

                // 不合法的叫法真的送進去，要被擋下而且什麼都不變
                foreach (var c in probes.Where(c => !auction.IsLegal(p, c)))
                {
                    int count = g.Auction.Count;
                    if (g.MakeCall(p, c)) Fail($"不合法的「{Call.Text(c)}」被接受");
                    if (g.Auction.Count != count) Fail("被拒絕的叫法還是被記進叫牌紀錄");
                }
                if (g.MakeCall(o, Call.Pass)) Fail("不是自己的回合卻能 Pass");
                if (g.PlayCard(p, g.Hands[p][0])) Fail("叫牌階段居然能出牌");

                int call = policy == Policy.AI ? SimpleAI.ChooseCall(g, p) : RandomCall(auction, p);
                if (!auction.IsLegal(p, call)) Fail($"{policy} 選了不合法的「{Call.Text(call)}」");

                int scores0 = g.Scores[0], scores1 = g.Scores[1];
                if (!g.MakeCall(p, call)) Fail($"合法的「{Call.Text(call)}」被拒絕");
                var outcome = auction.Apply(p, call);

                switch (outcome)
                {
                    case AuctionReferee.Outcome.Contract:
                        if (g.Phase != Phase.Play) Fail("一方 Pass 了卻沒有定約");
                        if (g.Declarer != auction.Bidder) Fail("莊家不是最後叫品的人");
                        if (g.HighestBid.Value.Index != auction.Highest) Fail("定約的叫品錯了");
                        if (g.Doubled != auction.Doubled) Fail("定約的加倍狀態錯了");
                        if ((int)g.Trump != (int)Bid.FromIndex(auction.Highest).Strain) Fail("王牌花色錯了");
                        if (g.Leader != HoneymoonGame.Other(g.Declarer) || g.CurrentPlayer != g.Leader) Fail("不是非莊家首攻");
                        var set = handEvents.LastOrDefault(e => e.type == GameEventType.ContractSet);
                        if (set == null || set.value != auction.Highest || set.extra != auction.Doubled || set.seat != g.Declarer)
                            Fail("ContractSet 事件內容錯誤");
                        break;
                    case AuctionReferee.Outcome.Redeal:
                        if (g.Phase != Phase.Draw || g.Stock.Count != 26) Fail("雙方都 Pass 卻沒有重發");
                        if (g.Scores[0] != scores0 || g.Scores[1] != scores1) Fail("重發時分數變了");
                        if (g.Auction.Count != 0) Fail("重發後叫牌紀錄沒清掉");
                        break;
                    default:
                        if (g.Phase != Phase.Bidding) Fail($"「{Call.Text(call)}」之後應該還在叫牌");
                        if (g.CurrentPlayer != o) Fail("叫完沒有換人");
                        break;
                }
            }

            int RandomCall(AuctionReferee a, int p)
            {
                double r = rng.NextDouble();
                if (a.IsLegal(p, Call.Redouble) && r < 0.35) return Call.Redouble;
                if (a.IsLegal(p, Call.Double) && r < 0.35) return Call.Double;
                if (r < 0.65 || a.Highest >= 34) return Call.Pass;
                int min = a.Highest + 1;
                return Math.Min(34, min + rng.Next(0, 5));
            }

            // ---------------- 出牌 ----------------

            void PlayStep(int p, int o)
            {
                var g = Game;
                var legal = g.LegalFor(p);
                if (legal.Count == 0) Fail("輪到出牌卻沒有合法的牌");
                if (g.Hands[o].Count > 0 && g.PlayCard(o, g.Hands[o][0])) Fail("不是自己的回合卻能出牌");

                var illegal = g.Hands[p].Where(c => !legal.Contains(c)).ToList();
                if (illegal.Count > 0)
                {
                    int before = g.Hands[p].Count;
                    int seenOpp = inbox[o].Count;
                    if (g.PlayCard(p, illegal[0])) Fail($"沒跟花色的 {illegal[0]} 被接受");
                    if (g.Hands[p].Count != before) Fail("非法出牌後手牌張數變了");
                    if (inbox[o].Skip(seenOpp).Any(e => e.type == GameEventType.Illegal))
                        Fail("非法出牌的提示被傳給了對手");
                }

                var card = policy == Policy.AI ? SimpleAI.ChooseCard(g, p) : legal[rng.Next(legal.Count)];
                if (!legal.Contains(card)) Fail($"{policy} 出了不合法的 {card}");

                // 獨立裁判：不靠 BridgeRules，自己判斷有沒有跟花色
                if (p != g.Leader)
                {
                    var led = g.LeadCard.Value.Suit;
                    if (g.Hands[p].Any(c => c.Suit == led) && card.Suit != led)
                        Fail($"手上有 {Card.SuitSymbol(led)} 卻出了 {card}，沒有跟花色");
                }
                if (!g.PlayCard(p, card)) Fail($"合法的 {card} 被拒絕");
            }

            void ResolveAndCheck()
            {
                var g = Game;
                var phase = g.Phase;
                int winner = g.TrickWinner();
                if (winner != RefereeWinner(g)) Fail($"{g.LeadCard} 對 {g.FollowCard}（王 {g.Trump}）判錯贏家");
                int loser = HoneymoonGame.Other(winner);
                Card? faceUp = g.FaceUp;
                int stockBefore = g.Stock.Count;
                int wonBefore = g.TricksWon[winner];

                g.ResolveTrick();

                if (g.LeadCard.HasValue || g.FollowCard.HasValue) Fail("結算後桌上還有牌");

                if (phase == Phase.Draw)
                {
                    if (g.Stock.Count != stockBefore - 2) Fail("抽牌階段一墩應該從牌堆拿走 2 張");
                    if (!g.Hands[winner].Contains(faceUp.Value)) Fail("贏墩的人沒有拿到明牌");
                    if (g.Hands[loser].Contains(faceUp.Value)) Fail("輸墩的人拿到了明牌");
                    if (g.Hands[0].Count != 13 || g.Hands[1].Count != 13) Fail("抽牌後雙方手牌應各 13 張");
                    if (g.TricksWon[0] != 0 || g.TricksWon[1] != 0) Fail("抽牌階段的墩不該計分");
                    if (g.Stock.Count == 0 && g.Phase != Phase.Bidding) Fail("牌堆抽完卻沒進入叫牌");
                    if (g.Stock.Count > 0 && g.Leader != winner) Fail("抽牌階段應由贏墩的人領下一墩");
                }
                else
                {
                    if (g.TricksWon[winner] != wonBefore + 1) Fail("贏墩的人墩數沒有 +1");
                    if (g.Phase == Phase.Play && g.Leader != winner) Fail("打牌階段應由贏墩的人領下一墩");
                }
            }

            // ---------------- 計分 ----------------

            // 獨立裁判：照 docs/SPEC.md 的公式自己算一次，不呼叫 Scoring
            void CheckScoring(Result res, int[] scoresBefore)
            {
                var g = Game;
                var b = g.HighestBid.Value;
                int mult = res.Doubled == 2 ? 4 : res.Doubled == 1 ? 2 : 1;
                int need = b.Level + 6;
                int got = res.TricksTaken;
                int expScorer = got >= need ? g.Declarer : 1 - g.Declarer;
                int expPoints = got >= need
                    ? b.Level * 10 * mult + (got - need) * 2
                    : (need - got) * 10 * mult;

                var r = g.LastResult;
                if (r == null) Fail("打完了卻沒有計分明細");
                if (r.scorer != expScorer || r.points != expPoints)
                    Fail($"{Scoring.ContractText(b, res.Doubled)} 拿 {got} 墩：應該座位 {expScorer} 得 {expPoints}，" +
                         $"實際座位 {r.scorer} 得 {r.points}");
                if (r.made != (got >= need)) Fail("打成／倒約判斷錯誤");
                if (r.contractPoints + r.overtrickPoints + r.penaltyPoints != r.points) Fail("明細各項加起來不等於得分");
                if (r.handNumber != g.HandsPlayed) Fail("明細的局數錯誤");

                if (g.Scores[expScorer] != scoresBefore[expScorer] + expPoints) Fail("得分方的總分沒有正確增加");
                if (g.Scores[1 - expScorer] != scoresBefore[1 - expScorer]) Fail("沒得分的一方總分變了");

                var scored = handEvents.LastOrDefault(e => e.type == GameEventType.HandScored);
                if (scored == null || scored.seat != expScorer || scored.value != expPoints || scored.extra != g.Scores[expScorer])
                    Fail("HandScored 事件內容錯誤");

                bool shouldEnd = g.Scores[expScorer] >= g.TargetScore;
                if (g.MatchOver != shouldEnd) Fail($"總分 {g.Scores[expScorer]}／目標 {g.TargetScore}，整場結束判斷錯誤");
                if (shouldEnd && g.MatchWinner != expScorer) Fail("整場贏家錯誤");
                bool sawMatchOver = handEvents.Any(e => e.type == GameEventType.MatchOver);
                if (sawMatchOver != shouldEnd) Fail("MatchOver 事件該有沒有、不該有卻有");

                for (int s = 0; s < 2; s++)
                {
                    var v = g.ViewFor(s);
                    if (!v.hasResult || v.result.points != expPoints || v.result.scorer != expScorer) Fail($"座位 {s} 畫面的明細錯誤");
                    if (v.myScore != g.Scores[s] || v.oppScore != g.Scores[1 - s]) Fail($"座位 {s} 畫面的總分錯誤");
                    if (v.matchWinner != g.MatchWinner) Fail($"座位 {s} 畫面的整場贏家錯誤");
                }

                res.Scorer = expScorer;
                res.Points = expPoints;
            }

            // ---------------- 通用檢查 ----------------

            // 52 張牌：手牌 + 牌堆 + 已出的牌，不多不少、不重複
            void CheckConservation()
            {
                var g = Game;
                var all = new List<int>();
                all.AddRange(g.Hands[0].Select(c => c.Id));
                all.AddRange(g.Hands[1].Select(c => c.Id));
                all.AddRange(g.Stock.Select(c => c.Id));
                all.AddRange(played);
                if (all.Count != 52) Fail($"牌數不守恆：現在有 {all.Count} 張");
                if (all.Distinct().Count() != 52) Fail("有重複的牌");
                if (all.Any(id => id < 0 || id > 51)) Fail("出現不存在的牌編號");
            }

            // 每個座位的畫面不能看到對手的手牌
            void CheckViews()
            {
                var g = Game;
                for (int s = 0; s < 2; s++)
                {
                    var v = g.ViewFor(s);
                    var mine = new HashSet<int>(g.Hands[s].Select(c => c.Id));
                    var opp = new HashSet<int>(g.Hands[1 - s].Select(c => c.Id));
                    if (!mine.SetEquals(v.hand)) Fail($"座位 {s} 畫面的手牌跟實際不同");
                    if (v.legal.Any(id => !mine.Contains(id))) Fail($"座位 {s} 的可出牌包含不在手上的牌");
                    if (v.oppCount != opp.Count) Fail($"座位 {s} 看到的對手張數錯誤");
                    if (v.legal.Length > 0 && !v.IsMyTurn) Fail($"座位 {s} 不是自己的回合卻有可出的牌");
                    if (v.hand.Any(id => opp.Contains(id))) Fail($"座位 {s} 的畫面洩漏了對手的牌");
                    if (v.oppTakenFaceUp.Any(id => !g.TakenFaceUp[1 - s].Any(c => c.Id == id)))
                        Fail($"座位 {s} 的記牌小抄有對手沒拿過的牌");
                    if (v.hasResult) Fail($"座位 {s} 還沒打完就有計分明細");
                }
            }

            // 送給某個座位的事件裡，不能有對手摸到的暗牌
            void CheckInbox()
            {
                for (int s = 0; s < 2; s++)
                {
                    foreach (var e in inbox[s])
                    {
                        if (e.type == GameEventType.CardDrawn && e.seat != s && e.card >= 0)
                            Fail($"座位 {s} 收到了對手摸到的暗牌 {Card.FromId(e.card)}");
                        if (e.type == GameEventType.Illegal && e.seat != s)
                            Fail($"座位 {s} 收到了對手的非法出牌提示");
                    }
                    inbox[s].Clear();
                }
            }
        }

        // 獨立裁判：跟牌的人只有「同花色比較大」或「首引不是王、他出王」才贏
        static int RefereeWinner(HoneymoonGame g)
        {
            Card lead = g.LeadCard.Value, follow = g.FollowCard.Value;
            bool hasTrump = g.Trump != Strain.NoTrump;
            Suit trump = hasTrump ? (Suit)(int)g.Trump : Suit.Clubs;
            bool followWins =
                (follow.Suit == lead.Suit && follow.Rank > lead.Rank) ||
                (hasTrump && follow.Suit == trump && lead.Suit != trump);
            return followWins ? HoneymoonGame.Other(g.Leader) : g.Leader;
        }

        // 叫牌裁判：照 docs/SPEC.md 的叫牌規則自己記一份，不看 HoneymoonGame 的實作
        class AuctionReferee
        {
            public enum Outcome { Continue, Contract, Redeal }

            public int Highest = -1, Bidder = -1, Doubled;
            public readonly List<(int seat, int call)> Calls = new List<(int seat, int call)>();

            public bool IsLegal(int p, int call)
            {
                if (call == Call.Pass) return true;
                if (call == Call.Double) return Highest >= 0 && Bidder != p && Doubled == 0;
                if (call == Call.Redouble) return Highest >= 0 && Bidder == p && Doubled == 1;
                return call >= 0 && call <= 34 && call > Highest;
            }

            public Outcome Apply(int p, int call)
            {
                Calls.Add((p, call));
                if (call == Call.Pass)
                {
                    if (Highest >= 0) return Outcome.Contract;              // 有合約後一方 Pass 就定約
                    return Calls.Count >= 2 ? Outcome.Redeal : Outcome.Continue;   // 起手兩個 Pass 才重發
                }
                if (call == Call.Double) Doubled = 1;
                else if (call == Call.Redouble) Doubled = 2;
                else { Highest = call; Bidder = p; Doubled = 0; }           // 蓋叫清除加倍
                return Outcome.Continue;
            }
        }
    }
}
