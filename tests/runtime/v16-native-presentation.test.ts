import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/index.ts';
import {
  CanvasGraphRenderer,
  composeGraphRenderFrameV1,
  DEFAULT_GRAPH_RENDER_THEME_V1,
  GraphFrameStore,
} from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { AnimaModule } from '../../src/graph-engine/runtime/modules/shipped/AnimaModule.ts';
import {
  ForceLayoutModule,
  readForceSettings,
} from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import {
  GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  migrateGraphPlusProfileOverridesV16,
} from '../../src/graph-plus/consumer/index.ts';
import { ThemeStyleResolver } from '../../src/obsidian/themeStyleResolver.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness } from '../support/runtimeHarness.ts';

test('V1.6 Anima owns the exact visible-degree radius and composable structural scale', () => {
  const nodes = [graphNode('hub'), ...Array.from({ length: 9 }, (_, index) => graphNode(`leaf-${index}`))];
  const edges = Array.from({ length: 9 }, (_, index) => graphEdge(`edge-${index}`, 'hub', `leaf-${index}`, { directed: true }));
  edges.push(graphEdge('duplicate', 'hub', 'leaf-0', { directed: true }));
  const document = graphDocument({ nodes, edges });
  const selection = { nodeIds: new Set(nodes.map((node) => node.id)), edgeIds: new Set(edges.map((edge) => edge.id)) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const patch = anima.contributeFrame({
    ...state,
    nodeContributions: { hub: { baseRadiusScale: 2, radiusScale: 1.35 } },
  });
  assert(patch && patch.nodeContributions, 'new-mode Anima should contribute final geometry');
  const expected = 2 * 1.35 * 3 * Math.sqrt(10);
  assert(Math.abs((patch.nodeContributions.hub.radius ?? 0) - expected) < 1e-10,
    'hub radius should use the exact formula and ignore duplicate ordered relationships');
  equal(patch.nodeContributions['leaf-0'].radius, 8, 'low-degree nodes should use the exact lower clamp');
  equal(patch.theme?.nodeScaleMode, 'sqrt-orthographic', 'Anima should request native-style 2d visual scaling');
});

test('V1.6 Anima neighborhood highlighting follows focus changes and clears with focus', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b'), graphNode('c')],
    edges: [graphEdge('a-b', 'a', 'b'), graphEdge('b-c', 'b', 'c')],
  });
  const selection = { nodeIds: new Set(['a', 'b', 'c']), edgeIds: new Set(['a-b', 'b-c']) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const focusedA = anima.contributeFrame({
    ...state,
    viewState: { ...state.viewState, focusedNodeId: 'a' },
  });
  assert(focusedA?.edgeContributions, 'focused Anima output should include edge presentation');
  equal(focusedA.edgeContributions['a-b'].opacity, 1, 'the focused node incident link should be highlighted');
  equal(focusedA.edgeContributions['b-c'].opacity, 0.2, 'a nonincident link should be deemphasized');

  const focusedC = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'a',
    viewState: { ...state.viewState, focusedNodeId: 'c' },
  });
  assert(focusedC?.edgeContributions, 'a changed focus should produce edge presentation');
  equal(focusedC.edgeContributions['a-b'].opacity, 0.2,
    'focus should outrank a stale hover when choosing the active neighborhood');
  equal(focusedC.edgeContributions['b-c'].opacity, 1, 'highlighting should follow the newly focused node');

  const cleared = anima.contributeFrame(state);
  assert(cleared?.edgeContributions, 'cleared focus should still resolve baseline edge presentation');
  equal(cleared.edgeContributions['a-b'].opacity, 1, 'clearing focus should restore ordinary link opacity');
  equal(cleared.edgeContributions['b-c'].opacity, 1, 'no prior focus highlight should remain latched');
});

test('V1.6 Anima owns live above and below label placement', () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const state = pipeline(document, { nodeIds: new Set(['a']), edgeIds: new Set() });
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, { labelPosition: 'above' });
  equal(anima.contributeFrame(state)?.theme?.labelPosition, 'above',
    'Anima should publish the configured above placement');
  anima.updateSettings({ labelPosition: 'below' });
  equal(anima.contributeFrame(state)?.theme?.labelPosition, 'below',
    'Anima should update label placement without remounting');
});

