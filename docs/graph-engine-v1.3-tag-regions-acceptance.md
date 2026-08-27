# Graph Engine V1.3 Tag Regions Acceptance Plan

Status: In progress; deterministic implementation evidence present, platform and release evidence pending

Baseline: Graph Engine V1.2

Date: 2026-08-26

Depends on: [Graph Engine V1.3 Tag Regions Contract](graph-engine-v1.3-tag-regions-contract.md)

## 1. Purpose

This plan turns the V1.3 tag-region contract into observable, release-blocking
scenarios. It supplements the V1/V1.1 functional baseline and V1.2 scalability suite;
it does not replace them.

V1.3 succeeds when canonical tag nodes organize visible members into live, readable,
overlapping 2D regions without changing membership, duplicating nodes, redirecting
edges, weakening consumer isolation, or introducing zoom-dependent graph state.

Drill transition choreography is explicitly outside this plan. PatternSmith appears
only as a neutral synthetic consumer proving that a tag node can own a different
registered activation action from Graph+.

## 2. Proof levels

| Level | Purpose | Environment |
| --- | --- | --- |
| C — Contract | Validation, closure, identity, dimensions | Deterministic TypeScript tests |
| L — Layout | Membership forces, pinning, overlap, settlement | Seeded force-layout harness |
| R — Rendering | Boundaries, nesting, overlap, live shape stability | Deterministic Canvas/DOM harness |
| I — Interaction | Selection, focus, fit, activation, keyboard | Mounted session harness |
| S — Scale | Bounded live and settled region work | V1.2 real-clock benchmark harness |
| G — Graph+ | Obsidian tag mapping and product behavior | Fixture vault and live Obsidian |
| P — Platform | Desktop, popout, mobile, accessibility | Physical or representative smoke |

### Current implementation evidence

The V1.3 implementation candidate passes 134 deterministic tests plus typecheck,
production build, client-artifact synchronization, and `git diff --check`. A rendered
browser fixture confirmed nested non-circular regions, Venn-like overlap at one shared
canonical node, behind-node layering, and live contour response while that node moved.

The repeatable `regions-stress-1500-2d` characterization uses 1,500 nodes, 3,000 edges,
100 active regions, and 1,000 direct memberships with labels off. On the 2026-08-26
darwin-arm64 Node v25.1.0 run, 174 measured active-layout frames reported total frame
time p50 10.40 ms, p95 15.71 ms, p99 17.63 ms, and max 18.09 ms; the region-render
stage reported p50 3.54 ms, p95 6.41 ms, p99 11.01 ms, and max 11.30 ms. This is
characterization evidence, not an approved release budget. Live Obsidian desktop,
popout, mobile, theme, accessibility, and reduced-motion evidence remains outstanding.

## 3. Required fixtures

### 3.1 `regions-basic`

- one tag node with three leaf members;
- one ordinary external node;
- canonical edges among members and external nodes;
- stable seeded 2D positions.

### 3.2 `regions-nested`

```text
quotes
├── note tagged exactly quotes
├── carl-jung
│   ├── note-a
│   └── note-b
└── allan-watts
    └── note-c
```

`quotes`, `carl-jung`, and `allan-watts` are canonical tag nodes. Recursive traversal
must stop at `note-a`, `note-b`, `note-c`, and the directly tagged note even if those
notes have ordinary outgoing graph edges.

### 3.3 `regions-overlap`

- two top-level tag nodes;
- two members exclusive to each tag;
- one member directly belonging to both tags;
- one member belonging to three tags;
- an ordinary nonmember between the clusters;
- canonical cross-region edges whose endpoints must remain unchanged.

### 3.4 `regions-stress`

The deterministic stress fixture contains at least:

- 1,500 canonical nodes and 3,000 canonical edges;
- 100 visible tag nodes;
- 1,000 direct membership relationships;
- nesting depth of four;
- overlapping membership of one, two, three, and five tags;
- pinned tag nodes and pinned leaf outliers;
- filtered projections retaining 100%, 50%, and 10% of members.

The fixture generator records its seed and region-definition revision.

## 4. Contract and identity acceptance

### C-DATA-01 — Tag nodes remain canonical nodes

