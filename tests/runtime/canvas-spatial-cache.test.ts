import { CanvasGraphRenderer, DEFAULT_GRAPH_RENDER_THEME_V1, DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  type GraphRenderSceneV2, type GraphRenderNodeV1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, equal, deepEqual, test } from '../support/harness.ts';

function spatialFixture(dimensions: '2d' | '3d', count = 1) {
  const value = runtimeHarness();
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, zoom: 1,
    projection: dimensions === '3d' ? 'perspective' : 'orthographic',
  }, dimensions);
  camera.setViewport(640, 360);
  const node = (id: string, x: number, y = 180): GraphRenderNodeV1 => ({
    id, label: id, position: camera.screenToWorld(x, y, 100), radius: 6, nodeScaleExponent: 0,
    finalColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, opacity: 1,
    labelColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.label, labelOpacity: 1, labelFontSize: 12, labelStatePriority: 0,
  });
  const scene: GraphRenderSceneV2 = {
    nodes: Array.from({ length: count }, (_, i) => node(`n${i}`, 120 + i % 30 * 18, 80 + Math.floor(i / 30) * 18)),
    edges: [], regions: [], labels: [], geometryRevision: 1, revision: 1, presentationRevision: 1,
    backgroundColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.background, labelFont: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'off' },
    view: { dimensions, camera: camera.getState(), viewport: { width: 640, height: 360, devicePixelRatio: 1 } },
  };
  const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), () => 0);
  renderer.initialize(); renderer.resize(scene.view.viewport); renderer.updateScene(scene, ['content']); renderer.render();
  // Count actual operations so the regression also runs against the parent renderer.
  const internals = renderer as unknown as { vision: GraphCameraController; rebuildHitGrid: (...args: unknown[]) => void };
  let projections = 0, gridBuilds = 0;
  const project = internals.vision.worldToScreen.bind(internals.vision);
  internals.vision.worldToScreen = position => { projections += 1; return project(position); };
  const build = internals.rebuildHitGrid.bind(renderer);
  internals.rebuildHitGrid = (...args) => { gridBuilds += 1; build(...args); };
  return { ...value, renderer, camera, scene, node, counts: () => ({ projections, gridBuilds }) };
}

test('1,200-node color and nonzero-opacity fades reuse Canvas projection and hit grid in both dimensions', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = spatialFixture(dimensions, 1200);
    try {
      const before = value.renderer.getDiagnostics();
      for (let i = 0; i < 20; i += 1) {
        value.renderer.updateScene({ ...value.scene, revision: i + 2, presentationRevision: i + 2,
          nodes: value.scene.nodes.map(node => ({ ...node, opacity: 0.3 + i / 30,
            finalColor: { r: i / 20, g: 0, b: 0, a: 1 }, labelOpacity: i / 20 })),
        }, ['presentation']);
        value.renderer.render();
        equal(value.renderer.pick({ point: { x: 120, y: 80 } })?.nodeId, 'n0', 'live visual refresh preserves exact picking');
      }
      deepEqual(value.counts(), { projections: 0, gridBuilds: 0 }, 'pure visual fades do no spatial work');
      equal(value.renderer.getDiagnostics().projectedLookupBuilds, before.projectedLookupBuilds, 'projected ID lookup is retained');
      assert(value.styleAssignments.includes('fillStyle:rgb(242, 0, 0)'), 'updated node colors reach the draw');
    } finally { value.renderer.dispose(); }
  }
});

test('radius and void crossings update Canvas picking without reprojecting positions', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = spatialFixture(dimensions);
    try {
      const target = value.scene.nodes[0];
      value.renderer.updateScene({ ...value.scene, nodes: [{ ...target, radius: 20 }] }, ['presentation']);
      equal(value.renderer.pick({ point: { x: 136, y: 80 } })?.nodeId, 'n0', 'new radius works before drawing');
      value.renderer.render();
      deepEqual(value.counts(), { projections: 0, gridBuilds: 1 }, 'radius rebuilds the grid once while retaining projection');
      value.renderer.updateScene({ ...value.scene, nodes: [{ ...target, radius: 20, opacity: 0 }] }, ['presentation']);
      equal(value.renderer.pick({ point: { x: 120, y: 80 } }), null, 'void nodes immediately leave picking');
      value.renderer.render();
      value.renderer.updateScene({ ...value.scene, nodes: [{ ...target, opacity: 0.4 }] }, ['presentation']);
      equal(value.renderer.pick({ point: { x: 120, y: 80 } })?.nodeId, 'n0', 'leaving void restores picking');
      value.renderer.render();
      deepEqual(value.counts(), { projections: 0, gridBuilds: 3 }, 'each hit-shape transition builds once');
    } finally { value.renderer.dispose(); }
  }
});

