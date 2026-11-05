using System;
using System.Collections.Generic;

namespace HoneymoonBridge
{
    // 叫牌動作編成一個整數：0..34 = 叫品（Bid.Index），負數是特殊叫。連線時只傳這個數字
    public static class Call
    {
        public const int Pass = -1;
        public const int Double = -2;     // 加倍：防守方對目前的合約
        public const int Redouble = -3;   // 再加倍：莊家回應對方的加倍

        public static bool IsBid(int c) => c >= 0 && c < 35;

        public static string Text(int c) => c switch
        {
            Pass => "Pass",
            Double => "加倍",
            Redouble => "再加倍",
            _ => IsBid(c) ? Bid.FromIndex(c).ToString() : "?"
        };
    }

    // 一局打完的計分明細。[Serializable] → 可以直接放進 TableState 用 JSON 傳給朋友
    [Serializable]
    public class HandResult
    {
        public int handNumber;          // 第幾局（重發不算）
        public int declarer = -1;
        public int bidIndex = -1;
        public int doubled;             // 0 = 沒加倍，1 = 加倍，2 = 再加倍
        public int tricksNeeded;
        public int tricksTaken;
        public bool made;
        public int overtricks;          // 超墩數（打成才有）
        public int undertricks;         // 倒墩數（倒約才有）
        public int contractPoints;      // 打成：線數 × 10 × 倍率
        public int overtrickPoints;     // 打成：超墩 × 2（不受加倍影響）
        public int penaltyPoints;       // 倒約：倒墩 × 10 × 倍率
        public int scorer = -1;         // 這局誰得分（只有一方得分）
        public int points;              // 得了幾分

        public Bid Contract => Bid.FromIndex(bidIndex);
    }

    // 第一版簡化計分（規格見 docs/SPEC.md）：
    //   打成：莊家得「線數 × 10 × 倍率」+ 每超 1 墩 2 分
    //   倒約：防守方每倒 1 墩得「10 × 倍率」
    //   倍率：沒加倍 ×1、加倍 ×2、再加倍 ×4
    public static class Scoring
    {
        public const int PerLevel = 10;
        public const int PerOvertrick = 2;
        public const int PerUndertrick = 10;
        public const int DefaultTarget = 100;

        public static int Multiplier(int doubled) => doubled >= 2 ? 4 : doubled == 1 ? 2 : 1;

        // 打成時的合約分（不含超墩）
        public static int MadePoints(Bid b, int doubled) => b.Level * PerLevel * Multiplier(doubled);

        // 每倒 1 墩，防守方得幾分
        public static int PointsPerUndertrick(int doubled) => PerUndertrick * Multiplier(doubled);

        public static HandResult Score(Bid contract, int doubled, int declarer, int tricksTaken)
        {
            var r = new HandResult
            {
                declarer = declarer,
                bidIndex = contract.Index,
                doubled = doubled,
                tricksNeeded = contract.TricksNeeded,
                tricksTaken = tricksTaken,
                made = tricksTaken >= contract.TricksNeeded
            };
            if (r.made)
            {
                r.overtricks = tricksTaken - r.tricksNeeded;
                r.contractPoints = MadePoints(contract, doubled);
                r.overtrickPoints = r.overtricks * PerOvertrick;
                r.scorer = declarer;
                r.points = r.contractPoints + r.overtrickPoints;
            }
            else
            {
                r.undertricks = r.tricksNeeded - tricksTaken;
                r.penaltyPoints = r.undertricks * PointsPerUndertrick(doubled);
                r.scorer = 1 - declarer;
                r.points = r.penaltyPoints;
            }
            return r;
        }

        // ---------------- 給畫面用的文字（放在 Logic 才能被測試，也讓教學共用） ----------------

        public static string DoubledText(int doubled) => doubled >= 2 ? "再加倍" : doubled == 1 ? "加倍" : "";

        // 「3♥」「3♥ 加倍」「3♥ 再加倍」
        public static string ContractText(Bid b, int doubled) =>
            doubled > 0 ? $"{b} {DoubledText(doubled)}" : b.ToString();

        // 我當莊家：「目標 9 墩｜打成 60 分｜每倒 1 墩對手得 20 分」
        public static string DeclarerPreview(Bid b, int doubled) =>
            $"目標 {b.TricksNeeded} 墩｜打成 {MadePoints(b, doubled)} 分｜每倒 1 墩對手得 {PointsPerUndertrick(doubled)} 分";

        // 對手當莊家：「電腦目標 9 墩｜打成電腦得 60 分｜每倒 1 墩你得 20 分」
        public static string DefenderPreview(Bid b, int doubled, string declarerName) =>
            $"{declarerName}目標 {b.TricksNeeded} 墩｜打成{declarerName}得 {MadePoints(b, doubled)} 分｜每倒 1 墩你得 {PointsPerUndertrick(doubled)} 分";

        // 局末計分明細，一行一個項目
        public static List<string> Breakdown(HandResult r, int mySeat, string oppName)
        {
            string Name(int seat) => seat == mySeat ? "你" : oppName;
            var b = r.Contract;
            int mult = Multiplier(r.doubled);
            string multText = mult > 1 ? $" × {mult}" : "";

            var lines = new List<string>
            {
                $"合約 {ContractText(b, r.doubled)}（{Name(r.declarer)}是莊家）",
                r.made
                    ? $"需要 {r.tricksNeeded} 墩，拿到 {r.tricksTaken} 墩 → 打成" + (r.overtricks > 0 ? $"，超 {r.overtricks} 墩" : "")
                    : $"需要 {r.tricksNeeded} 墩，拿到 {r.tricksTaken} 墩 → 倒 {r.undertricks} 墩"
            };
            if (r.made)
            {
                lines.Add($"合約分：{b.Level} 線 × {PerLevel}{multText} = {r.contractPoints}");
                if (r.overtricks > 0)
                    lines.Add($"超墩分：{r.overtricks} 墩 × {PerOvertrick} = {r.overtrickPoints}");
            }
            else
            {
                lines.Add($"倒約分：{r.undertricks} 墩 × {PerUndertrick}{multText} = {r.penaltyPoints}");
            }
            lines.Add($"{Name(r.scorer)} +{r.points} 分");
            return lines;
        }
    }
}
