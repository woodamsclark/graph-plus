# Graph+ and Graph Engine V1 Architecture and Contracts

Status: Approved for acceptance planning

Phase: Step 2 complete — specification approved before implementation

Date: 2026-08-21

## 1. Purpose

Graph+ is the installed, user-facing Obsidian plugin. It is presented as a better
Obsidian graph and includes Graph Engine as its reusable internal platform.

Graph Engine provides domain-neutral graph construction, manipulation,
visualization, interaction, layout, filtering, profiles, and module infrastructure.
It is publicly leaseable by PatternSmith and other installed plugins through a
versioned service exposed by Graph+.

Graph Engine does not own the durable meaning of a consumer's graph. A consumer
supplies a neutral graph document, mounts a live graph session into an HTML element,
responds to domain-neutral interaction intents, and decides if and when to persist
exported graph or view state.

Graph+ itself is a bundled first-party consumer module. It converts the Obsidian
vault into a neutral graph document, leases Graph Engine through the same public
contract available to external consumers, mounts the result in a Graph+ tab, and
owns its graph and view persistence.

The intended topology is:

```text
Installed Graph+ plugin
├── Graph+ built-in consumer module
│   └── local lease ───────────────┐
├── Graph Engine kernel            │
├── Graph Engine feature modules   │
└── public Graph Engine service ◀──┘
        ▲
        ├── PatternSmith
        └── other installed consumers
```

Graph Engine may contain internal packages such as a host-neutral core and a tiny
consumer contract/client package. Those packages are development artifacts, not
additional installed Obsidian plugins.

### 1.1 Product and developer framing

The user-facing explanation is:

> Graph+ is a better graph for Obsidian. It also provides a graph engine that other
> plugins can lease and mount inside their own interfaces.

The internal architecture runs in the opposite direction: Graph Engine is the
platform, and Graph+ is its bundled reference consumer. User-facing product framing
does not weaken the internal consumer boundary.

## 2. Governing principles

### 2.1 Consumer-owned permanence

The consumer owns and persists:

- its domain model;
- the mapping from domain data to a graph document;
- the durable graph document, if it chooses to persist one directly;
- exported per-graph view state, if it chooses to persist it;
- product actions and every domain mutation.

Graph Engine owns only the active in-memory session and its derived view. It does not
write a consumer's document or view state to storage automatically.

Graph Engine does persist its own global settings, registered profile descriptors,
and user profile overrides.

The bundled Graph+ consumer owns its state logically, even though its namespaced
storage physically shares the installed Graph+ plugin's data file.

### 2.2 Semantic ignorance

Graph Engine does not know what terms such as `due`, `locked`, `note`, `tag`,
`language`, `student`, `lesson`, `mastery`, or `FSRS` mean.

Consumers may attach opaque tokens and attributes to nodes and edges. Graph Engine
may compare those values, but it never interprets their domain meaning.

### 2.3 Canonical document, derived view

Filtering, projection, layout, camera movement, selection, focus, dragging, and
animation derive a view from the document. They do not mutate the document.

Structural operations are explicit document patches. A patch changes the in-memory
document and its revision.

### 2.4 Container-owned placement

A consumer provides an `HTMLElement`. Graph Engine mounts the complete live,
interactive surface inside it. The consumer owns where that element appears; Graph
Engine owns rendering and interaction within it.

### 2.5 Modular capability

Graph Engine has a minimal session kernel and a registry of engine modules. Profiles
declare each shipped module `required`, `optional`, or `forbidden`.

Filtering, Form, force layout, and Anima are modules. Anima is a valid but empty
optional module in V1.

Graph+ is a consumer module, not a feature module. Feature modules modify graph
sessions; Graph+ creates and uses sessions as an application.

### 2.6 Explicit lifecycle and versions

Documents, view state, settings, modules, service protocols, and plugin releases are
versioned independently. Every session and lease can be disposed. Stale leases and
stale document operations fail explicitly.

## 3. V1 scope

V1 includes:

- one installed, user-facing Graph+ plugin;
- a bundled Graph+ consumer module activated by `Open: graph+` or saved-view restore;
- a Graph+ V1 vault adapter for notes, tags, and relationships derived between them;
- namespaced Graph+ graph and view persistence;
- a versioned Graph Engine service for external consumers;
- consumer and profile registration;
- isolated sessions mounted into consumer-provided elements;
- neutral nodes and edges with opaque tokens and attributes;
- full document replacement and atomic structural patches;
- exportable documents and view state;
- 2D and 3D profile configuration;
- camera, input, selection, focus, dragging, and hit testing;
- node and edge filter ASTs;
- render-scope and projection-scope filtering;
- module policies and isolated optional-module failure;
- an empty optional Anima module;
- generic consumer intents;
- missing, disabled, incompatible, unload, and reconnect behavior;
- mobile, popout-window, resize, suspension, and disposal contracts.

