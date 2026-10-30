# `@graph-plus/graph-engine-client`

This is the self-contained compile-time client for the graph-engine V1 provider hosted
by the graph-engine Obsidian plugin. It contains public contracts, validation helpers, the
Workspace Events client, and the standard unavailable surface. It does not contain a
renderer or graph-engine provider runtime.

The `src` directory is generated from graph-engine's reviewed public boundary:

```sh
npm run build:client
```

External consumers may install a packed copy or vendor this directory. They must import
only `@graph-plus/graph-engine-client` and obtain the runtime through Workspace Events.

Protocol version: 1

Artifact version: 2.0.5

The artifact version is not a minimum graph-engine version and does not need to match
the installed provider. Runtime compatibility is negotiated by protocol and requested
capabilities. Existing V1 consumers may remain pinned to an older V1 artifact; they
only need to update when adopting a new public API or a relevant client-side fix.

V1.1 adds optional engine-owned session UI configuration, lease-scoped semantic node
actions, consumer/profile UI policy, and constrained 2D/3D profile settings. These are
additive capabilities: consumers using the original V1 fields remain source-compatible.

V1.2 adds optional rolling performance distributions, work counters, and a measurement
reset method while retaining protocol version 1. Runtime performance corrections do not
change consumer graph, interaction, persistence, or module-policy semantics.

V1.3 adds neutral node-region document definitions and the stock region-boundary UI
control while preserving canonical node and edge identity.

V1.4 adds the stock topology-weighting mode control. Effective affinity, hub
discounting, spring mapping, and component packing remain private provider behavior.

V1.5 adds the public Linear build-out direction contract. Consumers may request the
shipped `linear-layout` capability and choose `up`, `down`, `left`, `right`, `in`, or
`out`; depth-axis directions require a 3D profile.

V1.6 and V1.7 add optional presentation, camera-fit, input, and session-UI fields while
retaining protocol V1. Provider-side physics, rendering, performance, and lifecycle
improvements remain available to older V1 clients without an artifact refresh.

## License

The client is distributed under the Mozilla Public License 2.0, matching its source
in Graph+. The complete license is included in [LICENSE](LICENSE), including packed
copies of this package.

The shipped force layout offers the `node-attachment-2d` capability. Define
`attachment: { count: 4, stiffness: 'firm' }` directly on a node. Missing attachment
or count 1 is unrestricted. The quality travels with document exports and node
patches. See [the node attachment guide](../../docs/connection-angles-2d.md).

The testing branch also advertises `node-attachment-slots-2d`: finite-capacity,
stable occupants, releasable spring bindings, hard binding locks, and independent
free/spring/locked quaternion orientation. Request that capability when adopting
these features. Runtime slot occupants and phase live in force-layout module
state; save full view/world state to preserve them across sessions.

For explicit link placement, request `edge-attachment-assignments-2d` and set
`edge.attachment.sourceSlot` and/or `targetSlot` (zero-based). Omission is automatic,
null is explicitly unbound, and numeric assignments persist until edited. These
are stored on edges and changed through ordinary edge patches. Runtime snapshots
include binding `edgeIds` and per-endpoint request statuses.

## Attachment release candidate

`rc/attachments` includes opt-in 2D and 3D attachment constraints. Request
`GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1` and
`GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1` for spatial scenes.
`graphAttachmentSlotDirection3DV1(count, slot)` returns the deterministic local
unit direction addressed by an index. Use the provider and client from the same
RC commit; package labels alone do not identify this unpublished candidate.
See [the RC handoff](../../docs/rc-attachments.md) for adoption and saved-state rules.

Current RC updates use `setGraph` / `patchGraph` and return an `applied` result.
Request `GRAPH_UPDATE_API_CAPABILITY_V1` and
`GRAPH_ATTACHMENT_ASSIGNMENT_POLICY_CAPABILITY_V1` when adopting these contracts.
Attachments require `enabled: true`; enabled nodes default to loose assignment.
Strict policies reject unsuccessful graph edits atomically. See
[the policy example](../../docs/attachment-policy.md).
