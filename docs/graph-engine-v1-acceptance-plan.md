# Graph Engine V1.1 Acceptance Plan

Status: Automated acceptance complete; desktop, popout, and mobile smoke pending

Baseline: V1 extraction implemented; these scenarios cover the additive V1.1 contract

Date: 2026-08-22

Depends on: [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)

## 1. Purpose

This plan translates the V1.1 contracts into observable scenarios. It retains the V1
baseline and adds acceptance for engine-owned configurable UI, consumer-registered
node click actions, profile-backed dimension switching, and dimension-aware Form. It
defines what must remain true as the implemented V1 platform is revised so that:

- a domain-neutral Graph Engine kernel;
- a set of optional or required engine modules;
- a public lease service;
- and a bundled Graph+ consumer using the same session contract as external plugins.

This is not an implementation sequence. The subsequent remediation plan may choose
different internal seams, but it may not weaken these outcomes without returning to
contract review.

PatternSmith integration is represented by a neutral synthetic consumer in V1.1.
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

#### C-VIEW-08 — Active dimension export

Given a profile that allows both dimensions, when the effective dimension changes
from `2d` to `3d` or from `3d` to `2d`, then exported view state identifies the new
active dimension and contains a compatible camera and finite positions without
changing the graph document.

#### C-VIEW-09 — Dimension change preserves view identity

Given active filters, Form root/settings, selection, focus, and pinned-node identity,
when the effective dimension changes, then those identities and policies remain active
while derived positions, projection, and camera are recomputed for the new dimension.

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

#### C-PROFILE-08 — Allowed dimensions

Given a profile default and `allowedDimensions`, when user-profile or session overrides
are resolved, then an allowed `2d` or `3d` value wins according to normal precedence
and a disallowed value is rejected without changing the prior effective setting.

#### C-PROFILE-09 — Locked dimension

Given a profile whose allowed-dimension list contains one value, when settings are
listed or overrides are attempted, then the profile remains in that dimension and no
editable dimension control is exposed.

#### C-PROFILE-10 — UI policy namespace

Given consumers with different quick-settings visibility, section/control exposure,
core context actions, and interaction action IDs, when profiles resolve, then every
UI policy remains isolated by `consumerId/profileId` and user overrides cannot reveal
controls hidden by the consumer.

### C-VERSION — Structural and protocol versions

#### C-VERSION-01 — Independent schema rejection

Given an unsupported document, patch, view-state, or settings schema, when it crosses
its boundary, then the relevant boundary rejects it without inferring compatibility
from the installed Graph Engine version.

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

Selection is a zero-or-more-node chosen set; focus is an optional single
keyboard/navigation and camera-interaction reference. Given a primary node click, the
default interaction may set both to that node. Given a selected and focused node, when
a primary background drag crosses the pan threshold, then selection and focus both
clear, each applicable change emits exactly one intent, the threshold-crossing movement
is included in the pan, and no selected or focused highlight remains. A secondary 3D
orbit does not implicitly clear either state.

#### R-INPUT-04 — Activation

Given an unfocused hit-tested node, when it receives a stationary primary click, then
it becomes selected and focused without invoking a consumer action. Given that same
node remains focused, when it receives a later stationary primary click, then the
first available registered activation action runs exactly once and the corresponding
revision-bearing activation intent identifies the node.

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

#### R-INPUT-08 — Keyboard activation parity

Given a focused node with an available primary action, when Enter is pressed outside
an editable/native control, then the same resolved action used by focused-node click
runs exactly once. Repeated, composing, modified, or already-prevented key events do
not invoke it.

#### R-INPUT-09 — Primary action is first context item

Given several applicable consumer and core actions, when the focused node's context
menu opens, then the resolved primary activation action is the first enabled item,
other configured consumer actions follow in declared order, and applicable engine
view actions follow after a separator.

#### R-INPUT-10 — No unsafe activation fallback

Given every configured activation action is unavailable or unregistered, when an
already-focused node is clicked or Enter is pressed, then no action runs. Pin, Mind
Map, or another context-only action is never selected as an implicit fallback.

