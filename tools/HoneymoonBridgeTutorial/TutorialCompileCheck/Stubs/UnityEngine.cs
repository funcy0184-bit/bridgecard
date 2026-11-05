// 假的 UnityEngine：只有簽名，讓腳本能編譯。不要拿來跑。
// 從 tools/UnityCompileCheck/Stubs 複製過來，再補上教學版用到的 API（原檔不動）。
using System;
using System.Collections;

namespace UnityEngine
{
    public class Object
    {
        public string name;
        public static implicit operator bool(Object o) => o != null;
        public static T Instantiate<T>(T original, Transform parent) where T : Object => original;
        public static T Instantiate<T>(T original) where T : Object => original;
        public static void Destroy(Object o) { }
        public static void DestroyImmediate(Object o) { }
    }

    public class Component : Object
    {
        public Transform transform => null;
        public GameObject gameObject => null;
        public T GetComponent<T>() => default;
        public T GetComponentInChildren<T>() => default;
    }

    public class Behaviour : Component
    {
        public bool enabled;
        public bool isActiveAndEnabled => true;
    }

    public class MonoBehaviour : Behaviour
    {
        public Coroutine StartCoroutine(IEnumerator routine) => null;
        public void StopCoroutine(Coroutine c) { }
        public void StopAllCoroutines() { }
    }

    public sealed class GameObject : Object
    {
        public GameObject() { }
        public GameObject(string name) { }
        public GameObject(string name, params Type[] components) { }
        public Transform transform => null;
        public bool activeSelf => true;
        public T AddComponent<T>() where T : Component => default;
        public T GetComponent<T>() => default;
        public void SetActive(bool v) { }
    }

    public class Transform : Component, IEnumerable
    {
        public Vector3 position;
        public Vector3 localScale;
        public void SetParent(Transform p, bool worldPositionStays) { }
        public void SetSiblingIndex(int i) { }
        public IEnumerator GetEnumerator() { yield break; }
    }

    public sealed class RectTransform : Transform
    {
        public Vector2 anchorMin, anchorMax, pivot, anchoredPosition, sizeDelta, offsetMin, offsetMax;
    }

    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static Vector2 zero => default;
        public static Vector2 one => new Vector2(1, 1);
        public static Vector2 up => new Vector2(0, 1);
        public static Vector2 operator +(Vector2 a, Vector2 b) => default;
        public static Vector2 operator *(Vector2 a, float b) => default;
        public static Vector2 operator *(float b, Vector2 a) => default;
        public static Vector2 LerpUnclamped(Vector2 a, Vector2 b, float t) => default;
        public static implicit operator Vector3(Vector2 v) => default;
        public static implicit operator Vector2(Vector3 v) => default;
    }

    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public static Vector3 zero => default;
        public static Vector3 one => new Vector3(1, 1, 1);
        public static Vector3 operator +(Vector3 a, Vector3 b) => default;
        public static Vector3 operator -(Vector3 a, Vector3 b) => default;
        public static Vector3 operator *(Vector3 a, float b) => default;
        public static Vector3 operator *(float b, Vector3 a) => default;
        public static Vector3 operator /(Vector3 a, float b) => default;
        public static Vector3 LerpUnclamped(Vector3 a, Vector3 b, float t) => default;
        public static Vector3 Scale(Vector3 a, Vector3 b) => default;
    }

    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b) { this.r = r; this.g = g; this.b = b; a = 1; }
        public Color(float r, float g, float b, float a) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color white => default;
        public static Color Lerp(Color a, Color b, float t) => default;
    }

    public static class ColorUtility { public static bool TryParseHtmlString(string s, out Color c) { c = default; return true; } }

    public static class Mathf
    {
        public const float PI = 3.14159265f;
        public static float Pow(float a, float b) => 0;
        public static float Sin(float a) => 0;
        public static float Cos(float a) => 0;
        public static float Clamp01(float a) => 0;
        public static float Lerp(float a, float b, float t) => 0;
        public static int Max(int a, int b) => 0;
        public static float Max(float a, float b) => 0;
    }

    public static class Time { public static float time; public static float deltaTime; public static float timeScale = 1f; }
    public static class PlayerPrefs
    {
        public static int GetInt(string k, int d) => d;
        public static void SetInt(string k, int v) { }
        public static void DeleteKey(string k) { }
        public static void Save() { }
    }
    public static class Random
    {
        public static int Range(int a, int b) => 0;
        public static Vector2 insideUnitCircle => default;
    }
    public static class Debug { public static void Log(object o) { } public static void LogWarning(object o) { } public static void LogError(object o) { } }
    public static class JsonUtility
    {
        public static string ToJson(object o) => "";
        public static T FromJson<T>(string s) => default;
    }

    public class YieldInstruction { }
    public sealed class WaitForSeconds : YieldInstruction { public WaitForSeconds(float s) { } }
    public sealed class Coroutine : YieldInstruction { }

    [AttributeUsage(AttributeTargets.Field)] public sealed class SerializeField : Attribute { }
    [AttributeUsage(AttributeTargets.Field)] public sealed class HeaderAttribute : Attribute { public HeaderAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.Field)] public sealed class TooltipAttribute : Attribute { public TooltipAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
    public sealed class RequireComponent : Attribute { public RequireComponent(Type t) { } }

    public enum CameraClearFlags { Skybox, SolidColor }
    public sealed class Camera : Behaviour
    {
        public static Camera main => null;
        public CameraClearFlags clearFlags;
        public Color backgroundColor;
    }

    public sealed class Sprite : Object { }
    public sealed class Mesh : Object { public Vector3[] vertices; }
    public enum TextAnchor { UpperLeft, UpperCenter, MiddleCenter }
    public enum RenderMode { ScreenSpaceOverlay }
    public sealed class Canvas : Behaviour { public RenderMode renderMode; }
    public sealed class CanvasGroup : Behaviour { public float alpha; public bool blocksRaycasts, interactable; }
}

