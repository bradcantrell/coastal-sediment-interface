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
const TERRACE_SLOPE = 0.023;   // storm nearshore slope, read off six XBeach runs (0.021 to 0.024)
const TERRACE_YT_PER_A3 = Math.pow((2 / 3) / TERRACE_SLOPE, 3);   // Dean slope = cap at Y = this * A^3
// Fitted to the six XBeach runs: at 0.10 and 0.20 the mean profile error is 0.107
// and 0.138 m against 0.092 m here. XBeach's scarp foot sits within 0.6 m of the still water
// level in every run, which is the same statement.
const WAVE_REACH_PER_HS = 0.15;
const SLUMP_WET = 0.3, SLUMP_DRY = 1.0;   // XBeach's wetslp and dryslp defaults
const SLUMP_PASSES = 4;
const TRANSPORT_D0   = 0.0023;

const TRANSPORT_HREF = 1.5;

// Alongshore spreading. The cross-shore step above works on each row by itself, so nothing
// evened the bed out from one row to the next, and the grains' deposits, which land at random,
// grew into stripes across the shore over a long run (120 storm days: 0.15 m of row-to-row
// roughness at 2.9 h steps, 0.30 m at 0.8 h). The same exchange now runs along each column,
// at the same diffusivity, over all the wet bed within wave reach, and stops at a structure,
// so a groyne still holds the sand on its updrift side. It reaches past the depth of closure
// on purpose: the grains settle out there too, and limited to the cross-shore mobility it
// left their deposits standing (0.32 m rough against 0.05 m, 40 storm days at 8.6 h steps).
// On a straight beach every row is the same and this moves nothing.
const ALONG_D_FACTOR = 1.0;   // alongshore diffusivity as a multiple of the cross-shore one   // alongshore diffusivity as a multiple of the cross-shore one

// The grains' deposits are sand settling out of the water, so they arrive at a rate in
// model time. A grain used to add the same height on every frame it settled, so the bed
// grew faster per model day the slower the model ran, or the faster the machine drew.
// A grain now carries DEPO_AMOUNT for every DEPO_DT_REF of model time in its frame: the
// amount it always carried at the default rate (2 model days a second at 60 frames).
const DEPO_DT_REF = (1 / 60) * 2.0 * 86400;   // model seconds

