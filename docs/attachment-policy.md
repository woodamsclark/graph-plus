# Graph updates and node attachment assignment

These APIs describe graph data, not HTML or consumer-owned engine instances.
The consumer passes node and edge records; Graph+ copies them and owns their
runtime physics and presentation.

`setGraph(graph)` replaces the complete description. `patchGraph(patch)` edits
specific records with revision checks. Both return `{ applied: true, ... }` or
`{ applied: false, error, ... }`. Existing `replaceDocument` and `applyPatch` names
remain compatible: replacement still throws for validation/assignment failures,
while patches return their structured result.

Request `GRAPH_UPDATE_API_CAPABILITY_V1` (`graph-update-api`) and
`GRAPH_ATTACHMENT_ASSIGNMENT_POLICY_CAPABILITY_V1` (`attachment-assignment-policy`)
from the matching RC provider, alongside the applicable 2D/3D slot capabilities.
Older providers cannot guarantee the new behavior even when their package version
label matches. Pin matching provider/client commits for testing.

## Per-node configuration

```ts
attachment: {
  enabled: true,
  assignment: 'loose', // default when enabled; 'strict' rejects unsuccessful assignments
  count: 6,
  rigidity: 'locked',
  orientation: { mode: 'locked', rotation: { x: 0, y: 0, z: 0, w: 1 } },
}
```

- `enabled` defaults to false. Defining count, orientation, stiffness or assignment
  alone does not enable attachment behavior. Existing RC consumer scenes must add
  `enabled: true` to the nodes they intend to constrain.
- Enabled nodes default to loose assignment. If a connection cannot obtain a point,
  it remains connected without angular attachment; ordinary graph forces still
  govern it. Its authored index request is retained and can become usable later.
- Strict applies to that node's endpoint of every incident edge, including automatic
  allocation. An unsuccessful assignment rejects the whole graph edit. Neither its
  graph revision nor its live positions, pins, occupancy or orientation are committed.
- Assignment policy is independent of spring versus hard geometric rigidity and
  independent of pattern orientation. Existing lock/physics semantics remain intact.
- Slot indices are zero-based. One distinct neighbor occupies each point; compatible
  parallel edges share a physical binding. Each edge endpoint uses its owning node's
  policy independently.
- Explicit null means no point. It is valid loose fallback, but fails a strict owner.
  Count 1 or spring stiffness zero provides no indexed binding, so a strict enabled
  owner with incident edges reports `inactive`. A disabled owner ignores the policy.

## Complete consumer example: create, assign, then shrink

This function runs against an existing 3D session with force layout enabled and
the new capabilities negotiated. The node and edge arrays are ordinary data.

```ts
import type { GraphSessionV1 } from '@graph-plus/graph-engine-client';

async function buildToolbar(session: GraphSessionV1) {
  const created = await session.setGraph({
    schemaVersion: 1,
    documentId: 'toolbar',
    revision: 0,
    nodes: [
      {
        id: 'hub',
        attachment: {
          enabled: true,
          assignment: 'strict',
          count: 6,
          rigidity: 'locked',
          orientation: { mode: 'locked', rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      },
      { id: 'save' },
      { id: 'search' },
    ],
    edges: [
      { id: 'hub-save', sourceId: 'hub', targetId: 'save', attachment: { sourceSlot: 0 } },
      { id: 'hub-search', sourceId: 'hub', targetId: 'search', attachment: { sourceSlot: 5 } },
    ],
  });
  if (!created.applied) return created;

  const graph = await session.exportDocument();
  const hub = graph.nodes.find(node => node.id === 'hub')!;
  const search = graph.edges.find(edge => edge.id === 'hub-search')!;

  const shrink = await session.patchGraph({
    schemaVersion: 1,
    patchId: 'shrink',
    baseRevision: graph.revision,
    operations: [{
      type: 'replace-node',
      node: { ...hub, attachment: { ...hub.attachment, count: 4 } },
    }],
  });

  if (!shrink.applied) {
    // code: 'attachment-assignment'
    // failure: hub-search.source, requestedSlot 5, reason 'out-of-range'
    console.log(shrink.error.attachmentFailures);
  }

  // Rejection preserved the previous graph and revision. Shrink AND fix the
  // affected assignment in one atomic edit; intermediate operations are not committed.
  return session.patchGraph({
    schemaVersion: 1,
    patchId: 'shrink-and-reassign',
    baseRevision: graph.revision,
    operations: [
      { type: 'replace-node', node: { ...hub, attachment: { ...hub.attachment, count: 4 } } },
      { type: 'replace-edge', edge: { ...search, attachment: { sourceSlot: 3 } } },
    ],
  });
}
```

With the default loose policy, the first shrink instead succeeds. Search stays
connected and its request for point 5 remains saved, but it has no binding. Changing
count also changes the pattern shape, so even retained indices can acquire new
directions. No silent index wrapping, eviction or automatic count increase occurs.

## Failure contract and later physics

Strict failures identify `edgeId`, `endpoint`, `ownerId`, `neighborId`, optional
`requestedSlot`, `reason`, and a readable message. Reasons include `occupied`,
`out-of-range`, `conflicting`, `inactive`, `free`, `unbound`, and `layout-unavailable`.
Initial session creation rejects with an error carrying `code: 'attachment-assignment'`
and `failures`. Prefer the code/data fields over `instanceof` across separately
bundled provider and client copies.

Admission evaluates the fully staged graph against current geometry, pins and
retained bindings in isolated solver state. It is immediate and conservative; it
does not wait indefinitely for a future equilibrium or prove global feasibility.
The check runs before the document becomes observable. A failed edit is not queued;
the consumer changes its request or retries explicitly.

Physics/animation/position changes can invalidate a previously admitted spring
binding. When a subsequent solver tick detects a strict failure, the session emits
a recoverable `onError` report with `code: 'attachment-assignment'` and detailed
`attachmentFailures`. Identical consecutive failure states are suppressed; recovery
rearms reporting. This reports the current world failure rather than undoing an
earlier graph edit. It does not prevent spring dynamics or override accepted locks.

```ts
session.onError(error => {
  if (error.code === 'attachment-assignment') {
    console.log(error.attachmentFailures);
  }
});
```

Strict admission is for graph creation and updates. It uses authored canonical
attachments; transient animation overrides are evaluated by live physics, not saved
as graph edits. Attachments remain independent from selection, command targeting,
gravity, and experimental grab policies.
