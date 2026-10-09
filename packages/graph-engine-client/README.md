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

Artifact version: 2.0.1

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
