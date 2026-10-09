# graph-engine V1.9 optimization and architecture contract

Status: Implemented in V1.9.0; automated validation complete, live Obsidian smoke
validation pending.

Date: 2026-09-07

Depends on:

- [graph-engine V1.2 scalability contract](graph-engine-v1.2-scalability-contract.md)
- [graph-engine V1.6 Anima presentation contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)
- [graph-engine V1.7.3 energy and diagnostics contract](graph-engine-v1.7.3-energy-diagnostics-contract.md)
- [graph-engine V1.8 Anima note preview contract](graph-engine-v1.8-anima-note-preview-contract.md)

## 1. Purpose

V1.9 is a behavior-preserving optimization and architecture pass. It addresses the
cost of settled and background graphs, reduces duplicated host code, and clarifies
ownership between Graph Engine, Anima, Graph+, and Obsidian.

The release is guided by measurements from the existing diagnostics surface. A
refactor is accepted only when it preserves the current interaction, layout, preview,
settings, persistence, and downstream-consumer contracts.

V1.9 does not introduce a new visual language, solver, public protocol version, or
settings concept unless profiling proves that one is required for an optimization.

## 2. Design principles

1. Canonical graph data remains separate from projection, presentation, and transient
   interaction state.
2. Graph Engine remains host-neutral; Obsidian APIs stay in the Obsidian host layer.
3. Anima remains the authority for graph presentation values and preview emphasis.
4. Graph+ and Local Graph+ share one graph world while retaining separate viewport
   state and filtering behavior.
5. Event-driven work is preferred over polling, permanent animation loops, and broad
   rebuilds.
6. Refactors are incremental, measured, and reversible at each slice.

## 3. Runtime ownership and interaction state

The engine shall document and enforce one transient interaction model for:

- ordinary hover;
- semantic preview target and preview-surface ownership;
- focus;
- selection;
- node drag and pin state; and
- camera gestures.

The model must expose explicit transitions and resolved presentation priority to Anima.
Preview, focus, and hover remain distinct states, but their interaction is resolved in
one place. Host preview lifecycle events may extend a handoff, but may not become a
second source of graph highlight truth.

Acceptance:

- changing focus, preview target, or pointer hover cannot leave stale Anima emphasis;
- preview never changes focus, selection, drag, pin, camera, or canonical positions;
- suspension, disposal, file deletion, and visibility changes clear all transient
  interaction state exactly once; and
- interaction transition tests cover target changes, handoff, dismissal, and focus
  replacement without relying on DOM hover state.

## 4. Session runtime decomposition

`GraphSessionRuntime` remains the public session implementation, but its internal
responsibilities should be split behind private or neutral runtime interfaces:

- `SessionFrameScheduler`: requestAnimationFrame, wake timers, frame-rate caps, and
  dirty-state scheduling;
- `SessionActivityController`: manual suspension, document visibility, disposal, and
  module suspension;
- `SessionProjectionCoordinator`: projection, module contribution, position commits,
  and render-frame composition; and
- `SessionDiagnostics`: counters, rolling timing samples, and exported snapshots.

The public `GraphSessionV1` contract remains stable. Extraction must not create a new
consumer-facing dependency on implementation classes.

Acceptance:

- all existing session lifecycle and performance tests pass;
- a suspended or disposed session schedules zero frames and zero wake timers;
- projection-only, presentation-only, camera-only, and physics changes can be
  identified in diagnostics; and
- each extracted component has one owner for cleanup.

## 5. Frame and invalidation optimization

The runtime shall distinguish, at minimum, these invalidation classes:

- geometry: node positions, topology, dimensions, or layout changes;
- camera: viewport, projection, orbit, pan, or zoom changes;
- presentation: Anima colors, opacity, radii, labels, links, or preview emphasis;
- content: document, filter, Form, or region projection changes; and
- UI: settings and overlay changes that do not alter graph geometry.

The renderer may reuse projected geometry, depth ordering, hit-grid data, label
measurement, and region contours when their invalidation inputs are unchanged. Any
cache must have an explicit key and invalidation owner; stale visual or hit-test data
is a correctness failure.

Acceptance:

- diagnostics report which invalidation class caused a frame;
- presentation-only changes do not recompute topology or physics;
- camera-only changes do not rebuild canonical graph projections; and
- output and hit testing match the pre-refactor behavior across 2D and 3D.

## 6. Force-layout internal boundaries

The topology-weighted solver remains the shipped policy. V1.9 may split its internals
into testable units without changing the solver contract:

- topology and spring preparation;
- velocity and force integration;
- cooling and settling policy;
- component centering and region membership forces;
- collision and spatial indexing; and
- axial-spring constraints.

Each unit must retain deterministic inputs and diagnostics. No solver replacement,
alpha schedule change, or new user-facing settling control enters V1.9 without a
separate reviewed contract.

Acceptance:

- topology analysis, spring counts, component counts, alpha, and running state remain
  observable;
- settled graphs stop physics work as required by V1.7.3;
- drag, focus-follow, local graph loading, and axial binding retain their behavior; and
- benchmark results are compared with the V1.7.3 baseline for representative 2D and
  3D graph sizes.

## 7. Shared Graph+ host lifecycle

