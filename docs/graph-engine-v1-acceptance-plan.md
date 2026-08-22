# Graph Engine V1 Acceptance Plan

Status: Approved for migration planning

Phase: Step 3 complete — observable behavior and migration gates approved before implementation

Date: 2026-08-21

Depends on: [Graph+ and Graph Engine V1 Architecture and Contracts](graph-engine-v1-contracts.md)

## 1. Purpose

This plan translates the approved V1 contracts into observable scenarios. It defines
what must remain true while Graph+ is inverted from a vault-specific graph runtime
into:

- a domain-neutral Graph Engine kernel;
- a set of optional or required engine modules;
- a public lease service;
- and a bundled Graph+ consumer using the same session contract as external plugins.

This is not an implementation sequence. The subsequent migration plan may choose
different internal seams, but it may not weaken these outcomes without returning to
contract review.

PatternSmith integration is represented only by a neutral synthetic consumer in V1.
PatternSmith's learning behavior, persistence, qualification, curricula, and product
UI remain outside this plan.

## 2. Acceptance strategy

### 2.1 Proof levels

| Level | Purpose | Expected environment |
| --- | --- | --- |
| C — Core | Pure documents, patches, filters, profiles, versions, and state | Node, no Obsidian and no DOM |
| R — Runtime | Mounted sessions, rendering, input, modules, isolation, and cleanup | Deterministic browser/DOM harness |
| S — Service | Provider discovery, leases, load order, reload, and connection failures | Fake Workspace Events, then Obsidian smoke test |
| G — Graph+ | Vault adapter, lazy activation, persistence, commands, and public-contract parity | Fixture vault, then desktop/mobile Obsidian smoke test |

The default automated command eventually runs all C, R, S, and headless G scenarios.
Obsidian-only smoke cases are recorded in a repeatable checklist and run at every
release candidate.

### 2.2 Scenario language

Every scenario uses Given / When / Then. A scenario passes only when its stated
observable result is asserted. Private class names, folder placement, and incidental
frame timings are not acceptance criteria.

### 2.3 Determinism

- IDs, clocks, random sources, animation frames, and resize signals are injectable in
  test harnesses.
- Layout assertions use invariants or seeded snapshots rather than unconstrained
  floating-point equality.
- No test depends on actual vault contents outside a committed fixture.
- Cleanup assertions count active listeners, observers, timers, frames, and mounted
  children before and after disposal.

## 3. Contract acceptance scenarios

### C-DOC — Graph documents

#### C-DOC-01 — Minimal valid document

Given a version-1 document with a non-empty document ID, revision zero, one valid
node, and no edges, when it is validated, then validation succeeds and produces no
Obsidian or consumer-specific runtime references.

#### C-DOC-02 — Neutral rich document

Given nodes and edges with opaque tokens, scalar and scalar-array attributes,
parallel edges, directed edges, finite weights, and position hints, when the document
is validated and exported, then the values round-trip without semantic
interpretation.

#### C-DOC-03 — Duplicate and empty IDs

Given duplicate node IDs, duplicate edge IDs, or an empty document, node, or edge ID,
when validation runs, then it rejects the document with a structural error identifying
the invalid field.

#### C-DOC-04 — Dangling endpoints

Given an edge whose source or target is absent, when validation runs, then the entire
document is rejected and no partial document becomes active.

#### C-DOC-05 — Invalid numbers and values

Given `NaN`, infinity, a nested attribute object, or another value outside
`GraphAttributeValue`, when validation runs, then it rejects that value at the public
boundary.

#### C-DOC-06 — Builder parity

Given equivalent direct document input and builder input, when both are normalized,
then they satisfy the same validation rules and yield equivalent structural data.

#### C-DOC-07 — No shared mutable public state

Given a consumer retains and mutates its input arrays after session creation, when the
engine later exports the document, then the engine's copy is unchanged.

### C-PATCH — Structural patches

#### C-PATCH-01 — Atomic multi-operation success

