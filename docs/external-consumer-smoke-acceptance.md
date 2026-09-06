# Graph Engine V1 External Consumer Smoke Acceptance Checklist

Status: Implementation complete — manual Obsidian smoke pending

Date: 2026-08-22

Governing contract: [Graph Engine V1 External Consumer Smoke Contract](external-consumer-smoke-contract.md)

## 1. Acceptance objective

PatternSmith is a real external bundle used to verify that Graph Engine can be leased
from the installed Graph Engine plugin and embedded in outside plugin UI. These checks judge
the public provider/client boundary. PatternSmith learning behavior is out of scope.

Record each item as `pass`, `fail`, or `not run`, with the test command, Obsidian
environment, relevant log/screenshot, and defect reference where applicable.

## 2. Required automated gates

### A — Artifact boundary

- [ ] **EXT-A-01 Self-contained artifact:** The client/contracts artifact has no export
  or runtime resolution path into the Graph+ source tree.
- [ ] **EXT-A-02 External typecheck:** PatternSmith typechecks using only the artifact's
  public entry.
- [ ] **EXT-A-03 External bundle:** PatternSmith produces its normal plugin bundle with
  the Graph+ repository unavailable to module resolution.
- [ ] **EXT-A-04 No provider duplication:** PatternSmith's bundle contains the client,
  contracts, and public helpers but no renderer, runtime, physics, module registry,
  settings host, Graph+ adapter, or Graph+ consumer implementation.
- [ ] **EXT-A-05 Private-import audit:** Static import analysis finds no PatternSmith
  import from Graph+ private source paths or undocumented Obsidian plugin-manager APIs.
- [ ] **EXT-A-06 Version traceability:** The bundled client version/protocol and its
  repeatable update procedure are recorded.

### B — External consumer contract tests

- [ ] **EXT-B-01 Document validity:** The smoke fixture validates as
  `GraphDocumentV1` and contains stable nodes, edges, tokens, and attributes.
- [ ] **EXT-B-02 Registration validity:** The `pattern-smith` consumer and
  `external-smoke` profile register through a fake V1 lease without private hooks.
- [ ] **EXT-B-03 Session path:** Against the same public lease shape used in Obsidian,
  the harness creates a session, replaces a document, applies a patch, exports a
  document, and disposes.
- [ ] **EXT-B-04 Patch atomicity:** A valid patch advances revision once; a stale or
  invalid patch changes nothing and returns the public structured failure.
- [ ] **EXT-B-05 Filter paths:** Projection and render filters—including a node and an
  edge expression—apply and clear independently without changing the exported
  canonical document.
- [ ] **EXT-B-06 Intent translation:** Public intents reach the PatternSmith-owned
  handler as opaque IDs and are translated only through its private lookup.
- [ ] **EXT-B-07 View round trip:** Exported compatible view state restores camera,
  positions, selection/focus, and active filters through public methods.
- [ ] **EXT-B-08 Disposal idempotence:** Close after full, partial, failed, and repeated
  initialization releases subscriptions, session, lease, and consumer DOM safely.
- [ ] **EXT-B-09 Persistence fallback:** Valid document/invalid view, invalid
  document/valid view, missing data, and compatible saved data each follow the
  contract's independent fallback rules.

### C — Workspace Events service tests

- [ ] **EXT-C-01 Provider first:** With Graph+ ready first, PatternSmith receives
  exactly one compatible lease and creates exactly one session.
- [ ] **EXT-C-02 Consumer first:** When PatternSmith requests while Graph+ is still
  loading, provider availability causes one successful retry without duplicate
  registration or sessions.
- [ ] **EXT-C-03 Missing provider:** Timeout or explicit unavailability produces the
  standard unavailable surface; the remainder of PatternSmith continues working.
- [ ] **EXT-C-04 Incompatible protocol/capability:** The public structured error is
  shown and no lease or session is retained.
