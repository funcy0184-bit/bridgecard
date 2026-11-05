using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace HoneymoonBridge.Tests
{
    // 大量電腦對打。每局的種子 = HB_BASE_SEED + 局號，失敗訊息會印出種子，方便重播。
    //
    // 可用環境變數調整：
    //   HB_GAMES=20000      跑幾局（預設 5000）
    //   HB_BASE_SEED=777    從哪個種子開始（預設 20261105，固定 → 每次跑結果一樣）
    //   HB_SEED=123         只重播這一局（給 ReplaySeed 用）
    public class SimulationTests
    {
        static int EnvInt(string name, int fallback)
        {
            var v = Environment.GetEnvironmentVariable(name);
            return int.TryParse(v, out var n) ? n : fallback;
        }

        [Test]
        public void Simulate_5000Games_AllInvariantsHold()
        {
            int games = EnvInt("HB_GAMES", 5000);
            int baseSeed = EnvInt("HB_BASE_SEED", 20261105);

            var failures = new List<string>();
            int made = 0, redeals = 0;
            for (int i = 0; i < games; i++)
            {
                int seed = baseSeed + i;
                try
                {
                    var r = GameSimulator.PlayOne(seed);
                    if (r.TricksTaken >= r.TricksNeeded) made++;
                    redeals += r.Redeals;
                }
                catch (Exception ex)
                {
                    // 非預期的例外（例如 NullReference）也要帶種子
                    failures.Add(ex is GameSimulator.InvariantViolation ? ex.Message : $"[seed={seed}] {ex}");
                    if (failures.Count >= 10) break;
                }
            }

            TestContext.WriteLine($"跑了 {games} 局（種子 {baseSeed}..{baseSeed + games - 1}）：" +
                                  $"打成率 {100.0 * made / games:F1}%，總重發 {redeals} 次");
            if (failures.Count > 0)
                Assert.Fail($"{failures.Count} 局失敗（最多列 10 局）：\n" + string.Join("\n\n", failures));
        }

        [Test]
        public void ReplaySeed()
        {
            var v = Environment.GetEnvironmentVariable("HB_SEED");
            if (!int.TryParse(v, out var seed))
            {
                Assert.Ignore("沒有設定 HB_SEED，略過。用法：HB_SEED=123 dotnet test tools/LogicTests --filter ReplaySeed");
                return;
            }
            var r = GameSimulator.PlayOne(seed);
            TestContext.WriteLine($"seed={seed}：莊家 {r.Declarer}，拿 {r.TricksTaken}/{r.TricksNeeded} 墩，重發 {r.Redeals} 次，{r.Steps} 步");
        }
    }
}
