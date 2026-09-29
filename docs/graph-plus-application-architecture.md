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
2. The shared `GraphPlusApplicationV1` owns canonical vault reconciliation and event
   fan-out. Its presentation sessions own experience policy, document projection,
   navigation workflow, and checkpoint choice.
3. Graph Engine owns Ego, Awareness, Vision, interaction transitions, layout, Anima,
   rendering, and the public session contract.

Dependencies point inward through these boundaries. Graph Engine does not import
Graph+ or Obsidian, and Graph+ reaches Graph Engine only through its public contracts.

## Canonical model and projections

The plugin owns one `GraphPlusApplicationV1` and one `GraphPlusVaultModelV1` beneath
it. The application reads and adapts the vault once per canonical change and fans the
resulting document, note/tag lookup, and search index out to every open presentation.

`projectGraphPlusExperienceDocumentV1` derives the document presented by a policy:

- Global presents the canonical full-vault document.
- Local presents a depth-bounded neighborhood rooted in its current focal subject.

Local projection is derived state. It never becomes a second canonical graph and it
never writes to the Global checkpoint.

## Experience policies

| Concern | Global | Local |
| --- | --- | --- |
| Document scope | Full vault | Root neighborhood |
| Subject inputs | Ego | Ego and active note |
| Interaction states | Overview, Explore, Focus | Focus only |
| Persistence | Vault checkpoint | Ephemeral session; leaf depth is host state |
| Active-note following | No | Yes |
| Canonical root arrival | None | Root selected, focused, and pinned |

The Local root is supplied by canonical active-note truth. A single click directs
Attention and camera Focus within the existing projected constellation without
changing that root or Obsidian's active note. A double-click additionally requests an
outbound note reveal. Once Obsidian publishes the resulting active-note event, the
shared application replaces the root in every Local presentation. Thus endogenous
intent may direct one presentation while later exogenous canonical truth can replace
it across all Local presentations.

Graph+ translates this product policy into a host-neutral
`GraphExperienceContractV1` when it creates a Graph Engine session. The engine sees
state permissions, Attention cardinality, Awareness-neighborhood depth, interaction
capabilities, and framing constraints. It does not see the Global/Local mode, active
notes, vaults, or Obsidian. Local currently translates to Focus-only Attention capped
at one subject with one neighborhood step of peripheral Awareness; Global retains
unrestricted constellation Attention.

Canonical active-note changes enter the engine through `applyExternalInfluence` after
Graph+ translates the note into a graph subject. This path bypasses Ego and does not
emit a user-intent event, but it remains constrained by the neutral experience
contract. The absence of an active Markdown note clears the Local root, producing an
empty projection with empty Attention and no Focus subject.

## Host surfaces and compatibility

`GraphPlusObsidianViewV1` is the shared Obsidian pane host. The `graph-plus` and
`graph-plus-local` view classes remain only as small identity shells so existing
commands and saved Obsidian workspaces continue to resolve. Both ask the same
`GraphPlusApplicationV1` to create a presentation with a different experience mode.

Views do not subscribe to Obsidian. One `ObsidianGraphBridgeV1` owns vault, metadata,
active-leaf, and file-open subscriptions along with outbound note and tag operations.
It delivers neutral host events to the application, which coalesces a canonical vault
refresh and applies the same snapshot to all presentation sessions. Active-note truth
is distributed only to policies that follow it.

Each pane still owns an independent Graph Engine session, camera, and layout. Sharing
the application model means shared vault truth, not shared presentation state.

## Regression contract

Automated checks must prove that:

- Global and Local are created beneath the same application and host implementation;
- both modes use the shared canonical vault model;
- one Obsidian bridge owns every canonical subscription and outbound host operation;
- one canonical reconciliation is fanned out to all attached presentations;
- document shaping passes through the experience projection boundary;
- Local single-click preserves projection while changing Attention and camera Focus;
- Local double-click requests reveal without optimistically broadcasting canonical truth;
- Local remains rooted Focus after ordinary graph selection;
- Global retains full-vault checkpoint behavior; and
- Graph+ imports only Graph Engine contracts and its public client boundary.

The application-level fan-out regression mounts Global plus two Local presentations.
It proves that one Local presentation can direct its own Consciousness without
changing its sibling, that a bridge reveal performs one outbound operation without an
optimistic root mutation, that the received canonical event reaches each Local once,
that Global Consciousness is untouched, and that canonical absence blanks every Local
presentation. Engine-level regressions separately enforce Local's one-subject
Attention limit and Attention-to-Awareness neighborhood expansion.

Historical V1.7.1 and V1.9 documents describe the earlier two-consumer boundary.
This document supersedes that ownership model while preserving their user-visible
view IDs and the intentional separation of Global and Local session state.
