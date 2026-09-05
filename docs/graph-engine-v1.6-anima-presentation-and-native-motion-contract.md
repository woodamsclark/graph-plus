# Graph Engine V1.6 Anima Presentation and Native Motion Contract

Status: Approved; implementation candidate complete, live desktop/mobile acceptance pending.

Date: 2026-09-05

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.2 Scalability Contract](graph-engine-v1.2-scalability-contract.md)
- [Graph Engine V1.3 Tag Regions Contract](graph-engine-v1.3-tag-regions-contract.md)
- [Graph Engine V1.4 Topology-Weighted Layout Contract](graph-engine-v1.4-topology-weighted-layout-contract.md)
- [Graph Engine V1.5 Linear Build-out Layout Contract](graph-engine-v1.5-linear-build-out-layout-contract.md)
- [Graph Engine V1.6 Acceptance Plan](graph-engine-v1.6-anima-presentation-and-native-motion-acceptance.md)

## 1. Purpose

V1.6 gives Graph+ the visual weight, elastic motion, and quiet theme integration of
Obsidian's native graph without turning Graph+ into a clone of the native product.
It preserves the accepted Graph Engine and Graph+ design intent:

- trackpad wheel input pans and pinch input zooms, matching Obsidian Canvas;
- a first stationary node click selects, focuses, and fits rather than immediately
  opening the node;
- topology weighting, tag regions, reversible Filter and Form, explicit pins, 3D,
  checkpoint persistence, and adaptive rendering remain available;
- the new system is Graph+'s default, while the complete legacy system remains
  selectable for in-app comparison; and
- new attachment, unresolved-node, and other graph-content types are deferred.

V1.6 assigns presentation policy and future choreography to Anima. It also introduces
a D3-compatible force model whose 2D behavior is calibrated against Obsidian's native
graph and whose equations generalize to 3D.

The governing rule is:

> Anima decides how the graph should look and change; the renderer, camera, and force
> solver remain authoritative mechanisms that realize those declarative targets.

## 2. Compatibility and mode boundary

The stable consumer/profile key remains `graph-plus/default`.

Graph+ adds one profile setting with two values:

```text
graphSystem: new | legacy
```

- `new` is the declared and effective default for fresh and existing installations.
- `legacy` restores the complete pre-V1.6 presentation, force, contribution,
  interaction, and camera behavior for comparison.
- Switching modes changes no canonical graph document and does not change the stable
  consumer/profile identity.
- The setting is profile-backed and may be exposed in both the plugin settings page
  and the Graph+ quick-settings surface.
- Graph Engine's generic fallback behavior and other consumer profiles remain legacy
  unless their own profile explicitly selects new V1.6 capabilities.

V1.6 is intentionally allowed to change Graph+'s active default because Graph+ is a
local pre-release product. It may not silently change PatternSmith or an unregistered
external consumer.

### 2.1 Mode isolation

The two modes share:

- the canonical graph document and document revision;
- Graph+ query text and Filter configuration;
- tag and orphan visibility choices;
- Form configuration and root identity; and
- consumer-owned node actions and vault semantics.

The two modes retain separate:

- node positions and velocities;
- camera state;
- explicit pins;
- force and presentation settings;
- module state; and
- settled/running state.

When switching modes, the destination mode restores its last compatible view state.
On its first activation it derives its own defaults. Current focus and selection may
be reconciled by stable node ID when those nodes remain visible, but one mode never
overwrites the other mode's positions, pins, or camera.

## 3. Anima ownership

Anima is required and enabled in Graph+'s `new` mode. It remains optional for legacy
and other consumer profiles.

Anima owns the declarative, time-varying presentation and choreography policy for:

- node fill, stroke, opacity, visual radius, and state emphasis;
- label color, opacity, font size, offset, and visibility priority;
- edge color, opacity, visible thickness, dashing, arrow visibility, and arrow opacity;
- region fill, stroke, opacity, and other non-membership presentation;
- desired node position or positional offset through a transient layout-constraint
  channel;
