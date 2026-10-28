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
    WB: typeof waveBreaking!=='undefined' ? waveBreaking : null,
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
    storm: typeof stormNow!=='undefined' ? stormNow : null,
    bar: typeof barDistanceM!=='undefined' ? barDistanceM : null,
  }),
  bedZ: typeof bedZ==='function' ? bedZ : null,
  bedZ0: typeof bedZ0==='function' ? bedZ0 : null,
  morphZFn: typeof morphZ==='function' ? morphZ : null,
  eq: typeof equilibriumZ==='function' ? equilibriumZ : null,
  deanA: typeof deanA==='function' ? deanA : null,
  morphStep: typeof morphologyStep==='function' ? morphologyStep : null,
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

// Forcing cases, hoisted above every block that scores or exports them.
const STORM_COND = { Hs: 3.4, Tp: 12.0, dirDeg: -28, spreadDeg: 18,
                     waterLevel: 0.8, slr: 0, d50: 0.30, slope: 0.020 };
// Moderate-energy companion case: half the wave height, shorter period, weaker surge. If the
// bar calibration has generalised it should still hold here; if it learned one storm it will not.
const CASE2_COND = { Hs: 2.0, Tp: 9.0, dirDeg: -15, spreadDeg: 10,
                     waterLevel: 0.3, slr: 0, d50: 0.30, slope: 0.020 };

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
  // paused is module-scoped (let paused = true at load), so global.paused never reached it.
  // Every prior harness run therefore exercised only the paused render path, never the
  // simulation path, and per-frame cost was invisible.
  app.setPaused(false);
  if (app.isPaused() !== false) { console.error("could not unpause the app"); process.exit(1); }
  app.setPaused(true);
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
const sumMorph = () => {
  const m = app.getState().morph;
  let t = 0;
  for (let i = 0; i < m.length; i++) t += m[i];
  return t;
};
const volPerturbed = sumMorph();
for (let i = 0; i < 25; i++) app.morphStep(STEP);
const devRelaxed = meanDeviation();
const volRelaxed = sumMorph();

console.log(`Gate A  settled ${devSettled.toFixed(3)} m | perturbed ${devPerturbed.toFixed(3)} m -> relaxed ${devRelaxed.toFixed(3)} m`);
console.log(`        volume ${volPerturbed.toFixed(1)} -> ${volRelaxed.toFixed(1)} bed units`);
check(devPerturbed > devSettled * 1.5, "perturbation actually perturbs", `${devPerturbed.toFixed(3)} m`);
check(devRelaxed < devPerturbed, "profile relaxes toward Dean",
      `${devRelaxed.toFixed(3)} < ${devPerturbed.toFixed(3)} m`);
// The old relaxation pulled every cell toward its target independently and quietly created
// or destroyed sand. Diffusion conserves it, so this is the check that could not exist before.
const volErr = Math.abs(volRelaxed - volPerturbed) / Math.max(Math.abs(volPerturbed), 1);
check(volErr < 0.02, "cross-shore transport conserves volume", `${(volErr * 100).toFixed(2)}% drift`);

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
{
  // Is the model breaking where its own profile says it should? depth = wl - bedZ.
  const wl = app.getState().cond.waterLevel;
  const pxPerM = D.cross / width;              // metres -> pixels is /pxPerM
  const xSh = app.shoreRef(GROW);
  const rows = [20, 40, 60, 80, 120, 159, 200].map(Ym => {
    const px = xSh - Ym / pxPerM;
    const z = app.bedZ(px, GROW * 4 + 2) * D.mpbu;
    return `${Ym}m: h=${(wl - z).toFixed(2)}`;
  });
  console.log(`        depth vs offshore distance: ${rows.join('  ')}`);
  console.log(`        xShore px=${xSh.toFixed(1)} pxPerM=${pxPerM.toFixed(3)} wl=${wl}`);
}
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

// ============================================================ PHASE 3: longshore
console.log("\n=== longshore ===");
const setDir = (d) => { st.cond.dirDeg = d; app.waveFieldStep(); app.computeLongshore(); };

// --- Gate C: transport zero at shore-normal, peaking near 45 degrees
setDir(0);
const qNormal = app.getState().qPeak;
console.log(`shore-normal: peak Q ${qNormal.toFixed(6)} m3/s`);
check(Math.abs(qNormal) < 1e-4, "Q is zero at shore-normal", qNormal.toFixed(6));

const sweep = [];
for (let d = 0; d <= 85; d += 5) { setDir(d); sweep.push([d, app.getState().qPeak]); }
const best = sweep.reduce((a, b) => (b[1] > a[1] ? b : a));
console.log("angle sweep (deg: peak Q m3/s):", sweep.map(([d, q]) => `${d}:${q.toFixed(4)}`).join("  "));
check(Math.abs(best[0] - 45) <= 10, "Q peaks near 45 deg", `peak at ${best[0]} deg`);

// --- transport reverses with the approach direction
setDir(30);  const qPos = app.getState().qMean;
setDir(-30); const qNeg = app.getState().qMean;
console.log(`dir +30 -> mean Q ${qPos.toFixed(5)}; dir -30 -> ${qNeg.toFixed(5)} m3/s`);
check(qPos > 0 && qNeg < 0, "transport reverses with direction",
      `${qPos.toFixed(5)} vs ${qNeg.toFixed(5)}`);

// --- a uniform shore produces no alongshore bed change
setDir(30);
app.resetMorph();
for (let k = 0; k < 3; k++) { app.computeLongshore(); app.applyLongshore(3600); }
{
  const ls = app.longshoreStats();
  console.log(`uniform shore: min ${ls.min.toFixed(4)} m, max ${ls.max.toFixed(4)} m`);
  check(Math.abs(ls.min) < 0.02 && Math.abs(ls.max) < 0.02,
        "uniform transport leaves the bed alone", `${ls.min.toFixed(4)} .. ${ls.max.toFixed(4)} m`);
}

