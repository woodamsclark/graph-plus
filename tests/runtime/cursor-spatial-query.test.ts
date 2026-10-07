import { CanvasGraphRenderer, DEFAULT_GRAPH_RENDER_THEME_V1, DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  type GraphRenderSceneV2, type GraphRenderNodeV1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import type { GraphViewStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';

type CursorProbe = {
  resolveCursorFieldTarget(): { nodeId: string; distance: number } | undefined;
  vision: GraphCameraController;
  viewState: GraphViewStateV1;
  interaction: { getCursorPoint(): { x: number; y: number } | undefined; getCameraTrackingNodeIds(): readonly string[] };
};

async function cursorHarness(dimensions: '2d' | '3d', count = 1200) {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    document: graphDocument({ nodes: Array.from({ length: count }, (_, i) => graphNode(`n${i}`)), edges: [] }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: false }, anima: { settings: { cursorGravity: 'soft' } },
  } });
  const session = await value.create();
  const initial = await session.exportViewState();
  const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
  const depth = camera.worldToScreen(initial.camera.target).depth;
  await session.restoreViewState({ ...initial, positions: Object.fromEntries(Array.from({ length: count }, (_, i) =>
    [`n${i}`, camera.screenToWorld(120 + i % 30 * 40, 120 + Math.floor(i / 30) * 40, depth)])) });
  value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
  return { ...value, session, probe: session as unknown as CursorProbe, camera, depth };
}

test('1,200-node cursor attraction queries nearby candidates without full-graph world projection in both dimensions', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await cursorHarness(dimensions);
    try {
      value.probe.interaction.getCursorPoint = () => ({ x: 130, y: 120 });
      equal(value.probe.resolveCursorFieldTarget()?.nodeId, 'n0', 'the renderer chooses the same nearest center');
      let projects = 0;
      const project = value.probe.vision.worldToScreen.bind(value.probe.vision);
      value.probe.vision.worldToScreen = position => { projects += 1; return project(position); };
      const before = value.factory.getDiagnostics().sessions[0].renderCaches;
      for (let i = 0; i < 20; i += 1) equal(value.probe.resolveCursorFieldTarget()?.nodeId, 'n0', 'repeated queries preserve the target');
      equal(projects, 0, 'the runtime does not independently project the graph for cursor attraction');
      const after = value.factory.getDiagnostics().sessions[0].renderCaches;
      equal(after.nearestQueries - before.nearestQueries, 20, 'each lookup uses the neutral spatial API');
      assert(after.lastNearestQueryCandidates <= 4, 'only spatially nearby nodes are examined');
      assert(after.nearestQueryCandidates - before.nearestQueryCandidates <= 80, 'candidate work does not scale with all 1,200 nodes');
      equal(after.centerIndexBuilds, before.centerIndexBuilds, 'warm queries retain their center index');
      equal(after.pickIndexBuilds, before.pickIndexBuilds, 'warm queries do not rebuild an alternate source');
    } finally { await value.session.dispose(); }
  }
});

test('cursor spatial queries preserve pinned, focused, camera-tracked and missing-position exclusions', async () => {
  const value = await cursorHarness('2d', 6);
  try {
    const state = await value.session.exportViewState();
    await value.session.restoreViewState({ ...state, positions: Object.fromEntries(Array.from({ length: 6 }, (_, i) =>
      [`n${i}`, value.camera.screenToWorld(317 + i, 180, value.depth)])) });
    value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
    // Isolate the effector's exclusion inputs from View presentation changes.
    value.probe.viewState = { ...value.probe.viewState, pinnedNodeIds: ['n0'], focusedNodeId: 'n1' };
    value.probe.interaction.getCameraTrackingNodeIds = () => ['n2'];
    value.probe.interaction.getCursorPoint = () => ({ x: 317, y: 180 });
    equal(value.probe.resolveCursorFieldTarget()?.nodeId, 'n3', 'all fixed subjects are excluded before nearest ranking');
    const { n3: missing, ...positions } = value.probe.viewState.positions;
    value.probe.viewState = { ...value.probe.viewState, positions };
    // The runtime checks its actual working positions, not merely scene membership.
    const internals = value.probe as unknown as { moduleView: { positions: typeof positions } };
    internals.moduleView.positions = positions;
    equal(value.probe.resolveCursorFieldTarget()?.nodeId, 'n4', 'a missing working position cannot own the well');
  } finally { await value.session.dispose(); }
});

function nearestFixture(dimensions: '2d' | '3d') {
  const value = runtimeHarness();
  const camera = new GraphCameraController({ position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: dimensions === '3d' ? 'perspective' : 'orthographic' }, dimensions);
  camera.setViewport(640, 360);
  const node = (id: string, x: number, radius = 6, opacity = 1, depth = 100): GraphRenderNodeV1 => ({
    id, label: id, position: camera.screenToWorld(x, 180, depth), radius, nodeScaleExponent: 0, opacity,
    finalColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, labelColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.label,
    labelOpacity: 1, labelFontSize: 12, labelStatePriority: 0,
  });
  const scene: GraphRenderSceneV2 = { nodes: [], edges: [], regions: [], labels: [], geometryRevision: 1, revision: 1, presentationRevision: 1,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'off', cursorAttractionRadiusPx: 16 },
    backgroundColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.background, labelFont: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont,
    view: { dimensions, camera: camera.getState(), viewport: { width: 640, height: 360, devicePixelRatio: 1 } } };
  const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), () => 0);
  renderer.initialize(); renderer.resize(scene.view.viewport);
  return { renderer, scene, node, camera };
}

