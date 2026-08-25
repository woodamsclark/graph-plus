# `@graph-plus/graph-engine-client`

This is the self-contained compile-time client for the Graph Engine V1 provider hosted
by the Graph+ Obsidian plugin. It contains public contracts, validation helpers, the
Workspace Events client, and the standard unavailable surface. It does not contain a
renderer or Graph Engine provider runtime.

The `src` directory is generated from Graph+'s reviewed public boundary:

```sh
npm run build:client
```

External consumers may install a packed copy or vendor this directory. They must import
only `@graph-plus/graph-engine-client` and obtain the runtime through Workspace Events.

Protocol version: 1

Artifact version: 1.2.0

V1.1 adds optional engine-owned session UI configuration, lease-scoped semantic node
actions, consumer/profile UI policy, and constrained 2D/3D profile settings. These are
additive capabilities: consumers using the original V1 fields remain source-compatible.

V1.2 adds optional rolling performance distributions, work counters, and a measurement
reset method while retaining protocol version 1. Runtime performance corrections do not
change consumer graph, interaction, persistence, or module-policy semantics.
