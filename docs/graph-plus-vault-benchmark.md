# Graph+ vault metadata benchmark

Measured October 7, 2026 at 23:49 EDT with `npm run benchmark:vault`.

## Method

Three runs each at 1,000, 5,000, and 10,000 notes on an Apple M1 Max,
macOS 25.6.0, Node v25.1.0. The synthetic metadata host supplies four outbound links
per note with repeats and twenty nested tags. The shipped vault source, model,
adapter, and metadata index run without note bodies or disk fixtures.

Search uses the same simple-search host double as the automated tests because the
Obsidian npm package provides types only. Its timing measures Graph+ index traversal
and visibility filtering with that double, not the real `prepareSimpleSearch()` API.

Timings are medians; raw runs are in `outputs/graph-plus-vault-benchmark.json`.
The benchmark does not measure rendering, physics, real Obsidian UI responsiveness,
mobile, or iCloud storage latency.

| Notes | Open ms | Metadata snapshot ms | No-op reconcile ms | Body mtime change ms | Link edit ms | Search with host double ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1000 | 23.8 | 1.2 | 29.1 | 28.2 | 24.9 | 1.3 |
| 5000 | 106.1 | 2.4 | 133.5 | 124.8 | 121.1 | 4.3 |
| 10000 | 192.0 | 4.7 | 239.7 | 226.9 | 226.0 | 7.7 |

## Checked invariants

Opening, metadata snapshots, and reconciliation perform zero note-body reads.
An mtime change with unchanged metadata retains the canonical document identity
and revision. A link-count change advances the revision without reading bodies.
Searching `#topic/group-7` with tag nodes hidden returns the expected 5% of notes.

## Limits and follow-up

At 10,000 notes, a no-op reconciliation still takes about 240ms: rebuilding the
projection and comparing the serialized graph remain scaling costs. Incremental
metadata adaptation and comparisons are separate follow-up work.

Stage-end heap observations in the raw report include transient allocations and
are neither peak memory nor retained-index measurements. Validate opening, metadata
changes, searches, dragging, and background/resume in Obsidian on desktop and mobile
before making physical-device performance claims.
