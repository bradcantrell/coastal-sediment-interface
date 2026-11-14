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

## Baseline after extending both references to 10 model days

Both XBeach cases were re-run at `tstop 86400` with `morfac 10` (10 model days instead of 2.5)
and recorded with `dev/record_xbeach.py`, which states its convention: finalDz is the
alongshore mean of (final - initial).

    storm     rmse 0.222 m | barpos 100 m | erosion 0.13 | accretion 0.01
    moderate  rmse 0.101 m | barpos  95 m | erosion 0.50 | accretion 0.38
    COMPOSITE 64.5

    progression: 53.4 -> 65.8 -> 73.0 -> 76.4 -> 66.6 (second case)
                 -> 61.8 (stale-breakpoint fix) -> 62.7 (storm extended)
                 -> 64.5 (both extended)

The score rose when the references improved, which is the direction it should move. The longer
runs give the bar time to actually form: the storm crest migrates from x=420 to x=390 and the
beach cuts back to x=480, so the profile being scored is a morphology rather than an
adjustment. Accretion goes 0.98 -> 0.01 on the storm case and 0.93 -> 0.38 on the moderate one.

The two old 2.5-day references are kept alongside as `xbeach-reference-2.5d.json` and
`xbeach-reference-2-2.5d.json` so the earlier numbers remain reproducible.

Bar position is now the single weakest sub-score (100 m and 95 m against a 40 m tolerance) and
both crests sit too far offshore. Because the extended runs show the crest migrating seaward
with time but only 30 m in 7.5 days, this is not a duration artefact: the model puts the
deposition at the breakpoint, the reference puts it in the inner surf zone.

---

## Current baseline — HEAD `8141022`

The 64.5 above is an accurate record of the tree at `af3369a`. It is **not the current
number**, and three things have happened since.

**The recorded baseline was not reproducible on later trees.** Measured on the tree
immediately before `b76139c` — with hysteresis stashed, so the only difference is the
pile of physics commits in between — the score is **60.8**, not 64.5. That is a 3.7-point
drop that this file never recorded. Nothing was wrong with the 64.5 measurement; the
model moved underneath it and the record did not follow. A score in this file without the
commit it belongs to is not a baseline, it is a memory.

**Hysteresis cost 15 m of storm bar position.** `b76139c` holds the breaking mask between
two thresholds. That changes which cells are flagged as breaking, which changes the
dissipation pattern, which moves the storm bar:

    storm     rmse 0.223 m | barpos 115 m | erosion 0.14 | accretion 0.03
    moderate  rmse 0.103 m | barpos  95 m | erosion 0.50 | accretion 0.38
    COMPOSITE 62.6

What moved relative to the 64.5 record:

- CERC r²          0.99601 → 0.99958   better
- volume drift     2.7e-06 → 7.1e-07   better
- storm barpos     100 m → 115 m       worse, and barpos now scores 0.00
- storm accretion  0.01 → 0.03         worse, slightly
- storm rmse       0.222 → 0.223       unchanged

So the transport closure improved while the score fell 1.9 points, and the bar moved
further offshore — the wrong direction, given that the section above already names barpos
as the weak sub-score. Recorded here rather than smoothed over: the score is not the
objective, but a number without its sub-scores cannot be reproduced or argued with.

**The convergence probe and the interior-reporting fix do not change the score** (62.6
with and without). That is the correct result for a diagnostic and is why they carry no
score claim.

**Progression, current:** 53.4 → 65.8 → 73.0 → 76.4 → 66.6 → 61.8 → 62.7 → 64.5
(`af3369a`) → 60.8 (physics since, unrecorded) → 62.6 (`b76139c`, HEAD `8141022`)
→ **62.7** (`b952c8b`, on the shared interface).


---

## Baseline on the shared interface — `b952c8b` (2026-11-13)

