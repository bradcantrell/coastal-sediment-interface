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


// ============================================================ software rasterizer (PRECISION=1)
function makeRaster(w, h) {
  const buf = new Float32Array(w * h * 4);          // RGBA, 0..255, source-over composited
  let fillCol = [0, 0, 0, 255], strokeCol = [0, 0, 0, 255];
  let doFill = true, doStroke = true;

  const norm = (a) => {
    if (a.length === 1) return [a[0], a[0], a[0], 255];
    if (a.length === 2) return [a[0], a[0], a[0], a[1]];
    if (a.length === 3) return [a[0], a[1], a[2], 255];
    return [a[0], a[1], a[2], a[3]];
  };

  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = ((y | 0) * w + (x | 0)) * 4;
    const a = c[3] / 255;
    if (a <= 0) return;
    buf[i]     = buf[i]     * (1 - a) + c[0] * a;
    buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
    buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
    buf[i + 3] = Math.min(255, buf[i + 3] + c[3]);
  };

  const g = {
    width: w, height: h, _buf: buf,
    clear() { buf.fill(0); },
    background(...a) { const c = norm(a); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, c); },
    fill(...a) { fillCol = norm(a); doFill = true; },
    noFill() { doFill = false; },
    stroke(...a) { strokeCol = norm(a); doStroke = true; },
    noStroke() { doStroke = false; },
    strokeWeight() {},
    rect(x, y, ww, hh) {
      if (!doFill) return;
      const x0 = Math.round(x), y0 = Math.round(y);
      const x1 = Math.round(x + ww), y1 = Math.round(y + hh);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(xx, yy, fillCol);
    },
    point(x, y) { if (doStroke) px(Math.round(x), Math.round(y), strokeCol); },
    ellipse(x, y, d) { if (doFill) px(Math.round(x), Math.round(y), fillCol); },
    line(x1, y1, x2, y2) { if (doStroke) { px(x1, y1, strokeCol); px(x2, y2, strokeCol); } },
    push() {}, pop() {}, translate() {}, rotate() {}, scale() {},
    image() {}, text() {}, textAlign() {}, textSize() {}, triangle() {}, quad() {},
    beginShape() {}, endShape() {}, vertex() {}, bezier() {}, arc() {}, curve() {},
    loadPixels() {}, updatePixels() {},
  };
  return g;
}

