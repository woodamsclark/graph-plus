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
- Ego captures interpreted input and proposes a View directive. Its owned
  `Judgement` admits the intention after Experience validates or adjusts its meaning.
  One reducer derives the complete resulting state.
- Anima expresses the admitted plan as a transient preview.
- The interaction runtime commits the admitted state to the existing owners.
  Consciousness retains authoritative Attention; View state mirrors membership
  for compatibility and retains View/focus; Vision performs camera effects.
- Realized interaction observations continue through the existing Memory path.
  Evaluating a proposal produces no observation or consumer action.

Exogenous events still update conscious state through their established policy
path without seeking Ego approval. Such changes invalidate incompatible will.

### Judgement and route ownership

`Ego.judgement` owns the admission policy. Its initial rule allows every valid
intention. Experience retains the existing structural constraints: available Views,
interaction capabilities, subjects, and Attention cardinality. Permissive admission
does not manufacture a missing subject or an unavailable View.

Judgement is synchronous and has no effects, observations, or Memory writes. Its
rule is immutable for its lifetime. A different rule has a different semantic
revision, preventing an earlier will from being reused under a different policy.
Hover and activation both evaluate the same owned Judgement. Generic interpreted
commands, Reactions, and control-port node actions also pass through it.

Quick Settings Back, Overview, Clear constellation, context-menu Focus, and
membership toggles enter through the session's interaction control port. They queue
semantic input for the ordinary document-identity/Will/commit boundary. Menu Focus
admits the same visible connecting route as canvas Focus. Back means Escape's
one-View retreat; Overview does not offer a forward-pointing Back button. Clearing
a Local composition resolves to its permitted empty Constellation View.

The public `setView`, `setSelection`, and `focusNode` compatibility setters install
state for consumers and test/restoration workflows; interactive View controls must
not use them. Host-translated arrivals use `applyExternalInfluence`, including
application-level Show in Graph+. Received state does not emit endogenous
selection/focus observations or request host navigation in response to itself.

## Captured input

`EgoInteractionInputV1` captures:

- phase: `hover` or `activate`;
- target: a node ID or background;
- modality: mouse, touch, pen, or keyboard;
- independent Ctrl, Meta, Shift, and Alt facts.
- optional explicit `membershipAction: 'toggle'` for Add/Remove menu input.
- optional `objectAction: 'focus'` for explicit menu Focus;
- optional `navigationAction` for Back, Overview, or Clear constellation controls.

The input describes semantic activation. Coordinates, camera geometry, raw
pointer/button history, hold timing, and drag recognition stay with Input/Reflex
and Vision. This first implementation covers primary node activation,
Ctrl membership removal, constellation and Focus menu actions, View navigation controls, background activation, and Escape. Double activation,
node opening, holds, context menus, camera navigation, and dragging retain their
existing interpreted-command paths through Ego's generic adjudication. They
need plans only if a future interaction must predict their outcome.

Ctrl means idempotent membership removal. The menu captures its toggle action
explicitly rather than impersonating a physical Ctrl gesture. Capturing Meta/Shift/Alt does not
assign them new activation behavior; platform Mod note previews retain their
existing behavior.

## A plan answers what would happen now

`EgoInteractionPlanV1` is an immutable snapshot containing:

- captured input and document identity;
- its semantic context key and committed `before` state;
- requested action: choose constellation, admit member, remove member,
  focus member, enter Constellation through Overview background, go back, or none;
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

### Ctrl activation outcome matrix

Will resolves the complete activation outcome from committed membership. Anima
expresses its object deltas during hover while keeping the committed View and
Focus neighborhood. The View and subject columns below take effect only on click.

