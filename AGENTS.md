# Coastal Sediment Interface — Project Conventions
# Read by coding agents working in this directory. Notes about our own machines and
# checkouts are in `AGENTS.local.md`, which git ignores; read it too if it is there.

Browser-based coastal wave and beach simulator. Coastal sibling of `bradcantrell/sediment-interface`
(fluvial) and `bradcantrell/tidal-sediment-interface`. Read `PLAN.md` before changing physics.

## What it is — three files, and which one a change belongs in

The page is three files that load in this order and share one script scope. No build step,
no backend. p5.js 1.11.3 from cdnjs.

| File | Layer | What it is | Owned by |
|---|---|---|---|
| `index.html` | **interface** | Canvas, sediment particles, drawn bed and its editor, deposit, obstacles and their timeline, 3D view, sidebar. Knows nothing about waves. | `sediment-interface`, vendored byte for byte |
| `model.js` | **model** | Everything coastal: the wave field, the bed change it drives, nourishment, model time, the coastal and morphology controls and readouts, the bed rendering. | this repo |
| `site.js` | **site** | The XBeach case export. | this repo |

- **Never edit `index.html` or `dev/interface_harness.js` here.** They are copies;
  `dev/core.lock` records the commit and hashes, and the interface harness fails if one
  drifts. To change the interface: change it in the `sediment-interface` repo,
  run that repo's harness, commit there, run `dev/sync_core.sh` here (it reads a
  `sediment-interface` checkout next to this one, or the path you give it), and run both
  harnesses here. How the interface is organised and its rules are in
  `sediment-interface/AGENTS.md`.
- **The model reaches the interface through hooks**, registered at the bottom of `model.js`
  with `registerModel()` (the MODEL EXTENSION POINT comment in `index.html` is the
  reference). The ones this model uses: `step` (waves, then the bed, on model time),
  `spinUp` (waves only), `bedTotal` (adds `morphZ + longZ`), `defaultBedZ`, `bedGridsReady`,
  `renderBed`, `bed` (the editor's range), `clock` / `formatDuration` / `timeline` (model
  years), `isSolid` / `makeObstacle` / `key` (nourishment, key 4), `rules` (sediment),
  `hud`, `controls`, `render`. If the model needs something the interface does not offer,
  that is a new hook in `sediment-interface` with a check, not an edit here.
- Until 2026-11-13 this was one self-contained `index.html`, a fork of an early fluvial
  interface. `dev/experiments/transport-bar-attempt.html` is still that old single-file
  form and will not pick up interface changes.

What changed for the user when it moved onto the shared interface: the XBeach export sits at
the top of the sidebar; the OpenFOAM EXPORT CASE button is gone (it loaded a file this repo
never had) along with the inflow slider that only fed it; the 3D view shows the beach
instead of "no bed defined"; leaving bed mode with Escape restores the run state; and two
interface fixes are inherited (deposit lands on the cell it is read from, and sediment
bounces off rotated rectangles along the right normal). Those two fixes are the entire
difference in the precision score, 62.6 to 62.7; with them undone every probe value is
byte-identical. See `dev/PRECISION.md`.

**Scope boundary, settled:** two-dimensional plan form, one sediment class, no infragravity.
Do not add a third dimension, multiple sediment classes, or infragravity without asking.

**Visibility:** repo is **public** — `bradcantrell/coastal-sediment-interface`. GitHub Pages is
live at https://bradcantrell.github.io/coastal-sediment-interface/ and takes ~75 s to rebuild
after a push. Going private **deletes the Pages configuration**; making it public again does
not restore it — re-run `POST /repos/{owner}/{repo}/pages`.

## Drawing the waves and the wash (the waves and smooth toggles)

- **waves** (on by default) draws the wave field as moving crests: `waveCrestField()` adds up
  the phase shoreward along each row from the offshore alongshore wavenumber, using
  `wavenumberK` at each cell's depth and `waveAngle`; `drawWaveCrests()` (the `drawUnderlay`
  hook) paints a quarter-size image and screens it over the bed. The phase carries through a
  structure. The crests move on `simTime` at the peak period. About 5 ms a frame at 1330 px
  in headless Chrome.
- **smooth** (on by default) blurs the wash and the dry-beach ramp in `coastalRenderBed()`
  before the contours are drawn (`softenBedSurface()`); the contours stay sharp.