#### R-INPUT-11 — Context gesture behavior

Given a hit-tested node, when stationary secondary click, stationary long-press, or
supported pen context input occurs, then exactly one context menu opens without
changing selection or focus and one diagnostic `node-context-requested` intent remains
available. Movement beyond the threshold cancels the menu gesture.

#### R-INPUT-12 — Drag wins over click

Given a node press begins, when movement crosses the node-drag threshold, then neither
focus-state activation nor a context action runs, and the existing engine drag policy
and single `node-drag-ended` intent remain authoritative.

#### R-INPUT-13 — Action availability and dynamic labels

Given registered actions whose labels or availability differ by node, when menus and
activation resolve for those nodes, then the engine uses the current node context,
shows only applicable actions, and never asks the engine to interpret consumer domain
meaning.

#### R-INPUT-14 — Action failure and busy isolation

Given an asynchronous action is running, throws, rejects, or observes a stale document
revision, when repeated activation or failure occurs, then duplicate invocation is
guarded, the failure is reported against that consumer action, and the session, other
actions, and other consumers remain usable.

#### R-INPUT-15 — Action registration lifecycle

Given two consumers register identical local action IDs, when their sessions resolve
actions, then IDs remain consumer-namespaced. Disposing the registration, lease, or
provider removes its callbacks, and no stale action can execute after reconnect.

#### R-INPUT-16 — V1.1 click-only extension boundary

Given the shipped public contract/client, when its API surface is inspected, then it
offers node click-action registration but no edge/background action registration, raw
DOM event subscription, modifier remapping, custom gesture recognizer, continuous drag
callback, custom drag physics, or replacement camera-control hook.

#### R-INPUT-17 — Mobile dimension-consistent primary pan trial

Given either a `2d` or `3d` mobile session and a one-finger drag beginning on the
background, when the pan threshold is crossed, then the camera pans, focus/selection
clear exactly once, and no orbit occurs. A one-finger drag beginning on a draggable
node continues to use node-drag arbitration.

#### R-INPUT-18 — Mobile two-finger dimensional behavior

Given a `3d` mobile session, when a two-finger drag crosses the translation threshold
without qualifying as pinch, then the camera orbits with the same directional mapping
whether or not a node is focused and retains focus/selection. Given a `2d` session, the
same gesture never rotates the camera and may translate the pan centroid. In either
dimension, crossing the pinch scale threshold gives zoom priority and does not also
produce an accidental node drag or discontinuous orbit.

### R-UI — Engine-owned configurable session UI

#### R-UI-01 — Whole quick-settings visibility

Given otherwise equivalent sessions configured as `shown`, `collapsed`, and `hidden`,
when they mount, then the first exposes the panel, the second exposes its reopening
control, and the third mounts no quick-settings UI while all three retain equivalent
engine capabilities.

#### R-UI-02 — Selective stock exposure

Given a profile hides selected sections and individual controls, when quick settings
render, then only declared stock controls appear. A hidden Filter or Form section does
not disable its required module or prevent the consumer from using the corresponding
public session API.

#### R-UI-03 — Disabled module differs from hidden UI

Given one session hides an enabled optional module's section and another disables that
optional module while marking its section shown, when both mount, then the hidden
module remains operational through public APIs while the disabled module has no active
controls or lifecycle. Required and forbidden policies remain enforceable.

#### R-UI-04 — Consumer quick-setting contribution

Given a consumer contributes a control into a stock or custom section, when the panel
mounts, rerenders, collapses, reopens, and disposes, then the engine owns its section
placement and lifecycle, the contribution receives only public context, and its
disposable runs exactly once per mount lifecycle.

#### R-UI-05 — Profile setting edit and reset

Given a stock display, camera, or force control, when the user changes it,
then the user override is written only to the active `consumerId/profileId` and all
sessions affected by that profile setting update coherently. Double-click/reset clears
the override and immediately reveals the next effective value and source.

#### R-UI-06 — Transient controls remain view state

