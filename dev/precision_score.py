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


def score(probes, ref):
    dz = probes["storm_dz"]
    xb = ref["finalDz"]
    n = min(len(dz), len(xb))
    rmse = (sum((dz[i] - xb[i]) ** 2 for i in range(n)) / n) ** 0.5

    def peak(a):
        i = min(range(len(a)), key=lambda k: a[k])
        j = max(range(len(a)), key=lambda k: a[k])
        return a[i], i, a[j], j

    e_b, e_i, a_b, a_j = peak(dz)
    E_b, E_i, A_b, A_j = peak(xb)

    dx = ref["meta"]["reachCross"] / (len(xb) - 1)
    barpos = abs(a_j * dx - A_j * dx)
    ero_rel = abs(e_b - E_b) / max(abs(E_b), 1e-6)
    acc_rel = abs(a_b - A_b) / max(abs(A_b), 1e-6)

    s = {
        "calm_rate":   clamp01(1 - probes.get("calm_late_max", 0) / TOL["calm_rate_m"]),
        "calm_settle": clamp01(1 - probes.get("init_diseq_rms", 0) / TOL["calm_settle_rms_m"]),
        "flux":      clamp01(1 - probes["flux_resid"] / TOL["flux_resid"]),
        "cerc":      clamp01((probes["cerc_r2"] - TOL["cerc_r2"]) / (1 - TOL["cerc_r2"])),
        "volume":    clamp01(1 - probes["vol_drift"] / TOL["vol_drift"]),
        "profile":   clamp01(1 - rmse / TOL["profile_rmse_m"]),
        "barpos":    clamp01(1 - barpos / TOL["barpos_m"]),
        "erosion":   clamp01(1 - ero_rel / TOL["erosion_rel"]),
        "accretion": clamp01(1 - acc_rel / TOL["accretion_rel"]),
    }
    measured = {
        "calm_rate_m": round(probes.get("calm_late_max", 0), 5),
        "calm_settle_m": round(probes.get("init_diseq_rms", 0), 5),
        "calm_settle_max": round(probes["calm_drift"], 4),
        "flux_resid": round(probes["flux_resid"], 4),
        "cerc_r2": round(probes["cerc_r2"], 5),
        "vol_drift": probes["vol_drift"],
        "profile_rmse_m": round(rmse, 4),
        "barpos_m": round(barpos, 1),
        "erosion_rel": round(ero_rel, 4),
        "accretion_rel": round(acc_rel, 4),
        "shoaling_exp": round(probes.get("shoaling_exp") or 0, 3),
    }
    total = sum(s[k] * W[k] for k in s) / sum(W.values()) * 100
    return s, measured, total


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: precision_score.py <probes.json> [--json]")
    probes = json.load(open(sys.argv[1], encoding="utf-8"))
    here = __file__.replace("\\", "/").rsplit("/", 1)[0]
    ref = json.load(open(here + "/xbeach-reference.json", encoding="utf-8"))

    s, m, total = score(probes, ref)

    if "--json" in sys.argv:
        print(json.dumps({"score": round(total, 1), "subscores": {k: round(v, 3) for k, v in s.items()},
                          "measured": m}, indent=1))
        return

    print("PRECISION SCORE\n")
    rows = [
        ("calm_rate",   "calm drift, 2nd 100d (m)",  m["calm_rate_m"],   TOL["calm_rate_m"]),
        ("calm_settle", "seeded diseq rms (m)",      m["calm_settle_m"], TOL["calm_settle_rms_m"]),
        ("flux",      "flux residual",            m["flux_resid"],     TOL["flux_resid"]),
        ("cerc",      "CERC r2",                  m["cerc_r2"],        TOL["cerc_r2"]),
        ("volume",    "volume drift",             m["vol_drift"],      TOL["vol_drift"]),
        ("profile",   "storm profile rmse (m)",   m["profile_rmse_m"], TOL["profile_rmse_m"]),
        ("barpos",    "bar position err (m)",     m["barpos_m"],       TOL["barpos_m"]),
        ("erosion",   "peak erosion rel err",     m["erosion_rel"],    TOL["erosion_rel"]),
        ("accretion", "peak accretion rel err",   m["accretion_rel"],  TOL["accretion_rel"]),
    ]
    for key, label, val, tol in rows:
        flag = "  <-- AT LIMIT" if s[key] <= 0.001 else ""
        print(f"  {label:24} {val:>10.5g}   tol {tol:<7g} score {s[key]:5.2f}{flag}")
    print()
    print(f"  COMPOSITE {total:.1f} / 100")
    weakest = sorted(s, key=lambda k: s[k])[:2]
    print(f"  weakest: {', '.join(weakest)}")


if __name__ == "__main__":
    main()
