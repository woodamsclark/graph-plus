# Graph Engine agency and Awareness ontology

Status: Approved target ontology; implementation complete through Phase 12

Date: 2026-09-28

View implementation note: the [View and Scene Contract](graph-engine-view-scene-contract.md)
now implements Overview, Constellation, and Focus as Ego engagement framings. It
supersedes Phase 12's use of all Awareness as active composition and camera pivot.
Attention owns active membership; broader Awareness/Memory illuminate Overview and
supply connected highlighted groups for discovery. Choosing a group object replaces
Attention. View definitions supply bindings, interest, scene phases, and controls;
Consciousness retains membership and Memory ownership. View changes do not mutate
world or layout. Phase 12 notes below record the earlier migration.

Implementation status: Phase 1 defines the target semantics. Phase 2 implements the
presentation-scoped Consciousness foundation, Attention derived from compatibility
selection, membership-only Awareness, Ego Attention intents, and Vision-owned centroid
derivation. Phase 3 routes every interpreted endogenous interaction through Ego,
adjudicates accepted, adjusted, or rejected outcomes before effectors, and makes
Attention authoritative inside the interaction runtime while preserving
`selectedNodeIds` as a V1 compatibility mirror. Phase 4 implements the neutral
experience contract, Graph+ policy translation, Attention cardinality, policy-driven
Awareness expansion, endogenous capability/state adjudication, and policy-owned
framing targets. Phase 5 adds policy-governed exogenous Attention replacement and
routes Local active-note truth through it without creating Ego intent.
Phase 6 makes Anima consume explicit Attention and Awareness, classifies every
projected node as attended, peripherally aware, or unaware context, and removes the
scene compiler's semantic dependency on compatibility selection. Phase 7 separates
the structural projection and presentation module stages, constrains Consciousness to
projected document membership, and enforces one-way patch capabilities at runtime.
Phase 8 installs one bidirectional `ObsidianGraphBridge`, makes
`GraphPlusApplicationV1` the shared canonical reconciliation and graph-world owner,
and leaves each pane with independent viewport Consciousness and Vision.
Phase 9 keeps Local Attention, Focus, camera, and filters presentation-scoped.
Double-click adds an outbound bridge reveal and waits for the canonical active-note push.
Phase 10 locks the completed migration with regressions for shared coordinates and pins,
pane-local viewport state, Local Attention cardinality, Awareness expansion, canonical
multi-pane fan-out, and exactly-once outbound/inbound mutation.
Phase 11 adds subject-local Reflexes and presentation-scoped conscious Memory,
Association, and Reaction. Semantic observations compact into logarithmic historical
memory; declarative associations produce Reaction intents that pass through Ego before
an existing scoped capability executes.
Phase 12 makes Awareness the authoritative observable constellation: deliberate
Attention and the recent subjects retained by Memory contribute durable membership,
while policy-expanded neighbors live in a distinct conscious field. Anima now derives
highlighting from Awareness instead of applying Memory as a late visual override.
Vision uses the aware constellation as the Explore pivot, and an empty Overview cannot
enter an unanchored Constellation.

Ego now also retains transient **will**: captured node/background input and its
accepted, adjusted, or rejected interaction plan. Hover expresses the admitted
result through Anima; activation validates freshness and commits that same result.
Will remains distinct from realized Attention, View state, and Memory. Its scope,
ownership, and lifecycle are defined in the
[Ego Will and Interaction Plans contract](graph-engine-ego-interaction-plan-contract.md).

For target semantic ownership, this document supersedes the Ego/Awareness ownership
claims in `graph-engine-animus-anima-boundary.md`,
`graph-engine-interaction-state-contract.md`, `graph-engine-v1-contracts.md`, and the
interaction-presentation section of the V1.6 Anima contract. Those documents continue
to describe compatibility mechanics that have not yet migrated.

## Purpose

This contract defines the relationship among user agency, interpreted input,
Awareness, external stimuli, Vision, and Anima. It is the proposed successor to the
passive Ego model currently described by the interaction-state and Animus/Anima
contracts.

