# graph-engine

graph-engine is a reusable graph platform for Obsidian with the graph+ experience built in.

- Opening graph+ lazily interprets Markdown notes and tags, mounts the saved graph,
  reconciles it with the vault, and checkpoints its document and view state.
- Other Obsidian plugins can lease the same neutral graph interface through public
  Workspace Events without importing graph+ product code.
- graph-engine owns in-memory graph operations, filters, profiles, modules, rendering,
  and interaction. Each consumer owns domain meaning and persistence.

See [graph-engine V1 consumer guide](docs/graph-engine-consumer-guide.md) for the
public boundary and a runnable neutral example.

Current design artifacts:

- [graph-engine V1.7.2 ribbon contract](docs/graph-engine-v1.7.2-ribbon-contract.md)
- [graph-engine downstream compatibility policy](docs/graph-engine-downstream-compatibility-policy.md)
- [graph-engine V1.5 Linear build-out layout contract](docs/graph-engine-v1.5-linear-build-out-layout-contract.md)
- [graph-engine V1.5 Linear build-out acceptance plan](docs/graph-engine-v1.5-linear-build-out-layout-acceptance.md)
- [graph-engine V1.4 topology-weighted layout contract](docs/graph-engine-v1.4-topology-weighted-layout-contract.md)
- [graph-engine V1.4 topology-weighted layout acceptance plan](docs/graph-engine-v1.4-topology-weighted-layout-acceptance.md)
- [graph-engine V1.3 tag regions contract](docs/graph-engine-v1.3-tag-regions-contract.md)
- [graph-engine V1.3 tag regions acceptance plan](docs/graph-engine-v1.3-tag-regions-acceptance.md)
- [graph-engine V1.2 scalability contract](docs/graph-engine-v1.2-scalability-contract.md)
- [graph-engine V1.2 scalability acceptance plan](docs/graph-engine-v1.2-scalability-acceptance.md)
