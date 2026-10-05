# Graph Engine V1.6 Anima Presentation and Native Motion Contract

Status: Accepted in live desktop/mobile use; legacy comparison retired.

Date: 2026-09-05

View update: the [View and Scene Contract](graph-engine-view-scene-contract.md)
supersedes the historical click, hover, Focus scene, and implicit framing rules below.
Hover now previews the admitted ordinary object activation; only click commits it.

Migration note: the selection/Ego/Awareness ownership in this contract is superseded by
[Graph Engine agency and Awareness ontology](graph-engine-agency-awareness-ontology.md).
Phases 2 through 7 have migrated conscious-state ownership, policy, exogenous
influence, and explicit Anima classification while retaining compatible presentation
behavior and enforcing projection-before-presentation module stages.

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
- the Anima/native-motion system is Graph+'s sole presentation and motion path; and
- new attachment, unresolved-node, and other graph-content types are deferred.

V1.6 assigns presentation policy and future choreography to Anima. It also introduces
a D3-compatible force model whose 2D behavior is calibrated against Obsidian's native
graph and whose equations generalize to 3D.

The governing rule is:

> Anima decides how the graph should look and change; the renderer, camera, and force
> solver remain authoritative mechanisms that realize those declarative targets.

## 2. Compatibility and system boundary

The stable consumer/profile key remains `graph-plus/default`. Graph+ has one active
presentation and motion system: Anima owns presentation policy and the force module
uses the dimension-generic D3-compatible solver. No whole-system selector is exposed.
Neutral consumers retain their own profile policies for initial placement, drag
constraints, module enablement, and presentation without selecting a historical
Graph+ implementation.

V1.6 is intentionally allowed to change Graph+'s active default because Graph+ is a
local pre-release product. It may not silently change PatternSmith or an unregistered
external consumer.

### 2.1 State ownership

The canonical graph document, Filter/Form configuration, positions, camera, explicit
pins, focus, selection, and module state remain under their existing owners. Retired
comparison-bank metadata is discarded during restore/export and never recreated.

## 3. Anima ownership

Anima is required and enabled for Graph+. It remains optional for other consumer
profiles.

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

1. Animus establishes the canonical graph, display membership, topology, positions,
   interaction state, and structural roles.
2. Form, topology, and regions annotate semantic roles without emitting colors or
   other visual properties.
3. Anima establishes neutral primitive defaults and resolves theme roles plus all
   final presentation values.
4. Transient Anima states such as hover and drag receive the highest visual priority.
5. The renderer draws the resolved scene without interpreting graph state or theme
   roles.

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

The Node size setting is a positive global multiplier, defaulting to `1.00`. Form root/branch prominence and
future Anima resizing multiply the base radius rather than replacing the user's global
setting.

### 6.2 Two-dimensional zoom response

Node zoom contrast is fixed at the former slider's `100%` effect. There is no
contrast control, and legacy `nodeWorldScaleBlend` values are ignored. Within the
visible radius range, the smallest node receives exponent `0.5`, the largest
receives `2`, and intermediate nodes interpolate by normalized world radius.
Equal-sized nodes retain exponent `0.5`.

In an orthographic 2D view, the effective screen radius is:

```text
screenRadius = worldRadius * cameraZoom ^ nodeScaleExponent
```

Node coordinates continue to use the camera's ordinary linear world-to-screen
projection. Small nodes respond gently to zoom, while larger nodes respond more
strongly. The former square-root response remains the smallest-node and equal-size
fallback.

This is presentation scaling, not a change to wheel/pinch behavior, camera bounds,
node positions, force mass, collision radius, or topology.

Perspective 3D retains depth-aware camera projection and therefore preserves the
relative size difference between near and distant nodes. To prevent perspective from
flattening degree prominence when the whole graph is framed, Anima declares both a
`4` CSS-pixel absolute minimum and a `0.5` minimum scale of each node's resolved world
radius:

```text
screenRadius = max(worldRadius * perspectiveScale ^ nodeScaleExponent, 4, worldRadius * 0.5)
```

