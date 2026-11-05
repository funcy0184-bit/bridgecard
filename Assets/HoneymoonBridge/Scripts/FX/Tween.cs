using System;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge
{
    // 緩動曲線：決定動畫「手感」。曲線圖可以對照 easings.net
    public static class Ease
    {
        public static float Linear(float t) => t;
        public static float OutCubic(float t) => 1f - Mathf.Pow(1f - t, 3f);
        public static float InCubic(float t) => t * t * t;
        public static float InOutSine(float t) => -(Mathf.Cos(Mathf.PI * t) - 1f) / 2f;

        // 衝過頭再彈回來，最適合「蹦出來」的東西
        public static float OutBack(float t)
        {
            const float c1 = 1.70158f, c3 = c1 + 1f;
            return 1f + c3 * Mathf.Pow(t - 1f, 3f) + c1 * Mathf.Pow(t - 1f, 2f);
        }
    }

    // 不靠任何插件的迷你補間動畫。用法：StartCoroutine(Tween.Move(...))
    // 熟了以後可以換成 DOTween / PrimeTween，概念完全一樣
    public static class Tween
    {
        public static IEnumerator Move(Transform tr, Vector3 to, float dur, Func<float, float> ease = null)
        {
            ease ??= Ease.OutCubic;
            Vector3 from = tr.position;
            for (float t = 0; t < dur && tr; t += Time.deltaTime)
            {
                tr.position = Vector3.LerpUnclamped(from, to, ease(t / dur));
                yield return null;
            }
            if (tr) tr.position = to;
        }

        public static IEnumerator Scale(Transform tr, Vector3 to, float dur, Func<float, float> ease = null)
        {
            ease ??= Ease.OutBack;
            Vector3 from = tr.localScale;
            for (float t = 0; t < dur && tr; t += Time.deltaTime)
            {
                tr.localScale = Vector3.LerpUnclamped(from, to, ease(t / dur));
                yield return null;
            }
            if (tr) tr.localScale = to;
        }

        // 「啵」一下：放大再縮回原尺寸，帶一點回彈
        public static IEnumerator Punch(Transform tr, float amount = 0.2f, float dur = 0.3f)
        {
            Vector3 baseScale = tr.localScale;
            for (float t = 0; t < dur && tr; t += Time.deltaTime)
            {
                float k = t / dur;
                float s = 1f + amount * Mathf.Sin(k * Mathf.PI * 2f) * (1f - k);
                tr.localScale = baseScale * s;
                yield return null;
            }
            if (tr) tr.localScale = baseScale;
        }

        // 震動：隨機位移、越來越小，最後回原位
        public static IEnumerator Shake(RectTransform rt, float amplitude = 10f, float dur = 0.25f)
        {
            Vector2 basePos = rt.anchoredPosition;
            for (float t = 0; t < dur && rt; t += Time.deltaTime)
            {
                float falloff = 1f - t / dur;
                rt.anchoredPosition = basePos + UnityEngine.Random.insideUnitCircle * amplitude * falloff;
                yield return null;
            }
            if (rt) rt.anchoredPosition = basePos;
        }

        public static IEnumerator Fade(CanvasGroup g, float to, float dur)
        {
            float from = g.alpha;
            for (float t = 0; t < dur && g; t += Time.deltaTime)
            {
                g.alpha = Mathf.Lerp(from, to, t / dur);
                yield return null;
            }
            if (g) g.alpha = to;
        }

        // 顏色閃一下再回來（贏墩發光、被吃掉變紅都用它）
        public static IEnumerator Flash(Graphic g, Color flash, float dur = 0.4f)
        {
            Color baseColor = g.color;
            for (float t = 0; t < dur && g; t += Time.deltaTime)
            {
                g.color = Color.Lerp(flash, baseColor, Ease.InCubic(t / dur));
                yield return null;
            }
            if (g) g.color = baseColor;
        }

        // 翻牌：X 軸縮到 0，換內容，再展開
        public static IEnumerator Flip(Transform tr, Action atMiddle, float dur = 0.3f)
        {
            Vector3 s = tr.localScale;
            float half = dur / 2f;
            for (float t = 0; t < half && tr; t += Time.deltaTime)
            {
                tr.localScale = new Vector3(s.x * (1f - Ease.InCubic(t / half)), s.y, s.z);
                yield return null;
            }
            atMiddle?.Invoke();
            for (float t = 0; t < half && tr; t += Time.deltaTime)
            {
                tr.localScale = new Vector3(s.x * Ease.OutBack(t / half), s.y, s.z);
                yield return null;
            }
            if (tr) tr.localScale = s;
        }
    }
}
