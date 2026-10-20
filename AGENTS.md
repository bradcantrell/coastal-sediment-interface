# Coastal Sediment Interface — Project Conventions
# Auto-loaded by Hermes when working in this directory

Browser-based coastal wave and beach simulator. Coastal sibling of `bradcantrell/sediment-interface`
(fluvial) and `bradcantrell/tidal-sediment-interface`. Read `PLAN.md` before changing physics.

## What it is

Single file: `index.html` (HTML + CSS + p5.js canvas). No build step, no backend.
p5.js 1.11.3 from cdnjs. Everything else is inline.

**Scope boundary, settled:** two-dimensional plan form, one sediment class, no infragravity.
Do not add a third dimension, multiple sediment classes, or infragravity without asking.

**Visibility:** the repo is PRIVATE for now. That means GitHub Pages is unavailable on a free
plan, so there is no hosted build — serve locally. Re-check with Brad before making it public.

## Units

**Metres and seconds.** A deliberate departure from the tidal interface, which is
dimensionless. Coastal design is metric-native — Hs in m, T in s, D50 in mm, transport in
m³/yr — and students need real numbers to reason with.

- Reach: 400 m alongshore (x) × 300 m cross-shore (y), offshore at y = 0.
- Bed elevations are stored in **bed units**; `M_PER_BED_UNIT = 0.05` m per unit.
  Offshore shelf is −160 units (−8.0 m), waterline is 0, dune crest ~+180 units (+9 m).
- `stillWaterZ` is the still-water level in bed units (0 = the drawn waterline).

## Physics (current state — Phase 0)

The fluvial Stam solver is **gone**. In its place:

- `wavenumberK(T, h)` — Newton solution of ω² = gk·tanh(kh). Converges in ≤12 iterations;
  returns the deep-water guess if it fails.
- `groupVelocity(T, h)` — Cg = nC, the quantity shoaling conserves.
- `waveFieldStep()` — per cell: depth from `bedZ`, shoaling H = H0·√(Cg0/Cg), then a
  breaking cap H ≤ γh with γ = 0.78. Writes `waveH`, `waveDepth`, and the orbital velocity
  into `u`/`v`.

**Not yet modelled:** refraction, surf-zone dissipation (Battjes–Janssen), runup, any
sediment transport law, morphology. The breaking cap is a cliff, not a decay, so `waveH`
reads flat inside the surf zone. That is Phase 1.

## Data model

Unchanged from the fluvial shell, which is the point — feature parity:

- `depoGrid` / `userBedGrid` — bed grids (Float32Array, `DEPO_CELL` = 4 px).
- `bedZ(x, y)` = `userBedZ` + `depoZ`. Bed edits and deposition write `depoGrid`.
- `bedPoints` — user-drawn stations. **When empty, the bed falls back to
  `defaultCoastalBedZ(x, y)`**, which is what gives the app its beach profile on load.
- `particles[]` — suspended sediment.
- `obstacles[]` — `{type, x, y, w, h, rotation, clips: [{start, dur}]}` or
  `{type:'poly', x, y, rotation, points:[...], clips:[...]}`.
- `waveComponents[]` — `[{Hs, Tp, dirDeg, weight}]`. **One component today**, but the array
  shape is the contract: directional spread must be a parameter, never a refactor.

## Key functions

- `waveFieldStep()` — the physics step. Called from `draw()` where `velocityStep()` used to be.
- `buildSolidMask()` — carries over verbatim from the fluvial build; rasterizes obstacles
  into `solid`.
- `getVelocityAt(px, py)` — unchanged contract: returns `{vx, vy}` in px/frame.
- `timelineLoopTime()`, `isObstacleActive(ob)` — unchanged; `clips` drive object existence.
- `defaultCoastalBedZ(x, y)` — the archetype profile in bed units.
- `computeUserBedZ` — falls through to `defaultCoastalBedZ` when no stations are drawn.
- `paintBed(raise)` — dredge/fill; conceptually nourishment/scrape in docs only, not yet renamed.

## Testing — no browser screenshot harness on this box

Two gates, both must pass:

1. **Syntax** — extract the `<script>` body with a Python regex to a temp `.js`, `node --check`.
2. **Behaviour** — `node dev/headless_harness.js <extracted.js>`. Mocks p5 and the DOM,
   runs `setup()` plus 30 `draw()` frames, then asserts the wave field has wet cells.

Current expected output:
```
setup() OK
30 draw() frames OK
wave field: 11040 wet cells, 3864 dry, max depth 8.00 m, max H 1.51 m
HARNESS PASS
```

**The harness has already caught one silent failure**: `userBedZ()` returned 0 whenever
`bedPoints` was empty, so the coastal profile was never reached and the field came out
empty. If the wet-cell count drops to zero, suspect the bed accessors first.

## Pitfalls

- `bedPoints` is empty by default. `userBedZ` MUST fall through to `defaultCoastalBedZ`,
  or both the render and the physics silently go flat.
- Bed units are not metres. Multiply by `M_PER_BED_UNIT` before any physics.
- `draw()` calls `waveFieldStep()`, which calls `buildSolidMask()` — obstacles must be
  rasterized before the field is computed, or structures do not block waves.
- Mouse handlers MUST ignore non-canvas clicks (`e.target.tagName !== 'CANVAS'`), or the
  structure popup deselects on click.
- `paintBed` needs the click-vs-drag threshold, or a click-select also dredges.
- Sliders inherited from the fluvial shell (`inflow`, etc.) still drive fluvial-named
  variables. **Do not relabel them to coastal terms until Phase 1 actually rewires them** —
  a "wave energy" label on a slider that does not control wave energy is worse than a
  stale name.
- CRLF→LF warnings on commit are benign (Windows).

## Related

- Fluvial: `D:/workspace/sediment-interface` (`index.html`, 67 functions, 88 KB).
- Tidal: `D:/workspace/tidal-sediment-interface` (30 KB, dimensionless).
- Design rationale and phase gates: `PLAN.md`.
