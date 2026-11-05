// 放在名為 Editor 的資料夾裡，只在 Unity 編輯器裡存在，不會被打包進遊戲
// 用法：上方選單「蜜月橋牌 › 一鍵建立場景」
using System.IO;
using TMPro;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace HoneymoonBridge.EditorTools
{
    public static class HoneymoonSceneBuilder
    {
        const string Root = "Assets/HoneymoonBridge";
        const string PrefabDir = Root + "/Prefabs";
        const string ScenePath = Root + "/HoneymoonBridge.unity";

        // 配色（跟網頁版同一套：牌桌綠、牌面白、紅黑花色、金色強調）
        static readonly Color Felt = Hex("2E5A4E");
        static readonly Color FeltDark = Hex("244A40");
        static readonly Color FeltInk = Hex("E9F1EC");
        static readonly Color Paper = Hex("F8FAF8");
        static readonly Color Ink = Hex("1B2A3A");
        static readonly Color Gold = Hex("D9A23A");
        static readonly Color Shade = new Color(0.07f, 0.1f, 0.1f, 0.88f);

        static TMP_FontAsset font;
        static Sprite rounded;

        [MenuItem("蜜月橋牌/一鍵建立場景")]
        public static void Build()
        {
            font = TMP_Settings.defaultFontAsset;
            if (font == null)
            {
                EditorUtility.DisplayDialog("還缺 TextMeshPro 資源",
                    "先到 Window › TextMeshPro › Import TMP Essential Resources 匯入，\n" +
                    "再把中文字型（例如 Noto Sans TC 做成的 Font Asset）設成 TMP 預設字型，然後重跑這個選單。", "好");
                return;
            }
            if (File.Exists(ScenePath) && !EditorUtility.DisplayDialog("場景已存在",
                    $"{ScenePath} 已經有了，要重建嗎？（舊的會被覆蓋）", "重建", "取消"))
                return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;

            rounded = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
            EnsureFolder(Root);
            EnsureFolder(PrefabDir);

            var cardPrefab = BuildCardPrefab();
            var bidPrefab = BuildBidButtonPrefab();
            var floatPrefab = BuildFloatingTextPrefab();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var cam = Camera.main;
            if (cam) { cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = FeltDark; }

            BuildScene(cardPrefab, bidPrefab, floatPrefab);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AddToBuildSettings(ScenePath);
            AssetDatabase.SaveAssets();
            EditorUtility.DisplayDialog("完成", "場景建好了，按 Play 就能玩。\n" +
                "要改顏色或排版，直接在 Hierarchy 裡調；重跑這個選單會整個重建。", "好");
        }

        // ================= Prefab =================

        static CardView BuildCardPrefab()
        {
            var go = new GameObject("Card", typeof(RectTransform), typeof(CanvasGroup), typeof(LayoutElement));
            var rt = (RectTransform)go.transform;
            rt.sizeDelta = new Vector2(84, 118);
            var le = go.GetComponent<LayoutElement>();
            le.preferredWidth = 84; le.preferredHeight = 118;

            var visual = NewRect("Visual", rt);
            Stretch(visual);

            var faceRt = NewRect("Face", visual);
            Stretch(faceRt);
            var face = faceRt.gameObject.AddComponent<Image>();
            face.sprite = rounded; face.type = Image.Type.Sliced; face.color = Color.white;

            var label = AddText(NewRect("Label", visual), "A\n♠", 34, Ink);
            Stretch((RectTransform)label.transform);
            label.fontStyle = FontStyles.Bold;
            label.lineSpacing = -20;
            label.raycastTarget = false;

            var btn = go.AddComponent<Button>();
            btn.targetGraphic = face;
            btn.transition = Selectable.Transition.None;   // 顏色變化交給 CardView 自己做

            var cv = go.AddComponent<CardView>();
            cv.visual = visual; cv.face = face; cv.label = label; cv.button = btn;

            return SavePrefab(go, "Card").GetComponent<CardView>();
        }

        static Button BuildBidButtonPrefab()
        {
            var go = new GameObject("BidButton", typeof(RectTransform));
            ((RectTransform)go.transform).sizeDelta = new Vector2(78, 50);
            var img = go.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = Paper;
            var btn = go.AddComponent<Button>();
            btn.targetGraphic = img;
            var t = AddText(NewRect("Text", (RectTransform)go.transform), "1♠", 26, Ink);
            Stretch((RectTransform)t.transform);
            t.fontStyle = FontStyles.Bold;
            t.raycastTarget = false;
            return SavePrefab(go, "BidButton").GetComponent<Button>();
        }

        static FloatingText BuildFloatingTextPrefab()
        {
            var go = new GameObject("FloatingText", typeof(RectTransform), typeof(CanvasGroup));
            ((RectTransform)go.transform).sizeDelta = new Vector2(1000, 160);
            var g = go.GetComponent<CanvasGroup>();
            g.blocksRaycasts = false; g.interactable = false;   // 跳字不能擋住點擊

            var label = AddText(NewRect("Label", (RectTransform)go.transform), "王吃！", 48, Gold);
            Stretch((RectTransform)label.transform);
            label.fontStyle = FontStyles.Bold;
            label.raycastTarget = false;
            // 想加描邊：選字型的 Material Preset 調 Outline，不要在程式裡設（會產生存不進 Prefab 的臨時材質）

            var fx = label.gameObject.AddComponent<TextFX>();
            var ft = go.AddComponent<FloatingText>();
            ft.label = label; ft.fx = fx;
            return SavePrefab(go, "FloatingText").GetComponent<FloatingText>();
        }

        // ================= 場景 =================

        static void BuildScene(CardView cardPrefab, Button bidPrefab, FloatingText floatPrefab)
        {
            // --- Canvas + EventSystem ---
            var canvasGo = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            scaler.matchWidthOrHeight = 0.5f;
            var canvas = (RectTransform)canvasGo.transform;

            var es = new GameObject("EventSystem", typeof(EventSystem));
#if ENABLE_INPUT_SYSTEM
            es.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>();
#else
            es.AddComponent<StandaloneInputModule>();
#endif

            // --- 牌桌（震畫面時晃的就是這一層） ---
            var table = NewRect("Table", canvas);
            Stretch(table);
            table.gameObject.AddComponent<Image>().color = Felt;

            var status = Place(AddText(NewRect("Status", table), "抽牌階段", 30, FeltInk), 0, 1, 40, -36, 400, 50, TextAlignmentOptions.Left);
            var score = Place(AddText(NewRect("Score", table), "第 1 局｜你 0 · 電腦 0｜先到 100 分", 24, Gold), 0, 1, 40, -92, 460, 40, TextAlignmentOptions.Left);
            var info = Place(AddText(NewRect("Info", table), "", 26, FeltInk), 0.5f, 1, 0, -50, 900, 80, TextAlignmentOptions.Center);
            var oppCount = Place(AddText(NewRect("OppCount", table), "電腦：13 張", 28, FeltInk), 1, 1, -40, -36, 400, 50, TextAlignmentOptions.Right);

            var oppAnchor = Anchor("OppAnchor", table, 0.5f, 1, 0, -160);
            var oppSlot = Anchor("OppSlot", table, 0.5f, 0.5f, 0, 110);
            var mySlot = Anchor("MySlot", table, 0.5f, 0.5f, 0, -60);
            var faceUpSlot = Anchor("FaceUpSlot", table, 0, 0.5f, 220, 40);
            var faceUpLabel = Place(AddText(NewRect("FaceUpLabel", table), "明牌", 24, FeltInk), 0, 0.5f, 120, 130, 200, 40, TextAlignmentOptions.Center);   // 跟明牌同一條中線
            var centerAnchor = Anchor("CenterAnchor", table, 0.5f, 0.5f, 0, 30);
            var myAnchor = Anchor("MyAnchor", table, 0.5f, 0, 0, 300);

            var memo = Place(AddText(NewRect("Memo", table), "", 22, FeltInk), 0, 0, 40, 330, 520, 90, TextAlignmentOptions.TopLeft);
            var message = Place(AddText(NewRect("Message", table), "", 24, FeltInk), 1, 0, -40, 330, 620, 110, TextAlignmentOptions.BottomRight);

            var turnTmp = Place(AddText(NewRect("TurnText", table), "輪到你", 40, Gold), 0.5f, 0, 0, 262, 400, 60, TextAlignmentOptions.Center);   // 留空間給浮起來的手牌
            turnTmp.fontStyle = FontStyles.Bold;
            var turnFx = turnTmp.gameObject.AddComponent<TextFX>();

            // 手牌列
            var hand = NewRect("Hand", table);
            SetAnchor(hand, 0.5f, 0, 0, 100, 1500, 140);
            var hlg = hand.gameObject.AddComponent<HorizontalLayoutGroup>();
            hlg.spacing = 6; hlg.childAlignment = TextAnchor.MiddleCenter;
            hlg.childControlWidth = hlg.childControlHeight = false;
            hlg.childForceExpandWidth = hlg.childForceExpandHeight = false;

            // 叫牌紀錄（左側；抽牌階段放明牌的位置，叫牌後就空出來了）
            var auctionPanel = Panel("AuctionPanel", table, 0, 0.5f, 40, 80, 400, 360, FeltDark);
            var auctionText = AddText(NewRect("Text", auctionPanel), "<b>叫牌紀錄</b>", 24, FeltInk);
            Stretch((RectTransform)auctionText.transform);
            ((RectTransform)auctionText.transform).offsetMin = new Vector2(22, 16);
            ((RectTransform)auctionText.transform).offsetMax = new Vector2(-22, -16);
            auctionText.alignment = TextAlignmentOptions.TopLeft;
            var auctionToggle = MakeButton("AuctionToggle", table, "叫牌紀錄", 0, 1, 150, -156, 220, 52, Paper, Ink);

            // 叫牌面板（右側）：上面是目前合約，中間 35 個叫品，下面是試算和按鈕
            var bidPanel = Panel("BidPanel", table, 1, 0.5f, -40, 90, 460, 660, FeltDark);
            Place(AddText(NewRect("Title", bidPanel), "叫牌", 30, FeltInk), 0.5f, 1, 0, -24, 420, 40, TextAlignmentOptions.Center);
            var bidContract = Place(AddText(NewRect("Contract", bidPanel), "還沒有人叫牌", 24, Gold), 0.5f, 1, 0, -62, 430, 34, TextAlignmentOptions.Center);
            var grid = NewRect("BidGrid", bidPanel);
            SetAnchor(grid, 0.5f, 1, 0, -100, 420, 358);
            var glg = grid.gameObject.AddComponent<GridLayoutGroup>();
            glg.cellSize = new Vector2(78, 46); glg.spacing = new Vector2(6, 6);
            glg.constraint = GridLayoutGroup.Constraint.FixedColumnCount; glg.constraintCount = 5;
            glg.childAlignment = TextAnchor.UpperCenter;
            var bidPreview = Place(AddText(NewRect("Preview", bidPanel), "", 21, FeltInk), 0.5f, 1, 0, -464, 436, 112, TextAlignmentOptions.Top);
            AutoSize(bidPreview, 15, 21);   // 可以加倍時會有四行，字太多就自動縮小
            var confirmBid = MakeButton("ConfirmBid", bidPanel, "叫", 0.5f, 0, -135, 40, 170, 56, Gold, Ink);
            var pass = MakeButton("Pass", bidPanel, "Pass", 0.5f, 0, 20, 40, 120, 56, Paper, Ink);
            var dbl = MakeButton("Double", bidPanel, "加倍", 0.5f, 0, 155, 40, 130, 56, Paper, Hex("B8233A"));

            // 局末結算（正中央）：明細 + 總分 + 下一局
            var resultPanel = Panel("ResultPanel", table, 0.5f, 0.5f, 0, 20, 760, 560, new Color(FeltDark.r, FeltDark.g, FeltDark.b, 0.97f));
            var resultTitle = Place(AddText(NewRect("Title", resultPanel), "第 1 局結算", 52, FeltInk), 0.5f, 1, 0, -28, 700, 72, TextAlignmentOptions.Center);
            resultTitle.fontStyle = FontStyles.Bold;
            var resultTitleFx = resultTitle.gameObject.AddComponent<TextFX>();
            var resultBody = Place(AddText(NewRect("Body", resultPanel), "", 28, FeltInk), 0.5f, 1, 0, -112, 680, 340, TextAlignmentOptions.Top);
            resultBody.lineSpacing = 8;
            AutoSize(resultBody, 20, 28);
            var newHand = MakeButton("NewHand", resultPanel, "下一局", 0.5f, 0, 0, 62, 280, 72, Gold, Ink);

            // --- 跳字層：放在牌桌之後，永遠蓋在最上面，而且不擋點擊 ---
            var fxLayer = NewRect("FxLayer", canvas);
            Stretch(fxLayer);
            var fxGroup = fxLayer.gameObject.AddComponent<CanvasGroup>();
            fxGroup.blocksRaycasts = false; fxGroup.interactable = false;

            // --- 開場選單 ---
            var menu = NewRect("Menu", canvas);
            Stretch(menu);
            menu.gameObject.AddComponent<Image>().color = Shade;
            var title = Place(AddText(NewRect("Title", menu), "蜜月橋牌", 96, FeltInk), 0.5f, 0.5f, 0, 300, 900, 130, TextAlignmentOptions.Center);
            title.fontStyle = FontStyles.Bold;
            Place(AddText(NewRect("Subtitle", menu), "兩個人的橋牌", 32, Gold), 0.5f, 0.5f, 0, 210, 900, 50, TextAlignmentOptions.Center);
            var solo = MakeButton("Solo", menu, "單機 vs 電腦", 0.5f, 0.5f, 0, 90, 420, 80, Gold, Ink);
            var host = MakeButton("Host", menu, "開房間", 0.5f, 0.5f, 0, -20, 420, 80, Paper, Ink);
            var code = MakeInput("CodeInput", menu, "輸入朋友的房間代碼", 0.5f, 0.5f, -70, -130, 280, 72);
            var join = MakeButton("Join", menu, "加入", 0.5f, 0.5f, 140, -130, 130, 72, Paper, Ink);
            var menuStatus = Place(AddText(NewRect("Status", menu), "", 30, FeltInk), 0.5f, 0.5f, 0, -260, 1000, 120, TextAlignmentOptions.Center);

            // --- 邏輯物件 ---
            var nmGo = new GameObject("NetworkManager");
            var nm = nmGo.AddComponent<NetworkManager>();
            var transport = nmGo.AddComponent<UnityTransport>();
            nm.NetworkConfig = nm.NetworkConfig ?? new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;

            var tableLogic = new GameObject("TableLogic", typeof(NetworkObject), typeof(GameHost), typeof(LocalTable), typeof(NetTable));

            var gameGo = new GameObject("Game");
            var view = gameGo.AddComponent<GameView>();
            var fx = gameGo.AddComponent<FeedbackDirector>();
            var sessionMenu = gameGo.AddComponent<SessionMenu>();

            // --- 接線：把 Inspector 上那堆欄位全部自動拖好 ---
            Wire(view,
                ("cardPrefab", cardPrefab), ("bidButtonPrefab", bidPrefab),
                ("handRoot", hand), ("oppAnchor", oppAnchor), ("mySlot", mySlot), ("oppSlot", oppSlot), ("faceUpSlot", faceUpSlot),
                ("faceUpLabel", faceUpLabel.gameObject),
                ("statusText", status), ("infoText", info), ("scoreText", score), ("oppCountText", oppCount),
                ("messageText", message), ("memoText", memo), ("turnText", turnFx),
                ("bidPanel", bidPanel.gameObject), ("bidGridRoot", grid),
                ("bidContractText", bidContract), ("bidPreviewText", bidPreview),
                ("confirmBidButton", confirmBid), ("passButton", pass), ("doubleButton", dbl),
                ("auctionPanel", auctionPanel.gameObject), ("auctionText", auctionText), ("auctionToggle", auctionToggle),
                ("resultPanel", resultPanel.gameObject), ("resultTitle", resultTitleFx), ("resultBody", resultBody),
                ("newHandButton", newHand), ("fx", fx));
            Wire(fx,
                ("floatingPrefab", floatPrefab), ("fxLayer", fxLayer), ("shakeRoot", table),
                ("myAnchor", myAnchor), ("oppAnchor", oppAnchor), ("centerAnchor", centerAnchor));
            Wire(sessionMenu,
                ("menuPanel", menu.gameObject), ("soloButton", solo), ("hostButton", host), ("joinButton", join),
                ("codeInput", code), ("statusText", menuStatus),
                ("view", view), ("localTable", tableLogic.GetComponent<LocalTable>()), ("netTable", tableLogic.GetComponent<NetTable>()));
        }

        // ================= 小工具 =================

        static void Wire(Object target, params (string field, Object value)[] pairs)
        {
            var so = new SerializedObject(target);
            foreach (var (field, value) in pairs)
            {
                var p = so.FindProperty(field);
                if (p == null) { Debug.LogError($"[蜜月橋牌] {target.GetType().Name} 找不到欄位 {field}"); continue; }
                p.objectReferenceValue = value;
            }
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static RectTransform NewRect(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rt = (RectTransform)go.transform;
            if (parent) rt.SetParent(parent, false);
            return rt;
        }

        static void Stretch(RectTransform rt)
        {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = rt.offsetMax = Vector2.zero;
        }

        // ax/ay：錨點（0=左/下，1=右/上）；x/y：相對錨點的位移；w/h：尺寸
        static void SetAnchor(RectTransform rt, float ax, float ay, float x, float y, float w, float h)
        {
            rt.anchorMin = rt.anchorMax = new Vector2(ax, ay);
            rt.pivot = new Vector2(ax, ay);
            rt.anchoredPosition = new Vector2(x, y);
            rt.sizeDelta = new Vector2(w, h);
        }

        static RectTransform Anchor(string name, RectTransform parent, float ax, float ay, float x, float y)
        {
            var rt = NewRect(name, parent);
            rt.anchorMin = rt.anchorMax = new Vector2(ax, ay);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = new Vector2(x, y);
            rt.sizeDelta = new Vector2(84, 118);
            return rt;
        }

        static void AutoSize(TextMeshProUGUI t, float min, float max)
        {
            t.enableAutoSizing = true;
            t.fontSizeMin = min;
            t.fontSizeMax = max;
        }

        // 圓角底板
        static RectTransform Panel(string name, RectTransform parent, float ax, float ay, float x, float y, float w, float h, Color color)
        {
            var rt = NewRect(name, parent);
            SetAnchor(rt, ax, ay, x, y, w, h);
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = color;
            return rt;
        }

        static TextMeshProUGUI AddText(RectTransform rt, string text, float size, Color color)
        {
            var t = rt.gameObject.AddComponent<TextMeshProUGUI>();
            t.font = font;
            t.text = text;
            t.fontSize = size;
            t.color = color;
            t.alignment = TextAlignmentOptions.Center;
            t.richText = true;
            return t;
        }

        static TextMeshProUGUI Place(TextMeshProUGUI t, float ax, float ay, float x, float y, float w, float h, TextAlignmentOptions align)
        {
            SetAnchor((RectTransform)t.transform, ax, ay, x, y, w, h);
            t.alignment = align;
            return t;
        }

        static Button MakeButton(string name, RectTransform parent, string label, float ax, float ay, float x, float y, float w, float h, Color bg, Color fg)
        {
            var rt = NewRect(name, parent);
            SetAnchor(rt, ax, ay, x, y, w, h);
            rt.pivot = new Vector2(0.5f, 0.5f);
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = bg;
            var btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = img;
            var t = AddText(NewRect("Text", rt), label, 32, fg);
            Stretch((RectTransform)t.transform);
            t.fontStyle = FontStyles.Bold;
            t.raycastTarget = false;
            return btn;
        }

        static TMP_InputField MakeInput(string name, RectTransform parent, string placeholder, float ax, float ay, float x, float y, float w, float h)
        {
            var rt = NewRect(name, parent);
            SetAnchor(rt, ax, ay, x, y, w, h);
            rt.pivot = new Vector2(0.5f, 0.5f);
            var bg = rt.gameObject.AddComponent<Image>();
            bg.sprite = rounded; bg.type = Image.Type.Sliced; bg.color = Paper;

            var area = NewRect("Text Area", rt);
            Stretch(area);
            area.offsetMin = new Vector2(16, 6); area.offsetMax = new Vector2(-16, -6);
            area.gameObject.AddComponent<RectMask2D>();

            var ph = AddText(NewRect("Placeholder", area), placeholder, 24, new Color(Ink.r, Ink.g, Ink.b, 0.45f));
            Stretch((RectTransform)ph.transform);
            ph.alignment = TextAlignmentOptions.Left;
            var txt = AddText(NewRect("Text", area), "", 30, Ink);
            Stretch((RectTransform)txt.transform);
            txt.alignment = TextAlignmentOptions.Left;

            var input = rt.gameObject.AddComponent<TMP_InputField>();
            input.targetGraphic = bg;
            input.textViewport = area;
            input.textComponent = txt;
            input.placeholder = ph;
            input.characterLimit = 12;
            return input;
        }

        static GameObject SavePrefab(GameObject go, string name)
        {
            var path = $"{PrefabDir}/{name}.prefab";
            var asset = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            return asset;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path).Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }

        static void AddToBuildSettings(string path)
        {
            var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (list.Exists(s => s.path == path)) return;
            list.Insert(0, new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = list.ToArray();
        }

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString("#" + hex, out var c);
            return c;
        }
    }
}