Given a node designated as a region owner, when regions are enabled or disabled, then
the node retains the same canonical ID, attributes, edges, position, selection/focus
identity, pin state, context actions, and registered activation actions.

### C-DATA-02 — Boundary has no canonical identity

Given a rendered tag region, when the public document and view state are exported,
then no synthetic compound node, redirected edge endpoint, contour point, implicit
field, or boundary hit target appears as canonical graph data.

### C-DATA-03 — Position never changes membership

Given members and nonmembers are dragged inside and outside a region, when definitions
and the document are exported, then direct membership is unchanged.

### C-DATA-04 — Valid definition ingress

Given valid definitions referencing canonical nodes, when they enter a session, then
the engine copies and indexes them once and later consumer mutation cannot alter the
session.

### C-DATA-05 — Atomic invalid-definition rejection

Given an unknown ID, duplicate region definition, duplicate member, self-membership,
membership cycle, malformed value, or unsupported version, when definitions are
submitted, then the complete operation fails atomically and the last valid active
definitions remain unchanged.

### C-CLOSURE-01 — Recursive traversal through tag nodes

Given `regions-nested`, when the visible closure of `quotes` is resolved, then it
contains both child tag nodes and every visible leaf below them plus the directly
tagged note.

### C-CLOSURE-02 — Stop at first non-tag node

Given a leaf member has ordinary graph edges to other nodes, when recursive closure is
resolved, then traversal stops at that leaf and does not include its ordinary graph
neighbors.

### C-CLOSURE-03 — Overlap preserves one identity

Given a node directly belongs to two or more tags, when every applicable closure is
resolved, then the same node ID occurs in each closure but the canonical document,
view state, hit testing, and rendering contain one node instance and one position.

### C-CLOSURE-04 — Deterministic order

Given identical documents, definitions, and projections, when closure indexes are
built repeatedly, then membership and public selection order are deterministic.

## 5. Projection and Filter acceptance

### C-PROJECT-01 — Visible closure only

Given a region with visible and filtered-out members, when the Filter projection is
applied, then its boundary, direct membership forces, and first-click selection use
only visible members.

### C-PROJECT-02 — Hidden region node

Given a tag node is hidden by projection, when its members remain otherwise visible,
then that tag has no rendered boundary, membership force, or tag-node interaction
target.

### C-PROJECT-03 — Empty visible region

Given a visible tag node has no visible member, when the graph renders, then the tag
remains an ordinary node and no empty boundary is drawn.

### C-PROJECT-04 — Nested filtering

Given `regions-nested`, when one child tag and some leaves are filtered out, then each
remaining region wraps and selects only its visible recursive closure without changing
the canonical definitions.

### C-PROJECT-05 — Transactional invalidation

Given one accepted Filter or definition change, when projection settles, then closure,
force relationships, and boundaries reconcile once for that transaction and never
show a mixed old/new state.

## 6. Layout acceptance

### L-FORCE-01 — Direct membership cohesion

Given an unpinned free-layout tag node and visible direct members, when layout settles,
then membership attraction keeps the members in a coherent neighborhood around the tag
without replacing ordinary graph forces.

### L-FORCE-02 — Recursive force transmission

Given `regions-nested`, when layout settles, then leaves are attracted to their direct
child tags and child tags to their direct parent. Ancestor force is not redundantly
applied to every recursive leaf.

### L-FORCE-03 — Normalized overlap

Given otherwise equivalent nodes belonging directly to one, two, three, and five tag
nodes, when membership-force magnitudes are inspected, then each node's total maximum
membership influence remains within the same configured bound and is divided
deterministically among memberships.

### L-FORCE-04 — Shared member creates overlap

Given `regions-overlap`, when layout settles, then multiply tagged nodes receive forces
from each applicable tag and the resulting region geometry can intersect without node
duplication.

### L-FORCE-05 — Pinned member

Given a member is pinned outside the previous contour, when layout and rendering
settle, then its position remains fixed and every applicable region stretches to
contain it.

### L-FORCE-06 — Pinned tag node

Given a tag node is pinned, when its unpinned members settle, then the tag remains fixed
and members organize around it according to the configured soft force.

### L-FORCE-07 — Drag and release

Given an unpinned member is dragged away from its tag, when dragging occurs, then the
boundary follows live; after release, normal drag policy and membership force may draw
the node back without changing membership.

