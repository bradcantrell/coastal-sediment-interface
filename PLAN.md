# Coastal Sediment Interface — Plan for Review

**Status:** proposal, not started
**Date:** 2026-10-20
**Sibling projects:** `sediment-interface` (fluvial, 88 KB, 67 functions), `tidal-sediment-interface` (Venice lagoon)

---

## 1. What this is

A browser-based **coastal wave and beach simulator** that carries the full feature set of the fluvial Sediment Interface — same interaction model, same panels, same export affordance — with the physics and the condition-setting replaced by coastal ones.

The contribution, stated so it can be argued against: **the other two interfaces model sediment moving under a current. This one models sediment moving under a wave field, where the organizing variable is not discharge but the angle and energy of approach, and where the shoreline itself is the thing that moves.** That is a different design problem, not a re-skin.

Lineage matters here. Fluvial answers "where does sediment accumulate in a channel." Tidal answers "which channels silt and which stay open." Coastal answers "where does the beach go" — which is the question a landscape architect actually gets asked at the coast, and the one current tools answer only with proprietary black boxes or hand-waving.

---

## 2. Feature parity — what carries over

Every capability in the fluvial interface, mapped to its coastal equivalent. This is the contract; anything not on this list is scope creep.

| Fluvial feature | Coastal equivalent | Carries over as |
|---|---|---|
| Stam fluid solver (`velocityStep`, `advect`, `project`) | Wave field solve: shoaling, refraction, breaking | **Replaced** — analytic, not PDE |
| Suspended particle system (settle/erode) | Same particles, driven by orbital velocity and surf-zone energy | Reused |
| Aggrading heightfield bed (`depoGrid`) | Same three-grid bed model | Reused verbatim |
| Bed profile section + bed thumbnail | Same, with equilibrium-profile reference line | Extended |
| Dredge/fill painting (`paintBed`) | Nourishment placement / beach scraping | Reused, relabelled |
| Obstacle choreography (`clips: [{start,dur}]`) | Groynes, breakwaters, seawalls, dunes, vegetation | Reused **verbatim** |
| Polygon draw + `pointInPoly` + vertex editing | Same | Reused verbatim |
| Materials / `EDGE_TYPES` (resist, trap) | Rock, timber, geotextile, vegetation, concrete, sand | Same mechanism, new list |
| Sliders: settle/erosion prob+thresh, particle size/count, depo size | Same sliders | Reused |
| Flow field render, spot elevations, grid, fast-color | Wave field + surf zone render | Reused |
| Timeline: duration 30–600 s, loop/ping-pong | Same control, relabelled in model-years | Reused |
| Pause, reset physics, reset render | Same | Reused |
| OpenFOAM case export (`case_generator.js`) | XBeach / SWASH case export | **Replaced** |

**Net:** roughly 70% of the code is unchanged. The new work is the wave field, the two transport laws, and the condition panel.

---

## 3. Physics — the core decision

Three options were considered.

**A. Full numerical wave model (Boussinesq, SWASH-class).** Correct, and wrong for this tool. The tidal project already learned this lesson on shallow water: a full PDE solve with wet/dry boundaries is unstable at interactive frame rates. Rejected for the same reason.

**B. Analytic wave transformation + algebraic transport.** This is the proposal.
**C. Pure cellular/rule-based shoreline model (e.g. one-line theory only).** Too coarse — it cannot show a beach profile, a bar, or a dune.

### 3.1 Wave field (per cell, each frame)

Given offshore \(H_0, T, \theta_0\):

- **Shoaling** — linear theory, \(H \propto (C_{g0}/C_g)^{1/2}\), monotonic energy growth with decreasing depth.
- **Refraction** — Snell's law on the local depth contour; wave angle rotates toward shore-normal as depth falls.
- **Breaking** — \(H/h \le \gamma\), \(\gamma \approx 0.78\), with Battjes–Janssen dissipation across the surf zone so height decays rather than clipping.
- **Runup** — Stockdon et al. (2006) for swash excursion; sets the waterline and the dune-collision test.

All four are closed-form and evaluated per cell, so the whole field costs one pass over the grid. That is what buys real-time.

**Spectral structure — decided.** The field is declared as an **array of components** `[{H, T, dir, weight}]` from the first commit, and v1 ships with **N = 1**. Monochromatic is therefore a *parameter*, not an architecture. Directional spread is N ≈ 7 wrapped-Gaussian bins; frequency spread (JONSWAP redistribution) is a later refinement, because direction drives the transport nonlinearity far more than period does. Data structures and the transport integrator must be written for N from the start — retrofitting a spectrum into a single-angle transport chain is a rewrite, and that is the trap worth avoiding.

