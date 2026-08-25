# Graph+

Graph+ is a better Obsidian graph and the installed host for a reusable Graph Engine.

- Opening Graph+ lazily interprets Markdown notes and tags, mounts the saved graph,
  reconciles it with the vault, and checkpoints its document and view state.
- Other Obsidian plugins can lease the same neutral graph interface through public
  Workspace Events without importing Graph+ product code.
- Graph Engine owns in-memory graph operations, filters, profiles, modules, rendering,
  and interaction. Each consumer owns domain meaning and persistence.

See [Graph Engine V1 consumer guide](docs/graph-engine-consumer-guide.md) for the
public boundary and a runnable neutral example.

Current design artifacts:

- [Graph Engine V1.2 scalability contract](docs/graph-engine-v1.2-scalability-contract.md)
- [Graph Engine V1.2 scalability acceptance plan](docs/graph-engine-v1.2-scalability-acceptance.md)
