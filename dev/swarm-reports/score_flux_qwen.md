# flux / qwen (qwen/qwen3.8-27b)

**ADVERSARIAL REVIEW: WAVE TRANSFORMATION SCHEME**

**PRECISION SCORE VERDICT:** The reported score of 65.8 is **optimistic**. The "flux residual" metric (0.0181) is misleading because it measures the *output* consistency of a scheme that is fundamentally **non-conservative** in its intermediate steps. The 1.8% relative standard deviation in $H^2 C_g \cos\theta$ is not numerical noise; it is a systematic error introduced by the **order of operations** in the shoaling calculation.

The core failure is that the code calculates the new wave height $H$ using the *previous* cell's flux, then applies dissipation and breaking caps, and *then* updates the state variables for the next step. This breaks the exact conservation of energy flux $F = \frac{1}{8}\rho g H^2 C_g \cos\theta$ across the march.

---

### SEVERITY-RANKED FINDINGS

#### 1. CRITICAL: Non-Conservative Shoaling Update (Order of Operations)
**Mechanism:**
The code computes $H_{new}$ using the ratio of fluxes:
$$ H_{new} = H_{prev} \sqrt{\frac{F_{prev}}{F_{new}}} $$
where $F = C_g \cos\theta$.
However, $F_{new}$ is calculated using $\theta_{new}$ (derived from Snell's law) and $C_{g,new}$ (derived from local depth). This is correct *if* no energy is lost.
**The Error:** The code then applies Battjes-Janssen dissipation ($D$) and the breaking cap ($H \le \gamma h$) *after* this calculation.
1.  If $H_{new}$ is capped, the actual flux at this cell is $F_{actual} = \frac{1}{8}\rho g H_{capped}^2 C_{g,new} \cos\theta_{new}$.
2.  The next cell uses $H_{prev} = H_{capped}$ and $F_{prev} = C_{g,new} \cos\theta_{new}$.
3.  **Crucially:** The dissipation term $D$ is subtracted from the energy $E$, but the flux $F$ used in the *next* step's shoaling ratio is still based on the *uncapped* $C_g$ and $\theta$. The code does not re-calculate the effective flux *after* dissipation to ensure the next step's shoaling compensates for the lost energy.

In a conservative scheme, the flux $F$ must be continuous. If energy is lost ($D > 0$), the flux $F$ decreases. The next step should shoal based on the *reduced* flux. The current code shoals based on the *theoretical* flux (pre-dissipation), then subtracts energy. This creates a mismatch: the wave height is too high for the actual energy content, leading to an overestimation of flux in subsequent steps (or underestimation, depending on the sign of the error).

**Line:**
```javascript
      const fluxPrev = Math.max(CgPrev * Math.cos(thPrev), 1e-6);
      const flux     = Math.max(Cg * Math.cos(th), 1e-6);
      let H = Hprev * Math.sqrt(fluxPrev / flux);
      // ... dissipation and cap applied here ...
      Hprev = H; thPrev = th; kPrev = k; CgPrev = Cg;
```

**Exact Fix:**
The shoaling step must be derived from the **conservation of energy flux**. The flux $F$ is proportional to $H^2 C_g \cos\theta$.
If we assume no breaking/dissipation, $H_{new} = H_{prev} \sqrt{\frac{C_{g,prev} \cos\theta_{prev}}{C_{g,new} \cos\theta_{new}}}$.
However, when dissipation $D$ is present, the flux change is:
$$ F_{new} = F_{prev} - D \cdot \Delta x $$
$$ \frac{1}{8}\rho g H_{new}^2 C_{g,new} \cos\theta_{new} = \frac{1}{8}\rho g H_{prev}^2 C_{g,prev} \cos\theta_{prev} - D \cdot \Delta x $$
Solve for $H_{new}$ directly from this equation. Do not use the ratio of fluxes as a multiplier on $H_{prev}$ and then subtract energy. Instead, calculate the target energy $E_{new}$ and derive $H_{new}$.

**Corrected Logic:**
```javascript
      // 1. Calculate theoretical flux ratio for shoaling (no loss)
      const fluxPrev = Math.max(CgPrev * Math.cos(thPrev), 1e-6);
      const flux     = Math.max(Cg * Math.cos(th), 1e-6);
      
      // 2. Start with shoaled height (conservative step)
      let H = Hprev * Math.sqrt(fluxPrev / flux);
      
      // 3. Apply dissipation as a reduction in Energy, not just a post-hoc check
      if (H > 1e-6) {
        const Hmax = breakerGamma * h;
        const Hrms = H / Math.SQRT2;
        if (Hrms > 1e-6) {
          const Qb = Math.exp(-Math.pow(Hmax / Hrms, 2));
          const D  = 0.25 * RHO * GRAV * (1 / T) * Qb * Hmax * Hmax;
          if (D > 0) {
            // Energy per unit area E = 0.125 * RHO * GRAV * H^2
            // Flux F = E * Cg * cos(theta)
            // We want F_new = F_prev - D*dx
            // E_new * Cg * cos(theta) = E_prev * Cg_prev * cos(theta_prev) - D*dx
            // E_new = (E_prev * (Cg_prev * cos(theta_prev)) / (Cg * cos(theta)) - D*dx) / (Cg * cos(theta))
            // Wait, F = E * Cg * cos(theta). So E = F / (Cg * cos(theta)).
            // F_new = F_prev - D*dx
            // E_new = F_new / (Cg * cos(theta))
            // H_new = sqrt(8 * E_new / (RHO * GRAV))
            
            const F_prev = 0.125 * RHO * GRAV * Hprev * Hprev * CgPrev * Math.cos(thPrev);
            const F_new = Math.max(F_prev - D * dxm, 0);
            const denom = Cg * Math.cos(th);
            if (denom > 1e-6) {
               const E_new = F_new / denom;
               H = Math.sqrt(8 * E_new / (RHO * GRAV));
            }
          }
        }
      }
      
      // 4. Apply breaking cap (this is a hard limit, not a conservation step)
      const Hmax = breakerGamma * h;
      if (H > Hmax) H = Hmax;
```
*Note: This fix ensures that the flux entering the next cell is consistent with the energy leaving the current cell after dissipation.*

#### 2. HIGH: Inconsistent Wavenumber Convergence (kHint Bias)
**Mechanism:**
`wavenumberK` uses `kHint` (the previous cell's $k$) as the initial guess. While this speeds up convergence, the Newton-Raphson method is sensitive to the initial guess if the depth changes rapidly. More critically, the convergence criterion is:
```javascript
if (Math.abs(kn - k) < 1e-9) { k = kn; break; }
```
This is an **absolute** tolerance on $k$. In deep water, $k$ is small ($\sim 0.01$ rad/m). In shallow water, $k$ is large ($\sim 1$ rad/m). An absolute tolerance of $1e-9$ is extremely tight for deep water (good) but potentially loose for shallow water if the function is flat. However, the bigger issue is that `kHint` is passed from the *previous* cell. If the depth changes significantly (e.g., over a bar), the previous $k$ may be a poor guess, leading to convergence to a local minimum or slow convergence.
**More importantly:** The code does not check if the converged $k$ satisfies the dispersion relation within a relative tolerance. It only checks the change in $k$.

**Line:**
```javascript
  for (let it = 0; it < 12; it++) {
    // ...
    if (Math.abs(kn - k) < 1e-9) { k = kn; break; }
```

**Exact Fix:**
Use a relative tolerance and ensure the residual $f(k)$ is small.
```javascript
  for (let it = 0; it < 12; it++) {
    const th = Math.tanh(k * h);
    const f  = GRAV * k * th - w2;
    const df = GRAV * (th + k * h * (1 - th * th));
    if (Math.abs(df) < 1e-12) break;
    const kn = k - f / df;
    if (!isFinite(kn) || kn <= 0) break;
    // Relative tolerance on k
    if (Math.abs(kn - k) < 1e-9 * Math.max(k, 1e-6)) { k = kn; break; }
    // Also check residual
    if (Math.abs(f) < 1e-12) { k = kn; break; }
    k = kn;
  }
```

#### 3. MEDIUM: Snell's Law Clamping Introduces Discontinuities
**Mechanism:**
```javascript
let sinT = Math.sin(thPrev) * (kPrev / k);
sinT = Math.max(-0.999, Math.min(0.999, sinT));
```
Clamping `sinT` to $\pm 0.999$ is a hard cut. If the true value is $1.01$, it is clamped to $0.999$. This creates a discontinuity in $\theta$, and thus in $\cos\theta$, which directly affects the flux calculation. This can cause artificial energy jumps.
**Fix:** Use a smooth clamp or handle total internal reflection (which shouldn't happen in a shore-normal march unless the depth increases, which it doesn't). Since depth decreases shoreward, $k$ increases, so $k_{prev}/k < 1$, so $|\sin T| < |\sin T_{prev}|$. Clamping should rarely be needed unless the initial angle is very large. If it is needed, it indicates a numerical instability.
**Better Fix:** Ensure the initial angle is physically valid. If clamping is necessary, log a warning. For now, the hard clamp is acceptable but should be monitored.

#### 4. LOW: Depth Interpolation vs. Quantized Depth
**Mechanism:**
The code uses `depthAt(i, j)` which likely returns the depth at the cell center. The wavenumber $k$ is solved for this depth. This is consistent. However, if `depthAt` uses bilinear interpolation from a coarser grid, the depth may not be monotonic shoreward, leading to local depth increases. This would cause $k$ to decrease, $C_g$ to decrease, and $\cos\theta$ to increase (since $\sin\theta$ decreases). The flux $C_g \cos\theta$ could increase, leading to de-shoaling (wave height decrease). This is physically possible (wave focusing) but can cause numerical issues if the depth profile is noisy.
**Fix:** Ensure the depth profile is smoothed or monotonic in the shoreward direction.

---

### SUMMARY OF FIXES

1.  **Rewrite the shoaling/dissipation step** to conserve flux explicitly: $F_{new} = F_{prev} - D \Delta x$, then solve for $H_{new}$.
2.  **Improve wavenumber convergence** with relative tolerance and residual check.
3.  **Monitor Snell's law clamping** to detect numerical instabilities.

**Expected Impact:**
-   The "flux residual" score should improve from 0.64 to >0.90.
-   The "storm profile rmse" and "bar position error" should improve due to more accurate wave heights near the breaking zone.
-   The "calm drift" should remain stable, as the conservative flux update prevents artificial sand transport.

**Revised Precision Score Estimate:** 85-90 / 100 (if fixes are implemented).
