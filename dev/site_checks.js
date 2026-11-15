// Checks run by dev/interface_harness.js (the shared interface harness) for this repo:
// the vendored interface matches its lock, and the XBeach export backend is mounted.
// The coastal model's own checks are dev/headless_harness.js.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function ({ app, check, ROOT }) {
  const lockPath = path.join(ROOT, "dev", "core.lock");
  const lines = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8").split("\n") : [];
  const commit = (lines.find(l => l.startsWith("commit ")) || "").slice(7, 14);
  const bad = [];
  let n = 0;
  for (const l of lines) {
    const m = l.match(/^sha256 ([0-9a-f]{64}) (.+)$/);
    if (!m) continue;
    n++;
    const f = path.join(ROOT, m[2]);
    const h = fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "missing";
    if (h !== m[1]) bad.push(m[2]);
  }
  check(n >= 2 && bad.length === 0, "the vendored interface matches dev/core.lock",
        n < 2 ? "lock is missing files; run dev/sync_core.sh" :
        bad.length ? `edited here: ${bad.join(", ")}. Change it in sediment-interface, then dev/sync_core.sh` : `sediment-interface ${commit}, ${n} files`);

  const ids = app.run("backends.map(b => b.id)");
  const slot = app.run("document.getElementById('site-slot')");
  check(ids.includes("xbeach") && /id="export-xb"/.test(slot.innerHTML) && /id="xb-status"/.test(slot.innerHTML),
        "the XBeach export backend is registered and mounts its controls", `backends: ${ids.join(", ")}`);

  // What the export packs: the XBeach case, scripts that run it, a README that names only
  // files that are there, and the scene itself in a form the interface opens again.
  {
    const files = app.run("xbeachCaseFiles")({ hours: 6, morfac: 10 });
    const names = files.map(f => f.name), get = (n) => (files.find(f => f.name === n) || {}).text || "";
    const want = ["params.txt", "bed.dep", "jonswap.txt", "README.md", "run.sh", "run.bat", "scene.json"];
    const readme = get("README.md");
    const named = [...new Set(readme.match(/\b[\w-]+\.(?:txt|dep|sh|bat|json)\b/g) || [])];
    const made = ["XBlog.txt"];                       // written by XBeach, not part of the case
    const missing = named.filter(n => !names.includes(n) && !made.includes(n));
    const enc = new TextEncoder();
    const zip = app.run("zipStore")(files.map(f => ({ name: f.name, data: enc.encode(f.text) })));
    const found = app.run("findSceneInZip")(zip);
    const opens = found && found.method === 0 ? app.run("checkSceneText")(Buffer.from(found.data).toString()) : { ok: false, why: "no scene.json in the ZIP" };
    const nx = +(get("params.txt").match(/^nx\s*=\s*(\d+)/m) || [])[1], ny = +(get("params.txt").match(/^ny\s*=\s*(\d+)/m) || [])[1];
    check(want.every(n => names.includes(n)) && missing.length === 0 && opens.ok && opens.scene.tab === "coast" &&
          /XBEACH/.test(get("run.sh")) && /%XBEACH%/.test(get("run.bat")) && /\r\n/.test(get("run.bat")) && !/\r/.test(get("run.sh")) &&
          readme.includes(((nx + 1) * (ny + 1)) + " values"),
          "the exported ZIP holds the case, scripts that run it, and a scene the interface opens again",
          missing.length ? `the README names files the case lacks: ${missing.join(", ")}` :
          opens.ok ? `${names.join(", ")}; scene tab ${opens.scene.tab}; README names ${named.length} files` : opens.why);
  }

  const m = app.run("model");
  check(m.id === "coast" && app.run("bedZMin()") < 0 && app.run("bedZMax()") > 0,
        "the coastal model is the one loaded, with a bed on both sides of still water", `model ${m.id}, bed ${app.run("bedZMin()")}..${app.run("bedZMax()")}`);
};