The relative floor means a minimum-degree node bottoms out at `4` CSS pixels while a
larger hub retains the same degree-derived size ratio instead of collapsing onto the
same fixed floor. Above the floor, ordinary perspective depth still distinguishes
near and distant nodes. These floors affect drawing, culling, edge clipping, and exact
hit testing but do not affect force or collision geometry.

For perspective touch input only, Anima declares a `22` CSS-pixel minimum hit radius,
providing a `44` CSS-pixel finger target without enlarging the rendered disc. Exact
visible-disc hits retain priority; otherwise the nearest eligible screen-space node
wins, with depth as the tie-breaker. Orthographic and mouse behavior are unchanged.

### 6.3 Labels

Graph+ label sizing begins with:

```text
fontSize = 14 + worldRadius / 4
```

Labels use their resolved font size in fixed CSS pixels in both 2D and 3D. Focus keeps
the root at the resolved 100% size and renders its immediate-neighbor labels at 50%.
A hovered neighbor uses 100%, matching its future root label size throughout the preview.
They remain
readable while the graph recedes, matching the accepted 3D overview treatment rather
than shrinking with orthographic zoom. Adaptive collision rejection and budgeting
remain enabled as a Graph+ enhancement. Anima forces labels for highlighted nodes,
leaves standard nodes under the adaptive label policy, and suppresses labels for dimmed
or void nodes. Session Memory is an adaptive rather than forced label source in Focus.
Form-required labels remain structurally forced candidates.

Adaptive label collision slots are resolved in this stable order:

1. Anima highlighted subjects, including hover, Attention, and session Memory;
2. explicit structural label priority, including Form roles;
3. perspective proximity, nearest first;
4. resolved Anima world radius, largest first; and
5. stable node ID.

Explicit semantic and structural priority therefore remain authoritative, while two
otherwise-equal labels resolve to the one physically nearer the camera. An ordinary
adaptive label is also rejected when its node anchor or label bounds are occluded by a
nearer visible node disc. Forced interaction labels bypass this occlusion rule. Only
onscreen nodes are candidates.

The base adaptive label budget grows with viewport area and effective zoom. The RC
saliency mapping caps the adjusted budget at `60` and uses the slider-dependent
minimum below. In 2D effective zoom is the orthographic camera zoom with the existing
lower bound. In 3D it is the
perspective scale at the camera target, so dollying closer reveals progressively more
ordinary labels and dollying away returns to the hub-first overview. Collision
rejection remains active at every budget.

Graph+ exposes **Label saliency** in Display while label mode is Adaptive. The value
is stored independently as `adaptiveLabelThreshold2d` and
`adaptiveLabelThreshold3d` for compatibility, each from `0` through `100`. Higher
values narrow the visible periphery by delaying ordinary labels; direct cursor focus
is unaffected. Graph+ defaults to `65` in 2D and `50` in 3D. For Saliency `s`, the
renderer applies:

```text
saliencyFactor = 2 ^ (-s / 50)
minimumBudget = clamp(round(12 * saliencyFactor), 1, 12)
budget = clamp(round(baseAdaptiveBudget * saliencyFactor), minimumBudget, 60)
```

The RC shifts the entire mapping to roughly half the prior automatic-label budget.
The distant-zoom minimum is `12` at `0`, `6` at `50`, and `3` at `100`. Cursor proximity
is the default Graph+ label mode, separate from Adaptive. Off suppresses all labels,
including hover and proximity. Changing the
slider updates the mounted session without changing label rank, graph state, or the
other dimension's value.

Anima owns a two-value `labelPosition` presentation setting:

- `above` anchors the label four CSS pixels beyond the top node boundary;
- `below` anchors it four CSS pixels beyond the bottom node boundary; and
- Graph+ defaults to `above` and exposes both values in quick settings.

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

The current interaction policy is constellation-first:

- the first stationary click selects one node and enters Explore without moving the camera;
- later stationary clicks toggle membership and add the nearest visible path when adding;
- Enter activates only when exactly one node is selected;
- a stationary background activation clears selection and Focus without moving the camera; and
- context actions remain available without changing focus merely by opening the menu.