test('nearest-center queries preserve strict radius, lexical ties, void filtering and center ownership', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = nearestFixture(dimensions);
    try {
      const scene = { ...value.scene, nodes: [value.node('z', 320, 6, 1, 80), value.node('a', 320),
        value.node('runner', 330), value.node('void', 319, 6, 0), value.node('giant', 200, 500)] };
      value.renderer.updateScene(scene, ['content']); value.renderer.render();
      const request = { point: { x: 320, y: 180 }, radius: 16 };
      const nearest = value.renderer.queryNearest(request);
      equal(nearest?.nodeId, 'a', 'node-ID ties win regardless of depth or disc size');
      equal(nearest?.distance, 0, 'a centered target owns the well before any runner-up');
      equal(value.renderer.queryNearest({ ...request, exclusions: new Set(['a']) })?.nodeId, 'z', 'exclusions apply before ranking');
      equal(value.renderer.queryNearest({ ...request, exclusions: new Set(['a', 'z']), isEligible: id => id !== 'runner' }), null,
        'void nodes and large discs with distant centers cannot capture the well');
      value.renderer.updateScene({ ...scene, nodes: [value.node('boundary', 336)] }, ['content']); value.renderer.render();
      equal(value.renderer.queryNearest(request), null, 'a center at exactly the radius is outside the well');
      equal(value.renderer.queryNearest({ ...request, radius: 0 }), null, 'a disabled radius performs no candidate lookup');
      equal(value.renderer.queryNearest({ ...request, point: { x: Infinity, y: 180 } }), null, 'invalid coordinates do not scan world cells');
      equal(value.renderer.queryNearest({ ...request, point: { x: 1e300, y: 180 } }), null, 'extreme finite coordinates cannot stall cell traversal');
      equal(value.renderer.queryNearest({ ...request, radius: 1e6 })?.nodeId, 'boundary', 'broad queries stay bounded by indexed entries');
    } finally { value.renderer.dispose(); }
  }
});

test('nearest queries include offscreen centers and live source overrides without replacing the render scene', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = nearestFixture(dimensions);
    try {
      const scene = { ...value.scene, nodes: [value.node('offscreen', -10, 1), value.node('active', 320)] };
      value.renderer.updateScene(scene, ['content']); value.renderer.render();
      equal(value.renderer.pick({ point: { x: 0, y: 180 } }), null, 'the offscreen disc is absent from the clipped hit grid');
      equal(value.renderer.queryNearest({ point: { x: 0, y: 180 }, radius: 16 })?.nodeId, 'offscreen', 'its nearby center remains eligible for attraction');
      const moved = value.camera.screenToWorld(240, 180, 100);
      const source = { frame: scene, view: scene.view, positions: { active: moved }, nodeIds: new Set(['active']) };
      deepEqual(value.renderer.queryNearest({ point: { x: 245, y: 180 }, radius: 16 }, source)?.position, moved, 'live source geometry drives center lookup');
      equal(value.renderer.pick({ point: { x: 320, y: 180 } })?.nodeId, 'active', 'alternate queries leave active scene and picking stable');
      const before = value.renderer.getDiagnostics().centerIndexBuilds;
      value.renderer.queryNearest({ point: { x: 245, y: 180 }, radius: 16 }, source);
      equal(value.renderer.getDiagnostics().centerIndexBuilds, before, 'alternate centers are cached with their source');
    } finally { value.renderer.dispose(); }
  }
});

test('active center indexes update with geometry/void changes and add no work while the cursor well is off', () => {
  const value = nearestFixture('2d');
  try {
    let scene = { ...value.scene, nodes: [value.node('a', 320)], cursorScreenPoint: { x: 320, y: 180 } };
    value.renderer.updateScene(scene, ['content']); value.renderer.render();
    const before = value.renderer.getDiagnostics().centerIndexBuilds;
    equal(value.renderer.queryNearest({ point: { x: 320, y: 180 }, radius: 16 })?.nodeId, 'a', 'draw prepares active attraction centers');
    equal(value.renderer.getDiagnostics().centerIndexBuilds, before, 'the following query performs no center-index build');
    scene = { ...scene, nodes: [value.node('a', 240)], geometryRevision: 2 };
    value.renderer.updateScene(scene, ['geometry']); value.renderer.render();
    equal(value.renderer.queryNearest({ point: { x: 240, y: 180 }, radius: 16 })?.nodeId, 'a', 'new geometry moves the center cell');
    value.renderer.updateScene({ ...scene, nodes: [value.node('a', 240, 6, 0)] }, ['presentation']); value.renderer.render();
    equal(value.renderer.queryNearest({ point: { x: 240, y: 180 }, radius: 16 }), null, 'void transitions remove center candidates');
    const activeBuilds = value.renderer.getDiagnostics().centerIndexBuilds;
    value.renderer.updateScene({ ...scene, geometryRevision: 3, policy: { ...scene.policy, cursorAttractionRadiusPx: 0 } }, ['geometry']);
    value.renderer.render();
    equal(value.renderer.getDiagnostics().centerIndexBuilds, activeBuilds, 'Off does not maintain an unused center index');
  } finally { value.renderer.dispose(); }
});
