using System;

namespace HoneymoonBridge.Tutorial
{
    // 存設定的地方。Unity 裡用 PlayerPrefs（PlayerPrefsStore），測試時用記憶體版
    public interface ISettingsStore
    {
        int GetInt(string key, int fallback);
        void SetInt(string key, int value);
        void DeleteKey(string key);
        void Save();
    }

    public sealed class MemorySettingsStore : ISettingsStore
    {
        readonly System.Collections.Generic.Dictionary<string, int> d = new System.Collections.Generic.Dictionary<string, int>();
        public int GetInt(string key, int fallback) => d.TryGetValue(key, out var v) ? v : fallback;
        public void SetInt(string key, int value) => d[key] = value;
        public void DeleteKey(string key) => d.Remove(key);
        public void Save() { }
        public bool Has(string key) => d.ContainsKey(key);
    }

    // 教學版的設定與教學進度。所有儲存鍵都用 KeyPrefix 開頭，跟原版完全分開
    public sealed class TutorialSettings
    {
        public const string KeyPrefix = "HoneymoonBridgeTutorial.";
        public const string AnimSpeedKey = KeyPrefix + "AnimSpeed";
        public const string ShakeKey = KeyPrefix + "ScreenShake";
        public const string HintsKey = KeyPrefix + "Hints";
        public static string ChapterKey(int n) => KeyPrefix + "ChapterDone." + n;

        public static readonly float[] Speeds = { 0.75f, 1f, 1.5f };
        public static readonly string[] SpeedLabels = { "慢", "標準", "快" };
        public const int DefaultSpeed = 1;

        readonly ISettingsStore store;
        public event Action Changed;

        public TutorialSettings(ISettingsStore store) { this.store = store; }

        // 動畫速度：0 慢 / 1 標準 / 2 快（實際作用是 Time.timeScale）
        public int AnimSpeedIndex
        {
            get => Clamp(store.GetInt(AnimSpeedKey, DefaultSpeed), 0, Speeds.Length - 1);
            set { store.SetInt(AnimSpeedKey, Clamp(value, 0, Speeds.Length - 1)); Commit(); }
        }
        public float AnimSpeed => Speeds[AnimSpeedIndex];
        public string AnimSpeedLabel => SpeedLabels[AnimSpeedIndex];

        public bool ScreenShake
        {
            get => store.GetInt(ShakeKey, 1) != 0;
            set { store.SetInt(ShakeKey, value ? 1 : 0); Commit(); }
        }

        // 教學提示（白話提示框）
        public bool Hints
        {
            get => store.GetInt(HintsKey, 1) != 0;
            set { store.SetInt(HintsKey, value ? 1 : 0); Commit(); }
        }

        public bool IsChapterDone(int n) => store.GetInt(ChapterKey(n), 0) != 0;
        public void MarkChapterDone(int n) { store.SetInt(ChapterKey(n), 1); Commit(); }

        public int ChaptersDone
        {
            get
            {
                int n = 0;
                foreach (var c in TutorialCatalog.Chapters) if (IsChapterDone(c.Number)) n++;
                return n;
            }
        }

        public void ResetProgress()
        {
            foreach (var c in TutorialCatalog.Chapters) store.DeleteKey(ChapterKey(c.Number));
            Commit();
        }

        void Commit() { store.Save(); Changed?.Invoke(); }
        static int Clamp(int v, int lo, int hi) => v < lo ? lo : v > hi ? hi : v;
    }
}
