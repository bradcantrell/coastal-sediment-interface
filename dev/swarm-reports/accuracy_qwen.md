# accuracy / qwen (qwen/qwen3.8-27b)

Here is the adversarial physics audit of the provided reduced coastal-wave model.

### **CRITICAL**

**1. `morphologyStep`: Volume Non-Conservation (The "Headline" Asymmetry)**
*   **Finding:** The implicit diffusion solver enforces a zero-flux boundary condition at the offshore and onshore limits of the active grid (`diag[gx] = 1 + rr * nb`). This creates a **closed system** where the total volume of sand within the grid is strictly conserved.
*   **Physics Error:** In reality, storm erosion removes sand from the active profile and deposits it in the nearshore bar zone (which is often outside the "active" morphological grid or treated as a sink/source in one-line models). By forcing the system to be closed, the model *must* deposit every unit of eroded sand back into the active grid. Since the equilibrium target (`equilibriumZ`) lowers the upper profile (erosion) and raises the bar (accretion), the solver pushes sand from the eroding zone to the accreting zone.
*   **Result:** This artificially amplifies bar accretion because there is no "loss" to the deep water or offshore sediment transport. XBeach (and reality) allows sand to be transported offshore or into the bar zone where it may not immediately return to the active profile. The "3x more sand in the bar" is a direct artifact of this closed-box constraint combined with the specific equilibrium shape.
*   **Fix:** Implement a **source/sink term** or an **open boundary condition** at the offshore edge. Specifically, allow sand to leave the active grid if the local equilibrium depth is greater than the current depth (offshore transport) or if the gradient drives flux out of the domain. Alternatively, couple the active grid to a "bar reservoir" that can accept sand without forcing it back into the active profile immediately.

