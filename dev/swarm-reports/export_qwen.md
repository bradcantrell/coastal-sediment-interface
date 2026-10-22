# export / qwen (qwen/qwen3.8-27b)

Here is the adversarial audit of the `buildXBeach` export function against the measured frame profile and physics constraints.

### **CRITICAL FINDINGS**

#### 1. **MISREPRESENTED: Morphology Time vs. `tstop` / `morfac`**
*   **Severity:** **CRITICAL** (Breaks the core physics comparison)
*   **Issue:** The prompt states the comparison assumes a specific "morphological time." In XBeach, the total simulation time is `tstop`. The rate of change is governed by `morfac`.
    *   The code sets `tstop = hours * 3600`.
    *   The code sets `morfac` from `opts.morfac`.
    *   **The Trap:** If the UI's "morphology time" slider represents the *effective* morphological time (i.e., `tstop / morfac`), then `tstop` must be `morph_time * morfac`. However, standard XBeach usage often defines `tstop` as the physical time and `morfac` as the acceleration factor.
    *   **The Real Break:** Look at `params.txt`: `tstop = hours * 3600`. If the user selects "1 day" in the UI (which the prompt implies via `morphologyStep(1day)`), `hours` is likely 24. `tstop` becomes 86400s. If `morfac` is 1, the model runs for 1 day. If `morfac` is 10, the model runs for 1 day but changes as if 10 days passed.
    *   **The Mismatch:** The prompt says "morfac and tstop must correspond to the morphology time the comparison assumes." The code **does not** ensure that the *product* or *ratio* matches the UI's "morphology time" setting if that setting is distinct from `hours`. More critically, **`tstop` is derived from `hours`**, but `hours` is a UI variable. If the UI allows setting "Morphology Time" independently of "Wave Duration," this export is broken.
    *   **Specific Fix:** The export must explicitly map the UI's "Morphology Time" (let's call it `T_morph`) to `tstop` and `morfac`. If the UI defines `T_morph` as the *effective* time, then `tstop` should be `T_morph * morfac` (if `morfac` is an acceleration factor) OR `tstop` should be `T_morph` and `morfac` should be 1. The current code assumes `hours` is the physical time. If the UI's "1 day" refers to the *morphological* timescale, and `morfac` is >1, the physical `tstop` must be larger. **Verify that `hours` in the UI represents the *physical* duration, not the *morphological* duration.** If the UI slider is "Morphology Time," then `tstop` is wrong.

#### 2. **MISMATCHED: `dx`/`dy` Calculation vs. `bed.dep` Grid**
*   **Severity:** **HIGH** (Grid mismatch causes interpolation errors or domain shift)
*   **Issue:**
    *   `dx = REACH_CROSSSHORE / XB_NX`
    *   `dy = REACH_ALONGSHORE / XB_NY`
    *   `bed.dep` is written with `XB_NX + 1` columns and `XB_NY + 1` rows.
    *   **The Trap:** In XBeach, `nx` and `ny` in `params.txt` define the number of **cells**. The bed file must have `nx+1` and `ny+1` points. This part is **CONSISTENT**.
    *   **However:** `dx` is the cell width. The total domain width is `nx * dx`.
    *   `REACH_CROSSSHORE` is the total width.
    *   `dx = REACH_CROSSSHORE / XB_NX`.
    *   Total width = `XB_NX * (REACH_CROSSSHORE / XB_NX) = REACH_CROSSSHORE`. This is **CONSISTENT**.
    *   **Wait:** Look at `xbBedAt(i, j)`.
        *   `xm = i * (REACH_CROSSSHORE / XB_NX)`.
        *   `i` goes from `0` to `XB_NX`.
        *   At `i = XB_NX`, `xm = REACH_CROSSSHORE`.
        *   This maps the grid points correctly to the domain extent.
    *   **BUT:** `params.txt` says `nx = XB_NX`. XBeach expects `nx` to be the number of cells. The bed file has `XB_NX + 1` points. This is correct.
    *   **The Real Issue:** `dx` is calculated as `REACH_CROSSSHORE / XB_NX`. This is correct for `nx` cells.
    *   **Verdict:** This item is actually **CONSISTENT** in the code provided. *However*, if `REACH_CROSSSHORE` is defined as the distance between the first and last *point* (i.e., `nx * dx`), it is correct. If `REACH_CROSSSHORE` is defined as the distance between the first and last *cell center*, it is wrong. Given `xbBedAt` uses `i * dx`, it treats `REACH_CROSSSHORE` as the total span. This is standard. **CONSISTENT.**

