using System;
using System.Collections;
using UnityEngine;

namespace HoneymoonBridge
{
    // 「莊家機台」：擁有真正的 HoneymoonGame，負責節奏（停頓、電腦思考）。
    // 單機時掛在 LocalTable 旁邊；連線時只有房主那台的 NetTable 會用它
    public class GameHost : MonoBehaviour
    {
        [Tooltip("兩張牌都出完後停多久再結算，讓玩家看清楚")]
        public float trickPause = 1.3f;
        [Tooltip("電腦出牌前的思考時間")]
        public float aiDelay = 0.7f;
        [Tooltip("-1 = 沒有電腦（連線模式），1 = 座位 1 由電腦控制")]
        public int aiSeat = -1;

        public HoneymoonGame Game { get; private set; }

        public event Action<int, TableState> StateFor;   // (座位, 那個座位看到的牌桌)
        public event Action<int, GameEvent> EventFor;    // (座位, 事件)

        bool running;

        public void Begin()
        {
            if (Game != null) Game.Emitted -= Route;
            Game = new HoneymoonGame();
            Game.Emitted += Route;
            NewHand();
        }

        void Route(GameEvent e, int to)
        {
            if (to < 0) { EventFor?.Invoke(0, e); EventFor?.Invoke(1, e); }
            else EventFor?.Invoke(to, e);
        }

        public void NewHand()
        {
            StopAllCoroutines();
            running = false;
            Game.StartNew();
            Push();
            Kick();
        }

        public void PlayCard(int seat, int cardId)
        {
            if (Game == null || running) return;
            if (Game.PlayCard(seat, Card.FromId(cardId))) { Push(); Kick(); }
        }

        public void SubmitBid(int seat, int bidIndex)
        {
            if (Game == null || running) return;
            Bid? b = bidIndex < 0 ? (Bid?)null : Bid.FromIndex(bidIndex);
            if (Game.MakeBid(seat, b)) { Push(); Kick(); }
        }

        void Kick()
        {
            if (!running) StartCoroutine(Advance());
        }

        // 一直推進到「輪到真人」或遊戲結束
        IEnumerator Advance()
        {
            running = true;
            while (true)
            {
                if (Game.TrickComplete)
                {
                    yield return new WaitForSeconds(trickPause);
                    Game.ResolveTrick();
                    Push();
                    continue;
                }
                if (Game.Phase == Phase.Finished) break;

                if (aiSeat >= 0 && Game.CurrentPlayer == aiSeat)
                {
                    yield return new WaitForSeconds(aiDelay);
                    if (Game.Phase == Phase.Bidding)
                        Game.MakeBid(aiSeat, SimpleAI.ChooseBid(Game, aiSeat));
                    else
                        Game.PlayCard(aiSeat, SimpleAI.ChooseCard(Game, aiSeat));
                    Push();
                    continue;
                }
                break;
            }
            running = false;
        }

        void Push()
        {
            StateFor?.Invoke(0, Game.ViewFor(0));
            StateFor?.Invoke(1, Game.ViewFor(1));
        }
    }
}
