# Graph+ application architecture

Status: Implemented architecture

Date: 2026-09-28

Agency migration note: this document describes the implemented unified application
shell. The target for Consciousness, Ego, Attention, Awareness, and Local click
semantics is defined in
[Graph Engine agency and Awareness ontology](graph-engine-agency-awareness-ontology.md).
Where the documents differ on those target semantics, the ontology document takes
precedence. Phases 2 through 10 of that migration are implemented.

## Purpose

Graph+ is one application with two presentation modes. Global and Local are not
separate consumers and must not independently interpret the vault, lifecycle, or
interaction model.

The application is divided into three ownership layers:

1. The Obsidian host owns panes, plugin lifecycle, preview surfaces, saved leaf state,
   Graph Engine leases, and one `ObsidianGraphBridge` for inbound events and outbound
   host operations.
2. The shared `GraphPlusApplicationV1` owns canonical vault reconciliation and the
   graph world: document identity, node coordinates, and explicit pins. Presentation
   sessions own their viewport state: camera, View, Attention/Focus, hover, and filters.
3. Graph Engine owns Ego, Awareness, Vision, interaction transitions, layout, Anima,
   rendering, and the public session contract.

Dependencies point inward through these boundaries. Graph Engine does not import
Graph+ or Obsidian, and Graph+ reaches Graph Engine only through its public contracts.

## Conscious and unconscious routes

The boundary is the Graph+ application. Activity within Graph+ belongs to
consciousness; activity originating outside the application is unconscious input.
Automatic internal activity does not become unconscious merely because it does
not require a deliberate decision. Layout, rendering, Reflex, and transition
progress retain their internal owners.

| Origin and responsibility | Route |
| --- | --- |
| Deliberate graph engagement from canvas, keyboard, or View controls | Input/control port → Ego → owned Judgement → Will → realization |
| Internal automatic activity | Existing conscious owner: Reflex, Memory/Reaction, layout, Vision, or Anima |
| Vault edits or active-note changes in Obsidian | Obsidian bridge → `GraphPlusApplication.receiveUnconsciousActivity` → application policy/projection → external influence |
| Show in Graph+ initiated outside Graph+ | Application reveal workflow → external Attention/Focus installation → explicit framing |

`receiveHostEvent` remains a compatibility alias for the unconscious ingress.
Ego's initial Judgement accepts every valid intention. Received outside reality
does not need Ego's permission. Once translated and received, it can become
conscious Attention or Memory. The recent-note trail is an example: its origin is
outside activity, while its remembered constellations are inside consciousness.

Outbound note navigation is an effect of an admitted conscious action. The later
Obsidian active-note event is a separate received input; the outbound request must
not optimistically declare that external state has already changed.

## Canonical model and projections

The plugin owns one `GraphPlusApplicationV1` and one `GraphPlusVaultModelV1` beneath
it. While at least one Graph+ presentation is open, vault changes are debounced into
one canonical reconciliation and the resulting document, note/tag lookup, and search
index are fanned out to every open presentation. With no presentations, changes only
mark the model stale and start no vault work. Concurrent opens share one reconciliation;
the first open after a closed interval refreshes canonical truth before relying on it.

`projectGraphPlusExperienceDocumentV1` supplies the same canonical full-vault document
to Global and Local. Focus and Awareness determine what is visually emphasized; Local
does not manufacture a smaller document, a second node order, or a second layout.

Note identity is deliberately the normalized vault-relative path (`note:<path>`).
Renaming or moving a file therefore reconciles as removal of the old node plus arrival
of a new node; unrelated nodes and their saved positions retain their IDs. Graph+ does
not write opaque identity metadata into notes or maintain a fallible rename ledger.

## Experience policies

| Concern | Global | Local |
| --- | --- | --- |
| Document scope | Full vault | The same full vault |
| Subject inputs | Ego | Ego and active note |
| Initial View | Overview | Focus on the active note |
| Interaction states | Overview, Constellation, Focus | Focus only |
| Camera | Pane-local | Pane-local |
| Persistence | Owns the vault checkpoint | Reuses the shared graph world; its viewport state is ephemeral |
| Active-note following | No | Yes |
| Canonical root arrival | None | The root enters this Local viewport's Attention and Focus; recent subjects remain in Memory |

The shared `GraphPlusSessionV1` remembers the three most recently activated distinct
notes before the active note through Ego/Memory. Presentations receive that trail as remembered subjects,
not as user-authored Attention. Anima shows connected remembered groups as typed
Memory constellations with a separate theme color faded to 100%, 50%, and 25% by
recency; choosing one creates deliberate
membership through the ordinary Ego plan.

