# Graph Engine V1.1 Implementation Plan

Status: Implemented through Slice 10; automated gates pass, physical smoke pending

Date: 2026-08-25

Contract checkpoint: `ac601b5` (`docs: define graph engine v1.1 contracts`)

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.1 Acceptance Plan](graph-engine-v1-acceptance-plan.md)
- [Graph Engine V1 Migration Plan](graph-engine-v1-migration-plan.md)

Historical field evidence:

- [Graph+ Field Observation Backlog](graph-plus-field-observations-2026-08-22.md)
- [Graph+ Field Remediation Plan](graph-plus-field-remediation-plan-2026-08-22.md)

The field-remediation plan records the completed V1 stabilization work. It is not the
build order for V1.1; this document supersedes it only for the new V1.1 scope.

## 1. Outcome

V1.1 makes the shared-engine boundary visible in the product rather than merely
present in the runtime:

- Graph Engine owns an optional quick-settings surface and node context menu;
- every consumer receives the same UI host without importing Graph+ UI classes;
- consumers and profiles decide which stock UI is shown, hidden, or locked;
- consumers may contribute narrow domain controls without teaching Graph Engine their
  domain language;
- consumers register semantic node click actions such as Graph+ `open-node` or a later
  PatternSmith `start-drill`;
- `2d` or `3d` becomes a durable, consumer-constrained profile setting;
- Form produces a planar layout in 2D and a genuinely spatial layout in 3D;
- mobile interaction and engine UI satisfy the approved narrow-screen trial contract;
- the existing PatternSmith smoke consumer proves the external boundary before real
  PatternSmith learning integration begins.

This is an additive release over protocol V1. Existing consumers that do not request
V1.1 UI, actions, or dimension controls continue to compile and mount as before.

## 2. Non-negotiable boundaries

### 2.1 Domain ownership

Graph Engine remains ignorant of notes, tags, due items, drills, lessons, students, and
instructors. It accepts neutral documents, node IDs, filter ASTs, profiles, and
semantic action registrations.

Graph+ continues to own vault projection, note/tag vocabulary, note opening, and saved
Graph+ checkpoints. PatternSmith continues to own learning state, due calculation,
drill launch, and any durable learner graph.

### 2.2 UI ownership is not module ownership

Hiding Filter, Form, Forces, or another section hides only its stock control. It does
not disable the module or its public API. Module availability remains governed by
`required | optional | forbidden` policy.

The session quick-settings panel never contains the 2D/3D selector. Dimension is a
more durable Graph Engine profile setting shown only in Obsidian Settings when the
consumer permits and exposes it.

### 2.3 Click actions only

V1.1 consumer extensibility covers semantic node click actions. It does not add raw
pointer hooks, custom camera mappings, edge/background actions, modifier grammars,
custom drag physics, or replacement gesture recognizers.

The same action resolver determines:

1. the later click on an already-focused node;
2. Enter on the focused node; and
3. the first applicable context-menu item.

There is no fallback from an unavailable consumer action to Pin, Mind Map, or another
view mutation.

### 2.4 Consumer permanence

Graph Engine owns live graph construction and manipulation. Consumers own durable
documents and decide whether exported view state is saved. Profile settings may be
durable; active filters, Form root/configuration, selection, focus, and camera position
remain session state unless a consumer explicitly exports and saves them.

### 2.5 Host-neutral core

Contracts, core graph logic, runtime modules, and the client artifact contain no
Obsidian imports. The engine-owned Obsidian UI adapter may import `Menu`, `Setting`,
`Notice`, and host layout APIs because it is a host adapter, not part of the neutral
kernel.

## 3. Live architecture diagnosis

The V1 extraction is sound, but several V1.1 responsibilities still meet at product-
specific seams.

### 3.1 UI is mounted by Graph+

`src/obsidian/GraphPlusControlsPanel.ts` currently owns panel chrome, query controls,
Form, Display, Forces, status, and the node context menu. It receives a
`GraphPlusConsumerV1`, so an external consumer receives the canvas and intents but not
the same controls or menu.

The panel also owns the mobile layout defects captured in field evidence:

- `overflow-wrap: anywhere` can split `Search` and syntax tokens;
- the fixed/collapsed top-right placement can overlap Obsidian leaf actions;
- safe-area placement does not yet account for host or consumer occlusions.

### 3.2 Action behavior stops at intents

