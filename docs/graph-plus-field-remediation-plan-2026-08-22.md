# Graph+ Field Remediation Plan

Status: Implemented and automated checks passing — Obsidian field smoke remains

Date: 2026-08-22

Source: `graph-plus-field-observations-2026-08-22.md`

## 1. Outcome

Deliver a responsive Graph+ experience without weakening Graph Engine's external-consumer
contract. Camera, gesture, settings, Form, dragging, and rendering behavior remain generic
engine capabilities. Graph+ supplies vault meaning, Obsidian navigation, consumer-profile
defaults, product controls, and persistence.

## 2. Ownership

### Graph Engine

- normalized pan, orbit, zoom, focus, selection, drag, and context-request intents;
- desktop and touch gesture interpretation;
- 50 mm-equivalent perspective support;
- atomic live session/module override updates and effective-setting resolution;
- kinematic node dragging and configurable `pin`/`dynamic` release policy;
- deterministic rooted Form projection without canonical-position mutation;
- profile-backed `labelMode: adaptive | all | off`;
- viewport culling, label priority, collision rejection, and performance instrumentation.

### Graph+

- Graph+ profile defaults and current-view overrides;
- the `Refine graph` Filter/Form control surface;
- Obsidian-native node context menus and `Open note` behavior;
- selection-driven Mind Map root workflow;
- responsive controls, safe-area behavior, reset affordances, and explanatory feedback;
- Graph+ view persistence and legacy lens migration.

### External consumers

- choose their own profile defaults, including label mode, dimensions, focal length, and
  drag-release policy within declared constraints;
- compile domain meaning into generic documents, filters, priorities, and commands;
- construct consumer-specific context menus from the generic context-request intent;
- own persistence of their documents and views.

## 3. Implementation order

### Phase A — Baselines and contract tests

1. Capture current desktop and mobile gesture behavior.
2. Add the approximately 1,400-node/2,600-link large-graph fixture.
3. Record frame-stage timings and input-to-frame latency before changes.
4. Extend public contracts for context requests, focal length, drag release, live settings,
   effective setting sources, and label mode/priority.
5. Add external-consumer conformance cases before Graph+ UI work.

### Phase B — Live settings foundation

1. Add atomic session-override updates without session teardown.
2. Add module live-update lifecycle; replace only a module when live update is unsupported.
3. Preserve session identity, surface, document, camera, view state, filters, subscriptions,
   and unaffected module state.
4. Coalesce slider previews to the latest value per animation frame and persist settled
   values.
5. Convert Graph+ concrete lens defaults into optional current-view overrides.
6. Migrate legacy non-default values while allowing legacy defaults to inherit profiles.

### Phase C — Camera, gestures, context, and dragging

1. Invert vertical orbit once at normalized input mapping; retain horizontal direction.
2. Make 50 mm-equivalent perspective the Graph+ 3D profile default while preserving
   apparent target scale; retain consumer override support.
3. On desktop, primary background drag pans and clears focus/selection only after threshold;
   secondary drag orbits without clearing either.
4. On mobile, use one-finger background orbit, one-finger node drag, two-finger pan, and
   pinch zoom. Two-finger pan clears focus/selection; orbit retains them.
5. Emit a generic node context-request from stationary secondary click or long-press;
   movement beyond threshold cancels the request in favor of the mapped gesture.
6. Make free-graph drag kinematic and pointer-locked. Graph+ pins on release and exposes
   reversible Pin/Unpin context actions. Mind Map remains non-draggable.

### Phase D — Controls and context UI

1. Preserve compact panel width while using readable two-row slider layouts and wrapped
   explanatory text.
2. Make double-click reset remove a view override; expose a visible reset action for touch
   when the value differs from its effective default.
3. Keep header/close controls inside Obsidian mobile safe bounds and scroll only the body.
4. Prevent panel gestures from reaching the graph.
5. Build Graph+'s native context menu: Focus node, Mind map from here, Open note when
   applicable, and Pin/Unpin node.

### Phase E — Adaptive rendering and performance

1. Add the profile enum `labelMode: adaptive | all | off`; Graph+ defaults to `adaptive`.
2. Add generic numeric label priority contributions.
3. Cull offscreen nodes, labels, and edges while preserving visible crossing edges.
4. In adaptive mode, prioritize focused, selected, hovered/context, and Form-root labels;
   use zoom, screen area, projected prominence, consumer priority, stable ordering, and
   collision rejection for the remaining budget.
5. Cache stable text measurements and prevent stationary-camera label flicker.
6. Profile remaining force, edge, hit-test, and frame-composition cost independently.

### Phase F — Refine graph and Mind Map

1. Merge Graph+'s Filter and Form controls into `Refine graph`; keep engine modules separate.
2. Require one visible selected node to enable Mind Map and snapshot it as the durable root.
3. Do not live re-root on later selection; offer Re-form from selected.
4. Support Mind map from here from the context menu.
5. Implement deterministic breadth-first display parents, stable branch regions, primary
   tree edges, optional secondary cross-links, fixed derived positions, and camera framing.
6. Use Graph+ defaults: depth 3, cross-links off, disconnected nodes off, branch colors on,
   direction both, and any relation.