The Local root is supplied by canonical active-note truth. A single click can direct
Attention and Focus; focusing a different note requests an outbound note reveal.
Canonical arrival replaces the Local root and establishes only that subject in
Attention. The recent trail remains Memory and does not become selected merely to
stay visible. A double-click can additionally invoke the registered Open note action.
Canonical graph truth, pins, and node positions are fanned out to every presentation.
Each presentation keeps its own filters, selection, Focus, View, hover, and camera.
Thus a Global pane can remain in Overview while a Local pane follows the active note
in Focus without either pane rewriting the other's experience.

Graph+ translates this product policy into a host-neutral
`GraphExperienceContractV1` when it creates a Graph Engine session. The engine sees
state permissions, Attention cardinality, interaction
capabilities, and framing constraints. It does not see the Global/Local mode, active
notes, vaults, or Obsidian. Both modes permit Overview, Constellation, and Focus.

Canonical active-note changes enter the engine through `applyExternalInfluence` after
Graph+ translates the note into a graph subject. This path bypasses Ego and does not
emit a user-intent event, but it remains constrained by the neutral experience
contract. The absence of an active Markdown note clears the Local root, producing empty
Attention and no Focus subject without removing nodes from the shared graph.

## Host surfaces and compatibility

`GraphPlusObsidianViewV1` is the shared Obsidian pane host. The `graph-plus` and
`graph-plus-local` view classes remain only as small identity shells so existing
commands and saved Obsidian workspaces continue to resolve. Both ask the same
`GraphPlusApplicationV1` to create a presentation with a different experience mode.

Views do not subscribe to Obsidian. One `ObsidianGraphBridgeV1` owns vault, metadata,
active-leaf, and file-open subscriptions along with outbound note and tag operations.
It delivers neutral host events to the application. The application coalesces those
invalidations while Graph+ is open and applies the same refreshed snapshot to all
presentation sessions. When Graph+ is closed it retains only the dirty marker until
the next open. Active-note truth is distributed only to policies that follow it and
never triggers a vault scan by itself.

Each pane owns an independent Graph Engine rendering session because each DOM surface
needs its own viewport. The application elects exactly one open presentation to advance
layout and distributes that world geometry and layout-module state to the other sessions through
`GraphWorldStateV1`. Installing world state does not install viewport state. Local
filters use render scope, so hiding nodes in one pane cannot reflow the shared layout.
When known coordinates exist, Local starts from them with force settled and performs
one initial Focus-neighborhood fit.

## Regression contract

Automated checks must prove that:

- Global and Local are created beneath the same application and host implementation;
- both modes use the shared canonical vault model;
- one Obsidian bridge owns every canonical subscription and outbound host operation;
- vault invalidation reconciles once while any presentation is open, performs no work
  while all presentations are closed, and refreshes once on the next open;
- application disposal is terminal and late host events cannot restart work;
- both modes receive the same canonical document identity, nodes, and edges;
- Local Focus changes can request host navigation without independently declaring canonical truth;
- Local double-click requests reveal without optimistically broadcasting canonical truth;
- Local canonical arrival focuses only its root while Memory remains a distinct constellation source;
- pins and node positions fan out across presentations without copying viewport state;
- filters, Attention, Focus, View, and camera remain local to each presentation;
- exactly one presentation advances layout for the shared graph world;
- Local loads existing full-graph coordinates, keeps force settled, and performs one
  initial Focus-neighborhood fit;
- Global retains full-vault checkpoint behavior; and
- Graph+ imports only Graph Engine contracts and its public client boundary.

The application-level fan-out regression mounts Global plus two Local presentations.
It proves that pins and coordinates are shared while filter and Focus changes remain
local, that exactly one surface advances layout, that a bridge reveal performs one
outbound operation without an optimistic root mutation, and that canonical active-note
events reach each Local policy once without modifying Global. Engine-level regressions separately enforce
source-typed constellation resolution, Memory color/visibility, and
Attention-to-Awareness neighborhood expansion.

Historical V1.7.1 and V1.9 documents describe the earlier two-consumer boundary.
This document supersedes that ownership model while preserving their user-visible
view IDs and intentionally separate cameras.

## Deferred Mind Map

As of 2026-10-03, Graph+ locks the `form` module off, including restored enabled
overrides. Mind Map activation, its context menu, Quick Settings controls, and relation
controls are commented out for later work. The neutral engine module and saved Form
configuration remain available; dimensions and region controls remain active.

## Empty composition derivation

Empty active Attention is valid. The canonical document passes through the existing
experience projection, structural filtering, layout, and Anima scene assembly.
Memory can be visible while active composition is empty. With no surviving objects,
the assembled canvas is empty; no extra explanatory UI is required.
