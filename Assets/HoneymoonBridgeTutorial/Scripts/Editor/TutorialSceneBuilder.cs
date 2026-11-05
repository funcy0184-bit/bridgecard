// 只在 Unity 編輯器裡存在，不會被打包進遊戲
// 用法：上方選單「蜜月橋牌教學版 › 建立教學場景」
//
// 安全規則：
//   1. 只寫入 Assets/HoneymoonBridgeTutorial/（場景、Prefab），原版的檔案一個都不碰
//   2. 教學場景已經存在 → 直接在 Project 視窗選取它，不重建、不覆寫你手動調整過的內容
//   3. Prefab 已經存在 → 直接沿用，不覆寫
//   4. 不修改 Build Settings（ProjectSettings 保持原狀）；在編輯器裡打開場景按 Play 就能玩
using System.IO;
using TMPro;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace HoneymoonBridge.Tutorial.EditorTools
{
    public static class TutorialSceneBuilder
    {
        public const string Root = "Assets/HoneymoonBridgeTutorial";
        public const string PrefabDir = Root + "/Prefabs";
        public const string ScenePath = Root + "/HoneymoonBridgeTutorial.unity";

        // 配色跟原版一樣：牌桌綠、牌面白、紅黑花色、金色強調
        static readonly Color Felt = Hex("2E5A4E");
        static readonly Color FeltDark = Hex("244A40");
        static readonly Color FeltInk = Hex("E9F1EC");
        static readonly Color Paper = Hex("F8FAF8");
        static readonly Color Ink = Hex("1B2A3A");
        static readonly Color Gold = Hex("D9A23A");
        static readonly Color Shade = new Color(0.07f, 0.1f, 0.1f, 0.92f);

        static TMP_FontAsset font;
        static Sprite rounded;

        [MenuItem("蜜月橋牌教學版/建立教學場景")]
        public static void Build()
        {
            // 已經有了：選取它就好，絕不覆寫
            var existing = AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath);
            if (existing != null || File.Exists(ScenePath))
            {
                if (existing != null)
                {
                    Selection.activeObject = existing;
                    EditorGUIUtility.PingObject(existing);
                }
                EditorUtility.DisplayDialog("教學場景已經存在",
                    $"{ScenePath} 已經建好了，已幫你在 Project 視窗選取它，雙擊就能打開。\n\n" +
                    "為了不覆寫你手動調整過的內容，這個指令不會重建。\n" +
                    "真的想重建，請自己先刪除或改名那個場景檔，再執行一次。", "好");
                return;
            }

            font = TMP_Settings.defaultFontAsset;
            if (font == null)
            {
                EditorUtility.DisplayDialog("還缺 TextMeshPro 資源",
                    "先到 Window › TextMeshPro › Import TMP Essential Resources 匯入，\n" +
                    "再把中文字型（例如 Noto Sans TC 做成的 Font Asset）設成 TMP 預設字型，然後重跑這個選單。", "好");
                return;
            }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;

            rounded = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
            EnsureFolder(Root);
            EnsureFolder(PrefabDir);

            var cardPrefab = LoadOrBuild<CardView>("TutorialCard", BuildCardPrefab);
            var bidPrefab = LoadOrBuild<Button>("TutorialBidButton", BuildBidButtonPrefab);
            var floatPrefab = LoadOrBuild<FloatingText>("TutorialFloatingText", BuildFloatingTextPrefab);
            var listPrefab = LoadOrBuild<Button>("TutorialListButton", BuildListButtonPrefab);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var cam = Camera.main;
            if (cam) { cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = FeltDark; }

            BuildScene(cardPrefab, bidPrefab, floatPrefab, listPrefab);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            var saved = AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath);
            if (saved != null) { Selection.activeObject = saved; EditorGUIUtility.PingObject(saved); }
            EditorUtility.DisplayDialog("完成", $"教學場景建好了：{ScenePath}\n按 Play 就會看到主選單。\n\n" +
                "要改排版直接在 Hierarchy 裡調；之後再按這個選單也不會覆寫。", "好");
        }

        // ================= Prefab（存在就沿用） =================

        static T LoadOrBuild<T>(string name, System.Func<T> build) where T : Component
        {
            var path = $"{PrefabDir}/{name}.prefab";
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (go != null)
            {
                var c = go.GetComponent<T>();
                if (c != null) return c;
                Debug.LogWarning($"[蜜月橋牌教學版] {path} 存在但沒有 {typeof(T).Name}，改用新建的（不覆寫舊檔，存成另一個名字）");
                return build();
            }
            return build();
        }

        static CardView BuildCardPrefab()
        {
            var go = new GameObject("TutorialCard", typeof(RectTransform), typeof(CanvasGroup), typeof(LayoutElement));
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
            btn.transition = Selectable.Transition.None;

            var cv = go.AddComponent<CardView>();
            cv.visual = visual; cv.face = face; cv.label = label; cv.button = btn;
            return SavePrefab(go, "TutorialCard").GetComponent<CardView>();
        }

        static Button BuildBidButtonPrefab()
        {
            var go = new GameObject("TutorialBidButton", typeof(RectTransform));
            ((RectTransform)go.transform).sizeDelta = new Vector2(78, 50);
            var img = go.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = Paper;
            var btn = go.AddComponent<Button>();
            btn.targetGraphic = img;
            var t = AddText(NewRect("Text", (RectTransform)go.transform), "1♠", 26, Ink);
            Stretch((RectTransform)t.transform);
            t.fontStyle = FontStyles.Bold;
            t.raycastTarget = false;
            return SavePrefab(go, "TutorialBidButton").GetComponent<Button>();
        }

        static FloatingText BuildFloatingTextPrefab()
        {
            var go = new GameObject("TutorialFloatingText", typeof(RectTransform), typeof(CanvasGroup));
            ((RectTransform)go.transform).sizeDelta = new Vector2(1000, 160);
            var g = go.GetComponent<CanvasGroup>();
            g.blocksRaycasts = false; g.interactable = false;

            var label = AddText(NewRect("Label", (RectTransform)go.transform), "王吃！", 48, Gold);
            Stretch((RectTransform)label.transform);
            label.fontStyle = FontStyles.Bold;
            label.raycastTarget = false;

            var fx = label.gameObject.AddComponent<TextFX>();
            var ft = go.AddComponent<FloatingText>();
            ft.label = label; ft.fx = fx;
            return SavePrefab(go, "TutorialFloatingText").GetComponent<FloatingText>();
        }

        // 選單清單用的寬按鈕（章節、遊戲介紹分頁）
        static Button BuildListButtonPrefab()
        {
            var go = new GameObject("TutorialListButton", typeof(RectTransform), typeof(LayoutElement));
            ((RectTransform)go.transform).sizeDelta = new Vector2(880, 96);
            var le = go.GetComponent<LayoutElement>();
            le.preferredWidth = 880; le.preferredHeight = 96;
            var img = go.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = Paper;
            var btn = go.AddComponent<Button>();
            btn.targetGraphic = img;
            var t = AddText(NewRect("Text", (RectTransform)go.transform), "第一章", 30, Ink);
            Stretch((RectTransform)t.transform);
            ((RectTransform)t.transform).offsetMin = new Vector2(28, 6);
            ((RectTransform)t.transform).offsetMax = new Vector2(-28, -6);
            t.raycastTarget = false;
            return SavePrefab(go, "TutorialListButton").GetComponent<Button>();
        }

        // ================= 場景 =================

        static void BuildScene(CardView cardPrefab, Button bidPrefab, FloatingText floatPrefab, Button listPrefab)
        {
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

            // ---------- 牌桌：版面跟原版一樣，多了暫停、提示開關、白話提示框、教學說明框 ----------
            var table = NewRect("Table", canvas);
            Stretch(table);
            table.gameObject.AddComponent<Image>().color = Felt;
            var shakeGate = table.gameObject.AddComponent<ShakeGate>();

            var status = Place(AddText(NewRect("Status", table), "抽牌階段", 30, FeltInk), 0, 1, 40, -36, 400, 50, TextAlignmentOptions.Left);
            var score = Place(AddText(NewRect("Score", table), "第 1 局｜你 0 · 電腦 0｜先到 100 分", 24, Gold), 0, 1, 40, -92, 460, 40, TextAlignmentOptions.Left);
            var info = Place(AddText(NewRect("Info", table), "", 26, FeltInk), 0.5f, 1, 0, -50, 900, 80, TextAlignmentOptions.Center);
            var oppCount = Place(AddText(NewRect("OppCount", table), "電腦：13 張", 28, FeltInk), 1, 1, -40, -36, 220, 50, TextAlignmentOptions.Right);
            var pauseBtn = MakeButton("Pause", table, "暫停", 1, 1, -330, -61, 140, 48, Paper, Ink);
            var hintToggle = MakeButton("HintToggle", table, "提示：開", 0, 1, 380, -164, 200, 52, Paper, Ink);

            var oppAnchor = Anchor("OppAnchor", table, 0.5f, 1, 0, -160);
            var oppSlot = Anchor("OppSlot", table, 0.5f, 0.5f, 0, 110);
            var mySlot = Anchor("MySlot", table, 0.5f, 0.5f, 0, -60);
            var faceUpSlot = Anchor("FaceUpSlot", table, 0, 0.5f, 220, 40);
            var faceUpLabel = Place(AddText(NewRect("FaceUpLabel", table), "明牌", 24, FeltInk), 0, 0.5f, 120, 130, 200, 40, TextAlignmentOptions.Center);
            var centerAnchor = Anchor("CenterAnchor", table, 0.5f, 0.5f, 0, 30);
            var myAnchor = Anchor("MyAnchor", table, 0.5f, 0, 0, 300);

            var memo = Place(AddText(NewRect("Memo", table), "", 22, FeltInk), 0, 0, 40, 330, 520, 90, TextAlignmentOptions.TopLeft);
            var message = Place(AddText(NewRect("Message", table), "", 24, FeltInk), 1, 0, -40, 330, 620, 110, TextAlignmentOptions.BottomRight);

            var turnTmp = Place(AddText(NewRect("TurnText", table), "輪到你", 40, Gold), 0.5f, 0, 0, 262, 400, 60, TextAlignmentOptions.Center);
            turnTmp.fontStyle = FontStyles.Bold;
            var turnFx = turnTmp.gameObject.AddComponent<TextFX>();

            var hand = NewRect("Hand", table);
            SetAnchor(hand, 0.5f, 0, 0, 100, 1500, 140);
            var hlg = hand.gameObject.AddComponent<HorizontalLayoutGroup>();
            hlg.spacing = 6; hlg.childAlignment = TextAnchor.MiddleCenter;
            hlg.childControlWidth = hlg.childControlHeight = false;
            hlg.childForceExpandWidth = hlg.childForceExpandHeight = false;

            // 叫牌紀錄（左）
            var auctionPanel = Panel("AuctionPanel", table, 0, 0.5f, 40, 80, 400, 360, FeltDark);
            var auctionText = PaddedText(auctionPanel, "<b>叫牌紀錄</b>", 24, 22, 16);
            var auctionToggle = MakeButton("AuctionToggle", table, "叫牌紀錄", 0, 1, 150, -164, 220, 52, Paper, Ink);   // 比原版低 8px，不跟計分列重疊

            // 叫牌面板（右）
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
            AutoSize(bidPreview, 15, 21);
            var confirmBid = MakeButton("ConfirmBid", bidPanel, "叫", 0.5f, 0, -135, 40, 170, 56, Gold, Ink);
            var pass = MakeButton("Pass", bidPanel, "Pass", 0.5f, 0, 20, 40, 120, 56, Paper, Ink);
            var dbl = MakeButton("Double", bidPanel, "加倍", 0.5f, 0, 155, 40, 130, 56, Paper, Hex("B8233A"));

            // 局末結算（比原版低一點，讓出上方給教學說明框）
            var resultPanel = Panel("ResultPanel", table, 0.5f, 0.5f, 0, -70, 760, 500, new Color(FeltDark.r, FeltDark.g, FeltDark.b, 0.97f));
            var resultTitle = Place(AddText(NewRect("Title", resultPanel), "第 1 局結算", 52, FeltInk), 0.5f, 1, 0, -24, 700, 72, TextAlignmentOptions.Center);
            resultTitle.fontStyle = FontStyles.Bold;
            var resultTitleFx = resultTitle.gameObject.AddComponent<TextFX>();
            var resultBody = Place(AddText(NewRect("Body", resultPanel), "", 28, FeltInk), 0.5f, 1, 0, -104, 680, 300, TextAlignmentOptions.Top);
            resultBody.lineSpacing = 8;
            AutoSize(resultBody, 18, 28);
            var newHand = MakeButton("NewHand", resultPanel, "下一局", 0.5f, 0, 0, 52, 280, 68, Gold, Ink);

            // 白話提示框（人機對戰、連線、第五章）和教學說明框（第一～四章）共用同一個位置
            var coachPanel = Panel("CoachPanel", table, 0.5f, 1, -30, -148, 900, 210, new Color(FeltDark.r, FeltDark.g, FeltDark.b, 0.92f));
            var coachText = PaddedText(coachPanel, "", 22, 20, 12);
            AutoSize(coachText, 15, 22);

            var lessonPanel = Panel("LessonPanel", table, 0.5f, 1, -30, -148, 900, 210, new Color(0.11f, 0.2f, 0.18f, 0.97f));
            var lessonTitle = Place(AddText(NewRect("Title", lessonPanel), "第一章・搶明牌", 26, Gold), 0.5f, 1, 0, -10, 860, 36, TextAlignmentOptions.Left);
            lessonTitle.fontStyle = FontStyles.Bold;
            var lessonBody = Place(AddText(NewRect("Body", lessonPanel), "", 22, FeltInk), 0.5f, 1, 0, -48, 860, 112, TextAlignmentOptions.TopLeft);
            AutoSize(lessonBody, 15, 22);
            var lessonHint = Place(AddText(NewRect("Hint", lessonPanel), "", 21, Hex("F28B8B")), 0.5f, 0, -170, 10, 520, 40, TextAlignmentOptions.Left);
            AutoSize(lessonHint, 14, 21);
            var lessonPrimary = MakeButton("Primary", lessonPanel, "下一題", 1, 0, -95, 30, 170, 46, Gold, Ink);
            var lessonRestart = MakeButton("Restart", lessonPanel, "重來這題", 1, 0, -275, 30, 170, 46, Paper, Ink);

            // ---------- 跳字層：最上面、不擋點擊 ----------
            var fxLayer = NewRect("FxLayer", canvas);
            Stretch(fxLayer);
            var fxGroup = fxLayer.gameObject.AddComponent<CanvasGroup>();
            fxGroup.blocksRaycasts = false; fxGroup.interactable = false;

            // ---------- 主選單（蓋在牌桌和跳字上面） ----------
            var menuRoot = NewRect("Menu", canvas);
            Stretch(menuRoot);
            menuRoot.gameObject.AddComponent<Image>().color = Shade;

            // 主畫面
            var mainPanel = Group("Main", menuRoot);
            var title = Place(AddText(NewRect("Title", mainPanel), "蜜月橋牌", 96, FeltInk), 0.5f, 0.5f, 0, 300, 900, 130, TextAlignmentOptions.Center);
            title.fontStyle = FontStyles.Bold;
            Place(AddText(NewRect("Subtitle", mainPanel), "教學版 · 兩個人的橋牌", 32, Gold), 0.5f, 0.5f, 0, 210, 900, 50, TextAlignmentOptions.Center);
            var progress = Place(AddText(NewRect("Progress", mainPanel), "", 26, FeltInk), 0.5f, 0.5f, 0, 145, 1000, 44, TextAlignmentOptions.Center);
            var battleBtn = MakeButton("Battle", mainPanel, "開始對戰", 0.5f, 0.5f, 0, 40, 460, 84, Gold, Ink);
            var chaptersBtn = MakeButton("Chapters", mainPanel, "章節教學", 0.5f, 0.5f, 0, -70, 460, 84, Paper, Ink);
            var settingsBtn = MakeButton("Settings", mainPanel, "設定", 0.5f, 0.5f, 0, -180, 460, 84, Paper, Ink);
            var guideBtn = MakeButton("Guide", mainPanel, "遊戲介紹", 0.5f, 0.5f, 0, -290, 460, 84, Paper, Ink);

            // 開始對戰
            var battlePanel = Group("Battle", menuRoot);
            Place(AddText(NewRect("Title", battlePanel), "開始對戰", 64, FeltInk), 0.5f, 0.5f, 0, 300, 900, 90, TextAlignmentOptions.Center);
            var solo = MakeButton("Solo", battlePanel, "人機對戰", 0.5f, 0.5f, 0, 150, 460, 84, Gold, Ink);
            var hostBtn = MakeButton("Host", battlePanel, "建立房間", 0.5f, 0.5f, 0, 40, 460, 84, Paper, Ink);
            var code = MakeInput("CodeInput", battlePanel, "輸入朋友的房號", 0.5f, 0.5f, -70, -75, 320, 76);
            var join = MakeButton("Join", battlePanel, "加入", 0.5f, 0.5f, 170, -75, 120, 76, Paper, Ink);
            var battleStatus = Place(AddText(NewRect("Status", battlePanel), "人機對戰：跟電腦打；建立房間：拿到房號傳給朋友", 26, FeltInk), 0.5f, 0.5f, 0, -200, 1100, 120, TextAlignmentOptions.Center);
            var battleBack = MakeButton("Back", battlePanel, "返回", 0.5f, 0.5f, 0, -340, 260, 68, Paper, Ink);

            // 章節教學
            var chaptersPanel = Group("Chapters", menuRoot);
            Place(AddText(NewRect("Title", chaptersPanel), "章節教學", 64, FeltInk), 0.5f, 0.5f, 0, 390, 900, 90, TextAlignmentOptions.Center);
            var chapterList = NewRect("ChapterList", chaptersPanel);
            SetAnchor(chapterList, 0.5f, 0.5f, 0, 20, 900, 560);
            chapterList.pivot = new Vector2(0.5f, 0.5f);
            var vlg = chapterList.gameObject.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 14; vlg.childAlignment = TextAnchor.UpperCenter;
            vlg.childControlWidth = true; vlg.childForceExpandWidth = true;
            vlg.childControlHeight = true; vlg.childForceExpandHeight = false;
            var chaptersBack = MakeButton("Back", chaptersPanel, "返回", 0.5f, 0.5f, 0, -350, 260, 68, Paper, Ink);

            // 設定
            var settingsPanel = Group("Settings", menuRoot);
            Place(AddText(NewRect("Title", settingsPanel), "設定", 64, FeltInk), 0.5f, 0.5f, 0, 300, 900, 90, TextAlignmentOptions.Center);
            var speedBtn = MakeButton("Speed", settingsPanel, "動畫速度：標準", 0.5f, 0.5f, 0, 160, 560, 76, Paper, Ink);
            var shakeBtn = MakeButton("Shake", settingsPanel, "畫面震動：開", 0.5f, 0.5f, 0, 60, 560, 76, Paper, Ink);
            var hintsBtn = MakeButton("Hints", settingsPanel, "教學提示：開", 0.5f, 0.5f, 0, -40, 560, 76, Paper, Ink);
            var resetBtn = MakeButton("ResetProgress", settingsPanel, "重設教學進度", 0.5f, 0.5f, 0, -140, 560, 76, Paper, Ink);
            Place(AddText(NewRect("Note", settingsPanel), "點一下就切換。動畫速度會一起調整停頓和電腦思考的時間。", 24, FeltInk), 0.5f, 0.5f, 0, -235, 1100, 44, TextAlignmentOptions.Center);
            var settingsBack = MakeButton("Back", settingsPanel, "返回", 0.5f, 0.5f, 0, -340, 260, 68, Paper, Ink);

            // 遊戲介紹
            var guidePanel = Group("Guide", menuRoot);
            Place(AddText(NewRect("Title", guidePanel), "遊戲介紹", 64, FeltInk), 0.5f, 0.5f, 0, 420, 900, 90, TextAlignmentOptions.Center);
            var tabs = NewRect("Tabs", guidePanel);
            SetAnchor(tabs, 0.5f, 0.5f, 0, 330, 900, 70);
            tabs.pivot = new Vector2(0.5f, 0.5f);
            var tlg = tabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            tlg.spacing = 16; tlg.childAlignment = TextAnchor.MiddleCenter;
            tlg.childControlWidth = tlg.childControlHeight = true;
            tlg.childForceExpandWidth = tlg.childForceExpandHeight = true;
            var guideBox = Panel("Body", guidePanel, 0.5f, 0.5f, 0, -20, 1160, 600, FeltDark);
            guideBox.pivot = new Vector2(0.5f, 0.5f);
            var guideBody = PaddedText(guideBox, "", 26, 34, 24);
            AutoSize(guideBody, 18, 28);
            guideBody.lineSpacing = 6;
            var guideBack = MakeButton("Back", guidePanel, "返回", 0.5f, 0.5f, 0, -400, 260, 68, Paper, Ink);

            // 暫停
            var pausePanel = Group("Pause", menuRoot);
            Place(AddText(NewRect("Title", pausePanel), "暫停", 72, FeltInk), 0.5f, 0.5f, 0, 260, 900, 100, TextAlignmentOptions.Center);
            var resume = MakeButton("Resume", pausePanel, "繼續", 0.5f, 0.5f, 0, 120, 420, 80, Gold, Ink);
            var pauseGuide = MakeButton("Guide", pausePanel, "遊戲介紹", 0.5f, 0.5f, 0, 20, 420, 80, Paper, Ink);
            var pauseSettings = MakeButton("Settings", pausePanel, "設定", 0.5f, 0.5f, 0, -80, 420, 80, Paper, Ink);
            var pauseMenu = MakeButton("Menu", pausePanel, "回主選單", 0.5f, 0.5f, 0, -180, 420, 80, Paper, Ink);

            // ---------- 邏輯物件 ----------
            var nmGo = new GameObject("NetworkManager");
            var nm = nmGo.AddComponent<NetworkManager>();
            var transport = nmGo.AddComponent<UnityTransport>();
            nm.NetworkConfig = nm.NetworkConfig ?? new NetworkConfig();
            nm.NetworkConfig.NetworkTransport = transport;

            // 原版的莊家機台：單機和連線共用
            var tableLogic = new GameObject("TableLogic", typeof(NetworkObject), typeof(GameHost), typeof(LocalTable), typeof(NetTable));
            // 教學關卡的牌桌
            var tutorialLogic = new GameObject("TutorialLogic", typeof(TutorialTable));

            var gameGo = new GameObject("Game");
            var view = gameGo.AddComponent<GameView>();
            var fx = gameGo.AddComponent<FeedbackDirector>();

            var appGo = new GameObject("TutorialApp");
            var app = appGo.AddComponent<TutorialApp>();
            var menu = appGo.AddComponent<TutorialMenu>();
            var director = appGo.AddComponent<TutorialDirector>();
            var coach = appGo.AddComponent<CoachPanel>();

            // ---------- 接線 ----------
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
            Wire(app,
                ("view", view), ("host", tableLogic.GetComponent<GameHost>()),
                ("localTable", tableLogic.GetComponent<LocalTable>()), ("netTable", tableLogic.GetComponent<NetTable>()),
                ("tutorialTable", tutorialLogic.GetComponent<TutorialTable>()), ("director", director), ("coach", coach),
                ("shakeGate", shakeGate), ("menu", menu),
                ("pauseButton", pauseBtn), ("hintToggle", hintToggle));
            Wire(director,
                ("table", tutorialLogic.GetComponent<TutorialTable>()), ("panel", lessonPanel.gameObject),
                ("titleText", lessonTitle), ("bodyText", lessonBody), ("hintText", lessonHint),
                ("primaryButton", lessonPrimary), ("restartButton", lessonRestart));
            Wire(coach,
                ("root", coachPanel.gameObject), ("body", coachText));
            Wire(menu,
                ("root", menuRoot.gameObject), ("listButtonPrefab", listPrefab),
                ("mainPanel", mainPanel.gameObject), ("battleButton", battleBtn), ("chaptersButton", chaptersBtn),
                ("settingsButton", settingsBtn), ("guideButton", guideBtn), ("progressText", progress),
                ("battlePanel", battlePanel.gameObject), ("soloButton", solo), ("hostButton", hostBtn), ("joinButton", join),
                ("codeInput", code), ("battleStatus", battleStatus), ("battleBack", battleBack),
                ("chaptersPanel", chaptersPanel.gameObject), ("chapterList", chapterList), ("chaptersBack", chaptersBack),
                ("settingsPanel", settingsPanel.gameObject), ("speedButton", speedBtn), ("shakeButton", shakeBtn),
                ("hintsButton", hintsBtn), ("resetProgressButton", resetBtn), ("settingsBack", settingsBack),
                ("guidePanel", guidePanel.gameObject), ("guideTabs", tabs), ("guideBody", guideBody), ("guideBack", guideBack),
                ("pausePanel", pausePanel.gameObject), ("resumeButton", resume), ("pauseGuideButton", pauseGuide),
                ("pauseSettingsButton", pauseSettings), ("pauseMenuButton", pauseMenu));
        }

        // ================= 小工具（跟原版的同名工具一樣，複製一份以免改到原版） =================

        static void Wire(Object target, params (string field, Object value)[] pairs)
        {
            var so = new SerializedObject(target);
            foreach (var (field, value) in pairs)
            {
                var p = so.FindProperty(field);
                if (p == null) { Debug.LogError($"[蜜月橋牌教學版] {target.GetType().Name} 找不到欄位 {field}"); continue; }
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

        // 選單裡的一頁：全螢幕、透明的容器
        static RectTransform Group(string name, RectTransform parent)
        {
            var rt = NewRect(name, parent);
            Stretch(rt);
            return rt;
        }

        static void Stretch(RectTransform rt)
        {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = rt.offsetMax = Vector2.zero;
        }

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

        static RectTransform Panel(string name, RectTransform parent, float ax, float ay, float x, float y, float w, float h, Color color)
        {
            var rt = NewRect(name, parent);
            SetAnchor(rt, ax, ay, x, y, w, h);
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = rounded; img.type = Image.Type.Sliced; img.color = color;
            return rt;
        }

        // 填滿底板、留邊的文字
        static TextMeshProUGUI PaddedText(RectTransform parent, string text, float size, float padX, float padY)
        {
            var t = AddText(NewRect("Text", parent), text, size, FeltInk);
            var rt = (RectTransform)t.transform;
            Stretch(rt);
            rt.offsetMin = new Vector2(padX, padY);
            rt.offsetMax = new Vector2(-padX, -padY);
            t.alignment = TextAlignmentOptions.TopLeft;
            return t;
        }

        static void AutoSize(TextMeshProUGUI t, float min, float max)
        {
            t.enableAutoSizing = true;
            t.fontSizeMin = min;
            t.fontSizeMax = max;
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

        // 只寫入教學版自己的 Prefab 資料夾；同名檔案已存在就不寫（LoadOrBuild 會先沿用它）
        static GameObject SavePrefab(GameObject go, string name)
        {
            var path = $"{PrefabDir}/{name}.prefab";
            if (AssetDatabase.LoadAssetAtPath<GameObject>(path) != null)
                path = AssetDatabase.GenerateUniqueAssetPath(path);
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

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString("#" + hex, out var c);
            return c;
        }
    }
}
