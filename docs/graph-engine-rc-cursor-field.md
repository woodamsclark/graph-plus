# RC cursor attraction and label reveal

The RC restores a short desktop mouse field using the current engine boundaries.
The legacy source anchors are `6c18309` (2025-11-27 proximity label reveal),
`b6835a2` (2025-12-17 mouse attraction), and `f565030` (2026-06-16 attraction
independent of simulation alpha). `23f376f` removed the label-reveal radius setting
in March 2026. This port restores the behavior, without importing the legacy renderer,
camera, saved settings or simulation.

## Behavior

- Attraction reaches 64 CSS pixels from the mouse, with quadratic distance falloff.
  Only the nearest eligible node receives a pull, capped at 1.5 screen pixels per step.
  Equal screen distances use stable node-ID ordering. A node already at the cursor
  retains ownership of the well; it cannot pass its pull to a runner-up.
- The session projects eligible nodes and converts the screen displacement back to
  their existing camera-depth plane. This gives the same short reach in 2D and 3D.
- Force Layout owns position changes. Attraction works at zero alpha, wakes a cold
  graph without reheating it, and leaves no cursor velocity to replay after leave.
- Void nodes, pinned nodes, camera-tracked subjects and Form layouts are excluded.
  Normal graph forces can still act while their alpha remains above zero.
- Label reveal reaches 96 CSS pixels and fades with cursor distance. It can reveal
  visible dim context without promoting the node or changing membership. Void nodes
  remain hidden. Cursor-only labels use the same distance fade for standard Overview
  nodes and dim Constellation context. Adaptive mode separately preserves the opacity
  of its automatically admitted labels. Ordinary label collision and nearer-disc occlusion checks remain active.
  Proximity labels have a 12-pixel readable font floor, shared by text measurement
  and drawing.
- Labels offers Off, Cursor proximity (the Graph+ default), and Adaptive. Off suppresses
  every label, including hover, root, selected and structural labels. Cursor proximity
  and Adaptive both retain View-required root, constellation and preview labels.
  Extra labels use the 96-pixel distance fade in Cursor proximity or the saliency
  budget in Adaptive. The dropdown replaces the independent proximity
  toggle. Label position remains directly beneath Labels. Legacy All maps to Adaptive.
- Adaptive saliency retains the existing 0–100 saved values but halves the automatic
  label budget across the range. At distant zoom the minimum budgets are 12, 6, and 3
  for saliency 0, 50, and 100 respectively, with a maximum budget of 60. Higher values
  remain more selective; the existing hover-neighbor priority boost is retained.
- Mouse down suspends the field during navigation and dragging. Ctrl-removal also
  suspends it so proximity cannot relight a removed label or move its target. Leave, cancellation,
  disabled input and touch clear it. Touch does not create a hover field.
- Cursor position and attraction steps are transient. They are not exported as graph
  data or settings. Actual node movement follows the existing position persistence rules.

## Settling and restart contract

The first RC port exposed an existing buffer lifecycle mismatch: `stop()` clears
velocities, but `synchronizeBuffers()` used only document/position identity to skip
initialization. After a cursor visit had returned the internal position object,
a later settle-and-wake reached an undefined velocity. `GraphModuleHost` isolated
that tick failure by removing Force Layout from the active module list, so it stayed
off for the session. The fast path now also requires complete velocity buffers.
This retains empty exported cold-state velocities and restarts without stale momentum,
reheating the whole graph, or reanalyzing unchanged topology.

Hover previews show the next admitted View with the same node hovered there.
Overview previews Constellation plus hover; Constellation member hover previews
Focus plus hover; Focus hops preview the new Focus subject plus hover. A Focus root
has no next transition, so root hover preserves its standard neighbors and standard context
links. A hovered neighbor uses its full future-root label size, including during the
preview delay. Constellation admission previews can still raise immediate neighbors
and incident links one degree, with adaptive label priority rather than forced labels.

Preview begins only from an actual node hover. The gravity radius alone cannot
activate it. While Anima is enabled, a primary hover visit waits 0.2 seconds, then
linearly blends from the committed scene to the admitted preview over 0.5 seconds.
Leaving cancels the visit and fades its current strength back to the normal scene
over 0.5 seconds, including when canceled midway through fade-in. Changing targets
starts a fresh delay while the old preview fades out. Strength depends on elapsed
time, not cursor distance. The 96-pixel proximity label reveal remains immediate
and independent. Ctrl membership-removal cues remain immediate.

Anima owns the transient timer and the blend of resolved node, label, outline and
link visuals. The blend preserves absent node outlines; it never adds zero-width
strokes to ordinary nodes. Canvas rejects nonpositive outline widths because assigning
zero to its line width is ignored and would otherwise draw an inherited-width halo. The session supplies its clock and scheduler; a cold graph wakes for
the delay/fade, then sleeps after it finishes. No simulation alpha or graph position
is changed to animate the preview. Actual activation bypasses the timer and retains
its admitted hovered scene immediately. A changed committed View, membership or
projection discards stale prospective state. Suspension cancels the preview rather
than replaying it on resume; suspension and session shutdown clear all wakeups.
There is one admitted transition and one hover presentation pass; the destination hover never plans another transition recursively.
Actual activation commits normally and preserves the admitted hover visit until leave.
Hover alone never commits Attention, Memory, View, or camera interest.

Label position sits immediately after Labels in Display Quick Settings. The cursor
trial was branched from the original RC, while the prior reorder lived on the separate
three-size trial branch; this was a missing carried change, not a settings reset.

## Ownership and validation

`GraphInput` owns canvas-local mouse position; `SessionInteractionRuntime` exposes it.
The session owns screen-to-world conversion. `ForceLayoutModule` integrates the local
step independently of alpha. `CanvasGraphRenderer` resolves nearby label eligibility
and opacity from the same pointer without changing graph interaction or scene roles.
Anima declares the two screen-space radii in presentation policy. Input and Ego
admit the actual node-hover action. Anima resolves the destination scene and applies
that View's hover policy once. Presentation never runs another admission planner
against its hypothetical destination, nor commits the destination View.

Regression coverage includes input lifecycle, cold-layout attraction, pin and Form
exclusion, actual session movement/range in 2D and 3D, unchanged camera framing,
pointer-leave settling, repeated natural settling and waking with shared position buffers,
host failure isolation, nearest-only attraction and destination-plus-hover preview, Display control order, and
label range/void behavior, equal Overview/Constellation fade opacity in both dimensions,
absolute Labels Off, the three live label modes, the shifted saliency budgets,
inert Focus-root hover, future-root hover label size and active-note membership,
timed preview delay/fade/cancellation in every View and dimension, fresh target delays,
partial-fade reversal, immediate activation during waiting, and idle scheduling.
Obsidian desktop visual acceptance remains a separate smoke check.
