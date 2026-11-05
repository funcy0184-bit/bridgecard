namespace HoneymoonBridge.Tests
{
    static class TestUtil
    {
        // 用 AI 把抽牌階段打完，停在叫牌階段
        public static void FinishDrawPhase(HoneymoonGame g)
        {
            while (g.Phase == Phase.Draw)
            {
                if (g.TrickComplete) g.ResolveTrick();
                else g.PlayCard(g.CurrentPlayer, SimpleAI.ChooseCard(g, g.CurrentPlayer));
            }
        }

        // 用 AI 把打牌階段打完，停在這局結束
        public static void FinishPlayPhase(HoneymoonGame g)
        {
            while (g.Phase == Phase.Play)
            {
                if (g.TrickComplete) g.ResolveTrick();
                else g.PlayCard(g.CurrentPlayer, SimpleAI.ChooseCard(g, g.CurrentPlayer));
            }
        }

        // 從頭打完一整局：抽牌 → 指定的叫牌（先手叫 bid，對手 Pass）→ 打牌
        public static void PlayHandWithContract(HoneymoonGame g, Bid bid)
        {
            FinishDrawPhase(g);
            int p = g.CurrentPlayer;
            g.MakeCall(p, bid.Index);
            g.MakeCall(1 - p, Call.Pass);
            FinishPlayPhase(g);
        }
    }
}