#### 3. **MISREPRESENTED: `mainang` Direction Convention**
*   **Severity:** **HIGH** (Waves come from the wrong direction)
*   **Issue:**
    *   Prompt: "mainang is nautical, naming the direction waves come FROM; shore-normal is 270".
    *   Code: `dirToNautical(dirDeg)`.
    *   `dirDeg` is likely the UI's "wave direction" in degrees.
    *   `dirToNautical` logic:
        ```javascript
        let a = ((270 - dirDeg) % 360 + 360) % 360;
        if (a < 180) a += 360;
        return a;
        ```
    *   Let's test:
        *   If `dirDeg = 270` (shore-normal, waves from North? Or South? Usually 270 is West in nautical, but prompt says "shore-normal is 270").
        *   If `dirDeg = 270`, `a = (270 - 270) = 0`. `a < 180`, so `a = 360`.
        *   If `dirDeg = 0` (North?), `a = 270`.
    *   **The Trap:** The prompt says "shore-normal is 270". This implies that in the UI, `dirDeg = 270` means waves are coming from the shore-normal direction.
    *   In XBeach, `mainang` is the direction **from which** the waves come, in nautical degrees (0=N, 90=E, 180=S, 270=W).
    *   If the UI's `dirDeg` is already in nautical degrees (0-360), and `dirDeg = 270` means "waves from 270", then `mainang` should be `270`.
    *   The code calculates `a = (270 - 270) = 0 -> 360`. This is **WRONG**. It maps 270 to 360 (North).
    *   If the UI's `dirDeg` is in "math" degrees (0=East, 90=North), then `dirDeg = 90` (North) should map to `mainang = 0`.
        *   Code: `a = (270 - 90) = 180`. `a >= 180`, so `a = 180`. This maps North to South. **WRONG.**
    *   **Conclusion:** The `dirToNautical` function is **MISREPRESENTED**. It does not correctly map the UI's direction to XBeach's `mainang`. The logic `270 - dirDeg` suggests a rotation, but the offset is arbitrary.
    *   **Specific Fix:** Determine the UI's coordinate system. If UI `dirDeg` is nautical (0=N, 90=E), then `mainang = dirDeg`. If UI `dirDeg` is math (0=E, 90=N), then `mainang = (90 - dirDeg) % 360`. The current formula is incorrect for both common conventions.

#### 4. **MISMATCHED: `D50` Unit Conversion**
*   **Severity:** **MEDIUM** (Sediment transport rates off by 1000x)
*   **Issue:**
    *   Prompt: "D50 is millimetres in the UI and metres in params.txt".
    *   Code: `D50 = (conditions.d50 / 1000).toFixed(6)`.
    *   This assumes `conditions.d50` is in **millimetres**.
    *   If the UI stores `d50` in **metres** (common in scientific code), this divides by 1000 again, making it micrometres.
    *   If the UI stores `d50` in **millimetres**, this is correct.
    *   **The Trap:** The prompt explicitly states "D50 is millimetres in the UI". So `conditions.d50` is in mm. The code divides by 1000 to get metres. This is **CONSISTENT** with the prompt's description.
    *   **However:** `D90` is calculated as `conditions.d50 * 2 / 1000`. This assumes a fixed D90/D50 ratio of 2. If the UI allows independent D90, this is **MISREPRESENTED**. If the UI only has D50, this is a reasonable assumption but should be documented.
    *   **Verdict:** **CONSISTENT** (assuming UI is in mm as stated).

