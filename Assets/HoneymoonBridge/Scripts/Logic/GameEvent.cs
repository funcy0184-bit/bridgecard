using System;

namespace HoneymoonBridge
{
    public enum GameEventType
    {
        NewHand,        // 新的一局
        CardPlayed,     // seat 出了 card；value=1 代表目前這張最大；extra=1 代表王吃
        TrickWon,       // seat 贏墩；card=贏的那張；value=打牌階段的累計墩數（抽牌階段為 -1）；extra=1 代表王吃
        FaceUpTaken,    // seat 拿走明牌 card
        CardDrawn,      // seat 摸暗牌；只有本人收到的版本 card 才有值，對手收到 card=-1
        DrawPhaseOver,  // 牌堆抽完
        BidMade,        // seat 叫了 value（叫品編號）
        Passed,         // seat Pass
        ContractSet,    // seat 是莊家，value=叫品編號
        GameOver,       // seat=莊家，value=拿到墩數，extra=需要墩數
        Illegal,        // seat 出了不合法的牌（只傳給本人）
        Redeal          // 雙方都 Pass，重發
    }

    // 遊戲發生的每件事都包成一個事件。
    // 畫面層靠它決定要放什麼動畫、跳什麼字；連線時也是直接把它轉成 JSON 傳過去
    [Serializable]
    public class GameEvent
    {
        public GameEventType type;
        public int seat = -1;
        public int card = -1;
        public int value = -1;
        public int extra = -1;

        public GameEvent() { }   // JsonUtility 需要

        public GameEvent(GameEventType type, int seat = -1, int card = -1, int value = -1, int extra = -1)
        {
            this.type = type; this.seat = seat; this.card = card; this.value = value; this.extra = extra;
        }
    }
}