globalThis.__rasters = [];

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
  // Under PRECISION the RNG must be seeded: particle deposition is random, and an unstable
  // bed makes a rendering comparison measure noise instead of the code change.
  random: (() => {
    let seed = 12345;
    const rnd = () => {
      if (process.env.PRECISION || process.env.SCORE) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
      return Math.random();
    };
    return (a, b) => (a === undefined ? rnd() : (b === undefined ? rnd() * a : a + rnd() * (b - a)));
  })(),
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
  textWidth: () => 10,
  createGraphics: (w, h) => {
    if (process.env.PRECISION) {
      const g = makeRaster(w || W, h || H);
      globalThis.__rasters.push(g);
      return g;
    }
    return Object.assign(ctx(), { width: W, height: H });
  },
  loadImage: noop, redraw: noop, frameCount: 0, noLoop: noop, loop: noop,
  resizeCanvas: (w, h) => { W = w; H = h; },
  clear: noop, fill: noop, stroke: noop, noStroke: noop, strokeWeight: noop,
  rect: noop, ellipse: noop, line: noop, circle: noop, point: noop, quad: noop,
  triangle: noop, arc: noop, curve: noop, bezier: noop, image: noop,
  text: noop, textSize: noop, textAlign: noop, textLeading: noop, textStyle: noop,
  push: noop, pop: noop, translate: noop, rotate: noop, scale: noop,
  // drawGhost() styles the 2D context directly for shadow effects; the mock needs one.
  // drawGhost() and friends drive the 2D context directly. A Proxy no-ops any method and
  // stores any property, so the mock does not need to enumerate the canvas API.
  drawingContext: new Proxy({ shadowBlur: 0, shadowColor: "", globalAlpha: 1,
                              globalCompositeOperation: "source-over",
                              canvas: { width: 1200, height: 800 } }, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  }),
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
  computeBarDist: typeof computeBarDistance==='function'?computeBarDistance:null,
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
    qPeak: typeof qPeak!=='undefined' ? qPeak : null,
    qMean: typeof qMean!=='undefined' ? qMean : null,
    qLong: typeof qLong!=='undefined' ? qLong : null,
    longGrid: typeof longGrid!=='undefined' ? longGrid : null,
    modelYears: typeof modelYears!=='undefined' ? modelYears : null,
    solid: typeof solid!=='undefined' ? solid : null,
    loopTime: typeof timelineLoopTime==='function' ? timelineLoopTime() : null,
    activeCount: typeof obstacles!=='undefined'
      ? obstacles.filter(o => isObstacleActive(o)).length : null,

    morph: typeof morphGrid!=='undefined' ? morphGrid : null,
    gw: typeof GW!=='undefined' ? GW : null,
    gh: typeof GH!=='undefined' ? GH : null,
    storm: typeof stormNow!=='undefined' ? stormNow : null,
    bar: typeof barDistanceM!=='undefined' ? barDistanceM : null,
  }),
  bedZ: typeof bedZ==='function' ? bedZ : null,
  bedZ0: typeof bedZ0==='function' ? bedZ0 : null,
  morphZFn: typeof morphZ==='function' ? morphZ : null,
  eq: typeof equilibriumZ==='function' ? equilibriumZ : null,
  deanA: typeof deanA==='function' ? deanA : null,
  morphStep: typeof morphologyStep==='function' ? morphologyStep : null,
  convergenceProbe: typeof convergenceProbe==='function' ? convergenceProbe : null,
  convVerdict: typeof convVerdict==='function' ? convVerdict : null,
  computeLongshore: typeof computeLongshore==='function' ? computeLongshore : null,
  applyLongshore: typeof applyLongshore==='function' ? applyLongshore : null,
  applyNourishment: typeof applyNourishment==='function' ? applyNourishment : null,
  buildXBeach: typeof buildXBeach==='function' ? buildXBeach : null,
  zipStore: typeof zipStore==='function' ? zipStore : null,
  dirToNautical: typeof dirToNautical==='function' ? dirToNautical : null,
  spreadToS: typeof spreadToS==='function' ? spreadToS : null,
  xbBedAt: typeof xbBedAt==='function' ? xbBedAt : null,
  cond: typeof conditions!=='undefined' ? conditions : null,
  setYear: (y) => { if (typeof modelYears === 'number') modelYears = y; },
  longshoreStats: typeof longshoreStats==='function' ? longshoreStats : null,
  longZFn: typeof longZ==='function' ? longZ : null,
  buildSolid: typeof buildSolidMask==='function' ? buildSolidMask : null,
  obstacles: typeof obstacles!=='undefined' ? obstacles : null,
  updateParticles: typeof updateParticles==='function' ? updateParticles : null,
  tick: (dt) => { if (typeof simTime === 'number') simTime += dt; },
  // rendering/draw internals, for the frame profile
  rDrawFlow: typeof drawFlowField==='function'?drawFlowField:null,
  rSpot: typeof drawSpotElevations==='function'?drawSpotElevations:null,
  rParticles: typeof drawParticles==='function'?drawParticles:null,
  rObstacles: typeof drawObstacles==='function'?drawObstacles:null,
  rBedProfile: typeof drawBedProfile==='function'?drawBedProfile:null,
  rGhost: typeof drawGhost==='function'?drawGhost:null,
  rTimeline: typeof drawTimeline==='function'?drawTimeline:null,
  rDeposition: typeof drawDeposition==='function'?drawDeposition:null,
  rParticlesToBuffer: typeof drawParticlesToBuffer==='function'?drawParticlesToBuffer:null,
  rUpdateBedBuffer: typeof updateBedBuffer==='function'?updateBedBuffer:null,
  rRedrawDepo: typeof redrawDepoBuffer==='function'?redrawDepoBuffer:null,
  rApplyLong: typeof applyLongshore==='function'?applyLongshore:null,
  rApplyNourish: typeof applyNourishment==='function'?applyNourishment:null,
  rBarDist: typeof computeBarDistance==='function'?computeBarDistance:null,
  bedSurfaceRef: () => (typeof bedSurface !== 'undefined' ? bedSurface : null),
  // grid probes for the precision scorer
  gridDims: () => ({ NX, NY, GW, GH }),
  groupVel: (T, h) => groupVelocity(T, h),
  waveAt: (i, j) => ({ H: waveH[IX(i, j)], depth: waveDepth[IX(i, j)],
                       breaking: waveBreaking[IX(i, j)] ? 1 : 0 }),
  bedAtIJ: (i, j) => bedZ(i * cellW, j * cellH) * M_PER_BED_UNIT,
  setPaused: (v) => { if (typeof paused !== 'undefined') paused = v; },
  isPaused: () => (typeof paused !== 'undefined' ? paused : null),
  setPaused: (v) => { if (typeof paused !== 'undefined') paused = v; },
  resetMorph: typeof resetMorphology==='function' ? resetMorphology : null,
  shorelineYPx: typeof shorelineXPx==='function' ? shorelineXPx : null,
  shoreRef: typeof shoreRefAt==='function' ? shoreRefAt : null,
  // The long-profile strip mapping. Exposed so the harness can assert that a drawn transect
  // can reach below still water, which is the difference between a sea and a dry slope.
  bedStripZ: typeof bedStripZ==='function' ? bedStripZ : null,
  bedStripY: typeof bedStripY==='function' ? bedStripY : null,
  initParticles: typeof initParticles === 'function' ? initParticles : null,
  barDistM: () => (typeof barDistanceM !== 'undefined' ? barDistanceM : null),
  deposited: () => (typeof deposited !== 'undefined' ? deposited : null),
  setBedMode: (v) => { if (typeof bedMode !== 'undefined') bedMode = v; },
  toggleBedMode: typeof toggleBedMode === 'function' ? toggleBedMode : null,
  isPaused: () => (typeof paused !== 'undefined' ? paused : null),
  setBedPoints: (pts) => {
    if (typeof bedPoints === 'undefined') return false;
    bedPoints.length = 0;
    for (const q of pts) bedPoints.push({ x: q.x, z: q.z });
    bedPoints.sort((a, b) => a.x - b.x);
    if (typeof rebuildUserBedGrid === 'function') rebuildUserBedGrid();
    return true;
  },
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
// ---------------------------------------------------------------- interior convergence
// All dt-sensitivity sat on gy = GH-1, the off-canvas outer row of the morph grid, where
// bedZ() clamps to the row above. That row cannot feed back into the physics, so it is an
// artefact, not a convergence failure. Measure the interior separately.