- desired edge-rest-length and force-strength modifiers;
- desired camera position, target, zoom, projection-compatible framing, and transition
  targets; and
- the composition and precedence of base theme, node kind, Form role, topology role,
  selection, focus, hover, drag, and future temporal effects.

This ownership is broad enough for future live resizing, recoloring, edge breathing,
camera travel, and force choreography.

### 3.1 Mechanism boundary

Anima does not:

- draw directly to Canvas, WebGL, or another render backend;
- edit canonical nodes, edges, weights, tokens, regions, or checkpoints;
- integrate positions or velocities;
- replace the force solver;
- write camera state around the camera controller;
- rewrite DOM theme CSS or inject product-specific style sheets; or
- retain private references to renderer, camera, force-layout, Obsidian workspace, or
  consumer storage objects.

Instead, Anima emits declarative targets through engine-owned contribution channels.
The authoritative subsystem applies and validates each target:

| Anima target | Authoritative mechanism |
| --- | --- |
| node, label, edge, and region appearance | frame composition and renderer |
| node and edge geometric presentation | frame composition, projection, culling, and hit testing |
| desired node position or positional offset | layout/force constraint pipeline |
| edge rest length or strength | force-layout module |
| camera destination or framing | camera controller and command pipeline |
| frame timing and cancellation | session scheduler |

User camera input cancels or supersedes nonessential Anima camera choreography.
Explicit pins remain authoritative over Anima force targets. Filter and Form continue
to determine which canonical elements are eligible before Anima presents them.

This boundary is a technical requirement, not a reduction of Anima's creative scope.
It prevents two position integrators, two cameras, or two renderers from competing for
the same state while allowing Anima to animate any visible property later.

### 3.2 V1.6 versus later animation work

V1.6 must establish contribution channels that can accept changing values over time.
It must implement the static resolved presentation and the runtime invalidation needed
to update those values safely. A general timeline, keyframe, easing, sequencing, and
authoring system is deferred to Anima 2.0 or later.

V1.6 may apply a changed target immediately unless this contract specifies a small
native-style interpolation. Reduced-motion policy must be capable of snapping every
nonessential future transition to its target.

## 4. Host CSS and theme boundary

Graph+ renders graph primitives to a canvas, so individual graph nodes are not DOM
elements that CSS can style directly. The Obsidian host adapter therefore samples the
host's computed graph styles and gives Anima a neutral palette snapshot.

The host adapter owns:

- creating or locating safe `.graph-view.color-*` style probes;
- reading computed color and opacity;
- falling back from graph-specific styles to `--graph-*` variables and then generic
  Obsidian variables;
- observing Obsidian CSS/theme changes; and
- publishing an immutable palette update to active sessions.

Anima owns:

- mapping neutral node/edge tokens and interaction state to palette roles;
- color and opacity precedence;
- resolving the final node, edge, label, arrow, and region presentation; and
- invalidating only presentation-dependent work when the palette changes.

Graph Engine remains unaware of the meanings of `note`, `tag`, or any particular
Obsidian CSS class. Graph+ maps its opaque tokens to neutral palette roles through its
profile/adapter boundary.

At minimum, the new Graph+ profile supplies roles equivalent to:

- base node;
- focused node;
- tag node;
- link;
- label;
- arrow;
- hover/drag highlight; and
- focused/hover outline.

Attachment and unresolved roles may exist in the neutral palette contract but Graph+
does not ingest those graph-content types in V1.6.

Palette changes do not change positions, topology, force heat, Filter, Form, focus,
selection, or persistence.

## 5. Contribution composition

V1.6 replaces shallow property replacement with explicit per-property composition.

Numeric scales such as radius, opacity, edge thickness, edge rest length, and force
strength compose multiplicatively unless the property contract explicitly declares an
absolute target. Color and discrete modes use priority-based replacement.

The required presentation order is:

1. Rendering establishes neutral primitive defaults.
2. Structural metrics establish degree prominence and graph-wide display multipliers.
3. Form, topology, and regions contribute structural role modifiers.
4. Anima resolves theme roles and all final presentation values.
5. Transient Anima states such as hover and drag receive the highest visual priority.

Final fill precedence in Graph+ `new` mode is:

1. hover or drag;
2. focused node;
3. first matching Graph+ color rule, when later implemented;
4. Form branch;
5. node kind; and
6. base node.

Selection, region membership, and explicit pin cues should prefer strokes, halos, or
other orthogonal channels so they do not erase semantic fills.

Every resolved geometric value used for drawing must also be used for culling, edge
clipping, label placement, and baseline hit testing. A platform-appropriate touch
target may expand beyond the visible disc as an input accessibility affordance; it
does not alter drawing, layout, collision, mouse hit testing, or canonical geometry.

## 6. Node presentation

### 6.1 Degree prominence

In Graph+'s new free graph, Anima resolves the base world radius using the exact
Obsidian-compatible curve:

```text
worldRadius = nodeSizeMultiplier * clamp(3 * sqrt(visibleDegree + 1), 8, 30)
```

`visibleDegree` is derived from the active render topology:

- unique visible inbound and outbound directed relationships contribute;
- repeated records for the same ordered relationship do not increase visual degree;
- reciprocal directions may each contribute;
- hidden nodes and edges do not contribute; and
- self-edges do not increase prominence.

Graph Engine derives and caches the neutral degree metric. Anima consumes it and owns
the resulting geometric presentation. Consumers do not calculate display radii.

The Node size setting is a positive global multiplier. Form root/branch prominence and
future Anima resizing multiply the base radius rather than replacing the user's global
setting.

### 6.2 Two-dimensional zoom response

In an orthographic 2D view, the effective screen radius is:

```text
screenRadius = worldRadius * sqrt(cameraZoom)
```

Node coordinates continue to use the camera's ordinary linear world-to-screen
projection. This partial compensation makes nodes shrink more slowly when zooming out
and grow more slowly when zooming in. At zoom `0.25`, `1`, and `4`, a node's screen
radius is respectively `0.5`, `1`, and `2` times its radius at zoom `1`, rather than
`0.25`, `1`, and `4` times.

This is presentation scaling, not a change to wheel/pinch behavior, camera bounds,
node positions, force mass, collision radius, or topology.

Perspective 3D retains depth-aware camera projection and therefore preserves the
relative size difference between near and distant nodes. In Graph+ new mode, Anima
declares a `4` CSS-pixel minimum visible radius so a distant node never collapses into
an imperceptible speck. This floor affects drawing, culling, edge clipping, and exact
hit testing but does not affect force or collision geometry.

For perspective touch input only, Anima declares a `22` CSS-pixel minimum hit radius,
providing a `44` CSS-pixel finger target without enlarging the rendered disc. Exact
visible-disc hits retain priority; otherwise the nearest eligible screen-space node
wins, with depth as the tie-breaker. Orthographic and mouse behavior are unchanged.

### 6.3 Labels

New-mode label sizing begins with:

```text
fontSize = 14 + worldRadius / 4
```

In 2D the label receives the same square-root zoom compensation as its node. Adaptive
collision rejection and budgeting remain enabled as a Graph+ enhancement. Focused,
hovered, selected, dragged, and Form-required labels remain forced candidates.

Anima owns a two-value `labelPosition` presentation setting:

- `above` anchors the label four CSS pixels beyond the top node boundary;
- `below` anchors it four CSS pixels beyond the bottom node boundary; and
- Graph+ new mode defaults to `above` and exposes both values in quick settings.

The label's resolved height is included in the above anchor, and the existing Anima
label offset applies after placement. The choice is profile-backed and works in both
2D and 3D. Automatic platform-dependent selection is deferred.

A future text-fade control may be owned by Anima. V1.6 does not require replacement of
the accepted adaptive label budget merely to duplicate every native label.

## 7. Edge presentation

