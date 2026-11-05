using System;
using System.Collections.Generic;
using System.Linq;

namespace HoneymoonBridge.Tests
{
    // 電腦對打模擬器：每一步都檢查規則不變量，出錯時丟出帶「亂數種子」的例外，
    // 拿那個種子就能一模一樣重播那一局（同一個種子 → 同樣的洗牌、同樣的 AI 決策）。
    public static class GameSimulator
    {
        public const int MaxRedeals = 50;   // 連續重發超過這麼多次就當作卡死

        public class Result
        {
            public int Seed;
            public int Redeals;
            public int Declarer;
            public int TricksTaken;
            public int TricksNeeded;
            public int Steps;
        }

        public class InvariantViolation : Exception
        {
            public readonly int Seed;
            public InvariantViolation(int seed, string msg)
                : base($"[seed={seed}] {msg}\n重播這一局：HB_SEED={seed} dotnet test tools/LogicTests --filter ReplaySeed")
            {
                Seed = seed;
            }
        }

        // 跑完一整局（包含重發），回傳結果；任何不變量被打破就丟 InvariantViolation
        public static Result PlayOne(int seed)
        {
            var g = new HoneymoonGame(seed);
            var res = new Result { Seed = seed };
            var played = new HashSet<int>();          // 已經離開手牌、出到桌上的牌
            var inbox = new[] { new List<GameEvent>(), new List<GameEvent>() };

            void Fail(string msg) => throw new InvariantViolation(seed, msg);

            g.Emitted += (e, to) =>
            {
                if (to < 0) { inbox[0].Add(e); inbox[1].Add(e); }
                else if (to == 0 || to == 1) inbox[to].Add(e);
                else Fail($"事件 {e.type} 的收件人 {to} 不合法");

                if (e.type == GameEventType.CardPlayed) played.Add(e.card);
                if (e.type == GameEventType.NewHand) played.Clear();
                if (e.type == GameEventType.Redeal) res.Redeals++;
            };

            g.StartNew();

            while (g.Phase != Phase.Finished)
            {
                if (++res.Steps > 5000) Fail("超過 5000 步還沒結束，可能卡死");
                if (res.Redeals > MaxRedeals) Fail($"連續重發超過 {MaxRedeals} 次");

                CheckConservation(g, played, Fail);
                CheckViews(g, Fail);
                CheckInbox(inbox, Fail);

                int p = g.CurrentPlayer;
                int o = HoneymoonGame.Other(p);

                if (g.TrickComplete)
                {
                    // 兩張都出完，還沒結算前，誰都不能再出
                    if (g.Hands[p].Count > 0 && g.PlayCard(p, g.Hands[p][0])) Fail("墩已滿還能出牌");
                    ResolveAndCheck(g, Fail);
                    continue;
                }

                if (g.Phase == Phase.Bidding)
                {
                    if (g.MakeBid(o, null)) Fail("不是自己的回合卻能 Pass");
                    if (g.MinBidIndex > 0 && g.MakeBid(p, Bid.FromIndex(g.MinBidIndex - 1)))
                        Fail("叫品沒有比目前合約高卻被接受");
                    if (g.PlayCard(p, g.Hands[p][0])) Fail("叫牌階段居然能出牌");

                    var bid = SimpleAI.ChooseBid(g, p);
                    if (bid.HasValue && bid.Value.Index < g.MinBidIndex) Fail($"AI 叫了不合法的 {bid}");
                    if (!g.MakeBid(p, bid)) Fail($"合法叫品 {(bid.HasValue ? bid.ToString() : "Pass")} 被拒絕");
                    continue;
                }

                // 出牌（抽牌或打牌階段）
                var legal = g.LegalFor(p);
                if (legal.Count == 0) Fail("輪到出牌卻沒有合法的牌");
                if (g.Hands[o].Count > 0 && g.PlayCard(o, g.Hands[o][0])) Fail("不是自己的回合卻能出牌");

                var illegal = g.Hands[p].FirstOrDefault(c => !legal.Contains(c));
                if (g.Hands[p].Contains(illegal) && !legal.Contains(illegal))
                {
                    int before = g.Hands[p].Count;
                    int seenOpp = inbox[o].Count;
                    if (g.PlayCard(p, illegal)) Fail($"沒跟花色的 {illegal} 被接受");
                    if (g.Hands[p].Count != before) Fail("非法出牌後手牌張數變了");
                    if (inbox[o].Skip(seenOpp).Any(e => e.type == GameEventType.Illegal))
                        Fail("非法出牌的提示被傳給了對手");
                }

                var card = SimpleAI.ChooseCard(g, p);
                if (!legal.Contains(card)) Fail($"AI 出了不合法的 {card}");

                // 獨立裁判：不靠 BridgeRules，自己判斷有沒有跟花色
                if (p != g.Leader)
                {
                    var led = g.LeadCard.Value.Suit;
                    if (g.Hands[p].Any(c => c.Suit == led) && card.Suit != led)
                        Fail($"手上有 {Card.SuitSymbol(led)} 卻出了 {card}，沒有跟花色");
                }
                if (!g.PlayCard(p, card)) Fail($"合法的 {card} 被拒絕");
            }

            CheckInbox(inbox, Fail);
            if (g.Hands[0].Count != 0 || g.Hands[1].Count != 0) Fail("結束時手上還有牌");
            if (g.TricksWon[0] + g.TricksWon[1] != 13) Fail($"打牌階段總墩數 {g.TricksWon[0] + g.TricksWon[1]} ≠ 13");
            if (g.Declarer < 0 || !g.HighestBid.HasValue) Fail("結束了卻沒有莊家或合約");

            res.Declarer = g.Declarer;
            res.TricksTaken = g.TricksWon[g.Declarer];
            res.TricksNeeded = g.HighestBid.Value.TricksNeeded;
            return res;
        }

        static void ResolveAndCheck(HoneymoonGame g, Action<string> Fail)
        {
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

        // 52 張牌：手牌 + 牌堆 + 已出的牌，不多不少、不重複
        static void CheckConservation(HoneymoonGame g, HashSet<int> played, Action<string> Fail)
        {
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
        static void CheckViews(HoneymoonGame g, Action<string> Fail)
        {
            for (int s = 0; s < 2; s++)
            {
                var v = g.ViewFor(s);
                var mine = new HashSet<int>(g.Hands[s].Select(c => c.Id));
                var opp = new HashSet<int>(g.Hands[1 - s].Select(c => c.Id));
                if (!mine.SetEquals(v.hand)) Fail($"座位 {s} 畫面的手牌跟實際不同");
                if (v.legal.Any(id => !mine.Contains(id))) Fail($"座位 {s} 的可出牌包含不在手上的牌");
                if (v.oppCount != opp.Count) Fail($"座位 {s} 看到的對手張數錯誤");
                if (v.legal.Length > 0 && !v.IsMyTurn) Fail($"座位 {s} 不是自己的回合卻有可出的牌");

                // 對手手牌只允許以「他拿走的明牌」的形式出現（那本來就是公開資訊）
                if (v.hand.Any(id => opp.Contains(id)))
                    Fail($"座位 {s} 的畫面洩漏了對手的牌");
                if (v.oppTakenFaceUp.Any(id => !g.TakenFaceUp[1 - s].Any(c => c.Id == id)))
                    Fail($"座位 {s} 的記牌小抄有對手沒拿過的牌");
            }
        }

        // 送給某個座位的事件裡，不能有對手摸到的暗牌
        static void CheckInbox(List<GameEvent>[] inbox, Action<string> Fail)
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
}
