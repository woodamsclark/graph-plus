# Toolbar+ attachment testing handoff

This branch adds a persistent, node-owned `attachment` quality to Graph+. Toolbar+
can adopt it for testing without a public release or an npm publication. It does
not change toolbar+ source or its saved configuration.

## Provider and client

Use the Graph+ provider built from the same testing commit. The current local
Graph+ installation has already been updated; reload the plugin to load the new
code. A different installation must build and install this branch first.

The generated client is in `packages/graph-engine-client`. Toolbar+ may vendor or
pack that directory; pin the testing commit rather than treating its unchanged
2.0.5 package label as a newly published release. Direct installation of the
repository root is not installation of this nested client package.

Add `node-attachment-slots-2d` to toolbar+'s requested capabilities, both when acquiring
the lease and in its consumer profile. TypeScript consumers can import
`GRAPH_NODE_ATTACHMENT_SLOTS_CAPABILITY_V1` from the generated client. Toolbar+'s
current JavaScript consumer can request the string directly.

An older Graph+ provider will reject the requested capability. Keep the existing
unavailable/error path rather than silently pretending angular springs work.

## Define the quality on nodes

Pass the property on the nodes in the document supplied to the leased session:

```js
{
  id: "center",
  // Keep the existing label, attributes, positionHint, etc.
  attachment: { count: 8, stiffness: "firm", openingDegrees: 0 }
}
```

This gives the center eight preferred directions 45 degrees apart. The pattern
can turn freely; it does not fix north. Each slot holds one neighbor; overflow remains free.
Missing attachment or count 1 means unrestricted. Stiffness is numeric 0–1 or
`off`, `soft`, `firm`, or `stiff`. See [the full contract](connection-angles-2d.md).

Do not put the definition in force-layout settings. Copy a toolbar node's own
attachment property into the corresponding Graph+ node when generating scenes.
Preserve it in toolbar+'s persisted hub model, including the center node, which
the current model reconstructs separately on load. New nodes remain unrestricted
unless they explicitly receive their own quality.

Changes to the property travel through the existing document replacement/node
patch APIs. Toolbar+'s document revision key must include attachment so editing
it reaches Graph+. Temporary choreography targets use `motionTargets.nodeAttachments`
and do not overwrite the saved quality; there is no new Anima editor UI.

## Existing toolbar layout behavior

The current toolbar consumer uses `Layout.constrain` before and after Graph+
advances the world. It enforces depth radii and also clamps parent-child angular
stretch. Those corrections can compete with the new angular spring.

For this trial, keep depth/lane behavior explicit and inspect the angular clamp
separately. A free attachment pattern does not replace distance-from-hub lanes,
absolute compass placement, or pointer-driven selection. In fixed layouts the
nodes are pinned, so a spring cannot visibly move them. Start in the dynamic
Graph+ layout with a node that has at least two visible connected neighbors.

## Useful acceptance checks

- Existing saved hubs load with no angular force until a node is configured.
- Changing one node's count affects its connection pattern; it does not assign
  qualities to every node.
- Count 1 releases angular preference; count 2, 3, 4, and 8 produce the expected
  repeated directions in 2D.
- Dragging and releasing a neighbor shows the spring response, while the center
  and pointer-controlled nodes retain their position authority.
- Adding/revealing neighbors uses the owner's existing quality automatically.
- Saving and reopening toolbar+ preserves the property on the center and on
  ordinary action nodes.
- An older provider produces a clear unavailable-capability outcome.

The Graph+ suite currently passes 549 tests, including document validation,
cloning, JSON/checkpoint storage, leased-session node patches, spring convergence,
free rotation, pins, duplicate edges, and transient animation targets. The 3D
document retains attachment, but spherical forces are intentionally deferred.

## Binding and orientation lock testing

Use `rigidity: "locked"` to prevent an occupant from escaping or switching slots.
Leave orientation free to let the whole pattern turn, or anchor the hub in world
space with `orientation: { mode: "locked", rotation: { x: 0, y: 0, z: 0, w: 1 } }`.
That identity rotation aligns slot zero with world +X. A different planar angle
can be converted with `graphAttachmentRotation2DV1` from the client contract.

For spring mode, higher `stiffness` both restores the direction more strongly
and raises the escape threshold. Check that a sufficiently displaced occupant
can detach and later acquire a different empty slot. Check that a closer newcomer
cannot steal an occupied locked slot, and that excess neighbors stay free.

Locked constraints veto incompatible movement, including pointer and external
position updates. Toolbar+'s own per-frame position corrections may repeatedly
request moves Graph+ rejects; inspect those corrections when testing, rather than
interpreting a blocked drag as a binding failure. Keep a single layout authority.

Persist Graph+ view/world module state as well as the node declarations if
occupants should survive closing/reopening the toolbar session. Position-only
snapshots omit slot identities. Inspect `attachmentSlots`,
`rejectedAttachmentBindings`, and `blockedAttachmentMoves` in force diagnostics.
The provider remains 2D-only for these features.

## Assign a command link to a specific position

The provider now supports `edge-attachment-assignments-2d`. Request this additional
capability in the lease and consumer profile. A command's generated Graph+ edge
can carry `attachment: { sourceSlot: 3 }` when `sourceId` is its owning hub/node.
Use `targetSlot` instead when the owning node is `targetId`; each endpoint is
independent, even on an undirected link.

Indices are zero-based. Keep this property in toolbar+'s saved connection model,
include it in document revision comparisons, and forward it when regenerating
edges. Submit normal `replace-edge` patches or document replacements to change it.
A request persists until explicitly edited. Omission restores automatic binding;
null forces that endpoint to stay unbound. Explicit spring assignments may stretch
but do not jump to other positions.

Inspect the force-layout `attachmentSlots.requests` statuses and binding `edgeIds`
to confirm effective assignments. Occupied/out-of-range requests stay unbound;
Graph+ never silently substitutes a different position. Slot identity alone does
not set a world heading: configure the owning node's pattern orientation as well
when a command needs a particular screen/world direction.
