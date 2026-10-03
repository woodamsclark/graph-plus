# Ego Will and Interaction Plans

Date: 2026-10-02

Status: Implemented. Automated coverage is in
`tests/runtime/ego-interaction-plan.test.ts` and the existing View/input tests.
Obsidian visual smoke verification remains separate.

## Ownership

Ego also holds committed session-level `visionIntent`: follow a subject, follow the
constellation, or retain Vision's current focal point. This is separate from transient
hover will. Focus exit commits `retain-focal-point`, including exits caused by member
removal or filtering. The intent survives View toggles and composition edits until a
new deliberate focus, constellation choice, or Center/Fit. Vision owns the actual
coordinates and camera pose; Ego stores no geometry. Retaining the point stops node
motion-follow, while camera pan still moves the framing point. This session intent
is not currently serialized; camera pose retains its existing saved-state contract.

Ego retains **will**: the current interpreted input and the admitted outcome of
acting on it now. This is a transient proposal, not committed truth. Each session's
`Consciousness.ego` owns its own `will`; it cannot leak between panes or sessions.

The View describes engagement: discover/all in Overview, build/many in
Constellation, and present/one in Focus. Will describes the next proposed change
to that engagement. It does not belong in persisted View state, Quick Settings,
canonical graph data, conscious Memory, or a second selection store.

The implementation follows these boundaries:

- Input/Reflex recognize physical events and gestures, and acquire a target.
- Ego captures interpreted input, proposes a View directive, and asks Experience
  to admit, adjust, or reject it. One reducer derives the complete resulting state.
- Anima expresses the admitted plan as a transient preview.
- The interaction runtime commits the admitted state to the existing owners.
  Consciousness retains authoritative Attention; View state mirrors membership
  for compatibility and retains View/focus; Vision performs camera effects.
- Realized interaction observations continue through the existing Memory path.
  Evaluating a proposal produces no observation or consumer action.

Exogenous events still update conscious state through their established policy
path without seeking Ego approval. Such changes invalidate incompatible will.

## Captured input

`EgoInteractionInputV1` captures:

- phase: `hover` or `activate`;
- target: a node ID or background;
- modality: mouse, touch, pen, or keyboard;
- independent Ctrl, Meta, Shift, and Alt facts.

The input describes semantic activation. Coordinates, camera geometry, raw
pointer/button history, hold timing, and drag recognition stay with Input/Reflex
and Vision. This first implementation covers primary node activation,
Ctrl membership toggles, the Add/Remove constellation menu actions, background activation, and Escape. Double activation,
node opening, holds, context menus, camera navigation, and dragging retain their
existing interpreted-command paths through Ego's generic adjudication. They
need plans only if a future interaction must predict their outcome.

Ctrl means the membership-toggle modifier. Capturing Meta/Shift/Alt does not
assign them new activation behavior; platform Mod note previews retain their
existing behavior.

## A plan answers what would happen now

`EgoInteractionPlanV1` is an immutable snapshot containing:

- captured input and document identity;
- its semantic context key and committed `before` state;
- requested action: choose constellation, admit member, remove member,
  focus member, enter Constellation through Overview background, or go back;
- admission outcome: accepted, adjusted, or rejected;
- the admitted directive, or rejection reason;
- resulting View, Attention membership, focused subject, and captured connecting path;
- ordered commit effects: clear transient presentation and, where appropriate,
  recenter the new focused subject while preserving camera scale/orientation.

Rejected will remains inspectable in Ego. Its resulting state equals `before`,
its effects are empty, and Anima does not present an impossible transition.
Adjusted outcomes already incorporate Experience's permitted Views,
capabilities, and Attention cardinality. Hover cannot bypass those constraints.

`Ego.resolveWill(input, context)` is the single live resolution point. An unchanged
input/context reuses the plan. Advancing hover to activation captures the new
phase while retaining the same admitted resulting-state/effect objects. Click
commits those objects rather than separately reconstructing the transition.
Legacy Attention commands use the same state-realization reducer.

