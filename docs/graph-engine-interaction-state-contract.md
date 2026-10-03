# Graph Engine Interaction State Contract

Node/background primary activation and Ctrl membership previews now use
[Ego's stateful interaction plan](graph-engine-ego-interaction-plan-contract.md).
Input recognizes the gesture; Ego predicts and admits the transition; Anima
expresses it; the runtime commits its resulting state and effects.


Status: Approved and implemented

Date: 2026-10-02

The implemented [View and Scene Contract](graph-engine-view-scene-contract.md)
is authoritative for View ownership, transitions, membership, framing, presentation,
and controls. This document records physical gesture mechanics and compatibility.

## 1. View ownership and meaning

Views frame Ego engagement: **discover > build > focus; all > many > one**.
`GRAPH_VIEW_DEFINITIONS_V1` is the shared source of bindings, interest, scene constraints,
and controls. Overview has no tracked subject. Constellation (`explore` in public and
saved state) suggests Attention's centroid, subject to Ego's retained focal intent.
Focus tracks one member. Broader Awareness
and Memory can illuminate Overview without granting membership or camera ownership.

View definitions also own `interactions.nodeDrag` and `scene.labels`. Overview permits
dragging any visible node, as do Constellation and Focus, including dim context.
Dragging never admits membership or commits a connecting path. The interpreter and runtime
consume the shared eligibility policy; Form retains its independent position-ownership
gate. Anima consumes label reveal policy, while label layout and adaptive budgets remain
owned by the label manager and renderer.

## 2. View transitions

| Current View | Input | Result |
| --- | --- | --- |
| Overview | Primary node activation | Resolve the whole connected highlighted group, replace membership, enter Constellation; preserve framing |
| Overview | Background | Constellation; retain membership and framing, including an empty build workspace |
| Overview | Escape | Remain in Overview |
| Constellation | Primary activation of committed member | Enter Focus; recenter without fitting |
| Constellation | Primary activation of dim candidate | Admit the candidate and its nearest visible path; remain in Constellation and preserve framing |
| Focus | Primary node activation | Retain membership, admit the candidate and connecting path if needed, hop Focus; recenter without fitting |
| Focus | Background or Escape | Constellation; retain membership and camera frame |
| Constellation | Background or Escape | Overview; retain membership and camera frame |
| Any View | Ctrl-click object | Add candidate and path, or remove only the member, without descent; removing the subject releases Focus, removing the last member resolves Overview |

Primary release commits only for a stationary gesture. A second matching release
adds the primary host action once and preserves the first descent. Node hold (450 ms)
remains a Focus shortcut. Moving a matching second press interpolates translation
into Focus over 35% of the smaller viewport dimension while preserving scale. Holds
and navigation never emit a competing click. Touch Add/Remove constellation is
available through object actions.

Ordinary Focus entry and root hops recenter immediately in the committing input frame,
preserving zoom, orientation, and perspective distance. They schedule no camera
interpolation timers and emit only the final viewport state. The second-press scrub
gesture above remains driven by explicit input progress.

An interaction receipt is immutable evidence of an effect that has already committed.
It has a kind, graph identity and revision, issue and expiry timestamps, an ordered,
bounded log of timestamped interaction phases, and an opaque payload owned by the
issuing interaction. A tap receipt records both press and release, allowing recognizers
to measure release-to-press, press-to-press, hold duration, or other temporal relations
without changing the evidence format. Receipt adjudication is a pure operation that
returns `empty`, `expired`, `unmatched`, or `matched`; it never performs or rolls back an
effect. The caller owns receipt storage and explicitly maps a match to reconciliation or
an additional effect. A graph revision change invalidates the receipt. This contract is
generic so other compound interactions can reuse it without adopting click semantics.
The subject-local owner that retains and recognizes such a receipt is a Reflex. Reflex
evidence is transient and is not automatically added to Consciousness Memory.


## 3. Vision and framing

Interest, recentering, and fitting are independent. Changing interest changes the next
pivot without recentering. Overview uses pointer-anchored wheel/pinch and free framing
without tracked subjects. Constellation suggests its centroid; Focus uses its subject.
On Focus exit, Ego retains the current Vision focal point. Constellation orbit and
unanchored zoom then use that point, and node motion no longer pulls the camera.
View toggles and membership edits preserve the retained intent. A new Focus subject,
new Overview constellation choice, or explicit Center/Fit establishes a new interest.
Physical Ctrl-wheel keeps its pointer anchor in every View.

Focus clicks translate immediately, preserving zoom, orientation, and perspective distance.
Repeated subject activation cannot refit. Motion inherits positional deltas while
preserving the user offset; membership changes do not pull the camera. Automatic
settling fits and the neighborhood zoom cap are removed. Explicit Center + Fit uses
the whole projected graph, the active set, or all members plus focused-object neighbors,
respectively. Lone-point fitting retains the readable fallback scale.

## 4. Scene and transient affordances

Overview has no View-induced dimming. Constellation highlights members and dims every
nonmember. Focus highlights all members, dims the subject's immediate nonmember
neighbors, and voids everything else. Links take the weaker endpoint phase. Void
subjects have no labels, hit targets, preview, or context activation. Hover evaluates
ordinary object activation through the same View planner and Experience admission as
click. Overview highlights the prospective chosen group without dimming. Constellation
previews admission for a dim candidate and Focus for a committed member; Focus previews
its subject hop. Hover also lights a shortest projected-graph route back to the nearest
committed constellation (already highlighted Attention/Memory in Overview). Route nodes
and links remain transient during hover; adding the candidate commits the route nodes. Hover lighting does
not count as membership for deciding whether a click enters Focus. Revealed nodes can
become subsequent hover/click targets. Ctrl-hover previews the Ctrl-click toggle,
including an addition's connecting path, Focus release and empty-set Overview. Removal never highlights a route. Modifier
release restores ordinary hover; a removal preview retains its own acquired hit target
until the pointer leaves even if that preview would void it.
Leaving restores the committed scene. Hover never commits membership, Focus, View,
Memory, camera movement, or host actions. Option preserves the effective scene. Space
preserves the scene in Constellation/Focus and explicitly clears user membership in Overview.
The prospective subject receives the Focus outline and highest-priority label.
See [View scene contract](graph-engine-view-scene-contract.md#hover-previews-object-activation).

## 5. Desktop input matrix

### 5.1 Pointer and trackpad

| Input | Overview | Explore | Focus |
| --- | --- | --- | --- |
| Primary background drag, 2D | Pan | Pan | Elastic pan |
| Primary background drag, 3D | Pan | Pan | Pan |
| Primary drag on selected node | Drag node | Drag node | Drag after stable mouse hover; otherwise navigate |
| Primary drag on unselected node | Drag node without selecting | Drag node without selecting | Drag a visible direct neighbor after stable mouse hover; otherwise navigate |
| Secondary drag, 2D | Pan | Pan | Radial zoom around focused node |
| Secondary drag, 3D | Rotate | Rotate | Radial zoom around focused node |
| Two-finger scroll, 2D | Pan | Pan | Elastic pan |
| Two-finger scroll, 3D | Pan | Rotate | Rotate |
| Physical Ctrl-wheel | Zoom around pointer | Zoom around pointer | Zoom around pointer |
| Trackpad pinch | Zoom around cursor, including momentum | Zoom around intended interest: centroid or retained focal point | Zoom around focused node |
| Cmd-wheel | State navigation; never zoom | State navigation; never zoom | State navigation; never zoom |
| Stationary background secondary click | Center + Fit graph | Center + Fit selection | Center + Fit Focus presentation field |
| Stationary node secondary click | Node context menu | Node context menu | Node context menu |
| Double-click node | Primary node action | Primary node action | Primary node action |

Primary desktop background dragging in Focus translates the camera without rotating,
preserving zoom, orientation, distance, membership, and subject. Stable-hover node
dragging retains its separate object-movement gesture.

Focus radial zoom measures pointer distance from the focused node. Moving away zooms
in; moving toward the focused node zooms out.

Focus node dragging is deliberately narrower than ordinary navigation. A desktop
mouse may drag the focused subject or a visible direct neighbor when that exact node
was already the stable semantic hover target at pointer-down. A direct touch beginning
on either node may also drag it because the contact itself supplies the missing hover
intent. The drag retains the existing Attention and Focus; Vision follows when the
focused subject itself moves. Mouse movement without stable hover and touch movement
beginning on the background remain camera navigation. Pen retains the Focus navigation
gesture and does not enter this node-drag path.

### 5.2 Keyboard and modifiers

| Input | Behavior |
| --- | --- |
| Hold Ctrl + node clicks | Toggle membership without descent or camera movement |
| Release Ctrl | No selection or camera change |
| Hold Option | Preserve constellation-only highlighting; selection and camera unchanged |
| Space | Overview: clear user constellation, preserving framing and Memory; Constellation/Focus: preserve View scene phases |
| Arrow keys | Pan |
| Shift + arrow keys in 3D | Rotate |
| `+` / `-` | Zoom in / out; Overview uses the last pointer or free framing point; Constellation and Focus use their tracked subject |
| Enter with exactly one selected node | Primary node action |
| Escape | Back one View; retain membership and framing |

## 6. Mobile input matrix

| Input | Overview | Explore | Focus |
| --- | --- | --- | --- |
| One-finger drag, 2D | Drag a directly touched node; pan from background | Drag a directly touched node; pan from background | Drag a directly touched node; elastic-pan from background |
| One-finger drag, 3D | Drag a directly touched node; pan from background | Drag a directly touched node; orbit from background | Drag a directly touched node; rotate from background |
| Two-finger translation, 2D | Pan | Pan | Pan |
| Two-finger translation, 3D | Rotate | Rotate | Rotate around the focused node |
| Pinch | Touch-midpoint zoom with navigation | Intended-interest zoom with navigation | Focused-subject zoom with navigation |
| Double-tap background | Center + Fit graph | Center + Fit selection | Center + Fit Focus presentation field |
| Double-tap drag, 2D | Vertical zoom | Vertical zoom | Radial zoom |
| Double-tap drag, 3D | Horizontal rotate + vertical zoom | Horizontal rotate + vertical zoom | Radial zoom |
| Long press background | Center + Fit graph | Center + Fit selection | Center + Fit Focus presentation field |
| Long press node | Enter Focus | Enter Focus | Retain/hop Focus |
| Double-tap node | Primary node action | Primary node action | Primary node action |

Two-finger translation and pinch are simultaneous controls. In 3D, centroid movement
rotates while finger separation zooms; in 2D, centroid movement pans while finger
separation zooms. Pinch uses touch midpoint in Overview, intended interest in Constellation
(the active composition centroid by default, retained focal point after Focus exit),
and singular subject in Focus.

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

The authoritative `Consciousness`, `Ego`, `Attention`, and `Awareness` values live in
`src/graph-engine/runtime/consciousness/Consciousness.ts`. Interaction state and gesture permissions live
in `runtime/interaction/GraphInteractionStatePolicy.ts`. Anima owns state-scoped
rendering policy, highlight expansion, dimming, and label decisions in
`runtime/anima/AnimaAwareness.ts`. `Vision` owns only pose, projection, and geometric
viewpoint operations.

Runtime implementation names are unversioned (`Ego`, `Awareness`, `Vision`, `Pose`,
and `Orientation`). Public and persisted compatibility types retain their protocol
suffixes, including `GraphCameraStateV1`; Vision converts that legacy look-at point
into a forward orientation and never treats it as Ego Awareness.

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


Overview background activation toggles into Constellation, even with no selected
members; the empty build View has no tracked centroid. Escape stops at Overview.
View policy suppresses labels on Ctrl-removal previews before the hovered-label
forcing rule. Dragging does not expand neighbor highlights in any View. Overview
Space clears user Attention and preserves camera framing and Memory. Center + Fit
preserves membership; node right-click still opens the existing context menu.
