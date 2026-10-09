# Graph Engine V1.6 Anima Presentation and Native Motion Acceptance

Status: Automated gates pass; live desktop/mobile behavior accepted.

Date: 2026-09-05

View update: the [View and Scene Contract](graph-engine-view-scene-contract.md)
supersedes the historical click, hover, Focus scene, and implicit framing rules below.
Hover now previews the admitted ordinary object activation; only click commits it.

Depends on: [V1.6 Anima Presentation and Native Motion Contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)

## 1. Acceptance principle

V1.6 succeeds when Graph+'s 2D free graph has the restrained presentation and
elastic response of Obsidian's native graph while retaining Graph+'s current
navigation, focus model, topology weighting, regions, reversible lenses, persistence,
and optional 3D behavior.

The comparison target is observable behavior, not identical final coordinates.
Uniform weighting is the numerical native-motion control. Topology weighting is
accepted when it preserves the control's lifecycle and interaction feel while changing
relative graph geography in the ways already contracted by V1.4.

No automated result substitutes for live desktop and mobile review.

## 2. Documentation and compatibility gates

### A-V16-DOC-01 — Review approval

The V1.6 contract and this acceptance plan are reviewed and approved before
implementation begins.

### A-V16-DOC-02 — Previous contracts remain available

V1.1 through V1.5 contracts and acceptance plans remain Git-tracked and unchanged
except for explicit cross-references or amendments approved as part of V1.6.

### A-V16-COMPAT-01 — Stable profile identity

Graph+ continues to register `graph-plus/default`. Existing compatible checkpoint and
view-state profile identities are not invalidated by a renamed profile.

### A-V16-COMPAT-02 — Other consumers retain declared behavior

Synthetic profiles and PatternSmith preserve their declared:

- effective settings;
- render frames;
- click/focus/activation command traces;
- wheel and touch command traces;
- linear-layout positions;
- persistence behavior; and
- module lifecycle behavior.

The external client artifact remains source-compatible for consumers that do not
do not require Anima.

## 3. Single-system acceptance

### A-V16-MODE-01 — Sole active system

Given a fresh or migrated Graph+ registration, Anima presentation and the
D3-compatible dimension-generic solver are active with no whole-system selector.

### A-V16-MODE-02 — Retired code is unreachable

No profile or quick setting can select the retired renderer, solver, Anima-disabled
path, or comparison state bank. Source and built artifacts contain no executable
branch for those behaviors.

### A-V16-MODE-03 — One coherent state

Positions, camera, pins, focus, selection, and module settings round-trip through one
view state while canonical document identity and Filter/Form configuration remain
unchanged.

### A-V16-MODE-04 — Focus reconciliation

Focus and selection reconcile by stable node ID. Invisible or removed IDs clear
through the normal reconciliation path.

## 4. Anima ownership and safety

### A-V16-ANIMA-01 — Required Graph+ module

Graph+ cannot mount without a healthy Anima module. A required-module failure uses the
existing recoverable/fatal error contract and never falls through to a partially
styled graph.

### A-V16-ANIMA-02 — Presentation reach

A deterministic Anima test contribution changes each supported target independently:

- node color, opacity, and radius;
- label color, opacity, size, and offset;
- edge color, opacity, width, dash, and arrow state;
- region fill/stroke presentation;
- desired node position/offset through the transient layout-constraint boundary;
- edge rest-length and strength modifiers; and
- camera target/zoom through the camera command boundary.

Each change reaches its authoritative subsystem without canonical document mutation.
The target may apply immediately; no general animation timeline is required.

### A-V16-ANIMA-03 — No private subsystem ownership

Static analysis and runtime construction prove Anima receives no mutable renderer,
Canvas context, camera controller, force-layout instance, Obsidian workspace, or
consumer storage reference.

### A-V16-ANIMA-04 — User authority

Direct user camera interaction cancels an active nonessential Anima camera target.
Explicit pins override Anima position/force requests. Filter and Form visibility remain
authoritative over Anima presentation.

### A-V16-ANIMA-05 — Idle and lifecycle

When no force or presentation target is changing, Anima schedules no continuous work.
Suspend and dispose remove every Anima timer, frame request, observer, cache, and
pending target. Resume does not replay a completed transition.

## 5. CSS and theme acceptance

### A-V16-THEME-01 — Native graph role resolution

In a synthetic Obsidian document, set distinct computed values and alpha/opacity for
the graph style probes. Assert that the host palette snapshot preserves their resolved
RGBA values and precedence over generic fallback variables.

Cover roles for base node, focus, tag, link, label, arrow, highlight, and outline.

### A-V16-THEME-02 — Neutral engine boundary

Graph Engine and Anima tests consume neutral palette roles and opaque tokens. No
engine module branches on `note`, `tag`, a vault path, or an Obsidian CSS selector.

