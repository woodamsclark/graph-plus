# Graph Engine V1 External Consumer Smoke Contract

Status: Approved and implemented — manual Obsidian smoke pending

Date: 2026-08-22

Companion: [External Consumer Smoke Acceptance Checklist](external-consumer-smoke-acceptance.md)

## 1. Purpose

This contract defines the first integration of Graph Engine by code shipped from a
different Obsidian plugin repository. PatternSmith is the external consumer and test
harness, but PatternSmith product behavior is not the subject of this pass.

The pass answers one question:

> Can an outside Obsidian plugin obtain Graph Engine from the installed Graph+ plugin,
> mount a working graph inside its own UI, use the public API, own its persisted state,
> and cleanly survive provider and consumer lifecycle changes without importing Graph+
> implementation code?

A successful pass proves the installed-plugin delivery model in a real external
bundle. It does not accept PatternSmith's graph-centered learning experience and does
not replace Graph+'s own performance or platform testing.

## 2. Delivery topology

There is one runtime provider and two independent consumers:

```text
Installed Graph+ plugin
  Graph Engine provider
    <- local public lease <- bundled Graph+ vault consumer
    <- Workspace Events lease <- PatternSmith smoke consumer
```

PatternSmith bundles only the small compile-time contracts/client artifact. It does
not bundle a second Graph Engine runtime. At runtime it discovers and leases the
provider hosted by Graph+ through the documented Workspace Events protocol.

The compile-time artifact must be self-contained and consumable from PatternSmith's
repository. It may contain public V1 types, validation/reconciliation helpers, the
Workspace Events client, and the unavailable-surface helper. It must not re-export
files through paths inside the Graph+ source tree after installation into
PatternSmith.

## 3. Scope

### 3.1 Required

- a PatternSmith-owned command and surface that are used only for this smoke pass;
- lazy connection when that surface is requested, not during PatternSmith startup;
- provider discovery and lease acquisition through `GraphEngineWorkspaceClientV1`;
- one registered external consumer and at least one registered profile;
- a graph mounted inside an `HTMLElement` owned by PatternSmith;
- a small PatternSmith-owned neutral document and private ID lookup;
- public document replacement, patch, filter, intent, view-state, and disposal paths;
- PatternSmith-owned document and view-state persistence;
- missing-provider, provider-unload, provider-reload, and stale-handle behavior;
- simultaneous operation with the bundled Graph+ vault consumer; and
- automated boundary checks plus repeatable manual Obsidian checks.

### 3.2 Deliberately excluded

- PatternSmith scheduling, qualification, curriculum, Drill, or radial-session changes;
- a production PatternSmith graph home;
- deciding PatternSmith's final nodes, edges, tokens, profiles, or visual language;
- curriculum regions or gates in Graph Engine;
- automatic installation or enabling of Graph+;
- direct access to Obsidian's undocumented plugin manager;
- imports from Graph+ vault adapters, persistence, UI, runtime, renderer, physics,
  module registry, profile registry, or other private implementation paths;
- Graph+ label-density or large-vault performance corrections; and
- treating success here as mobile, popout, or release-candidate acceptance unless
  those environments are separately exercised.

## 4. Consumer identity and profile

The smoke consumer uses stable registration data so settings and persistence can be
inspected across reloads:

| Field | V1 value |
| --- | --- |
| `consumerId` | `pattern-smith` |
| Display name | `PatternSmith` |
| Smoke profile ID | `external-smoke` |
| Profile display name | `External smoke test` |
| Dimensions | `3d` |
| Requested capabilities | `render`, `camera`, `input`, `filter`, `layout`, `force-layout` |

The profile is an archetype/configuration preset, not a person. It exists to verify
external profile registration and settings resolution. PatternSmith may replace it
with production profiles in a later reviewed project.

The profile requires rendering and filtering. Force layout is optional and enabled by
default. Form and Anima are forbidden for this pass because they are not needed to
prove external embedding.

## 5. Smoke surface

PatternSmith owns a temporary command such as `Open Graph Engine smoke test`. Invoking
it opens a PatternSmith-owned view or modal containing:

- an ordinary HTML container into which Graph Engine mounts;
- a compact PatternSmith-owned diagnostic strip showing connection state, engine
  version/instance ID, session ID, document ID/revision, and last public error;
- consumer-owned controls sufficient to exercise add/remove patching, projection
  filtering, render filtering, clear filters, camera reset, and save/restore; and
- no dependency on PatternSmith's normal learner navigation.

The diagnostic strip is test harness UI, not an engine module. Graph Engine owns the
interactive graph inside the supplied container; PatternSmith owns the surrounding
surface.

Opening the smoke surface is lazy. Merely enabling or loading PatternSmith must not
request a lease, register a consumer, create a session, start a renderer, or modify
PatternSmith persistence.

## 6. Test document and ownership

For this pass, PatternSmith may use a committed neutral fixture rather than projecting
live learning state. The fixture must contain enough structure to exercise the public
contract:

- at least four nodes;
- at least three edges, including one directed edge;
- node and edge labels;
- multiple generic tokens and scalar attributes;
- stable opaque IDs; and
- no Graph+ vault semantics and no PatternSmith learning semantics required by the
  engine.

