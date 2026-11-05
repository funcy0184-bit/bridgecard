using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge
{
    // 畫面層：收「事件」放動畫，收「狀態」把牌桌畫對。
    // 事件一定比狀態先到 → 動畫可以先抓到牌在手上的位置，再讓狀態把它移走
    public class GameView : MonoBehaviour
    {
        [Header("Prefab")]
        [SerializeField] CardView cardPrefab;
        [SerializeField] Button bidButtonPrefab;   // 一顆 Button，底下有 TMP 文字

        [Header("牌桌位置")]
        [SerializeField] RectTransform handRoot;   // 掛 Horizontal Layout Group
        [SerializeField] RectTransform oppAnchor;  // 對手手牌的位置（牌從這裡飛出來）
        [SerializeField] RectTransform mySlot;     // 我出的牌停在這（不要掛 Layout Group）
        [SerializeField] RectTransform oppSlot;
        [SerializeField] RectTransform faceUpSlot;

        [Header("文字")]
        [SerializeField] TMP_Text statusText;
        [SerializeField] TMP_Text infoText;
        [SerializeField] TMP_Text oppCountText;
        [SerializeField] TMP_Text messageText;
        [SerializeField] TMP_Text memoText;
        [SerializeField] TextFX turnText;          // 「輪到你」

        [Header("叫牌")]
        [SerializeField] GameObject bidPanel;
        [SerializeField] Transform bidGridRoot;    // Grid Layout Group，固定 5 欄
        [SerializeField] Button passButton;

        [Header("其他")]
        [SerializeField] Button newHandButton;
        [SerializeField] FeedbackDirector fx;

        static readonly Color Red = new Color(0.72f, 0.14f, 0.23f);
        static readonly Color Ink = new Color(0.11f, 0.16f, 0.23f);

        ITableClient table;
        TableState state;
        readonly Dictionary<int, CardView> hand = new Dictionary<int, CardView>();
        readonly List<Button> bidButtons = new List<Button>();
        readonly Queue<string> log = new Queue<string>();
        CardView myPlayed, oppPlayed, faceUpView;
        float lockUntil;            // 送出操作後短暫鎖住點擊，等狀態回來（最多 1.5 秒，避免卡死）
        bool WaitingForServer => Time.time < lockUntil;
        bool wasMyTurn;

        void Awake()
        {
            for (int i = 0; i < 35; i++)
            {
                var bid = Bid.FromIndex(i);
                var b = Instantiate(bidButtonPrefab, bidGridRoot);
                var t = b.GetComponentInChildren<TMP_Text>();
                t.text = bid.ToString();
                t.color = bid.IsRed ? Red : Ink;
                int idx = i;
                b.onClick.AddListener(() => SendBid(idx));
                bidButtons.Add(b);
            }
            passButton.onClick.AddListener(() => SendBid(-1));
            newHandButton.onClick.AddListener(() => table?.RequestNewHand());
            bidPanel.SetActive(false);
            newHandButton.gameObject.SetActive(false);
        }

        public void Bind(ITableClient t)
        {
            if (table != null)
            {
                table.StateChanged -= OnState;
                table.EventReceived -= OnEvent;
            }
            table = t;
            table.StateChanged += OnState;
            table.EventReceived += OnEvent;
        }

        // ---------------- 事件：動畫 ----------------

        void OnEvent(GameEvent e)
        {
            int mySeat = table.MySeat;
            if (e.type == GameEventType.NewHand) ClearTable();   // 先清桌，這局第一行訊息才不會被一起清掉

            string line = EventText.Describe(e, mySeat, table.OppName);
            if (!string.IsNullOrEmpty(line))
            {
                log.Enqueue(line);
                while (log.Count > 3) log.Dequeue();
                messageText.text = string.Join("\n", log);
            }

            switch (e.type)
            {
                case GameEventType.CardPlayed:
                    FlyToSlot(e, mySeat);
                    break;
                case GameEventType.TrickWon:
                    CollectTrick(e, mySeat);
                    break;
                case GameEventType.FaceUpTaken:
                    TakeFaceUp(e.seat == mySeat);
                    break;
                case GameEventType.Illegal:
                    if (hand.TryGetValue(e.card, out var v)) v.Deny();
                    lockUntil = 0f;
                    break;
            }

            fx.Handle(e, state, mySeat, table.OppName);
        }

        void FlyToSlot(GameEvent e, int mySeat)
        {
            bool mine = e.seat == mySeat;
            var slot = mine ? mySlot : oppSlot;
            Vector3 from = mine && hand.TryGetValue(e.card, out var hv) ? hv.visual.position : oppAnchor.position;

            var v = Instantiate(cardPrefab, slot);
            v.Set(e.card);
            v.button.interactable = false;
            ((RectTransform)v.transform).anchoredPosition = Vector2.zero;
            v.visual.position = from;           // 只動 visual，落地後回到 (0,0)
            StartCoroutine(Land(v));

            if (mine) myPlayed = v; else oppPlayed = v;
        }

        IEnumerator Land(CardView v)
        {
            yield return Tween.Move(v.visual, v.transform.position, 0.28f, Ease.OutCubic);
            if (v) yield return Tween.Punch(v.visual, 0.15f, 0.25f);
        }

        void CollectTrick(GameEvent e, int mySeat)
        {
            var a = myPlayed; var b = oppPlayed;
            myPlayed = oppPlayed = null;            // 交給動畫，狀態更新不會再刪它們
            var winner = a != null && a.CardId == e.card ? a : b;
            Vector3 target = e.seat == mySeat ? handRoot.position : oppAnchor.position;
            StartCoroutine(CollectRoutine(a, b, winner, target));
        }

        IEnumerator CollectRoutine(CardView a, CardView b, CardView winner, Vector3 target)
        {
            if (winner)
            {
                winner.Glow();
                yield return Tween.Punch(winner.visual, 0.25f, 0.3f);
            }
            yield return new WaitForSeconds(0.2f);
            foreach (var v in new[] { a, b })
            {
                if (!v) continue;
                StartCoroutine(Tween.Move(v.visual, target, 0.35f, Ease.InCubic));
                StartCoroutine(Tween.Fade(v.Group, 0f, 0.35f));
            }
            yield return new WaitForSeconds(0.4f);
            if (a) Destroy(a.gameObject);
            if (b) Destroy(b.gameObject);
        }

        void TakeFaceUp(bool mine)
        {
            var v = faceUpView;
            faceUpView = null;
            if (!v) return;
            Vector3 target = mine ? handRoot.position : oppAnchor.position;
            StartCoroutine(FlyAway(v, target));
        }

        IEnumerator FlyAway(CardView v, Vector3 target)
        {
            v.Glow();
            StartCoroutine(Tween.Fade(v.Group, 0f, 0.45f));
            yield return Tween.Move(v.visual, target, 0.45f, Ease.InCubic);
            if (v) Destroy(v.gameObject);
        }

        void ClearTable()
        {
            foreach (var v in hand.Values) if (v) Destroy(v.gameObject);
            hand.Clear();
            foreach (var v in new[] { myPlayed, oppPlayed, faceUpView }) if (v) Destroy(v.gameObject);
            myPlayed = oppPlayed = faceUpView = null;
            log.Clear();
        }

        // ---------------- 狀態：把牌桌畫對 ----------------

        void OnState(TableState st)
        {
            state = st;
            lockUntil = 0f;
            RenderHand();
            RenderTrick();
            RenderFaceUp();
            RenderTexts();
            RenderBidding();
        }

        void RenderHand()
        {
            var inHand = new HashSet<int>(state.hand);
            foreach (var id in hand.Keys.ToList())
            {
                if (inHand.Contains(id)) continue;
                Destroy(hand[id].gameObject);
                hand.Remove(id);
            }

            var legal = new HashSet<int>(state.legal);
            bool canPlay = legal.Count > 0;

            for (int i = 0; i < state.hand.Length; i++)
            {
                int id = state.hand[i];
                if (!hand.TryGetValue(id, out var v))
                {
                    v = Instantiate(cardPrefab, handRoot);
                    v.Set(id);
                    v.button.onClick.AddListener(() => OnCardClick(id));
                    hand[id] = v;
                    v.Appear();
                }
                v.transform.SetSiblingIndex(i);
                v.SetPlayable(!canPlay || legal.Contains(id));
                v.SetLift(canPlay && legal.Contains(id));
            }
        }

        void RenderTrick()
        {
            bool iLed = state.leaderSeat == state.seat;
            SyncSlot(ref myPlayed, iLed ? state.leadCard : state.followCard, mySlot);
            SyncSlot(ref oppPlayed, iLed ? state.followCard : state.leadCard, oppSlot);
        }

        // 保險：如果事件漏了（例如斷線重連），直接照狀態把牌擺上去
        void SyncSlot(ref CardView v, int id, RectTransform slot)
        {
            if (v != null && v.CardId == id) return;
            if (v != null) { Destroy(v.gameObject); v = null; }
            if (id < 0) return;
            v = Instantiate(cardPrefab, slot);
            v.Set(id);
            v.button.interactable = false;
            ((RectTransform)v.transform).anchoredPosition = Vector2.zero;
        }

        void RenderFaceUp()
        {
            if (faceUpView != null && faceUpView.CardId == state.faceUp) return;
            if (faceUpView != null) { Destroy(faceUpView.gameObject); faceUpView = null; }
            if (state.faceUp < 0) return;

            var v = Instantiate(cardPrefab, faceUpSlot);
            v.button.interactable = false;
            ((RectTransform)v.transform).anchoredPosition = Vector2.zero;
            int id = state.faceUp;
            v.label.text = "";
            StartCoroutine(Tween.Flip(v.visual, () => v.Set(id), 0.35f));   // 翻開新的明牌
            faceUpView = v;
        }

        void RenderTexts()
        {
            string opp = table.OppName;
            oppCountText.text = $"{opp}：{state.oppCount} 張";

            statusText.text = state.Phase switch
            {
                Phase.Draw => "抽牌階段",
                Phase.Bidding => "叫牌階段",
                Phase.Play => "打牌階段",
                _ => "這局結束"
            };

            if (state.Phase == Phase.Draw)
                infoText.text = $"牌堆剩 {state.stockCount} 張";
            else if (state.highestBid >= 0 && state.declarer >= 0)
            {
                var b = Bid.FromIndex(state.highestBid);
                string who = state.declarer == state.seat ? "你" : opp;
                infoText.text = $"合約 {b}（{who}要 {b.TricksNeeded} 墩）\n你 {state.myTricks} · {opp} {state.oppTricks}";
            }
            else infoText.text = "";

            memoText.text = state.oppTakenFaceUp.Length > 0
                ? $"{opp}拿走的明牌：" + string.Join(" ", state.oppTakenFaceUp.Select(id => Card.FromId(id).ToRichText()))
                : $"{opp}拿走的明牌：還沒有";

            // 「輪到你」：只在剛輪到的那一刻彈一次，之後保持 Q 彈
            bool myTurn = state.IsMyTurn && state.Phase != Phase.Finished;
            turnText.gameObject.SetActive(myTurn);
            if (myTurn && !wasMyTurn) turnText.Play("輪到你", TextFXFlags.PopIn | TextFXFlags.Jelly);
            wasMyTurn = myTurn;

            newHandButton.gameObject.SetActive(state.Phase == Phase.Finished);
        }

        void RenderBidding()
        {
            bool bidding = state.Phase == Phase.Bidding;
            bidPanel.SetActive(bidding);
            bool myTurn = bidding && state.IsMyTurn;
            for (int i = 0; i < bidButtons.Count; i++)
                bidButtons[i].interactable = myTurn && i >= state.minBid;
            passButton.interactable = myTurn;
        }

        // ---------------- 玩家操作 ----------------

        void OnCardClick(int id)
        {
            if (state == null || WaitingForServer) return;
            if (state.legal.Length == 0) return;          // 不是你的回合
            if (!state.legal.Contains(id))
            {
                // 本地先擋下來，回饋更即時（連線時不用等一來一回）
                hand[id].Deny();
                fx.IllegalMove();
                return;
            }
            lockUntil = Time.time + 1.5f;
            table.PlayCard(id);
        }

        void SendBid(int index)
        {
            if (state == null || WaitingForServer || !state.IsMyTurn) return;
            lockUntil = Time.time + 1.5f;
            table.Bid(index);
        }
    }
}
