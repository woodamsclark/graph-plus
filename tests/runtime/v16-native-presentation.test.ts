import { GraphInput } from '../../src/graph-engine/runtime/interaction/GraphInput.ts';
import { BufferedQueue } from '../../src/graph-engine/runtime/interaction/BufferedQueue.ts';
import type {
  GraphModulePresentationStateV1,
} from '../../src/graph-engine/runtime/modules/index.ts';
import {
  CanvasGraphRenderer,
  composeGraphRenderFrameV1,
  DEFAULT_GRAPH_RENDER_THEME_V1,
  DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  GraphFrameStore,
  GraphRendererRegistryV2,
  type GraphRenderSceneV2,
} from '../../src/graph-engine/runtime/render/index.ts';
import { desaturateGraphColorV2, parseGraphColorV2 } from '../../src/graph-engine/runtime/theme/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { resolveConsciousness } from '../../src/graph-engine/runtime/consciousness/index.ts';
import { AnimaModule } from '../../src/graph-engine/runtime/modules/shipped/AnimaModule.ts';
import {
  ForceLayoutModule,
  readForceSettings,
} from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import {
  GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  migrateGraphPlusProfileOverridesV16,
} from '../../src/graph-plus/consumer/index.ts';
import {
  DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2,
  ThemeStyleResolver,
} from '../../src/obsidian/themeStyleResolver.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness } from '../support/runtimeHarness.ts';

const RESOLVED_NODE_STYLE = {
  finalColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.node,
  opacity: 1,
  labelColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.label,
  labelOpacity: 1,
  labelFontSize: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont.sizePx,
  labelStatePriority: 0,
} as const;

const RESOLVED_FRAME_STYLE = {
  backgroundColor: DEFAULT_GRAPH_RENDER_THEME_V1.colors.background,
  labelFont: DEFAULT_GRAPH_RENDER_THEME_V1.labelFont,
} as const;

test('cursor input clears on leave, gestures and touch without creating a stale field', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const input = new GraphInput({ element: canvas, platform: value.platform, events: new BufferedQueue(),
    getIdentity: () => ({ documentId: 'cursor-test', documentRevision: 0 }) });
  pointer(value, canvas, 'pointermove', 50, 60, 1, 'mouse');
  deepEqual(input.getCursorPoint(), { x: 50, y: 60 }, 'mouse supplies canvas-local coordinates');
  canvas.dispatchEvent(new value.window.PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1,
    clientX: 50, clientY: 60, ctrlKey: true }) as unknown as Event);
  equal(input.getCursorPoint(), undefined, 'Ctrl-removal cannot regain a label or moving target through proximity');
  pointer(value, canvas, 'pointermove', 50, 60, 1, 'mouse');
  pointer(value, canvas, 'pointerdown', 50, 60, 1, 'mouse');
  equal(input.getCursorPoint(), undefined, 'mouse gestures suspend attraction and proximity');
  pointer(value, canvas, 'pointerup', 50, 60, 1, 'mouse');
  pointer(value, canvas, 'pointerdown', 50, 60, 2, 'touch');
  pointer(value, canvas, 'pointerup', 50, 60, 2, 'touch');
  equal(input.getCursorPoint(), undefined, 'touch cannot resume a stale mouse field');
  pointer(value, canvas, 'pointermove', 50, 60, 1, 'mouse');
  canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 1 }) as unknown as Event);
  equal(input.getCursorPoint(), undefined, 'pointer leave clears proximity');
  input.dispose();
});

test('cursor attraction moves a cooled graph without reheating and excludes pins and Form', () => {
  const document = graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [] });
  const initial = pipeline(document, { nodeIds: new Set(['a', 'b']), edgeIds: new Set() });
  const state = { ...initial, viewState: { ...initial.viewState, pinnedNodeIds: ['b'] } };
  const force = new ForceLayoutModule('2d', readForceSettings({ repulsionStrength: 0, springStrength: 0,
    centeringStrength: 0, collisionRadius: 0 }));
  force.tick(state, 1 / 60);
  force.restoreState({ schemaVersion: 1, alpha: 0, running: false, velocities: {} });
  const result = force.tick({ ...state, cursorAttractionSteps: { a: { x: 1, y: 2, z: 7 }, b: { x: -10, y: 0, z: 0 } } }, 1 / 60);
  assert(result?.positions, 'cursor must wake a cold layout');
  equal(result.positions.a.x, state.positions.a.x + 1, 'cursor moves eligible nodes independently of alpha');
  equal(result.positions.a.y, state.positions.a.y + 2, 'cursor follows both screen axes');
  equal(result.positions.a.z, 0, '2D remains planar');
  deepEqual(result.positions.b, state.positions.b, 'pinned nodes ignore cursor steps');
  equal(force.getDiagnostics().alpha, 0, 'cursor must not reheat the whole graph');
  equal(result.requestNextFrame, true, 'cursor continues while it has nearby nodes');
  equal(force.tick({ ...state, formActive: true, cursorAttractionSteps: { a: { x: 1, y: 0, z: 0 } } }, 1 / 60), undefined,
    'cursor cannot distort a Form layout');
  equal(force.tick(state, 1 / 60)?.requestNextFrame, false, 'leaving allows a cold layout to stop');
});

test('settled physics can repeatedly wake on cursor entry with unchanged position buffers', () => {
  const document = graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [] });
  let state = pipeline(document, { nodeIds: new Set(['a', 'b']), edgeIds: new Set() });
  const force = new ForceLayoutModule('2d', readForceSettings({ repulsionStrength: 0, springStrength: 0,
    centeringStrength: 0, collisionRadius: 0, alphaDecay: 1 }));
  for (let visit = 0; visit < 3; visit++) {
    for (let step = 0; step < 90; step++) {
      const result = force.tick(state, 1 / 60);
      if (result?.positions) state = { ...state, positions: result.positions };
    }
    equal(force.getDiagnostics().running, false, 'ordinary settling puts physics to sleep');
    const before = state.positions.a.x;
    const result = force.tick({ ...state, cursorAttractionSteps: { a: { x: 1, y: 0, z: 0 } } }, 1 / 60);
    assert(result?.positions, 'a cursor visit must restart a naturally settled layout');
    equal(result.positions.a.x, before + 1, 'each new visit moves the nearby node');
    state = { ...state, positions: result.positions };
    equal(force.tick(state, 1 / 60)?.requestNextFrame, false, 'leave returns a cold layout to sleep');
  }
  force.updateSettings({ repulsionStrength: 0, springStrength: 0, centeringStrength: 0.1, collisionRadius: 0 });
  assert(force.tick(state, 1 / 60)?.positions, 'ordinary forces can restart after cursor wake cycles');
});

test('live cursor field has the same short screen range in 2D and 3D and stops on leave', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const document = graphDocument({ nodes: ['near', 'pinned', 'far'].map(id => graphNode(id)), edges: [] });
    const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
      registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document });
    value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: { 'force-layout': { settings: {
      repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0, alphaDecay: 1000,
    } } } });
    const session = await value.create();
    const initial = await session.exportViewState();
    const cameraState = { ...initial.camera, position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
      zoom: 1, projection: dimensions === '2d' ? 'orthographic' as const : 'perspective' as const };
    const camera = new GraphCameraController(cameraState, dimensions);
    camera.setViewport(640, 360);
    const positions = { near: camera.screenToWorld(320, 180, 1000),
      pinned: camera.screenToWorld(320, 210, 1000), far: camera.screenToWorld(500, 180, 1000) };
    await session.restoreViewState({ ...initial, camera: cameraState, positions, pinnedNodeIds: ['pinned'] });
    const restoredCamera = (await session.exportViewState()).camera;
    const errors: string[] = [];
    session.onError(error => errors.push(error.code));
    const canvas = runtimeCanvas(value.container);
    pointer(value, canvas, 'pointermove', 350, 180, 11, 'mouse');
    value.platform.flushFrame(17);
    const after = await session.exportViewState();
    assert(after.positions.near.x > positions.near.x, 'nearby node should move toward the cursor');
    deepEqual(after.positions.pinned, positions.pinned, 'pinned nodes stay fixed');
    deepEqual(after.positions.far, positions.far, 'distant nodes are outside the field');
    deepEqual(after.camera, restoredCamera, 'attraction never moves the camera');
    canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 11 }) as unknown as Event);
    value.platform.flushFrame(34);
    deepEqual((await session.exportViewState()).positions, after.positions, 'leaving stops attraction without replaying momentum');
    let timestamp = 34;
    for (let visit = 0; visit < 3; visit++) {
      for (let step = 0; step < 90; step++) {
        value.platform.advanceTime(34);
        value.platform.flushTimer();
        value.platform.flushFrame(timestamp += 34);
      }
      const beforeVisit = await session.exportViewState();
      pointer(value, canvas, 'pointermove', 350, 180, 11, 'mouse');
      value.platform.flushFrame(timestamp += 34);
      const nextVisit = await session.exportViewState();
      assert(nextVisit.positions.near.x > beforeVisit.positions.near.x, 'each cursor return wakes settled session physics');
      deepEqual(nextVisit.camera, restoredCamera, 'repeated waking retains camera framing');
      canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 11 }) as unknown as Event);
      value.platform.flushFrame(timestamp += 34);
    }
    deepEqual(errors, [], 'settle and wake must never cause the host to disable force layout');
    await session.dispose();
  }
});

