# Quick Settings live updates

Slider `input` events immediately update the namespaced in-memory profile override
and the adjacent numeric field. The Reset control appears as soon as an override
exists, without rebuilding the panel or replacing its active slider element.

All open panels share one runtime update coordinator. Rapid inputs retain their
latest values and request at most one profile refresh per animation frame. The
running graph receives these changes during dragging. Sessions whose effective
settings did not change perform no additional composition or projection work.

Persistence uses a 250ms quiet-period debounce. Slider change/release/cancellation,
keyboard completion, and numeric-field change/blur flush the latest pending value.
Duplicate completion events do not produce extra writes. Panel disposal also
flushes; plugin shutdown cancels scheduled runtime work and awaits pending saves
before releasing the provider. A failed save retains pending work for a retry and
reports the error. Discrete controls retain their awaited update/save behavior.

Projection reuse follows module capabilities: live settings on an existing module
without source, topology, or render-selection hooks reuse the projected document.
Module activation, replacement, structural settings, and profile-level changes
remain conservative and reproject. Visual updates invalidate cached presentation
and hover targets without restarting the current hover visit or fade.

Force coefficient changes retain topology analysis, physical endpoint grouping,
degree bias, and tag-closure counts. Link strength/distance update spring parameters;
component padding updates packing targets. Topology policy, document, and region
membership changes still rebuild topology. Unchanged settings and damping-only
changes do not reheat; other effective force changes retain the existing reheat
and physics cadence, once per coalesced runtime update.

Automated coverage exercises rapid input, updates before release, duplicate release
events, numeric entry, Reset visibility, persistence debounce/failure/concurrency,
disposal/shutdown, projection preservation, structural invalidation, hover caches,
and coefficient behavior against a freshly constructed solver in 2D and 3D.
The UI tests use minimal Obsidian widget doubles; physical desktop and mobile
dragging remain a separate acceptance check.
