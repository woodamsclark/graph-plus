# Graph Engine Interaction State Contract

Status: Approved and implemented

Date: 2026-09-20

Normative matrix: [Graph+ UI Interaction Matrix](graph-plus-ui-interaction-matrix.xlsx)

## 1. Purpose

Graph Engine expresses a scale of attention through three internal UX states. The
states own camera, rendering, and input policy so individual gesture handlers cannot
silently drift apart.

The policy is fixed in V1. It is not a consumer-configurable public API.

Ego is the engine's singular UI awareness. It derives one immutable semantic context
from Animus facts: active state, dimensions, selection, pins, focus, hover, drag,
preview, and transient presentation conditions. Ego also resolves `Attention`: the
selected node set and its current world-space centroid. The active Ego state contract
owns attention, rendering-scope, navigation, and any state-scoped highlight override. Anima
realizes Ego's semantic roles as concrete color, opacity, and geometry. Renderers
receive only the resolved scene and never inspect selection, focus, or hover state.

The application-wide highlight policy in `runtime/ego/GraphHighlightPolicy.ts` is
external to UI state. Ego resolves that
global truth together with the active state contract. An override is read directly
from that contract and is never installed into the global policy, so it expires by
construction as soon as the requesting UI state expires. Highlight policy does not
force labels. Ego separately resolves label attention, and the label manager retains
sizing, camera-range Saliency, and collision mechanics.

| State | User meaning | Invariant | Ego attention | Center + Fit target |
| --- | --- | --- | --- | --- |
| Overview | View the whole graph | No selection and no focused node | None; Vision retains its framing point | Whole visible graph |
| Explore | Work with a selected constellation | One or more selected nodes and no focused node | Selection centroid | Current selection |
| Focus | Inspect one local node | A non-empty selection and one focused node | Selection centroid | Focused node plus immediate neighbors |

A one-node selection is a constellation and enters Explore. Focus is entered only by
an explicit focus operation; ordinary node clicks do not enter or move Focus. Focus is
independent of selection membership: a focused node may be unselected while the
constellation remains non-empty.

The terms Overview, Explore, and Focus are canonical. “Kosmos,” “Constellation,” and
“Local” are product-language candidates, not aliases in the code contract yet.

## 2. State transitions

| Current state | Input | Result |
| --- | --- | --- |
| Overview | Click or tap a node | Add that node to the constellation, enter Explore, and preserve camera framing |
| Overview | Ctrl-click a node | Same as an ordinary click |
| Explore | Click an unselected node | Add the node and the shortest path back to the existing constellation; preserve camera framing |
| Explore | Click a selected node | Remove the node from the constellation and preserve camera framing |
| Explore | Click or tap background | Clear selection and enter Overview; preserve camera framing |
| Focus | Click or tap any node | Exit Focus and toggle that node's constellation membership |
| Focus | Click or tap background with two or more selected nodes | Exit Focus, retain the constellation, enter Explore, and preserve camera framing |
| Focus | Click or tap background with one selected node | Clear selection, enter Overview, and preserve camera framing |
| Any state | Escape | Clear selection and Focus; enter Overview |

Double-click or double-tap on the same node opens its primary action and leaves that
node in the constellation.

Selection is committed only on primary-button or tap release, after the pointer stays
within the drag threshold and no drag or navigation gesture has begun. Pointer-down
never selects. Once movement crosses the drag threshold, release ends that gesture and
must not also toggle selection or enter Focus.

Ctrl does not change node-click semantics. Node clicks toggle constellation membership
without moving the camera. Adding an unselected node also selects the shortest path from
that node to any current constellation member. Releasing Ctrl leaves selection and
framing unchanged.

Input handlers request semantic state transitions rather than pairing state commands
with sibling camera commands. Each transition owns its consequences: Focus to Explore
preserves the camera, and clearing the constellation to return to Overview also
preserves the camera. Center + Fit occurs only through an explicit framing action or
when no compatible saved view exists for a new session.

## 3. Ego and Vision contract

Retarget, Recenter, and Refit are three independent operations:

1. **Retarget** changes Ego's world-space Attention point. It does not mutate Vision,
   camera position, orientation, zoom, perspective distance, or the current screen
   position of any graph content. Vision receives this point explicitly for future
   rotation and unanchored trackpad or mobile pinch zoom. It is distinct from the
   serialized framing point retained for compatibility as `camera.target`.
2. **Recenter** translates Vision framing to the arithmetic centroid of the target,
   or to the focused node in Focus. It does not reset camera angle or up vector.
3. **Refit** adjusts Vision's orthographic zoom or perspective distance so the same target fits
   with padding. An explicit Center + Fit action performs Recenter and Refit together.

