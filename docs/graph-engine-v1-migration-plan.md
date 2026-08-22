# Graph Engine V1 Migration Plan

Status: Approved for implementation

Phase: Step 4 complete — source topology and ordered extraction approved

Date: 2026-08-21

Depends on:

- [Graph+ and Graph Engine V1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1 Acceptance Plan](graph-engine-v1-acceptance-plan.md)

## 1. Outcome

This plan converts the approved contracts and acceptance gates into an ordered,
reviewable migration of the existing Graph+ codebase.

The installed artifact remains one Obsidian plugin named Graph+. Inside that plugin:

- Graph Engine becomes a domain-neutral kernel, runtime, module host, settings host,
  and public lease service;
- Graph+ becomes the bundled vault consumer;
- the bundled consumer uses the same public session contract as external consumers;
- PatternSmith is not changed during this migration;
- current experimental Anima behavior is not migrated into V1.

The strategy is a strangler extraction. The existing Graph+ runtime remains available
as a characterization reference while a neutral engine is built beside it. Graph+
switches only after a synthetic consumer proves the public boundary.

## 2. Current architecture diagnosis

### 2.1 Current composition

```text
GraphView
  → GraphEngineRuntime
      → Obsidian app/plugin/settings/theme/navigation
      → Graph vault scanning and persistence
      → Input and command pipeline
      → Physics and current Anima
      → Frame composition and rendering
      → Graph+-specific controls
```

This works as a single application but is not yet a leaseable engine boundary.

### 2.2 Principal couplings to remove

1. `GraphEngineRuntime` constructs Obsidian navigation, reads the global settings
   store, mounts Graph+-specific controls, selects the active file, and hardcodes every
   system including Anima.
2. `Graph` imports `App` and `TFile`, scans the vault, creates closed note/tag/canvas/
   attachment/unresolved node types, owns persistence, derives adjacency, and applies
   Form/Filter projection.
3. Public graph objects contain runtime physics, rendering, Obsidian file, gate, and
   Anima state rather than neutral document values.
4. `NavigationController` opens Obsidian objects from engine commands.
5. `InteractionController` reads the Obsidian settings singleton directly.
6. `FrameComposer` and dependency types import Obsidian theme resolution and mandatory
   Anima state.
7. `Physics` and simulation depend on Anima state, making Anima compile-time required.
8. `GraphControlsPanel` and `LiveSettingsOverlay` import Obsidian UI and global settings
   while mixing generic controls with Graph+-specific note/tag/Form vocabulary.
9. The current settings schema is one large Graph+ object rather than independently
   versioned engine, module, profile, and consumer namespaces.
10. The build exports only the default Graph+ plugin and has no public contracts/client
    artifact or service provider.

### 2.3 Existing assets to preserve

- buffered input → interpretation → command dispatch mechanics;
- camera projection and controller mathematics;
- canvas rendering and hit testing;
- deterministic physics and simulation mechanics after removing domain state;
- SpaceTime scheduling after adopting container-window lifecycle;
- reversible source/projection behavior in `GraphProjector`;
- existing Form layout behavior;
- current gesture characterization, including pan while unfocused;
- compact native Graph+ controls where they remain consumer UI.

Preservation means observable behavior under acceptance scenarios, not retention of
current class names or folders.

## 3. Target source topology

The exact filenames may adjust during implementation, but dependency direction may
not reverse.

