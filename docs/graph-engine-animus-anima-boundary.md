# Graph Engine Animus / Ego / Anima Boundary

Status: Implemented architecture

Date: 2026-09-23

## Governing model

Graph Engine has four one-way stages:

1. **Animus** owns graph facts and runtime behavior.
2. **Ego** holds the UI's singular awareness of Animus facts and the semantic
   presentation Anima must realize.
3. **Anima** compiles those facts and Ego roles into a completely resolved visual scene.
4. **Renderer** realizes the scene as pixels and hit targets.

The dependency direction is strictly `Animus -> Ego -> Anima -> Renderer`.

## Animus ownership

Animus owns canonical nodes, tags and links; filtering and display membership;
topology and structural roles; layout positions and pins; the durable and transient
facts behind selection, focus, hover, drag, and preview; camera state; lifecycle;
persistence; and diagnostics.

`AnimusSnapshotV1` is the immutable semantic handoff. It intentionally contains no
colors, opacity, strokes, fonts, dash patterns, or other renderer-facing values.

Form now emits branch identity, depth, and tree/cross roles. Node regions emit
membership, geometry, padding, and visibility. Neither subsystem chooses how those
facts look.

## Ego ownership

Ego is the UI's center of activity. The unversioned runtime `Ego` contains the resolved
`Attention` subject and point alongside one `EgoUiContextV1`, which contains the current semantic
state and every durable or transient fact that can affect UI interpretation. One
`EgoUiStateContractV1` then supplies the active camera, navigation, render-scope, and
state-scoped policy contract. `AnimusSnapshotV1.ego` carries that same context object
across the semantic handoff; the legacy `interaction` field is only a compatibility
alias over it.

`EGO_HIGHLIGHT_POLICY_V1` in `GraphHighlightPolicy.ts` is external global truth. Ego
state contracts may declare a partial override, but the resolver merges it only for
the current resolution. Nothing
mutates or replaces the global policy, so an override cannot outlive the state that
requested it. The resolved `EgoHighlightResultV1` is the one authority for highlighted
nodes and links. Its label disposition is always `delegate`.

Ego owns semantic roles such as highlighted, dimmed, and hidden, plus graph Attention
and label attention:
direct focus, peripheral Saliency boosts, raising, or suppression. It does not own
colors, opacity values, label size, camera-range budgeting, collision layout, drawing,
or animation curves; those remain Anima and label-manager responsibilities.

## Vision ownership

The unversioned runtime `Vision` owns a mechanical `Pose` (position and forward/up
orientation), zoom, projection, and world/screen geometry. It receives Ego's Attention
point explicitly when an interaction rotates or zooms around what Ego attends to.
Vision never inspects selection, Focus, saliency, or node meaning, and it does not retain
a hidden attention target.

`GraphCameraStateV1` remains the persisted and public compatibility shape. Its `target`
is a look-at point used to reconstruct Vision orientation, not Ego Attention. Protocol
types keep version suffixes; runtime domain objects use the plain Ego/Vision language.

## Anima ownership

Anima owns baseline theme application, node and edge material, region decoration,
Form branch presentation, label presentation, interaction emphasis, visual geometry,
and future time-varying transitions. The persisted `rendering` module ID remains as a
compatibility key, but its implementation is `AnimaBaselineModule`.

`compileAnimaSceneV1()` is the sole semantic-to-render-scene boundary. It resolves
every node fill, opacity, outline and label value; every edge color, opacity, width and
arrow value; region fill and stroke; label state priority; background; and font.

Overview, Explore, and Focus are Ego states derived from Animus facts. Their semantic
highlight scope and state-scoped overrides live in `EGO_UI_STATE_CONTRACTS_V1`.
Anima maps the resulting roles to concrete presentation.

## Renderer ownership

Renderers project, cull, cache, draw, and pick. They do not inspect selection, focus,
hover, tags, Form roles, or semantic theme roles. `CanvasGraphRenderer` consumes only
resolved colors, opacity, geometry, font values, label priority, and mechanical
presentation policy.

The renderer has no selected/focused color fallback. A missing visual decision is an
Anima compilation defect, not something a backend repairs independently.

## Compatibility

Public Protocol V1 documents, profiles, persisted view state, module IDs, and settings
keys remain unchanged. `composeGraphRenderFrameV1()` remains as a deprecated wrapper
which constructs an Animus snapshot and delegates to the Anima compiler.

Theme sampling remains in the Obsidian host adapter. It supplies immutable neutral
tokens to Anima and does not style individual graph primitives.

## Enforced invariants

- Animus code may not import Anima, renderer, or theme implementations.
- Ego may consume Animus facts and emit semantic UI roles, but may not choose concrete
  colors, opacity values, label eligibility, or renderer mechanics.
- Form and node-region modules may not emit visual properties.
- Renderers may not inspect semantic interaction state or theme roles.
- Theme-only changes do not rebuild topology or physics.
- Visual and hit-test geometry derive from the same resolved scene.
- Canonical graph and persisted view state never contain Anima presentation values.
