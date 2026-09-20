# Graph Engine V1.7 Interaction, Runtime, Layout, and Recovery Contract

Status: Implemented; automated suite passes, live desktop/mobile acceptance pending.

Interaction update: The later
[Graph Engine Interaction State Contract](graph-engine-interaction-state-contract.md)
supersedes the V1.7 gesture and selection-camera clauses wherever they differ. The
runtime, layout, recovery, and historical acceptance record in this document remain
applicable.

Date: 2026-09-06

Depends on:

- [Graph+ and Graph Engine V1 Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.6 Anima Presentation and Native Motion Contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)

## 1. Purpose

V1.7 adds a one-finger precision zoom gesture for mobile use, a bounded graph update
pipeline, workspace-leaf-aware background suspension, an optional 3D axial flattening
spring, Graph+ recovery and settings cleanup, and direct Obsidian-to-Graph+
navigation and native note preview. These additions preserve the accepted two-finger
pinch gesture and Graph+'s selection-centroid camera model. The complete normative
input table is [Graph+ UI Interaction Matrix](graph-plus-ui-interaction-matrix.xlsx).

## 2. Normative gesture

The gesture is:

1. Tap once.
2. Tap a second time within the engine's double-tap interval.
3. Keep the second touch held.
4. Drag vertically to zoom continuously.

Dragging down zooms in. Dragging up zooms out. Reversing direction during the same
gesture reverses the zoom continuously. Releasing the second touch ends the gesture
without kinetic continuation.

The first and second taps must satisfy the existing spatial tolerance for a double
tap. Vertical movement must cross a small drag threshold before zoom begins so hand
jitter cannot consume an ordinary double tap.

## 3. Camera semantics

- Zoom is anchored at the second tap's screen position when the active camera
  projection supports cursor-anchored zoom.
- If anchored zoom is unavailable for the active projection, the current camera
  target remains the zoom reference.
- The mapping is continuous and multiplicative, so equal vertical travel produces a
  comparable perceived scale change regardless of the starting zoom.
- Existing camera minimum and maximum zoom/distance limits remain authoritative.
- The gesture works in both 2D and 3D in Overview or Explore.
- Focus, selection, explicit pins, canonical positions, Filter state, and Form state
  remain unchanged.
- Direct user zoom input cancels nonessential Anima camera choreography under the
  existing user-input precedence rule.

A stationary one-finger long press or secondary click on graph background performs
Center + Fit. Center targets the arithmetic centroid of selected nodes, or of the
complete visible graph when nothing is selected. Fit adjusts zoom or camera distance
to contain that same target. Angle, orientation, and up vector remain unchanged. A
stationary long press or secondary click whose hit test resolves a node retains the
node context-menu behavior instead. Explicit Reset Camera remains a separate operation.

### 3.1 Canonical navigation matrix

| Input | `2d` | `3d` Overview | `3d` Explore |
| --- | --- | --- | --- |
| Desktop primary background drag | Pan | Pan | Pan |
| Desktop secondary drag | Pan | Rotate | Rotate |
| Unmodified trackpad translation | Pan | Pan | Orbit |
| Trackpad pinch or Ctrl-wheel | Zoom around input | Zoom around input | Zoom around input |
| Mobile one-finger background drag | Pan | Pan | Orbit |
| Mobile two-finger translation | Pan | Rotate | Pan camera-focus offset |
| Mobile pinch | Zoom | Zoom | Zoom |
| Double-tap, hold, vertical drag | Precision zoom | Precision zoom | Precision zoom |

Mobile two-finger navigation is resolved only after pinch arbitration. A qualifying
pinch always wins over translation. Two-finger rotate and pan retain selection.

## 4. Gesture arbitration

Once the second held tap crosses the zoom threshold, precision zoom owns that pointer
sequence. The same sequence must not:

- focus, select, activate, or open a node;
- begin or complete node dragging;
- pan or orbit the camera;
- open a long-press context menu;
- leave a hover or pressed-node highlight latched; or
- emit a click or double-click action on release.