```text
src/
├── graph-engine/
│   ├── contracts/v1/
│   │   ├── values.ts
│   │   ├── document.ts
│   │   ├── patch.ts
│   │   ├── filter.ts
│   │   ├── view-state.ts
│   │   ├── profile.ts
│   │   ├── session.ts
│   │   ├── service.ts
│   │   └── index.ts
│   ├── client/
│   │   ├── GraphEngineClient.ts
│   │   ├── WorkspaceEventsTransport.ts
│   │   └── unavailableSurface.ts
│   ├── core/
│   │   ├── document/
│   │   ├── patch/
│   │   ├── filter/
│   │   ├── profile/
│   │   └── state/
│   ├── runtime/
│   │   ├── GraphSessionRuntime.ts
│   │   ├── SessionFactory.ts
│   │   ├── commands/
│   │   ├── input/
│   │   ├── camera/
│   │   ├── render/
│   │   └── lifecycle/
│   ├── modules/
│   │   ├── ModuleRegistry.ts
│   │   ├── base-surface/
│   │   ├── force-layout/
│   │   ├── filtering/
│   │   ├── form/
│   │   └── anima-stub/
│   └── host/obsidian/
│       ├── GraphEngineProvider.ts
│       ├── LocalLeaseTransport.ts
│       ├── EngineSettingsStore.ts
│       └── EngineSettingsSection.ts
├── graph-plus/
│   ├── GraphPlusConsumer.ts
│   ├── GraphPlusView.ts
│   ├── adapter/
│   │   ├── VaultGraphAdapter.ts
│   │   ├── VaultGraphReconciler.ts
│   │   ├── GraphPlusFilterCompiler.ts
│   │   └── GraphPlusLookup.ts
│   ├── persistence/
│   │   ├── GraphPlusPersistence.ts
│   │   └── GraphPlusDataMigration.ts
│   ├── settings/
│   └── ui/
└── obsidian/
    └── main.ts
```

### 3.1 Dependency rule

```text
contracts ← core ← runtime/modules ← host
     ↑                  ↑              ↑
   client         Graph+ consumer ─────┘
```

- Contracts import no implementation and no Obsidian API.
- Core imports contracts but no DOM, renderer, Obsidian, or consumer code.
- Runtime and shipped modules import contracts/core and browser APIs through injected
  owning-window dependencies.
- The Obsidian host adapts Workspace Events, storage, settings UI, and plugin lifecycle.
- Graph+ imports contracts/client plus Graph+-owned adapter, persistence, and UI.
- Graph+ never imports engine implementation classes.
- External consumers copy or depend on the small contracts/client artifact, not the
  Graph+ source tree.

## 4. Source-to-destination seam map

| Current source | Disposition | Target responsibility |
| --- | --- | --- |
| `types/domain/graph.ts` | Replace | Public neutral document types plus private runtime scene types |
| `systems/4. Modules/Graph.ts` | Split completely | Document store, VaultGraphAdapter, Graph+ persistence, reconciliation, projection modules |
| `engine/runtime/GraphEngineRuntime.ts` | Replace incrementally | SessionFactory and GraphSessionRuntime with injected profile/theme/window dependencies |
| `engine/runtime/GraphSystemRegistry.ts` | Generalize | Descriptor-driven ModuleRegistry and deterministic lifecycle |
| `lens/GraphQuery.ts` | Retain only as Graph+ compiler input | Graph+-specific text vocabulary compiles to public AST |
| `lens/GraphProjector.ts` | Split/generalize | Projection filter core and Form module over neutral scene data |
| `types/domain/lens.ts` | Migrate | Public filters plus Form module settings/state; remove closed file-type flags |
| `Input`, gesture helpers, buffers | Move with adapters | Generic container-owned input runtime with complete disposal |
| `UIInterpreter`, `UIStateStore`, `HitTester` | Generalize | Generic commands, selection/focus, hit testing, and public intents |
| `Commander`, `CommandBuffer` | Move/generalize | Internal engine command pipeline |
| `GraphCommandBindings` | Split | Generic engine bindings; product actions become consumer intent handling |
| `NavigationController` | Move to Graph+ | Translate node activation IDs through GraphPlusLookup into Obsidian actions |
| `InteractionController` | Generalize | Inject effective session settings; remove settings singleton |
| `Physics` and `simulation.ts` | Generalize | Force-layout module over private runtime nodes; remove Anima dependency |
| current `Anima` and `AnimaStateStore` | Do not migrate | Replace with lifecycle-valid empty optional module; preserve old code only until cutover |
| `CameraController`, `CameraProjection` | Move/generalize | Session camera with 2D/3D profile configuration and view-state export |
| `FrameComposer`, `FrameStore`, `Renderer` | Move/generalize | Neutral runtime scene, injected palette, optional module contributions |
| `themeStyleResolver.ts` | Keep in host | Host-provided theme palette scoped to the container's owning document |
| `GraphControlsPanel` | Split | Graph+ note/tag/query controls vs generic engine session controls |
| `LiveSettingsOverlay` | Defer or retain as dev-only | Not part of public V1 session contract unless a reviewed use remains |
| settings types/schema/store/tab | Split and migrate | Engine/module/profile store and UI plus Graph+-consumer settings namespace |
| `GraphView.ts` | Replace late | Thin Graph+ view: persistence, adapter, lease, container, intents, reconciliation |
| `main.ts` | Become composition root | Engine provider starts eagerly; Graph+ consumer stays dormant until view request |

