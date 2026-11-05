// 假的 TextMeshPro / Netcode / Multiplayer Services / UnityEditor API：只有簽名
// 從 tools/UnityCompileCheck/Stubs 複製過來，再補上教學版用到的 API（原檔不動）。
using System;
using System.Threading.Tasks;
using UnityEngine;

namespace TMPro
{
    public enum TextAlignmentOptions { Left, Center, Right, Top, TopLeft, BottomRight }
    [Flags] public enum FontStyles { Normal = 0, Bold = 1 }
    public class TMP_FontAsset : UnityEngine.Object { }
    public class TMP_Settings { public static TMP_FontAsset defaultFontAsset => null; }
    public struct TMP_CharacterInfo { public bool isVisible; public int materialReferenceIndex, vertexIndex; }
    public struct TMP_MeshInfo { public Vector3[] vertices; public Mesh mesh; }
    public class TMP_TextInfo
    {
        public int characterCount, meshCount;
        public TMP_CharacterInfo[] characterInfo;
        public TMP_MeshInfo[] meshInfo;
    }
    public abstract class TMP_Text : UnityEngine.UI.MaskableGraphic
    {
        public string text;
        public float fontSize, lineSpacing, fontSizeMin, fontSizeMax;
        public bool enableAutoSizing;
        public FontStyles fontStyle;
        public TextAlignmentOptions alignment;
        public bool richText;
        public TMP_FontAsset font;
        public TMP_TextInfo textInfo => null;
        public void ForceMeshUpdate() { }
        public void UpdateGeometry(Mesh m, int index) { }
    }
    public class TextMeshProUGUI : TMP_Text { }
    public class TMP_InputField : UnityEngine.UI.Selectable
    {
        public string text;
        public RectTransform textViewport;
        public TMP_Text textComponent;
        public UnityEngine.UI.Graphic placeholder;
        public int characterLimit;
    }
}

namespace Unity.Netcode
{
    public enum SendTo { Server, SpecifiedInParams }
    public enum RpcTargetUse { Temp, Persistent }
    [AttributeUsage(AttributeTargets.Method)] public sealed class RpcAttribute : Attribute { public RpcAttribute(SendTo t) { } }
    public class BaseRpcTarget { }
    public class RpcTargetGroup { public BaseRpcTarget Single(ulong id, RpcTargetUse use) => null; }
    public struct RpcReceiveParams { public ulong SenderClientId; }
    public struct RpcParams
    {
        public RpcReceiveParams Receive;
        public static implicit operator RpcParams(BaseRpcTarget t) => default;
    }
    public class NetworkTransport : MonoBehaviour { }
    public class NetworkConfig { public NetworkTransport NetworkTransport; }
    public class NetworkManager : MonoBehaviour
    {
        public NetworkConfig NetworkConfig;
        public event Action<ulong> OnClientDisconnectCallback;
        public const ulong ServerClientId = 0;
        public static NetworkManager Singleton => null;
        public bool IsListening => false;
        public void Shutdown(bool discardMessageQueue = false) { }
    }
    public sealed class NetworkObject : MonoBehaviour { }
    public abstract class NetworkBehaviour : MonoBehaviour
    {
        public bool IsServer => false;
        public NetworkManager NetworkManager => null;
        public RpcTargetGroup RpcTarget => null;
        public virtual void OnNetworkSpawn() { }
        public virtual void OnNetworkDespawn() { }
    }
}

namespace Unity.Netcode.Transports.UTP
{
    public class UnityTransport : NetworkTransport { }
}

namespace Unity.Services.Core
{
    public enum ServicesInitializationState { Uninitialized, Initializing, Initialized }
    public class InitializationOptions { }
    public static class UnityServices
    {
        public static ServicesInitializationState State => default;
        public static Task InitializeAsync(InitializationOptions o) => Task.CompletedTask;
    }
}

namespace Unity.Services.Authentication
{
    public interface IAuthenticationService { bool IsSignedIn { get; } Task SignInAnonymouslyAsync(); }
    public static class AuthenticationService { public static IAuthenticationService Instance => null; }
    public static class AuthenticationExtensions
    {
        public static Unity.Services.Core.InitializationOptions SetProfile(this Unity.Services.Core.InitializationOptions o, string p) => o;
    }
}

namespace Unity.Services.Multiplayer
{
    public interface ISession { string Code { get; } Task LeaveAsync(); }
    public class SessionOptions { public int MaxPlayers; public bool IsPrivate; }
    public static class SessionOptionsExtensions { public static SessionOptions WithRelayNetwork(this SessionOptions o) => o; }
    public interface IMultiplayerService
    {
        Task<ISession> CreateSessionAsync(SessionOptions o);
        Task<ISession> JoinSessionByCodeAsync(string code);
    }
    public static class MultiplayerService { public static IMultiplayerService Instance => null; }
}

namespace UnityEditor
{
    [AttributeUsage(AttributeTargets.Method)] public sealed class MenuItem : Attribute { public MenuItem(string path) { } }
    public static class EditorUtility
    {
        public static bool DisplayDialog(string title, string msg, string ok) => true;
        public static bool DisplayDialog(string title, string msg, string ok, string cancel) => true;
    }
    public static class AssetDatabase
    {
        public static T GetBuiltinExtraResource<T>(string path) where T : UnityEngine.Object => null;
        public static bool IsValidFolder(string p) => true;
        public static string CreateFolder(string parent, string name) => "";
        public static void SaveAssets() { }
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object => null;
        public static string GenerateUniqueAssetPath(string path) => path;
    }
    public class SceneAsset : UnityEngine.Object { }
    public static class Selection { public static UnityEngine.Object activeObject; }
    public static class EditorGUIUtility { public static void PingObject(UnityEngine.Object o) { } }
    public static class PrefabUtility { public static GameObject SaveAsPrefabAsset(GameObject go, string path) => go; }
    public class SerializedProperty { public UnityEngine.Object objectReferenceValue; }
    public class SerializedObject
    {
        public SerializedObject(UnityEngine.Object o) { }
        public SerializedProperty FindProperty(string name) => null;
        public bool ApplyModifiedPropertiesWithoutUndo() => true;
    }
    public class EditorBuildSettingsScene
    {
        public string path;
        public EditorBuildSettingsScene(string path, bool enabled) { this.path = path; }
    }
    public static class EditorBuildSettings { public static EditorBuildSettingsScene[] scenes; }
}

namespace UnityEditor.SceneManagement
{
    public enum NewSceneSetup { EmptyScene, DefaultGameObjects }
    public enum NewSceneMode { Single, Additive }
    public static class EditorSceneManager
    {
        public static UnityEngine.SceneManagement.Scene NewScene(NewSceneSetup s, NewSceneMode m) => default;
        public static bool SaveScene(UnityEngine.SceneManagement.Scene s, string path) => true;
        public static bool SaveCurrentModifiedScenesIfUserWantsTo() => true;
    }
}