Given Filter, Form root/configuration, selection, focus, or camera-position controls,
when they are manipulated from quick settings, then the active view changes but those
values are not written as durable user-profile settings. They persist only if the
consumer exports and saves compatible view state.

#### R-UI-07 — Domain-facing filter shim

Given a synthetic external consumer hides all stock sections, keeps Filtering enabled,
and contributes only `Filter by due nodes`, when its callback supplies consumer-chosen
node IDs through a neutral AST, then the engine applies and clears the filter without
learning `due`, rendering any hidden stock Filter UI, or affecting another profile.

#### R-UI-08 — Context menu opt-out

Given the engine-owned context menu is disabled, when a context gesture occurs, then
no stock menu mounts but the generic context-request intent still emits so the consumer
may render its own surface. Disabling the menu does not disable registered actions or
other session APIs.

#### R-UI-09 — Responsive and safe-area ownership

Given desktop, narrow sidebar, mobile safe-area, and popout containers, when the quick
settings or context menu opens near every edge, then all actionable controls—including
the close button—remain readable, reachable, and inside the owning container/window's
usable area without changing the consumer's surrounding layout.

#### R-UI-10 — Narrow Search control reflow

Given the photographed narrow mobile Graph+ panel or an equivalently narrow fixture,
when the Refine section renders, then `Search` remains one intact readable word, the
syntax hint does not split words or filter tokens into arbitrary fragments, and the
search input receives a full-width row beneath the label/description when necessary.
The section introduces neither horizontal scrolling nor clipped text.

#### R-UI-11 — Collapsed launcher avoids host actions

Given an Obsidian mobile leaf with a host-owned top-right action and a collapsed Graph
Engine quick-settings panel, when the launcher is positioned and the host chrome,
orientation, or viewport changes, then the launcher and host action have disjoint hit
targets and remain independently visible and operable. The same rule applies to
desktop leaf actions and consumer-declared embedded-layout occlusions.

### R-DIM — Live dimensional mode

#### R-DIM-01 — Persistent profile setting

Given a profile that permits `2d` and `3d` and exposes the dimension control in Graph
Engine's persistent settings page, when the user changes it, then the effective profile
value, source metadata, rendered projection, and exported view dimension update without
replacing the session canvas or document. No dimension control appears in the session's
quick-settings panel.

The control is user-selectable only when the consumer permits both values and exposes
it. A consumer may hide the control, set either default, or enforce one dimension; all
UI and programmatic attempts outside `allowedDimensions` are rejected consistently.

#### R-DIM-02 — Session override isolation

Given two sessions share a consumer/profile and one supplies a session dimension
override, when the user profile dimension changes, then ordinary sessions follow the
profile while the valid session override remains isolated to its mount.

#### R-DIM-03 — Camera and finite-layout conversion

Given a settled graph in either dimension, when its dimension changes, then `2d` uses
a coherent orthographic camera and planar positions, `3d` uses a coherent perspective
camera and depth-capable positions, every exported number remains finite, and no node
or edge identity changes.

#### R-DIM-04 — Repeated switching stability

Given selection, focus, pins, filters, and a settled layout, when `2d`/`3d` is switched
repeatedly, then identities and policies remain stable, resources do not multiply,
physics can settle after each recomputation, and switching does not accumulate camera
or position corruption.

### R-FORM — Dimension-aware Form and Mind Map

#### R-FORM-01 — Planar 2D Form

Given Form is enabled in a `2d` session, when a Mind Map is built from a valid root,
then all derived positions use `z: 0` while root, traversal direction, relation, depth,
cross-link, branch-color, and disconnected-node policies are honored.

#### R-FORM-02 — Genuinely spatial 3D Form

Given the same nontrivial fixture and Form settings in a `3d` session, when its Mind
Map is built, then multiple eligible non-root nodes occupy meaningfully different
finite z positions, branches remain distinguishable, and the result is not a planar
2D layout viewed through a perspective camera.

#### R-FORM-03 — Active Form dimension switch