// --- Gate D: a groyne accretes updrift and erodes downdrift
app.resetMorph();
const GROYNE_Y = 400;
app.obstacles.push({ type: 'rect', x: 760, y: GROYNE_Y, w: 420, h: 24, rotation: 0,
                     clips: [{ start: 0, dur: 10000 }] });   // dur >= loop => always active
setDir(30);
for (let k = 0; k < 10; k++) { app.computeLongshore(); app.applyLongshore(3600); }
{
  // Measure over the whole updrift and downdrift halves rather than a single pixel: the
  // fillet is a band, and picking one sample point tests the sampling, not the physics.
  const lg = app.getState().longGrid;
  let up = 0, upN = 0, dn = 0, dnN = 0;
  for (let gy = 0; gy < D.gh; gy++) {
    const yy = (gy + 0.5) * 4;
    for (let gx = 0; gx < D.gw; gx++) {
      const v = lg[gy * D.gw + gx] * D.mpbu;
      if (Math.abs(v) < 1e-6) continue;
      if (yy < GROYNE_Y - 12) { up += v; upN++; }
      else if (yy > GROYNE_Y + 12) { dn += v; dnN++; }
    }
  }
  const upMean = upN ? up / upN : 0;
  const dnMean = dnN ? dn / dnN : 0;
  const ls2 = app.longshoreStats();
  console.log(`groyne stats: min ${ls2.min.toFixed(3)} max ${ls2.max.toFixed(3)} m`);
  console.log(`  updrift mean ${upMean.toFixed(4)} m over ${upN} cells; downdrift mean ${dnMean.toFixed(4)} m over ${dnN} cells`);
  check(upMean > 0.0005, "groyne accretes updrift", `${upMean.toFixed(4)} m`);
  check(dnMean < -0.0005, "groyne erodes downdrift", `${dnMean.toFixed(4)} m`);
}

// remove the test groyne so nothing downstream sees it
app.obstacles.pop();
app.buildSolid();
app.resetMorph();

// ============================================================ PHASE 4: timeline objects
console.log("\n=== timeline (model years) ===");

// The clock must be model years, and the timeline must read it.
app.setYear(7.5);
const loopAt7 = app.getState().loopTime;
app.setYear(23.0);
const loopAt23 = app.getState().loopTime;
console.log(`year 7.5 -> loop time ${loopAt7.toFixed(1)}; year 23.0 -> ${loopAt23.toFixed(1)} (loop 20 yr)`);
check(Math.abs(loopAt7 - 7.5) < 0.01, "loop tracks model years", `${loopAt7.toFixed(1)}`);
check(Math.abs(loopAt23 - 3.0) < 0.01, "loop wraps at the loop length", `${loopAt23.toFixed(1)}`);

// --- Gate E: an object clipped to a later year does nothing until that year
app.resetMorph();
app.obstacles.length = 0;
app.obstacles.push({ type: 'rect', x: 760, y: 400, w: 420, h: 24, rotation: 0,
                     clips: [{ start: 10, dur: 6 }] });   // groyne appears in year 10

setDir(30);
const meanLongshore = () => {
  const lg = app.getState().longGrid;
  let sum = 0;
  for (let i = 0; i < lg.length; i++) sum += Math.abs(lg[i]);
  return sum * D.mpbu;   // total |change|: conservative transport nets to zero by design
};

app.setYear(5);            // before the clip
app.buildSolid();
app.waveFieldStep();
for (let k = 0; k < 8; k++) { app.computeLongshore(); app.applyLongshore(3600); }
const beforeClip = meanLongshore();
const activeBefore = app.getState().activeCount;

app.setYear(13);           // inside the clip
app.buildSolid();
app.waveFieldStep();
for (let k = 0; k < 8; k++) { app.computeLongshore(); app.applyLongshore(3600); }
const afterClip = meanLongshore() - beforeClip;
const activeAfter = app.getState().activeCount;

console.log(`year 5: ${activeBefore} active, net longshore volume ${beforeClip.toFixed(4)}`);
console.log(`year 13: ${activeAfter} active, added ${afterClip.toFixed(4)}`);
check(activeBefore === 0, "object inactive before its clip", `${activeBefore} active`);
check(activeAfter === 1, "object active inside its clip", `${activeAfter} active`);
check(Math.abs(beforeClip) < 0.01, "no bed response before the clip", beforeClip.toFixed(4));
check(Math.abs(afterClip) > 0.01, "bed responds once the clip opens", afterClip.toFixed(4));

// --- object vocabulary: nourishment adds sand, and is not solid
app.obstacles.length = 0;
app.obstacles.push({ type: 'rect', kind: 'nourish', x: 820, y: 400, w: 120, h: 80,
                     rotation: 0, clips: [{ start: 0, dur: 10000 }] });
app.buildSolid();
const solidUnderNourish = (() => {
  let n = 0;
  for (let i = 0; i < app.getState().solid.length; i++) if (app.getState().solid[i]) n++;
  return n;
})();
app.resetMorph();
const zBefore = app.bedZ(820, 400) * D.mpbu;
for (let k = 0; k < 10; k++) app.applyNourishment(365 * 86400);   // 10 model years
const zAfter = app.bedZ(820, 400) * D.mpbu;
console.log(`nourishment: solid cells ${solidUnderNourish}, bed ${zBefore.toFixed(2)} -> ${zAfter.toFixed(2)} m`);
check(solidUnderNourish === 0, "nourishment is sand, not concrete", `${solidUnderNourish} solid cells`);
check(zAfter > zBefore + 1.0, "nourishment raises the bed", `+${(zAfter - zBefore).toFixed(2)} m`);