Given revision 4 and a valid patch containing node and edge additions, replacements,
and removals, when the patch is applied, then every operation is visible and the
document advances exactly once to revision 5.

#### C-PATCH-02 — Atomic rejection

Given a patch whose third operation creates a dangling edge, when it is applied, then
none of its operations are committed and the revision remains unchanged.

#### C-PATCH-03 — Stale revision

Given an active document at revision 5 and a patch based on revision 4, when it is
applied, then it returns `stale-revision` and makes no change.

#### C-PATCH-04 — Explicit incident-edge behavior

Given a connected node, when removal specifies `removeIncidentEdges: false`, then the
patch is rejected as dangling; when an otherwise equivalent patch specifies `true`,
then the node and its incident edges are removed atomically.

#### C-PATCH-05 — Stable patch result

Given a successful patch, when the consumer inspects the result and graph-changed
event, then both identify the patch, previous revision, and new revision without
forcing a full document export.

#### C-PATCH-06 — Replacement

Given an active session, when a valid newer document with the same or a different
document ID is supplied to `replaceDocument`, then the active document is completely
replaced and a replacement event is emitted; invalid replacement leaves the prior
document active.

### C-FILTER — Domain-neutral filtering

#### C-FILTER-01 — Boolean AST

Given nodes and edges with arbitrary tokens and attributes, when `all`, `none`,
`and`, `or`, and `not` ASTs are evaluated, then their set behavior is correct without
assigning meaning to any token or attribute name.

#### C-FILTER-02 — Membership and attributes

Given opaque IDs, tokens, scalar attributes, and scalar arrays, when `id-in`,
`has-token`, `attribute-equals`, `attribute-contains`, and numeric-range predicates
are evaluated, then only exact contract-defined comparisons affect membership.

#### C-FILTER-03 — Topology predicates

Given directed and undirected topology, when node filters use `connected-to` or
`within-depth` with incoming, outgoing, and either directions, then the selected node
sets match the requested traversal.

#### C-FILTER-04 — Invalid edge topology predicate

Given an edge AST containing `connected-to` or `within-depth`, when it is applied,
then the filter is rejected without replacing the active filter.

#### C-FILTER-05 — Node and edge filtering

Given independent node and edge predicates, when a filter is evaluated, then an edge
appears only when it matches the edge predicate and both endpoints survive the node
predicate.

#### C-FILTER-06 — Render scope

Given a force-laid-out graph, when a render filter hides elements, then those elements
are excluded from rendering and hit testing while source adjacency and layout forces
remain unchanged.

#### C-FILTER-07 — Projection scope

Given the same graph, when a projection filter excludes elements, then traversal,
adjacency, projection, and layout use the derived topology while the source document
remains unchanged.

#### C-FILTER-08 — Pipeline order

Given active projection and render filters, when both are applied, then projection
predicates evaluate against the source document, render topology predicates evaluate
against the projected graph, and the output follows the documented pipeline order.

#### C-FILTER-09 — Independent scope replacement

Given both scopes are active, when a new render request is applied, then only render
scope changes; clearing one scope preserves the other, while clearing without a scope
removes both.

#### C-FILTER-10 — Presentation boundary

Given a nonmatching element, when the V1 Filter module processes it, then the element
is hidden rather than dimmed or animated, and the AST contains no presentation
instruction.

### C-VIEW — View state

#### C-VIEW-01 — Default view

Given no restored state, when a session starts, then dimensions, enabled modules,
initial positions, and camera derive from validated profile defaults, position hints,
layout, and fit-to-graph behavior.

#### C-VIEW-02 — Export round-trip

Given positions, pins, camera, selection, focus, filters, and module state, when view
state is exported and restored into a compatible session, then all supported state
round-trips without entering the graph document.

#### C-VIEW-03 — Revision reconciliation

Given saved state from an older document revision, when it is restored against a
newer document, then unknown IDs are ignored, retained IDs recover their compatible
state, and new nodes receive ordinary placement.

#### C-VIEW-04 — Incompatible state

