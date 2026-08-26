# Graph Engine V1.3 Tag Regions Contract

Status: Proposed; design and acceptance only

Baseline: Graph Engine V1.2

Date: 2026-08-26

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.2 Scalability Contract](graph-engine-v1.2-scalability-contract.md)
- [Graph Engine V1.3 Tag Regions Acceptance Plan](graph-engine-v1.3-tag-regions-acceptance.md)

## 1. Purpose

V1.3 adds tag regions: live, non-circular 2D boundaries around visible members of a
canonical tag node. A tag remains an ordinary graph node and the only interactive
group target. The boundary is visual only. Soft membership forces keep related nodes
near their tag node, while overlapping membership produces overlapping regions without
duplicating canonical nodes or redirecting canonical edges.

Graph Engine owns the neutral region, layout, camera, rendering, and interaction
mechanics. Consumers own which canonical nodes are tag nodes, direct membership,
hierarchy, labels, actions, and domain meaning.

The governing rule is:

> A tag stays a node; its visible member closure shapes a region around it.

## 2. Compatibility statement

V1.3 is additive to V1/V1.1 and preserves the V1.2 runtime and scalability boundary.
Consumers that do not supply tag-region definitions receive the existing graph without
region work or behavior changes.

V1.3 preserves:

- canonical node and edge identity;
- consumer ownership of graph meaning and persistence;
- engine ownership of layout, camera, rendering, hit testing, and gestures;
- first-click focus followed by focused-node activation;
- consumer-registered semantic node actions;
- Filter, Form, profile, module, and settings policy;
- private efficient runtime state with defensive public ingress and egress;
- Anima as a separate optional module;
- support for both 2D and 3D sessions outside the tag-region module.

The engine and first-party fallback/default profiles use `2d` unless a consumer profile,
user-profile override, restored view, or session override explicitly selects an allowed
dimension. Existing explicit dimension overrides remain authoritative. Consumers may
continue to define `3d` as a profile default when their product requires it.

## 3. Terminology

- **Tag node:** a canonical graph node designated by the consumer as the owner and
  interaction target of one tag region. `tag` is product language; the engine contract
  remains domain-neutral.
- **Direct member:** a canonical node explicitly assigned to a tag node by the
  consumer.
- **Child tag:** a direct member that is itself designated as a tag node.
- **Leaf member:** a direct member that is not a tag node.
- **Recursive member closure:** traversal through child tags, stopping at the first
  non-tag node on every branch.
- **Visible member closure:** the part of a tag node's recursive member closure retained
  by the active graph projection and Filter. It does not include the owning tag node.
- **Tag region:** the visual 2D boundary derived from a visible member closure.
- **Membership force:** the optional soft force between one tag node and its visible
  direct members.
- **Region component:** an implementation contour. V1.3 presents one continuous closed
  boundary for each rendered tag region.

## 4. Scope

V1.3 includes:

- consumer-supplied tag-node and direct-membership definitions;
- validated recursive closure with cycle rejection;
- nested and overlapping tag regions;
- live, non-circular 2D boundaries around visible member closures;
- soft normalized membership forces in free layout;
- pinned-node and live-drag behavior;
- tag-node first-click descendant selection, focus, and camera fitting;
- existing focused-node activation for a tag node's consumer-defined default action;
- Filter- and projection-aware region membership;
- live reconciliation when definitions or visible nodes change;
- an engine-owned quick-setting that shows or hides visual region boundaries;
- module/profile policy and lifecycle;
- 2D as the engine and first-party fallback/default dimension;
- deterministic fixtures and bounded live-region performance evidence.

## 5. Non-goals and deferrals

V1.3 does not include:

- Drill transition choreography, graph-to-screen fades, temporary session-node
  spreading, or reverse return animations;
- PatternSmith session planning, eligibility, FSRS, progress, or Drill semantics;
- semantic zoom, zoom-triggered reveal, expansion, collapse, or physics changes;
- user-authored region shapes, control points, resizing, or region dragging;
- changing membership by moving a node across a boundary;
- region-fill or region-boundary click actions;
- replacing tag nodes with compound nodes;
- redirecting, aggregating, bundling, or re-owning canonical edges;
- general graph-density or edge-density redesign;
- automatic tag inference or community detection;
- area-proportional Venn or Euler diagrams;
- 3D region surfaces, volumes, or flat 2D regions presented as 3D support;
- Anima membership brightening or other new Anima behavior;
- individual-node PatternSmith review policy.

The engine may later provide transition primitives usable by PatternSmith, but no V1.3
consumer action receives private camera, renderer, scene, scheduler, or animation-loop
control.

