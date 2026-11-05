using System;
using System.Collections;
using UnityEngine;

namespace HoneymoonBridge.Tutorial
{
    // 教學關卡用的「牌桌」。實作原版的 ITableClient，所以原版的 GameView 直接就能畫它，
    // 翻牌、王吃震動、跳字全部跟正式對戰一樣。規則和題目檢查都交給 TutorialSession（純 C#）。
    public class TutorialTable : MonoBehaviour, ITableClient
    {
        [Tooltip("兩張牌都出完後停多久再結算（跟原版 GameHost 一樣）")]
        public float trickPause = 1.3f;
        [Tooltip("對手出牌、叫牌前的思考時間")]
        public float opponentDelay = 0.7f;

        public event Action<TableState> StateChanged;
        public event Action<GameEvent> EventReceived;
        public event Action<string> HintShown;              // 這題不收這個動作 → 給提示
        public event Action<LessonVerdict> LessonFinished;  // 這題結束（過關或要重來）
        public event Action NextRequested;                  // 玩家在結算面板按了「下一局」

        public string OppName => "電腦";
        public int MySeat => TutorialSession.Player;

        TutorialSession session;
        bool running, reported;

        public bool Active => session != null;

        public void Begin(Lesson lesson)
        {
            Stop();
            session = new TutorialSession(lesson);
            session.PlayerEvent += Forward;
            session.Start();
            reported = false;
            // 原版畫面靠 NewHand 事件清桌，所以每一題開始時補發一個
            EventReceived?.Invoke(new GameEvent(GameEventType.NewHand, session.Game.CurrentPlayer, value: 1));
            Push();
            Kick();
        }

        public void Stop()
        {
            StopAllCoroutines();
            running = false;
            if (session != null) session.PlayerEvent -= Forward;
            session = null;
        }

        void Forward(GameEvent e) => EventReceived?.Invoke(e);

        void Push()
        {
            if (session != null) StateChanged?.Invoke(session.Game.ViewFor(MySeat));
        }

        // ---------------- ITableClient：玩家的操作 ----------------

        public void PlayCard(int cardId)
        {
            if (session == null) return;
            if (running || session.Finished) { Push(); return; }
            string hint = session.TryPlay(Card.FromId(cardId));
            if (hint != null) HintShown?.Invoke(hint);
            Push();
            Kick();
        }

        public void Bid(int call)
        {
            if (session == null) return;
            if (running || session.Finished) { Push(); return; }
            string hint = session.TryCall(call);
            if (hint != null) HintShown?.Invoke(hint);
            Push();
            Kick();
        }

        public void RequestNewHand() => NextRequested?.Invoke();

        // ---------------- 節奏 ----------------

        void Kick()
        {
            if (!running && isActiveAndEnabled) StartCoroutine(Advance());
        }

        IEnumerator Advance()
        {
            running = true;
            while (session != null)
            {
                if (session.Finished)
                {
                    if (!reported) { reported = true; LessonFinished?.Invoke(session.Verdict); }
                    break;
                }
                if (session.NeedsResolve)
                {
                    yield return new WaitForSeconds(trickPause);
                    if (session == null) break;
                    session.Resolve();
                    Push();
                    continue;
                }
                if (session.OpponentToAct)
                {
                    yield return new WaitForSeconds(opponentDelay);
                    if (session == null) break;
                    session.OpponentAct();
                    Push();
                    continue;
                }
                break;   // 輪到玩家
            }
            running = false;
        }
    }
}