Consciousness supplies explicit Attention and Awareness membership. Anima classifies
projected nodes as attended, peripherally aware, or unaware context, then resolves
those classes with focus, hover, drag, and preview facts into semantic UI roles without
altering their state-machine meaning, and also presents pin and region state.

While Explore/Constellation is active, selected members and their structural links
receive emphasis. Every other projected node and link, including unrelated
non-neighbors, remains rendered as subdued graph context. Context nodes use their
ordinary node or tag theme color with 80% desaturation at `0.24` opacity, and context
links use the same 80% desaturation policy at `0.6` opacity. Constellation
presentation does not hide the surrounding graph.

Hover/drag presentation should adopt the useful native visual pattern:

- the active node, direct neighbors, and incident links target full opacity;
- unrelated visible nodes and links target `0.2` opacity;
- the active node and incident links receive the highlight role;
- the active label is forced visible; and
- no hover-only change affects physics or persistence.

Explore/Constellation highlights aware nodes plus links internal to that constellation.
Hover also highlights the shortest path from its subject to the nearest selected member;
remembered-but-unselected subjects are not route targets;
immediate neighbors and incident links outside that path rise to standard presentation.
None of those transient subjects become selected. Previews and Option do
not add an Explore seed. Highlighted labels are forced, standard labels use camera-range
Saliency, and dimmed or void labels are suppressed. Dwell and
movement resistance before a transient hover highlight belong to the future shared
Anima animation kit; the interim implementation highlights immediately.

Anima resolves every projected node and link to one ordered presentation phase:
`void`, `dimmed`, `standard`, or `highlighted`. Memory contributes to Awareness before
presentation resolution, so remembered session subjects remain highlighted across Focus,
Explore, and Overview without becoming selected. Selection remains an Attention and interaction concern rather than a synonym
for visual highlighting. A link has no independent phase: it inherits the weaker phase
of its two endpoints. Consequently, a highlighted hovered node connected to a standard
neighbor produces a standard, fully visible link.

For neighborhood emphasis, active-node precedence is drag, then focus, then hover.
Focus preserves the selected constellation after entry, follows a later click to a
different node without replacing that constellation, and releases focus-only emphasis
when focus clears. Touch
movement and completed touch node drags never create a persistent hover target. Clearing
interaction presentation is required even when the requested focus ID already matches
the stored focus state; an idempotent focus command may not leave stale hover behind.
While Focus/Local is active, constellation nodes and links whose endpoints are both in
the constellation receive the highlight treatment at full opacity. Immediate neighbors
of the focused node remain rendered as dimmed visible context; they do not become
selected, and their labels remain suppressed. Unrelated context is void.
Hover temporarily highlights that node and its shortest path to the nearest selected
constellation subject while unrelated context remains void. Clicking a
frontier node adds it to the constellation. Background activation exits
Focus to Explore while retaining the constellation.

A small exponential interpolation may approach these opacity/color targets. It must
stop scheduling frames once the resolved values reach their targets.

## 9. Navigation and camera behavior

V1.6 preserves current Graph Engine/Graph+ navigation rather than adopting all native
Graph view input behavior:

- unmodified trackpad/mouse wheel pans in an unfocused 2D graph;
- trackpad pinch, represented by the platform's modified wheel gesture, zooms;
- touch pinch zooms;
- one-finger background drag pans in 2D and in 3D Overview; 3D Explore orbits
  around the selected constellation;
- in focused 3D, one-finger primary drag orbits around the focus while retaining
  selection and focus, even when the gesture begins inside another node's hit target;
- node dragging is disabled while 3D focus is active; a stationary tap on another node
  still transfers focus normally;
- in 3D, two-finger centroid movement orbits while finger-separation change zooms at
  the same time; Focus retains its target, selection, and focus;
- in 2D, two-finger centroid movement pans while finger-separation change zooms at the
  same time;
