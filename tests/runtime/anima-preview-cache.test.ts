import { Consciousness, DEFAULT_GRAPH_RENDER_THEME_V1, type GraphVisualThemeV2 } from '../../src/graph-engine/runtime/index.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, DEFAULT_GRAPH_PRESENTATION_POLICY_V2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import type { GraphModuleHost } from '../../src/graph-engine/runtime/modules/index.ts';
import { SessionProjectionCoordinatorV1 } from '../../src/graph-engine/runtime/session/SessionProjectionCoordinator.ts';
import type { GraphViewStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function previewHarness(dimensions: '2d' | '3d') {
  let theme: GraphVisualThemeV2 = DEFAULT_GRAPH_RENDER_THEME_V1;
  let scene: GraphRenderSceneV2 | undefined;
  const registry = new GraphRendererRegistryV2();
  registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
    const renderer = new CanvasGraphRenderer(createCanvas(), now);
    const update = renderer.updateScene.bind(renderer);
    renderer.updateScene = next => { scene = next; update(next); };
    return renderer;
  } });
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
    resolveThemePalette: () => theme,
    document: graphDocument({ nodes: ['a', 'b', 'outside'].map(id => graphNode(id)), edges: [graphEdge('ab', 'a', 'b')] }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: false }, anima: { settings: { cursorGravity: 'off' } },
  } });
  return { ...value,
    node: (id: string) => scene!.nodes.find(node => node.id === id)!,
    setTheme: (next: GraphVisualThemeV2) => { theme = next; value.factory.refreshActiveThemes(); },
    advance: (milliseconds: number) => {
      value.platform.advanceTime(milliseconds);
      value.platform.flushTimer();
      value.platform.flushFrame(value.platform.now());
    },
  };
}

test('cached hover targets adopt theme changes without restarting partial or terminal fades', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = previewHarness(dimensions);
    const session = await value.create();
    try {
      value.advance(20);
      const world = await session.exportViewState();
      await session.setNodeHover!('a');
      value.advance(20);
      value.advance(450);
      const partialOpacity = value.node('outside').opacity;
      assert(partialOpacity < 1 && partialOpacity > 0.24, 'the theme changes while the preview is partway in');
      const accent = { r: 1, g: 0, b: 0, a: 1 };
      value.setTheme({ ...DEFAULT_GRAPH_RENDER_THEME_V1, colors: { ...DEFAULT_GRAPH_RENDER_THEME_V1.colors, animaAccent: accent } });
      value.advance(20);
      assert(value.node('outside').opacity <= partialOpacity, 'changing the target visuals cannot restart the hover delay');
      value.advance(300);
      deepEqual(value.node('a').finalColor, accent, 'the terminal highlight uses the new theme');
      const nextAccent = { r: 0, g: 1, b: 0, a: 1 };
      value.setTheme({ ...DEFAULT_GRAPH_RENDER_THEME_V1, colors: { ...DEFAULT_GRAPH_RENDER_THEME_V1.colors, animaAccent: nextAccent } });
      value.advance(20);
      deepEqual(value.node('a').finalColor, nextAccent, 'an already terminal highlight updates immediately');
      equal(value.node('outside').opacity, 0.24, 'terminal theme changes keep the terminal preview strength');
      deepEqual(await session.exportViewState(), world, 'theme changes and previews do not mutate the world');
      equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'a terminal refreshed target sleeps');
    } finally { await session.dispose(); }
  }
});

test('cached hover targets adopt settings and pin changes without replaying hover entry', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = previewHarness(dimensions);
    const session = await value.create();
    try {
      await session.setNodeHover!('a');
      value.advance(20);
      value.advance(720);
      const fontSize = value.node('a').labelFontSize;
      const radius = value.node('a').radius;
      await session.setSessionOverrides({ modules: { rendering: { settings: { nodeRadiusScale: 2 } } } });
      value.advance(20);
      equal(value.node('a').radius, radius * 2, 'settings update live radius');
      assert(value.node('a').labelFontSize > fontSize, 'cached label targets use the updated radius setting');
      equal(value.node('outside').opacity, 0.24, 'settings changes preserve terminal strength');
      await session.setNodePinned('b', true);
      value.advance(20);
      equal(value.node('b').strokeWidth, 2, 'pinning updates the cached target outline');
      await session.setNodePinned('b', false);
      value.advance(20);
      equal(value.node('b').strokeWidth, undefined, 'unpinning cannot retain an old target outline');
    } finally { await session.dispose(); }
  }
});