`b952c8b` moved the page onto the shared Sediment Interface: `index.html` is now the interface
vendored from `sediment-interface`, the coastal model is `model.js`, the XBeach export is
`site.js`. No line of the model changed. The score moved anyway, by 0.1, and the cause is
known exactly.

    storm     rmse 0.223 m | barpos 100 m | erosion 0.14 | accretion 0.01
    moderate  rmse 0.104 m | barpos  95 m | erosion 0.50 | accretion 0.39
    COMPOSITE 62.7

What moved relative to 62.6:

- storm barpos       115 m → 100 m      better, though barpos still scores 0.00
- storm accretion    0.03 → 0.01        better
- moderate rmse      0.103 → 0.104      worse, slightly
- moderate accretion 0.38 → 0.39        worse, slightly
- seeded diseq rms   0.0337 → 0.0338    unchanged in effect
- flux residual      0.0027 → 0.0029    worse, slightly
- volume drift       7.1e-07 → 7.8e-07  unchanged in effect

**The cause is two interface fixes this repo inherited, and nothing else.** The shared
interface places a settling particle's deposit on the cell `depoZ()` reads it from (the old
fork was half a cell off), and bounces a particle off a rotated rectangle along the correct
normal. Deposit is a bed layer here (`bedZ = userBedZ + depoZ + morphZ + longZ`), so where
sediment particles settle reaches the waves and the profile.

This was tested, not assumed: with those two fixes undone in a scratch copy of the vendored
`index.html`, and everything else as committed, `SCORE=` writes a probes file that is
**byte-identical** to the one from `9958b59`, and the score is 62.6. The whole 0.1 is the
two fixes.

Two things this shows that were not written down before:

- The scored storm profile depends on where sediment particles deposit. The 15 m of storm
  bar position that hysteresis "cost" above comes back with these two sediment fixes (which
  of the two does it was not isolated). Bar position at this resolution is that sensitive,
  which is worth knowing before tuning anything against it.
- The harness's frame-time check ("no worse than the recorded 38 ms") is a record from
  vlio. On vlmars under node the same tree measures 78.7 ms per frame before the move and
  81.6 after. It fails on vlmars at every commit and is not a regression signal there.


---

## The edge row, and an honest baseline: 54.5 (2026-11-13)

62.7 was partly an artefact. Removing it is a bug fix, not a model change, and the score
falls 8.2 points because the artefact had been flattering the storm case.

**The bug.** `morphZ()` and `longZ()` returned zero past the outermost cell centre. The last
grid row (centre at y = 802 px on an 800 px canvas) therefore never saw its own bed change.
In a storm the cross-shore step kept relaxing a bed that, to it, never moved. Its eroding
cells hit the −300 clamp (15 m), its accreting cells kept filling, and the row gained sand
without limit: 3095 m² per metre of shore after a 10-day storm, where a real row moves 36.
The existing conservation check runs calm conditions, where the row drifts but does not
reach the clamp, so it passed throughout.

**How it reached the score.** `runProfile()` averages the bed over 41 alongshore samples. The
last one sits at y = 800 px, half way between the last real row and the runaway row. So
1/82 of a row holding ±15 m went into every point of the scored profile. That put a false
+0.17 m shelf across the surf zone and deepened the scored erosion.

**The fix.** Both layers now hold their edge value past the outermost cell centre. Two checks
in `dev/headless_harness.js` cover it (a 10-day storm neither makes nor loses sand in any
row; the edge row follows its neighbour), and both fail on the old `model.js`.

                 before (62.7)                          after (54.5)
    storm     rmse 0.223 | barpos 100 | ero 0.14 | acc 0.01    rmse 0.241 | barpos 100 | ero 0.22 | acc 0.52
    moderate  rmse 0.104 | barpos  95 | ero 0.50 | acc 0.39    rmse 0.115 | barpos  95 | ero 0.66 | acc 0.55

Every other probe is unchanged (calm drift, seeded disequilibrium 0.0338, flux, CERC, volume).

What the clean numbers say about the model, which the artefact was hiding:

- The storm bar is +0.16 m, not +0.34 m. The "accretion 0.01" match to XBeach was the
  artefact landing on XBeach's number.
