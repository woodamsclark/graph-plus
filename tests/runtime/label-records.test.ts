import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphLabelRecordCache } from '../../src/graph-engine/runtime/render/GraphLabelRecordCache.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { graphDocument, graphNode, graphEdge } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function labelHarness(dimensions: '2d' | '3d', records = false) {
  let scene: GraphRenderSceneV2 | undefined;
  const registry = new GraphRendererRegistryV2();
  registry.register({ backendId: records ? 'webgl2' : 'canvas2d', priority: 0, supports: () => true,
    create: ({ createCanvas, now }) => {
      const renderer = new CanvasGraphRenderer(createCanvas(), now);
      const updateScene = (next: GraphRenderSceneV2) => { scene = next; renderer.updateScene(next); };
      if (!records) { renderer.updateScene = updateSceneWithCapture(renderer, next => { scene = next; }); return renderer; }
      // An existing alternate renderer omits the new optional label capability.
      return { backendId: 'webgl2' as const, interactionElement: renderer.interactionElement,
        initialize: () => renderer.initialize(), resize: renderer.resize.bind(renderer),
        updateTheme: renderer.updateTheme.bind(renderer), updateScene,
        render: renderer.render.bind(renderer), pick: renderer.pick.bind(renderer),
        queryNearest: renderer.queryNearest.bind(renderer),
        getRendererDiagnostics: renderer.getRendererDiagnostics.bind(renderer), dispose: renderer.dispose.bind(renderer),
      };
    },
  });
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, rendererRegistry: registry,
    document: graphDocument({ nodes: Array.from({ length: 1200 }, (_, i) => graphNode(`n${i}`)),
      edges: Array.from({ length: 1199 }, (_, i) => graphEdge(`e${i}`, `n${i}`, `n${i + 1}`)) }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { enabled: true, settings: { alphaDecay: 0 } },
    anima: { settings: { cursorGravity: 'off' } },
  } });
  return { ...value, scene: () => scene!, advance: () => {
    value.platform.advanceTime(20); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
  } };
}

function updateSceneWithCapture(renderer: CanvasGraphRenderer, capture: (scene: GraphRenderSceneV2) => void) {
  const update = renderer.updateScene.bind(renderer);
  return (scene: GraphRenderSceneV2) => { capture(scene); update(scene); };
}

test('Canvas physics frames allocate no duplicate labels and still draw canonical node labels in both dimensions', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = labelHarness(dimensions);
    const session = await value.create();
    try {
      value.advance();
      const labels = value.scene().labels;
      equal(labels.length, 0, 'Canvas does not receive duplicate label records');
      assert(value.scene().nodes.some(node => node.label.length > 0 && node.labelOpacity > 0), 'canonical node label presentation is retained');
      const before = value.factory.getDiagnostics().sessions[0];
      for (let i = 0; i < 4; i += 1) {
        value.advance();
        equal(value.scene().labels, labels, 'geometry frames share one empty label array');
      }
      const after = value.factory.getDiagnostics().sessions[0];
      equal(after.counters?.frameCompositions, before.counters?.frameCompositions, 'stable physics still avoids presentation composition');
      assert(after.invalidationCounts.geometry > before.invalidationCounts.geometry, 'real geometry callbacks are exercised');
      // Isolate one required label from large-graph adaptive admission/occlusion.
      const renderer = new CanvasGraphRenderer(value.document.createElement('canvas'), () => 0);
      const scene = value.scene();
      renderer.initialize(); renderer.resize(scene.view.viewport);
      renderer.updateScene({ ...scene, edges: [], regions: [], nodes: [{ ...scene.nodes[0],
        position: scene.view.camera.target, label: 'canonical-label', labelFontSize: 16,
        labelAlwaysVisible: true, showLabel: true, labelOpacity: 1,
      }] });
      renderer.render(); renderer.dispose();
      assert(value.drawArguments.some(call => call.method === 'fillText' && call.args[0] === 'canonical-label'),
        'Canvas draws the canonical node label while the derived label array is empty');
      await session.setNodeHover!('n0'); value.advance();
      equal(value.scene().labels, labels, 'hover presentation also avoids duplicate records');
    } finally { await session.dispose(); }
  }
});

test('existing record-based renderers keep their labels and reuse records through geometry-only callbacks', async () => {
  const value = labelHarness('2d', true);
  const session = await value.create();
  try {
    value.advance();
    const scene = value.scene();
    equal(scene.labels.length, 1200, 'alternate backends retain their prior label representation');
    const first = scene.nodes[0];
    deepEqual(scene.labels[0], { id: `label:${first.id}`, nodeId: first.id, text: first.label,
      color: first.labelColor, opacity: first.labelOpacity, fontSizePx: first.labelFontSize,
      offset: first.labelOffset ?? { x: 0, y: 0 }, visible: first.showLabel !== false,
      priority: first.labelPriority ?? 0, alwaysVisible: first.labelAlwaysVisible === true,
    }, 'derived record values preserve the renderer contract');
    for (let i = 0; i < 4; i += 1) { value.advance(); equal(value.scene().labels, scene.labels, 'geometry does not allocate label records'); }
  } finally { await session.dispose(); }
});

test('derived label records invalidate only for label values, membership, order or mode', async () => {
  const value = labelHarness('2d');
  const session = await value.create();
  try {
    const frame = { ...value.scene(), nodes: value.scene().nodes.slice(0, 2) };
    const cache = new GraphLabelRecordCache();
    const initial = cache.resolve(frame);
    const geometry = { ...frame, nodes: frame.nodes.map(node => ({ ...node,
      position: { x: 99, y: 10, z: 0 }, radius: node.radius * 2,
      labelColor: { ...node.labelColor }, labelOffset: { x: 0, y: 0 },
    })) };
    equal(cache.resolve(geometry), initial, 'geometry and equivalent label value objects reuse the records');
    const updates = [
      { label: 'renamed' }, { labelColor: { r: 1, g: 0, b: 0, a: 1 } }, { labelOpacity: 0.3 },
      { labelFontSize: 33 }, { labelOffset: { x: 12, y: -8 } }, { showLabel: false },
      { labelPriority: 99 }, { labelAlwaysVisible: true },
    ];
    for (const update of updates) {
      const next = cache.resolve({ ...frame, nodes: [{ ...frame.nodes[0], ...update }, frame.nodes[1]] });
      assert(next !== initial && next[0] !== initial[0], 'changed label values regenerate the affected record');
      equal(next[1], initial[1], 'unchanged labels retain their records');
      equal(cache.resolve(frame)[1], initial[1], 'restoring a changed value preserves the untouched record');
    }
    const reordered = cache.resolve({ ...frame, nodes: [...frame.nodes].reverse() });
    deepEqual(reordered.map(label => label.nodeId), frame.nodes.map(node => node.id).reverse(), 'record order follows canonical nodes');
    equal(cache.resolve({ ...frame, nodes: frame.nodes.slice(0, 1) }).length, 1, 'removed nodes lose their records');
    const disabled = cache.resolve({ ...frame, policy: { ...frame.policy!, labelMode: 'off' } });
    equal(disabled.length, 0, 'off preserves the prior record visibility contract');
    equal(cache.resolve({ ...frame, policy: { ...frame.policy!, labelMode: 'off' } }), disabled, 'disabled labels share an empty array');
    equal(cache.resolve(frame).length, 2, 'enabling labels restores current membership');
  } finally { await session.dispose(); }
});