The ontology is internal to Graph Engine. Public consumers provide graph documents,
experience constraints, and neutral external events without needing to adopt Ego,
Awareness, Vision, or Anima as public API concepts.

## Awareness is an independent observable constellation

Awareness is the current set of graph subjects available for deliberate observation.
It is the semantic constellation Anima expresses as highlighted. It is not owned by
Ego and is not a synonym for compatibility selection.

Subjects can enter or leave Awareness through more than one influence:

- Ego intentionally attends to or withdraws from them;
- Memory retains recently experienced subjects after Attention moves on;
- experience policy constrains or requires a subject;
- an exogenous event introduces, removes, or invalidates a subject; or
- another future engine subsystem contributes information without an explicit Ego
  decision.

Ego can direct and influence Awareness, but cannot assume exclusive authority over
everything that enters it. Exogenous influences and Memory may preserve or expand the
set without Ego having just initiated that change.

Nodes placed in Attention through selection enter Awareness intentionally. Remembered
session subjects also remain in Awareness after deliberate Attention moves elsewhere.
Nodes outside Awareness may remain in the wider conscious field as visible periphery,
or remain ordinary projected context according to the active view policy. Hover is a
transient Anima input: it highlights its subject and may return neighboring context to
standard presentation without durably changing Awareness.

Awareness is semantic state, not visual styling. It does not choose colors, opacity,
labels, outlines, geometry, or animation.

Awareness is an undifferentiated, binary set. A subject is either within Awareness or
outside it. Awareness carries no degree of salience, intensity, or priority and does not
expose why a subject is a member. Attention, Memory, hover, Focus, and other interaction
facts remain independent inputs. Rendered highlight is derived from Awareness; rendered
selection remains the compatibility expression of deliberate Attention.

Systems that combine temporary and durable influences may retain private contribution
bookkeeping so removing one influence does not incorrectly remove a subject that
remains aware for another reason. That bookkeeping is not part of Awareness's semantic
contract.

Awareness owns node membership only. Links do not independently enter Awareness in the
current ontology. Anima derives a link's expression from its endpoints, topology,
interaction facts, and the endpoints' Awareness membership. This can be generalized
later if Graph Engine gains an interaction whose subject is a relationship itself.

Awareness does not own a centroid, bounds, positions, or any other world-space geometry.
Spatial values derived from aware nodes change as the graph moves even when Awareness
itself has not changed, so they are not part of its semantic state.

## Exogenous conscious state bypasses Ego

An exogenous event does not require Ego's approval before affecting Attention or
Awareness. The consumer translates a host event according to the active experience
policy and submits the resulting conscious-state change to Graph Engine. Ego
experiences the changed state; it does not retroactively become the author of that
change.

For Local Graph+, an Obsidian active-note change replaces each Local presentation's
existing Attention with the newly active note and ensures that note is within Awareness. This is
a replacement rather than an additive Attention contribution. A later endogenous node
selection may consciously replace Attention again through Ego. Global Graph+ may use
different Attention semantics because its policy does not root the presentation in
Obsidian's active note.

This does not mean every external graph mutation enters Awareness. A vault rename, for
example, may update canonical graph truth without changing what is presently aware.
Graph+ decides which host events have Awareness meaning when it translates them into
neutral Graph Engine input.

## Attention, Awareness, and the conscious field

Attention is the set of nodes presently held at the center of deliberate conscious
activity. Awareness contains Attention plus subjects retained by conscious Memory.
The conscious field contains Awareness plus policy-defined peripheral subjects. The
core invariants are:

```text
Attention is a subset of Awareness
Awareness is a subset of ConsciousField
```

Attention is semantic state rather than a synonym for raw UI selection. Selecting
nodes is the ordinary endogenous way Ego directs Attention. Once the transition is
accepted, rendered selection is the interactive and visual expression of Attention;
it is not a second durable source of truth. Attention may also be redirected
exogenously: in Local Graph+, an Obsidian active-note change replaces Attention without
Ego having selected the node.