The baseline new-mode edge width is a global screen-space value independent of camera
zoom, canonical edge weight, parallel multiplicity, and physical affinity.

- Default Link thickness is `1` CSS pixel.
- The exposed multiplier range is `0.1` through `5`.
- Canonical weight remains available to topology analysis, queries, export, and later
  opt-in Anima effects.
- Links terminate at the final Anima-resolved node boundaries.
- Arrows are disabled by default in the Graph+ new profile.

Graph Engine derives at most one presentation shaft for an unordered endpoint pair
without modifying canonical edges. Repeated or reciprocal canonical edges retain all
IDs and direction data. When arrows are enabled, one shaft may carry the surviving
direction indicators at either or both ends.

Form branch color, cross-link dashing, and depth emphasis remain Graph+ enhancements.
Their scales compose with, rather than replace, the global edge settings.

## 8. Interaction presentation

V1.6 preserves the existing focus-mode product behavior:

- the first stationary click on an unfocused node selects and focuses it and may fit
  the camera;
- a later stationary click on the still-focused node invokes the profile's first
  activation action;
- Enter activates the focused node;
- a background tap or committed background pan clears selection and focus; and
- context actions remain available without changing focus merely by opening the menu.

Anima presents focus, selection, hover, drag, pin, and region state but does not alter
their state-machine meaning.

Hover/drag presentation should adopt the useful native visual pattern:

- the active node, direct neighbors, and incident links target full opacity;
- unrelated visible nodes and links target `0.2` opacity;
- the active node and incident links receive the highlight role;
- the active label is forced visible; and
- no hover-only change affects physics or persistence.

For neighborhood emphasis, active-node precedence is drag, then focus, then hover.
Focus therefore owns the highlighted neighborhood after a click, follows a later click
to a different node, and releases all neighborhood emphasis when focus clears. Touch
movement and completed touch node drags never create a persistent hover target. Clearing
interaction presentation is required even when the requested focus ID already matches
the stored focus state; an idempotent focus command may not leave stale hover behind.

A small exponential interpolation may approach these opacity/color targets. It must
stop scheduling frames once the resolved values reach their targets.

## 9. Navigation and camera behavior

V1.6 preserves current Graph Engine/Graph+ navigation rather than adopting all native
Graph view input behavior:

- unmodified trackpad/mouse wheel pans in an unfocused 2D graph;
- trackpad pinch, represented by the platform's modified wheel gesture, zooms;
- touch pinch zooms;
- background pointer drag pans in 2D and in unfocused 3D;
- in focused 3D, one-finger primary drag orbits around the focus while retaining
  selection and focus, even when the gesture begins inside another node's hit target;
- node dragging is disabled while 3D focus is active; a stationary tap on another node
  still transfers focus normally;
- in focused 3D, two-finger translation pans the camera/focus offset while retaining
  selection and focus;
- a stationary background tap whose hit test misses clears selection and focus;
- pinch continues to zoom in both focused and unfocused states;
- current focus-follow, fit, reset, keyboard, and desktop 3D orbit behaviors remain
  unless separately reviewed; and
- V1.6 does not require native Graph view pan inertia or native plain-wheel zoom.

A node-focus fit may magnify the current view by at most `1.75` times per focus
activation in both projection modes. It may still zoom out as needed to frame a large
focus set. Explicit fit-all and reset commands remain uncapped. This keeps focus
legible without placing the camera effectively on top of a single node.

The 2D square-root node scaling in section 6.2 changes only how large nodes look under
the existing camera zoom.

Anima receives a future-safe camera-target contribution channel. V1.6 uses it only
where needed to preserve existing focus/fit behavior. Later Anima versions may perform
camera choreography, subject to these rules:

- direct user camera input cancels nonessential choreography immediately;
- the camera controller validates projection, bounds, and finite state;
- Anima never writes persisted camera state except through the ordinary command and
  view-state pipeline; and
- suspended or disposed sessions retain no camera animation callback.

## 10. Solver decision record

### 10.1 What a force solver is

