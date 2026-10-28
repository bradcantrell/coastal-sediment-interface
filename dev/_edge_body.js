// ---------------------------------------------------------------- edge-row probe
// The convergence disagreement sits entirely on gy = GH-1. Test whether that row samples
// outside the interpolation grid, which bedZ() reports as 0.

app.setup();
const st0 = app.getState();
st0.cond.Hs = 3.4; st0.cond.Tp = 12.0; st0.cond.waterLevel = 0.8;
st0.cond.slope = 0.02; st0.cond.d50 = 0.30;
app.waveFieldStep();

const st = app.getState();
const GW = st.gw, GH = st.gh;

// canvas height/width as the harness mocks them

const probe = [];
for (const gy of [GH - 3, GH - 2, GH - 1]) {
  const y = (gy + 0.5) * 4;
  const row = [];
  for (const gx of [2, 50, 150, 237, GW - 2, GW - 1]) {
    const x = (gx + 0.5) * 4;
    row.push({ gx: gx, z: +app.bedZ(x, y).toFixed(3) });
  }
  probe.push({ gy: gy, yPx: y, vals: row });
}

console.log(JSON.stringify({
  grid: GW + 'x' + GH,
  lastRowY: (GH - 1 + 0.5) * 4,
  lastColX: (GW - 1 + 0.5) * 4,
  rows: probe,
}, null, 1));
