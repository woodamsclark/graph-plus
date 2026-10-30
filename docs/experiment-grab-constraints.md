# Experimental grab constraints

Status: implemented on `experiment/grab-constraints` and integrated into `rc/attachments`
as an opt-in internal hook. No change to shipped default interactions.

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

## Implemented experiment

The optional `GraphModulePipelineStateV1.grabConstraint` is the solver boundary.
It takes precedence over `draggedNodeId`, including an explicit `off` constraint.
Without it, existing exact dragging, position patches, pin policies, visuals,
and user profiles follow their existing paths.

`runtime/interaction/GrabConstraint.ts` contains the internal policy types,
world-space `GrabController`, and spring/damper calculation. Input adapters can
capture a contact, update it in world coordinates, and end it without selection,
camera, pin, or snapshot dependencies. Each capture copies its policy and offset;
later policy edits affect the next capture. This state is never serialized.

`SessionInteractionRuntime` maps screen coordinates into that world-space input.
Elastic/off updates do not patch node positions or change pins. Elastic capture
refuses pinned nodes; a pin applied during capture cancels it. Removed, filtered,
or no-longer-draggable nodes also cancel. Cancellation, input reset, disabling,
disposal, and replacement grabs clear the transient constraint. Late updates
cannot resurrect it. Release emits the actual solved position using the existing
drag-ended intent, without authoring a pin, restoring a position, or writing velocity.

In 3D the elastic target uses a screen-parallel plane through the original world
anchor, recalculating depth after camera motion and preserving the original world
contact offset. This is an explicit experimental plane policy, not surface picking
or a depth handle. Existing exact pointer mapping remains unchanged.

The force module applies elastic force after the ordinary force passes and before
velocity decay, speed clamping, and position integration. Damping reads pre-step
physical velocity, rather than velocity already modified by other force passes.
The combined spring/damper vector is capped before the existing integration gain
of `0.6`; general velocity decay and `maxSpeed` still apply afterward. Exact solver
constraints assign position before neighbors evaluate forces and skip integration.

An active elastic/exact constraint keeps alpha at 1 and prevents settled early
termination. Removing it immediately resumes ordinary cooling. A single-node
layout can now run while grabbed and finish settling after release; ungrabbed
single-node layouts retain their previous idle behavior. Pins remain authoritative
over elastic constraints. Invalid or hidden targets cannot silently fall back to
the legacy exact drag input.

### Trying coefficients internally

On a concrete `GraphSessionRuntime` (not its public `GraphSessionV1` interface):

```ts
runtime.setExperimentalGrabPolicy({
  mode: 'elastic', stiffness: 0.15, damping: 0.6, maxForce: 12,
});
runtime.setExperimentalGrabPolicy({ mode: 'off' });
runtime.setExperimentalGrabPolicy({ mode: 'exact' }); // default
```

`GraphSessionRuntimeOptions.experimentalGrabPolicy` also accepts an initial policy.
These are internal experiment hooks; there is no settings, profile, service, or
public client API change. `EXPERIMENTAL_ELASTIC_GRAB` supplies the example values.
They are starting coefficients for experimentation, not calibrated UI ranges.

Coefficients use the engine's existing per-admitted-step units, not SI units or
delta-time-scaled acceleration. `maxForce: null` is uncapped; zero caps the entire
grab contribution. Zero stiffness removes attraction but nonzero damping still
brakes motion. `off` removes both effects. Coefficients must be finite and
nonnegative; overflowed force calculations are discarded. Global speed safety
bounds extreme finite coefficients, but does not guarantee smoothness for arbitrary
uncapped spring/damper values. A timestep/integrator redesign is outside this experiment.

### Verification

- 14 new tests cover coefficients, combined force caps, damping/oscillation,
  connected spring response, momentum-preserving release versus an ordinary solver,
  cold wakeup and eventual cooling (including isolated nodes), exact/off precedence,
  invalid/pinned/removed/filtered targets, extreme coefficient stability, real pointer
  input in 2D/3D, cancellation, reset/disable, policy capture, rapid grabs, contact
  offsets, and camera remapping.
- Full suite: 539 tests passed, including existing exact drag/pin behavior and
  1,200-node position-patch compatibility tests.
- Typecheck, lint of changed engine files, client generation, plugin build, and
  `git diff --check` passed.
- Validation is automated; interactive feel on real desktop/mobile hardware remains
  an experiment. No gravity, platform profiles, user-profile changes, or UI changes
  are included, and integration into `main` has not been attempted.


## RC integration

The implementation is integrated into `rc/attachments` alongside vector gravity,
2D/3D attachments, and the shared node-sizing behavior. Exact remains the default;
no user settings, public consumer API, or device/platform profiles are added.

Elastic targets remain mobile to the attachment solver; only Exact targets use
kinematic exclusion. Accepted hard attachment rays can therefore constrain elastic
pulls. Single-node gravity and grab lifecycles both permit settling after release.

RC verification: 613 tests pass, including the original 14 grab tests and two
integration tests covering combined vector gravity, isolated-node cooling, hard
attachment authority, and pins in both dimensions. Typecheck and build pass.