- [ ] **EXT-C-05 Provider unload:** Active external sessions are invalidated or
  disposed, later old-handle calls fail, and unavailability is observable.
- [ ] **EXT-C-06 Provider reload:** A new provider instance ID yields a new working
  lease/session while old handles remain stale.
- [ ] **EXT-C-07 Release isolation:** Releasing PatternSmith's lease disposes only
  PatternSmith sessions.
- [ ] **EXT-C-08 Listener baseline:** Repeated connect, fail, reconnect, close, and
  release cycles return Workspace Events listeners and pending callbacks to baseline.

### D — Regression gates

- [ ] **EXT-D-01 Graph+ suite:** Graph+ typecheck, automated tests, build, and diff
  check pass after artifact packaging changes.
- [ ] **EXT-D-02 PatternSmith suite:** PatternSmith's existing typecheck, automated
  tests, build, and diff check pass with the isolated smoke feature present.
- [ ] **EXT-D-03 Public conformance parity:** The same external-lease vectors used by
  the neutral sample pass through the PatternSmith client artifact.

## 3. Required manual Obsidian smoke

Run first on Obsidian desktop in the main window. Mobile and popout checks are useful
follow-ups but are not required to answer the primary insertion question.

### E — Basic external embedding

- [ ] **EXT-E-01 No startup activation:** Enable/reload PatternSmith without opening
  the smoke surface. Confirm no external lease, registration, session, canvas, RAF
  loop, or smoke persistence is created.
- [ ] **EXT-E-02 Mount:** Invoke PatternSmith's smoke command. A 3D graph appears inside
  the PatternSmith-owned container and does not open or reuse the Graph+ vault view.
- [ ] **EXT-E-03 Input ownership:** Orbit/pan, zoom, select, focus, drag, reset camera,
  and resize work inside the embedded container without breaking surrounding
  PatternSmith UI.
- [ ] **EXT-E-04 Diagnostic identity:** The harness shows a provider instance ID,
  external session ID, document ID/revision, and no private provider object.
- [ ] **EXT-E-05 Lazy repeated reveal:** Re-reveal the same live smoke surface. No
  duplicate canvas, renderer, lease, session, controls, or input response appears.

### F — Public operations

- [ ] **EXT-F-01 Patch:** Use the consumer-owned control to add or remove graph data.
  The visible graph and exported revision update once.
- [ ] **EXT-F-02 Projection filter:** Apply and clear a projection filter. Layout
  participation changes and the exported canonical document remains unchanged.
- [ ] **EXT-F-03 Render filter:** Apply and clear a node/edge render filter. Visibility
  changes and the exported canonical document remains unchanged.
- [ ] **EXT-F-04 Intents:** Activate, select, drag, and move the viewport. PatternSmith's
  diagnostic strip receives the expected public intents with its opaque IDs.
- [ ] **EXT-F-05 Document replace:** Reload the fixture or saved document through
  `replaceDocument`; the session remains mounted and coherent.

### G — Consumer-owned persistence

- [ ] **EXT-G-01 Close flush:** Change graph content, camera, positions, selection, and
  filters; close normally; confirm PatternSmith completes document and view exports
  before session disposal and saves them under its versioned smoke namespace.
- [ ] **EXT-G-02 Reopen restore:** Reopen the smoke surface. The saved graph and
  compatible view state restore rather than silently returning to the fixture.
- [ ] **EXT-G-03 Independent fallbacks:** Corrupt only the saved view and confirm the
  saved document opens with default view state. Corrupt only the saved document and
  confirm the fixture opens without applying the incompatible saved view.
- [ ] **EXT-G-04 Ownership:** Confirm Graph+ storage contains no PatternSmith graph and
  PatternSmith storage contains no Graph+ vault graph.
- [ ] **EXT-G-05 Cross-product noninterference:** Opening, changing, saving, or closing
  Graph+ does not change PatternSmith's saved smoke graph, and the reverse is true.

