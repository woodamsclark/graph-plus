# Graph Engine V1.7.3 Energy and Performance Contract

Status: Diagnostics accepted on desktop; adaptive physics, rendering efficiency,
and consistent focus framing implemented. Mobile lifecycle evidence remains pending.

Date: 2026-09-07

Depends on:

- [Graph Engine V1.7 Interaction, Runtime, Layout, and Recovery Contract](graph-engine-v1.7-mobile-precision-zoom-contract.md)

## 1. Purpose

V1.7.3 begins with observability rather than speculative physics tuning. A user must
be able to capture enough evidence on mobile to distinguish an active visible graph,
a correctly suspended graph, an unexpectedly surviving graph session, an external
consumer session, and an idle provider with no sessions.

The first diagnostic phase does not change behavior. The accepted optimization phase
reduces solver wake frequency and Canvas backing resolution without changing force
equations, topology weighting, input semantics, checkpoint policy, or final layout.

## 2. Diagnostic snapshot

Graph-engine registers a **copy graph-engine diagnostics** command. It copies one
bounded JSON snapshot to the clipboard and also writes the same structured value to
the developer console.

The snapshot reports:

- plugin version and capture time;
- host-document background state;
- mounted graph+ and local graph+ leaves, including actual and tracked visibility;
- mounted graph session DOM count;
- active provider leases grouped by consumer ownership;
- every active runtime session and its consumer, profile, dimensions, document size,
  suspension reasons, animation-frame and delayed-wake state, frame counters, and
  last frame time; and
- compact module diagnostics, including force alpha and whether the solver is running.

Diagnostics must not include node labels, paths, note contents, graph coordinates,
velocities, settings payloads, or canonical graph documents. Capturing diagnostics
does not schedule a frame, reheat physics, export a document or view state, persist
data, or change graph behavior.

## 3. Acceptance

Automated tests must prove that:

1. mounting a session adds exactly one runtime diagnostic record;
2. the record identifies its consumer and pending-frame state;
3. force diagnostics expose only compact activity evidence;
4. suspension reports its state and cancels the pending frame;
5. session disposal and lease release remove their diagnostic records; and
6. diagnostics contain no graph content or per-node motion data.

Manual mobile diagnosis captures snapshots with graph+ visible, covered by another
leaf, closed, and with graph-engine disabled. A fully closed graph+ with no downstream
consumer should report zero active sessions and zero mounted session elements.

## 4. Adaptive physics cadence

Continuous force work is wake-timer driven rather than display-refresh driven:

- every active layout, including active dragging and cooling, requests at most `30 Hz`;
- settled layout requests `0 Hz` and owns neither an animation frame nor a wake timer;
- input, camera commands, document changes, and settings changes interrupt a sleeping
  physics delay and receive an immediate visual frame; and
- each eligible force tick computes the ordinary D3-compatible step and alpha blends the
  whole state transition, giving an effective simulated rate from `30 Hz` down to `0 Hz`.

Rendering a changed physics frame must not independently schedule an immediate
follow-up that bypasses the requested solver delay. If another active module requests
a faster cadence, the runtime honors the fastest request.

Topology-derived physical springs, endpoint degrees, bias, and base spring parameters
are prepared when topology or force settings change. They are reused across force
steps rather than rebuilt and reallocated inside the hot loop. Live Anima length and
strength targets remain dynamic overlays on those cached base values.

## 5. Render quality

The typed Settings catalog exposes **Render quality** globally and per profile. It is
not duplicated in Quick Settings.

- **Automatic** is the default. Graphs below `500` nodes use native device pixel
  ratio; graphs of `500` nodes or more cap the Canvas backing ratio at `2`.
- **High fidelity** uses the native device pixel ratio.
- **Energy saver** caps the Canvas backing ratio at `2` for every graph size.

The limit affects backing-buffer resolution only. Camera geometry, CSS dimensions,
pointer coordinates, hit detection, node sizing, and label sizing remain in logical
screen pixels. A live quality change resizes the existing Canvas rather than replacing
the graph session.

At a native ratio of `3`, a `2` ratio cap reduces Canvas pixel count by approximately
`56%`.

## 6. Optimization acceptance

Automated tests must prove that:

1. hot continuous force work sleeps at approximately `30 Hz`;
2. cooling work remains smoothly scheduled at `30 Hz`, its effective simulated rate falls
   with alpha, and settled work reaches `0 Hz`;
3. continuous physics does not spin animation frames while waiting;
4. immediate camera/input work interrupts a delayed physics wake;
5. Automatic caps a large DPR-3 graph at DPR 2;
6. High fidelity restores DPR 3 without remounting the Canvas;
7. Energy saver caps DPR 3 at DPR 2; and
8. diagnostics report native and effective ratios plus solver target cadence.

## 7. Consistent Graph+ focus framing

Graph+ separates Focus from fitting. Local graph startup fits its initial map once;
direct clicks and active-note hops within the existing map then recenter on the focused
node while preserving scale, angle, and camera distance. An active-note change that
admits new mapped nodes fits once after their known coordinates are installed.
**show in graph+** remains an explicit reveal-and-fit operation.

Focus follows subject translation while physics settles without recalculating zoom.
Clearing focus does not reset the camera. Active filters remain authoritative: hidden
neighbors are not pulled back into view merely to satisfy camera framing. Local graph+
loads known coordinates from the live Global view or saved checkpoint, starts the force
solver settled, and performs one fit after any newly admitted coordinates are installed.
It retains one document identity across Focus hops, and changing only the focused
subject does not rotate layout pins, move nodes, or reheat the solver.