- a stationary background tap whose hit test misses clears selection and focus;
- pinch continues to zoom in both focused and unfocused states without suppressing
  simultaneous two-finger navigation;
- current focus-follow, fit, reset, keyboard, and desktop 3D orbit behaviors remain
  unless separately reviewed; and
- V1.6 does not require native Graph view pan inertia or native plain-wheel zoom.

A node-focus fit frames the complete focused neighborhood in one deterministic action.
It uses a centered square safe frame based on the viewport's shorter dimension. While
Focus remains active, that live fit is the zoom-out boundary: users may zoom in, but
seeing a wider field requires leaving Focus. Explicit Center + Fit and reset actions
return directly to the boundary without incremental magnification.
The fit follows the newly focused neighborhood during a bounded settling window and
stops immediately when the user directly manipulates the camera or a node.

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

### 10.2 Why the retired solver differed

The retired custom solver used:

- a saturating `tanh` link response rather than a linear displacement spring;
- inverse-square repulsion magnitude rather than D3-style inverse-distance magnitude;
- no dedicated collision force;
- full reheats for changes that native Obsidian treats as partial reheats;
- render-frame-dependent cooling/integration; and
- a temporary-drag path coupled to the persistent pin collection.

Those equations produced a different interaction feel and were removed after live
acceptance of the D3-compatible path.

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
- collision strength: `0.5`;
- fixed force-integration gain: `0.6`; and
- one iteration of link and collision forces per tick.

The force order is origin position, link, many-body, collision, velocity damping, and
position integration. Link and collision calculations use anticipated positions where
required by the chosen compatible formulation.

Simulation results must be independent of display refresh. The runtime uses a fixed
step accumulator or an equivalent time-correct method and bounds catch-up work after a
long suspension.

### 11.2 Activity, force, and settlement contract

V2 separates the force field from the speed at which the solver advances through it. The
persisted and diagnostic field continues to be named `alpha` for compatibility, but its
normative meaning is a bounded **integration time scale**, or thaw/freeze state. Alpha
`1` applies one ordinary solver step, alpha `0.5` applies half of that whole state
transition, and alpha `0` is frozen.

The following invariants are release requirements:

1. Alpha is always clamped to `0..1`. It scales the whole integration state transition,
   never an individual force or force family.
2. Origin, link, many-body repulsion, region membership, component packing, axial, Anima
   motion-target, and collision forces use the fixed force-integration gain `0.6`.
3. Given identical document, positions, velocities, pins, settings, and motion targets,
   the solver computes the same ordinary full step at every alpha, then blends both
   position and velocity from the prior state toward that result by alpha. All positive
   alpha values therefore retain the same force field and fixed points while moving at
   different speeds.
4. Link correction retains its numerical cap of `1` per step, but that cap is computed
   from fixed integration gain and resolved link strength only. Activity cannot enter the
   cap.
5. Reheating may set `running`, alpha, and alpha target. Reheating does not directly
   change positions, velocities, force settings, topology weights, or the fixed integration
   gain.
6. Active drag uses the constant alpha and alpha target `1`. Link Force, incident-link strength,
   node degree, topology, Anima, and all other pipeline state must not derive or modify that
   target.
7. Drag alpha must not be localized, amplified, or attenuated by graph state in V2.
   Anima-owned local activity is deferred to the 3.0 motion contract.

The activity lifecycle is:

- Fresh layout, document changes, relevant force-setting changes, and drag start thaw alpha
  to `1`.
- While drag remains active, the solver remains running with alpha and alpha target `1`.
- Drag release clears the transient kinematic constraint and returns the alpha target to
  `0`; wall-clock cooling then begins.
- With the default decay `0.2` per second, alpha decreases linearly from `1` to `0` over
  five seconds. Halfway through that interval, each integration step advances halfway
  toward the ordinary full-step result.
- Every running layout requests the constant `30 Hz` solver cadence. Alpha changes the
  effective amount of simulated time per tick, not the callback frequency.
- The solver stops when alpha falls below `alphaMin`, or when maximum unpinned-node
  movement is at most `0.001` for `12` consecutive integration steps.