app.obstacles.length = 0;
app.buildSolid();
app.resetMorph();

// ============================================================ PHASE 5: XBeach export
console.log("\n=== xbeach export ===");
{
  const xb = app.buildXBeach({ hours: 6, morfac: 10 });
  const P = {};
  for (const line of xb.params.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith('%') || !t.includes('=')) continue;
    const k = t.split('=')[0].trim().toLowerCase();
    const v = t.split('=').slice(1).join('=').trim();
    P[k] = v;
  }
  console.log(`params.txt: ${xb.params.split("\n").length} lines, ${Object.keys(P).length} keywords`);

  // ---- required keywords present, per the manual
  const required = ['depfile','posdwn','nx','ny','dx','dy','tstop','instat','bcfile','zs0',
                    'D50'.toLowerCase(),'rhos','por','ngd','morfac','morphology','outputformat'];
  const missing = required.filter(k => !(k in P));
  check(missing.length === 0, "all required keywords present", missing.length ? "missing " + missing.join(",") : "17 present");

  // ---- orientations and units that are easy to get backwards
  check(P.posdwn === '-1', "bed written positive up", `posdwn = ${P.posdwn}`);
  const d50 = parseFloat(P['d50']);
  const d50Expected = app.cond.d50 / 1000;
  console.log(`D50: app ${app.cond.d50} mm -> params ${d50} m`);
  check(Math.abs(d50 - d50Expected) < 1e-9, "D50 converted mm to m", `${d50} m`);

  // ---- bed.dep shape and content
  const rows = xb.bed.trim().split("\n").map(r => r.trim().split(/\s+/));
  const nx = parseInt(P.nx, 10), ny = parseInt(P.ny, 10);
  console.log(`bed.dep: ${rows.length} rows x ${rows[0].length} cols (expect ${ny + 1} x ${nx + 1})`);
  check(rows.length === ny + 1, "bed.dep row count", `${rows.length}`);
  check(rows.every(r => r.length === nx + 1), "bed.dep column count", `${rows[0].length}`);

  let bad = 0;
  const flat = [];
  for (const r of rows) for (const v of r) { const z = parseFloat(v); if (!isFinite(z)) bad++; flat.push(z); }
  check(bad === 0, "bed values all finite", `${bad} bad`);

  const offshoreZ = flat[0];                       // i=0, j=0
  const landZ = flat[nx];                          // i=nx, j=0
  console.log(`profile: offshore ${offshoreZ.toFixed(2)} m, landward ${landZ.toFixed(2)} m`);
  check(offshoreZ < -2, "offshore end is below datum", `${offshoreZ.toFixed(2)} m`);
  check(landZ > 1, "landward end is above datum", `${landZ.toFixed(2)} m`);

  // ---- the exported bed must match the browser at the same physical point.
  // Independent of xbBedAt: recompute from bedZ by hand, so an axis or unit slip shows.
  let worst = 0;
  for (const [i, j] of [[0,0],[24,10],[60,20],[96,30],[120,40]]) {
    const xm = i * (300 / nx), ym = j * (400 / ny);
    const want = app.bedZ(xm * (width / 300), ym * (height / 400)) * D.mpbu;
    const got = parseFloat(rows[j][i]);
    worst = Math.max(worst, Math.abs(want - got));
  }
  console.log(`bed round-trip: worst |browser - exported| = ${worst.toFixed(4)} m`);
  check(worst < 0.01, "exported bed matches the browser", `${worst.toFixed(4)} m`);

  // ---- JONSWAP file
  const J = {};
  for (const line of xb.jonswap.split("\n")) {
    const t = line.trim();
    if (!t || !t.includes('=')) continue;
    J[t.split('=')[0].trim().toLowerCase()] = parseFloat(t.split('=')[1]);
  }
  console.log(`jonswap: Hm0 ${J.hm0}, Tp ${J.tp}, mainang ${J.mainang}, s ${J.s}`);
  check(Math.abs(J.hm0 - app.cond.Hs) < 1e-6, "Hm0 matches the interface", `${J.hm0} m`);
  check(Math.abs(J.tp - app.cond.Tp) < 1e-6, "Tp matches the interface", `${J.tp} s`);
  check(J.mainang >= 180 && J.mainang <= 360, "mainang inside the documented range", `${J.mainang}`);
  check(J.s >= 1 && J.s <= 1000, "spreading s inside the documented range", `${J.s}`);
  const fp = 1 / J.tp;
  check(fp >= 0.0625 && fp <= 0.4, "peak frequency inside the documented range", `${fp.toFixed(4)} 1/s`);

  // ---- angle mapping, both directions
  const a0 = app.dirToNautical(0), a30 = app.dirToNautical(30), am30 = app.dirToNautical(-30);
  console.log(`dir 0 -> ${a0}, dir +30 -> ${a30}, dir -30 -> ${am30} (nautical)`);
  check(a0 === 270, "shore-normal is 270 nautical", `${a0}`);
  check(a30 === 240 && am30 === 300, "oblique angles map symmetrically", `${a30} / ${am30}`);

  // ---- the ZIP is a real ZIP: signature, entry count, CRCs
  const enc = new TextEncoder();
  const zip = app.zipStore([
    { name: 'params.txt',  data: enc.encode(xb.params) },
    { name: 'bed.dep',     data: enc.encode(xb.bed) },
    { name: 'jonswap.txt', data: enc.encode(xb.jonswap) },
  ]);
  const dvz = new DataView(zip.buffer);
  const sig = dvz.getUint32(0, true);
  const eocdPos = zip.length - 22;
  const entries = dvz.getUint16(eocdPos + 10, true);
  const cdOffset = dvz.getUint32(eocdPos + 16, true);
  console.log(`zip: ${(zip.length / 1024).toFixed(1)} KB, signature 0x${sig.toString(16)}, ${entries} entries`);
  check(sig === 0x04034b50, "zip starts with a local file header", `0x${sig.toString(16)}`);
  check(entries === 3, "zip holds three files", `${entries}`);
  check(cdOffset > 0 && cdOffset < zip.length, "central directory offset is sane", `${cdOffset}`);

  // CRC of the first entry must match a recomputed CRC of params.txt
  const cNameLen = dvz.getUint16(26, true), cDataLen = dvz.getUint32(18, true);
  const cStored = dvz.getUint32(14, true);
  const dataStart = 30 + cNameLen;
  let c = 0xFFFFFFFF;
  const TBL = (() => { const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let x = n;
      for (let k = 0; k < 8; k++) x = (x & 1) ? (0xEDB88320 ^ (x >>> 1)) : (x >>> 1);
      t[n] = x >>> 0; } return t; })();
  for (let i = dataStart; i < dataStart + cDataLen; i++) c = TBL[(c ^ zip[i]) & 0xFF] ^ (c >>> 8);
  c = (c ^ 0xFFFFFFFF) >>> 0;
  check(c === cStored, "zip entry CRC is correct", `0x${c.toString(16)}`);

  if (process.env.XB_DUMP) {
    require('fs').writeFileSync(process.env.XB_DUMP, Buffer.from(zip));
    console.log(`wrote ${process.env.XB_DUMP}`);
  }
}