V1 does not include:

- domain-specific node, edge, status, or filter vocabulary;
- inference of a graph from arbitrary domain records without a consumer adapter;
- automatic persistence of consumer documents or views;
- regions, gates, curriculum boundaries, or progression semantics;
- engine-originated structural editing UI;
- dimming as a filter operation;
- the current experimental Graph+ Anima visuals;
- Graph+ attachment, Canvas, unresolved-link, or other non-note/non-tag node types;
- arbitrary third-party executable module registration across the service boundary;
- a separately installed Graph Engine plugin;
- automatic installation or enabling of Graph+ by external consumers;
- PatternSmith qualification, unlocking, or radial-session redesign.

## 4. Terminology and ownership

| Term | Definition | Owner |
| --- | --- | --- |
| Consumer | An application layer using Graph Engine | Product plugin or bundled consumer module |
| Built-in consumer | A consumer shipped inside Graph+ but restricted to public engine contracts | Graph+ plugin |
| Domain model | The consumer's meaningful source data | Consumer |
| Graph document | Neutral nodes and edges used by one session | Consumer persists; engine holds a copy |
| Graph patch | Atomic structural update to a graph document | Consumer submits; engine applies |
| Graph session | One mounted in-memory graph runtime | Engine |
| View state | Positions, camera, selection, filters, and module state | Engine while active; consumer may persist |
| Profile | A named configuration archetype for a consumer | Consumer describes; engine stores settings |
| Module | A shipped optional or required engine capability | Engine |
| Command | An internal generic engine operation | Engine |
| Intent | A domain-neutral event exposed to the consumer | Engine emits; consumer handles |

Profiles are configuration archetypes, not user identities. A consumer may register
multiple profiles such as `student` and `instructor`. Profile IDs remain opaque, so
the contract does not technically prevent other naming schemes, but V1 does not add
a user-account model.

Graph+ is identified as consumer `graph-plus` whether it obtains an in-process local
lease or an external consumer obtains a Workspace Events lease. The local transport
must not grant Graph+ additional session capabilities.

## 5. Shared value types

Persisted values and graph data crossing the public service must be structural and
JSON-serializable. Runtime-only references such as `HTMLElement`, `AbortSignal`,
callbacks, leases, and sessions remain same-process objects and are never persisted.
No public contract relies on shared class identity or `instanceof` across plugin
bundles.

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type GraphScalar = string | number | boolean | null;
type GraphAttributeValue = GraphScalar | readonly GraphScalar[];

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Disposable {
  dispose(): void;
}
```

IDs are opaque, non-empty strings. Labels are not identities and need not be unique.

## 6. Graph document contract

```ts
interface GraphDocumentV1 {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly revision: number;
  readonly nodes: readonly GraphNodeV1[];
  readonly edges: readonly GraphEdgeV1[];
}

interface GraphNodeV1 {
  readonly id: string;
  readonly label?: string;
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
  readonly positionHint?: Vec3;
}

interface GraphEdgeV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly directed?: boolean;
  readonly weight?: number;
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
}
```

### 6.1 Document rules

- `documentId`, node IDs, and edge IDs are opaque.
- Node IDs are unique within a document.
- Edge IDs are unique within a document.
- Multiple edges may connect the same pair of nodes.
- Every edge endpoint must exist.
- Numbers must be finite.
- Tokens are opaque exact strings.
- Attribute names and values are opaque.
- `positionHint` is an initial suggestion, not durable layout authority.
- Runtime position and velocity never live on the public node object.
- Obsidian objects such as `TFile` and consumer objects such as FSRS cards do not
  cross the boundary. Consumers retain lookup maps keyed by graph IDs.

### 6.2 Building a document

Graph Engine may publish pure builder and validation helpers:

```ts
interface GraphDocumentBuilderV1 {
  addNode(node: GraphNodeV1): this;
  addEdge(edge: GraphEdgeV1): this;
  build(options: {
    documentId: string;
    revision?: number;
  }): GraphDocumentV1;
}
```

The builder normalizes and validates neutral graph data. It does not infer domain
nodes or edges from arbitrary records. Consumers own that adapter logic.

## 7. Graph patch contract

A patch is an atomic update format, not an approval handshake.

```ts
interface GraphPatchV1 {
  readonly schemaVersion: 1;
  readonly patchId: string;
  readonly baseRevision: number;
  readonly operations: readonly GraphPatchOperationV1[];
}