Given a wrong document ID, consumer ID, profile ID, schema, or irreconcilable state,
when restore is requested, then the engine returns a structured incompatibility error
without corrupting the current view.

#### C-VIEW-05 — Temporary view

Given a consumer never calls `exportViewState`, when the session is disposed and
recreated, then the engine uses profile defaults and does not attempt autonomous
per-document persistence.

#### C-VIEW-06 — Drag ownership

Given a node is dragged, when the drag ends, then only in-memory view position and a
domain-neutral drag intent change; graph document data remains unchanged.

#### C-VIEW-07 — Generic consumer persistence round-trip

Given a consumer previously persisted an exported graph document and view state,
when it supplies those values to a new session, then Graph Engine loads and visualizes
them; after accepted document or view changes, the consumer can export updated values
for its own persistence. Graph Engine neither requires this policy nor performs the
storage operation.

### C-PROFILE — Consumers, profiles, and settings

#### C-PROFILE-01 — Multiple archetypes

Given one consumer registers `student` and `instructor` profiles, when settings are
listed, then both appear under the same consumer with independent effective values
and no user-identity semantics.

#### C-PROFILE-02 — Precedence

Given values at engine defaults, user global, profile defaults, user profile
override, and session override layers, when effective settings are resolved, then
later permitted layers win in the documented order.

#### C-PROFILE-03 — Required, optional, and forbidden modules

Given module policies, when user or session overrides are applied, then required
modules cannot be disabled, forbidden modules cannot be enabled, and optional modules
follow permitted overrides.

#### C-PROFILE-04 — Constraints and locks

Given enum, numeric, read-only, and locked-value rules, when invalid overrides are
submitted, then they are rejected or normalized according to the declared rule and
locked values remain visible with an explanation.

#### C-PROFILE-05 — Re-registration

Given a registered profile with user overrides, when its descriptor is re-registered
at a newer descriptor version, then compatible overrides survive, incompatible values
are migrated or rejected, and no unrelated profile changes.

#### C-PROFILE-06 — Inactive consumer

Given a previously registered external consumer does not load, when settings open,
then its saved profiles remain visible as inactive until explicitly deleted.

#### C-PROFILE-07 — Namespace isolation

Given two consumers use the same profile ID or setting names, when values are stored
and resolved, then keys remain isolated by `consumerId/profileId`.

### C-VERSION — Structural and protocol versions

#### C-VERSION-01 — Independent schema rejection

Given an unsupported document, patch, view-state, or settings schema, when it crosses
its boundary, then the relevant boundary rejects it without inferring compatibility
from the installed Graph+ version.

#### C-VERSION-02 — Capability negotiation

Given a consumer requests supported and unsupported capabilities, when connecting,
then the lease advertises the negotiated set or returns `capability-unavailable`.

## 4. Mounted runtime acceptance scenarios

### R-MOUNT — Container and surface lifecycle

#### R-MOUNT-01 — Complete surface mount

Given an empty consumer-owned `HTMLElement`, when a session is created, then the
engine mounts its canvas and accessibility descendants inside that element without
claiming surrounding application UI.

#### R-MOUNT-02 — Container sizing

Given a container smaller than the Obsidian window, when it mounts and resizes, then
the viewport, hit testing, and pixel ratio follow the container rather than the main
window.

#### R-MOUNT-03 — Popout ownership

Given a container belonging to a secondary Obsidian window, when the session mounts,
then DOM construction, events, animation frames, and pixel ratio use that owning
document and window.

#### R-MOUNT-04 — Multiple session isolation

Given two sessions with different documents, profiles, filters, selections, and
camera states, when either changes, then the other remains unchanged.

#### R-MOUNT-05 — Suspension

Given a running session, when suspended or hidden, then expensive frame and physics
work pauses while document operations remain coherent; resumption continues without
duplicating resources.

#### R-MOUNT-06 — Complete disposal

