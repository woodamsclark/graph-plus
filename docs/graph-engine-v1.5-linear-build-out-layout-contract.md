# Graph Engine V1.5 Linear Build-out Layout Contract

Status: implemented; live consumer visual acceptance pending.

Date: 2026-08-29

## Purpose

Linear build-out is a deterministic derived layout for graphs that should read from
one supplied origin along a chosen axis. It complements free force layout and radial
Form; it does not reinterpret consumer domain meaning.

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

The layout is derived presentation. It does not mutate the document, redirect edges,
persist ranks, infer prerequisites, or assign semantic importance.

## Ownership and conflicts

Consumers own node order, stable identity, edge direction, weights, opaque tokens,
domain actions, and the selected build direction. Graph Engine owns traversal, depth,
branch placement, coordinates, validation, and deterministic output.

`linear-layout` conflicts with `form` and `force-layout` because all three own node
positions. A consumer profile must choose one position owner. Camera fitting remains
an explicit session/consumer decision so restoring a learner's camera is not silently
overridden.

## Compatibility

This is an additive V1 capability and client-artifact V1.5 change. Existing consumers
that do not request `linear-layout` retain their current layout behavior.
