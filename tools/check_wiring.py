#!/usr/bin/env python3
"""檢查「一鍵建立場景」接線用的欄位名稱，是不是每一個都真的存在。

HoneymoonSceneBuilder 用字串指定要接哪個欄位（例如 ("scoreText", score)），
打錯字時編譯器不會報錯，要到 Unity 裡按選單才會在 Console 噴紅字。這支腳本先幫你抓。

用法：python3 tools/check_wiring.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "Assets/HoneymoonBridge/Scripts"
BUILDER = ROOT / "Editor/HoneymoonSceneBuilder.cs"
# Wire(變數名, ...) → 那個變數對應的腳本
TARGETS = {
    "view": "View/GameView.cs",
    "fx": "FX/FeedbackDirector.cs",
    "sessionMenu": "Net/SessionMenu.cs",
}

builder = BUILDER.read_text(encoding="utf-8")
ok = True
for var, rel in TARGETS.items():
    src = (ROOT / rel).read_text(encoding="utf-8")
    fields = set(re.findall(r"\[SerializeField\][^;]*?\b(\w+)\s*(?:=[^;]*)?;", src))
    m = re.search(r"Wire\(" + var + r",(.*?)\);", builder, re.S)
    if not m:
        print(f"✗ 找不到 Wire({var}, ...)")
        ok = False
        continue
    wired = re.findall(r'\("(\w+)"', m.group(1))
    missing = [w for w in wired if w not in fields]
    dup = sorted({w for w in wired if wired.count(w) > 1})
    if missing or dup:
        ok = False
        if missing: print(f"✗ {rel}：場景工具接了不存在的欄位 {missing}")
        if dup: print(f"✗ {rel}：同一個欄位接了兩次 {dup}")
    else:
        print(f"✓ {rel}：{len(wired)} 個欄位都接對了")

sys.exit(0 if ok else 1)
