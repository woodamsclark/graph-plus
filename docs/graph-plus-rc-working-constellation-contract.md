# RC labels and working constellation

Updated 2026-10-05. This supersedes the prior independent cursor-label toggle and
Focus-root neighbor promotion. The existing 0.2-second preview delay and 0.5-second
fade in/out remain.

## Labels

Display Quick Settings offers exactly three choices:

- **Off:** no node labels, including root, selection, hover, structural and cursor labels.
- **Cursor proximity (default):** labels reveal within 96 CSS pixels with the existing
  distance fade, collision/occlusion checks and 12-pixel readability floor. View-required root, constellation and preview labels remain visible independently
  of the cursor. Only extra labels use proximity instead of the adaptive algorithm.
- **Adaptive:** the existing saliency budget, semantic ordering and interaction label
  priorities. No cursor-only reveal runs in this mode.

Label position stays directly beneath Labels. The old proximity toggle is retired.
Existing explicit Adaptive/Off choices are retained; saved All maps to Adaptive. The
engine can still accept All for other consumers, while Graph+ exposes only these three
choices. Mouse gravity is unaffected by label mode.

## Focus

Hovering the current root has no prospective action and leaves node/link/label styling
unchanged. Its nonmember neighbors remain standard, and unrelated context remains void.
Hovering a neighbor previews admission and making that node the new root. Its label
uses its full resolved root-size treatment instead of the half-size neighbor treatment,
including during the preview delay. Every other non-root Focus label stays reduced, including nodes beyond the
original root neighborhood, so preview cannot accidentally restore their full size.
The admitted destination root has standard nonmember neighbors; it does not promise a
further View transition on hover.

A Focus hop retains the prior root, all admitted members and the new subject in the
working constellation. This applies to engine activation and application-directed
Focus, including Local active-note following. Local note arrival previously replaced
Attention with a singleton and could erase the prior Focus trail.

## Active notes and clearing

Active-note events add their node to each open Graph+ working constellation. Global
arrival preserves View, Focus subject, camera and geometry. Local continues its
existing active-note Focus following while retaining earlier members. This is active
membership, not a second remembered-node layer or bounded historical Memory trail.

The active startup note seeds membership without forcing a View change. Consecutive
duplicate host events do not resurrect a cleared group. Rapid activations retain each
note even when the follow queue coalesces its latest subject. A newly activated note
not yet in canonical graph data waits for canonical reconciliation before admission.

Returning from Constellation or Focus to Overview preserves constellation membership,
including pending unavailable-note admissions. A constellation member's secondary-click
context menu includes Clear constellation; non-members do not offer it. Explicit clear
removes the working group and cancels pending admissions. Local remains Focus-only and
retains its required root while removing the other members. A later distinct note
activation starts building the group again.

Regression coverage lives in `views.test.ts`, `ego.test.ts`,
`ego-interaction-plan.test.ts`, `v16-native-presentation.test.ts`, and Graph+ adapter and
settings-controller tests. Automated checks do not replace Obsidian visual acceptance.

## Hover peeking and camera navigation

Primary node hover borrows the admitted destination View's input policy and spatial
pivot: Overview to Constellation, Constellation member to Focus, and Focus neighbor
to its prospective root. Constellation candidate admission keeps Constellation's
controls. This navigation lane does not realize Attention, Awareness, Memory,
View changes, note activation, or the working constellation's clear-on-Overview rule.

The borrowed pivot is the hovered node's coordinate, including dim Constellation
candidates whose next action is admission rather than Focus entry. It does not recenter or refit on hover. Trackpad swipes in 3D Overview
therefore orbit while peeking rather than panning; unanchored zoom, drag navigation
and Focus elastic pan also use the borrowed View. Camera gestures retain the peek
scene rather than replacing it with the underlying View mid-gesture. Center and Fit
use the borrowed scene when invoked during a peek.

Leaving restores only the previous navigation pivot and input policy. The complete
camera pose, including position, orientation, target and zoom, stays untouched. The visual scene uses the existing
0.2-second delay and 0.5-second fades. Hover-only node motion and node dragging do
not transfer camera-follow ownership to the peeked subject. A matching click commits
the admitted destination; Overview commitment preserves camera framing; Focus entry or a root switch recenters
without changing angle or scale, and subsequent leave cannot restore the old target. Modifiers, different
press targets, reset/suspension and external state changes release the temporary lane.

Graph+ enables `framing.focus.entry: recenter`. Ordinary Focus entry, root hopping,
programmatic Focus and Local active-note following recenter on the new root while
preserving orientation, distance and zoom. Hover entry/exit still does not move the camera.
Right-click Center + Fit remains the explicit graph gesture for reframing/resizing.
Initial surface framing and the explicit Show in Graph+ reveal/fit operation remain
available. Other engine consumers retain their configured framing policy. Peek exit never calls a camera transform or fit.

Cursor gravity reaches 16 CSS pixels; label proximity remains independently fixed
at 96 CSS pixels. Changing label mode does not change the gravity radius.

All non-void source-View nodes are hover targets, including disconnected dim
Constellation candidates. A temporary Focus peek cannot revoke targets visible in
its underlying Constellation: picking falls back to the committed scene without
changing its rendered appearance. Committed Focus void nodes remain unavailable.
Clicking a primary node in Graph+ retains that node as camera interest, including
Overview-to-Constellation admission after a previously retained focal point. Hover
admission keeps the correct View step and does not recursively enter Focus.

Forces Quick Settings offers Cursor gravity: Soft, Clingy, Off. Soft uses
a broad shallow hyperbolic well; Clingy uses a narrower deeper well and a stronger
bounded step. Both reach 16 CSS pixels, capture only the nearest eligible node and
cannot overshoot the cursor. Off removes attraction, never label proximity or
hover peeking. The label reveal radius stays 96 CSS pixels in every mode. The choice
is stored as `anima.cursorGravity` through the normal profile settings path.

Clingy is enabled by default. Gravity pauses for the duration of a node drag.
RC excludes region capabilities, forces and controls, including saved enabled overrides.
Drag input bursts compose and publish their final position once per frame.

Graph+ RC reserves plain Space for a temporary physics override: while held, force layout ticks at alpha 1 even if disabled in settings. Release or window blur restores the configured behavior. Holding Space never clears the constellation or changes saved settings.

Cursor proximity label reveal pauses immediately while hovering any node, and resumes in empty space. View and peek label policies continue to apply; cursor gravity is unaffected.

Local Graph+ is Focus-only. Background clicks and Escape cannot exit Focus; absence of an active Markdown note retains the last root. Document internal-link hover is resolved by the Obsidian bridge and forwarded only to Local presentations through the engine node-hover input. It shares graph hover highlighting, root-sized label styling, timed peek/pivot and fade-out without committing Attention or Focus. Link leave clears the host hover. Global remains independent.

Cmd + single click on a node with its note preview already open invokes its registered open-note action immediately. It does not commit a View transition or change constellation membership. Cmd click without an open preview retains ordinary behavior.

Reopening a side pane containing Local Graph+ recenters its camera on the committed Focus root. Visibility is synchronized on workspace layout changes and view resize; repeated visible resize does not recenter. Reveal preserves zoom, orientation and graph positions. Global reveal preserves its framing.

In Focus, a hovered non-root node retains a visible small label through the 200 ms peek delay, then grows continuously to the next-root size over 500 ms. Turning off proximity on hover must not create a label visibility gap. Leave retains the existing fade-out lifecycle; absolute Labels Off still suppresses every label.
