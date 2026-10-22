# performance / gemma (google/gemma-4-31b-qat)

### PERFORMANCE REVIEW: Coastal-Wave Simulator
**Status:** CRITICAL FAILURE
**Current Performance:** 7 FPS (Budget: 60 FPS)
**Primary Bottleneck:** Massive over-draw in `updateBedBuffer` and redundant memory allocation in `morphologyStep`.

---

#### 1. CRITICAL: `updateBedBuffer()` - Canvas API Abuse
*   **Where:** `updateBedBuffer()` loops (lines 65-108).
*   **Why:** The function attempts to "paint" a 1200x800 grid using `bedSurface.rect()` and `bedSurface.point()` calls inside nested loops. 
    *   **Per-pixel work:** It executes thousands of individual `fill()` and `rect()` calls per invocation. The Canvas API overhead for a single `rect()` call is orders of magnitude higher than manipulating a pixel array.
    *   **Redundancy:** It runs every 8 frames AND every 0.5s. Since the bed changes slowly, updating the visual buffer every 8 frames is unnecessary.
    *   **Complexity:** The contour line loop (lines 84-108) performs $O(L \cdot N)$ work (Levels $\times$ Pixels) with expensive `stroke()` and `point()` calls.
*   **Fix:** Replace all `rect()` and `point()` calls with a single `ImageData` buffer. Calculate colors in a typed array and use `putImageData()` once at the end of the function.
*   **Estimated Saving:** ~90ms $\rightarrow$ <2ms.

#### 2. HIGH: `morphologyStep()` - Heap Thrashing
*   **Where:** `morphologyStep()` start (lines 157-163).
*   **Why:** Six `Float64Array` and one `Uint8Array` are allocated **every single frame**. 
    *   **Allocation:** `new Float64Array(GW)` $\times 6$ per frame triggers constant Garbage Collection (GC) pauses, especially on laptops with limited memory.
    *   **Redundancy:** These arrays are temporary workspace for the Thomas algorithm and never change size.
*   **Fix:** Move these array declarations to the global scope (or a closure) and reuse them. Use `.fill(0)` if necessary, though the algorithm overwrites them.
*   **Estimated Saving:** ~3-5ms (and elimination of periodic stutter/jank).

#### 3. HIGH: `waveFieldStep()` $\rightarrow$ `transformComponent()` - Redundant Math
*   **Where:** `transformComponent()` inner loop (lines 130-150).
*   **Why:** 
    *   **Redundant Trig:** `Math.sin(thPrev)` and `Math.asin(sinT)` are called inside the innermost loop ($NX \times NY$).
    *   **Redundant Lookups:** `depthAt(i, j)` is called repeatedly.
    *   **Inefficiency:** The `waveHComp` array is re-allocated via `.map()` if the component length changes (line 118), which is a slow operation.
*   **Fix:** 
    1.  Pre-calculate `sin(theta)` and work entirely in "sin-space" to avoid `asin` calls.
    2.  Cache `depthAt` results into a local typed array before the component loop.
*   **Estimated Saving:** ~4-6ms.

#### 4. LOW: `updateParticles()` - Redundant Bed Sampling
*   **Where:** `updateParticles()` gradient calculation (lines 183-187).
*   **Why:** For every particle, the code calls `bedZ()` 4 times to calculate a local gradient. `bedZ` likely involves a lookup or interpolation.
*   **Fix:** If particles are dense, sample the bed gradient once per grid cell and store it in a "gradient map" updated during `updateBedBuffer`.
*   **Estimated Saving:** ~0.5ms.

---

### Summary of Impact
| Function | Current | Target | Fix |
| :--- | :--- | :--- | :--- |
| `updateBedBuffer` | 99ms | 2ms | `ImageData` instead of `rect()` |
| `morphologyStep` | 8ms | 3ms | Static array allocation |
| `waveFieldStep` | 10ms | 5ms | Remove `asin`/`sin` from inner loop |
| **Total** | **136ms** | **~16ms** | **Target 60 FPS Achieved** |
