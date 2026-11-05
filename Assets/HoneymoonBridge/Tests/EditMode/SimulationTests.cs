using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 大量對打。每局的種子 = HB_BASE_SEED + 局號，失敗訊息會印出種子和重播指令。
    //
    // 可用環境變數調整：
    //   HB_GAMES=20000      單局模擬跑幾局（預設 5000）
    //   HB_MATCHES=2000     整場模擬跑幾場（預設 500）
    //   HB_BASE_SEED=777    從哪個種子開始（預設 20261105，固定 → 每次跑結果一樣）
    //   HB_SEED=123         只重播這一局（給 ReplaySeed 用），搭配 HB_POLICY=AI|Random、HB_MATCH=1
    public class SimulationTests
    {
        const int DefaultBaseSeed = 20261105;

        static int EnvInt(string name, int fallback)
        {
            var v = Environment.GetEnvironmentVariable(name);
            return int.TryParse(v, out var n) ? n : fallback;
        }

        // 跑 count 次 body(seed)，收集失敗（最多 10 個）一起報
        static void RunMany(string label, int count, Func<int, string> body)
        {
            int baseSeed = EnvInt("HB_BASE_SEED", DefaultBaseSeed);
            var failures = new List<string>();
            var notes = new List<string>();
            for (int i = 0; i < count && failures.Count < 10; i++)
            {
                int seed = baseSeed + i;
                try { var n = body(seed); if (n != null) notes.Add(n); }
                catch (GameSimulator.InvariantViolation ex) { failures.Add(ex.Message); }
                catch (Exception ex) { failures.Add($"[seed={seed}] 非預期的例外：{ex}"); }   // NullReference 之類也要帶種子
            }
            TestContext.WriteLine($"{label}：{count} 次（種子 {baseSeed}..{baseSeed + count - 1}）");
            if (failures.Count > 0)
                Assert.Fail($"{failures.Count} 個失敗（最多列 10 個）：\n" + string.Join("\n\n", failures));
        }

        static void Report(string label, List<GameSimulator.Result> hands)
        {
            int n = hands.Count;
            if (n == 0) return;
            var dbl = hands.Where(h => h.Doubled == 1).ToList();
            var rdbl = hands.Where(h => h.Doubled == 2).ToList();
            TestContext.WriteLine(
                $"  {label}：打成率 {100.0 * hands.Count(h => h.Made) / n:F1}%，平均每局 {hands.Average(h => h.Points):F1} 分，" +
                $"重發 {hands.Sum(h => h.Redeals)} 次｜加倍 {dbl.Count} 局（倒約 {dbl.Count(h => !h.Made)}）" +
                $"｜再加倍 {rdbl.Count} 局（打成 {rdbl.Count(h => h.Made)}）");
        }

        [Test]
        public void Simulate_5000Games_AI()
        {
            var hands = new List<GameSimulator.Result>();
            RunMany("AI 單局", EnvInt("HB_GAMES", 5000), seed => { hands.Add(GameSimulator.PlayOne(seed, Policy.AI)); return null; });
            Report("AI", hands);
        }

        [Test]
        public void Simulate_5000Games_Random()
        {
            var hands = new List<GameSimulator.Result>();
            RunMany("隨機單局", EnvInt("HB_GAMES", 5000), seed => { hands.Add(GameSimulator.PlayOne(seed, Policy.Random)); return null; });
            Report("隨機", hands);
            Assert.That(hands.Count(h => h.Doubled == 1), Is.GreaterThan(0), "隨機策略應該要跑到加倍");
            Assert.That(hands.Count(h => h.Doubled == 2), Is.GreaterThan(0), "隨機策略應該要跑到再加倍");
        }

        [Test]
        public void Simulate_500Matches_AI()
        {
            var matches = new List<GameSimulator.MatchResult>();
            RunMany("AI 整場", EnvInt("HB_MATCHES", 500), seed => { matches.Add(GameSimulator.PlayMatch(seed, Policy.AI)); return null; });
            if (matches.Count > 0)
                TestContext.WriteLine($"  平均一場 {matches.Average(m => m.Hands.Count):F1} 局，" +
                                      $"最長 {matches.Max(m => m.Hands.Count)} 局；座位 0 贏 {matches.Count(m => m.Winner == 0)} 場");
            Report("AI 整場內的每一局", matches.SelectMany(m => m.Hands).ToList());
        }

        [Test]
        public void Simulate_500Matches_Random()
        {
            var matches = new List<GameSimulator.MatchResult>();
            RunMany("隨機整場", EnvInt("HB_MATCHES", 500), seed => { matches.Add(GameSimulator.PlayMatch(seed, Policy.Random)); return null; });
            if (matches.Count > 0)
                TestContext.WriteLine($"  平均一場 {matches.Average(m => m.Hands.Count):F1} 局");
        }

        [Test]
        public void ReplaySeed()
        {
            var v = Environment.GetEnvironmentVariable("HB_SEED");
            if (!int.TryParse(v, out var seed))
            {
                Assert.Ignore("沒有設定 HB_SEED，略過。用法：HB_SEED=123 HB_POLICY=Random dotnet test tools/LogicTests --filter ReplaySeed");
                return;
            }
            var policy = string.Equals(Environment.GetEnvironmentVariable("HB_POLICY"), "Random", StringComparison.OrdinalIgnoreCase)
                ? Policy.Random : Policy.AI;
            bool match = Environment.GetEnvironmentVariable("HB_MATCH") == "1";

            if (match)
            {
                var m = GameSimulator.PlayMatch(seed, policy);
                TestContext.WriteLine($"seed={seed} {policy} 整場：座位 {m.Winner} 贏，{m.Scores[0]} : {m.Scores[1]}，共 {m.Hands.Count} 局");
                foreach (var h in m.Hands)
                    TestContext.WriteLine($"  莊家 {h.Declarer} 拿 {h.TricksTaken}/{h.TricksNeeded}，加倍 {h.Doubled}，座位 {h.Scorer} +{h.Points}");
            }
            else
            {
                var r = GameSimulator.PlayOne(seed, policy);
                TestContext.WriteLine($"seed={seed} {policy}：莊家 {r.Declarer}，拿 {r.TricksTaken}/{r.TricksNeeded} 墩，" +
                                      $"加倍 {r.Doubled}，座位 {r.Scorer} +{r.Points}，重發 {r.Redeals} 次，{r.Steps} 步");
            }
        }
    }
}