## 6. Public region definition

The public contract is additive and may use equivalent names, but it must express this
information without domain-specific tag strings:

```ts
interface GraphNodeRegionDefinitionV1 {
  readonly regionNodeId: string;
  readonly directMemberNodeIds: readonly string[];
}

interface GraphNodeRegionsDocumentV1 {
  readonly version: 1;
  readonly definitions: readonly GraphNodeRegionDefinitionV1[];
}
```

`regionNodeId` and every member ID reference canonical nodes in the active graph
document. A region node remains usable everywhere an ordinary node is usable: edges,
selection, focus, pinning, dragging, filtering, context menus, registered node actions,
document patches, and view-state reconciliation.

Definitions are consumer-owned public inputs. The engine validates and copies them at
ingress using the V1.2 boundary rules. Definitions are rejected atomically when they
contain:

- an unknown region or member node ID;
- duplicate definitions for one region node;
- duplicate direct members within one definition;
- self-membership;
- a membership cycle through region nodes;
- a malformed version or value.

The engine does not infer membership from position, boundary containment, ordinary
edges, labels, paths, or attributes. A consumer adapter may derive definitions from
those sources before ingress.

### 6.1 Recursive closure

For a region node `T`, recursive closure follows this rule on every direct-member
branch:

1. Include the direct member.
2. If that member is also a region node, recursively include its direct members.
3. If that member is not a region node, stop traversal on that branch.
4. Never traverse ordinary graph edges or relationships out of a non-region member.

Therefore a parent tag selects and encloses all recursive children until the first
non-tag node at each branch. A node may occur in the closure of more than one tag.
It remains one canonical node with one position, one selection identity, and its
original edges.

### 6.2 Consumer mappings

Graph+ derives region definitions from visible Obsidian tag nodes, nested tag paths,
and note-to-tag membership. Location does not affect or imply tag membership.

PatternSmith may present pedagogical groups using tag-node behavior, but it owns stable
group identity, learning membership, and action meaning. Changing a display label or
node position cannot change a PatternSmith learning identity.

## 7. Projection and Filter behavior

Region definitions belong to the canonical consumer input. Rendered regions and their
forces use only the active visible projection.

- A rendered boundary wraps the visible region node and its visible recursive member
  closure.
- A hidden member contributes no boundary influence and no membership force.
- A region node hidden by the active projection has no rendered region.
- A visible region node with no visible members remains an ordinary node and has no
  empty boundary.
- A nested child region renders only when its region node and at least one member are
  visible.
- Form may render boundaries if its effective profile permits them, but region forces
  are off by default so they cannot distort Form-derived positions.
- Filter changes reconcile region closures once per accepted projection transaction;
  camera, hover, focus, and ordinary selection changes do not recompute membership.

Consumer actions receive the focused tag node ID and current selected node IDs. The
engine does not decide whether a product action applies canonical, visible, eligible,
due, or otherwise domain-qualified members.

## 8. Membership-force contract

Tag regions add an optional engine module, referred to here as `node-regions`. Its
rendering and layout influence are separately configurable within module policy.

Recommended profile defaults are:

| Projection | Region rendering | Membership forces |
| --- | --- | --- |
| Free 2D graph | enabled | enabled |
| Form 2D | consumer-configurable | disabled |
| Any 3D projection | unavailable | unavailable |

### 8.1 Boundary visibility setting

Graph Engine owns a stock `Regions` quick-settings section with a `Show region
boundaries` toggle, using a published control ID such as
`node-regions.boundaries-visible`. Graph+ does not recreate or privately own this
control. A consumer/profile may expose or hide the stock section and control through
the existing engine-owned UI contract.

The effective `boundariesVisible` setting:

- defaults to `true` in a free 2D profile with active region rendering;
- is stored as a namespaced user-profile override for the active
  `consumerId/profileId` when changed through quick settings;
- resets through the existing settings-precedence chain;
- affects visual boundary calculation and drawing only;
- does not enable or disable tag nodes, definitions, recursive closure, selection,
  focus, camera fitting, registered actions, or membership forces;
- does not alter canonical nodes, edges, positions, tags, or Filter state;
- suppresses contour calculation, refinement, interpolation, and drawing while false;
- restores boundaries from current visible membership and positions when changed back
  to true;
- is unavailable in 3D because V1.3 region boundaries are 2D-only.

UI exposure remains distinct from capability and module policy. Hiding the stock
control does not force boundaries off and does not revoke the validated setting/API.
Forbidding or disabling the `node-regions` module still controls whether its region
capabilities are available at all.