type GraphPatchOperationV1 =
  | { readonly type: "add-node"; readonly node: GraphNodeV1 }
  | { readonly type: "replace-node"; readonly node: GraphNodeV1 }
  | {
      readonly type: "remove-node";
      readonly nodeId: string;
      readonly removeIncidentEdges: boolean;
    }
  | { readonly type: "add-edge"; readonly edge: GraphEdgeV1 }
  | { readonly type: "replace-edge"; readonly edge: GraphEdgeV1 }
  | { readonly type: "remove-edge"; readonly edgeId: string };

type ApplyGraphPatchResultV1 =
  | {
      readonly applied: true;
      readonly previousRevision: number;
      readonly revision: number;
      readonly patchId: string;
    }
  | {
      readonly applied: false;
      readonly revision: number;
      readonly patchId: string;
      readonly error: GraphPatchErrorV1;
    };

interface GraphPatchErrorV1 {
  readonly code:
    | "stale-revision"
    | "duplicate-id"
    | "missing-node"
    | "missing-edge"
    | "dangling-edge"
    | "invalid-value"
    | "invalid-operation";
  readonly message: string;
  readonly operationIndex?: number;
}
```

### 7.1 Patch semantics

- A consumer call to `applyPatch` is authorization to apply the patch.
- All operations validate before any operation is committed.
- A failed patch makes no document change.
- A successful patch advances the revision exactly once.
- Removing a node must explicitly state whether incident edges are removed.
- Full document replacement remains available when diffing is unnecessary.
- The engine returns a revision result, not a complete document after every patch.
- Consumers may request `exportDocument()` whenever their persistence policy needs
  a complete snapshot.
- V1 does not originate structural edits from engine UI. A future editing module may
  introduce proposed-patch intents requiring consumer validation.

## 8. View state contract

```ts
type GraphDimensionsV1 = "2d" | "3d";

interface GraphCameraStateV1 {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly zoom: number;
  readonly projection: "orthographic" | "perspective";
}

interface GraphViewStateV1 {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly consumerId: string;
  readonly profileId: string;
  readonly dimensions: GraphDimensionsV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly pinnedNodeIds: readonly string[];
  readonly camera: GraphCameraStateV1;
  readonly selectedNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly activeFilters: Partial<
    Readonly<Record<GraphFilterScopeV1, GraphFilterRequestV1>>
  >;
  readonly moduleState: Readonly<Record<string, JsonValue>>;
}
```

### 8.1 View state rules

- View state is not part of the graph document.
- Dragging changes view state by default.
- The consumer may export, ignore, or persist view state.
- The engine does not autonomously persist per-document view state.
- When no saved state is supplied, the engine derives defaults from the profile,
  module defaults, position hints, and an initial fit-to-graph operation.
- Restore is best-effort across document revisions. Unknown node IDs are ignored;
  new nodes receive normal initial placement.
- A consumer may deliberately translate a dragged position into a later structural
  domain change, but Graph Engine does not do so automatically.

## 9. Filter AST contract

The AST selects matching nodes or edges. It does not define whether unmatched
elements are hidden, dimmed, moved, or animated.

```ts
type GraphFilterScopeV1 = "render" | "projection";

interface GraphFilterRequestV1 {
  readonly schemaVersion: 1;
  readonly scope: GraphFilterScopeV1;
  readonly node?: GraphFilterAstV1;
  readonly edge?: GraphFilterAstV1;
}

type GraphFilterAstV1 =
  | { readonly op: "all" }
  | { readonly op: "none" }
  | { readonly op: "and"; readonly operands: readonly GraphFilterAstV1[] }
  | { readonly op: "or"; readonly operands: readonly GraphFilterAstV1[] }
  | { readonly op: "not"; readonly operand: GraphFilterAstV1 }
  | { readonly op: "id-in"; readonly ids: readonly string[] }
  | { readonly op: "has-token"; readonly token: string }
  | {
      readonly op: "attribute-equals";
      readonly attribute: string;
      readonly value: GraphScalar;
    }
  | {
      readonly op: "attribute-contains";
      readonly attribute: string;
      readonly value: GraphScalar;
    }
  | {
      readonly op: "attribute-number-range";
      readonly attribute: string;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly op: "connected-to";
      readonly nodeIds: readonly string[];
      readonly direction?: "incoming" | "outgoing" | "either";
    }
  | {
      readonly op: "within-depth";
      readonly rootNodeIds: readonly string[];
      readonly maxDepth: number;
      readonly direction?: "incoming" | "outgoing" | "either";
    };