- The model conserves sand: a storm row erodes and deposits 34 m² per metre. XBeach deposits
  35 and erodes 66 in its alongshore mean, so XBeach is the one losing sand from the profile.
- The deposit is in the wrong place by far more than the crest metric shows. See below.

**Deposit centre of mass, reported and not scored.** `precision_score.py` now prints where the
centre of everything deposited sits, next to the crest position. The crest is the single
highest sample of a profile with a long flat top, so it jumps. The centre of mass does not.

    storm     model x = 185 m, XBeach 374 m (189 m apart) | deposited 33.7 m²/m, XBeach 35.3
    moderate  model x = 169 m, XBeach 346 m (176 m apart) | deposited  7.8 m²/m, XBeach 15.5

x runs from the offshore edge (0) to the dune (600 m); the still-water shoreline is near
445 m. The model spreads its eroded sand as a film about 0.1 m thick over the whole seabed
out to the offshore edge. XBeach keeps it within about 100 m of the shoreline.

**XBeach's bar through time** (from the 81 slices already in the two 10-day runs on vlio,
`D:/workspace/xb-storm-long` and `xb-case2-long`):

    storm     day 1: crest x 430, centre 405, deposited 13.6   day 5: 400, 383, 26.6   day 10: 390, 374, 35.3
    moderate  day 1: crest x 425, centre 382, deposited  5.3   day 5: 390, 361, 11.7   day 10: 370, 346, 15.5

The deposit starts at the shoreline and moves seaward about 3 to 4 m a day while it grows. It
never comes from the breakpoint.

A latent order dependence found on the way: the calm probes read the storm intensity left by
the last morphology step. The storm budget check is therefore skipped under `SCORE=`.


---

## A corrected scoring basis: 53.2 (2026-11-14)

Three changes to how the score is measured. None changes the model.

**1. The model now runs as long as XBeach did.** The harness looked for each reference one
directory too deep and for `modelDays` at the top of the JSON instead of under `meta`. Both
misses fell back silently to 2.5, so since the references were extended the model has been
run for 2.5 days and scored against XBeach's 10. It now reads `meta.modelDays` and fails
loudly if it is missing. Effect on the score: 54.5 → 54.0, small, and the reason it is small
is itself a finding (below).

**2. The references are the middle rows.** `finalDz` is now the mean over rows 12 to 28 of 41.
With oblique waves XBeach strips sand at the updrift side boundary: the storm run's edge rows
lose 114 m² per metre of shore while the middle gains 5. The old all-row mean therefore
overstated erosion and understated the bar (storm crest +0.34 m all rows, +0.41 m middle).
The all-row profile stays in each file as `finalDzAllRows`, with each row's budget as
`rowNet`. Effect: 54.0 → 53.2.

**3. Four more XBeach cases, reported and not scored**, run on vlio on the storm bed
(`D:/workspace/xb-ref-*`): the storm with shore-normal waves, the storm without surge, an
intermediate case, and a calm case. Each reference file now also carries `history`, the
profile summarised once per model day.

    storm     rmse 0.228 m | barpos 100 m | ero 0.25 | acc 0.61 | centre 185 m apart | deposited 33.7 / 45.7
    moderate  rmse 0.099 m | barpos 370 m | ero 0.60 | acc 0.81 | centre 193 m apart | deposited  7.6 / 18.6
    COMPOSITE 53.2
    reported:
    normal    rmse 0.204 m | barpos 135 m | ero 0.23 | acc 0.59 | centre 162 m apart | deposited 33.8 / 53.4
    nosurge   rmse 0.183 m | barpos 130 m | ero 0.31 | acc 0.69 | centre  98 m apart | deposited  8.9 / 43.0
    mid       rmse 0.127 m | barpos  75 m | ero 0.45 | acc 0.69 | centre 174 m apart | deposited 19.2 / 29.3
    calm      rmse 0.081 m | barpos  65 m | ero 0.97 | acc 0.93 | centre 140 m apart | deposited  1.4 /  8.9
    all 6 cases: mean rmse 0.154 m, mean centre error 159 m

