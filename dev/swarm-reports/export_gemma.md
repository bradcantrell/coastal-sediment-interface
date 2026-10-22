# export / gemma (google/gemma-4-31b-qat)

**ADVERSARIAL REVIEW: EXPORT FIDELITY**

The following findings identify discrepancies between the browser simulator's visual state and the exported XBeach configuration.

### 🔴 CRITICAL: MISREPRESENTED
**Function:** `buildXBeach` / `params.txt`
**Finding:** The simulator calculates morphology using a "longshore layer" (`applyLongshore`) and a "morph layer" (`redrawDepoBuffer`), but the export only writes the base bed elevation (`xbBedAt`). Any sediment accumulation or erosion calculated in the simulator's active buffers is discarded during export. The student sees a modified beach on screen, but XBeach starts from the initial `bed.dep`.
**Fix:** Modify `xbBedAt` to sum the base bed elevation and the current values from the morphology/deposition buffers.

### 🟠 HIGH: MISMATCHED
**Function:** `dirToNautical`
**Finding:** The logic `((270 - dirDeg) % 360 + 360) % 360` combined with `if (a < 180) a += 360` creates a non-standard mapping. For a shore-normal wave (270°), this returns 360°. However, for a wave coming from 0° (North), it returns 270°. This likely conflicts with the XBeach `thetanaut = 1` convention where 0/360 is North and 270 is West.
**Fix:** Standardize `dirToNautical` to return the absolute compass heading (0-360) of the wave source.

### 🟡 MEDIUM: MISREPRESENTED
**Function:** `buildXBeach` / `jonswap.txt`
**Finding:** The simulator uses a "spread" value (`conditions.spreadDeg`), but the export converts this to a parameter `s` via `spreadToS`. The function `spreadToS` clamps the result between 1 and 1000. If the UI allows a narrow spread (small $\sigma$), the resulting `s` will be capped at 1, meaning the XBeach run will use a wider directional spread than what is visually simulated.
**Fix:** Remove the `Math.max(1, s)` clamp or align the UI constraints with the `spreadToS` mathematical limits.

### 🟢 LOW: CONSISTENT
**Items Verified:**
- **Bed Dimensions:** `(XB_NX+1)*(XB_NY+1)` is correctly implemented in the nested loops.
- **D50 Units:** Correctly converted from mm to m (`/ 1000`).
- **Orientation:** `posdwn = -1` is explicitly set and matches the "positive up" logic.
- **Time:** `tstop` is correctly derived from `hours * 3600`.
- **Grid:** `dx/dy` are derived from the same constants used in `xbBedAt`.
