using System;

namespace HoneymoonBridge
{
    // 把事件翻成「從我的角度」看的一句話，放在訊息欄
    public static class EventText
    {
        public static string Describe(GameEvent e, int mySeat, string oppName)
        {
            bool me = e.seat == mySeat;
            string who = me ? "你" : oppName;
            string card = e.card >= 0 ? Card.FromId(e.card).ToRichText() : "";

            switch (e.type)
            {
                case GameEventType.NewHand:
                    return $"第 {e.value} 局開始，" + (me ? "你先出" : $"{oppName}先出");
                case GameEventType.CardPlayed:
                    return e.extra == 1 ? $"{who}用王牌 {card} 吃！" : $"{who}出了 {card}";
                case GameEventType.TrickWon:
                    return e.value < 0 ? "" : $"{who}贏下這墩";
                case GameEventType.FaceUpTaken:
                    return $"{who}拿走明牌 {card}";
                case GameEventType.CardDrawn:
                    return me ? $"你摸到 {card}" : $"{oppName}摸了一張暗牌";
                case GameEventType.DrawPhaseOver:
                    return me ? "牌堆抽完，你先叫" : $"牌堆抽完，{oppName}先叫";
                case GameEventType.BidMade:
                    return $"{who}叫 {Bid.FromIndex(e.value)}";
                case GameEventType.Passed:
                    return $"{who} Pass";
                case GameEventType.Doubled:
                    return $"{who}加倍！";
                case GameEventType.Redoubled:
                    return $"{who}再加倍！";
                case GameEventType.ContractSet:
                {
                    var b = Bid.FromIndex(e.value);
                    return $"合約 {Scoring.ContractText(b, Math.Max(0, e.extra))}，{who}要拿 {b.TricksNeeded} 墩";
                }
                case GameEventType.GameOver:
                    return e.value >= e.extra
                        ? $"{who}拿到 {e.value} 墩，合約打成！"
                        : $"{who}只拿 {e.value} 墩，倒了 {e.extra - e.value} 墩";
                case GameEventType.Illegal:
                    return "手上還有領出的花色，要先跟";
                case GameEventType.Redeal:
                    return "雙方都 Pass，重新發牌（分數不變）";
                case GameEventType.HandScored:
                    return $"{who} +{e.value} 分（累計 {e.extra} 分）";
                case GameEventType.MatchOver:
                    return $"{who}先到 {e.value} 分，贏得整場！";
                default:
                    return "";
            }
        }
    }
}