test('geometry/content invalidations, camera and viewport changes refresh Canvas spatial data', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = spatialFixture(dimensions);
    try {
      const moved = value.camera.screenToWorld(240, 180, 100);
      const geometry = { ...value.scene, nodes: [{ ...value.scene.nodes[0], position: moved }] };
      value.renderer.updateScene(geometry, ['geometry']);
      value.renderer.updateScene({ ...geometry, presentationRevision: 2 }, ['presentation']);
      deepEqual(value.renderer.pick({ point: { x: 240, y: 180 } })?.position, moved, 'geometry invalidation refreshes even without a revision bump');
      value.renderer.render();
      deepEqual(value.counts(), { projections: 1, gridBuilds: 1 }, 'picking and drawing share one geometry update');
      const content = { ...geometry, nodes: [geometry.nodes[0], value.node('added', 440)] };
      value.renderer.updateScene(content, ['content']); value.renderer.render();
      equal(value.renderer.pick({ point: { x: 440, y: 180 } })?.nodeId, 'added', 'new membership enters projection');
      deepEqual(value.counts(), { projections: 3, gridBuilds: 2 }, 'content rebuilds both nodes once');
      const zoomed = { ...content, view: { ...content.view, camera: { ...content.view.camera, zoom: 2 } } };
      value.renderer.updateScene(zoomed, ['camera']); value.renderer.render();
      deepEqual(value.counts(), { projections: 5, gridBuilds: 3 }, 'camera changes reproject all live nodes');
      value.renderer.resize({ ...value.scene.view.viewport, width: 320, height: 180 });
      value.renderer.updateScene({ ...zoomed, view: { ...zoomed.view, viewport: { width: 320, height: 180, devicePixelRatio: 1 } } }, ['camera']);
      value.renderer.render();
      deepEqual(value.counts(), { projections: 7, gridBuilds: 4 }, 'viewport changes refresh clipping and projection');
      value.renderer.dispose();
      equal(value.renderer.getDiagnostics().projectedGeometryEntries, 0, 'disposal releases cached spatial entries');
    } finally { value.renderer.dispose(); }
  }
});

test('perspective hit-policy changes and unchanged-position membership changes cannot reuse stale Canvas shapes', () => {
  const value = spatialFixture('3d');
  try {
    value.renderer.updateScene({ ...value.scene, policy: { ...value.scene.policy!, minimumPerspectiveNodeRadius: 30 } }, ['presentation']);
    equal(value.renderer.pick({ point: { x: 145, y: 80 } })?.nodeId, 'n0', 'policy radius changes refresh exact shapes');
    deepEqual(value.counts(), { projections: 0, gridBuilds: 1 }, 'radius policy retains positions');
    value.renderer.updateScene({ ...value.scene, nodes: [value.node('replacement', 440)] }, ['presentation']);
    value.renderer.render();
    equal(value.renderer.pick({ point: { x: 440, y: 180 } })?.nodeId, 'replacement', 'same-sized membership replacement still projects new IDs');
    equal(value.renderer.pick({ point: { x: 120, y: 80 } }), null, 'removed IDs leave picking');
    deepEqual(value.counts(), { projections: 1, gridBuilds: 2 }, 'membership changes invalidate geometry even when mislabeled presentation');
  } finally { value.renderer.dispose(); }
});


test('in-place solver geometry advances cached Canvas positions by revision', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = spatialFixture(dimensions);
    try {
      const moved = value.camera.screenToWorld(240, 180, 100);
      Object.assign(value.scene.nodes[0].position, moved);
      value.renderer.updateScene({ ...value.scene, geometryRevision: 2 }, []);
      deepEqual(value.renderer.pick({ point: { x: 240, y: 180 } })?.position, moved, 'stable-buffer geometry reaches picking by revision');
      value.renderer.render();
      deepEqual(value.counts(), { projections: 1, gridBuilds: 1 }, 'revision update prepares spatial data once');
      equal(value.renderer.pick({ point: { x: 120, y: 80 } }), null, 'the old screen position leaves the index');
    } finally { value.renderer.dispose(); }
  }
});
