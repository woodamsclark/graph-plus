# Graph Engine V1.2 Scalability Acceptance Plan

Status: V1.2 implementation complete; physical smoke remains operational verification

Baseline: Graph Engine V1.1 release candidate and pre-extraction Graph+ runtime at
`4355b1d`

Date: 2026-08-25

Depends on: [Graph Engine V1.2 Scalability Contract](graph-engine-v1.2-scalability-contract.md)

## 1. Purpose

This plan turns the V1.2 scalability contract into observable, release-blocking
evidence. It supplements the complete V1/V1.1 acceptance baseline; it does not replace
functional, lifecycle, platform, or public-consumer conformance.

V1.2 succeeds only if a real Graph+ vault-sized graph becomes responsive because the
engine performs less unnecessary work. Hiding labels, dropping graph elements, changing
accepted interaction semantics, disabling modules, or reducing physics quality does
not satisfy this plan.

PatternSmith smoke-test corrections are explicitly outside this pass. A neutral
synthetic consumer continues to prove the public boundary without modifying the
PatternSmith checkout or product experience.

## 2. Proof levels

| Level | Purpose | Environment |
| --- | --- | --- |
| A — Architecture | Boundaries, invalidation, module lifecycle, frame work, counters | Deterministic Node/DOM harness |
| B — Benchmark | Frame cost, latency, settling, allocation, scale | Real monotonic clock and production build |
| S — Service | Backward-compatible leases, sessions, exports, isolation | Local and fake Workspace Events transports |
| G — Graph+ | Vault adapter, checkpoint, open/use/close behavior | Fixture vault and live Obsidian |
| P — Platform | Desktop, popout, mobile, suspension, host integration | Physical or representative platform smoke |

All architecture scenarios are automated. Timing budgets are measured in a production
build, not a TypeScript test runner with a non-advancing fake clock.

## 3. Fixtures

### 3.1 Deterministic graph fixtures

Every scale fixture uses stable IDs, a seeded position generator, finite values, mixed
degrees, hubs, leaves, disconnected components, parallel edges, tokens, and attributes.
The same generated document must be reusable in 2D and 3D.

| Fixture | Nodes | Edges | Required modes |
| --- | ---: | ---: | --- |
| `small-250` | 250 | 500 | 2D, 3D |
| `vault-1500` | 1,500 | 3,000 | 2D, 3D |
| `scale-5000` | 5,000 | 10,000 | 2D, 3D |

The `vault-1500` fixture approximates the reported Graph+ graph of approximately 1,409
nodes and 2,733 edges. Benchmark documents are domain-neutral and do not require an
Obsidian vault scan.

### 3.2 Historical comparison fixture

An isolated characterization harness runs the same `vault-1500` topology through the
pre-extraction Graph+ runtime at `4355b1d` where practical. Its output is not required
to be coordinate-identical. It records:

- time to first interactive frame;
- active-layout frame distribution;
- settling duration;
- settled pan/orbit/zoom distribution;
- input-to-present latency;
- peak and retained memory where the platform exposes it.

If a metric cannot be compared because the historical API cannot express the same
operation, the evidence records that limitation instead of inventing equivalence.

### 3.3 Graph+ fixture vault

A committed fixture vault provides notes, tags, and relationships sufficient to
exercise Graph+'s adapter, saved checkpoint reconciliation, open/reopen, and canonical
persistence. The user's live vault is the final experiential confirmation, not the
only reproducible benchmark source.

## 4. Measurement protocol

Every benchmark report records:

- commit SHA and production-build hash;
- Obsidian/browser/runtime version;
- operating system and device model;
- CPU architecture and memory;
- display refresh rate and device pixel ratio;
- graph dimensions, label mode, enabled modules, and effective force settings;
- fixture identity and node/edge counts;
- whether developer tools and performance instrumentation were active;
- power/thermal conditions where they are known.

Each interactive scenario uses:

1. one unmeasured load/warm-up run;
2. three additional warm-up interactions;
3. five measured runs of at least ten seconds each;
4. a reset performance window before every measured run;
5. median, p95, p99, maximum, and sample count—not a single favorable frame.

