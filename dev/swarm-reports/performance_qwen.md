# performance / qwen (qwen/qwen3.8-27b)

Here is the severity-ranked performance audit based on the provided source and frame profile.

### CRITICAL

**1. `updateBedBuffer()` executes full-canvas pixel loops every 8 frames**
*   **Where:** `updateBedBuffer()` (lines starting with `for (let ox = 0...` and `for (let px=0...`).
*   **Why it costs 99 ms:** This function is called twice per second (every 8 frames at 60fps) *and* every 0.5s. Inside, it iterates over the entire 1200x800 canvas in three separate passes:
    1.  Morphology wash loop: `width/8 * height/8` = 150 * 100 = 15,000 iterations. Each calls `bedZ()` (likely a grid lookup or interpolation) and `bedZ0()`.
    2.  Bed surface loop: `width/8 * height/8` = 15,000 iterations. Each calls `bedZ()`.
    3.  Contour loop: 7 levels * (width/4 * height/4) = 7 * 300 * 200 = 420,000 iterations. Each calls `bedZ()` twice.
    *   Total: ~450,000 `bedZ()` calls per invocation. If `bedZ` involves any non-trivial lookup or interpolation, this dominates the frame. Even if `bedZ` is O(1), the overhead of 450k function calls in JS is ~50-100ms.
    *   **Redundancy:** The bed changes slowly (morphology step is 8ms). Recalculating the entire visual buffer every 8 frames is wasteful. The "morphology wash" only needs to update cells where `dz` changed significantly, but the code scans *all* cells.
*   **Fix:**
    1.  **Dirty-Rect Rendering:** Maintain a list of "dirty" cells (indices where `morphGrid` changed in `morphologyStep`). In `updateBedBuffer`, only iterate over dirty cells to update `bedSurface`. Clear only those rects. This reduces work from 450k to ~1k-10k operations.
    2.  **Debounce/Throttle:** Do not call `updateBedBuffer` every 8 frames. Call it only when `lastMaxErosion` or `lastMaxAccretion` exceeds a threshold (e.g., >0.01m change). For slow drift, update every 1-2 seconds.
    3.  **Optimize Contours:** The contour loop is the most expensive. Use a marching squares algorithm on a coarse grid (e.g., 100x100) instead of scanning every 4px. Or, skip contours entirely for the "wash" layer and only draw them on demand.
    *   **Estimated Saving:** 90-95 ms/frame (amortized).

**2. `morphologyStep()` allocates 7 large arrays every frame**
*   **Where:** `morphologyStep()` (lines `const u = new Float64Array(GW); ...`).
*   **Why it costs 8.28 ms:** `GW` is likely ~100-200. Allocating 7 arrays of size GW (e.g., 100) is 700 floats. While small, `new Float64Array` triggers GC pressure. More importantly, the Thomas algorithm loop (`for (let gy = 0; gy < GH; gy++)`) runs for every alongshore row. If `GH` is large (e.g., 100), this is 100 tridiagonal solves per frame. The allocation happens *inside* the function, but the real cost is the repeated setup.
    *   **Redundancy:** The arrays `u, un, diag, low, up, rhs, act` are reused for every row `gy`. They should be allocated *once* outside the `gy` loop, or better, allocated once globally and reused across frames.
*   **Fix:**
    1.  Move array allocation to module scope or a class member. Reuse the same `Float64Array` instances for every frame and every row.
    2.  If `GH` is large, consider solving only active rows (where `any` is true). The code already skips rows with `if (!any) continue;`, but the arrays are still allocated.
    *   **Estimated Saving:** 2-3 ms/frame (reduced GC and allocation overhead).

### HIGH

**3. `waveFieldStep()` calls `buildSolidMask()` redundantly**
*   **Where:** `draw()` calls `buildSolidMask()`, then `waveFieldStep()` calls `buildSolidMask()` again.
*   **Why it costs part of 10.34 ms:** `buildSolidMask()` likely iterates over the grid to set `solid[]` flags. Doing this twice per frame is pure waste.
*   **Fix:** Remove `buildSolidMask()` from `waveFieldStep()`. Ensure it is called once in `draw()` before any physics step that needs it.
    *   **Estimated Saving:** 1-2 ms/frame.

