# Graph+ Field Observation Backlog

Status: Implemented in code — real-device field verification remains

Date: 2026-08-22

Purpose: Preserve real desktop/mobile feedback as an input to a later de Bono Six Hats
review. Each entry separates observed behavior, desired behavior, and likely ownership
without treating the ownership guess as diagnosis.

## 1. Camera and focus

### CAM-01 — Vertical orbit direction feels inverted

- **Observed:** Dragging to rotate the camera up or down moves in the opposite direction
  from the user's expectation.
- **Approved fix:** Invert vertical orbit at the shared input-mapping layer for mouse,
  trackpad, and touch orbit. Preserve the existing horizontal direction.
- **Likely ownership:** Shared Graph Engine input/camera runtime.
- **Acceptance direction:** All orbit input sources produce the same perceived vertical
  direction, without applying the inversion twice in camera math or device adapters.

### CAM-02 — Background pan leaves stale selection

- **Observed:** After focusing a node, a click-drag background movement clears focus,
  although the node can remain visually highlighted. Camera state and visual state then
  communicate different things.
- **Approved fix:** When primary background drag becomes a pan, clear
  `focusedNodeId`, clear `selectedNodeIds`, and pan the camera. The node should no longer
  retain either focused or selected presentation.
- **Likely ownership:** Shared Graph Engine focus state, camera target, command
  interpretation, and selection behavior.
- **Acceptance direction:** Do not clear either state before the drag crosses the pan
  threshold. At threshold crossing, clear each applicable state once and apply the first
  pan movement immediately. Orbit retains focus and selection.

### CAM-03 — Perspective is excessively wide

- **Observed:** The camera reads like an approximately 18 mm wide-angle lens. Depth is
  exaggerated and the graph feels distorted.
- **Approved fix:** Default Graph Engine 3D profiles to a 50 mm full-frame-equivalent
  perspective. Keep focal length available as an engine profile value that consumers
  may override, but do not expose it in Graph+'s quick controls yet. Preserve apparent
  target scale when migrating from the current perspective. Two-dimensional rendering
  is unaffected.
- **Likely ownership:** Shared Graph Engine 3D camera/projection profile.
- **Acceptance direction:** A fresh 3D profile uses the 50 mm-equivalent projection;
  consumer overrides remain profile-scoped and reopening restores the effective value.

### CAM-04 — Camera rotation is unavailable on mobile

- **Observed:** On mobile, no attempted graph gesture produces camera rotation. The
  view may pan, but the graph cannot be orbited in three dimensions. Selecting and
  focusing a node does not enable orbit, so the failure is not limited to the absence
  of a focused camera target.
- **Revised V1.1 trial 2026-08-25:** Use one-finger background drag for pan in both 2D
  and 3D, preserving one-finger node drag when the gesture begins on a draggable node.
  Use two-finger drag for orbit in 3D; retain focus/selection and orbit around the
  focused node when present. That trial gave pinch zoom priority. In 2D, two-finger
  input never rotates and may pan by centroid movement. This superseded the earlier
  one-finger orbit/two-finger pan proposal and remained subject to on-device trial.
- **Accepted correction 2026-09-22:** In 3D Explore, one-finger drag pans rather than
  rotates. Two-finger centroid movement rotates while pinch separation zooms during
  the same gesture; pinch no longer suppresses rotation. In 2D, the combined gesture
  pans and zooms.
- **Superseded 2026-09-30:** Physical-device feedback reversed the 3D Explore portion:
  a one-finger background drag now orbits around the selected constellation. Overview
  and 2D Explore continue to pan, and a direct touch on an eligible node still drags it.
- **Likely ownership:** Shared Graph Engine touch-gesture recognition and camera intent
  mapping, with Graph+ responsible for any consumer-facing gesture guidance.
- **Acceptance direction:** Verify both dimensions and the complete mapping with and
  without a focused node, including gesture transitions, node/background hit targets,
  Obsidian host event interception, and accidental pan/orbit during pinch.

## 2. Controls panel

### UI-01 — Sidebar copy is clipped at the accepted width

- **Observed:** Filter syntax help and force-setting names are truncated to fragments
  such as `Ce... for...`, `R... f...`, and `Link dista...`. The panel width itself is
  acceptable, but the controls are not readable.
- **Approved fix:** Preserve the compact panel width but never ellipsize meaningful
  setting names. Render slider controls responsively with the full label and current
  value on one row and a full-width slider on the next. Permit explanatory copy to wrap;
  compact toggles may remain single-row. Tooltips may add detail but cannot be the only
  readable source.
- **Evidence:** Screenshot 1, especially Filter help and the expanded Forces section.
- **Likely ownership:** Graph+ controls-panel layout and responsive typography.
- **Acceptance direction:** Every label and help string remains understandable at the
  accepted desktop and mobile widths without horizontal scrolling or hover dependence.