A force-directed solver treats nodes as moving bodies. On each simulation tick it
combines several influences, updates velocity, and then updates position. Typical
influences include:

- links acting like springs;
- nodes repelling one another;
- gravity or position forces keeping the graph near an origin;
- collision preventing bodies from occupying the same space; and
- damping and a cooling schedule that remove energy until the graph stops.

The precise equations matter more than similarly named sliders. Two solvers can both
offer “Repel,” “Link force,” and “Link distance” while producing very different motion.

### 10.2 Why the current solver differs

The legacy Graph Engine solver is a reasonable custom, dimension-generic foundation.
It provides deterministic directions, bounded `tanh` springs, Barnes-Hut acceleration,
speed limiting, topology-affinity mapping, component targets, and common 2D/3D vector
handling. Those choices favor boundedness, implementation control, and a direct path
for Graph Engine's topology work.

They were not sufficiently characterized against the later product goal of native
Obsidian motion. In particular, the legacy solver has:

- a saturating `tanh` link response rather than a linear displacement spring;
- inverse-square repulsion magnitude rather than D3-style inverse-distance magnitude;
- no dedicated collision force;
- full reheats for changes that native Obsidian treats as partial reheats;
- render-frame-dependent cooling/integration; and
- a temporary-drag path coupled to the persistent pin collection.

The result is not a bad solver; it is a different solver. Extreme saved Graph+ force
values are evidence of trying to tune one mathematical model to resemble another.

### 10.3 Alternatives considered

| Solver family | Strengths | Why it is not the V1.6 default |
| --- | --- | --- |
| D3-style force simulation | interactive, elastic, incremental, familiar Obsidian feel | chosen baseline |
| Fruchterman-Reingold | simple and well-known force-directed layout | less direct parity and fewer useful interaction/lifecycle conventions |
| ForceAtlas2 | strong community separation and hub behavior | can overemphasize hubs and remain visually active; different native feel |
| stress majorization / multidimensional scaling | globally coherent graph distances | heavier global recomputation and less local interactive continuity |
| multilevel force layout | scalable for very large graphs | greater complexity and less transparent parity target |
| hierarchical / Sugiyama | clear directed rank and flow | appropriate for Form or curricula, not a free associative graph |
| constraint or orthogonal layout | precise authored structure | too rigid for the desired organic free graph |
| spectral layout | deterministic global structure | weak drag continuity and expensive topology-wide updates |

V1.6 chooses a D3-compatible force model because the desired behavior is interactive,
elastic, local, and intentionally close to Obsidian. It is also a clean base beneath
Graph Engine's existing topology-affinity overlay.

### 10.4 Library versus equations

V1.6 does not require importing the `d3-force` package. The stock D3 implementation is
two-dimensional. Graph Engine may implement the compatible equations within its own
dimension-generic solver, preserving its neutral contracts, performance instrumentation,
and 3D support.

The compatibility requirement is observable mechanics, not dependency choice.

## 11. New force model

### 11.1 Two-dimensional baseline

Graph+'s new uniform 2D mode uses:

- fixed simulation step: `1 / 60` second;
- initial alpha: `1`;
- alpha target: `0`;
- alpha minimum: `0.001`;
- alpha decay: `1 - 0.001^(1 / 300)`;
- velocity retention per tick: `0.6`;
- independent X and Y origin-force strength: `0.1`;
- many-body charge: `-1000`;
- many-body minimum distance: `30`;
- Barnes-Hut theta: `0.9`;
- link target distance: `250`;
- base link strength: `1 / min(sourceDegree, targetDegree)`;
- degree-biased endpoint motion;
- collision radius: `60`;
- collision strength: `0.5`; and
- one iteration of link and collision forces per tick.

The force order is origin position, link, many-body, collision, velocity damping, and
position integration. Link and collision calculations use anticipated positions where
required by the chosen compatible formulation.

Simulation results must be independent of display refresh. The runtime uses a fixed
step accumulator or an equivalent time-correct method and bounds catch-up work after a
long suspension.