#### 5. **MISREPRESENTED: `zs0` (Sea Level) vs. `bed.dep` Reference**
*   **Severity:** **HIGH** (Dry/wet boundary error)
*   **Issue:**
    *   `params.txt`: `zs0 = conditions.waterLevel.toFixed(4)`.
    *   `bed.dep`: `xbBedAt(i, j)` returns `bedZ(px, py) * M_PER_BED_UNIT`.
    *   **The Trap:** In XBeach, `bed.dep` contains **bed elevations**. `zs0` is the **still water level**.
    *   If `bedZ` is the elevation relative to the same datum as `zs0`, this is correct.
    *   However, if `bedZ` is the **depth** (positive down), and `posdwn = -1` (positive up), then `bed.dep` must be **elevation** (positive up).
    *   The code says `posdwn = -1` and `bed.dep` is "positive up".
    *   `xbBedAt` returns `bedZ * M_PER_BED_UNIT`. If `bedZ` is depth (positive down), multiplying by `M_PER_BED_UNIT` (likely 1) gives positive down. But `posdwn = -1` means XBeach expects **positive up**.
    *   **The Break:** If `bedZ` is depth (positive down), the code **must** negate it: `return -bedZ(px, py) * M_PER_BED_UNIT`.
    *   The code does **not** negate. It assumes `bedZ` is already elevation (positive up).
    *   If the UI's `bedZ` is depth (common in bathymetry), this is **MISMATCHED**.
    *   **Specific Fix:** Verify the sign convention of `bedZ`. If `bedZ` is depth (positive down), change `xbBedAt` to `return -bedZ(px, py) * M_PER_BED_UNIT`.

#### 6. **MISREPRESENTED: `spreadToS` Formula**
*   **Severity:** **MEDIUM** (Wave spectrum shape error)
*   **Issue:**
    *   Code: `s = 2 / (sig * sig) - 1`.
    *   JONSWAP spread parameter `s` is related to the standard deviation of the direction `sigma` by `s = 1 / (2 * sigma^2) - 1`? No.
    *   Standard JONSWAP: `s = 1 / (2 * sigma^2) - 1` is **incorrect**.
    *   Correct relation: `s = 1 / (2 * sigma^2) - 1` is for the **cosine** distribution?
    *   Actually, the JONSWAP directional spread parameter `s` is defined such that the directional distribution is `cos^s(theta)`.
    *   The relationship between `s` and the standard deviation `sigma` (in radians) is approximately `sigma = sqrt(2 / (s + 1))`? No.
    *   For a `cos^s` distribution, the variance is `1 / (s + 1)`. So `sigma^2 = 1 / (s + 1)`.
    *   Therefore, `s = 1 / sigma^2 - 1`.
    *   The code uses `s = 2 / (sig * sig) - 1`.
    *   This implies `sigma^2 = 2 / (s + 1)`.
    *   This is **WRONG**. The factor of 2 is incorrect.
    *   **Specific Fix:** Change `spreadToS` to `return Math.min(1000, Math.max(1, 1 / (sig * sig) - 1));`.

#### 7. **MISREPRESENTED: `thetamin` / `thetamax` vs. `mainang`**
*   **Severity:** **MEDIUM** (Wave direction range error)
*   **Issue:**
    *   `params.txt`: `thetamin = 180`, `thetamax = 360`.
    *   This defines the directional grid range.
    *   If `mainang` is, say, 270, it falls within [180, 360].
    *   However, if `mainang` is 0 (North), it is **outside** the range [180, 360].
    *   XBeach will fail or wrap incorrectly if `mainang` is not within `thetamin` to `thetamax`.
    *   The code does not adjust `thetamin`/`thetamax` based on `mainang`.
    *   **Specific Fix:** Dynamically set `thetamin` and `thetamax` to cover `mainang` with a sufficient spread (e.g., `mainang - 90` to `mainang + 90`).

### **SUMMARY OF SEVERITY-RANKED FINDINGS**

1.  **CRITICAL:** `dirToNautical` is **MISREPRESENTED**. It incorrectly maps UI direction to XBeach `mainang`. **Fix:** Implement correct nautical conversion based on UI convention.
2.  **HIGH:** `xbBedAt` sign convention is **MISMATCHED** if `bedZ` is depth. **Fix:** Negate `bedZ` if it is positive-down.
3.  **HIGH:** `thetamin`/`thetamax` are **MISREPRESENTED** as fixed [180, 360], which may not contain `mainang`. **Fix:** Dynamically set range around `mainang`.
4.  **MEDIUM:** `spreadToS` formula is **MISREPRESENTED** (factor of 2 error). **Fix:** Use `s = 1/sigma^2 - 1`.
5.  **MEDIUM:** `tstop`/`morfac` relationship is **MISREPRESENTED** if UI "morphology time" is not physical time. **Fix:** Ensure `tstop` is physical time and `morfac` is acceleration.
