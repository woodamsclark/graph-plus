# Node-owned attachment slots and orientation (2D and 3D)

Attachment is a quality stored on each graph node. Missing attachment, omitted
count, or count 1 means freely attaching. There is no graph-wide attachment default.

```ts
import { graphAttachmentRotation2DV1, type GraphNodeV1 } from '@graph-plus/graph-engine-client';

const hub: GraphNodeV1 = {
  id: 'hub',
  attachment: {
    count: 8,
    rigidity: 'locked',
    orientation: { mode: 'locked', rotation: graphAttachmentRotation2DV1(0) },
  },
};
```

This node offers eight slots 45° apart. Each slot holds one distinct neighboring
node; extra connections float freely. Parallel/reciprocal edges to the same
neighbor count once. Slot assignments persist while the link exists, instead of
being reassigned to the nearest direction on every frame.

## Binding strength and pattern orientation

These are independent controls:

| Control | Values and behavior |
| --- | --- |
| `count` | Positive safe whole number; 1 is off. In 2D, spacing is `360 / count` degrees. |
| `rigidity` | `spring` (default) permits release and recapture; `locked` keeps the occupant and its angular direction until explicitly unlocked or reconfigured. |
| `stiffness` | Spring binding strength from 0–1, default `soft`. Presets: `off` = 0, `soft` = 0.08, `firm` = 0.3, `stiff` = 0.8. Higher strength increases restoring force and the displacement required to escape. |
| `openingDegrees` | Full width of a spring's force-free angular zone, default zero, maximum `360 / count`. Hard locks enforce the slot direction exactly, regardless of this width. |
| `orientation` | Omitted or `{ mode: 'free' }` lets the whole pattern turn. `spring` attracts its orientation to a declared rotation; `locked` anchors it to that rotation. |

A spring occupant can leave its slot when stretched beyond its release threshold.
Capture uses a smaller threshold, preventing rapid capture/release flicker. A
released connection cannot recapture in the same tick, but may later capture an
available slot, including a different one. Occupied slots do not evict their
neighbors when a closer newcomer appears.

A locked binding never releases because of force, angular displacement, or drag.
It maintains its angular relation within 1e-6 radians. Distance remains free;
ordinary link-length forces still apply. Changing rigidity to spring permits
release. Count 1, zero stiffness in spring mode, removing attachment, or removing
the link releases its bindings. Changing count explicitly reconfigures the slots.
Locked mode ignores spring stiffness, including zero.

A locked binding with free pattern orientation preserves its slot while the
whole pattern rotates. A locked pattern orientation fixes the directions, but
its occupants can still release if their binding rigidity is spring.

```ts
attachment: {
  count: 4,
  stiffness: 'firm',
  orientation: {
    mode: 'spring',
    rotation: graphAttachmentRotation2DV1(30),
    stiffness: 0.2, // orientation stiffness is separate from binding strength
  },
}
```

## Generic orientation and coordinates

Rotation is stored as a unit quaternion `{ x, y, z, w }`, suitable for both 2D and
future 3D patterns. The 2D helper takes counterclockwise degrees from world +X.
The 3D solver uses the full quaternion. The 2D solver uses the quaternion's Z-axis twist; planar rotations have x = y = 0.
A quaternion with no Z twist uses zero twist in 2D. The full value survives saving
and exporting, including components reserved for future spatial orientation.

Orientation is in graph/world coordinates. Camera motion does not change it.
A consumer requiring screen alignment must translate its screen heading to world
orientation using the controlling camera. Two differently rotated views do not
independently dictate one shared physical pattern.

## Admission and incompatible moves

New locked bindings are admitted only if geometric projection can satisfy them
alongside retained locks and current pins. Otherwise that endpoint stays unbound;
it does not displace an occupant or break an existing lock. Admission is stable
and deterministic by owner ID, proximity, and neighbor ID. A conservative failed
projection leaves a request unbound even if a different geometric solution might
exist; the solver does not claim a global feasibility proof.

After ordinary layout forces, accepted locks project positions back to permitted
rays. If a pinned/dragged/external move cannot coexist with those locks, affected
positions return to their last feasible geometry. Locks constrain interaction;
pinning does not grant permission to break them. An incompatible orientation
change can likewise be blocked, preserving the last feasible pose. The diagnostics
expose `rejectedAttachmentBindings` and `blockedAttachmentMoves`; these are not
fatal session errors. Unbound neighbors retain ordinary layout behavior.

## Leased plugins and live edits

Request `GRAPH_NODE_ATTACHMENT_SLOTS_CAPABILITY_V1` (`node-attachment-slots-2d`) in
both the lease request and consumer profile, and enable the shipped force layout.
For 3D request the spatial capabilities described below. The earlier `node-attachment-2d` capability is also advertised, but only the slots
capability guarantees this binding/lock behavior. Use the regenerated client
contract from this testing branch; no stable package release has been published.

Define attachment directly on document nodes. To commit a persistent change, use
the existing node replacement API while preserving the node's other fields:

```ts
const document = await session.exportDocument();
const node = document.nodes.find(node => node.id === 'hub')!;
await session.applyPatch({
  schemaVersion: 1, patchId: 'hub-attachment-change', baseRevision: document.revision,
  operations: [{ type: 'replace-node', node: {
    ...node, attachment: { ...node.attachment, count: 6 },
  } }],
});
```