test('cursor gravity pulls only the nearest eligible node and never a runner-up at the center', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
      registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
      document: graphDocument({ nodes: ['a', 'b', 'far'].map(id => graphNode(id)), edges: [] }) });
    value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: { 'force-layout': { settings: {
      repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    } } } });
    const session = await value.create();
    const initial = await session.exportViewState();
    const camera = new GraphCameraController(initial.camera, dimensions);
    camera.setViewport(640, 360);
    const depth = camera.worldToScreen(initial.camera.target).depth;
    const positions = { a: camera.screenToWorld(320, 180, depth),
      b: camera.screenToWorld(360, 180, depth), far: camera.screenToWorld(500, 180, depth) };
    await session.restoreViewState({ ...initial, positions });
    const canvas = runtimeCanvas(value.container);
    pointer(value, canvas, 'pointermove', 340, 180, 13);
    value.platform.flushFrame(100);
    const pulled = await session.exportViewState();
    assert(pulled.positions.a.x > positions.a.x, 'a stable node-ID tie selects a single nearest node');
    deepEqual(pulled.positions.b, positions.b, 'another node inside the well stays still');
    deepEqual(pulled.positions.far, positions.far, 'outside nodes stay still');
    const centered = camera.worldToScreen(pulled.positions.a);
    pointer(value, canvas, 'pointermove', centered.x, centered.y, 13);
    value.platform.flushFrame(200);
    deepEqual((await session.exportViewState()).positions, pulled.positions, 'a centered nearest node cannot pass attraction to the runner-up');
    pointer(value, canvas, 'pointermove', 370, 180, 13);
    value.platform.flushFrame(300);
    const switched = await session.exportViewState();
    assert(switched.positions.b.x > pulled.positions.b.x, 'moving the cursor hands the well to the new nearest node');
    deepEqual(switched.positions.a, pulled.positions.a, 'the previous nearest stops moving');
    await session.dispose();
  }
});

test('Overview completes timed previews only on node hover, independently of cursor gravity range', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
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
      document: graphDocument({ nodes: ['a', 'b', 'far'].map(id => graphNode(id)), edges: [graphEdge('ab', 'a', 'b')] }) });
    value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: { 'force-layout': { enabled: false } } });
    const session = await value.create();
    const initial = await session.exportViewState();
    const camera = new GraphCameraController(initial.camera, dimensions);
    camera.setViewport(640, 360);
    const positions = { a: camera.screenToWorld(320, 180, 1000),
      b: camera.screenToWorld(500, 180, 1000), far: camera.screenToWorld(80, 180, 1000) };
    await session.restoreViewState({ ...initial, positions });
    const unchanged = await session.exportViewState();
    const canvas = runtimeCanvas(value.container);
    for (const [distance, expected] of [[64, 1], [32, 1], [0, 0.24], [1, 0.24], [0, 0.24], [32, 1], [64, 1]]) {
      pointer(value, canvas, 'pointermove', 320 + distance, 180, 14);
      value.platform.flushFrame();
      value.platform.advanceTime(distance <= 1 ? 700 : 500);
      value.platform.flushTimer(); value.platform.flushFrame();
      equal(scene!.nodes.find(node => node.id === 'far')!.opacity, expected,
        'only an actual node hover completes the timed preview, independently of cursor distance');
      deepEqual(await session.exportViewState(), unchanged, 'hover never commits View, Attention, Memory or camera');
    }
    canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 14 }) as unknown as Event);
    value.platform.flushFrame();
    equal(scene!.nodes.find(node => node.id === 'far')!.opacity, 1, 'leaving restores Overview');
    pointer(value, canvas, 'pointermove', 320, 180, 14);
    value.platform.flushFrame(1100);
    pointer(value, canvas, 'pointerdown', 320, 180, 14);
    pointer(value, canvas, 'pointerup', 320, 180, 14);
    value.platform.flushFrame(1200);
    equal((await session.exportViewState()).viewMode, 'explore', 'actual node activation still commits Constellation normally');
    await session.dispose();
  }
});

test('cursor proximity reveals nearby labels independently of Labels mode while respecting range and void', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const renderer = new CanvasGraphRenderer(canvas, () => 0);
  renderer.initialize();
  renderer.resize(640, 360, 1);
  const scene = { regions: [], edges: [], ...RESOLVED_FRAME_STYLE, revision: 1, presentationRevision: 1,
    view: { dimensions: '2d' as const, camera: { position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const },
      viewport: { width: 640, height: 360, devicePixelRatio: 1 } }, labels: [],
    nodes: [
      { id: 'near', label: 'near', position: { x: 0, y: 0, z: 0 }, radius: 8, ...RESOLVED_NODE_STYLE,
        opacity: 0.24, showLabel: false, labelOpacity: 0 },
      { id: 'far', label: 'far', position: { x: 150, y: 0, z: 0 }, radius: 8, ...RESOLVED_NODE_STYLE,
        showLabel: false, labelOpacity: 0 },
      { id: 'void', label: 'void', position: { x: 20, y: 0, z: 0 }, radius: 8, ...RESOLVED_NODE_STYLE,
        opacity: 0, showLabel: false, labelOpacity: 0 },
    ], policy: { labelMode: 'adaptive' as const, cursorLabelRevealRadiusPx: 96 } };
  const labels = () => value.drawArguments.filter(c => c.method === 'fillText').map(c => c.args[0]);
  renderer.updateScene({ ...scene, cursorScreenPoint: { x: 320, y: 160 } });
  renderer.render();
  deepEqual(labels(), ['near'], 'only nearby visible nodes reveal labels');
  value.drawArguments.length = 0;
  renderer.updateScene(scene);
  renderer.render();
  deepEqual(labels(), [], 'leaving restores dim label suppression');
  renderer.updateScene({ ...scene, cursorScreenPoint: { x: 320, y: 160 }, policy: { ...scene.policy, labelMode: 'off' } });
  renderer.render();
  deepEqual(labels(), ['near'], 'Labels Off leaves the proximity channel enabled');
  value.drawArguments.length = 0;
  renderer.updateScene({ ...scene, cursorScreenPoint: { x: 320, y: 160 },
    policy: { ...scene.policy, labelMode: 'off', cursorLabelRevealRadiusPx: 0 } });
  renderer.render();
  deepEqual(labels(), [], 'disabling proximity and ordinary labels hides unforced labels');
  renderer.dispose();
});

test('proximity-only labels fade identically for Overview standard and Constellation dim nodes', () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = runtimeHarness();
    const canvas = value.document.createElement('canvas');
    const context = recordingContext([]);
    const alphas = new Map<string, number>();
    context.fillText = text => { alphas.set(text, context.globalAlpha); };
    canvas.getContext = (() => context) as unknown as typeof canvas.getContext;
    const renderer = new CanvasGraphRenderer(canvas, () => 0);
    renderer.initialize(); renderer.resize(640, 360, 1);
    const cameraState = { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: dimensions === '2d' ? 'orthographic' as const : 'perspective' as const };
    const camera = new GraphCameraController(cameraState, dimensions); camera.setViewport(640, 360);
    const automatic = Array.from({ length: 12 }, (_, i) => ({ id: `auto-${i}`, label: `A${i}`,
      position: camera.screenToWorld(40 + (i % 6) * 95, i < 6 ? 40 : 320, 1000), radius: 4,
      ...RESOLVED_NODE_STYLE, labelStatePriority: 5, labelFontSize: 12 }));
    for (const dimmed of [false, true]) {
      const scene = { regions: [], edges: [], ...RESOLVED_FRAME_STYLE, revision: 1, presentationRevision: 1,
        view: { dimensions, camera: cameraState, viewport: { width: 640, height: 360, devicePixelRatio: 1 } }, labels: [],
        nodes: [...automatic, { id: 'target', label: 'target', position: camera.screenToWorld(320, 180, 1000), radius: 4,
          ...RESOLVED_NODE_STYLE, opacity: dimmed ? 0.24 : 1, showLabel: !dimmed, labelOpacity: dimmed ? 0 : 1,
          labelStatePriority: 0 }],
        policy: { labelMode: 'adaptive' as const, adaptiveLabelSaliency: 100, cursorLabelRevealRadiusPx: 96 },
      };
      for (const distance of [72, 48, 24]) {
        alphas.clear();
        renderer.updateScene({ ...scene, cursorScreenPoint: { x: 320 + distance, y: 180 } }); renderer.render();
        equal(alphas.get('target'), 1 - distance / 96, 'cursor-only opacity depends on distance, not its scene label opacity');
        assert([...alphas].filter(([label]) => label !== 'target').every(([, alpha]) => alpha === 1),
          'already eligible automatic labels retain their normal opacity');
      }
      alphas.clear(); renderer.updateScene(scene); renderer.render();
      equal(alphas.has('target'), false, 'leaving restores the automatic budget or dim suppression');
    }
    renderer.dispose();
  }
});