namespace UnityEngine.Events
{
    public delegate void UnityAction();
    public class UnityEvent { public void AddListener(UnityAction a) { } }
}

namespace UnityEngine.EventSystems
{
    public class UIBehaviour : MonoBehaviour { }
    public class EventSystem : UIBehaviour { }
    public class StandaloneInputModule : UIBehaviour { }
}

namespace UnityEngine.SceneManagement
{
    public struct Scene { }
}

namespace UnityEngine.UI
{
    public class Graphic : EventSystems.UIBehaviour { public Color color; public bool raycastTarget; }
    public class MaskableGraphic : Graphic { }
    public class Image : MaskableGraphic
    {
        public enum Type { Simple, Sliced }
        public Sprite sprite;
        public Type type;
    }
    public class Selectable : EventSystems.UIBehaviour
    {
        public enum Transition { None, ColorTint }
        public bool interactable;
        public Graphic targetGraphic;
        public Transition transition;
    }
    public class Button : Selectable
    {
        public class ButtonClickedEvent : Events.UnityEvent { }
        public ButtonClickedEvent onClick => null;
    }
    public class LayoutElement : EventSystems.UIBehaviour { public float preferredWidth, preferredHeight; }
    public abstract class LayoutGroup : EventSystems.UIBehaviour { public TextAnchor childAlignment; }
    public abstract class HorizontalOrVerticalLayoutGroup : LayoutGroup
    {
        public float spacing;
        public bool childControlWidth, childControlHeight, childForceExpandWidth, childForceExpandHeight;
    }
    public class HorizontalLayoutGroup : HorizontalOrVerticalLayoutGroup { }
    public class VerticalLayoutGroup : HorizontalOrVerticalLayoutGroup { }
    public class GridLayoutGroup : LayoutGroup
    {
        public enum Constraint { Flexible, FixedColumnCount }
        public Vector2 cellSize, spacing;
        public Constraint constraint;
        public int constraintCount;
    }
    public class CanvasScaler : EventSystems.UIBehaviour
    {
        public enum ScaleMode { ConstantPixelSize, ScaleWithScreenSize }
        public ScaleMode uiScaleMode;
        public Vector2 referenceResolution;
        public float matchWidthOrHeight;
    }
    public class GraphicRaycaster : EventSystems.UIBehaviour { }
    public class RectMask2D : EventSystems.UIBehaviour { }
}