PatternSmith owns the fixture, its private ID lookup, all interpretation of tokens and
attributes, and every decision to patch or filter it. Graph Engine treats IDs, tokens,
and attributes as opaque graph data.

Graph Engine owns only the mounted in-memory session. It must not write PatternSmith's
document or view state and must not call PatternSmith domain services.

## 7. Connection and lifecycle contract

### 7.1 Open

When the smoke surface opens, PatternSmith:

1. constructs the Workspace Events adapter;
2. constructs `GraphEngineWorkspaceClientV1`;
3. requests protocol V1 with the required capabilities;
4. renders the standard unavailable surface if connection fails;
5. registers the consumer/profile after obtaining a lease;
6. loads its last valid saved document and compatible view state, falling back to the
   fixture and engine defaults independently when either saved value is unavailable;
7. creates exactly one session in its container; and
8. subscribes to public intents, graph changes, and errors.

Repeated reveal of the same live surface must not create duplicate leases, sessions,
renderers, or subscriptions.

### 7.2 Active use

PatternSmith may call only methods exposed by `GraphEngineLeaseV1` and
`GraphSessionV1`. It translates public intents through its private lookup. An intent
never directly invokes a PatternSmith domain command from inside Graph Engine.

Accepted document changes are obtained through `exportDocument()`. View state is
obtained through `exportViewState()`. PatternSmith may checkpoint these explicit
exports after accepted changes; it must not inspect private session state.

### 7.3 Close

On an ordinary close, PatternSmith:

1. exports and awaits the latest document and view state;
2. saves them under a PatternSmith-owned, versioned smoke namespace;
3. disposes all public subscriptions;
4. disposes the session;
5. releases the lease; and
6. removes all consumer-owned DOM and Workspace Events references.

Close is idempotent. A partial open or failed connection must be safe to close.

### 7.4 Provider unload and reload

If Graph+ unloads while the smoke surface is active, the old session and lease become
unavailable. PatternSmith must not reuse them or silently fall back to private access.
The smoke surface reports provider unavailability while the rest of PatternSmith
remains usable.

After Graph+ returns with a new `engineInstanceId`, reopening or explicitly
reconnecting the smoke surface obtains a new lease and session. Calls through old
handles must fail rather than affect the new provider. Automatic seamless recovery is
not required for this pass; unambiguous recovery initiated by reopen/reconnect is.

## 8. Mutation, filtering, and intent contract

The smoke harness must demonstrate:

- an atomic patch that changes the document revision and adds or removes graph data;
- rejection of a stale-revision patch without partial mutation;
- replacement or reload of the complete document;
- a projection filter affecting graph participation/layout without mutating the
  canonical document;
- a render filter affecting visibility without mutating the canonical document;
- node and edge filter ASTs constructed by PatternSmith;
- clearing each filter scope independently;
- at least one `node-activated` or selection intent reaching PatternSmith;
- at least one viewport or drag intent reaching PatternSmith; and
- camera and view-state export/restore through public methods.

Graph Engine does not parse PatternSmith vocabulary. PatternSmith either builds the
generic AST directly or supplies explicit ID lists.

## 9. Persistence contract

PatternSmith persists smoke data in its own plugin storage under one explicitly
versioned namespace, separate from learning data. At minimum it stores:

- the latest completed `GraphDocumentV1` export;
- the latest completed compatible `GraphViewStateV1` export; and
- its own smoke-data schema version.

The saved graph is restored when the smoke surface next opens. Invalid document data
falls back to the fixture without preventing view creation. Missing or incompatible
view state falls back to engine defaults without discarding a valid document.

Graph+ must not receive, merge, or save PatternSmith graph persistence. Opening or
closing Graph+ must not alter PatternSmith's saved smoke graph, and the reverse is also
required.

## 10. Isolation and security boundaries

- PatternSmith and Graph+ receive different leases and sessions.
- Session IDs and ownership must not collide.
- PatternSmith patches, filters, selections, camera changes, failures, close, and lease
  release must not alter or dispose Graph+'s graph.
- Graph+ vault rescans and Graph+ view close must not alter or dispose PatternSmith's
  graph.
- Consumer registration and settings remain namespaced by consumer/profile.
- The external client performs no filesystem, vault, or network access on behalf of
  Graph Engine.
- All executable engine modules are provider-owned; PatternSmith cannot inject module
  code through registration.

## 11. Compile-time artifact gate

Implementation of the external smoke consumer does not begin by importing Graph+
source relatively. First, the client artifact must satisfy all of the following:

- it is built or copied into a self-contained distributable directory;
- its public entry resolves entirely within that artifact;
- PatternSmith can typecheck and bundle after the Graph+ repository is moved or made
  unavailable to its bundler;
- its runtime code contains the Workspace Events client and unavailable helper but no
  provider implementation;
- its type declarations expose only the approved V1 boundary; and
- a license/version manifest and upgrade procedure identify what PatternSmith bundled.

Publication to a public package registry is not required for this smoke pass. A local
packed artifact or intentionally vendored generated artifact is acceptable if the
boundary and repeatable update procedure are proven.

## 12. Completion rule

This contract is complete only when every required item in the companion acceptance
checklist passes with evidence.

Passing means Graph Engine has been proven leaseable and embeddable by a real outside
Obsidian plugin. It does not mean PatternSmith's graph product has been designed, nor
does it waive unresolved Graph+ performance or UX work.