What six cases with history show that two end states could not:

- **The model finishes in a day; XBeach is still going at ten.** Storm deposit by day, model /
  XBeach: day 1 34 / 14, day 5 34 / 35, day 10 34 / 46 m² per metre. That is why running the
  model four times longer barely moved the score. The model relaxes to a fixed target and
  stops. XBeach keeps cutting the beach.
- **XBeach's bar starts at the shoreline and moves seaward** in every case (storm centre of
  deposit x = 400 on day 1, 370 on day 10; the shoreline is near 450). The model's deposit
  sits at x = 185 from the first day.
- **XBeach erodes this bed in calm waves** (0.6 m at Hs 1.2 m), and without surge. The model
  moves almost nothing in either. The calm-beach gate stays as a design rule of the interface
  (decided 2026-11-14); this disagreement is recorded, not resolved.
- The moderate case's crest metric jumped from 95 m to 370 m off. Its true bar is 0.04 m high
  and the highest sample is now a point of the offshore film. This is the instability the
  centre-of-mass measure was added for.


---

## The bar comes from the beach: 56.1 (2026-11-14)

Three changes to the cross-shore step, all in `model.js`.

1. **The bump is gone.** `equilibriumZ()` no longer draws a bar into the target at the
   breakpoint. Seaward of the waterline the target is Dean and nothing else.
2. **Depth of closure.** Sand moves only shoreward of 2 m + 0.8 Hs of water. Mobility is 1
   down to half that depth and falls linearly to 0 at it. Each face exchanges with the lower
   mobility of its two cells, the same from both sides, so the step still conserves sand.
3. **Slower, and linear in wave height.** `TRANSPORT_D0` 0.35 → 0.0023 m²/s, scaled by Hs/1.5
   instead of its square. At storm Hs that is 350 times slower.

                 before (53.2)                                         after (56.1)
    storm     rmse 0.228 | barpos 100 | ero 0.25 | acc 0.61 | centre 185   rmse 0.232 | barpos 10 | ero 0.35 | acc 0.59 | centre  6
    moderate  rmse 0.099 | barpos 370 | ero 0.60 | acc 0.81 | centre 193   rmse 0.098 | barpos 95 | ero 0.67 | acc 0.57 | centre 36
    normal    rmse 0.204 | centre 162                                     rmse 0.215 | centre 19
    nosurge   rmse 0.183 | centre  98                                     rmse 0.173 | centre 29
    mid       rmse 0.127 | centre 174                                     rmse 0.111 | centre 22
    calm      rmse 0.081 | centre 140                                     rmse 0.081 | centre 58
    all six   mean rmse 0.154 m, centre error 159 m                       mean rmse 0.152 m, centre error 28 m

    storm deposit centre x by day, model / XBeach:  d1 417/400  d3 395/382  d5 383/377  d7 374/374  d10 364/370

**What improved.** Where the sand goes. The deposit's centre is within 28 m of XBeach's on
average, from 159 m, and in the storm case it follows XBeach day by day. No sand reaches the
seabed beyond closure.

**What did not.** How much sand moves. Profile error is unchanged (0.154 → 0.152 m) and both
amplitude sub-scores are near zero: the storm bar is +0.17 m against XBeach's +0.41 m,
erosion −1.16 m against −1.79 m, deposit 23 m² per metre against 46. The model matches
XBeach's deposit on day 1 (14 / 14) and then runs out of beach: it has a fixed target and
shuts the bed above `refWaterLevel + 1.5 m` out of transport, while XBeach keeps cutting into
the dune. Erosion got slightly worse (0.25 → 0.35) because the slower rate has not finished
the cut the old rate finished on day 1. The supply of sand from the upper beach is the next
piece of work and the one the remaining error sits in.

**How the three numbers were chosen, and how much to trust them.**

