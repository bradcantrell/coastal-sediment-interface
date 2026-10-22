## Performance

Measured, not asserted. `BENCH=1 node dev/headless_harness.js index.html` prints the frame
profile; `dev/coastal_swarm.py` runs the adversarial review that found the first three items.

| | before | after |
|---|---|---|
| `updateBedBuffer()` | 99.0 ms | 9.9 ms |
| `waveFieldStep()` | 10.3 ms | 7.1 ms |
| `morphologyStep()` | 9.4 ms | 7.2 ms |
| frame | 136.5 ms (**7 fps**) | 29.9 ms (**33 fps**) |

Every one of these is bit-identical to its predecessor under the precision metric below.

Three fixes, all from the swarm and all verified against the source before being applied:

- **`updateBedBuffer()` sampled the bed three times over.** The wash, the height ramp and each
  of the seven contour levels called `bedZ()` independently — roughly half a million lookups
  per refresh. The bed is now sampled once into two typed arrays and every pass reads those.
  The contour scan costs no lookups at all.
- **`morphologyStep()` allocated seven typed arrays per call.** Hoisted to module scope.
- **`buildSolidMask()` ran twice per frame** — once in `draw()`, again at the top of
  `waveFieldStep()`.
- **The dispersion solve ran twice per cell.** `groupVelocity()` called `wavenumberK()` again
  after the caller had just solved it, from a deep-water first guess. Newton is now seeded
  from the neighbouring cell and `k` is passed through. Identical results: max H 1.42 m,
  break 3.18 m at 4.19 m, runup 1.20 m, before and after.

**33 fps is not 60.** What is left is the physics grid itself: 7.1 ms of wave field and
7.2 ms of morphology over 300 × 200 cells. Getting under 16.67 ms needs a coarser morphology
grid or a slower model time — a trade in fidelity, not an optimisation, so it is left as a
decision rather than quietly assumed.

## Adversarial review

`dev/coastal_swarm.py` runs three lenses — performance, accuracy, export alignment — against
both Gemma and Qwen3.8, sequentially (one local worker serializes; parallel calls just queue
and time out). Reports land in `dev/swarm-reports/`.

Pairing the two families is the point: a model shares its own blind spots. Where they agree,
the finding is probably real — both ranked `updateBedBuffer` CRITICAL at ~90 ms. Where they
disagree, verification decides.

**Every export-alignment finding failed verification.** Gemma reported that `xbBedAt()` writes
only the base bed and silently drops the morphology and longshore layers. It does not —
`bedZ()` sums `userBedZ + depoZ + morphZ + longZ`, so the exported `bed.dep` is the bed on
screen. Its second claim, that `dirToNautical` returns a wrong heading, is also wrong:
shore-normal maps to 270 and ±30° map symmetrically, which the harness already asserts.
Qwen raised a `tstop`/`morfac` concern before reasoning itself to "consistent".

That is the swarm working. A confident CRITICAL from a strong local model, checked against
four lines of source and rejected.