### L-FORCE-08 — Form isolation

Given a 2D Form projection with boundaries permitted and membership forces at their
default, when regions render, then Form-derived positions remain unchanged because
region forces are disabled.

### L-FORCE-09 — Settled stability

Given an unchanged settled graph, when only camera, hover, focus, selection, menus, or
settings-panel interaction occurs, then membership forces do not reheat and nodes do
not resume wandering.

## 7. Boundary-rendering acceptance

### R-BOUNDARY-01 — Includes owner and visible closure

Given `regions-basic`, when its tag region renders, then one continuous closed boundary
contains the tag node and all visible recursive members.

### R-BOUNDARY-02 — Non-circular shape

Given members arranged in a seeded elongated concave configuration, when its region
renders, then the contour follows that configuration and is observably non-circular;
replacing it with a fixed circle or ellipse does not pass.

### R-BOUNDARY-03 — Nested regions

Given `regions-nested`, when all nodes are visible, then the parent boundary contains
the child tag regions and their visible members, while each child boundary identifies
its own closure.

### R-BOUNDARY-04 — Venn-like overlap

Given `regions-overlap`, when the graph settles, then the applicable region boundaries
overlap at shared members and each shared member remains visibly singular.

### R-BOUNDARY-05 — Nonmember avoidance

Given a visible nonmember lies between members of one tag, when a valid enclosing route
exists, then the contour avoids enclosing that nonmember. If geometry makes avoidance
impossible, focus/selection presentation still distinguishes actual members.

### R-BOUNDARY-06 — Live drag response

Given a member is continuously dragged, when its position changes, then its applicable
boundaries follow without visible detachment, discontinuous teleporting, or input lag
that prevents direct manipulation.

### R-BOUNDARY-07 — Stable refinement

Given small position changes and later settlement, when contours update, then they
interpolate without persistent jitter, threshold flicker, or repeated topology popping
and stop recomputing after refinement completes.

### R-BOUNDARY-08 — Visual-only layering

Given regions, edges, nodes, labels, and controls overlap, when the frame renders and
input is hit-tested, then boundaries render behind canonical nodes and labels and never
intercept node, edge, background, menu, drag, or gesture input.

### R-BOUNDARY-09 — Canonical edges unchanged

Given canonical edges touching members of collapsed-looking or dense regions, when
regions render and move, then every edge retains and renders from its canonical endpoint
IDs. No endpoint is lifted, bundled, or redirected to the tag node.

### R-BOUNDARY-10 — Theme and accessibility

Given supported light, dark, high-contrast, and reduced-motion settings, when nested and
overlapping regions render, then boundaries remain distinguishable, focus/selection is
not communicated by color alone, and reduced motion reaches the same final state
without nonessential interpolation.

### R-BOUNDARY-11 — Boundary visibility off

Given active 2D tag regions and membership forces, when the effective
`boundariesVisible` setting becomes false, then every visual region boundary disappears
and contour calculation, refinement, interpolation, and drawing stop. Canonical tag
nodes, members, edges, definitions, forces, selection, focus, camera fitting, and
registered actions remain unchanged.

### R-BOUNDARY-12 — Boundary visibility restored

Given hidden boundaries and current visible memberships and positions, when
`boundariesVisible` becomes true, then the engine reconstructs the correct current
regions without restoring stale contour geometry or changing graph state.

## 8. Interaction and camera acceptance

### I-INPUT-01 — Ordinary-node first click

Given an unfocused visible ordinary node, when it receives a stationary primary click,
then it becomes the selection and focus, one selection and one focus change are emitted,
and the engine fits the camera to that selection without invoking its action.

### I-INPUT-02 — Tag-node first click

Given an unfocused visible tag node, when it receives a stationary primary click, then
its complete visible recursive closure becomes the selection, the clicked tag node
becomes the single focus, the camera fits the full selection, and no consumer action
runs.

### I-INPUT-03 — First-depth non-tag stop

Given a selected leaf has ordinary graph descendants or neighbors, when its parent tag
is first-clicked, then those ordinary neighbors are absent from the selection unless
they are independently in the tag's declared recursive closure.

### I-INPUT-04 — Focused tag activation