### 11.2 Heat and drag

- Fresh layout starts at alpha `1`.
- Document and force-setting changes raise alpha to at least `0.3` without reducing a
  currently hotter simulation.
- Active node drag sets alpha target to `0.3`.
- The dragged node is a transient kinematic constraint distinct from explicit pins.
- Drag release clears the transient constraint and returns alpha target to `0` without
  reheating to `1`.
- An explicitly pinned node remains pinned after drag.
- New mode stops when alpha falls below the configured minimum; a single low-velocity
  frame does not end it early.

### 11.3 Incremental placement

Existing positions survive document changes. A new connected node begins near the
mean of its already-positioned visible neighbors with bounded deterministic jitter. A
new disconnected node begins outside or around the occupied cloud rather than at the
same small central seed. Adding one node does not reinitialize existing nodes.

Placement is an engine strategy because it requires canonical topology plus current
session positions. Consumers continue to provide stable IDs and neutral graph evidence.

## 12. Three-dimensional generalization

The native Obsidian graph solver is two-dimensional. Its force model can be generalized
to 3D, but the result is a Graph Engine 3D solver, not literal native Obsidian behavior.

Graph Engine's new solver supports 3D by extending the same mechanics:

- X, Y, and Z origin forces use the configured baseline strength;
- link distance is Euclidean in three axes;
- many-body approximation uses the engine's 3D spatial tree;
- collision uses spheres instead of circles;
- drag constrains the node on the engine's selected interaction plane/depth;
- damping, alpha, heat, pins, and incremental placement retain the same lifecycle; and
- the perspective camera and depth-aware rendering remain Graph Engine mechanisms.

Uniform 3D uses the same declared force settings as uniform 2D unless a profile
explicitly overrides them. Because a third degree of freedom changes equilibrium,
3D acceptance tests verify invariants and qualitative response rather than identical
2D coordinates.

Graph+'s default dimension remains 2D. Switching dimension does not switch
`graphSystem` and does not discard either mode's separately saved view state.

## 13. Topology, regions, and Form in new mode

The new Graph+ defaults are:

- topology weighting: enabled;
- component handling: enabled;
- direct region attraction: enabled;
- region boundaries: hidden;
- adaptive labels: enabled;
- Form: disabled until the learner/user invokes it;
- Anima: required and enabled; and
- dimension: 2D.

Uniform mode within the new force model is the exact numerical comparison baseline.
Topology-weighted mode composes bounded affinity over the new link force:

- affinity `1` reproduces the uniform pair's baseline target and strength;
- stronger affinity creates a bounded shorter/stiffer pair;
- weaker affinity creates a bounded longer/softer pair;
- topology may not replace collision, degree bias, heat, damping, or drag semantics;
- canonical edges and all V1.4 evidence remain unchanged; and
- component handling, topology weighting, and region attraction have independent
  effective settings even when the Graph+ UI presents a simplified default.

For a physical pair, the declared composition order is profile baseline, topology
affinity, coordinated region influence, then a bounded Anima target modifier. Anima
cannot bypass finite-value validation, profile constraints, explicit pins, or the
solver's safety bounds.

Form continues to own derived positions while active and remains reversible. Anima
owns the Form projection's visual branch treatment and may later choreograph the
transition, but V1.6 requires no Form animation.

## 14. Settings and controls

Graph+ new mode exposes familiar display and force settings whose values affect only
the new-mode namespace.

At minimum:

- Graph system: `New` or `Legacy`;
- Node size multiplier;
- Link thickness multiplier;
- Show arrows;
- topology weighting mode;
- center/origin force;
- repel force;
- link force;
- link distance;
- region attraction;
- show region boundaries; and
- existing Filter, Form, camera, and dimension controls.

The new force controls use user-facing ranges compatible with the intended native
baseline while the engine stores explicit effective values. A reset in new mode
restores new defaults only. A reset in legacy mode restores legacy defaults only.

The whole-system switch must be clearly separated from individual tuning controls so
a comparison does not accidentally rewrite one mode using the other's units.

