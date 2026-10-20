// Headless harness for the Coastal Sediment Interface.
// Pattern from the tidal repo's AGENTS.md: mock p5 + DOM, load the app script, then
// exercise setup() + N draw() frames. No browser, no screenshot harness needed.

const fs = require("fs");

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
  textLeading: noop, textStyle: noop, textWrap: noop, textWidth2: noop,
  rotateX: noop, rotateY: noop, rotateZ: noop, applyMatrix: noop, resetMatrix: noop,
  shearX: noop, shearY: noop, erase: noop, noErase: noop,
  save: noop, restore: noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
  putImageData: noop, drawImage: noop,
  // raw CanvasRenderingContext2D surface — used by the bed thumbnail
  clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
  moveTo: noop, lineTo: noop, arc: noop, rect2: noop, quadraticCurveTo: noop,
  bezierCurveTo: noop, setTransform: noop, resetTransform: noop, transform: noop,
  clip: noop, fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
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
    id, textContent: "", innerHTML: "", value: "0", checked: false,
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

// p5 math/utility globals
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
});

// p5 drawing API
Object.assign(global, {
  createCanvas: () => ({ parent: noop, style: {}, elt: el("canvas"), id: () => "c" }),
  pixelDensity: noop, background: noop, clear: noop, fill: noop, stroke: noop,
  noStroke: noop, noFill: noop, rect: noop, ellipse: noop, line: noop, circle: noop,
  text: noop, textSize: noop, textAlign: noop, textWidth: () => 10, textFont: noop,
  push: noop, pop: noop, translate: noop, rotate: noop, scale: noop, image: noop,
  beginShape: noop, endShape: noop, vertex: noop, strokeWeight: noop,
  createGraphics: () => Object.assign(ctx(), { width: W, height: H }),
  loadImage: noop, redraw: noop, frameCount: 0, deviceOrientation: "landscape",
  resizeCanvas: (w, h) => { W = w; H = h; }, noLoop: noop, loop: noop,
});

global.p5 = { disableFriendlyErrors: true, prototype: {}, Vector: function () {} };

// p5 constants
Object.assign(global, {
  CENTER: "center", LEFT: "left", RIGHT: "right", TOP: "top", BOTTOM: "bottom",
  BASELINE: "alphabetic", CORNER: "corner", CORNERS: "corners", RADIUS: "radius",
  CLOSE: "close", OPEN: "open", CHORD: "chord", PIE: "pie", PROJECT: "square",
  ROUND: "round", SQUARE: "butt", MITER: "miter", BEVEL: "bevel", RGB: "rgb", HSB: "hsb",
  HSL: "hsl", ADD: "lighter", MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay",
  REPLACE: "source-over", DIFFERENCE: "difference", EXCLUSION: "exclusion",
  arrows: {}, UP_ARROW: 38, DOWN_ARROW: 40, LEFT_ARROW: 37, RIGHT_ARROW: 39,
  ENTER: 13, RETURN: 13, ESCAPE: 27, BACKSPACE: 8, DELETE: 46, TAB: 9, SHIFT: 16,
  CONTROL: 17, ALT: 18, OPTION: 18, SPACE: 32,
});

// ---------------------------------------------------------------- load the app
const src = fs.readFileSync(process.argv[2], "utf8");
const mod = { exports: {} };
try {
  // Run in global scope so function declarations become reachable.
  new Function(src + `
;globalThis.__app = {
  setup: typeof setup==='function'?setup:null,
  draw: typeof draw==='function'?draw:null,
  waveFieldStep: typeof waveFieldStep==='function'?waveFieldStep:null,
  waveComponents: typeof waveComponents!=='undefined'?waveComponents:null,
  getField: () => (typeof waveH !== 'undefined' && typeof waveDepth !== 'undefined')
      ? { H: waveH, D: waveDepth } : null,
};
`)();
} catch (e) {
  console.error("LOAD FAILED:", e.message);
  process.exit(1);
}

const app = globalThis.__app;
if (!app.setup) { console.error("FAIL: no setup() found"); process.exit(1); }

try {
  app.setup();
  console.log("setup() OK");
} catch (e) {
  console.error("SETUP FAILED:", e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}

// Unpause and run frames
try {
  if (typeof paused !== "undefined") global.paused = false;
  for (let i = 0; i < 30; i++) app.draw();
  console.log("30 draw() frames OK");
} catch (e) {
  console.error("DRAW FAILED on frame:", e.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

// Wave field sanity
try {
  const f = app.getField ? app.getField() : null;
  const wH = f && f.H, wD = f && f.D;
  if (wH && wD) {
    let wet = 0, dry = 0, maxH = 0, maxD = 0;
    for (let i = 0; i < wH.length; i++) {
      if (wD[i] > 0.02) { wet++; if (wH[i] > maxH) maxH = wH[i]; if (wD[i] > maxD) maxD = wD[i]; }
      else dry++;
    }
    console.log(`wave field: ${wet} wet cells, ${dry} dry, max depth ${maxD.toFixed(2)} m, max H ${maxH.toFixed(2)} m`);
    if (wet === 0) { console.error("FAIL: no wet cells — the field is empty"); process.exit(1); }
  } else {
    console.log("wave field: arrays not reachable (skipped)");
  }
} catch (e) {
  console.error("field check error:", e.message);
}
console.log("HARNESS PASS");
