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

## 6. Acceptance requirements

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

Manual acceptance requires physical iOS testing in portrait and landscape, beginning
over both nodes and background, at near and far zoom limits, in focused and unfocused
2D and 3D graphs. The chosen sensitivity must permit useful one-thumb control without
requiring large travel or causing abrupt scale jumps.

## 7. Non-goals

V1.7 does not require:

- replacing pinch-to-zoom;
- assigning an action to a stationary double tap;
- zoom inertia;
- platform-specific automatic sensitivity;
- changing desktop wheel, trackpad pan, pinch, or Cmd-scroll behavior; or
- changing focus, selection, node-drag, or activation semantics.

