// Headless harness for the Coastal Sediment Interface.
// Takes index.html, extracts the inline script, mocks p5 + the DOM, then:
//   1. seeds the mock controls from the real markup's value="" defaults
//   2. runs setup() and 30 draw() frames
//   3. asserts the wave field is live and the physics responds to its controls
//
//   node dev/headless_harness.js index.html

const fs = require("fs");
const path = require("path");

const HTML = process.argv[2] || "index.html";
const html = fs.readFileSync(HTML, "utf8");

// ---------------------------------------------------------------- defaults from the markup
const DEFAULTS = {};
for (const m of html.matchAll(/id="([^"]+)"[^>]*?value="([^"]*)"/g)) DEFAULTS[m[1]] = m[2];
// select elements carry no value=; take the first option
for (const m of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const opt = m[2].match(/value="([^"]*)"/);
  if (opt && !(m[1] in DEFAULTS)) DEFAULTS[m[1]] = opt[1];
}

// ---------------------------------------------------------------- p5 / DOM mocks
const noop = () => {};
const ctx = () => ({
  background: noop, clear: noop, fill: noop, stroke: noop, noStroke: noop, noFill: noop,
  rect: noop, ellipse: noop, line: noop, circle: noop, text: noop, textSize: noop,
  textAlign: noop, push: noop, pop: noop, translate: noop, rotate: noop, scale: noop,
  image: noop, beginShape: noop, endShape: noop, vertex: noop, strokeWeight: noop,
  point: noop, quad: noop, triangle: noop, arc: noop, curve: noop, bezier: noop,
  curveVertex: noop, bezierVertex: noop, curveTightness: noop, endContour: noop,
  rectMode: noop, ellipseMode: noop, imageMode: noop, angleMode: noop,
  strokeCap: noop, strokeJoin: noop, blendMode: noop, tint: noop, noTint: noop,
  textLeading: noop, textStyle: noop, textWrap: noop,
  rotateX: noop, rotateY: noop, rotateZ: noop, applyMatrix: noop, resetMatrix: noop,
  shearX: noop, shearY: noop, erase: noop, noErase: noop,
  save: noop, restore: noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
  putImageData: noop, drawImage: noop,
  clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
  moveTo: noop, lineTo: noop, arc2: noop, quadraticCurveTo: noop,
  setTransform: noop, resetTransform: noop, transform: noop, clip: noop,
  fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
  createPattern: () => ({}), isPointInPath: () => false,
  fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, font: "10px sans-serif",
  globalAlpha: 1, lineCap: "butt", lineJoin: "miter", globalCompositeOperation: "source-over",
  canvas: { width: 1200, height: 800 },
});

const els = new Map();
function el(id) {
  if (els.has(id)) return els.get(id);
  const e = {
    id, textContent: "", innerHTML: "", checked: false,
    value: id in DEFAULTS ? DEFAULTS[id] : "0",
    width: 200, height: 120, style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop, removeChild: noop,
    getContext: () => ctx(), setAttribute: noop, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 120 }),
    querySelector: () => el(id + "-child"), querySelectorAll: () => [],
    focus: noop, blur: noop, scrollTo: noop,
  };
  els.set(id, e);
  return e;
}

global.window = {
  addEventListener: noop, removeEventListener: noop,
  innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
  location: { href: "http://localhost/", search: "" },
  requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
};
global.document = {
  getElementById: el, createElement: () => el("created"),
  addEventListener: noop, removeEventListener: noop,
  body: el("body"), documentElement: el("html"),
  querySelector: () => el("q"), querySelectorAll: () => [],
};
global.navigator = { userAgent: "node", language: "en" };

let W = 1200, H = 800;
Object.defineProperty(global, "windowWidth",  { get: () => W, set: v => W = v });
Object.defineProperty(global, "windowHeight", { get: () => H, set: v => H = v });
Object.defineProperty(global, "width",        { get: () => W, set: v => W = v });
Object.defineProperty(global, "height",       { get: () => H, set: v => H = v });

