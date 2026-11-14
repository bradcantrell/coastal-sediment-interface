"""Record an XBeach run as a reference profile, with a stated convention.

The existing references were recorded ad hoc and the convention was never written down, which
cost a full session of confusion. This fixes it:

  * zb.dat is a plain array of (nx+1)*(ny+1) doubles per output, NO header. The record stride
    is 121*41*8 = 39688 bytes. Reading it with the cell count 120*40 = 4800 instead scrambles
    the array and flattens the alongshore mean by a factor of six -- the bar appears to vanish.
  * the initial bed is bed.dep, ASCII, also (ny+1) x (nx+1).
  * finalDz is the mean of (final - initial) over the MIDDLE rows (MID, rows 12 to 28 of 41),
    which is the profile an alongshore-uniform plan-form model should match. It used to be
    the mean over all 41 rows. With oblique waves XBeach strips sand from the updrift side
    boundary (-114 m2 per metre of shore at the edge of the storm run, +5 in the middle), so
    the all-row mean overstated erosion and understated the bar. The all-row mean is kept as
    finalDzAllRows, and rowNet records the sand budget of each row so the edge effect stays
    visible.
  * history is the same middle-row profile summarised once per model day: where the crest
    and the centre of the deposit sit and how much has been deposited and eroded.
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
    init = np.loadtxt(run / "bed.dep").reshape(NY, NX)
    allz = np.frombuffer(zb, dtype="<f8", count=n * NX * NY).reshape(n, NY, NX)
    return allz[-1] - init, n, allz - init


MID = slice(12, 29)       # the middle rows, clear of both side boundaries


def summarise(prof, dx):
    pos = np.clip(prof, 0, None)
    x = np.arange(len(prof)) * dx
    return {
        "crestX": float(x[prof.argmax()]), "crestDz": round(float(prof.max()), 4),
        "centreX": round(float((pos * x).sum() / max(pos.sum(), 1e-9)), 1),
        "deposited": round(float(pos.sum() * dx), 2),
        "eroded": round(float(-np.clip(prof, None, 0).sum() * dx), 2),
        "deepest": round(float(prof.min()), 4), "deepestX": float(x[prof.argmin()]),
    }


def record(run: Path, meta: dict, out: Path):
    d, n, series = load(run)
    mean = d[MID].mean(axis=0)
    allrows = d.mean(axis=0)
    dx = meta.get("dx", 5.0)
    days = meta["modelDays"]
    per_day = max(int(round((n - 1) / days)), 1) if days else 1
    history = [dict(day=round(k / per_day, 2), **summarise(series[k][MID].mean(axis=0), dx))
               for k in range(per_day, n, per_day)]
    lowest = min(float(d[j].min()) for j in range(NY))
    highest = max(float(d[j].max()) for j in range(NY))
    payload = {
        "about": (
            "XBeach result for a case exported by this interface. finalDz is the mean of "
            "(final - initial) bed over the middle rows 12 to 28, clear of the side boundaries; "
            "finalDzAllRows is the same over all 41 rows; rowNet is each row's net sand change "
            "in m2 per metre of shore; rowSpread is the per-row extremes; history is the "
            "middle-row profile summarised once per model day. meta.modelDays is the "
            "morphology XBeach actually integrated (tstop x morfac)."
        ),
        "source": "xbeach st1.24 trunk, MSYS2/gfortran, serial, outputformat=fortran",
        "meta": meta,
        "nSlices": n,
        "rowSpread": {"min": round(lowest, 4), "max": round(highest, 4)},
        "midRows": [MID.start, MID.stop - 1],
        "finalDz": [round(float(v), 5) for v in mean],
        "finalDzAllRows": [round(float(v), 5) for v in allrows],
        "rowNet": [round(float(v), 1) for v in d.sum(axis=1) * dx],
        "history": history,
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