## 5. Internal data separation

The migration must introduce three distinct representations.

### 5.1 Public document

`GraphDocumentV1` is immutable at the boundary, JSON-serializable, consumer-owned,
and contains only IDs, labels, tokens, attributes, edges, and position hints.

### 5.2 Canonical in-memory document store

The engine validates and clones the public document into a revisioned store. Patches
are atomic. This layer has adjacency indexes but no view positions, velocity, radius,
camera, selection, or Anima state.

### 5.3 Derived runtime scene

The session scene contains projected nodes/edges, runtime positions and velocities,
render metrics, hit-test data, and module-owned transient state. It is rebuilt or
reconciled from the canonical store and active view state.

This separation replaces the current `GraphData` object, which serves all three roles.

## 6. Ordered implementation slices

Each slice ends in a clean commit and must preserve every previously passed gate.
Production Graph+ stays on the legacy runtime until Slice 9.

### Slice 0 — Repository and characterization baseline

Work:

- record the starting branch, status, test, typecheck, and build results;
- preserve unrelated user changes;
- fix case-sensitive `5. Render` path/import inconsistencies before moving files;
- remove tracked dependency artifacts from version control in a separately reviewed
  hygiene commit without changing the installed dependency state;
- align package/manifest version policy and document build entry points;
- split the current seven-test runner into named suites without changing assertions;
- characterize current commands, camera, gestures, Form, Filter, focus reset, runtime
  open/close, and saved position behavior.

Exit:

- a reproducible green baseline;
- characterization fixtures exist before any class moves;
- cleanup and architecture changes are separate commits.

### Slice 1 — Contracts and pure conformance harness

Work:

- add the approved V1 structural types under `graph-engine/contracts/v1`;
- add validators and deterministic fixture builders;
- build a contracts-only import entry point;
- implement C-DOC and C-VERSION tests first;
- add an architecture check proving contracts have no Obsidian imports.

Exit: Gate A begins; contracts compile independently and do not affect legacy Graph+.

### Slice 2 — Canonical document, patches, and filters

Work:

- implement the cloned revisioned document store;
- implement atomic patch validation/application and graph-changed events;
- implement generic filter AST validation and evaluation for nodes and edges;
- build adjacency indexes and topology traversal without runtime scene fields;
- implement C-PATCH and C-FILTER scenarios;
- keep `GraphQuery` unchanged on the legacy side.

Exit: neutral documents can be replaced, patched, filtered, and exported without DOM
or Obsidian.

### Slice 3 — Profiles, module policy, and view state core

Work:

- implement consumer/profile registration and effective setting resolution;
- enforce required, optional, forbidden, constraint, and locked-value policies;
- define view-state validation, reconciliation, and export formats;
- implement descriptor/module/settings schema migration boundaries;
- implement C-PROFILE and C-VIEW scenarios, including generic persistence round-trip.

Exit: Gate A completes.

### Slice 4 — Neutral mounted session shell

Work:

- create `GraphSessionRuntime` and `SessionFactory` over a supplied container/document;
- derive DOM, window, RAF, device pixel ratio, observers, and timers from the
  container's owning document;
- implement session lifecycle, events, suspension, disposal, replacement, patches,
  filters, selection, focus, camera commands, and exports;
- create the synthetic consumer before moving the production renderer;
- initially mount a minimal deterministic diagnostic surface if necessary.

Exit:

- a neutral consumer creates, drives, exports, suspends, and disposes a session;
- lifecycle leak instrumentation passes.

### Slice 5 — Input, camera, rendering, and command pipeline

Work:

- port buffers, pointer/touch/wheel interpretation, command registry, camera math,
  hit testing, frame store, renderer, and cursor behavior behind neutral interfaces;
