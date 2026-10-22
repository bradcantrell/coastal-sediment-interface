# Coastal Sediment Interface — Project Conventions
# Auto-loaded by Hermes when working in this directory

Browser-based coastal wave and beach simulator. Coastal sibling of `bradcantrell/sediment-interface`
(fluvial) and `bradcantrell/tidal-sediment-interface`. Read `PLAN.md` before changing physics.

## What it is

Single file: `index.html` (~134 KB; HTML + CSS + p5.js canvas). No build step, no backend.
p5.js 1.11.3 from cdnjs. Everything else is inline.

**Scope boundary, settled:** two-dimensional plan form, one sediment class, no infragravity.
Do not add a third dimension, multiple sediment classes, or infragravity without asking.

**Visibility:** repo is **public** — `bradcantrell/coastal-sediment-interface`. GitHub Pages is
live at https://bradcantrell.github.io/coastal-sediment-interface/ and takes ~75 s to rebuild
after a push. Going private **deletes the Pages configuration**; making it public again does
not restore it — re-run `POST /repos/{owner}/{repo}/pages`.

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
- `morphologyStep()` — cross-shore relaxation toward a Dean equilibrium.
- `computeLongshore()` / `applyLongshore()` — CERC, conservative flux divergence.
- `applyNourishment()` — sand placed by `kind: 'nourish'` objects.

**Not modelled:** diffraction (a structure casts a hard shadow), infragravity, shoreline
retreat under sea-level rise, and shoreline feedback into the breaking angle.

## Bed model — three layers, and why

`bedZ = userBedZ + depoZ + morphZ + longZ`

- `userBedGrid` / `depoGrid` — carried over from the fluvial shell; dredge/fill and particles.
- `morphGrid` — cross-shore relaxation. **Target-seeking, NOT volume-conserving.**
- `longGrid` — longshore transport. **Conservative.** Kept in its own layer so the
  non-conservative relaxation cannot erase the accretion that proves a groyne works.
- `bedZ0 = userBedZ + depoZ` — the bed without morphology; used for the change overlay and as
  the fixed anchor for the Dean target.

The two morphology layers are summed into the bed but **not coupled**.

## XBeach agreement — what is and is not true

The exported case builds and runs. Against a recorded XBeach storm run on the same bed:

- **Spatial pattern: correlation 0.818.** Erosion and accretion land in the right places.
- **Rate: wrong by ~10×.** The interface moves roughly 15× less sediment in the same time.
- The correlation is **invariant to run time**, because a linear relaxation scales without
  changing shape. The shape is right; only the rate and the volume budget are wrong.

Do not claim numerical agreement. The comparison runs in the harness against
`dev/xbeach-reference.json`.

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
- `morphologyStep` **must not relax the dune** (`z > refWaterLevel + BERM_TOP_M`). Dean says
  nothing about a dune.
- The profile references **datum 0, never `conditions.waterLevel`**. If the bed follows the
  live water level, a surge lifts the seabed with the water and nothing can erode.

## Testing

```
node dev/headless_harness.js index.html      # 63 checks
```

`node --check` alone is **not** a gate — it passes on a silently empty field.

The harness parses the real markup for slider `value=""` defaults and `<select>` first options.
**Mocked DOM controls that return "0" have already produced a false pass** (Phase 1 reported
`max H 0.00 m` with every check green). Do not stub controls by hand.

## Pitfalls — each of these cost real time

- `bedPoints` is empty by default. `userBedZ` MUST fall through to `defaultCoastalBedZ`.
- Bed units are not metres. Multiply by `M_PER_BED_UNIT` before any physics.
- `GW`/`GH` snapshotted at load time are **zero** — `setup()` assigns them later. Use getters.
- A Dean target anchored to its own moving shoreline is degenerate and diverges. Anchor once.
- Re-anchoring on water level cancels the storm signal exactly. Anchor once.
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

Default destination `D:/workspace/xbeach-src`; binary at `<destination>/src/xbeach/.libs/xbeach.exe`.
Verified from a clean clone. Two traps:

- `scripts/generate.py` imports `mako` and produces all 27 `.inc` files. Without it the build
  fails on `chartoindex.inc` with a "No rule to make target" that looks unrelated.
- `mnemoniciso.F90` declares `bind(c)` types with `character(len=20)` components, which
  gfortran 16 rejects. Relax **`b_arraytype` only** to a plain `type` — it is used solely
  inside that file. `carraytype` **must** keep `bind(c)` or `introspection.F90` fails.

`make clean` after patching, or stale `.mod` files reproduce the old error and make the fix
look like it failed. MSYS2 has no `git` of its own — it is a declared dependency.

## Related

- Fluvial: `D:/workspace/sediment-interface` (`index.html`, 67 functions, 88 KB).
- Tidal: `D:/workspace/tidal-sediment-interface` (Venice lagoon sibling).
- XBeach source/build: `D:/workspace/xbeach-src`.
- Design rationale and phase gates: `PLAN.md`.
