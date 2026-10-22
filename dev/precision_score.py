"""Physical precision score for the coastal interface.

A number to optimise against, built from probes that each have a known correct answer.

    SCORE=probes.json node dev/headless_harness.js index.html
    python dev/precision_score.py probes.json [--json]

Eight sub-scores, each 1.0 when perfect and 0.0 at tolerance, averaged into a composite out
of 100. Every tolerance is stated here so the score is arguable rather than mystical, and a
sub-score of 0 means "at or past the limit of what this model should be allowed to claim".

Why these eight: they separate the things that can be wrong independently. A model can
conserve volume perfectly and still put the bar in the wrong place; it can match XBeach's
storm profile and still fail to hold a calm beach still. Collapsing them into one number
without the breakdown hides which one moved.
"""
import json
import sys

# --- tolerances: at this error the sub-score reaches 0. Raise a tolerance only with a reason
#     written next to it, because loosening one is how a bad model starts scoring well.
TOL = {
    "calm_rate_m":     0.01,   # m over the SECOND 100 model days: does it keep moving?
    # Settle is scored as RMS over the active bed, not as max. A single cell out of 11,500
    # sitting 0.2 m off is not an accuracy failure of a 600 m x 400 m beach; the RMS is what
    # describes whether the seeded profile is the equilibrium. The max is still reported.
    "calm_settle_rms_m": 0.05,
    "flux_resid":      0.05,   # relative sd of H^2*Cg along a non-breaking column (exact: 0)
    "cerc_r2":         0.98,   # CERC is exactly sin(2a); below this the fit is not CERC
    "vol_drift":       0.01,   # relative change in total bed volume (exact: 0)
    "profile_rmse_m":  0.30,   # rmse of the 121-point storm dz profile against XBeach
    "barpos_m":        40.0,   # |bar crest position error| against XBeach
    "erosion_rel":     0.30,   # relative error in peak erosion depth
    "accretion_rel":   0.60,   # relative error in peak accretion height
}

W = {  # equal weight by default; these are separate failure modes, not one thing
    "calm_rate": 1.0, "calm_settle": 1.0, "flux": 1.0, "cerc": 1.0, "volume": 1.0,
    "profile": 1.0, "barpos": 1.0, "erosion": 1.0, "accretion": 1.0,
}


def clamp01(x):
    return max(0.0, min(1.0, x))


def case_scores(dz, xb, dx):
    n = min(len(dz), len(xb))
    rmse = (sum((dz[i] - xb[i]) ** 2 for i in range(n)) / n) ** 0.5

    e_b = min(dz)
    a_b = max(dz)
    a_j = dz.index(a_b)
    E_b = min(xb)
    A_b = max(xb)
    A_j = xb.index(A_b)

    barpos = abs(a_j * dx - A_j * dx)
    ero = abs(e_b - E_b) / max(abs(E_b), 1e-6)
    acc = abs(a_b - A_b) / max(abs(A_b), 1e-6)
    return {
        "rmse": rmse, "barpos": barpos, "erosion": ero, "accretion": acc,
        "profile": clamp01(1 - rmse / TOL["profile_rmse_m"]),
        "barpos_s": clamp01(1 - barpos / TOL["barpos_m"]),
        "erosion_s": clamp01(1 - ero / TOL["erosion_rel"]),
        "accretion_s": clamp01(1 - acc / TOL["accretion_rel"]),
    }


def score(probes, refs):
    # Both XBeach cases are scored and averaged. Only the storm case was ever used for
    # calibration, so a change that helps the storm and hurts the moderate case is not an
    # improvement -- it is a fit.
    cases = []
    for name, dz in (("storm", probes.get("storm_dz")), ("moderate", probes.get("case2_dz"))):
        if not dz:
            continue
        ref = refs[name]
        xb = ref["finalDz"]
        cases.append((name, case_scores(dz, xb, ref["meta"]["reachCross"] / (len(xb) - 1))))

    s = {
        "calm_rate":   clamp01(1 - probes.get("calm_late_max", 0) / TOL["calm_rate_m"]),
        "calm_settle": clamp01(1 - probes.get("init_diseq_rms", 0) / TOL["calm_settle_rms_m"]),
        "flux":        clamp01(1 - probes["flux_resid"] / TOL["flux_resid"]),
        "cerc":        clamp01((probes["cerc_r2"] - TOL["cerc_r2"]) / (1 - TOL["cerc_r2"])),
        "volume":      clamp01(1 - probes["vol_drift"] / TOL["vol_drift"]),
    }
    for key in ("profile", "barpos_s", "erosion_s", "accretion_s"):
        s[key.replace("_s", "")] = sum(c[1][key] for c in cases) / max(len(cases), 1)

    measured = {
        "calm_rate_m": round(probes.get("calm_late_max", 0), 5),
        "calm_settle_rms_m": round(probes.get("init_diseq_rms", 0), 5),
        "flux_resid": round(probes["flux_resid"], 4),
        "cerc_r2": round(probes["cerc_r2"], 5),
        "vol_drift": probes["vol_drift"],
        "cases": {n: {k: round(v, 4) for k, v in c.items()
                      if k in ("rmse", "barpos", "erosion", "accretion")} for n, c in cases},
    }
    total = sum(s.values()) / len(s) * 100
    return s, measured, total, cases


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: precision_score.py <probes.json> [--json]")
    probes = json.load(open(sys.argv[1], encoding="utf-8"))
    here = __file__.replace("\\", "/").rsplit("/", 1)[0]
    refs = {"storm": json.load(open(here + "/xbeach-reference.json", encoding="utf-8")),
            "moderate": json.load(open(here + "/xbeach-reference-2.json", encoding="utf-8"))}

    s, m, total, cases = score(probes, refs)

    if "--json" in sys.argv:
        print(json.dumps({"score": round(total, 1), "subscores": {k: round(v, 3) for k, v in s.items()},
                          "measured": m}, indent=1))
        return

    print("PRECISION SCORE\n")
    rows = [
        ("calm_rate",   "calm drift, 2nd 100d (m)", m["calm_rate_m"],       TOL["calm_rate_m"]),
        ("calm_settle", "seeded diseq rms (m)",     m["calm_settle_rms_m"], TOL["calm_settle_rms_m"]),
        ("flux",        "flux residual",            m["flux_resid"],        TOL["flux_resid"]),
        ("cerc",        "CERC r2",                  m["cerc_r2"],           TOL["cerc_r2"]),
        ("volume",      "volume drift",             m["vol_drift"],         TOL["vol_drift"]),
    ]
    for key, label, val, tol in rows:
        flag = "  <-- AT LIMIT" if s[key] <= 0.001 else ""
        print(f"  {label:28} {val:>10.5g}   tol {tol:<7g} score {s[key]:5.2f}{flag}")

    print("\n  XBeach cases (only the storm case was calibrated):")
    for name, c in cases:
        print(f"    {name:9} rmse {c['rmse']:.3f} m | barpos {c['barpos']:4.0f} m | "
              f"ero {c['erosion']:5.2f} | acc {c['accretion']:5.2f}")
    for key, label in (("profile", "profile rmse"), ("barpos", "bar position"),
                       ("erosion", "peak erosion"), ("accretion", "peak accretion")):
        print(f"    mean {label:16} score {s[key]:5.2f}")

    print(f"\n  COMPOSITE {total:.1f} / 100")
    weakest = sorted(s, key=lambda k: s[k])[:2]
    print(f"  weakest: {', '.join(weakest)}")


if __name__ == "__main__":
    main()