The gesture may begin over a node or over the background. Hit detection on either tap
does not change the resulting zoom behavior after the threshold is crossed.

Before the threshold is crossed, existing tap behavior remains eligible. A completed
stationary double tap is not assigned a new semantic action by this contract. If the
second tap is released without qualifying as precision zoom, the interpreter resolves
the sequence through the existing click/selection rules without synthesizing extra taps.

A second pointer joining the sequence cancels the one-finger candidate and hands
control to the existing two-finger pinch/pan recognizer. Suspension, view invalidation,
pointer cancellation, or loss of capture clears the candidate without changing graph
state.

## 5. Input ownership

Recognition belongs to Graph Engine's input interpreter. Camera movement continues
through the engine camera controller. Consumers receive semantic camera effects and
existing intents; they do not receive raw touch events or implement competing
double-tap recognizers.

No new GraphDocument or GraphViewState field is required. Sensitivity and thresholds
may initially be engine constants. A later version may expose them through an input
profile if on-device evaluation demonstrates a real need.

## 6. Graph pipeline frequency ceiling

V1.7 caps active Graph Engine work at 60 updates per second on every platform,
including displays whose `requestAnimationFrame` callback runs at 90, 120, 144, or
more hertz. Sixty hertz is a ceiling, not an idle target: settled or suspended graphs
continue to schedule no unnecessary work.

The cap covers:

- force integration and Anima advancement;
- camera gesture and choreography advancement;
- frame contribution and composition;
- Canvas rendering;
- hover and hit-test work that can be coalesced safely; and
- persistence invalidation caused only by intermediate animated frames.

The runtime uses a monotonic clock and a minimum presentation interval of `1 / 60`
second. Input received between eligible frames is coalesced to the latest complete
state without dropping the final semantic result. Discrete commands, focus changes,
document mutations, and accessibility state may update immediately, but their
expensive graph-wide presentation work is coalesced into the next eligible frame.

Physics advances by at most one fixed `1 / 60`-second integration step per eligible
frame. A delayed callback does not execute a multi-step catch-up burst. Excess backlog
is bounded and discarded so a temporarily blocked host cannot create a spiral of
death, abrupt layout jump, or long recovery frame. The solver's cooling schedule is
defined in simulation ticks and therefore remains deterministic under the cap.

The frequency ceiling is independent from numerical safety. Every force step and
restored force snapshot must also enforce finite coordinate, velocity, and magnitude
bounds; invalid or implausible saved motion state is discarded and reheated from safe
positions. Frame throttling may not be treated as protection against solver overflow.

## 7. Workspace-leaf background suspension

Graph+ treats visibility of its own Obsidian workspace leaf separately from visibility
of the containing browser document. A mounted Graph+ leaf that is covered by another
tab, moved into an inactive tab group, or otherwise not presented to the user is
backgrounded even when Obsidian itself remains visible.

While backgrounded, the session must suspend:

- force integration and solver cooling;
- Anima advancement and camera choreography;
- frame contribution, composition, and Canvas rendering;
- hover, hit testing, and pointer interpretation;
- resize-driven presentation work; and
- checkpoint writes caused only by intermediate animated state.

Suspension cancels any already requested animation frame and retains the exact current
document, positions, velocities, force heat, camera, focus, selection, pins, Filter,
Form, and profile state. Backgrounding is a pause, not a layout reset, simulated time
must not accumulate while paused, and returning to the leaf must not produce a physics
catch-up burst or camera jump.

Vault and metadata events may continue to arrive while the leaf is backgrounded.
Graph+ records that reconciliation is required but coalesces any number of those events
into at most one reconciliation when the leaf becomes visible again. It must not build,
project, render, or reheat the graph once per background event. On visibility return,
Graph+ reconciles once against the latest source snapshot, applies any required bounded
reheat, renders the current state, and resumes continuous work only while a subsystem
actually requests another frame.