### H — Simultaneous consumers and failure isolation

- [ ] **EXT-H-01 Two live graphs:** Open Graph+ and PatternSmith's smoke graph at the
  same time. Both render and accept input independently.
- [ ] **EXT-H-02 State isolation:** Apply filters, selection, focus, camera changes, and
  patches in PatternSmith. No observable Graph+ graph state changes.
- [ ] **EXT-H-03 Reverse isolation:** Rescan, filter, reset, and close Graph+. No
  observable PatternSmith smoke state changes.
- [ ] **EXT-H-04 Consumer close:** Close PatternSmith's surface while Graph+ remains
  open. Graph+ continues rendering and responding normally.
- [ ] **EXT-H-05 Bundled consumer close:** Close Graph+ while PatternSmith remains open.
  PatternSmith continues rendering because the provider plugin is still loaded.
- [ ] **EXT-H-06 Consumer failure:** Force the PatternSmith fixture/initialization path
  to fail. Graph+ remains healthy and only the PatternSmith surface reports failure.
- [ ] **EXT-H-07 Bundled-consumer failure:** Force or reproduce a Graph+ vault-consumer
  failure without unloading the provider. PatternSmith's healthy external session
  continues.

### I — Provider absence, unload, and reload

- [ ] **EXT-I-01 Initially absent:** Disable Graph Engine, keep PatternSmith enabled, and open
  the smoke surface. The standard `Graph Engine unavailable/not installed` surface
  appears inside PatternSmith and other PatternSmith UI remains usable.
- [ ] **EXT-I-02 Late provider:** Start the connection attempt before Graph Engine finishes
  enabling. Confirm the availability retry creates one graph, not duplicates.
- [ ] **EXT-I-03 Active unload:** With both graphs active, disable Graph Engine. PatternSmith
  reports unavailability; stale interaction does not continue against an orphaned
  runtime.
- [ ] **EXT-I-04 Reload recovery:** Re-enable Graph Engine and reconnect or reopen the smoke
  surface. A new provider instance/session works and persisted PatternSmith state
  restores.
- [ ] **EXT-I-05 Stale handle rejection:** A diagnostic/test call through the old
  lease/session fails as unavailable or disposed and cannot mutate the new session.
- [ ] **EXT-I-06 Repeated cycles:** Complete at least three enable/open/close/disable
  cycles. No multiplied input, duplicated canvases, leaked settings entries, or
  progressively increasing idle work is observed.

## 4. Evidence record

Complete this table during the real smoke run.

| Field | Evidence |
| --- | --- |
| Graph+ commit | |
| PatternSmith commit | |
| Client artifact version/hash | |
| Obsidian version | |
| Operating system | |
| Graph+ enabled before PatternSmith | pass / fail / not run |
| PatternSmith enabled before Graph+ | pass / fail / not run |
| Simultaneous sessions | pass / fail / not run |
| Persistence close/reopen | pass / fail / not run |
| Provider disable/re-enable | pass / fail / not run |
| Automated Graph+ gates | command and result |
| Automated PatternSmith gates | command and result |
| Known defects/deferred observations | |

## 5. Acceptance threshold

The external insertion smoke passes when:

1. every A–D automated gate passes;
2. every E–I required desktop check passes;
3. no PatternSmith import or bundled code crosses the public artifact boundary;
4. PatternSmith and Graph+ can run simultaneously without shared consumer state or
   lifecycle damage;
5. close/reopen proves PatternSmith—not Graph Engine—owns persistence; and
6. provider absence and reload fail visibly and recover through a new public lease.

Performance observations should be recorded, but existing large-vault Graph+ label
cost is not a failure of this external-insertion contract unless it prevents the small
external fixture from remaining interactive or reveals cross-consumer contention.

After this threshold passes, Graph Engine's outside-plugin insertion model is accepted.
Any production PatternSmith graph projection begins under its own design and
acceptance plan.