State-aware targets are:

- Overview: all visible graph nodes;
- Explore: selected nodes; and
- Focus: the focused node and its immediate neighbors, centered on the focused node.

Explore follows selected-node motion by the selection-centroid delta while preserving
framing. Every additive or subtractive selection edit recalculates the selection
centroid and redirects Ego's Attention without Recentering or Refitting: one selected
node uses that node's position, while multiple selected nodes use their arithmetic
centroid. Focus follows focused-node motion while preserving framing.

Focus limits zooming out using the longest world-space distance from the focused node
to any selected node, plus padding. The local-neighborhood fit established when Focus
is entered remains a valid baseline even when it is wider.

In 2D Focus, navigation pan is elastic: it may temporarily offset the view and then
returns the target to the focused node. Explicit Focus entry may establish a
local-neighborhood fit. Node clicks that return to Explore preserve the live camera
framing so global gray context does not jump.

## 4. Rendering contract

| State | Nodes | Links | Labels |
| --- | --- | --- | --- |
| Overview | Whole visible graph at normal presentation | Whole visible graph | Normal label policy |
| Explore | Only selected constellation nodes are durably lit; every unselected projected node remains visible at 24% opacity with its ordinary theme color 80% desaturated | Only selected-to-selected links are durably lit; every other projected link remains visible and dimmed | Selected labels emphasized; unselected labels suppressed while dim unless hover takes precedence |
| Focus | Focused node, immediate neighbors, and selected constellation remain rendered and highlighted; all other nodes hidden | Selected-to-selected and focused-to-neighbor links remain; every focused-neighborhood link is highlighted; all other links hidden | Only labels allowed by the local render set and normal label policy |

Focus/Local highlighting is presentation only and does not add neighbors to the
selection. Explore/Constellation never hides a projected node or link merely because
it is outside the selected constellation. Only selected nodes and links whose endpoints
are both selected remain durably highlighted. Unselected neighbors stay dimmed.
Hovering any dim context node may transiently light that node, its immediate neighbors,
and its incident links without selecting them. The highlight does not propagate beyond
one hop or reveal a shortest path. Previews and Option do not expand the highlighted
set. Tag nodes follow exactly the same interaction and presentation rules as ordinary
nodes.

Ego resolves label attention in this order: hovered node, immediate hover neighbors,
selected or focused node, dim-context suppression, then camera-range Saliency fallback.
The hovered label overrides graph-wide label-off mode. Selected or focused labels bypass
the adaptive collision budget. Hover neighbors remain adaptive, but Ego reduces their
effective Saliency value by 50%, making them more likely to appear without defeating
collision handling. Unselected selection neighbors remain dim and suppressed. Unrelated
dimmed nodes are likewise suppressed before Saliency is evaluated, unless direct cursor
focus or its immediate neighborhood takes precedence.

The intended Anima interaction language adds dwell and movement resistance before a
dim context node becomes lit. That timing and interpolation belong to the future shared
Anima animation kit. Until that kit exists, hover eligibility is immediate.

## 5. Desktop input matrix

### 5.1 Pointer and trackpad

| Input | Overview | Explore | Focus |
| --- | --- | --- | --- |
| Primary background drag, 2D | Pan | Pan | Elastic pan |
| Primary background drag, 3D | Pan | Pan | Rotate |
| Primary drag on selected node | Drag node | Drag node | Navigate; stationary activation owns selection toggle |
| Primary drag on unselected node | Drag node without selecting | Pan | Navigate; stationary activation exits Focus and toggles selection |
| Secondary drag, 2D | Pan | Pan | Radial zoom around focused node |
| Secondary drag, 3D | Rotate | Rotate | Radial zoom around focused node |
| Two-finger scroll, 2D | Pan | Pan | Elastic pan |
| Two-finger scroll, 3D | Pan | Rotate | Rotate |
| Physical Ctrl-wheel | Zoom around pointer | Zoom around pointer | Zoom around pointer |
| Trackpad pinch | Zoom around retained Vision framing point | Zoom around Ego Attention | Zoom around Ego Attention |
| Cmd-wheel | State navigation; never zoom | State navigation; never zoom | State navigation; never zoom |
| Stationary background secondary click | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Stationary node secondary click | Node context menu | Node context menu | Node context menu |
| Double-click node | Primary node action | Primary node action | Primary node action |

Focus radial zoom measures pointer distance from the focused node. Moving away zooms
in; moving toward the focused node zooms out.

### 5.2 Keyboard and modifiers

