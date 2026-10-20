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

**Phase 1 — wave transformation.** The interface shell carries over from the fluvial
Sediment Interface: all panels, particles, bed grids, obstacle choreography and timeline.
The Stam fluid solver is gone. In its place is a column-by-column wave transformation with
refraction, shoaling, breaking dissipation and runup, driven by a coastal-conditions panel.

Sediment transport and morphology are **not built yet** (Phases 2–3). Today the wave field
is correct and the sand does not yet respond to it.

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

**Not modelled:** diffraction (a structure casts a hard shadow), wave setup in the bed,
infragravity. Breaking dissipation is applied as an energy decay per cell rather than a
full roller model.

## Conditions panel

Wave height, period, direction and directional spread; water level; sea-level rise; D50;
foreshore slope. Presets: calm summer, winter storm, post-storm recovery, SLR 2100.

The readout reports breaking wave height and depth, Stockdon runup, the Iribarren number
and the breaker type (spilling / plunging / surging).

## Units

Metres and seconds throughout. Reach is 400 m alongshore × 300 m cross-shore; bed
elevations are stored in bed units at `M_PER_BED_UNIT = 0.05` m per unit.

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
field: 11040 wet cells, max depth 8.00 m, max H 1.51 m, mean H 1.054 m
runup R2 0.476 m, Iribarren 0.183
storm: break 3.48 m @ 4.47 m, runup 1.20 m, max H 3.68 m
HARNESS PASS
```

Note: extracting the script and running `node --check` alone is **not** sufficient — it
passes on a field that is silently empty. The behavioural checks are the real gate.

## License

MIT — see `LICENSE`.