**2. `transformComponent`: Inconsistent Breaking/Dissipation Logic**
*   **Finding:** The code calculates a dissipation term `D` based on `Hmax` (the breaking limit) and subtracts it from the energy `E`. However, it then applies a hard cap `if (H > Hmax) H = Hmax`.
*   **Physics Error:** The Battjes-Janssen dissipation formula is an *approximation* for the energy loss *during* breaking. If the wave is already at the breaking limit (`H == Hmax`), the dissipation should be maximal. However, the code calculates `D` using `Hmax` regardless of the current `H`. If `H < Hmax`, `D` is still calculated as if the wave were breaking, leading to excessive energy loss for non-breaking waves. Conversely, if `H > Hmax` (which shouldn't happen due to the cap, but numerically might before the cap), the logic is inconsistent.
*   **More Critically:** The dissipation term `D` is derived from `Hmax`, but the energy `E` is derived from the *current* `H`. If `H` is significantly less than `Hmax`, the code is subtracting a large amount of energy (based on the breaking wave) from a small energy pool (based on the non-breaking wave), potentially driving `E` negative (clamped to 0) and causing `H` to collapse to 0 prematurely. This is a **numerical instability** that causes artificial wave damping.
*   **Fix:** The dissipation `D` should be proportional to the *actual* wave height `H` or use a smooth function of `H/Hmax` (e.g., `Qb` should depend on `H/Hmax`, not `Hmax/Hrms` which is always >1 if H<Hmax). The standard Battjes-Janssen form is `D = 0.25 * rho * g * (1/T) * (H/Hb)^2 * Hb^2 * exp(-(Hb/H)^2)`. The current code uses `Hmax` in the exponential and the prefactor, which is incorrect for non-breaking waves.

### **HIGH**

**3. `cercQ`: Incorrect Reference Angle for `sin(2*alpha)`**
*   **Finding:** The function `cercQ(Hb, alpha)` uses `alpha` directly in `Math.sin(2 * alpha)`.
*   **Physics Error:** The CERC formula for longshore sediment transport is $Q = K \frac{H_b^{2.5}}{\sqrt{\gamma}} \sin(2\alpha_b)$, where $\alpha_b$ is the **angle of wave approach relative to the shoreline normal** (i.e., the angle between the wave crest and the shoreline is $90^\circ - \alpha_b$).
*   **Code Context:** In `transformComponent`, `th` is the angle of the wave vector relative to the **shore-normal** (x-axis). The code stores `waveAngle[idx] = th`. Therefore, `alpha` in `cercQ` is the correct angle relative to the normal.
*   **Wait, let's re-verify:** The standard CERC formula is often written as $\sin(2\alpha)$ where $\alpha$ is the angle between the wave crest and the shoreline. If $\alpha_{normal}$ is the angle from the normal, then $\alpha_{crest} = 90^\circ - \alpha_{normal}$. Then $\sin(2\alpha_{crest}) = \sin(180^\circ - 2\alpha_{normal}) = \sin(2\alpha_{normal})$. So the factor is correct *if* `alpha` is the angle from the normal.
*   **However:** The code calculates `sinT` based on Snell's law. `sin0` is the deep water angle. `th` is the local angle. The code uses `th` as `alpha`. This is correct for the CERC formula *if* `th` is the angle from the normal.
*   **BUT:** Look at `transformComponent`. `sin0` is `Math.sin(comp.dirDeg * Math.PI / 180)`. If `dirDeg` is the direction *from* which the wave comes (meteorological convention) or the direction *to* which it goes? Usually, wave direction is given as the direction the wave is traveling. If `dirDeg` is 0, it travels in +x (onshore). `sin(0)=0`. `th=0`. `sin(2*0)=0`. Correct. If `dirDeg` is 90, it travels in +y (alongshore). `sin(90)=1`. `th=90`. `sin(180)=0`. Correct.
*   **Real Issue:** The CERC formula assumes `alpha` is the angle of the **breaking wave** relative to the **shoreline**. The code uses `waveAngle[idx]` which is the local angle `th`. This is correct.
*   **Re-evaluating Severity:** This might be **LOW** if the angle convention is consistent. However, many implementations use the angle relative to the *shoreline* (not normal). If `alpha` in `cercQ` is interpreted as the angle from the shoreline, then `sin(2*alpha)` would be wrong (it should be `cos(2*alpha)` or similar). Given the code uses `th` (angle from normal), and CERC uses `sin(2*alpha_normal)`, this is **CORRECT**.
*   **Correction:** I will downgrade this. The real issue is in the **next** point.

**4. `morphologyStep`: Implicit Diffusion Boundary Conditions are Physically Wrong for Open Ocean**
*   **Finding:** The Thomas algorithm setup uses `low[gx] = linkL ? -rr : 0` and `up[gx] = linkR ? -rr : 0`. At the boundaries (`gx=0` and `gx=GW-1`), one of the off-diagonals is zero. This enforces **zero flux** (Neumann BC) at both ends.
*   **Physics Error:** The offshore boundary should allow sediment to leave the domain (open boundary). The onshore boundary (dune) should be a fixed elevation or a no-flux boundary (if the dune is not eroding). The code *does* exclude the dune (`if (z > refWaterLevel + BERM_TOP_M) ... continue`), so the onshore boundary is effectively a no-flux wall, which is acceptable. However, the **offshore** boundary is also a no-flux wall. This is the root cause of the **CRITICAL** volume conservation issue. Sand cannot leave the system offshore.
*   **Fix:** Change the offshore boundary condition to a **Dirichlet** (fixed depth) or a **Robin** (flux proportional to gradient) condition that allows sand to be lost to the deep water.

**5. `deanA`: Settling Velocity Calculation is Dimensionally Inconsistent**
*   **Finding:** `deanA` calls `settlingVelocity(d50mm)`. Inside `settlingVelocity`, `d` is in meters. `Dstar` is calculated correctly. The return value is `(nu / d) * (...)`. `nu` is m²/s, `d` is m, so the result is **m/s**.
*   **In `deanA`:** `const ws = Math.max(settlingVelocity(d50mm) * 100, 0.1); // cm/s`. This converts m/s to cm/s. Correct.
*   **Dean's Formula:** $A = 0.067 w_s^{0.44}$, where $w_s$ is in **cm/s**.
*   **Check:** The code uses `ws` in cm/s. This is **CORRECT**.
*   **However:** The Dean profile $z = -A Y^{2/3}$ assumes $Y$ is in **meters** and $z$ is in **meters**. The code uses `Y` in meters (from `xMPerPx`). This is **CORRECT**.
*   **Wait:** The Dean coefficient $A$ is typically in the range of 0.1 to 0.2 for sand. If $w_s \approx 1$ cm/s, $A \approx 0.067$. This is reasonable.
*   **Re-evaluating:** This is **LOW** or **NO ISSUE**.

**6. `transformComponent`: Shoaling/Refraction Marching is Unstable**
*   **Finding:** The code marches shoreward in discrete steps `dxm`. It updates `H` using the ratio of group velocities. This is a first-order upwind scheme.
*   **Physics Error:** For steep waves or sharp bathymetry changes, this can lead to **numerical dispersion** and **energy gain** (if the step size is too large relative to the wavelength). The code does not check the Courant number.
*   **Fix:** Use a smaller step size or a higher-order scheme. However, given the "reduced" nature, this is a **LOW** severity issue unless the grid is very coarse.

### **LOW**

**7. `computeRunup`: Stockdon Formula Coefficients**
*   **Finding:** `runupSetup = 0.35 * b * root` and `runupSwash = 0.5 * Math.sqrt(...)`.
*   **Physics Error:** The Stockdon et al. (2006) formula is $R_{2\%} = 1.1 (R_{setup} + R_{swash})$. The coefficients 0.35 and 0.5 are empirical fits. The code uses `b` (slope) and `H0/L0`. This is **CORRECT** for the simplified form.
*   **Note:** The code uses `conditions.slope` for `b`. This is the foreshore slope. Correct.

**8. `stormIntensity`: Linear Combination**
*   **Finding:** `stormIntensity` is a linear combination of wave height and water level.
*   **Physics Error:** This is a heuristic. It does not account for the interaction between waves and surge (e.g., wave setup). However, for a reduced model, this is acceptable. **LOW**.

### **Summary of Fixes**

1.  **CRITICAL:** `morphologyStep`: Change the offshore boundary condition from zero-flux to an open boundary (allow sand loss) to fix the volume conservation error and excessive bar accretion.
2.  **CRITICAL:** `transformComponent`: Fix the Battjes-Janssen dissipation term to depend on the *current* wave height `H` relative to `Hmax`, not just `Hmax`, to prevent artificial damping of non-breaking waves.
3.  **HIGH:** `morphologyStep`: Ensure the onshore boundary (dune) is correctly handled as a no-flux or fixed-elevation boundary, but the primary issue is the offshore boundary.
4.  **LOW:** `transformComponent`: Consider checking the Courant number for the marching scheme to ensure stability.

### **Final Severity-Ranked List**

1.  **CRITICAL** - `morphologyStep`: **Closed-box volume conservation.** The zero-flux boundary at the offshore edge forces all eroded sand to be redeposited within the active grid, artificially amplifying bar accretion. **Fix:** Implement an open offshore boundary condition that allows sediment to leave the domain (sink term).
2.  **CRITICAL** - `transformComponent`: **Incorrect Dissipation Scaling.** The Battjes-Janssen dissipation `D` is calculated using `Hmax` (breaking height) even when the current wave height `H` is much smaller. This leads to excessive energy loss for non-breaking waves. **Fix:** Scale `D` by `(H/Hmax)^2` or use the standard form `D = 0.25 * rho * g * (1/T) * (H^2/Hmax) * exp(-(Hmax/H)^2)`.
3.  **HIGH** - `morphologyStep`: **Implicit Diffusion Stability.** The implicit solver is stable, but the physical boundary conditions are wrong (see #1). The "zero-flux" at the offshore edge is the primary driver of the asymmetry.
4.  **LOW** - `cercQ`: **Angle Convention.** The use of `sin(2*alpha)` where `alpha` is the angle from the normal is correct for the CERC formula. No fix needed, but verify that `waveAngle` is indeed the angle from the normal (it is, based on `th`).
5.  **LOW** - `deanA`: **Settling Velocity.** The calculation is dimensionally consistent and uses the correct units for Dean's formula. No fix needed.