## Presentation is derived from admitted will

Anima receives the plan's resulting state through `presentEgoInteractionPlanV1`.
Ego captures the shortest visible connecting path when admitting a new member,
and includes its nodes in the resulting Attention set. Anima uses that captured
route for both ordinary and Ctrl-addition previews. Ctrl removal removes only the
clicked node and has no route. Hover never realizes Attention or camera effects;
activation commits the admitted candidate and route together. Overview whole-group
entry retains its group-lookup contract instead of extending the previous set.

Overview keeps the discover field undimmed while showing prospective membership.
Constellation and Focus express the admitted resulting scene. The detailed scene
rules remain in the [View and Scene Contract](graph-engine-view-scene-contract.md).
Background input can be captured as will, but hovering background does not preview
backing out of the current View.

Picking still follows the rendered prospective scene. The existing Ctrl-removal
exception retains only the acquired removal target for picking if its own preview
voids it. It does not make every void node interactive. A transient highlight is
never evidence of committed membership.

## Freshness and consumption

A plan is current only while these semantic facts match:

- document ID and revision, including topology;
- committed View, Attention membership/order, and focused subject;
- canonical available node IDs and projected node/edge sets;
- Awareness membership used to resolve Overview constellations;
- the Experience contract.

The constellation lookup must be derived from these facts. Changing graph
relationships must revise the document; changing projection or highlighted
membership must update the corresponding context. Equal sets with a different
iteration order do not expire a plan. Geometry, camera motion, and layout alone
do not alter its semantic outcome.

The runtime validates freshness when routing activation and immediately before
applying it. Changed context causes resolution against current truth; stale
resulting state is never committed. A command for an old document identity is
rejected by the existing command boundary. A removed/filtered target is rejected
rather than committed from its previous hover plan.

Effects execute only at commit. Primary Focus entry/hops recenter immediately in the
committing input frame, without fitting or timer-driven camera interpolation;
admitting a dim Constellation candidate preserves framing; Back preserves
composition and camera framing. The runtime retains existing View-change intents,
consumer routing, and Memory observation semantics.

## Lifecycle

Pointer leave, pointer cancellation, interaction reset, dimension reset,
suspension, and disposal clear captured hover input and will. Ongoing navigation
or drag gestures supersede the node activation preview. Activation consumes the
proposal; if the pointer still hovers afterward, the next presentation resolves a
new proposal against committed state. A hover never changes state itself.

`Ego.will` is a snapshot of the most recently resolved input. Consumers must
validate it against current context before acting; reading this property alone
is not proof of freshness after an external update.

## Implementation seams

- `runtime/consciousness/Consciousness.ts`: session Ego retains will.
- `runtime/consciousness/EgoInteractionPlan.ts`: immutable plans, admission,
  shared state realization, semantic freshness.
- `runtime/interaction/GraphViewObjectActivation.ts`: View node translation and
  graph-path resolution helpers.
- `runtime/interaction/GraphInteractionInterpreter.ts`: emits interpreted
  activation input and captures hover modifiers.
- `runtime/interaction/SessionInteractionRuntime.ts`: current context, plan
  routing, freshness validation, commit, lifecycle, and effect execution.
- `runtime/anima/AnimaInteractionPreview.ts`: plan-to-presentation adapter;
  pure presentation callers evaluate the same Ego planner.

Related: [Consciousness ownership](graph-engine-agency-awareness-ontology.md),
[View and Scene Contract](graph-engine-view-scene-contract.md), and
[physical interaction mechanics](graph-engine-interaction-state-contract.md).


Background pointer activation toggles Overview and Constellation, retaining membership
and framing. A keyboard Back/Escape proposal uses the separate escape binding and
stops at Overview. Empty Constellation is permitted; Focus still requires a subject.
Ctrl-removal label suppression takes precedence over hovered-label forcing. These
rules are View declarations, not inferred from highlight brightness.
