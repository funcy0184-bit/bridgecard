using System;
using UnityEngine;

namespace HoneymoonBridge
{
    // 單機模式：你坐 0 號位，電腦坐 1 號位
    [RequireComponent(typeof(GameHost))]
    public class LocalTable : MonoBehaviour, ITableClient
    {
        public event Action<TableState> StateChanged;
        public event Action<GameEvent> EventReceived;
        public string OppName => "電腦";
        public int MySeat => 0;

        GameHost host;

        void Awake()
        {
            host = GetComponent<GameHost>();
        }

        bool active;   // 只有按了「單機」才轉發，連線模式時這支保持安靜

        public void StartGame()
        {
            if (!active)
            {
                active = true;
                host.StateFor += (seat, st) => { if (seat == 0) StateChanged?.Invoke(st); };
                host.EventFor += (seat, e) => { if (seat == 0) EventReceived?.Invoke(e); };
            }
            // 這行不能放 Awake：LocalTable 和 NetTable 掛在同一個物件上，
            // 兩邊的 Awake 誰先跑 Unity 不保證，放 Awake 會被 NetTable 蓋掉，電腦就永遠不出牌
            host.aiSeat = 1;
            host.Begin();
        }

        public void PlayCard(int cardId) => host.PlayCard(0, cardId);
        public void Bid(int bidIndex) => host.SubmitBid(0, bidIndex);
        public void RequestNewHand() => host.NewHand();
    }
}
