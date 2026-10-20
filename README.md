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

**Phase 0 — scaffold and parity.** The interface shell is in place, derived from the
fluvial Sediment Interface: all panels, particles, bed grids, obstacle choreography and
timeline carry over. The Stam fluid solver has been removed and replaced with a coastal
wave field (linear shoaling with a breaking cap). The coastal-conditions panel, refraction,
surf-zone dissipation, transport laws and the XBeach export are **not built yet**.

See `PLAN.md` for the full design and the phase gates.

## What works today

- Loads and runs; every inherited control responds
- Default archetype beach profile: offshore shelf, shoreface, beach face, berm, dune
- Wave field: linear-dispersion group velocity, shoaling by energy-flux conservation,
  breaking at `H ≤ γh` with `γ = 0.78`
- Obstacles and the looping timeline, unchanged from the fluvial interface
- Headless test harness (`dev/headless_harness.js`)

## Units

Metres and seconds throughout. Reach is 400 m alongshore × 300 m cross-shore; bed
elevations are stored in bed units at `M_PER_BED_UNIT = 0.05` m per unit.

## Running

Static file, no build step:

```
python -m http.server 8100
```

then open <http://localhost:8100/>.

## Testing

```
# syntax
python -c "import re;s=open('index.html',encoding='utf-8').read();open('_check.js','w',encoding='utf-8').write(re.search(r'<script>\s*\n(.*?)\n</script>',s,re.S).group(1))"
node --check _check.js

# behaviour (mocks p5 + DOM, runs setup() and 30 frames, asserts a live wave field)
node dev/headless_harness.js _check.js
```

A passing run prints the wet-cell count, maximum depth and maximum wave height, e.g.
`11040 wet cells, 3864 dry, max depth 8.00 m, max H 1.51 m`.

## License

MIT — see `LICENSE`.
