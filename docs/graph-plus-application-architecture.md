# Graph+ application architecture

Status: Implemented architecture

Date: 2026-09-28

## Purpose

Graph+ is one application with two presentation modes. Global and Local are not
separate consumers and must not independently interpret the vault, lifecycle, or
interaction model.

The application is divided into three ownership layers:

1. The Obsidian host owns panes, plugin lifecycle, vault events, active-file events,
   preview surfaces, saved leaf state, and Graph Engine leases.
2. The Graph+ application layer owns the canonical vault model, experience policy,
   document projection, navigation workflow, and checkpoint choice.
3. Graph Engine owns Ego, Awareness, Vision, interaction transitions, layout, Anima,
   rendering, and the public session contract.

Dependencies point inward through these boundaries. Graph Engine does not import
Graph+ or Obsidian, and Graph+ reaches Graph Engine only through its public contracts.

## Canonical model and projections

The plugin owns one `GraphPlusVaultModelV1`. It reads and adapts the vault once for
concurrent work and exposes one canonical document, note/tag lookup, and search index.
Every open Graph+ presentation receives snapshots from this model.

`projectGraphPlusExperienceDocumentV1` derives the document presented by a policy:

- Global presents the canonical full-vault document.
- Local presents a depth-bounded neighborhood rooted in the active Markdown note.

Local projection is derived state. It never becomes a second canonical graph and it
never writes to the Global checkpoint.

## Experience policies

| Concern | Global | Local |
| --- | --- | --- |
| Document scope | Full vault | Root neighborhood |
| Subject owner | User | Active note |
| Interaction states | Overview, Explore, Focus | Focus only |
| Persistence | Vault checkpoint | Ephemeral session; leaf depth is host state |
| Active-note following | No | Yes |
| Root invariant | None | Root selected, focused, and pinned |

The Local root remains the active note. Selecting a neighbor may open that note; once
Obsidian makes it active, Local follows it as the new root. Graph input cannot silently
change the Local subject while a different note remains active.

## Host surfaces and compatibility

`GraphPlusObsidianViewV1` is the shared Obsidian host. The `graph-plus` and
`graph-plus-local` view classes remain only as small identity shells so existing
commands and saved Obsidian workspaces continue to resolve. Both construct the same
`GraphPlusApplicationV1` with a different experience mode.

Each pane still owns an independent Graph Engine session, camera, and layout. Sharing
the application model means shared vault truth, not shared presentation state.

## Regression contract

Automated checks must prove that:

- Global and Local instantiate the same application and host implementation;
- both modes use the shared canonical vault model;
- document shaping passes through the experience projection boundary;
- Local remains rooted Focus after ordinary graph selection;
- Global retains full-vault checkpoint behavior; and
- Graph+ imports only Graph Engine contracts and its public client boundary.

Historical V1.7.1 and V1.9 documents describe the earlier two-consumer boundary.
This document supersedes that ownership model while preserving their user-visible
view IDs and the intentional separation of Global and Local session state.