`SessionInteractionRuntime` emits `node-activated` and
`node-context-requested`. `GraphEngineProviderCore` tracks leases and sessions but has
no lease-scoped action registry. Consequently Graph+ interprets those events itself,
and the external smoke consumer cannot receive the same context/action behavior.

The interpreter also uses a 300 ms double-click heuristic. V1.1 instead uses stable
focus state: the first click focuses; a later click on that focused node invokes the
resolved primary action.

### 3.3 Dimensions are construction-time state

`ConsumerProfileRegistry` resolves one profile dimension, but the settings controller
cannot write a profile dimension override and registrations cannot constrain
`allowedDimensions`.

`GraphSessionRuntime.applyResolvedProfile()` currently rejects a dimension change
after mount. Camera, renderer, interaction, surface, and dimension-bound modules are
constructed around the original dimension. Saved view reconciliation also treats a
dimension mismatch as incompatible.

### 3.4 Form is always planar

`FormModule` currently emits radial positions with `z: 0`, and the shipped module
factory does not pass its dimension into the module. A perspective camera therefore
shows a flat Mind Map rather than a 3D Form.

### 3.5 Touch mapping reflects the pre-trial contract

The current interpreter makes a one-finger 3D background drag orbit and a two-finger
translation pan. V1.1 trials one-finger background pan in both dimensions, 3D
two-finger orbit, pinch-priority zoom, and no rotation in 2D.

### 3.6 Session override writes need one owner

`setSessionOverrides()` replaces the supplied override object. If the engine UI and a
consumer independently write partial settings, one can overwrite the other's active
values. V1.1 needs one internal merge path before settings controls move into the
engine-owned panel.

## 4. Target composition

```text
Obsidian Graph Engine plugin
├── Graph Engine provider
│   ├── host-neutral contracts/core/runtime/modules
│   ├── lease-scoped node action registry
│   ├── consumer/profile settings registry
│   └── Obsidian session UI host
│       ├── quick-settings panel
│       ├── node context menu
│       └── host-safe layout adapter
├── bundled Graph+ consumer
│   ├── vault → neutral document adapter
│   ├── Graph+ query/tag/orphan UI contributions
│   ├── open-node action
│   └── checkpoint persistence
└── external consumer lease
    ├── its own document and persistence
    ├── its own action registrations
    └── optional domain UI contributions
```

Suggested source layout:

```text
src/
├── graph-engine/
│   ├── contracts/v1/                # additive V1.1 public types
│   ├── core/profile/                # dimension and UI policy resolution
│   ├── runtime/
│   │   ├── actions/                 # action resolution/invocation primitives
│   │   ├── interaction/             # focus activation and touch trial
│   │   ├── reconfigure/             # live dimension transaction
│   │   └── modules/shipped/          # dimension-aware Form
│   └── service/                      # lease-scoped action registrations
├── graph-plus/
│   └── ui/                           # only Graph+ contributions
└── obsidian/
    └── graph-engine-ui/
        ├── GraphEngineSessionUiHost.ts
        ├── GraphEngineQuickSettingsPanel.ts
        ├── GraphEngineContextMenu.ts
        └── ObsidianGraphUiLayout.ts
```

Names may adjust during implementation. Dependency direction and ownership may not.

## 5. Internal ports

### 5.1 Public consumer surface

Consumers use only the versioned lease/session contracts:

- register consumer/profile definitions;
- create and dispose sessions;
- register and dispose node actions;
- supply session UI options and contributions;
- replace documents or apply patches;
- apply or clear neutral filters;
- export/restore view state;
- subscribe to public intents/errors/events.

External consumers do not receive runtime, scene, camera, renderer, module, or profile
registry objects.

### 5.2 Engine UI control port

The Obsidian UI host needs an internal, non-exported control port that can:

- read the effective profile settings and their winning sources;
- patch or clear one profile-setting override without replacing siblings;
- read and patch session module overrides through one merge owner;
- invoke stock transient operations such as filter clear, Form root change, or camera
  reset;
- observe session/profile changes for rerendering;
- resolve and invoke consumer actions through the same service-owned resolver.

Consumer contributions receive only `GraphUiContributionContextV1` and the public
session. They never receive this internal port.

### 5.3 Action registry

Action callbacks are registered against a lease and consumer namespace. The provider
owns ordering, availability checks, busy protection, stale-revision checks, error
isolation, and disposal. Profiles store ordered IDs only; callbacks are never
persisted.

