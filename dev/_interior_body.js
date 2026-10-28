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
