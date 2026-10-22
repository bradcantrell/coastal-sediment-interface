"""Second swarm pass, aimed at the precision score.

The first pass found performance problems. This one is grounded in the score itself: the
probes, their tolerances, and the measured drift, handed to both model families so they can
argue about the physics rather than about the code's style.

Two lenses:
  calm  -- the bed lowers ~0.2 m uniformly offshore under CALM water even though it starts on
           the equilibrium profile and volume is conserved. Where is that disequilibrium?
  flux  -- H^2*Cg is not constant along a non-breaking column (1.8% relative sd). The march
           claims to conserve it exactly.

Usage: python dev/coastal_swarm_score.py [--lens calm|flux] [--model gemma|qwen]
"""
import os
import sys
import json
import datetime
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "index.html")
OUTDIR = os.path.join(HERE, "swarm-reports")
API = "http://localhost:1234/v1/chat/completions"

MODELS = {"gemma": "google/gemma-4-31b-qat", "qwen": "qwen/qwen3.8-27b"}

EVIDENCE = """PRECISION SCORE: 65.8 / 100

  calm drift (m per 100 model days)      0.2073   tol 0.30    score 0.31
  flux residual (rel sd of H^2*Cg)       0.0181   tol 0.05    score 0.64
  CERC r2                                0.9966   tol 0.98    score 0.83
  volume drift                           1e-18    tol 0.01    score 1.00
  storm profile rmse vs XBeach (m)       0.1634   tol 0.30    score 0.46
  bar position error vs XBeach (m)       20.0     tol 40      score 0.50
  peak erosion relative error            0.0968   tol 0.30    score 0.68
  peak accretion relative error          0.0902   tol 0.60    score 0.85

MEASURED DRIFT UNDER CALM (Hs 0.6 m, Tp 6 s, 20 steps of 5 model days):
  the largest bed changes are all NEGATIVE, about -0.20 m, spread across the offshore
  profile at x = 56, 130, 160, 358, 366 m. Total volume is conserved to 1e-18, so the sand
  is not lost -- it is being redistributed onshore. The bed starts ON the Dean equilibrium:
  equilibriumZ() and defaultCoastalBedZ() use the same formula and the same deanA().

  morphologyStep solves, per alongshore row, implicitly:
      u = z - equilibriumZ(Y, storm, A)
      d u / d t = (D/(1-p)) d2u/dx^2      with zero flux at both ends
  and writes morphGrid += du. It excludes cells with z > refWaterLevel + BERM_TOP_M (dune).
"""