Releasing an individual registration removes that callback. Releasing a lease removes
all registrations created through it. Provider disposal clears everything.

### 5.4 Dimension transaction

A live dimension change is a runtime transaction, not a new session:

1. validate the requested dimension against `allowedDimensions` and locks;
2. snapshot canonical document identity, filters, Form state/root, selection, focus,
   pins, finite positions, and camera framing;
3. suspend ticking and input dispatch;
4. reconfigure or replace dimension-bound camera, interaction, renderer, and module
   instances while keeping the same session and canvas;
5. convert positions/camera and rebuild active Form in the destination dimension;
6. restore valid transient identities and resume;
7. roll back to the prior configuration if construction fails.

The transaction must not duplicate listeners, observers, animation frames, or module
instances.

## 6. Source seam map

| Current source | V1.1 disposition |
| --- | --- |
| `contracts/v1/profile.ts` | Add allowed dimensions, UI policy, interaction profile, validation-compatible defaults |
| `contracts/v1/session.ts` | Add optional UI options/contributions and action-facing public context without breaking current callers |
| `contracts/v1/service.ts` | Add lease-scoped action registration and disposal |
| `core/profile/ConsumerProfileRegistry.ts` | Resolve dimension source, allowed set, UI defaults, action ID order, and profile overrides |
| `runtime/GraphSessionRuntime.ts` | Replace dimension rejection with a transactional live reconfiguration path |
| `runtime/SessionFactory.ts` | Inject action resolver and optional UI host; propagate profile refresh coherently |
| `runtime/interaction/GraphInteractionInterpreter.ts` | Implement focus-state activation and approved mobile gesture arbitration |
| `runtime/interaction/SessionInteractionRuntime.ts` | Route semantic activation through the resolver while preserving public intents |
| `runtime/camera/GraphCameraController.ts` | Support coherent 2D/3D reconfiguration and camera conversion |
| `runtime/surface/CanvasSessionSurface.ts` | Preserve one canvas and expose dimension/layout updates safely |
| `runtime/render/CanvasGraphRenderer.ts` | Accept the reconfigured camera/dimension without leaking resources |
| `runtime/modules/GraphModuleHost.ts` | Recreate only dimension-bound instances in deterministic lifecycle order |
| `runtime/modules/shipped/FormModule.ts` | Produce deterministic planar or spatial Form positions |
| `service/GraphEngineProviderCore.ts` | Own lease-scoped actions and session UI lifecycle integration |
| `obsidian/GraphPlusControlsPanel.ts` | Split; remove after generic host and Graph+ contributions reach parity |
| `obsidian/settings/*` | Add durable dimension controls, allowed/locked behavior, reset, and live profile refresh |
| `graph-plus/consumer/GraphPlusConsumer.ts` | Stop owning generic display/force/Form UI; register Graph+ action/contributions |
| `graph-plus/consumer/GraphPlusRegistration.ts` | Declare dimensions, UI policy, and ordered action IDs |
| `graph-plus/persistence/GraphPlusCheckpoint.ts` | Reconcile saved views across valid dimension changes rather than discarding them |
| `styles.css` | Move/alias panel selectors, fix narrow Search flow, safe areas, and collapsed-launcher placement |
| `packages/graph-engine-client` | Publish the additive V1.1 types/client artifact while retaining protocol version 1 |

## 7. Ordered implementation slices

Each slice ends in a focused commit. Every completed slice must keep all earlier V1
and V1.1 scenarios green.

### Slice 0 — Green baseline and implementation ledger

Work:

- record branch, status, checkpoint `ac601b5`, typecheck, tests, build, and client
  artifact hash;
- add an implementation ledger to this document or the release checklist as slices
  land;
- preserve unrelated worktree changes and never commit PatternSmith's existing dirty
  work during the external smoke update.

