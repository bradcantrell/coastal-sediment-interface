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
| calm drift | 0 m/100d on an equilibrium-seeded bed | 0.30 m |
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

Current score: **65.8**. Weakest are calm drift (0.31) and profile rmse (0.46) — the beach
still creeps under calm water, and the profile shape is a third of a metre from XBeach over
part of the shoreface.
