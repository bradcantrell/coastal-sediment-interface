# The storm bar as a result, not a target

**Status: not landed.** The attempt is preserved at `dev/experiments/transport-bar-attempt.html`.
The shipped model (`index.html`) is unchanged at 66.6.

The goal was to remove the bar from `equilibriumZ` and let it emerge from transport. The
structure is right. Four concrete bugs were found and fixed on the way. What stopped it was
the bar's *position* and *share*, not the scheme.

## Why the change was wanted

`equilibriumZ` added a Gaussian bar and a scarp to the Dean profile, and the diffusion relaxed
the bed toward that shape. Three consequences, all visible in the score:

- the bar's amplitude was a hand-set coefficient, tuned at Hs 3.4 and wrong at Hs 2.0
- sand filled the bar whether or not anything had eroded to supply it
- the bar sat where `barDistanceM` said, regardless of where the surf zone actually was

## What was built

`equilibriumZ` became the fair-weather profile only. Storms act through an undertow cell:
an offshore flux, zero at the storm waterline, rising to the breakpoint, decaying seaward. The
bed responds to minus its divergence, so the surf zone erodes and the bar builds where the
flux dies. The storm waterline is the surge divided by the beach slope (0.8 m on a 1:10 beach
moves it 8 m landward), which is what produces the beach cut.

## The four bugs, with evidence

**1. A duplicate `equilibriumZ` masked everything.** The new two-argument function was
prepended at the top of the *file*, outside the `<script>` block, and the old three-argument
one below it won on hoisting. It was called with the storm argument where `A` belonged, so
`A` was undefined and the equilibrium returned **NaN** for every wet cell. The diagnostic that
found this printed `zeq=NaN` beside a perfectly good `zbed=-1.837` for the same cell. Five
earlier attempts read 0.00 m on the upper profile because of it.

**2. The divergence sign was inverted.** `x` runs offshore→landward on this grid, so
`dY/dx = -1` and `dz/dt = -dF/dY = +dF/dx`. With the wrong sign every cell accreted
*uniformly* at +0.516 m/day. The tell was a dz profile that was constant to three decimals
across 160 m of shoreface, which no divergence produces.

**3. The erosion cap was applied to a rate, not a step.** `dz` is metres per day, but one
harness step advances thirty days. A single step dug 15 m and hit the ±15 m grid clamp, which
is where every `-15.00` and `+15.00` reading came from. Capping the *step* against the
remaining allowance fixed it.

**4. Conservation cannot come from a correction.** Forcing the row's divergence to average
zero spread the imbalance uniformly across every cell including the dry beach, and built 15 m
there. Fluxes live on cell FACES; with F pinned to zero at both ends the divergence sums to
zero by construction and no correction is needed anywhere.

## Where it stopped

With those fixed the harness passed all 69 checks and erosion matched XBeach to **0.04
relative error**. Two things were still wrong:

- the bar was about **twice** XBeach's height
- the crest sat ~60 m from XBeach's

The second is the instructive one. The check samples the bar at the breakpoint, but transport
puts the crest 20–30 m *seaward* of it — which is where real longshore bars sit. Making it
pass would mean moving deposition to the test's coordinate rather than the physics', so it was
not done.

The first is a modelling gap, not a parameter. Conservation puts **100%** of eroded sand into
the bar. XBeach's bar holds roughly 40% — the rest goes into deeper water. A two-component
deposition (sharp bar plus a broad lower-shoreface tail) is the right shape and was started,
but the split has to be validated against both cases, not tuned on one.

## Sweep results, for the record

`dev/bar_sweep.py` swept discharge spread and erosion depth across both XBeach cases:

    wDep 0.5  maxDrop 0.68 -> 57.8
    wDep 0.85 maxDrop 0.68 -> harness fail (crest falls below the breakpoint sample)
    wDep 1.3  maxDrop 0.68 -> harness fail
    wDep 1.9  maxDrop 0.68 -> harness fail
    wDep 0.5  maxDrop 0.55 -> 56.4

Nothing beat the committed 66.6, and widening the spread breaks the breakpoint check for the
reason above.

## Next

1. Split the deposition into bar and lower-shoreface components and calibrate the share
   against **both** cases at once.
2. Decide whether the breakpoint check should sample the crest's actual position rather than
   `barDistanceM`. If the physics says seaward, the check should say seaward.
3. Only then retune — the transport version's erosion term is already better than the
   committed one and should not be thrown away with the bar.

## Second pass: the split, and what it exposed

Option taken: split the deposition into a bar component and a lower-shoreface component,
calibrated across both cases, leaving the breakpoint check where it is.

Implemented as two decay scales seaward of the break:

    F(Y) = q0 * (fBar * exp(-d / wBar) + (1 - fBar) * exp(-d / wDep))
    d    = Y - (Yb - 0.6 * wBar)      peak pulled just landward of the break

so `wBar` sets the crest width, `wDep` sets how far the remainder is carried, and `fBar` sets
the share that stays in the crest.

**Result: 56.5** against the committed model. The split works — the crest stopped being 2.4x
too tall — but it did not close the gap.

### The reason the numbers were not comparable

Sweeping the split changed nothing useful because the **scored profile and the checks were
measuring different beaches.** `runProfile` never ran the wave field, so `barDistanceM` kept
its default 60 m while Gate B read the real 159 m. The scored profile was generated at a
breakpoint the app would never use.