Closing the leaf continues to dispose the consumer and its resources completely.
Background suspension does not unregister the view, discard its checkpoint, or make a
second Graph+ leaf authoritative. If multiple Graph+ leaves are supported, visibility
is evaluated independently for each mounted leaf.

## 8. Acceptance requirements

Automated pointer traces must prove:

1. Double-tap, hold, and drag down increases zoom in 2D and 3D.
2. Double-tap, hold, and drag up decreases zoom in 2D and 3D.
3. Direction reversal changes zoom direction without starting a new gesture.
4. Zoom remains finite and inside camera limits under extreme travel.
5. Beginning over a node never drags, focuses, activates, or opens that node once the
   zoom threshold wins.
6. Explore 3D precision zoom does not rotate and preserves selection.
7. A second pointer cleanly transfers arbitration to pinch without a zoom jump.
8. Cancellation and suspension leave no pointer capture, timer, pressed state, hover,
   or scheduled frame behind.
9. Existing single tap, selection edits, background clearing, one-finger pan/rotate,
   selection-sensitive two-finger pan/rotate, pinch, node drag, and long-press tests remain
   passing.
10. A synthetic 120 Hz and 144 Hz callback stream produces no more than 60 physics,
    Anima, composition, render, or coalescible hit-test updates per second.
11. A delayed callback advances physics at most once and does not burst through saved
    elapsed time.
12. Settled, hidden, and suspended sessions remain idle rather than waking at 60 Hz.
13. Extreme finite restored velocities and coordinates are rejected or normalized
    before they can reach rendering, camera fitting, or checkpoint persistence.
14. Resetting layout data removes only the named vault's disposable view state and
    cannot delete or rewrite its canonical graph document.
15. After a layout reset and reconnect, every visible document node receives a safe
    initial position, the camera fits the regenerated graph, and the reset state
    replaces rather than races with the prior live session checkpoint.
16. Invoking **show in graph+** from a Markdown file tab opens or reveals graph+ and
    focuses the stable note node for that exact vault-relative path.
17. A filtered target receives a temporary reveal without mutating the persisted
    Filter query; clearing or transferring focus removes the exception.
18. The command uses ordinary selection and focus state, so camera targeting and
    Anima neighborhood highlighting cannot diverge from direct node focus.
19. On the first quick-settings render, the complete panel is minimized to its launcher.
    Opening it reveals every collapsible section closed by default; after the user opens
    or closes a section, subsequent sidebar rerenders preserve each section's choice
    independently for the lifetime of the panel.
20. Quick settings expose no topology-weighting mode selector, and restored profiles
    containing the retired uniform mode resolve to topology-weighted layout.
21. In 3D free layout, selecting the Y axial spring and increasing stiffness reduces
    Y displacement toward the XZ plane while preserving nonzero X and Z variation.
22. Axial stiffness `0%` is behaviorally identical to Off, while `90%` strongly
    flattens the chosen dimension without converting the session to 2D.
23. Changing the axis or stiffness updates the mounted layout live with bounded heat;
    explicit pins remain fixed and camera orientation does not change the force axis.
24. The axial controls are hidden or inert in 2D and do not alter Form-derived
    positions, canonical graph data, Filter state, focus, or selection.
25. Covering Graph+ with another Obsidian tab cancels its scheduled frame and produces
    no physics, Anima, camera, composition, render, hit-test, or animated-checkpoint
    work while the containing Obsidian window remains visible.
26. Background suspension preserves positions, velocities, heat, camera, focus,
    selection, pins, Filter, Form, and profile state without accumulating simulated
    elapsed time.
27. Any number of vault or metadata events received while backgrounded produces at
    most one source reconciliation when Graph+ becomes visible again.
28. Returning to Graph+ renders the latest graph without a catch-up burst, camera jump,
    duplicate session, or unnecessary continuous frame loop after the solver settles.