- Neither changes the model. Two checks cover them (crests follow the field; the toggles).

## Units and geometry

**Metres and seconds.** A deliberate departure from the tidal interface, which is
dimensionless. Coastal design is metric-native and students need real numbers to reason with.

- **Cross-shore runs along x.** Offshore at x = 0, waterline at 0.74 · width, dune at the
  right edge. Wave energy marches in +x. **Alongshore is y.**
- Reach: 600 m cross-shore × 400 m alongshore. Canvas is 1200 × 800 px.
- Bed elevations are stored in **bed units**; `M_PER_BED_UNIT = 0.05` m per unit.
- `conditions.d50` is in **millimetres**; `params.txt` wants **metres**. Divide by 1000.

## Physics (current state — Phase 5 complete)

The fluvial Stam solver is **gone**. In its place, one analytic pass per frame:

- `wavenumberK(T, h)` — Newton on ω² = gk·tanh(kh), ≤12 iterations, deep-water fallback.
- `groupVelocity(T, h)` — Cg = nC.
- `transformComponent(i, comp)` — marches j = 1..NY per column carrying `{H, θ, k, Cg}`.
  Snell refraction `sinθ = sinθ_prev·(k_prev/k)`; shoaling on **oblique flux**
  `H = H_prev·√(flux_prev/flux)` with `flux = Cg·cosθ`; breaking via Battjes–Janssen
  `Qb = exp(−(γh/Hrms)²)`; hard cap `H ≤ γh` at `γ = 0.78`. Stores `waveAngle`.
- `combineComponents()` — `H² = Σ wᵢHᵢ²` over the directional bins.
- `computeRunup()` — Stockdon et al. (2006) eq. 18, `R2 = 1.1(η + S)`, plus Iribarren.
- `morphologyStep()` — cross-shore: conservative implicit diffusion of the bed's distance
  from `equilibriumZ()`, then slumping. See "Cross-shore morphology" below.
- `computeLongshore()` / `applyLongshore()` — CERC, conservative flux divergence.
- `applyNourishment()` — sand placed by `kind: 'nourish'` objects.

**Not modelled:** diffraction and sheltering (a structure stops waves only in its own cells; the shoreward
march carries the wave height past it, so there is no shadow behind it, measured 2026-11-15), infragravity, erosion of the
bed below the waterline by storm waves, and shoreline feedback into the breaking angle. Sea-level rise is basic: the target follows the water level.

## Bed model — three layers, and why

`bedZ = userBedZ + depoZ + morphZ + longZ`

- `userBedGrid` / `depoGrid` — owned by the interface; the drawn bed and particle deposit.
  The interface computes `userBedZ + depoZ` and hands it to the model's `bedTotal`, which
  adds the two layers below in the same order as before. The grains' deposits are part of
  the bed the waves see and the morphology moves, on purpose (Brad, 2026-11-16: the bed
  should come from the deposits). A grain's deposit is sized by model time
  (`rules.depositAmount()`: `DEPO_AMOUNT` per `DEPO_DT_REF`, the default rate at 60 frames),
  so the bed grows at the same rate per model day at any rate slider or frame rate.
- `morphGrid` — cross-shore change. **Conservative** since stage 4: every row keeps its sand
  (a harness check, to 0.05 m2 per metre of shore over a 10-day storm).
- `longGrid` — longshore transport. **Conservative.** Kept in its own layer so cross-shore
  change cannot erase the accretion that proves a groyne works.
- `bedZ0 = userBedZ + depoZ` — the bed without morphology; used for the change overlay and to
  find the waterline the Dean target hangs from.

The two morphology layers are summed into the bed but **not coupled**.

## Cross-shore morphology (stage 4, 2026-11-14)

Each of these was measured against XBeach and is covered by a check. `dev/PRECISION.md` has
the numbers and the reasons; do not undo one without reading its entry there.

- **The target, `equilibriumZ(Y, storm, A)`.** Calm: Dean seaward, `BEACH_SLOPE` landward,
  which is the seeded bed. Storm: Dean with its slope capped at `TERRACE_SLOPE` (0.023), the
  tangent line continuing up the beach. The two are blended by `storm`. There is no bar drawn
  into the target; the bar is the sand cut from above the terrace.
- **`stormIntensity()` is wave height only**: 0 at 1.2 m, 1 from 2.0 m. A surge acts through
  the water level, not through this number.
