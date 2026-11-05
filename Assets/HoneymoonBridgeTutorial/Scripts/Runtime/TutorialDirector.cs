using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge.Tutorial
{
    // 章節教學的流程：一題一題往下走，上方的說明框顯示題目、提示、過關訊息
    public class TutorialDirector : MonoBehaviour
    {
        [SerializeField] TutorialTable table;
        [SerializeField] GameObject panel;
        [SerializeField] TMP_Text titleText;
        [SerializeField] TMP_Text bodyText;
        [SerializeField] TMP_Text hintText;
        [SerializeField] Button primaryButton;    // 下一題／完成本章／再試一次
        [SerializeField] Button restartButton;    // 重來這題

        public event Action<int> ChapterCompleted;

        TutorialSettings settings;
        Chapter chapter;
        int index;
        LessonVerdict verdict;

        static readonly Color Gold = new Color(0.85f, 0.64f, 0.23f);
        static readonly Color Ink = new Color(0.91f, 0.95f, 0.93f);
        static readonly Color Warn = new Color(0.95f, 0.55f, 0.55f);

        public bool Running => chapter != null;

        public void Init(TutorialSettings s)
        {
            settings = s;
            primaryButton.onClick.AddListener(OnPrimary);
            restartButton.onClick.AddListener(() => { if (chapter != null) BeginLesson(); });
            table.HintShown += OnHint;
            table.LessonFinished += OnFinished;
            table.NextRequested += () => { if (verdict != null) OnPrimary(); };
            panel.SetActive(false);
        }

        public void StartChapter(Chapter ch)
        {
            chapter = ch;
            index = 0;
            panel.SetActive(true);
            BeginLesson();
        }

        public void Stop()
        {
            chapter = null;
            verdict = null;
            table.Stop();
            panel.SetActive(false);
        }

        void BeginLesson()
        {
            verdict = null;
            var lesson = chapter.Lessons[index];
            titleText.text = $"{chapter.Heading}（{index + 1}/{chapter.Lessons.Count}）{lesson.Title}";
            titleText.color = Gold;
            bodyText.text = lesson.Instruction;
            bodyText.color = Ink;
            hintText.text = "";
            primaryButton.gameObject.SetActive(false);
            table.Begin(lesson);
        }

        void OnHint(string hint)
        {
            if (chapter == null) return;
            hintText.text = hint;
            hintText.color = Warn;
        }

        void OnFinished(LessonVerdict v)
        {
            if (chapter == null) return;
            verdict = v;
            hintText.text = "";
            bodyText.text = v.Message;
            titleText.text = v.Passed ? "過關！" : "差一點！";
            titleText.color = v.Passed ? Gold : Warn;
            bool last = index == chapter.Lessons.Count - 1;
            SetLabel(primaryButton, !v.Passed ? "再試一次" : last ? "完成本章" : "下一題");
            primaryButton.gameObject.SetActive(true);
        }

        void OnPrimary()
        {
            if (chapter == null || verdict == null) return;
            if (!verdict.Passed) { BeginLesson(); return; }
            if (index < chapter.Lessons.Count - 1) { index++; BeginLesson(); return; }

            int n = chapter.Number;
            settings?.MarkChapterDone(n);
            Stop();
            ChapterCompleted?.Invoke(n);
        }

        static void SetLabel(Button b, string text)
        {
            var t = b.GetComponentInChildren<TMP_Text>();
            if (t) t.text = text;
        }
    }
}
