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

// run.sh and run.bat: one command that runs the case. They use the xbeach on the PATH, or
// the binary named in the XBEACH variable. A ZIP made in the browser carries no executable
// bit, so the README runs the shell script through sh.
function xbRunSh() {
  return [
    '#!/bin/sh',
    '# Runs this XBeach case:  sh run.sh',
    '# Uses the xbeach on the PATH, or the one you name:  XBEACH=/path/to/xbeach sh run.sh',
    'cd "$(dirname "$0")" || exit 1',
    'XB="${XBEACH:-xbeach}"',
    'if ! command -v "$XB" >/dev/null 2>&1; then',
    '  echo "XBeach was not found. Put xbeach on the PATH, or run:" >&2',
    '  echo "  XBEACH=/path/to/xbeach sh run.sh" >&2',
    '  exit 1',
    'fi',
    '"$XB" || { echo "XBeach stopped with an error, see XBlog.txt" >&2; exit 1; }',
    'echo "done. Bed levels over time are in zb.dat, the log is XBlog.txt"',
  ].join('\n') + '\n';
}

function xbRunBat() {
  return [
    '@echo off',
    'rem Runs this XBeach case. Double-click it, or run it from a command prompt.',
    'rem Uses xbeach.exe on the PATH, or the one you name:  set XBEACH=C:\\path\\to\\xbeach.exe',
    'cd /d "%~dp0"',
    'if "%XBEACH%"=="" set XBEACH=xbeach.exe',
    '"%XBEACH%"',
    'if errorlevel 1 (',
    '  echo.',
    '  echo XBeach did not run or stopped with an error. If it was not found, put xbeach.exe',
    '  echo on the PATH or set XBEACH to its full path. Otherwise see XBlog.txt.',
    ')',
    'pause',
  ].join('\r\n') + '\r\n';
}

function xbReadme(p, hours, morfac) {
  const outs = Math.floor(p.tstop / Math.max(60, Math.round(p.tstop / 20))) + 1;
  return [
    '# Coastal Sediment Interface -> XBeach case',
    '',
    'This folder is a complete XBeach case made from the scene in the interface: the bed as it',
    'was drawn, the waves and water level as they were set.',
    '',
    '## Run',
    '',
    'You need an XBeach executable (https://xbeach.org, source at github.com/openearth/xbeach).',
    'A serial build without netCDF is enough. Unpack the ZIP, then from this folder:',
    '',
    '    sh run.sh        Linux and macOS',
    '    run.bat          Windows',
    '',
    'Both use the xbeach on the PATH. To use another one, set XBEACH to its full path first.',
    'A Windows build made with MSYS2 also needs C:\\msys64\\mingw64\\bin on the PATH.',
    'Running by hand is the same thing: start xbeach in this folder and it reads params.txt.',
    '',
    '## What is in the case',
    '',
    '    params.txt   the run: ' + p.nx + ' x ' + p.ny + ' cells, ' + hours + ' h of storm (tstop ' + p.tstop + ' s), morfac ' + morfac,
    '    bed.dep      bed levels in metres, positive up, one cross-shore transect per row,',
    '                 offshore first: ' + (p.ny + 1) + ' rows of ' + (p.nx + 1) + ' values',
    '    jonswap.txt  the wave spectrum at the offshore boundary',
    '    run.sh, run.bat   run the case',
    '    scene.json   the scene itself, for the interface',
    '',
    'With morfac ' + morfac + ' the bed changes as it would over ' + (hours * morfac) + ' h.',
    '',
    '## What comes out',
    '',
    '    zb.dat   bed level        zs.dat   water level        H.dat   wave height',
    '',
    'Each is a plain file of 8-byte reals with no header: ' + ((p.nx + 1) * (p.ny + 1)) + ' values (' + (p.nx + 1) + ' x ' + (p.ny + 1) + ') for',
    'each of about ' + outs + ' output times. xy.dat holds the grid, dims.dat its size, and XBlog.txt the log.',
    'For netCDF output, use a build with netCDF and set outputformat = netcdf in params.txt.',
    '',
    '## Open the scene again',
    '',
    'In the Coastal Sediment Interface, on the coast tab, press "open" and pick scene.json or',
    'the ZIP itself. The drawing and the settings come back; the run starts fresh.',
  ].join('\n') + '\n';
}

// Everything the export packs, as text: the case, the scripts that run it, and the scene.
function xbeachCaseFiles(opts) {
  opts = opts || {};
  const hours = opts.hours || xbHours, morfac = opts.morfac || xbMorfac;
  const p = buildXBeach({ hours: hours, morfac: morfac });
  return [
    { name: 'params.txt',  text: p.params  },
    { name: 'bed.dep',     text: p.bed     },
    { name: 'jonswap.txt', text: p.jonswap },
    { name: 'README.md',   text: xbReadme(p, hours, morfac) },
    { name: 'run.sh',      text: xbRunSh() },
    { name: 'run.bat',     text: xbRunBat() },
    { name: 'scene.json',  text: sceneFileText() },
  ];
}

function exportXBeach() {
  const enc = new TextEncoder();
  const files = xbeachCaseFiles().map(function (f) { return { name: f.name, data: enc.encode(f.text) }; });
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
                           XB_NX + 'x' + XB_NY + ' cells · run.sh or run.bat runs it, "open" reads it back';
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