test('live cursor label toggle updates independently of Labels Off and cursor gravity', async () => {
  let scene: GraphRenderSceneV2 | undefined;
  const registry = new GraphRendererRegistryV2();
  registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
    const renderer = new CanvasGraphRenderer(createCanvas(), now); const update = renderer.updateScene.bind(renderer);
    renderer.updateScene = next => { scene = next; update(next); }; return renderer;
  } });
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
    document: graphDocument({ nodes: [graphNode('near'), graphNode('far')], edges: [] }) });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '2d', modules: {
    'force-layout': { enabled: false }, rendering: { settings: { labelMode: 'off' } },
  } });
  const session = await value.create(); const initial = await session.exportViewState();
  const camera = new GraphCameraController(initial.camera, '2d'); camera.setViewport(640, 360);
  await session.restoreViewState({ ...initial, positions: { near: camera.screenToWorld(320, 180, 1000),
    far: camera.screenToWorld(500, 180, 1000) } });
  const canvas = runtimeCanvas(value.container);
  pointer(value, canvas, 'pointermove', 350, 180, 26); value.platform.flushFrame();
  const drawn = () => value.drawArguments.filter(call => call.method === 'fillText').map(call => call.args[0]);
  for (const enabled of [false, true, false]) {
    value.drawArguments.length = 0;
    await session.setSessionOverrides({ modules: { anima: { settings: { cursorLabelProximityEnabled: enabled } } } });
    value.platform.flushFrame();
    deepEqual(drawn(), enabled ? ['near'] : [], 'proximity can switch while ordinary labels remain Off');
    equal(scene!.policy?.labelMode, 'off', 'the proximity toggle cannot alter Labels mode');
    equal(scene!.policy?.cursorAttractionRadiusPx, 64, 'the label toggle cannot alter gravity');
    equal(scene!.policy?.cursorLabelRevealRadiusPx, enabled ? 96 : 0, 'the live setting controls only the label field');
  }
  await session.dispose();
});

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
  equal(patch.presentationPolicy?.nodeScaleMode, 'sqrt-orthographic', 'Anima should request native-style 2d node scaling');
  equal(patch.presentationPolicy?.nodeScaleExponent, 0.5,
    'Anima should default to its calm square-root zoom response');
  equal(patch.presentationPolicy?.labelScaleMode, 'fixed', 'Anima labels should remain screen-readable in both dimensions');
});

test('Awareness and Focus presentation do not resize nodes or change their zoom response', () => {
  const document = graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [graphEdge('ab', 'a', 'b')] });
  const state = pipeline(document, { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['ab']) });
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const baseline = anima.contributeFrame(state)!.nodeContributions!;
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    const conscious = withConsciousness(state, ['a'], viewMode === 'focus' ? 'a' : undefined);
    const next = anima.contributeFrame({ ...state, ...conscious, viewState: { ...conscious.viewState, viewMode } })!.nodeContributions!;
    for (const id of ['a', 'b']) {
      equal(next[id].radius, baseline[id].radius, 'semantic illumination does not change the structural radius');
      equal(next[id].nodeScaleExponent, baseline[id].nodeScaleExponent, 'semantic illumination does not change zoom scaling');
    }
  }
});

test('Anima fixes node zoom contrast at its former 100 percent effect, ignoring saved tuning', () => {
  const document = graphDocument({ nodes: [graphNode('small'), graphNode('large')], edges: [] });
  const state = {
    ...pipeline(document, { nodeIds: new Set(['small', 'large']), edgeIds: new Set() }),
    nodeContributions: { large: { radiusScale: 2 } },
};

test('Canvas picking stays bounded by the viewport at tight zoom in both projections', () => {
  for (const projection of ['orthographic', 'perspective'] as const) {
    const value = runtimeHarness();
    const camera = new GraphCameraController({
      position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection,
    }, projection === 'perspective' ? '3d' : '2d');
    camera.setViewport(640, 360);
    const frames = new GraphFrameStore();
    frames.set({
      regions: [], edges: [],
      nodes: [{ id: 'hub', label: 'hub', position: { x: 0, y: 0, z: 0 },
        radius: 24, nodeScaleExponent: 2, ...RESOLVED_NODE_STYLE }],
      ...RESOLVED_FRAME_STYLE,
      policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'off' },
    });
    const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), camera, frames, () => 0);
    renderer.resize(640, 360, 1);
    // Check the moderate regression case before the maximum to fail without a huge allocation.
    for (const scale of [12, 40]) {
      camera.setState({ ...camera.getState(), zoom: projection === 'perspective' ? scale * (50 / 24) : scale });
      // The first pick also exercises rebuilding before any render at this camera position.
      equal(renderer.hitTest({ x: 0, y: 0 })?.nodeId, 'hub', 'a large visible disc remains pickable at the corner');
      assert(renderer.getDiagnostics().hitGridCells <= 252, 'offscreen disc coverage cannot allocate offscreen cells');
      renderer.render();
      assert(renderer.getDiagnostics().hitGridCells <= 252, 'render-time indexing obeys the same bound');
      equal(renderer.hitTest({ x: 640, y: 360 }, 'touch')?.nodeId, 'hub', 'touch picking includes the viewport boundary');
    }
    renderer.dispose();
  }
});

test('Canvas void nodes do not allocate picking cells or obscure a visible node', () => {
  const value = runtimeHarness();
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 12, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  const voidNode = { id: 'void', label: 'void', position: { x: 0, y: 0, z: 10 },
    radius: 24, nodeScaleExponent: 2, ...RESOLVED_NODE_STYLE, opacity: 0 };
  frames.set({ ...RESOLVED_FRAME_STYLE, regions: [], edges: [], nodes: [voidNode] });
  const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  equal(renderer.getDiagnostics().hitGridCells, 0, 'void-only presentation has no picking cells');
  equal(renderer.hitTest({ x: 320, y: 180 }), null, 'void nodes cannot produce mouse hits');
  equal(renderer.hitTest({ x: 320, y: 180 }, 'touch'), null, 'void nodes cannot produce touch hits');
  frames.set({ ...RESOLVED_FRAME_STYLE, regions: [], edges: [], nodes: [voidNode,
    { id: 'visible', label: 'visible', position: { x: 0, y: 0, z: 0 }, radius: 4, ...RESOLVED_NODE_STYLE }] });
  equal(renderer.hitTest({ x: 320, y: 180 })?.nodeId, 'visible', 'a nearer void node cannot intercept a visible node');
  renderer.dispose();
});

test('Canvas viewport clipping preserves offscreen-center discs and exact circle misses', () => {
  const value = runtimeHarness();
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({ ...RESOLVED_FRAME_STYLE, regions: [], edges: [], nodes: [
    { id: 'edge', label: 'edge', position: camera.screenToWorld(-20, 180, 100), radius: 24, ...RESOLVED_NODE_STYLE },
  ] });
  const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  equal(renderer.hitTest({ x: 0, y: 180 })?.nodeId, 'edge', 'the visible sliver of an offscreen-center disc remains pickable');
  equal(renderer.hitTest({ x: 0, y: 180 }, 'touch')?.nodeId, 'edge', 'touch retains the same visible sliver');
  equal(renderer.hitTest({ x: 0, y: 200 }), null, 'being in its bounding box does not replace the exact circle check');
  renderer.resize(64, 32, 1);
  camera.setViewport(64, 32);
  renderer.render();
  assert(renderer.getDiagnostics().hitGridCells <= 6, 'resizing updates the picking bounds');
  renderer.dispose();
});
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, { nodeWorldScaleBlend: 0.5 });
  const midpoint = anima.contributeFrame(state);
  equal(midpoint?.nodeContributions?.small.nodeScaleExponent, 0.5,
    'the smallest node should retain the gentle response');
  equal(midpoint?.nodeContributions?.large.nodeScaleExponent, 2,
    'the largest node should receive the former maximum response despite saved midpoint tuning');
  equal(midpoint?.presentationPolicy?.nodeScaleExponent, 0.5,
    'nodes without a usable size range should retain the gentle fallback');
  anima.updateSettings({ nodeWorldScaleBlend: 0 });
  const maximum = anima.contributeFrame(state);
  equal(maximum?.nodeContributions?.small.nodeScaleExponent, 0.5,
    'maximum contrast should still keep the smallest node restrained');
  equal(maximum?.nodeContributions?.large.nodeScaleExponent, 2,
    'saved zero contrast must not reduce the baked-in maximum effect');
});

