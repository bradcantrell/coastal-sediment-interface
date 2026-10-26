"""Sweep the two bar-shape parameters against the precision score.

Both knob values are physical: `wDep` is how broadly the undertow discharge spreads as it
dies seaward of the break, and `maxDrop` is how deep a storm can cut before the profile
reaches its own equilibrium. Neither is a fudge factor for one XBeach run -- they are swept
across BOTH cases and the score averages the two, so a value that fits one at the other's
expense gains nothing.

Restores the source when it finishes.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

APP = Path(r"D:/workspace/coastal-sediment-interface/index.html")
HARNESS = Path(r"D:/workspace/coastal_headless_v2.js")
SCORER = Path(r"D:/workspace/coastal-sediment-interface/dev/precision_score.py")
ORIG = APP.read_text(encoding="utf-8")

WDEP = re.compile(r"const wDep = Math\.max\([\d.]+ \* Yb, \d+\);")
DROP = re.compile(r"const maxDrop = Math\.max\([\d.]+ \* stormNow \* conditions\.Hs, [\d.]+\);")

grid = [(w, d) for d in (0.68, 0.55) for w in (0.5, 0.85, 1.3, 1.9)]
rows = []

try:
    for w, d in grid:
        text = WDEP.sub(f"const wDep = Math.max({w} * Yb, 60);", ORIG, count=1)
        text = DROP.sub(f"const maxDrop = Math.max({d} * stormNow * conditions.Hs, 0.05);", text, count=1)
        APP.write_text(text, encoding="utf-8")

        run = subprocess.run(["node", str(HARNESS), str(APP).replace("/", "\\")],
                             cwd=r"D:/workspace", capture_output=True, text=True,
                             env={**os.environ, "SCORE": r"D:/workspace/_sw.json"})
        if "HARNESS PASS" not in run.stdout:
            rows.append((w, d, None, "harness fail"))
            print(f"  wDep {w} maxDrop {d}: harness FAIL")
            continue

        out = subprocess.run([sys.executable, str(SCORER), r"D:/workspace/_sw.json", "--json"],
                             capture_output=True, text=True)
        try:
            d0 = json.loads(out.stdout)
        except Exception:
            print(f"  wDep {w} maxDrop {d}: score parse failed"); continue

        m = d0["measured"]["cases"]
        rows.append((w, d, d0["score"], m))
        print(f"  wDep {w:4} maxDrop {d:4} -> {d0['score']:5.1f}  "
              f"storm rmse {m['storm']['rmse']:.3f} acc {m['storm']['accretion']:.2f} | "
              f"mod acc {m['moderate']['accretion']:.2f}")
finally:
    APP.write_text(ORIG, encoding="utf-8")
    print("restored original source")

good = [r for r in rows if isinstance(r[2], (int, float))]
if good:
    best = max(good, key=lambda r: r[2])
    print(f"\nbest: wDep {best[0]} maxDrop {best[1]} -> {best[2]}")