// ============================================================ the simulation actually runs
{
  app.setPaused(false);
  const frames = 60;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < frames; i++) app.draw();
  const msPerFrame = Number(process.hrtime.bigint() - t0) / 1e6 / frames;
  app.setPaused(true);

  const st = app.getState();
  let badBed = 0;
  for (let i = 0; i < st.morph.length; i++) if (!isFinite(st.morph[i])) badBed++;
  let badQ = 0;
  for (let i = 0; i < st.qLong.length; i++) if (!isFinite(st.qLong[i])) badQ++;
  const finiteH = Array.prototype.every.call(st.H, isFinite);

  console.log(`sim: ${frames} unpaused frames, ${msPerFrame.toFixed(2)} ms/frame ` +
              `(${(1000 / msPerFrame).toFixed(0)} fps), bed ${badBed} non-finite, q ${badQ}, H finite ${finiteH}`);
  check(badBed === 0, "bed stays finite while the simulation runs", `${badBed} cells`);
  check(badQ === 0, "longshore flux stays finite", `${badQ} cells`);
  check(finiteH, "wave field stays finite", "all cells");
  // A regression tripwire, not a claim of 60 fps. The recorded cost after the swarm fixes is
  // ~38 ms. Reaching 16.67 would need a coarser morphology grid or a slower model time --
  // a fidelity trade, not an optimisation, so it is left as a decision rather than assumed.
  check(msPerFrame < 46, "frame time no worse than the recorded 38 ms", `${msPerFrame.toFixed(2)} ms`);
}

// ============================================================ precision dump
if (process.env.PRECISION_DUMP) {
  const fs = require('fs');
  app.resetMorph();
  // Particle deposition is random, so it must be cleared or the dump differs run to run and
  // the metric measures noise instead of the code change.
  if (typeof depoGrid !== "undefined" && depoGrid) depoGrid.fill(0);
  if (typeof particles !== "undefined" && particles) particles.length = 0;
  for (let i = 0; i < 4; i++) app.morphStep(86400 * 5);   // give the bed something to draw
  app.rUpdateBedBuffer();
  {
    const st = app.getState();
    let s = 0;
    for (let i = 0; i < st.morph.length; i++) s += st.morph[i];
    let s2 = 0;
    if (st.depo) for (let i = 0; i < st.depo.length; i++) s2 += st.depo[i];
    const probe = [];
    for (let x = 100; x < 1200; x += 250) probe.push(app.bedZ(x, 400).toFixed(4));
    console.log("  diag bed sum " + s.toFixed(2) + " depo " + s2.toFixed(2) +
                " bar " + Number(st.bar).toFixed(3) + " storm " + Number(st.storm).toFixed(4) +
                " probe " + probe.join(","));
  }
  const g = app.bedSurfaceRef();
  if (!g || !g._buf) { console.error('no rasterized bedSurface'); process.exit(1); }
  fs.writeFileSync(process.env.PRECISION_DUMP, Buffer.from(g._buf.buffer));
  console.log("precision dump -> " + process.env.PRECISION_DUMP + " " + g.width + "x" + g.height);
}


