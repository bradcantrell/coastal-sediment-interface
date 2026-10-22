# Coastal Sediment Interface

A browser-based **coastal wave and beach simulator** — the coastal sibling of
[`sediment-interface`](https://github.com/bradcantrell/sediment-interface) (fluvial) and
[`tidal-sediment-interface`](https://github.com/bradcantrell/tidal-sediment-interface).

Students and designers set coastal starting conditions, draw structures, choreograph them
on a timeline, and watch a beach profile respond: where sand goes under a given wave
climate, what a groyne traps, what a storm takes away.

**Two-dimensional plan form. One sediment class. No infragravity.** That boundary is
deliberate — everything past it is what the case export is for.

## Status

**Phase 5 — export.** The interface shell carries over from the fluvial Sediment Interface:
all panels, particles, bed grids, obstacle choreography and timeline. On top of that: a wave
transformation, cross-shore profile response, CERC longshore transport, a timeline on model
years, and an XBeach case writer.

Presets and teaching notes are **not built yet** (Phase 6).

**XBeach status — half the gate is met.** A generated case has been built and run: it
completes headless in ~3.5 minutes with exit 0 and produces `zb.dat`. But the plan's gate
also asks for a bed change *in the same direction as the browser*, and **that part fails** —
correlation between the two cross-shore change profiles is +0.07 with 39% sign agreement.
The cause is known and is not a bug in the export: see "Agreement with XBeach" below.

See `PLAN.md` for the full design and the phase gates.

## Physics

| Process | Method |
|---|---|
| Dispersion | Newton solution of ω² = gk·tanh(kh) |
| Refraction | Snell, alongshore wavenumber k·sinθ conserved |
| Shoaling | Energy-flux conservation on the oblique flux Cg·cosθ |
| Breaking | Battjes & Janssen (1978), γ = 0.78, Qb = exp(−(γh/Hrms)²) |
| Runup | Stockdon et al. (2006), R2 on a plane foreshore |
| Wave input | 1 component (monochromatic) or 7 wrapped-Gaussian directional bins |
| Profile | Dean h = A·y^(2/3), A from Soulsby (1997) settling velocity |
| Morphology | dz/dt = (z_eq − z)/T, storm-modified z_eq |
| Longshore | CERC, Q = K/(16(s−1))·Hb^2.5/√γ·sin(2αb) |
| Bed change | dz/dt = −(1/(1−p))·(dQ/dy)/W_active |

**Not modelled:** diffraction (a structure casts a hard shadow), infragravity, shoreline
retreat under sea-level rise (the equilibrium profile is anchored rather than translated),
and shoreline feedback into the breaking angle — so a groyne fillet does not feed back to
reduce transport. The cross-shore relaxation is target-seeking and **not volume-conserving**;
the longshore term is conservative and is kept in its own bed layer so the relaxation cannot
erase it. The two are summed into the bed but not yet coupled.

## Longshore transport

Transport is computed per alongshore row at the break point and the bed follows its
divergence. Structures block it because they occupy the surf zone: `buildSolidMask` zeroes
the wave field inside them, so no cell in that row breaks, so Q is zero there. The resulting
gradient **is** the groyne effect — sand piles up on the updrift side and starves the
downdrift side.

The transport field is smoothed over a six-row window. A groyne occupies fewer alongshore
rows than the grid resolves, so differencing it directly deposits the whole fillet into a
single row — a spike, not a beach. This is a numerical treatment, not physics.

CERC is accurate to perhaps ±50% in absolute terms. The gates are therefore about behaviour
— the zero at shore-normal, the peak at 45°, which side of a groyne gains sand — not about
the absolute cubic metres per second.

## Export

The **xbeach** button writes a runnable case as a ZIP: `params.txt`, `bed.dep`, `jonswap.txt`.
No library — the archive is built in the page.

Three conversions are easy to get backwards, so they are stated in the code:

- **`posdwn = -1`** — bed elevations positive up, matching `bedZ`. The alternative is
  flipping every value in `bed.dep`.
- **`D50` and `D90` are in metres in `params.txt`, not millimetres.** This interface works in
  millimetres. Real cases carry `D50 = 0.0002` for 0.2 mm sand.
- **`mainang` is nautical, 180–360, and is the direction waves come *from*.** Shore-normal in
  this interface is `270`.

`bed.dep` holds `(nx+1) × (ny+1)` values, one cross-shore transect per row. Verified against
the browser: at five sample corners the exported elevation matches `bedZ` to 0.0000 m.

The archive is verified with Python's `zipfile` — `testzip()` reports all CRCs valid.

### Running it

Built and run on this machine with MSYS2 + gfortran 16.2.0, serial, no MPI, no netCDF. The
whole recipe is scripted:

```
/c/msys64/usr/bin/bash.exe dev/build-xbeach-msys2.sh [destination]
```

Default destination is `D:/workspace/xbeach-src`; the binary lands at
`<destination>/src/xbeach/.libs/xbeach.exe`. Verified from a clean clone.

Three things are needed beyond a bare toolchain. `scripts/generate.py` produces the
`.inc` files and imports `mako`. `mnemoniciso.F90` declares a `bind(c)` type containing
`character(len=20)` components, which gfortran 16 rejects — relaxing `b_arraytype` to a
plain `type` fixes it, because that type is used only inside `mnemoniciso.F90`. `carraytype`
**must** keep `bind(c)`: `introspection.F90` passes it through a `bind(C)` procedure.

Rebuild with `make clean` after patching; stale `.mod` files will otherwise reproduce the
old error and look like the patch failed.

### Agreement with XBeach

Same bed, same storm (Hs 3.4 m, Tp 12 s, 0.8 m surge), same morphological time — 2.5 model
days, which is what XBeach integrates at `tstop = 21600` with `morfac = 10`:

| | XBeach | This interface |
|---|---|---|
| Peak erosion | −1.35 m at x = 465 m | −1.51 m at x = 455 m |
| Peak accretion | +0.27 m at x = 415 m | +0.87 m |
| Peak amplitude | 1.35 m | 1.51 m (**ratio 1.12**) |
| Correlation of the change profiles | — | **0.837** |

Before the transport rewrite these figures were −0.04 m against −1.35 m: the interface moved
roughly 15× too little sand. Cross-shore transport as a conservative flux brought the rate to
within 12% and the pattern to 0.84.

Erosion now matches closely. Accretion is generous — the modelled bar holds about three times
the sand XBeach deposits, which is the obvious next thing to look at. The profile is also not
yet volume-exact against XBeach, only against itself.

The comparison runs in the harness against `dev/xbeach-reference.json`. Regenerate the
reference with `dev/build-xbeach-msys2.sh`, the storm case from the export panel, and
`xbeach.exe` in that directory.

## Timeline

One clock. **Model years**, not seconds — `modelYears` advances with the morphology, and
the timeline reads it. An object clipped to start in year 10 activates when the model
reaches year 10, not when the browser has been open for ten of something else. Clips are
`{start, dur}` in model years.

Objects carry a `kind`. Structural kinds block the wave field and therefore the transport.
**Nourishment** (`kind: 'nourish'`, key `4`) does not — it is sand, not concrete — and adds
0.5 m of bed per model year across its footprint.

## Panels

Wave height, period, direction and directional spread; water level; sea-level rise; D50;
foreshore slope. Presets: calm summer, winter storm, post-storm recovery, SLR 2100.

The readout reports breaking wave height and depth, Stockdon runup, the Iribarren number
and breaker type, erosion and accretion rates, storm intensity, bar distance, longshore
transport rate, and the current model year against the timeline position.

## Morphology

The bed relaxes toward an equilibrium profile at a rate set by **model rate** (model days
per real second) and **response** (the e-folding time). Under wave energy the equilibrium
changes: the beach face flattens and cuts back, and a bar forms at the breakpoint. Both
are driven by the same storm intensity, so they stay coupled — which is why a storm digs
the upper beach and piles the sand into a bar, and why the bar decays once the storm passes.

## Units and orientation

Metres and seconds throughout. **Cross-shore runs along x** — offshore at the left edge,
waterline at 74% of the width, dune at the right. Wave energy marches in from the left, so
the right third of the window is beach. The alongshore extent is y: 400 m of shore, 300 m
of profile. Bed elevations are stored in bed units at `M_PER_BED_UNIT = 0.05` m per unit.

Velocities are stored in cells per frame for the particle system, with a `VEL_GAIN` of 120
so orbital motion reads at a human scale; the bed physics uses metres and seconds. The
`+0.6` bias on the oscillating term is a stand-in for Stokes drift — without it the
particles slosh in place and the water reads as static.

## Running

Static file, no build step:

```
python -m http.server 8102
```

then open <http://localhost:8102/>.

## Testing

```
node dev/headless_harness.js index.html
```

The harness parses the real markup, mocks p5 and the DOM, seeds every control from its
`value=""` default, runs `setup()` and 30 frames, then asserts the field is live and
responds correctly to its controls — storm breaks deeper than calm, spread expands to
seven weighted components, obliquity lowers the peak, no NaN at the small-wave limit.

Current run:

```
field: 10710 wet cells, max depth 7.02 m, max H 1.42 m, mean H 1.230 m
runup R2 0.476 m, Iribarren 0.183
storm: break 3.18 m @ 4.19 m, runup 1.20 m, max H 3.43 m
Gate A  settled 0.000 m | perturbed 0.822 m -> relaxed 0.782 m
        volume 723600.0 -> 723600.0 bed units (0.00% drift)
Gate B  storm bar 159.3 m offshore, intensity 0.62
        upper profile 0.80 -> -0.03 m (-0.83)
        bar crest     -3.56 -> -2.89 m (0.67)
        after calm    -3.56 m (-0.67)
profile: offshore -7.05 m, landward 8.55 m
orientation: waterline at 74% of width
particles: mean x 423 px, max x 840 px
period-averaged onshore component 0.488 cells/frame
longshore: Q zero at shore-normal, peak at 45 deg, reverses with direction
groyne: updrift +0.0274 m, downdrift -0.0274 m
timeline: year 7.5 -> 7.5, year 23.0 -> 3.0 (loop 20 yr)
clipped groyne: inactive at year 5 (no change), active at year 13 (14.4 m of change)
nourishment: not solid, raises the bed 5.00 m over 10 years
xbeach: bed.dep 41 x 121, profile -8.00 / +7.50 m, round-trip 0.0000 m
zip: 3 entries, all CRCs valid under python zipfile.testzip()
xbeach run: exit 0, 22,183 timesteps (calm) and 11,620 (storm), zb.dat produced
xbeach storm: correlation 0.837, amplitude ratio 1.12, volume conserved 0.00%
65 checks, 0 failures
HARNESS PASS
```

Note: extracting the script and running `node --check` alone is **not** sufficient — it
passes on a field that is silently empty. The behavioural checks are the real gate.

## License

MIT — see `LICENSE`.
