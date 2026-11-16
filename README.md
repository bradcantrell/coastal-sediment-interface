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

**Phase 5 — export.** The page runs on the shared Sediment Interface (`index.html`, the same
file the fluvial interface uses: panels, particles, bed editor, obstacle choreography and
timeline). The coastal model is `model.js` and the XBeach export is `site.js`: a wave
transformation, cross-shore profile response, CERC longshore transport, a timeline on model
years, and an XBeach case writer.

Presets and teaching notes are **not built yet** (Phase 6).

**XBeach status.** A generated case builds and runs in XBeach, and the browser model is
scored against eight recorded XBeach runs on two beaches. In the storm case the two change
profiles correlate at 0.99 and the model moves 0.90 of XBeach's peak amplitude. See
"Agreement with XBeach" below for what agrees and what does not.

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
| Storm profile | Dean with its slope capped at 0.023 (1 in 43), the line XBeach cuts across the waterline |
| Cross-shore | Conservative diffusion of the bed's distance from that profile, fading out around a depth of closure of 2 m + 0.8·Hs, deeper under long-period swell |
| Dune | Waves cut up to 0.15·Hs above the water; behind that the bed slumps at 0.3 (wet) or 1.0 (dry) |
| Dune recovery | Wind moves sand from the dry beach to a cut dune at a set rate (default 10 m³/m/yr), in calm only |
| Longshore | CERC, Q = K/(16(s−1))·Hb^2.5/√γ·sin(2αb) |
| Bed change | dz/dt = −(1/(1−p))·(dQ/dy)/W_active |

**Not modelled:** diffraction and sheltering (a structure stops waves only in its own cells; the shoreward
march carries the wave height past it, so there is no shadow behind it, measured 2026-11-15), infragravity, erosion of
the bed below the waterline by storm waves, and shoreline feedback into the breaking angle, so a groyne fillet
does not feed back to reduce transport. The cross-shore and longshore terms both conserve
sand and are kept in separate bed layers; they are summed into the bed but not yet coupled.
Sea-level rise is handled only in a basic way: the target profile follows the water level,
so a higher level slowly moves the profile up and inland.

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

The ZIP is made to be run on your own machine. It also holds `run.sh` and `run.bat`, which
start the XBeach on the PATH (or the one named in `XBEACH`), a `README.md` that says how to
run it and how to read what comes out, and `scene.json`, the scene itself. The **open**
button in the tab row reads `scene.json`, or the ZIP as it is, and puts the drawing and the
settings back. Checked 2026-11-15 with a ZIP made by the page: `run.bat` on Windows ran the case through
XBeach in 96 s and wrote 21 output times of 121 x 41 values, as the case's README says, and
prints a plain message when no XBeach is found. `run.sh` is checked with a stand-in binary.

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

Default destination is `xbeach-src` in the current folder; the binary lands at
`<destination>/src/xbeach/.libs/xbeach.exe`. Verified from a clean clone.

Three things are needed beyond a bare toolchain. `scripts/generate.py` produces the
`.inc` files and imports `mako`. `mnemoniciso.F90` declares a `bind(c)` type containing
`character(len=20)` components, which gfortran 16 rejects — relaxing `b_arraytype` to a
plain `type` fixes it, because that type is used only inside `mnemoniciso.F90`. `carraytype`
**must** keep `bind(c)`: `introspection.F90` passes it through a `bind(C)` procedure.

Rebuild with `make clean` after patching; stale `.mod` files will otherwise reproduce the
old error and look like the patch failed.

### Agreement with XBeach

Nine XBeach runs, each 10 model days (`tstop = 86400`, `morfac = 10`), are recorded in
`dev/xbeach-reference*.json`: six on the default beach (0.3 mm sand) and three on a second
beach (0.5 mm sand and the steeper seabed that goes with it). Eight are scored. The profiles
compared are the change in bed level averaged over the middle of the reach.

| Case | Sand (mm) | Hs (m) | Surge (m) | Profile error, rmse (m) | Sand deposited, model / XBeach (m² per m) |
|---|---|---|---|---|---|
| storm | 0.3 | 3.4 | 0.8 | 0.055 | 41 / 46 |
| normal (same storm, shore-normal) | 0.3 | 3.4 | 0.8 | 0.051 | 41 / 53 |
| mid | 0.3 | 2.7 | 0.55 | 0.122 | 27 / 29 |
| moderate | 0.3 | 2.0 | 0.3 | 0.064 | 14 / 19 |
| no surge | 0.3 | 3.4 | 0 | 0.161 | 15 / 43 |
| storm, second beach | 0.5 | 3.4 | 0.8 | 0.079 | 57 / 68 |
| mid, second beach | 0.5 | 2.7 | 0.55 | 0.115 | 42 / 36 |
| moderate, second beach | 0.5 | 2.0 | 0.3 | 0.128 | 28 / 21 |

Nothing in the model was fitted to the second beach before it was added.

