# calm / gemma (google/gemma-4-31b-qat)

### Adversarial Review: Coastal Morphology Solver

The observed behavior—a uniform lowering of the offshore profile ($\sim 0.2\text{m}$) and onshore migration of sand under calm conditions starting from equilibrium—indicates a systematic **positive disequilibrium** ($z > z_{eq}$) across the shoreface.

---

#### 1. CRITICAL: Datum Mismatch (The "Ghost Surge")
**Mechanism:** The initial bed is generated in `defaultCoastalBedZ` using a hardcoded datum `wl = 0`. However, the solver calculates disequilibrium in `morphologyStep` using `equilibriumZ`, which references `refWaterLevel` (captured from `conditions.waterLevel` at anchor time). If `conditions.waterLevel` is non-zero (e.g., $0.2\text{m}$), the solver perceives the entire bed as being $0.2\text{m}$ too high relative to the current water level's equilibrium. This creates a global pressure to move sand onshore to "sink" the bed to the new relative datum.

**Function:** `equilibriumZ` vs `defaultCoastalBedZ`
**Code Change:**
In `defaultCoastalBedZ`, replace `const wl = 0;` with `const wl = refWaterLevel;` (or ensure `refWaterLevel` is initialized before the bed is generated).

---

#### 2. HIGH: Boundary Condition Leak (Dune Wall)
**Mechanism:** The solver implements a zero-flux condition at the dune boundary (`z > refWaterLevel + BERM_TOP_M`). However, the `equilibriumZ` function defines a linear beach slope and storm scarp landward of the waterline. If the `BERM_TOP_M` cutoff occurs at a point where the actual bed height is slightly higher than the analytical `equilibriumZ` (which is common due to the transition from Dean to linear slope), the implicit diffusion operator will push sand from the active cells toward the "frozen" dune wall. Because the wall is a zero-flux boundary, sand accumulates at the landward edge of the active zone, causing the offshore region to lower to satisfy volume conservation.

**Function:** `morphologyStep` (Active cell logic)
**Code Change:**
The `act[gx] = 0` logic is too blunt. The boundary between active and inactive cells should be handled by ensuring the `equilibriumZ` target at the boundary exactly matches the frozen bed height, or by implementing a soft transition. Specifically, ensure `equilibriumZ` is clamped to the bed height at the `BERM_TOP_M` interface.

---

#### 3. LOW: Numerical Diffusion at Waterline (Singularity)
**Mechanism:** `equilibriumZ` uses `cbrt(Y*Y)`. The derivative $\frac{dz}{dY} \propto Y^{-1/3}$ approaches infinity as $Y \to 0$. In a discrete grid, the cell adjacent to the waterline ($Y \approx 0$) experiences an extremely steep gradient. The implicit solver (central difference approximation) will over-respond to this singularity, effectively "sucking" sand from the immediate offshore cells to fill the steep void at the waterline. While this causes local noise, it contributes to the overall offshore lowering.

**Function:** `equilibriumZ`
**Code Change:**
Introduce a small epsilon to the Dean term to regularize the derivative:
`let h = A * Math.cbrt(Y * Y + 1e-3);`

---

### Evaluation of Proposed Causes

*   **Bilinear Interpolation (Cause 1):** **WRONG.** Bilinear interpolation of a smooth Dean curve introduces negligible error ($\sim 10^{-3}\text{m}$), not a $0.2\text{m}$ shift.
*   **One-sided Implicit Solve (Cause 5):** **WRONG.** The Thomas algorithm implementation correctly handles the tridiagonal matrix. The "zero-flux" is correctly implemented via the `nb` (neighbor) count and `diag` adjustment; it is numerically stable and not the source of a uniform shift.
