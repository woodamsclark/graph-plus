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

Artifact version: 1.0.0
