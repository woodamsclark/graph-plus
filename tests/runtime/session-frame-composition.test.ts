import { GraphCameraController } from '../../src/graph-engine/runtime/index.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function compositionHarness(dimensions: '2d' | '3d', physics = false) {
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
    document: graphDocument({ nodes: ['a', 'b', 'c', 'outside'].map(id => graphNode(id)),
      edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')] }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: physics, settings: { alphaDecay: 0 } },
    anima: { settings: { cursorGravity: 'off' } },
  } });
  return { ...value, scene: () => scene!, diagnostics: () => value.factory.getDiagnostics().sessions[0]!,
    advance: (milliseconds = 20) => {
      value.platform.advanceTime(milliseconds); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
    },
  };
}

test('one display callback composes drag, physics and highlight fading once in every View', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    for (const viewMode of ['overview', 'explore', 'focus'] as const) {
      const value = compositionHarness(dimensions, true);
      const session = await value.create();
      try {
        const initial = await session.exportViewState();
        const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
        await session.restoreViewState({ ...initial, viewMode,
          selectedNodeIds: viewMode === 'overview' ? [] : ['a'], focusedNodeId: viewMode === 'focus' ? 'a' : undefined,
          // Keep projected hover targets stable while physics is admitted. The
          // dragged pin still changes through the actual pointer/drag path.
          pinnedNodeIds: ['a', 'b', 'c', 'outside'],
          positions: Object.fromEntries(['a', 'b', 'c', 'outside'].map((id, i) => [id, camera.screenToWorld(120 + i * 120, 180, 1000)])),
        });
        const restoredPosition = (await session.exportViewState()).positions.b;
        value.advance();
        const canvas = runtimeCanvas(value.container);
        const pointer = (type: string, x: number, buttons = 0) => {
          const fields = { clientX: x, clientY: 180, pointerId: 821, pointerType: 'mouse', button: 0, buttons };
          const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
          for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
          canvas.dispatchEvent(event as unknown as Event);
        };
        pointer('pointermove', 240); value.advance(); value.advance(450);
        const before = value.diagnostics();
        const forceBefore = before.modules['force-layout'] as { integrationStepCount: number };
        pointer('pointerdown', 240, 1);
        pointer('pointermove', 260, 1); pointer('pointermove', 280, 1);
        value.advance();
        const after = value.diagnostics();
        const forceAfter = after.modules['force-layout'] as { integrationStepCount: number };
        equal((after.counters?.frameCompositions ?? 0) - (before.counters?.frameCompositions ?? 0), 1,
          `${dimensions}/${viewMode}: drag and fade share one composition`);
        equal(forceAfter.integrationStepCount - forceBefore.integrationStepCount, 1, 'physics still admits one step');
        equal(after.compositionsThisFrame, 1, 'diagnostics expose the current callback count');
        equal(after.maxCompositionsPerFrame, 1, 'no previous callback exceeds the composition limit');
        assert(after.lastFrameInvalidations.includes('geometry') && after.lastFrameInvalidations.includes('presentation'),
          'diagnostics retain both geometry and presentation causes');
        const state = await session.exportViewState();
        deepEqual(value.scene().nodes.find(node => node.id === 'b')!.position, state.positions.b,
          'the composed scene contains the final committed drag position');
        assert(JSON.stringify(state.positions.b) !== JSON.stringify(restoredPosition), 'the drag actually moves its node');
      } finally { await session.dispose(); }
    }
  }
});

test('state changes before a display callback coalesce while committed View observations remain immediate', async () => {
  const value = compositionHarness('2d');
  const session = await value.create();
  try {
    value.advance();
    const before = value.diagnostics();
    const observed: string[] = [];
    const subscription = session.onViewChanged!(view => observed.push(view.id));
    await session.setView('explore');
    await session.setSelection(['a']);
    await session.setNodePinned('b', true);
    await session.applyPatch({ schemaVersion: 1, patchId: 'coalesced-add', baseRevision: 0,
      operations: [{ type: 'add-node', node: graphNode('added') }] });
    equal(value.diagnostics().counters?.frameCompositions, before.counters?.frameCompositions,
      'state mutations do not compose before the scheduled display callback');
    deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'committed state is immediately readable');
    assert(observed.includes('explore'), 'View observers are notified without waiting for rendering');
    equal(value.platform.pendingFrames, 1, 'all mutations share one scheduled callback');
    value.advance();
    const after = value.diagnostics();
    equal((after.counters?.frameCompositions ?? 0) - (before.counters?.frameCompositions ?? 0), 1, 'one callback flushes the union');
    assert(after.lastFrameInvalidations.includes('content') && after.lastFrameInvalidations.includes('geometry'),
      'content and geometry causes survive coalescing');
    assert(value.scene().nodes.some(node => node.id === 'added'), 'the new content reaches the scene');
    equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'settling state does not schedule a redundant callback');
    subscription.dispose();
  } finally { await session.dispose(); }
});

test('camera-only callbacks update the renderer transform without composing the graph', async () => {
  const value = compositionHarness('3d');
  const session = await value.create();
  try {
    value.advance();
    const before = value.diagnostics();
    await session.resetCamera();
    value.advance();
    const after = value.diagnostics();
    equal(after.counters?.frameCompositions, before.counters?.frameCompositions, 'camera reset performs no graph composition');
    equal(after.compositionsThisFrame, 0, 'camera-only composition count is zero');
    assert(after.lastFrameInvalidations.includes('camera'), 'camera work is classified');
    deepEqual(value.scene().view.camera, (await session.exportViewState()).camera, 'renderer gets the live camera');
    equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'the camera-only callback returns to sleep');
  } finally { await session.dispose(); }
});
