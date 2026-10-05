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
  remain hidden, Labels Off is respected, and ordinary label collision and nearer-disc
  occlusion checks remain active. Proximity labels have a 12-pixel readable font floor,
  shared by text measurement and drawing.
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

Overview again previews the admitted Constellation destination, fading linearly from
its ordinary scene as the nearest visible node enters the 64-pixel cursor well.
Strength is `clamp(1 - screenDistance / gravityRadius, 0, 1)`: zero at the edge,
50% halfway inward, and 100% at the center. Fixed nodes can receive presentation
preview but remain ineligible for physical attraction. The scene blend includes node
and link opacity, colors, outlines and label expression. Newly forced destination
labels fade in; the existing 96-pixel proximity label reveal remains independent.

The session supplies a pure proximity admission plan; input picking and click targets
remain based on actual node hits. Partial preview never commits Attention, Memory,
View or camera interest. Actual node activation commits normally and retains the
existing consumed-hover latch. Ctrl, touch and navigation do not create a proximity
preview. When gravity moves a node under a stationary cursor, distance is recomputed
and the scene is refreshed. Leaving restores ordinary Overview.

Label position sits immediately after Labels in Display Quick Settings. The cursor
trial was branched from the original RC, while the prior reorder lived on the separate
three-size trial branch; this was a missing carried change, not a settings reset.

## Ownership and validation

`GraphInput` owns canvas-local mouse position; `SessionInteractionRuntime` exposes it.
The session owns screen-to-world conversion. `ForceLayoutModule` integrates the local
step independently of alpha. `CanvasGraphRenderer` resolves nearby label eligibility
and opacity from the same pointer without changing graph interaction or scene roles.
Anima declares the two screen-space radii in presentation policy. The projection
coordinator evaluates baseline and admitted preview through the same presentation
pipeline; `AnimaSceneBlend` interpolates their resolved expression. It never runs
physics or graph projection, and neither scene evaluation commits a View.

Regression coverage includes input lifecycle, cold-layout attraction, pin and Form
exclusion, actual session movement/range in 2D and 3D, unchanged camera framing,
pointer-leave settling, repeated natural settling and waking with shared position buffers,
host failure isolation, nearest-only attraction and continuous Constellation preview, Display control order, and
label range/void/Off behavior. Obsidian desktop visual
acceptance remains a separate smoke check.