## 15. Persistence and migration

On first V1.6 load:

1. Persist the existing pre-V1.6 Graph+ profile overrides and compatible view state in
   the `legacy` namespace.
2. Create the `new` namespace from V1.6 defaults.
3. Set `graphSystem` to `new`.
4. Preserve the canonical external graph document and shared Filter/Form configuration.
5. Do not reinterpret legacy force numbers as new-solver values.

The migration is idempotent. Re-running it does not duplicate state, reset either
mode, or touch another consumer namespace.

The descriptor version and module settings schema version are evidence, not a migration
mechanism by themselves. V1.6 requires an explicit version-aware migration path.

Switching modes after migration:

- restores the destination positions, camera, pins, and module state;
- preserves shared Filter/Form configuration;
- reconciles focus and selection by stable visible node ID;
- schedules only the work required by the destination mode; and
- never deletes the inactive mode's state.

Importing `.obsidian/graph.json`, automatic parity with future Obsidian releases, and a
general profile-management UI are deferred.

## 16. Performance and lifecycle

V1.6 inherits every V1.2 performance, suspension, and disposal requirement.

- Degree and endpoint-pair metrics are event-driven and cached.
- Anima does not rescan the graph every frame.
- A settled graph with no active Anima interpolation schedules no continuous frame.
- CSS/theme changes invalidate presentation only.
- Camera-only changes do not rerun topology or force analysis.
- Node-radius changes update drawing, culling, clipping, labels, and hit geometry
  through one resolved geometry path.
- Force work may move to a worker or remain in-process only if the accepted large-graph
  interaction budget is met.
- Suspended sessions stop force, Anima, camera, contour, and rendering work.
- Disposal releases every observer, worker, timer, frame callback, cache, and target.

## 17. Non-goals and deferrals

V1.6 does not include:

- complete behavioral duplication of Obsidian Graph view;
- plain-wheel zoom, native pan inertia, or single-click node opening;
- attachment, unresolved-link, Canvas, Base, or other new graph-content ingestion;
- a general Anima timeline, keyframe editor, choreography language, or animation UI;
- automatic color groups beyond the existing Graph+ token/profile mechanisms;
- importing native Obsidian graph settings;
- replacing the Canvas renderer;
- identical 2D and 3D final coordinates;
- identical final coordinates to Obsidian when topology weighting or regions are active;
- consumer-specific semantics inside Graph Engine or Anima; or
- deleting the legacy Graph+ implementation.

## 18. Review decisions

Approval of this contract confirms:

1. Graph+ seeks native-inspired presentation and motion, not full native behavior.
2. Current Canvas-like wheel/pinch navigation and focus-first activation remain.
3. `graph-plus/default` remains the stable profile ID.
4. `graphSystem` switches the complete Graph+ system between separately persisted
   `new` and `legacy` modes.
5. `new` is the default for both fresh and existing local installations.
6. Anima is required in new mode and owns static and future time-varying presentation,
   including geometric sizing, force targets, and camera targets.
7. Renderer, force-layout, and camera remain authoritative mechanisms; Anima reaches
   them through declarative contributions and commands.
8. The host adapter reads Obsidian CSS; Anima interprets the resulting neutral palette.
9. Node prominence uses the exact degree formula and 2D square-root zoom compensation.
10. Baseline edge width is screen-space and independent of topology evidence.
11. The new solver uses D3-compatible 2D mechanics and a dimension-generic 3D
    generalization.
12. Topology weighting, component handling, and region attraction compose over the new
    solver rather than replacing its collision, cooling, degree bias, or drag lifecycle.
13. V1.6 defaults to 2D, topology weighting on, regions active with hidden boundaries,
    adaptive labels on, Form off, and Anima on.
14. Existing state becomes the legacy comparison state; new mode starts from new
    defaults and becomes active automatically.
15. New graph-content types and general Anima animation authoring remain deferred.

Implementation begins only after this contract and its acceptance plan are reviewed
and approved.
