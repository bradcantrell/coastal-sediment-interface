// model.js: the coastal model for the Sediment Interface.
//
// index.html is the shared interface (canvas, sediment particles, drawn bed, obstacles and
// their timeline, 3D view, sidebar), vendored unchanged from the sediment-interface repo.
// It knows nothing about how water moves. This file is the model that tells it: a wave
// field transformed across the drawn beach (refraction, shoaling, breaking), the bed change
// it drives (cross-shore profile, longshore transport, nourishment), and model time.
//
// It runs in index.html's scope, after it, and registers itself at the bottom with
// registerModel(). See MODEL EXTENSION POINT in index.html for what the interface asks of
// a model. site.js (the XBeach export) loads after this and reads this file's state.
//
// Cross-shore runs along x: offshore at x = 0, the dune at x = width. Elevations are in bed
// units, M_PER_BED_UNIT metres each, zero at still water.

// ─────────────────────────────────────────────
// SEDIMENT RULES (read by the interface's particle code through model.rules)
// ─────────────────────────────────────────────
const MIN_PARTICLE_AGE = 0.8;

const MIN_TRAVEL_X = 100;

const MAX_PARTICLE_AGE = 30;

let settleThresh = 0.20;

let erosionThresh = 1.0;

let settleProb = 0.012;

let erosionProb = 0.02;

let modelYears = 0;           // elapsed model time: the clock the timeline and morphology share


/**
 * Default archetype beach profile, in bed units.
 *
 * Offshore shelf, rising shoreface, beach face crossing the waterline, berm, then dune.
 * Sections are fractions of the canvas height (y=0 offshore, y=height landward).
 * Replaced by the coastal-conditions panel once Phase 1 lands.
 */
function defaultCoastalBedZ(x, y) {
  // Cross-shore runs along x: offshore at x=0 (left), dune at x=width (right).
  // Waterline lands at 0.74 of the width, in the right third.
  //
  // Built FROM the equilibrium rather than hand-placed. Offshore is the Dean curve for the
  // configured sediment; landward is the beach gradient the equilibrium itself uses; beyond
  // the berm crest the dune rises at its own slope. Under calm the disequilibrium is zero,
  // so the profile does not lurch toward a target it was never seeded at.
  const xShore  = 0.74 * Math.max(width, 1);
  const xMPerPx = REACH_CROSSSHORE / Math.max(width, 1);
  const Y = (xShore - x) * xMPerPx;                 // metres offshore of the waterline
  // Datum, NOT the live water level. Water rises over a fixed bed; if the profile followed
  // conditions.waterLevel a surge would lift the seabed with it and erode nothing.
  const wl = 0;
  const A  = deanA(conditions.d50);

  if (Y >= 0) {                                     // shoreface: Dean h = A y^(2/3)
    return (wl - A * Math.pow(Y, 2 / 3)) / M_PER_BED_UNIT;
  }

  const run  = -Y;
  const zBch = wl + BEACH_SLOPE * run;
  if (zBch <= wl + BERM_TOP_M) {                    // beach face
    return zBch / M_PER_BED_UNIT;
  }
  const runAtBerm = BERM_TOP_M / BEACH_SLOPE;       // dune: continues from the berm crest
  return (wl + BERM_TOP_M + (run - runAtBerm) * DUNE_SLOPE) / M_PER_BED_UNIT;
}


// The bed without the morphology layer. The equilibrium profile is referenced to the
// waterline of THIS surface, not the evolving one: a Dean profile anchored at its own
// moving shoreline is degenerate, so re-anchoring each step makes the target chase the
// bed and diverge.
function bedZ0(x, y) { return userBedZ(x, y) + depoZ(x, y); }