Proof:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`

Exit: current V1 is reproducibly green before any public type changes.

Commit: no code commit unless a baseline-only test correction is separately reviewed.

### Slice 1 — Additive V1.1 contracts and client artifact

Work:

- add the approved UI, action, interaction, and dimension policy types;
- publish stable IDs for stock sections, controls, and core context actions;
- add validators, clones, and defaulting so omitted V1.1 fields preserve V1 behavior;
- extend the lease contract with disposable node-action registration;
- update the client build allowlist and README;
- bump `@graph-plus/graph-engine-client` from `1.0.0` to `1.1.0` while retaining
  protocol version `1`.

Automated proof:

- compile a V1-only consumer fixture unchanged;
- compile a V1.1 consumer fixture using UI/action/dimension fields;
- reject duplicate/invalid action IDs and invalid dimension policies;
- prove the generated client artifact matches source and contains no Obsidian import.

Acceptance: C-PROFILE-08..10, C-VERSION-01..02, R-INPUT-15..16.

Exit: public additions compile independently; runtime behavior is still unchanged.

Commit: `feat(graph-engine): add v1.1 consumer contracts`

### Slice 2 — Profile-backed dimensions and settings persistence

Work:

- extend registration validation with nonempty `allowedDimensions`;
- reject a default or session override outside that set;
- resolve dimension value and source through the existing precedence chain;
- add namespaced user dimension overrides to the engine settings snapshot;
- migrate the settings snapshot additively, preserving all V1 module/profile values;
- add the persistent Obsidian Settings selector only when both dimensions are allowed
  and the consumer exposes it;
- show a fixed value, or no editable control, for a one-value/locked profile;
- make reset clear only that profile override and reveal the next effective source.

The UI selector may be hidden behind a temporary implementation flag until Slice 5
can switch mounted sessions safely. Programmatic writes must not reach a runtime path
that still throws.

Automated proof:

- precedence, source-map, reset, namespace, and migration tests;
- two profiles under one consumer remain isolated;
- invalid programmatic/UI writes fail identically;
- existing settings snapshots deserialize unchanged.

Acceptance: C-PROFILE-01..10, R-UI-05, R-DIM-01..02.

Exit: dimensions are durably and safely resolved even before live rendering is
enabled.

Commit: `feat(graph-engine): persist profile dimensions`

### Slice 3 — Consumer node action registry and focus activation

Work:

- implement lease-scoped registration, disposal, ordering, and lookup;
- resolve dynamic labels and availability against a fresh public action context;
- add per-session/action busy protection and local error reporting;
- reject stale document revisions before callback invocation;
- replace timed double-click activation with the approved focus-state rule;
- make later click, Enter, and context-menu-first-item share one resolver;
- continue emitting public activation/context intents for observation and opt-out UI;
- keep drag-threshold arbitration ahead of click activation;
- ensure no action case silently falls through to Pin or Mind Map.

Automated proof:

- action ordering, dynamic label, unavailable action, async rejection, busy re-entry,
  stale revision, individual disposal, lease release, provider disposal;
- local lease and Workspace Events transport parity;
- first click focuses, later click invokes once, Enter matches, drag invokes zero;
- two consumers may reuse local action names without cross-callbacks after namespace
  resolution.

Acceptance: R-INPUT-03..16, S-CONNECT-06..10.

Exit: a headless synthetic consumer can register and invoke its own semantic action
without Graph+ UI or navigation code.

Commit: `feat(graph-engine): register consumer node actions`

### Slice 4 — Engine-owned session UI host

Work:

- introduce the internal UI control port and one override-merge owner;
- extract panel chrome, generic Display/Camera/Forces/Form controls, slider reset, and
  stock context actions from `GraphPlusControlsPanel`;
- mount/dispose the UI host with every opted-in local or external session;
- implement `shown | collapsed | hidden`, section/control exposure, context opt-out,
  and consumer contributions;
- keep contributions on the public session/context boundary;
- make the context menu consume the Slice 3 action resolver;
- place the resolved primary action first, then remaining consumer actions, then
  enabled core view actions;
- retain Graph+ query/tag/orphan controls temporarily as Graph+ contributions;
- fix narrow Search layout: intact label/words/tokens and full-width input row;
- replace fixed launcher coordinates with container-safe bounds, safe-area insets, and
  consumer/host occlusion inputs;
- recalculate placement on resize, orientation, keyboard, and host-chrome changes;
- retain compatibility CSS aliases until Graph+ fully drops the old panel.

Automated proof:

- shown/collapsed/hidden capability parity;
- section/control hiding does not disable modules;
- contribution mount/rerender/collapse/disposal counts;
- context opt-out still emits intent;
- profile writes and session-transient operations reach different stores;
- constrained-width DOM fixture asserts `Search` is intact and input occupies its own
  row;
- layout harness asserts panel, close button, and launcher stay in usable bounds and
  avoid declared occlusions.

Visual proof:

- desktop full view and sidebar;
- desktop popout;
- mobile expanded/collapsed panel in both orientations, including the photographed
  top-right Obsidian action;
- keyboard open/closed where the platform exposes usable viewport changes.

Acceptance: R-UI-01..11, R-INPUT-09..15, G-PARITY-07..08.

Exit: a synthetic external consumer receives the same optional panel/context host as
Graph+ without importing a Graph+ class.

Commit: `feat(graph-engine): own configurable session ui`

### Slice 5 — Live 2D/3D session reconfiguration

Work:

- implement the dimension transaction described in Section 5.4;
- retain the existing session ID, public handle, document, and canvas;
- convert camera projection/framing coherently between orthographic 2D and
  perspective 3D;
- flatten free-layout positions safely when entering 2D and seed finite depth when
  entering 3D without changing node/edge identities;
- rebuild only dimension-bound module/runtime pieces in lifecycle order;
- preserve active filters, selection, focus, pins, and valid session overrides;
- teach view-state restoration to convert a valid saved view from the other dimension
  rather than rejecting it wholesale;
- roll back cleanly on construction failure;
- activate the Slice 2 settings selector and live profile refresh.

Automated proof:

- same canvas and session handle across switches;
- finite camera/position exports after each direction;
- preserved document revision, node/edge IDs, filters, selection, focus, and pins;
- repeated 2D/3D cycles do not multiply listeners, RAFs, observers, or modules;
- profile-following sessions update while a valid session override remains isolated;
- checkpoint restore across a permitted dimension change is deterministic.

Acceptance: C-VIEW-08..09, R-DIM-01..04, R-MOUNT-04..07.

Exit: dimension changes are profile-backed, live, reversible, and resource-stable.

Commit: `feat(graph-engine): switch live graph dimensions`

### Slice 6 — Dimension-aware Form

Work:

- pass effective dimensions into Form module construction and rebuilds;
- retain current deterministic radial/tree semantics in 2D with `z: 0`;
- add deterministic, meaningful branch/depth separation on the z-axis in 3D;
- avoid unbounded random layouts and fragile exact floating-point snapshots;
- rebuild and frame active Form after a dimension switch using the same root,
  direction, relation, depth, cross-link, branch-color, and disconnected-node policy;
- preserve canonical document and active filter ASTs.

Automated proof:

- all 2D output has `z === 0`;
- a nontrivial 3D fixture has multiple finite, meaningfully separated z values;
- identical seeded inputs preserve branch/depth invariants;
- active Form switches dimension without changing root or document/filter identity.

Acceptance: R-FORM-01..04, G-PARITY-09.

Exit: 3D Mind Map is spatial structure, not a flat map under perspective.

Commit: `feat(graph-engine): form graphs in active dimensions`

### Slice 7 — Mobile gesture trial

Work:

- make one-finger background drag pan in both 2D and 3D;
- preserve one-finger node-drag arbitration;
- make two-finger translation orbit in 3D with the accepted direction mapping;
- make the same gesture non-rotating in 2D, with centroid pan allowed;
- give pinch zoom priority once its scale threshold is crossed;
- keep long-press context behavior and cancel click/drag/orbit cleanly when another
  gesture wins;
- preserve focus/selection during 3D two-finger orbit; clear them exactly once when a
  background pan begins.

Automated proof:

- pointer/touch traces for one-finger background, node drag, two-finger translation,
  pinch, long press, threshold jitter, and cancellation in both dimensions;
- orbit direction matches the accepted desktop mapping;
- no accidental action invocation after a gesture.

Manual proof:

- physical iOS Graph+ smoke in 2D and 3D;
- focused and unfocused node cases;
- trial notes recorded before deciding whether the mapping becomes permanent.

Acceptance: R-INPUT-11..12, R-INPUT-17..18.

Exit: the approved mobile mapping is usable and remains explicitly trial behavior.

Commit: `fix(graph-engine): align mobile dimension gestures`

### Slice 8 — Graph+ V1.1 adoption and compatibility migration

Work:

- make Graph+ register allowed dimensions, profile UI policy, and ordered action IDs;
- register `open-node` as its primary semantic action and keep note/tag lookup in
  Graph+;
- move Graph+ query, tag, orphan, and any other domain controls into contributions
  hosted by the engine panel;
- remove Graph+'s dependency on `GraphPlusControlsPanel` after parity;
- migrate generic Display, Forces, Camera, and Form values from the current Graph+
  lens/settings seam into engine profile or session state;
- copy forward compatible saved values once; do not destructively delete old data in
  V1.1;
- preserve Graph+ note/tag checkpoint ownership, lazy vault scanning, restoration,
  repeated open, and save-on-close behavior;
- verify 2D/3D free graph and Form persistence through Graph+.

Automated proof:

- existing Graph+ adapter, persistence, lazy-load, parity, and performance suites;
- Graph+ has no import of external-consumer-inaccessible engine UI/runtime internals;
- `open-node` is first applicable context action and later-click/Enter behavior;
- old settings/checkpoint fixtures migrate or degrade locally without data loss;
- Graph+ and a synthetic consumer run simultaneously without UI/action/profile bleed.

Acceptance: G-LAZY, G-ADAPTER, G-PERSIST, G-PARITY-01..09.

Exit: Graph+ looks like the first-party product but is technically an ordinary
consumer of the same engine UI/action contracts.

Commit: `refactor(graph-plus): adopt graph engine v1.1 surfaces`

### Slice 9 — External PatternSmith smoke handoff

This slice verifies leaseability; it does not integrate PatternSmith learning state.

Work:

- build and vendor the `1.1.0` client artifact into the existing PatternSmith smoke
  module using its vendor script;
- preserve PatternSmith's unrelated dirty worktree changes and commit only with
  separate explicit authorization;
- keep the smoke document consumer-owned and neutral;
- hide unwanted stock sections while leaving Filtering operational;
- contribute a `Filter by due nodes` diagnostic shim that calculates fixture node IDs
  in PatternSmith and submits only neutral filter AST/IDs;
- register a clearly labeled smoke action through the public action API;
- prove profile/dimension policy isolation from Graph+;
- prove quick panel and context menu arrive from Graph Engine, not a copied PatternSmith
  implementation;
- dispose/reconnect repeatedly through Workspace Events.

The smoke action must not pretend to start a production drill. Real `start-drill`
registration belongs to the next PatternSmith integration contract.

Proof in PatternSmith:

- `npm run check`
- `npm test`
- `npm run build`
- manual desktop and mobile smoke command;
- missing/disabled/reloaded Graph+ provider fallback and reconnect;
- UI/action/profile isolation while Graph+ is open concurrently.

Acceptance: R-UI-01..11, S-CONNECT-01..10, G-PARITY-07..08, Gate F and Gate G external-
consumer clauses.

Exit: the shipped client artifact alone is sufficient for an outside plugin to obtain
engine-owned rendering, configurable UI, filtering, click actions, dimensions, and
clean lifecycle.

Commit: separate PatternSmith commit only after its dirty-worktree diff is reviewed and
the user authorizes it.

### Slice 10 — Gate G stabilization and V1.1 release candidate

Work:

- run the complete V1 and V1.1 suite, not only touched tests;
- run Graph+ and PatternSmith builds from their own checkouts;
- inspect generated client artifact hash and committed output;
- capture desktop, popout, and mobile smoke evidence;
- test simultaneous consumers, provider disable/re-enable, reconnect, repeated
  dimension switches, UI collapse/reopen, and session disposal;
- compare performance and force-settling metrics with the accepted V1 baseline;
- document any intentionally deferred trial findings without silently expanding V1.1.

Release proof:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`
- PatternSmith `npm run check`, `npm test`, and `npm run build`
- platform smoke matrix completed with evidence.