Fixed in the harness (`computeBarDistance` exposed and refreshed after a `waveFieldStep` each
step). Under the corrected measurement:

    committed model      61.8   (was reported as 66.6)
    transport + split    56.5

So the real gap is **5.3 points, not 10** — and the committed model's 66.6 was partly an
artefact. See `PRECISION.md`.

### Where the transport version actually stands

Measured on the corrected harness, storm case:

    erosion   -1.31 @ x=450    XBeach -1.35 @ 465    position good, depth good
    crest     +0.60 @ x=300    XBeach +0.27 @ 415    2.2x too tall, 115 m short of it

The crest sits at Y ≈ 144 m offshore against a breakpoint of 159 m, which is where transport
puts it. XBeach's crest is at Y ≈ 29 m in the same frame. **That is a disagreement about where
the waves break, not about where sediment goes.** The bar cannot land in the right place while
the breakpoint is 100 m off, and no share parameter will fix it.

### Next, revised

1. Reconcile the breakpoint: the model breaks waves at 159 m offshore, the reference at ~29 m.
   That is a wave-transformation question — shoaling, the gamma cap, or the depth at breaking —
   and it gates the bar position.
2. Only after that is the `fBar`/`wBar` calibration meaningful, because it is being calibrated
   against a crest position that is itself wrong.
3. The erosion term in the transport version is already better than the committed one (0.11
   relative error) and should be kept.

## Reconciling the breakpoint

The breakpoint was the suspected cause: the model breaks at 159 m offshore, the reference's
accretion maximum is at 29 m. Measured against the model's own profile:

    Y =  20 m  h = 1.68      Y = 120 m  h = 3.71
          40       2.21            159       4.24   <- breakpoint
          60       2.65            200       4.91
          80       3.04

At the breakpoint the depth is **4.24 m**, and the breaking criterion `H = gamma*h` gives
**3.31 m** with gamma = 0.78. That is where a 3.4 m storm sea breaks on this profile. The
breakpoint is correct. It is not the obstruction.

### What the reference actually did

The full XBeach storm profile, not just its extremes:

    x=  80..290   +0.00 exactly            <- no morphological change at all
    x= 300        +0.01
    x= 380        +0.16
    x= 420        +0.27   <- accretion maximum, Y = 24 m offshore
    x= 460        -1.13   <- erosion trough, Y = -16 m

XBeach moved **no sediment** between Y = 80 and Y = 290. Its entire response is a nearshore
wedge that grows toward the beach and peaks at Y = 24 m, in roughly 2 m of water, with the
trough 40 m landward of it.

That is an **inner bar**, not a break-bar. A 2.5-day run at morfac 10 has time to adjust the
inner surf zone; it does not have time to build the outer bar at the breakpoint, where the
energy is lower and the response slower. Our model builds the break-bar because the undertow
peaks at the break by construction.

**So the bar-position probe is comparing an outer bar to an inner bar and calling the
difference an error.** `argmax` picks whichever accretion is largest anywhere in the profile,
and in the reference that is the nearshore wedge.

### The real disagreement, stated properly

It is not where the waves break. It is the **distribution of deposition**. In the zone the
reference actually resolved (Y < 80):

    XBeach   peaks at Y = 24 m,  +0.27
    model    peaks at Y = 64 m,  +0.20,  with its global maximum at the break, Y = 164 m

So the model puts too much of the load at the break and too little into the inner surf zone.
That is a deposition-shape question, and it is answerable — but only after deciding what the
reference is a reference *for*, which is a modelling choice rather than a bug.

### Two ways forward

1. **Extend the reference.** Run XBeach longer so a break-bar has time to form, and score
   against that. The current 2.5-day run resolves the inner surf zone and nothing else.
2. **Add the inner-surf term.** Give the deposition a second component tied to runup and the
   inner surf zone, so the model produces the wedge the reference shows instead of only the
   break-bar.

Option 1 is the honest one for a metric. Option 2 is what makes the model right. They are not
mutually exclusive, and doing 2 before 1 risks calibrating to a truncated reference.

## The XBeach output format, and why the reference looked wrong

Recording the extended run meant reading `zb.dat`, and the existing references had no recorded
convention. That cost a long detour, so it is written down here.

- `zb.dat` is a plain array of `(nx+1)*(ny+1)` doubles per output with **no header**. The
  record stride is `121*41*8 = 39688` bytes, and 21 records make the 833448-byte file exactly.
- The initial bed is `bed.dep`, ASCII, also `(ny+1) x (nx+1)`, identical across alongshore rows.
- Read with the cell count `120*40 = 4800` instead of `4961`, the array scrambles. The
  alongshore mean then collapses by a factor of six — the bar appears to vanish, and every
  magnitude looks wrong by that factor. That misread is what made the reference look like it
  disagreed with the physics.

`dev/record_xbeach.py` now does this properly and states its convention: **finalDz is the
alongshore mean of (final - initial)**, with the per-row spread recorded alongside it.

Verified against the existing moderate case, which it reproduces exactly:

    recorded   -0.8274 .. +0.1374   erosion x=450, accretion x=405
    recorder   -0.8274 .. +0.1382   erosion x=450, accretion x=405

The storm case records as `-1.264 .. +0.355` against the stored `-1.3452 .. +0.2742` at the
same positions. The stored values came from an earlier run of the same setup; the positions
agree exactly, so the convention is the same and only the run instance differs.