// Signed morphology change, same grid as depoGrid. Separated from depoGrid because
// deposition is clamped to [0, DEPO_MAX] and cannot represent erosion.
function morphZ(x, y) {
  if (!morphGrid) return 0;
  // Past the outermost cell centres the layer holds its edge value. It used to read zero
  // there, so the last row and column never saw their own change: the cross-shore step kept
  // relaxing a bed that, to it, never moved, until that row hit the clamp.
  let fx = Math.min(Math.max(x / DEPO_CELL - 0.5, 0), GW - 1);
  let fy = Math.min(Math.max(y / DEPO_CELL - 0.5, 0), GH - 1);
  let i = Math.min(Math.floor(fx), GW - 2), j = Math.min(Math.floor(fy), GH - 2);
  let tx = fx - i, ty = fy - j;
  let a = morphGrid[j * GW + i],     b = morphGrid[j * GW + i + 1];
  let c = morphGrid[(j + 1) * GW + i], d = morphGrid[(j + 1) * GW + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}


// Alongshore transport layer. Separate from morphGrid so the cross-shore relaxation
// cannot erode accretion that longshore transport deposited.
function longZ(x, y) {
  if (!longGrid) return 0;
  // Past the outermost cell centres the layer holds its edge value. It used to read zero
  // there, so the last row and column never saw their own change: the cross-shore step kept
  // relaxing a bed that, to it, never moved, until that row hit the clamp.
  let fx = Math.min(Math.max(x / DEPO_CELL - 0.5, 0), GW - 1);
  let fy = Math.min(Math.max(y / DEPO_CELL - 0.5, 0), GH - 1);
  let i = Math.min(Math.floor(fx), GW - 2), j = Math.min(Math.floor(fy), GH - 2);
  let tx = fx - i, ty = fy - j;
  let a = longGrid[j * GW + i],       b = longGrid[j * GW + i + 1];
  let c = longGrid[(j + 1) * GW + i], d = longGrid[(j + 1) * GW + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}


// ─────────────────────────────────────────────
// COASTAL WAVE FIELD
// ─────────────────────────────────────────────
// Column-by-column marching transformation, shoreward:
//   refraction by Snell (alongshore wavenumber conserved)
//   shoaling by energy-flux conservation on the oblique flux Cg*cos(theta)
//   breaking dissipation after Battjes & Janssen (1978)
//   runup after Stockdon et al. (2006)
//
// Diffraction is NOT modelled: a structure casts a hard shadow, not a spreading one.
// Infragravity is excluded by design (PLAN.md, scope boundary).

const GRAV = 9.81;

const RHO  = 1025;              // kg/m3, seawater

const VEL_GAIN = 120;           // visual gain: orbital m/s -> pixels/frame a viewer can read

const REACH_ALONGSHORE = 400;   // m, x

const REACH_CROSSSHORE = 600;   // m, x (offshore at x=0, dune landward)

const M_PER_BED_UNIT   = 0.05;  // metres of elevation per bed unit


// Morphology profile constants. BEACH_SLOPE is the subaerial beach gradient the equilibrium
// is built from — distinct from conditions.slope, which is the foreshore gradient feeding
// the runup formula. DUNE_SLOPE governs the dune beyond the berm crest.
const BEACH_SLOPE    = 0.10;

const DUNE_SLOPE     = 0.05;

const BERM_TOP_M     = 1.5;   // metres above still water: top of the active beach


// Cross-shore transport coefficient at the reference wave height, m2/s, scaled linearly with
// Hs in morphologyStep. It was 0.35 with Hs squared, which finished a storm's whole response
// inside the first model day; six XBeach runs on this bed are still cutting the beach at day
// ten, and their deposit spreads seaward about as fast at Hs 2 m as at 3.4 m. This value is
// set from the storm run's deposit, day by day (dev/PRECISION.md, 2026-11-14).
const TRANSPORT_D0   = 0.0023;

const TRANSPORT_HREF = 1.5;

// Depth of closure in metres below the live water level: 2 m + 0.8 Hs. Seaward of it the bed
// does not move; mobility falls linearly to zero over the outer half of that depth. XBeach's
// deposit ends at 2.8 m depth in the calm run and 4 to 5.4 m in the storm runs. Without this
// the eroded sand spread as a thin film over the whole seabed out to the offshore edge.
const CLOSURE_BASE_M = 2.0;

const CLOSURE_PER_HS = 0.8;

let conditions = {
  Hs: 1.20,          // m, offshore significant wave height
  Tp: 8.0,           // s, peak period
  dirDeg: 0,         // deg from shore-normal, +ve to the right
  spreadDeg: 0,      // deg, 0 = monochromatic
  waterLevel: 0.0,   // m above datum (tide + SLR)
  d50: 0.30,         // mm, not yet used by the wave field (Phase 2)
  slope: 0.020,      // foreshore gradient, used by runup
};

let breakerGamma = 0.78;


// Hysteresis band on the breaking mask, as fractions of breakerGamma*h.
// A single threshold re-tested every frame lets cells that sit near the limit flicker on
// and off. Kazolea (2024, HDR Université de Bordeaux) names this "intermittency of the
// detection" as one of the two causes of instability at a breaking / non-breaking
// interface, and it is the one cause we can remove without changing the physics: a cell
// starts breaking at BREAK_ON and keeps breaking down to BREAK_OFF, so the mask changes
// only when the wave height moves a real distance past the limit rather than crossing it.
const BREAK_ON  = 0.97;

const BREAK_OFF = 0.89;

let waveComponents = [];

let waveHComp      = [];

let waveH          = new Float32Array(SIZE);

let waveDepth      = new Float32Array(SIZE);

let waveBreaking   = new Uint8Array(SIZE);

let waveAngle      = new Float32Array(SIZE);   // breaking angle from shore-normal, rad

let runupR2 = 0, runupSetup = 0, runupSwash = 0, iribarren = 0;

let breakHb = 0, breakDepth = 0, breakCount = 0;


/** Newton solution of the linear dispersion relation w^2 = g k tanh(k h). */
function wavenumberK(T, h, kHint) {
  const w2 = Math.pow(2 * Math.PI / T, 2);
  // Seed from the neighbouring cell when one is available: adjacent depths are close, so
  // this converges in two or three iterations instead of marching from the deep-water guess.
  let k = (kHint && isFinite(kHint) && kHint > 0) ? kHint : w2 / GRAV;
  for (let it = 0; it < 12; it++) {
    const th = Math.tanh(k * h);
    const f  = GRAV * k * th - w2;
    const df = GRAV * (th + k * h * (1 - th * th));
    if (Math.abs(df) < 1e-12) break;
    const kn = k - f / df;
    if (!isFinite(kn) || kn <= 0) break;
    if (Math.abs(kn - k) < 1e-9) { k = kn; break; }
    k = kn;
  }
  return k;
}


/** Group velocity Cg = n*C from linear theory. */
function groupVelocity(T, h, kKnown) {
  const hh = Math.max(h, 0.05);
  // The caller has usually just solved for k at this same depth. Re-solving it here doubled
  // the dispersion cost of every cell in the march.
  const k  = (kKnown && isFinite(kKnown) && kKnown > 0) ? kKnown : wavenumberK(T, hh);
  const kh = k * hh;
  const c  = (2 * Math.PI / T) / k;
  const n  = 0.5 * (1 + (2 * kh) / Math.max(Math.sinh(2 * kh), 1e-9));
  return n * c;
}


/** Bed elevation in metres (bed units are not metres). */
function bedMeters(x, y) { return bedZ(x, y) * M_PER_BED_UNIT; }


/** Still-water depth in metres at grid cell (i, j). Negative means dry land. */
function depthAt(i, j) { return conditions.waterLevel - bedMeters(i * cellW, j * cellH); }


/**
 * Expand the conditions into wave components.
 * Monochromatic when spreadDeg is ~0; otherwise 7 wrapped-Gaussian directional bins.
 * Weights sum to 1 so that sum(w*H^2) recovers the total offshore energy.
 */
function buildComponents() {
  if (conditions.spreadDeg <= 0.5) {
    return [{ Hs: conditions.Hs, Tp: conditions.Tp, dirDeg: conditions.dirDeg, weight: 1 }];
  }
  const n = 7;
  const sigma = conditions.spreadDeg * Math.PI / 180;
  const out = [];
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) / ((n - 1) / 2);            // -1 .. 1
    const offset = t * 1.5 * sigma;                          // +/- 1.5 sigma
    const w = Math.exp(-0.5 * Math.pow(t * 1.5, 2));         // Gaussian in bin space
    out.push({
      Hs: conditions.Hs, Tp: conditions.Tp,
      dirDeg: conditions.dirDeg + offset * 180 / Math.PI,
      weight: w,
    });
    wsum += w;
  }
  for (const c of out) c.weight /= wsum;
  return out;
}


/**
 * March one component shoreward down every column.
 * State carried from cell to cell: H, theta, k, Cg.
 */
function transformComponent(ci, comp) {
  const T = comp.Tp;
  const out = waveHComp[ci];
  out.fill(0);

  // Cross-shore step length in metres (marching is +x, from offshore to dune).
  const dxm = cellW * (REACH_CROSSSHORE / Math.max(width, 1));
  const sin0 = Math.max(-0.999, Math.min(0.999,
                 Math.sin(comp.dirDeg * Math.PI / 180)));

  for (let j = 1; j <= NY; j++) {          // one march per alongshore row
    let hPrev  = Math.max(depthAt(1, j), 0.05);
    let kPrev  = wavenumberK(T, hPrev);
    let CgPrev = groupVelocity(T, hPrev);
    let thPrev = Math.asin(sin0);
    let Hprev  = comp.Hs;

    for (let i = 1; i <= NX; i++) {        // shoreward march
      const idx = IX(i, j);
      const h = depthAt(i, j);

      if (h <= 0.05 || solid[idx]) { out[idx] = 0; continue; }

      const k  = wavenumberK(T, h, kPrev);
      const Cg = groupVelocity(T, h, k);

      // refraction: alongshore (y) wavenumber k*sin(theta) conserved
      let sinT = Math.sin(thPrev) * (kPrev / k);
      sinT = Math.max(-0.999, Math.min(0.999, sinT));
      const th = Math.asin(sinT);

      const fluxPrev = Math.max(CgPrev * Math.cos(thPrev), 1e-6);
      const flux     = Math.max(Cg * Math.cos(th), 1e-6);
      let H = Hprev * Math.sqrt(fluxPrev / flux);

      const Hmax = breakerGamma * h;
      const Hrms = H / Math.SQRT2;
      if (Hrms > 1e-6) {
        const Qb = Math.exp(-Math.pow(Hmax / Hrms, 2));
        const D  = 0.25 * RHO * GRAV * (1 / T) * Qb * Hmax * Hmax;
        if (D > 0) {
          const E  = 0.125 * RHO * GRAV * H * H;
          const dE = D * dxm / flux;
          H = Math.sqrt(8 * Math.max(E - dE, 0) / (RHO * GRAV));
        }
      }
      if (H > Hmax) H = Hmax;

      out[idx] = H;
      if (ci === 0) waveAngle[idx] = th;      // dominant component drives longshore transport
      Hprev = H; thPrev = th; kPrev = k; CgPrev = Cg;
    }
  }
}


/** Energy-combine the component fields into waveH. */
function combineComponents() {
  const n = waveComponents.length;
  const acc = new Float32Array(SIZE);
  let wsum = 0;
  for (let c = 0; c < n; c++) {
    const arr = waveHComp[c], w = waveComponents[c].weight;
    for (let idx = 0; idx < SIZE; idx++) acc[idx] += w * arr[idx] * arr[idx];
    wsum += w;
  }
  const inv = wsum > 0 ? 1 / wsum : 1;
  for (let idx = 0; idx < SIZE; idx++) waveH[idx] = Math.sqrt(acc[idx] * inv);
}