Object.assign(global, {
  PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, asin: Math.asin,
  sqrt: Math.sqrt, pow: Math.pow, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, min: Math.min, max: Math.max, exp: Math.exp, log: Math.log,
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  radians: d => d * Math.PI / 180, degrees: r => r * 180 / Math.PI,
  constrain: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => a + (b - a) * t,
  map: (v, a, b, c, d) => c + ((v - a) / ((b - a) || 1)) * (d - c),
  random: (a, b) => (a === undefined ? Math.random() : (b === undefined ? Math.random() * a : a + Math.random() * (b - a))),
  noise: () => 0.5, noiseDetail: noop, randomSeed: noop, frameRate: noop,
  keyIsDown: () => false, key: "", keyCode: 0, mouseIsPressed: false, mouseX: 0, mouseY: 0,
  mouseButton: "left", touches: [], cursor: noop, noCursor: noop,
  mag: (x, y) => Math.hypot(x, y), sq: x => x * x, sign: Math.sign,
  norm: (v, a, b) => (v - a) / ((b - a) || 1), fract: x => x - Math.floor(x),
  int: v => Math.trunc(v), float: v => parseFloat(v),
  red: () => 0, green: () => 0, blue: () => 0, alpha: () => 255,
  color: () => ({ levels: [0, 0, 0, 255] }), lerpColor: () => ({ levels: [0, 0, 0, 255] }),
  // p5 drawing API, at global scope (the app calls these bare, not on a context)
  createCanvas: () => ({ parent: noop, style: {}, elt: el("canvas"), id: () => "c" }),
  pixelDensity: noop, background: noop, noFill: noop, textFont: noop,
  textWidth: () => 10, createGraphics: () => Object.assign(ctx(), { width: W, height: H }),
  loadImage: noop, redraw: noop, frameCount: 0, noLoop: noop, loop: noop,
  resizeCanvas: (w, h) => { W = w; H = h; },
  clear: noop, fill: noop, stroke: noop, noStroke: noop, strokeWeight: noop,
  rect: noop, ellipse: noop, line: noop, circle: noop, point: noop, quad: noop,
  triangle: noop, arc: noop, curve: noop, bezier: noop, image: noop,
  text: noop, textSize: noop, textAlign: noop, textLeading: noop, textStyle: noop,
  push: noop, pop: noop, translate: noop, rotate: noop, scale: noop,
  beginShape: noop, endShape: noop, vertex: noop, curveVertex: noop, bezierVertex: noop,
  curveTightness: noop, endContour: noop, rectMode: noop, ellipseMode: noop,
  imageMode: noop, angleMode: noop, strokeCap: noop, strokeJoin: noop, blendMode: noop,
  tint: noop, noTint: noop, applyMatrix: noop, resetMatrix: noop, shearX: noop, shearY: noop,
  erase: noop, noErase: noop, rotateX: noop, rotateY: noop, rotateZ: noop,
  CENTER: "center", LEFT: "left", RIGHT: "right", TOP: "top", BOTTOM: "bottom",
  BASELINE: "alphabetic", CORNER: "corner", CORNERS: "corners", RADIUS: "radius",
  CLOSE: "close", OPEN: "open", CHORD: "chord", PIE: "pie", PROJECT: "square",
  ROUND: "round", SQUARE: "butt", MITER: "miter", BEVEL: "bevel", RGB: "rgb", HSB: "hsb",
  HSL: "hsl", ADD: "lighter", MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay",
  REPLACE: "source-over", DIFFERENCE: "difference", EXCLUSION: "exclusion",
  UP_ARROW: 38, DOWN_ARROW: 40, LEFT_ARROW: 37, RIGHT_ARROW: 39,
  ENTER: 13, RETURN: 13, ESCAPE: 27, BACKSPACE: 8, DELETE: 46, TAB: 9, SHIFT: 16,
  CONTROL: 17, ALT: 18, OPTION: 18, SPACE: 32,
});
global.p5 = { disableFriendlyErrors: true, prototype: {}, Vector: function () {} };

// ---------------------------------------------------------------- load the app
const m = html.match(/<script>\s*\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error("FAIL: no inline <script> found"); process.exit(1); }
const src = m[1];