Acceptance: complete Gate G plus all retained Gates A through F regressions.

Exit: V1.1 is ready to tag or version as the user directs; the next design focus may
move to real PatternSmith integration.

Commit: `chore(graph-engine): prepare v1.1 release candidate` only if release metadata
or evidence files change.

## 8. Acceptance-to-slice traceability

| Acceptance family | Primary slice | Regression slices |
| --- | --- | --- |
| C-PROFILE-08..10 | 1–2 | 4, 5, 8, 9 |
| C-VIEW-08..09 | 5 | 6, 8 |
| R-INPUT-03..16 | 3 | 4, 7, 8, 9 |
| R-INPUT-17..18 | 7 | 8, 10 |
| R-UI-01..11 | 4 | 8, 9, 10 |
| R-DIM-01..04 | 2 and 5 | 6, 7, 8, 9, 10 |
| R-FORM-01..04 | 6 | 8, 10 |
| S-CONNECT-01..10 | 3–4 | 9, 10 |
| G-LAZY / G-PERSIST | 8 | 10 |
| G-PARITY-07..09 | 4, 6, 8 | 9, 10 |
| Gate G external smoke | 9 | 10 |

No scenario is considered satisfied merely because its TypeScript shape exists. Each
family needs the proof level named in the acceptance plan: pure tests, mounted runtime
tests, Obsidian integration, or manual platform evidence.

