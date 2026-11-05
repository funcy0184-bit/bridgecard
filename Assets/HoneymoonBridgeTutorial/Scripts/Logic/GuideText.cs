using System.Collections.Generic;

namespace HoneymoonBridge.Tutorial
{
    // 「遊戲介紹」的三頁內容。計分範例的數字直接呼叫正式的 Scoring 算，規則改了這裡會自動跟著變。
    public static class GuideText
    {
        public static readonly string[] PageTitles = { "玩法簡介", "規則速查", "計分範例" };

        public static string Page(int index)
        {
            switch (index)
            {
                case 0: return Overview;
                case 1: return QuickRules;
                default: return ScoringExamples();
            }
        }

        public const string Overview =
            "<b>蜜月橋牌是兩個人玩的橋牌</b>，一局分成三段：\n\n" +
            "<b>1. 抽牌</b>：每人先拿 13 張，剩下 26 張疊成牌堆，最上面翻開一張（明牌）。" +
            "兩人輪流比大小，<b>贏的人拿明牌，輸的人摸一張暗牌</b>。抽完 13 墩，牌堆就沒了。\n\n" +
            "<b>2. 叫牌</b>：看著手牌喊出「我要拿幾墩、哪一門當王」。叫得越高，賭得越大。" +
            "覺得對手打不成，可以<b>加倍</b>。\n\n" +
            "<b>3. 打牌</b>：13 墩決勝負。叫到合約的人（莊家）拿到目標墩數就打成，沒拿到就倒約。\n\n" +
            "每局得分累計，<b>先到 100 分的人贏得整場</b>。";

        public const string QuickRules =
            "<b>比大小</b>：A 最大，2 最小。同一門才比大小，墊別門的牌永遠贏不了。\n" +
            "<b>跟牌</b>：手上有首引的花色就<b>一定要跟</b>；沒有（缺門）才可以墊牌或出王。\n" +
            "<b>王牌</b>：合約那一門就是王。再小的王牌也比別門的 A 大。無王（NT）就沒有王。\n" +
            "<b>抽牌階段</b>：全程無王，這 13 墩不計分，只決定誰拿明牌。\n" +
            "<b>叫品大小</b>：由小到大 ♣ → ♦ → ♥ → ♠ → 無王，然後才是下一線。叫 N 線要拿 N + 6 墩。\n" +
            "<b>叫牌結束</b>：雙方起手都 Pass → 重發。有人叫了之後，只要一方 Pass 就定約。\n" +
            "<b>加倍</b>：防守方可以對目前的合約加倍；被加倍的莊家可以再加倍。有人蓋叫，加倍就清掉。\n" +
            "<b>首攻</b>：定約後由<b>不是莊家</b>的人先出。";

        public static string ScoringExamples()
        {
            var lines = new List<string>
            {
                $"<b>打成</b>：莊家得「線數 × {Scoring.PerLevel} × 倍率」，每多拿 1 墩再 +{Scoring.PerOvertrick}",
                $"<b>倒約</b>：每少 1 墩，防守方得「{Scoring.PerUndertrick} × 倍率」",
                "<b>倍率</b>：沒加倍 ×1、加倍 ×2、再加倍 ×4（超墩分不乘倍率）",
                ""
            };
            lines.Add(Example("2♥ 剛好拿 8 墩", new Bid(2, Strain.Hearts), 0, 8));
            lines.Add(Example("2♥ 拿 10 墩", new Bid(2, Strain.Hearts), 0, 10));
            lines.Add(Example("3♥ 加倍拿 10 墩", new Bid(3, Strain.Hearts), 1, 10));
            lines.Add(Example("3♥ 加倍只拿 8 墩", new Bid(3, Strain.Hearts), 1, 8));
            lines.Add(Example("4♠ 再加倍拿 10 墩", new Bid(4, Strain.Spades), 2, 10));
            return string.Join("\n", lines);
        }

        // 例：「3♥ 加倍拿 10 墩 → 莊家 +62（60 + 超墩 2）」
        public static string Example(string label, Bid b, int doubled, int taken)
        {
            var r = Scoring.Score(b, doubled, declarer: 0, tricksTaken: taken);
            string detail = r.made
                ? (r.overtricks > 0 ? $"（{r.contractPoints} + 超墩 {r.overtrickPoints}）" : "")
                : $"（倒 {r.undertricks} 墩）";
            return $"{label} → {(r.made ? "莊家" : "防守方")} +{r.points}{detail}";
        }
    }
}