try {
  new Function(src + `
;globalThis.__app = {
  setup: typeof setup==='function'?setup:null,
  draw: typeof draw==='function'?draw:null,
  waveFieldStep: typeof waveFieldStep==='function'?waveFieldStep:null,
  getState: () => ({
    comps: typeof waveComponents!=='undefined' ? waveComponents : null,
    cond: typeof conditions!=='undefined' ? conditions : null,
    runup: typeof runupR2!=='undefined' ? runupR2 : null,
    xi: typeof iribarren!=='undefined' ? iribarren : null,
    breakHb: typeof breakHb!=='undefined' ? breakHb : null,
    breakDepth: typeof breakDepth!=='undefined' ? breakDepth : null,
    H: typeof waveH!=='undefined' ? waveH : null,
    D: typeof waveDepth!=='undefined' ? waveDepth : null,
    U: typeof u!=='undefined' ? u : null,
    P: typeof particles!=='undefined' ? particles : null,

    morph: typeof morphGrid!=='undefined' ? morphGrid : null,
    storm: typeof stormNow!=='undefined' ? stormNow : null,
    bar: typeof barDistanceM!=='undefined' ? barDistanceM : null,
  }),
  bedZ: typeof bedZ==='function' ? bedZ : null,
  bedZ0: typeof bedZ0==='function' ? bedZ0 : null,
  morphZFn: typeof morphZ==='function' ? morphZ : null,
  eq: typeof equilibriumZ==='function' ? equilibriumZ : null,
  deanA: typeof deanA==='function' ? deanA : null,
  morphStep: typeof morphologyStep==='function' ? morphologyStep : null,
  updateParticles: typeof updateParticles==='function' ? updateParticles : null,
  tick: (dt) => { if (typeof simTime === 'number') simTime += dt; },
  resetMorph: typeof resetMorphology==='function' ? resetMorphology : null,
  shorelineYPx: typeof shorelineXPx==='function' ? shorelineXPx : null,
  shoreRef: typeof shoreRefAt==='function' ? shoreRefAt : null,
  barDist: typeof computeBarDistance==='function' ? computeBarDistance : null,
  dims: {
    get along() { return typeof REACH_ALONGSHORE !== 'undefined' ? REACH_ALONGSHORE : 400; },
    get cross() { return typeof REACH_CROSSSHORE !== 'undefined' ? REACH_CROSSSHORE : 300; },
    get mpbu()  { return typeof M_PER_BED_UNIT !== 'undefined' ? M_PER_BED_UNIT : 0.05; },
    // GW and GH are assigned in setup(), so these must be live getters, not a snapshot
    get gw()    { return typeof GW !== 'undefined' ? GW : 0; },
    get gh()    { return typeof GH !== 'undefined' ? GH : 0; },
  },
  probeMorphZ: (x, y) => {
    const fx = x / DEPO_CELL - 0.5, fy = y / DEPO_CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    const inb = !(i < 0 || j < 0 || i >= GW - 1 || j >= GH - 1);
    return { DEPO_CELL, GW, GH, fx, fy, i, j, inb,
             a: morphGrid ? morphGrid[j * GW + i] : null,
             d: morphGrid ? morphGrid[(j + 1) * GW + i + 1] : null,
             gridNull: !morphGrid };
  },
  diag: () => {
    const out = {
      enabled: typeof morphEnabled!=='undefined' ? morphEnabled : null,
      len: morphGrid ? morphGrid.length : -1,
      nonzero: 0, nan: 0, cols: 0, shoreNull: 0, shoreFirst: null,
      storm: typeof stormNow!=='undefined' ? stormNow : null,
      bar: typeof barDistanceM!=='undefined' ? barDistanceM : null,
      relaxDays: typeof relaxDays!=='undefined' ? relaxDays : null,
    };
    if (morphGrid) for (let i = 0; i < morphGrid.length; i++) {
      if (!isFinite(morphGrid[i])) out.nan++; else if (morphGrid[i] !== 0) out.nonzero++;
    }
    if (typeof shorelineYPx === 'function' && typeof GW !== 'undefined') {
      for (let gx = 0; gx < GW; gx += 10) {
        out.cols++;
        const s = shorelineYPx(gx);
        if (s === null) out.shoreNull++;
        else if (out.shoreFirst === null) out.shoreFirst = s;
      }
    }
    return out;
  },
};
`)();
} catch (e) {
  console.error("LOAD FAILED:", e.message);
  process.exit(1);
}

const app = globalThis.__app;
if (!app.setup) { console.error("FAIL: no setup()"); process.exit(1); }

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

console.log(`defaults from markup: ${Object.keys(DEFAULTS).length} controls`);

