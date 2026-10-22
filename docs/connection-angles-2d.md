# Node-owned attachment symmetry

Attachment is a quality of a graph node, stored in the graph document. It is not
an inherited graph-wide layout policy. A node without `attachment`, with omitted
`count`, or with `count: 1` is freely attaching. Nothing is enabled by default.

```ts
import type { GraphNodeV1 } from '@graph-plus/graph-engine-client';

const hub: GraphNodeV1 = {
  id: 'hub',
  attachment: { count: 4, openingDegrees: 10, stiffness: 'firm' },
};
const unrestricted: GraphNodeV1 = { id: 'unrestricted' };
```

In 2D, the node's preferred directions repeat every `360 / count` degrees. The
whole pattern turns freely to fit its neighbors; it has no fixed up direction or
camera dependency. Multiple neighbors can share a direction. Angular spring
forces act alongside the existing link-length springs.

## Parameters

| Field | Meaning |
| --- | --- |
| `count` | Positive safe whole number, default 1 (unrestricted). Two gives 180° spacing, three 120°, four 90°, six 60°. |
| `openingDegrees` | Full angular width of each zone, from zero through `360 / count`. Defaults to zero. |
| `stiffness` | Number 0–1; defaults to `soft` for an active attachment. Presets: `off` = 0, `soft` = 0.08, `firm` = 0.3, `stiff` = 0.8. |

Zero opening pulls toward exact repeated directions. Within a nonzero opening,
there is no angular restoring force. Opening equal to spacing permits every
angle. Zero stiffness releases the spring regardless of count. The stiff preset
is still a finite spring, not a hard lock. Existing velocity damping controls
settling.

## Leased plugins, saving, and live edits

Request `GRAPH_NODE_ATTACHMENT_CAPABILITY_V1` (`node-attachment-2d`) when acquiring
a lease, and enable the shipped force layout in the consumer profile. Define
attachment directly on nodes supplied to `createSession`. There is no separate
attachment setting or graph-wide default to install.

Attachment is validated and copied by the document contract and builder. Node
creation, replacement, patches, export, JSON storage, and Graph+ document
checkpoints carry the quality with the node. Old documents without attachment
continue to load unrestricted. Updated clients are required to understand the
new optional field; negotiate the capability before sending it to a provider.

To commit a new count, use the existing node patch API. Preserve the node's other
properties when replacing it:

```ts
const document = await session.exportDocument();
const node = document.nodes.find(node => node.id === 'hub')!;
await session.applyPatch({
  schemaVersion: 1,
  patchId: 'hub-attachment-change',
  baseRevision: document.revision,
  operations: [{
    type: 'replace-node',
    node: { ...node, attachment: { ...node.attachment, count: 6 } },
  }],
});
```

Setting count to 1 or replacing the node without attachment restores unrestricted
behavior. Consumers that regenerate documents must preserve authored node
qualities when rebuilding nodes. View/world position snapshots do not duplicate
attachment: the graph document is authoritative.

## Animation

Choreography modules, including future Anima controls, can return per-node targets:

```ts
return {
  motionTargets: {
    nodeAttachments: { hub: { count: 6, stiffness: 'soft' } },
  },
};
```

A target changes that node's effective attachment quality for the tick. Null
means freely attaching; omitting a node returns control to its saved quality.
Targets do not overwrite the document. Use a document patch when the change is
intended to persist. Multiple choreography modules merge their targets by node ID;
a later target wins for that node. Invalid targets fall back to the saved quality.
This is an animation hook, not an Anima editor UI.

## Simulation and future 3D support

Only nodes with active attachment qualities produce angular forces. Each owner
uses its distinct document-linked neighbors; parallel and reciprocal edges count
once. Self-links, coincident endpoints, and implicit region membership without a
document edge supply no direction. New neighbors respond automatically.

A node with fewer than two distinct noncoincident neighbors produces no angular
force because the freely turning pattern has no relative spacing to enforce.
Pinned and dragged nodes retain their position authority. Competing preferences,
collisions, pins, and other forces may reach a compromise instead of an exact
angular solution.

The stored count is dimension-independent. The current solver applies it in 2D
only. 3D documents preserve the same node quality without applying angular forces;
spherical direction generation is reserved for a later implementation. There are
no stored plane counts or hard-coded 3D axes to migrate later.
