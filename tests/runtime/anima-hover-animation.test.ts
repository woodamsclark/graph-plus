import { AnimaHoverPreviewAnimation, blendAnimaPreviewFrame } from '../../src/graph-engine/runtime/anima/AnimaHoverPreviewAnimation.ts';
import type { GraphRenderFrameV1 } from '../../src/graph-engine/runtime/render/GraphRenderTypes.ts';
import type { GraphInteractionPreviewV1 } from '../../src/graph-engine/runtime/anima/AnimaInteractionPreview.ts';
import { CanvasGraphRenderer, GraphRendererRegistry, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness, runtimeCanvas } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const preview: GraphInteractionPreviewV1 = { kind: 'objects', activation: 'primary',
  addedNodeIds: ['a'], removedNodeIds: [], hoverPathNodeIds: [] };

test('Anima cached highlight targets preserve the moving live world through full strength', () => {
  const color = { r: 0, g: 0, b: 0, a: 1 };
  const initial: GraphRenderFrameV1 = {
    geometryRevision: 1, regions: [], backgroundColor: color,
    labelFont: { family: 'sans-serif', sizePx: 12, weight: 400, style: 'normal', lineHeightPx: 14.4 },
    nodes: [{ id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 5,
      finalColor: color, opacity: 0.25, labelColor: color, labelOpacity: 0.25,
      labelFontSize: 12, labelStatePriority: 0 }],
    edges: [{ id: 'aa', sourceId: 'a', targetId: 'a', directed: false, thickness: 1,
      color, opacity: 0.25, arrowColor: color, arrowOpacity: 0.25 }],
  };
  // This target is compiled once, before the live node moves.
  const cached: GraphRenderFrameV1 = { ...initial,
    nodes: [{ ...initial.nodes[0], radius: 99, opacity: 1, labelOpacity: 1 },
      { ...initial.nodes[0], id: 'preview-only' }],
    edges: [{ ...initial.edges[0], thickness: 99, sourceId: 'preview-only', opacity: 1 }],
  };
  const animation = new AnimaHoverPreviewAnimation();
  const layers = (now: number) => animation.update({ context: 'world', preview, hoveredNodeId: 'a', committed: false, now });
  layers(0);
  for (const [now, x, expectedStrength] of [[450, 10, 0.5], [700, 20, 1], [800, 30, 1]]) {
    const live: GraphRenderFrameV1 = { ...initial, geometryRevision: x,
      nodes: [{ ...initial.nodes[0], position: { x, y: x * 2, z: x * 3 } },
        { ...initial.nodes[0], id: 'live-only' }],
    };
    const strength = layers(now)[0].strength;
    equal(strength, expectedStrength, 'the highlight reaches and retains full strength');
    const result = blendAnimaPreviewFrame(live, cached, strength);
    deepEqual(result.nodes[0].position, live.nodes[0].position, 'cached visuals cannot snap a moving node back');
    deepEqual(result.nodes.map(node => node.id), ['a', 'live-only'], 'membership comes from the live baseline');
    equal(result.nodes[0].radius, 5, 'node geometry comes from the live baseline');
    equal(result.geometryRevision, x, 'projection revision follows the live geometry');
    equal(result.edges[0].sourceId, 'a', 'edge endpoints come from the live baseline');
    equal(result.edges[0].thickness, 1, 'edge geometry comes from the live baseline');
    equal(result.nodes[0].opacity, 0.25 + 0.75 * strength, 'highlight visuals interpolate to the cached target');
    equal(result.edges[0].opacity, 0.25 + 0.75 * strength, 'edge visuals interpolate to the cached target');
    equal(result.regions, live.regions, 'other world state stays on the live baseline');
    equal(blendAnimaPreviewFrame(live, cached, -1), live, 'negative strength returns the baseline');
    deepEqual(blendAnimaPreviewFrame(live, cached, 2), blendAnimaPreviewFrame(live, cached, 1),
      'strength above one clamps visuals while retaining live geometry');
  }
});

