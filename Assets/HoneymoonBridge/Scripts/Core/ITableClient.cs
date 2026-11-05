using System;

namespace HoneymoonBridge
{
    // 畫面層只認這個介面：不管是單機對電腦還是連線對朋友，GameView 的程式碼都一樣
    public interface ITableClient
    {
        event Action<TableState> StateChanged;
        event Action<GameEvent> EventReceived;

        string OppName { get; }
        int MySeat { get; }          // 單機永遠是 0；連線時房主 0、朋友 1

        void PlayCard(int cardId);
        void Bid(int call);          // 0..34 叫品；Call.Pass(-1)、Call.Double(-2)、Call.Redouble(-3)
        void RequestNewHand();       // 局末「下一局」；整場結束時是「再來一場」
    }
}