Given a tag node remains focused after its first click, when it receives a later
stationary primary click, then the first available registered node action runs exactly
once with the tag node ID and current selected descendant IDs.

### I-INPUT-05 — Consumer action parity

Given Graph+ registers `open-node` and a synthetic PatternSmith consumer registers
`start-drill`, when the same focused-tag activation occurs in their isolated sessions,
then each receives its own action and the engine interprets neither product meaning.

### I-INPUT-06 — Keyboard parity

Given a focused tag node with an available default action, when Enter is pressed outside
an editable/native control, then it invokes the same action and context used by the
later stationary click.

### I-INPUT-07 — Child click transfers focus

Given a parent tag is focused and its descendants are selected, when a visible child is
clicked, then normal first-click behavior focuses and selects that child and does not
invoke the parent's action.

### I-INPUT-08 — Drag wins

Given a press begins on a tag or member node, when movement crosses the drag threshold,
then no focus-state action or camera fit runs and existing drag behavior remains
authoritative.

### I-INPUT-09 — Region is not a hit target

Given a pointer lands on a region fill or stroke but no canonical node or edge, when it
clicks, drags, long-presses, or opens context input, then the engine treats it according
to background interaction and never identifies a region entity.

### I-CAMERA-01 — Fit is view-only

Given a tag-node first click triggers camera fitting, when the fit begins and ends,
then definitions, membership, projection, Filter, layout positions, forces, selection,
and focus remain unchanged after the initiating selection/focus transaction.

### I-CAMERA-02 — Manual zoom has no semantic effect

Given an unchanged graph, when the user zooms across any scale in either direction,
then region definitions, visible nodes, forces, hierarchy, selection, focus, and
boundary membership remain unchanged. Only normal camera-dependent rendering work may
change.

### I-CAMERA-03 — No Drill transition surface

Given the public V1.3 API and acceptance implementation, when inspected, then no Drill,
scene fade, temporary session spread, reverse return animation, raw camera replacement,
or PatternSmith-specific transition contract is present.

## 9. Quick settings, dimensions, and profile acceptance

### I-UI-01 — Engine-owned quick-setting

Given an active 2D profile whose consumer exposes the stock region controls, when quick
settings opens, then Graph Engine renders one `Show region boundaries` toggle in its
stock `Regions` section. Graph+ does not mount a duplicate private control.

### I-UI-02 — Namespaced persistence and reset

Given two consumer/profile pairs with different boundary-visibility choices, when
sessions reopen, then each receives its own saved effective value. Reset clears only
the active profile override and restores the next value in the existing precedence
chain.

### I-UI-03 — Hidden UI does not disable capability

Given a consumer/profile hides the stock region section or control, when the module
remains available, then the effective boundary setting and validated programmatic API
continue to work. Hidden UI neither forces boundaries off nor disables membership
forces.

### I-UI-04 — Module policy remains authoritative

Given `node-regions` is forbidden or disabled, when quick settings renders, then no
active boundary control is presented and attempts to enable boundaries cannot bypass
module policy.

### I-UI-05 — 3D unavailability

Given an optional-region profile is currently in 3D, when quick settings renders, then
the boundary control is absent or clearly unavailable and cannot create a flat
pseudo-3D contour. Returning to 2D restores the effective saved setting.

### C-DIM-01 — Default 2D

Given no explicit allowed profile, saved user-profile, restored-view, or session
dimension override, when a first-party/default graph session mounts, then its effective
dimension is `2d`.

### C-DIM-02 — Explicit override precedence

Given a valid saved or session `3d` choice under a profile that permits both dimensions,
when the session mounts, then the explicit choice remains effective despite the new 2D
fallback/default.

### C-DIM-03 — 2D-only region module

Given a profile requires `node-regions`, when its descriptor is validated, then
`allowedDimensions` is constrained to `2d`. An incompatible required-region 3D profile
fails clearly rather than silently dropping the requirement.

### C-DIM-04 — Optional module dimension switch

Given a profile permits both dimensions and optionally enables regions, when it switches
from 2D to 3D, then boundaries and membership forces become unavailable while canonical
tag nodes, definitions, edges, selection, focus, pins, Filter, and actions remain.
Returning to 2D reconstructs regions from current valid state.