test('V1.6 renderer anchors labels above or below the resolved node boundary', () => {
  const fillTextY: number[] = [];
  const context = recordingContext(fillTextY);
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  const node = {
    id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 8,
    selected: false, focused: false, hovered: false,
  };
  frames.set({
    regions: [], edges: [], nodes: [node],
    theme: { ...DEFAULT_GRAPH_RENDER_THEME_V1, labelMode: 'all', labelPosition: 'below' },
  });
  renderer.render();
  equal(fillTextY.pop(), 192, 'below should begin four pixels beneath the eight-pixel node');
  frames.set({
    regions: [], edges: [], nodes: [node],
    theme: { ...DEFAULT_GRAPH_RENDER_THEME_V1, labelMode: 'all', labelPosition: 'above' },
  });
  renderer.render();
  equal(fillTextY.pop(), 156, 'above should clear the node and the twelve-pixel label height');
});

test('V1.6 presentation aggregation preserves reciprocal direction without mutating canonical edges', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [
      graphEdge('a-b-1', 'a', 'b', { directed: true }),
      graphEdge('a-b-2', 'a', 'b', { directed: true }),
      graphEdge('b-a', 'b', 'a', { directed: true }),
    ],
  });
  const selection = { nodeIds: new Set(['a', 'b']), edgeIds: new Set(document.edges.map((edge) => edge.id)) };
  const frame = composeGraphRenderFrameV1({
    document,
    viewState: viewState(document),
    selection,
    theme: { ...DEFAULT_GRAPH_RENDER_THEME_V1, edgeAggregation: 'unordered-pair', showArrows: true },
  });
  equal(frame.edges.length, 1, 'parallel and reciprocal canonical edges should render as one shaft');
  equal(frame.edges[0].arrowAtSource, true, 'the shaft should preserve its reverse direction marker');
  equal(frame.edges[0].arrowAtTarget, true, 'the shaft should preserve its forward direction marker');
  equal(document.edges.length, 3, 'presentation aggregation must not change canonical edge records');
});

test('V1.6 frame composition carries future Anima label and arrow targets to rendering', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('a-b', 'a', 'b', { directed: true })],
  });
  const frame = composeGraphRenderFrameV1({
    document,
    viewState: viewState(document),
    selection: { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']) },
    nodeContributions: {
      a: { finalColor: '#123456', labelOffset: { x: 3, y: -4 } },
    },
    edgeContributions: {
      'a-b': {
        arrowAtSource: true, arrowAtTarget: false,
        arrowColor: '#abcdef', arrowOpacity: 0.4,
      },
    },
    theme: { ...DEFAULT_GRAPH_RENDER_THEME_V1, showArrows: true },
  });
  equal(frame.nodes[0].finalColor, '#123456', 'Anima final fill should reach the render frame');
  deepEqual(frame.nodes[0].labelOffset, { x: 3, y: -4 }, 'label offsets should survive composition');
  equal(frame.edges[0].arrowAtSource, true, 'Anima should be able to show a source arrow');
  equal(frame.edges[0].arrowAtTarget, false, 'Anima should be able to suppress a canonical target arrow');
  equal(frame.edges[0].arrowColor, '#abcdef', 'arrow color should be independent from shaft color');
  equal(frame.edges[0].arrowOpacity, 0.4, 'arrow opacity should be independent from shaft opacity');
});