// Depth of closure in metres below the live water level: 2 m + 0.8 Hs. Seaward of it the bed
// does not move; mobility falls linearly to zero over the outer half of that depth. XBeach's
// deposit ends at 2.8 m depth in the calm run and 4 to 5.4 m in the storm runs. Without this
// the eroded sand spread as a thin film over the whole seabed out to the offshore edge.
// Swell reaches deeper than a sea of the same height. In the XBeach references wave height
// and period rise together (Tp is within half a second of 5.8 + 1.83 Hs in every run), so
// they cannot say which of the two sets the closure depth, and the fit above is written in
// height alone. The swell term is the period beyond that line: zero on every reference run,
// so it leaves the fit and the score untouched. Its size, 0.8 m per second, is a choice and
// is not fitted to anything. It is there so that a season of long, low swell (the recovery
// preset, 0.9 m at 9 s) can bring back the sand a storm left below the reach of a short sea.
const CLOSURE_PER_SWELL_S = 0.8, SWELL_T0 = 5.8, SWELL_T_PER_HS = 1.83;
const CLOSURE_FADE_END = 1.25;   // mobility reaches zero at this multiple of the closure depth
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
// Energy-weighted direction of the components (sum of w H^2 sin th and w H^2 cos th), turned
// into waveAngle by combineComponents().
let waveDirS = new Float32Array(0), waveDirC = new Float32Array(0);

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
      // Longshore transport and the crests follow the energy-weighted mean direction of the
      // components. (Bin 0 alone, as it once was, is the weakest, most oblique edge of the
      // spread, which ran the drift the wrong way. 2026-11-17 stress test.)
      const e = comp.weight * H * H;
      waveDirS[idx] += e * Math.sin(th); waveDirC[idx] += e * Math.cos(th);
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
  for (let idx = 0; idx < SIZE; idx++) {
    if (waveDirC[idx] > 0 || waveDirS[idx] !== 0) waveAngle[idx] = Math.atan2(waveDirS[idx], waveDirC[idx]);
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
  if (waveDirS.length !== SIZE) { waveDirS = new Float32Array(SIZE); waveDirC = new Float32Array(SIZE); }
  waveDirS.fill(0); waveDirC.fill(0);

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

// Wind-blown dune recovery, m3 per metre of shore per year. Field rates of dune growth are
// roughly 5 to 15. XBeach has no wind, so unlike the storm numbers this is not fitted to
// anything; it is a slider.
let duneRate = 10;

let morphEnabled = true;

let lastMaxErosion = 0, lastMaxAccretion = 0, barDistanceM = 60, stormNow = 0;

let shoreRef = null, refWaterLevel = 0;   // per alongshore row (GH)


/**
 * Waterline reference per row: where the bed WITHOUT the morphology layer meets the water.
 *
 * It follows the water level and nothing else. The target profile hangs from it, so a
 * surge or sea-level rise lifts the target and moves its origin up the beach, and the
 * profile responds: sand comes off the beach to raise the nearshore.
 *
 * It is taken from the bed without the morphology layer on purpose. Re-anchoring to the
 * evolving shoreline each step makes the target chase the bed, which diverges.
 *
 * Until 2026-11-14 it was anchored at the first morphology step and held, because under the
 * old storm target re-anchoring on a water-level change cancelled the storm signal. That
 * meant the same storm gave a different answer depending on whether the surge was already
 * up when the bed was reset: the precision score saw a +0.17 m bar where the page saw
 * +0.08 m. The capped-slope target does not have that problem, since the terrace lies far
 * below the beach wherever the origin is.
 */
function shoreRefAt(gy) {
  if (!shoreRef || refWaterLevel !== conditions.waterLevel) {
    if (!shoreRef) shoreRef = new Float32Array(GH);
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


/**
 * Storm intensity 0..1: how far the waves have flattened the nearshore target (see
 * equilibriumZ). 0 at the default 1.2 m and below, so a calm beach is at rest; 1 from 2.0 m.
 * Wave height only. A surge acts through the water level itself, not through this number:
 * it used to add up to 0.4 here, which made a surge with no waves cut the beach.
 * XBeach cuts its terrace under 1.2 m waves too (dev/xbeach-reference-calm.json). Holding a
 * calm beach still is a design rule of this model, so the range starts above that.
 */
const STORM_HS_CALM = 1.2, STORM_HS_FULL = 2.0;
function stormIntensity() {
  return Math.max(0, Math.min(1, (conditions.Hs - STORM_HS_CALM) / (STORM_HS_FULL - STORM_HS_CALM)));
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
  // The water level shoreRefAt() last anchored at, which is the live one once a step has run.
  const wl = refWaterLevel;
  // The Dean curve, with its slope capped. Dean steepens without limit toward the waterline;
  // under storm waves the bed cannot hold that. In all six XBeach reference runs the final
  // nearshore bed is one straight line at about 0.023 (1 in 43), from roughly 1.6 m of water
  // up to the foot of the scarp, whatever the wave height or surge. So the storm target is
  // Dean out to where Dean's own slope falls to the cap, and the tangent line landward of
  // that, on up the beach. Sand cut from above the line is what builds the bar.
  // Between calm and storm the target is a blend of the two profiles, so in calm it is
  // exactly the profile the default bed is seeded with and nothing moves.
  // cbrt(Y*Y) rather than pow(Y, 2/3): this runs once per cell per frame.
  const calm = Y >= 0 ? wl - A * Math.cbrt(Y * Y) : wl + BEACH_SLOPE * (-Y);
  if (storm <= 0) return calm;
  const Yt = TERRACE_YT_PER_A3 * A * A * A;           // where the Dean slope equals the cap
  const cut = Y >= Yt ? wl - A * Math.cbrt(Y * Y)
                      : wl - A * Math.cbrt(Yt * Yt) + TERRACE_SLOPE * (Yt - Y);
  return calm + (cut - calm) * storm;
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
  const hClose = closureDepthM();
  const r = (D / (1 - POR)) * dtModel / (dx * dx);
  const reach = conditions.waterLevel + WAVE_REACH_PER_HS * conditions.Hs;
  // m2 of cross-section per metre of shore this step; none while storm waves are running
  const duneVol = duneRate * (1 - stormNow) * dtModel / (365.25 * 86400);

  let maxEr = 0, maxAc = 0;

  // Reused across frames: allocating seven typed arrays per frame was pure GC pressure.
  if (!_morphScratch || _morphScratch.u.length !== GW) {   // was .length, undefined on an object: it reallocated every frame
    _morphScratch = {
      u: new Float64Array(GW), un: new Float64Array(GW), diag: new Float64Array(GW),
      mob: new Float64Array(GW), zr: new Float64Array(GW),
      low: new Float64Array(GW), up: new Float64Array(GW), rhs: new Float64Array(GW),
      act: new Uint8Array(GW),
    };
  }
  if (!_morphScratch.Z || _morphScratch.Z.length !== GW * GH) {
    _morphScratch.Z = new Float64Array(GW * GH);      // the bed after the cross-shore step, m
    _morphScratch.M = new Uint8Array(GW * GH);        // 1 where it can move along the shore
    const n = Math.max(GW, GH);
    Object.assign(_morphScratch, { cu: new Float64Array(n), cn: new Float64Array(n), cd: new Float64Array(n),
      cl: new Float64Array(n), cp: new Float64Array(n), cr: new Float64Array(n) });
  }
  const { u, un, diag, low, up, rhs, act, mob, zr, Z, M } = _morphScratch;
  M.fill(0);

  for (let gy = 0; gy < GH; gy++) {
    const xShore = shoreRefAt(gy);
    if (xShore === null) continue;
    const y = (gy + 0.5) * DEPO_CELL;
    // The profile moves with the sand the drift has brought or taken: the longshore layer's
    // volume in this row, spread over the active height (closure depth to berm top), is how
    // far the shoreline has moved, and the target moves with it. Anchored at the original
    // shoreline instead, the step took away whatever the drift brought (morphGrid relaxed
    // toward minus longGrid), and next to a groyne the two layers grew against each other by
    // about 11 m a year until both hit their clamps (2026-11-17 stress test).
    let vLong = 0;
    for (let gx = 0; gx < GW; gx++) vLong += longGrid[gy * GW + gx];
    const shift = vLong * M_PER_BED_UNIT * dx / (hClose + BERM_TOP_M);

    let any = false;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * DEPO_CELL;
      const z = bedZ(x, y) * M_PER_BED_UNIT;
      zr[gx] = z;
      const Y = (xShore - x) * xMPerPx - shift;
      const du0 = z - equilibriumZ(Y, stormNow, A);
      // Waves cut the bed only as high as they reach: WAVE_REACH_PER_HS x Hs above the live
      // water level. Above that the bed is dry and is lowered only by slumping (below).
      // Sand can be put back higher than it can be cut, up to the berm top, so a beach
      // that a storm has lowered can rebuild in calm.
      if (z > reach && !(du0 < 0 && z <= refWaterLevel + BERM_TOP_M)) { act[gx] = 0; u[gx] = 0; continue; }
      u[gx] = du0;
      act[gx] = 1;
      // Mobility: 1 down to half the depth of closure, then linearly to 0 at closure.
      const depth = conditions.waterLevel - z;
      // The cube, and out to CLOSURE_FADE_END x the closure depth: a straight fade to zero at
      // the closure depth itself left a ledge there. At storm rates even a tenth of full
      // mobility spreads sand 30 m in ten days, so the last mobile cells filled as high as
      // the rest and the next cell out stayed empty. XBeach's deposit tapers off over 60 m.
      const fade = Math.max(0, Math.min(1, (CLOSURE_FADE_END * hClose - depth) / ((CLOSURE_FADE_END - 0.5) * hClose)));
      mob[gx] = fade * fade * fade;
      any = true;
    }
    if (!any) continue;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * DEPO_CELL;
      // A structure stops the exchange along the shore as it does in the field.
      const solidHere = solid[IX(Math.min(NX + 1, Math.round(x / cellW)), Math.min(NY + 1, Math.round(y / cellH)))];
      M[gy * GW + gx] = (act[gx] && !solidHere && zr[gx] < reach) ? 1 : 0;
    }

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
      zr[gx] += du;
      if (du > 0 &&  du > maxAc) maxAc =  du;
    }

    // Slumping. Where the waves have cut the bed down, the bed behind it cannot stand
    // steeper than SLUMP_WET if the lower cell is within wave reach, or SLUMP_DRY above
    // that; the excess slides down one cell. This is how the dune feeds the beach: the
    // scarp retreats a cell at a time as its foot is carried away, which is why erosion
    // keeps growing through a storm instead of stopping when the beach is used up.
    // What leaves one cell lands in the next, so sand is conserved. The dry limit applies
    // only behind a cell the model has already lowered, so a steep bank the user has drawn
    // is left alone until the waves reach it.
    for (let pass = 0; pass < SLUMP_PASSES; pass++) {
      for (let gx = 0; gx < GW - 1; gx++) {
        // Either way round: a scarp faces the sea, the back of a shoal faces the land.
        const up = zr[gx + 1] >= zr[gx];
        const hi = up ? gx + 1 : gx, lo = up ? gx : gx + 1;
        if (zr[hi] <= conditions.waterLevel) continue;
        const lim = zr[lo] < reach ? SLUMP_WET * dx
                  : morphGrid[gy * GW + lo] < 0 ? SLUMP_DRY * dx : Infinity;
        const d = zr[hi] - zr[lo];
        if (d <= lim) continue;
        const m = 0.5 * (d - lim);
        zr[hi] -= m; zr[lo] += m;
        morphGrid[gy * GW + hi] -= m / M_PER_BED_UNIT;
        morphGrid[gy * GW + lo] += m / M_PER_BED_UNIT;
      }
    }

    // Dune recovery. Wind carries sand from the dry beach to a dune the waves have cut, and
    // the dune rebuilds toward the bed it had before. The sinks are cells that are dry, lower
    // than they were, and were dune to begin with (above the berm top); each takes a share
    // in proportion to how much it is missing. The sources are the dry beach cells seaward
    // of them, which give up an even layer, never below wave reach. What the beach loses the
    // cross-shore step above puts back from the nearshore, so the bar ends up feeding the
    // dune by way of the beach. Sand is conserved. Nothing moves under storm waves, and a
    // dune that was never cut has no sink cells and does not grow.
    if (duneVol > 0) {
      const bermTop = conditions.waterLevel + BERM_TOP_M;
      let need = 0, nSrc = 0, firstSink = -1;
      for (let gx = 0; gx < GW; gx++) {
        const m = morphGrid[gy * GW + gx] * M_PER_BED_UNIT;
        act[gx] = 0;                                    // reused: 1 = sink, 2 = source
        if (m < 0 && zr[gx] > reach && zr[gx] - m > bermTop) {
          act[gx] = 1; need -= m;
          if (firstSink < 0) firstSink = gx;
        }
      }
      if (firstSink >= 0) {
        for (let gx = 0; gx < firstSink; gx++) {
          if (zr[gx] > reach && zr[gx] <= bermTop) { act[gx] = 2; nSrc++; }
        }
      }
      if (need > 0 && nSrc > 0) {
        // Volumes here are thickness x dx per metre of shore; everything is in thickness.
        let give = Math.min(duneVol / dx, need);        // total thickness to move
        let got = 0;
        const layer = give / nSrc;
        for (let gx = 0; gx < firstSink; gx++) {
          if (act[gx] !== 2) continue;
          const t = Math.min(layer, zr[gx] - reach);
          zr[gx] -= t; got += t;
          morphGrid[gy * GW + gx] -= t / M_PER_BED_UNIT;
        }
        for (let gx = firstSink; gx < GW; gx++) {
          if (act[gx] !== 1) continue;
          const idx = gy * GW + gx;
          const t = got * (-morphGrid[idx] * M_PER_BED_UNIT) / need;
          zr[gx] += t;
          morphGrid[idx] += t / M_PER_BED_UNIT;
        }
      }
    }
    for (let gx = 0; gx < GW; gx++) Z[gy * GW + gx] = zr[gx];
  }

  // Alongshore: the same implicit exchange down each column, on the bed itself. Sand moves
  // only between two neighbouring wet cells, the same amount out of one as into the other,
  // so it is conserved, and nothing crosses a structure, the dry beach or a row with no
  // shoreline.
  const dy = DEPO_CELL * (REACH_ALONGSHORE / Math.max(height, 1));
  const ry = ALONG_D_FACTOR * (D / (1 - POR)) * dtModel / (dy * dy);
  const { cu, cn, cd, cl, cp, cr } = _morphScratch;
  for (let gx = 0; gx < GW; gx++) {
    let any = false;
    for (let gy = 0; gy < GH; gy++) {
      const q = gy * GW + gx;
      const fU = (gy > 0      && M[q] && M[q - GW]) ? ry : 0;
      const fD = (gy < GH - 1 && M[q] && M[q + GW]) ? ry : 0;
      if (fU || fD) any = true;
      // The drift's own layer is left out: its shape along the shore (a groyne's fillet) is
      // set by the transport and the shoreline feedback, and smoothing it here undid the
      // fillet as fast as the drift built it, into morphGrid, so the two layers grew apart
      // while the bed hardly moved.
      cl[gy] = -fU; cp[gy] = -fD; cd[gy] = 1 + fU + fD; cr[gy] = cu[gy] = Z[q] - longGrid[q] * M_PER_BED_UNIT;
    }
    if (!any) continue;
    for (let gy = 1; gy < GH; gy++) {
      const f = cl[gy] / cd[gy - 1];
      cd[gy] -= f * cp[gy - 1];
      cr[gy] -= f * cr[gy - 1];
    }
    cn[GH - 1] = cr[GH - 1] / cd[GH - 1];
    for (let gy = GH - 2; gy >= 0; gy--) cn[gy] = (cr[gy] - cp[gy] * cn[gy + 1]) / cd[gy];
    for (let gy = 0; gy < GH; gy++) {
      const du = cn[gy] - cu[gy];
      if (!isFinite(du) || du === 0) continue;
      const q = gy * GW + gx;
      morphGrid[q] = Math.max(-300, Math.min(300, morphGrid[q] + du / M_PER_BED_UNIT));
    }
  }

  lastMaxErosion = maxEr;
  lastMaxAccretion = maxAc;
}