Automated tests use a real advancing monotonic clock for elapsed measurements. Fake RAF
and clocks remain appropriate for deterministic frame-loop assertions, but zero-valued
stage timings are not benchmark evidence.

## 5. Architecture acceptance

### A-BOUNDARY — Public and private state

#### A-BOUNDARY-01 — Validated ingress

Given a consumer-created document or restored view, when it enters a session, then the
engine validates and copies it exactly once per accepted operation; later consumer
mutation cannot affect the session.

#### A-BOUNDARY-02 — Defensive egress

Given an active session, when its document or view is exported, then mutating the
export cannot affect the session and later session work cannot mutate that export.

#### A-BOUNDARY-03 — Scalar identity

Given any number of pointer, wheel, keyboard, command, hit-test, camera, or frame events,
when the active document identity is checked, then document ID and revision are read in
constant time with zero public document exports, validations, node traversals, or edge
traversals.

#### A-BOUNDARY-04 — No snapshot in the frame loop

Given `vault-1500` with active force layout, when 300 frames execute without an explicit
consumer export, then the document-export and view-export counters remain zero. Public
contract clones are not used as internal tick buffers.

### A-INVALIDATE — Dependency-aware recomputation

#### A-INVALIDATE-01 — Camera-only work

Given a settled graph, when it is continuously panned, orbited, or zoomed for ten
seconds, then document validation, Filter evaluation, Form projection, topology
projection, force reheating, and static contribution counts do not increase.

Camera matrices, culling, screen-space indexes, frame composition, and rendering may
increase as required.

#### A-INVALIDATE-02 — Stable hover

Given the pointer remains over the same node while raw move events arrive, when frames
are processed, then at most one hit test occurs per frame and no repeated hover-state,
projection, or graph-wide contribution update is committed.

#### A-INVALIDATE-03 — Gesture hit-test suppression

Given an active pan, orbit, pinch, or node drag, when pointer moves arrive, then hover
hit testing is suspended unless the gesture explicitly requires a node target. The
final semantic gesture result remains correct.

#### A-INVALIDATE-04 — Selection and focus

Given an unchanged document and lens, when selection or focus changes, then Filter,
Form, topology, and force-layout initialization counts remain unchanged. Only dependent
interaction/camera/presentation work runs.

#### A-INVALIDATE-05 — Physics-only frame

Given an unsettled free graph, when force layout advances one frame, then position and
position-dependent frame work may run, while validation, Filter, Form, topology, and
static rendering-contribution counts remain unchanged.

#### A-INVALIDATE-06 — Transactional graph-wide work

Given one accepted document patch, Filter replacement, or Form change, when it is
committed, then each required graph-wide phase runs at most once for that transaction
and produces one coherent derived state.

### A-FRAME — Existing frame-loop preservation

#### A-FRAME-01 — Deterministic order

Given instrumented interaction, two tickable modules with distinct order, composition,
and rendering, when a frame runs, then observed order is input/commands, ordered module
ticks, composition, and render.

#### A-FRAME-02 — Settled force does no expensive work

Given a settled force module and an otherwise unchanged graph, when the existing session
frame loop continues, then the force tick performs no position clone, graph traversal,
projection, composition, or render invalidation.

#### A-FRAME-03 — No frame-loop rewrite

Given the V1.2 implementation diff, when frame ownership and ordering are inspected,
then `GraphSessionRuntime` retains the existing frame-loop responsibility and no
replacement coordinator or public scheduler abstraction is added.

#### A-FRAME-04 — Suspension and disposal

Given an active layout, when the session is suspended, hidden, or disposed, then frames
and module work stop; resume restarts only valid work, and disposal can never restart.

### A-MODULE — Extensibility preservation

#### A-MODULE-01 — Force layout remains modular

Given a profile that permits `force-layout`, when the module is enabled, disabled,
required, optional, or forbidden, then existing module-policy behavior controls its
activation without moving force integration into the kernel.

