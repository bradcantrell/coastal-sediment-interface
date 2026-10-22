# calm / qwen (qwen/qwen3.8-27b)

Here is the adversarial review of the reduced coastal morphology solver.

### **CRITICAL FINDING: Sign Convention Mismatch in Cross-Shore Coordinate**

**Mechanism:**
The solver defines the cross-shore coordinate `Y` as `Y = (xShore - x) * xMPerPx`.
*   **Offshore** (where `x < xShore`): `Y` is **positive**.
*   **Onshore** (where `x > xShore`): `Y` is **negative**.

However, the `equilibriumZ` function implements the Dean profile as:
```javascript
if (Y >= 0) {
    let h = A * Math.cbrt(Y * Y); // h is positive depth
    return wl - h;                // z = wl - depth
}
```
This is physically correct for the standard Dean profile $z = -A y^{2/3}$ where $y$ is distance offshore.

**The Error:**
Look at `defaultCoastalBedZ`:
```javascript
const Y = (xShore - x) * xMPerPx;
if (Y >= 0) {                                     // shoreface: Dean h = A y^(2/3)
    return (wl - A * Math.pow(Y, 2 / 3)) / M_PER_BED_UNIT;
}
```
This matches `equilibriumZ`. So far, so good.

**BUT**, look at the `morphologyStep` calculation of `u`:
```javascript
const Y = (xShore - x) * xMPerPx;
u[gx] = z - equilibriumZ(Y, stormNow, A);
```
And the diffusion equation:
```javascript
d u / d t = (D/(1-p)) d2u/dx^2
```
The variable `u` is the *deviation* from equilibrium. The solver relaxes `u` to zero.

**The Critical Flaw:**
The question states: *"the bed lowers by a uniform ~0.2 m across the whole offshore profile... starting from what is supposed to be its own equilibrium profile."*

If the bed starts at equilibrium, `u` should be 0. If `u` is 0, `du` is 0. No change should occur.
The fact that a change *does* occur implies `u` is **not** zero.

Let's look at `shoreRefAt`:
```javascript
function shoreRefAt(gy) {
    if (!shoreRef) {
        shoreRef = new Float32Array(GH);
        refWaterLevel = conditions.waterLevel;
        for (let j = 0; j < GH; j++) {
            const s = shorelineXPx(j, true);
            shoreRef[j] = s === null ? -1 : s;
        }
    }
    return shoreRef[gy] >= 0 ? shoreRef[gy] : null;
}
```
`shorelineXPx` finds the x-coordinate where `bedZ0(x, y)` crosses `wlU` (water level).
`bedZ0` uses `wl = 0` (datum).
`shorelineXPx` uses `wlU = conditions.waterLevel / M_PER_BED_UNIT`.

**Scenario:**
1.  `defaultCoastalBedZ` builds the bed using `wl = 0`. The waterline is at `z=0`.
2.  `conditions.waterLevel` is likely **not** 0. It is the *live* water level.
3.  `shorelineXPx` calculates the shoreline position based on the *live* water level intersecting the *datum-based* bed.
4.  `equilibriumZ` uses `refWaterLevel` (captured at anchor time) as the reference for the equilibrium profile.

**The Mismatch:**
If `conditions.waterLevel` (live) $\neq$ `refWaterLevel` (anchor), the `shoreRef` (shoreline position) calculated in `shoreRefAt` is **shifted** relative to the equilibrium profile defined in `equilibriumZ`.

Specifically:
*   `equilibriumZ` assumes the waterline is at `refWaterLevel`.
*   `shoreRefAt` calculates the shoreline where the *actual* bed (built on datum 0) intersects the *live* water level.

If `conditions.waterLevel` > `refWaterLevel` (e.g., high tide or surge), the live waterline is higher. The intersection point `xShore` moves **onshore** (larger x).
Consequently, for a fixed offshore grid point `x`, the calculated `Y = (xShore - x)` becomes **larger** than it was when the bed was built.
Since `equilibriumZ` depends on `Y` (via $Y^{2/3}$), a larger `Y` implies a **deeper** equilibrium depth ($h$ increases).
Therefore, `equilibriumZ` returns a **lower** z-value.
The actual bed `z` is fixed (initially).
So `u = z - equilibriumZ` becomes **positive** (bed is higher than equilibrium).
The solver relaxes `u` towards 0 by lowering the bed (`du` is negative).