### UI-02 — Sliders lack a direct default reset

- **Observed:** Individual range controls have no quick way to return to their default.
- **Approved fix:** Double-clicking a slider removes its user override and immediately
  recomputes the effective value through engine default, consumer-profile default, and
  author constraints. Persist the reset. When a non-default value is active, expose a
  small visible reset action beside the displayed value for touch accessibility. Locked
  controls are disabled and cannot be reset interactively.
- **Likely ownership:** Generic settings/control UI behavior, potentially reusable by
  all Graph Engine consumer-profile controls.
- **Acceptance direction:** Reset never substitutes a hard-coded Graph+ value; it
  restores the current profile's effective default and produces the same immediate
  runtime effect as moving the control manually.

### UI-03 — Mobile panel cannot scroll and escapes the top safe area

- **Observed:** On mobile, the quick settings panel extends too high above the usable
  safe area. This places the top-right `X` close button beyond reach and makes the panel
  impossible to dismiss normally. The panel also cannot be scrolled to recover access
  to the displaced header action.
- **Approved fix:** Keep the complete panel inside the graph view's usable bounds while
  accounting for device safe areas and Obsidian mobile chrome. Keep the panel header and
  close action sticky, scroll only the settings body, recompute available height when
  orientation, mobile chrome, or the onscreen keyboard changes, and suppress graph
  gestures during panel interaction.
- **Likely ownership:** Graph+ controls-panel mobile positioning, height calculation,
  safe-area clearance, overflow container, and touch-scroll behavior.
- **Acceptance direction:** Verify reachable close and settings controls in portrait,
  landscape, filter-keyboard-open, and bottom-navigation states without accidental
  graph pan, orbit, zoom, or node drag.

### UI-04 — Mobile Search label and syntax hint wrap incorrectly

- **Observed 2026-08-25:** In the narrow mobile quick-settings panel, `Search` splits
  inside the word as `Sea` / `rch`, while the syntax hint breaks into hard-to-parse
  fragments above the input. The input itself remains usable, but the setting label and
  grammar guidance are visually corrupted.
- **Approved V1.1 direction:** Give Search a narrow-layout stack: intact label, readable
  syntax hint, then a full-width input. Do not break inside setting names, ordinary
  words, or published filter tokens; wrap examples at intentional separators.
- **Likely ownership:** Engine-owned stock quick-settings layout and responsive control
  primitives, inherited by Graph+ and any external consumer exposing the stock Filter
  section.
- **Acceptance direction:** Reproduce the photographed mobile width and adjacent narrow
  widths; verify no mid-word/mid-token breaks, clipping, or horizontal scrolling.

### UI-05 — Collapsed controls launcher overlaps Obsidian chrome

- **Observed 2026-08-25:** When the quick-settings panel is minimized, its circular
  launcher occupies the top-right Obsidian leaf-action area, visually and interactively
  competing with the host button beneath or beside it.
- **Approved V1.1 direction:** Position engine-owned expanded/collapsed controls within
  host-aware usable bounds. Respect safe areas and host/consumer-declared occlusions,
  and recompute placement when mobile chrome, orientation, viewport, or keyboard state
  changes.
- **Likely ownership:** Graph Engine session-UI layout plus the Obsidian host adapter's
  usable-bounds/occlusion reporting—not the Graph+ vault consumer.
- **Acceptance direction:** Both launcher and Obsidian action retain disjoint visible
  hit targets in the photographed state, portrait/landscape, and desktop/popout leaf
  variants.

## 3. Form and Mind Map

### FORM-01 — Mind Map output is not intelligible

- **Observed:** Choosing a center and enabling Mind Map rearranges the vault, but the
  resulting structure is difficult to interpret. Large arcs, dense overlaps, and label
  collisions obscure the supposed hierarchy or relationship direction.
- **Approved fix:** Define Mind Map as a rooted breadth-first projection of the current
  projection-visible graph. Give each reachable node one deterministic display parent,
  place depth levels at increasing distance from the central root, allocate stable
  branch regions, render tree edges as primary and optional cross-links as secondary,
  suspend forces that would displace derived positions, frame the result, and leave
  canonical graph positions untouched. Explain that display parents do not assert that
  the source graph is inherently hierarchical.
- **Approved defaults:** Depth 3, cross-links off, disconnected nodes off, branch colors
  on, direction both, and any relation.
- **Evidence:** Screenshot 2.
- **Likely ownership:** Split between Graph+'s root/relation compiler and the shared Form
  module's derived positions.
- **Acceptance direction:** The root, depth levels, branches, primary tree edges, and
  optional cross-links are visually identifiable; repeated projection of the same input
  is deterministic and disabling Form restores the free graph unchanged.

### FORM-02 — Root shortcut buttons have no observable result