## 9. Migration and compatibility rules

### 9.1 Public protocol

- Keep `protocolVersion: 1` because V1.1 fields and methods are additive.
- Increment the client package version to `1.1.0`.
- Omitted V1.1 registration fields use behavior-compatible defaults.
- Unknown published UI IDs are ignored for forward compatibility.
- Existing V1 consumers do not receive UI or action behavior they did not request.

### 9.2 Settings storage

- Bump the internal settings snapshot schema only when the migration reader ships in
  the same slice.
- Namespace every override by `consumerId/profileId`.
- Store values and derive sources; never persist callback functions or contribution
  mounts.
- A reset removes the user override rather than copying a lower-layer value upward.
- A hidden dimension selector does not prevent a consumer-enforced/default dimension.

### 9.3 Graph+ state

- Preserve current plugin data and checkpoints before writing new fields.
- Copy compatible generic values into their new namespaces; retain the legacy source
  through V1.1 for rollback.
- Treat invalid/corrupt V1.1 fields as a local fallback, not a reason to discard the
  consumer's graph document.
- Convert permitted saved-view dimensions; reject only structurally invalid state.

### 9.4 Rollback

- Each slice is separately revertible.
- Do not combine contract, runtime reconfiguration, Graph+ migration, and PatternSmith
  vendoring in one commit.