#### A-MODULE-02 — Internal extension module

Given a test module registered at engine composition time, when a matching profile
enables it, then its setup, ordered projection/tick/contribution, settings, state,
suspension, and disposal hooks execute through the generic module host without editing
the session loop.

#### A-MODULE-03 — Optional failure isolation

Given an optional module throws during tick after other modules are active, when the
failure is handled, then that module is isolated for the affected session, other
sessions remain valid, and no duplicate RAF or retained module instance remains.

#### A-MODULE-04 — External boundary unchanged

Given a contracts-only external consumer, when it registers profiles and creates a
session, then it can configure shipped modules but cannot access private module,
renderer, camera, frame-loop, or mutable-state implementations.

## 6. Input and rendering acceptance

### R-INPUT-01 — Coalesced camera input

Given 100 wheel or pointer camera deltas arrive before the next RAF, when the frame is
processed, then cumulative camera motion is preserved, semantic event order is valid,
and camera/render work is committed no more than once for that frame.

### R-INPUT-02 — Semantic events are not coalesced away

Given press, threshold crossing, release, click, context request, and action activation
traces, when high-frequency moves are coalesced, then each accepted semantic transition
still occurs exactly once.

### R-HIT-01 — Indexed candidate set

Given `vault-1500` and `scale-5000`, when a routine stationary hover hit test runs, then
diagnostics show indexed candidates rather than a full node scan. Hit results remain
equivalent to an exhaustive reference implementation, including depth ordering in 3D.

### R-LABEL-01 — Off means no label work

Given label mode `off`, when active-layout and settled-camera frames render, then label
candidate, measurement, collision, and draw counters remain zero.

### R-LABEL-02 — Adaptive budget

Given adaptive labels at every scale tier, when the camera is stationary, then the
accepted bounded label count, priority, collision, and no-flicker V1.1 behavior remains
true.

### R-CACHE-01 — Static contribution reuse

Given an unchanged document, projection, theme, and rendering settings, when 600 camera
or physics frames render, then graph-wide static node and edge contributions are reused
rather than regenerated per frame.

### R-VISIBLE-01 — No density cheat

Given all three fixtures, when performance modes are compared, then every onscreen node
and accepted visible edge remains renderable. Meeting a budget by silently truncating
the graph fails acceptance.

## 7. Force-layout acceptance

### F-PARITY-01 — Accepted defaults

Given an unoverridden Graph+ profile, when force settings resolve, then Barnes-Hut,
spring, length, center, velocity-decay, alpha-decay, alpha-minimum, minimum-distance,
theta, and maximum-speed values match the accepted V1.1 defaults.

### F-PARITY-02 — Stable spatial character

Given the seeded `vault-1500` fixture, when the pre-extraction and V1.2 engines settle,
then both produce finite non-collapsed layouts with connected nodes closer on average
than unrelated components, visible separation among major components, and no runaway
node.

### F-SETTLE-01 — Cooling completes

Given `vault-1500` at alpha 1 with accepted defaults, when no input or layout mutation
occurs, then force layout reaches its stopped state within 7 seconds on the declared
desktop reference device and subsequently satisfies A-FRAME-02.

### F-SETTLE-02 — Unrelated work does not reheat

Given a settled graph, when the camera moves, hover/focus/selection changes, a context
menu opens, or label visibility changes, then alpha remains stopped unless that specific
setting is documented as layout-affecting.

### F-BUFFER-01 — Reusable simulation state

Given 600 active-layout frames, when allocation instrumentation is enabled, then
positions, velocities, forces, and spatial-tree storage demonstrate bounded reuse.
There is no fresh public view-state clone or whole-document clone per tick, and retained
memory returns to a stable plateau after forced garbage collection in the harness.

### F-TOPOLOGY-01 — Reconciliation

Given a small patch adds and removes nodes and edges, when force layout reconciles, then
unaffected node positions/velocities are retained, removed buffers disappear, new nodes
receive valid positions, and the layout reheats once.

## 8. Release performance budgets

