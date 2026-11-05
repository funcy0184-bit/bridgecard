using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge
{
    // 牌的 Prefab 結構：
    //   Card (Button + CanvasGroup + 這支腳本)      ← 給 Layout Group 排位置
    //     └ Visual (RectTransform)                  ← 動畫都動這層，才不會被 Layout 蓋掉
    //         ├ Face (Image)
    //         └ Label (TMP_Text)
    [RequireComponent(typeof(CanvasGroup))]
    public class CardView : MonoBehaviour
    {
        public RectTransform visual;
        public Image face;
        public TMP_Text label;
        public Button button;

        [SerializeField] Color faceColor = Color.white;
        [SerializeField] Color glowColor = new Color(1f, 0.85f, 0.35f);
        [SerializeField] Color red = new Color(0.72f, 0.14f, 0.23f);
        [SerializeField] Color ink = new Color(0.11f, 0.16f, 0.23f);
        [SerializeField] float liftHeight = 18f;

        public int CardId { get; private set; } = -1;
        public CanvasGroup Group { get; private set; }

        Coroutine liftRoutine;
        bool lifted;

        void Awake() => Group = GetComponent<CanvasGroup>();

        public void Set(int id)
        {
            CardId = id;
            var c = Card.FromId(id);
            label.text = $"{c.RankText}\n{Card.SuitSymbol(c.Suit)}";
            label.color = c.IsRed ? red : ink;
            face.color = faceColor;
        }

        // 不能出的牌變半透明（但還是能點，點了會抖一下告訴你為什麼不行）
        public void SetPlayable(bool playable)
        {
            if (!Group) Group = GetComponent<CanvasGroup>();
            Group.alpha = playable ? 1f : 0.45f;
        }

        // 輪到你時，能出的牌整排浮起來
        public void SetLift(bool on)
        {
            if (on == lifted) return;
            lifted = on;
            if (liftRoutine != null) StopCoroutine(liftRoutine);
            if (isActiveAndEnabled) liftRoutine = StartCoroutine(LiftTo(on ? liftHeight : 0f));
        }

        IEnumerator LiftTo(float y)
        {
            Vector2 from = visual.anchoredPosition;
            Vector2 to = new Vector2(from.x, y);
            const float dur = 0.18f;
            for (float t = 0; t < dur; t += Time.deltaTime)
            {
                visual.anchoredPosition = Vector2.LerpUnclamped(from, to, Ease.OutBack(t / dur));
                yield return null;
            }
            visual.anchoredPosition = to;
        }

        public void Appear()   // 新摸到的牌：從 0 彈出來 + 閃一下金光
        {
            visual.localScale = Vector3.zero;
            StartCoroutine(Tween.Scale(visual, Vector3.one, 0.35f, Ease.OutBack));
            StartCoroutine(Tween.Flash(face, glowColor, 0.6f));
        }

        public void Glow() => StartCoroutine(Tween.Flash(face, glowColor, 0.5f));

        public void Deny()     // 點了不能出的牌
        {
            StartCoroutine(Tween.Shake(visual, 8f, 0.25f));
            StartCoroutine(Tween.Flash(face, new Color(1f, 0.75f, 0.78f), 0.35f));
        }
    }
}
