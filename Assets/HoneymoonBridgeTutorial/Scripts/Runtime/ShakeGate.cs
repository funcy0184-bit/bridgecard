using UnityEngine;

namespace HoneymoonBridge.Tutorial
{
    // 「畫面震動」開關。掛在 FeedbackDirector 震動的那個物件（牌桌）上。
    // 原版的震動是在協程裡改 anchoredPosition；LateUpdate 在協程之後才跑，
    // 關掉時在這裡把位置拉回原點，畫面就不會晃。原版的 FeedbackDirector 一行都不用改。
    [RequireComponent(typeof(RectTransform))]
    public class ShakeGate : MonoBehaviour
    {
        public bool allowShake = true;
        RectTransform rt;

        void Awake() => rt = (RectTransform)transform;

        void LateUpdate()
        {
            if (!allowShake && rt) rt.anchoredPosition = Vector2.zero;
        }
    }
}