app.setup();
const st0 = app.getState();
st0.cond.Hs = 3.4; st0.cond.Tp = 12.0; st0.cond.waterLevel = 0.8;
st0.cond.slope = 0.02; st0.cond.d50 = 0.30;
app.waveFieldStep();
for (let i = 0; i < 6; i++) app.morphStep(900);

const st = app.getState();
const GW = st.gw, GH = st.gh;
const M_PER_UNIT = 0.05;
const snap = Float32Array.from(st.morph);

function runAt(dt, n) {
  st.morph.set(snap);
  for (let k = 0; k < n; k++) app.morphStep(dt);
  return Float32Array.from(st.morph);
}

const dt = (16.7 / 1000) * 2.0 * 86400;

function compare(ny, nx) {
  const A = runAt(dt, 12);
  const B = runAt(dt / 2, 24);
  st.morph.set(snap);
  let sum = 0, max = 0, n = 0, over05 = 0, over1 = 0;
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const k = gy * GW + gx;
      const d = Math.abs(B[k] - A[k]) * M_PER_UNIT;
      sum += d; n++;
      if (d > max) max = d;
      if (d > 0.5) over05++;
      if (d > 1.0) over1++;
    }
  }
  return { cells: n, meanM: +(sum / n).toFixed(5), maxM: +max.toFixed(3),
           cellsOver0_5m: over05, cellsOver1m: over1 };
}

console.log(JSON.stringify({
  dtHours: +(dt / 3600).toFixed(2),
  grid: GW + 'x' + GH,
  full:    compare(GH,     GW),
  noLastRow: compare(GH - 1, GW),
  interior:  compare(GH - 1, GW - 1),
}, null, 1));
