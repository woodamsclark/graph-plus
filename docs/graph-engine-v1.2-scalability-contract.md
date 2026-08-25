# Graph Engine V1.2 Scalability Contract

Status: Implemented

Baseline: Graph Engine V1.1 release candidate

Date: 2026-08-25

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.2 Scalability Acceptance Plan](graph-engine-v1.2-scalability-acceptance.md)

## 1. Purpose

V1.2 makes the existing Graph Engine architecture scale to real vault-sized graphs
without weakening the public consumer boundary introduced in V1 and V1.1.

The extraction retained Graph+'s broad input, command, module, force-layout, camera,
and rendering model, but replaced much of its efficient mutable runtime with defensive
public-document and public-view-state operations. Full validation, cloning, projection,
and frame reconstruction can consequently occur during ordinary pointer, camera,
hover, and physics work.

V1.2 corrects that boundary error. Public inputs and exports remain validated,
consumer-owned values. Inside an active session, Graph Engine may use private mutable
state, cached projections, indexed lookup, reusable buffers, and coalesced frame work.

The governing rule is:

> Safe snapshots at the public boundary; efficient state inside the frame loop.

## 2. Compatibility statement

V1.2 is an internal scalability release, not a new product model.

It preserves:

- Graph+ as the installed host and bundled first-party consumer;
- the domain-neutral graph document and patch contracts;
- consumer-owned document and view persistence;
- local and Workspace Events leases;
- consumer/profile settings and module policy;
- engine-owned configurable quick settings and context menus;
- click-only semantic consumer actions;
- 2D and 3D sessions;
- Filter and Form behavior;
- focus, selection, pinning, dragging, camera, and interaction semantics;
- the current protocol major and existing V1 public type names where additions are
  backward-compatible.

Existing consumers must not need to change how they register, create a session, submit
a document or patch, apply a filter, invoke a session method, receive intents, or export
state.

## 3. Scope

V1.2 includes:

- separation of validated public snapshots from private runtime state;
- explicit invalidation domains and cached derived state;
- coalesced high-frequency camera and pointer work;
- bounded hit testing and hover updates;
- allocation-conscious force layout and frame composition;
- deterministic force cooling and stopped physics work after settling;
- large-graph rendering and label budgets;
- persistence work proportional to what changed;
- rolling performance instrumentation and real regression budgets;
- preservation and verification of the existing module lifecycle;
- Graph+ large-vault verification as the first-party reference consumer.

## 4. Non-goals

V1.2 does not include:

- PatternSmith smoke-test UI, gesture, profile, or product corrections;
- PatternSmith learning semantics, graph projection, drills, persistence, or filters;
- new pointer mappings, click semantics, or camera behavior;
- a replacement scheduler or redesign of the current session frame-loop ownership;
- arbitrary executable module registration from external consumer plugins;
- a public raw-input, drag-handler, renderer, camera-controller, or scheduler API;
- new Anima visuals or behavior beyond preserving its optional module slot;
- a WebGL, WebGPU, worker, or native renderer requirement;
- a new graph query language or domain vocabulary;
- Graph+ file types beyond the accepted notes-and-tags scope;
- changes to Filter or Form product semantics;
- graph-owned permanence for consumer documents;
- optimization by silently dropping visible nodes or edges.

An implementation may later choose GPU rendering or worker-assisted layout, but V1.2
must meet its contract without making either a public dependency.

### 4.1 Observed V1.1 regression

The reported Graph+ graph contains approximately 1,409 nodes and 2,733 edges. The
following diagnostic measurements identify the correction target; they are not release
benchmark results:

- one defensive document export on that graph measured about 3.4 ms median, 6 ms p90,
  and 14 ms maximum in the diagnostic harness;
- one current force-layout tick on a synthetic 1,400-node/2,600-edge graph measured
  about 7.2 ms median, 9.9 ms p90, and 47.5 ms maximum before Canvas rendering;
- the active Graph+ plugin data is about 6.8 MB and retains redundant complete graph and
  view representations;
- disabling labels helps only modestly because it does not remove document cloning,
  projection reconstruction, force allocation, hit testing, or edge rendering.

The primary regression is that defensive public-boundary operations became internal
hot-loop operations. Camera and hover commands can export the document, compare
identity, rerun the complete module projection, regenerate node/edge contributions,
and rebuild a frame. Trackpad input can repeat that sequence several times before one
display frame. Force layout additionally reconstructs positions, force vectors, and
view snapshots on every active tick.