- The rate was swept from 0.35 down to 0.0001 with the closure on and off (twelve variants,
  six cases each, in a scratch copy). 0.001 at Hs² matched the storm's day-1 deposit and its
  centre through time. That is one number fitted to one case's history.
- At Hs² the calm-drift gate failed (0.0126 m against 0.01): beds left out of equilibrium by
  earlier checks were still relaxing in the second 100 days. The tolerance was not touched.
  XBeach's deposit moves seaward about as far at Hs 2.0 m (33 m in nine days) as at 3.4 m
  (30 m), which argues against Hs² independently, so the scaling was changed to linear with
  the storm rate held. Calm drift is then 0.0006 m. Linear, square-root and no scaling were
  each scored: 56.1, 55.6, 56.1. The data does not separate them. Linear was kept because
  the interface needs bigger waves to work faster.
- The closure depth comes from where XBeach's deposit ends: 2.8 m of water in the calm run,
  4.0 to 5.4 m in the others. Two numbers read off six runs on one bed and one grain size.

**Gate B was rewritten.** It measured the bed at the breakpoint, which encoded the bump. It
now finds the bar wherever it is and checks that a storm builds one from the eroded sand,
that after ten days it sits inside the surf zone and not at the breakpoint, that the seabed
350 to 400 m offshore does not move, and that the bar decays in calm. The second and third
fail on the old model; the third fails with the closure switched off. The first has a floor
of 0.05 m where the gate measures 0.08 m: in the gate the surge arrives on a beach anchored
at calm water, the active beach is then only 0.7 m above the storm water level, and the bar
is starved. In `runProfile()` the anchor is taken at the storm level and the same model
builds +0.17 m. That difference between how the score sets up a storm and how the page does
was not known before and is part of the same supply question.

**What changes on the page.** Storm response takes model days to weeks now, not hours. At a
slow time rate the beach will look inert where it used to snap to its storm shape.

Also fixed: the scratch arrays in `morphologyStep()` were reallocated every frame because the
reuse test read `.length` of a plain object.

## Five scored cases: 55.8

`precision_score.py` now scores five XBeach cases instead of two: the storm, the moderate
case, and the shore-normal, no-surge and mid-energy runs that had been reported only. The
model is unchanged (`ec25fca`); the same probes score 56.1 on two cases and 55.8 on five.

Why now: a trial terrace target for stage 4 step 3 cut the storm profile error from 0.232 m
to 0.115 m and raised the moderate one from 0.096 m to 0.184 m. With two cases, half of that
is hidden. With five, a change has to hold across wave height, surge and angle.

The calm XBeach case stays reported and is not scored. XBeach cuts 0.6 m into the beach under
1.2 m waves, and this model holds a calm beach still by design.

| Case | rmse (m) | crest error (m) | erosion error | accretion error |
|---|---|---|---|---|
| storm | 0.232 | 10 | 0.35 | 0.59 |
| moderate | 0.098 | 95 | 0.67 | 0.57 |
| normal | 0.215 | 20 | 0.33 | 0.59 |
| nosurge | 0.173 | 65 | 0.37 | 0.76 |
| mid | 0.111 | 15 | 0.53 | 0.60 |

Peak erosion scores 0.00 and peak accretion 0.02 across the five: the model moves about half
the sand XBeach does in every case. That is what step 3 is for.

## The storm target is Dean with its slope capped: 69.4

Stage 4 step 3, first of three changes. Score 55.8 -> 69.4 on the five scored cases.

**What was wrong.** The model matched XBeach's eroded volume on day 1 of the storm (13.4
against 14.5 m2 per metre of shore) and then stalled at 22.8 by day 10, while XBeach reached
53 and was still climbing. The transport rate was not the limit. The target was: the old
storm target (the beach slope reduced by up to 55% plus a 1.2 m scarp decaying over 18 m)
left the upper beach too high, and once the bed reached it nothing more moved.

**What XBeach does.** In all six reference runs the final nearshore bed is one straight line
at 0.021 to 0.024, from about 1.6 m of water up to the foot of a scarp, whatever the wave
height or surge. That is the Dean curve with its slope capped: Dean out to where its own
slope falls to the cap, and the tangent line landward of that.