```

`connected-to` and `within-depth` are valid only in the `node` AST. They are rejected
as invalid filters when used in the `edge` AST. All other V1 predicates operate on
the IDs, tokens, or attributes of the target collection. An omitted node or edge AST
means that all elements of that target match.

### 9.1 Semantic boundary

Graph Engine never defines fields such as `status`, `kind`, or `language`. A consumer
may calculate an ID set and emit `id-in`, or may attach an opaque token or attribute
and ask the engine to compare it.

Example using consumer-calculated membership:

```ts
const filter: GraphFilterRequestV1 = {
  schemaVersion: 1,
  scope: "render",
  node: {
    op: "and",
    operands: [
      { op: "id-in", ids: dueNodeIds },
      { op: "not", operand: { op: "id-in", ids: lockedNodeIds } },
    ],
  },
};
```

Example using a consumer-owned token:

```ts
const filter: GraphFilterRequestV1 = {
  schemaVersion: 1,
  scope: "render",
  node: { op: "has-token", token: "due" },
};
```

The second example does not teach the engine what `due` means.

Scalar and topology comparisons are deterministic:

- IDs, tokens, attribute names, and string values compare exactly and case-sensitively.
- `attribute-equals` matches only a scalar attribute equal to the requested scalar.
- `attribute-contains` matches only a scalar-array attribute containing the requested
  scalar; it is not substring search.
- `attribute-number-range` matches only a scalar finite number and uses inclusive
  minimum and maximum bounds.
- `connected-to` traverses one edge outward, inward, or either way from the supplied
  node IDs. Undirected edges are traversable both ways.
- `within-depth` uses the same direction relative to each supplied root and includes
  the roots at depth zero.

### 9.2 Render and projection scopes

Render scope:

- unmatched elements are omitted by the V1 Filter module;
- unmatched elements do not participate in hit testing;
- underlying adjacency and layout forces remain intact;
- if a node is hidden, its incident edges are not rendered.

Projection scope:

- unmatched elements are excluded from the derived topology;
- adjacency, traversal, projection, and layout are recomputed from matches;
- edges require both visible endpoints and an edge-filter match;
- the source document remains unchanged.

The evaluation pipeline is:

```text
source document
  → projection-scope node and edge filters
    → topology projection and layout, including Form
      → render-scope node and edge filters
        → hit testing and rendering
```

Topology predicates in a projection filter evaluate against the source document.
Topology predicates in a render filter evaluate against the already-derived
projection. A session may hold one active request for each scope simultaneously.
Applying a filter replaces the request for that scope without clearing the other.

Edge filtering supports use cases such as relation selection, cross-link suppression,
weak-edge removal, or separation of render topology from layout topology. Edge tokens
and attributes remain consumer-defined.

### 9.3 Presentation

The V1 Filter module hides unmatched elements. Dimming and animated transitions are
not AST operations. Anima or another presentation module may later consume filter
results and apply alternate treatment.

The AST is the authoritative public representation. Generic text parsing may be
provided as a convenience, while consumers remain free to compile their own product
vocabulary or controls into the AST.

## 10. Session contract

```ts
interface GraphSessionOptionsV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  readonly restoreViewState?: GraphViewStateV1;
  readonly sessionOverrides?: GraphSettingsOverridesV1;
}

interface EngineModuleOverrideV1 {
  readonly enabled?: boolean;
  readonly settings?: Readonly<Record<string, JsonValue>>;
}

interface GraphSettingsOverridesV1 {
  readonly profileSettings?: Readonly<Record<string, JsonValue>>;
  readonly modules?: Readonly<Record<string, EngineModuleOverrideV1>>;
}

interface GraphSessionV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;

  replaceDocument(document: GraphDocumentV1): Promise<void>;
  applyPatch(patch: GraphPatchV1): Promise<ApplyGraphPatchResultV1>;
  exportDocument(): Promise<GraphDocumentV1>;

  applyFilter(filter: GraphFilterRequestV1): Promise<void>;
  clearFilter(scope?: GraphFilterScopeV1): Promise<void>;

  setSelection(nodeIds: readonly string[]): Promise<void>;
  focusNode(nodeId: string | null): Promise<void>;
  fitNodes(nodeIds?: readonly string[], options?: TransitionOptionsV1): Promise<void>;
  resetCamera(options?: TransitionOptionsV1): Promise<void>;

  exportViewState(): Promise<GraphViewStateV1>;
  restoreViewState(state: GraphViewStateV1): Promise<void>;

  onIntent(listener: (intent: GraphIntentV1) => void): Disposable;
  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable;
  onError(listener: (error: GraphSessionErrorV1) => void): Disposable;

  setSuspended(suspended: boolean): void;
  dispose(): Promise<void>;
}