Given a mounted and active session, when disposed, then all descendants, listeners,
observers, timers, animation frames, module instances, and callbacks are removed;
subsequent calls fail as `session-disposed`.

#### R-MOUNT-07 — Idempotent lifecycle requests

Given repeated suspension or disposal requests, when they occur, then they do not
duplicate work, leak resources, or revive a disposed session.

### R-INPUT — Interaction and intents

#### R-INPUT-01 — Pan-unfocused wheel contract

Given no focused node, when the unmodified wheel gesture occurs, then it pans rather
than orbits; with focus active, the configured focused behavior may orbit.

#### R-INPUT-02 — Camera controls

Given pointer, wheel, touch, and keyboard inputs, when generic navigation gestures
occur, then pan, orbit, zoom, reset, and fit commands update only the session view.

#### R-INPUT-03 — Selection and focus

Given visible nodes, when selection and focus interactions occur, then the session
state changes and exactly one corresponding domain-neutral intent is emitted.

#### R-INPUT-04 — Activation

Given a hit-tested node, when primary, secondary, or keyboard activation occurs, then
a `node-activated` intent identifies the node and activation form without opening an
Obsidian file or invoking a consumer action itself.

#### R-INPUT-05 — Filtered hit testing

Given a node hidden at render or projection scope, when input occurs at its previous
screen location, then it cannot be selected, focused, dragged, or activated.

#### R-INPUT-06 — Drag intent

Given a visible draggable node, when dragging ends, then its view position changes and
one `node-drag-ended` intent includes its neutral ID and position.

#### R-INPUT-07 — Revision-bearing intents

Given the document revision changes between input collection and consumer handling,
when an intent is delivered, then it carries the revision that produced it so the
consumer can reject stale product actions.

### R-MODULE — Module lifecycle and failure

#### R-MODULE-01 — Optional Anima stub

Given Anima is enabled in an optional profile, when a session runs, then its empty V1
lifecycle initializes, exports/restores valid empty state, suspends, and disposes
without changing required rendering behavior.

#### R-MODULE-02 — Optional failure isolation

Given an optional module throws during setup or a later hook, when the failure is
observed, then that module is disabled for the affected session where possible, a
recoverable structured error is emitted, and other sessions continue.

#### R-MODULE-03 — Required failure

Given a required module fails, when session creation or execution reaches it, then
the session fails explicitly or enters a documented fatal unavailable state rather
than silently degrading.

#### R-MODULE-04 — Dependency and conflict validation

Given missing dependencies or conflicting enabled modules, when a profile is
resolved, then session creation fails before partial module activation.

#### R-MODULE-05 — Lifecycle ordering

Given enabled modules contribute document, projection, frame, force, or render hooks,
when the session runs and disposes, then hook ordering is deterministic and reverse
cleanup completes even after a partial setup failure.

## 5. Service acceptance scenarios

### S-CONNECT — Discovery and leases

#### S-CONNECT-01 — Engine-first load order

Given Graph+ has registered its request listener and announced availability, when an
external consumer requests protocol 1, then exactly one compatible lease is returned.

#### S-CONNECT-02 — Consumer-first load order

Given the consumer listens and requests before Graph+ is ready, when availability is
later announced, then its retry obtains one lease without duplicate registration or
sessions.

#### S-CONNECT-03 — Missing or disabled provider

Given Graph+ is absent or disabled, when a client connection times out or receives
unavailability, then its helper renders the approved fallback inside the supplied
container and unrelated consumer features remain usable.

#### S-CONNECT-04 — Protocol incompatibility

Given provider and consumer have no common protocol version, when connection is
attempted, then `protocol-incompatible` is returned and no lease is created.

#### S-CONNECT-05 — Ambiguous providers

Given more than one provider responds to the same request, when discovery completes,
then the client returns `ambiguous-provider` rather than selecting silently.

#### S-CONNECT-06 — Engine unload

Given active external leases and sessions, when Graph+ unloads, then sessions are
disposed or invalidated, leases reject later calls, and unavailability is announced.

#### S-CONNECT-07 — Reload and stale handles