// ============================================================ precision probes
if (process.env.SCORE) {
  const fs = require("fs");
  const out = {};
  // Start from a clean, reproducible bed: residual deposition from earlier checks would
  // otherwise leak into every probe.
  if (typeof depoGrid !== "undefined" && depoGrid) depoGrid.fill(0);
  if (typeof particles !== "undefined" && particles) particles.length = 0;

  // --- calm drift: an equilibrium-seeded bed must not move at all under calm water
  {
    Object.assign(app.cond, { Hs: 0.6, Tp: 6.0, dirDeg: 0, spreadDeg: 0,
                              waterLevel: 0, slr: 0, d50: 0.30, slope: 0.020 });
    app.obstacles.length = 0; app.buildSolid();
    app.resetMorph(); app.setYear(0);
    app.waveFieldStep(); app.barDist();
    // Disequilibrium BEFORE anything moves: z - equilibriumZ at every active cell.
    {
      const gd0 = app.gridDims();
      const A0 = app.deanA(app.cond.d50);
      let worst = 0, worstY = 0, sum = 0, n = 0;
      for (let gy = 0; gy < gd0.GH; gy++) {
        const xShore = app.shoreRef(gy);          // shoreRefAt takes a GRID row, not a pixel row
        if (xShore === null) continue;
        for (let gx = 0; gx < gd0.GW; gx++) {
          const px = (gx + 0.5) * 4, py = (gy + 0.5) * 4;
          const z = app.bedZ(px, py) * app.dims.mpbu;
          const Y = (xShore - px) * (app.dims.cross / 1200);
          const zeq = app.eq(Y, app.getState().storm, A0);
          if (z > 1.5) continue;          // same dune exclusion morphologyStep uses
          const u = z - zeq;
          sum += u * u; n++;
          if (Math.abs(u) > Math.abs(worst)) { worst = u; worstY = Y; }
        }
      }
      out.init_diseq_max = +worst.toFixed(4);
      out.init_diseq_at_Y = +worstY.toFixed(1);
      out.init_diseq_rms = +Math.sqrt(sum / Math.max(n, 1)).toFixed(4);
      // shape of u along the profile: is it constant (datum), or growing offshore (A mismatch)?
      {
        const gy3 = Math.max(1, Math.floor(gd0.GH / 2));
        const xS = app.shoreRef(gy3);
        const mpp = app.dims.cross / 1200;
        const samp = [];
        for (let Yt of [0, 25, 60, 100, 160, 240, 340, 400]) {
          const px = xS - Yt / mpp, py = (gy3 + 0.5) * 4;
          const z = app.bedZ(px, py) * app.dims.mpbu;
          samp.push(Yt + ":" + (z - app.eq(Yt, app.getState().storm, A0)).toFixed(3));
        }
        out.diseq_shape = samp.join(" ");
      }
      out.init_diseq_n = n;
    }
    const snap = () => { const mm = app.getState().morph; let t = 0;
      for (let i = 0; i < mm.length; i++) t += mm[i]; return t; };
    for (let k = 0; k < 20; k++) app.morphStep(86400 * 5);
    const settle_sum = snap();
    const settleMap = Float32Array.from(app.getState().morph);
    for (let k = 0; k < 20; k++) app.morphStep(86400 * 5);   // second 100 days
    const m = app.getState().morph;
    // Ongoing drift: how much moves in the SECOND 100 days. A settling transient shows up in
    // the first window and should be near zero here if the bed is genuinely at equilibrium.
    out.calm_late_max = +((() => {
      const mm = app.getState().morph; let mx = 0;
      for (let i = 0; i < mm.length; i++) mx = Math.max(mx, Math.abs(mm[i] - settleMap[i]));
      return mx * app.dims.mpbu;
    })()).toFixed(5);
    const gd = app.gridDims();
    let maxd = 0, mi = -1;
    for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) > maxd) { maxd = Math.abs(m[i]); mi = i; }
    out.calm_drift = maxd * app.dims.mpbu;
    if (mi >= 0) {
      const gx = mi % gd.GW, gy = (mi / gd.GW) | 0;
      out.calm_at = { gx, gy, xm: +(gx * 4 * (app.dims.cross / 1200)).toFixed(1) };
      const bits = [];
      for (let s2 = 0; s2 <= 6; s2++) {
        const ii = Math.min(gd.GW - 1, gx - 20 + s2 * 8);
        bits.push((m[gy * gd.GW + ii] * app.dims.mpbu).toFixed(3));
      }
      out.calm_profile = bits.join(",");
      const top = [];
      for (let i = 0; i < m.length; i++) top.push([Math.abs(m[i]), i]);
      top.sort((a, b) => b[0] - a[0]);
      const mpp = app.dims.cross / 1200;   // metres per pixel
      out.calm_top5 = top.slice(0, 5).map(([v, i2]) => {
        const gx2 = i2 % gd.GW;
        const xm2 = gx2 * 4 * mpp;
        const xShore = app.shoreRef(Math.max(1, Math.min(gd.GH - 1, ((i2 / gd.GW) | 0)) + 0.5) * 4);
        return { xm: +xm2.toFixed(1), Y: +((xShore - gx2 * 4) * mpp).toFixed(1),
                 dz: +(m[i2] * app.dims.mpbu).toFixed(4) };
      });
    }
  }

  // --- shoaling exponent against Green's law
  {
    const wave = [];
    const g = app.gridDims();
    const j = Math.max(2, Math.floor(g.NY / 2));
    for (let i = 2; i < g.NX - 1; i++) {
      const w = app.waveAt(i, j);
      if (w.breaking) continue;
      if (w.depth < 0.8 || w.depth > 5.0) continue;
      if (!(w.H > 0)) continue;
      wave.push([Math.log(w.depth), Math.log(w.H)]);
    }
    if (wave.length > 20) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y] of wave) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      const n = wave.length;
      out.shoaling_exp = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      out.shoaling_n = n;
    } else {
      out.shoaling_exp = null; out.shoaling_n = wave.length;
    }

    // Flux conservation: in the absence of breaking, H^2 * Cg * cos(theta) must be the same
    // at every cell along a column. That is the invariant the march claims to conserve, and
    // its exact value is known (constant), so the spread measures how well it is honoured.
    const flux = [];
    for (let i = 2; i < g.NX - 1; i++) {
      const w = app.waveAt(i, j);
      if (w.breaking || w.depth < 0.8 || !(w.H > 0)) continue;
      // Dissipation is exp(-(gamma*h/Hrms)^2), so it is only negligible well below the cap.
      // A cell flagged non-breaking can still be dissipating, which would rightly break flux
      // conservation -- exclude the near-breaker band so the probe tests the shoaling march
      // and not the breaking model.
      if (w.H > 0.70 * 0.78 * w.depth) continue;
      flux.push(w.H * w.H * app.groupVel(app.cond.Tp, w.depth));
    }
    if (flux.length > 20) {
      const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
      const sd = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length);
      out.flux_resid = sd / Math.max(Math.abs(mean), 1e-9);
      out.flux_n = flux.length;
    } else {
      out.flux_resid = null; out.flux_n = flux.length;
    }
  }

  // --- CERC: Q must be proportional to sin(2*alpha)
  {
    const ang = [], q = [];
    Object.assign(app.cond, { Hs: 1.5, Tp: 8.0, spreadDeg: 0, waterLevel: 0 });
    for (let a = 5; a <= 40; a += 5) {
      app.cond.dirDeg = a;
      app.waveFieldStep(); app.barDist();
      app.computeLongshore();
      ang.push(Math.sin(2 * a * Math.PI / 180));
      q.push(Math.abs(app.getState().qPeak || 0));
    }
    const n = q.length;
    const mq = q.reduce((s, v) => s + v, 0) / n;
    let ss = 0, st = 0, sq = 0;
    for (let i = 0; i < n; i++) { ss += (ang[i] - ang.reduce((s, v) => s + v, 0) / n) ** 2; }
    // fit q = k * sin(2a) through the origin
    const k = q.reduce((s, v, i) => s + v * ang[i], 0) / Math.max(ang.reduce((s, v) => s + v * v, 0), 1e-9);
    for (let i = 0; i < n; i++) { const pred = k * ang[i]; st += (q[i] - mq) ** 2; sq += (q[i] - pred) ** 2; }
    out.cerc_r2 = st > 0 ? 1 - sq / st : 1;
  }

  // --- volume conservation under cross-shore transport
  {
    Object.assign(app.cond, { Hs: 1.2, Tp: 8.0, dirDeg: 0, spreadDeg: 0, waterLevel: 0 });
    app.resetMorph(); app.waveFieldStep(); app.barDist();
    for (let k = 0; k < 20; k++) app.morphStep(86400 * 5);
    const sum = () => { const m = app.getState().morph; let t = 0; for (let i = 0; i < m.length; i++) t += m[i]; return t; };
    const v0 = sum();
    for (let k = 0; k < 20; k++) app.morphStep(86400 * 5);
    const v1 = sum();
    out.vol_drift = Math.abs(v1 - v0) / Math.max(Math.abs(v0), 1);
    out.vol_abs = Math.abs(v1 - v0);
  }

  // --- storm bed-change profile against the recorded XBeach run.
  // The model time comes from the reference itself, so extending the XBeach run cannot leave
  // the two sides comparing different durations -- which is what a hardcoded 2.5 would do.
  const refDays = (name, dflt) => {
    try { return JSON.parse(fs.readFileSync(__dirname + "/coastal-sediment-interface/dev/" + name, "utf8")).modelDays || dflt; }
    catch (e) { return dflt; }
  };
  out.storm_days = refDays("xbeach-reference.json", 2.5);
  out.case2_days = refDays("xbeach-reference-2.json", 2.5);
  out.storm_dz = runProfile(STORM_COND, out.storm_days);
  out.case2_dz = runProfile(CASE2_COND, out.case2_days);

  fs.writeFileSync(process.env.SCORE, JSON.stringify(out, null, 1));
  console.log("precision probes -> " + process.env.SCORE);
}