Graph+ checkpoint serialization is a secondary burst cost after interaction. Labels
are a visible but tertiary contributor.

## 5. Preserved architecture

The high-level architecture remains:

```text
Consumer domain
    ↓ adapter
Validated public graph document
    ↓ one-time ingress copy
Graph session runtime
    ├── document/topology state
    ├── Filter and Form projection
    ├── interaction and camera
    ├── ordered engine modules
    ├── existing session frame loop
    └── renderer
    ↓ explicit export
Validated public document/view snapshots
```

Graph+ remains a consumer of this boundary. It must not receive privileged access to
private runtime objects.

### 5.1 Kernel and module ownership

The session kernel owns:

- the public-to-private state boundary;
- invalidation and cache coordination;
- normalized input collection;
- semantic command dispatch;
- camera state;
- frame scheduling;
- renderer lifecycle;
- session suspension and disposal;
- public exports and event delivery.

Shipped modules own optional graph transformations or contributions. At minimum:

- `filtering` owns Filter evaluation and selections;
- `form` owns Form-derived topology/positions;
- `force-layout` owns free-graph force integration;
- `rendering` owns presentation contributions and settings;
- `anima` retains its optional lifecycle-compatible slot.

The Canvas renderer may remain a kernel-owned implementation. A rendering module
contributes presentation state; it does not need to expose or own the Canvas object.

## 6. Public snapshots and private runtime state

### 6.1 Ingress

Graph Engine validates and copies a consumer document when a session is created, a
document is replaced, or a patch is applied. It validates and copies restored public
view state when explicitly supplied.

Validation must be atomic. Invalid input cannot partially mutate active runtime state.

### 6.2 Internal representation

After ingress, the session may retain:

- a private canonical document;
- direct document ID and revision fields;
- node and edge lookup maps;
- topology and adjacency indexes;
- mutable position and velocity buffers;
- cached Filter and Form results;
- cached rendering contributions;
- reusable frame and spatial-index storage.

Internal references must never escape through the public service, callbacks, module
state exports, or consumer-owned persistence.

### 6.3 Egress

`exportDocument`, `exportViewState`, checkpoint creation, and public event payloads
return defensive snapshots where the existing contract requires ownership isolation.
An exported value cannot mutate an active session, and later session changes cannot
mutate an already exported value.

### 6.4 Cheap identity

Document ID, document revision, session ID, and engine instance ID are scalar runtime
identity. Reading or comparing them must not export, validate, traverse, or clone a
graph document.

No raw input event, internal command check, frame tick, hit test, or camera operation
may call the public document-export path merely to obtain identity.

## 7. Invalidation contract

V1.2 distinguishes these invalidation domains:

| Domain | Examples | Work it may invalidate |
| --- | --- | --- |
| Document | replace, structural patch | topology, Filter, Form, layout, contributions, frame |
| Projection | Filter request, Form root/configuration | projection selections, derived topology/positions, contributions, frame |
| Layout | force setting, pin, drag, reheating | runtime positions, spatial indexes, frame |
| Presentation | theme, label mode, node/edge styles | rendering contributions, label caches where relevant, frame |
| Camera | pan, orbit, zoom, fit, resize | camera matrices, culling/screen-space indexes, frame |
| Interaction | hover, focus, selection, context target | affected interaction contribution and frame |
| Persistence | consumer save request | exported snapshots only; no visual invalidation |

The following rules are mandatory:

1. Camera changes do not rerun document validation, Filter, Form, topology projection,
   force initialization, or graph-wide static presentation contribution.
2. Hover changes do not rerun Filter, Form, topology, or force work. Repeating the same
   hover target causes no state change.
3. Selection and focus changes update only the state and presentation that depend on
   them. They do not re-evaluate graph topology unless a separately requested lens
   explicitly depends on that public state.
4. A physics tick updates positions and position-dependent render data. It does not
   rerun Filter, Form, or static rendering contributions.
5. Presentation-only settings do not rebuild topology or reheat force layout.
6. Filter/Form/document changes may perform graph-wide work, but at most once per
   accepted transaction.
7. Cache invalidation follows dependencies; it may be broader only when correctness
   cannot otherwise be preserved and the reason is recorded in diagnostics.

## 8. Existing frame-loop constraints

V1.2 retains the current `GraphSessionRuntime` frame-loop ownership and execution
order. It does not introduce a new scheduler abstraction.