/** Orbital velocity, depth field and the breaking mask. */
function applyField() {
  const T = conditions.Tp;
  const ang = conditions.dirDeg * Math.PI / 180;
  const osc = Math.sin(simTime * (2 * Math.PI / T));
  const dtF = 1 / 60;                                   // assumed frame time
  const cWm = Math.max(cellW * (REACH_CROSSSHORE / Math.max(width, 1)), 1e-3);
  const cHm = Math.max(cellH * (REACH_ALONGSHORE / Math.max(height, 1)), 1e-3);
  breakCount = 0;

  for (let j = 1; j <= NY; j++) {
    for (let i = 1; i <= NX; i++) {
      const idx = IX(i, j);
      const h = depthAt(i, j);
      waveDepth[idx] = h;

      if (h <= 0.05 || solid[idx] || waveH[idx] <= 1e-4) {
        u[idx] = 0; v[idx] = 0; waveBreaking[idx] = 0; continue;
      }

      const k  = wavenumberK(T, h);
      const sh = Math.max(Math.sinh(k * h), 1e-6);
      const amp = (waveH[idx] / 2) * ((2 * Math.PI / T) / sh);   // m/s near the bed

      // getVelocityAt() expects CELLS PER FRAME: it multiplies by cellW/cellH to get px.
      // Shore-normal is +x, so the alongshore component is sin(ang).
      // The +0.25 offset gives the oscillation a net onshore bias — a stand-in for Stokes
      // drift. Without it the particles slosh in place and the water reads as static.
      u[idx] = (amp * Math.cos(ang) * (osc + 0.6) * VEL_GAIN * dtF) / cWm;
      v[idx] = (amp * Math.sin(ang) * (osc + 0.6) * VEL_GAIN * dtF) / cHm;

      const Hb = breakerGamma * h;
      const hOn = Hb * BREAK_ON, hOff = Hb * BREAK_OFF;
      const keepBreaking = waveBreaking[idx] === 1;
      if (keepBreaking ? waveH[idx] >= hOff : waveH[idx] >= hOn) {
        waveBreaking[idx] = 1;
        breakCount++;
        if (waveH[idx] > breakHb) { breakHb = waveH[idx]; breakDepth = h; }
      } else {
        waveBreaking[idx] = 0;
      }
    }
  }
}


/**
 * Stockdon et al. (2006) eq. 18, R2 (2% exceedance runup) on a plane foreshore:
 *   R2 = 1.1 * ( 0.35*beta*sqrt(H0*L0) + 0.5*sqrt(H0*L0*(0.563*beta^2 + 0.004)) )
 * L0 is the deep-water wavelength g*T^2/(2*pi).
 */
function computeRunup() {
  const T = conditions.Tp, H0 = conditions.Hs, b = conditions.slope;
  const L0 = GRAV * T * T / (2 * Math.PI);
  const root = Math.sqrt(Math.max(H0 * L0, 0));
  runupSetup = 0.35 * b * root;
  runupSwash = 0.5 * Math.sqrt(Math.max(H0 * L0 * (0.563 * b * b + 0.004), 0));
  runupR2    = 1.1 * (runupSetup + runupSwash);
  iribarren  = b / Math.sqrt(Math.max(H0 / L0, 1e-9));
}

function waveFieldStep() {
  buildSolidMask();

  waveComponents = buildComponents();
  if (waveHComp.length !== waveComponents.length) {
    waveHComp = waveComponents.map(() => new Float32Array(SIZE));
  }

  breakHb = 0; breakDepth = 0;

  for (let c = 0; c < waveComponents.length; c++) transformComponent(c, waveComponents[c]);

  combineComponents();
  applyField();
  computeRunup();
}


// ─────────────────────────────────────────────
// CROSS-SHORE RESPONSE  (Phase 2)
// ─────────────────────────────────────────────
// Exner continuity with a relaxed equilibrium profile:
//
//   dz/dt = (z_eq - z) / T
//
// z_eq is the Dean profile h = A*y^(2/3) offshore, continued at the foreshore gradient
// on land. A comes from the settling velocity of the bed material (Soulsby 1997), so
// grain size controls the profile shape.
//
// Under wave energy z_eq is modified: the subaerial foreshore flattens (erosion of the
// upper profile) and a bar appears at the breakpoint (deposition where the waves break).
// Both are driven by the same storm intensity, so the two responses stay coupled.
//
// Limitation, stated plainly: relaxation is a target-seeking model, not a flux-conserving
// one. It does not conserve volume exactly. Volume conservation belongs with nourishment
// and alongshore transport in Phase 3.

const POROSITY = 0.40;

let morphGrid = null;

let modelDaysPerSec = 2.0;     // model days per real second

let relaxDays = 40;            // e-folding time of the profile response, model days

let morphEnabled = true;

let lastMaxErosion = 0, lastMaxAccretion = 0, barDistanceM = 60, stormNow = 0;

let shoreRef = null, refWaterLevel = 0;   // per alongshore row (GH)


/**
 * Fixed waterline reference per column, from the bed WITHOUT the morphology layer.
 *
 * Anchored once and held. Two failure modes are avoided by NOT re-deriving it:
 *  - re-anchoring to the evolving shoreline each step makes the target chase the bed,
 *    which diverges;
 *  - re-anchoring on every water-level change cancels the storm signal, because a surge
 *    lifts the waterline and raises the landward target by exactly what the storm lowers.
 *
 * Consequence, stated plainly: the equilibrium profile does not translate inland under
 * sea-level rise. Shoreline retreat under SLR needs a volume-conserving profile solver
 * and belongs to Phase 3 alongside alongshore transport.
 */
function shoreRefAt(gy) {
  if (!shoreRef) {
    shoreRef = new Float32Array(GH);
    refWaterLevel = conditions.waterLevel;
    for (let j = 0; j < GH; j++) {
      const s = shorelineXPx(j, true);
      shoreRef[j] = s === null ? -1 : s;
    }
  }
  return shoreRef[gy] >= 0 ? shoreRef[gy] : null;
}


/** Soulsby (1997) settling velocity for a quartz grain, m/s. */
function settlingVelocity(d50mm) {
  const d = Math.max(d50mm, 0.05) / 1000;
  const nu = 1.36e-6;                                   // kinematic viscosity, m2/s
  const Dstar = d * Math.pow(GRAV * 1.65 / (nu * nu), 1 / 3);
  return (nu / d) * (Math.sqrt(10.36 * 10.36 + 1.049 * Math.pow(Dstar, 3)) - 10.36);
}


/** Dean profile coefficient A in m^(1/3), from grain size. */
function deanA(d50mm) {
  const ws = Math.max(settlingVelocity(d50mm) * 100, 0.1);   // cm/s
  return 0.067 * Math.pow(ws, 0.44);
}


/** Storm intensity 0..1 from wave height and water level. */
function stormIntensity() {
  const byWave  = (conditions.Hs - 1.5) / 2.5;
  const byLevel = (conditions.waterLevel - 0.3) / 1.2;
  const a = Math.max(0, Math.min(1, byWave))   * 0.6;
  const b = Math.max(0, Math.min(1, byLevel)) * 0.4;
  return a + b;
}


/** Waterline position in pixels for a morph-grid column, or null. */
/** Waterline position in pixels along x for a morph-grid row, or null. */
function shorelineXPx(gj, base) {
  const y = (gj + 0.5) * DEPO_CELL;
  const wlU = conditions.waterLevel / M_PER_BED_UNIT;
  const fz = base ? bedZ0 : bedZ;
  let xPrev = 0, zPrev = fz(0, y);
  for (let x = DEPO_CELL; x <= width; x += DEPO_CELL) {
    const z = fz(x, y);
    if (zPrev < wlU && z >= wlU) {
      const t = (wlU - zPrev) / ((z - zPrev) || 1e-6);
      return xPrev + t * DEPO_CELL;
    }
    xPrev = x; zPrev = z;
  }
  return null;
}


/**
 * Equilibrium bed elevation in metres.
 * Y is metres offshore of the waterline: positive seaward, negative landward.
 */