// --- a drawn transect can reach below still water
// This is the bug that made every user-drawn profile a dry slope: the strip mapped 0..bedMaxZ
// and the input clamped z to >= 0, so no transect could contain sea. Everything then settled at
// the left, where the bed met the waterline.
{
  if (app.bedStripZ && app.bedStripY) {
    const STRIP_H = 160;                         // BED_STRIP_H; the app's own constant
    const bottom = app.bedStripZ(height);        // value at the very bottom of the strip
    const top = app.bedStripZ(height - STRIP_H);
    const probeY = height - STRIP_H * 0.62;
    const round = app.bedStripY(app.bedStripZ(probeY));
    check(bottom < -50, "the bed strip reaches below still water", `bottom z=${bottom.toFixed(0)} bed units`);
    check(top > 100, "the bed strip still reaches the dune top", `top z=${top.toFixed(0)} bed units`);
    check(Math.abs(app.bedStripZ(round) - app.bedStripZ(probeY)) < 0.01,
          "the bed strip mapping round-trips", `${app.bedStripZ(round).toFixed(2)}`);
  }

  // a submerged ridge must shoal the wave before it breaks -- the expectation that an elevated
  // area makes a bigger wave is right in intermediate depth, and stops only at breaking.
  // Measured at MATCHED DEPTH, not at the domain maximum: the maximum sits where the two beds
  // are identical, so it cannot show shoaling.
  if (app.setBedPoints) {
    const hAtDepth = (lo, hi, z) => {
      app.setBedPoints([
        { x: 0, z: z[0] },
        { x: width * 0.5, z: z[1] },
        { x: width * 0.74, z: 0 },
        { x: width, z: 150 },
      ]);
      app.resetMorph(); app.waveFieldStep(0.1);
      const st = app.getState();
      const H = st.H, D = st.D;
      let sum = 0, n = 0;
      for (let i = 0; i < H.length; i++) {
        if (D[i] >= lo && D[i] <= hi) { sum += H[i]; n++; }
      }
      return n ? sum / n : 0;
    };
    app.cond = app.cond || {};
    Object.assign(app.cond, { Hs: 2.0, Tp: 9.0, dirDeg: 0, spreadDeg: 0, waterLevel: 0 });
    const flatDeep = hAtDepth(6.5, 7.5, [-140, -140]);
    const ridgeShallow = hAtDepth(4.5, 5.5, [-140, -100]);
    check(ridgeShallow > flatDeep * 1.02, "shallower water shoals the wave",
          `mean H at 7 m ${flatDeep.toFixed(2)} -> at 5 m ${ridgeShallow.toFixed(2)} m`);
    app.setBedPoints([]); app.resetMorph();
  }

  // Drawing a bed profile must not throw. The x-section strip kept a reference to a variable
  // that had been removed, so from the first placed point onward draw() threw every frame --
  // which also froze the simulation and made bed mode impossible to leave. Nothing exercised
  // this path, so it shipped.
  if (app.setBedMode && app.setBedPoints) {
    app.setBedPoints([{ x: 0, z: -140 }, { x: width * 0.5, z: -40 }, { x: width, z: 150 }]);
    app.setBedMode(true);
    let err = null;
    try { app.draw(); } catch (e) { err = e.message; }
    check(!err, "drawing a bed profile does not throw", err || "clean");
    app.setBedMode(false);
    if (app.toggleBedMode && app.isPaused && app.setPaused) {
      app.setBedMode(false);
      app.setPaused(false);                      // known starting state: running
      const before = app.isPaused();
      app.toggleBedMode();                       // enter bed mode
      const during = app.isPaused();
      app.toggleBedMode();                       // leave it
      const after = app.isPaused();
      check(during === true && after === before,
            "leaving bed mode restores the run state", `paused ${before} -> ${during} -> ${after}`);
    }
    app.setBedPoints([]); app.resetMorph();
  }

  // and a drawn beach profile must actually be wet over its offshore half
  if (app.setBedPoints) {
    const drew = app.setBedPoints([
      { x: 0, z: -140 },                          // -7 m offshore
      { x: width * 0.74, z: 0 },                  // waterline
      { x: width, z: 150 },                       // dune
    ]);
    if (drew) {
      app.resetMorph(); app.waveFieldStep(0.1);
      const D = app.getState().D;
      let wet = 0, maxd = 0;
      for (let i = 0; i < D.length; i++) if (D[i] > 0.1) { wet++; if (D[i] > maxd) maxd = D[i]; }
      check(wet > 0.2 * D.length, "a drawn beach profile contains water",
            `${wet}/${D.length} wet cells, max depth ${maxd.toFixed(2)} m`);
      app.setBedPoints([]);
      app.resetMorph();
    }
  }
}