### A-V16-THEME-03 — Live CSS refresh

With one mounted session, switch:

1. default light to default dark;
2. default theme to Ebullientworks;
3. Ebullientworks light to dark; and
4. a graph-specific CSS snippet on and off.

The visible palette updates without remounting the session. Positions, camera, Filter,
Form, selection, focus, pins, force alpha, and topology-analysis count remain unchanged.

### A-V16-THEME-04 — Anima precedence

Given overlapping base, kind, Form, focus, and hover styles, assert the contract's
fill precedence. Selection and pin cues remain visible without replacing the winning
fill role.

## 6. Node geometry acceptance

### A-V16-NODE-01 — Exact degree formula

At Node size multiplier `1`, visible degrees `0`, `6`, `7`, `24`, `99`, and `200`
produce world radii approximately:

```text
8, 8, 8.485281, 15, 30, 30
```

At multiplier `2`, each result doubles without changing node position, velocity,
collision radius, topology affinity, or camera.

### A-V16-NODE-02 — Visible degree semantics

Fixtures cover:

- one incoming edge;
- one outgoing edge;
- repeated same-direction canonical records;
- a reciprocal pair;
- a self-edge;
- one render-hidden edge; and
- a Filter change.

Assert the degree calculation follows section 6.1 of the contract and recomputes only
when the active render topology changes.

### A-V16-NODE-03 — Square-root 2D zoom

At orthographic zoom `0.25`, `1`, and `4`, one fixed world radius produces screen
radius factors `0.5`, `1`, and `2`.

At each zoom, drawing, viewport culling, edge clipping, label offset, and hit testing
agree on the boundary within `0.5` CSS pixel.

### A-V16-NODE-04 — Geometry composition

Set a global Node size multiplier, a Form/root multiplier, and an Anima transient
multiplier. Assert the final radius is their declared composition rather than the last
module's value. Toggling Form preserves the configured global multiplier.

### A-V16-NODE-05 — 3D separation

Perspective 3D continues to use depth-aware projection and hit testing. The 2D
square-root compensation is not silently applied to perspective depth. At sufficient
distance, a minimum-degree node retains a `4` CSS-pixel visible radius and every node
retains at least `0.5` of its resolved world radius. Assert that an `8`-radius leaf and
a `24`-radius hub therefore render at `4` and `12` CSS pixels rather than sharing one
floor. A touch at up to `22` CSS pixels from its center selects it, while the same
mouse point outside the visible disc misses. These floors do not affect 2D, force, or
collision geometry.

### A-V16-LABEL-01 — Label size and adaptive preservation

Assert base font size equals `14 + worldRadius / 4`, remains fixed in CSS pixels under
both orthographic zoom and perspective dolly, and remains collision-aware. Focused,
hovered, selected, dragged, and Form-required labels survive the adaptive candidate
budget.

For ordinary colliding labels, explicit structural priority wins first, then larger
Anima world radius, then perspective proximity, then stable node ID. A distant hub
therefore reserves space before a nearer low-degree leaf. In perspective 3D, compare
far and near camera-target scales and assert that dollying closer increases the
ordinary label budget while keeping the Saliency-adjusted result inside `4` through
`120`.

Graph+ defaults Label saliency to `65` in 2D and `50` in 3D. At one fixed camera and
viewport, raising the active dimension's Saliency reduces ordinary accepted labels
without hiding forced labels or changing the other dimension's setting. The control
is present only while label mode is Adaptive and updates without remounting.

### A-V16-LABEL-02 — Anima placement and quick setting

Graph+ defaults `labelPosition` to `above`. Switching the Display quick
setting between Above and Below updates the mounted session without remounting or
changing graph, force, focus, or camera state. Drawing and collision bounds share the
same anchor: four CSS pixels above or below the resolved node boundary, including the
resolved text height for above placement. Both placements work in 2D and 3D.

## 7. Edge presentation acceptance

### A-V16-EDGE-01 — Screen-space width

At zoom `0.125`, `1`, and `8`, baseline screen width remains constant within raster
tolerance. Canonical weights `1`, `5`, and `15` produce the same baseline width.

### A-V16-EDGE-02 — Presentation aggregation

Fixtures cover:

- repeated A to B edges;
- A to B plus B to A;
- an undirected A/B edge; and
- filtered removal of one direction.

Assert one visible shaft per unordered endpoint pair while every canonical edge ID and
direction remains available to Filter, topology, query, action, and export paths.

### A-V16-EDGE-03 — Arrow behavior

Arrows are absent by default. When enabled, one-way pairs show one surviving direction
and reciprocal pairs show both directions without drawing a doubled shaft.

### A-V16-EDGE-04 — Boundary and composition

Increasing final Anima node radius moves the visible link endpoint to the new boundary
without moving the node or changing collision. Form color/dash/depth contributions
compose with the global thickness rather than replacing it.

