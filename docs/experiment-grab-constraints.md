# Experimental grab constraints

Status: exploratory; isolated on `experiment/grab-constraints`. No change to shipped default interactions.

## Purpose

Replace the engine's binary `draggedNodeId`/kinematic exclusion with a general, optional node grab constraint. Keep the existing exact drag as the default and preserve visuals, pin persistence, interaction intent, and mobile navigation until explicitly opted in.

## Definitions

- Grab: a temporary physical relationship between one captured node and a target in graph/world coordinates.
- Target: pointer world position plus captured node-contact offset, established at grab start; camera changes must not cause snapping.
- Exact: hard positional constraint preserving today's pointer-locked drag. Do not simulate infinity using large finite coefficients.
- Elastic: spring-damper constraint coexisting with normal link, repulsion, collision, region, and centering forces. Apply grab forces before velocity integration.
- Release: remove constraint and return node to the normal solver. Explicitly decide whether to preserve physical velocity (elastic) or reset it (exact).
- Targeting/selection remains independent of grabbing.

## Candidate internal shape (not yet a public API)

```ts
type GrabConstraint =
  | { mode: 'exact'; nodeId: string; target: Vec3 }
  | { mode: 'elastic'; nodeId: string; target: Vec3;
      stiffness: number; damping: number; maxForce: number | null };
```

`maxForce: null` means uncapped; `stiffness: 0` means no attraction.
The numeric ranges must be calibrated against ForceLayoutModule's existing
`FORCE_INTEGRATION_GAIN`, velocity decay, maxSpeed, alpha cooling and
integration cadence, not chosen as generic UI percentages.

The physical expression is:
`F = clampMagnitude(k * (target - position) - c * velocity, maxForce)`.
A capped force must cap the **combined** spring and damping contribution.
The grab must wake settled physics while active, and release must allow
normal cooling and eventually stop the simulation.

## Integration checkpoints

1. Introduce a solver-facing optional constraint distinct from UI pointer events and selection. Preserve existing `draggedNodeId` as the default/compatibility input at first.
2. Exact mode uses existing kinematic behavior and node-position patching.
3. Elastic mode does **not** exclude grabbed node from integration; apply force in the same pass as ordinary forces and use its actual position as the solver authority.
4. Resolve screen-to-world coordinates and contact offset in interaction runtime, not in the physics module. Correctly account for 2D/3D camera motion.
5. On release, avoid hidden pinning or automatic snap to the target; retain existing Graph+ pin-on-release for its default exact behavior only unless the experiment explicitly opts out.
6. Keep the solver constraint transient: do not serialize grab state into profile settings or snapshot velocity state. User-facing parameter presets can be persisted separately later.
7. Do not expose gravity or platform profiles in this branch.

## Experiment matrix

| Case | Expectation |
| --- | --- |
| Existing default drag | Pixel-locked position and same pin-on-release behavior |
| Elastic stiffness 0 | Pointer has no positional influence |
| Low/medium/high stiffness | Monotonic grip response without node teleportation |
| Max force low/high/uncapped | Pull caps as specified; no numerical explosion |
| Damping 0/high | Oscillation vs controlled settling |
| Release during rapid motion | No position snap or stale force |
| Cold settled graph | Grabbing wakes layout; release allows cooling |
| 2D and 3D | Stable coordinate mapping and finite positions |
| Pinned/removed/filtered nodes | Explicit cancellation/precedence; no stale references |
| Rapid repeated grabs | No retained constraint or velocity impulse |
| Mobile touch vs click | Remains separate policy experiment; no behavior change yet |

## Open design questions

- Should elastic release pin a node? Initial recommendation: **no**, because pinning converts a temporary negotiation into permanent positional authority.
- Should a pinned node be grabbable elastically? Initial recommendation: maintain pin until a deliberate unpin transition, rather than silently fighting two authorities.
- Should maximum force operate before or after general solver speed clamping? The cap applies to the grab contribution, then existing global speed safety remains in place.