- **Observed:** `Use focused` appears to do nothing. `Use current note` also appears to
  do nothing.
- **Approved fix:** Remove `Use focused`, `Use current note`, and direct root-ID search
  from the normal Mind Map workflow. Enabling Mind Map requires exactly one visible
  selected node and snapshots that node as the durable Form root. Later selections do
  not automatically re-form the graph; when another visible node is selected, expose
  `Re-form from selected`. The active root receives its own presentation independent of
  transient selection. A restored saved view may restore its persisted root directly.
- **Likely ownership:** Graph+ consumer lookup, focus-intent handling, current-note
  resolution, and controls-panel feedback.
- **Acceptance direction:** Mind Map cannot start without one visible selected node;
  starting or explicitly re-forming uses that selection, ordinary later selection does
  not move the root, and clearing selection during camera pan does not destroy the
  active Mind Map.

### FORM-03 — Form has no clear meaning while Mind Map is disabled

- **Observed:** Direction, relation, depth, branch colors, cross-links, and disconnected
  nodes appear under Form, but their effect without Mind Map is unclear.
- **Approved fix:** Present Filter and Form together in one user-facing `Refine graph`
  section while retaining separate engine modules. Place the Mind Map toggle beside
  filtering controls and reveal Mind Map-specific settings only while active. Do not
  require an explicit text/tag filter: the selected root and depth limit already form a
  structural constraint. If an active filter removes the root, exit or pause Mind Map
  with an explicit explanation rather than silently choosing another root. Warn about
  unusually large projected node counts instead of forbidding unfiltered use.
- **Likely ownership:** Graph+ product language and controls-panel state presentation.
- **Acceptance direction:** The UI expresses the pipeline `filter → optional Mind Map`
  without exposing inactive Form controls, while the canonical graph and independent
  Filter/Form engine-module boundaries remain intact.

### FORM-04 — Mind Map nodes cannot be manually dragged

- **Observed:** Node dragging is unavailable while Mind Map is active.
- **Decision:** Defer manual Mind Map node placement. Derived Form positions remain
  fixed in the current pass and no offset or pinning model will be added yet.
- **Likely ownership:** Shared Form module and interaction policy.
- **Acceptance direction:** Mind Map must not present draggable affordances or begin a
  node-drag interaction. Free graph dragging remains unaffected. Manual offsets may be
  reconsidered later without changing canonical graph positions.

## 4. Node context actions

### INT-01 — Nodes need an explicit contextual action surface

- **Approved addition:** A secondary click on desktop or stationary long-press on mobile
  opens a node-anchored context menu. Initial Graph+ actions are `Focus node`, `Mind map
  from here`, and `Open note` when the target represents an openable note. The menu may
  grow through consumer-defined actions later.
- **Behavior:** Opening the menu does not itself change focus or selection. `Focus node`
  selects and focuses the target and moves the camera according to the focus contract.
  `Mind map from here` selects the target, snapshots it as the Form root, enables Mind
  Map, and frames the result. `Open note` delegates to Graph+'s Obsidian navigator and
  does not require Graph Engine to understand notes.
- **Ownership:** Graph Engine recognizes secondary-click/long-press against a hit-tested
  node and emits a generic context-request intent with node identity and viewport anchor.
  Graph+ constructs the native menu and invokes engine commands or Graph+-specific
  navigation. External consumers may construct their own menus from the same intent.
- **Acceptance direction:** A stationary context gesture opens exactly one menu without
  starting node drag or camera orbit. Movement beyond the applicable threshold cancels
  the menu gesture in favor of the mapped drag/orbit gesture. The menu remains within
  desktop/mobile safe bounds, closes through normal pointer, Escape, and mobile-back
  behavior, and never offers `Open note` for nodes Graph+ cannot open.

## 5. Node dragging and forces

### DRAG-01 — Dragged node loses pointer synchronization

- **Observed:** A dragged node initially moves, slips away from the pointer, and is
  pulled toward the center. On release it snaps back to the pointer location, then
  resumes wandering under the force simulation.
- **Approved fix:** When a free-graph node drag crosses its threshold, do not mutate
  selection or Focus. Capture the pointer, preserve the initial pointer-to-node offset,
  zero node velocity, and treat the node as a kinematic body excluded from force
  integration for the complete drag. Selection may change only on a stationary release
  that never crossed the drag threshold. Other nodes may continue responding to the
  dragged node. Graph+ defaults to pinning it at its released position without a
  corrective snap and persists its pin and position as view state, not canonical graph
  data. Graph Engine may expose `pin` or `dynamic` release behavior as a consumer-profile
  policy.
- **Approved context actions:** Show `Unpin node` for a pinned node and optionally `Pin
  node` for an unpinned node. Unpinning returns the node to force integration from its
  current position with zero inherited drag velocity.