**The change.** `equilibriumZ()` is now that profile under storm waves (`TERRACE_SLOPE`
0.023), blended with the seeded calm profile by storm intensity so that calm is exactly
unchanged. `stormIntensity()` is now wave height only, 0 at 1.2 m and 1 from 2.0 m. A surge
acts through the water level, not through that number.

| | Before | After |
|---|---|---|
| Score | 55.8 | 69.4 |
| Peak erosion sub-score | 0.00 | 0.56 |
| Peak accretion sub-score | 0.02 | 0.58 |
| storm rmse (m) | 0.232 | 0.104 |
| normal rmse | 0.215 | 0.076 |
| nosurge rmse | 0.173 | 0.167 |
| mid rmse | 0.111 | 0.134 |
| moderate rmse | 0.098 | 0.190 |
| all six, mean rmse | 0.152 | 0.125 |

**What got worse, and why.** The moderate case nearly doubles its error and mid rises. The
model cuts every cell of the active beach at once, right up to its fixed 1.5 m limit. XBeach
works from the waterline inland behind a scarp, and at 2.0 m waves the scarp has only
reached the 1.1 m contour by day 10. Day 1 is also too fast everywhere (storm 20 against
14 m2/m). The second change, wave reach and the dune slump, is aimed at exactly this.

**How fitted it is.** One number, 0.023, read off the reference runs rather than swept. The
0 to 1 range over 1.2 to 2.0 m is not fitted to anything between its ends: the lower end is
the design rule that a calm beach stays still, and the upper end is the smallest wave height
at which a reference run shows the full terrace.

Two checks added (86 in all). "The storm target is a 1 in 43 terrace across the waterline"
fails on the old model (0.035). "The calm target keeps the seeded beach" fails when the calm
beach slope in the target is changed to 0.09.

## Waves cut only where they reach, and the dune slumps: 70.8

Stage 4 step 3, second of three changes. Score 69.4 -> 70.8; mean profile error over all six
XBeach cases 0.125 -> 0.091 m.

**The change.** Two rules in `morphologyStep()`, replacing the fixed limit that made
everything up to 1.5 m above the anchor water level active and everything above it a wall.

- *Wave reach.* The bed is cut only up to `WAVE_REACH_PER_HS` (0.15) x Hs above the live
  water level. Sand can still be put back up to the berm top, so a lowered beach can rebuild.
- *Slump.* Behind a cell the waves have lowered, the bed cannot stand steeper than 0.3 if
  the lower cell is within wave reach, or 1.0 above that (XBeach's wetslp and dryslp
  defaults). The excess moves down one cell. It works in both directions, and the dry limit
  applies only behind a cell the model has already lowered, so a steep bank drawn by the
  user is left alone until the waves get to it.

The scarp now retreats through the storm: x = 465 m on day 1, 480 m on day 10. XBeach's is
at 480 m on day 10. Eroded volume by day, model / XBeach, m2 per metre:

| | d1 | d2 | d3 | d5 | d7 | d10 |
|---|---|---|---|---|---|---|
| storm | 14/14 | 21/23 | 25/27 | 31/35 | 36/41 | 41/46 |
| moderate | 5/5 | 7/8 | 9/10 | 11/13 | 13/16 | 14/19 |

| Case | rmse before (m) | rmse after |
|---|---|---|
| storm | 0.104 | 0.061 |
| normal | 0.076 | 0.056 |
| nosurge | 0.167 | 0.162 |
| mid | 0.134 | 0.124 |
| moderate | 0.190 | 0.064 |

**How fitted it is.** `WAVE_REACH_PER_HS` was chosen from three values in a scratch copy
(0.10, 0.15, 0.20: six-case mean rmse 0.107, 0.092, 0.138 m). It is a fit to these runs and
the result is sensitive to it. Its physical reading is that XBeach's scarp foot sits within
about 0.6 m of the still water level in every run. A reach of 0.5 x Hs with the same slump
ran away (75 m2/m in the storm against 46). The slump slopes were not fitted.