In free 2D layout:

- each visible tag node applies a soft attraction to its visible direct members;
- only direct membership produces force, while recursive closure determines the
  boundary and group selection;
- nested tag nodes transmit grouping through their own direct relationships, producing
  nested clusters without applying every ancestor force directly to every leaf;
- ordinary link springs, repulsion, collision, centering, velocity decay, and cooling
  remain active;
- a node belonging directly to multiple tags receives influence from each;
- total membership influence on one node is normalized so membership in more tags does
  not multiply its maximum grouping force;
- equal-weight direct memberships divide the available membership influence equally;
- a profile may supply bounded weights without exposing custom executable physics;
- tag nodes remain draggable and pinnable ordinary nodes;
- a pinned member or tag node is not displaced by membership force;
- dragging updates positions and boundaries live under the existing drag policy;
- releasing an unpinned member allows soft membership force to draw it back toward its
  tag node as the layout settles;
- membership force reheats only for relevant topology, definition, visibility,
  dimension, setting, pin, or drag-release changes.

Membership forces seek coherent groups but do not guarantee collision-free strict
geometric containment. Boundary geometry remains responsible for enclosing the
visible closure.

## 9. Boundary contract

For each visible tag node with at least one visible recursive member, the engine draws
one continuous closed 2D region that contains the tag node and its visible recursive
member closure.

The boundary must:

- derive from current member positions rather than a fixed circle;
- permit concave, elongated, pinched, nested, and overlapping shapes;
- follow active node dragging and physics settlement without obvious lag;
- avoid enclosing visible nonmembers where geometrically practical;
- remain visually stable under small node movement;
- transition smoothly when a definition, Filter, or projection changes;
- retain coherent identity when its shape or overlap topology changes;
- render behind canonical nodes and their labels;
- disappear completely when the effective `boundariesVisible` setting is false;
- never intercept node, background, edge, or context-menu input;
- never create, delete, duplicate, redirect, or visually replace a canonical node or
  edge;
- use theme-safe and accessibility-aware presentation without making color the only
  focused-selection cue.

An implicit field, routed member corridors, nonmember avoidance, contour extraction,
and smoothing are suitable implementation techniques, but the public contract does not
mandate Bubble Sets, marching squares, a particular field resolution, or a particular
spline algorithm.

Region geometry is evidence of declared membership, not a membership editor. A
nonmember that is incidentally enclosed remains a nonmember. Moving a member outside
the previous contour retains membership and causes the contour to reconcile around its
new position.

Expressive member brightening, region energy, and especially future 3D membership
communication belong to Anima and are deferred. The kernel still exposes existing
focus and selection state and provides its baseline accessible focused/selected-node
presentation when Anima is disabled.

## 10. Interaction and camera

The tag-region module adds no new raw gesture and no boundary hit target. Interaction
continues through canonical nodes and the V1.1 node-action contract.

On the first stationary primary click of an unfocused ordinary node, the engine:

1. selects that node;
2. focuses that node;
3. fits the camera to the resulting selection.

On the first stationary primary click of an unfocused tag node, the engine atomically:

1. computes its currently visible recursive member closure;
2. selects that closure, including visible child tag nodes and visible leaf members;
3. focuses the clicked tag node;
4. fits the camera to the complete resulting selection.

Focus remains the single clicked tag node; selection is the zero-or-more descendant
set. The focused tag node does not need to be added to `selectedNodeIds` merely to
remain the group action target.

A later stationary primary click on the still-focused tag node resolves the first
available registered activation action exactly as in V1.1. Enter invokes the same
action. Graph+ may register `open-node`; PatternSmith may register `start-drill`.
Clicking a visible child instead applies the normal first-click behavior to that child
and transfers focus away from the parent tag node.

The camera fit is an engine-owned command and view transition. Zooming or camera fitting
does not change:

- region definitions or membership;
- visible projection or Filter state;
- layout forces or positions;
- region hierarchy;
- selection or focus after the initiating transaction;
- any expansion, collapse, or reveal state, because V1.3 defines none.

Crossing a drag or camera-gesture threshold continues to cancel click activation. A
boundary fill or stroke is presentation-only and cannot be focused, selected, dragged,
pinned, activated, or opened as a context target.

## 11. Live updates and persistence

Replacing or patching region definitions is atomic and revision-aware. Accepted
changes reconcile closure indexes, visible forces, region geometry, selection, focus,
and camera dependencies no more broadly than necessary.

- Adding or removing membership animates the affected region when motion is enabled.
- Renaming a canonical tag node changes its label without changing region identity.
- Removing a tag node removes its definition and boundary through document
  reconciliation.