test('Anima cancels waiting previews and reverses partial fades without jumping', () => {
  const animation = new AnimaHoverPreviewAnimation();
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
      const registry = new GraphRendererRegistry();
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
      equal(scene!.policy?.cursorLabelRevealRadiusPx, 0, 'hover suspends proximity labels throughout preview timing');
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


test('Cmd note preview holds hover styling through card handoff and release until dismissal', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    for (const viewMode of ['overview', 'explore', 'focus'] as const) {
      let scene: GraphRenderSceneV2 | undefined;
      const registry = new GraphRendererRegistry();
      registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
        const renderer = new CanvasGraphRenderer(createCanvas(), now);
        const update = renderer.updateScene.bind(renderer);
        renderer.updateScene = next => { scene = next; update(next); };
        return renderer;
      } });
      const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
        registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
        document: graphDocument({ nodes: ['a', 'b', 'c', 'd'].map(id => graphNode(id)),
          edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')] }) });
      Object.defineProperty(value.window.navigator, 'platform', { value: 'MacIntel', configurable: true });
      value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
        'force-layout': { enabled: false }, anima: { settings: { cursorGravity: 'off' } },
      } });
      const session = await value.create();
      const initial = await session.exportViewState();
      const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
      await session.restoreViewState({ ...initial, viewMode, selectedNodeIds: viewMode === 'overview' ? [] : ['a'],
        focusedNodeId: viewMode === 'focus' ? 'a' : undefined,
        positions: Object.fromEntries(['a', 'b', 'c', 'd'].map((id, i) => [id, camera.screenToWorld(120 + i * 120, 180, 1000)])) });
      value.platform.flushFrame(value.platform.now());
      const unchanged = await session.exportViewState();
      const styling = () => ({ nodes: scene!.nodes, edges: scene!.edges, policy: scene!.policy });
      const baseline = styling();
      const canvas = runtimeCanvas(value.container);
      const move = (x: number, y: number) => {
        canvas.dispatchEvent(new value.window.PointerEvent('pointermove', {
          clientX: x, clientY: y, pointerId: 982, pointerType: 'mouse', metaKey: true, bubbles: true,
        }) as unknown as Event);
        value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      };
      move(240, 180);
      value.platform.advanceTime(720); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
      const hovered = styling();
      assert(JSON.stringify(hovered) !== JSON.stringify(baseline), 'the hovered node has distinct styling');
      move(-100, -100);
      deepEqual(styling(), hovered, `${dimensions}/${viewMode}: handoff preserves all hover styling`);
      await session.setPreviewSurfaceActive(true);
      canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerId: 982, pointerType: 'mouse' }) as unknown as Event);
      value.window.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Meta', metaKey: false }));
      value.platform.advanceTime(20);
      value.platform.flushFrame(value.platform.now());
      deepEqual(styling(), hovered, 'card interaction and Cmd release preserve hover styling');
      value.platform.advanceTime(700); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
      deepEqual(styling(), hovered, 'the hover styling remains after the ordinary fade-out duration');
      await session.setPreviewSurfaceActive(false);
      value.platform.flushFrame(value.platform.now());
      deepEqual(styling(), hovered, 'leaving the card preserves styling until the card disappears');
      await session.clearPreview(); value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      value.platform.advanceTime(500); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
      deepEqual(styling(), baseline, 'dismissal restores the baseline styling');
      deepEqual(await session.exportViewState(), unchanged, 'preview styling never changes the live world');
      await session.dispose();
    }
  }
});