test('Anima separates undimmed overview hover from tagged Explore presentation', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b'), graphNode('c'), graphNode('d')],
    edges: [graphEdge('a-b', 'a', 'b'), graphEdge('b-c', 'b', 'c'), graphEdge('a-d', 'a', 'd')],
  });
  const selection = { nodeIds: new Set(['a', 'b', 'c', 'd']), edgeIds: new Set(['a-b', 'b-c', 'a-d']) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const overviewHover = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'b',
  });
  assert(overviewHover?.nodeContributions && overviewHover.edgeContributions,
    'overview hover should produce node and edge presentation');
  equal(overviewHover.nodeContributions.a.opacity, 1, 'preview includes destination hover neighbors');
  equal(overviewHover.nodeContributions.d.opacity, 0.24, 'the destination View dims unrelated context');
  deepEqual(overviewHover.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.node,
    'destination hover neighbors retain standard color');
  deepEqual(overviewHover.nodeContributions.b.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'overview hover should light the hovered node');
  equal(overviewHover.nodeContributions.b.labelForceVisible, true,
    'overview hover should force the hovered node label');
  equal(overviewHover.nodeContributions.c.labelAlwaysVisible, false,
    'overview hover should leave a neighboring node under adaptive saliency');
  equal(overviewHover.nodeContributions.c.labelSaliencyBoost, 0.5,
    'destination hover favors adaptive neighbor labels');
  equal(overviewHover.edgeContributions['a-d'].opacity, 0.6, 'unrelated links follow prospective Constellation context');
  equal(overviewHover.edgeContributions['a-b'].opacity, 1,
    'destination hover raises incident links');

  const taggedA = anima.contributeFrame({
    ...state,
    ...withConsciousness(state, ['a']),
  });
  assert(taggedA?.nodeContributions && taggedA.edgeContributions, 'Explore presentation should resolve tagged nodes');
  equal(taggedA.nodeContributions.a.opacity, 1, 'the tagged node should remain fully visible');
  equal(taggedA.nodeContributions.b.opacity, 0.24, 'Constellation should dim an unselected direct neighbor');
  equal(taggedA.nodeContributions.d.opacity, 0.24, 'Constellation should dim every unselected neighbor');
  equal(taggedA.nodeContributions.c.opacity, 0.24,
    'Constellation should keep an unrelated non-neighbor visible but dimmed');
  deepEqual(taggedA.nodeContributions.c.finalColor,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, 0.8),
    'an unrelated non-neighbor should retain a strongly desaturated form of its theme color');
  deepEqual(taggedA.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'the tagged node should light up');
  deepEqual(taggedA.nodeContributions.b.finalColor,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, 0.8),
    'an unselected direct neighbor should retain dim context presentation');
  equal(taggedA.edgeContributions['a-b'].opacity, 0.6,
    'a one-node Constellation should not light an unselected incident link');
  equal(taggedA.edgeContributions['a-d'].opacity, 0.6,
    'a one-node Constellation should leave every unselected incident link dimmed');
  deepEqual(taggedA.edgeContributions['a-d'].color,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.edge, 0.8),
    'a dimmed link should receive the same desaturation treatment as a dimmed node');
  equal(taggedA.edgeContributions['b-c'].opacity, 0.6,
    'Constellation should keep an unrelated non-neighbor link visible but dimmed');
  equal(taggedA.nodeContributions.b.showLabel, false,
    'an unselected dim neighbor should not receive a peripheral label');

  const taggedStructure = anima.contributeFrame({
    ...state,
    ...withConsciousness(state, ['a', 'b'], 'b'),
  });
  assert(taggedStructure?.edgeContributions, 'multi-tag presentation should include structural links');
  equal(taggedStructure.edgeContributions['a-b'].opacity, 1, 'a link between tagged nodes should remain bright');
  equal(taggedStructure.edgeContributions['b-c'].opacity, 0.6,
    'Focus should keep a connection to its non-constellation frontier dimmed');

  const exploredHover = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'c',
    ...withConsciousness(state, ['a']),
  });
  assert(exploredHover?.nodeContributions && exploredHover.edgeContributions,
    'hover should retain the scene phases while exposing the direct label');
  equal(exploredHover.nodeContributions.a.opacity, 1, 'members stay highlighted');
  equal(exploredHover.nodeContributions.c.opacity, 1, 'hover previews admission of the prospective subject');
  equal(exploredHover.nodeContributions.b.opacity, 1, 'the hover route is highlighted');
  equal(exploredHover.nodeContributions.d.opacity, 0.24, 'admission preview keeps unrelated Constellation context dimmed');
  equal(exploredHover.edgeContributions['a-b'].opacity, 1, 'route links are highlighted');
  equal(exploredHover.edgeContributions['b-c'].opacity, 1, 'the complete route is highlighted');
  equal(exploredHover.edgeContributions['a-d'].opacity, 0.6, 'links outside the route stay dimmed');
  equal(exploredHover.nodeContributions.c.labelForceVisible, true, 'the prospective subject label is readable');
  equal(exploredHover.nodeContributions.b.showLabel, true, 'highlighted route labels are readable');

  const hoveredTag = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'a',
    ...withConsciousness(state, ['a']),
  });
  assert(hoveredTag?.nodeContributions && hoveredTag.edgeContributions,
    'hovering a tagged node should retain its one-hop neighborhood');
  deepEqual(hoveredTag.nodeContributions.b.finalColor,
    DEFAULT_GRAPH_RENDER_THEME_V1.colors.node,
    'Focus preview includes the destination hover neighbor style');
  deepEqual(hoveredTag.nodeContributions.d.finalColor,
    DEFAULT_GRAPH_RENDER_THEME_V1.colors.node,
    'Focus destination hover makes immediate neighbors standard');
  equal(hoveredTag.nodeContributions.c.opacity, 0, 'committed member hover previews deliberate Focus entry');
  equal(hoveredTag.edgeContributions['a-b'].opacity, 1, 'Focus destination hover raises incident links');
  equal(hoveredTag.edgeContributions['a-d'].opacity, 1, 'each incident frontier link uses destination hover');
  equal(hoveredTag.nodeContributions.a.labelForceVisible, true,
    'hovering a tagged node should force only its own label');
  equal(hoveredTag.nodeContributions.b.labelForceVisible, false,
    'a lit direct neighbor should not receive the hover label override');
  equal(hoveredTag.nodeContributions.b.labelAlwaysVisible, false,
    'a direct hover neighbor should not bypass adaptive collision policy');
  equal(hoveredTag.nodeContributions.b.showLabel, true,
    'a destination hover neighbor remains label eligible');

  const suspended = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'c',
    selectionPresentationSuspended: true,
    ...withConsciousness(state, ['a', 'b']),
  });
  assert(suspended?.nodeContributions, 'a Space-toggled undimmed view should contribute presentation');
  equal(suspended.nodeContributions.c.opacity, 1, 'Space preserves the object activation preview');
  deepEqual(suspended.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'tagged nodes should remain lit while selection presentation is suspended');
  deepEqual(suspended.nodeContributions.c.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'Space does not suppress prospective subject highlighting');

  const optionRevealed = anima.contributeFrame({
    ...state,
    selectionNeighborRevealActive: true,
    ...withConsciousness(state, ['a']),
  });
  assert(optionRevealed?.nodeContributions && optionRevealed.edgeContributions,
    'Option should not override constellation-only presentation');
  equal(optionRevealed.nodeContributions.b.opacity, 0.24,
    'the ordinary Constellation should dim an unselected direct neighbor');
  equal(optionRevealed.nodeContributions.d.opacity, 0.24,
    'the ordinary Constellation should dim every unselected direct neighbor');
  equal(optionRevealed.nodeContributions.c.opacity, 0.24, 'Option should leave non-neighbors dimmed');
  equal(optionRevealed.edgeContributions['a-b'].opacity, 0.6,
    'the ordinary Constellation should dim a selected-to-unselected link');
  equal(optionRevealed.edgeContributions['a-d'].opacity, 0.6,
    'the ordinary Constellation should dim every selected-to-unselected link');
  equal(optionRevealed.edgeContributions['b-c'].opacity, 0.6,
    'Option should leave links outside the revealed neighborhood dimmed');
  deepEqual(optionRevealed.nodeContributions.b.finalColor,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, 0.8),
    'the ordinary Constellation should not highlight an unselected neighbor');
  equal(optionRevealed.nodeContributions.b.labelForceVisible, hoveredTag.nodeContributions.b.labelForceVisible,
    'Option should match hover label behavior instead of forcing every neighbor label visible');
  const updatedOptionReveal = anima.contributeFrame({
    ...state,
    selectionNeighborRevealActive: true,
    ...withConsciousness(state, ['c']),
  });
  assert(updatedOptionReveal?.nodeContributions, 'Option reveal should recompute with selection edits');
  equal(updatedOptionReveal.nodeContributions.b.opacity, 0.24,
    'the updated selection should continue dimming its unselected neighbor');
  equal(updatedOptionReveal.nodeContributions.d.opacity, 0.24,
    'neighbors of the old selection should dim when no longer adjacent');

  const exploredPreview = anima.contributeFrame({
    ...state,
    previewedNodeId: 'c',
    ...withConsciousness(state, ['a']),
  });
  assert(exploredPreview?.nodeContributions && exploredPreview.edgeContributions,
    'Explore preview should contribute constellation presentation');
  equal(exploredPreview.nodeContributions.c.opacity, 0.24,
    'previewing a nonmember should leave it dimmed');
  deepEqual(exploredPreview.nodeContributions.c.finalColor,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, 0.8),
    'previewing a nonmember should not give it the selection highlight');
  equal(exploredPreview.edgeContributions['b-c'].opacity, 0.6,
    'previewing a nonmember should leave its links dimmed');

  const previewedA = anima.contributeFrame({
    ...state,
    previewedNodeId: 'a',
    ...withConsciousness(state, ['c'], 'c'),
  });
  assert(previewedA?.edgeContributions, 'semantic preview should produce Anima presentation');
  equal(previewedA.edgeContributions['a-b'].opacity, 0,
    'Focus should hide links outside the focused neighborhood');
  equal(previewedA.nodeContributions?.b.opacity, 0.24,
    'a focused frontier neighbor should remain dimmed');
  deepEqual(previewedA.nodeContributions?.b.finalColor,
    desaturateGraphColorV2(DEFAULT_GRAPH_RENDER_THEME_V1.colors.node, 0.8),
    'a focused frontier neighbor should use dimmed theme presentation');
  equal(previewedA.edgeContributions['b-c'].opacity, 0.6,
    'a focused-to-frontier link should remain dimmed');
  equal(previewedA.edgeContributions['a-d'].opacity, 0,
    'Focus should ignore unrelated preview links outside its local rendering scope');

  const hoveredFocusedNeighbor = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'b',
    ...withConsciousness(state, ['a'], 'a'),
    consciousness: resolveConsciousness({
      attentionNodeIds: ['a'],
      availableNodeIds: state.renderSelection.nodeIds,
      peripheralAwarenessNodeIds: ['b', 'd'],
    }),
  });
  assert(hoveredFocusedNeighbor?.nodeContributions && hoveredFocusedNeighbor.edgeContributions,
    'hovering a non-root node in Focus should contribute an isolated root-to-node presentation');
  equal(hoveredFocusedNeighbor.nodeContributions.a.opacity, 1,
    'the focused root should remain fully visible while a neighbor is hovered');
  equal(hoveredFocusedNeighbor.nodeContributions.b.opacity, 1,
    'the prospective subject is highlighted');
  equal(hoveredFocusedNeighbor.nodeContributions.d.opacity, 0,
    'explicit Focus-hop preview voids previous-subject-only context');
  equal(hoveredFocusedNeighbor.nodeContributions.d.showLabel, false,
    'a dimmed non-hovered focus neighbor should not retain its Awareness-raised label');
  equal(hoveredFocusedNeighbor.nodeContributions.d.labelOpacity, 0,
    'a dimmed non-hovered focus neighbor label should be fully transparent');
  equal(hoveredFocusedNeighbor.nodeContributions.c.opacity, 1,
    'Focus preview includes the prospective subject hover neighbors');
  equal(hoveredFocusedNeighbor.nodeContributions.c.showLabel, true,
    'a standard destination hover neighbor remains label eligible');
  equal(hoveredFocusedNeighbor.nodeContributions.c.labelForceVisible, false,
    'hover neighbors remain under adaptive label policy');
  equal(hoveredFocusedNeighbor.nodeContributions.c.labelAlwaysVisible, false,
    'hover neighbors do not bypass collision budgets');
  equal(hoveredFocusedNeighbor.edgeContributions['a-b'].opacity, 1,
    'the prospective member connection is highlighted');
  deepEqual(hoveredFocusedNeighbor.edgeContributions['a-b'].color,
    DEFAULT_GRAPH_RENDER_THEME_V1.colors.highlightedNode,
    'the prospective member connection is highlighted');
  equal(hoveredFocusedNeighbor.edgeContributions['a-d'].opacity, 0,
    'explicit View preview voids old subject-only context links');
  equal(hoveredFocusedNeighbor.edgeContributions['b-c'].opacity, 1,
    'Focus destination hover raises the prospective subject incident link');

  const cleared = anima.contributeFrame(state);
  assert(cleared?.edgeContributions, 'cleared focus should still resolve baseline edge presentation');
  equal(cleared.edgeContributions['a-b'].opacity, 1, 'clearing focus should restore ordinary link opacity');
  equal(cleared.edgeContributions['b-c'].opacity, 1, 'no prior focus highlight should remain latched');
  equal(cleared.edgeContributions['a-d'].opacity, 1, 'clearing focus should restore every ordinary link');
});

