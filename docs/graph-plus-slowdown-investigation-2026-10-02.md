# Graph+ slowdown investigation — 2026-10-02

## Finding

Tight zoom exposes an unbounded picking-grid allocation in `CanvasGraphRenderer.rebuildHitGrid`. This is a reproduced Graph+ defect and a strong match for the reported slowdown around closely zoomed Focus views. It has not yet been established as the sole cause of the live Obsidian slowdown, especially its persistence after disabling the plugin in Settings.

The renderer indexes every 32px cell inside a projected node's bounding square. It does not clip that square to the canvas. A node's rendered radius can grow with the square of its projected scale. Consequently, one large node allocates thousands or millions of offscreen map entries and arrays. Every render clears and rebuilds this grid; a camera change can also trigger rebuilding during hit testing.

Focus compounds this: scene compilation retains void nodes with opacity zero, and picking-grid construction includes them even though node drawing skips them. Invisible nodes therefore consume grid capacity and can win the renderer's hit test before the interaction layer rejects them.

The grid implementation dates to commit `c433a39` (2026-08-25). The recent decision to bake in the maximum node zoom contrast makes the existing defect easier to encounter; it did not introduce the unbounded grid.

## Reproduction and candidate

Headless probes used the actual source renderer and Vision, a no-op Canvas2D context, a 640 × 360 CSS-pixel viewport, and one centered node with base radius 24 and scale exponent 2. Allocation measurements used Node with `--expose-gc`, collecting before each sample. These are algorithm measurements, not live Obsidian frame timings.

| Projected scale | Projected radius | Current grid cells | Candidate grid cells |
| --- | --- | --- | --- |
| 1 | 24px | 6 | 6 |
| 2 | 96px | 49 | 49 |
| 4 | 384px | 625 | 252 |
| 8 | 1,536px | 9,409 | 252 |
| 12 | 3,456px | 47,089 | 252 |

At scale 12, one current-renderer sample took 13.95ms and allocated approximately 7.36MiB. The isolated candidate sample took 0.16ms and allocated approximately 0.075MiB. Single samples are illustrative; the deterministic grid-cell counts establish the growth problem.

The supported projected-scale cap is 40. At that scale, this node's radius is 38,400px and the current loop would visit 5,764,801 cells. That count was calculated, not executed, to avoid deliberately allocating millions of entries.

The candidate clips cell bounds to the viewport and skips nodes with opacity zero. It preserves node rendering, radius growth, zoom, and camera behavior. It bounds the number of distinct grid cells by viewport dimensions; bucket contents still depend on graph size and overlap.

Additional probes reproduced the same scale-12 failure in perspective projection with camera distance 10 and zoom 2.5. Visible-node mouse picking at the center/corner and touch picking near the opposite corner remained intact. An otherwise identical void node used 47,089 cells and returned hits in the current renderer; the candidate used zero cells and returned no hits. All 337 existing tests passed with the candidate substituted during bundling.

The candidate was tested in temporary bundles. Production renderer code and the installed plugin bundle were not changed by this investigation. Before shipping, add focused regression coverage for large offscreen bounds, opacity-zero nodes, and viewport-edge picking; then run the normal checks and verify tight Focus zoom in Obsidian.

## Lifecycle and other findings

Renderer disposal clears the picking grid and other renderer caches. Provider/session disposal paths cancel scheduled frame activity and dispose sessions. The investigation did not demonstrate a surviving rendering loop after a completed plugin unload.

A live snapshot showed approximately 2.1GiB renderer-process RSS; a later console snapshot showed approximately 128MiB used JavaScript heap. Those different measurements do not establish retained Graph+ heap or explain post-disable slowness. A CPU/allocation profile captured while slow, followed by plugin disable and a second capture, is still needed to attribute the persistent slowdown.

Two additional issues deserve separate follow-up:

- The application reconciles vault invalidations with zero graph presentations, and it lacks a terminal disposed guard. A probe demonstrated that an explicit `reconcile()` call after disposal still reads the vault. This does not prove that plugin unload actually leaves a caller invoking it.
- Memory compaction has a 4,096-bucket cap but can increase its maximum level on each overflow, making later compaction scans expensive. A synthetic 8,000-observation probe reached level 3,904. The saved state inspected here had only 95 observations, 79 buckets, and maximum level 2, so this is a latent risk rather than the leading explanation for this report.

Priority: fix the bounded picking grid first, then verify the reported tight-zoom and plugin-disable sequence in the live app. Keep the lifecycle and memory-compaction issues separate so their causes and effects can be tested independently.

## Implemented follow-up — 2026-10-03

The user clarified that entering Focus and switching Focus roots are the most obvious
triggers, and authorized removing the transition animation if it contributes work.
Ordinary Focus recentering used twelve camera translations on 16ms timers. Each step
invalidated rendering and picking and emitted a viewport intent. The timer path did
not request its own render frame, leaving playback dependent on other scheduled
activity. This is an additional explanation for choppy transitions, rather than proof
of a surviving workload after plugin disable.

The viewport-bounded picking grid and opacity-zero exclusion are now implemented.
Ordinary Focus entry/hops now translate the camera to the subject immediately in the
committing input frame, preserving zoom, orientation, perspective distance, and
constellation membership. The recenter timer and its twelve intermediate camera
states were removed. The explicitly scrubbed second-press gesture retains its
input-driven progress.

Regression checks cover bounded picking at projected scales 12 and 40 in both
projections, rebuilding through hit testing as well as rendering, void-node hits,
offscreen-center discs, exact circle misses, viewport boundaries and resize, and
rapid Focus root changes with mouse/touch in 2D/3D. The suite passes 341 tests and
TypeScript checking passes. Live Obsidian verification remains necessary to establish
whether this resolves the user's sustained slowdown.