Given Graph+ reloads with a new engine instance ID, when a consumer reconnects, then
new sessions work while every old lease and session rejects calls as stale or
unavailable.

#### S-CONNECT-08 — Lease release

Given a consumer owns multiple sessions, when it releases its lease, then its sessions
are disposed and registration/runtime resources are released without affecting other
consumers.

#### S-CONNECT-09 — Callback and event cleanup

Given repeated connect, fail, reconnect, and release cycles, when the cycles finish,
then Workspace Event listeners and pending reply callbacks return to their baseline
counts.

## 6. Graph+ bundled-consumer acceptance scenarios

### G-LAZY — Dormancy and activation

#### G-LAZY-01 — Dormant plugin load

Given Obsidian loads Graph+ and no consumer requests a session, when startup settles,
then the engine service is available but the Graph+ consumer performs no vault scan,
graph construction, physics setup, renderer construction, animation loop, or
view-specific listener registration.

#### G-LAZY-02 — Open command

Given the user invokes `Open: graph+`, when the command completes, then Graph+ opens
or reveals its tab, loads and validates compatible saved graph and view state when
available, obtains a local public-contract lease, mounts one session, and reconciles
the active graph against the authoritative notes-and-tags vault scan.

#### G-LAZY-03 — Saved-view restoration

Given Obsidian restores a saved Graph+ leaf, when its container becomes available,
then the same activation flow creates a session without requiring the command.

#### G-LAZY-04 — Repeated open

Given a Graph+ view already exists, when the open command is invoked again, then the
documented reveal-or-create policy does not accidentally duplicate scans, sessions,
or listeners.

#### G-LAZY-05 — Built-in consumer disabled

Given the bundled Graph+ consumer is disabled while the engine service remains
enabled, when Obsidian runs, then Graph+ view commands and sessions are absent while
an external synthetic consumer can still acquire a lease and mount a graph.

### G-ADAPTER — Notes and tags

#### G-ADAPTER-01 — Supported fixture projection

Given a committed vault fixture containing notes, resolved note links, and nested and
flat tags, when the adapter scans it, then it produces stable neutral IDs, note and
tag nodes, and only the supported relationships defined by Graph+ V1.

#### G-ADAPTER-02 — Deferred source types

Given attachments, Canvas files, and unresolved links in the fixture, when V1 scans,
then it omits those node types without preventing equivalent opaque nodes supplied by
another consumer.

#### G-ADAPTER-03 — Obsidian-reference boundary

Given a built Graph+ document, when its public values are inspected or serialized,
then no `TFile`, vault, metadata-cache, plugin, or other Obsidian runtime object is
present; Graph+ retains its lookup map privately.

#### G-ADAPTER-04 — Incremental vault change

Given an open Graph+ session, when supported vault metadata adds, changes, renames, or
removes notes, tags, or links, then Graph+ submits a valid replacement or atomic
patch and keeps document revisions coherent.

#### G-ADAPTER-05 — Product intent translation

Given the engine emits node activation for a note or tag ID, when Graph+ handles it,
then Graph+ uses its private lookup and Obsidian adapter to perform the product action;
the engine does not know or invoke that action.

#### G-ADAPTER-06 — Filter compilation boundary

Given Graph+ exposes note/tag-oriented filter controls, when the user changes them,
then Graph+ compiles that vocabulary to the neutral AST and the engine receives no
hard-coded note, tag, path, or Obsidian predicate.

### G-PERSIST — Namespaced persistence and recovery

#### G-PERSIST-01 — Logical namespaces

Given engine settings, profile overrides, Graph+ consumer settings, graph data, and
view state, when plugin data is saved, then engine-owned and Graph+-consumer-owned
values occupy separate versioned namespaces.

#### G-PERSIST-02 — Independent migrations

Given old engine settings with current Graph+ data, or current engine settings with
old Graph+ data, when loading occurs, then each namespace migrates independently.

#### G-PERSIST-03 — Consumer corruption isolation