### 3.2 Transport

- **Longshore** — CERC: \(Q_{ls} \propto K\, H_b^{2.5} \sin(2\alpha_b)\). Zero at shore-normal, maximum near 45°. This single relation is what makes groynes legible to a student.
- **Cross-shore** — disequilibrium relaxation toward a Dean equilibrium profile \(h = A x^{2/3}\), with \(A\) set by \(D_{50}\). Steeper than equilibrium → offshore flux; flatter → onshore. This is what produces storm erosion and calm-weather recovery.
- **Grain size** \(D_{50}\) drives settling velocity and mobility, reusing the tidal interface's material logic.

### 3.3 Bed evolution

Exner: \(\partial z/\partial t = -\nabla \cdot \mathbf{q}\), with a **morphological acceleration factor** so a season or a decade passes in a session. Accelerated morphology is the one place spurious oscillation creeps in; the mitigation is a floor on the bed-update step and a smoothing pass, both switchable for inspection.

---

## 4. Coastal starting conditions

This is the panel the request centres on. Proposed controls, all with sensible ranges:

**Wave climate**
- Significant height \(H_s\) — 0.2–4.0 m
- Peak period \(T_p\) — 4–16 s
- Mean direction — ±45° from shore-normal
- Directional spread — monochromatic → 30° (governs whether longshore drift is coherent)

