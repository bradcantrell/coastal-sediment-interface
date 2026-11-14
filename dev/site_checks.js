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

  const m = app.run("model");
  check(m.id === "coast" && app.run("bedZMin()") < 0 && app.run("bedZMax()") > 0,
        "the coastal model is the one loaded, with a bed on both sides of still water", `model ${m.id}, bed ${app.run("bedZMin()")}..${app.run("bedZMax()")}`);
};