- Stopping sets alpha to `0`, marks the solver idle, clears the step accumulator, and
  clears residual velocities so later activity cannot replay old momentum.

The dragged node is a transient kinematic constraint distinct from explicit pins. An
explicitly pinned node remains pinned after drag.

### 11.3 Force-setting definitions

Force settings define one stable force field. Alpha changes how far the solver advances
toward each ordinary step while leaving that field and its equilibrium unchanged.

| Setting | V2 default | Contractual meaning |
|---|---:|---|
| `centeringStrength` / **Center force** | `0.1` | Per-axis attraction toward the world origin. The impulse is proportional to displacement and the fixed integration gain. |
| `repulsionStrength` / **Repel force** | `1000` | Nonnegative node-to-node many-body repulsion. It is spatial, not a force emitted by the graph center. |
| `springStrength` / **Link force** | `1` | Baseline stiffness of physical endpoint-pair springs before degree normalization, topology weighting, and bounded motion-target modifiers. It never controls activity. |
| `springLength` / **Link distance** | `250` | Baseline preferred world-space distance between linked endpoints before bounded topology and motion-target modifiers. |
| `velocityDecay` / **Velocity decay** | `0.4` | Fraction of velocity removed after forces each step. Retained velocity is `1 - velocityDecay`; the default therefore retains `0.6`. This is damping, not activity decay. |
| `collisionRadius` / **Collision spacing** | `60` | Uniform collision radius in world units. Two ordinary nodes begin collision correction below center distance `2 * collisionRadius`. |
| `axialSpringAxis` / **Axial spring** | `off` | Optional 3D world axis pulled toward coordinate zero. It is inert in 2D and when set to `off`. |
| `axialSpringStiffness` / **Axial stiffness** | `0` | Bounded strength of the selected 3D axial spring. It never changes activity. |
| region `membershipStrength` / **Region attraction** | profile-defined | Attraction between a region owner and its direct members. Overlapping membership is coordinated independently from activity. |

The UI-to-storage mappings are also contractual:

- **Center force** exposes stored values `0..1` directly.
- **Repel force** exposes normalized UI value `u` in `0..1` and stores `50000 * u²`.
- **Link force** exposes normalized UI value `u` in `0..1` and stores `5 * u²`.
- **Link distance** stores world units directly over `20..500`.
- **Velocity decay** stores `0..0.9` directly.
- **Collision spacing** stores collision radius `0..200` directly.
- **Axial stiffness** exposes `0..90%` and stores `0..0.9`.
- **Region attraction** stores `0..2` directly.

Advanced module settings have these meanings:

| Setting | V2 default | Contractual meaning |
|---|---:|---|
| `alphaDecay` | `0.2` | Linear alpha removed per wall-clock second after interaction. The default thaws from `1` to frozen in five seconds. |
| `alphaMin` | `0.001` | Alpha-only fallback stopping threshold. |
| `repulsionMinDistance` | `30` | Lower-distance softening bound for many-body repulsion. |
| `barnesHutTheta` | `0.9` | Accuracy/performance threshold for aggregate many-body cells. |
| `maxSpeed` | `260` | Per-node, per-step velocity safety bound after force accumulation. |
| `componentPadding` | `80` | Additional world-space separation used by disconnected-component packing targets. |
| `collisionStrength` | `0.5` | Fractional collision correction before the fixed integration gain. |
| `topologyLayoutPolicy` | shipped policy | Bounded affinity-to-spring transformation; it may change link stiffness and target distance but never activity. |

The fixed force-integration gain is an internal V2 calibration constant, not a profile or
Anima setting. Changing it is a force-model contract change and requires force-equation,
stability, and interaction acceptance review.

### 11.4 Incremental placement

Existing positions survive document changes. A new connected node begins near the
mean of its already-positioned visible neighbors with bounded deterministic jitter. A
new disconnected node begins outside or around the occupied cloud rather than at the
same small central seed. Adding one node does not reinitialize existing nodes.