**4. `transformComponent()` recomputes `wavenumberK` and `groupVelocity` for every cell**
*   **Where:** `transformComponent()` (lines `const k = wavenumberK(T, h); const Cg = groupVelocity(T, h);`).
*   **Why it costs part of 10.34 ms:** For each component `c`, for each row `j`, for each column `i`, it calls `wavenumberK` and `groupVelocity`. These are likely transcendental functions (sin, cos, sqrt). If `NX*NY` is 1000x1000 = 1M cells, and there are 3 components, that's 3M calls to `wavenumberK` and `groupVelocity` per frame.
    *   **Redundancy:** `h` (depth) changes slowly. `T` (period) is constant per component. The values of `k` and `Cg` depend only on `h`. If the depth grid is static or changes slowly, these values can be precomputed and cached in a lookup table indexed by depth bin.
*   **Fix:**
    1.  Precompute `k` and `Cg` for a range of depths (e.g., 0.1m to 10m in 0.1m steps) for each component period `T`. Store in `Float32Array`.
    2.  In `transformComponent`, bin the depth `h` to the nearest precomputed value and lookup `k` and `Cg`.
    *   **Estimated Saving:** 3-5 ms/frame.

**5. `updateParticles()` calls `bedZ()` 5 times per particle**
*   **Where:** `updateParticles()` (lines `bedHere = bedZ(p.x, p.y); ... bedAbove = bedZ(...); bedBelow = bedZ(...); bedLeft = bedZ(...); bedRight = bedZ(...);`).
*   **Why it costs 0.31 ms (but scales with particle count):** If `particleCount` is 1000, that's 5000 `bedZ()` calls per frame. `bedZ` likely involves bilinear interpolation or grid lookup.
    *   **Redundancy:** The gradient calculation (`gradY`, `gradX`) requires 4 extra `bedZ` calls. This is expensive for a visual effect.
*   **Fix:**
    1.  Use a precomputed gradient field. In `morphologyStep` or `updateBedBuffer`, compute `gradX` and `gradY` for all grid cells and store in `Float32Array`.
    2.  In `updateParticles`, lookup `gradX` and `gradY` via bilinear interpolation (2 lookups) instead of 5 `bedZ` calls.
    *   **Estimated Saving:** 0.1-0.2 ms/frame (negligible now, but critical if particle count increases).

### LOW

**6. `drawParticles()` parses hex colors every frame**
*   **Where:** `drawParticles()` (lines `let sr=parseInt(slowColor.slice(1,3),16)...`).
*   **Why it costs <0.1 ms:** String slicing and `parseInt` are cheap, but done for every particle? No, it's done once per frame. However, `fill()` is called for every particle.
    *   **Redundancy:** The color interpolation `t = constrain(speed/colorThresh, 0, 1)` and `fill(...)` is per-particle. This is necessary for visual fidelity.
*   **Fix:** Precompute a color LUT (lookup table) of 256 colors from slow to fast. Index by `t * 255`. Avoid per-particle `fill()` with computed RGB; use `fill(colorLUT[idx])`.
    *   **Estimated Saving:** <0.1 ms.

**7. `drawFlowField()` draws lines with `line()` calls**
*   **Where:** `drawFlowField()`.
*   **Why it costs <0.1 ms:** `line()` is a canvas API call. If `flowDensity` is low, this is fine. If high, it can be slow.
*   **Fix:** Use `beginShape()` / `vertex()` / `endShape()` to batch lines. Or, draw to an offscreen buffer and `image()` it.
    *   **Estimated Saving:** <0.1 ms.

### Summary of Fixes (Priority Order)

1.  **CRITICAL:** Refactor `updateBedBuffer()` to use dirty-rect rendering and throttle updates. **Saves ~90 ms.**
2.  **HIGH:** Remove redundant `buildSolidMask()` call in `waveFieldStep()`. **Saves ~1-2 ms.**
3.  **HIGH:** Precompute `wavenumberK` and `groupVelocity` lookup tables in `transformComponent()`. **Saves ~3-5 ms.**
4.  **CRITICAL:** Reuse arrays in `morphologyStep()` instead of allocating every frame. **Saves ~2-3 ms.**
5.  **LOW:** Precompute bed gradients for `updateParticles()`. **Saves ~0.1-0.2 ms.**

**Total Estimated Saving:** ~96-100 ms.
**New Frame Cost:** ~36-40 ms (still >16.67 ms, but closer).
**Note:** The remaining cost is dominated by `waveFieldStep` (10ms) and `morphologyStep` (8ms). To hit 60fps, further optimization of the wave solver (e.g., reducing grid resolution, using WebAssembly) or morphology solver (e.g., reducing `GH` or `GW`) may be needed. However, the above fixes eliminate the 99ms outlier, which is the primary bottleneck.