- **The target follows the live water level.** `shoreRefAt()` re-derives the waterline, from
  the bed without the morphology layer, whenever the water level changes. Taking it from the
  evolving bed makes the target chase the bed and diverge.
- **Depth of closure.** `2.0 + 0.8 * Hs` m of water. Mobility is 1 to half that depth, then
  falls as a cube to 0 at 1.25 times it. A straight fade to 0 at the closure depth left a
  ledge at the seaward end of the deposit.
- **Swell.** The closure depth gains `0.8 m` per second of peak period beyond `5.8 + 1.83 * Hs`.
  That line is the period the XBeach runs had for their wave height, so the term is zero on
  every reference and the score cannot see it. Its size is a choice. It lets long, low swell
  level the bump a short sea leaves at the edge of its reach after a storm. Each face uses the smaller mobility of its two
  cells from both sides, which is what keeps the step conservative.
- **Rate.** `TRANSPORT_D0 = 0.0023` m2/s at 1.5 m waves, linear in Hs. A storm response takes
  model days to weeks.
- **Wave reach.** Waves cut the bed only up to `WAVE_REACH_PER_HS` (0.15) x Hs above the live
  water level. Sand can be put back up to `BERM_TOP_M` above it. This number is fitted and
  the result is sensitive to it.
- **Slump.** Behind a cell the model has lowered, the bed cannot stand steeper than 0.3 if the
  lower cell is within wave reach, 1.0 otherwise. Both directions. This is how the dune feeds
  the beach and why erosion keeps growing through a storm.
- **Dune recovery.** In calm, wind moves sand from the dry beach (above wave reach, up to the
  berm top) to dune cells the model has lowered, each in proportion to what it is missing,
  at `duneRate` m3 per metre per year (the "dune" slider in the morphology panel, default 10). Off under
  storm waves. Not fitted to anything: XBeach has no wind. Calm waves alone rebuild the beach
  to the berm top, which covers most of a scarp; the wind does the part above that.
- **Alongshore exchange.** After the rows, the same implicit diffusion runs down each column
  at the same diffusivity (`ALONG_D_FACTOR` = 1), over every wet cell within wave reach, and
  not across a structure, the dry beach or a row with no shoreline. Conservative. Without it
  the grains' random deposits grew into stripes across the shore (120 storm days, Hs 3.4 m,
  three groynes: row-to-row roughness 0.30 m at 0.8 h steps, 0.15 m at 2.9 h; deposits off,
  0). With it: 0.027, 0.039 and 0.047 m at 0.8, 2.9 and 8.6 h steps, largest change 1.7 to
  1.8 m at all three. It reaches past the depth of closure because grains settle there too;
  held to the cross-shore mobility it left them standing (0.32 m against 0.05 m). Score
  unchanged at 80.4: the XBeach runs are the same in every row. The harness checks the
  spreading, conservation, the structure and the deposit size.
- `morphZ()` and `longZ()` hold their edge value past the last cell centre. Reading zero
  there once let the off-canvas grid row run away and leak into the scored profile.

Known limits:
- The deposit is a ramp, highest next to the beach, with its crest 15 to 40 m landward of
  XBeach's. XBeach builds a detached bar with a trough behind it.
- With the dune slider at 0 the sand a storm took from the dune has nowhere to return to and
  stays as a layer a few centimetres thick over the active profile.
- The no-surge case scores poorly for a reason that is in the reference, not the model (see
  "XBeach agreement").