```text
selection input --> Ego intent --> Consciousness updates Attention
                                      |
                                      +--> Anima expresses Attention as selection
```

The presentation must not independently retain `selectedNodeIds` that can disagree
with Attention. Existing selection-shaped protocol values may remain temporarily for
compatibility, but their semantic source is Attention. An exogenous Attention change
therefore changes rendered selection through the same projection used for an
endogenous Attention change.

Awareness is not limited to Attention: Memory may keep a subject aware without keeping
it selected or attended. Hover does not, by itself, change durable Attention or
Awareness.

Empty Awareness is a valid neutral state. It does not direct Anima to hide or dim every
projected node. An empty Overview remains neutral and cannot enter Constellation until
a click, Memory, or another permitted influence provides an aware subject. Once
Awareness is non-empty, Anima may contrast its members against peripheral context.

Focus Mode constrains Attention to at most one node. While a rooted Local presentation
has a valid active subject, its policy requires exactly one. Changing that node replaces
the previous Attention, whether the change is endogenous through Ego or exogenous
through Local Graph+. The presentation then derives the appropriate Awareness field
around the new Attention. A neighbor becoming aware does not make that neighbor
attended.

When Local Graph+ has no valid active node, Attention and Focus are empty while the
full shared graph and recent Memory remain available. It does not invent a placeholder
subject merely to satisfy Focus. A later canonical active-note push establishes the new
subject without recreating or relaying out the graph.

Global presentations do not inherit Focus's cardinality constraint. Their Attention
may contain multiple intentionally selected nodes as a constellation, or be empty when
the experience is not directing attention to a selection.

## Experience policy expands Awareness into the conscious field

The active presentation policy defines how Awareness contributes peripheral nodes to
the conscious field. Consciousness applies that rule; Ego does not hard-code a
neighborhood radius or topology.

Examples of policy-governed expansion include:

- Local Focus places its active node in Attention and Awareness. Anima derives the
  Focus presentation field from the same full graph used by Global.
- Global Constellation combines selected Attention and recent Memory into Awareness,
  then may include a different policy-defined periphery in the conscious field.
- Global Overview with neither Attention nor Memory leaves Awareness empty, producing
  the neutral baseline presentation.
- Hover remains transient presentation influence without changing either durable set.

Changing these expansion rules changes an experience policy rather than Ego,
Awareness, or Anima.

## Projection precedes Consciousness

Awareness does not decide which nodes exist in a presentation. Graph+ supplies the
same canonical full graph to each Graph Engine session. Consciousness
then classifies nodes within that projection as attended, aware, or neither, and Anima
expresses those classifications.

```text
canonical graph --> Graph+ projection --> presented graph
                                            |
                         Consciousness classifies its nodes
                                            |
                                  Anima resolves expression
```

Nodes outside Awareness may remain visible as neutral or dim context. Local Graph+
does not crop this context into a second document; Attention and Awareness describe
conscious state inside the shared graph. A rootless Local pane retains recent subjects
through Memory without treating any of them as current Attention.

## Local click and reveal are separate intents

A single click on a node in Local Graph+ directs that presentation's Attention and camera
to that node inside the existing graph. This is an endogenous graph interaction; it
does not recreate or reorder the graph. The outbound navigation
may subsequently make the same node Obsidian's active note.

A double click adds a host-facing reveal intent. Graph+ translates that intent and asks
`ObsidianGraphBridge` to activate the corresponding note. The outbound result does not
itself perform the canonical Local re-root. When Obsidian publishes the resulting
active-note change, the shared canonical inbound path replaces Attention and Focus in
each Local presentation while Global preserves its viewport state.

The first click of the double-click gesture changes only the originating presentation's
Attention and camera. The later canonical active-note push
re-roots it and applies the same exogenous change to other Local presentations. Global
presentations do not follow the active-note event.

## Agency is presentation-scoped

Each Graph Engine presentation session owns its own Consciousness, including Ego,
Attention, and Awareness, together with its own Vision. Ego represents the user's
agency within that presentation context; it is not a plugin-wide singleton shared by
every open graph pane.

