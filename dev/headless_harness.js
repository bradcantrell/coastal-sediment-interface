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
  }),
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

console.log("");
if (failures === 0) console.log("HARNESS PASS");
else { console.log(`HARNESS FAIL — ${failures} check(s)`); process.exit(1); }