29. Hiding one Graph+ leaf does not suspend a different visible Graph+ leaf, and closing
    a backgrounded leaf still releases all of its listeners, timers, frames, and leases.
30. The main plugin settings page places Profiles first, displays global settings
    directly below it, and contains no selector that presents Global as a profile or
    settings target.
31. Opening a profile editor uses a modal that shows only the curated settings the
    profile may override, identifies inherited versus overridden values, and can reset
    an individual override or all overrides without changing global values.
32. The main settings page, profile modal, and Quick Settings obtain labels, control
    types, ranges, choices, units, scope, and reset behavior from one shared settings
    presentation catalog rather than maintaining conflicting UI definitions.
33. Every exposed boolean uses a toggle, every finite choice uses a dropdown or
    equivalent selection control, every bounded numeric value uses a slider, and no
    user is required to enter raw text or JSON to configure an enumerated, boolean, or
    bounded numeric setting.
34. Changing a persistent appearance, layout, motion, or region control through Quick
    Settings updates the active profile override and is immediately reflected in the
    profile modal and every active session using that profile.
35. Filter, Form, focus, selection, and camera actions remain graph/session state and
    do not silently become global or profile settings merely because Quick Settings
    presents them beside persistent controls.
36. The ordinary settings surface exposes neither raw module enablement nor solver
    internals such as alpha decay, alpha minimum, Barnes-Hut theta, maximum speed,
    affinity bounds, evidence scaling, reciprocal boost, hub discount, or derived
    spring-scale bounds.
37. Holding the platform Mod key while hovering a visible note node requests Obsidian's
    native Page Preview for that note without changing graph focus or selection.
38. Mod becoming active after the pointer is already resting over a note node produces
    the same preview as entering that node while Mod is already held.
39. Moving directly between note nodes updates the preview target to the newly hovered
    note, while releasing Mod or moving to the background, a tag node, or an unavailable
    note clears the prior Graph+ preview without leaving a stale popover.
40. Tag nodes never request a Page Preview, including when their labels resemble note
    paths or when they are connected to a focused note.
41. Preview uses the note's exact vault-relative path and Obsidian's registered hover
    source and native preview lifecycle; Graph+ does not render a second proprietary
    note-preview surface.
42. Preview activation and dismissal do not open, focus, select, drag, pin, reheat, or
    mutate the graph and stop cleanly when the leaf is backgrounded or disposed.
43. Rebuilding the main Settings page or profile modal after any setting change keeps
    the user's current scroll position instead of returning the surface to the top.
44. A stationary mobile long press on background resets the camera, while the same
    gesture on a node continues to open that node's context menu.
45. Moving from a Mod-hovered note into its native Page Preview keeps the popover open,
    retains the node's Anima hover presentation, allows ordinary pointer and wheel
    scrolling inside it, and releases the latched hover when Mod is released.

Manual acceptance requires physical iOS testing in portrait and landscape, beginning
over both nodes and background, at near and far zoom limits, in focused and unfocused
2D and 3D graphs. The chosen sensitivity must permit useful one-thumb control without
requiring large travel or causing abrupt scale jumps.

Desktop acceptance requires invoking **show in graph+** from an already open graph,
with no graph open, and with the target excluded by an active Filter. Each case must
reveal the correct node without opening a duplicate Graph+ leaf or changing the saved
Filter query. It also requires exercising Page Preview by pressing Mod before entering
a note node and after already hovering one, transferring directly between two notes,
and moving from a note to a tag and to the background. These checks must use Obsidian's
core Page Preview plugin rather than a test-only replacement.

## 9. show in graph+ host navigation

graph+ registers a **show in graph+** item with Obsidian's file context-menu event.
The item is required for Markdown file-tab context menus and may also appear in other
single-file contexts, such as the File Explorer, when Obsidian supplies the same
unambiguous `TFile` target. It is absent or disabled while the bundled graph+ consumer
is disabled.

Invoking the item:

1. resolves the target from the supplied file object and its vault-relative path;
2. reuses and reveals an existing graph+ leaf, or creates exactly one when none exists;
3. waits for the graph+ consumer and its initial reconciliation to become ready;
4. serializes the explicit request after any in-flight automatic active-note follow and
   prevents activation events caused by revealing graph+ from replacing its target;
5. resolves the path through the same stable note-ID adapter used to construct the
   canonical graph;
6. applies ordinary graph+ selection and focus to that node; and
7. lets the existing focus controller target and follow the moving node while Anima
   derives all neighbor and incident-link presentation from that focus state.

The command does not maintain a second navigation highlight or camera-focus state.
Focus remains the single source of truth, and normal background defocus or focus
transfer clears the result exactly as if the node had been clicked in graph+.

If the note is absent from the current canonical snapshot, Graph+ performs one normal
reconciliation before reporting that the node is unavailable. If the note exists but
the projection Filter excludes it, Graph+ adds a transient reveal exception for only
the target node. Existing neighbors and links remain visible only when permitted by
the active Filter. The exception is neither written into the Filter query nor stored
in the checkpoint, and it ends when focus clears, moves to another node, the file is
deleted, or the graph session closes.

## 10. Native note preview

V1.7 integrates note-node hover with Obsidian's native **Page Preview** system. On
macOS, holding Command while hovering a visible note node requests a preview. On other
desktop platforms, the equivalent platform **Mod** key is used, normally Control.
Touch and pen input receive no new preview gesture in this version.

Graph+ registers a dedicated Obsidian hover-link source with modifier-required behavior.
When a mouse pointer is over a visible note node and Mod is held, the host adapter
resolves the node through the same stable note lookup used for activation and emits an
ordinary Obsidian hover-link request using the exact vault-relative Markdown path. The
Page Preview core plugin remains responsible for preview content, delay, placement,
theme, navigation, and ordinary popover behavior.

The gesture is order independent. It works when the pointer enters a note while Mod is
already held and when Mod is pressed while the pointer is already resting over a note.
Moving directly to another note transfers the native preview target. Moving to the
background, a tag node, a filtered or removed node, or outside the Graph+ surface clears
Graph+'s preview eligibility and must not leave the prior note preview latched. Releasing
Mod also clears eligibility through Obsidian's native dismissal path and does not
synthesize a graph command.

After the native popover opens, Graph+ provides a short pointer-handoff window between
the canvas node and Obsidian's preview element. Entering the preview preserves its
anchor and the node's semantic Anima hover, then delegates pointer and wheel behavior
to Obsidian so long notes can be scrolled. The semantic node hover is latched while Mod
is held and is released when Mod is released, even after the pointer has left the graph.

Tag nodes are deliberately inert. Graph+ does not emit a hover-link request for a tag
node, attempt to preview a tag search, or infer a note merely because a tag label
resembles a path. A missing note lookup similarly produces no preview request.

Graph Engine owns hit testing and exposes semantic hover identity plus current modifier
state. It does not import Obsidian APIs or render note content. The Graph+ Obsidian host
adapter owns registration of the hover source, note-node resolution, native event
bridging, anchoring, and popover cleanup. Preview is a host presentation effect only: it
does not alter focus, selection, Anima highlighting, camera position, physics heat,
pins, Filter, Form, checkpoints, or canonical graph data. Background suspension and
view disposal clear preview eligibility and release all preview-related listeners.

## 11. Settings cleanup and layout recovery

V1.7 replaces the implementation-oriented settings browser with one coherent Graph+
settings experience. The main plugin settings page is the global settings surface;
Global is a scope, not a profile, and therefore does not appear in a **Settings for**
dropdown or any equivalent profile selector. The page does not require the user to
navigate between **Graph+ product**, **Graph Engine**, and **Graph+ — Default** panes.
Subsystem ownership remains explicit in code and persistence but is not exposed as
primary user navigation.

The internal ownership rule is:

- Graph+ owns vault interpretation and Obsidian integration, including whether Graph+
  is enabled, default tag inclusion, duplicate-link interpretation, host navigation,
  checkpoints, and recovery;
- Graph Engine owns presentation and behavior of an already supplied graph, including
  rendering, labels, camera, input, physics, Anima, and node regions; and
- the unified Graph+ settings page may present both kinds of setting together according
  to user intent rather than implementation ownership.

The core resolution order remains:

```text
engine defaults
  -> global user settings
  -> consumer profile defaults and locks
  -> user profile overrides
  -> current-session overrides
  -> effective settings
```

The Settings page, profile editor, and Quick Settings are interfaces over this one
model. None owns a parallel settings document or private copy of a persistent value.
Graph Engine provides a shared presentation catalog for intentionally user-facing
settings. Each catalog entry defines its user-facing name, purpose-based category,
control type, allowed choices or numeric range and step, optional unit, editable
scopes, reset behavior, and whether it is suitable for the compact Quick Settings
surface. The full and compact interfaces may lay out the same entry differently, but
they do not independently redefine its meaning or valid values.

The main page uses concise, purpose-based sections in this order:

- **Profiles** for viewing the active consumer profiles and opening their editors;
- **General** for Graph+ availability, vault interpretation, and default dimension;
- **Appearance** for labels, node size, link thickness, arrows, and visible region
  treatment;
- **Layout and motion** for a curated set of outcome-oriented spacing, link, repulsion,
  damping, collision, and 3D axial-spring controls; and
- **Data and recovery** for reset and recovery actions.

Grouping is not permission to expose every registered module setting. The ordinary
surface contains only controls with a comprehensible user outcome. It does not expose
raw module enablement, topology mode, alpha decay, alpha minimum, Barnes-Hut theta,
maximum solver speed, affinity bounds, evidence logarithm factor, reciprocal boost,
hub discount exponent, or derived minimum and maximum spring scaling. V1.7 does not
add a **Settling speed** control. A later version may introduce a product-level motion
concept only after its behavior and value are intentionally designed.

Control widgets follow the value semantics. Booleans use toggles; finite choices use
dropdowns, segmented controls, or selectable chips; bounded numbers use sliders with
appropriate steps and visible values; tag or token sets use selectable tags or a
purpose-built multi-select. Raw text input is reserved for values that are semantically
free text, such as a user-authored profile name. Raw JSON is not an ordinary settings
control. Precise numeric entry may supplement a slider later, but cannot replace the
bounded control.

The **Profiles** section does not replace the global page. It presents each registered
consumer profile as a compact summary with a **Customize…** action. Customization opens
a modal containing only presentation-catalog entries permitted at profile scope. Each
row identifies whether its current value is inherited from Global, supplied by the
consumer, locked by the consumer, or explicitly overridden by the user. The user may
reset one override or all overrides. Resetting profile overrides never mutates Global.

Quick Settings remains an alternate compact interface over the same core model:

- persistent appearance, layout, motion, and region controls write the active user
  profile overrides and update other sessions using that profile;
- Filter, Form, focus, selection, and camera remain current graph/session state and
  continue through the session control and checkpoint paths; and
- disclosure state remains local presentation state and is not promoted into graph or
  profile settings.

Changing a persistent setting through Quick Settings must be reflected immediately in
the profile modal and vice versa. The interfaces may not drift in ranges, choice labels,
defaults, or reset semantics. Quick Settings does not require a separate **Save to
profile defaults** action for its persistent controls.

Destructive recovery actions appear in a visually separate **Danger zone** at the end
of **Data and recovery**. The Danger zone includes **Reset graph layout data for this
vault**.

The complete Quick Settings panel is minimized to its launcher on first render. When
opened, every collapsible section is initially closed. Disclosure state is presentation
state only: collapsing the panel or a section does not disable or alter its underlying
feature, including an active Form projection. If the user opens or closes a disclosure,
ordinary quick-settings rerenders preserve each section's choice independently rather
than restoring the default while the panel remains mounted.