test('cached target compilation stays independent of live position and camera updates on 1200 nodes', () => {
  const document = graphDocument({ nodes: Array.from({ length: 1200 }, (_, i) => graphNode(`n${i}`)), edges: [] });
  const viewState: GraphViewStateV1 = {
    schemaVersion: 1, documentId: document.documentId, documentRevision: document.revision,
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', dimensions: '2d',
    positions: Object.fromEntries(document.nodes.map((node, i) => [node.id, { x: i * 10, y: 0, z: 0 }])),
    pinnedNodeIds: [], selectedNodeIds: [], viewMode: 'overview', activeFilters: {}, moduleState: {},
    camera: { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' },
  };
  let targetCompilations = 0;
  const host = { has: () => true, contribute: (state: Parameters<GraphModuleHost['contribute']>[0]) => {
    if (state.objectActivationPreview) targetCompilations += 1;
    return state;
  } } as unknown as GraphModuleHost;
  const coordinator = new SessionProjectionCoordinatorV1(() => {}, () => {});
  const selection = { nodeIds: new Set(document.nodes.map(node => node.id)), edgeIds: new Set<string>() };
  const options: Parameters<SessionProjectionCoordinatorV1['compose']>[0] = {
    host, consciousness: new Consciousness(), viewState,
    projectionView: { sourceDocument: document, document, viewState, positions: viewState.positions,
      projectionSelection: selection, renderSelection: selection, formActive: false,
      nodeRoles: {}, edgeRoles: {}, regions: [], regionLayouts: [] },
    theme: DEFAULT_GRAPH_RENDER_THEME_V1, presentationPolicy: DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
    hoveredNodeId: 'n0', resolveObjectActivationPreview: () => ({ kind: 'objects', activation: 'primary',
      addedNodeIds: ['n0'], removedNodeIds: [], hoverPathNodeIds: [] }), invalidation: 'presentation', now: 0,
  };
  coordinator.compose(options);
  coordinator.compose({ ...options, now: 700 });
  equal(targetCompilations, 1, 'entry resolves one target');
  for (let i = 1; i <= 20; i += 1) {
    const positions = { ...viewState.positions, n0: { x: i, y: i * 2, z: 0 } };
    coordinator.compose({ ...options, now: 700 + i * 20, invalidation: 'geometry',
      viewState: { ...viewState, positions, camera: { ...viewState.camera, zoom: 1 + i / 10 } },
      projectionView: { ...options.projectionView, positions } });
    deepEqual(coordinator.frames.get()!.nodes[0].position, positions.n0, 'cached targets preserve the moving live node');
  }
  equal(targetCompilations, 1, 'twenty moving frames reuse the semantic target');
  coordinator.compose({ ...options, now: 1200, theme: { ...options.theme, revision: 1 } });
  equal(targetCompilations, 2, 'one theme revision rebuilds the target once');
  coordinator.compose({ ...options, now: 1220, theme: { ...options.theme, revision: 1 } });
  equal(targetCompilations, 2, 'unchanged target revisions retain the cache');
  options.consciousness.receiveExogenous({ source: 'exogenous', type: 'replace-remembered-subjects', nodeIds: ['n1'] },
    { availableNodeIds: selection.nodeIds });
  coordinator.compose({ ...options, now: 1240, theme: { ...options.theme, revision: 1 } });
  equal(targetCompilations, 3, 'Memory changes invalidate semantic target visuals');
  coordinator.compose({ ...options, now: 1260, theme: { ...options.theme, revision: 1 }, invalidation: 'camera' });
  equal(targetCompilations, 3, 'camera-only composition retains the target');
  coordinator.compose({ ...options, now: 1280, theme: { ...options.theme, revision: 1 }, invalidation: 'content' });
  equal(targetCompilations, 4, 'a settings/structural content transaction refreshes the target once');
});
