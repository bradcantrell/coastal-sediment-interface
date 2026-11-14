// site.js for the coastal interface: the XBeach case export.
//
// index.html is the shared interface and model.js is the coastal model. This file is what
// this repo does with the scene: it writes the drawn beach and the wave conditions as an
// XBeach case and downloads it as a ZIP, entirely in the browser. See SITE EXTENSION POINT
// in index.html for what a backend can provide.


// ─────────────────────────────────────────────
// XBEACH EXPORT  (Phase 5)
// ─────────────────────────────────────────────
// Frames the current state as a case XBeach can read. Units are the whole story here:
// params.txt wants D50 in METRES, this interface works in millimetres; bed.dep wants
// elevations positive UP, so posdwn = -1 rather than flipping the data.

const XB_NX = 120;          // cross-shore cells

const XB_NY = 40;           // alongshore cells

const XB_DTHETA = 10;       // directional resolution, degrees

let xbHours = 6;            // simulated storm duration

let xbMorfac = 10;          // morphological acceleration factor

let xbStatus = '';

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}


/** Minimal store-only ZIP. One file in, three files out, no library. */
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;

  for (let f = 0; f < files.length; f++) {
    const nameBytes = enc.encode(files[f].name);
    const data = files[f].data;
    const crc = crc32(data), size = data.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);            // stored, no compression
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    parts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + size;
  }

  let cSize = 0;
  for (let i = 0; i < central.length; i++) cSize += central[i].length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cSize + 22);
  let p = 0;
  for (let i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
  for (let i = 0; i < central.length; i++) { out.set(central[i], p); p += central[i].length; }
  out.set(eocd, p);
  return out;
}


/** Bed level at an XBeach grid corner, metres, positive up. */
function xbBedAt(i, j) {
  const xm = i * (REACH_CROSSSHORE / XB_NX);       // offshore at 0, dune at the land edge
  const ym = j * (REACH_ALONGSHORE / XB_NY);
  const px = xm * (width / REACH_CROSSSHORE);
  const py = ym * (height / REACH_ALONGSHORE);
  return bedZ(px, py) * M_PER_BED_UNIT;
}


/** Directional spread in degrees to the JONSWAP s parameter: s = 2/sigma^2 - 1. */
function spreadToS(deg) {
  const sig = Math.max(1, deg) * Math.PI / 180;
  const s = 2 / (sig * sig) - 1;
  return Math.min(1000, Math.max(1, s));
}


/** Shore-normal angle to nautical mainang. 270 deg is waves from the west, travelling +x. */
function dirToNautical(dirDeg) {
  let a = ((270 - dirDeg) % 360 + 360) % 360;
  if (a < 180) a += 360;
  return a;
}