**Tide**
- Range — 0–4 m
- Regime — none / semidiurnal / diurnal / mixed
- (Reuses the tidal interface's M2/M4 machinery directly — the harmonic code already exists)

**Sediment**
- \(D_{50}\) — 0.1–2.0 mm
- Sorting
- Active layer depth

**Beach**
- Initial slope *or* Dean \(A\)
- Berm height
- Dune height, width, and vegetated fraction

**Sea level**
- Rise rate — 0–15 mm/yr, applied against the morphological clock

**Presets** (the teaching payload)
- Calm summer — low energy, onshore recovery
- Winter storm — high \(H_s\), long \(T_p\), surge, dune collision
- Post-storm recovery — the storm's aftermath as an initial condition
- SLR 2050 / 2100 — the same beach under a raised datum
- Mixed-energy coast — strong tide plus modest waves

---

## 5. Objects on a timeline

The fluvial timeline is already exactly the right abstraction: each object carries `clips: [{start, dur}]`, and `isObstacleActive()` resolves it against the loop. **Keep it unchanged.** What changes is the object vocabulary and what each does to the field.

**Object types**
- **Groyne** — shore-perpendicular, length, crest elevation, permeability
- **Breakwater** — detached, shore-parallel, crest elevation, gap width
- **Seawall / revetment** — shore-parallel, crest, toe elevation
- **Dune** — mound profile with vegetation state, erodible
- **Nourishment** — a sand volume placed at a time, then dispersed. A *timed event*, which is exactly what a `clip` is
- **Vegetation patch** — trapping and roughness
- **Sand fence** — accretional, low, temporary
- **Borrow pit** — negative placement

**Interaction with physics.** This is where the pedagogical value lives, and it must not be faked:
- A groyne must cast a **transport shadow** — accretion updrift, erosion downdrift
- A breakwater must create a **sheltered zone** where wave energy is reduced (approximated as a geometric shadow with edge diffraction softening; full diffraction is out of scope)
- A dune must be **erodible** — overwash when runup exceeds crest
- Nourishment must **conserve volume** — placed sand goes somewhere, never vanishes

**The interface point:** an object born at model-year 3 while another is removed at year 6 is an *adaptation sequence*. That is the design move this tool should make easy to try and hard to fake.

---

## 6. Two clocks

The fluvial interface has one loop. Coastal needs a scale distinction, and I propose resolving it without adding UI complexity:

- **Hydrodynamic time** — wave groups and tide, seconds to hours
- **Morphological time** — days to years, via the acceleration factor

One control, as now: timeline duration 30–600 s, labelled in **model years** (1–50) rather than seconds. Objects' `clips` sit on that clock. A secondary readout shows the hydrodynamic sub-time, so a student can see the storm that produced the erosion rather than only its result.

---

## 7. Export

The fluvial interface exports an OpenFOAM case — a real deliverable, not a toy. Coastal should hold that standard.

- **Primary: XBeach** — the standard open model for beach and dune morphodynamics: storm impact, overwash, profile change. Plain-text `params.txt` plus a bed grid and a wave boundary. Crucially, **its native output is bed-level change**, the same quantity this interface produces, so the comparison is honest rather than decorative. Chosen because a student can actually run it.
- **Secondary: SWASH** — non-hydrostatic, resolves individual waves, best for detailed runup and overwash at the dune face. Computationally heavy; a storm run is hours, not minutes. Add in Phase 5b only if the dune gates need that detail.
- **Optional: olaFlow (OpenFOAM)** — continuity with the fluvial exporter, highest fidelity, and the same case machinery could be reused. Not primary: two-phase CFD at beach scale is a research run rather than a hand-off, and it does not do morphology natively.

### An honest caveat on validation

XBeach and this interface are in the same modelling family — both wave-averaged. Agreement between them therefore does **not** validate the physics; it demonstrates that the hand-off is sane. Validation has to come from the analytic gates in §9 and, if an independent check is ever wanted, from SWASH or olaFlow, which resolve individual waves.

The export's purpose is **hand-off, not proof**: "this is your design, now run it properly."

---

## 8. Architecture

Mirror the siblings rather than invent:

- **Single file**, `index.html`, no build step, p5.js from CDN. Same deployment (GitHub Pages).
- **Dev/hosted split** as with tidal: edit dev, copy to hosted repo, push both.
- **Headless test harness** — reuse the tidal pattern: extract the script, prepend p5 mocks, run under `node`. No browser screenshot harness on this box.
- **Grid** — plan-form, UTM-free local metres, ~200 m alongshore × 250 m cross-shore at 2 m cells ≈ 25,000 cells.

**Repo:** `bradcantrell/coastal-sediment-interface`, public, Pages on `main`.

---

## 9. Phases and gates

Each phase ends with a behaviour that can be demonstrated or refuted, not a vibe.

**Phase 0 — Scaffold and parity.** Fork the fluvial shell, strip the Stam solver, port every panel and interaction. *Gate:* every fluvial control exists and moves something.

**Phase 1 — Conditions panel + wave field.** Shoaling, refraction, breaking, surf-zone render. *Gate:* waves visibly shoal and break at a depth that scales with \(H_0\); changing period changes the breaker line.

**Phase 2 — Cross-shore response.** Exner plus equilibrium relaxation. *Gate:* a perturbed profile relaxes toward Dean; a storm pulse erodes the upper profile and builds a bar.

**Phase 3 — Longshore transport and structures.** CERC, plus groyne and breakwater effects. *Gate:* transport is zero at shore-normal and peaks near 45°; a groyne accretes updrift and erodes downdrift.

**Phase 4 — Timeline objects.** Reuse `clips` verbatim; add the object vocabulary. *Gate:* an adaptation sequence plays and the bed responds at the right model-years.

**Phase 5 — Export.** XBeach (and SWASH if wanted). *Gate:* a generated case runs headless and returns a bed change in the same direction as the browser.

**Phase 6 — Presets, teaching notes, documentation.** *Gate:* a student can run the storm preset and explain the result without a manual.

---

## 10. Risks

- **Wet/dry instability** at the moving waterline — the tidal project's known failure mode. Mitigated by an analytic waterline rather than a solved one, and by clamping.
- **Accelerated morphology oscillation** — bed updates that overshoot and ring. Mitigated by a step floor plus optional smoothing.
- **Structure–wave interaction** is the expensive part if done properly. Shadow-zone approximation is honest if labelled as such in the interface.
- **Scope.** Coastal morphodynamics is a career. The boundary is: two-dimensional plan form, one sediment class, no infragravity, no overwash hydrodynamics beyond a runup test.

---

## 11. Decisions (settled 2026-10-20)

1. **Units** — metres and seconds. Physical quantities throughout: \(H_s\) m, \(T\) s, depth m, \(D_{50}\) mm, transport m³/yr. No dimensionless abstraction.
2. **Domain** — abstract archetype reach. No real site baked in; presets carry the geometry.
3. **Wave input** — architecture for N components, ship N = 1 monochromatic with optional directional spread as a parameter (§3.1). Full frequency spectrum deferred.
4. **Export** — XBeach primary; SWASH secondary in Phase 5b if the dune gates need runup detail; olaFlow optional.
5. **Reference interface** — the **fluvial** `sediment-interface`. Feature parity is measured against it.

**Scope boundary (settled):** two-dimensional plan form, one sediment class, no infragravity. Everything beyond that is what the export is for.

---

## 12. Next step

Phase 0 — scaffold the new repo from the fluvial shell, strip the Stam solver, and prove every panel and interaction still responds. No new physics until parity is demonstrated.