Graph+ may host multiple Global and Local presentations through one shared
`GraphPlusApplication`. The application distributes canonical vault changes and other
exogenous events to those presentations, and each presentation interprets them under
its own experience policy. An active-note change can therefore replace the Attention
of every Local presentation without replacing a Global presentation's Attention,
Awareness, selection, or camera state.

## Consciousness holds Ego, Attention, and Awareness

`Consciousness` is the presentation-scoped aggregate that holds Ego, Attention, and
Awareness. It is not a passive namespace around unrelated values. It receives interpreted
endogenous activity through Ego, receives permitted exogenous influence independently
of Ego, applies policy-governed transitions, and reconciles those influences into the
current Attention and binary Awareness field.

```text
                    Consciousness
              +-----------------------+
endogenous -->| Ego --> intent         |
              |              \         |
exogenous --->|----------> reconciliation --> Attention + Awareness
              +-----------------------+
```

The previously proposed `AwarenessResolver` is therefore an internal responsibility of
Consciousness rather than a peer top-level domain object. It may privately retain the
contribution bookkeeping necessary to combine durable and transient influences, while
the published Attention and Awareness values each remain undifferentiated sets of node
IDs.

Consciousness must remain a narrowly defined agency-and-awareness boundary. It does not
absorb camera mathematics, visual styling, graph physics, persistence, or host
integration merely because those systems consume or influence its state.

Consciousness does own associative Memory because remembered semantic observations can
become new endogenous Reaction intents. Storage serialization remains the session
persistence boundary's responsibility; Consciousness owns the meaning and compaction of
the memory being serialized. See
[Reflex, Memory, Association, and Reaction Contract](graph-engine-reflex-memory-association-reaction-contract.md).

## Ego owns intent and direction

Ego represents the user's agency within Graph Engine. It receives mechanically
interpreted endogenous intentions, operates within the active experience policy, and
issues semantic directives to the systems capable of realizing those intentions.

Ego may contribute subjects to Awareness, withdraw its own contributions, direct a
viewpoint intention to Vision, request spatial manipulation, or initiate a consumer
operation. Ego does not implement pointer mechanics, camera mathematics, physics,
rendering, persistence, or host integration.

Ego's intentions are directional proposals, not declarations of truth. They may be
constrained by experience policy or compete with exogenous influences. The realized
state therefore does not necessarily equal the state Ego most recently intended.

The relationship is therefore not `Ego owns Awareness`. It is:

```text
Ego intention and perception ---┐
Experience requirements --------+--> Awareness field --> Anima
Exogenous stimuli --------------┘
```

Raw pointer mechanics do not belong to Ego. The interaction interpreter identifies a
semantic hover, click, drag, or key action; Ego receives that interpreted endogenous
event and expresses the user's intent or transient attention. Hover is therefore an Ego
contribution to Awareness rather than an independent source beside Ego.

## Anima expresses Attention and Awareness

Anima consumes Attention and Awareness together with structural and interaction facts
and resolves their visual expression. Because Attention is a subset of Awareness, each
projected node occupies one of three semantic classes:

1. **Attended**: the node is in Attention and therefore also in Awareness. Anima
   expresses this as selected.
2. **Peripherally aware**: the node is in Awareness but not Attention, such as a
   relevant neighbor or a transient hover contribution.
3. **Unaware context**: the node is inside the projection but outside Awareness.

At the broadest level:

```text
Consciousness: subject is attended, peripherally aware, or unaware
Anima: resolve how that condition appears
Renderer: draw the resolved scene
```

Attended and peripherally aware subjects may receive different highlight, label
eligibility, emphasis, or other presentation. Unaware subjects may remain as dim
context. Projection—not Anima—decides whether a node is excluded from the
presentation. Anima may combine these semantic classes with independent facts such as
hover, topology, and Focus mode, but neither Anima nor the renderer infers Attention or
Awareness from styling.

Conscious state and presentation remain separate: changing an Anima theme cannot
change Attention or Awareness, and adding a node to either set does not itself
prescribe one specific color or animation.

