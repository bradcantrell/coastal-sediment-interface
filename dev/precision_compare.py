"""Precision metric for rendering optimisations on the bed surface.

A speed change is only an optimisation if the output stays the same. This compares two
rasterized bed-surface buffers produced by `PRECISION=1 PRECISION_DUMP=... node
dev/headless_harness.js index.html` and reports how far apart they are.

Reported:
  MAE      mean absolute channel difference, 0..255
  RMSE     root mean square channel difference
  PSNR     20*log10(255/RMSE) dB -- above 40 dB is indistinguishable, below 30 is visible
  maxd     largest single-channel difference
  >8 / >32 percentage of pixels differing by more than 8 / 32 on any channel

Verdict thresholds are deliberately strict: a rendering change that is meant to be lossless
should sit above 40 dB with essentially no pixels beyond 8, because the only legitimate
difference between two correct rasterizations is edge rounding.
"""
import sys
import numpy as np

W, H, C = 1200, 800, 4

def load(path):
    a = np.fromfile(path, dtype=np.float32)
    if a.size != W * H * C:
        raise SystemExit(f"{path}: expected {W*H*C} floats, got {a.size}")
    return a.reshape(H, W, C)

def compare(ref_path, cand_path):
    ref = load(ref_path)
    cand = load(cand_path)
    d = np.abs(ref - cand)
    mae = float(d.mean())
    rmse = float(np.sqrt(((ref - cand) ** 2).mean()))
    psnr = float("inf") if rmse == 0 else 20 * np.log10(255.0 / rmse)
    maxd = float(d.max())
    anych = d.max(axis=2)
    pct8 = float((anych > 8).mean() * 100)
    pct32 = float((anych > 32).mean() * 100)

    print(f"reference : {ref_path}")
    print(f"candidate : {cand_path}")
    print()
    print(f"  MAE        {mae:9.4f}")
    print(f"  RMSE       {rmse:9.4f}")
    print(f"  PSNR       {psnr:9.2f} dB")
    print(f"  max diff   {maxd:9.1f}")
    print(f"  pixels >8  {pct8:9.4f} %")
    print(f"  pixels >32 {pct32:9.4f} %")
    print()
    if psnr >= 40 and pct8 < 0.05:
        verdict = "LOSSLESS (indistinguishable)"
    elif psnr >= 30 and pct8 < 2.0:
        verdict = "NEAR-LOSSLESS (minor edge differences)"
    else:
        verdict = "VISIBLY DIFFERENT -- not a lossless optimisation"
    print(f"  VERDICT    {verdict}")
    return psnr, pct8, verdict

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: precision_compare.py <reference.f32> <candidate.f32>")
    psnr, pct8, _ = compare(sys.argv[1], sys.argv[2])
    sys.exit(0 if (psnr >= 40 and pct8 < 0.05) else 1)