### C-DIM-05 — No pseudo-3D boundary

Given a 3D session, when it renders from any camera angle, then no flat tag contour is
presented as a 3D region.

## 10. Live update and lifecycle acceptance

### C-LIVE-01 — Add and remove membership

Given an active region, when a valid definition patch adds or removes a member, then
closure, visible force, boundary, and later tag selection reconcile atomically; canonical
node identity and unrelated regions remain unchanged.

### C-LIVE-02 — Rename stability

Given a tag node's label changes without its canonical ID changing, when the patch is
applied, then region identity, membership, positions, focus, selection, and actions are
preserved while the label updates.

### C-LIVE-03 — Remove focused tag

Given a focused tag node is removed, when document reconciliation completes, then its
definition and boundary disappear, invalid selection/focus entries clear once, and no
stale action can run.

### C-LIVE-04 — Last visible member

Given a region loses its final visible member through a definition or Filter change,
when the update completes, then the boundary disappears smoothly when motion is enabled
and the visible tag remains an ordinary node.

### C-LIFE-01 — Suspension

Given active region physics or contour refinement, when the session is suspended or
hidden, then force, contour, interpolation, worker, and render work stop. Resume
continues once without duplicate resources.

### C-LIFE-02 — Disposal

Given a mounted region session, when it is disposed, then definitions, closure indexes,
force relationships, contour buffers, workers, timers, frames, and callbacks are
released and cannot restart.

### C-LIFE-03 — Session isolation

Given two consumers use the same canonical IDs with different definitions and profiles,
when either changes or disposes, then the other's regions, forces, selection, focus,
actions, and caches remain unchanged.

## 11. Performance acceptance

V1.3 extends V1.2 diagnostics with:

- active visible region count;
- visible direct membership relationship count;
- closure-index rebuild count and duration;
- membership-force tick duration;
- contour calculation and refinement duration;
- contour update count;
- region draw duration;
- region cache size where measurable.

### S-PERF-01 — No camera invalidation

Given settled `regions-stress`, when the camera pans and zooms for ten seconds, then
closure rebuild, membership-force initialization, world-space contour calculation, and
contour refinement counts remain unchanged. Camera projection and region drawing may
run as required.

### S-PERF-02 — No hover or selection invalidation

Given settled `regions-stress`, when hover, focus, and selection change without a
projection or definition change, then closure and geometry are not recomputed.

### S-PERF-03 — Active-layout responsiveness

Given `regions-stress` in a production 2D build, when free layout and live contours run,
then direct manipulation remains responsive and region stages fit within a recorded,
reviewed frame budget. The release evidence reports median, p95, p99, maximum, and
sample count under the V1.2 measurement protocol.

The exact numeric release budget must be set from a characterization implementation
before Gate B approval; an unmeasured adjective such as `smooth` cannot satisfy the
gate.

### S-PERF-04 — Settled graph does no region work

Given unchanged `regions-stress` has settled and contour refinement completed, when 300
frames or equivalent idle time elapse, then membership-force integration, closure
rebuild, contour calculation, and contour interpolation counts remain unchanged.

### S-PERF-05 — Bounded Filter transaction

Given each `regions-stress` Filter projection, when applied once, then closure and
contour work occurs once for the accepted transaction, remains proportional to visible
definitions and relationships, and produces no frame-loop public exports.

### S-PERF-06 — No density cheating

Given performance budgets are met, when output is inspected, then no visible canonical
node or edge was dropped, no membership changed, no required boundary was disabled,
and no boundary was replaced with a fixed circle solely to meet the budget.

### S-PERF-07 — Hidden-boundary work stops

Given `regions-stress` with active membership forces and hidden boundaries, when layout
and interaction continue, then contour calculation, refinement, interpolation, and
region-draw counts remain unchanged while force behavior and canonical rendering remain
correct.

## 12. Graph+ acceptance

### G-TAG-01 — Obsidian hierarchy mapping

Given notes tagged `#quotes/carl-jung` and `#quotes/allan-watts`, when Graph+ builds its
document and region definitions, then canonical `quotes`, `carl-jung`, and
`allan-watts` tag nodes form the expected direct hierarchy and parent recursive closure.

### G-TAG-02 — Exact parent membership