Performance corrections inside that loop must:

- preserve the existing interaction, module tick, composition, and rendering order;
- preserve deterministic ordering among active modules;
- coalesce redundant high-frequency input before expensive dependent work;
- avoid graph-wide work when a frame changes only camera, hover, or positions;
- stop force-layout computation after the force module reports that it has settled;
- preserve existing suspension, visibility, and disposal behavior;
- cancel the existing outstanding frame handle on disposal.

The retained order is:

```text
coalesced input
  → semantic commands
  → time-dependent modules
  → position/frame updates
  → render if dirty
```

V1.2 does not require demand-driven animation-frame scheduling. A settled force module
must, however, return without cloning positions, rebuilding projections, composing a
frame, or marking rendering dirty.

## 9. Module scalability and extensibility

Physics remains an engine module. V1.2 must not fold force integration into the session
kernel as a performance shortcut.

The internal module model continues to support:

- descriptor and version;
- deterministic order;
- the existing dependency metadata and ordering behavior;
- required, optional, and forbidden profile policies;
- setup, settings update, document/view notification, projection, tick, frame
  contribution, state export/restore, suspension, and disposal;
- optional-module failure isolation;
- required-module fatal behavior;
- session isolation.

Engine developers may register additional shipped definitions at engine composition
time. External consumer leases continue to configure registered modules through
profiles; they do not submit executable module code in V1.2.

Modules receive the narrowest state appropriate to their hook. A module must not need
a freshly cloned public document on every tick. A module that retains runtime
references must release them on replacement or disposal.

## 10. Input and hit testing

Raw pointer and wheel input may arrive faster than the display can render. V1.2 must:

- retain ordered semantic transitions such as press, release, click, context request,
  drag start, and drag end;
- coalesce repeated camera deltas and pointer positions to the latest cumulative state
  consumed by the next frame;
- perform at most one hover hit test per rendered frame;
- skip hover hit testing while an exclusive pan, orbit, pinch, or node-drag gesture is
  active unless that gesture explicitly requires a target;
- emit a hover change only when the hit node ID changes;
- use a maintained spatial or screen-space index so routine hit testing does not
  project and inspect every node for every raw event;
- preserve accepted desktop/mobile gesture semantics and drag thresholds.

Coalescing cannot discard clicks, releases, context requests, action activation, or the
final camera state.

## 11. Force-layout contract

The `force-layout` module retains the accepted Graph+ behavior and defaults unless a
profile overrides them:

- Barnes-Hut repulsion;
- spring forces along edges;
- center pull;
- velocity decay;
- alpha decay and minimum;
- configured maximum speed;
- 2D planar and 3D spatial positions;
- pinning and drag-release behavior;
- suspension during Form where the existing contract requires fixed derived positions.

The module must:

- keep reusable private position, velocity, force, and spatial-tree storage where
  practical;
- reconcile buffers when topology changes rather than recreate the public view state
  for every node on every tick;
- cool to a stopped state without camera, hover, focus, selection, or unrelated
  presentation work reheating it;
- reheat only for topology, relevant layout-setting, pin, drag-release, dimension, or
  explicit layout changes;
- use bounded elapsed time so suspension or a slow frame cannot cause an integration
  jump;
- expose copied positions only on public view export or consumer checkpoint;
- produce deterministic results under the seeded acceptance harness.

V1.2 does not require bit-identical coordinates to the pre-extraction engine. It does
require comparable settling time, stability, spatial character, and responsiveness.

## 12. Projection and rendering

Filter, Form, and rendering contributions are cached independently.

- Filter evaluation runs after document or Filter-request changes, not camera motion.
- Form projection runs after relevant document, filtered projection, dimension, root,
  or Form-setting changes, not hover or camera motion.
- Static node/edge presentation contributions run after document, projection, theme,
  or relevant rendering-setting changes.
- Camera-dependent culling and screen projection may update during camera motion.
- Physics-dependent positions may update during active layout.
- Labels set to `off` perform no label candidate, measurement, collision, or draw work.
- Adaptive labels remain bounded, deterministic, collision-aware, and stable for a
  stationary camera.
- Visible nodes and edges cannot be omitted solely to meet a budget. Accepted culling
  may omit offscreen primitives while preserving visible crossing edges.

Frame composition may reuse internal buffers. The renderer must not receive or mutate
consumer-owned document objects.