interface TransitionOptionsV1 {
  readonly animate?: boolean;
  readonly durationMs?: number;
  readonly signal?: AbortSignal;
}
```

`applyFilter` replaces the active request for the supplied scope. Render and
projection filters may therefore coexist. `clearFilter(scope)` clears one scope;
omitting the scope clears both.

### 10.1 Mounting contract

Creating a session mounts a complete interactive graph surface inside `container`.
Graph Engine owns its descendant canvas and accessibility DOM, input listeners,
resize observation, animation frames, and enabled module instances.

The consumer owns the container's placement and lifetime. The surface may be used in
a full view, sidebar, modal, split pane, dashboard card, or small embedded inspector.

Graph Engine must:

- size against the container, not the application window;
- derive `document`, `window`, RAF, and device pixel ratio from the container's owning
  document and `defaultView`;
- support Obsidian popout windows;
- pause expensive work when suspended or hidden;
- remove every listener, observer, timer, animation frame, and child element on
  disposal;
- keep simultaneous sessions isolated.

## 11. Commands and intents

Graph Engine preserves and generalizes Graph+'s existing buffered command pipeline.
The intended layers are:

```text
DOM input
  → input events
  → generic engine commands
  → engine controllers
  → public consumer intents
  → consumer product actions
```

Generic engine commands include operations such as:

- pan, orbit, and zoom camera;
- reset camera;
- begin, continue, and end node drag;
- set selection;
- set focus;
- apply filter;
- replace document or apply patch.

Graph+-specific actions such as opening an Obsidian file or using the current note as
a Form root remain in Graph+.

```ts
type GraphIntentV1 =
  | GraphNodeActivatedIntentV1
  | GraphSelectionChangedIntentV1
  | GraphFocusChangedIntentV1
  | GraphBackgroundActivatedIntentV1
  | GraphNodeDragEndedIntentV1
  | GraphViewportChangedIntentV1;

interface GraphIntentBaseV1 {
  readonly sessionId: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly timestamp: number;
}

interface GraphNodeActivatedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "node-activated";
  readonly nodeId: string;
  readonly activation: "primary" | "secondary" | "keyboard";
}

interface GraphSelectionChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "selection-changed";
  readonly selectedNodeIds: readonly string[];
}

interface GraphFocusChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "focus-changed";
  readonly focusedNodeId?: string;
}

interface GraphBackgroundActivatedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "background-activated";
}

interface GraphNodeDragEndedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "node-drag-ended";
  readonly nodeId: string;
  readonly position: Vec3;
}

interface GraphViewportChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: "viewport-changed";
  readonly camera: GraphCameraStateV1;
}
```

Consumers reject or ignore intents whose revision no longer matches their active
domain projection. Intents never directly open files, start drills, or mutate domain
state.

## 12. Module contract

V1 modules are shipped by Graph Engine. Consumers configure them through profiles;
V1 does not accept arbitrary executable module code from consumer bundles.

```ts
type EngineModulePolicyV1 = "required" | "optional" | "forbidden";

interface EngineModuleDescriptorV1 {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly dependencies?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly settingsSchemaVersion: number;
  readonly defaultSettings: Readonly<Record<string, JsonValue>>;
}

interface EngineModuleProfileV1 {
  readonly policy: EngineModulePolicyV1;
  readonly defaultEnabled?: boolean;
  readonly defaults?: Readonly<Record<string, JsonValue>>;
  readonly constraints?: Readonly<Record<string, ModuleSettingConstraintV1>>;
  readonly lockedValues?: Readonly<Record<string, JsonValue>>;
}

type ModuleSettingConstraintV1 =
  | { readonly type: "enum"; readonly allowed: readonly JsonValue[] }
  | { readonly type: "number"; readonly min?: number; readonly max?: number }
  | { readonly type: "readonly" };
```

Internal module lifecycle must support setup, document/view changes, optional frame or
force/render contributions, state export/restore, suspension, and disposal.

### 12.1 Failure isolation

- Failure in an optional module disables that module for the session where possible.
- The session emits a structured module error.
- Required-module failure may prevent session creation or place the session in a
  fatal unavailable state.
- One session's module failure must not corrupt another session.

### 12.2 Initial module set

The exact internal packaging may evolve, but V1 profiles can govern at least:

- base rendering/camera/input capability;
- force layout;
- Filtering;
- Form projection;
- Anima.

Anima V1 has lifecycle, settings, and state hooks but no required visual behavior.

## 13. Consumer profiles

```ts
interface ConsumerRegistrationV1 {
  readonly consumerId: string;
  readonly displayName: string;
  readonly consumerVersion: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly profiles: readonly ConsumerProfileDescriptorV1[];
}

