"""Coastal interface adversarial swarm.

Three criteria, each critiqued by BOTH model families, run sequentially because LM Studio
serializes a single local worker:

    performance         -> is it fast enough to be real time
    accuracy            -> is the physics right
    export alignment    -> does the browser equal what XBeach receives

Gemma and Qwen3.8 are deliberately paired on every lens: a model shares its own blind spots,
so the disagreements between families are the signal and the agreements are the finding.

Each lens is fed only the functions that matter for it, plus the MEASURED numbers from the
benchmark. A reviewer asked to judge performance or accuracy without measurements invents
them.

Usage:
    python dev/coastal_swarm.py [--lens performance|accuracy|export] [--model gemma|qwen]
"""
import os
import re
import sys
import json
import datetime
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "index.html")
OUTDIR = os.path.join(HERE, "swarm-reports")

API = "http://localhost:1234/v1/chat/completions"

MODELS = {
    "gemma": "google/gemma-4-31b-qat",
    "qwen":  "qwen/qwen3.8-27b",
}

BENCH = """MEASURED FRAME PROFILE (headless node, 1200x800, 60 frames, this machine):
  updateBedBuffer()      99.02 ms   called every 8 frames AND every 0.5 s
  waveFieldStep()        10.34 ms   every frame
  morphologyStep(1day)    8.28 ms   every frame
  applyLongshore(1day)    3.37 ms   every frame
  computeBarDistance()    0.38 ms   every frame
  updateParticles()       0.31 ms   every frame
  redrawDepoBuffer()      0.19 ms   every 0.5 s
  buildXBeach()           1.28 ms   on export only
  everything else        <0.10 ms
  TOTAL                   136.5 ms/frame  =  7 fps  (budget is 16.67 ms)

CURRENT PHYSICS NUMBERS (from the harness):
  calm field 10710 wet cells, max depth 7.02 m, max H 1.42 m
  storm Hs 3.4 m: break 3.18 m at 4.19 m depth, runup 1.20 m
  cross-shore: volume drift 0.00%, storm erodes upper profile -0.83 m, bar +0.67 m
  versus XBeach on the same storm, same morphological time:
      peak erosion   XBeach -1.345 m  vs  interface -1.509 m
      peak accretion XBeach +0.274 m  vs  interface +0.874 m
      correlation 0.837, amplitude ratio 1.12
"""

