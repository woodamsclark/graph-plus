# graph-engine V2.0 rendering foundations design

Status: Implemented in V2.0.0; automated validation and macOS dark-theme render
smoke complete; broader live platform/theme acceptance pending

Date: 2026-09-08

Milestone: [2.0 — Public Release](https://github.com/woodamsclark/graph-engine/milestone/1)

Issues:

- [#6 — Standardize theme/color semantics for GPU-friendly rendering](https://github.com/woodamsclark/graph-engine/issues/6)
- [#7 — Introduce renderer abstraction and backend capability selection](https://github.com/woodamsclark/graph-engine/issues/7)

Depends on:

- [graph-engine V1.9 optimization and architecture contract](graph-engine-v1.9-optimization-and-architecture-contract.md)
- [graph-engine downstream compatibility policy](graph-engine-downstream-compatibility-policy.md)

## 1. Decision summary

V2.0 should be two independently shippable, behavior-preserving changes:

1. Replace renderer-facing CSS strings and the mixed-purpose `GraphRenderThemeV1`
   object with an immutable semantic visual theme whose colors are normalized to
   unpremultiplied sRGB floats. Keep CSS and Obsidian theme probing in the host layer.
2. Put the existing Canvas2D renderer behind a renderer-neutral lifecycle, registry,
   capability detector, and fallback selector. Do not add WebGL or WebGPU rendering in
   this milestone.

The intended runtime path is:

```text
Obsidian CSS/theme
  -> host theme resolver
  -> normalized semantic visual theme
  -> presentation modules + scene composer
  -> immutable render scene
  -> selected renderer backend
  -> backend surface
```

Canonical graph data, projections, simulation positions, view state, selection, and
interaction intents remain independent of the selected renderer. Protocol V1 and the
downstream client artifact do not change.

## 2. Baseline and gaps

The local implementation baseline is V1.9.0 at `d41bdb1`. GitHub `main` is currently
at V1.7.2 (`c243552`), so the V1.8, V1.7.3, and V1.9 commits should be pushed before a
V2.0 implementation branch is shared or reviewed.

Useful existing seams:

- `ThemeStyleResolver` is already confined to the Obsidian host and reacts to
  Obsidian's `css-change` event.
- `GraphFrameComposer` already creates a mostly renderer-neutral frame from canonical
  graph state and module contributions.
- `SessionProjectionCoordinator` already owns frame composition and dirty state.
- `CanvasSessionSurface` owns viewport observation, device-pixel-ratio limiting,
  accessibility metadata, and surface cleanup.
- `SessionDiagnostics` already distinguishes geometry, camera, presentation, content,
  and UI invalidations.

The remaining gaps are structural:

- `GraphRenderThemeV1` mixes semantic colors, a CSS font shorthand, renderer sizing
  policy, label policy, edge aggregation, and arrow visibility.
- Color-bearing node, edge, and region contributions remain arbitrary CSS strings.
- `ThemeStyleResolver` returns strings in several possible CSS syntaxes; GPU code would
  need to parse or duplicate host theme behavior.
- `GraphSessionRuntime.refreshThemePalette()` mutates a shared object and invokes the
  broader projection path through `recomputeView(false)`. A theme change should be a
  presentation invalidation, not a graph projection rebuild.
- `GraphSessionRuntime`, `SessionProjectionCoordinator`, and
  `SessionInteractionRuntime` refer directly to `CanvasGraphRenderer` or a canvas.
- `CanvasGraphRenderer` reaches into the mutable `GraphCameraController` instead of
  consuming an immutable scene/view-transform snapshot.
- The session surface creates the drawing canvas before backend selection. That makes
  safe fallback awkward because a canvas cannot reliably switch context families once
  a context has been acquired.

## 3. Scope and non-goals

V2.0 includes:

- semantic theme tokens and deterministic color normalization;
- a host-owned theme source and a presentation-only refresh path;
- renderer-neutral scene, viewport, view-transform, picking, timing, and diagnostics
  types;
- a renderer lifecycle and factory registry;
- detection of Canvas2D, WebGL, WebGL2, and WebGPU API availability;
- automatic backend selection with deterministic fallback;
- migration of the current renderer to the new lifecycle; and
- automated and live visual parity evidence.

V2.0 does not include:

- a WebGL or WebGPU renderer;
- GPU simulation, shader Anima, field/fluid visuals, spatial LOD, or aggregate nodes;
- a user-facing backend setting before a second production backend exists;
- a new public protocol version;
- changes to graph meaning, Form topology, layout, camera behavior, gestures, or
  persistence; or
- a new visual language.

## 4. Issue #6: semantic theme and color boundary

### 4.1 Split visual theme from presentation policy

Replace the mixed-purpose theme with two internal values:

```ts
interface GraphColorV2 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface GraphFontV2 {
  readonly family: string;
  readonly sizePx: number;
  readonly weight: number;
  readonly style: 'normal' | 'italic' | 'oblique';
  readonly lineHeightPx: number;
}

interface GraphVisualThemeV2 {
  readonly revision: number;
  readonly colors: {
    readonly background: GraphColorV2;
    readonly node: GraphColorV2;
    readonly tagNode: GraphColorV2;
    readonly selectedNode: GraphColorV2;
    readonly focusedNode: GraphColorV2;
    readonly highlightedNode: GraphColorV2;
    readonly nodeOutline: GraphColorV2;
    readonly edge: GraphColorV2;
    readonly arrow: GraphColorV2;
    readonly label: GraphColorV2;
    readonly animaAccent: GraphColorV2;
  };
  readonly labelFont: GraphFontV2;
}

interface GraphPresentationPolicyV2 {
  readonly labelMode: 'adaptive' | 'all' | 'off';
  readonly labelPosition: 'above' | 'below';
  readonly adaptiveLabelThreshold: number;
  readonly nodeScaleMode: 'linear' | 'sqrt-orthographic';
  readonly labelScaleMode: 'fixed' | 'sqrt-orthographic';
  readonly minimumPerspectiveNodeRadius: number;
  readonly minimumPerspectiveNodeScale: number;
  readonly minimumPerspectiveTouchHitRadius: number;
  readonly edgeAggregation: 'canonical' | 'unordered-pair';
  readonly showArrows: boolean;
}
```

`GraphColorV2` is unpremultiplied sRGB with every channel clamped to `[0, 1]`.
Renderers may convert it to CSS, packed bytes, linear-light values, uniforms, or
buffers. The semantic object must not contain CSS variable names, CSS color strings,
Canvas types, WebGL types, or WebGPU types.

`GraphPresentationPolicyV2` is scene behavior, not theme. It is composed from profile
settings and Anima contributions and travels with the render scene. Keeping it separate
prevents a future renderer from treating interaction or aggregation rules as theme.

### 4.2 Inventory and ownership

The first implementation pass must account for every current visual value:

| Current source | V2.0 owner |
| --- | --- |
| Obsidian graph role probes and CSS-variable fallbacks | `ObsidianGraphThemeSourceV2` |
| Default node, tag, edge, arrow, label, focus, selection, outline, and background colors | `DEFAULT_GRAPH_VISUAL_THEME_V2` |
| Graph profile color overrides | presentation/theme overlay resolver |
| `labelFont` CSS shorthand | resolved `GraphFontV2` fields |
| Form's fixed branch palette | renderer-neutral categorical palette, normalized before contribution |
| Node-region hashed HSL colors | renderer-neutral deterministic color generator returning `GraphColorV2` |
| Anima active, neighborhood, outline, arrow, and label colors | semantic theme tokens plus normalized contributions |
| Label modes, scale modes, minimum radii, edge aggregation, and arrows | `GraphPresentationPolicyV2` |

Form and node-region colors are content presentation rather than base theme roles, but
they still must enter the render scene as `GraphColorV2`; renderers must never parse
their current hex or HSL strings.

### 4.3 Host theme source

Replace `ThemeStyleResolver.getPalette()` with a host-neutral source contract and an
Obsidian implementation:

```ts
interface GraphThemeSourceV2 {
  read(container: HTMLElement, previousRevision?: number): GraphVisualThemeV2;
}
```

`ObsidianGraphThemeSourceV2` retains the existing native `.graph-view` role probes and
CSS-variable fallback order. It resolves computed colors once per theme revision and
normalizes them before returning. Invalid or unsupported values fall back per token,
not for the entire theme. Typography is read from the container's computed
`font-family`, `font-size`, `font-weight`, `font-style`, and `line-height` rather than
passing a font shorthand downstream.

Color parsing belongs in a small tested codec. It must support the formats currently
observed from Obsidian and its themes: transparent, named transparent, short and long
hex with alpha, comma and space `rgb()`/`rgba()`, percentage channels, and
`hsl()`/`hsla()`. A DOM normalization probe may be used in the Obsidian adapter for
newer CSS color syntaxes, but the graph runtime receives only `GraphColorV2`.

The source remains event-driven. `main.ts` continues to listen to Obsidian's
`css-change`; no polling or per-frame computed-style reads are introduced.

### 4.4 Theme propagation

Themes are immutable snapshots. Replace shared-object mutation with explicit updates:

```text
css-change
  -> SessionFactory.refreshActiveThemes()
  -> GraphSessionRuntime.updateTheme(next)
  -> GraphModuleHost.themeChanged(next)
  -> recompose presentation from the existing projected view
  -> renderer.updateTheme(next)
  -> schedule one presentation frame
```

Add `onThemeChanged?(theme: GraphVisualThemeV2)` to the private module lifecycle.
`AnimaBaselineModule` and `AnimaModule` replace their stored snapshot when called. The
module host must not recreate modules or invoke source/topology/filter projection for
a theme-only change.

`SessionProjectionCoordinator` should expose a presentation-only compose operation
over its last projected state. Theme changes increment a presentation/theme revision,
preserve the geometry revision, invalidate text/color caches as appropriate, and
schedule exactly one frame for a settled graph.

### 4.5 Settings overlays

Existing profile color settings may remain CSS strings at the settings persistence
boundary for compatibility. Resolve them into `GraphColorV2` when building the
effective visual theme. Invalid overrides retain the resolved host token and report a
recoverable validation issue; they must not reach a renderer as unparsed strings.

This preserves current settings data while making the runtime boundary strict.

## 5. Issue #7: renderer lifecycle and backend selection

### 5.1 Renderer-neutral render scene

Evolve `GraphRenderFrameV1` into an internal immutable `GraphRenderSceneV2`:

```ts
interface GraphRenderSceneV2 {
  readonly revision: number;
  readonly geometryRevision: number;
  readonly presentationRevision: number;
  readonly nodes: readonly GraphRenderNodeV2[];
  readonly edges: readonly GraphRenderEdgeV2[];
  readonly labels: readonly GraphRenderLabelV2[];
  readonly regions: readonly GraphRenderRegionV2[];
  readonly view: GraphViewTransformV2;
  readonly policy: GraphPresentationPolicyV2;
}
```

Node, edge, label, and region colors use `GraphColorV2`. Labels become an explicit
scene collection even if the Canvas2D composer initially derives them one-to-one from
nodes. This prevents future backends from reconstructing label visibility and style
from node internals.

`GraphViewTransformV2` is an immutable snapshot produced by shared camera math. It
contains dimensions, projection kind, camera state, CSS viewport, pixel ratio, and
renderer-neutral view/projection matrices or equivalent coefficients. The exact math
representation must have shared projection tests against current
`GraphCameraController.worldToScreen()`. Renderers must not retain or mutate the camera
controller.

The scene carries final presentation inputs, including Anima-produced colors, opacity,
radii, label offsets, dashes, and arrows. It does not carry simulation objects,
canonical stores, Obsidian objects, DOM nodes, or renderer resources.

### 5.2 Renderer contract

Use one lifecycle for all drawing backends:

```ts
type GraphRendererBackendIdV2 = 'canvas2d' | 'webgl' | 'webgl2' | 'webgpu';

interface GraphRendererV2 {
  readonly backendId: GraphRendererBackendIdV2;
  readonly interactionElement: HTMLElement;

  initialize(context: GraphRendererInitializeContextV2): Promise<void>;
  resize(viewport: GraphRenderViewportV2): void;
  updateTheme(theme: GraphVisualThemeV2): void;
  updateScene(scene: GraphRenderSceneV2, invalidations: readonly SessionInvalidationClassV1[]): void;
  render(): GraphRenderTimingV2;
  pick(request: GraphPickRequestV2): GraphPickResultV2 | null;
  getDiagnostics(): GraphRendererDiagnosticsV2;
  dispose(): void;
}
```

Contract rules:

- `initialize` is idempotent only for the first successful call; all later lifecycle
  calls require successful initialization.
- `dispose` is idempotent and releases contexts, listeners, caches, buffers, textures,
  and its render element. It is safe after partial initialization.
- `resize` receives CSS dimensions and effective pixel ratio. The renderer owns its
  backing-store size.
- `updateTheme` invalidates only theme-dependent resources. `updateScene` receives the
  existing invalidation classes so a backend can preserve correct caches.
- `render` draws the latest scene and returns backend-neutral timing categories plus
  optional backend detail in diagnostics.
- `pick` returns semantic node identity, world position, and depth. GPU-specific pick
  buffers remain backend-private.
- Renderer failures are reported to the session as recoverable initialization/runtime
  errors with the selected backend and fallback reason.

The current `CanvasGraphRenderer` becomes `Canvas2DGraphRendererV2` and is the first
implementation. Its existing projected-geometry, hit-grid, text-width, and region
contour caches remain backend-private.

### 5.3 Surface boundary

Generalize `CanvasSessionSurface` to `GraphSessionSurfaceV2`:

- it owns the session root, resize observation, accessibility summary, cursor, and
  diagnostic data attributes;
- it supplies a mount point but does not create or acquire a drawing context;
- each backend attempt creates a fresh render element and mounts it through the
  surface;
- after selection, the renderer's `interactionElement` receives keyboard, pointer,
  wheel, context-menu, touch-action, role, label, and cursor behavior; and
- a failed backend attempt is disposed and its element removed before the next
  candidate initializes.

`GraphInput` changes from `canvas: HTMLCanvasElement` to
`element: HTMLElement`. Coordinate conversion continues to use
`getBoundingClientRect()`. No gesture semantics change.

### 5.4 Capability detection and registry

Keep API capability separate from implemented backend availability:

```ts
interface GraphRendererCapabilitiesV2 {
  readonly canvas2d: { readonly apiAvailable: boolean };
  readonly webgl: { readonly apiAvailable: boolean };
  readonly webgl2: { readonly apiAvailable: boolean };
  readonly webgpu: {
    readonly apiAvailable: boolean;
    readonly adapterAvailable?: boolean;
  };
}

interface GraphRendererFactoryV2 {
  readonly backendId: GraphRendererBackendIdV2;
  readonly priority: number;
  supports(capabilities: GraphRendererCapabilitiesV2): boolean;
  create(): GraphRendererV2;
}
```

Detection uses a disposable probe canvas for Canvas2D/WebGL/WebGL2 and the owning
window's navigator for WebGPU. API presence is not equivalent to a usable production
backend. WebGPU adapter acquisition, device creation, limits, and failure remain an
initialization concern for the future WebGPU factory.

V2.0 registers only Canvas2D. The detector must still distinguish all four API states,
which satisfies the milestone acceptance criterion without pretending that an
unimplemented GPU backend is selectable.

The registry sorts supported, registered factories by policy. The future automatic
preference is:

```text
webgpu -> webgl2 -> webgl -> canvas2d
```

Selection attempts each candidate in order. On initialization failure it records the
reason, fully disposes the attempt, creates a fresh render element, and tries the next
candidate. Failure of Canvas2D fails session creation with the existing recoverable
initialization path.

Do not add a persisted user preference in V2.0. Allow an internal
`preferredBackend` factory option for deterministic tests and developer experiments.
A user-facing setting belongs with issue #8, when at least two production backends
exist and the compatibility consequences are known.

### 5.5 Async initialization and session ownership

Future GPU initialization is asynchronous, while the current runtime constructor does
substantial synchronous work. Use the already-async `createSession()` boundary:

```text
SessionFactory.createHostedSession()
  -> GraphSessionRuntime.create(options)
  -> construct inert runtime owners
  -> detect/select/initialize renderer
  -> bind resize and interaction to selected element
  -> create modules and initial scene
  -> render first frame
  -> publish active session
```

Do not insert a half-initialized runtime into `activeSessions`. If any stage fails,
cleanup runs in reverse ownership order. Once active, disposal order is:

1. stop scheduler and input;
2. dispose interaction and modules;
3. clear the scene store and resize subscription;
4. dispose the renderer;
5. dispose the session surface; and
6. remove the session from the factory.

This order prevents input or scheduled frames from reaching a released backend.

### 5.6 Observability

Extend internal session diagnostics with:

- detected API capabilities;
- registered backend IDs;
- requested selection policy (`auto` or internal test override);
- selected backend ID;
- initialization attempts and sanitized fallback reasons;
- backend lifecycle state;
- renderer-specific cache/resource counts; and
- context/device loss count when future backends support it.

Set `data-renderer-backend` on the session root. The existing “copy graph-engine
diagnostics” command is the user-visible debugging path; no new permanent UI is
required for V2.0.

## 6. Component changes

### Issue #6 files

- Add `src/graph-engine/runtime/theme/GraphColor.ts` for normalized color values,
  parsing, equality, and Canvas CSS conversion.
- Add `src/graph-engine/runtime/theme/GraphVisualTheme.ts` for semantic tokens,
  defaults, immutable snapshots, and settings overlays.
- Replace `src/obsidian/themeStyleResolver.ts` with an Obsidian implementation of the
  theme-source boundary while preserving its current probe precedence.
- Split theme from presentation policy in `GraphRenderTypes.ts`. Presentation now
  resides in `AnimaBaselineModule`, `AnimaModule`, and the Anima scene compiler;
  `FormModule` and `NodeRegionsModule` emit semantic Animus roles only.
- Add the private theme-change hook to `GraphModuleTypes` and `GraphModuleHost`.
- Add presentation-only theme recomposition to `SessionProjectionCoordinator` and
  `GraphSessionRuntime`.
- Update the runtime harness and native-presentation tests to assert normalized values
  and theme invalidation behavior.

### Issue #7 files

- Add `GraphRenderer.ts`, `GraphRendererRegistry.ts`, and
  `GraphRendererCapabilities.ts` under `runtime/render`.
- Add `GraphRenderScene.ts` and `GraphViewTransform.ts`; migrate
  `GraphFrameStore`/`GraphFrameComposer` to scene terminology.
- Adapt `CanvasGraphRenderer.ts` into the Canvas2D lifecycle implementation.
- Generalize `CanvasSessionSurface.ts` and change `GraphInput` to a renderer-neutral
  interaction element.
- Update `SessionProjectionCoordinator`, `SessionFactory`, and
  `GraphSessionRuntime` to depend only on renderer interfaces/registry.
- Extend session diagnostics and the runtime harness with fake renderer factories and
  controllable capability snapshots.

Do not expose these implementation types from `src/graph-engine/public.ts` in V2.0.
The public session/protocol contract remains unchanged.

## 7. Implementation sequence

### Slice A — issue #6

1. Add normalized color/font/theme types and exhaustive codec tests.
2. Inventory and convert every theme and contribution color producer.
3. Convert Canvas2D drawing at its boundary with `graphColorToCss()`.
4. Split presentation policy out of the theme type.
5. Add immutable theme propagation and the module theme-change hook.
6. Change theme refresh to presentation-only recomposition.
7. Run automated validation and desktop light/dark/custom-theme visual parity.
8. Commit issue #6 as an independently shippable unit.

### Slice B — issue #7

1. Introduce scene/view-transform and renderer lifecycle types.
2. Put Canvas2D behind the lifecycle without changing its draw order or cache rules.
3. Generalize the surface and input element boundary.
4. Add registry, capability detector, selector, and fresh-element fallback attempts.
5. Move session creation onto explicit async initialization and reverse-order cleanup.
6. Add backend selection and lifecycle diagnostics.
7. Prove a fake second renderer can mount, receive scene/theme/resize updates, pick,
   render, and dispose without graph/model changes.
8. Run automated and cross-platform live acceptance, then commit issue #7.

## 8. Test and acceptance plan

### Automated theme tests

- Every supported CSS format normalizes to expected sRGB floats and round-trips to an
  equivalent Canvas CSS value.
- Alpha from native graph role opacity is folded into the semantic color exactly once.
- Native role probes retain precedence over CSS-variable and hardcoded fallbacks.
- A missing or invalid token falls back independently.
- Form, node-region, Anima, node, edge, arrow, label, outline, and background scene
  colors contain no strings.
- A theme update changes the theme and presentation revisions, preserves geometry and
  canonical document revisions, invokes zero source/topology/filter projections, and
  schedules one presentation frame.
- Reapplying an equal theme schedules no frame.

### Automated renderer tests

- Canvas2D receives lifecycle calls in order and preserves current draw output, hit
  testing, caching, sizing, and timing behavior.
- A fake second renderer mounts without changes to document, projection, layout,
  simulation, or interaction code.
- Capability snapshots distinguish Canvas2D, WebGL, WebGL2, and WebGPU API presence.
- Automatic selection uses only registered and supported factories.
- Failed initialization disposes the failed renderer and element before selecting the
  next backend.
- Partial initialization and repeated session disposal release each owned resource
  exactly once.
- Resize, pixel-ratio limiting, suspension, view recreation, theme change, and
  interaction events reach the selected backend only.
- Picking returns the same semantic node IDs and depth preference as the current
  renderer in 2D and 3D.
- Diagnostics report the selected backend and fallback chain without changing the
  public Protocol V1 payloads.

### Required repository gates

Run:

```text
npm run typecheck
npm test
npm run build
npm run build:client
git diff --check
```

The generated client artifact must remain unchanged unless a separately approved
public API change becomes necessary. A legacy-shaped V1 consumer and PatternSmith
smoke test must continue to mount against the provider.

### Live visual and lifecycle acceptance

Check Graph+ and Local Graph+ in:

- default light and dark themes;
- Ebullientworks light and dark modes;
- desktop main leaf and narrow side leaf;
- macOS and Windows;
- iOS and Android;
- 2D and 3D, including focus, selection, hover, preview, Form branch colors, tag
  regions, arrows, adaptive labels, drag, zoom, and camera reset; and
- repeated open/close, workspace reload, theme switching, and leaf recreation.

Capture before/after screenshots using the same graph, positions, camera, dimensions,
viewport, and pixel ratio. “Materially unchanged” means no unexplained token, alpha,
font, draw-order, geometry, label, edge, region, or interaction difference. Headless
tests alone do not close either issue.

## 9. Risks and mitigations

### Color conversion changes appearance

CSS color parsing, alpha multiplication, color-space conversion, or rounding can alter
the current image. Preserve unpremultiplied sRGB semantics, compare resolved token
values, and perform fixed-camera screenshot parity before accepting #6.

### Theme refresh accidentally rebuilds graph state

The current refresh path calls broader recomputation. Add projection-call counters to
the theme test and make presentation-only recomposition a separate method rather than
passing a flag through the broad path.

### The abstraction merely renames Canvas2D

A fake renderer contract test must create its own element, receive immutable scene and
view data, render, pick, resize, respond to theme changes, and dispose without importing
Canvas2D or changing graph/model code.

### Fallback leaks contexts or event handlers

Use a fresh element for each backend attempt, bind input only after selection, and test
partial initialization failure at every lifecycle stage.

### Capability detection overstates support

Report API availability, registered backend availability, and successful backend
initialization as distinct facts. Do not label WebGPU “selected” merely because
`navigator.gpu` exists.

### Internal refactor leaks into the public protocol

Keep theme, scene, renderer, and backend types under runtime internals. Enforce the
existing client-artifact import-boundary tests and downstream compatibility policy.

## 10. Completion criteria

Issue #6 is complete when every renderer-facing color is normalized and semantic,
theme switching uses a presentation-only immutable update, existing appearance is
visually accepted, and no renderer code reads CSS or computed styles.

Issue #7 is complete when Canvas2D runs exclusively through the new lifecycle, a fake
second renderer proves the seam, capability and selection state are observable,
initialization/disposal/fallback are deterministic, and current graph behavior is
accepted across the supported host matrix.

V2.0 is complete only when both issue commits are independently reviewable, the full
repository gates pass, Protocol V1 compatibility remains intact, and live visual
acceptance is recorded. WebGL work begins afterward under issue #8.

## 11. Implementation record

Implemented on 2026-09-08 as V2.0.0:

- renderer-facing theme colors are immutable, normalized, unpremultiplied sRGB values;
- host CSS probing and fallback resolution remain in the Obsidian adapter;
- typography is resolved into renderer-neutral font fields;
- Form, node-region, Anima, node, edge, label, outline, arrow, and background colors
  reach render scenes without CSS strings;
- presentation policy is separate from the visual theme, with a deprecated internal
  V1 compatibility value retained for existing implementation tests;
- theme refresh replaces the snapshot, notifies presentation modules, recomposes from
  the existing projected state, and schedules a presentation invalidation without
  rerunning graph projection;
- the Canvas2D renderer implements the renderer lifecycle and consumes immutable scene,
  view, theme, and picking inputs;
- renderer selection uses a registry, reports Canvas2D/WebGL/WebGL2/WebGPU API
  availability separately from registered backends, disposes failed attempts, and
  supplies a fresh canvas to every attempt;
- renderer-neutral scenes include explicit labels and an immutable camera/viewport
  snapshot;
- input binds to the selected renderer's interaction element rather than a concrete
  canvas assumption;
- session diagnostics and `data-renderer-backend` expose the selected backend,
  available APIs, registered factories, lifecycle, resources, and fallback attempts;
  and
- an alternate synthetic renderer mounts through the complete session runtime without
  graph, model, projection, layout, or simulation changes.

Automated evidence: typecheck, 219 tests, production build, client-artifact generation,
and `git diff --check` pass. The generated Protocol V1 client artifact remains
synchronized and unchanged in public shape. After rebuilding and reloading Obsidian,
the existing large Graph+ canvas rendered successfully in the active macOS dark theme.
Cross-theme, mobile, Windows, and complete interaction acceptance remain manual release
checks rather than automated claims.

The final single-run headless benchmark retained active-layout behavior near the V1.9
record: 1,500-node 3D p50 was 10.692 ms versus 10.574 ms, and 5,000-node 3D p50 was
48.980 ms versus 47.683 ms. The 5,000-node presentation-only p50 was 8.702 ms versus
8.010 ms. These small increases include the new scene/backend boundary and remain
sensitive to run-to-run runtime noise; they are recorded as evidence, not asserted as
an optimization.