interface ConsumerProfileDescriptorV1 {
  readonly profileId: string;
  readonly displayName: string;
  readonly descriptorVersion: number;
  readonly dimensions: GraphDimensionsV1;
  readonly requestedCapabilities: readonly string[];
  readonly modules: Readonly<Record<string, EngineModuleProfileV1>>;
  readonly profileSettings?: Readonly<Record<string, JsonValue>>;
}
```

The stable profile key is `consumerId/profileId`.

### 13.1 Settings precedence

```text
Engine and module defaults
  → user global settings
    → consumer profile defaults
      → user profile overrides, where permitted
        → validated per-session overrides
```

Constraints and locked values govern whether later layers may override a value.
Forbidden modules cannot be enabled. Required modules cannot be disabled. Optional
modules use the profile default unless the user overrides it.

Graph Engine persists user global settings and user profile overrides inside the
installed Graph+ plugin's engine namespace. Consumers do not read or write that
storage directly.

### 13.2 Profile lifecycle and settings UI

- Re-registering a profile updates its descriptor; it does not erase user overrides.
- Saved overrides are validated and migrated against new descriptor/module versions.
- A profile whose consumer is not currently registered remains visible as inactive
  until the user deletes it.
- Settings may present a profile selector such as `Global`, `Graph+ — Default`,
  `PatternSmith — Student`, and `PatternSmith — Instructor`.
- Locked values remain visible with an explanation.
- Reset actions may target a setting, profile, or global settings.

## 14. Built-in Graph+ consumer contract

Graph+ is bundled with the installed plugin but behaves as a consumer of Graph
Engine rather than as a privileged part of the kernel.

### 14.1 Contract parity

- Graph+ registers consumer ID `graph-plus` and profile `default`.
- Graph+ obtains a local in-process lease implementing `GraphEngineLeaseV1`.
- The local lease may avoid Workspace Events, but it exposes the same capabilities,
  validation, errors, sessions, and lifecycle as an external lease.
- Graph+ submits `GraphDocumentV1`, `GraphPatchV1`, and `GraphFilterRequestV1` values.
- Graph+ handles public intents and translates them into Obsidian actions.
- Graph+ must not import private renderer, physics, scene-store, settings-store, or
  module implementation classes.
- A neutral synthetic external consumer must be able to reproduce every Graph Engine
  capability used by Graph+.

### 14.2 Lazy activation

Graph+ is available by default but remains dormant until one of these events occurs:

- the user invokes `Open: graph+`;
- Obsidian restores a saved Graph+ view;
- a future explicitly documented Graph+ action requests a session.

Before activation, Graph+ performs no vault scan, graph construction, physics setup,
renderer construction, animation loop, or view-specific listener registration.

Opening Graph+ follows this flow:

```text
Open: graph+
  → create or reveal Graph+ tab
    → load and validate saved Graph+ document and view state, when available
      → obtain local Graph Engine lease
        → mount the saved document, or a newly built document when none is usable
          → restore compatible Graph+ view state
            → scan supported vault material
              → reconcile the active document with the authoritative vault