test('V2 adaptive labels remain continuously eligible and accept interaction requests', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b'), graphNode('c')],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const selection = { nodeIds: new Set(['a', 'b', 'c']), edgeIds: new Set(['a-b']) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const adaptive = anima.contributeFrame({
    ...state,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'adaptive' },
    ...withConsciousness(state, ['a'], 'a'),
  });
  assert(adaptive?.nodeContributions, 'tagged adaptive presentation should contribute nodes');
  equal(adaptive.nodeContributions.a.showLabel, true, 'the tagged node label should remain eligible');
  equal(adaptive.nodeContributions.a.labelForceVisible, true,
    'highlighted Focus membership should always show its label');
  equal(adaptive.nodeContributions.b.showLabel, false,
    'a dimmed Focus neighbor should suppress its label');
  equal(adaptive.nodeContributions.b.labelForceVisible, false,
    'a standard Focus neighbor should not bypass the adaptive label policy');
  equal(adaptive.nodeContributions.b.labelOpacity, 0,
    'a dimmed Focus neighbor label should be fully transparent');
  equal(adaptive.nodeContributions.c.showLabel, false,
    'Focus should suppress labels outside the local node, its neighbors, and the constellation');
  equal(adaptive.nodeContributions.c.labelOpacity, 0,
    'hidden Focus labels should be fully transparent');

  const inspected = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'b',
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'adaptive' },
    ...withConsciousness(state, ['a'], 'a'),
  });
  equal(inspected?.nodeContributions?.b.showLabel, true,
    'hover should force label eligibility in Explore mode');
  equal(inspected?.nodeContributions?.b.labelOpacity, 1,
    'hover should force full label opacity in Explore mode');
  equal(inspected?.nodeContributions?.b.labelForceVisible, true,
    'hover should mark its label as the explicit graph-wide mode override');

  const all = anima.contributeFrame({
    ...state,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all' },
    ...withConsciousness(state, ['a'], 'a'),
  });
  equal(all?.nodeContributions?.c.showLabel, false,
    'Focus rendering scope should remain authoritative even when label mode is All');
});

test('V1.6 Anima owns live above and below label placement', () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const state = pipeline(document, { nodeIds: new Set(['a']), edgeIds: new Set() });
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, { labelPosition: 'above' });
  equal(anima.contributeFrame(state)?.presentationPolicy?.labelPosition, 'above',
    'Anima should publish the configured above placement');
  anima.updateSettings({ labelPosition: 'below' });
  equal(anima.contributeFrame(state)?.presentationPolicy?.labelPosition, 'below',
    'Anima should update label placement without remounting');
});

test('V1.6 Anima labels retain their CSS size across orthographic zoom', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 10 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 0.25,
    projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [{
      id: 'hub', label: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 24,
      ...RESOLVED_NODE_STYLE, labelFontSize: 20,
    }],
    ...RESOLVED_FRAME_STYLE,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      labelMode: 'all',
      labelScaleMode: 'fixed',
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  assert(value.styleAssignments.includes('font:20px sans-serif'),
    'zoomed-out 2D should keep the resolved label font size');

  value.styleAssignments.length = 0;
  camera.setState({ ...camera.getState(), zoom: 4 });
  renderer.render();
  assert(value.styleAssignments.includes('font:20px sans-serif'),
    'zoomed-in 2D should keep the same resolved label font size');
});

test('hover-forced labels are the only labels rendered while label mode is off', () => {
  const fillTextY: number[] = [];
  const context = recordingContext(fillTextY);
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [], ...RESOLVED_FRAME_STYLE,
    nodes: [
      {
        id: 'hovered', label: 'hovered', position: { x: -40, y: 0, z: 0 }, radius: 8,
        ...RESOLVED_NODE_STYLE, labelStatePriority: 2, showLabel: true, labelForceVisible: true,
      },
      {
        id: 'ordinary', label: 'ordinary', position: { x: 40, y: 0, z: 0 }, radius: 8,
        ...RESOLVED_NODE_STYLE, showLabel: true,
      },
    ],
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'off' },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  equal(fillTextY.length, 1, 'label mode off should retain only the explicit hover label override');
});