In the storm case the dune scarp is at x = 480 m on day 10 in both models, and the eroded
volume tracks XBeach day by day (14 against 14 m² per metre on day 1, 41 against 46 on
day 10).

What does not agree:

- **No surge.** Only 11 of the 40 m² per metre in XBeach's bar comes from the beach; the model
  takes 15 from the beach. Most of the rest XBeach scours from the seabed beside its
  offshore wave boundary, which is a property of that setup and not of a beach.
- **Bar shape.** The deposit is a ramp with its crest 15 to 40 m landward of XBeach's detached
  bar. See "Future work".
- **Calm.** XBeach cuts 0.6 m into this beach under 1.2 m waves. This model holds a calm
  beach still by design, so that run is reported and not scored.
- **How fitted it is.** The transport rate, the depth of closure and the wave reach are fitted
  to the six runs on the first beach, which share one bed and one grain size. Dune recovery
  and the swell term are not fitted to anything.

The composite precision score is 80.4 out of 100 over eight runs, three of them on a second beach (0.5 mm sand, steeper seabed) to which nothing had been fitted when they were added; those three give a mean profile error of 0.11 m. `dev/PRECISION.md` records every score with
its commit and the reason it moved. Regenerate a reference with `dev/build-xbeach-msys2.sh`,
a case from the export panel, `xbeach.exe` in that directory, and `dev/record_xbeach.py`.

### Future work

The model builds its storm deposit as a ramp that is highest next to the beach. XBeach, and
real beaches, build a detached bar with a trough behind it. Getting that shape means
replacing the cross-shore step with a wave-driven transport (undertow carrying sand seaward,
wave asymmetry carrying it landward). It is marked as future work and not started.

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

Two view toggles are on when the page opens. **waves** draws the model's wave field as moving
crests (closer together in shallow water, bending as they come in at an angle, white where
they break), and **smooth** softens the wash that shows where the beach has built up or worn
away. The **streak** toggle, which the river interface has too, is also on and draws each
grain as a line along its path.

## Morphology

The bed moves toward an equilibrium profile, at a pace set by **model rate** (model days per
real second) and by wave height. In calm the equilibrium is the Dean profile the default
beach is built from, and nothing moves. Under storm waves the nearshore cannot hold Dean's
steep slope, and the equilibrium becomes a gentle terrace across the waterline. The sand cut
from above that line moves offshore and builds the bar, inside the depth of closure.

Waves only cut as high as they reach. Behind that the dune slumps onto the beach a little at
a time, so the scarp retreats through the storm and erosion keeps growing instead of
stopping when the beach is used up. A storm response takes model days to weeks. When the
storm passes the bar decays and calm waves rebuild the beach to the berm top within months.
Above that, wind carries sand from the dry beach back to the cut dune at the **dune**
rate, over years.

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

New to it? Press **? guide** in the bottom left corner, or the `?` key, for a walkthrough that lights up each part of the screen and explains it. The key list along the bottom shows whenever the run is paused.

## Testing

```
node dev/headless_harness.js index.html      # the coastal model and the export
node dev/interface_harness.js index.html     # the shared interface under this model
```

The harness parses the real markup, mocks p5 and the DOM, seeds every control from its
`value=""` default, runs `setup()` and 30 frames, then asserts the field is live and
responds correctly to its controls — storm breaks deeper than calm, spread expands to
seven weighted components, obliquity lowers the peak, no NaN at the small-wave limit.

Part of the current run (2026-11-14):

```
field: 10710 wet cells, max depth 7.02 m, max H 1.42 m, mean H 1.230 m
runup R2 0.476 m, Iribarren 0.183
break 3.18 m @ 4.19 m, runup 1.20 m, max H 3.43 m
Gate A  settled 0.000 m | perturbed 0.822 m -> relaxed 0.814 m
        volume 723600.0 -> 723600.0 bed units
Gate B  storm intensity 1.00, breakpoint 159 m offshore
        upper profile 0.80 -> 0.10 m after 10 d, -0.05 m after the long storm
        bar after 10 d: +0.31 m at 32 m offshore
        largest bed change 350 to 400 m offshore: 0.0000 m
        after 125 calm days: +0.02 m where the 10-day crest was (-0.30); upper profile 0.10 -> 0.80 m
bed round-trip: worst |browser - exported| = 0.0000 m
reference: erosion -1.7919 m at x=475, accretion 0.4104 m at x=390
interface: erosion -1.614 m at x=475, accretion 0.322 m
equal morphological time (10 d): correlation 0.986 over 55 cells
amplitude at equal time: 1.614 vs xbeach 1.792 m (ratio 0.90)
```

97 checks. 96 pass on a slower machine; the one failure is a frame-time limit recorded on a faster
machine.

Note: extracting the script and running `node --check` alone is **not** sufficient — it
passes on a field that is silently empty. The behavioural checks are the real gate.

## License

MIT — see `LICENSE`.
