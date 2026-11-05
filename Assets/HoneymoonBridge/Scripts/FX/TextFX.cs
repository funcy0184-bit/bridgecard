using System;
using TMPro;
using UnityEngine;

namespace HoneymoonBridge
{
    [Flags]
    public enum TextFXFlags
    {
        None = 0,
        PopIn = 1,   // 一個字一個字彈出來
        Wave = 2,    // 字像波浪一樣上下飄（開心、慶祝）
        Shake = 4,   // 字抖動（錯誤、被王吃、倒約）
        Jelly = 8    // 每個字輪流壓扁拉長（Q 彈感，適合「輪到你」）
    }

    // TextMeshPro 逐字動畫：每一幀拿到每個字的四個頂點，自己挪位置、縮放
    [RequireComponent(typeof(TMP_Text))]
    public class TextFX : MonoBehaviour
    {
        [Header("彈出")]
        public float charDelay = 0.035f;
        public float popDuration = 0.28f;
        [Header("波浪")]
        public float waveHeight = 6f;
        public float waveSpeed = 8f;
        public float waveSpacing = 0.45f;
        [Header("抖動")]
        public float shakeAmount = 2.5f;

        TMP_Text text;
        TextFXFlags flags;
        float startTime;

        void Awake() => text = GetComponent<TMP_Text>();

        public void Play(string content, TextFXFlags fx)
        {
            if (!text) text = GetComponent<TMP_Text>();
            text.text = content;
            flags = fx;
            startTime = Time.time;
        }

        public void SetFlags(TextFXFlags fx)
        {
            flags = fx;
            startTime = Time.time;
        }

        void LateUpdate()
        {
            if (flags == TextFXFlags.None) return;

            text.ForceMeshUpdate();          // 先拿到「沒動過」的原始頂點
            var info = text.textInfo;
            float now = Time.time - startTime;

            for (int i = 0; i < info.characterCount; i++)
            {
                var ch = info.characterInfo[i];
                if (!ch.isVisible) continue;

                var verts = info.meshInfo[ch.materialReferenceIndex].vertices;
                int v = ch.vertexIndex;
                Vector3 center = (verts[v] + verts[v + 2]) / 2f;
                Vector3 scale = Vector3.one;
                Vector3 offset = Vector3.zero;

                if ((flags & TextFXFlags.PopIn) != 0)
                {
                    float t = Mathf.Clamp01((now - i * charDelay) / popDuration);
                    scale *= Ease.OutBack(t);
                }
                if ((flags & TextFXFlags.Wave) != 0)
                    offset.y += Mathf.Sin(now * waveSpeed - i * waveSpacing) * waveHeight;
                if ((flags & TextFXFlags.Shake) != 0)
                    offset += (Vector3)(UnityEngine.Random.insideUnitCircle * shakeAmount);
                if ((flags & TextFXFlags.Jelly) != 0)
                {
                    float s = Mathf.Sin(now * 6f - i * 0.6f) * 0.12f;
                    scale = Vector3.Scale(scale, new Vector3(1f + s, 1f - s, 1f));
                }

                for (int j = 0; j < 4; j++)
                {
                    Vector3 p = verts[v + j] - center;
                    verts[v + j] = new Vector3(p.x * scale.x, p.y * scale.y, 0) + center + offset;
                }
            }

            for (int m = 0; m < info.meshCount; m++)
            {
                info.meshInfo[m].mesh.vertices = info.meshInfo[m].vertices;
                text.UpdateGeometry(info.meshInfo[m].mesh, m);
            }
        }
    }
}