function buildXBeach(opts) {
  opts = opts || {};
  const hours  = opts.hours  || xbHours;
  const morfac = opts.morfac || xbMorfac;
  const tstop  = Math.round(hours * 3600);
  const dx = REACH_CROSSSHORE / XB_NX;
  const dy = REACH_ALONGSHORE / XB_NY;

  // ---------------- params.txt
  const L = [];
  L.push('%%% XBeach case exported from the Coastal Sediment Interface');
  L.push('%%% Bed elevations are positive UP (posdwn = -1).');
  L.push('');
  L.push('%%% Grid parameters %%%');
  L.push('depfile   = bed.dep');
  L.push('posdwn    = -1');
  L.push('nx        = ' + XB_NX);
  L.push('ny        = ' + XB_NY);
  L.push('dx        = ' + dx.toFixed(6));
  L.push('dy        = ' + dy.toFixed(6));
  L.push('vardx     = 0');
  L.push('alfa      = 0');
  L.push('xori      = 0');
  L.push('yori      = 0');
  L.push('');
  L.push('%%% Directional grid %%%');
  L.push('thetamin  = 180');
  L.push('thetamax  = 360');
  L.push('dtheta    = ' + XB_DTHETA);
  L.push('thetanaut = 1');
  L.push('');
  L.push('%%% Model time %%%');
  L.push('tstart    = 0');
  L.push('tstop     = ' + tstop);
  L.push('');
  L.push('%%% Physical processes %%%');
  L.push('swave     = 1');
  L.push('lwave     = 1');
  L.push('flow      = 1');
  L.push('sedtrans  = 1');
  L.push('morphology = 1');
  L.push('nonh      = 0');
  L.push('');
  L.push('%%% Constants %%%');
  L.push('rho       = ' + RHO);
  L.push('g         = ' + GRAV);
  L.push('');
  L.push('%%% Water level %%%');
  L.push('zs0       = ' + conditions.waterLevel.toFixed(4));
  L.push('');
  L.push('%%% Wave boundary condition %%%');
  L.push('instat    = jons');
  L.push('bcfile    = jonswap.txt');
  L.push('rt        = 3600');
  L.push('dtbc      = 0.5');
  L.push('');
  L.push('%%% Sediment %%%');
  L.push('%%% D50 and D90 are in METRES here; the interface works in millimetres.');
  L.push('D50       = ' + (conditions.d50 / 1000).toFixed(6));
  L.push('D90       = ' + (conditions.d50 * 2 / 1000).toFixed(6));
  L.push('rhos      = 2650');
  L.push('por       = 0.4');
  L.push('ngd       = 1');
  L.push('nd        = 30');
  L.push('');
  L.push('%%% Morphology %%%');
  L.push('morfac    = ' + morfac);
  L.push('morstart  = 0');
  L.push('morfacopt = 1');
  L.push('wetslp    = 0.3');
  L.push('dryslp    = 1.0');
  L.push('');
  L.push('%%% Output %%%');
  // fortran = unformatted binary, which the plain (non-netCDF) executable supports.
  // A build configured --with-netcdf can switch this to netcdf.
  L.push('outputformat = fortran');
  L.push('tintg     = ' + Math.max(60, Math.round(tstop / 20)));
  L.push('nglobalvar = 3');
  L.push('zb');
  L.push('zs');
  L.push('H');
  const params = L.join('\n') + '\n';

  // ---------------- bed.dep : ny+1 rows of nx+1 values, positive up
  const rows = [];
  for (let j = 0; j <= XB_NY; j++) {
    const vals = [];
    for (let i = 0; i <= XB_NX; i++) vals.push(xbBedAt(i, j).toFixed(4));
    rows.push(vals.join(' '));
  }
  const bed = rows.join('\n') + '\n';

  // ---------------- jonswap.txt
  const J = [];
  J.push('Hm0 = ' + conditions.Hs.toFixed(3));
  J.push('Tp = ' + conditions.Tp.toFixed(2));
  J.push('mainang = ' + dirToNautical(conditions.dirDeg).toFixed(1));
  J.push('gammajsp = 3.3');
  J.push('s = ' + spreadToS(conditions.spreadDeg).toFixed(1));
  J.push('fnyq = 0.3');
  const jonswap = J.join('\n') + '\n';

  return { params: params, bed: bed, jonswap: jonswap, nx: XB_NX, ny: XB_NY, tstop: tstop };
}

function exportXBeach() {
  const p = buildXBeach({ hours: xbHours, morfac: xbMorfac });
  const enc = new TextEncoder();
  const files = [
    { name: 'params.txt',  data: enc.encode(p.params)  },
    { name: 'bed.dep',     data: enc.encode(p.bed)     },
    { name: 'jonswap.txt', data: enc.encode(p.jonswap) },
  ];
  const zip = zipStore(files);
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xbeach-case.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

  const el = document.getElementById('xb-status');
  if (el) el.textContent = 'exported ' + (zip.length / 1024).toFixed(1) + ' KB · ' +
                           XB_NX + 'x' + XB_NY + ' cells';
}

registerBackend({
  id: 'xbeach',
  title: 'Coastal Sediment Interface',
  mount(slot) {
    // The sidebar is a flex column with a gap; the slot is a plain block, so this keeps the
    // rows spaced the way the rest of the sidebar is.
    slot.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;">' + `
<div class="sect-label">export <button class="reset-btn" id="export-xb">xbeach</button></div>
<div class="ctrl-row"><label>run <span class="val" id="xb-dur-val">6 h</span></label><input type="range" id="xb-dur" min="1" max="48" value="6" step="1"></div>
<div class="ctrl-row"><label>morfac <span class="val" id="xb-mf-val">10</span></label><input type="range" id="xb-mf" min="1" max="50" value="10" step="1"></div>
<div id="xb-status" style="font-size:9px;color:rgba(140,200,255,0.65);line-height:1.5;margin:3px 0 3px 0;">case not exported</div>
` + '</div>';
    const xb = document.getElementById('export-xb');
    xb.style.width = 'auto'; xb.style.marginBottom = '0';
    document.getElementById('xb-dur').addEventListener('input', function(){
      xbHours = parseFloat(this.value);
      document.getElementById('xb-dur-val').textContent = xbHours.toFixed(0) + ' h';
    });
    document.getElementById('xb-mf').addEventListener('input', function(){
      xbMorfac = parseFloat(this.value);
      document.getElementById('xb-mf-val').textContent = xbMorfac.toFixed(0);
    });
    document.getElementById('export-xb').addEventListener('click', function(){ exportXBeach(); });
  },
});
