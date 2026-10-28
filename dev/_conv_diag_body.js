// ---------------------------------------------------------------- convergence diagnostic
// Where does the dt vs dt/2 disagreement actually live, and is it a smooth discretisation
// error or a membership change in the active-transport mask?

app.setup();
const st0 = app.getState();
// storm conditions, the same values the harness uses for the XBeach case
st0.cond.Hs = 3.4; st0.cond.Tp = 12.0; st0.cond.waterLevel = 0.8;
st0.cond.slope = 0.02; st0.cond.d50 = 0.30;
app.waveFieldStep();
for (let i = 0; i < 6; i++) app.morphStep(900);      // get off the seeded state

const st = app.getState();
const GW = st.gw, GH = st.gh;
const M_PER_UNIT = 0.05;
const snap = Float32Array.from(st.morph);

// morphologyStep excludes cells above refWaterLevel + BERM_TOP_M from transport entirely.
// Rebuild that decision so we can see whether the two runs disagree about membership.
function maskOf() {
  const m = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * 4;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * 4;
      m[gy * GW + gx] = (app.bedZ(x, y) * M_PER_UNIT > 0.8 + 1.5) ? 1 : 0;
    }
  }
  return m;
}

function runAt(dt, n) {
  st.morph.set(snap);
  for (let k = 0; k < n; k++) app.morphStep(dt);
  return { bed: Float32Array.from(st.morph), mask: maskOf() };
}

const dt = (16.7 / 1000) * 2.0 * 86400;
const A = runAt(dt, 12);
const B = runAt(dt / 2, 24);
st.morph.set(snap);

const rows = [];
let over05 = 0, over1 = 0, maskDiff = 0, bigMaskDiff = 0;
for (let k = 0; k < snap.length; k++) {
  const d = Math.abs(B.bed[k] - A.bed[k]) * M_PER_UNIT;
  if (d > 0.5) { over05++; if (A.mask[k] !== B.mask[k]) bigMaskDiff++; }
  if (d > 1.0) over1++;
  if (A.mask[k] !== B.mask[k]) maskDiff++;
  rows.push({ k: k, d: d });
}
rows.sort((p, q) => q.d - p.d);

console.log(JSON.stringify({
  dtHours: +(dt / 3600).toFixed(2),
  cells: snap.length,
  cellsOver0_5m: over05,
  cellsOver1m: over1,
  maxDiffM: +rows[0].d.toFixed(3),
  excludedCellsA: A.mask.reduce((s, v) => s + v, 0),
  excludedCellsB: B.mask.reduce((s, v) => s + v, 0),
  maskDisagreements: maskDiff,
  bigCellsWithMaskDisagreement: bigMaskDiff,
  top: rows.slice(0, 10).map(o => ({
    gx: o.k % GW,
    gy: Math.floor(o.k / GW),
    d: +o.d.toFixed(2),
    excludedA: A.mask[o.k],
    excludedB: B.mask[o.k],
    bedA_m: +(A.bed[o.k] * M_PER_UNIT).toFixed(2),
    bedB_m: +(B.bed[o.k] * M_PER_UNIT).toFixed(2),
  })),
}, null, 1));
