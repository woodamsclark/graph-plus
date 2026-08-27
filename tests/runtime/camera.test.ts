import type { GraphCameraStateV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { GraphFrameStore, DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphHitTester } from '../../src/graph-engine/runtime/interaction/GraphHitTester.ts';
import { assert, equal, test } from '../support/harness.ts';

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
      selected: false,
      focused: false,
      hovered: false,
    }],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
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
