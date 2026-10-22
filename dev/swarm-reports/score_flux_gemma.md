# flux / gemma (google/gemma-4-31b-qat)

### Adversarial Review: Wave Transformation Scheme

The 1.8% relative standard deviation in the non-breaking energy flux is not numerical noise; it is a systematic error caused by the sequence of operations in the shoreward march. The code claims to conserve $H^2 C_g \cos(\theta)$, but it applies dissipation and capping *after* the shoaling calculation, then passes the modified $H$ to the next cell as the baseline for the next shoaling step.

---

#### Finding 1: Dissipative Leakage into Shoaling Baseline
**Severity: High**
**Mechanism:** The variable `Hprev` is updated at the end of the loop (`Hprev = H`) *after* the Battjes-Janssen dissipation and the `Hmax` cap have been applied. In the subsequent cell, the shoaling ratio `Math.sqrt(fluxPrev / flux)` is applied to this already-dissipated height. 
Physically, shoaling is a conservation of energy flux; dissipation is a loss of energy flux. By using the dissipated $H$ as the basis for the next cell's shoaling, the model treats the energy loss as a change in the baseline energy state rather than a discrete loss along the path. This creates a "stair-step" error in the flux calculation because the `fluxPrev` used in the ratio is calculated using the *undissipated* $C_g \cos(\theta)$ of the previous cell, but the $H_{prev}$ has already been reduced.

**Line:** `Hprev = H;` (at the end of the `i` loop)
**Fix:** Maintain a separate `H_conserved` variable for the shoaling march and apply dissipation as a separate term, or ensure `fluxPrev` is calculated using the actual energy state passed from the previous cell.

---

#### Finding 2: Flux Ratio Inconsistency (The 1.8% Source)
**Severity: Medium**
**Mechanism:** The code calculates `fluxPrev` and `flux` using the local $C_g$ and $\cos(\theta)$ of the current and previous cells. However, the shoaling formula $H = H_{prev} \sqrt{\frac{C_{g,prev} \cos \theta_{prev}}{C_g \cos \theta}}$ is only valid if $H_{prev}$ was the height *before* dissipation in the previous cell. 
Because the code updates `Hprev = H` (where $H$ is the post-dissipation height), the energy flux is not actually being conserved; it is being multiplied by the shoaling ratio and then subtracted by dissipation. The 1.8% residual is the result of the mismatch between the "ideal" flux ratio and the "actual" energy state being carried forward.

**Line:** `let H = Hprev * Math.sqrt(fluxPrev / flux);`
**Fix:** 
```javascript
// Calculate shoaling based on the energy flux of the previous cell
const currentFlux = Cg * Math.cos(th);
const prevFlux = CgPrev * Math.cos(thPrev);
let H = Hprev * Math.sqrt(prevFlux / currentFlux);
```
*(Note: While this looks similar, the logic must ensure `Hprev` is the height that produced `prevFlux`.)*

---

#### Finding 3: Non-Physical "Calm Drift" (Numerical Erosion)
**Severity: High**
**Mechanism:** The "calm drift" (negative bed changes offshore) is caused by the `morphologyStep` implicit solver. The equation $\frac{\partial u}{\partial t} = \frac{D}{1-p} \frac{\partial^2 u}{\partial x^2}$ is a diffusion equation. If the bed starts exactly on the Dean equilibrium, $u$ should be 0. However, the `morphGrid += du` update is applied to a grid where the boundary conditions or the discretization of $\frac{\partial^2 u}{\partial x^2}$ (likely a central difference) are introducing a slight gradient at the boundaries or the dune interface. Because the "dune" cells are excluded from the solver but the offshore cells are not, the diffusion is asymmetric, pushing sand onshore.

**Line:** `morphologyStep` logic (Implicit Diffusion)
**Fix:** Ensure the boundary condition at the offshore limit is strictly $\frac{\partial u}{\partial x} = 0$ and that the `refWaterLevel + BERM_TOP_M` mask does not create a "sink" or "source" by abruptly terminating the diffusion stencil.

---

#### Finding 4: Precision Loss in Wavenumber Iteration
**Severity: Low**
**Mechanism:** The `wavenumberK` function uses a hard-coded 12-iteration limit. While usually sufficient, the use of `kHint` from the previous cell in a shoreward march (where $k$ increases rapidly) can lead to slow convergence in the transition zone (intermediate water). If the loop hits 12 iterations without hitting the `1e-9` tolerance, it returns a slightly inaccurate $k$, which propagates into $C_g$ and the flux ratio.

**Line:** `for (let it = 0; it < 12; it++)`
**Fix:** Increase iteration limit to 20 or implement a check to warn if the tolerance was not met.
