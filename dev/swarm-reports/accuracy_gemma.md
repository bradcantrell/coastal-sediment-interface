# accuracy / gemma (google/gemma-4-31b-qat)

### Physics Audit Report

**Headline Finding: Bar Over-Accretion**
The asymmetry (eroding correctly but depositing $\approx 3\times$ too much in the bar) is caused by the **additive nature of the `equilibriumZ` function**. The code calculates a base Dean profile and then *subtracts* a Gaussian bar term: `h -= storm * 0.35 * conditions.Hs * Math.exp(...)`. Since $h$ is depth (positive downwards), subtracting from $h$ **raises the bed**. 

Because the implicit diffusion drives the bed toward $Z = WL - h$, the model is effectively trying to "fill" a hole that is being deepened by the storm energy. However, the bar term is scaled by `conditions.Hs` (the storm height) but is applied to the *target* profile. In a real storm, the bar is a result of transport, not a static target. By forcing the equilibrium profile to have a massive bar during the storm, you are creating a "sink" that pulls sand from the beach and locks it into the bar with no physical mechanism to limit it other than the Gaussian width.

---

#### SEVERITY: CRITICAL
**Function:** `equilibriumZ`
**Finding:** The bar term is subtracted from $h$ (depth), which increases the bed elevation $Z$. Because this is used as the target for the implicit diffusion, the model treats the bar as a "required" geological feature of the storm state rather than a transport result. This creates an artificial sediment trap.
**Fix:** Remove the `if (storm > 0)` bar term from `equilibriumZ`. The bar should emerge naturally from the cross-shore transport gradients or be handled as a separate morphological forcing, not as a static target for the diffusion solver.

#### SEVERITY: HIGH
**Function:** `morphologyStep`
**Finding:** The implicit diffusion boundary condition is incorrect for the landward side. The code uses a zero-flux condition (`nb = (linkL ? 1 : 0) + (linkR ? 1 : 0)`) for all boundaries. However, the landward boundary is capped by `if (z > refWaterLevel + BERM_TOP_M) { act[gx] = 0; }`. This creates a "hard wall" where sediment cannot move into the dune, but the diffusion solver still sees the cell immediately adjacent to the dune as a boundary. This often leads to artificial sediment piling (or "clumping") at the dune toe.
**Fix:** Ensure the landward boundary condition explicitly handles the transition to the non-active dune cells to prevent numerical reflection of sediment.

#### SEVERITY: HIGH
**Function:** `cercQ`
**Finding:** The CERC formula implementation is missing the $\sin(\alpha)$ term for the longshore component of the wave energy flux. The standard CERC formula is $q \propto H_{sb}^{2.5} \sin(2\alpha)$. While $\sin(2\alpha)$ is present, the reference angle $\alpha$ is the breaking angle. The current implementation uses `waveAngle[idx]`, which is the angle relative to the x-axis (cross-shore). If $\alpha=0$ is cross-shore, $\sin(2\alpha)$ is correct, but if $\alpha$ is the angle relative to the shoreline, this is correct. However, the `transformComponent` logic sets `waveAngle` as the refracted angle $\theta$.
**Fix:** Verify that `alpha` is the angle relative to the shoreline. If `th` is the angle relative to the x-axis (cross-shore), the longshore component is $\sin(\theta)$. The CERC factor should be $\sin(2\theta)$ only if $\theta$ is the angle relative to the beach face.

#### SEVERITY: LOW
**Function:** `morphologyStep`
**Finding:** Dimensional sanity of `energy = (Hs / TRANSPORT_HREF)^2`. While common in reduced models, the transport rate $Q$ in cross-shore models typically scales with $H^3$ or $H^{2.5}$. A squared scaling is a significant underestimation of storm power and an overestimation of swell power.
**Fix:** Change scaling to `Math.pow(conditions.Hs / TRANSPORT_HREF, 2.5)`.

#### SEVERITY: LOW
**Function:** `deanA` / `settlingVelocity`
**Finding:** The `deanA` coefficient uses $w_s$ in cm/s. The formula $A = 0.067 w_s^{0.44}$ is a common empirical fit, but the settling velocity calculation for $D^*$ is using a very specific viscosity/density ratio. Ensure `d50mm` is passed correctly as millimeters.
**Fix:** No immediate code change required, but verify $A$ against a known Dean profile for the specific $d_{50}$ of the site.

#### SEVERITY: LOW
**Function:** `transformComponent`
**Finding:** The breaking cap `if (H > Hmax) H = Hmax;` is applied *after* the Battjes-Janssen dissipation. This is redundant and can cause a slight discontinuity in the energy gradient at the breaker line.
**Fix:** Remove the hard cap and rely on the dissipation term $D$ to bring $H$ toward $H_{max}$.