Given an active Mind Map with a selected root and active filters, when dimensions
change, then the engine rebuilds Form in the new dimensional mode from the same root
and policies, frames the result, preserves selection/focus where valid, and leaves the
canonical document and filter ASTs unchanged.

#### R-FORM-04 — Deterministic seeded invariants

Given identical documents, roots, settings, dimensions, and seeded layout sources,
when Form is rebuilt, then its branch/depth invariants and dimensional character are
repeatable without requiring fragile unconstrained floating-point snapshots.

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

#### S-CONNECT-10 — Node-action transport parity

Given equivalent node actions registered through local and Workspace Events leases,
when action conformance scenarios run, then namespacing, ordering, availability,
invocation, errors, disposal, release, and reconnect behavior are equivalent. No
transport grants Graph+ private or additional action capabilities.

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

Given Graph+ registers its `open-node` action and a focused note or tag node is clicked
again or activated by Enter, when the engine invokes the registered callback, then
Graph+ uses its private lookup and Obsidian adapter to open the corresponding note or
tag. The engine invokes the opaque action but does not understand its domain meaning or
receive an Obsidian object.

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

#### G-PARITY-07 — Engine-owned controls parity

Given Graph+ and a synthetic external consumer request the same UI exposure and
dimension capabilities, when their sessions mount, then both receive the same engine
quick-settings sections, profile-scoped edits, persistent profile dimension setting,
core context actions, safe-area behavior, and lifecycle without importing Graph+ UI
classes. Neither session quick-settings panel exposes the dimension selector.

#### G-PARITY-08 — Consumer UI and action customization

Given Graph+ contributes note/tag controls and `open-node` while a synthetic consumer
hides stock controls and contributes `Filter by due nodes` plus `start-drill`, when both
run simultaneously, then each surface shows and invokes only its own profile-selected
contributions and neither consumer's callbacks or settings appear in the other.

#### G-PARITY-09 — Graph+ dimensional Form

Given the Graph+ profile permits both dimensions, when the user switches between `2d`
and `3d` in free graph and Mind Map modes, then its canonical note/tag document remains
unchanged, the effective profile value persists, and Mind Map satisfies the planar or
spatial Form criteria for the selected mode.

## 7. Platform smoke matrix

The final release candidate is exercised in these environments where available:

| Environment | Required observations |
| --- | --- |
| Obsidian desktop, main window | Open/reveal, mount, resize, click actions, quick settings, 2D/3D, Form, persistence, close/dispose |
| Obsidian desktop, popout window | Owning-document DOM, input, UI placement, RAF, theme, pixel ratio, disposal |
| Obsidian mobile | Touch focus/activation, long-press menu, intact Search layout, non-overlapping collapsed launcher, safe areas, 2D/3D, resize/orientation, suspension/resume, disposal |
| Two simultaneous consumers | UI/action/profile/session isolation and independent failure |
| Plugin disable/re-enable | Fallback, invalidation, reconnect, no stale resources |

2D and 3D are selected through the permitted persistent profile setting rather than
session quick settings. The 3D mode is accepted when perspective projection, orbit,
depth-aware hit testing, exported camera/positions, repeated switching, and spatial
Mind Map behavior are coherent.

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
- a consumer-action fixture covering dynamic availability, ordering, async failure,
  disposal, stale revisions, and local/external lease parity;
- instrumented quick-settings and context-menu hosts covering visibility, custom
  contributions, profile writes, safe areas, and teardown;
- seeded free-graph and Form fixtures with enough topology to distinguish planar 2D
  output from genuinely spatial 3D output;
- retained Graph+ command-pipeline characterization fixtures;
- an import-boundary check preventing Graph+ from reaching engine internals.

The existing organized core/runtime/service/Graph+ suites remain the regression
baseline. New V1.1 scenarios require equivalent automated placement plus repeatable
desktop/mobile smoke evidence where Obsidian-native rendering or safe areas cannot be
proved headlessly.

## 9. Migration gates

These gates order proof, not source-file movement. Gates A through F remain regression
requirements from V1; Gate G is the additive V1.1 release gate.

