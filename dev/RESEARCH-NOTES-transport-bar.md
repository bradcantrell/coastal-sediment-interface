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
