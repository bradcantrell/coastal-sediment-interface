// ---------------------------------------------------------------- convergence diagnostic
// Where does the dt vs dt/2 disagreement actually live?
// The mask-membership hypothesis was tested in the first pass and refuted (0 disagreements),
// so characterise the location instead.

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
  const bed = Float32Array.from(st.morph);
  const zTot = new Float64Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * 4;
    for (let gx = 0; gx < GW; gx++) zTot[gy * GW + gx] = app.bedZ((gx + 0.5) * 4, y) * M_PER_UNIT;
  }
  return { bed: bed, zTot: zTot };
}

const dt = (16.7 / 1000) * 2.0 * 86400;
const A = runAt(dt, 12);
const B = runAt(dt / 2, 24);
st.morph.set(snap);

const rows = [];
for (let k = 0; k < snap.length; k++) {
  rows.push({ k: k, gx: k % GW, gy: Math.floor(k / GW),
              d: Math.abs(B.bed[k] - A.bed[k]) * M_PER_UNIT });
}
const big = rows.filter(r => r.d > 1.0).sort((p, q) => q.d - p.d);

function stats(arr, key) {
  if (!arr.length) return null;
  const v = arr.map(o => o[key]);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return { min: Math.min.apply(null, v), max: Math.max.apply(null, v), mean: +mean.toFixed(1) };
}

console.log(JSON.stringify({
  dtHours: +(dt / 3600).toFixed(2),
  grid: GW + 'x' + GH,
  cellsOver1m: big.length,
  gx: stats(big, 'gx'),
  gy: stats(big, 'gy'),
  top: big.slice(0, 12).map(r => ({
    gx: r.gx, gy: r.gy, diffM: +r.d.toFixed(2),
    zCoarse_m: +A.zTot[r.k].toFixed(2),
    zFine_m: +B.zTot[r.k].toFixed(2),
  })),
}, null, 1));