- A region that loses its final visible member removes its boundary and leaves the tag
  node visible if the projection retains that node.
- If a focused tag node is removed, normal focus reconciliation clears it.
- If selected members are filtered or removed, normal selection reconciliation removes
  them.
- Simultaneous sessions retain isolated definitions, forces, contours, and interaction
  state.

Consumers own canonical definitions and any durable user meaning. The engine may export
additive region-compatible view settings, but it does not infer or persist tags. Region
shape points, implicit fields, temporary interpolation state, and derived closure
indexes are runtime caches and are not canonical document data.

## 12. Dimensions and defaults

The engine's fallback/default dimension is `2d`. First-party default profiles move to
`2d`; saved explicit user/profile/session choices continue to win through the existing
settings precedence chain.

The `node-regions` module is 2D-only in V1.3:

- a profile requiring tag regions constrains `allowedDimensions` to `2d`;
- a profile allowing both dimensions may enable the module in `2d` and receives no
  boundary or membership-force contribution in `3d`;
- switching to `3d` preserves canonical tag nodes, membership definitions, selection,
  focus, pins, Filter state, and registered actions;
- returning to `2d` reconstructs regions from current visible positions and membership;
- the engine never draws a flat contour under a 3D camera and calls it 3D support.

Anima may later communicate selected membership in 3D through node-level presentation;
that does not make tag regions themselves a V1.3 3D feature.

## 13. Performance and invalidation

V1.3 inherits the V1.2 rule: safe snapshots at the public boundary; efficient state
inside the frame loop.

- Camera-only motion does not recompute closure, membership forces, or world-space
  contours.
- Hidden boundaries perform no contour calculation, refinement, interpolation, or draw
  work while their membership forces may remain active.
- A physics tick updates only affected positions and position-dependent region work.
- Boundary computation may be throttled, cached, incrementally updated, or refined
  after settlement.
- Rendered contours interpolate between valid shapes when motion is enabled.
- Region work is limited to visible definitions and visible member relationships.
- Settled graphs perform no continuous region recomputation or animation work.
- Region caches and workers, if used, are private and session-scoped.
- Suspension and disposal stop and release all region work.
- Reduced-motion mode removes nonessential contour and camera interpolation while
  preserving final selection, focus, fit, membership, and boundary results.

Exact budgets and fixtures are defined in the acceptance plan. Meeting a budget by
dropping visible canonical nodes, changing membership, replacing a boundary with a
circle, or disabling required regions is not acceptable.

## 14. Ownership summary

Graph Engine owns:

- definition validation and closure indexes;
- region-module policy and settings;
- the engine-owned `Show region boundaries` quick-setting and namespaced override;
- soft normalized membership forces;
- live 2D boundary calculation and rendering;
- focus, selection, hit testing, camera fitting, and node activation;
- Filter/projection reconciliation;
- runtime caching, animation, suspension, disposal, and diagnostics.

Graph+ owns:

- Obsidian tag ingestion and hierarchy mapping;
- canonical tag and note nodes;
- direct tag membership definitions;
- `open-node` meaning and product UI;
- graph checkpoint persistence.

PatternSmith owns:

- pedagogical group identities and membership;
- language, course, lesson, syllabus, and learning meaning;
- eligibility, FSRS, session planning, Drill, and progress;
- `start-drill` availability and behavior;
- any later graph-to-Drill choreography request.

Anima owns, when separately designed and enabled:

- expressive focus/member brightening;
- region energy or attention effects;
- future non-boundary 3D membership communication.

## 15. Review decisions

Approval of this contract confirms:

1. Tags remain canonical nodes and are the only group interaction targets.
2. Region boundaries are visual only and never determine membership.
3. Recursive closure traverses tag nodes and stops at the first non-tag node on each
   branch.
4. Region geometry and forces use only currently visible members.
5. Direct membership forces keep related nodes close; recursive closure controls the
   boundary and selection.
6. Overlapping membership retains one canonical node and produces overlapping regions.
7. First tag-node click selects the visible recursive closure, focuses the clicked tag,
   and fits the camera; later activation uses the existing registered node action.
8. Zoom and camera fit do not reveal, expand, collapse, or otherwise change graph state.
9. Tag regions are 2D-only in V1.3, and the engine/fallback default becomes 2D.
10. Graph Engine owns a quick-setting that shows or hides the visual boundaries without
    disabling tag nodes, group interaction, or membership forces.
11. Anima brightening, general density work, and Drill transition choreography remain
    deferred.

Implementation begins only after this contract and its acceptance plan are reviewed
and approved.
