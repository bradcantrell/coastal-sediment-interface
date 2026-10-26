"""Record an XBeach run as a reference profile, with a stated convention.

The existing references were recorded ad hoc and the convention was never written down, which
cost a full session of confusion. This fixes it:

  * zb.dat is a plain array of (nx+1)*(ny+1) doubles per output, NO header. The record stride
    is 121*41*8 = 39688 bytes. Reading it with the cell count 120*40 = 4800 instead scrambles
    the array and flattens the alongshore mean by a factor of six -- the bar appears to vanish.
  * the initial bed is bed.dep, ASCII, also (ny+1) x (nx+1).
  * finalDz is the ALONGSHORE MEAN of (final - initial), which is the profile an
    alongshore-uniform plan-form model should match. The alongshore spread is reported too,
    because a mean that hides a large spread is telling you the run is not uniform and a
    single row would overstate the response.
"""
import json
import sys
from pathlib import Path

import numpy as np

NX, NY = 121, 41          # staggered grid: (nx+1) x (ny+1)
REC = NX * NY * 8         # bytes per output record


def load(run: Path):
    zb = (run / "zb.dat").read_bytes()
    n = len(zb) // REC
    if n == 0:
        raise SystemExit(f"{run}/zb.dat is empty or truncated")
    z = np.frombuffer(zb, dtype="<f8", count=NX * NY, offset=(n - 1) * REC).reshape(NY, NX)
    init = np.loadtxt(run / "bed.dep").reshape(NY, NX)
    return z - init, n


def record(run: Path, meta: dict, out: Path):
    d, n = load(run)
    mean = d.mean(axis=0)
    lowest = min(float(d[j].min()) for j in range(NY))
    highest = max(float(d[j].max()) for j in range(NY))
    payload = {
        "about": (
            "XBeach result for the storm case exported by this interface. finalDz is the "
            "alongshore mean of (final - initial) bed over all 41 rows; rowSpread records the "
            "same extremes taken per row, which is the spread that mean is averaging over. "
            "modelDays is the morphology XBeach actually integrated (tstop x morfac)."
        ),
        "source": "xbeach st1.24 trunk, MSYS2/gfortran, serial, outputformat=fortran",
        "meta": meta,
        "nSlices": n,
        "rowSpread": {"min": round(lowest, 4), "max": round(highest, 4)},
        "finalDz": [round(float(v), 5) for v in mean],
        "summary": {
            "min": round(float(mean.min()), 4),
            "max": round(float(mean.max()), 4),
            "xMin": float(mean.argmin() * 5.0),
            "xMax": float(mean.argmax() * 5.0),
        },
    }
    out.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"{out.name}: {n} slices, mean dz {payload['summary']['min']:+.3f} .. "
          f"{payload['summary']['max']:+.3f}, row spread {lowest:+.3f} .. {highest:+.3f}")
    print(f"  erosion at x={payload['summary']['xMin']:.0f} m, accretion at "
          f"x={payload['summary']['xMax']:.0f} m")
    return payload


if __name__ == "__main__":
    # usage: record_xbeach.py <run dir> <tstop> <morfac> <out.json> [conditions.json]
    run = Path(sys.argv[1])
    tstop = int(float(sys.argv[2])) if len(sys.argv) > 2 else 21600
    morfac = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
    out = Path(sys.argv[4]) if len(sys.argv) > 4 else run / "reference.json"
    cond = {
        "Hs": 3.4, "Tp": 12.0, "dirDeg": -28, "spreadDeg": 18,
        "waterLevel": 0.8, "d50": 0.3,
    }
    if len(sys.argv) > 5:
        cond.update(json.loads(Path(sys.argv[5]).read_text(encoding="utf-8")))
    record(run, {
        "nx": 120, "ny": 40, "reachCross": 600, "reachAlong": 400,
        "dx": 5.0, "dy": 10.0,
        **cond,
        "tstop": tstop, "morfac": morfac,
        "duration_s": tstop, "modelDays": round(tstop * morfac / 86400.0, 3),
    }, out)