Placement is an engine strategy because it requires canonical topology plus current
session positions. Consumers continue to provide stable IDs and neutral graph evidence.

## 12. Three-dimensional generalization

The native Obsidian graph solver is two-dimensional. Its force model can be generalized
to 3D, but the result is a Graph Engine 3D solver, not literal native Obsidian behavior.

Graph Engine's solver supports 3D by extending the same mechanics:

- X, Y, and Z origin forces use the configured baseline strength;
- link distance is Euclidean in three axes;
- many-body approximation uses the engine's 3D spatial tree;
- collision uses spheres instead of circles;
- drag constrains the node on the engine's selected interaction plane/depth;
- damping, activity, pins, and incremental placement retain the same lifecycle; and
- the perspective camera and depth-aware rendering remain Graph Engine mechanisms.

Uniform 3D uses the same declared force settings as uniform 2D unless a profile
explicitly overrides them. Because a third degree of freedom changes equilibrium,
3D acceptance tests verify invariants and qualitative response rather than identical
2D coordinates.

Graph+'s default dimension remains 2D. Switching dimensions preserves compatible
graph state through the ordinary view-state conversion path.

## 13. Topology, regions, and Form

The new Graph+ defaults are:

- topology weighting: enabled;
- component handling: enabled;
- direct region attraction: enabled;
- region boundaries: hidden;
- adaptive labels: enabled;
- Form: disabled until the learner/user invokes it;
- Anima: required and enabled; and
- dimension: 2D.

Uniform weighting within the force model is the exact numerical comparison baseline.
Topology-weighted mode composes bounded affinity over the new link force:

- affinity `1` reproduces the uniform pair's baseline target and strength;
- stronger affinity creates a bounded shorter/stiffer pair;
- weaker affinity creates a bounded longer/softer pair;
- topology may not replace collision, degree bias, activity, damping, or drag semantics;
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

Graph+ exposes familiar display and force settings in its profile namespace. Section
11.3 defines their normative meanings, defaults, units, mappings, and independence from
activity.

At minimum:

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

The force controls use user-facing ranges compatible with the intended native
baseline while the engine stores explicit effective values. Reset restores the
single profile's declared defaults.

## 15. Persistence and migration

On upgrade, the explicit idempotent migration promotes values from the accepted V1.6
settings bank into direct module settings, removes the retired selector and comparison
bank, preserves canonical external documents and shared Filter/Form configuration,
and does not touch another consumer namespace. Retired view-state bank metadata is
discarded during restore/export.

The descriptor version and module settings schema version are evidence, not a migration
mechanism by themselves. V1.6 requires an explicit version-aware migration path.

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
- reintroducing a whole-system comparison toggle.

## 18. Review decisions

Approval of this contract confirms:

1. Graph+ seeks native-inspired presentation and motion, not full native behavior.
2. Current Canvas-like wheel/pinch navigation and focus-first activation remain.
3. `graph-plus/default` remains the stable profile ID.
4. Graph+ has one Anima/native-motion presentation and solver path.
5. Anima is required and owns static and future time-varying presentation,
   including geometric sizing, force targets, and camera targets.
7. Renderer, force-layout, and camera remain authoritative mechanisms; Anima reaches
   them through declarative contributions and commands.
8. The host adapter reads Obsidian CSS; Anima interprets the resulting neutral palette.
9. Node prominence uses the exact degree formula and 2D square-root zoom compensation.
10. Baseline edge width is screen-space and independent of topology evidence.
10. The solver uses D3-compatible 2D mechanics and a dimension-generic 3D
    generalization.
11. Topology weighting, component handling, and region attraction compose over the
    solver rather than replacing its collision, cooling, degree bias, or drag lifecycle.
12. V1.6 defaults to 2D, topology weighting on, regions active with hidden boundaries,
    adaptive labels on, Form off, and Anima on.
13. Retired comparison settings are promoted or discarded idempotently without
    changing canonical graph documents.
14. New graph-content types and general Anima animation authoring remain deferred.

Implementation begins only after this contract and its acceptance plan are reviewed
and approved.