> Historical note: the current ownership model is defined by
> [Graph+ application architecture](graph-plus-application-architecture.md). It
> supersedes this section's separate-product-boundary requirement while preserving
> separate cameras and the legacy view identities.

Global Graph+ and Local Graph+ shall share small, composable host services for:

- preview controller construction and Markdown rendering lifecycle;
- leaf visibility and suspension wiring;
- consumer disposal and event cleanup;
- active-note follow routing; and
- theme and viewport synchronization.

The two views share the same full-vault graph world: canonical topology, coordinates,
pins, and layout-module state. Their product difference is startup framing: Global
begins in Overview; Local begins in Focus and follows the active note. Each pane retains
its own camera, filters, View, Attention, Focus, hover, and UI state.

Acceptance:

- both views use the same preview and cleanup semantics;
- closing one view cannot dispose another view's lease or preview surface;
- side-leaf background, theme, and viewport behavior remains correct; and
- no Obsidian API crosses into the public engine or downstream client artifact.

## 8. Settings and UI update efficiency

Quick settings and the full settings page remain interfaces over the same core settings
model. V1.9 should update existing controls in place when practical, preserving scroll
position and disclosure state without replacing the entire panel.

Settings changes must continue to use typed controls and shared validation. A common
settings transaction path should standardize validation, persistence, rollback on save
failure, and live-session application for global and profile overrides.

Acceptance:

- changing a setting preserves the current scroll position and open section;
- unchanged controls are not recreated during a setting update;
- failed saves restore the prior effective value consistently for global and profile
  settings; and
- quick settings and full settings produce the same core-model result.

## 9. Diagnostics and performance evidence

Before adopting a refactor, record a baseline and compare:

- settled frame rate and scheduled-frame count;
- physics ticks and integration steps;
- projection, composition, rendering, hit-test, and label timings;
- effective versus native pixel ratio;
- wake timers and pending animation frames;
- memory-sensitive caches and their entry counts; and
- battery or energy observations on desktop and mobile where available.

Diagnostics must distinguish active work from retained data. A graph that is hidden,
suspended, or closed must show no active session frames, timers, physics ticks, preview
work, or render work.

## 10. Public and downstream compatibility

V1.9 remains additive at the public contract boundary unless a separate breaking
contract is approved. The generated downstream client artifact remains synchronized,
portable, and free of provider implementation and Obsidian imports.

PatternSmith and other consumers should receive optimizations through the shared
engine artifact without repeatedly changing their integration code. Any public type
change must include artifact regeneration, import-boundary tests, and downstream smoke
coverage.

## 11. Required validation

Before V1.9 is considered complete:

1. Typecheck, unit tests, client-artifact synchronization, build, and diff checks pass.
2. Existing Graph+ and Local Graph+ behavior is manually checked in 2D, 3D, desktop,
   mobile, and a narrow side leaf.
3. Settled, hidden, suspended, and disposed diagnostics are captured for desktop and
   mobile.
4. Representative large-graph benchmarks are compared with the V1.7.3 baseline.
5. Preview, focus, settings, camera, persistence, and downstream-consumer smoke tests
   pass without changes to canonical graph data.

## 12. Deferred work

V1.9 does not include a new physics solver, a general Anima timeline system, a custom
Canvas/WebGL Markdown renderer, arbitrary cache persistence, or a broad public protocol
version. Those remain separate design and contract work.

## 13. Implementation record

Implemented on 2026-09-08 as a behavior-preserving internal release:

- `GraphSessionRuntime` now delegates frame scheduling, activity state, projection and
  composition, and diagnostics to independently owned runtime components.
- Frame diagnostics identify geometry, camera, presentation, content, and UI
  invalidations. The renderer reuses projected geometry and depth ordering when only
  presentation changes, while geometry revisions explicitly invalidate that cache.
- Force-layout cadence policy is isolated from the solver without changing topology
  weighting, integration, cooling, or settling behavior.
- Global Graph+ and Local Graph+ share preview creation and view-lifecycle services,
  while retaining their distinct document and filtering behavior.
- Global and profile settings use shared transaction paths with validation, live
  application, persistence, and rollback. Quick settings avoid graph exports and broad
  control reconstruction while collapsed or during non-structural updates.
- Cache sizes, cache hits, pending invalidations, and the causes of the last rendered
  frame are exposed through diagnostics. The public `GraphSessionV1` contract and the
  independently versioned downstream client protocol remain unchanged.

The headless benchmark was run against the pre-V1.9 `ac617e3` snapshot with the same
new presentation-only scenario applied to both versions. Representative results:

| Scenario | Metric | Pre-V1.9 | V1.9.0 | Change |
| --- | ---: | ---: | ---: | ---: |
| 5,000 nodes, 3D, presentation only | projection p50 | 3.167 ms | 2.098 ms | -33.8% |
| 5,000 nodes, 3D, presentation only | total p50 | 8.860 ms | 8.010 ms | -9.6% |
| 1,500 nodes, 3D, active layout | total p50 | 10.574 ms | 10.574 ms | parity |
| 5,000 nodes, 3D, active layout | total p50 | 47.714 ms | 47.683 ms | parity |

Single-run tail values remain sensitive to garbage collection and are not used as a
release claim. Automated typecheck, unit, client-artifact, build, and diff gates pass.
Desktop/mobile behavior and energy acceptance remain live-host validation items rather
than claims made by the headless suite.
