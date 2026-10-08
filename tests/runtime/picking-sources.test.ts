import { CommittedPickState } from '../../src/graph-engine/runtime/render/CommittedPickState.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { equal, deepEqual, assert, test } from '../support/harness.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1, DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  type GraphPickSourceV2, type GraphRenderNodeV1 } from '../../src/graph-engine/runtime/render/index.ts';

test('pointer hits leave the active renderer scene untouched until the display callback', async () => {
  let sceneUpdates = 0;
  const picks: { scene: GraphRenderSceneV2 | undefined; updates: number }[] = [];
  let scene: GraphRenderSceneV2 | undefined;
  const registry = new GraphRendererRegistryV2();
  registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true,
    create: ({ createCanvas, now }) => {
      const renderer = new CanvasGraphRenderer(createCanvas(), now);
      const pick = renderer.pick.bind(renderer);
      renderer.pick = (...args) => { picks.push({ scene, updates: sceneUpdates }); return pick(...args); };
      const update = renderer.updateScene.bind(renderer);
      renderer.updateScene = next => { sceneUpdates += 1; scene = next; update(next); };
      return renderer;
    },
  });
  const value = runtimeHarness({ rendererRegistry: registry });
  const session = await value.create();
  try {
    value.platform.flushFrame(20);
    const before = sceneUpdates;
    const activeScene = scene;
    const canvas = runtimeCanvas(value.container);
    for (let i = 0; i < 10; i += 1) {
      const fields = { clientX: 4 + i, clientY: 4, pointerId: 42, pointerType: 'mouse', button: 0, buttons: 0 };
      const event = new value.window.PointerEvent('pointermove', { ...fields, bubbles: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event);
    }
    value.platform.flushFrame(40);
    equal(picks.length > 0, true, 'the test exercises real pointer picking');
    for (const picked of picks) {
      equal(picked.updates, before, 'picking performs zero scene installs');
      equal(picked.scene, activeScene, 'active scene identity stays stable during every pick');
    }
  } finally { await session.dispose(); }
});

function pickFixture(dimensions: '2d' | '3d') {
  const value = runtimeHarness();
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1,
    projection: dimensions === '3d' ? 'perspective' : 'orthographic',
  }, dimensions);
  camera.setViewport(640, 360);
  const node = (id: string, x: number, opacity = 1, radius = 6, depth = 100): GraphRenderNodeV1 => ({
    id, label: id, position: camera.screenToWorld(x, 180, depth), radius, nodeScaleExponent: 0,
    finalColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, opacity,
    labelColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.label, labelOpacity: 1,
    labelFontSize: 12, labelStatePriority: 0,
  });
  const scene: GraphRenderSceneV2 = {
    nodes: [node('active', 120)], edges: [], regions: [], labels: [],
    backgroundColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.background,
    labelFont: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, minimumPerspectiveTouchHitRadius: 14 },
    geometryRevision: 1, revision: 1, presentationRevision: 1,
    view: { camera: camera.getState(), dimensions, viewport: { width: 640, height: 360, devicePixelRatio: 1 } },
  };
  const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), () => 0);
  renderer.initialize(); renderer.resize(scene.view.viewport); renderer.updateScene(scene); renderer.render();
  const source = (nodes: readonly GraphRenderNodeV1[]): GraphPickSourceV2 => {
    const committed = new CommittedPickState(); committed.set({ ...scene, nodes });
    return { frame: committed.get()!, view: scene.view };
  };
  return { renderer, scene, source, node, camera };
}

test('alternate picks retain only the acquired void target without changing the render scene or camera', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pickFixture(dimensions);
    try {
      const source = value.source([value.node('hidden', 320, 0), value.node('other-hidden', 440, 0)]);
      equal(value.renderer.pick({ point: { x: 320, y: 180 } }, source), null, 'void targets remain excluded');
      const retained = { ...source, retainedNodeId: 'hidden' };
      equal(value.renderer.pick({ point: { x: 320, y: 180 } }, retained)?.nodeId, 'hidden', 'the acquired removal target remains pickable');
      equal(value.renderer.pick({ point: { x: 440, y: 180 } }, retained), null, 'retention cannot reveal another void target');
      equal(value.renderer.pick({ point: { x: 328, y: 188 } }, retained), null, 'retention preserves the exact circular hit shape');
      equal(value.renderer.pick({ point: { x: 120, y: 180 } })?.nodeId, 'active', 'ordinary picking still sees the installed scene');
      deepEqual(source.frame.nodes.map(node => node.opacity), [0, 0], 'source presentation is never mutated');
      const movedView = { ...source.view, camera: { ...source.view.camera, zoom: 2 } };
      value.renderer.pick({ point: { x: 320, y: 180 } }, { ...retained, view: movedView });
      equal(value.renderer.pick({ point: { x: 120, y: 180 } })?.nodeId, 'active', 'alternate camera cannot change the active camera');
    } finally { value.renderer.dispose(); }
  }
});