function equilibriumZ(Y, storm, A) {
  // Referenced to the water level at anchor time, NOT the live one. A surge would
  // otherwise lift the landward target by exactly the amount the storm lowers it, and
  // erosion could never appear.
  const wl = refWaterLevel;
  if (Y >= 0) {
    // cbrt(Y*Y) rather than pow(Y, 2/3): this runs once per cell per frame and Math.pow with a
    // fractional exponent goes through exp/log. Same value, cheaper.
    // Dean, and nothing else. There used to be a bump drawn into this target at the
    // breakpoint. XBeach never builds a bar there: in all six reference runs the bar starts at
    // the shoreline and moves seaward as it grows. The bar now comes from the eroded beach
    // sand, which morphologyStep keeps inside the depth of closure.
    return wl - A * Math.cbrt(Y * Y);
  }
  // Landward: the beach gradient this profile is built from, cut back by storm energy.
  // conditions.slope is NOT used here — that is the runup foreshore gradient, a different
  // quantity. Using it dragged a 12% dune toward a 2% ramp.
  const slope = BEACH_SLOPE * (1 - 0.55 * storm);
  const cut   = storm * 1.2 * Math.exp(-Math.abs(Y) / 18);   // storm scarp
  return wl + slope * (-Y) - cut;
}


/** Mean distance from the waterline to the outermost breaking cell, in metres. */
function computeBarDistance() {
  const dxp = REACH_CROSSSHORE / Math.max(width, 1);
  let sum = 0, n = 0;
  for (let j = 1; j <= NY; j += 4) {          // one alongshore row in four
    let iBreak = -1, iShore = -1;
    for (let i = 1; i <= NX; i++) {
      const idx = IX(i, j);
      if (iBreak < 0 && waveBreaking[idx]) iBreak = i;
      if (iShore < 0 && depthAt(i, j) <= 0.05) { iShore = i; break; }
    }
    if (iBreak > 0 && iShore > iBreak) { sum += (iShore - iBreak) * cellW * dxp; n++; }
  }
  barDistanceM = n > 0 ? sum / n : 60;
}


// ---- convergence probe -------------------------------------------------------
// dt for the morphology step comes from frame time: dtModel = frameSeconds * rate * 86400,
// so at 30 fps the model advances twice as far per step as at 60 fps. The horizontal step
// is implicit (see (I - r*L) and the Thomas solve in morphologyStep), so there is no CFL
// limit to guard against. But implicit is not the same as accurate: a large r means each
// step makes a large correction, and the answer then depends on how finely the interval is
// divided. That dependence is not visible by looking at the screen — a frame-rate artefact
// and a result look identical.
//
// Kazolea (2024, HDR Université de Bordeaux) states the principle: if you cannot be sure
// the discretisation is adequate, a numerical artefact is easily mistaken for physics. So
// test rather than inspect. This runs the SAME interval of model time twice, at dt and at
// dt/2, from an identical bed state, and reports how far the answer moves.

// Tolerances, stated rather than hidden, and arguable on purpose. One morph cell is
// DEPO_CELL px, about 2.2 m cross-shore on a 1100 px canvas, so 5 m of bar position is
// roughly two cells. 0.05 m of mean bed change is a twentieth of a metre: below that the
// two timesteps describe the same beach, above it they describe different beaches.
const CONV_TOL_BAR_M  = 5.0;

const CONV_TOL_MEAN_M = 0.05;

let convLast    = null;   // { dt, dBar, dMeanM, dMaxM, steps }

let lastDtModel = 0;      // the dt the last draw actually used, in model seconds


/** Integrate `steps` of dtModel twice, at dt and dt/2, and report the difference. */
function convergenceProbe(dtModel, steps) {
  if (!morphGrid || !morphEnabled || !(dtModel > 0)) return null;
  const snap = Float32Array.from(morphGrid);
  const runAt = function (dt, n) {
    morphGrid.set(snap);
    for (let k = 0; k < n; k++) morphologyStep(dt);
    computeBarDistance();
    return { bar: barDistanceM, bed: Float32Array.from(morphGrid) };
  };
  const coarse = runAt(dtModel, steps);
  const fine   = runAt(dtModel / 2, steps * 2);
  morphGrid.set(snap);                 // leave the live bed exactly as we found it
  computeBarDistance();

  // Compare the beds in metres. Not as a percentage of total volume: morphGrid is a
  // perturbation field that sums to about zero, so a ratio to its sum divides by noise.
  //
  // Interior only. The outer row and column of the grid sit off-canvas, and bedZ() clamps
  // them to their neighbours, so they act as a zero-gradient (Neumann) boundary condition.
  // That is a legitimate choice, but those cells converge less well than the interior: at
  // 0.8 h per step they disagree between dt and dt/2 by up to 4.6 m while every interior
  // cell agrees to 1 mm. Measuring them together reports the boundary's noise as if it were
  // the model's. Removing the row instead of measuring around it drops the precision score
  // 62.6 -> 53.9, so the edge is load-bearing and must not be "fixed" casually.
  let sumAbs = 0, maxAbs = 0, n = 0;
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const k = gy * GW + gx;
      const d = Math.abs(fine.bed[k] - coarse.bed[k]) * M_PER_BED_UNIT;
      sumAbs += d;
      if (d > maxAbs) maxAbs = d;
      n++;
    }
  }
  convLast = {
    dt: dtModel,
    dBar: Math.abs(fine.bar - coarse.bar),
    dMeanM: n > 0 ? sumAbs / n : 0,
    dMaxM: maxAbs,
    steps: steps,
  };
  return convLast;
}

function convVerdict(c) {
  if (!c) return null;
  const ok = c.dBar <= CONV_TOL_BAR_M && c.dMeanM <= CONV_TOL_MEAN_M;
  return (ok ? '\u2713 ' : '\u2717 ') +
         '\u0394bar ' + c.dBar.toFixed(0) + ' m  \u0394bed ' + c.dMeanM.toFixed(3) + ' m';
}


/** One morphology step over dtModel seconds of model time. */
let _morphScratch = null;

function morphologyStep(dtModel) {
  if (!morphGrid || !morphEnabled || dtModel <= 0) return;

  stormNow = stormIntensity();
  const A = deanA(conditions.d50);
  const xMPerPx = REACH_CROSSSHORE / Math.max(width, 1);
  const dx = DEPO_CELL * xMPerPx;                    // metres per morph cell
  const POR = 0.4;

  const D = TRANSPORT_D0 * Math.max(conditions.Hs, 0.1) / TRANSPORT_HREF;
  const hClose = CLOSURE_BASE_M + CLOSURE_PER_HS * conditions.Hs;
  const r = (D / (1 - POR)) * dtModel / (dx * dx);

  let maxEr = 0, maxAc = 0;

  // Reused across frames: allocating seven typed arrays per frame was pure GC pressure.
  if (!_morphScratch || _morphScratch.u.length !== GW) {   // was .length, undefined on an object: it reallocated every frame
    _morphScratch = {
      u: new Float64Array(GW), un: new Float64Array(GW), diag: new Float64Array(GW),
      mob: new Float64Array(GW),
      low: new Float64Array(GW), up: new Float64Array(GW), rhs: new Float64Array(GW),
      act: new Uint8Array(GW),
    };
  }
  const { u, un, diag, low, up, rhs, act, mob } = _morphScratch;

  for (let gy = 0; gy < GH; gy++) {
    const xShore = shoreRefAt(gy);
    if (xShore === null) continue;
    const y = (gy + 0.5) * DEPO_CELL;

    let any = false;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * DEPO_CELL;
      const z = bedZ(x, y) * M_PER_BED_UNIT;
      // The dune is not a Dean profile: exclude it from transport entirely.
      if (z > refWaterLevel + BERM_TOP_M) { act[gx] = 0; u[gx] = 0; continue; }
      const Y = (xShore - x) * xMPerPx;
      u[gx] = z - equilibriumZ(Y, stormNow, A);
      act[gx] = 1;
      // Mobility: 1 down to half the depth of closure, then linearly to 0 at closure.
      const depth = conditions.waterLevel - z;
      mob[gx] = depth <= 0.5 * hClose ? 1 : Math.max(0, (hClose - depth) / (0.5 * hClose));
      any = true;
    }
    if (!any) continue;

    // Implicit tridiagonal: (I - r*L) u_new = u. The exchange across each face is weighted by
    // the less mobile of its two cells, and the same weight is used from both sides, so what
    // leaves one cell arrives in the next: sand is conserved whatever the mobility does.
    // A face next to a dune cell, a closed cell or the grid edge carries nothing.
    for (let gx = 0; gx < GW; gx++) {
      const fL = (gx > 0      && act[gx] && act[gx - 1]) ? r * Math.min(mob[gx], mob[gx - 1]) : 0;
      const fR = (gx < GW - 1 && act[gx] && act[gx + 1]) ? r * Math.min(mob[gx], mob[gx + 1]) : 0;
      low[gx]  = -fL;
      up[gx]   = -fR;
      diag[gx] = 1 + fL + fR;
      rhs[gx]  = u[gx];
    }

    // Thomas algorithm.
    for (let gx = 1; gx < GW; gx++) {
      const f = low[gx] / diag[gx - 1];
      diag[gx] -= f * up[gx - 1];
      rhs[gx]  -= f * rhs[gx - 1];
    }
    un[GW - 1] = rhs[GW - 1] / diag[GW - 1];
    for (let gx = GW - 2; gx >= 0; gx--) {
      un[gx] = (rhs[gx] - up[gx] * un[gx + 1]) / diag[gx];
    }

    for (let gx = 0; gx < GW; gx++) {
      if (!act[gx]) continue;
      const du = un[gx] - u[gx];                      // metres
      if (!isFinite(du) || du === 0) continue;
      const idx = gy * GW + gx;
      morphGrid[idx] += du / M_PER_BED_UNIT;
      if (morphGrid[idx] >  300) morphGrid[idx] =  300;
      if (morphGrid[idx] < -300) morphGrid[idx] = -300;
      if (du < 0 && -du > maxEr) maxEr = -du;
      if (du > 0 &&  du > maxAc) maxAc =  du;
    }
  }

  lastMaxErosion = maxEr;
  lastMaxAccretion = maxAc;
}