| Input | Behavior |
| --- | --- |
| Hold Ctrl + node clicks | Same toggle behavior as ordinary node clicks; do not move camera |
| Release Ctrl | No selection or camera change |
| Hold Option | Preserve constellation-only highlighting; selection and camera unchanged |
| Hold Space | Temporarily suspend ordinary selection dimming |
| Arrow keys | Pan |
| Shift + arrow keys in 3D | Rotate |
| `+` / `-` | Zoom in / out |
| Enter with exactly one selected node | Primary node action |
| Escape | Clear selection and Focus |

## 6. Mobile input matrix

| Input | Overview | Explore | Focus |
| --- | --- | --- | --- |
| One-finger drag, 2D | Pan | Pan | Elastic pan |
| One-finger drag, 3D | Pan, including when starting over a node | Pan, including when starting over a node | Rotate, including when starting over a node |
| Two-finger translation, 2D | Pan | Pan | Pan |
| Two-finger translation, 3D | Rotate | Rotate | Rotate around the focused node |
| Pinch | Target-centered zoom concurrently with two-finger pan/rotation | Target-centered zoom concurrently with two-finger pan/rotation | Target-centered zoom concurrently with two-finger pan/rotation |
| Double-tap background | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Double-tap drag, 2D | Vertical zoom | Vertical zoom | Radial zoom |
| Double-tap drag, 3D | Horizontal rotate + vertical zoom | Horizontal rotate + vertical zoom | Radial zoom |
| Long press background | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Long press node | Node context menu | Node context menu | Node context menu |
| Double-tap node | Primary node action | Primary node action | Primary node action |

Two-finger translation and pinch are simultaneous controls. In 3D, centroid movement
rotates while finger separation zooms; in 2D, centroid movement pans while finger
separation zooms. The pinch component uses Ego's current Attention point when selection
exists, rather than the touch centroid or serialized framing point. Without directed
Attention, Vision retains its current framing point.

## 7. Persistence and reopen

Graph reopen restores the complete compatible saved view state: finite positions,
explicit pins, camera framing, selection, Focus, filters, Form/module state, and other
durable interaction state. Reopen does not implicitly center or fit the camera. A graph
with no compatible saved view starts in fresh Overview and fits the whole graph.

Global Graph+ and Local Graph+ have deliberately different active-note ownership:

- Global Graph+ never follows the active note automatically. Opening, revealing, or
  switching to the global view preserves the complete restored graph and its saved
  interaction and camera state. An explicit `showFile()` request may reveal, select,
  focus, and frame one requested note, but ordinary `file-open` and
  `active-leaf-change` events must not do so.
- Local Graph+ follows the active Markdown note automatically. The active note becomes
  the root of its depth-bounded local projection, and file or leaf changes may replace
  that local projection.

The two behaviors are separate host contracts. Shared lifecycle, reconciliation, or UI
code must not make global Graph+ inherit Local Graph+ active-note following.

Explicit same-session `restoreViewState()` remains a runtime operation for controlled
transitions and tests; it is not the reopen persistence policy.

## 8. Code ownership and regression locks

The authoritative Ego, Attention, state contracts, global highlight policy, and highlight
resolver live in `src/graph-engine/runtime/ego/GraphEgo.ts`. `Vision` owns only pose,
projection, and geometric viewpoint operations. Input dispatch and Vision
fitting/follow consume the compatibility projection in
`runtime/interaction/GraphInteractionStatePolicy.ts`; it aliases Ego and owns no
sibling table. Anima consumes resolved Ego awareness rather than expanding highlight
neighborhoods or inventing state presentation locally.

Runtime implementation names are unversioned (`Ego`, `Attention`, `Vision`, `Pose`,
and `Orientation`). Public and persisted compatibility types retain their protocol
suffixes, including `GraphCameraStateV1`; Vision converts that legacy look-at point
into a forward orientation and never treats it as Ego Attention.

Regression coverage is concentrated in:

- `tests/contracts/architecture.test.ts` for the global-versus-Local active-note
  ownership boundary;
- `tests/runtime/interaction.test.ts` for transitions and desktop/mobile gestures;
- `tests/runtime/ego.test.ts` for the singular context, global highlight truth, and
  automatic override expiry;
- `tests/runtime/session.test.ts` for centering, fitting, and reopen behavior;
- `tests/runtime/modules.test.ts` and
  `tests/runtime/v16-native-presentation.test.ts` for state presentation; and
- `tests/graph-plus/adapter.test.ts` and `tests/service/service.test.ts` for Graph+
  integration and primary node actions.

Physical desktop-trackpad and mobile-device smoke testing remains required before a
release because synthetic pointer and wheel events cannot prove OS gesture
classification or tactile feel.