LENSES = {
    "performance": {
        "functions": ["draw", "updateBedBuffer", "waveFieldStep", "transformComponent",
                      "morphologyStep", "updateParticles", "drawFlowField", "drawParticles"],
        "prompt": (
            "You are an adversarial PERFORMANCE reviewer for a browser coastal-wave simulator: "
            "a single index.html with an HTML canvas and a physics loop. It must run at 60 fps "
            "for students on laptops.\n\n"
            + BENCH + "\n"
            "You are given the actual source of the hot functions. Find, in order of measured "
            "impact, what makes the frame cost 136 ms. Be specific: name the line, the loop, the "
            "per-pixel work, the redundant recomputation, the allocation inside the loop.\n"
            "Consider especially: whether updateBedBuffer must touch every pixel of a 1200x800 "
            "canvas, whether it must run every 8 frames when the bed changes slowly, whether "
            "waveFieldStep recomputes anything that did not change, and whether the morphology "
            "solve allocates per call.\n"
            "Output a severity-ranked list (CRITICAL/HIGH/LOW). Each entry: what, where, why it "
            "costs what it costs, and the specific fix with an estimated saving. "
            "Do NOT praise the code. Only findings."
        ),
    },
    "accuracy": {
        "functions": ["transformComponent", "wavenumberK", "groupVelocity", "equilibriumZ",
                      "morphologyStep", "computeLongshore", "cercQ", "computeRunup",
                      "deanA", "settlingVelocity", "stormIntensity"],
        "prompt": (
            "You are an adversarial PHYSICS reviewer for a reduced coastal-wave model. It is "
            "deliberately simple: linear shoaling, Snell refraction, Battjes-Janssen breaking "
            "with a hard cap H <= gamma*h, Stockdon runup, CERC longshore transport, and "
            "cross-shore morphology as an implicit diffusion of the disequilibrium toward a "
            "Dean profile.\n\n"
            + BENCH + "\n"
            "Audit the source below for CORRECTNESS. The interface currently deposits about "
            "three times more sand in its bar than XBeach does while eroding about the right "
            "amount -- treat that asymmetry as the headline question and reason about what in "
            "this code would cause it.\n"
            "Also check: sign conventions (x runs offshore->onshore, so cross-shore gradients "
            "are negative for a normal beach), the implicit diffusion's boundary conditions, "
            "whether the transport coefficient scaling (Hs/1.5)^2 is dimensionally sane, "
            "whether the Dean A coefficient is computed from the right settling velocity, the "
            "CERC sin(2*alpha) factor and its reference angle, and whether the breaking cap "
            "and the dissipation are consistent with each other.\n"
            "Output a severity-ranked list (CRITICAL/HIGH/LOW) with the function name and the "
            "specific fix. Only findings."
        ),
    },
    "export": {
        "functions": ["buildXBeach", "xbBedAt", "dirToNautical", "spreadToS", "exportXBeach",
                      "zipStore"],
        "prompt": (
            "You are an adversarial reviewer for EXPORT FIDELITY. The browser simulator writes "
            "an XBeach input case: params.txt, bed.dep and jonswap.txt in a zip. The promise is "
            "that what the student sees on screen is exactly what XBeach will run.\n\n"
            + BENCH + "\n"
            "Audit the source below for anything that breaks that promise:\n"
            "- bed.dep must be (nx+1)*(ny+1) values with the same orientation and sign as the "
            "screen (posdwn=-1 means elevation positive up)\n"
            "- D50 is millimetres in the UI and metres in params.txt\n"
            "- mainang is nautical, naming the direction waves come FROM; shore-normal is 270\n"
            "- the JONSWAP peak period is a PERIOD but XBeach may want a frequency\n"
            "- dx/dy and the domain size must match the grid the bed is written on\n"
            "- morfac and tstop must correspond to the morphology time the comparison assumes\n"
            "- anything the screen shows that silently does NOT reach the export (sea level, "
            "spread, structures, particles, the longshore layer, the morph layer)\n"
            "For each item say whether the export is CONSISTENT, MISMATCHED, or MISREPRESENTED, "
            "with the function name and the specific fix. Output severity-ranked findings only."
        ),
    },
}

FUNC_RE = re.compile(r"\nfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{")

def extract(path, names):
    src = open(path, encoding="utf-8").read()
    out = []
    for name in names:
        m = re.search(r"\nfunction\s+%s\s*\([^)]*\)\s*\{" % re.escape(name), src)
        if not m:
            continue
        i = m.end()
        depth = 1
        while i < len(src) and depth:
            c = src[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            i += 1
        out.append(src[m.start():i])
    return "\n\n".join(out)

def call(model, prompt, max_tokens=4096):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "reasoning_effort": "none",
    }
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"].get("content") or ""

def run(lens_name, model_key):
    lens = LENSES[lens_name]
    code = extract(APP, lens["functions"])
    if not code.strip():
        print(f"  !! no functions extracted for {lens_name}")
        return None
    prompt = (lens["prompt"] + "\n\n=== SOURCE ===\n" + code)
    print(f"  {lens_name} / {model_key} ({MODELS[model_key]}), {len(prompt):,} chars ...")
    t0 = datetime.datetime.now()
    try:
        out = call(MODELS[model_key], prompt)
    except Exception as e:
        out = f"[ERROR] {type(e).__name__}: {e}"
    dt = (datetime.datetime.now() - t0).total_seconds()
    print(f"    -> {len(out):,} chars in {dt:.0f}s")
    os.makedirs(OUTDIR, exist_ok=True)
    p = os.path.join(OUTDIR, f"{lens_name}_{model_key}.md")
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

    # sequential: one local worker, so parallel calls would just queue and time out
    for ln in lenses:
        for mk in models:
            run(ln, mk)
    print("done")
