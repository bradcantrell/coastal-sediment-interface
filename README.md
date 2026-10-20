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

**Phase 2 — cross-shore response.** The interface shell carries over from the fluvial
Sediment Interface: all panels, particles, bed grids, obstacle choreography and timeline.
The Stam fluid solver is replaced by a wave transformation (refraction, shoaling, breaking
dissipation, runup), and the bed now responds across the profile — relaxing toward a
Dean equilibrium, eroding under a storm and building a bar at the breakpoint.

Alongshore transport and structures are **not built yet** (Phase 3). Sand moves across the
shore, not along it: a groyne will not yet do anything.

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

**Not modelled:** diffraction (a structure casts a hard shadow), alongshore transport,
infragravity, shoreline retreat under sea-level rise (the equilibrium profile is anchored
rather than translated), and volume conservation — the relaxation is target-seeking, not
flux-conserving.

## Conditions panel

Wave height, period, direction and directional spread; water level; sea-level rise; D50;
foreshore slope. Presets: calm summer, winter storm, post-storm recovery, SLR 2100.

The readout reports breaking wave height and depth, Stockdon runup, the Iribarren number
and breaker type, plus erosion and accretion rates, storm intensity and bar distance.

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
field: 10710 wet cells, max depth 8.00 m, max H 1.51 m, mean H 1.151 m
runup R2 0.476 m, Iribarren 0.183
storm: break 3.68 m @ 4.81 m, runup 1.20 m, max H 3.68 m
Gate A  settled 0.078 m | perturbed 0.854 m -> relaxed 0.038 m
Gate B  storm bar 181.7 m offshore, intensity 0.62
        upper profile 0.16 -> -0.33 m (-0.49)
        bar crest     -3.99 -> -3.22 m (0.77)
orientation: waterline at 74% of width
particles: mean x 423 px, max x 840 px
period-averaged onshore component 0.488 cells/frame
HARNESS PASS
```

Note: extracting the script and running `node --check` alone is **not** sufficient — it
passes on a field that is silently empty. The behavioural checks are the real gate.

## License

MIT — see `LICENSE`.