Timing budgets apply to a production build on a declared desktop reference device at
normal power and thermal state. The report must include raw samples. A slower platform
may be documented separately, but cannot replace the reference gate.

### 8.1 Vault-tier budgets

For `vault-1500` in both 2D and 3D:

| Scenario | Required budget |
| --- | --- |
| Mount prebuilt document to first interactive frame | no more than 1,000 ms |
| Settled continuous pan/orbit/zoom total frame | p50 no more than 16.7 ms; p95 no more than 25 ms; p99 no more than 40 ms |
| Active force-layout total frame | p50 no more than 20 ms; p95 no more than 33 ms; p99 no more than 50 ms |
| Input-to-present latency during settled camera gesture | p95 no more than 50 ms |
| Routine indexed hover hit test | p95 no more than 3 ms |
| Force settling from alpha 1 | no more than 7 seconds |
| Gesture frames longer than 100 ms | zero in each ten-second measured run |

The same scenarios must also be no more than 15 percent slower than the comparable
pre-extraction baseline where a valid comparison exists. If the V1.2 result beats the
absolute budget but misses this parity limit, release review must explain and approve
the difference.

### 8.2 Scale-tier budgets

For `scale-5000` in both 2D and 3D:

| Scenario | Required budget |
| --- | --- |
| Mount prebuilt document to first interactive frame | no more than 2,500 ms |
| Settled continuous pan/orbit/zoom total frame | p95 no more than 33 ms; p99 no more than 50 ms |
| Active force-layout total frame | p95 no more than 50 ms; p99 no more than 75 ms |
| Input-to-present latency during settled camera gesture | p95 no more than 75 ms |
| Gesture frames longer than 150 ms | zero in each ten-second measured run |

The Scale tier is a graceful interactive target, not a promise that full force layout
will settle within the Vault-tier time.

### 8.3 Mobile expectations

On a declared supported mobile reference device, `small-250` must satisfy the complete
gesture and rendering contract without continuous force work after settling. The user's
approximately 1,400-node vault must mount and remain operable without crash or runaway
work, but V1.2 does not establish a phone-specific 60 fps Vault-tier guarantee.

## 9. Performance-observability acceptance

### O-PERF-01 — Rolling distributions

Given at least 300 rendered samples, when a performance snapshot is exported, then it
contains sample count, median, p95, p99, and maximum for total and named frame stages.

### O-PERF-02 — Counter reset

Given prior activity, when diagnostics are reset, then the next snapshot describes only
the new measurement window and retains no stale maxima or counts.

### O-PERF-03 — Work counters

Given architecture scenarios, when counters are inspected, then validations, exports,
projection phases, hit tests, frames, RAF requests, module ticks, and persistence
flushes correspond to the actual operations asserted by the test.

### O-PERF-04 — Module attribution

Given two tickable modules, when one intentionally consumes measurable time, then the
snapshot attributes its cost to that module without misreporting it as renderer or hit
test time.

### O-PERF-05 — Instrumentation overhead

Given diagnostics enabled and disabled on `vault-1500`, when identical settled-camera
runs are compared, then instrumentation adds no more than 5 percent to p95 total frame
time.

## 10. Persistence acceptance

### G-PERSIST-12-01 — One canonical checkpoint

Given a Graph+ checkpoint saved by V1.2, when plugin data is inspected, then the active
Graph+ namespace contains one authoritative graph document and one associated view
state, without full duplicate legacy document/view representations.

### G-PERSIST-12-02 — Legacy compaction

Given valid V1/V1.1 duplicated persistence, when Graph+ loads and next saves
successfully, then accepted state is preserved in the canonical representation and
redundant migrated copies are retired without touching other consumers' namespaces.

### G-PERSIST-12-03 — Camera-only save

Given an unchanged graph document and a changed camera, when the debounced checkpoint
flushes, then the document is not revalidated or reserialized and only change-relevant
checkpoint state is written.

### G-PERSIST-12-04 — Burst debounce