Given corrupt Graph+ consumer state and valid engine settings, when Graph+ opens,
then the consumer falls back to recoverable defaults without rewriting engine
settings or invalidating external leases.

#### G-PERSIST-04 — Engine settings corruption isolation

Given corrupt engine settings and valid Graph+ consumer state, when Graph+ loads,
then the engine reports or repairs only its namespace according to migration policy;
Graph+ data is not silently discarded.

#### G-PERSIST-05 — Persistence policy

Given a vault-derived document and active view state, when Graph+ persists them, then
its consumer explicitly calls `exportDocument()` and `exportViewState()` and writes
the results in its namespace; the engine performs no hidden consumer-document write.

#### G-PERSIST-06 — Save on controlled close

Given an open Graph+ session with accepted graph or view changes, when its view closes
normally, then Graph+ flushes any pending export and durably saves the complete neutral
graph document and compatible view state before disposing the session.

#### G-PERSIST-07 — Load saved graph on reopen

Given a valid saved Graph+ document and compatible view state, when Graph+ opens, then
it loads and mounts that saved document rather than requiring a complete vault rebuild
before the first graph can appear.

#### G-PERSIST-08 — Reconcile saved graph with vault

Given a valid saved graph but the vault changed while Graph+ was closed, when opening
reconciliation completes, then additions, removals, renames, tag changes, and link
changes are reflected through a coherent patch or replacement, the vault-derived
result is active, and it becomes the next state eligible for persistence.

#### G-PERSIST-09 — Missing or unusable saved graph

Given no saved graph, an unsupported saved schema, or corrupt saved graph data, when
Graph+ opens, then it reconstructs a valid document from the vault, reports or records
the recovery appropriately, and does not overwrite independently recoverable engine
settings or view state.

#### G-PERSIST-10 — Change checkpointing and unload safety

Given Graph+ remains open after accepted document or view changes, when its configured
debounce settles, then it saves the same explicit exports used at close. Given plugin
unload, Graph+ requests a best-effort final flush, but reopening correctness relies on
the latest completed checkpoint rather than assuming unload can await storage.

### G-PARITY — Existing behavior and public-contract dogfooding

#### G-PARITY-01 — Synthetic consumer capability parity

Given a neutral synthetic external consumer and the bundled Graph+ consumer request
the same profile capabilities, when they create equivalent sessions, then every
engine operation used by Graph+ is available to the synthetic consumer.

#### G-PARITY-02 — Import boundary

Given the production build dependency graph, when architecture checks run, then the
Graph+ consumer imports only public contracts/client and its own adapter code, never
private renderer, physics, scene, settings-store, or module implementation classes.

#### G-PARITY-03 — Local and event transport parity

Given equivalent local and Workspace Events leases, when contract conformance tests
run against both, then validation, operations, events, errors, lifecycle, and
capability results are equivalent.

#### G-PARITY-04 — Command-pipeline characterization

Given the existing InputBuffer → UIInterpreter → CommandBuffer → Commander behavior,
when characterization fixtures run before and after extraction, then generic input
and camera behaviors retained by the contract produce equivalent observable results.

#### G-PARITY-05 — Existing Form and Filter preservation

Given supported Graph+ note/tag fixture data, when existing free view, filter, and
Form behaviors are invoked through the new session boundary, then their approved
observable graph, focus, camera, and projection behavior remains available without
mutating the canonical document.

#### G-PARITY-06 — Consumer failure isolation

Given Graph+ vault adapter or view initialization fails, when an external consumer
already holds a healthy lease, then its session continues and the Graph+ failure is
reported only on the affected surface.

## 7. Platform smoke matrix

The final release candidate is exercised in these environments where available:

| Environment | Required observations |
| --- | --- |
| Obsidian desktop, main window | Open/reveal, mount, resize, input, persistence, close/dispose |
| Obsidian desktop, popout window | Owning-document DOM, input, RAF, theme, pixel ratio, disposal |
| Obsidian mobile | Touch navigation, resize/orientation, suspension/resume, disposal |
| Two simultaneous consumers | Profile/session isolation and independent failure |
| Plugin disable/re-enable | Fallback, invalidation, reconnect, no stale resources |

