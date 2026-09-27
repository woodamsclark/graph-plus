import type { GraphCameraStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphCameraController, Vision } from '../../src/graph-engine/runtime/camera/index.ts';
import { GraphFrameStore, DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphHitTester } from '../../src/graph-engine/runtime/interaction/GraphHitTester.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('R-CAMERA-01 orthographic zoom scales node projection and hit radius together', () => {
  const state: GraphCameraStateV1 = {
    position: { x: 0, y: 0, z: 10 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
    projection: 'orthographic',
  };
  const camera = new GraphCameraController(state, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [],
    edges: [],
    nodes: [{
      id: 'a',
      label: 'a',
      position: { x: 0, y: 0, z: 0 },
      radius: 7,
      finalColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.node,
      opacity: 1,
      labelColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.label,
      labelOpacity: 1,
      labelFontSize: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont.sizePx,
      labelStatePriority: 0,
    }],
    backgroundColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.background,
    labelFont: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont,
  });
  const hitTester = new GraphHitTester(camera, frames);
  equal(camera.worldToScreen({ x: 0, y: 0, z: 0 }).scale, 1, 'baseline zoom should preserve the canonical node radius');
  equal(hitTester.hit({ x: 330, y: 180 }), null, 'a point beyond the baseline projected radius should miss');

  camera.setState({ ...state, zoom: 2 });
  equal(camera.worldToScreen({ x: 0, y: 0, z: 0 }).scale, 2, 'doubling zoom should double projected node radius');
  assert(hitTester.hit({ x: 330, y: 180 })?.nodeId === 'a', 'the hit radius should expand with the rendered node radius');
});

test('R-CAMERA-02 perspective dolly scales nodes without changing the default size', () => {
  const state: GraphCameraStateV1 = {
    position: { x: 0, y: 0, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  };
  const camera = new GraphCameraController(state, '3d');
  camera.setViewport(640, 360);
  equal(camera.worldToScreen({ x: 0, y: 0, z: 0 }).scale, 1, 'the stock perspective camera should retain its established node size');
  camera.setState({ ...state, position: { x: 0, y: 0, z: 50 } });
  equal(camera.worldToScreen({ x: 0, y: 0, z: 0 }).scale, 2, 'dollying to half the depth should double projected node radius');
});

test('Vision orbits around an explicit Awareness centroid without storing or reframing it', () => {
  const initial: GraphCameraStateV1 = {
    position: { x: 30, y: 20, z: 100 },
    target: { x: 10, y: -5, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  };
  const vision = new Vision(initial, '3d');
  vision.setViewport(640, 360);
  const pivot = { x: -40, y: 25, z: 10 };
  const pivotBefore = vision.worldToScreen(pivot);
  const ordinaryPoint = { x: 80, y: -15, z: 5 };
  const ordinaryBefore = vision.worldToScreen(ordinaryPoint);

  deepEqual(vision.getState(), initial, 'supplying a pivot must not mutate serialized framing before an operation');
  deepEqual(vision.worldToScreen(pivot), pivotBefore, 'an Awareness centroid alone must not move on screen');
  deepEqual(vision.worldToScreen(ordinaryPoint), ordinaryBefore, 'Awareness alone must not move graph content');

  vision.orbitByPixels(28, -16, pivot);
  const pivotAfter = vision.worldToScreen(pivot);
  assert(Math.abs(pivotAfter.x - pivotBefore.x) < 1e-9 && Math.abs(pivotAfter.y - pivotBefore.y) < 1e-9,
    'orbiting around Awareness should keep the off-center pivot fixed on screen');
  assert(JSON.stringify(vision.getState().position) !== JSON.stringify(initial.position),
    'orbiting around Awareness should move Vision around the supplied pivot');
});

test('unanchored zoom uses the Awareness centroid instead of the serialized framing center', () => {
  for (const [dimensions, projection] of [
    ['2d', 'orthographic'],
    ['3d', 'perspective'],
  ] as const) {
    const vision = new Vision({
      position: { x: 30, y: 20, z: 100 },
      target: { x: 10, y: -5, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 50 / 24,
      projection,
    }, dimensions);
    vision.setViewport(640, 360);
    const pivot = { x: -40, y: 25, z: 10 };
    const before = vision.worldToScreen(pivot);

    vision.zoomByWheel(-60, undefined, pivot);

    const after = vision.worldToScreen(pivot);
    assert(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9,
      `${projection} target-centered zoom should keep the Awareness centroid fixed on screen`);
  }
});

test('Vision exposes pose orientation without treating the serialized look-at point as Awareness', () => {
  const vision = new Vision({
    position: { x: 10, y: 20, z: 30 },
    target: { x: 10, y: 20, z: 20 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 2,
    projection: 'perspective',
  }, '3d');

  deepEqual(vision.getVisionState(), {
    pose: {
      position: { x: 10, y: 20, z: 30 },
      orientation: {
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      },
    },
    zoom: 2,
    projection: 'perspective',
  }, 'runtime Vision should expose position plus forward/up orientation');
});

test('focus fitting caps magnification in orthographic and perspective cameras', () => {
  const orthographic = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
    projection: 'orthographic',
  }, '2d');
  orthographic.setViewport(640, 360);
  orthographic.fit([{ x: 100, y: 50, z: 0 }], 48, 1.75);
  equal(orthographic.getState().zoom, 1.75,
    'single-node focus should not magnify a 2D view by more than the supplied cap');

  const perspective = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  }, '3d');
  perspective.setViewport(640, 360);
  perspective.fit([{ x: 100, y: 50, z: 0 }], 48, 1.75);
  const state = perspective.getState();
  const fittedDistance = Math.hypot(
    state.position.x - state.target.x,
    state.position.y - state.target.y,
    state.position.z - state.target.z,
  );
  assert(Math.abs(fittedDistance - (1000 / 1.75)) < 1e-9,
    'single-node focus should not dolly a 3D camera closer than the supplied cap');
});

test('camera fitting can reserve a stable world-space radius before nodes expand', () => {
  const orthographic = new GraphCameraController({
    position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
  }, '2d');
  orthographic.setViewport(640, 360);
  orthographic.fit([{ x: 0, y: 0, z: 0 }], 48, undefined, { x: 0, y: 0, z: 0 }, 500);
  assert(Math.abs(orthographic.getState().zoom - 0.264) < 1e-9,
    'a 2D predictive fit should reserve the requested radius even while nodes remain near the origin');

  const perspective = new GraphCameraController({
    position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 50 / 24, projection: 'perspective',
  }, '3d');
  perspective.setViewport(640, 360);
  perspective.fit([{ x: 0, y: 0, z: 0 }], 48, undefined, { x: 0, y: 0, z: 0 }, 500);
  const state = perspective.getState();
  equal(Math.hypot(
    state.position.x - state.target.x,
    state.position.y - state.target.y,
    state.position.z - state.target.z,
  ), 2500, 'a 3D predictive fit should dolly for the requested future radius');
});