console.log("");
if (failures === 0) console.log("HARNESS PASS");
else console.log(`HARNESS FAIL — ${failures} check(s)`);

// ============================================================ frame budget
if (process.env.BENCH) {
  const time = (label, fn, n) => {
    fn();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    console.log(`  ${label.padEnd(30)} ${ms.toFixed(2)} ms`);
    return ms;
  };
  console.log("\n=== frame budget (mean of N) ===");
  const full = time("draw()", () => app.draw(), 60);
  const wave = time("waveFieldStep()", () => app.waveFieldStep(), 60);
  const morph = time("morphStep(1 day)", () => app.morphStep(86400), 20);
  const long  = time("computeLongshore()", () => app.computeLongshore(), 20);
  const parts = time("updateParticles()", () => app.updateParticles(), 60);
  const bed   = time("buildSolidMask()", () => app.buildSolid(), 60);
  const r = (lbl, fn, n) => { if (typeof fn === 'function') { try { time(lbl, () => fn(), n); } catch(e) {} } };
  r('  drawFlowField()', app.rDrawFlow, 30);
  r('  drawParticles()', app.rParticles, 30);
  r('  drawParticlesToBuffer()', app.rParticlesToBuffer, 30);
  r('  drawSpotElevations()', app.rSpot, 30);
  r('  drawBedProfile()', app.rBedProfile, 30);
  r('  drawObstacles()', app.rObstacles, 30);
  r('  drawGhost()', app.rGhost, 30);
  r('  drawTimeline()', app.rTimeline, 30);
  r('  drawDeposition()', app.rDeposition, 30);
  r('  updateBedBuffer()', app.rUpdateBedBuffer, 10);
  r('  redrawDepoBuffer()', app.rRedrawDepo, 10);
  r('  applyLongshore(1d)', () => app.rApplyLong(app, 86400), 10);
  r('  computeBarDistance()', app.rBarDist, 30);
  let xb = 0;
  try { xb = time("buildXBeach()", () => app.buildXBeach({ hours: 6, morfac: 10 }), 5); } catch (e) {}
  console.log("");
  console.log(`  60 fps budget is 16.67 ms; measured draw() ${full.toFixed(2)} ms ` +
              `(${(1000 / full).toFixed(0)} fps ceiling)`);
  console.log(`  share: wave ${(wave / full * 100).toFixed(0)}%, morph ${(morph / full * 100).toFixed(0)}%, ` +
              `longshore ${(long / full * 100).toFixed(0)}%, particles ${(parts / full * 100).toFixed(0)}%`);
}


