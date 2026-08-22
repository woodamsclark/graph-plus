# Graph Engine V1 consumer guide

Graph+ is the installed Obsidian plugin and Graph Engine is its leaseable platform.
The engine starts without scanning the vault or creating a renderer. Graph+ itself is
only one consumer; opening its view is what starts the vault adapter and graph session.

## Public artifact

Consumer code depends only on [`src/graph-engine/public.ts`](../src/graph-engine/public.ts).
The repository-local source package at
[`packages/graph-engine-client/package.json`](../packages/graph-engine-client/package.json)
names that boundary for local development. Before external publication, bundle that
entry as the `@graph-plus/graph-engine-client` package; do not import provider core,
runtime, renderer, module, or profile-registry paths.

The public boundary contains:

- V1 document, patch, filter, view-state, profile, session, lease, intent, and error contracts;
- the small Workspace Events client;
- availability event names and the standard unavailable surface;
- public document/view-state validation and reconciliation helpers.

## Connect from an Obsidian plugin

Wrap `app.workspace.on`, `offref`, and `trigger` as the public `GraphEngineEventBusV1`.
Create `GraphEngineWorkspaceClientV1` during the feature request—not during plugin
startup if the feature is not needed—then call `connect`:

```ts
const result = await client.connect({
  consumerId: 'my-plugin',
  supportedProtocolVersions: [1],
  requestedCapabilities: ['render', 'filter'],
  timeoutMs: 1500,
});

if (!result.ok) {
  mountGraphEngineUnavailableSurfaceV1(container, result.error);
  return;
}
```

The client listens before its first request, retries when Graph+ announces late
availability, rejects incompatible or ambiguous providers structurally, and removes
its temporary listeners after settlement. Never use Obsidian's undocumented plugin
manager to find Graph+.

## Register and mount

Register stable consumer/profile descriptors through the lease. Profiles are
archetypes, not people: `student` and `instructor` are appropriate; one profile per
individual user is not the intended model. The consumer owns its graph data and
persistence. Graph Engine only keeps the mounted in-memory session.

The runnable [`examples/neutral-consumer.ts`](../examples/neutral-consumer.ts)
demonstrates registration, document load, an atomic patch, projection and render
filters, intent subscription, view export/restore, disposal, and lease release.

## Ownership rules

- The consumer converts its domain into opaque nodes, edges, tokens, and attributes.
- The consumer translates its own query language into the generic filter AST or an ID list.
- The consumer persists exported documents and view state; Graph Engine never writes them.
- The consumer handles public intents and translates IDs back through its private lookup.
- Release a lease when the feature closes. Release disposes only sessions owned by that lease.
- Treat an engine instance ID change as a reload; old leases are stale and must not be reused.

PatternSmith integration begins as a separate change against this public artifact.
It should not import Graph+ vault-adapter code or private Graph Engine implementations.
