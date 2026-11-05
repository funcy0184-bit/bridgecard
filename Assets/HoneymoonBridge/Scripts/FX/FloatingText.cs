using System.Collections;
using TMPro;
using UnityEngine;

namespace HoneymoonBridge
{
    // 跳字 Prefab：一個 TMP 文字 + TextFX + CanvasGroup。
    // 出現 → 停留 → 往上飄並淡出 → 自毀
    [RequireComponent(typeof(CanvasGroup))]
    public class FloatingText : MonoBehaviour
    {
        public TMP_Text label;
        public TextFX fx;

        public IEnumerator Show(string content, Color color, float size, TextFXFlags flags,
                                float hold = 0.7f, float rise = 60f)
        {
            var group = GetComponent<CanvasGroup>();
            var rt = (RectTransform)transform;
            label.color = color;
            label.fontSize = size;
            fx.Play(content, flags);
            group.alpha = 1f;

            yield return new WaitForSeconds(hold);

            Vector2 start = rt.anchoredPosition;
            const float dur = 0.5f;
            for (float t = 0; t < dur; t += Time.deltaTime)
            {
                float k = t / dur;
                rt.anchoredPosition = start + Vector2.up * rise * Ease.OutCubic(k);
                group.alpha = 1f - k;
                yield return null;
            }
            Destroy(gameObject);
        }
    }
}
