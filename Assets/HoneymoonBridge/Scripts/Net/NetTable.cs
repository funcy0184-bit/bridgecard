using System;
using Unity.Netcode;
using UnityEngine;

namespace HoneymoonBridge
{
    // 連線模式。房主（Host）= 0 號位，並且是唯一跑遊戲邏輯的人；朋友（Client）= 1 號位。
    // 朋友只能「請求」出牌 / 叫牌，房主檢查合法後才執行，再把各自能看的畫面傳回去。
    // 掛在場景裡一個有 NetworkObject 的物件上（in-scene placed，連線開始時會自動 spawn）
    [RequireComponent(typeof(GameHost))]
    public class NetTable : NetworkBehaviour, ITableClient
    {
        public event Action<TableState> StateChanged;
        public event Action<GameEvent> EventReceived;
        public event Action<string> StatusChanged;     // 給選單顯示「等朋友加入…」之類
        public string OppName => "朋友";
        public int MySeat => IsServer ? 0 : 1;

        const ulong NoGuest = ulong.MaxValue;
        GameHost host;
        ulong guestId = NoGuest;

        void Awake()
        {
            host = GetComponent<GameHost>();
        }

        public override void OnNetworkSpawn()
        {
            if (IsServer)
            {
                host.aiSeat = -1;            // 連線模式兩邊都是真人

                host.StateFor += OnHostState;
                host.EventFor += OnHostEvent;
                NetworkManager.OnClientDisconnectCallback += OnClientDisconnected;
                StatusChanged?.Invoke("房間開好了，等朋友輸入代碼加入…");
            }
            else
            {
                // 朋友這邊物件 spawn 好了才通知房主開局，避免 RPC 送到還沒準備好的人
                ReadyRpc();
            }
        }

        public override void OnNetworkDespawn()
        {
            if (IsServer)
            {
                host.StateFor -= OnHostState;
                host.EventFor -= OnHostEvent;
                if (NetworkManager != null)
                    NetworkManager.OnClientDisconnectCallback -= OnClientDisconnected;
            }
            guestId = NoGuest;
        }

        // ---------- 房主端 ----------

        [Rpc(SendTo.Server)]
        void ReadyRpc(RpcParams rpcParams = default)
        {
            if (guestId != NoGuest) return;          // 兩人桌，第三個人進來不理他
            guestId = rpcParams.Receive.SenderClientId;
            StatusChanged?.Invoke("朋友到了，發牌！");
            host.Begin();
        }

        void OnClientDisconnected(ulong id)
        {
            if (id != guestId) return;
            guestId = NoGuest;
            StatusChanged?.Invoke("朋友斷線了");
        }

        int SeatOf(ulong clientId)
        {
            if (clientId == NetworkManager.ServerClientId) return 0;
            if (clientId == guestId) return 1;
            return -1;
        }

        void OnHostState(int seat, TableState st)
        {
            if (seat == 0) StateChanged?.Invoke(st);
            else if (guestId != NoGuest)
                StateRpc(JsonUtility.ToJson(st), RpcTarget.Single(guestId, RpcTargetUse.Temp));
        }

        void OnHostEvent(int seat, GameEvent e)
        {
            if (seat == 0) EventReceived?.Invoke(e);
            else if (guestId != NoGuest)
                EventRpc(JsonUtility.ToJson(e), RpcTarget.Single(guestId, RpcTargetUse.Temp));
        }

        // ---------- 兩邊都會呼叫：畫面層的操作 ----------

        public void PlayCard(int cardId) => PlayCardRpc(cardId);
        public void Bid(int bidIndex) => BidRpc(bidIndex);
        public void RequestNewHand() => NewHandRpc();

        [Rpc(SendTo.Server)]
        void PlayCardRpc(int cardId, RpcParams rpcParams = default)
        {
            int seat = SeatOf(rpcParams.Receive.SenderClientId);
            if (seat >= 0) host.PlayCard(seat, cardId);      // 合不合法由 HoneymoonGame 判斷
        }

        [Rpc(SendTo.Server)]
        void BidRpc(int bidIndex, RpcParams rpcParams = default)
        {
            int seat = SeatOf(rpcParams.Receive.SenderClientId);
            if (seat >= 0) host.SubmitBid(seat, bidIndex);
        }

        [Rpc(SendTo.Server)]
        void NewHandRpc(RpcParams rpcParams = default)
        {
            if (host.Game != null && host.Game.Phase == Phase.Finished && guestId != NoGuest)
                host.NewHand();
        }

        // ---------- 朋友端：收畫面 ----------

        [Rpc(SendTo.SpecifiedInParams)]
        void StateRpc(string json, RpcParams rpcParams)
        {
            StateChanged?.Invoke(JsonUtility.FromJson<TableState>(json));
        }

        [Rpc(SendTo.SpecifiedInParams)]
        void EventRpc(string json, RpcParams rpcParams)
        {
            EventReceived?.Invoke(JsonUtility.FromJson<GameEvent>(json));
        }
    }
}
