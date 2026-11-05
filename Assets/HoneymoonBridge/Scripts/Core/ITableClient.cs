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
        void Bid(int bidIndex);      // -1 = Pass
        void RequestNewHand();
    }
}