### Gate A — Contract baseline

- Approved contract types compile in a contracts-only package or boundary.
- C-DOC, C-PATCH, C-FILTER, C-VIEW, C-PROFILE, and C-VERSION scenarios are mapped to
  automated tests.
- Existing Graph+ tests still pass unchanged.

### Gate B — Runtime shell

- A neutral synthetic consumer mounts a session without importing Obsidian.
- R-MOUNT, R-INPUT, R-UI, R-DIM, R-FORM, and R-MODULE scenarios pass for the runtime
  shell.
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
  intents, view export/restore, profiles, configurable engine UI, custom quick-setting
  and click actions, dimension policy, and disposal.
- PatternSmith-specific projection work remains a separate reviewed change.

### Gate G — V1.1 additive release

- Additive public types compile for existing consumers that do not opt into V1.1 UI
  or action registration.
- All new C-PROFILE, C-VIEW, R-INPUT, R-UI, R-DIM, R-FORM, S-CONNECT, and G-PARITY
  scenarios pass alongside the complete V1 regression suite.
- Graph+ uses the engine-owned controls/context menu and registered `open-node` action;
  no Graph+-specific UI class is required by an external consumer.
- A synthetic external smoke consumer proves hidden stock UI, a domain-facing filter
  shim, a registered primary action, and independent profile settings.
- Desktop, popout, and mobile smoke checks pass for safe areas, click/keyboard action
  parity, intact narrow Search layout, non-overlapping host/engine controls, live
  dimension switching, and 3D Mind Map.

No gate is satisfied by file movement alone. Each gate requires its relevant
observable scenarios and the full previously satisfied suite.

## 10. V1.1 review decisions

Approval of this revision confirms:

1. Engine-owned UI can be omitted or selectively exposed without disabling hidden
   capabilities.
2. Consumer extensibility is limited to semantic node click actions in V1.1; drag,
   edge, background, raw-input, and camera remapping remain deferred.
3. Focused-node click and Enter invoke the same primary action displayed first in the
   context menu.
4. Dimensions are profile-backed, constrainable, live-switchable, and isolated by
   consumer/profile/session precedence.
5. Mind Map is planar in 2D and genuinely spatial in 3D while preserving the same
   domain-neutral Form semantics.
6. A synthetic external consumer—not PatternSmith domain implementation—is the
   conformance proof for custom UI/actions before PatternSmith product integration.
7. Automated core/runtime/service coverage and desktop/mobile visual smoke evidence
   are both required before V1.1 release acceptance.

After approval, the V1.1 remediation plan maps these scenarios to ordered code slices,
compatibility changes, checkpoints, and smoke-test updates before implementation.

After Gate G passes, work shifts to PatternSmith's real consumer integration. That
integration validates Graph Engine in a domain-rich external plugin and may produce a
separate backlog of engine defects or V1.2 proposals; it does not weaken Gate G or fold
PatternSmith learning semantics into Graph Engine.

The Step 4 artifact is [Graph Engine V1 Migration Plan](graph-engine-v1-migration-plan.md).

## 11. Release-candidate checkpoint — 2026-08-25

Automated Gate G evidence is complete:

- Graph Engine/Graph+ client build, typecheck, 120 contract/runtime/service/consumer
  tests, and production build pass at `c3ace33`;
- PatternSmith client vendoring, typecheck, 132 tests, and production build pass at
  `a95f267`;
- the PatternSmith vendor matches the Graph+ `1.1.0` public artifact byte-for-byte
  except for PatternSmith's additive provenance record;
- Graph+ consumes the engine-owned UI/action surfaces, while the external smoke
  consumer proves hidden stock sections, a domain-owned node-ID filter shim, a
  registered click action, and independent 2D/3D profile policy.

Gate G remains a release candidate—not a completed physical-platform acceptance—until
the desktop, popout, and mobile rows in the platform smoke matrix are exercised in
Obsidian. Those checks require rendered host chrome, touch gestures, safe areas, and
provider reload behavior that the automated harness does not emulate.