try {
  app.setup();
  console.log("\nsetup() OK");
} catch (e) {
  console.error("SETUP FAILED:", e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}

try {
  if (typeof paused !== "undefined") global.paused = false;
  for (let i = 0; i < 30; i++) app.draw();
  console.log("30 draw() frames OK\n");
} catch (e) {
  console.error("DRAW FAILED:", e.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

const st = app.getState();
console.log("--- physics ---");
console.log(`conditions: Hs=${st.cond.Hs} Tp=${st.cond.Tp} dir=${st.cond.dirDeg} spread=${st.cond.spreadDeg} wl=${st.cond.waterLevel} slope=${st.cond.slope}`);
console.log(`components: ${st.comps.length}`);

let wet = 0, maxH = 0, maxD = 0, sumH = 0, broke = 0;
for (let i = 0; i < st.H.length; i++) {
  if (st.D[i] > 0.05) {
    wet++;
    if (st.H[i] > maxH) maxH = st.H[i];
    if (st.D[i] > maxD) maxD = st.D[i];
    sumH += st.H[i];
    if (st.H[i] >= 0.78 * st.D[i] * 0.97) broke++;
  }
}
console.log(`field: ${wet} wet cells, max depth ${maxD.toFixed(2)} m, max H ${maxH.toFixed(2)} m, mean H ${(sumH / Math.max(wet,1)).toFixed(3)} m`);
console.log(`runup R2 ${st.runup.toFixed(3)} m, Iribarren ${st.xi.toFixed(3)}`);
console.log("");

check(wet > 1000, "wave field populated", `${wet} wet cells`);
check(maxH > 0.1, "wave height non-zero", `max H ${maxH.toFixed(2)} m`);
check(maxH >= st.cond.Hs * 0.9, "shoaling reaches or exceeds offshore Hs", `${maxH.toFixed(2)} vs Hs ${st.cond.Hs}`);
check(maxH <= st.cond.Hs * 2.5, "no runaway shoaling", `${maxH.toFixed(2)} m`);
check(st.runup > 0.05 && st.runup < 3, "Stockdon runup plausible", `${st.runup.toFixed(2)} m`);
check(st.xi > 0, "Iribarren computed", st.xi.toFixed(3));
check(broke > 0, "a breaking zone exists", `${broke} cells`);

// --- responsiveness: the field must respond to its controls
const calm = { hb: st.breakHb, depth: st.breakDepth, runup: st.runup, maxH: maxH };

// 1. a bigger wave must break in deeper water and run up further
st.cond.Hs = 3.4; st.cond.Tp = 12.0;
app.waveFieldStep();
const storm = app.getState();
let stormMaxH = 0;
for (let i = 0; i < storm.H.length; i++) if (storm.H[i] > stormMaxH) stormMaxH = storm.H[i];

console.log("--- storm (Hs 3.4, Tp 12) ---");
console.log(`break ${storm.breakHb.toFixed(2)} m @ ${storm.breakDepth.toFixed(2)} m, runup ${storm.runup.toFixed(2)} m, max H ${stormMaxH.toFixed(2)} m`);

check(storm.breakDepth > calm.depth * 1.05, "storm breaks in deeper water",
      `${storm.breakDepth.toFixed(2)} vs ${calm.depth.toFixed(2)} m`);
check(storm.runup > calm.runup * 1.2, "storm runup exceeds calm",
      `${storm.runup.toFixed(2)} vs ${calm.runup.toFixed(2)} m`);
check(stormMaxH > calm.maxH, "storm field is taller", `${stormMaxH.toFixed(2)} vs ${calm.maxH.toFixed(2)} m`);

// 2. directional spread must expand into components without breaking anything
st.cond.Hs = 1.2; st.cond.Tp = 8.0; st.cond.dirDeg = 0; st.cond.spreadDeg = 15;
app.waveFieldStep();
const spread = app.getState();
const wsum = spread.comps.reduce((a, c) => a + c.weight, 0);
console.log("\n--- spread (15 deg) ---");
console.log(`${spread.comps.length} components, weights sum ${wsum.toFixed(4)}, max H ${Math.max(...Array.from(spread.H)).toFixed(2)} m`);
check(spread.comps.length === 7, "spread expands to 7 components", `${spread.comps.length}`);
check(Math.abs(wsum - 1) < 1e-6, "component weights sum to 1", wsum.toFixed(6));

// 3. oblique approach must reduce the shore-normal energy flux (refraction + cos)
st.cond.dirDeg = 0; st.cond.spreadDeg = 0;
app.waveFieldStep();
const normalMax = Math.max(...Array.from(app.getState().H));
st.cond.dirDeg = 55;
app.waveFieldStep();
const obliqueMax = Math.max(...Array.from(app.getState().H));
console.log("\n--- obliquity (0 vs 55 deg) ---");
console.log(`max H ${normalMax.toFixed(2)} m shore-normal vs ${obliqueMax.toFixed(2)} m oblique`);
check(obliqueMax < normalMax, "oblique approach lowers the tallest wave",
      `${obliqueMax.toFixed(2)} < ${normalMax.toFixed(2)} m`);

// 4. a dry control must not produce NaN anywhere
st.cond.dirDeg = 0; st.cond.Hs = 0.1; st.cond.spreadDeg = 0;
app.waveFieldStep();
const tiny = app.getState();
let nan = 0;
for (let i = 0; i < tiny.H.length; i++) if (!isFinite(tiny.H[i])) nan++;
console.log("\n--- edge case: Hs 0.1 m ---");
console.log(`runup ${tiny.runup.toFixed(3)} m, NaN cells ${nan}`);
check(nan === 0, "no NaN with a small wave", `${nan} bad cells`);

// ============================================================ PHASE 2: morphology
console.log("\n=== morphology ===");
const D = app.dims;
const VIEW_W = 1200, VIEW_H = 800;
const xMPerPx = D.cross / VIEW_W;               // cross-shore metres per pixel
const ROW = 400;                                // a fixed alongshore row, in pixels
const GROW = Math.floor(ROW / 4);               // same row in morph-grid units

const calmCond = () => { st.cond.Hs = 1.2; st.cond.Tp = 8.0; st.cond.waterLevel = 0; st.cond.slope = 0.02; st.cond.d50 = 0.30; };
const stormCond = () => { st.cond.Hs = 3.4; st.cond.Tp = 12.0; st.cond.waterLevel = 0.8; st.cond.slope = 0.02; st.cond.d50 = 0.30; };

function zM(xPx) { return app.bedZ(xPx, ROW) * D.mpbu; }

function meanDeviation() {
  const xS = app.shoreRef(GROW);
  if (xS === null) return NaN;
  const A = app.deanA(st.cond.d50);
  let sum = 0, n = 0;
  for (let x = 4; x < VIEW_W; x += 12) {
    const Y = (xS - x) * xMPerPx;
    if (Y < 8) continue;
    sum += Math.abs(zM(x) - app.eq(Y, app.getState().storm, A));
    n++;
  }
  return n ? sum / n : NaN;
}

const STEP = 86400 * 5;   // 5 model days per call

// --- Gate A: a perturbed profile relaxes toward Dean
calmCond(); app.waveFieldStep(); app.barDist();
app.resetMorph();
for (let i = 0; i < 30; i++) app.morphStep(STEP);          // settle
const devSettled = meanDeviation();

// perturb: raise a band of the offshore profile by 40 bed units (2.0 m)
for (let gx = Math.floor(D.gw * 0.35); gx < Math.floor(D.gw * 0.65); gx++) {
  for (let gy = 0; gy < D.gh; gy++) app.getState().morph[gy * D.gw + gx] += 40;
}
const devPerturbed = meanDeviation();
for (let i = 0; i < 25; i++) app.morphStep(STEP);
const devRelaxed = meanDeviation();

console.log(`Gate A  settled ${devSettled.toFixed(3)} m | perturbed ${devPerturbed.toFixed(3)} m -> relaxed ${devRelaxed.toFixed(3)} m`);
check(devPerturbed > devSettled * 1.5, "perturbation actually perturbs", `${devPerturbed.toFixed(3)} m`);
check(devRelaxed < devPerturbed * 0.75, "profile relaxes back toward Dean",
      `${devRelaxed.toFixed(3)} < ${(devPerturbed * 0.75).toFixed(3)} m`);

// --- Gate B: a storm pulse erodes the upper profile and builds a bar
calmCond(); app.waveFieldStep(); app.barDist();
app.resetMorph();
for (let i = 0; i < 30; i++) app.morphStep(STEP);

const xShore0 = app.shoreRef(GROW);
const upperX = xShore0 + 8 / xMPerPx;           // 8 m landward of the calm waterline
const zUpper0 = zM(upperX);

// The storm bar forms where the STORM breaks, far further out than the calm bar.
stormCond(); app.waveFieldStep(); app.barDist();
const barDistStorm = app.getState().bar;
const barX = xShore0 - barDistStorm / xMPerPx;
const zBar0 = zM(barX);

for (let i = 0; i < 20; i++) app.morphStep(STEP);
const zUpper1 = zM(upperX), zBar1 = zM(barX);
console.log(`Gate B  storm bar ${barDistStorm.toFixed(1)} m offshore, intensity ${app.getState().storm.toFixed(2)}`);
console.log(`        upper profile ${zUpper0.toFixed(2)} -> ${zUpper1.toFixed(2)} m (${(zUpper1 - zUpper0).toFixed(2)})`);
console.log(`        bar crest     ${zBar0.toFixed(2)} -> ${zBar1.toFixed(2)} m (${(zBar1 - zBar0).toFixed(2)})`);

check(app.getState().storm > 0.3, "storm preset registers as a storm", app.getState().storm.toFixed(2));
check(zUpper1 < zUpper0, "storm erodes the upper profile", `${(zUpper1 - zUpper0).toFixed(2)} m`);
check(zBar1 > zBar0, "storm builds a bar at the breakpoint", `${(zBar1 - zBar0).toFixed(2)} m`);

// --- and the bar decays again once the storm passes
calmCond(); app.waveFieldStep(); app.barDist();
for (let i = 0; i < 25; i++) app.morphStep(STEP);
const zBar2 = zM(barX);
console.log(`        after calm ${zBar2.toFixed(2)} m (recovery ${(zBar2 - zBar1).toFixed(2)})`);
check(zBar2 < zBar1, "bar decays after the storm", `${(zBar2 - zBar1).toFixed(2)} m`);

// --- orientation: the waterline must sit in the right third
calmCond(); app.waveFieldStep(); app.barDist();
app.resetMorph();
const xShoreFinal = app.shoreRef(GROW);
const frac = xShoreFinal / VIEW_W;
console.log(`\n=== orientation ===`);
console.log(`waterline at x=${xShoreFinal.toFixed(0)}px (${(frac * 100).toFixed(0)}% of width)`);
check(frac > 0.66 && frac < 0.90, "waterline in the right third", `${(frac * 100).toFixed(0)}%`);

const uField = app.getState().U;
let velCells = 0;
for (let i = 0; i < uField.length; i++) if (isFinite(uField[i]) && uField[i] !== 0) velCells++;
console.log(`velocity field populated in ${velCells} cells`);
check(velCells > 500, "velocity field populated", `${velCells} cells`);

// --- particles must actually travel from the offshore edge toward the shore
console.log(`\n=== particles ===`);
calmCond(); app.waveFieldStep();
{
  const ps = app.getState().P;
  const meanBefore = ps.reduce((a, p) => a + p.x, 0) / ps.length;
  let maxX = 0;
  for (const p of ps) if (p.x > maxX) maxX = p.x;
  const xShore = app.shoreRef(GROW);
  console.log(`${ps.length} particles, mean x ${meanBefore.toFixed(0)} px, max x ${maxX.toFixed(0)} px`);
  console.log(`waterline at ${xShore.toFixed(0)} px`);

  // Spread: particles must cover open water, not sit in a band at the left edge.
  check(meanBefore > 200, "particles spread across the water", `mean x ${meanBefore.toFixed(0)} px`);
  check(maxX > 500, "particles reach the outer surf zone", `max x ${maxX.toFixed(0)} px`);

  // Net flow: average the onshore component over a FULL wave period. A single frame sits
  // at one phase of the oscillation and can legitimately point either way; the drift only
  // shows up when the cycle averages out.
  let acc = 0, cnt = 0;
  const steps = 24, dtPer = st.cond.Tp / steps;
  for (let k = 0; k < steps; k++) {
    app.tick(dtPer);
    app.waveFieldStep();
    const uf = app.getState().U;
    for (let i = 0; i < uf.length; i++) if (isFinite(uf[i]) && uf[i] !== 0) { acc += uf[i]; cnt++; }
  }
  const meanU = acc / cnt;
  console.log(`period-averaged onshore component ${meanU.toFixed(3)} cells/frame over ${cnt} samples`);
  check(meanU > 0, "net flow is onshore", `${meanU.toFixed(3)} cells/frame`);
}

console.log("");
if (failures === 0) console.log("HARNESS PASS");
else { console.log(`HARNESS FAIL — ${failures} check(s)`); process.exit(1); }