/** Flood / drain the morphology grid with spring sand, for the reset control. */
function resetMorphology() {
  if (!morphGrid) return;
  morphGrid.fill(0);
  if (longGrid) longGrid.fill(0);
  shoreRef = null;
  updateBedBuffer();
}


// ─────────────────────────────────────────────
// LONGSHORE TRANSPORT  (Phase 3)
// ─────────────────────────────────────────────
// CERC bulk formula, applied per alongshore row at the break point:
//
//   Q = K / (16 (s-1)) * Hb^2.5 / sqrt(gamma) * sin(2 alpha_b)      [m3/s]
//
// sin(2a) makes transport zero at shore-normal and peak at 45 degrees, by construction.
// The bed then follows the divergence: dz/dt = -(1/(1-p)) * (dQ/dy) / W_active.
//
// Structures block transport because they occupy the surf zone: buildSolidMask zeroes the
// wave field inside them, so no cell in that row is breaking, so Q is zero there. The
// resulting gradient IS the groyne effect — accretion updrift, erosion downdrift.

const CERC_K = 0.39;         // CERC coefficient for significant wave height

const CERC_S = 2.65;         // relative sediment density

const POROSITY_LS = 0.40;

let longGrid = null;

let longshoreGain = 0.03;    // morphological rate multiplier for the alongshore term

let qLong = new Float32Array(NY + 2);

let qPeak = 0, qMean = 0;    // m3/s


/** CERC longshore transport rate, m3/s. alpha is the breaking angle in radians. */
function cercQ(Hb, alpha) {
  if (Hb <= 0.02 || !isFinite(alpha)) return 0;
  return (CERC_K / (16 * (CERC_S - 1))) *
         (Math.pow(Hb, 2.5) / Math.sqrt(breakerGamma)) *
         Math.sin(2 * alpha);
}


/** Transport rate per alongshore row, taken at the outermost breaking cell. */
function computeLongshore() {
  for (let j = 1; j <= NY; j++) {
    let Hb = 0, alpha = 0, found = false;
    for (let i = 1; i <= NX; i++) {
      const idx = IX(i, j);
      if (waveBreaking[idx]) { Hb = waveH[idx]; alpha = waveAngle[idx]; found = true; break; }
    }
    qLong[j] = found ? cercQ(Hb, alpha) : 0;
  }

  // Structure-influence smoothing. A groyne occupies fewer alongshore rows than the grid
  // can resolve, so differencing it directly deposits the whole fillet into a single row —
  // a spike, not a beach. Widening the transition to a few rows makes the deposit
  // resolvable. This is a numerical treatment, not physics: a proper one-line model would
  // derive the same length from shoreline curvature feeding back into the breaking angle.
  const HALO = 6;
  const tmp = new Float32Array(NY + 2);
  for (let j = 1; j <= NY; j++) {
    let sum = 0, n = 0;
    for (let k = -HALO; k <= HALO; k++) {
      const jj = j + k < 1 ? 1 : (j + k > NY ? NY : j + k);
      sum += qLong[jj]; n++;
    }
    tmp[j] = sum / n;
  }
  for (let j = 1; j <= NY; j++) qLong[j] = tmp[j];

  let sum = 0, n = 0, peak = 0;
  for (let j = 1; j <= NY; j++) {
    sum += qLong[j]; n++;
    if (Math.abs(qLong[j]) > peak) peak = Math.abs(qLong[j]);
  }
  qLong[0] = qLong[1];
  qLong[NY + 1] = qLong[NY];
  qPeak = peak;
  qMean = n ? sum / n : 0;
}


/**
 * Apply the transport divergence over a model-time step.
 * Volumetric: whatever leaves one cell arrives in the next, so the alongshore layer
 * conserves sediment. The cross-shore relaxation does not, and they are kept apart.
 */
function applyLongshore(dtModel) {
  if (!longGrid || !morphEnabled || dtModel <= 0) return;

  const xMPerPx = REACH_CROSSSHORE / Math.max(width, 1);
  const dyp = DEPO_CELL * (REACH_ALONGSHORE / Math.max(height, 1));   // metres per morph row

  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * DEPO_CELL;
    const j = Math.max(1, Math.min(NY, Math.round(y / cellH)));

    // active zone: break point to shoreline, for this row
    let iBreak = -1, iShore = -1;
    for (let i = 1; i <= NX; i++) {
      const idx = IX(i, j);
      if (iBreak < 0 && waveBreaking[idx]) iBreak = i;
      if (iShore < 0 && depthAt(i, j) <= 0.05) { iShore = i; break; }
    }
    if (iBreak < 1 || iShore <= iBreak) continue;

    const Wact = Math.max((iShore - iBreak) * cellW * xMPerPx, 10);   // metres
    const dQdy = (qLong[j + 1] - qLong[j - 1]) / (2 * dyp);           // m2/s
    const dzdt = -(dQdy / ((1 - POROSITY_LS) * Wact)) * longshoreGain; // m/s
    if (!isFinite(dzdt) || dzdt === 0) continue;
    const dzUnits = dzdt * dtModel / M_PER_BED_UNIT;

    const gx0 = Math.max(0, Math.floor((iBreak * cellW) / DEPO_CELL));
    const gx1 = Math.min(GW - 1, Math.ceil((iShore * cellW) / DEPO_CELL));

    for (let gx = gx0; gx <= gx1; gx++) {
      const idx = gy * GW + gx;
      longGrid[idx] += dzUnits;
      if (longGrid[idx] >  300) longGrid[idx] =  300;
      if (longGrid[idx] < -300) longGrid[idx] = -300;
    }
  }
}