Given one note tagged exactly `#quotes`, when Graph+ builds definitions, then it is a
direct leaf member of `quotes` alongside the child tag nodes.

### G-TAG-03 — Overlapping tags

Given one note carries tags from two independent branches, when Graph+ renders and
settles, then it remains one canonical note node, belongs to both closures, receives
normalized forces, and lies within both tag regions.

### G-TAG-04 — Open tag action

Given a Graph+ tag node is focused after its first-click group selection, when it is
clicked again or Enter is pressed, then Graph+'s registered `open-node` action receives
that tag node. No engine fallback opens, pins, or forms it implicitly.

### G-TAG-05 — Live metadata reconciliation

Given a note's tags are added, removed, or renamed in the fixture vault, when Graph+
reconciles metadata, then definitions and regions update without replacing unaffected
canonical nodes or corrupting the saved graph checkpoint.

## 13. Required visual evidence

Repeatable screenshots or recordings must cover:

- one non-circular basic region;
- the complete `regions-nested` hierarchy;
- two-region and three-region overlaps with shared nodes;
- a pinned outlier stretching a region;
- live member dragging and settled refinement;
- 100%, 50%, and 10% filtered projections;
- first-click selection and camera fit;
- quick-setting boundary disable and re-enable without layout or interaction changes;
- light, dark, high-contrast, and reduced-motion presentation;
- desktop main window, popout, and representative mobile 2D rendering;
- switching an optional-region profile from 2D to 3D and back without pseudo-3D
  boundaries or lost canonical state.

Static screenshots alone cannot prove drag response, contour stability, camera fitting,
or reduced-motion behavior. Those cases require a repeatable recording or automated
frame/state trace.

## 14. Migration gates

### Gate A — Contract and deterministic model

- Approve the V1.3 contract and this acceptance plan.
- Add region-definition validation, recursive closure, and deterministic fixtures.
- Preserve all V1/V1.1/V1.2 public-consumer and scalability regressions.

### Gate B — Characterization and rendering

- Implement seeded direct-membership forces and visual-only 2D boundaries.
- Record live and settled region-stage measurements.
- Set the numeric `regions-stress` frame budget from characterization.
- Pass C-DATA, C-CLOSURE, C-PROJECT, L-FORCE, and R-BOUNDARY.

### Gate C — Interaction and dimensions

- Implement tag-node descendant selection, focus, and engine-owned camera fit.
- Change first-party/fallback defaults to 2D while preserving explicit overrides.
- Pass I-INPUT, I-CAMERA, and C-DIM.

### Gate D — Consumers and lifecycle

- Map Obsidian tags in Graph+.
- Prove a neutral synthetic consumer with a distinct tag-node activation action.
- Pass C-LIVE, C-LIFE, S-PERF, and G-TAG.

### Gate E — V1.3 release

- Pass the complete V1/V1.1/V1.2 regression suite.
- Pass every V1.3 automated scenario.
- Meet the approved `regions-stress` performance budget.
- Capture required desktop, popout, mobile, theme, and reduced-motion evidence.
- Record explicit limitations, including 2D-only boundaries and deferred Drill
  transition choreography.

No gate is satisfied by documenting types without mounted behavior, by demonstrating
only circular non-overlapping regions, or by implementing PatternSmith Drill animation
outside this contract.

## 15. Approval checklist

Approval of this plan confirms:

- [ ] Tags remain canonical nodes and boundaries remain visual only.
- [ ] Recursive closure stops at the first non-tag node on each branch.
- [ ] Region forces use direct membership and are normalized for overlap.
- [ ] Regions wrap only visible members.
- [ ] First tag click selects visible recursive descendants, focuses the tag, and fits
      the camera.
- [ ] Later focused-tag activation retains V1.1 node-action semantics.
- [ ] Zoom has no semantic or layout effect.
- [ ] Graph Engine owns a quick-setting that toggles visual boundaries independently
      of membership forces and tag-node interaction.
- [ ] Regions are 2D-only and first-party/fallback defaults become 2D.
- [ ] Anima brightening, density redesign, and Drill transition choreography remain
      deferred.
- [ ] Numeric live-region performance budgets will be approved after characterization
      and before release acceptance.

Implementation begins only after the contract and this plan are approved.