- **Likely ownership:** Shared Graph Engine hit testing, pointer capture, drag command
  timing, force-layout integration, and drag-end reconciliation.
- **Acceptance direction:** The dragged node remains under the pointer at every rendered
  update, the camera does not chase it, release produces no snap or drift, reopen restores
  Graph+'s pinned placement, unpinning is reversible, and Mind Map remains non-draggable.

## 6. Settings and live configuration

### SET-01 — Settings appear to have no effect

- **Observed:** Changing the exposed settings does not produce an obvious graph change.
  It is not yet known whether the controls are unwired, unsaved, applied only to future
  sessions, overridden by profile resolution, or visually masked by another issue.
- **Approved fix:** Replace full-session teardown for Display, Force, Form, and Filter
  changes with atomic live override updates. Prefer updating the affected module instance
  in place; if a module cannot safely update, replace only that module while preserving
  the session, canvas, document, camera, selection, focus, positions, pins, filters,
  subscriptions, and unaffected module state. Coalesce rapid slider input to the latest
  value per animation frame and persist the final settled value.
- **Approved precedence correction:** Graph+ quick controls store optional current-view
  overrides rather than always supplying hard-coded session values. An absent view
  override inherits the effective engine/profile value; moving a control creates an
  override and reset deletes it. Locked author values remain visible and disabled.
- **Approved migration:** Preserve legacy saved values that differ from legacy defaults
  as intentional view overrides; legacy values equal to old defaults may be removed so
  they no longer mask engine or profile settings.
- **Likely ownership:** Split between Graph+ controls, Graph Engine profile/settings
  resolution, live module updates, and persistence.
- **Acceptance direction:** Audit every setting through control input, requested
  override, effective value and source, live module update, visible or measurable effect,
  persistence, reopen, and reset. Profile changes affect active views without a view
  override; explicit current-view overrides remain stable.

## 7. Label density and legibility

### VIS-01 — Labels overwhelm the graph

- **Observed:** Large vault views draw enough labels simultaneously to obscure nodes,
  links, clusters, and Form structure. This also remains a plausible contributor to the
  reported lag, though performance causation is not yet established.
- **Approved fix:** Replace the boolean text toggle with a profile-backed `labelMode`
  enum whose complete allowed values are `adaptive`, `all`, and `off`. Graph+ defaults
  to `adaptive`; every consumer profile may choose its own default, constrain or lock the
  value, and decide whether to expose a current-view override. Reset removes the view
  override and restores the effective profile value.
- **Adaptive behavior:** Cull offscreen work, rank focused, selected, hovered/context,
  and Form-root nodes first, then accept generic consumer/module `labelPriority`,
  projected prominence, and stable ID ordering. Apply a zoom- and screen-area-sensitive
  label budget with deterministic collision rejection and cached text measurements.
  Priority labels remain visible when the normal budget is exhausted.
- **All/off behavior:** `all` draws every onscreen label after viewport culling and is
  intentionally allowed to be dense; `off` draws no node labels. Both remain live,
  profile-resolved settings rather than special Graph+ renderer switches.
- **Performance requirement:** Instrument force simulation, frame composition, edge and
  node rendering, label selection/layout, text drawing, and hit testing separately. Use
  the reported approximately 1,400-node/2,600-link graph as the primary large fixture.
- **Evidence:** Screenshot 2 and the earlier large-vault performance observation.
- **Likely ownership:** Shared rendering module and consumer/profile display defaults.
- **Acceptance direction:** Adaptive mode remains legible and deterministic, priority
  labels do not disappear, offscreen elements do not consume draw calls, stationary
  labels do not flicker, all three enum values honor profile/view precedence and locks,
  and measured interaction/frame cost improves against the captured baseline.

## 8. Proposed Six Hats review order

The later review should consider these as a connected interaction system rather than
isolated tickets:

1. **White Hat:** Reproduce and measure each observation; trace current commands,
   settings, state transitions, and renderer/module behavior.
2. **Red Hat:** Preserve the user's spatial expectations: direct manipulation, stable
   focus, readable controls, and a graph that feels comprehensible rather than unruly.
3. **Black Hat:** Identify regressions involving touch vs pointer input, accessibility,
   canonical-state mutation, profile overrides, large-vault cost, and Form
   reversibility.
4. **Yellow Hat:** Identify reusable improvements that benefit every external consumer,
   especially camera, drag, settings, and label behavior.
5. **Green Hat:** Generate solution candidates and small experiments only after the
   behavior contracts are explicit.
6. **Blue Hat:** Choose ownership, acceptance cases, order the fixes, and keep Graph+
   product semantics outside the generic engine where appropriate.

Approved behavior is consolidated into `graph-plus-field-remediation-plan-2026-08-22.md`.
No item in this backlog is implementation authorization by itself.