## 13. Persistence and Graph+ checkpoints

Graph Engine does not persist consumer graphs automatically. Public exports remain
explicit consumer operations.

The bundled Graph+ consumer must demonstrate efficient persistence:

- one authoritative namespaced checkpoint per vault/graph;
- no steady-state duplication of the same complete graph document under legacy and
  current keys;
- migration may read legacy forms but the next successful save writes the canonical
  form and retires redundant migrated copies safely;
- a camera-only change may persist view/camera state without reserializing an unchanged
  canonical graph document;
- repeated viewport intents debounce into at most one save per settled interaction
  burst;
- close/dispose flushes pending accepted state once;
- save failure is recoverable and does not block interaction or corrupt the last valid
  checkpoint.

Graph+ remains the logical owner of this checkpoint. These requirements do not grant
Graph Engine ownership of another consumer's persistence.

## 14. Performance observability

The existing performance snapshot becomes meaningful rather than nominal. Additive
diagnostics must provide:

- rolling sample count, median, p95, p99, and maximum total frame duration;
- the same rolling statistics for interaction, hit testing, module ticking,
  composition, projection, node drawing, edge drawing, label layout, and label drawing;
- input-to-present latency where the platform can observe it;
- active node and edge counts;
- whether force layout, transition, gesture, or animation kept the frame loop active;
- counts of document validations, public document exports, public view exports,
  projection passes, hit tests, rendered frames, scheduled frames, and persistence
  flushes;
- module-specific tick timing sufficient to identify a slow optional module;
- a way to reset the measurement window before a repeatable scenario.

Diagnostics must use a real monotonic clock in performance tests. A fake clock that
never advances cannot satisfy V1.2 performance acceptance.

Instrumentation must remain inexpensive when disabled and must not expose private
mutable objects to consumers.

## 15. Supported scale tiers

V1.2 defines three deterministic, domain-neutral scale fixtures:

| Tier | Nodes | Edges | Purpose |
| --- | ---: | ---: | --- |
| Small | 250 | 500 | correctness and low-end/mobile smoke |
| Vault | 1,500 | 3,000 | release target approximating the reported Graph+ vault |
| Scale | 5,000 | 10,000 | growth guard and graceful-degradation target |

The Vault tier is a release-blocking interactive target in both 2D and 3D. The Scale
tier must remain mountable, filterable, camera-interactive, exportable, disposable,
and free of runaway work. Exact budgets and measurement conditions are defined in the
acceptance plan.

## 16. Compatibility and migration

- Public protocol version remains `1` unless implementation discovers an unavoidable
  breaking transport change and returns to contract review.
- Additive performance fields use backward-compatible optional/defaulted handling in
  the client artifact.
- Existing profile descriptors and overrides remain valid.
- Existing document and view-state schema versions remain valid unless a separately
  reviewed migration is required.
- Existing Graph+ checkpoints load before canonical compaction.
- Local Graph+ and external synthetic consumers continue to receive equivalent public
  session behavior.
- No consumer can observe whether the engine uses mutable buffers, cached projections,
  or other private performance structures internally.

## 17. Failure and resource behavior

- An optional module that exceeds correctness boundaries or throws is isolated using
  the existing module policy. Performance alone does not silently disable it.
- A required-module failure remains explicit and session-scoped.
- Cache recovery must rebuild from canonical private state, not consumer storage.
- Simultaneous sessions do not share mutable document, view, layout, frame, spatial,
  or measurement buffers.
- Suspended or disposed sessions perform no graph work.
- Repeated mount, dimension switch, suspend/resume, and disposal cycles do not multiply
  listeners, observers, timers, animation frames, modules, or persistence callbacks.

## 18. V1.2 review decisions

Approval of this contract confirms:

1. The V1/V1.1 public and product architecture remains authoritative.
2. Defensive public copies are retained at ingress and egress but removed from internal
   identity checks and frame-by-frame work.
3. Physics remains a module.
4. The current session frame-loop ownership and ordering remain in place.
5. Camera, hover, and physics invalidation cannot rerun unrelated graph-wide work.
6. High-frequency input is coalesced per frame without losing semantic actions.
7. Graph+ persistence becomes canonical and change-aware.
8. Vault-scale performance is a measured release gate, not an informal observation.
9. External module-code registration and PatternSmith smoke-test corrections remain
   deferred.

Implementation begins only after this contract and its acceptance plan are approved.
