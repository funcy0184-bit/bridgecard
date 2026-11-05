using System;
using System.Threading.Tasks;
using TMPro;
using Unity.Netcode;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Multiplayer;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge.Tutorial
{
    // 教學版的總控：主選單 ↔ 人機對戰／開房連線／章節教學 ↔ 暫停。
    // 牌桌本身完全沿用原版（GameView、GameHost、LocalTable、NetTable、FeedbackDirector），
    // 這裡只負責切換要接哪一個 ITableClient，以及套用教學版自己的設定。
    public class TutorialApp : MonoBehaviour
    {
        [Header("原版牌桌（直接沿用）")]
        [SerializeField] GameView view;
        [SerializeField] GameHost host;
        [SerializeField] LocalTable localTable;
        [SerializeField] NetTable netTable;

        [Header("教學版")]
        [SerializeField] TutorialTable tutorialTable;
        [SerializeField] TutorialDirector director;
        [SerializeField] CoachPanel coach;
        [SerializeField] ShakeGate shakeGate;
        [SerializeField] TutorialMenu menu;

        [Header("牌桌上的按鈕")]
        [SerializeField] Button pauseButton;
        [SerializeField] Button hintToggle;

        public enum Mode { Menu, Solo, Challenge, Online, Lesson }

        public TutorialSettings Settings { get; private set; }
        public Mode Current { get; private set; } = Mode.Menu;
        public bool Paused { get; private set; }

        ISession session;
        bool challengeMarked;

        void Awake()
        {
            Settings = new TutorialSettings(new PlayerPrefsStore());
        }

        void Start()
        {
            Settings.Changed += Apply;
            coach.Init(Settings);
            director.Init(Settings);
            director.ChapterCompleted += n => { ToMenuState(); menu.ShowChapters(); };
            menu.Init(this);

            pauseButton.onClick.AddListener(Pause);
            hintToggle.onClick.AddListener(() => Settings.Hints = !Settings.Hints);

            netTable.StatusChanged += s => menu.SetBattleStatus(s);
            netTable.StateChanged += _ => { if (Current == Mode.Online && !Paused) menu.HideAll(); };
            localTable.StateChanged += OnLocalState;

            ToMenuState();
            menu.ShowMain();
        }

        // ---------------- 設定 ----------------

        void Apply()
        {
            // 動畫速度 = Time.timeScale：原版所有動畫、停頓、電腦思考時間都會一起變快變慢
            bool freeze = Paused && Current != Mode.Online;   // 連線時對方還在打，不能停時間
            Time.timeScale = freeze ? 0f : Settings.AnimSpeed;
            shakeGate.allowShake = Settings.ScreenShake;
            SetLabel(hintToggle, Settings.Hints ? "提示：開" : "提示：關");
            coach.Refresh();
            menu.RefreshLabels();
        }

        void SetTableButtons(bool on, bool hintsAvailable)
        {
            pauseButton.gameObject.SetActive(on);
            hintToggle.gameObject.SetActive(on && hintsAvailable);
        }

        // ---------------- 進入各模式 ----------------

        public void StartSolo() => StartLocal(Mode.Solo);

        // 第五章：跟簡單電腦打完整的一局（就是正式的人機對戰 + 白話提示）
        public void StartChallenge() => StartLocal(Mode.Challenge);

        void StartLocal(Mode mode)
        {
            StopEverything();
            Current = mode;
            challengeMarked = false;
            menu.HideAll();
            view.Bind(localTable);
            coach.Bind(localTable, showHints: true);
            SetTableButtons(true, hintsAvailable: true);
            Apply();
            localTable.StartGame();
        }

        public void StartChapter(int number)
        {
            var ch = TutorialCatalog.Get(number);
            if (ch.IsFreePlay) { StartChallenge(); return; }
            StopEverything();
            Current = Mode.Lesson;
            menu.HideAll();
            view.Bind(tutorialTable);
            coach.Bind(null, showHints: false);   // 關卡有自己的說明框
            SetTableButtons(true, hintsAvailable: false);
            Apply();
            director.StartChapter(ch);
        }

        void OnLocalState(TableState st)
        {
            if (Current != Mode.Challenge || challengeMarked || !st.hasResult) return;
            challengeMarked = true;
            Settings.MarkChapterDone(5);     // 打完一局就算完成；結算面板可以直接「下一局」繼續累計
        }

        // ---------------- 連線（流程跟原版 SessionMenu 一樣） ----------------

        public async void StartHost()
        {
            menu.SetBattleBusy(true);
            menu.SetBattleStatus("開房間中…");
            try
            {
                await SignInAsync();
                PrepareOnline();
                var options = new SessionOptions { MaxPlayers = 2, IsPrivate = true }.WithRelayNetwork();
                session = await MultiplayerService.Instance.CreateSessionAsync(options);
                menu.SetBattleStatus($"房間代碼：<b>{session.Code}</b>\n傳給朋友，等他加入");
            }
            catch (Exception e)
            {
                menu.SetBattleStatus("開房失敗：" + e.Message);
                menu.SetBattleBusy(false);
                Current = Mode.Menu;
            }
        }

        public async void StartJoin(string rawCode)
        {
            string code = (rawCode ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(code)) { menu.SetBattleStatus("先輸入朋友給你的代碼"); return; }
            menu.SetBattleBusy(true);
            menu.SetBattleStatus("加入中…");
            try
            {
                await SignInAsync();
                PrepareOnline();
                session = await MultiplayerService.Instance.JoinSessionByCodeAsync(code);
                menu.SetBattleStatus("連上了，等房主發牌…");
            }
            catch (Exception e)
            {
                menu.SetBattleStatus("加入失敗：" + e.Message);
                menu.SetBattleBusy(false);
                Current = Mode.Menu;
            }
        }

        void PrepareOnline()
        {
            StopEverything();
            Current = Mode.Online;
            view.Bind(netTable);
            coach.Bind(netTable, showHints: true);
            SetTableButtons(true, hintsAvailable: true);
            Apply();
        }

        static async Task SignInAsync()
        {
            if (UnityServices.State != ServicesInitializationState.Initialized)
            {
                var options = new InitializationOptions();
#if UNITY_EDITOR
                // 同一台電腦開兩個視窗測試時，讓兩邊用不同的匿名帳號
                options.SetProfile("t" + UnityEngine.Random.Range(0, 100000));
#endif
                await UnityServices.InitializeAsync(options);
            }
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
        }

        async void LeaveOnline()
        {
            var s = session;
            session = null;
            if (NetworkManager.Singleton != null && NetworkManager.Singleton.IsListening)
                NetworkManager.Singleton.Shutdown();
            if (s != null)
            {
                try { await s.LeaveAsync(); } catch { /* 離房失敗就算了 */ }
            }
        }

        // 「開始對戰」面板按返回：開了房間還沒開打的話，要把房間關掉
        public void LeaveBattleMenu()
        {
            if (Current == Mode.Online || session != null) ReturnToMenu();
            else menu.ShowMain();
        }

        // ---------------- 暫停／回主選單 ----------------

        public void Pause()
        {
            if (Current == Mode.Menu) return;
            Paused = true;
            Apply();
            menu.ShowPause();
        }

        public void Resume()
        {
            Paused = false;
            Apply();
            menu.HideAll();
        }

        public void ReturnToMenu()
        {
            StopEverything();
            ToMenuState();
            menu.ShowMain();
        }

        void ToMenuState()
        {
            Current = Mode.Menu;
            Paused = false;
            SetTableButtons(false, false);
            menu.SetBattleBusy(false);
            Apply();
        }

        void StopEverything()
        {
            Paused = false;
            host.StopAllCoroutines();   // 電腦思考到一半的也停掉；下次 Begin() 會重設
            director.Stop();
            tutorialTable.Stop();
            coach.Bind(null, false);
            if (Current == Mode.Online || session != null) LeaveOnline();
        }

        void OnDestroy()
        {
            Time.timeScale = 1f;
            if (session != null) LeaveOnline();
        }

        static void SetLabel(Button b, string text)
        {
            var t = b.GetComponentInChildren<TMP_Text>();
            if (t) t.text = text;
        }
    }
}
