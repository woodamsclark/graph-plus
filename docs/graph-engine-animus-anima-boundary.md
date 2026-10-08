# Graph Engine Animus / Ego / Anima Boundary

Status: Implemented architecture

Date: 2026-09-23

Migration note: the former Ego/Awareness ownership below is superseded by
[Graph Engine agency and Awareness ontology](graph-engine-agency-awareness-ontology.md).
Phases 2 through 7 have implemented Consciousness, geometry-free Attention/Awareness,
Vision-owned centroid derivation, neutral policy, exogenous Attention input, and
explicit Anima consciousness classes, plus enforced projection/presentation ordering.
Remaining sections are retained for compatibility mechanics that have not yet migrated.

## Governing model

Graph Engine has four semantic roles:

1. **Animus** owns graph facts and runtime behavior.
2. **Consciousness** holds Ego, Attention, and binary Awareness for one presentation.
3. **Anima** decides how Animus facts, Attention, and Awareness are expressed visually.
4. **Renderer** realizes the scene as pixels and hit targets.

The primary dependency direction is
`Animus + Consciousness -> Anima -> Renderer`. Vision separately derives spatial
targets from conscious-state membership without storing geometry in Awareness.

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

## Consciousness and Ego ownership

Each presentation-scoped `Consciousness` owns its Ego, Attention, and Awareness. Ego
proposes endogenous intent; it does not declare realized truth. Attention contains the
subjects at the center of conscious activity. Awareness is a geometry-free binary node
set containing Attention plus permitted peripheral subjects.

Persisted `selectedNodeIds` remain the Protocol V1 compatibility mirror of Attention.
Exogenous inputs may replace Attention without passing through Ego. Experience policy
adjudicates both paths and expands realized Attention into Awareness.

## Vision ownership

The unversioned runtime `Vision` owns a mechanical `Pose` (position and forward/up
orientation), zoom, projection, and world/screen geometry. It receives an explicit
centroid derived from Attention when an interaction rotates or zooms around attended
nodes. Vision never inspects selection, Focus, saliency, or node meaning, and it does
not retain a hidden semantic target.

`GraphCameraStateV1` remains the persisted and public compatibility shape. Its `target`
is a look-at point used to reconstruct Vision orientation, not Ego Awareness. Protocol
types keep version suffixes; runtime domain objects use the plain Ego/Vision language.

## Anima ownership

Anima consumes explicit Attention and Awareness and first classifies every projected
node as attended, peripherally aware, or unaware context. It owns baseline theme
application, Awareness highlighting and dimming, label raising and suppression, node
and edge material, region decoration, Form branch presentation, label presentation,
interaction emphasis, visual geometry, and future time-varying transitions. The
persisted `rendering` module ID remains as a compatibility key, but its implementation
is `AnimaBaselineModule`.

`compileAnimaSceneV1()` is the sole semantic-to-render-scene boundary. It receives
Consciousness explicitly rather than inferring it from compatibility selection and
resolves every node fill, opacity, outline and label value; every edge color, opacity,
width and arrow value; region fill and stroke; label state priority; background; and
font.

Module stages preserve the same direction. Projection hooks receive only structural
projection state and may emit only structural patches. After projection completes,
Consciousness reconciles against the projected document. Presentation hooks then
receive required Consciousness and may emit only Anima-facing contributions. The host
applies these as explicit allowlists, so dynamically supplied modules cannot cross the
boundary by returning extra fields.

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
keys remain unchanged. The deprecated `composeGraphRenderFrameV1()` wrapper has been
removed from the runtime and its exports. Standalone test fixtures construct explicit
Consciousness and Animus inputs and call the Anima compiler. Canvas accepts only
`updateScene()`; it no longer retains an alternate Vision/FrameStore input.

Theme sampling remains in the Obsidian host adapter. It supplies immutable neutral
tokens to Anima and does not style individual graph primitives.

## Enforced invariants

- Animus code may not import Anima, renderer, or theme implementations.
- Consciousness may resolve Attention and Awareness membership, but neither value owns
  geometry, presentation roles, colors, labels, or renderer mechanics.
- Anima and renderers may not infer Attention or Awareness from styling or compatibility
  selection facts.
- Form and node-region modules may not emit visual properties.
- Renderers may not inspect semantic interaction state or theme roles.
- Theme-only changes do not rebuild topology or physics.
- Visual and hit-test geometry derive from the same resolved scene.
- Canonical graph and persisted view state never contain Anima presentation values.


## Runtime names and compatibility

SessionProjectionCoordinator, SessionFrameScheduler, SessionActivityController,
SessionDiagnostics, AnimaHoverPreviewAnimation, Reflex and GraphRendererRegistry
use plain implementation names. Their private records, factory options and runtime
invalidation types follow the same rule. These objects have no competing versioned
implementation and do not participate in persisted data or the external client.

Protocol V1 documents, View state and GraphSession interfaces retain their names.
Module/renderer extension interfaces and copied client contracts also retain their
version labels. Existing error names/codes remain compatibility identifiers.