- remove global `document`, `window`, and settings singleton access;
- translate generic terminal commands into public intents;
- make pan-unfocused behavior explicit and characterized;
- ensure `Input.destroy()` and every runtime cleanup path are complete;
- prove 2D and 3D profile camera/render behavior.

Exit: R-MOUNT and R-INPUT scenarios pass through the synthetic consumer.

### Slice 6 — Shipped module registry

Work:

- replace hardcoded system construction with descriptor-driven module resolution;
- extract force layout with no Anima dependency;
- implement Filter as view membership over the AST evaluator;
- port Form as a reversible projection over neutral nodes/edges;
- add the empty optional Anima module and discard its current required render/physics
  contributions from the new runtime;
- inject theme palette and module render contributions without Obsidian imports;
- implement optional/required failure isolation and reverse-order cleanup.

Exit: Gate B completes; R-MODULE scenarios pass.

### Slice 7 — Obsidian provider, client, profiles, and settings

Work:

- implement local and Workspace Events lease transports against one provider core;
- register request listeners before availability announcement;
- implement instance IDs, release, unload invalidation, reconnect, ambiguous-provider,
  missing, and incompatible behavior;
- add the small consumer client and unavailable-surface helper;
- split engine/module/profile persistence into the namespaced store;
- replace the settings tab with Global and consumer/profile selection;
- show inactive profiles and locked values with reset/migration behavior;
- run one conformance suite against local and event transports.

Exit: Gate C completes; Graph Engine is externally leaseable even though Graph+ still
uses the legacy view runtime.

### Slice 8 — Graph+ vault consumer and persistence

Work:

- extract notes, tags, supported links, tag hierarchy, duplicate weighting, metadata
  tokens/attributes, and stable IDs into `VaultGraphAdapter`;
- omit attachments, Canvas, and unresolved nodes from V1 output;
- keep every `TFile` in `GraphPlusLookup` outside the document;
- implement saved-document loading, migration, validation, and vault reconciliation;
- implement debounced graph/view checkpoints and awaited close flush;
- migrate legacy saved node positions into namespaced `GraphViewStateV1` without
  destructively removing legacy data on first read;
- move Graph+ query parsing and note/tag controls into the consumer;
- translate public intents into Obsidian navigation/product actions;
- compare adapter output with committed fixture expectations.

Exit: Graph+ consumer tests pass independently through a fake lease.

### Slice 9 — Graph+ public-contract cutover

Work:

- replace `GraphView → GraphEngineRuntime` with `GraphPlusView → GraphPlusConsumer →
  local GraphEngineLeaseV1`;
- register `graph-plus/default` and mount into the view container;
- restore saved document/view state, render immediately, then reconcile the vault;
- ensure repeated open reveals rather than duplicates according to the approved policy;
- remove direct imports from Graph+ into engine internals;
- prove a synthetic external consumer can reproduce every engine operation Graph+
  uses;
- retain a short-lived development-only comparison switch only if it materially helps
  diagnosis, and remove it before V1 completion.

Exit: Gate D completes. The bundled Graph+ consumer now dogfoods the public API.

### Slice 10 — Persistence, lifecycle, and platform hardening

Work:

- exercise settings/data migrations against copies of legacy and corrupt fixture data;
- prove close checkpoint flush, abnormal-unload recovery, and saved-graph-first reopen;
- test simultaneous Graph+ and synthetic consumers;
- perform desktop main-window, popout, mobile, disable/re-enable, and reload smoke runs;
- instrument listener, observer, frame, timer, DOM, lease, and session cleanup;
- verify Graph+ consumer failures do not interrupt external leases.

Exit: Gate E completes.

### Slice 11 — Legacy removal and consumer handoff

Work:

- delete the legacy runtime, current Anima implementation, closed graph types, and old
  settings paths only after cutover evidence is green;
- retain explicit migrations for supported persisted data;
- publish or package the tiny contracts/client artifact in the form chosen for V1;
- add consumer documentation and a runnable neutral sample;
- document Graph+ as product and Graph Engine as its leaseable platform;
- perform a final import-boundary and bundle-content audit.

Exit: Gate F completes. PatternSmith integration may begin as a separate reviewed
project using only the public artifact.

## 7. Graph+ persistence transition

The current plugin saves only node positions under `graphStateByVault`. The new
consumer namespace saves a complete neutral document and compatible view state.