Given continuous camera input for ten seconds, when input stops, then zero persistence
flushes occur during the active burst and at most one occurs after the accepted idle
delay.

### G-PERSIST-12-05 — Close flush

Given accepted unsaved graph or view changes, when the Graph+ view closes, then one
final ordered flush completes before disposal; reopening restores the accepted result.

### G-PERSIST-12-06 — Save failure

Given the backing store rejects a save, when interaction continues, then the graph
remains responsive, the last valid checkpoint remains recoverable, and a later retry
cannot write an internally inconsistent document/view pair.

## 11. Public compatibility acceptance

### S-COMPAT-12-01 — Existing client compiles

Given the V1.1 client artifact and a consumer that uses no additive V1.2 diagnostics,
when it compiles and connects to V1.2, then registration, lease, session, document,
filter, view, intent, action, UI, and disposal behavior remain compatible.

### S-COMPAT-12-02 — Local/external parity

Given Graph+ uses a local lease and a neutral synthetic consumer uses Workspace Events,
when both mount the same document/profile, then neither receives privileged mutable
runtime state and both satisfy the same session contract.

### S-COMPAT-12-03 — Simultaneous isolation

Given two sessions with independent documents and profiles, when both animate, filter,
export, suspend, and dispose, then their buffers, caches, counters, module failures,
settings, and checkpoints remain isolated.

### S-COMPAT-12-04 — PatternSmith deferral

Given V1.2 implementation begins, when repository changes are reviewed, then no
PatternSmith smoke-test command, UI, graph behavior, or product setting is changed as
part of this release. Any independently discovered PatternSmith issue remains backlog
work after V1.2.

## 12. Graph+ live acceptance

### G-LARGE-01 — First open

Given the fixture vault and no saved checkpoint, when `Open: graph+` is invoked, then
Graph+ scans notes/tags once, creates one public document, mounts one session, reaches
an interactive frame, settles, and becomes idle within the applicable Vault-tier
budgets.

### G-LARGE-02 — Saved reopen

Given a valid canonical checkpoint, when Graph+ reopens, then it restores document/view
state, reconciles current vault changes, avoids redundant full reconstruction, and
meets the recorded reopen budget.

### G-LARGE-03 — Real-vault interaction

Given the user's approximately 1,400-node vault, when titles are `adaptive`, `all`, and
`off`, then camera interaction remains responsive in 2D and 3D, labels affect only their
attributed stages, and disabling titles is not required to make the engine usable.

### G-LARGE-04 — Settle and remain settled

Given the live Graph+ graph reaches equilibrium, when the user only pans, orbits,
zooms, focuses, selects, or opens controls, then nodes do not resume wandering and the
force module remains stopped.

### G-LARGE-05 — Repeated lifecycle

Given ten open, interact, close cycles including dimension switching and suspension,
when resource counts are compared, then listeners, observers, frame handles, module
instances, DOM children, buffers, and queued saves return to baseline after every close.

## 13. Required tooling and evidence

V1.2 implementation must add or upgrade:

- deterministic scale-fixture generation;
- a real-clock production benchmark runner;
- stage distributions rather than latest-frame-only values;
- invalidation and export counters;
- a historical comparison harness or documented comparison limitation;
- allocation/retained-memory instrumentation where supported;
- Graph+ canonical-persistence inspection;
- repeatable desktop and mobile smoke instructions.

The release evidence contains:

- raw benchmark output;
- summarized before/after table;
- reference-device description;
- automated test, typecheck, client-artifact, and production-build results;
- `git diff --check` result;
- desktop 2D/3D and popout smoke results;
- mobile suspension and operability result;
- explicit remaining limitations.

## 14. Migration gates

### Gate A — Characterization and instrumentation

- Freeze deterministic Small, Vault, and Scale fixtures.
- Capture current V1.1 and historical pre-extraction measurements.
- Make rolling timings and work counters trustworthy.
- Map every A-, R-, F-, O-, S-, and G-scenario to an automated or explicit physical
  proof location.

### Gate B — State boundary and invalidation