**What is still off.**
- nosurge: XBeach takes 24 of its 35 m2/m from below the water line. This model has no way
  to erode a submerged Dean profile, and moves 15 against 43.
- The crest sits 15 to 40 m landward of XBeach's in four of five cases (bar position score
  0.38, unchanged).
- Gate A (a 2 m band raised offshore relaxes) passes but relaxes less than it did: 0.822 ->
  0.814 m against 0.775 before. The emergent edge of the band is above wave reach and feeds
  the rest only by slumping. With the slump off it does not relax at all and the gate fails.
- Nothing rebuilds a dune. Calm can put sand back up to the berm top and no higher.

One check added (87 in all): "the scarp retreats into the dune through a storm" fails with
the slump off (455 m on both days). "A storm neither makes nor loses sand in any row" fails
when the slump is made to drop the sand it moves (-29.6 m2/m).

## One water level: 70.8 (unchanged), and the page now gets what the score sees

Stage 4 step 3, third of three changes. The score does not move, and should not: the score
already reset each bed with the storm water level up.

**The change.** `shoreRefAt()` re-derives the waterline reference whenever the water level
changes, from the bed without the morphology layer, and the target hangs from that. It used
to be anchored at the first morphology step and held, so the same storm gave a different
answer depending on whether the surge was up when the bed was reset. A storm arriving on a
beach set up in calm, which is what the page does, now leaves the same 10-day profile as the
scored setup to 0.000 m; on the previous commit the two differ by 0.206 m.

A side effect, wanted: a raised water level with calm waves now moves the profile slowly up
and inland (the target's origin moves up the beach and the nearshore wants sand). That is a
basic sea-level-rise response, which the old comment in the code said the model could not do.

**Gate B was restructured, and this is a change to a check.** "Bar decays after the storm"
failed. The gate ran 100 days of storm and measured decay at the crest of that. With the
target following the water level, a surge held for 100 days is a sea-level rise: the profile
fills out to the storm's depth of closure, the highest point is 180 m offshore in 4.8 m of
water, and calm 1.2 m waves (closure 3 m) never reach it. The gate now measures decay on the
10-day bar where it stood, through 125 calm days in quarter-day steps, and then runs the
100-day storm for the depth-of-closure check. Measured: bar +0.31 m after 10 days, +0.02 m
after the calm; upper beach 0.80 -> 0.10 -> 0.80 m.

The floor on "storm builds a bar" goes from 0.05 m to 0.2 m (measured 0.31 m), as the note
beside it said it should once the bar was no longer starved.

**A real limit this exposes.** Sand a storm carries deeper than the calm depth of closure
does not come back. After the 10-day storm and 125 calm days, +0.15 m is still sitting 132 m
offshore. This was true before this change (+0.30 m at 142 m); the old gate did not look.

Two checks added (89 in all, 88 passing on vlmars with the known frame-time failure):
- "A storm leaves the same profile whether the surge came before or after the reset" fails
  on `f5bf5c8` (0.206 m).
- "The beach rebuilds in calm after a storm" fails when sand is not allowed back above wave
  reach (0.38 m of 0.80 m). It only tells the two apart in quarter-day steps: in 5-day steps
  the implicit solve puts a lowered cell back in one jump.

### Step 3 as a whole

| | Start of step 3 | End |
|---|---|---|
| Score, five cases | 55.8 | 70.8 |
| Mean rmse, six cases (m) | 0.152 | 0.091 |
| Peak erosion sub-score | 0.00 | 0.51 |
| Peak accretion sub-score | 0.02 | 0.59 |
| Profile sub-score | 0.45 | 0.69 |
| Bar position sub-score | 0.38 | 0.38 |
| Storm sand moved by day 10 (XBeach 46 m2/m) | 23 | 41 |

Weakest now: the seeded-disequilibrium probe (0.33, untouched by this step) and bar position.