```

Loading a saved document avoids requiring a complete reconstruction before the graph
can first appear. The vault remains authoritative: every open performs reconciliation,
and Graph+ submits the resulting patch or replacement to the active session.

Disabling the bundled Graph+ consumer suppresses its commands, ribbon actions, view
creation, saved-view restoration, vault listeners, and sessions without disabling
the Graph Engine service used by external consumers.

### 14.3 Graph+ V1 domain scope

Graph+ V1 interprets only:

- Obsidian notes as nodes;
- tags as nodes;
- note-to-note links;
- note-to-tag membership;
- tag relationships Graph+ explicitly derives from its supported tag model.

Attachments, Canvas files, unresolved links, and other file/node types are deferred.
Their absence from Graph+ V1 does not restrict the neutral Graph Engine document from
representing equivalent consumer-defined nodes in other applications.

Graph+ retains all `TFile` references and vault objects in adapter-side lookup maps.
They never enter the public graph document.

### 14.4 Persistence and migration

The installed Graph+ plugin has one physical plugin data store. Logical ownership is
kept explicit through namespaced schemas:

```ts
interface GraphPlusPluginDataV1 {
  readonly engine: {
    readonly settingsSchemaVersion: number;
    readonly globalSettings: JsonValue;
    readonly profileOverrides: JsonValue;
  };
  readonly consumers: {
    readonly graphPlus: {
      readonly dataSchemaVersion: number;
      readonly graphDocuments?: JsonValue;
      readonly viewStates?: JsonValue;
      readonly consumerSettings?: JsonValue;
    };
  };
}
```

Engine settings migrations and Graph+ consumer-data migrations are independent.
Graph+ V1 persists its complete neutral graph document and compatible view state
through debounced checkpoints after accepted document or view changes. A controlled
Graph+ view close flushes any pending checkpoint before disposing the session. Plugin
unload requests a best-effort final flush, but because Obsidian plugin unload is not
an awaitable durability boundary, correctness does not depend on that final request.
Graph Engine never performs these writes autonomously; Graph+ explicitly requests
`exportDocument()` and `exportViewState()` and writes the returned values in its own
namespace.

On open, Graph+ loads, migrates, and validates the saved document before offering it
to Graph Engine. If it is usable, Graph+ mounts it and then reconciles it against a
fresh scan of supported vault material. If it is absent, incompatible, or corrupt,
Graph+ reconstructs the document from the vault and uses default or independently
recoverable view state. Successful reconciliation becomes the next persisted graph
state.

### 14.5 Failure isolation

- Graph+ initialization errors disable or fail the Graph+ consumer surface, not the
  Graph Engine kernel.
- Graph+ vault-adapter errors do not invalidate leases held by PatternSmith or other
  consumers.
- A failed Graph+ session does not stop other sessions.
- Graph+ consumer state corruption falls back to recoverable defaults without
  rewriting engine settings.
- Kernel failure may make both Graph+ and external graph surfaces unavailable.

## 15. Obsidian service contract

Obsidian has no documented plugin-dependency field or public plugin-manager lookup.
The primary connection mechanism therefore uses the public Workspace Events API.
The V1 provider is the installed plugin whose manifest ID is `graph-plus`; consumers
discover the `graph-engine` capability rather than looking up that plugin through an
undocumented plugin manager.

Suggested event names:

```text
graph-engine:request:v1
graph-engine:available:v1
graph-engine:unavailable:v1
```

```ts
interface GraphEngineRequestV1 {
  readonly requestId: string;
  readonly consumerId: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly requestedCapabilities: readonly string[];
  readonly reply: (result: GraphEngineLeaseResultV1) => void;
}

type GraphEngineLeaseResultV1 =
  | { readonly ok: true; readonly lease: GraphEngineLeaseV1 }
  | { readonly ok: false; readonly error: GraphEngineConnectionErrorV1 };

interface GraphEngineLeaseV1 {
  readonly protocolVersion: 1;
  readonly engineVersion: string;
  readonly engineInstanceId: string;
  readonly capabilities: readonly string[];

  registerConsumer(registration: ConsumerRegistrationV1): Promise<void>;
  createSession(options: GraphSessionOptionsV1): Promise<GraphSessionV1>;
  release(): Promise<void>;
}
```

### 15.1 Load-order behavior

- The engine registers its request listener before announcing availability.
- Consumers listen for availability/unavailability before requesting a lease.
- If the engine loads first, a later request succeeds.
- If the consumer loads first, it retries after the availability event.
- Engine unload invalidates all leases and announces unavailability.
- `engineInstanceId` changes on reload, so stale handles reject calls.
- Multiple providers are treated as an error rather than selected silently.

### 15.2 Missing or incompatible engine

If the installed Graph+ plugin is missing, disabled, initializing, or exposes an
incompatible Graph Engine protocol, an external consumer or bundled client helper
renders a fallback inside the consumer-owned container. The unavailable provider
cannot render its own message because it is not running.

Suggested copy:

```text
Graph+ is unavailable or not installed. This feature requires its Graph Engine.
```

Consumers do not attempt to install or enable Graph+ automatically. Unrelated
consumer functionality remains available where possible.

## 16. Errors and events

```ts
interface GraphChangedEventV1 {
  readonly sessionId: string;
  readonly documentId: string;
  readonly previousRevision: number;
  readonly revision: number;
  readonly patch?: GraphPatchV1;
  readonly cause: "patch" | "replace-document";
}

interface GraphSessionErrorV1 {
  readonly code:
    | "invalid-document"
    | "stale-revision"
    | "module-failed"
    | "required-module-failed"
    | "session-disposed"
    | "engine-unavailable"
    | "incompatible-view-state";
  readonly message: string;
  readonly moduleId?: string;
  readonly recoverable: boolean;
}

interface GraphEngineConnectionErrorV1 {
  readonly code:
    | "engine-unavailable"
    | "protocol-incompatible"
    | "capability-unavailable"
    | "ambiguous-provider"
    | "initialization-failed";
  readonly message: string;
}
```

Errors crossing the service boundary are structural values, not engine class
instances.

## 17. Versioning

These versions evolve independently:

- installed Graph+ Obsidian plugin version;
- bundled Graph+ consumer-module version and data schema;
- public service protocol version;
- graph document schema version;
- graph patch schema version;
- view-state schema version;
- settings data schema version;
- consumer profile descriptor version;
- each module implementation and settings-schema version;
- Obsidian `minAppVersion`.

Breaking service changes require a new protocol major and event namespace. Consumers
declare supported protocol versions. Additive capabilities are negotiated rather than
inferred from plugin version alone.

## 18. Consumer examples

### 18.1 Neutral XYZ consumer

```ts
const lease = await client.connect({
  consumerId: "xyz",
  supportedProtocolVersions: [1],
});

