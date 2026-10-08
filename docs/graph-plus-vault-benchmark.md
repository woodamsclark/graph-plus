# Graph+ vault loading benchmark

Measured 2026-10-08T01:28:16.596Z with `npm run benchmark:vault`.

## Method

Three runs each at 1,000, 5,000, and 10,000 notes on an Apple M1 Max, macOS 25.6.0, Node v25.1.0. Each disposable disk fixture mixes 1/4/8 KiB bodies, four outbound links per note with repeats, and twenty nested tags. The shipped Obsidian vault source, vault model, adapter, and content-search compiler run against a synthetic metadata host. No live vault files are modified.

The source cache starts empty for each run. OS filesystem caching is uncontrolled, so these are source-cache cold loads, not guaranteed cold storage reads. Fixtures are written before measurement. Timings below are medians; raw runs and fixture sizes are in `outputs/graph-plus-vault-benchmark.json`. This does not measure Obsidian rendering, physics, UI responsiveness, mobile, or iCloud storage latency.

| Notes | Content MiB | Cold open ms | Warm source ms | No-op reconcile ms | Content edit ms | Link edit ms | Content search ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 4.3 | 60.2 | 1.3 | 32.2 | 34.5 | 32.9 | 7.4 |
| 5000 | 21.7 | 262.4 | 4.4 | 131.7 | 140.8 | 136.1 | 18.7 |
| 10000 | 43.5 | 473.2 | 12.2 | 261.8 | 263.4 | 275.9 | 43.1 |

## Findings and release implications

Warm reads and no-op reconciles perform zero additional body reads. A content-only edit reads exactly one note, refreshes search results, and retains the canonical graph revision. A link-count change reads no bodies and advances the revision. Search returns the expected 10% of notes at all sizes. These invariants are checked by the benchmark.

At 10k notes, no-op and one-note content reconciliation still take approximately 262–263 ms. Warm metadata collection takes about 12 ms: rebuilding the projection and comparing the serialized graph dominates the measured path. That work can block desktop input when run on the main thread; this benchmark is evidence of a scaling cost, not a measured frame-stall trace inside Obsidian.

Median stage-end heap growth was 62, 207, and 397 MiB respectively. These observations include transient allocations and are neither peak memory nor retained-cache measurements. The 10k fixture contains 43.5 MiB of bodies and its canonical document serializes to about 13.7 MiB. Mobile memory acceptance remains outstanding.

The release retains the current adapter and 60 Hz physics policy. Follow-up work should separate content-search refresh from topology adaptation, update changed files incrementally, and replace whole-document serialized comparisons. Validate those changes with stable document identity/revision, body-search correctness, and Global/Local camera/pin preservation. Do not advertise large-vault mobile performance from this desktop synthetic benchmark.

## Physical-device checks still required

Run representative 1k/5k/10k vaults in Obsidian on desktop and mobile; measure opening, typing-driven reconciliation, dragging, and background/resume. Capture frame stalls and memory alongside stage timings. The synthetic fixture benchmark completes the reproducible measurement portion, not those device checks.