**Future work, not started: a bar and a trough.** Marked by Brad on 2026-11-14 as something
to address later. Getting a detached bar means replacing the cross-shore step (diffusion of
the bed's distance from a target) with a wave-driven transport: undertow carrying sand
seaward, wave asymmetry carrying it landward, the bar forming where they balance. Two
smaller attempts failed and are recorded in `dev/PRECISION.md`: lowering the terrace slope,
and a seaward drift on the disequilibrium. It replaces the part of the model that agrees
with XBeach best, so discuss with Brad before starting.

## XBeach agreement — what is and is not true

The exported case builds and runs. The model is scored against six recorded XBeach runs on
the same bed, 10 model days each (`dev/xbeach-reference*.json`, written by
`dev/record_xbeach.py` from the middle rows 12 to 28). Eight runs are scored (five here, three on a second beach); the calm run is
reported only, because XBeach erodes a calm beach and this model holds it still by design.

    SCORE=probes.json node dev/headless_harness.js index.html     # about 5 minutes
    python3 dev/precision_score.py probes.json

- Composite 80.4 on eight cases (80.2 on the first five). The basis changed twice on 2026-11-14 with the model unchanged: bar position
  scored on the deposit centre (70.8 -> 72.3), then the probes run on a bed actually cleared
  of particle deposit (72.3 -> 80.6). Compare only like with like; `dev/PRECISION.md` has it. Mean profile error over the six runs 0.091 m.
- Storm case: correlation 0.99, peak amplitude 0.90 of XBeach's, deposit 41 against 46 m2/m.
- The transport rate, closure depth and wave reach are fitted to these runs, which share one
  bed and one grain size. Say so when quoting agreement.
- Three more runs on a second beach (0.5 mm sand, steeper seabed) are scored since
  2026-11-14: `dev/xbeach-reference-coarse-*.json`. Nothing had been fitted to them at that
  point (mean rmse 0.11 m). They are no longer an independent test; the next needs a new beach.
- The no-surge case's error is mostly the reference: 23 of the 40 m2/m in XBeach's bar is
  scoured from beside its offshore wave boundary. Do not make the model erode deep water to
  match it.
- To make a new case: `XB_CASE='{"Hs":2.7,"d50":0.5,...}' XB_OUT=dir node dev/headless_harness.js
  index.html` writes the XBeach inputs and `conditions.json`; run XBeach in that folder; then
  `python3 dev/record_xbeach.py dir 86400 10 dev/xbeach-reference-NAME.json dir/conditions.json`.
- An XBeach run takes about 8 minutes, CPU only. A Windows build made with MSYS2 needs
  `C:\msys64\mingw64\bin` on PATH. The reference run folders were `xb-storm-long`,
  `xb-case2-long`, `xb-ref-normal`, `xb-ref-nosurge`, `xb-ref-mid`, `xb-ref-calm`, `xb2-storm`,
  `xb2-moderate`, `xb2-mid`.

## Timeline

**Model years, not seconds.** `modelYears` accumulates from the morphology step and
`timelineLoopTime()` reads it, so the timeline and the bed share one clock. `timelineDuration`
and every clip `{start, dur}` are in model years; default loop 20 yr.

## Data model

- `depoGrid` / `userBedGrid` / `morphGrid` / `longGrid` — Float32Array on a `DEPO_CELL` = 4 px grid.
- `bedPoints` — user-drawn stations. **When empty the bed falls back to `defaultCoastalBedZ`.**
- `particles[]` — suspended sediment, seeded across the water, not as an inflow stream.
- `obstacles[]` — `{type, x, y, w, h, rotation, kind?, clips:[{start, dur}]}` or poly.
  **`clips: []` means the object is NEVER active** — `isObstacleActive` returns false.
- `waveComponents[]` — `[{Hs, Tp, dirDeg, weight}]`. Monochromatic is `N = 1`.

## The default profile IS the equilibrium

`defaultCoastalBedZ` is built **from** the equilibrium: Dean `h = A·y^(2/3)` offshore,
`BEACH_SLOPE` landward, `DUNE_SLOPE` beyond the berm crest. Under calm the disequilibrium is
zero, so the bed does not lurch on load.

- `BEACH_SLOPE` (0.10) is the morphology's beach gradient. **`conditions.slope` is not the
  same thing** — that is the foreshore gradient feeding Stockdon runup and the Iribarren
  number. Using it for morphology dragged a 10% beach toward a 2% ramp.
- The dune is not relaxed toward Dean. Waves cut only as high as they reach, and the dune
  loses sand by slumping onto the beach (see "Cross-shore morphology").
- `defaultCoastalBedZ` references **datum 0, never `conditions.waterLevel`**. Water rises over
  a fixed bed. The *target* follows the water level; the seeded bed does not.

## Testing

```
node dev/headless_harness.js index.html      # the coastal model and the export: 99 checks
node dev/interface_harness.js index.html     # the shared interface under this model: 62 checks
```

Run both. `headless_harness.js` is this repo's; it loads the page the way a browser does
(inline script, then `model.js`, then `site.js`, one scope) and reaches the model's state by
name. `interface_harness.js` is the vendored shared harness; `dev/site_checks.js` adds this
repo's checks to it (the vendored copies match the lock, the XBeach backend is mounted).
The probe scripts (`conv_diag.js`, `edge_probe.js`, `interior_probe.js`, `flicker_probe.js`)
load the page the same way.

One check can fail on a slower machine and is not a regression: "frame time no worse than
the recorded 38 ms". That number was recorded on a faster machine; on a slower one the same
tree measures about 80 ms per frame under node, before and after the move (78.7 and 81.6).

`node --check` alone is **not** a gate — it passes on a silently empty field.

The harness parses the real markup for slider `value=""` defaults and `<select>` first options.
**Mocked DOM controls that return "0" have already produced a false pass** (Phase 1 reported
`max H 0.00 m` with every check green). Do not stub controls by hand.

Record every score with the commit it belongs to, in `dev/PRECISION.md`. A score without a
commit is a memory, not a baseline: 64.5 was accurate for `af3369a` and is 3.7 points wrong
for the tree immediately before `b76139c`, and for a while nothing recorded the difference.

## Pitfalls — each of these cost real time

- `bedPoints` is empty by default. `userBedZ` MUST fall through to `defaultCoastalBedZ`.
- Bed units are not metres. Multiply by `M_PER_BED_UNIT` before any physics.
- `GW`/`GH` snapshotted at load time are **zero** — `setup()` assigns them later. Use getters.
- A Dean target anchored to its own moving shoreline is degenerate and diverges. The
  waterline reference comes from the bed without the morphology layer.
- The implicit cross-shore solve is stable at any step, and a 5-day step hides transients a
  quarter-day step shows. Two checks only told a broken model from a working one in small steps.
- Run the model for as long as the XBeach reference ran. The harness once compared 2.5 model
  days with 10 and nothing failed; `refMeta()` now reads the duration from the reference.
- The default profile must be **continuous by construction**; a vertical step at the berm
  means the waterline cannot migrate and no storm can erode the upper beach.
- A conservative process **nets to zero**. Do not test it with a signed sum — use Σ|change|.
- A structure thinner than the grid step turns the transport gradient into a one-row spike.
  The transport field is smoothed over six rows; that is numerical, not physics.
- When a measured number looks wrong, **check the measurement before the physics**. Three
  separate "physics failures" in this project were test errors: a frozen-phase velocity, a
  signed sum over a conservative process, and an assumed 800 px canvas.
- CRLF→LF warnings on commit are benign (Windows).

## XBeach build (native Windows, no WSL, no Docker)

```
/c/msys64/usr/bin/bash.exe dev/build-xbeach-msys2.sh [destination]
```

Default destination `./xbeach-src`; binary at `<destination>/src/xbeach/.libs/xbeach.exe`.
Verified from a clean clone. Two traps:

- `scripts/generate.py` imports `mako` and produces all 27 `.inc` files. Without it the build
  fails on `chartoindex.inc` with a "No rule to make target" that looks unrelated.
- `mnemoniciso.F90` declares `bind(c)` types with `character(len=20)` components, which
  gfortran 16 rejects. Relax **`b_arraytype` only** to a plain `type` — it is used solely
  inside that file. `carraytype` **must** keep `bind(c)` or `introspection.F90` fails.

`make clean` after patching, or stale `.mod` files reproduce the old error and make the fix
look like it failed. MSYS2 has no `git` of its own — it is a declared dependency.

## Related

- Shared interface and river model: repo `bradcantrell/sediment-interface`.
- Tidal: repo `bradcantrell/tidal-sediment-interface` (Venice lagoon sibling).
- Design rationale and phase gates: `PLAN.md`.

## Drawing a bed transect

The long-profile strip spans **z = -150 to +170 bed units** (-7.5 m to +8.5 m), with still
water drawn on it at z = 0. The range and the label are this model's (`bed: { zMin, zMax,
datumLabel }` in `registerModel`); the chart and its mapping are the interface's
(`bedChartYOf(z)`, `bedChartZOf(y)`, `clampBedZ(z)`).

The strip used to map 0..160 and clamp input to `max(0, z)`, so **no drawn transect could go
below still water**. Every user-drawn profile was therefore dry land: no water column anywhere,
the wave field had nothing to propagate through, and particles settled along the left edge where
the bed met the waterline. Four checks now guard this — the strip reaches below datum, reaches
the dune top, round-trips, and a drawn beach profile is wet over its offshore half.
