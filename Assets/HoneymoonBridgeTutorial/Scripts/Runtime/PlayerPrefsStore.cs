using UnityEngine;

namespace HoneymoonBridge.Tutorial
{
    // 教學版設定存在 PlayerPrefs；鍵名一律是 TutorialSettings.KeyPrefix 開頭，不會碰到原版
    public sealed class PlayerPrefsStore : ISettingsStore
    {
        public int GetInt(string key, int fallback) => PlayerPrefs.GetInt(key, fallback);
        public void SetInt(string key, int value) => PlayerPrefs.SetInt(key, value);
        public void DeleteKey(string key) => PlayerPrefs.DeleteKey(key);
        public void Save() => PlayerPrefs.Save();
    }
}
