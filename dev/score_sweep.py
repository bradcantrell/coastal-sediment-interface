"""Sweep the storm-bar amplitude against the precision score.

The score says peak accretion is 2.2x too large. The bar height in equilibriumZ is set by one
literal (0.35 * Hs * storm). This walks a few values, re-scores each, and restores the file,
so the metric can be shown to respond to a physics change rather than only to noise.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

APP = Path(r"D:/workspace/coastal-sediment-interface/index.html")
HARNESS = Path(r"D:/workspace/coastal_headless_v2.js")
SCORER = Path(r"D:/workspace/coastal-sediment-interface/dev/precision_score.py")
ORIG = APP.read_text(encoding="utf-8")

PATTERN = re.compile(r"storm \* ([\d.]+) \* conditions\.Hs \* Math\.exp")
m = PATTERN.search(ORIG)
assert m, "bar amplitude literal not found"
current = float(m.group(1))
print(f"current bar amplitude: {current}")

values = [float(v) for v in sys.argv[1:]] or [0.35, 0.25, 0.20, 0.15, 0.10]
results = []

try:
    for v in values:
        text = PATTERN.sub(f"storm * {v} * conditions.Hs * Math.exp", ORIG, count=1)
        APP.write_text(text, encoding="utf-8")

        run = subprocess.run(
            ["node", str(HARNESS), str(APP).replace("/", "\\")],
            cwd=r"D:/workspace", capture_output=True, text=True,
            env={**__import__("os").environ, "SCORE": r"D:/workspace/_sweep.json"})
        if "HARNESS PASS" not in run.stdout:
            print(f"  {v}: harness FAILED")
            continue

        out = subprocess.run([sys.executable, str(SCORER), r"D:/workspace/_sweep.json", "--json"],
                             capture_output=True, text=True)
        d = json.loads(out.stdout)
        results.append((v, d["score"], d["measured"]))
        print(f"  bar {v:<5} score {d['score']:5.1f}   "
              f"accretion {d['measured']['accretion_rel']:5.2f}  "
              f"erosion {d['measured']['erosion_rel']:5.2f}  "
              f"rmse {d['measured']['profile_rmse_m']:.3f}")
finally:
    APP.write_text(ORIG, encoding="utf-8")
    print("restored original source")

if results:
    best = max(results, key=lambda r: r[1])
    print(f"\nbest: bar {best[0]} -> score {best[1]:.1f}")