Settings surfaces retain their scroll position across an internal rebuild caused by a
toggle, dropdown, slider, or reset action. This applies to both the main plugin Settings
page and profile customization modal.

Topology-weighted layout is the only supported free-layout mode in V1.7. Quick
settings no longer expose a topology-weighted versus uniform/homogeneous selector,
and the corresponding user override is removed from the supported settings surface.
When an older profile or checkpoint contains the retired uniform value, migration
discards that value and resolves the profile to topology-weighted layout. The retired
mode is not retained as a hidden compatibility path. This change applies to the free
force layout only; Form-derived layouts remain governed by Form.

The reset action:

- closes or suspends the current Graph+ session before persistence changes;
- requires an explicit confirmation naming the affected vault;
- removes saved positions, velocities, force heat, pins, camera placement, focus,
  selection, hover, and other transient interaction state;
- preserves the canonical graph document, notes, tags, links, Graph+ preferences,
  engine/profile settings, Filter query, Form configuration, palette, and label
  placement preference;
- reconnects from the preserved canonical document, generates safe initial positions,
  reheats the solver, and fits the camera; and
- writes the fresh view state before reporting success, preventing the discarded live
  session from checkpointing stale data over the reset.

The confirmation explains that node placement, camera framing, pins, focus, and
selection will be lost, while vault content and graph filtering remain unchanged. The
control is unavailable while no Graph+ vault session can be resolved unambiguously.

This recovery action is distinct from numerical self-healing. Implausible saved
coordinates or velocities must still be rejected automatically during ordinary load;
the user should not need to discover and operate the Danger zone after the same class
of corruption occurs again.

## 12. Three-dimensional axial spring

V1.7 adds an optional world-axis spring to the free 3D force layout. Its purpose is to
let the user continuously tune the graph between a fully volumetric galaxy and a
flatter, more legible spatial arrangement without switching to true 2D.

Quick settings expose these profile-backed controls under **Forces**:

- **Axial spring**: Off, X, Y, or Z;
- **Axial stiffness**: `0%` through `90%`.

The selected name identifies the coordinate pulled toward zero, and therefore the
plane produced by the spring:

- X pulls `x` toward zero and forms a YZ-oriented plane;
- Y pulls `y` toward zero and forms an XZ-oriented plane; and
- Z pulls `z` toward zero and forms an XY-oriented plane.

This terminology avoids the mathematically different behavior of pulling nodes onto
the named axis, which would collapse the graph toward a line. The force uses stable
world coordinates and does not rotate with the camera.

For each unpinned simulated node, the selected coordinate receives this additional
velocity contribution once per solver tick:

```text
axisVelocity += -axisPosition * (stiffnessPercent / 100) * 0.1 * alpha
```

`0%` is identical to Off. The `90%` ceiling remains a spring rather than a hard
constraint: topology, links, repulsion, collision, and momentum may retain visible
depth. Explicit pins remain authoritative. Changing the axis or stiffness reheats the
solver only enough to settle toward the new equilibrium and does not reset positions
or the camera.

The control applies only to the 3D free force layout. It is hidden or inert in 2D and
while Form owns derived positions. The setting is ordinary profile state and therefore
persists through session recreation without entering the canonical graph document.

## 13. Non-goals

V1.7 does not require:

- replacing pinch-to-zoom;
- assigning an action to a stationary double tap;
- zoom inertia;
- platform-specific automatic sensitivity;
- replacing Obsidian's native file-menu behavior or changing the active Markdown file;
- clearing or rewriting a Filter merely to reveal a context-menu target;
- previewing tag nodes or implementing a Graph+-specific note renderer;
- a camera-relative flattening plane or a hard planar constraint;
- exposing a settling-speed control or raw solver-tuning console;
- changing desktop wheel, trackpad pan, pinch, or Cmd-scroll behavior; or
- changing focus, selection, node-drag, or activation semantics.
