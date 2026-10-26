# Precision score

A number to optimise against, built from probes that each have a known correct answer.

```
SCORE=probes.json node dev/headless_harness.js index.html
python dev/precision_score.py probes.json
python dev/score_sweep.py 0.35 0.05 0.02      # sweep a constant, re-score each value
```

Probes are seeded (`SCORE` enables the deterministic RNG) and start from a cleaned bed, so two
runs of one build give byte-identical measurements. A metric that cannot reproduce itself
cannot rank anything — the rendering metric in `PERFORMANCE.md` failed exactly this way before
the RNG was seeded.

## The eight sub-scores

Each runs 1.0 at perfect and 0.0 at tolerance, averaged into a composite out of 100. The
tolerances live at the top of `dev/precision_score.py` so the score is arguable rather than
mystical.

| probe | correct answer | tolerance |
|---|---|---|
| calm drift, 2nd 100d | 0 (does the beach keep moving?) | 0.01 m |
| seeded disequilibrium | 0 (is the seeded bed the equilibrium?) | 0.05 m rms |
| flux residual | 0 (H²·Cg is constant along a non-breaking column) | 0.05 rel sd |
| CERC r² | 1.0 (CERC is exactly sin 2α) | 0.98 |
| volume drift | 0 | 0.01 rel |
| storm profile rmse | 0 against the recorded XBeach run | 0.30 m |
| bar position error | 0 | 40 m |
| peak erosion rel err | 0 | 0.30 |
| peak accretion rel err | 0 | 0.60 |

They are kept separate because they fail independently. A model can conserve volume perfectly
and put the bar in the wrong place; it can match XBeach's storm profile and still fail to hold
a calm beach still. A composite alone hides which one moved.

## Using it

Sweeping the storm-bar amplitude in `equilibriumZ` against the score:

| bar amplitude | score | accretion err | erosion err | profile rmse |
|---|---|---|---|---|
| 0.35 | 53.4 | 2.20 | 0.12 | 0.186 |
| 0.20 | 54.8 | 1.15 | 0.11 | 0.161 |
| 0.10 | 58.4 | 0.44 | 0.10 | 0.160 |
| 0.05 | **65.8** | 0.09 | 0.10 | 0.163 |
| 0.03 | 66.6 | 0.05 | 0.10 | 0.165 |

0.05 was taken rather than 0.03: the difference is within what one reference case can
resolve, and 0.05 keeps a real bar term rather than fitting a single storm run to two decimal
places. The score is a compass, not a proof.

The result also settles the question the adversarial swarm raised. Gemma argued the storm bar
should emerge from transport rather than being a static target; Qwen argued the closed
offshore boundary over-fills it. Both are consistent with what the sweep shows — the bar
target was doing the over-depositing, and dropping it lets the bar form from the scarp
erosion and volume conservation instead.

## What it is not

The XBeach comparison is **one storm on one bed**. Optimising hard against a single case is
how a model learns that case. Calm drift and flux residual are the guards against that: they
are properties of the physics, not of a fit, and they have not improved.

## Progression

53.4 -> 65.8 -> 73.0 -> 76.4 -> **66.6 with a second case**. That last drop is the point.

## The second XBeach case

`dev/xbeach-reference-2.json` is a moderate-energy case — Hs 2.0 m, Tp 9 s, 0.3 m surge,
same sediment. **It was never used for calibration.** Its only job is to test whether the
storm tuning generalises.

It does not:

| case | rmse | bar position | erosion err | accretion err |
|---|---|---|---|---|
| storm (calibrated) | 0.163 m | 20 m | 0.10 | 0.09 |
| moderate (held out) | 0.084 m | 60 m | 0.34 | 0.93 |

The held-out case has a *better* profile rmse and a much worse bar. The app puts roughly
double XBeach's sand in the crest, 60 m from where XBeach puts it, while eroding about a
third too little. The single-case score of 76.4 was flattering.

The forcing split explains it: `stormIntensity()` returns 0.62 for the storm and 0.12 for the
moderate case. Those are different regimes, and the bar amplitude was tuned at one of them.

Scoring now averages the four XBeach sub-scores across both cases, so a change that helps the
storm and hurts the moderate case no longer reads as an improvement.

## Probes corrected along the way

- **calm drift was measuring a transient.** The bed settles a one-time 0.21 m at a handful of
  cells, then holds *exactly* still -- the second 100 days move 0.000 m. Scoring ongoing drift
  and seeded disequilibrium separately is what the probe actually claims to measure.
- **a single cell is not a beach.** Settle is scored as RMS over 11,500 active cells, not as
  the maximum over them. The max is still reported.
- **the flux probe was sampling dissipating cells.** Dissipation is exp(-(gamma*h/H)^2), so a
  cell flagged non-breaking can still be dissipating and would rightly not conserve flux.
  Excluding the near-breaker band drops the residual from 1.81% to 0.27%. The march was fine;
  the probe was asking the wrong question.

Adversarial swarm, second pass, on the two weakest probes. Gemma argued the calm drift came
from a datum mismatch between `defaultCoastalBedZ` (wl = 0) and `equilibriumZ`
(`refWaterLevel`). Measurement disproved it: the disequilibrium is 0.000 m at the waterline,
so the datums already agree. Qwen's report wandered without landing a mechanism.

Current score: **76.4**. Weakest are calm drift (0.31) and profile rmse (0.46) — the beach
still creeps under calm water, and the profile shape is a third of a metre from XBeach over
part of the shoreface.

## Measurement correction: the scored profile was using a stale breakpoint

The score is only as good as what it measures, and it was measuring the wrong profile.

`runProfile` in the harness stepped `morphStep` directly and never ran the wave field. The
breakpoint (`barDistanceM`) is computed from the outermost breaking cell, so with no wave field
it kept its initial value of **60 m**. The checks in Gate B set the storm conditions and read
the real value (159 m), so the checks and the score were describing two different profiles.

Fixed: `runProfile` now steps `waveFieldStep` and recomputes the bar distance before each
morphology step.

**This changes the baseline.** Under the corrected measurement the committed model scores
**61.8**, not 66.6:

    before (stale 60 m breakpoint) 66.6
    after  (real 159 m breakpoint) 61.8

Nothing about the app changed. The earlier number was partly an artefact of the profile being
generated at a breakpoint the app would never have used. It is recorded here rather than
quietly replaced because the whole point of a tolerance or a baseline is that it is stated
before it is used.

The bar-position sub-score is 0.00 in both cases, so correcting the measurement did not flatter
the model either — it removed a systematic offset of ~100 m from the storm case, and the score
fell because the storm profile shape is genuinely worse than the stale measurement showed.