**This explains the uniform offshore lowering.** The solver is not relaxing a numerical artifact; it is relaxing a **physical mismatch** between the reference water level used to define the equilibrium profile and the reference water level used to locate the shoreline for that profile.

**Severity:** **CRITICAL**
**Function:** `shoreRefAt`, `equilibriumZ`, `defaultCoastalBedZ`
**Code Change:**
The `shoreRef` must be consistent with the `refWaterLevel` used in `equilibriumZ`.
Currently, `shorelineXPx` uses `conditions.waterLevel`. It should use `refWaterLevel`.

```javascript
function shorelineXPx(gj, base) {
    const y = (gj + 0.5) * DEPO_CELL;
    // FIX: Use refWaterLevel to be consistent with equilibriumZ
    const wlU = refWaterLevel / M_PER_BED_UNIT; 
    const fz = base ? bedZ0 : bedZ;
    let xPrev = 0, zPrev = fz(0, y);
    for (let x = DEPO_CELL; x <= width; x += DEPO_CELL) {
        const z = fz(x, y);
        if (zPrev < wlU && z >= wlU) {
            const t = (wlU - zPrev) / ((z - zPrev) || 1e-6);
            return xPrev + t * DEPO_CELL;
        }
        xPrev = x; zPrev = z;
    }
    return null;
}
```
*Note: Ensure `refWaterLevel` is initialized before `shoreRefAt` is first called. Currently it is set inside `shoreRefAt`, which is fine, but `shorelineXPx` must access it.*

---

### **HIGH FINDING: Discontinuous Slope at Waterline Causes Numerical Diffusion Artifact**

**Mechanism:**
The `equilibriumZ` function has a kink at `Y=0` (the waterline).
*   For `Y > 0`: $z = wl - A Y^{2/3}$. Slope $dz/dY = -A (2/3) Y^{-1/3} \to -\infty$ as $Y \to 0^+$.
*   For `Y < 0`: $z = wl + \text{slope} \cdot (-Y)$. Slope $dz/dY = -\text{slope}$ (finite).

The diffusion operator $\frac{d^2 u}{dx^2}$ is applied to `u`.
`u = z - z_eq`.
Since `z` is smooth (linear or smooth curve) and `z_eq` has an infinite slope discontinuity at the waterline, `u` has a **discontinuous derivative** at the waterline.

The finite difference approximation of the second derivative at a cell adjacent to a slope discontinuity is **unstable** or at least highly inaccurate. The "zero-flux" boundary condition at the dune is handled, but the **internal** discontinuity at the waterline is not.

The solver treats the waterline as an internal node. The tridiagonal solve assumes smoothness. The large gradient in `u` near the waterline will cause the implicit solver to "smear" the profile, potentially causing the observed uniform drift if the grid resolution is coarse relative to the steepness of the Dean profile near the waterline.

**Severity:** **HIGH**
**Function:** `morphologyStep`
**Code Change:**
The diffusion should not be applied across the waterline discontinuity, or the grid should be refined. A better fix is to recognize that the Dean profile is only valid for `Y > 0`. The solver should treat the waterline as a **boundary** between two different regimes, or simply not diffuse `u` across the waterline if the slope is discontinuous.

However, a simpler and more robust fix is to **clamp the slope** in `equilibriumZ` near `Y=0` to avoid the infinite derivative, or to **exclude the waterline cell** from the diffusion calculation (treat it as a fixed boundary for the diffusion step).

Given the "reduced" nature, the best fix is to **not diffuse across the waterline**. The waterline is a physical boundary between the submerged Dean profile and the emergent beach slope.

```javascript
// In morphologyStep, when building the tridiagonal matrix:
// Identify the waterline index for this row.
// If gx is adjacent to the waterline, do not link to the other side.

// Simpler fix: In the loop building low/up/diag:
// Check if the link crosses the waterline.
// We need to know the waterline index. Let's find it.
// This is complex. A simpler alternative:
// The problem is that u has a kink. The diffusion of u is physically questionable 
// if u is not a smooth field. 
// 
// Actually, the primary issue is the CRITICAL finding above. 
// If the waterline is consistent, u should be small. 
// The diffusion of a small u with a kink is less severe. 
// 
// However, to be safe, we can limit the diffusion coefficient D 
// or ensure the grid is fine enough. 
// 
// Let's stick to the CRITICAL fix as the primary solution. 
// The HIGH finding is a secondary numerical issue that may be masked 
// by the CRITICAL fix.
```

