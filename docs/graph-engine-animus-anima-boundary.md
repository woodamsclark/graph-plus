# Graph Engine Animus / Ego / Anima Boundary

Status: Implemented architecture

Date: 2026-09-23

## Governing model

Graph Engine has four semantic roles:

1. **Animus** owns graph facts and runtime behavior.
2. **Ego** defines which graph nodes are held in Awareness.
3. **Anima** decides how Animus facts and Ego Awareness are expressed visually.
4. **Renderer** realizes the scene as pixels and hit targets.

The primary dependency direction is `Animus -> Ego Awareness -> Anima -> Renderer`.
Vision separately consumes the Awareness centroid as an explicit manipulation pivot.

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

The unversioned runtime `Ego` owns exactly one value: `Awareness`. Awareness contains
the selected node IDs and their derived world-space centroid. Ego does not own hover,
drag, preview, Focus state, gesture permissions, highlighting, label decisions,
rendering scope, colors, or animation.

Persisted `selectedNodeIds` remain the Protocol V1 compatibility representation from
which Awareness is resolved. Future influences may change how Ego chooses Awareness,
but consumers remain Vision and Anima rather than presentation logic inside Ego.

## Vision ownership

The unversioned runtime `Vision` owns a mechanical `Pose` (position and forward/up
orientation), zoom, projection, and world/screen geometry. It receives Ego's Awareness
centroid explicitly when an interaction rotates or zooms around the aware nodes.
Vision never inspects selection, Focus, saliency, or node meaning, and it does not retain
a hidden semantic target.

`GraphCameraStateV1` remains the persisted and public compatibility shape. Its `target`
is a look-at point used to reconstruct Vision orientation, not Ego Awareness. Protocol
types keep version suffixes; runtime domain objects use the plain Ego/Vision language.

## Anima ownership

Anima owns baseline theme application, Awareness highlighting and dimming, label
raising and suppression, node and edge material, region decoration,
Form branch presentation, label presentation, interaction emphasis, visual geometry,
and future time-varying transitions. The persisted `rendering` module ID remains as a
compatibility key, but its implementation is `AnimaBaselineModule`.

`compileAnimaSceneV1()` is the sole semantic-to-render-scene boundary. It resolves
every node fill, opacity, outline and label value; every edge color, opacity, width and
arrow value; region fill and stroke; label state priority; background; and font.

Overview, Explore, and Focus remain graph-engine interaction states. Gesture and framing
rules live in `GRAPH_INTERACTION_STATE_POLICIES_V1`; Anima's independent state-scoped
rendering rules live in `ANIMA_STATE_PRESENTATION_POLICIES_V1`.

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
- Ego may resolve node membership and centroid for Awareness, but may not own
  interaction policy, presentation roles, colors, labels, or renderer mechanics.
- Form and node-region modules may not emit visual properties.
- Renderers may not inspect semantic interaction state or theme roles.
- Theme-only changes do not rebuild topology or physics.
- Visual and hit-test geometry derive from the same resolved scene.
- Canonical graph and persisted view state never contain Anima presentation values.