## Vision reconciles viewpoint influences

Ego owns the user's viewpoint intention: the framing the user is trying to create by
panning, rotating, zooming, or otherwise directing the camera. Vision owns the resolved
camera target and the camera's actual realized pose.

Vision resolves Ego's intention together with exogenous and policy-imposed framing
requirements. For example, an active-note change may require Local Graph+ to follow a
new Attention subject even though Ego did not initiate that movement. Vision must not
misrepresent this automatic reframe as user intent, nor may Ego treat its intended
framing as authoritative camera truth.

Interaction state decides whether any conscious subject owns camera tracking. Overview
has no tracked subjects even when Attention or remembered Awareness is non-empty and
Anima lights those subjects. Cursor or touch anchors and the retained camera frame own
Overview navigation; subject motion cannot pull its camera. Constellation suggests its
centroid and Focus its subject as orbit, zoom, and motion-follow targets. Those defaults
do not make the camera a View-owned object. Ego holds committed session `visionIntent`
separately from transient hover will. On Focus exit it retains Vision's current focal
point: the next Constellation orbit/zoom stays there and node motion does not pull it.
Further View toggles and membership edits preserve that intent. A new Focus subject,
Overview constellation choice, or explicit Center/Fit establishes a new interest.
The actual point and pose remain geometry owned by Vision.
See the [interaction state contract](graph-engine-interaction-state-contract.md).

Vision presently owns the centroid and other spatial targets it derives from Awareness
membership plus current graph geometry. This is an implementation boundary, not a
claim that centroid calculation is intrinsically part of Vision; a later spatial or
geometry abstraction may assume that responsibility without changing the meaning of
Awareness.

```text
Ego viewpoint intent -----------┐
Exogenous framing influence ----+--> Vision target --> realized camera pose
Policy framing requirements ----┘
```

Intent can remain meaningful while it is being limited or temporarily displaced. The
exact reconciliation rules belong to Vision and the active experience contract rather
than to raw input handling.

## Experience policy is declarative

Experience policy declares capabilities and invariants but does not initiate actions.
Ego submits an intent to the state-transition layer, which evaluates it against the
active policy before any affected subsystem realizes it.

```text
Ego intent --> policy-governed transition --> accepted directive --> effectors
                                      |
                                      +--> accepted, adjusted, or rejected outcome
                                           returned to Ego
```

This permits Ego to form an intent that the active experience cannot realize without
granting Ego authority to violate the architecture. The returned outcome prevents Ego
from confusing its intention with realized state. Exogenous transitions are likewise
subject to applicable invariants even though they do not require Ego's approval.

Policy remains descriptive throughout this process. The transition layer acts; policy
supplies the rules under which that action is accepted, normalized, or rejected.

### Phase 3 endogenous routing

The interaction interpreter continues to translate raw pointer and keyboard mechanics
into semantic runtime commands. It now names selection intent `direct-attention` and
sends every interpreted command through Ego before `GraphCommander` dispatches a
directive to an effector.

```text
raw input --> interpreter --> Ego intent --> adjudication --> effector directive
```

Adjudication returns an accepted, adjusted, or rejected outcome. Phase 3 enforces the
existing active-document identity rule through this boundary, rejecting stale commands
before they reach effectors. Later phases will supply the neutral experience contract
that evaluates capabilities and state invariants at the same seam.

Within the interaction runtime, Attention now drives node toggling, Focus membership,
camera targeting, and selection-following drag behavior. Public and persisted V1
`selectedNodeIds` are written from realized Attention and remain available as a
compatibility representation. Programmatic session operations do not pass through Ego
because they originate outside Graph Engine's endogenous input path; they reconcile
directly into Consciousness and update the same compatibility mirror.

### Phase 4 neutral experience contract

Each Graph Engine session now receives an optional `GraphExperienceContractV1` through
the public session boundary. The default contract preserves the unrestricted engine
experience for existing consumers. The contract contains only host-neutral terms:

- permitted Overview, Explore, and Focus states;
- maximum Attention cardinality and overflow behavior;
- Attention-neighborhood depth contributed to Awareness;
- permitted endogenous capability families; and
- state-specific framing targets and centers.