test('alternate picks use live positions and membership before drawing while active geometry remains stable', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pickFixture(dimensions);
    try {
      const source = value.source([value.node('a', 320), value.node('b', 440)]);
      const position = value.camera.screenToWorld(240, 180, 100);
      const live = { ...source, positions: { a: position }, nodeIds: new Set(['a']) };
      deepEqual(value.renderer.pick({ point: { x: 240, y: 180 } }, live)?.position, position, 'live positions drive hit geometry and returned world position');
      equal(value.renderer.pick({ point: { x: 320, y: 180 } }, live), null, 'the previous position no longer hits');
      equal(value.renderer.pick({ point: { x: 440, y: 180 } }, live), null, 'filtered membership cannot hit');
      equal(value.renderer.pick({ point: { x: 320, y: 180 } }, source)?.nodeId, 'a', 'fallback keeps its own geometry');
      equal(value.renderer.pick({ point: { x: 120, y: 180 } })?.nodeId, 'active', 'alternate geometry never replaces the scene');
    } finally { value.renderer.dispose(); }
  }
});

test('alternate picking preserves depth order, touch assistance and changed hit radii', () => {
  const value = pickFixture('3d');
  try {
    const source = value.source([value.node('back', 320, 1, 4, 100), value.node('front', 320, 1, 4, 80)]);
    equal(value.renderer.pick({ point: { x: 320, y: 180 } }, source)?.nodeId, 'front', 'the nearer visible disc wins');
    equal(value.renderer.pick({ point: { x: 332, y: 180 }, pointerKind: 'mouse' }, source), null, 'mouse requires a visible disc hit');
    equal(value.renderer.pick({ point: { x: 332, y: 180 }, pointerKind: 'pen' }, source), null, 'pen retains the mouse hit shape');
    equal(value.renderer.pick({ point: { x: 332, y: 180 }, pointerKind: 'touch' }, source)?.nodeId, 'front', 'perspective touch assistance preserves depth tie breaking');
    const larger = { ...source, frame: { ...source.frame, nodes: [value.node('front', 320, 1, 20, 80)] } };
    equal(value.renderer.pick({ point: { x: 332, y: 180 } }, larger)?.nodeId, 'front', 'presentation radius changes rebuild the alternate index');
    equal(value.renderer.pick({ point: { x: 332, y: 180 } }, source), null, 'returning to the earlier radius does not retain the larger shape');
  } finally { value.renderer.dispose(); }
});

test('an alternate hit-shape policy cannot reuse the active scene radius', () => {
  const value = pickFixture('3d');
  try {
    const source = { frame: { ...value.scene,
      policy: { ...value.scene.policy!, minimumPerspectiveNodeRadius: 40 } }, view: value.scene.view };
    equal(value.renderer.pick({ point: { x: 150, y: 180 } }, source)?.nodeId, 'active', 'policy radius override drives alternate geometry');
    equal(value.renderer.pick({ point: { x: 150, y: 180 } }), null, 'the active hit shape remains unchanged');
  } finally { value.renderer.dispose(); }
});

test('large alternate pick sources reuse bounded indexes and invalidate in-place geometry by revision', () => {
  const value = pickFixture('2d');
  try {
    const source = value.source(Array.from({ length: 1200 }, (_, i) => value.node(`n${i}`, 320 + i * 20)));
    const retained = { ...source, retainedNodeId: 'n0' };
    const before = value.renderer.getDiagnostics().pickIndexBuilds;
    for (let i = 0; i < 20; i += 1) {
      equal(value.renderer.pick({ point: { x: 320, y: 180 } }, retained)?.nodeId, 'n0', 'repeated picking preserves its result');
    }
    equal(value.renderer.getDiagnostics().pickIndexBuilds - before, 1, 'repeated alternate picks build one spatial index');
    assert(value.renderer.getDiagnostics().pickIndexCacheHits >= 19, 'subsequent hits reuse the index');
    // A solver can mutate a stable buffer. Its geometry revision must advance.
    Object.assign(source.frame.nodes[0].position, value.camera.screenToWorld(240, 180, 100));
    const advanced = { ...retained, frame: { ...source.frame, geometryRevision: 2 } };
    equal(value.renderer.pick({ point: { x: 240, y: 180 } }, advanced)?.nodeId, 'n0', 'advancing geometry invalidates a stable world buffer');
    value.renderer.pick({ point: { x: 120, y: 180 } }, value.source([value.node('third', 120)]));
    equal(value.renderer.getDiagnostics().pickIndexEntries, 2, 'the cache retains at most two alternate sources');
    value.renderer.dispose();
    equal(value.renderer.getDiagnostics().pickIndexEntries, 0, 'disposal releases alternate indexes');
  } finally { value.renderer.dispose(); }
});


test('compact committed geometry preserves full-frame mouse, pen, touch and nearest-center results', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = pickFixture(dimensions);
    try {
      const nodes = [value.node('back', 320, 1, 6, 100), value.node('front', 320, 1, 4, 80), value.node('void', 400, 0), value.node('edge', 635, 1, 10)];
      const full = { frame: { ...value.scene, nodes }, view: value.scene.view };
      const compact = value.source(nodes);
      for (const pointerKind of ['mouse', 'touch', 'pen'] as const) for (const x of [300, 316, 320, 324, 332, 400, 635, 640]) {
        deepEqual(value.renderer.pick({ point: { x, y: 180 }, pointerKind }, compact), value.renderer.pick({ point: { x, y: 180 }, pointerKind }, full), 'compact shape matches the full frame');
      }
      deepEqual(value.renderer.queryNearest({ point: { x: 330, y: 180 }, radius: 40 }, compact),
        value.renderer.queryNearest({ point: { x: 330, y: 180 }, radius: 40 }, full), 'compact geometry preserves nearest-center ranking');
    } finally { value.renderer.dispose(); }
  }
});