## 8. Hover, focus, and input acceptance

### A-V16-HOVER-01 — One-hop isolation

Use chain A-B-C-D. Hover B:

- A, B, C, A-B, and B-C target opacity `1`;
- D and C-D target opacity `0.2`;
- B and its incident links use the highlight role;
- B's label is accepted; and
- positions, velocities, alpha, selection, focus, and persisted state do not change.

If interpolation is enabled, assert it converges monotonically and ceases scheduling
frames after reaching tolerance.

### A-V16-HOVER-02 — Focus is the stable neighborhood owner

After focusing A, its incident links are emphasized. Focusing C moves emphasis to C
even if a stale hover still names A. A missed background tap clears focus and restores
ordinary opacity to every link. Touch movement does not latch hover state.
An idempotent clear-focus command also clears any stale transient hover presentation.

### A-V16-FOCUS-01 — Focus-first activation remains

A stationary first click on an unfocused node selects/focuses and fits exactly once
without activating. A later stationary click activates exactly once. Enter activates
the focused node. Crossing the drag threshold cancels stationary-click activation.

### A-V16-FOCUS-02 — Mobile release and restrained framing

A stationary background finger tap clears selection and focus in perspective 3D.
Focus-triggered fitting frames the complete focused neighborhood in one action in both
orthographic and perspective modes, using a centered square safe frame based on the
viewport's shorter dimension. The current neighborhood fit is the Focus zoom-out
boundary, and repeated Center + Fit actions are idempotent.
During initial force settling the fit tracks the focused neighborhood, unless direct
user camera or node-drag input cancels that automatic framing.

### A-V16-INPUT-01 — Canvas-like wheel and pinch remain

- Unmodified wheel input pans in 2D.
- Platform pinch/modified wheel input zooms.
- Touch pinch zooms.
- A one-finger background drag pans 3D Overview and orbits around the selected
  constellation in 3D Explore.
- A focused one-finger drag orbits and retains focus/selection even when it begins on
  another node; that node does not move and does not acquire neighborhood emphasis.
- A stationary tap on that node still transfers focus.
- In 3D, two-finger centroid movement orbits while finger separation zooms during the
  same gesture; Focus retains its target and focus/selection.
- In 2D, two-finger centroid movement pans while finger separation zooms during the
  same gesture.
- A stationary background touch miss clears focus and selection.
- Existing desktop 3D wheel and secondary-drag behavior remains as contracted.

Changing visual zoom compensation does not change the emitted camera command trace.

## 9. Force solver acceptance

### A-V16-FORCE-01 — Numerical oracle

Use fixed initial positions and an independent implementation of the declared
D3-compatible equations. For two-node, three-node path, star, reciprocal-pair, and
disconnected fixtures, compare Graph Engine positions and velocities after `1`, `10`,
and `60` ticks within documented floating-point tolerance.

### A-V16-FORCE-02 — Default constants

Assert the new uniform profile resolves exactly:

- 60 Hz step;
- alpha `1`, target `0`, minimum `0.001`, and decay
  `1 - 0.001^(1 / 300)`;
- velocity retention `0.6`;
- X/Y origin strength `0.1`;
- charge `-1000`, minimum distance `30`, theta `0.9`;
- link distance `250` and degree-derived strength;
- collision radius `60` and strength `0.5`; and
- one link and collision iteration.

### A-V16-FORCE-03 — Cooling

From alpha `1`, the compatibility simulation reaches its stop threshold at
approximately 300 fixed ticks. It does not stop because of one low-velocity frame and
does not remain active after cooling.

### A-V16-FORCE-04 — Refresh independence

Drive an equivalent five-second run using synthetic render schedules of 30, 60, and
120 Hz. Final alpha, positions, and velocities agree within `1%` or one world unit,
whichever tolerance is larger.

### A-V16-FORCE-05 — Collision

Two initially coincident unlinked nodes separate under the declared collision force.
Cover both-free and one-explicitly-pinned cases. Changing visual Node size does not
change the collision target.

### A-V16-FORCE-06 — Drag lifecycle

Drag a hub for at least one second:

- screen pointer error remains at most one CSS pixel;
- neighbors respond while the drag remains held;
- no persistent pin is added for an initially unpinned node;
- drag alpha remains exactly `1` and never exceeds it;
- release causes no position discontinuity;
- release returns the alpha target to zero; and
- the graph continuously slows and freezes within five seconds without changing its force
  equilibrium.

An explicitly pinned node remains pinned after the same gesture.

### A-V16-FORCE-07 — Incremental placement

After settlement:

- add a node connected to two positioned neighbors and assert its initial position is
  near their centroid with bounded jitter;
- add a disconnected batch and assert it starts around/outside the occupied cloud;
- remove a node and assert surviving positions are retained; and
- assert each change thaws alpha to `1` without resetting coordinates.

