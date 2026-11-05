using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge.Tutorial
{
    // 主選單和所有子畫面。一次只顯示一個面板；按鈕事件全部轉給 TutorialApp
    public class TutorialMenu : MonoBehaviour
    {
        [SerializeField] GameObject root;              // 半透明全螢幕底，蓋住牌桌
        [SerializeField] Button listButtonPrefab;      // 章節清單、分頁按鈕用

        [Header("主選單")]
        [SerializeField] GameObject mainPanel;
        [SerializeField] Button battleButton;
        [SerializeField] Button chaptersButton;
        [SerializeField] Button settingsButton;
        [SerializeField] Button guideButton;
        [SerializeField] TMP_Text progressText;

        [Header("開始對戰")]
        [SerializeField] GameObject battlePanel;
        [SerializeField] Button soloButton;
        [SerializeField] Button hostButton;
        [SerializeField] Button joinButton;
        [SerializeField] TMP_InputField codeInput;
        [SerializeField] TMP_Text battleStatus;
        [SerializeField] Button battleBack;

        [Header("章節教學")]
        [SerializeField] GameObject chaptersPanel;
        [SerializeField] Transform chapterList;        // Vertical Layout Group
        [SerializeField] Button chaptersBack;

        [Header("設定")]
        [SerializeField] GameObject settingsPanel;
        [SerializeField] Button speedButton;
        [SerializeField] Button shakeButton;
        [SerializeField] Button hintsButton;
        [SerializeField] Button resetProgressButton;
        [SerializeField] Button settingsBack;

        [Header("遊戲介紹")]
        [SerializeField] GameObject guidePanel;
        [SerializeField] Transform guideTabs;          // Horizontal Layout Group
        [SerializeField] TMP_Text guideBody;
        [SerializeField] Button guideBack;

        [Header("暫停")]
        [SerializeField] GameObject pausePanel;
        [SerializeField] Button resumeButton;
        [SerializeField] Button pauseGuideButton;
        [SerializeField] Button pauseSettingsButton;
        [SerializeField] Button pauseMenuButton;

        static readonly Color Gold = new Color(0.85f, 0.64f, 0.23f);
        static readonly Color Paper = new Color(0.97f, 0.98f, 0.97f);

        TutorialApp app;
        readonly List<Button> chapterButtons = new List<Button>();
        readonly List<Button> tabButtons = new List<Button>();
        GameObject[] panels;
        bool fromPause;        // 設定／遊戲介紹是從暫停打開的 → 返回時回暫停
        int guidePage;

        public void Init(TutorialApp a)
        {
            app = a;
            panels = new[] { mainPanel, battlePanel, chaptersPanel, settingsPanel, guidePanel, pausePanel };

            battleButton.onClick.AddListener(() => Show(battlePanel));
            chaptersButton.onClick.AddListener(ShowChapters);
            settingsButton.onClick.AddListener(() => { fromPause = false; Show(settingsPanel); });
            guideButton.onClick.AddListener(() => { fromPause = false; ShowGuide(0); });

            soloButton.onClick.AddListener(app.StartSolo);
            hostButton.onClick.AddListener(app.StartHost);
            joinButton.onClick.AddListener(() => app.StartJoin(codeInput.text));
            battleBack.onClick.AddListener(app.LeaveBattleMenu);

            foreach (var ch in TutorialCatalog.Chapters)
            {
                var b = Instantiate(listButtonPrefab, chapterList);
                int n = ch.Number;
                b.onClick.AddListener(() => app.StartChapter(n));
                chapterButtons.Add(b);
            }
            chaptersBack.onClick.AddListener(ShowMain);

            speedButton.onClick.AddListener(() =>
                app.Settings.AnimSpeedIndex = (app.Settings.AnimSpeedIndex + 1) % TutorialSettings.Speeds.Length);
            shakeButton.onClick.AddListener(() => app.Settings.ScreenShake = !app.Settings.ScreenShake);
            hintsButton.onClick.AddListener(() => app.Settings.Hints = !app.Settings.Hints);
            resetProgressButton.onClick.AddListener(() => app.Settings.ResetProgress());
            settingsBack.onClick.AddListener(Back);

            for (int i = 0; i < GuideText.PageTitles.Length; i++)
            {
                var b = Instantiate(listButtonPrefab, guideTabs);
                int page = i;
                SetLabel(b, GuideText.PageTitles[i]);
                b.onClick.AddListener(() => ShowGuide(page));
                tabButtons.Add(b);
            }
            guideBack.onClick.AddListener(Back);

            resumeButton.onClick.AddListener(app.Resume);
            pauseGuideButton.onClick.AddListener(() => { fromPause = true; ShowGuide(guidePage); });
            pauseSettingsButton.onClick.AddListener(() => { fromPause = true; Show(settingsPanel); });
            pauseMenuButton.onClick.AddListener(app.ReturnToMenu);

            RefreshLabels();
        }

        // ---------------- 顯示 ----------------

        void Show(GameObject panel)
        {
            root.SetActive(true);
            foreach (var p in panels) p.SetActive(p == panel);
            RefreshLabels();
        }

        public void HideAll()
        {
            foreach (var p in panels) p.SetActive(false);
            root.SetActive(false);
        }

        public void ShowMain() { fromPause = false; Show(mainPanel); }
        public void ShowChapters() => Show(chaptersPanel);
        public void ShowPause() => Show(pausePanel);

        void ShowGuide(int page)
        {
            guidePage = page;
            guideBody.text = GuideText.Page(page);
            for (int i = 0; i < tabButtons.Count; i++)
                if (tabButtons[i].targetGraphic is Image img) img.color = i == page ? Gold : Paper;
            Show(guidePanel);
        }

        void Back()
        {
            if (fromPause && app.Paused) Show(pausePanel);
            else ShowMain();
        }

        // ---------------- 文字 ----------------

        public void RefreshLabels()
        {
            if (app == null || app.Settings == null) return;
            var s = app.Settings;

            int done = s.ChaptersDone, total = TutorialCatalog.Chapters.Count;
            progressText.text = done == 0
                ? "第一次玩？從「章節教學」開始，一章大約兩分鐘"
                : done < total ? $"教學進度 {done}/{total} 章" : $"教學全部完成（{total}/{total}）！直接開始對戰吧";

            for (int i = 0; i < chapterButtons.Count; i++)
            {
                var ch = TutorialCatalog.Chapters[i];
                string mark = s.IsChapterDone(ch.Number) ? "<color=#2E8B57>（已完成）</color>" : "";
                SetLabel(chapterButtons[i], $"<b>{ch.Heading}</b>{mark}\n<size=75%>{ch.Goal}</size>");
            }

            SetLabel(speedButton, $"動畫速度：{s.AnimSpeedLabel}");
            SetLabel(shakeButton, $"畫面震動：{(s.ScreenShake ? "開" : "關")}");
            SetLabel(hintsButton, $"教學提示：{(s.Hints ? "開" : "關")}");
            SetLabel(resetProgressButton, done > 0 ? $"重設教學進度（目前 {done} 章）" : "重設教學進度");
        }

        public void SetBattleStatus(string text) => battleStatus.text = text;

        public void SetBattleBusy(bool busy)
        {
            soloButton.interactable = hostButton.interactable = joinButton.interactable = !busy;
        }

        static void SetLabel(Button b, string text)
        {
            var t = b.GetComponentInChildren<TMP_Text>();
            if (t) t.text = text;
        }
    }
}