test('node scaling supports calm, world, and exaggerated responses in 2D and 3D', () => {
  const arcRadii: number[] = [];
  const context = recordingContext([], arcRadii);
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 4, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  const node = {
    id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 10,
    ...RESOLVED_NODE_STYLE,
  };
  const renderAt = (exponent: number): number => {
    arcRadii.length = 0;
    frames.set({
      regions: [], edges: [], nodes: [node], ...RESOLVED_FRAME_STYLE,
      policy: {
        ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
        nodeScaleMode: 'sqrt-orthographic',
        nodeScaleExponent: exponent,
      },
    });
    renderer.render();
    return arcRadii[0];
  };
  equal(renderAt(0.5), 20, 'the low end should use the square root of zoom');
  equal(renderAt(1), 40, 'the first third should pass through true world-space scaling');
  equal(renderAt(2), 160, 'the high end should grow substantially beyond world-space size');
  arcRadii.length = 0;
  frames.set({
    regions: [], edges: [], nodes: [{ ...node, nodeScaleExponent: 2 }], ...RESOLVED_FRAME_STYLE,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, nodeScaleExponent: 0.5 },
  });
  renderer.render();
  equal(arcRadii[0], 160, 'a node-specific response should override the graph-wide fallback');

  const perspectiveCamera = new GraphCameraController({
    position: { x: 0, y: 0, z: 50 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 50 / 24, projection: 'perspective',
  }, '3d');
  perspectiveCamera.setViewport(640, 360);
  const perspectiveFrames = new GraphFrameStore();
  const perspectiveRenderer = new CanvasGraphRenderer(canvas, perspectiveCamera, perspectiveFrames, () => 0);
  perspectiveRenderer.resize(640, 360, 1);
  const renderPerspectiveAt = (exponent: number): number => {
    arcRadii.length = 0;
    perspectiveFrames.set({
      regions: [], edges: [], nodes: [node], ...RESOLVED_FRAME_STYLE,
      policy: {
        ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
        nodeScaleExponent: exponent,
        minimumPerspectiveNodeRadius: 0,
        minimumPerspectiveNodeScale: 0,
      },
    });
    perspectiveRenderer.render();
    return arcRadii[0];
  };
  assert(Math.abs(renderPerspectiveAt(0.5) - 10 * Math.sqrt(2)) < 1e-10,
    'the gentle response should apply to perspective depth');
  equal(renderPerspectiveAt(1), 20, 'world response should remain linear in perspective');
  equal(renderPerspectiveAt(2), 40, 'the exaggerated response should also apply in 3D');
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
    ...RESOLVED_NODE_STYLE,
  };
  frames.set({
    regions: [], edges: [], nodes: [node],
    ...RESOLVED_FRAME_STYLE,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all', labelPosition: 'below' },
  });
  renderer.render();
  equal(fillTextY.pop(), 192, 'below should begin four pixels beneath the eight-pixel node');
  frames.set({
    regions: [], edges: [], nodes: [node],
    ...RESOLVED_FRAME_STYLE,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all', labelPosition: 'above' },
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
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, edgeAggregation: 'unordered-pair', showArrows: true },
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
      a: {
        finalColor: parseGraphColorV2('#123456'), labelOffset: { x: 3, y: -4 },
        labelForceVisible: true, nodeScaleExponent: 1.75,
      },
    },
    edgeContributions: {
      'a-b': {
        arrowAtSource: true, arrowAtTarget: false,
        arrowColor: parseGraphColorV2('#abcdef'), arrowOpacity: 0.4,
      },
    },
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, showArrows: true },
  });
  deepEqual(frame.nodes[0].finalColor, parseGraphColorV2('#123456'), 'Anima final fill should reach the render frame');
  deepEqual(frame.nodes[0].labelOffset, { x: 3, y: -4 }, 'label offsets should survive composition');
  equal(frame.nodes[0].labelForceVisible, true, 'the interaction label override should survive composition');
  equal(frame.nodes[0].nodeScaleExponent, 1.75, 'per-node zoom response should survive composition');
  equal(frame.edges[0].arrowAtSource, true, 'Anima should be able to show a source arrow');
  equal(frame.edges[0].arrowAtTarget, false, 'Anima should be able to suppress a canonical target arrow');
  deepEqual(frame.edges[0].arrowColor, parseGraphColorV2('#abcdef'), 'arrow color should be independent from shaft color');
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
  deepEqual(palette.colors.node, parseGraphColorV2('rgba(10, 20, 30, 0.5)'), 'native node opacity should be folded into its resolved color');
  deepEqual(palette.colors.tagNode, parseGraphColorV2('rgb(190, 200, 210)'), 'nested graph CSS variables should resolve before reaching Anima');
  deepEqual(palette.colors.edge, parseGraphColorV2('rgb(40, 50, 60)'), 'native line role should outrank generic fallbacks');
  deepEqual(palette.colors.label, parseGraphColorV2('rgb(70, 80, 90)'), 'native text role should be sampled');
  deepEqual(palette.colors.arrow, parseGraphColorV2('rgb(100, 110, 120)'), 'native arrow role should be sampled separately');
  deepEqual(palette.colors.highlightedNode, parseGraphColorV2('rgb(130, 140, 150)'), 'native focus role should drive interaction highlighting');
  deepEqual(palette.colors.nodeOutline, parseGraphColorV2('rgb(160, 170, 180)'), 'native circle role should drive outlines');
});

test('V2 default Obsidian theme uses the Graph+ kosmos palette without affecting community themes', () => {
  const value = runtimeHarness();
  value.document.body.style.color = 'rgb(220, 220, 220)';
  value.document.body.style.backgroundColor = 'rgb(30, 30, 30)';

  const defaultPalette = new ThemeStyleResolver(() => value.document.body, () => true).getPalette(7);
  equal(defaultPalette.revision, 7, 'the hard-coded default-theme palette should retain the requested revision');
  deepEqual(defaultPalette.colors, DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2.colors,
    'the stock Obsidian theme should use the restrained Graph+ kosmos colors');
  deepEqual(defaultPalette.colors.background, parseGraphColorV2('#0b0810'), 'the default graph field should be near-black');
  deepEqual(defaultPalette.colors.node, parseGraphColorV2('#4b3562'), 'ordinary nodes should be dark plum');
  deepEqual(defaultPalette.colors.tagNode, parseGraphColorV2('#e1d7eb'), 'tag nodes should be pale lavender-white');

  const style = value.document.createElement('style');
  style.textContent = '.graph-view.color-fill { color: rgb(12, 34, 56); }';
  value.document.head.append(style);
  const communityPalette = new ThemeStyleResolver(() => value.document.body, () => false).getPalette();
  deepEqual(communityPalette.colors.node, parseGraphColorV2('rgb(12, 34, 56)'),
    'a selected community theme should continue to own its graph node color');
});

test('Graph+ resolves its canvas background from the shared presentation surface color', () => {
  const value = runtimeHarness();
  value.document.body.style.setProperty('--graph-plus-surface-background', '#0f0f0f');

  const defaultPalette = new ThemeStyleResolver(
    () => value.document.body,
    () => true,
  ).getPalette();
  deepEqual(defaultPalette.colors.background, parseGraphColorV2('#0f0f0f'),
    'the Graph+ surface should replace the stock graph field with its exact background');

  const communityPalette = new ThemeStyleResolver(
    () => value.document.body,
    () => false,
  ).getPalette();
  deepEqual(communityPalette.colors.background, parseGraphColorV2('#0f0f0f'),
    'the Graph+ surface should replace a community graph field with its exact background');
});

test('Graph+ color overrides layer over the active Obsidian palette', () => {
  const value = runtimeHarness();
  value.document.body.style.backgroundColor = 'rgb(30, 30, 30)';
  const palette = new ThemeStyleResolver(
    () => value.document.body,
    () => true,
    () => ({ background: '#102030', noteNode: '#405060', tagNode: '#708090' }),
  ).getPalette();
  deepEqual(palette.colors.background, parseGraphColorV2('#102030'), 'background override should replace the resolved theme field');
  deepEqual(palette.colors.node, parseGraphColorV2('#405060'), 'note override should replace the ordinary node role');
  deepEqual(palette.colors.tagNode, parseGraphColorV2('#708090'), 'tag override should replace the tag node role');
  deepEqual(palette.colors.edge, DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2.colors.edge,
    'unoverridden theme roles should retain their resolved palette values');
});

test('Frank mode forces the semantic palette to pure red and green', () => {
  const value = runtimeHarness();
  const palette = new ThemeStyleResolver(
    () => value.document.body,
    () => true,
    () => ({ background: '#102030', noteNode: '#405060', tagNode: '#708090' }),
    () => true,
  ).getPalette(11);
  const frankColors = new Set(Object.values(palette.colors).map((color) =>
    `${color.r},${color.g},${color.b},${color.a}`));
  deepEqual([...frankColors].sort(), ['0,1,0,1', '1,0,0,1'],
    'Frank mode should override both Obsidian and user colors with only red and green');
  equal(palette.revision, 11, 'Frank mode should retain normal theme revision behavior');
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
    nodes: [
      {
        id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 8,
        ...RESOLVED_NODE_STYLE,
      },
      {
        id: 'hub', label: 'hub', position: { x: 1_000, y: 0, z: 0 }, radius: 24,
        ...RESOLVED_NODE_STYLE,
      },
    ],
    ...RESOLVED_FRAME_STYLE,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      minimumPerspectiveNodeRadius: 4,
      minimumPerspectiveNodeScale: 0.5,
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
  const radii = value.drawArguments
    .filter((call) => call.method === 'arc')
    .map((call) => call.args[2]);
  assert(radii.includes(4), 'a minimum-size node should retain the four-pixel base floor');
  assert(radii.includes(12), 'a hub should retain its degree-relative radius at long range');
});

test('V1.6 adaptive labels prefer nearer labels after semantic and structural priority', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 5_000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  }, '3d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [
      {
        id: 'z-hub', label: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 24,
        ...RESOLVED_NODE_STYLE, labelFontSize: 14,
        labelOffset: { x: 0, y: -8 },
      },
      {
        id: 'a-leaf', label: 'leaf', position: { x: 0, y: 0, z: 4_500 }, radius: 8,
        ...RESOLVED_NODE_STYLE, labelFontSize: 14,
      },
    ],
    ...RESOLVED_FRAME_STYLE,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      labelMode: 'adaptive',
      labelPosition: 'below',
      minimumPerspectiveNodeRadius: 4,
      minimumPerspectiveNodeScale: 0.5,
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  deepEqual(value.drawArguments
    .filter((call) => call.method === 'fillText')
    .map((call) => call.args[0]), ['leaf'],
  'perspective proximity should resolve label collisions after explicit priorities tie');
});