### A-V16-FORCE-08 — Large-graph responsiveness

On the representative large fixture, hot-layout work preserves the accepted V1.2
render/input budget. A dragged node remains under the pointer within one rendered frame
at p95. If the budget cannot be met in-process, worker execution becomes required.

## 10. Topology and region acceptance

### A-V16-TOPO-01 — Uniform control

New uniform mode has affinity-neutral pair behavior and matches the numerical oracle.
It retains canonical endpoint-pair aggregation without topology-based length or
strength variation.

### A-V16-TOPO-02 — Weighted composition

For affinity `1`, topology-weighted pair parameters equal uniform baseline parameters.
Higher/lower affinities change length and strength monotonically within the configured
bounds while collision, damping, heat, degree bias, and drag rules remain identical.

### A-V16-TOPO-03 — Independent switches

Toggle topology weighting, component handling, region attraction, and visual region
boundaries independently. Hiding boundaries does not implicitly disable or enable
region attraction. Pinning one node does not disable centering for its component.

### A-V16-TOPO-04 — V1.4 regression

Retain every accepted V1.4 invariant for canonical edge preservation, physical
endpoint aggregation, evidence mass, reciprocity, hub discount, relation-channel
handling, bounded affinity, region coordination, component determinism, and cached
analysis.

## 11. Three-dimensional solver acceptance

### A-V16-3D-01 — Finite dimension-generic mechanics

Run the numerical fixtures in 3D with nonzero Z positions. All positions, velocities,
forces, bounds, and diagnostics remain finite. Z participates in origin, link,
many-body, collision, placement, and drag mechanics.

### A-V16-3D-02 — Sphere collision and pins

Coincident 3D nodes separate in a deterministic finite direction. A pinned 3D node
remains exact while unpinned neighbors respond.

### A-V16-3D-03 — Lifecycle parity, not coordinate identity

3D uses the same alpha, damping, heat, drag, and settling lifecycle as 2D. Acceptance
does not require 3D final positions to match a flattened 2D run or native Obsidian.

## 12. Migration acceptance

### A-V16-MIG-01 — Accepted-bank promotion

Starting from dual-bank V1.6 profile data, migration promotes the accepted presentation
and force values into direct module settings and removes both wrappers.

### A-V16-MIG-02 — Retired-state cleanup

Restore/export drops retired comparison-bank module metadata and never recreates it.

### A-V16-MIG-03 — Shared state

Canonical document identity/revision, query, tag/orphan visibility, and Form
configuration survive migration and remain shared according to the contract.

### A-V16-MIG-04 — Idempotence and namespace isolation

Run migration twice and compare serialized state byte-for-byte after normalization.
No duplicate state appears, no stale bank returns, and no other consumer/profile namespace
changes.

### A-V16-MIG-05 — Direct-setting reset

Reset a migrated presentation or force setting and verify the single profile default
returns without affecting another consumer namespace.

## 13. Visual acceptance

Use the same representative vault graph and frozen canonical revision across themes.

### Desktop matrix

- default light theme;
- default dark theme;
- Ebullientworks light;
- Ebullientworks dark;
- narrow and wide desktop panes;
- settled, actively cooling, hovered, focused, selected, dragged, pinned, and Form
  states; and
- uniform and topology-weighted force settings.

Inspect at several zoom levels, including a whole-vault overview and a close local
cluster. Verify degree prominence, square-root node scaling, line width, label
readability, theme roles, hover isolation, link endpoints, region layering, and the
absence of perpetual movement.

### Mobile matrix

- portrait and landscape;
- touch pan, pinch, drag, focus, second-click/tap activation, long-press context, and
  dimension switching;
- safe-area and quick-settings behavior; and
- usable hit targets despite small rendered nodes.

Record screenshots and short movement captures for review. Coordinate differences from
native Obsidian are expected in topology-weighted mode; presentation and kinetic
response must still read as one coherent product.

## 14. Validation sequence

Before implementation is presented as complete, run:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run build:client`
5. `npm run benchmark`
6. `git diff --check`
7. PatternSmith external-consumer smoke validation
8. Graph+ desktop live acceptance
9. Graph+ mobile live acceptance

Generated checkpoint data remains outside the implementation commit unless explicitly
requested.

## 15. Release decision

V1.6 is ready for implementation acceptance only when:

- the contract's ownership boundaries are preserved;
- Anima/native motion is Graph+'s sole active system;
- retired comparison code is unreachable;
- Anima controls the declared visual, geometry, force-target, and camera-target seams;
- uniform 2D matches the numerical compatibility oracle;
- topology-weighted mode retains V1.4 semantics over the new solver;
- current navigation and focus-first activation remain unchanged;
- other consumers remain unchanged;
- migration is idempotent; and
- the live desktop/mobile visual result is approved.
