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
        [SerializeField] GameObject faceUpLabel;   // 「明牌」兩個字，抽牌階段才顯示

        [Header("文字")]
        [SerializeField] TMP_Text statusText;
        [SerializeField] TMP_Text infoText;
        [SerializeField] TMP_Text scoreText;       // 「第 3 局｜你 42 · 電腦 18｜先到 100 分」
        [SerializeField] TMP_Text oppCountText;
        [SerializeField] TMP_Text messageText;
        [SerializeField] TMP_Text memoText;
        [SerializeField] TextFX turnText;          // 「輪到你」

        [Header("叫牌")]
        [SerializeField] GameObject bidPanel;
        [SerializeField] Transform bidGridRoot;    // Grid Layout Group，固定 5 欄
        [SerializeField] TMP_Text bidContractText; // 「目前：電腦 2♠ 加倍」
        [SerializeField] TMP_Text bidPreviewText;  // 「目標 9 墩｜打成 60 分｜每倒 1 墩對手得 20 分」
        [SerializeField] Button confirmBidButton;  // 先點叫品選好，再按這顆送出（點同一顆叫品兩次也行）
        [SerializeField] Button passButton;
        [SerializeField] Button doubleButton;      // 加倍／再加倍共用一顆，字會自動換

        [Header("叫牌紀錄")]
        [SerializeField] GameObject auctionPanel;
        [SerializeField] TMP_Text auctionText;
        [SerializeField] Button auctionToggle;     // 打牌中收起／打開叫牌紀錄

        [Header("局末結算")]
        [SerializeField] GameObject resultPanel;
        [SerializeField] TextFX resultTitle;
        [SerializeField] TMP_Text resultBody;
        [SerializeField] Button newHandButton;     // 「下一局」／整場結束時「再來一場」
        [Tooltip("打完最後一墩後等多久才跳出結算面板（先讓「打成！」大字演完）")]
        [SerializeField] float resultDelay = 2.4f;

        [Header("其他")]
        [SerializeField] FeedbackDirector fx;

        static readonly Color Red = new Color(0.72f, 0.14f, 0.23f);
        static readonly Color Ink = new Color(0.11f, 0.16f, 0.23f);
        static readonly Color Gold = new Color(0.85f, 0.64f, 0.23f);
        static readonly Color FeltInk = new Color(0.91f, 0.95f, 0.93f);
        const string LightRed = "#F28B8B";   // 深綠底上的紅色花色
        const string GoldHex = "#D9A23A";

        ITableClient table;
        TableState state;
        readonly Dictionary<int, CardView> hand = new Dictionary<int, CardView>();
        readonly List<Button> bidButtons = new List<Button>();
        readonly List<Image> bidImages = new List<Image>();
        Color bidBaseColor = Color.white;
        readonly Queue<string> log = new Queue<string>();
        CardView myPlayed, oppPlayed, faceUpView;
        float lockUntil;            // 送出操作後短暫鎖住點擊，等狀態回來（最多 1.5 秒，避免卡死）
        bool WaitingForServer => Time.time < lockUntil;
        bool wasMyTurn;

        int selectedBid = -1;       // 叫牌面板上選中、還沒送出的叫品
        bool auctionCollapsed;      // 打牌中玩家自己收起了叫牌紀錄
        int shownResultHand = -1;   // 結算面板目前顯示（或排隊要顯示）的是第幾局
        Coroutine resultRoutine;

        string Opp => table != null ? table.OppName : "對手";
        string Name(int seat) => state != null && seat == state.seat ? "你" : Opp;

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
                b.onClick.AddListener(() => SelectBid(idx));
                bidButtons.Add(b);
                var img = b.targetGraphic as Image;
                bidImages.Add(img);
                if (img) bidBaseColor = img.color;
            }
            confirmBidButton.onClick.AddListener(ConfirmBid);
            passButton.onClick.AddListener(() => SendCall(Call.Pass));
            doubleButton.onClick.AddListener(() =>
            {
                if (state != null) SendCall(state.canRedouble ? Call.Redouble : Call.Double);
            });
            auctionToggle.onClick.AddListener(() =>
            {
                auctionCollapsed = !auctionCollapsed;
                if (state != null) RenderAuction();
            });
            newHandButton.onClick.AddListener(() =>
            {
                if (WaitingForServer) return;
                lockUntil = Time.time + 1.5f;
                table?.RequestNewHand();
            });
            bidPanel.SetActive(false);
            auctionPanel.SetActive(false);
            auctionToggle.gameObject.SetActive(false);
            resultPanel.SetActive(false);
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
            selectedBid = -1;
            HideResult();
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
            RenderAuction();
            RenderResult();
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
            faceUpLabel.SetActive(state.Phase == Phase.Draw);
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
            oppCountText.text = $"{Opp}：{state.oppCount} 張";

            // 叫牌時右側被叫牌面板蓋住，訊息改看左邊的叫牌紀錄
            messageText.gameObject.SetActive(state.Phase != Phase.Bidding);

            statusText.text = state.Phase switch
            {
                Phase.Draw => "抽牌階段",
                Phase.Bidding => "叫牌階段",
                Phase.Play => "打牌階段",
                _ => state.MatchOver ? "整場結束" : "這局結束"
            };

            scoreText.text = $"第 {state.handNumber} 局｜你 <b>{state.myScore}</b> · {Opp} <b>{state.oppScore}</b>｜先到 {state.targetScore} 分";

            if (state.Phase == Phase.Draw)
                infoText.text = $"牌堆剩 {state.stockCount} 張";
            else if (state.Phase == Phase.Bidding)
                infoText.text = "叫牌中｜" + CurrentContractLine();
            else if (state.highestBid >= 0 && state.declarer >= 0)
            {
                var b = Bid.FromIndex(state.highestBid);
                infoText.text = $"合約 {Scoring.ContractText(b, state.doubled)}（{Name(state.declarer)}要 {b.TricksNeeded} 墩）\n" +
                                $"你 {state.myTricks} · {Opp} {state.oppTricks}";
            }
            else infoText.text = "";

            memoText.text = state.oppTakenFaceUp.Length > 0
                ? $"{Opp}拿走的明牌：" + string.Join(" ", state.oppTakenFaceUp.Select(id => Card.FromId(id).ToRichText()))
                : $"{Opp}拿走的明牌：還沒有";

            // 「輪到你」：只在剛輪到的那一刻彈一次，之後保持 Q 彈
            bool myTurn = state.IsMyTurn && state.Phase != Phase.Finished;
            turnText.gameObject.SetActive(myTurn);
            if (myTurn && !wasMyTurn) turnText.Play("輪到你", TextFXFlags.PopIn | TextFXFlags.Jelly);
            wasMyTurn = myTurn;
        }

        string CurrentContractLine()
        {
            if (state.highestBid < 0) return "還沒有人叫牌";
            var b = Bid.FromIndex(state.highestBid);
            return $"目前 {Name(state.highestBidder)} {Scoring.ContractText(b, state.doubled)}";
        }

        // ---------------- 叫牌面板 ----------------

        bool MyBidTurn => state != null && state.Phase == Phase.Bidding && state.IsMyTurn;

        void RenderBidding()
        {
            bool bidding = state.Phase == Phase.Bidding;
            bidPanel.SetActive(bidding);
            if (!bidding) { selectedBid = -1; return; }

            bool myTurn = MyBidTurn;
            if (!myTurn || selectedBid < state.minBid) selectedBid = -1;

            for (int i = 0; i < bidButtons.Count; i++)
            {
                bidButtons[i].interactable = myTurn && i >= state.minBid;
                if (bidImages[i]) bidImages[i].color = i == selectedBid ? Gold : bidBaseColor;
            }

            passButton.interactable = myTurn;
            confirmBidButton.interactable = myTurn && selectedBid >= 0;
            SetLabel(confirmBidButton, selectedBid >= 0 ? $"叫 {Bid.FromIndex(selectedBid)}" : "叫");
            doubleButton.interactable = myTurn && (state.canDouble || state.canRedouble);
            SetLabel(doubleButton, state.canRedouble ? "再加倍" : "加倍");

            bidContractText.text = CurrentContractLine();
            bidPreviewText.text = BidPreview();
        }

        // 新手不用背公式：這裡直接算給你看這一叫押了多少
        string BidPreview()
        {
            Bid? cur = state.highestBid >= 0 ? Bid.FromIndex(state.highestBid) : (Bid?)null;

            if (!MyBidTurn)
            {
                string wait = $"等{Opp}叫牌…";
                if (!cur.HasValue) return wait;
                return wait + "\n" + (state.highestBidder == state.seat
                    ? Scoring.DeclarerPreview(cur.Value, state.doubled)
                    : Scoring.DefenderPreview(cur.Value, state.doubled, Opp));
            }

            if (selectedBid >= 0)
            {
                var b = Bid.FromIndex(selectedBid);
                return $"叫 {b}：{Scoring.DeclarerPreview(b, 0)}\n超墩每墩 +{Scoring.PerOvertrick} 分｜再點一次送出";
            }

            if (!cur.HasValue)
                return "點一個叫品，這裡會算給你看這局押多少分";

            var c = cur.Value;
            if (state.canRedouble)
                return $"{Opp}對你加倍了！\n再加倍 → {Scoring.DeclarerPreview(c, 2)}";
            if (state.canDouble)
                return $"{Scoring.DefenderPreview(c, state.doubled, Opp)}\n" +
                       $"加倍 → 打成{Opp}得 {Scoring.MadePoints(c, 1)} 分｜每倒 1 墩你得 {Scoring.PointsPerUndertrick(1)} 分";
            return state.highestBidder == state.seat
                ? Scoring.DeclarerPreview(c, state.doubled)
                : Scoring.DefenderPreview(c, state.doubled, Opp);
        }

        static void SetLabel(Button b, string text)
        {
            var t = b.GetComponentInChildren<TMP_Text>();
            if (t) t.text = text;
        }

        // ---------------- 叫牌紀錄 ----------------

        void RenderAuction()
        {
            bool bidding = state.Phase == Phase.Bidding;
            bool afterAuction = (state.Phase == Phase.Play || state.Phase == Phase.Finished) && state.auctionCalls.Length > 0;

            auctionToggle.gameObject.SetActive(afterAuction);
            if (afterAuction) SetLabel(auctionToggle, auctionCollapsed ? "叫牌紀錄" : "收起紀錄");

            bool show = bidding || (afterAuction && !auctionCollapsed);
            auctionPanel.SetActive(show);
            if (show) auctionText.text = AuctionLines();
        }

        const int MaxAuctionLines = 10;

        string AuctionLines()
        {
            var sb = new System.Text.StringBuilder("<b>叫牌紀錄</b>\n");
            int n = state.auctionCalls.Length;
            if (n == 0) return sb.Append("（還沒有人叫）").ToString();
            int start = Mathf.Max(0, n - MaxAuctionLines);
            if (start > 0) sb.Append("…\n");
            for (int i = start; i < n; i++)
                sb.Append($"{i + 1}. {Name(state.auctionSeats[i])}　{CallRich(state.auctionCalls[i])}\n");
            return sb.ToString().TrimEnd('\n');
        }

        static string CallRich(int call)
        {
            if (call == Call.Double || call == Call.Redouble)
                return $"<color={GoldHex}><b>{Call.Text(call)}</b></color>";
            if (Call.IsBid(call) && Bid.FromIndex(call).IsRed)
                return $"<color={LightRed}>{Call.Text(call)}</color>";
            return Call.Text(call);
        }

        // ---------------- 局末結算 ----------------

        void RenderResult()
        {
            if (state.Phase != Phase.Finished || !state.hasResult) { HideResult(); return; }
            if (shownResultHand == state.result.handNumber) return;   // 已經顯示或排隊中
            shownResultHand = state.result.handNumber;
            if (resultRoutine != null) StopCoroutine(resultRoutine);
            resultRoutine = StartCoroutine(ShowResultAfter(resultDelay));
        }

        void HideResult()
        {
            if (resultRoutine != null) { StopCoroutine(resultRoutine); resultRoutine = null; }
            resultPanel.SetActive(false);
            shownResultHand = -1;
        }

        IEnumerator ShowResultAfter(float delay)
        {
            yield return new WaitForSeconds(delay);
            resultRoutine = null;
            if (state == null || state.Phase != Phase.Finished || !state.hasResult) yield break;

            var r = state.result;
            bool matchOver = state.MatchOver;
            bool iWonMatch = state.matchWinner == state.seat;

            var titleText = resultTitle.GetComponent<TMP_Text>();
            string title;
            TextFXFlags flags = TextFXFlags.PopIn;
            if (!matchOver) { title = $"第 {r.handNumber} 局結算"; titleText.color = FeltInk; }
            else if (iWonMatch) { title = "你贏得整場！"; titleText.color = Gold; flags |= TextFXFlags.Wave; }
            else { title = $"{Opp}贏得整場"; titleText.color = FeltInk; }

            var lines = Scoring.Breakdown(r, state.seat, Opp);
            // 最後一行「你 +62 分」放大、上色
            string last = lines[lines.Count - 1];
            lines[lines.Count - 1] = r.scorer == state.seat
                ? $"<size=120%><color={GoldHex}><b>{last}</b></color></size>"
                : $"<size=120%><b>{last}</b></size>";

            lines.Add("");
            lines.Add($"總分　你 <b>{state.myScore}</b> · {Opp} <b>{state.oppScore}</b>（先到 {state.targetScore} 分）");
            lines.Add(matchOver
                ? $"共打了 {r.handNumber} 局"
                : $"你還差 {Mathf.Max(0, state.targetScore - state.myScore)} 分 · " +
                  $"{Opp}還差 {Mathf.Max(0, state.targetScore - state.oppScore)} 分");

            resultBody.text = string.Join("\n", lines);
            SetLabel(newHandButton, matchOver ? "再來一場" : "下一局");

            resultPanel.SetActive(true);
            var rt = resultPanel.transform;
            rt.localScale = Vector3.one * 0.85f;
            StartCoroutine(Tween.Scale(rt, Vector3.one, 0.3f, Ease.OutBack));
            resultTitle.Play(title, flags);
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

        void SelectBid(int index)
        {
            if (!MyBidTurn || WaitingForServer || index < state.minBid) return;
            if (selectedBid == index) { ConfirmBid(); return; }   // 同一顆點兩次 = 確定
            selectedBid = index;
            RenderBidding();
        }

        void ConfirmBid()
        {
            if (selectedBid >= 0) SendCall(selectedBid);
        }

        void SendCall(int call)
        {
            if (!MyBidTurn || WaitingForServer) return;
            selectedBid = -1;
            lockUntil = Time.time + 1.5f;
            table.Bid(call);
        }
    }
}