LENSES = {
    "calm": {
        "functions": ["equilibriumZ", "morphologyStep", "defaultCoastalBedZ", "deanA",
                      "shoreRefAt", "shorelineXPx", "stormIntensity", "bedZ", "bedZ0"],
        "prompt": (
            "You are an adversarial reviewer of a reduced coastal morphology solver. Do not "
            "comment on style, naming or documentation. Only physics and numerics.\n\n"
            + EVIDENCE + "\n"
            "THE QUESTION: the bed lowers by a uniform ~0.2 m across the whole offshore "
            "profile under CALM water, in 100 model days, starting from what is supposed to "
            "be its own equilibrium profile. Volume is conserved, so sand moves onshore.\n\n"
            "Find the disequilibrium that the solver is relaxing. Consider specifically:\n"
            "1. The initial bed is rasterised onto a grid at 4 px and then read back with "
            "bilinear interpolation, while equilibriumZ() is evaluated analytically at the "
            "cell centre. Where does that mismatch become large, and is it large enough?\n"
            "2. The Dean term uses cbrt(Y*Y), whose derivative is unbounded at Y=0 (the "
            "waterline). What does the diffusion operator do to one cell adjacent to a "
            "slope discontinuity?\n"
            "3. refWaterLevel is captured once at anchor time. If it differs from the datum "
            "the bed was built on, what happens?\n"
            "4. The active/inactive boundary at the dune: cells above BERM_TOP_M are frozen "
            "and the solver sees a zero-flux wall there. Does that push sand seaward?\n"
            "5. The implicit solve is one-sided at the domain ends. Is the offshore boundary "
            "condition actually zero-flux, and does it hold a uniform lowering?\n\n"
            "Output severity-ranked findings (CRITICAL/HIGH/LOW). For each: the mechanism, "
            "the function, and the specific code change. If you believe a claimed cause is "
            "wrong, say so and explain why -- a wrong fix here costs more than no fix."
        ),
    },
    "flux": {
        "functions": ["transformComponent", "wavenumberK", "groupVelocity", "waveFieldStep",
                      "combineComponents"],
        "prompt": (
            "You are an adversarial reviewer of a wave transformation scheme. Physics and "
            "numerics only -- no style comments.\n\n"
            + EVIDENCE + "\n"
            "THE QUESTION: in the absence of breaking, the product H^2 * Cg * cos(theta) must "
            "be constant along a shore-normal march, because that is the wave energy flux. "
            "Measured over 112 non-breaking cells it has a relative standard deviation of "
            "1.8%. The march claims to conserve exactly this quantity.\n\n"
            "The march, per component, walks shoreward cell by cell carrying {H, theta, k, Cg}:\n"
            "  sin(theta) = sin(theta_prev) * (k_prev / k)          Snell\n"
            "  H = H_prev * sqrt(flux_prev / flux)                  shoaling on oblique flux\n"
            "  flux = Cg * cos(theta)\n"
            "  Battjes-Janssen dissipation and a hard cap H <= gamma*h applied after that\n\n"
            "Where does the 1.8% come from? Consider: whether k and Cg in flux_prev are the "
            "values from the previous cell or recomputed at the current one; whether the "
            "refraction uses the updated or the previous angle when forming cos(theta); "
            "whether the cap and the dissipation are applied before or after the flux ratio "
            "is taken; and whether interpolating depth to the cell centre while k is solved "
            "from a quantised depth introduces a consistent bias.\n\n"
            "Output severity-ranked findings with the mechanism, the line, and the exact fix."
        ),
    },
}

FUNCS = {}


def extract(path, names):
    import re
    src = open(path, encoding="utf-8").read()
    out = []
    for name in names:
        m = re.search(r"\nfunction\s+%s\s*\([^)]*\)\s*\{" % re.escape(name), src)
        if not m:
            continue
        i = m.end()
        depth = 1
        while i < len(src) and depth:
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
            i += 1
        out.append(src[m.start():i])
    return "\n\n".join(out)


def call(model, prompt):
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}],
               "temperature": 0.2, "max_tokens": 4096, "reasoning_effort": "none"}
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.loads(r.read())["choices"][0]["message"].get("content") or ""


def run(lens_name, model_key):
    lens = LENSES[lens_name]
    code = extract(APP, lens["functions"])
    prompt = lens["prompt"] + "\n\n=== SOURCE ===\n" + code
    print(f"  {lens_name} / {model_key}: {len(prompt):,} chars ...")
    t0 = datetime.datetime.now()
    try:
        out = call(MODELS[model_key], prompt)
    except Exception as e:
        out = f"[ERROR] {type(e).__name__}: {e}"
    print(f"    -> {len(out):,} chars in {(datetime.datetime.now()-t0).total_seconds():.0f}s")
    os.makedirs(OUTDIR, exist_ok=True)
    p = os.path.join(OUTDIR, f"score_{lens_name}_{model_key}.md")
    open(p, "w", encoding="utf-8").write(
        f"# {lens_name} / {model_key} ({MODELS[model_key]})\n\n{out}\n")
    return p


if __name__ == "__main__":
    lenses = list(LENSES)
    models = list(MODELS)
    if "--lens" in sys.argv:
        lenses = [sys.argv[sys.argv.index("--lens") + 1]]
    if "--model" in sys.argv:
        models = [sys.argv[sys.argv.index("--model") + 1]]
    for ln in lenses:
        for mk in models:
            run(ln, mk)
    print("done")
