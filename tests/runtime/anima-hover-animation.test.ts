import { AnimaHoverPreviewAnimationV1 } from '../../src/graph-engine/runtime/anima/AnimaHoverPreviewAnimation.ts';
import type { GraphInteractionPreviewV1 } from '../../src/graph-engine/runtime/anima/AnimaInteractionPreview.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const preview: GraphInteractionPreviewV1 = { kind: 'objects', activation: 'primary',
  addedNodeIds: ['a'], removedNodeIds: [], hoverPathNodeIds: [] };

test('Anima cancels waiting previews and reverses partial fades without jumping', () => {
  const animation = new AnimaHoverPreviewAnimationV1();
  const update = (now: number, id?: string, committed = false, context = 'overview') => animation.update({
    context, preview: id ? preview : null, hoveredNodeId: id, committed, now,
  });
  deepEqual(update(0, 'a'), [], 'the first hover waits');
  equal(animation.nextFrameDelayMs(0), 200, 'a waiting preview needs one delayed wake');
  deepEqual(update(100), [], 'leaving during the delay never exposes the preview');
  equal(animation.nextFrameDelayMs(100), undefined, 'canceled waiting work becomes idle');
  update(300, 'a');
  equal(update(750, 'a')[0].strength, 0.5, '450ms into a new visit is halfway in');
  equal(update(750, 'b')[0].strength, 0.5, 'handoff preserves the outgoing visual strength');
  equal(update(850, 'b')[0].strength, 0.4, 'the old preview fades back while the new visit waits');
  equal(update(950, 'b').length, 1, 'only the outgoing preview is visible as the new delay ends');
  equal(update(1_200, 'b').find(layer => layer.hoveredNodeId === 'b')!.strength, 0.5, 'each target owns its own delay');
  equal(update(1_200)[0].strength, 0.5, 'canceling a partial fade preserves its current strength');
  equal(update(1_450)[0].strength, 0.25, 'partial cancellation returns over half a second');
  deepEqual(update(1_700), [], 'the canceled preview reaches the normal scene');
  equal(animation.nextFrameDelayMs(1_700), undefined, 'completed fade-out has no background work');
  equal(update(1_800, 'a', true)[0].strength, 1, 'activation bypasses all preview timing');
  deepEqual(update(1_900, 'a', false, 'focus'), [], 'a changed committed scene discards stale previews');
});

test('Anima delays and fades each View preview in and out in 2D and 3D without moving the graph', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    for (const viewMode of ['overview', 'explore', 'focus'] as const) {
      let scene: GraphRenderSceneV2 | undefined;
      const registry = new GraphRendererRegistryV2();
      registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
        const renderer = new CanvasGraphRenderer(createCanvas(), now);
        const update = renderer.updateScene.bind(renderer);
        renderer.updateScene = next => { scene = next; update(next); }; return renderer;
      } });
      const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
        registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
        document: graphDocument({ nodes: ['a', 'b', 'c', 'd'].map(id => graphNode(id)),
          edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')] }) });
      value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: { 'force-layout': { enabled: false } } });
      const session = await value.create(); const initial = await session.exportViewState();
      const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
      await session.restoreViewState({ ...initial, viewMode, selectedNodeIds: viewMode === 'overview' ? [] : ['a', 'b'],
        focusedNodeId: viewMode === 'focus' ? 'a' : undefined,
        positions: Object.fromEntries(['a', 'b', 'c', 'd'].map((id, i) => [id, camera.screenToWorld(120 + i * 120, 180, 1000)])) });
      value.platform.flushFrame(value.platform.now());
      const unchanged = await session.exportViewState();
      const probe = viewMode === 'focus' ? 'c' : 'd';
      const opacity = () => scene!.nodes.find(node => node.id === probe)!.opacity;
      const baseline = opacity();
      const target = viewMode === 'overview' ? 0.24 : viewMode === 'explore' ? 0 : 1;
      const canvas = runtimeCanvas(value.container);
      const hover = (type: 'pointermove' | 'pointerleave' | 'pointerdown' | 'pointerup') => {
        const fields = { clientX: 240, clientY: 180, pointerId: 981, pointerType: 'mouse', button: 0 };
        const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
        for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
        canvas.dispatchEvent(event as unknown as Event);
        value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      };
      const advance = (ms: number) => {
        value.platform.advanceTime(ms); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
      };
      const close = (actual: number, expected: number, message: string) => assert(Math.abs(actual - expected) < 1e-8, `${dimensions}/${viewMode}: ${message}; expected ${expected}, got ${actual}`);
      hover('pointermove');
      equal(opacity(), baseline, 'entry retains the committed View');
      advance(199); equal(opacity(), baseline, 'preview stays absent for the full delay');
      advance(1); equal(opacity(), baseline, 'fade starts at zero after 200ms');
      advance(250); close(opacity(), (baseline + target) / 2, 'halfway fade blends the committed and admitted scenes');
      equal(scene!.nodes.find(node => node.id === 'd')!.strokeWidth, undefined, 'fade-in cannot invent an outline on an ordinary node');
      equal(scene!.policy?.cursorLabelRevealRadiusPx, 96, 'label proximity remains independent of preview timing');
      advance(250); close(opacity(), target, 'the preview reaches its exact admitted scene');
      hover('pointerleave'); close(opacity(), target, 'leaving does not snap the scene back');
      advance(250); close(opacity(), (baseline + target) / 2, 'leave fades halfway toward the normal View');
      equal(scene!.nodes.find(node => node.id === 'd')!.strokeWidth, undefined, 'fade-out cannot invent an outline on an ordinary node');
      advance(250); close(opacity(), baseline, 'the normal View is restored after 500ms');
      deepEqual(await session.exportViewState(), unchanged, 'timed presentation never changes camera, positions, membership or Memory');
      equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'a completed fade sleeps on a cold graph');
      hover('pointermove');
      session.setSuspended(true);
      equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'suspension clears the delayed wake');
      value.platform.advanceTime(5_000); session.setSuspended(false);
      value.platform.flushFrame(value.platform.now());
      close(opacity(), baseline, 'resuming cannot replay a canceled hover preview');
      hover('pointermove');
      equal(opacity(), baseline, 'another visit starts a fresh delay');
      hover('pointerdown'); hover('pointerup');
      const activated = await session.exportViewState();
      equal(activated.viewMode, viewMode === 'overview' ? 'explore' : 'focus', 'click commits immediately during the waiting phase');
      close(opacity(), target, 'activation immediately presents the admitted destination');
      await session.dispose();
      equal(value.platform.pendingFrames + value.platform.pendingTimers, 0, 'disposal leaves no preview wakeup');
    }
  }
});
