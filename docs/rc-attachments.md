# Attachment release candidate for Toolbar+

Branch: `rc/attachments`. This is the integration candidate for attachment features,
not a stable release or an automatic plugin installation. `main` stays unchanged.

## Current consumer API

Use `setGraph` for a complete description and `patchGraph` for atomic incremental
edits. Both return an `applied` result. Attachments are now explicitly disabled
unless `attachment.enabled === true`; enabled nodes default to loose assignment.
Strict node policies return detailed failures without committing unsuccessful graph
edits. See [the current policy contract and complete consumer example](attachment-policy.md).

## Included

- Existing node-owned 2D attachment patterns, finite occupancy, spring bindings,
  hard geometric locks, orientation policies, and persistent edge endpoint indices.
- Matching 3D behavior with spherical slot directions, full quaternion pattern
  orientation, spatial angular springs, and hard spatial ray projection.
- A shared slot lifecycle for both dimensions: capacity, assignment precedence,
  admission, release/recapture, diagnostics, and snapshot validation.
- Regenerated downstream client contracts and a public slot-direction helper.

## Separate experiments

| Branch | Scope |
| --- | --- |
| `rc/attachments` | 2D and 3D attachments; no gravity or experimental grabs |
| `experiment/gravity-node-pull` | Checkpoint of the existing uniform-Y-gravity and settings-based node-pull prototype |
| `experiment/grab-constraints` | Exact/elastic/off transient grab experiment |

The settings-based node pull is an earlier prototype, not the newer grab API.
Neither experiment is included in this RC. Default exact dragging remains as before;
accepted hard attachment locks can still veto incompatible movement.

The RC starts with the three committed attachment changes through `439ccde`.
The original attachment checkout and its uncommitted experimental edits are preserved.
Future tested engine features can enter this RC intentionally; downstream-only
experiments should remain on their own branches until their behavior is agreed.

## Toolbar+ adoption

Build Graph+ from this branch and reload that provider. Use the matching generated
`packages/graph-engine-client` directory in Toolbar+. Pin the tested commit when
reproducibility matters; follow the branch for ongoing RC trials. Provider/client
package labels remain `2.0.5` in this source branch; the commit and negotiated
capabilities distinguish this candidate from the stable build. No npm publication
or stable release version change is implied.

From the RC checkout:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The generated `main.js` plus repository `manifest.json` and `styles.css` form the
provider build. Building does not install it into a vault. Toolbar+ is not modified
by this branch, and an already-running provider continues using its loaded build
until explicitly replaced and reloaded.

For a 3D scene, select `dimensions: '3d'` in the consumer profile, enable force
layout, and request these capabilities in both registration/profile requirements
and the lease request:

```ts
import {
  GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1,
  GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1,
  graphAttachmentSlotDirection3DV1,
} from '@graph-plus/graph-engine-client';

const requestedCapabilities = [
  GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1,
  GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1,
];
const direction = graphAttachmentSlotDirection3DV1(6, 2); // world-local +Z
```

An older provider rejects unavailable capabilities. Keep that explicit outcome;
do not silently fall back to a provider without spatial constraints.

Node and edge declarations use the existing attachment fields. For example:

```ts
const hub = {
  id: 'hub',
  attachment: {
    enabled: true,
    count: 6,
    rigidity: 'locked',
    orientation: { mode: 'locked', rotation: { x: 0, y: 0, z: 0, w: 1 } },
  },
};
const edge = {
  id: 'hub-command', sourceId: 'hub', targetId: 'command',
  attachment: { sourceSlot: 2 },
};
```

That connection occupies the hub's +Z ray. Its distance remains governed by normal
link physics; moving it off that ray is constrained by the existing hard-lock rules.
Spring rigidity uses the same indexed direction as a preference instead.

## Spatial patterns and saved state

| Count | Indexed local pattern |
| --- | --- |
| 1 | Unrestricted; no attachment forces |
| 2 | Antipodal +X, -X |
| 3 | Equatorial triangle |
| 4 | Tetrahedron |
| 6 | Octahedron: +X, +Y, +Z, -X, -Y, -Z |
| 8 | Cube corners |
| 12 | Icosahedron |
| Other counts | Deterministic Fibonacci sphere |

Indices are zero-based and stable for a given count. Count changes explicitly
reconfigure the pattern. The full node quaternion rotates these local directions
into world space. Free orientation fits all retained bindings; spring orientation
turns toward its declared quaternion; locked orientation fixes that quaternion.
With only one directional observation, the free fit preserves the previous twist.

Angular spring opening/capture/release rules operate in angular distance on the
sphere. The existing document validation limit `openingDegrees <= 360 / count`
is retained. Automatic capture uses an area-derived angular scale in 3D rather
than assuming one-dimensional circular spacing. For counts above 4,096, automatic
nearest-slot searches use bounded sampling; explicit indices remain addressable.
Extreme counts may leave vacant slots undiscovered by automatic capture.

Persist documents plus view/world module state to retain runtime occupancy and
pose. Spatial attachment snapshots include `dimensions: '3d'` and the full quaternion
on each owner. Legacy snapshots without dimensions remain 2D. Occupancy snapshots
from another dimension are discarded rather than reinterpreting their indices;
authored node/edge declarations survive dimension changes and are re-admitted.

## Validation and remaining hands-on checks

The RC passes 583 tests, including 21 3D tests and 13 policy/API tests, existing 2D behavior, client
artifact consistency, leased capability negotiation and edge patches, persistence,
quaternion fitting, spring convergence, hard-lock conflicts, drag/position patches,
and a 24-hub/144-binding repeated-disturbance stress case. Typecheck, build, and
lint of changed engine files also pass.

Toolbar+ should still check the actual dynamic layout, its own position corrections,
save/reopen, dimension switching, and provider reload. Those consumer/hardware
checks have not been performed here. Hard-lock admission remains conservative,
and dense coupled constraint networks can reject otherwise plausible bindings;
the solver is not a global feasibility proof. Inspect `attachmentSlots.requests`,
`rejectedAttachmentBindings`, and `blockedAttachmentMoves` when testing.