Migration behavior:

1. Read existing settings and `graphStateByVault` without modifying them.
2. Build or load the V1 notes/tags document.
3. Map legacy positions for retained stable node IDs into `GraphViewStateV1`.
4. Validate the new document and view state.
5. Write the new namespaced checkpoint.
6. Mark migration complete only after the write succeeds and can be read back.
7. Keep legacy data through at least the V1 migration window; cleanup requires a
   later explicit schema migration, not an opportunistic delete.

Saved graph startup behavior:

```text
open Graph+
  → load/migrate/validate saved document and view state
    ├── usable → mount immediately → scan vault → reconcile → checkpoint
    └── unusable → scan vault → build document → mount → checkpoint
```

The vault is authoritative for Graph+ domain membership and relations. Saved runtime
positions, camera, selection, filters, and module state remain view state and never
become vault truth.

## 8. Compatibility and rollback rules

- No slice both migrates persisted data and deletes its legacy source.
- Every schema migration is copy-forward, validated, and retryable.
- Failed migration leaves the last readable state intact.
- Public protocol V1 remains additive during V1 development; a breaking change returns
  to contract review.
- Local Graph+ transport may optimize dispatch but cannot expose extra methods.
- The old runtime is deleted only after public-contract Graph+ parity and platform
  hardening pass.
- Current Anima data/behavior is not a compatibility promise.
- PatternSmith is never used to prove engine correctness or modified to accommodate an
  unstable private interface.
- Each implementation slice is independently revertible at its commit boundary.

## 9. Test organization target

```text
tests/
├── characterization/       # current Graph+ observable behavior
├── contracts/              # C-DOC, C-PATCH, C-FILTER, C-VIEW, C-PROFILE
├── runtime/                # R-MOUNT, R-INPUT, R-MODULE
├── service/                # S-CONNECT and transport conformance
├── graph-plus/             # G-LAZY, G-ADAPTER, G-PERSIST, G-PARITY
├── fixtures/
│   ├── documents/
│   ├── persistence/
│   └── vault/
└── smoke/                  # repeatable Obsidian platform checklist/harness
```

Unit tests do not replace mounted runtime tests. Mounted runtime tests do not replace
the small Obsidian platform matrix.

## 10. Commit and review checkpoints

Recommended commit boundaries:

1. repository hygiene only;
2. characterization and harness only;
3. V1 contracts and validation;
4. document/patch/filter core;
5. profiles and view-state core;
6. mounted session shell;
7. input/camera/render pipeline;
8. module registry, force, Filter, Form, Anima stub;
9. service transports and client;
10. settings/profile host;
11. Graph+ vault adapter;
12. Graph+ persistence migration;
13. Graph+ public-contract cutover;
14. lifecycle/platform hardening;
15. legacy removal and consumer documentation.

Before each commit:

- relevant new scenario suite passes;
- every prior suite passes;
- typecheck and build pass;
- diff contains no unrelated user changes;
- persisted-data changes include migration fixtures;
- visible behavior changes include the appropriate rendered/manual check.

## 11. Explicit non-goals during migration

- PatternSmith projection or UI integration;
- PatternSmith learning cleanup;
- attachments, Canvas, or unresolved Graph+ nodes;
- a separate installed Graph Engine plugin;
- third-party executable engine modules;
- new Anima visuals or physics;
- dimming as filtering;
- regions, gates, curriculum semantics, or user-account profiles;
- redesigning Graph+ beyond what is necessary to preserve its approved V1 behavior.

## 12. Step 4 review decisions

Approval of this plan confirms:

1. one installed Graph+ plugin remains the delivery topology;
2. the target dependency direction and source boundaries are correct;
3. the synthetic consumer precedes the Graph+ cutover;
4. Graph+ stays on the legacy runtime until the neutral session and service pass;
5. complete saved-document persistence and vault reconciliation belong to Graph+;
6. generic export/load capability belongs to Graph Engine without automatic storage;
7. current Anima implementation is replaced by an empty optional V1 module;
8. PatternSmith integration begins only after Gate F;
9. the ordered slices and commit checkpoints may guide implementation.

After approval, Step 5 is implementation. It begins with Slice 0 baseline and
characterization, not with production extraction.
