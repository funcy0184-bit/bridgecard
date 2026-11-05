#!/usr/bin/env python3
"""檢查「建立教學場景」接線用的欄位名稱，是不是每一個都真的存在。

TutorialSceneBuilder 用字串指定要接哪個欄位，打錯字編譯器抓不到，這支會一個一個對。
同時檢查：建場景工具只寫入 Assets/HoneymoonBridgeTutorial/、不碰 Build Settings。

用法：python3 tools/HoneymoonBridgeTutorial/check_tutorial_wiring.py
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BUILDER = REPO / "Assets/HoneymoonBridgeTutorial/Scripts/Editor/TutorialSceneBuilder.cs"
TARGETS = {   # Wire(變數名, ...) → 那個變數對應的腳本
    "view": "Assets/HoneymoonBridge/Scripts/View/GameView.cs",
    "fx": "Assets/HoneymoonBridge/Scripts/FX/FeedbackDirector.cs",
    "app": "Assets/HoneymoonBridgeTutorial/Scripts/Runtime/TutorialApp.cs",
    "director": "Assets/HoneymoonBridgeTutorial/Scripts/Runtime/TutorialDirector.cs",
    "coach": "Assets/HoneymoonBridgeTutorial/Scripts/Runtime/CoachPanel.cs",
    "menu": "Assets/HoneymoonBridgeTutorial/Scripts/Runtime/TutorialMenu.cs",
}

builder = BUILDER.read_text(encoding="utf-8")
ok = True
for var, rel in TARGETS.items():
    src = (REPO / rel).read_text(encoding="utf-8")
    # 只算 Object 參考（UnityEngine 物件）欄位；float / Color 這類有預設值的不用接
    fields = set(re.findall(r"\[SerializeField\]\s+(?!float|int|bool|Color)\w+\s+(\w+)\s*;", src))
    m = re.search(r"Wire\(" + var + r",(.*?)\);", builder, re.S)
    if not m:
        print(f"✗ 找不到 Wire({var}, ...)"); ok = False; continue
    wired = re.findall(r'\("(\w+)"', m.group(1))
    missing = [w for w in wired if w not in fields]
    unwired = sorted(fields - set(wired))
    dup = sorted({w for w in wired if wired.count(w) > 1})
    if missing or unwired or dup:
        ok = False
        if missing: print(f"✗ {rel}：接了不存在的欄位 {missing}")
        if unwired: print(f"✗ {rel}：有欄位沒接到 {unwired}")
        if dup: print(f"✗ {rel}：同一個欄位接了兩次 {dup}")
    else:
        print(f"✓ {Path(rel).name}：{len(wired)} 個欄位都接對了")

# 建場景工具的安全規則
paths = re.findall(r'"(Assets/[^"]*)"', builder)
bad = [p for p in paths if not p.startswith("Assets/HoneymoonBridgeTutorial")]
if bad: print(f"✗ 建場景工具寫到教學版以外的路徑：{bad}"); ok = False
if "EditorBuildSettings" in builder: print("✗ 建場景工具不該修改 Build Settings"); ok = False
if not re.search(r"if \(existing != null \|\| File\.Exists\(ScenePath\)\)", builder):
    print("✗ 找不到「場景已存在就不重建」的檢查"); ok = False
if ok: print("✓ 建場景工具只寫入 Assets/HoneymoonBridgeTutorial/、不改 Build Settings、場景已存在就不覆寫")

sys.exit(0 if ok else 1)