`GraphPlusExperiencePolicyV1` remains the product-level source of Global and Local
meaning. `graphPlusEngineExperienceContractV1` translates it when Graph+ creates a
session. Local therefore becomes single-subject, Focus-only, one-neighborhood
Awareness without Graph Engine receiving a Local mode or Obsidian concept. Global
translates to unrestricted constellation Attention and the complete state set.

Ego's adjudication seam evaluates endogenous commands against this contract before
effectors run. A contract may accept an intent, reject it, or adjust it—for example,
reducing a multi-node selection to the interaction's intended subject and retaining
Focus. Consciousness independently applies the same Attention cap and expands realized
Attention through the declared graph-neighborhood depth, so programmatic compatibility
operations cannot bypass cardinality. Framing commands resolve their target from the
contract rather than from a hard-coded Global/Local branch.

### Phase 5 exogenous influence

The public session exposes `applyExternalInfluence` for host-translated conscious-state
truth. Its V1 input can replace Attention, optionally establish a Focus subject, and
request state-appropriate framing. The input names only graph subjects and neutral
framing behavior; consumers retain all host vocabulary and translation.

Graph Engine resolves the input against the same experience contract used for
endogenous transitions, then calls `Consciousness.receiveExogenous` directly. Ego is
not consulted and no endogenous `GraphIntentV1` is emitted. The compatibility
`selectedNodeIds` mirror, Focus state, Awareness expansion, Anima, and Vision framing
are updated from the realized result.

Local Graph+ uses this path when applying its canonical active-note subject. A new
active Markdown note replaces that Local presentation's Attention and Focus, recenters
its camera without fitting, and preserves canonical graph identity and existing positions. When
there is no active Markdown note, Local accepts empty exogenous Attention while the
full graph and recent session Memory remain available.

### Phase 6 explicit Anima consciousness classes

The frame-composition boundary now hands Anima the reconciled presentation-scoped
Consciousness snapshot separately from the Animus snapshot. Anima classifies every
projected node before assigning visual properties:

- Attention compiles to `attended`;
- Awareness outside Attention compiles to `peripherally-aware`; and
- projected membership outside Awareness compiles to `unaware-context`.

The shipped Anima module uses this classification for selection expression, awareness
emphasis, context visibility, outlines, and label raising. The final scene compiler
also derives selected color, outline, and label priority from the attended class. It no
longer reconstructs conscious state from `AnimusSnapshotV1.interaction.selectedNodeIds`.
That compatibility interaction fact remains available to older mechanics, but it is
not Anima's semantic source.

The deprecated `composeGraphRenderFrameV1()` boundary is retired from the runtime. Test fixtures may
translate a legacy selection-shaped caller into a temporary Consciousness snapshot,
but the compiler beneath it accepts only explicit Consciousness truth.

### Phase 7 projection and presentation ordering

Graph Engine now exposes distinct module-stage contracts:

- `GraphModuleProjectionStateV1` and `GraphModuleProjectionPatchV1` contain structural
  graph, layout, role, and display-membership facts only;
- Consciousness reconciles Attention and Awareness against node IDs in the completed
  projected document, never against the broader position map; and
- `GraphModulePresentationStateV1` is created afterward with required Consciousness,
  while `GraphModulePresentationPatchV1` can contribute only Anima-facing styling.

The module host applies explicit allowlists for both patch kinds rather than spreading
arbitrary module output into shared state. Projection hooks therefore cannot inject
colors, opacity, theme, or other presentation values, and presentation hooks cannot
replace documents, positions, roles, or projected membership. The separation is
enforced both by TypeScript contracts and at runtime for dynamically supplied modules.

The implemented order is:

```text
canonical document
    -> structural projection
    -> Consciousness reconciliation within projected membership
    -> Anima presentation contributions
    -> resolved render scene
```

### Graph+ policy translates to a host-neutral engine contract

Graph+ and Graph Engine operate at different policy levels:

- `GraphPlusExperiencePolicy` defines the product experience, including Global versus
  Local behavior, active-note following, projection scope, persistence, available
  modes, and Obsidian-facing operations.
- Graph+ translates the relevant constraints into a host-neutral Graph Engine
  experience contract, including Attention cardinality, Attention-to-Awareness
  expansion, permitted interactions, and framing constraints.
- Consciousness, Vision, and the policy-governed transition layer consume only the
  neutral engine contract. They do not import or interpret
  `GraphPlusExperiencePolicy`, Local Graph+, or Obsidian concepts.

For example, Local policy may declare that the presentation follows Obsidian's active
note and uses Focus. Graph Engine receives only the resulting neutral requirements:
Attention contains at most one node, a valid root requires one attended node, this
neighborhood expansion rule applies, and these framing constraints govern Vision.

## Outbound intent remains host-neutral

Ego may initiate an operation whose realization belongs to the consumer, but neither
Ego nor the rest of Graph Engine names Obsidian concepts. It emits a semantic intent
against a graph subject. Graph+ applies its experience policy, translates the subject
and operation into vault meaning, and asks `ObsidianGraphBridge` to perform the
Obsidian-specific effect.

```text
Ego: rename graph subject
  --> Graph+ policy and document translation
  --> ObsidianGraphBridge: rename vault file
  --> Obsidian
```

The bridge reports the operation's result back through Graph+, but that result does not
independently mutate graph truth. Graph+ waits for the corresponding canonical inbound
push from Obsidian. `ObsidianGraphBridge` delivers that change to the shared vault
model, `GraphPlusApplication` reconciles it once, and the application distributes the
new canonical snapshot to its presentations.

```text
outbound intent --> bridge performs operation --> Obsidian
                                                  |
canonical vault model <-- bridge receives event <-+
          |
GraphPlusApplication --> all affected presentations
```

Presentations do not subscribe to Obsidian independently and the outbound command path
does not optimistically assert canonical success. A presentation may expose temporary
pending feedback, but Global and Local converge only from the same received truth.
This keeps pane, file, vault-path, and Obsidian API knowledge outside Graph Engine while
avoiding duplicate application and cross-presentation drift.

## Runtime migration checklist

The completed runtime migration preserves behavior through these phases:

1. Introduce presentation-scoped `Consciousness`, `Attention`, and membership-only
   `Awareness` domain values.
2. Reduce `Ego` to the endogenous intent facet held by Consciousness; route interpreted
   click, hover, drag, keyboard, context-menu, and camera actions through it.
3. Make Attention the semantic source of rendered selection. Retain
   `selectedNodeIds` only at compatibility boundaries until public and persisted
   contracts can migrate safely.
4. Move Awareness centroid and other spatial derivation out of Awareness and into
   Vision temporarily.
5. Define the neutral Graph Engine experience contract and translate
   `GraphPlusExperiencePolicy` into it rather than importing Graph+ concepts into the
   engine.
6. Add an exogenous Consciousness input that bypasses Ego while remaining subject to
   the neutral experience contract.
7. Make Anima consume Attention and Awareness explicitly and compile the attended,
   peripherally aware, and unaware-context classes.
8. Keep graph projection upstream of Consciousness and presentation styling downstream
   of it.
9. Move Obsidian subscription and outbound host operations behind one
   `ObsidianGraphBridge`; reconcile canonical vault truth once in
   `GraphPlusApplication` and distribute it to presentation sessions.
10. Keep Local single-click as endogenous presentation Attention plus pane-local camera Focus,
    and implement double-click as an outbound reveal whose canonical active-note event
    enters through the shared bridge.
11. Add regression coverage for shared Global/Local world geometry, separate viewport
    state, Local Attention cardinality, Attention-to-Awareness expansion, canonical
    event fan-out, and the absence of duplicate outbound/inbound mutation.

Presentation rendering sessions remain separate where a surface experience must be
separate: camera, filters, View, Attention, Focus, Memory, hover, UI, and lifecycle.
Canonical graph data, positions, and pins belong to the one application world.
