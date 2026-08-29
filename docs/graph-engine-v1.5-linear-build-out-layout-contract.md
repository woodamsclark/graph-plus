# Graph Engine V1.5 Linear Build-out Layout Contract

Status: implemented; live consumer visual acceptance pending.

Date: 2026-08-29

## Purpose

Linear build-out is a deterministic initial placement for graphs that should read
from one supplied origin along a chosen axis. It complements free force layout and
radial Form; it does not reinterpret consumer domain meaning or constrain nodes after
placement.

The governing rule is:

> The consumer supplies ordered nodes and canonical links; Graph Engine builds them
> outward from the first node.

## Public surface

The shipped module ID and capability are `linear-layout`. Its display name is
**Linear build-out**. Public settings are:

- `buildDirection`: `up`, `down`, `left`, `right`, `in`, or `out`;
- `layerSpacing`: positive distance between successive link-depth layers;
- `branchSpacing`: positive separation between siblings in one layer; and
- `componentSpacing`: positive separation between disconnected components.

`up`, `down`, `left`, and `right` work in 2D and 3D. `in` and `out` require 3D.
In the engine world coordinate system, `out` is positive Z and `in` is negative Z.

## Placement

1. The first node in `GraphDocumentV1.nodes` is the primary origin at `(0, 0, 0)`.
2. Directed edges traverse from `sourceId` to `targetId`. Undirected edges are
   traversable both ways.
3. A reachable directed acyclic component uses longest-path depth so a join is placed
   after all of its upstream branches.
4. Cyclic, mixed, or oppositely rooted topology falls back to deterministic weak
   breadth-first depth rather than failing or producing non-finite positions.
5. Nodes sharing a depth occupy a perpendicular sibling lane in consumer document
   order.
6. Disconnected components use their first supplied node as a local root and receive
   a deterministic perpendicular component offset. The primary origin never moves.
7. The computed coordinates become the session's ordinary editable positions. After
   that initial placement, dragging moves only the active node and does not pin,
   reflow, or snap any node back.

The layout initializes view-state positions. It does not mutate the document,
redirect edges, persist ranks, infer prerequisites, or assign semantic importance.
Its module state records the placed document identity so restoring the same view does
not reapply the initial placement over manual edits.

## Ownership and conflicts

Consumers own node order, stable identity, edge direction, weights, opaque tokens,
domain actions, and the selected build direction. Graph Engine owns traversal, depth,
branch placement, coordinates, validation, and deterministic output.

`linear-layout` conflicts with `form` and `force-layout` during initial placement
because each can supply positions. After placement, Linear build-out relinquishes
position ownership and the coordinates are freely editable. Camera fitting remains an
explicit session/consumer decision so restoring a learner's camera is not silently
overridden. Focus, hit testing, and camera fitting use the active positions.

## Compatibility

This is an additive V1 capability and client-artifact V1.5 change. Existing consumers
that do not request `linear-layout` retain their current layout behavior.