2D is proven through normal rendering and interaction scenarios. The 3D profile is
accepted when perspective projection, orbit, depth-aware hit testing, and exported
camera/positions behave coherently; it need not introduce a separate product UI.

## 8. Required fixtures and harnesses

Step 4 may implement these with different tools, but acceptance requires equivalent
coverage:

- a pure contract fixture builder for nodes, edges, documents, patches, profiles, and
  view state;
- seeded layout, fake clock, RAF, resize, visibility, and pixel-ratio controls;
- instrumented containers that can detect leaked DOM and runtime resources;
- a fake Workspace Events bus supporting load-order and multi-provider cases;
- a neutral synthetic external consumer using only the shipped client/contracts;
- a small committed Obsidian fixture vault covering supported and deferred sources;
- a local-lease and external-lease conformance suite sharing the same test vectors;
- Graph+ command-pipeline characterization fixtures captured before extraction;
- an import-boundary check preventing Graph+ from reaching engine internals.

The current seven-test single-file runner is sufficient for initial characterization,
but the migration plan must introduce test organization and browser/runtime support
before extraction makes mounted-session behavior a critical dependency.

## 9. Migration gates

These gates order proof, not source-file movement.

### Gate A — Contract baseline

- Approved contract types compile in a contracts-only package or boundary.
- C-DOC, C-PATCH, C-FILTER, C-VIEW, C-PROFILE, and C-VERSION scenarios are mapped to
  automated tests.
- Existing Graph+ tests still pass unchanged.

### Gate B — Runtime shell

- A neutral synthetic consumer mounts a session without importing Obsidian.
- R-MOUNT, R-INPUT, and R-MODULE scenarios pass for the new runtime shell.
- Anima is optional and empty; no current experimental Anima behavior is required.

### Gate C — Service and profile host

- Local and Workspace Events transports pass the same conformance suite.
- Consumer/profile settings appear and resolve according to the contract.
- Missing, load-order, unload, reload, and stale-lease scenarios pass.

### Gate D — Graph+ adapter conversion

- Notes/tags fixture projection and lookup behavior pass.
- Graph+ opens exclusively through a public-contract local lease.
- The import-boundary and synthetic-consumer parity checks pass.
- Existing supported controls, Form, Filter, navigation, and command behavior meet
  characterization expectations.

### Gate E — Persistence and platform hardening

- Namespaced migration, corruption recovery, and optional view persistence pass.
- Desktop, popout, and mobile smoke matrices pass.
- Disable/re-enable and multiple-consumer lifecycle leave no leaked resources.

### Gate F — PatternSmith-ready handoff

- The public contracts/client artifact is documented and consumable without Graph+
  source imports.
- A neutral consumer demonstrates document load, patches, both filter scopes,
  intents, view export/restore, profiles, and disposal.
- PatternSmith-specific projection work remains a separate reviewed change.

No gate is satisfied by file movement alone. Each gate requires its relevant
observable scenarios and the full previously satisfied suite.

## 10. Review decisions for Step 3

Approval of this plan confirms:

1. These scenarios adequately express the V1 contract.
2. Browser/DOM runtime behavior receives automated coverage rather than manual-only
   confidence.
3. The neutral synthetic consumer precedes Graph+ extraction.
4. Graph+ command behavior is characterized before generic mechanics move.
5. PatternSmith is not used as the extraction test bed.
6. The migration gates may now be converted into an implementation sequence.

After approval, Step 4 produces the concrete migration plan: target package/folder
topology, dependency direction, source-to-destination seam map, ordered work slices,
compatibility strategy, and commit/release checkpoints. Production code remains
unchanged until that plan is reviewed.

The Step 4 artifact is [Graph Engine V1 Migration Plan](graph-engine-v1-migration-plan.md).