**Revised Severity:** **MEDIUM** (if CRITICAL is fixed).

---

### **LOW FINDING: Bilinear Interpolation vs. Analytical Evaluation**

**Mechanism:**
The question asks about the mismatch between rasterized bed (bilinear) and analytical `equilibriumZ`.
`bedZ` uses `userBedZ`, `depoZ`, `morphZ`, `longZ`.
`defaultCoastalBedZ` is the initial bed.
`morphologyStep` reads `bedZ(x, y)` which is a sum of fields.
If `userBedZ` is rasterized, it is interpolated.
`equilibriumZ` is analytical.

The mismatch is:
`u = z_raster - z_eq_analytical`.

If the raster is coarse, `z_raster` is a smoothed version of the true bed.
`z_eq_analytical` is the exact equilibrium.
The difference `u` contains a **rasterization error**.
The solver relaxes this error.
This is a **valid physical process** (the bed is not exactly at equilibrium due to discretization).
The magnitude depends on the grid resolution.
Given `DEPO_CELL` and `REACH_CROSSSHORE`, if the grid is fine, this error is small.
The observed 0.2 m drift is likely dominated by the CRITICAL finding.

**Severity:** **LOW**
**Function:** `morphologyStep`
**Code Change:** None required if grid resolution is adequate. If drift persists after CRITICAL fix, refine grid or use higher-order interpolation for `bedZ`.

---

### **LOW FINDING: Dune Boundary Condition**

**Mechanism:**
Cells above `BERM_TOP_M` are frozen (`act[gx] = 0`).
The solver sees a zero-flux wall.
This is physically correct: sand does not transport over the dune crest in this model.
Does it push sand seaward?
The zero-flux condition means $\frac{du}{dx} = 0$ at the boundary.
This is a Neumann boundary condition.
It does not inherently push sand seaward. It prevents sand from leaving the active domain.
If the equilibrium profile suggests sand should move onshore (towards the dune), the zero-flux condition will cause sand to **pile up** at the dune base, not move seaward.
The observed drift is **seaward** (offshore lowering, onshore accretion? No, "sand is being redistributed onshore" in the prompt, but "bed lowers... offshore").
Wait, the prompt says: "sand is not lost -- it is being redistributed onshore."
And "bed lowers... offshore".
This is consistent with onshore transport.
The dune boundary prevents sand from going *over* the dune, so it accumulates at the dune base.
This is correct behavior.

**Severity:** **LOW**
**Function:** `morphologyStep`
**Code Change:** None.

---

### **LOW FINDING: Offshore Boundary Condition**

**Mechanism:**
The offshore boundary is at `x=0`.
`act[gx]` is 1 for all offshore cells.
The tridiagonal solve uses `linkL = gx > 0 && ...`.
For `gx=0`, `linkL` is false.
`diag[0] = 1 + rr * Math.max(nb, 0)`.
`nb = (linkL ? 1 : 0) + (linkR ? 1 : 0)`.
For `gx=0`, `nb = 1` (if `linkR` is true).
`diag[0] = 1 + r`.
`low[0] = 0`.
`up[0] = -r`.
This is a standard zero-flux (Neumann) boundary condition.
It holds a uniform lowering?
If `u` is uniform, `du` is uniform.
The boundary condition does not introduce a bias.

**Severity:** **LOW**
**Function:** `morphologyStep`
**Code Change:** None.

---

### **CONCLUSION**

The primary cause of the observed drift is the **inconsistency between the water level used to define the equilibrium profile (`refWaterLevel`) and the water level used to locate the shoreline (`conditions.waterLevel`)**.

**Fix:**
1.  Modify `shorelineXPx` to use `refWaterLevel` instead of `conditions.waterLevel`.
2.  Ensure `refWaterLevel` is set before `shoreRefAt` is called.

This will align the `Y` coordinate in `equilibriumZ` with the `Y` coordinate used to build the initial bed, resulting in `u ≈ 0` and no drift.
