"""Physical precision score for the coastal interface.

A number to optimise against, built from probes that each have a known correct answer.

    SCORE=probes.json node dev/headless_harness.js index.html
    python dev/precision_score.py probes.json [--json]

Nine sub-scores, each 1.0 when perfect and 0.0 at tolerance, averaged into a composite out
of 100. Every tolerance is stated here so the score is arguable rather than mystical, and a
sub-score of 0 means "at or past the limit of what this model should be allowed to claim".

Why these nine: they separate the things that can be wrong independently. A model can
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
    # Bar position is the centre of mass of everything deposited, not the crest. Changed
    # 2026-11-14 with the tolerance left at 40 m. The crest is the single highest sample of a
    # deposit about 150 m wide with a nearly flat top, in both models, so it jumps: differences
    # of a few centimetres moved it 35 m. This change raises the score (70.8 -> 72.3 on the
    # same probes), which is exactly the kind of change to distrust, so the crest error is
    # still computed and printed beside it.
    "barpos_m":        40.0,   # |deposit centre position error| against XBeach
    "erosion_rel":     0.30,   # relative error in peak erosion depth
    "accretion_rel":   0.60,   # relative error in peak accretion height
}

SCORED_EXTRA = ("normal", "nosurge", "mid")   # see score(); "calm" is reported only

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

    # barpos, the crest, is reported and not scored (see TOL). The centre of mass of
    # everything deposited is steadier and says where the sand went.
    def centroid(p):
        w = [max(v, 0.0) for v in p[:n]]
        return sum(i * dx * v for i, v in enumerate(w)) / max(sum(w), 1e-9)
    cen_model, cen_xb = centroid(dz), centroid(xb)
    dep_model = sum(max(v, 0.0) for v in dz[:n]) * dx
    dep_xb = sum(max(v, 0.0) for v in xb[:n]) * dx
    ero = abs(e_b - E_b) / max(abs(E_b), 1e-6)
    acc = abs(a_b - A_b) / max(abs(A_b), 1e-6)
    return {
        "rmse": rmse, "barpos": barpos, "erosion": ero, "accretion": acc,
        "centroid_err": abs(cen_model - cen_xb), "centroid_model": cen_model,
        "centroid_xb": cen_xb, "deposit_model": dep_model, "deposit_xb": dep_xb,
        "profile": clamp01(1 - rmse / TOL["profile_rmse_m"]),
        "barpos_s": clamp01(1 - abs(cen_model - cen_xb) / TOL["barpos_m"]),
        "crest_s": clamp01(1 - barpos / TOL["barpos_m"]),
        "erosion_s": clamp01(1 - ero / TOL["erosion_rel"]),
        "accretion_s": clamp01(1 - acc / TOL["accretion_rel"]),
    }


def score(probes, refs):
    # Five XBeach cases are scored and averaged: the storm, the moderate case, and three more
    # on the same bed (shore-normal waves, no surge, mid energy). Only the storm case was
    # used for calibration until 2026-11-14, and a change that helps the storm and hurts the
    # others is not an improvement, it is a fit. Two cases let that hide: a trial terrace
    # target halved the storm error while doubling the moderate one.
    # The calm XBeach case is NOT scored. XBeach cuts 0.6 m into a beach under 1.2 m waves;
    # this model holds a calm beach still by design (calm_rate, calm_settle), which was a
    # decision, not an oversight. It stays reported so the disagreement stays visible.
    cases = []
    named = [("storm", probes.get("storm_dz")), ("moderate", probes.get("case2_dz"))]
    named += [(n, e["dz"]) for n, e in (probes.get("extra") or {}).items() if n in SCORED_EXTRA]
    for name, dz in named:
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
                      if k in ("rmse", "barpos", "erosion", "accretion", "centroid_err",
                               "centroid_model", "centroid_xb", "deposit_model",
                               "deposit_xb")} for n, c in cases},
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
    for name in (probes.get("extra") or {}):
        refs[name] = json.load(open(here + "/xbeach-reference-" + name + ".json", encoding="utf-8"))

    s, m, total, cases = score(probes, refs)

    # Reported, not scored: the further XBeach cases, and where the bar sits day by day.
    extra = []
    for name, e in (probes.get("extra") or {}).items():
        if name in SCORED_EXTRA:
            continue
        xb = refs[name]["finalDz"]
        extra.append((name, case_scores(e["dz"], xb, refs[name]["meta"]["reachCross"] / (len(xb) - 1))))
    daily = []
    for name, key in (("storm", "storm_daily"), ("moderate", "case2_daily")):
        if probes.get(key):
            hist = refs[name]["history"]
            dx = refs[name]["meta"]["reachCross"] / (len(refs[name]["finalDz"]) - 1)
            rows = []
            for k, prof in enumerate(probes[key][:len(hist)]):
                pos = [max(v, 0.0) for v in prof]
                cen = sum(i * dx * v for i, v in enumerate(pos)) / max(sum(pos), 1e-9)
                rows.append((hist[k]["day"], cen, hist[k]["centreX"], sum(pos) * dx, hist[k]["deposited"]))
            daily.append((name, rows))

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

    print("\n  XBeach cases, scored:")
    for name, c in cases:
        print(f"    {name:9} rmse {c['rmse']:.3f} m | centre {c['centroid_err']:4.0f} m | "
              f"ero {c['erosion']:5.2f} | acc {c['accretion']:5.2f}")
        print(f"    {'':9} deposit centre x {c['centroid_model']:.0f} m, XBeach {c['centroid_xb']:.0f} m | "
              f"crest {c['barpos']:.0f} m apart | deposited {c['deposit_model']:.1f} m2/m, "
              f"XBeach {c['deposit_xb']:.1f}   [crest and volume reported, not scored]")
    print(f"    mean crest position   score {sum(c['crest_s'] for _, c in cases) / max(len(cases), 1):5.2f}   [the old bar position score, not in the composite]")
    for key, label in (("profile", "profile rmse"), ("barpos", "deposit centre"),
                       ("erosion", "peak erosion"), ("accretion", "peak accretion")):
        print(f"    mean {label:16} score {s[key]:5.2f}")

    def line(name, c):
        print(f"    {name:9} rmse {c['rmse']:.3f} m | barpos {c['barpos']:4.0f} m | "
              f"ero {c['erosion']:5.2f} | acc {c['accretion']:5.2f} | centre "
              f"{c['centroid_err']:4.0f} m apart | deposited {c['deposit_model']:.1f} / {c['deposit_xb']:.1f}")
    if extra:
        print("\n  Further XBeach cases [reported, not scored]:")
        for name, c in extra:
            line(name, c)
        allc = cases + extra
        print(f"    all {len(allc)} cases: mean rmse {sum(c['rmse'] for _, c in allc) / len(allc):.3f} m, "
              f"mean centre error {sum(c['centroid_err'] for _, c in allc) / len(allc):.0f} m")
    for name, rows in daily:
        print(f"\n  {name}: deposit centre x by day, model / XBeach (deposited m2/m) [reported]")
        print("    " + "  ".join(f"d{int(d)} {cm:.0f}/{cx:.0f} ({dm:.0f}/{dxb:.0f})"
                                 for d, cm, cx, dm, dxb in rows if int(d) in (1, 2, 3, 5, 7, 10)))

    print(f"\n  COMPOSITE {total:.1f} / 100")
    weakest = sorted(s, key=lambda k: s[k])[:2]
    print(f"  weakest: {', '.join(weakest)}")


if __name__ == "__main__":
    main()