Node declarations, including nested orientation, are validated and cloned by
value through creation, patches, export, JSON storage, and document checkpoints.
Old documents without attachment remain unrestricted. Consumers that regenerate
documents must carry authored node qualities forward.

## Runtime occupancy, saving, and animation

Occupants and the current freely turning phase are runtime layout state. They
are exported under `attachmentSlots` in the force-layout module snapshot, as a
versioned `GraphAttachmentSlotsStateV1`. Persist the document plus view/world state
to preserve assignments across sessions. `exportWorldState()` includes layout
module state; `exportWorldPositions()` intentionally does not. A document alone
preserves declarations but does not preserve which neighbor occupies each slot.
Invalid or obsolete saved occupants are discarded or revalidated against the
current graph and declarations. Graph+ view checkpoints retain module state.

Diagnostics expose the current `attachmentSlots` snapshot so a testing consumer
can inspect occupied slots and infer overflow. They also expose admission and
blocked-movement counters.

Choreography modules, including future Anima controls, can temporarily replace
specific node qualities without overwriting saved declarations:

```ts
return { motionTargets: { nodeAttachments: {
  hub: { count: 6, stiffness: 'firm', orientation: { mode: 'free' } },
} } };
```

Null releases that node for the tick; omission returns control to its saved
quality. Changing count is an explicit slot reconfiguration. Persistent edits
use document patches. This provides an animation hook, not an Anima editor UI.

## 3D

Count, rigidity, and quaternion orientation are dimension-independent stored
qualities. The RC supports spherical slot generation, angular springs, and hard geometric
locks in 3D. Request `node-attachment-slots-3d` and, for explicit edge indices,
`edge-attachment-assignments-3d`. Use `graphAttachmentSlotDirection3DV1(count, slot)`
from the matching client to inspect stable local directions. Full quaternion
orientation and spatial occupancy are saved in dimension-tagged snapshots. See
[the RC handoff](rc-attachments.md) for pattern shapes, adoption, and validation.

## Explicit per-link slot assignments

A downstream plugin can persist which position a specific edge should use at
both endpoints. Request `GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_CAPABILITY_V1`
(`edge-attachment-assignments-2d`) when adopting this API.

```ts
const edge = {
  id: 'hub-command',
  sourceId: 'hub',
  targetId: 'command',
  attachment: {
    sourceSlot: 3, // zero-based slot on hub's pattern
    targetSlot: null, // leave the command endpoint unbound
  },
};
```

Source and target refer to the stored endpoint IDs, including for undirected
links. Slot indices start at zero and keep their meaning when a free pattern
rotates: slot 3 is an identity in that pattern, not a fixed screen direction.
Use locked world orientation when an application needs a stable heading too.

An explicit assignment remains until changed. Its slot is reserved for that
neighbor. A spring binding can stretch and yields according to its stiffness,
but cannot jump into another slot while this explicit assignment remains. A hard
binding still enforces its direction geometrically. Automatic links retain the
release/recapture behavior described above.

To reassign a link, submit a `replace-edge` operation in a normal document patch,
preserving its other fields:

```ts
const document = await session.exportDocument();
const edge = document.edges.find(edge => edge.id === 'hub-command')!;
await session.applyPatch({
  schemaVersion: 1, patchId: 'assign-command-position', baseRevision: document.revision,
  operations: [{ type: 'replace-edge', edge: {
    ...edge, attachment: { ...edge.attachment, sourceSlot: 2 },
  } }],
});
```

Changing a request explicitly reconfigures that endpoint, including a previously
locked assignment. It releases that connection's previous slot before trying the
new one. An occupied or incompatible request stays unbound; it does not evict an
existing occupant or silently choose another position. A vacant requested slot
is reserved against new automatic captures. An out-of-range slot stays unbound
until a later count change makes it valid. A request does not enable an otherwise
unrestricted node.

Omit an endpoint field to return it to automatic assignment, retaining its
current binding until the normal release rules permit movement. Set it to null
to explicitly release that endpoint and prevent automatic recapture. Removing the
whole edge `attachment` object returns both endpoints to automatic behavior.

Declarations are validated, cloned, patched, exported, and saved as part of the
edge in the graph document. Runtime slot snapshots also retain the controlling
link for an explicit assignment. Binding entries include `edgeIds`, and the
snapshot's `requests` array reports each explicit edge endpoint with `edgeId`,
`ownerId`, `neighborId`, `requestedSlot`, and a status:

- `bound`: assigned to the requested slot; a spring binding may still be stretched.
- `occupied`: a retained occupant is using that position.
- `out-of-range`: the current pattern does not offer that slot index.
- `inactive`: no active attachment pattern is available at this endpoint.
- `free`: the endpoint explicitly requests null.
- `conflicting`: another parallel link controls this physical neighbor with a
  different request.
- `unbound`: the request is not currently geometrically admissible.

Parallel edges between the same two nodes share physical geometry and one slot
per endpoint. Compatible requests share that binding. The current controlling
explicit edge remains stable; new incompatible parallel requests are reported
without stealing control. When first selecting a controller, edge ID provides a
stable tie-break. Persist full view/world state to preserve that choice across
sessions. Consumers can match any binding's `edgeIds` to their canonical edges.