test('Overview and Constellation keep the approached label drawn through the primary hover handoff', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    for (const viewMode of ['overview', 'explore'] as const) {
      let scene: GraphRenderSceneV2 | undefined;
      const registry = new GraphRendererRegistry();
      registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
        const renderer = new CanvasGraphRenderer(createCanvas(), now);
        const update = renderer.updateScene.bind(renderer);
        renderer.updateScene = next => { scene = next; update(next); }; return renderer;
      } });
      const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
        registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
        document: graphDocument({ nodes: ['root', 'neighbor', 'other'].map(id => graphNode(id)),
          edges: [graphEdge('rn', 'root', 'neighbor')] }) });
      value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
        'force-layout': { enabled: false }, anima: { settings: { cursorGravity: 'off' } },
        rendering: { settings: { labelMode: 'proximity' } },
      } });
      const session = await value.create(); const initial = await session.exportViewState();
      const camera = new GraphCameraController(initial.camera, dimensions); camera.setViewport(640, 360);
      await session.restoreViewState({ ...initial, viewMode, selectedNodeIds: viewMode === 'overview' ? [] : ['root'],
        positions: Object.fromEntries(['root', 'neighbor', 'other'].map((id, i) =>
          [id, camera.screenToWorld(120 + i * 180, 180, 1000)])) });
      value.platform.flushFrame(value.platform.now());
      const committed = await session.exportViewState();
      const canvas = runtimeCanvas(value.container);
      const move = (x: number) => {
        value.drawArguments.length = 0;
        const fields = { clientX: x, clientY: 180, pointerId: 981, pointerType: 'mouse', button: 0 };
        const event = new value.window.PointerEvent('pointermove', { ...fields, bubbles: true });
        for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
        canvas.dispatchEvent(event as unknown as Event);
        value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      };
      let labelOnCanvas = false;
      const drawn = () => {
        // The scheduler may keep the existing canvas at the zero-strength boundary.
        // Only a repaint can remove a label that was already drawn.
        if (value.drawArguments.some(call => call.method === 'clearRect')) {
          labelOnCanvas = value.drawArguments.some(call => call.method === 'fillText' && call.args[0] === 'neighbor');
        }
        return labelOnCanvas;
      };
      move(270); assert(drawn(), `${dimensions}/${viewMode}: proximity draws the approached label`);
      move(300);
      const readable = () => {
        assert(drawn(), `${dimensions}/${viewMode}: hovering cannot drop the approached label`);
        equal(scene!.nodes.find(node => node.id === 'neighbor')!.labelOpacity, 1, 'handoff keeps full label opacity');
        equal(scene!.policy?.cursorLabelRevealRadiusPx, 0, 'other proximity labels remain paused');
      };
      readable();
      for (const ms of [199, 1, 1, 249, 250]) {
        value.drawArguments.length = 0;
        value.platform.advanceTime(ms); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
        readable();
      }
      deepEqual(await session.exportViewState(), committed, 'label handoff does not change committed graph or camera state');
      await session.setSessionOverrides({ modules: { rendering: { settings: { labelMode: 'off' } } } });
      value.drawArguments.length = 0; value.platform.flushFrame(value.platform.now());
      assert(!value.drawArguments.some(call => call.method === 'fillText'), 'absolute label Off still suppresses hover labels');
      await session.dispose();
    }
  }
});

test('Focus hover keeps its label visible through the delay and grows it continuously to root size', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    let scene: GraphRenderSceneV2 | undefined;
    const registry = new GraphRendererRegistry();
    registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true, create: ({ createCanvas, now }) => {
      const renderer = new CanvasGraphRenderer(createCanvas(), now);
      const update = renderer.updateScene.bind(renderer);
      renderer.updateScene = next => { scene = next; update(next); };
      return renderer;
    } });
    const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
      registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
      document: graphDocument({ nodes: [graphNode('root'), graphNode('neighbor')], edges: [graphEdge('rn', 'root', 'neighbor')] }) });
    value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
      'force-layout': { enabled: false }, anima: { settings: { cursorGravity: 'off' } },
    } });
    const session = await value.create(); await session.focusNode('root');
    value.platform.flushFrame(value.platform.now());
    const label = () => scene!.nodes.find(node => node.id === 'neighbor')!;
    const baselineSize = label().labelFontSize;
    const small = Math.max(12, baselineSize);
    const large = scene!.nodes.find(node => node.id === 'root')!.labelFontSize;
    assert(session.setNodeHover, 'host hover shares the graph hover transition');
    await session.setNodeHover('neighbor'); value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
    const advance = (ms: number) => { value.platform.advanceTime(ms); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now()); };
    const visible = () => { assert(label().showLabel !== false && label().labelForceVisible === true,
      'hovered label remains admitted even with proximity paused'); equal(label().labelOpacity, 1, 'entry label never fades out'); };
    visible(); equal(label().labelFontSize, small, 'hover begins at the small label size');
    advance(200); visible(); equal(label().labelFontSize, small, 'delay preserves the visible small label');
    advance(250); visible(); assert(Math.abs(label().labelFontSize - (small + large) / 2) < 1e-8,
      'halfway entry smoothly interpolates label size');
    advance(250); visible(); equal(label().labelFontSize, large, 'entry ends at root label size');
    await session.setNodeHover(null); value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
    advance(500); equal(label().labelFontSize, baselineSize, 'leave restores the smaller label size');
    await session.dispose();
  }
});