/** Total and peak bed change held in the longshore layer, in metres. */
function longshoreStats() {
  if (!longGrid) return { min: 0, max: 0, mean: 0 };
  let mn = 0, mx = 0, sum = 0;
  for (let i = 0; i < longGrid.length; i++) {
    const v = longGrid[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
  }
  return { min: mn * M_PER_BED_UNIT, max: mx * M_PER_BED_UNIT,
           mean: sum / longGrid.length * M_PER_BED_UNIT };
}


// ─────────────────────────────────────────────
// OBJECT VOCABULARY  (Phase 4)
// ─────────────────────────────────────────────
// Objects carry a `kind`. Structural kinds block the wave field through buildSolidMask;
// nourishment does not — it is sand, not concrete.

/** Sand placed over a nourishment object's footprint, at 0.5 m per model year. */
const NOURISH_RATE = 0.5;

function applyNourishment(dtModel) {
  if (!morphGrid || dtModel <= 0) return;
  const dYears = dtModel / (365 * 86400);

  for (let o = 0; o < obstacles.length; o++) {
    const ob = obstacles[o];
    if ((ob.kind || 'structure') !== 'nourish') continue;
    if (!isObstacleActive(ob)) continue;

    const hw = obW(ob) / 2, hh = obH(ob) / 2;
    const dz = (NOURISH_RATE * dYears) / M_PER_BED_UNIT;

    for (let gy = 0; gy < GH; gy++) {
      const y = (gy + 0.5) * DEPO_CELL;
      if (Math.abs(y - ob.y) > hh) continue;
      for (let gx = 0; gx < GW; gx++) {
        const x = (gx + 0.5) * DEPO_CELL;
        if (Math.abs(x - ob.x) > hw) continue;
        const idx = gy * GW + gx;
        morphGrid[idx] += dz;
        if (morphGrid[idx] > 300) morphGrid[idx] = 300;
      }
    }
  }
}

function spawnParticle() {
  // Suspended sediment fills the water, rather than entering as an inflow stream: seed
  // across the offshore portion of the reach so the whole surf zone is populated.
  let x = random(cellW, width * 0.70), y = random(cellH, height - cellH);
  return { x, y, vx: random(0, 0.15) * cellW, vy: random(-0.3,0.3)*cellH, born: simTime - random(0, MAX_PARTICLE_AGE) };
}


// ── Bed surface render ──
let bedSample = null, bedDz = null;

const BED_Z_MIN = -150;                       // -7.5 m

const BED_Z_MAX = 170;                        // +8.5 m

// ─────────────────────────────────────────────
// WHAT THE INTERFACE ASKS OF THE MODEL
// ─────────────────────────────────────────────
// The whole bed surface: where the bed has moved, the dry beach, and contours.
function coastalRenderBed() {
  // Sample the bed ONCE per cell and let the wash, the height ramp and the contours all read
  // the same array. The earlier version called bedZ() independently in each of the three
  // passes -- around half a million lookups per refresh -- and that single function was 99 ms
  // of a 136 ms frame.
  const STEP = 4;
  const NW = Math.ceil(width / STEP), NH = Math.ceil(height / STEP);
  if (!bedSample || bedSample.length !== NW * NH) {
    bedSample = new Float32Array(NW * NH);
    bedDz = new Float32Array(NW * NH);
  }
  for (let iy = 0; iy < NH; iy++) {
    const py = iy * STEP;
    for (let ix = 0; ix < NW; ix++) {
      const px = ix * STEP, k = iy * NW + ix;
      // One lookup of each component instead of calling bedZ() AND bedZ0(), which together
      // walked userBedZ and depoZ twice per cell. The wash only needs the morphology layers.
      const mo = morphZ(px, py), lo = longZ(px, py);
      bedSample[k] = userBedZ(px, py) + depoZ(px, py) + mo + lo;
      bedDz[k] = (mo + lo) * M_PER_BED_UNIT;
    }
  }

  const ovStep = 8, os = ovStep / STEP;

  // Morphology-change wash. The height ramp below only colours the subaerial bed, so a bar
  // or a groyne fillet -- both underwater -- would otherwise be invisible. Warm is accretion,
  // cool is erosion; the layer is the difference from the base bed.
  for (let iy = 0; iy < NH; iy += os) {
    for (let ix = 0; ix < NW; ix += os) {
      const dz = bedDz[iy * NW + ix];
      if (Math.abs(dz) < 0.02) continue;
      const t = Math.min(1, Math.abs(dz) / 0.8);
      if (dz > 0) bedSurface.fill(255, 190, 90, 25 + t * 95);
      else        bedSurface.fill(90, 160, 255, 25 + t * 95);
      bedSurface.rect(ix * STEP, iy * STEP, ovStep, ovStep);
    }
  }

  // Subaerial height ramp.
  const bedMaxZ = 160;
  bedSurface.noStroke();
  for (let iy = 0; iy < NH; iy += os) {
    for (let ix = 0; ix < NW; ix += os) {
      const z = bedSample[iy * NW + ix];
      if (z <= 0) continue;
      const t = Math.min(1, z / bedMaxZ);
      bedSurface.fill(40 + t * 80, 20 + t * 35, 10 + t * 15, 10 + t * 40);
      bedSurface.rect(ix * STEP, iy * STEP, ovStep, ovStep);
    }
  }

  // Contours, straight off the sampled grid -- no further bed lookups.
  const levels = [20, 40, 60, 80, 100, 120, 140];
  for (const lvl of levels) {
    bedSurface.stroke(255, 200, 130, 25 + (lvl / bedMaxZ) * 50);
    bedSurface.strokeWeight(0.5);
    for (let iy = 0; iy < NH; iy++) {
      const row = iy * NW, py = iy * STEP;
      for (let ix = 1; ix < NW; ix++) {
        const prevZ = bedSample[row + ix - 1], currZ = bedSample[row + ix];
        if ((prevZ - lvl) * (currZ - lvl) < 0 && prevZ > 0 && currZ > 0) {
          const t = (lvl - prevZ) / (currZ - prevZ);
          bedSurface.point((ix - 1) * STEP + t * STEP, py);
        }
      }
    }
    for (let ix = 0; ix < NW; ix++) {
      const px = ix * STEP;
      for (let iy = 1; iy < NH; iy++) {
        const prevZ = bedSample[(iy - 1) * NW + ix], currZ = bedSample[iy * NW + ix];
        if ((prevZ - lvl) * (currZ - lvl) < 0 && prevZ > 0 && currZ > 0) {
          const t = (lvl - prevZ) / (currZ - prevZ);
          bedSurface.point(px, (iy - 1) * STEP + t * STEP);
        }
      }
    }
  }
}

// The readouts in the sidebar, every frame.
function coastalHud() {
  document.getElementById('modelyear').textContent = modelYears.toFixed(1);
  document.getElementById('tlyear').textContent    = timelineLoopTime().toFixed(1);
  document.getElementById('tldur').textContent     = timelineDuration.toFixed(0);
  document.getElementById('ro-hb').textContent     = breakHb > 0 ? breakHb.toFixed(2) : '–';
  document.getElementById('ro-db').textContent     = breakDepth > 0 ? breakDepth.toFixed(2) : '–';
  document.getElementById('ro-er').textContent    = lastMaxErosion.toFixed(2);
  document.getElementById('ro-ac').textContent    = lastMaxAccretion.toFixed(2);
  document.getElementById('ro-storm').textContent = stormNow.toFixed(2);
  document.getElementById('ro-qpk').textContent  = qPeak.toFixed(4);
  document.getElementById('ro-qnet').textContent = qMean.toFixed(4);
  {
    const st = longshoreStats();
    document.getElementById('ro-ls').textContent =
      (st.min < -0.005 ? 'erosion ' + st.min.toFixed(2) + ' m' : 'no erosion') +
      ' · ' + (st.max > 0.005 ? 'accretion ' + st.max.toFixed(2) + ' m' : 'no accretion');
  }
  document.getElementById('ro-bar').textContent   = barDistanceM > 0 ? barDistanceM.toFixed(0) : '–';
  {
    // dt is the timestep the last frame actually used, so a frame-rate change shows here
    // immediately rather than only inside a probe run.
    const dtNow = lastDtModel > 0 ? lastDtModel : (16.7 / 1000) * modelDaysPerSec * 86400;
    const el    = document.getElementById('ro-conv');
    if (el) {
      const v = convVerdict(convLast);
      el.textContent = 'dt ' + (dtNow / 3600).toFixed(2) + ' h' + (v ? '  ' + v : '');
      el.style.color = (v && v.charAt(0) === '\u2717')
        ? 'rgba(255,110,110,0.95)' : 'rgba(255,190,120,0.6)';
    }
  }
  document.getElementById('ro-runup').textContent  = runupR2.toFixed(2);
  document.getElementById('ro-xi').textContent     = iribarren.toFixed(2);
  document.getElementById('ro-zone').textContent   =
    (iribarren < 0.5 ? 'spilling' : iribarren < 1.5 ? 'plunging' : 'surging') +
    ' · ' + breakCount + ' breaking cells';
}

// One frame of the model: waves, then the bed they move, on model time.
function coastalStep() {
  // waveFieldStep() rasterizes obstacles itself; calling it here too ran the mask twice
  // per frame for nothing.
  waveFieldStep();
  const _dtF = (typeof deltaTime === 'number' ? Math.min(deltaTime, 60) : 16.7) / 1000;
  const dtModel = _dtF * modelDaysPerSec * 86400;      // model seconds this frame
  lastDtModel = dtModel;
  modelYears += dtModel / (365 * 86400);
  computeBarDistance();
  morphologyStep(dtModel);
  computeLongshore();
  applyLongshore(dtModel);
  applyNourishment(dtModel);
  if (morphEnabled && (frameCount % 8 === 0)) updateBedBuffer();
}

registerModel({
  id: 'coast',

  // The bed is drawn on both sides of still water.
  bed: { zMin: BED_Z_MIN, zMax: BED_Z_MAX, datumLabel: 'still water' },
  defaultBedZ: defaultCoastalBedZ,
  // z is the drawn bed plus deposit; the model adds what the waves have moved.
  bedTotal(z, x, y) { return z + morphZ(x, y) + longZ(x, y); },
  bedGridsReady() {
    morphGrid = new Float32Array(GW * GH);
    longGrid = new Float32Array(GW * GH);
    rebuildUserBedGrid();          // seed the coastal profile into the cached bed grid
  },
  renderBed: coastalRenderBed,

  controls: {
    stats: `year: <span class="hv" id="modelyear">0.0</span> &nbsp; <span class="hv" id="tlyear">0.0</span> / <span class="hv" id="tldur">20</span> yr<br>`,
    html: `
<div class="sect-label">coastal <button class="reset-btn" id="reset-coastal">reset</button></div>
<div class="ctrl-row" style="margin-bottom:2px;">
  <label style="font-size:8px;color:rgba(255,255,255,0.3);">preset</label>
  <select id="coastal-preset" style="flex:1;background:#161616;color:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.14);border-radius:2px;font-size:9px;padding:1px 2px;outline:none;">
    <option value="custom">custom</option>
    <option value="calm">calm summer</option>
    <option value="storm">winter storm</option>
    <option value="recovery">post-storm recovery</option>
    <option value="slr">SLR 2100</option>
  </select>
</div>
<div class="ctrl-row"><label>Hs <span class="val" id="c-hs-val">1.20</span> m</label><input type="range" id="c-hs" min="0.1" max="6" value="1.2" step="0.05"></div>
<div class="ctrl-row"><label>Tp <span class="val" id="c-tp-val">8.0</span> s</label><input type="range" id="c-tp" min="3" max="20" value="8" step="0.5"></div>
<div class="ctrl-row"><label>direction <span class="val" id="c-dir-val">0</span>&deg;</label><input type="range" id="c-dir" min="-80" max="80" value="0" step="1"></div>
<div class="ctrl-row"><label>spread <span class="val" id="c-spread-val">0</span>&deg;</label><input type="range" id="c-spread" min="0" max="45" value="0" step="1"></div>
<div class="ctrl-row"><label>water level <span class="val" id="c-wl-val">0.00</span> m</label><input type="range" id="c-wl" min="-0.5" max="3" value="0" step="0.05"></div>
<div class="ctrl-row"><label>SLR <span class="val" id="c-slr-val">0.00</span> m</label><input type="range" id="c-slr" min="0" max="2" value="0" step="0.05"></div>
<div class="ctrl-row"><label>D50 <span class="val" id="c-d50-val">0.30</span> mm</label><input type="range" id="c-d50" min="0.08" max="2" value="0.3" step="0.01"></div>
<div class="ctrl-row"><label>slope <span class="val" id="c-slope-val">0.020</span></label><input type="range" id="c-slope" min="0.005" max="0.15" value="0.02" step="0.005"></div>
<div id="coastal-readout" style="font-size:9px;color:rgba(110,190,255,0.6);line-height:1.5;margin:4px 0 3px 0;font-variant-numeric:tabular-nums;">
  break <span id="ro-hb">–</span> m @ <span id="ro-db">–</span> m<br>
  runup R2 <span id="ro-runup">–</span> m &nbsp; &xi; <span id="ro-xi">–</span><br>
  <span id="ro-zone">–</span>
</div>

<div class="sect-label">morphology <button class="reset-btn" id="btn-conv" title="run the same interval of model time at dt and at dt/2 and report how far the answer moves">conv</button> <button class="reset-btn" id="reset-morph">clear</button></div>
<div class="ctrl-row"><label>model rate <span class="val" id="mrate-val">2.0</span> d/s</label><input type="range" id="m-rate" min="0.1" max="30" value="2" step="0.1"></div>
<div class="ctrl-row"><label>response <span class="val" id="relax-val">40</span> d</label><input type="range" id="m-relax" min="5" max="180" value="40" step="5"></div>
<div class="ctrl-row"><label>longshore <span class="val" id="ls-val">0.03</span></label><input type="range" id="m-long" min="0" max="0.2" value="0.03" step="0.005"></div>
<div id="morph-readout" style="font-size:9px;color:rgba(255,190,120,0.6);line-height:1.5;margin:4px 0 3px 0;font-variant-numeric:tabular-nums;">
  erosion <span id="ro-er">0.00</span> m &nbsp; accretion <span id="ro-ac">0.00</span> m<br>
  storm <span id="ro-storm">0.00</span> &nbsp; bar at <span id="ro-bar">–</span> m<br>
  Q peak <span id="ro-qpk">–</span> m&sup3;/s &nbsp; net <span id="ro-qnet">–</span> m&sup3;/s<br>
  <span id="ro-ls">–</span><br>
  <span id="ro-conv">–</span>
</div>
<div class="sect-label">physics <button class="reset-btn" id="reset-physics">reset</button></div>
<div class="ctrl-row"><label>settle thresh <span class="val" id="settle-thresh-val">0.20</span></label><input type="range" id="settle-thresh" min="0.05" max="0.8" value="0.20" step="0.01"></div>
<div class="ctrl-row"><label>settle prob <span class="val" id="settle-prob-val">0.012</span></label><input type="range" id="settle-prob" min="0.002" max="0.08" value="0.012" step="0.001"></div>
<div class="ctrl-row"><label>erode thresh <span class="val" id="erosion-thresh-val">1.00</span></label><input type="range" id="erosion-thresh" min="0.2" max="3.0" value="1.0" step="0.01"></div>
<div class="ctrl-row"><label>erode prob <span class="val" id="erosion-prob-val">0.02</span></label><input type="range" id="erosion-prob" min="0.005" max="0.1" value="0.02" step="0.005"></div>
`,
    wire() {
      // ---- Coastal conditions
      const CP = {
        hs: 'c-hs', tp: 'c-tp', dir: 'c-dir', spread: 'c-spread',
        wl: 'c-wl', slr: 'c-slr', d50: 'c-d50', slope: 'c-slope',
      };
      function readCoastal() {
        const g = id => parseFloat(document.getElementById(id).value);
        conditions.Hs        = g(CP.hs);
        conditions.Tp        = g(CP.tp);
        conditions.dirDeg    = g(CP.dir);
        conditions.spreadDeg = g(CP.spread);
        conditions.waterLevel = g(CP.wl) + g(CP.slr);
        conditions.d50       = g(CP.d50);
        conditions.slope     = g(CP.slope);
        document.getElementById('c-hs-val').textContent    = conditions.Hs.toFixed(2);
        document.getElementById('c-tp-val').textContent    = conditions.Tp.toFixed(1);
        document.getElementById('c-dir-val').textContent   = conditions.dirDeg.toFixed(0);
        document.getElementById('c-spread-val').textContent= conditions.spreadDeg.toFixed(0);
        document.getElementById('c-wl-val').textContent    = g(CP.wl).toFixed(2);
        document.getElementById('c-slr-val').textContent   = g(CP.slr).toFixed(2);
        document.getElementById('c-d50-val').textContent   = conditions.d50.toFixed(2);
        document.getElementById('c-slope-val').textContent = conditions.slope.toFixed(3);
      }
      function writeCoastal(c) {
        document.getElementById('c-hs').value    = c.Hs;
        document.getElementById('c-tp').value    = c.Tp;
        document.getElementById('c-dir').value   = c.dirDeg;
        document.getElementById('c-spread').value= c.spreadDeg;
        document.getElementById('c-wl').value    = c.waterLevel;
        document.getElementById('c-slr').value   = c.slr || 0;
        document.getElementById('c-d50').value   = c.d50;
        document.getElementById('c-slope').value = c.slope;
        readCoastal();
      }
      const PRESETS = {
        calm:     { Hs: 0.6, Tp: 6.0, dirDeg: 8,  spreadDeg: 12, waterLevel: 0.2, slr: 0, d50: 0.30, slope: 0.020 },
        storm:    { Hs: 3.4, Tp: 12.0, dirDeg: -28, spreadDeg: 18, waterLevel: 0.8, slr: 0, d50: 0.30, slope: 0.020 },
        recovery: { Hs: 0.9, Tp: 9.0, dirDeg: 4,  spreadDeg: 20, waterLevel: 0.3, slr: 0, d50: 0.30, slope: 0.020 },
        slr:      { Hs: 0.6, Tp: 6.0, dirDeg: 8,  spreadDeg: 12, waterLevel: 0.2, slr: 0.9, d50: 0.30, slope: 0.020 },
      };
      ['c-hs','c-tp','c-dir','c-spread','c-wl','c-slr','c-d50','c-slope'].forEach(id => {
        document.getElementById(id).addEventListener('input', function() {
          document.getElementById('coastal-preset').value = 'custom';
          readCoastal();
        });
      });
      document.getElementById('coastal-preset').addEventListener('change', function() {
        const p = PRESETS[this.value];
        if (p) writeCoastal(p);
      });
      document.getElementById('reset-coastal').addEventListener('click', function() {
        document.getElementById('coastal-preset').value = 'custom';
        writeCoastal({ Hs: 1.2, Tp: 8.0, dirDeg: 0, spreadDeg: 0, waterLevel: 0, slr: 0, d50: 0.30, slope: 0.020 });
      });
      readCoastal();

      // ---- Morphology
      document.getElementById('m-rate').addEventListener('input', function(){
        modelDaysPerSec = parseFloat(this.value);
        document.getElementById('mrate-val').textContent = modelDaysPerSec.toFixed(1);
      });
      document.getElementById('m-relax').addEventListener('input', function(){
        relaxDays = parseFloat(this.value);
        document.getElementById('relax-val').textContent = relaxDays.toFixed(0);
      });
      document.getElementById('m-long').addEventListener('input', function(){
        longshoreGain = parseFloat(this.value);
        document.getElementById('ls-val').textContent = longshoreGain.toFixed(3);
      });
      document.getElementById('reset-morph').addEventListener('click', function(){ resetMorphology(); });
      {
        const bconv = document.getElementById('btn-conv');
        if (bconv) bconv.addEventListener('click', function () {
          bconv.blur();                       // keep Space and the other keys working
          const dt = lastDtModel > 0 ? lastDtModel : (16.7 / 1000) * modelDaysPerSec * 86400;
          const res = convergenceProbe(dt, 40);
          bconv.textContent = res ? 'conv' : 'off';
        });
      }

      // Physics sliders
      document.getElementById('settle-thresh').addEventListener('input', function(){settleThresh=parseFloat(this.value);document.getElementById('settle-thresh-val').textContent=settleThresh.toFixed(2);});
      document.getElementById('settle-prob').addEventListener('input', function(){settleProb=parseFloat(this.value);document.getElementById('settle-prob-val').textContent=settleProb.toFixed(3);});
      document.getElementById('erosion-thresh').addEventListener('input', function(){erosionThresh=parseFloat(this.value);document.getElementById('erosion-thresh-val').textContent=erosionThresh.toFixed(2);});
      document.getElementById('erosion-prob').addEventListener('input', function(){erosionProb=parseFloat(this.value);document.getElementById('erosion-prob-val').textContent=erosionProb.toFixed(3);});

      document.getElementById('reset-physics').addEventListener('click',function(){
        settleThresh=0.20;erosionThresh=1.0;settleProb=0.012;erosionProb=0.02;
        document.getElementById('settle-thresh').value=0.20;document.getElementById('settle-thresh-val').textContent='0.20';
        document.getElementById('settle-prob').value=0.012;document.getElementById('settle-prob-val').textContent='0.012';
        document.getElementById('erosion-thresh').value=1.0;document.getElementById('erosion-thresh-val').textContent='1.00';
        document.getElementById('erosion-prob').value=0.02;document.getElementById('erosion-prob-val').textContent='0.02';
      });
    },
  },
  help: '4 nourish',
  render: { slowColor: '#ff44aa', fastColor: '#ddeeff', flowOpacity: 140 },

  // The timeline runs on model years.
  clock() { return modelYears; },
  formatDuration(t) { return (t >= 1 ? Math.round(t) + ' yr' : Math.round(t * 12) + ' mo'); },
  timeline: { duration: 20, objectDuration: 5, min: 5, max: 100, step: 5 },

  // A nourishment is sand placed on the bed: the waves pass over it and it feeds the profile.
  isSolid(ob) { return (ob.kind || 'structure') !== 'nourish'; },
  makeObstacle(type, x, y, rot) {
    if (type !== 'nourish') return null;
    return { type: 'rect', kind: 'nourish', x, y, w: ghostSize, h: ghostSize * 0.6,
             rotation: 0, clips: [{ start: timelineLoopTime(), dur: DEFAULT_OBJ_DUR }] };
  },
  key(k) {
    if (k === '4') { ghostType = 'nourish'; polyPoints = []; return true; }
    return false;
  },
  sceneReady() {
  // Default obstacles: spread across the loop so the timeline is meaningful out of
  // the box; drag/resize them on the timeline bar to re-choreograph.
  obstacles[0].clips = [{ start: 0, dur: timelineDuration / 3 }];
  obstacles[1].clips = [{ start: timelineDuration / 3, dur: timelineDuration / 3 }];
  obstacles[2].clips = [{ start: 2 * timelineDuration / 3, dur: timelineDuration / 3 }];
  },

  spinUp() {
  for (let k=0; k<80; k++) { simTime+=DT; buildSolidMask(); waveFieldStep(); }
  },
  step: coastalStep,
  hud: coastalHud,

  rules: {
    get settleThresh() { return settleThresh; },
    get settleProb() { return settleProb; },
    get erosionThresh() { return erosionThresh; },
    get erosionProb() { return erosionProb; },
    minTravelX: MIN_TRAVEL_X, minAge: MIN_PARTICLE_AGE, maxAge: MAX_PARTICLE_AGE,
    bedSettleOnBed: 1,
    // Sediment slides on the dry beach only, and gently: under water the waves move it.
    slope(p, gradX, gradY, bedHere) {
      if (bedHere > 0) {
        p.vy += gradY * cellH * 0.15;
        p.vx += gradX * cellW * 0.05;
      }
    },
    bedSettleChance(bedHere, settleProb) { return settleProb * (1.0 + (bedHere / 160) * 4.0); },   // 1x..5x settleProb
    settleBoost(bedHere) { return bedHere > 0 ? 1.0 + (bedHere/160)*4.0 : 1.0; },
  },
  spawnParticle, respawnParticle: spawnParticle,
});