await lease.registerConsumer({
  consumerId: "xyz",
  displayName: "XYZ",
  consumerVersion: "1.0.0",
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: "default",
    displayName: "Default",
    descriptorVersion: 1,
    dimensions: "2d",
    requestedCapabilities: ["render", "filter", "force-layout"],
    modules: {
      filtering: { policy: "optional", defaultEnabled: true },
      anima: { policy: "optional", defaultEnabled: false },
    },
  }],
});

const session = await lease.createSession({
  consumerId: "xyz",
  profileId: "default",
  container: graphElement,
  document,
});

await session.applyPatch({
  schemaVersion: 1,
  patchId: "patch-1",
  baseRevision: document.revision,
  operations: [
    { type: "remove-node", nodeId: "old", removeIncidentEdges: true },
    { type: "add-node", node: nextNode },
  ],
});

const documentToPersist = await session.exportDocument();
const optionalViewState = await session.exportViewState();
```

### 18.2 Graph+

Graph+ owns:

- vault scanning and metadata interpretation;
- note and tag meanings;
- relationships Graph+ derives between supported notes and tags;
- ID-to-`TFile` lookup;
- active-file and current-note behavior;
- opening files and tags;
- conversion of Graph+ query UI into the neutral filter AST;
- persistence/migration of Graph+'s existing document and view data.

Graph+ is bundled, but it registers and leases the engine as consumer `graph-plus`
through the local implementation of the public service contract. It receives no
private session capabilities.

Graph Engine owns:

- mounted surface, camera, gestures, hit testing, physics, rendering, and lifecycle;
- generic filtering and Form projection;
- generic settings/profile UI;
- optional Anima lifecycle.

Graph+'s existing InputBuffer, UIInterpreter, CommandBuffer, Commander,
CommandRegistry, and controllers are characterized before extraction. Generic
mechanics move into Graph Engine; Graph+ actions remain in its adapter.

The user invokes `Open: graph+`. The module opens a tab, scans supported vault notes
and tags, builds a neutral document, mounts a session into the tab's container, and
restores optional persisted Graph+ view state. Other file types are deferred beyond
V1.

Illustrative profile:

```text
graph-plus/default
dimensions: 3d
force-layout: required
filtering: required
form: optional
anima: optional, disabled by default in V1
unmodified wheel: pan when unfocused; rotate when focused
```

### 18.3 PatternSmith

PatternSmith owns:

- learning identities and labels;
- FSRS, due-state calculation, qualification, curricula, and unlocking;
- every edge meaning;
- Drill planning and persistence;
- the conversion of learning meaning into ID sets, opaque tokens, or attributes;
- product actions resulting from node activation.

Graph Engine sees only the resulting neutral document and filter AST.

Illustrative profiles:

```text
pattern-smith/student
dimensions: 2d
filtering: required
form: forbidden initially
anima: optional, disabled by default

pattern-smith/instructor
dimensions: 2d
filtering: required
form: optional
anima: optional, disabled by default
```

The instructor profile is a supported archetype example, not a V1 commitment to an
instructor product surface.

## 19. Stage 3 handoff

After this contract is approved, Step 3 must turn each promise into acceptance
scenarios before implementation. At minimum, those scenarios cover:

- valid and invalid documents;
- atomic patches and stale revisions;
- document and temporary view-state export/restore;
- domain-neutral node and edge filters in both scopes;
- profile registration, inheritance, constraints, and multiple profiles;
- optional-module failure isolation and required-module failure;
- consumer-first and engine-first load order;
- missing, incompatible, unload, reload, and stale-lease behavior;
- multiple isolated sessions and consumers;
- container mounting, resize, hidden suspension, mobile, popouts, and disposal;
- `Open: graph+` lazy activation with no pre-open vault scan or renderer construction;
- notes-and-tags-only Graph+ V1 source fixtures and persistence reconciliation;
- Graph+ consumer disable/failure without interruption to external engine leases;
- local Graph+ lease parity with an external synthetic consumer;
- Graph+ command-pipeline characterization and parity;
- a neutral synthetic consumer before Graph+ extraction.

No production extraction or PatternSmith integration begins until this contract and
the subsequent acceptance plan are reviewed.

The Step 3 artifact is [Graph Engine V1 Acceptance Plan](graph-engine-v1-acceptance-plan.md).