- Remove public snapshot/export operations from identity and frame loops.
- Pass A-BOUNDARY and A-INVALIDATE.
- Preserve complete V1/V1.1 functional acceptance.

### Gate C — Existing frame loop and input

- Preserve the current session frame loop and remove redundant work within it.
- Implement input coalescing and bounded hit testing.
- Pass A-FRAME, R-INPUT, and R-HIT.

### Gate D — Modules, force, and rendering

- Preserve force layout as a module and generic internal module extensibility.
- Reuse runtime buffers and caches.
- Pass A-MODULE, F-, R-LABEL, R-CACHE, and R-VISIBLE.

### Gate E — Graph+ persistence

- Write one canonical Graph+ checkpoint and migrate redundant representations safely.
- Make saves change-aware and burst-debounced.
- Pass G-PERSIST-12 without changing another consumer's persistence ownership.

### Gate F — V1.2 release

- Pass all V1/V1.1 regression tests and V1.2 scenarios.
- Meet Vault and Scale performance budgets in 2D and 3D.
- Pass local/external synthetic-consumer parity.
- Pass Graph+ fixture and live-vault verification.
- Record physical desktop, popout, and mobile evidence.
- Leave PatternSmith smoke-test corrections untouched.

No gate is satisfied by moving files, renaming classes, lowering graph density, or
reporting a single favorable timing sample.

## 15. Approval checklist

Approval of this acceptance plan confirms:

- [x] `vault-1500` is the V1.2 release-scale fixture.
- [x] `scale-5000` is the V1.2 graceful-growth fixture.
- [x] The stated desktop frame, latency, hit-test, mount, and settling budgets are
      acceptable release targets.
- [x] The historical runtime at `4355b1d` is a comparison baseline, not the public
      architecture to restore wholesale.
- [x] Physics remains a module.
- [x] The current session frame-loop ownership and ordering remain unchanged.
- [x] Public snapshot safety and external-consumer isolation remain intact.
- [x] Graph+ checkpoint compaction is part of V1.2 scalability.
- [x] PatternSmith smoke-test corrections remain deferred.

Implementation began after approval of this contract and acceptance plan.

## 16. Implementation-candidate evidence

The 2026-08-25 implementation candidate provides:

- private canonical document reads with defensive public exports retained;
- invalidation domains for camera, interaction, positions, layout, and graph-wide
  projection work;
- per-frame camera/drag coalescing and one idle hover hit test per frame;
- a screen-space node hit index;
- reusable force positions, velocity, and force buffers with deterministic cooling;
- change-aware Graph+ checkpoints with canonical documents stored separately from
  lightweight camera/view metadata, plus per-vault legacy checkpoint compaction;
- rolling frame distributions and explicit work counters;
- the repeatable `npm run benchmark` Vault and Scale runner in 2D and 3D.

The local headless real-clock run used Node v25.1.0 on darwin-arm64, labels off, and
active force layout. Times are milliseconds:

| Fixture | Mount | Total p50 | Total p95 | Total p99 |
| --- | ---: | ---: | ---: | ---: |
| `vault-1500` 2D | 37.22 | 6.23 | 13.02 | 16.30 |
| `vault-1500` 3D | 29.44 | 7.64 | 14.20 | 19.05 |
| `scale-5000` 2D | 61.09 | 25.03 | 36.74 | 61.95 |
| `scale-5000` 3D | 64.58 | 33.79 | 41.77 | 52.00 |

All four active-layout scenarios recorded zero document exports, view exports,
graph-wide projection passes, and static frame compositions inside the measured frame
loop. The automated suite passes 123 tests, including 300-frame no-snapshot/settling,
input coalescing, hover bounds, external-consumer isolation, and change-aware Graph+
checkpoint cases.

This headless harness measures engine JavaScript work and regression counters, not real
Canvas rasterization or Obsidian host overhead. Desktop/mobile Graph+ smoke remains the
operational verification for the production build. A historical `4355b1d` production
comparison and physical memory profile also remain unrecorded; these limitations must
not be represented as measured evidence.