| Target before input | Resulting membership | Resulting View / subject | Action |
| --- | --- | --- | --- |
| Unselected, in any View (including empty Constellation) | Unchanged | Unchanged | `none` |
| Selected, in Overview | Remove target only | Overview | `remove-member` |
| Selected, in Constellation, with members remaining | Remove target only | Constellation | `remove-member` |
| Selected, another Focus member | Remove target only | Focus retains its subject | `remove-member` |
| Selected Focus subject, with members remaining | Remove target only | Constellation, no subject | `remove-member` |
| Last selected member, in any View | Empty | Overview, no subject | `remove-member` |

`none` is an accepted no-change outcome: resulting state equals `before`, effects
and connecting path are empty, and activation performs no mutation or observation.
After Ctrl removal commits, holding Ctrl over that same target resolves to `none`;
it cannot preview re-addition. Ctrl over a nonmember adds no outline, path, phase
change, or hover-forced label. Independent remembered presentation remains intact.
Releasing Ctrl resolves ordinary primary hover unless activation consumed this node visit; rearming requires pointer leave and return.

The previous toggle rule was introduced in `a834813`. Both the planner and tests
encoded nonmember Ctrl addition, while scene tests left the pointer after removal
without checking the immediate held-Ctrl frame. This matrix supersedes that rule.

## Presentation is derived from admitted will

`presentEgoInteractionPlanV1` derives `GraphInteractionPreviewV1` from Will.
Its `objects` lane contains admitted node/link deltas and retains committed View
context. Its `view-transition` lane additionally carries the admitted resulting
state whenever admission enters Constellation, a group enters its View, or a member
enters/hops Focus. That state supplies
prospective scene context only; Consciousness and exported View remain committed.

Overview unhighlighted nodes admit the candidate and its shortest visible route
and enter Constellation in the same click. Committed Attention or Memory highlights enter their
constellation. Constellation candidates admit membership only; members enter Focus.
Preview brightness never decides which action applies. Ctrl removal always uses
object deltas and retains committed context until activation, including subject or
last-member removal. Will retains the full outcome for every action.

Hover awareness is a separate Anima policy for object-delta previews: raise only the
hovered node in Overview; in Constellation and Focus also raise immediate neighbors
and incident links. Explicit View-transition previews do not receive this extra layer;
they present the exact admitted destination scene. Hover awareness bypasses Ctrl
removal/no-change. It never writes Consciousness or changes Will.

Background input can be captured as will, but hovering background does not preview
backing out of the current View.

Picking follows the committed View with explicit object additions and paths. A
prospective focus cue never supplies a neighborhood for hit testing. The Ctrl-removal
exception retains only the acquired removal target for picking if its own preview
voids it. It does not make every void node interactive. A transient highlight is
never evidence of committed membership.

## Freshness and consumption

A plan is current only while these semantic facts match:

- document ID and revision, including topology;
- committed View, Attention membership/order, and focused subject;
- canonical available node IDs and projected node/edge sets;
- Awareness and separate remembered membership used to resolve source-typed Overview constellations;
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
proposal and commits its admitted node/View outcome. Activation consumes that node's
hover visit before refreshing presentation. The next action preview waits for pointer
leave and return; same-node movement, modifier changes and external updates do not
rearm it. Ordinary awareness lifting continues independently. Another click resolves
fresh committed state and may transition immediately, without requiring a preview.
Reset, suspension and disposal clear the transient visit latch. Hover never changes
state itself.

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
  pure presentation callers evaluate the same Ego planner; presentation exposes
  only object deltas, never a hypothetical View.

Related: [Consciousness ownership](graph-engine-agency-awareness-ontology.md),
[View and Scene Contract](graph-engine-view-scene-contract.md), and
[physical interaction mechanics](graph-engine-interaction-state-contract.md).


Background pointer activation toggles Overview and Constellation, retaining membership
and framing. A keyboard Back/Escape proposal uses the separate escape binding and
stops at Overview. Empty Constellation is permitted; Focus still requires a subject.
Ctrl-removal label suppression takes precedence over hovered-label forcing. These
rules are View declarations, not inferred from highlight brightness.