test('V1.6 host theme probes resolve native graph roles, opacity, and CSS-variable fallbacks', () => {
  const value = runtimeHarness();
  const style = value.document.createElement('style');
  style.textContent = [
    '.graph-view.color-fill { color: rgb(10, 20, 30); opacity: 0.5; }',
    '.graph-view.color-line { color: rgb(40, 50, 60); }',
    '.graph-view.color-text { color: rgb(70, 80, 90); }',
    '.graph-view.color-arrow { color: rgb(100, 110, 120); }',
    '.graph-view.color-fill-focused { color: rgb(130, 140, 150); }',
    '.graph-view.color-circle { color: rgb(160, 170, 180); }',
  ].join('\n');
  value.document.head.append(style);
  value.document.body.style.setProperty('--native-tag', 'rgb(190, 200, 210)');
  value.document.body.style.setProperty('--graph-node-tag', 'var(--native-tag)');
  const palette = new ThemeStyleResolver(() => value.document.body).getPalette();
  equal(palette.nodeColor, 'rgba(10, 20, 30, 0.5)', 'native node opacity should be folded into its resolved color');
  equal(palette.tagColor, 'rgb(190, 200, 210)', 'nested graph CSS variables should resolve before reaching Anima');
  equal(palette.linkColor, 'rgb(40, 50, 60)', 'native line role should outrank generic fallbacks');
  equal(palette.labelColor, 'rgb(70, 80, 90)', 'native text role should be sampled');
  equal(palette.arrowColor, 'rgb(100, 110, 120)', 'native arrow role should be sampled separately');
  equal(palette.highlightColor, 'rgb(130, 140, 150)', 'native focus role should drive interaction highlighting');
  equal(palette.outlineColor, 'rgb(160, 170, 180)', 'native circle role should drive outlines');
});

test('V1.6 new-mode 3D preserves depth while keeping nodes visible and finger-selectable', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 5000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  }, '3d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [{
      id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 8,
      selected: false, focused: false, hovered: false,
    }],
    theme: {
      ...DEFAULT_GRAPH_RENDER_THEME_V1,
      minimumPerspectiveNodeRadius: 4,
      minimumPerspectiveTouchHitRadius: 22,
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  equal(renderer.hitTest({ x: 324, y: 180 })?.nodeId, 'a',
    'the visible perspective disc should retain a four-pixel radius at long range');
  equal(renderer.hitTest({ x: 335, y: 180 }), null,
    'mouse hit testing should still follow the visible node geometry');
  equal(renderer.hitTest({ x: 335, y: 180 }, 'touch')?.nodeId, 'a',
    'perspective touch should receive a 44-pixel finger target without enlarging the disc');
});

test('V1.6 D3-compatible integration is fixed-step and refresh-rate independent', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const settings = readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0,
    centeringStrength: 0, collisionRadius: 0, springStrength: 1, springLength: 250,
  });
  const one = new ForceLayoutModule('2d', settings);
  const two = new ForceLayoutModule('2d', settings);
  const initial = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const oneResult = one.tick(initial, 1 / 30);
  assert(oneResult?.positions, 'one 30Hz frame should advance two fixed simulation steps');
  const first = two.tick(initial, 1 / 60);
  assert(first?.positions, 'the first 60Hz frame should advance one fixed step');
  const second = two.tick({ ...initial, positions: first.positions }, 1 / 60);
  assert(second?.positions, 'the second 60Hz frame should advance the second fixed step');
  deepEqual(oneResult.positions, second.positions, 'equal elapsed time should produce identical positions at different refresh rates');
});

test('V1.6 D3-compatible link integration matches the reviewed one-tick equation', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const alphaDecay = 1 - Math.pow(0.001, 1 / 300);
  const force = new ForceLayoutModule('2d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0,
    centeringStrength: 0, collisionRadius: 0, springStrength: 1, springLength: 250,
    velocityDecay: 0.4, alphaDecay,
  }));
  const initial = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const result = force.tick(initial, 1 / 60);
  assert(result?.positions, 'one fixed tick should move the linked nodes');
  const alpha = 1 - alphaDecay;
  const expectedMovement = ((400 - 250) * alpha * 0.5) * 0.6;
  assert(Math.abs(result.positions.left.x - (-200 + expectedMovement)) < 1e-10,
    'source movement should match D3 link bias followed by velocity decay');
  assert(Math.abs(result.positions.right.x - (200 - expectedMovement)) < 1e-10,
    'target movement should mirror the D3 link step');
});