/** Depth of closure below the live water level, m (see CLOSURE_BASE_M). */
function closureDepthM() {
  return CLOSURE_BASE_M + CLOSURE_PER_HS * conditions.Hs
       + CLOSURE_PER_SWELL_S * Math.max(0, conditions.Tp - (SWELL_T0 + SWELL_T_PER_HS * conditions.Hs));
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
// Structures block the share of the drift that flows through the cells they cover (see
// computeLongshore); the gradient this leaves is the groyne effect, accretion updrift and
// erosion downdrift, and the shoreline feedback sets how far along the shore it reaches.

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


// Per flow row, from the wave field: breaking height and angle at the outermost breaking cell,
// and the share of the drift a structure lets past. The drift itself is longshoreQ().
let HbAt = new Float64Array(NY + 2), alphaAt = new Float64Array(NY + 2);
let passShare = new Float64Array(NY + 2), hasBreak = new Uint8Array(NY + 2);
let shoreShift = new Float64Array(NY + 2);     // m, seaward, from the longshore layer

/**
 * Transport rate per alongshore row.
 *
 * Height and angle are taken at the outermost breaking cell. Two things then shape it:
 *
 * Structures. The drift is spread across the surf zone, sin-shaped from the breaker line to
 * the shoreline (a simple stand-in for the measured distributions, which peak inside the surf
 * zone), and a structure blocks the share that flows through the cells it covers. A short
 * groyne holds back part of the drift, one reaching the breakers nearly all of it. (It used
 * to block all or nothing, switching at the outer breaker. 2026-11-17 stress test.)
 *
 * The shoreline (longshoreQ). The breaking angle is measured against the local shoreline
 * (one-line theory): where a fillet turns the shore to face the waves the drift falls, so a
 * groyne's fillet levels off and downdrift erosion spreads instead of digging in. Without it
 * the drift ran at the full rate next to a groyne for ever.
 */
function computeLongshore() {
  for (let j = 1; j <= NY; j++) {
    let iBreak = -1, iShore = -1;
    for (let i = 1; i <= NX; i++) {
      const idx = IX(i, j);
      if (iBreak < 0 && waveBreaking[idx]) { iBreak = i; HbAt[j] = waveH[idx]; alphaAt[j] = waveAngle[idx]; }
      if (depthAt(i, j) <= 0.05) { iShore = i; break; }
    }
    hasBreak[j] = iBreak > 0 ? 1 : 0;
    // No breaking in a row a structure crosses: it covers the whole surf zone.
    let anySolid = false;
    if (iBreak < 0) for (let i = 1; i <= NX && !anySolid; i++) anySolid = solid[IX(i, j)] === 1;
    passShare[j] = anySolid ? 0 : 1;
    if (iBreak > 0 && iShore > iBreak) {
      let all = 0, open = 0;
      const n = iShore - iBreak;
      for (let i = iBreak; i < iShore; i++) {
        const w = Math.sin(Math.PI * (i - iBreak + 0.5) / n);
        all += w;
        if (!solid[IX(i, j)]) open += w;
      }
      passShare[j] = all > 0 ? open / all : 1;
    }
  }
  longshoreBase();
  longshoreShift();
  longshoreQ(qLong);

  let sum = 0, n = 0, peak = 0;
  for (let j = 1; j <= NY; j++) {
    sum += qLong[j]; n++;
    if (Math.abs(qLong[j]) > peak) peak = Math.abs(qLong[j]);
  }
  qPeak = peak;
  qMean = n ? sum / n : 0;
}

// How far each row's shoreline has moved seaward because of the drift: the longshore layer's
// volume per metre of shore over the active height (closure depth to berm top). Read from the
// layer itself, not the waterline, which steps a whole cell at a time.
function longshoreShift() {
  shoreShift.fill(0);
  if (!longGrid) return;
  const dxm = DEPO_CELL * (REACH_CROSSSHORE / Math.max(width, 1));
  const Dact = closureDepthM() + BERM_TOP_M;
  const cnt = new Float64Array(NY + 2);
  for (let gy = 0; gy < GH; gy++) {
    const j = Math.max(1, Math.min(NY, Math.round((gy + 0.5) * DEPO_CELL / cellH)));
    let v = 0;
    for (let gx = 0; gx < GW; gx++) v += longGrid[gy * GW + gx];
    shoreShift[j] += v * M_PER_BED_UNIT * dxm / Dact; cnt[j]++;
  }
  for (let j = 1; j <= NY; j++) shoreShift[j] = cnt[j] ? shoreShift[j] / cnt[j] : 0;
  shoreShift[0] = shoreShift[1]; shoreShift[NY + 1] = shoreShift[NY];
}

// The drift on the faces between flow rows (qFace[j] is between rows j and j + 1, 0 and NY
// are the open ends), and its mean per row in qLong. One-line form: the drift through a face
// is the drift the waves alone would carry, minus 2 A cos(2 alpha) times the angle of the
// shoreline across that face, from the two rows on either side of it. (Taken from rows j - 1
// and j + 1 instead, on rows, it left a row-to-row zigzag undamped, which grew until the drift
// changed sign.)
let qFace = new Float64Array(NY + 1);
const qBase = new Float64Array(NY + 1), qAmpF = new Float64Array(NY + 1), cos2F = new Float64Array(NY + 1), passF = new Float64Array(NY + 1);
function longshoreBase() {
  // Per row what the waves alone would carry, NaN where nothing breaks.
  const raw = new Float64Array(NY + 2), amp = new Float64Array(NY + 2), c2 = new Float64Array(NY + 2);
  for (let j = 1; j <= NY; j++) {
    if (!hasBreak[j]) { raw[j] = amp[j] = c2[j] = NaN; continue; }
    raw[j] = cercQ(HbAt[j], alphaAt[j]);
    amp[j] = cercQ(HbAt[j], Math.PI / 4);
    c2[j] = Math.cos(2 * alphaAt[j]);
  }
  raw[0] = raw[1]; raw[NY + 1] = raw[NY]; amp[0] = amp[1]; amp[NY + 1] = amp[NY]; c2[0] = c2[1]; c2[NY + 1] = c2[NY];
  const mean = (a, b) => Number.isFinite(a) ? (Number.isFinite(b) ? 0.5 * (a + b) : a) : (Number.isFinite(b) ? b : 0);
  // On each face: the mean of the rows either side that have breaking waves, and the share a
  // structure lets through, the smaller of the two rows'. A groyne's own rows pass only what
  // goes round its tip. (A smoothing over 13 rows used to stand in for all this, which let
  // about 12/13 of the drift through any groyne one row wide.)
  for (let f = 0; f <= NY; f++) {
    const pass = Math.min(f >= 1 ? passShare[f] : 1, f < NY ? passShare[f + 1] : 1);
    passF[f] = pass;
    qBase[f] = mean(raw[f], raw[f + 1]) * pass;
    qAmpF[f] = mean(amp[f], amp[f + 1]) * pass;
    cos2F[f] = mean(c2[f], c2[f + 1]);
  }
}
function longshoreQ(out) {
  const dyFlow = cellH * (REACH_ALONGSHORE / Math.max(height, 1));
  qFace[0] = qBase[0]; qFace[NY] = qBase[NY];                    // open ends: what the waves carry
  for (let f = 1; f < NY; f++) {
    // A shoreline further seaward at larger y faces waves arriving at a positive angle more
    // squarely: the angle to the local shore is smaller, and so is the drift.
    // Not across a structure: a groyne divides the shore into two, and what crosses its line
    // is what goes round its tip. (Read across it, the step from the fillet to the groyne's
    // own row cancelled most of the blocking within one step.)
    if (passF[f] < 1) { qFace[f] = qBase[f]; continue; }
    const phi = Math.atan((shoreShift[f + 1] - shoreShift[f]) / dyFlow);
    qFace[f] = qBase[f] - 2 * qAmpF[f] * cos2F[f] * phi;
  }
  for (let j = 1; j <= NY; j++) out[j] = 0.5 * (qFace[j - 1] + qFace[j]);
  out[0] = out[1];
  out[NY + 1] = out[NY];
}


/**
 * Apply the transport divergence over a model-time step.
 * Volumetric: whatever leaves one row arrives in the next, so the alongshore layer conserves
 * sediment. The step is split so the shoreline feedback stays stable: it acts as diffusion
 * along the shore, eps = 2 Q / ((1 - p) D), and an explicit step needs eps dt / dy^2 below a
 * half. At the default rate one step is half a model day, about three times that limit.
 */
function applyLongshore(dtModel) {
  if (!longGrid || !morphEnabled || dtModel <= 0) return;

  const xMPerPx = REACH_CROSSSHORE / Math.max(width, 1);
  const dyFlow = cellH * (REACH_ALONGSHORE / Math.max(height, 1));     // metres per flow row
  const dxm = DEPO_CELL * xMPerPx;

  // The active profile of each row: from the depth of closure up to the berm top. The drift
  // adds or takes sand over all of it, so the profile moves as a whole and the shoreline with
  // it. (It used to go only between the breaker line and the waterline, which hardly moved
  // the shoreline: downdrift of a groyne the bed was dug down metres while the shore stood.)
  const hClose = closureDepthM(), top = conditions.waterLevel + BERM_TOP_M;
  const band0 = new Int32Array(GH).fill(-1), band1 = new Int32Array(GH).fill(-1);
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * DEPO_CELL;
    for (let gx = 0; gx < GW; gx++) {
      const z = bedMeters((gx + 0.5) * DEPO_CELL, y);
      if (band0[gy] < 0 && conditions.waterLevel - z <= hClose) band0[gy] = gx;
      if (band0[gy] >= 0 && z >= top) { band1[gy] = gx - 1; break; }
    }
  }

  let qAmp = 0;
  for (let f = 0; f <= NY; f++) qAmp = Math.max(qAmp, Math.abs(qAmpF[f]));
  const eps = 2 * qAmp * longshoreGain / ((1 - POROSITY_LS) * (hClose + BERM_TOP_M));
  const nSub = Math.max(1, Math.min(64, Math.ceil(eps * dtModel / (dyFlow * dyFlow) / 0.25)));
  const dt = dtModel / nSub;

  for (let sub = 0; sub < nSub; sub++) {
    if (sub > 0) { longshoreShift(); longshoreQ(qLong); }
    for (let gy = 0; gy < GH; gy++) {
      const gx0 = band0[gy], gx1 = band1[gy];
      if (gx0 < 0 || gx1 < gx0) continue;
      const j = Math.max(1, Math.min(NY, Math.round((gy + 0.5) * DEPO_CELL / cellH)));
      const Wact = Math.max((gx1 - gx0 + 1) * dxm, 10);                 // metres
      // The difference across the row's two faces, one flow row apart. (It used to be taken
      // over two flow rows and divided by two bed rows, which overstated it by about 2.2.)
      const dQdy = (qFace[j] - qFace[j - 1]) / dyFlow;                  // m2/s
      const dzdt = -(dQdy / ((1 - POROSITY_LS) * Wact)) * longshoreGain; // m/s
      if (!isFinite(dzdt) || dzdt === 0) continue;
      const dzUnits = dzdt * dt / M_PER_BED_UNIT;
      for (let gx = gx0; gx <= gx1; gx++) {
        const idx = gy * GW + gx;
        longGrid[idx] += dzUnits;
        if (longGrid[idx] >  300) longGrid[idx] =  300;
        if (longGrid[idx] < -300) longGrid[idx] = -300;
      }
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

// ── The grains' sand ──
// A grain is sand the waves have stirred off the bed: it takes its load from where it starts
// (pickGrid, a signed layer in the bed) and puts the same load down where it settles. A grain
// that leaves the canvas or ages out puts it back where it is. So the grains move sand and
// never make it. They used to appear out of nothing over the whole water and add sand
// wherever they settled: the default calm beach silted up in about 5 minutes of real time
// (2026-11-17 stress test).
let pickGrid = null;
function pickZ(x, y) {
  if (!pickGrid) return 0;
  let fx = Math.min(Math.max(x / DEPO_CELL - 0.5, 0), GW - 1);
  let fy = Math.min(Math.max(y / DEPO_CELL - 0.5, 0), GH - 1);
  let i = Math.min(Math.floor(fx), GW - 2), j = Math.min(Math.floor(fy), GH - 2);
  let tx = fx - i, ty = fy - j;
  let a = pickGrid[j * GW + i],       b = pickGrid[j * GW + i + 1];
  let c = pickGrid[(j + 1) * GW + i], d = pickGrid[(j + 1) * GW + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
// The same 3 x 3 footprint the interface's addDeposit() uses (weights sum to 1), unclamped.
function stampPick(x, y, amt) {
  if (!pickGrid) return;
  const i = Math.floor(x / DEPO_CELL - 0.5), j = Math.floor(y / DEPO_CELL - 0.5);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ii = Math.min(GW - 1, Math.max(0, i + di)), jj = Math.min(GH - 1, Math.max(0, j + dj));
    pickGrid[jj * GW + ii] += amt * ((di === 0 && dj === 0) ? 0.5 : 0.0625);
  }
}
// A grain carries 3% of the deposit a grain used to add. The grains now move sand rather than
// make it, and at the old amount they moved about 3.5 m3 per metre of shore a day: far more
// than the profile step, so they set the beach shape on their own (the calm beach lost its
// waterline 50 m landward in 600 days). At 3% the calm beach holds its waterline over 600 days
// and no deposit passes about a metre. The size is a choice, not a fit.
let GRAIN_LOAD = 0.03;
function grainLoad() { return GRAIN_LOAD * (lastDtModel > 0 ? DEPO_AMOUNT * lastDtModel / DEPO_DT_REF : DEPO_AMOUNT); }

// Where a new grain starts: a point in the water, inside the depth of closure, taken with a
// chance that rises with how hard the waves stir the bed there (wave height over the height
// it breaks at). Breaking water lifts the most sand; deep water and the dry beach none.
function grainStart() {
  const hClose = closureDepthM();
  let x = 0, y = 0;
  for (let t = 0; t < 40; t++) {
    x = random(cellW, width - cellW); y = random(cellH, height - cellH);
    const i = Math.max(1, Math.min(NX, Math.round(x / cellW))), j = Math.max(1, Math.min(NY, Math.round(y / cellH)));
    const idx = IX(i, j), h = depthAt(i, j);
    if (h <= 0.05 || h > hClose || solid[idx]) continue;
    const stir = Math.min(1, waveH[idx] / Math.max(breakerGamma * h, 1e-3));
    if (random() < stir) return { x, y };
  }
  return null;
}

function spawnGrain(born) {
  let at = grainStart();
  if (!at) at = { x: random(cellW, width * 0.70), y: random(cellH, height - cellH) };   // no waves: the old spread
  const load = grainLoad();
  stampPick(at.x, at.y, -load);
  return { x: at.x, y: at.y, ox: at.x, oy: at.y, vx: random(0, 0.15) * cellW, vy: random(-0.3, 0.3) * cellH, born, load };
}
function spawnParticle() { return spawnGrain(simTime - random(0, MAX_PARTICLE_AGE)); }
function respawnParticle() { return spawnGrain(simTime); }
// A grain that ages out or leaves the canvas has not settled anywhere: its sand goes back
// where it came from (a grain lifted from a deposit, back to that deposit's place).
function grainLost(p) {
  if (!(p.load > 0)) return;
  const x = p.ox != null ? p.ox : p.x, y = p.oy != null ? p.oy : p.y;
  stampPick(Math.min(width - 1, Math.max(0, x)), Math.min(height - 1, Math.max(0, y)), p.load);
}
function grainWet(p) {
  if (!p) return true;
  const i = Math.max(1, Math.min(NX, Math.round(p.x / cellW))), j = Math.max(1, Math.min(NY, Math.round(p.y / cellH)));
  return depthAt(i, j) > 0.05;
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

  // The wash and the ramp are painted in 8 px blocks; smooth softens them into one wash.
  // The contours below stay sharp.
  if (smoothWash) softenBedSurface();

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


// ─────────────────────────────────────────────
// DRAWING THE WAVES, AND A SOFTER WASH
// ─────────────────────────────────────────────
// The waves toggle draws this model's wave field as moving crests. Height, depth, angle and
// breaking are the model's (waveH, waveDepth, waveAngle, waveBreaking). The crest spacing is the
// wavenumber at each cell's depth, and the phase is added up shoreward along each row from the
// alongshore wavenumber the offshore waves arrive with, so crests close up, turn and break where
// the model says the waves do, and leave a gap where it has no waves (behind a structure, on
// land). They move on the model clock at the peak period, the clock the grains sway on.
let showWaves = true, smoothWash = true;
const CREST_SCALE = 4;                 // px of canvas per pixel of the crest image
let crestPhase = null, crestAmp = null, crestBreak = null, crestCanvas = null, crestImg = null;

function waveCrestField() {
  const N = (NX + 2) * (NY + 2);
  if (!crestPhase || crestPhase.length !== N) {
    crestPhase = new Float32Array(N); crestAmp = new Float32Array(N); crestBreak = new Float32Array(N);
  }
  const T = conditions.Tp;
  const dxm = cellW * (REACH_CROSSSHORE / Math.max(width, 1)), dym = cellH * (REACH_ALONGSHORE / Math.max(height, 1));
  const k0 = wavenumberK(T, Math.max(waveDepth[IX(1, (NY / 2) | 0)] || 5, 0.5));
  const ky = k0 * Math.sin(conditions.dirDeg * Math.PI / 180);
  let hmax = 1e-3;
  for (let j = 0; j <= NY + 1; j++) {
    let ph = ky * j * dym, kp;
    for (let i = 0; i <= NX + 1; i++) {
      const idx = IX(i, j), h = waveDepth[idx], H = waveH[idx];
      if (h > 0.05 && H > 1e-3 && !solid[idx]) {
        const k = wavenumberK(T, h, kp); kp = k;
        ph += k * Math.cos(waveAngle[idx]) * dxm;
        crestAmp[idx] = H; if (H > hmax) hmax = H;
      } else {
        crestAmp[idx] = 0;
        if (solid[idx] && kp) ph += kp * dxm;   // the phase carries through a structure, so crests line up behind it
      }
      crestPhase[idx] = ph; crestBreak[idx] = waveBreaking[idx] ? 1 : 0;
    }
  }
  for (let q = 0; q < N; q++) crestAmp[q] /= hmax;
  return { phase: crestPhase, amp: crestAmp, brk: crestBreak, dxm, dym };
}

function drawWaveCrests() {
  if (!showWaves) return 0;
  waveCrestField();
  const cw = Math.ceil(width / CREST_SCALE), ch = Math.ceil(height / CREST_SCALE);
  if (!crestCanvas || crestCanvas.width !== cw || crestCanvas.height !== ch) {
    crestCanvas = document.createElement('canvas'); crestCanvas.width = cw; crestCanvas.height = ch;
    crestImg = crestCanvas.getContext('2d').createImageData(cw, ch);
  }
  const px = crestImg.data, wt = simTime * 2 * Math.PI / conditions.Tp;
  const sx = CREST_SCALE / cellW, sy = CREST_SCALE / cellH;
  let lit = 0;
  for (let y = 0; y < ch; y++) {
    const fy = y * sy, j0 = Math.min(NY, Math.floor(fy)), ty = fy - j0;
    for (let x = 0; x < cw; x++) {
      const fx = x * sx, i0 = Math.min(NX, Math.floor(fx)), tx = fx - i0;
      const a = IX(i0, j0), b = IX(i0 + 1, j0), c = IX(i0, j0 + 1), d = IX(i0 + 1, j0 + 1);
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const A = crestAmp[a] * w00 + crestAmp[b] * w10 + crestAmp[c] * w01 + crestAmp[d] * w11;
      const o = (y * cw + x) * 4;
      if (A < 0.01) { px[o + 3] = 0; continue; }
      const P = crestPhase[a] * w00 + crestPhase[b] * w10 + crestPhase[c] * w01 + crestPhase[d] * w11;
      const B = crestBreak[a] * w00 + crestBreak[b] * w10 + crestBreak[c] * w01 + crestBreak[d] * w11;
      const cs = Math.cos(P - wt), c1 = cs > 0 ? cs : 0, c2 = c1 * c1, c4 = c2 * c2, crest = c4 * c4 * c1;
      let foam = 0;
      if (B > 0.01) {
        const f = Math.cos(P - wt - 0.5), f1 = f > 0 ? f : 0, sp = Math.sin(x * 12.9898 + y * 78.233 + wt * 3);
        foam = Math.min(1, 0.9 * B * f1 * f1 * f1 * (0.6 + 0.4 * sp * sp));
      }
      const v = Math.min(1, crest * A * 0.6 + 0.1 * A * (0.5 + 0.5 * cs));
      px[o] = 160 + 75 * foam; px[o + 1] = 225 + 20 * foam; px[o + 2] = 235 + 20 * foam;
      px[o + 3] = 255 * Math.min(1, v + foam);
      if (v + foam > 0.3) lit++;
    }
  }
  crestCanvas.getContext('2d').putImageData(crestImg, 0, 0);
  const g = drawingContext;
  g.save(); g.globalCompositeOperation = 'screen'; g.imageSmoothingEnabled = true;
  g.drawImage(crestCanvas, 0, 0, width, height); g.restore();
  return lit;
}

// Blur the blocks of the wash and the dry-beach ramp into one soft layer, in place.
let washScratch = null;
function softenBedSurface() {
  const c = bedSurface && (bedSurface.elt || bedSurface.canvas);
  if (!c || typeof c.getContext !== 'function') return false;
  if (!washScratch) washScratch = document.createElement('canvas');
  washScratch.width = c.width; washScratch.height = c.height;
  const t = washScratch.getContext('2d');
  t.clearRect(0, 0, c.width, c.height);
  t.filter = `blur(${Math.max(3, Math.round(c.width / 220))}px)`;
  t.drawImage(c, 0, 0);
  const g = c.getContext('2d');
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(washScratch, 0, 0); g.restore();
  return true;
}

function coastUpdateToggles() {
  const w = document.getElementById('toggle-waves'), m = document.getElementById('toggle-smooth');
  if (w) w.className = showWaves ? 'tg-on' : 'tg-off';
  if (m) m.className = smoothWash ? 'tg-on' : 'tg-off';
}

registerModel({
  id: 'coast',

  // The coast's steps in the interface's guide (see THE GUIDE in index.html).
  guide: [
    { id: 'coast-view', after: 'toggles', target: ['#toggle-waves', '#toggle-smooth'], title: 'Waves and the wash', text:
      `<p><b>waves</b> draws the wave crests the model works out. They close up as the water gets shallow, bend as they come in at an angle, and turn white where the model has them breaking. Where a groyne or a breakwater stands there is a gap in the crests.</p>
       <p><b>smooth</b> softens the colored wash that shows where the beach has changed. Warm colors show sand building up and blue shows it wearing away. Turn it off to see the cells the model works on.</p>` },
    { id: 'coast', after: 'welcome', title: 'The coast', text:
      `<p>This model is a beach seen from above. The sea is on the left and the land is on the right, with the dune at the far right edge. Waves come in from the left, break as the water gets shallow and run up the beach.</p>
       <p>Time here is model years, and the <b>year</b> line in the numbers counts them. One second on screen stands for days of model time, so you can watch a beach change over seasons and storms. Use it to ask what a groyne, a breakwater or a nourishment does to the shore over years.</p>` },
    { id: 'coast-nourish', after: 'draw', target: guideCanvas, title: 'Nourishment', text:
      `<p>Press <b>4</b> to place a nourishment instead of a solid object. A nourishment is sand added to the beach, the way coastal managers rebuild a shore that is wearing away.</p>
       <p>The waves pass over it rather than around it. While it is in place it adds sand to the ground under it, about half a meter a model year. Watch where the waves take that sand afterwards.</p>` },
    { id: 'coast-waves', after: 'thumb', target: guideSection('reset-coastal', 'coastal-readout'), title: 'Waves and water', text:
      `<p>These are the conditions the beach faces. <b>preset</b> loads a set of them, a calm summer, a winter storm, the recovery after a storm, or SLR 2100, a calm summer with 0.9 meters of sea level rise. Moving any slider switches it back to custom.</p>
       <p><b>Hs</b> is the wave height, the average of the biggest third of the waves. <b>Tp</b> is the time between wave crests. Longer periods are swell from far away, and at the same height they carry more energy. <b>direction</b> is the angle the waves arrive from, where 0 is straight at the shore, and <b>spread</b> is how much that angle varies.</p>
       <p><b>water level</b> is the tide or a storm surge, and <b>SLR</b> is sea level rise added on top. <b>D50</b> is the grain size of the sand in millimeters. Fine sand is about 0.2 and coarse sand about 1. <b>slope</b> is how steep the beach is.</p>
       <p>The blue lines read the result. How high the waves are where they break and how deep the water is there, how far up the beach they run (<b>runup R2</b>), and <b>ξ</b>, which says how they break, spilling gently on a flat beach or plunging and surging on a steep one.</p>` },
    { id: 'coast-morph', after: 'coast-waves', target: guideSection('reset-morph', 'morph-readout'), title: 'How the beach changes', text:
      `<p>This section is the beach changing shape over time. <b>model rate</b> is how many days of model time pass each second, so you can watch years go by in a minute. <b>dune</b> is how much sand the wind adds to the dune each year. <b>longshore</b> is how strongly the waves carry sand along the shore rather than up and down it.</p>
       <p>The orange lines read the change. The most <b>erosion</b> and <b>accretion</b> so far, how stormy the waves are, where they break, and how much sand is moving along the shore.</p>
       <p><b>clear</b> wipes the change and starts the beach again. <b>conv</b> is a check on the model itself. It runs the same stretch of time in smaller steps and reports how much the answer moves. A small number means the size of the step is not what is driving the answer.</p>` },
    { id: 'coast-physics', after: 'coast-morph', target: guideSection('reset-physics', 'erosion-prob'), title: 'Grains', text:
      `<p>These four set how the moving grains you see behave. <b>settle thresh</b> is the speed below which a grain can settle, and <b>settle prob</b> is how likely it is to settle each moment once it is that slow. <b>erode thresh</b> and <b>erode prob</b> are the same for lifting a deposit back up. <b>reset</b> puts them back.</p>` },
  ],

  // The bed is drawn on both sides of still water.
  bed: { zMin: BED_Z_MIN, zMax: BED_Z_MAX, datumLabel: 'still water' },
  defaultBedZ: defaultCoastalBedZ,
  // z is the drawn bed plus deposit; the model adds what the waves have moved.
  bedTotal(z, x, y) { return z + morphZ(x, y) + longZ(x, y) + pickZ(x, y); },
  bedGridsReady() {
    morphGrid = new Float32Array(GW * GH);
    longGrid = new Float32Array(GW * GH);
    pickGrid = new Float32Array(GW * GH);
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
<div class="ctrl-row"><label>dune <span class="val" id="dune-val">10</span> m&sup3;/m/yr</label><input type="range" id="m-dune" min="0" max="30" value="10" step="1"></div>
<div class="ctrl-row"><label>longshore <span class="val" id="ls-val">0.03</span></label><input type="range" id="m-long" min="0" max="0.2" value="0.03" step="0.005"></div>
<div id="morph-readout" style="font-size:9px;color:rgba(255,190,120,0.6);line-height:1.5;margin:4px 0 3px 0;font-variant-numeric:tabular-nums;">
  erosion <span id="ro-er">0.00</span> m &nbsp; accretion <span id="ro-ac">0.00</span> m<br>
  storm <span id="ro-storm">0.00</span> &nbsp; breakpoint <span id="ro-bar">–</span> m<br>
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
    toggles: `<button id="toggle-waves" class="tg-on">waves</button><button id="toggle-smooth" class="tg-on">smooth</button>`,
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
      document.getElementById('m-dune').addEventListener('input', function(){
        duneRate = parseFloat(this.value);
        document.getElementById('dune-val').textContent = duneRate.toFixed(0);
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

      document.getElementById('toggle-waves').addEventListener('click', function () { showWaves = !showWaves; coastUpdateToggles(); });
      document.getElementById('toggle-smooth').addEventListener('click', function () { smoothWash = !smoothWash; updateBedBuffer(); coastUpdateToggles(); });
      coastUpdateToggles();

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
  drawUnderlay: drawWaveCrests,
  updateToggles: coastUpdateToggles,
  // Both toggles are saved with the scene, so the page opens the way it was left.
  viewState() { return { waves: showWaves, smooth: smoothWash }; },
  applyViewState(v) {
    if (typeof v.waves === 'boolean') showWaves = v.waves;
    if (typeof v.smooth === 'boolean') smoothWash = v.smooth;
    coastUpdateToggles();
  },
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
    // A grain puts down the sand it took up (see spawnGrain).
    depositAmount(p) { return p && p.load != null ? p.load : grainLoad(); },
    // Sediment slides on the dry beach only, and gently: under water the waves move it.
    slope(p, gradX, gradY, bedHere) {
      if (bedHere > 0) {
        p.vy += gradY * cellH * 0.15;
        p.vx += gradX * cellW * 0.05;
      }
    },
    // Grains settle in the water only. They used to settle five times as readily on high
    // ground, and stranded grains stopped dead on the dry beach (no flow there) and settled
    // into a ridge along the waterline that the waves could not reach to cut back.
    bedSettleChance(bedHere, settleProb, p) { return grainWet(p) ? settleProb : 0; },
    settleBoost(bedHere, p) { return grainWet(p) ? 1.0 : 0; },
  },
  spawnParticle, respawnParticle,
  particleLost: grainLost,
  // R clears the deposits; the sand the grains took up goes with them.
  restart() { if (pickGrid) pickGrid.fill(0); },
});
