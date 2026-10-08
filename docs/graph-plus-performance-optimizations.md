# Graph+ performance optimizations — 2026-10-08

The release scope is targeted invalidation and bounded persistence/synchronization. The existing canonical vault model, engine-owned world geometry, single layout authority, Ego controls, exogenous host ingress, and per-pane camera/filter/Attention boundaries remain in place.

## Changes and invariants

- **Filtering:** compile ID predicates to Sets once per evaluation; construct topology only when a traversing predicate actually executes. Runtime installation validates without doing a discarded selection evaluation. Identical installed requests and absent filter clears do no projection work. Graph+ memoizes filter compilation by document identity and query/tag/orphan controls; Form/display changes do not rebuild this derived selection. Blank queries and visible orphans need no extra search-index/orphan construction.
- **Vault reconciliation:** the adapter already retains canonical document identity when metadata is unchanged. Presentations still adopt fresh lookup objects, but skip replacement, filtering and checkpoint scheduling for the unchanged document. Empty pending constellation admissions do not export view state. Changed metadata continues through normal projection and reconciliation.
- **Physics and panes:** additive optional `onWorldInvalidated`, `exportWorldPositions` and `applyWorldPositions` APIs carry geometry/pins without exporting layout-module state. Managed single-pane applications do no synchronization exports. Layout/drag updates share one animation frame and at most one in-flight transfer plus the latest trailing update. Pin edits flush promptly. Full layout state transfers at initialization, document/restoration synchronization, authority handoff and shutdown; existing full-snapshot subscribers and older-engine fallbacks retain their behavior. New panes read the live authority rather than an application snapshot cache.
- **Lens transactions:** optional `setSessionOverridesAndFilter` installs settings and filtering in one synchronous projection batch. Equal lenses are idle. A hidden Form root still pauses Form, including when the same transaction first enables it.
- **Quick Settings:** the existing worktree implementation already coalesces live refresh to one frame, debounces saving, shows Reset immediately, and updates appearance/force coefficients without graph projection/topology reconstruction. Release/close now realize the final pending frame before persistence. Count display uses optional `getDocumentStats`; Focus/selection helpers use optional `getInteractionState` rather than complete view exports.
- **Persistence:** latest-state writes serialize disk access and replace intermediate queued writes. Plugin data is read from its current authority when a write starts, including retries after checkpoint rollback. Errors remain observable and shutdown drains pending writes. Checkpoint dirtiness distinguishes document, layout, camera, lens and interaction; successful persistent-state signatures suppress identical writes. A failed save never advances the saved marker, and changes arriving during a save remain dirty. Explicit/final checkpoint flush still exports current state to cover compatibility setters that emit no intent.
- **Search cleanup:** the prior filtering simplification already removed note-body reads and the obsolete content matcher/cache. Existing metadata/search tests and the vault benchmark guard zero body reads. Memory projection already skips unchanged installs and retains failed-install retry coverage.

No worker migration, new world authority, force integrator rewrite, or checkpoint format migration is included. Checkpoints still export a complete recoverable view; selective serialization of module state is deferred.

## Before/after benchmark

Run `npm run benchmark:optimizations -- /absolute/path/report.json`. Optional `GRAPH_PLUS_BENCHMARK_SIZES` and `GRAPH_PLUS_BENCHMARK_PANES` select comma-separated scenarios. The baseline includes the pre-existing uncommitted search, slider and force-setting changes; it is not the Git HEAD alone.

Synthetic Node v25.1.0 / macOS arm64 host and canvas, four edges per node, 1/3 panes. ID-filter time is the median of ten evaluations. Synchronization measures twenty frames of three world invalidations each; reconciliation measures five unchanged vault reconciliations. The benchmark isolates synchronization from force integration and drawing. Timings are single scenario runs and include allocation/GC variability; this is not an Obsidian/mobile FPS measurement. One interrupted baseline timing was discarded and that scenario re-run in isolation.

| Nodes | Panes | ID filter ms, before → after | Sync batch ms, before → after | Five no-op reconciliations ms, before → after |
| --- | --- | --- | --- | --- |
| 1,000 | 1 | 4.71 → 0.31 | 43.7 → 0.7 | 145.7 → 74.0 |
| 1,000 | 3 | 4.71 → 0.31 | 112.6 → 17.2 | 232.7 → 67.1 |
| 5,000 | 1 | 38.23 → 1.44 | 409.5 → 78.6 | 2275.1 → 335.6 |
| 5,000 | 3 | 37.96 → 1.44 | 999.7 → 218.8 | 1846.0 → 337.9 |
| 10,000 | 1 | 128.03 → 2.90 | 845.4 → 176.9 | 4881.1 → 638.5 |
| 10,000 | 3 | 128.03 → 2.90 | 2183.9 → 380.6 | 23269.1 → 626.2 |

Work counts are the stronger acceptance criterion:

- Every scenario: physics layout-state exports **60 → 0**.
- One pane: **0** position transfers after the change.
- Three panes: **20** position exports for **60** invalidations after the change.
- Five unchanged reconciliations: projections **5 → 0** for one pane, **15 → 0** for three panes; reconciliation full-world exports **5 → 0**.

Raw reports: `outputs/graph-plus-optimizations-before.json` and `outputs/graph-plus-optimizations-after.json` (ignored local artifacts).

## Regression coverage and acceptance

The suite covers compiled ID membership/lazy topology, equivalent filters, absent clears, invalid-filter rejection, combined Form/filter projection, hidden-root pause, lightweight counts/interaction selectors, legacy full-snapshot subscribers, stale position rejection, independent cameras, zero single-pane exports, burst and slow-transfer coalescing, pin propagation, live new-pane initialization, force-state handoff, failed handoff cleanup, latest-state writes, persistence failure/retry/rollback/shutdown, final slider refresh, unchanged reconciliation/lenses/checkpoints, and edits arriving during checkpoint writes. Existing force cadence, appearance-setting, search metadata and Memory retry tests remain required.

Verified: **508 tests passed**, strict `npm run typecheck`, `npm run build` (including generated client), and `git diff --check`. The metadata-only vault benchmark also passed at 1,000/5,000/10,000 notes with zero note-body reads. Live Obsidian desktop/mobile smoke testing remains separate acceptance work.