// ============================================================ XBeach comparison, against the recorded run
{
  const fs = require('fs');
  const refPath = require('path').join(require('path').dirname(require('path').resolve(process.argv[2] || 'index.html')), 'dev', 'xbeach-reference.json');
  if (fs.existsSync(refPath)) {
    const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    const m = ref.meta;

    // The reference is only meaningful if it was produced from this geometry.
    const geomOk = Math.abs(m.reachCross - D.cross) < 1e-6 &&
                   Math.abs(m.reachAlong - D.along) < 1e-6;
    const xb = ref.finalDz;
    const corr = (dz) => {
      const mask = dz.map((v, i) => Math.abs(v) > 0.03 || Math.abs(xb[i]) > 0.03);
      const idx = mask.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
      if (idx.length < 3) return { r: 0, n: idx.length };
      const a = idx.map(i => xb[i]), b = idx.map(i => dz[i]);
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
      }
      return { r: (da > 0 && db > 0) ? num / Math.sqrt(da * db) : 0, n: idx.length };
    };

    const dzEqual = runProfile(STORM_COND, m.modelDays);
    const dzCal   = runProfile(STORM_COND, m.browserDaysForPattern || m.modelDays);
    const eq = corr(dzEqual);
    const ca = corr(dzCal);
    const dz = dzCal;
    const idx = { length: ca.n };
    const r = ca.r;

    console.log(`\n=== xbeach comparison (recorded storm run) ===`);
    console.log(`reference: erosion ${ref.summary.min} m at x=${ref.summary.xMin}, accretion ${ref.summary.max} m at x=${ref.summary.xMax}`);
    console.log(`interface: erosion ${Math.min(...dz).toFixed(3)} m at x=${(dz.indexOf(Math.min(...dz)) * (D.cross / 120)).toFixed(0)}, ` +
                `accretion ${Math.max(...dz).toFixed(3)} m`);
    console.log(`equal morphological time (${m.modelDays} d): correlation ${eq.r.toFixed(3)} over ${eq.n} cells  [range ${Math.min(...dzEqual).toFixed(3)} .. ${Math.max(...dzEqual).toFixed(3)}]`);
    console.log(`pattern-calibrated   (${m.browserDaysForPattern} d): correlation ${ca.r.toFixed(3)} over ${ca.n} cells  [range ${Math.min(...dzCal).toFixed(3)} .. ${Math.max(...dzCal).toFixed(3)}]`);
    console.log(geomOk ? `` : `  NOTE: reference geometry differs from the current reach; comparison is stale.`);

    check(geomOk, "xbeach reference matches the current geometry",
          `reach ${D.cross}x${D.along} m`);
    check(idx.length > 5, "interface responds where xbeach responds", `${idx.length} active cells`);

    const bMin = Math.min(...dz), bMax = Math.max(...dz);
    check(Math.abs(bMax) > 0.02, "interface moves sediment under storm", `${bMax.toFixed(3)} m`);

    // Recorded, not asserted: the models do not agree yet. This is a regression tripwire,
    // not a pass mark. Raising it means the physics improved and the reference needs redoing.
    check(eq.r > 0.5, "spatial pattern matches xbeach", eq.r.toFixed(3));
    // The point of the transport rewrite: at equal morphological time the interface should
    // move a comparable amount of sand, not 15x less.
    const xbAmp = Math.max(...xb.map(Math.abs));
    const bAmp = Math.max(...dzEqual.map(Math.abs));
    const ratio = bAmp / xbAmp;
    console.log(`amplitude at equal time: ${bAmp.toFixed(3)} vs xbeach ${xbAmp.toFixed(3)} m (ratio ${ratio.toFixed(2)})`);
    check(ratio > 0.6 && ratio < 1.6, "moves comparable sediment at equal time", ratio.toFixed(2));
  }
}


// ============================================================ storm case for XBeach comparison
if (process.env.XB_STORM || process.env.XB_CASE2) {
  Object.assign(app.cond, process.env.XB_CASE2 ? CASE2_COND : STORM_COND);
  app.obstacles.length = 0;
  app.buildSolid();
  app.resetMorph();

  const sx = app.buildXBeach({ hours: 6, morfac: 10 });
  const e2 = new TextEncoder();
  const z2 = app.zipStore([
    { name: 'params.txt',  data: e2.encode(sx.params)  },
    { name: 'bed.dep',     data: e2.encode(sx.bed)     },
    { name: 'jonswap.txt', data: e2.encode(sx.jonswap) },
  ]);
  const dst = process.env.XB_CASE2 || process.env.XB_STORM;
  require('fs').writeFileSync(dst, Buffer.from(z2));
  console.log(`wrote case -> ${dst}`);
}

// ============================================================ storm profile, shared

function runProfile(cond, modelDays) {
  Object.assign(app.cond, cond);
  app.obstacles.length = 0;
  app.buildSolid();
  app.resetMorph();
  app.setYear(0);

  const sample = () => {
    const prof = [];
    for (let i = 0; i <= 120; i++) {
      let sum = 0;
      for (let j = 0; j <= 40; j++) {
        const xm = i * (D.cross / 120), ym = j * (D.along / 40);
        sum += app.bedZ(xm * (width / D.cross), ym * (height / D.along)) * D.mpbu;
      }
      prof.push(sum / 41);
    }
    return prof;
  };

  const before = sample();
  const steps = 400;
  for (let k = 0; k < steps; k++) {
    // The breakpoint is measured from the breaking cells, so the wave field must exist before
    // it can be measured. Without this the dump scored against the stale default of 60 m while
    // the checks used the real one, which is why the scored profile and the check disagreed
    // about where the bar was.
    if (app.waveFieldStep) app.waveFieldStep(0.1);
    if (app.computeBarDist) app.computeBarDist();
    app.morphStep((modelDays * 86400) / steps);
  }
  const after = sample();
  return after.map((v, i) => v - before[i]);
}

// ============================================================ profile dump
if (process.env.MORPH_DUMP) {
  const dz = runProfile(STORM_COND, process.env.MORPH_STORM ? 25 : 2.5);
  require('fs').writeFileSync(process.env.MORPH_DUMP, JSON.stringify({ dz }));
  console.log(`wrote profile -> ${process.env.MORPH_DUMP}`);
}

if (failures > 0) process.exit(1);
