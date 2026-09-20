# Graph Engine Interaction State Contract

Status: Approved and implemented

Date: 2026-09-20

Normative matrix: [Graph+ UI Interaction Matrix](graph-plus-ui-interaction-matrix.xlsx)

## 1. Purpose

Graph Engine expresses a scale of attention through three internal UX states. The
states own camera, rendering, and input policy so individual gesture handlers cannot
silently drift apart.

The policy is fixed in V1. It is not a consumer-configurable public API.

| State | User meaning | Invariant | Camera target | Center + Fit target |
| --- | --- | --- | --- | --- |
| Overview | View the whole graph | No selection and no focused node | Graph centroid | Whole visible graph |
| Explore | Work with a selected constellation | One or more selected nodes and no focused node | Stored selection-centroid focus | Current selection |
| Focus | Inspect one local node | A non-empty selection and one focused node | Focused node | Focused node plus immediate neighbors |

A one-node initial selection shortcuts directly from Overview to Focus. Focus is
independent of selection membership: a focused node may be unselected while the
constellation remains non-empty.

The terms Overview, Explore, and Focus are canonical. “Kosmos,” “Constellation,” and
“Local” are product-language candidates, not aliases in the code contract yet.

## 2. State transitions

| Current state | Input | Result |
| --- | --- | --- |
| Overview | Click or tap a node | Select that node, enter Focus on it, center it, and fit its immediate neighborhood |
| Overview | Ctrl-click a node | Add it; a one-node result enters Focus |
| Explore | Click an unselected node | Add the node and shortest-path bridge; keep Explore and preserve camera framing |
| Explore | Click a selected node | Enter Focus on that node without changing selection |
| Explore | Click or tap background | Clear selection and enter Overview; fit the graph |
| Focus | Click or tap a different visible node | Move Focus to that node without changing selection |
| Focus | Single-click or tap the focused node | Toggle only that node's selection membership; Focus remains if the constellation is still non-empty |
| Focus | Click or tap background with two or more selected nodes | Exit Focus, retain the constellation, enter Explore, and center + fit the selection |
| Focus | Click or tap background with one selected node | Clear selection, enter Overview, and center + fit the graph |
| Any state | Escape | Clear selection and Focus; enter Overview |

Single activation on the focused node is delayed only long enough to arbitrate a
double activation. Double-click or double-tap opens the primary node action only when
the node was already focused before the first activation. A double activation that
begins on an unfocused node changes Focus but does not open the node.

Ctrl edits selection without moving the camera. If Ctrl editing began with no
selection, Ctrl release performs state-appropriate Center + Fit on the result. If a
selection already existed, release leaves the camera unchanged.

## 3. Camera contract

Center and Fit are separate operations performed in sequence:

1. **Center** translates the camera target to the arithmetic centroid of the target,
   or to the focused node in Focus. It does not reset camera angle or up vector.
2. **Fit** adjusts orthographic zoom or perspective distance so the same target fits
   with padding.

State-aware targets are:

- Overview: all visible graph nodes;
- Explore: selected nodes; and
- Focus: the focused node and its immediate neighbors, centered on the focused node.

Explore follows selected-node motion by the selection-centroid delta while preserving
framing. Later additive or subtractive selection edits recalculate the centroid but do
not move the stored camera target automatically. Focus follows focused-node motion
while preserving framing.

Focus limits zooming out using the longest world-space distance from the focused node
to any selected node, plus padding. The local-neighborhood fit established when Focus
is entered remains a valid baseline even when it is wider.

In 2D Focus, navigation pan is elastic: it may temporarily offset the view and then
returns the target to the focused node. Leaving Focus always performs a fresh
selection or graph Center + Fit; the prior camera angle need not be restored.

## 4. Rendering contract

| State | Nodes | Links | Labels |
| --- | --- | --- | --- |
| Overview | Whole visible graph at normal presentation | Whole visible graph | Normal label policy |
| Explore | Selected constellation lit; all other visible nodes dimmed | Selection links lit; other visible links dimmed | Selected labels emphasized |
| Focus | Selected constellation lit; focused node, immediate neighbors, and constellation remain rendered; unselected members of that local set are gray; all other nodes hidden | Selected-to-selected and focused-to-neighbor links remain; unselected local links are gray; all other links hidden | Only labels allowed by the local render set and normal label policy |

