# Graph Engine V1.7 Mobile Precision Zoom Contract

Status: Draft; product intent recorded, implementation not started.

Date: 2026-09-05

Depends on:

- [Graph+ and Graph Engine V1 Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.6 Anima Presentation and Native Motion Contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)

## 1. Purpose

V1.7 adds a one-finger precision zoom gesture for mobile use without replacing the
accepted two-finger pinch gesture or Graph+'s focus-first interaction model. The
gesture is intended for situations where the user is holding the device in one hand
or where a second touch is inconvenient.

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
- The gesture works in both 2D and 3D and while the graph is focused or unfocused.
- Focus, selection, explicit pins, canonical positions, Filter state, and Form state
  remain unchanged.
- Direct user zoom input cancels nonessential Anima camera choreography under the
  existing user-input precedence rule.

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
the sequence through the existing click/focus rules without synthesizing extra taps.

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

## 7. Acceptance requirements

Automated pointer traces must prove:

1. Double-tap, hold, and drag down increases zoom in 2D and 3D.
2. Double-tap, hold, and drag up decreases zoom in 2D and 3D.
3. Direction reversal changes zoom direction without starting a new gesture.
4. Zoom remains finite and inside camera limits under extreme travel.
5. Beginning over a node never drags, focuses, activates, or opens that node once the
   zoom threshold wins.
6. Focused 3D precision zoom does not orbit and preserves the focused node.
7. A second pointer cleanly transfers arbitration to pinch without a zoom jump.
8. Cancellation and suspension leave no pointer capture, timer, pressed state, hover,
   or scheduled frame behind.
9. Existing single tap, focus transfer, background defocus, one-finger pan/orbit,
   two-finger pan, pinch, node drag, and long-press tests remain passing.
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

Manual acceptance requires physical iOS testing in portrait and landscape, beginning
over both nodes and background, at near and far zoom limits, in focused and unfocused
2D and 3D graphs. The chosen sensitivity must permit useful one-thumb control without
requiring large travel or causing abrupt scale jumps.

## 8. Settings cleanup and layout recovery

V1.7 reorganizes Graph+ settings into concise, purpose-based sections and places
destructive recovery actions in a visually separate **Danger zone** at the end. The
Danger zone includes **Reset graph layout data for this vault**.

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

## 9. Non-goals

V1.7 does not require:

- replacing pinch-to-zoom;
- assigning an action to a stationary double tap;
- zoom inertia;
- platform-specific automatic sensitivity;
- changing desktop wheel, trackpad pan, pinch, or Cmd-scroll behavior; or
- changing focus, selection, node-drag, or activation semantics.