test('adaptive labels hide nodes and label bounds occluded by nearer node discs', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1_000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
    projection: 'orthographic',
  }, '3d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [
      {
        id: 'far', label: 'far', position: { x: 0, y: 0, z: 0 }, radius: 8,
        ...RESOLVED_NODE_STYLE,
      },
      {
        id: 'near', label: 'near', position: { x: 0, y: 0, z: 500 }, radius: 8,
        ...RESOLVED_NODE_STYLE,
      },
      {
        id: 'far-bounds', label: 'far-boundary-label', position: { x: 100, y: 0, z: 0 }, radius: 8,
        ...RESOLVED_NODE_STYLE,
      },
      {
        id: 'near-blocker', label: 'near-blocker', position: { x: 100, y: 18, z: 500 }, radius: 8,
        ...RESOLVED_NODE_STYLE, showLabel: false,
      },
    ],
    ...RESOLVED_FRAME_STYLE,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'adaptive' },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  deepEqual(value.drawArguments
    .filter((call) => call.method === 'fillText')
    .map((call) => call.args[0]), ['near'],
  'a farther node should not project its anchor or label bounds through nearer discs');
});

test('V1.6 adaptive label budget follows camera range and per-node Saliency', () => {
  const renderAtDistance = (distance: number, saliency = 50, boost = 0): number => {
    const value = runtimeHarness();
    const canvas = value.document.createElement('canvas');
    const camera = new GraphCameraController({
      position: { x: 0, y: 0, z: distance },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 50 / 24,
      projection: 'perspective',
    }, '3d');
    camera.setViewport(640, 360);
    const coordinateScale = 360 * (50 / 24) / distance;
    const frames = new GraphFrameStore();
    frames.set({
      regions: [], edges: [],
      nodes: Array.from({ length: 30 }, (_, index) => ({
        id: `node-${index}`,
        label: `${index}`,
        position: {
          x: ((index % 5) - 2) * 50 / coordinateScale,
          y: (Math.floor(index / 5) - 2.5) * 40 / coordinateScale,
          z: 0,
        },
        radius: 8,
        ...RESOLVED_NODE_STYLE,
        labelFontSize: 10,
        labelSaliencyBoost: boost,
      })),
      ...RESOLVED_FRAME_STYLE,
      policy: {
        ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
        labelMode: 'adaptive',
        labelPosition: 'below',
        adaptiveLabelSaliency: saliency,
        minimumPerspectiveNodeRadius: 4,
        minimumPerspectiveNodeScale: 0.5,
      },
    });
    const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
    renderer.resize(640, 360, 1);
    renderer.render();
    return value.drawArguments.filter((call) => call.method === 'fillText').length;
  };

  const far = renderAtDistance(5_000);
  const near = renderAtDistance(100);
  const stricter = renderAtDistance(100, 100);
  const favored = renderAtDistance(100, 100, 0.5);
  equal(far, 6, 'the stricter midpoint halves the distant automatic label floor');
  equal(renderAtDistance(5_000, 0), 12, 'the low slider end starts at the former midpoint budget');
  equal(renderAtDistance(5_000, 100), 3, 'the strict slider end can show fewer than the former minimum');
  assert(near > far, 'dollying closer should reveal additional adaptive labels');
  assert(stricter < near, 'raising Saliency should reduce peripheral labels at the same camera range');
  assert(favored > stricter,
    'a 50% per-node Saliency boost should reveal more labels without forcing them past collision policy');
});

test('V1.7 D3-compatible integration advances at most once after a delayed frame', () => {
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
  const delayed = one.tick(initial, 1 / 30);
  assert(delayed?.positions, 'a delayed frame should still advance one fixed simulation step');
  const ordinary = two.tick(initial, 1 / 60);
  assert(ordinary?.positions, 'an ordinary 60Hz frame should advance one fixed simulation step');
  deepEqual(delayed.positions, ordinary.positions,
    'a delayed callback must discard catch-up backlog instead of bursting through multiple simulation steps');
});

test('V2 force integration uses a fixed gain independent of activity', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0,
    centeringStrength: 0, collisionRadius: 0, springStrength: 1, springLength: 250,
    velocityDecay: 0.4,
  }));
  const initial = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const result = force.tick(initial, 1 / 60);
  assert(result?.positions, 'one fixed tick should move the linked nodes');
  const expectedMovement = ((400 - 250) * 0.6 * 0.5) * 0.6;
  assert(Math.abs(result.positions.left.x - (-200 + expectedMovement)) < 1e-10,
    'source movement should match the fixed integration gain followed by velocity decay');
  assert(Math.abs(result.positions.right.x - (200 - expectedMovement)) < 1e-10,
    'target movement should mirror the fixed-gain link step');
});

test('high link strength converges without crossing its target in one integration step', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, centeringStrength: 0, collisionRadius: 0,
    springStrength: 4, springLength: 250, velocityDecay: 0.4,
  }));
  const result = force.tick(pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  }), 1 / 60);
  assert(result?.positions, 'a high-strength spring should still advance the layout');
  const distance = Math.abs(result.positions.right.x - result.positions.left.x);
  assert(distance >= 250,
    'a high-strength spring must not overshoot through its target distance in one step');
  assert(distance < 400, 'a high-strength spring should still move monotonically toward its target');
});

test('active drag activity is constant and independent of incident link strength', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const state = {
    ...pipeline(document, {
      nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
    }),
    draggedNodeId: 'left',
  };
  const baseSettings = {
    repulsionStrength: 0, centeringStrength: 0, collisionRadius: 0,
    springLength: 250, velocityDecay: 0.4,
  };
  const ordinary = new ForceLayoutModule('2d', readForceSettings({ ...baseSettings, springStrength: 1 }));
  const strong = new ForceLayoutModule('2d', readForceSettings({ ...baseSettings, springStrength: 5 }));
  ordinary.tick(state, 1 / 60);
  strong.tick(state, 1 / 60);
  const ordinaryAlpha = ordinary.getDiagnostics().alpha;
  const strongAlpha = strong.getDiagnostics().alpha;
  assert(Math.abs(ordinaryAlpha - 1) < 1e-12,
    'ordinary incident links should use the configured drag activity');
  assert(Math.abs(strongAlpha - ordinaryAlpha) < 1e-12,
    'link strength must not influence drag activity');
});

test('activity under-relaxes the whole integration step without changing its destination', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const settings = readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0, centeringStrength: 0,
    collisionRadius: 0, springStrength: 1, springLength: 250, velocityDecay: 0.4,
    alphaDecay: 0,
  });
  const hot = new ForceLayoutModule('2d', settings);
  const cool = new ForceLayoutModule('2d', settings);
  const restored = (alpha: number) => ({
    schemaVersion: 1,
    alpha,
    alphaTarget: 0,
    running: true,
    velocities: {},
  });
  hot.restoreState(restored(1));
  cool.restoreState(restored(0.5));
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const hotResult = hot.tick(state, 1 / 60);
  const coolResult = cool.tick(state, 1 / 60);
  assert(hotResult?.positions && coolResult?.positions, 'both activity levels should advance one step');
  const startX = state.positions.left.x;
  const hotMovement = hotResult.positions.left.x - startX;
  const coolMovement = coolResult.positions.left.x - startX;
  assert(Math.abs(coolMovement - hotMovement * 0.5) < 1e-10,
    'half activity should apply exactly half of the ordinary integration step');
  equal(hot.getDiagnostics().targetStepRateHz, 30, 'hot integration should run at 30 Hz');
  equal(cool.getDiagnostics().targetStepRateHz, 30, 'cool integration should retain the smooth 30 Hz cadence');
  equal(cool.getDiagnostics().effectiveStepRateHz, 15,
    'half activity should report half the effective simulation rate');
});

test('activity is capped at one and linearly freezes over five seconds', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0,
    collisionRadius: 0, velocityDecay: 0, alphaDecay: 0.2, alphaMin: 0.001,
  }));
  force.restoreState({
    schemaVersion: 1,
    alpha: 4,
    alphaTarget: 4,
    running: true,
    velocities: {
      left: { x: 1, y: 0, z: 0 },
      right: { x: -1, y: 0, z: 0 },
    },
  });
  let state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(),
  });
  equal(force.getDiagnostics().alpha, 1, 'restored activity must be capped at one');
  for (let step = 0; step < 75; step += 1) {
    const result = force.tick(state, 1 / 30);
    if (result?.positions) state = { ...state, positions: result.positions };
  }
  assert(Math.abs(force.getDiagnostics().alpha - 0.5) < 1e-10,
    'default cooling should reach half speed after two and a half seconds');
  for (let step = 0; step < 75; step += 1) {
    const result = force.tick(state, 1 / 30);
    if (result?.positions) state = { ...state, positions: result.positions };
  }
  equal(force.getDiagnostics().alpha, 0, 'default cooling should freeze after five seconds');
  equal(force.getDiagnostics().running, false, 'a frozen layout should become inactive');
  equal(force.getDiagnostics().targetStepRateHz, 0, 'a frozen layout should request no physics work');
});

test('a motionless layout settles even when its activity timer does not decay', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0,
    collisionRadius: 0, alphaDecay: 0,
  }));
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(),
  });
  for (let index = 0; index < 12; index += 1) force.tick(state, 1 / 60);
  const settled = force.exportState() as { readonly alpha: number; readonly running: boolean };
  equal(settled.running, false, 'sustained negligible movement should stop the solver');
  equal(settled.alpha, 0, 'settlement should clear the activity timer');
});