test('V1.6 D3-compatible mechanics remain finite and spatial in 3D', () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', { positionHint: { x: 0, y: 0, z: -100 } }),
      graphNode('b', { positionHint: { x: 0, y: 0, z: 100 } }),
    ],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const force = new ForceLayoutModule('3d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 1000,
    centeringStrength: 0.1, collisionRadius: 60, collisionStrength: 0.5,
    springStrength: 1, springLength: 250, velocityDecay: 0.4,
    alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  }));
  let state = pipeline(document, {
    nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']),
  });
  state = { ...state, positions: viewState(document).positions, viewState: {
    ...state.viewState, dimensions: '3d', positions: viewState(document).positions,
    camera: { ...state.viewState.camera, projection: 'perspective' },
  } };
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, '3D forces should advance nonzero depth positions');
  assert(Object.values(result.positions).every((position) =>
    Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)),
  '3D force integration should remain finite');
  assert(result.positions.a.z !== -100 || result.positions.b.z !== 100, 'Z should participate in native force integration');
});

test('V1.6 retirement migration promotes the accepted settings and removes comparison banks', () => {
  const migrated = migrateGraphPlusProfileOverridesV16({
    profileSettings: { graphSystem: 'legacy', graphSystemMigrationVersion: 1 },
    modules: {
      rendering: { settings: {
        nodeRadiusScale: 4,
        newSettings: { nodeRadiusScale: 1.5, edgeThicknessScale: 0.75 },
        legacySettings: { nodeRadiusScale: 8 },
      } },
    },
  });
  equal(migrated.profileSettings?.graphSystem, undefined, 'the retired selector should be removed');
  const rendering = migrated.modules?.rendering?.settings as Record<string, unknown>;
  equal(rendering.nodeRadiusScale, 1.5, 'the accepted bank should override obsolete direct tuning');
  equal(rendering.edgeThicknessScale, 0.75, 'the accepted bank should become directly editable');
  equal(rendering.newSettings, undefined, 'the accepted bank wrapper should be removed');
  equal(rendering.legacySettings, undefined, 'the comparison bank should be removed');
  deepEqual(migrateGraphPlusProfileOverridesV16(migrated), migrated, 'migration should be idempotent');
});

test('V1.6 restore/export discards retired whole-system state-bank metadata', async () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const restored = {
    ...viewState(document),
    consumerId: 'graph-plus',
    profileId: 'default',
    moduleState: { 'graph-system-states-v1': { schemaVersion: 1, activeMode: 'new', states: {} } },
  };
  const session = await value.create(restored);
  equal((await session.exportViewState()).moduleState['graph-system-states-v1'], undefined,
    'the single-system runtime should not preserve or recreate a comparison state bank');
  await session.dispose();
});

test('V1.6 Graph+ defaults Anima label placement above and accepts a live below override', async () => {
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  });
  const session = await value.create();
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.labelPosition, 'above',
    'Graph+ should begin with mobile-friendly labels above nodes');
  value.profiles.setUserOverrides('graph-plus', 'default', {
    modules: { anima: { settings: { labelPosition: 'below' } } },
  });
  value.factory.refreshActiveProfiles();
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.labelPosition, 'below',
    'the persisted profile setting should update Anima live');
  await session.dispose();
});

test('V1.6 uses generated initial placement instead of adapter position hints', async () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', { positionHint: { x: 910, y: 920, z: 0 } }),
      graphNode('b', { positionHint: { x: 1010, y: 1020, z: 0 } }),
    ],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const session = await value.create();
  const initial = await session.exportViewState();
  assert(initial.positions.a.x !== 910 && initial.positions.b.x !== 1010,
    'the single system should use generated placement instead of adapter hints');
  await session.dispose();
});