An unselected focused node receives no special selection color. Holding Option
temporarily reveals direct neighbors of the current selection and the connecting links
with the same presentation used for hover. Option never changes selection or camera.
Tag nodes follow exactly the same interaction and presentation rules as ordinary
nodes.

## 5. Desktop input matrix

### 5.1 Pointer and trackpad

| Input | Overview | Explore | Focus |
| --- | --- | --- | --- |
| Primary background drag, 2D | Pan | Pan | Elastic pan |
| Primary background drag, 3D | Pan | Rotate | Rotate |
| Primary drag on selected node | Drag node | Drag node | Navigate; stationary activation owns selection toggle |
| Primary drag on unselected node | Select and drag from Overview | Pan in 2D; rotate in 3D | Navigate; stationary activation hops Focus |
| Secondary drag, 2D | Pan | Pan | Radial zoom around focused node |
| Secondary drag, 3D | Rotate | Rotate | Radial zoom around focused node |
| Two-finger scroll, 2D | Pan | Pan | Elastic pan |
| Two-finger scroll, 3D | Pan | Rotate | Rotate |
| Ctrl-wheel / trackpad pinch | Zoom around pointer | Zoom around pointer | Zoom while retaining focused-node target |
| Cmd-wheel | State navigation; never zoom | State navigation; never zoom | State navigation; never zoom |
| Stationary background secondary click | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Stationary node secondary click | Node context menu | Node context menu | Node context menu |
| Double-click focused node | Primary node action | Primary node action | Primary node action |

Focus radial zoom measures pointer distance from the focused node. Moving away zooms
in; moving toward the focused node zooms out.

### 5.2 Keyboard and modifiers

| Input | Behavior |
| --- | --- |
| Hold Ctrl + node clicks | Add or remove selection members; do not move camera during edits |
| Release Ctrl after initial selection | State-appropriate Center + Fit |
| Release Ctrl after editing an existing selection | No camera change |
| Hold Option | Reveal selection neighbors and connecting links; selection and camera unchanged |
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
| One-finger drag, 3D | Rotate, including when starting over a node | Rotate, including when starting over a node | Rotate, including when starting over a node |
| Two-finger translation, 2D | Pan | Pan | Radial zoom from the gesture centroid |
| Two-finger translation, 3D | Rotate | Pan | Radial zoom from the gesture centroid |
| Pinch | Zoom | Zoom | Zoom combined with radial two-finger translation |
| Double-tap background | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Double-tap drag, 2D | Vertical zoom | Vertical zoom | Radial zoom |
| Double-tap drag, 3D | Horizontal rotate + vertical zoom | Horizontal rotate + vertical zoom | Radial zoom |
| Long press background | Center + Fit graph | Center + Fit selection | Center + Fit local neighborhood |
| Long press node | Node context menu | Node context menu | Node context menu |
| Double-tap focused node | Primary node action | Primary node action | Primary node action |

Focus two-finger translation and pinch are simultaneous controls. Translation uses
the gesture centroid's distance from the focused node; pinch uses finger separation.

## 7. Persistence and reopen

Graph reopen restores graph data, finite node positions, and explicit pins only.
Selection, Focus, camera, filters, Form, and other interaction state are not restored.
Every graph opens in fresh Overview and fits the whole graph.

Explicit same-session `restoreViewState()` remains a runtime operation for controlled
transitions and tests; it is not the reopen persistence policy.

## 8. Code ownership and regression locks

The state policy lives in
`src/graph-engine/runtime/interaction/GraphInteractionStatePolicy.ts`. Input dispatch,
camera fitting/follow, and Anima presentation consume that shared state rather than
redefining it locally.

Regression coverage is concentrated in:

- `tests/runtime/interaction.test.ts` for transitions and desktop/mobile gestures;
- `tests/runtime/session.test.ts` for centering, fitting, and reopen behavior;
- `tests/runtime/modules.test.ts` and
  `tests/runtime/v16-native-presentation.test.ts` for state presentation; and
- `tests/graph-plus/adapter.test.ts` and `tests/service/service.test.ts` for Graph+
  integration and primary node actions.

Physical desktop-trackpad and mobile-device smoke testing remains required before a
release because synthetic pointer and wheel events cannot prove OS gesture
classification or tactile feel.