7. Hide inactive Mind Map controls. If filtering removes the root, pause or exit with an
   explanation instead of silently selecting another root.

### Phase G — Integration and migration verification

1. Run Graph+ unit, contract, runtime, persistence, build, and visual-fixture checks.
2. Repeat desktop pointer/trackpad and mobile touch smoke tests in Obsidian.
3. Run the PatternSmith external-consumer smoke view against the revised service contract.
4. Verify Graph+ and PatternSmith namespaces, profiles, documents, views, and failures remain
   isolated.
5. Compare large-graph timings with the Phase A baseline and document remaining bottlenecks.

## 4. Acceptance checklist

### Camera and gestures

- [ ] Vertical orbit direction matches the approved mapping on mouse, trackpad, and touch.
- [ ] Horizontal orbit behavior is unchanged.
- [ ] Primary/two-finger pan clears focus and selection once, only after threshold.
- [ ] Orbit works on mobile with and without a focused node and retains focus/selection.
- [ ] Fresh Graph+ 3D profiles use a 50 mm-equivalent perspective.
- [ ] Perspective migration preserves apparent target scale.

### Node interaction

- [ ] A dragged free-graph node remains under the pointer for every rendered update.
- [ ] Forces never integrate the actively dragged node; its velocity is zero.
- [ ] Graph+ release pins without snap or drift; reopen restores placement.
- [ ] Unpin resumes force integration from the current position without drag velocity.
- [ ] Mind Map nodes do not advertise or begin drag.
- [ ] Right-click and stationary long-press open one context menu without accidental orbit
      or drag.
- [ ] Context actions target the hit-tested node without changing state merely by opening.

### Settings and controls

- [ ] Module settings update without changing session identity or remounting the surface.
- [ ] Camera, document, view state, filters, pins, subscriptions, and unaffected modules survive.
- [ ] Effective values follow documented precedence and expose their source.
- [ ] Quick controls create view overrides; reset deletes them.
- [ ] Profile changes reach active views that lack a corresponding view override.
- [ ] `adaptive`, `all`, and `off` are valid profile defaults and honor constraints/locks.
- [ ] Every label, help string, and value is readable at accepted panel widths.
- [ ] The mobile header and close action remain reachable in portrait, landscape, keyboard,
      and host-navigation states.

### Filter and Form

- [ ] Filter precedes optional Form in the projection pipeline without canonical mutation.
- [ ] Mind Map cannot start without one visible selected root, except saved-view restoration.
- [ ] Later selection does not re-root without explicit Re-form from selected.
- [ ] Filtering out the root produces explicit recoverable feedback and no silent fallback.
- [ ] The same input/settings produce the same display-parent tree and branch allocation.
- [ ] Free graph positions and behavior return unchanged when Mind Map is disabled.

### Labels and performance

- [ ] Adaptive mode uses a bounded, deterministic, collision-aware label set.
- [ ] Focused, selected, hovered/context, and Form-root labels survive the adaptive budget.
- [ ] All mode draws every onscreen label; Off mode draws none.
- [ ] Offscreen elements do not consume normal draw work.
- [ ] Stationary-camera labels do not flicker.
- [ ] Stage timings distinguish labels from force, edge, node, composition, and hit-test cost.
- [ ] Large-fixture interaction and frame timing improve measurably over baseline.

### External-consumer compatibility

- [ ] PatternSmith can mount, configure, interact with, save, restore, and dispose its graph.
- [ ] A consumer can choose a non-Graph+ default label mode through its profile.
- [ ] Generic context intents contain no Obsidian note semantics.
- [ ] Graph+ profile/view changes do not affect PatternSmith sessions.

## 5. Completion gate

The remediation is complete only when the checklist passes in supported desktop and mobile
Obsidian environments, the external-consumer smoke remains functional, and large-graph
measurements demonstrate improvement rather than merely reduced visual density.

## 6. Implementation verification — 2026-08-22

- Graph+ contract/runtime/consumer suite: 90 tests passing, including the
  1,400-node/2,600-link fixture, live settings, cached labels, stage timing export,
  mobile orbit, context gestures, drag policy, and Mind Map root behavior.
- Graph+ public client artifact, typecheck, and production build pass.
- PatternSmith vendored-client check, typecheck, production build, and 131 tests pass.
- Rendered fixture passes at 1,200 × 800 and 390 × 844. The mobile fixture simulates
  47 px top and 34 px bottom safe areas; the header remains reachable and only the body
  scrolls.
- Remaining completion work is experiential smoke testing inside desktop and mobile
  Obsidian: gesture feel, drag persistence after reopen, context-menu host behavior,
  keyboard/host-chrome variants, and before/after timing capture on the user's actual vault.

### V1 stabilization follow-up

- Perspective zoom is a fixed-focal-length camera dolly. Existing saved 3D views migrate
  zoom into camera distance while preserving apparent scale.
- Trackpad orbit uses the same directional mapping as secondary-button drag.
- Force layout again uses Barnes-Hut repulsion, the pre-extraction Graph+ defaults, and
  alpha cooling (`0.035` decay to `0.001`) so it reaches a stable stopped state.
- Physics-only frames update positions without rerunning Filter, Form, or render-module
  projection. Settled unchanged frames no longer redraw the canvas.