test('V1.6 keeps Canvas-like pan, Cmd-scroll zoom, and transient drag separate from explicit pins', async () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const initial = await session.exportViewState();
  wheel(value, canvas, { deltaX: 20, deltaY: 10 });
  value.platform.flushFrame(16);
  const panned = await session.exportViewState();
  equal(panned.camera.zoom, initial.camera.zoom, 'unmodified trackpad wheel should pan without zooming');
  assert(JSON.stringify(panned.camera.target) !== JSON.stringify(initial.camera.target), 'unmodified wheel should move the camera target');
  wheel(value, canvas, { deltaY: -30, metaKey: true });
  value.platform.flushFrame(32);
  const zoomed = await session.exportViewState();
  assert(zoomed.camera.zoom > panned.camera.zoom, 'Cmd-scroll should remain a zoom gesture');

  const camera = new GraphCameraController(zoomed.camera, '2d');
  camera.setViewport(640, 360);
  const point = camera.worldToScreen(zoomed.positions.a);
  pointer(value, canvas, 'pointerdown', point.x, point.y, 9);
  pointer(value, canvas, 'pointermove', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(48);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), false,
    'new-mode drag should use a transient kinematic constraint, not the persistent pin set');
  pointer(value, canvas, 'pointerup', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(64);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), false,
    'releasing an ordinary drag should return the node to the solver');

  await session.setNodePinned('a', true);
  const pinned = await session.exportViewState();
  const pinnedCamera = new GraphCameraController(pinned.camera, '2d');
  pinnedCamera.setViewport(640, 360);
  const pinnedPoint = pinnedCamera.worldToScreen(pinned.positions.a);
  pointer(value, canvas, 'pointerdown', pinnedPoint.x, pinnedPoint.y, 10);
  pointer(value, canvas, 'pointermove', pinnedPoint.x + 20, pinnedPoint.y, 10);
  pointer(value, canvas, 'pointerup', pinnedPoint.x + 20, pinnedPoint.y, 10);
  value.platform.flushFrame(80);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), true,
    'an explicit pin should remain authoritative after drag release');
  await session.dispose();
});

test('V1.6 a background finger tap clears focus in 3D', async () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '3d' });
  const session = await value.create();
  await session.focusNode('a');
  equal((await session.exportViewState()).focusedNodeId, 'a', 'the fixture should begin focused');

  const canvas = runtimeCanvas(value.container);
  pointer(value, canvas, 'pointerdown', -100, -100, 31, 'touch');
  pointer(value, canvas, 'pointerup', -100, -100, 31, 'touch');
  value.platform.flushFrame(16);
  const cleared = await session.exportViewState();
  equal(cleared.focusedNodeId, undefined, 'a 3D background finger tap should release focus');
  deepEqual(cleared.selectedNodeIds, [], 'background release should also clear selection');
  await session.dispose();
});

function pipeline(
  document: ReturnType<typeof graphDocument>,
  selection: { nodeIds: Set<string>; edgeIds: Set<string> },
): GraphModulePipelineStateV1 {
  const state = viewState(document);
  return {
    sourceDocument: document,
    document,
    viewState: state,
    positions: state.positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}

function viewState(document: ReturnType<typeof graphDocument>) {
  return {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'synthetic-consumer',
    profileId: 'two-dimensional',
    dimensions: '2d' as const,
    positions: Object.fromEntries(document.nodes.map((node, index) => [node.id,
      node.positionHint ?? { x: index * 100, y: 0, z: 0 }])),
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const,
    },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
}

function pointer(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  pointerId: number,
  pointerType: 'mouse' | 'touch' = 'mouse',
): void {
  canvas.dispatchEvent(new value.window.PointerEvent(type, {
    clientX: x, clientY: y, pointerId, button: 0, pointerType, bubbles: true, cancelable: true,
  }) as unknown as Event);
}

function wheel(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  options: { deltaX?: number; deltaY: number; metaKey?: boolean },
): void {
  const event = new value.window.WheelEvent('wheel', {
    clientX: 320, clientY: 180, deltaX: options.deltaX ?? 0, deltaY: options.deltaY,
    bubbles: true, cancelable: true,
  } as any);
  Object.defineProperty(event, 'metaKey', { value: options.metaKey ?? false });
  canvas.dispatchEvent(event as unknown as Event);
}

function recordingContext(fillTextY: number[]): CanvasRenderingContext2D {
  return {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    fillText: (_text: string, _x: number, y: number) => { fillTextY.push(y); },
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}