test('link distance does not change disconnected-component packing', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -100, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 100, y: 0, z: 0 } }),
      graphNode('orphan', { positionHint: { x: 0, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right', 'orphan']), edgeIds: new Set(['join']),
  });
  const settings = {
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0.1,
    collisionRadius: 0, velocityDecay: 0.4,
  };
  const compact = new ForceLayoutModule('2d', readForceSettings({ ...settings, springLength: 20 }));
  const spacious = new ForceLayoutModule('2d', readForceSettings({ ...settings, springLength: 500 }));
  const compactResult = compact.tick(state, 1 / 60);
  const spaciousResult = spacious.tick(state, 1 / 60);
  assert(compactResult?.positions && spaciousResult?.positions,
    'component packing should move the disconnected orphan in both layouts');
  deepEqual(compactResult.positions.orphan, spaciousResult.positions.orphan,
    'an orphan packing target must be independent of linked-node distance');
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

test('V1.6 force integration rejects hostile restored motion and enforces maxSpeed', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const maxSpeed = 10;
  const force = new ForceLayoutModule('2d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0, centeringStrength: 0,
    collisionRadius: 0, springStrength: 1000, springLength: 1, maxSpeed,
  }));
  force.restoreState({
    schemaVersion: 1,
    alpha: 0,
    alphaTarget: 0,
    running: false,
    velocities: {
      left: { x: 1e42, y: 0, z: 0 },
      right: { x: -1e42, y: 0, z: 0 },
    },
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, 'rejected hostile motion should reheat from safe positions');
  const leftMovement = Math.hypot(
    result.positions.left.x - state.positions.left.x,
    result.positions.left.y - state.positions.left.y,
    result.positions.left.z - state.positions.left.z,
  );
  const rightMovement = Math.hypot(
    result.positions.right.x - state.positions.right.x,
    result.positions.right.y - state.positions.right.y,
    result.positions.right.z - state.positions.right.z,
  );
  assert(leftMovement <= maxSpeed + 1e-10 && rightMovement <= maxSpeed + 1e-10,
    'every integrated node movement should obey the configured maximum speed');
});

test('force cooling clears residual velocity before a later reheat', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 1, alphaMin: 0.001,
  }));
  force.restoreState({
    schemaVersion: 1,
    alpha: 0.0005,
    alphaTarget: 0,
    running: true,
    velocities: {
      left: { x: 100, y: 0, z: 0 },
      right: { x: -100, y: 0, z: 0 },
    },
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(),
  });
  force.tick(state, 1 / 60);
  const settled = force.exportState() as { readonly alpha: number; readonly running: boolean; readonly velocities: Record<string, unknown> };
  equal(settled.alpha, 0, 'cooling should end at zero alpha');
  equal(settled.running, false, 'cooling should stop the layout');
  deepEqual(settled.velocities, {}, 'a settled layout must not retain replayable momentum');

  force.onDocumentChanged();
  const reheated = force.tick(state, 1 / 60);
  assert(!reheated?.positions, 'a later reheat should start from rest instead of replaying old motion');
});

test('velocity-decay-only changes preserve a settled topology and do not reheat it', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const settings = {
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0.4, alphaDecay: 1, alphaMin: 0.001,
  };
  const force = new ForceLayoutModule('2d', readForceSettings(settings));
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  for (let step = 0; step < 12; step += 1) force.tick(state, 1 / 60);
  const topologyAnalysisCount = force.getDiagnostics().topologyAnalysisCount;
  force.updateSettings({ ...settings, velocityDecay: 0.8 });
  const afterUpdate = force.exportState() as { readonly alpha: number; readonly running: boolean };
  equal(afterUpdate.alpha, 0, 'changing velocity decay must not reheat a settled layout');
  equal(afterUpdate.running, false, 'changing velocity decay must keep a settled layout stopped');
  force.tick(state, 1 / 60);
  equal(force.getDiagnostics().topologyAnalysisCount, topologyAnalysisCount,
    'velocity decay must not invalidate topology-derived springs');
});

test('V1.7 axial spring flattens only the selected 3D coordinate and respects pins', () => {
  const document = graphDocument({
    nodes: [
      graphNode('pinned', { positionHint: { x: -40, y: 100, z: -30 } }),
      graphNode('free', { positionHint: { x: 50, y: 100, z: 40 } }),
    ],
    edges: [],
  });
  const baseState = pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  });
  const state = { ...baseState, viewState: { ...baseState.viewState, pinnedNodeIds: ['pinned'] } };
  const force = new ForceLayoutModule('3d', readForceSettings({
    repulsionStrength: 0,
    springStrength: 0,
    centeringStrength: 0,
    collisionRadius: 0,
    velocityDecay: 0,
    alphaDecay: 0,
    axialSpringAxis: 'y',
    axialSpringStiffness: 0.9,
  }));
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, 'active axial spring should advance layout');
  equal(result.positions.pinned.y, 100, 'explicit pins should remain authoritative');
  assert(Math.abs(result.positions.free.y) < 100, 'the selected coordinate should move toward zero');
  equal(result.positions.free.x, 50, 'flattening Y should preserve X without another force');
  equal(result.positions.free.z, 40, 'flattening Y should preserve Z without another force');

  const planar = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 0, axialSpringAxis: 'y', axialSpringStiffness: 0.9,
  }));
  const planarResult = planar.tick(pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  }), 1 / 60);
  const planarOff = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 0, axialSpringAxis: 'off', axialSpringStiffness: 0,
  })).tick(pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  }), 1 / 60);
  deepEqual(planarResult, planarOff, '2D axial settings should be behaviorally identical to Off');
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
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.adaptiveLabelThreshold2d, 65,
    'Graph+ should begin with the quieter 2D adaptive-label threshold');
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.adaptiveLabelThreshold3d, 50,
    'Graph+ should retain the accepted 3D adaptive-label threshold');
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

test('V1.6 keeps Canvas-like pan, Cmd-scroll navigation, and transient drag separate from explicit pins', async () => {
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
  value.platform.flushFrame(17);
  const panned = await session.exportViewState();
  equal(panned.camera.zoom, initial.camera.zoom, 'unmodified trackpad wheel should pan without zooming');
  assert(JSON.stringify(panned.camera.target) !== JSON.stringify(initial.camera.target), 'unmodified wheel should move the camera target');
  wheel(value, canvas, { deltaY: -30, metaKey: true });
  value.platform.flushFrame(34);
  const cmdScrolled = await session.exportViewState();
  equal(cmdScrolled.camera.zoom, panned.camera.zoom, 'Cmd-scroll should not zoom');
  assert(JSON.stringify(cmdScrolled.camera.target) !== JSON.stringify(panned.camera.target),
    'Cmd-scroll should follow ordinary wheel navigation');

  const camera = new GraphCameraController(cmdScrolled.camera, '2d');
  camera.setViewport(640, 360);
  const point = camera.worldToScreen(cmdScrolled.positions.a);
  pointer(value, canvas, 'pointerdown', point.x, point.y, 9);
  pointer(value, canvas, 'pointermove', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(51);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), false,
    'new-mode drag should use a transient kinematic constraint, not the persistent pin set');
  pointer(value, canvas, 'pointerup', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(68);
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

test('V1.6 a background finger tap exits focus into its constellation in 3D', async () => {
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
  await session.setSelection(['a']);
  await session.focusNode('a');
  equal((await session.exportViewState()).focusedNodeId, 'a', 'the fixture should begin focused');

  const canvas = runtimeCanvas(value.container);
  pointer(value, canvas, 'pointerdown', -100, -100, 31, 'touch');
  pointer(value, canvas, 'pointerup', -100, -100, 31, 'touch');
  value.platform.flushFrame(17);
  value.platform.flushTimer();
  value.platform.flushFrame(34);
  const cleared = await session.exportViewState();
  equal(cleared.focusedNodeId, undefined, 'a 3D background finger tap should release focus');
  deepEqual(cleared.selectedNodeIds, ['a'],
    'background release should retain the one-node constellation');
  await session.dispose();
});

function pipeline(
  document: ReturnType<typeof graphDocument>,
  selection: { nodeIds: Set<string>; edgeIds: Set<string> },
): GraphModulePresentationStateV1 {
  const state = viewState(document);
  return {
    sourceDocument: document,
    document,
    viewState: state,
    positions: state.positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    consciousness: resolveConsciousness({
      attentionNodeIds: state.selectedNodeIds,
      availableNodeIds: selection.nodeIds,
    }),
    nodeRoles: {},
    edgeRoles: {},
    regions: [],
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}

function withConsciousness(
  state: GraphModulePresentationStateV1,
  attentionNodeIds: readonly string[],
  focusedNodeId?: string,
): Pick<GraphModulePresentationStateV1, 'viewState' | 'consciousness'> {
  const { focusedNodeId: _priorFocus, ...withoutFocus } = state.viewState;
  const viewState = focusedNodeId === undefined
    ? { ...withoutFocus, selectedNodeIds: [...attentionNodeIds] }
    : { ...withoutFocus, selectedNodeIds: [...attentionNodeIds], focusedNodeId };
  return {
    viewState,
    consciousness: resolveConsciousness({
      attentionNodeIds,
      availableNodeIds: state.renderSelection.nodeIds,
    }),
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

function recordingContext(fillTextY: number[], arcRadii: number[] = []): CanvasRenderingContext2D {
  return {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    arc: (_x: number, _y: number, radius: number) => { arcRadii.push(radius); },
    fill: () => undefined,
    fillText: (_text: string, _x: number, y: number) => { fillTextY.push(y); },
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}