- Keep compatibility CSS aliases and legacy Graph+ stored fields until Gate G passes.
- If live dimension switching fails, restore the previous dimension transactionally;
  do not replace the session or clear consumer data.

## 10. Verification matrix

| Layer | Required verification |
| --- | --- |
| Pure contracts/core | validators, clones, defaults, precedence, namespaces, AST/domain neutrality |
| Runtime | focus activation, action errors/lifecycle, override merge, dimension transaction, Form invariants, touch traces |
| Service | local/external parity, load order, release/reload, stale handles, simultaneous consumers |
| Obsidian UI | panel visibility, contributions, persistent setting/reset, menu ordering, safe layout, complete disposal |
| Graph+ | lazy scan, query/tag/orphan contribution, open-node, checkpoints, 2D/3D, Form, performance |
| PatternSmith smoke | vendored artifact only, hidden stock UI, due shim, action, reconnect, isolation |
| Visual/platform | desktop, narrow/sidebar, popout, iOS orientations, keyboard/safe areas, collapsed launcher |

Performance snapshots should compare:

- idle settled frame cost;
- active force-layout frame cost;
- hit testing and label layout/draw cost;
- UI open/close overhead;
- resource counts before and after repeated dimension switches;
- Graph+ settling time relative to the accepted V1 behavior.

V1.1 does not require a broad renderer optimization project, but a material regression
blocks Gate G and is diagnosed before release.

## 11. Explicit non-goals

The following do not enter V1.1 unless the contract is reopened:

- real PatternSmith learning-graph projection or drill launch;
- per-person/student profiles;
- consumer-defined pointer or drag handlers;
- edge/background semantic actions;
- replacement camera controllers or custom gesture grammars;
- Mind Map manual node dragging;
- Anima implementation beyond the existing optional stub;
- regions, gates, or domain-specific graph semantics;
- graph-owned durable consumer documents;
- file types beyond Graph+ V1 notes and tags;
- a general performance/render-engine rewrite.

## 12. Implemented review gate

Implementation proceeded after review confirmed:

1. the eleven-slice order (Slice 0 through Slice 10) and commit boundaries;
2. the internal UI control port rather than exposing engine internals publicly;
3. engine-owned Obsidian UI plus consumer-owned domain contributions;
4. additive protocol V1 with client package `1.1.0`;
5. the transactional same-canvas dimension-switch strategy;
6. the external PatternSmith step remains a smoke integration, not production learning
   behavior;
7. the mobile mapping remains a trial evaluated with physical-device evidence.

Slices 0 through 10 were implemented in ordered commits. Automated verification is
recorded in the acceptance plan; the remaining release decision depends on the named
desktop, popout, and physical-mobile smoke checks.
