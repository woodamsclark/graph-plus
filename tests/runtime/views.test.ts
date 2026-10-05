import { graphPlusEngineExperienceContractV1, graphPlusExperiencePolicyV1 } from '../../src/graph-plus/application/GraphPlusExperiencePolicy.ts';
import { DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1, GRAPH_VIEW_DEFINITIONS_V1, type GraphSessionV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { Judgement } from '../../src/graph-engine/runtime/consciousness/Judgement.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController, type GraphSessionRuntime } from '../../src/graph-engine/runtime/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
import { multiplyGraphColorAlphaV2 } from '../../src/graph-engine/runtime/theme/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness, runtimeRegistration } from '../support/runtimeHarness.ts';

test('Views codify discover/build/focus bindings independently of world and UI settings', async () => {
  deepEqual(Object.values(GRAPH_VIEW_DEFINITIONS_V1).map((v) => v.purpose), ['discover', 'build', 'focus'], 'creation phases are explicit definitions');
  deepEqual(Object.values(GRAPH_VIEW_DEFINITIONS_V1).map((v) => v.framing.interest), ['none', 'constellation', 'focused-node'], 'all/many/one interest is explicit');
  deepEqual(Object.values(GRAPH_VIEW_DEFINITIONS_V1).map((v) => v.interactions.nodeDrag),
    ['all-visible', 'all-visible', 'all-visible'], 'drag permission belongs to the committed View');
  deepEqual(Object.values(GRAPH_VIEW_DEFINITIONS_V1).map((v) => v.interactions.spaceActivation),
    ['clear-constellation', 'preserve-scene', 'preserve-scene'], 'Space clearing belongs only to Overview View policy');
  for (const view of Object.values(GRAPH_VIEW_DEFINITIONS_V1)) {
    deepEqual(view.scene.labels, { focused: 'force', hovered: 'force', highlighted: 'force',
      dimmed: 'suppress', void: 'suppress', standard: 'fallback', removedMember: 'suppress' }, 'each View declares label reveal eligibility');
  }
  const value = runtimeHarness();
  const session = await value.create();
  await session.setSelection(['a', 'b']);
  const world = await session.exportDocument();
  const positions = (await session.exportViewState()).positions;
  const settings = await session.exportEffectiveSettings();
  const changes: string[] = [];
  const subscription = session.onViewChanged((view) => changes.push(view.id));
  session.setViewUiState('overview', { quickSettingsOpen: true, expandedSectionIds: ['display'] });
  session.setViewUiState('explore', { quickSettingsOpen: false, expandedSectionIds: ['form'] });
  await session.setView('explore');
  await session.focusNode('b');
  await session.setView('explore');
  await session.setView('overview');
  deepEqual(changes, ['explore', 'focus', 'explore', 'overview'], 'View notification works without endogenous intent or membership changes');
  deepEqual(await session.exportDocument(), world, 'View transitions do not alter canonical world');
  deepEqual((await session.exportViewState()).positions, positions, 'View transitions do not alter layout');
  deepEqual(await session.exportEffectiveSettings(), settings, 'View transitions preserve subsystem settings');
  deepEqual(session.getViewUiState('overview'), { quickSettingsOpen: true, expandedSectionIds: ['display'] }, 'Overview UI disclosure survives return');
  deepEqual(session.getViewUiState('explore'), { quickSettingsOpen: false, expandedSectionIds: ['form'] }, 'Constellation retains independent UI disclosure');
  const exported = session.getViewUiState('overview')!;
  (exported.expandedSectionIds as string[]).push('forces');
  deepEqual(session.getViewUiState('overview')?.expandedSectionIds, ['display'], 'exported UI state cannot mutate the session');
  subscription.dispose();
  await session.dispose();
});

test('Overview chooses a whole connected highlighted constellation and replaces the previous composition', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const pointerType of ['mouse', 'touch'] as const) {
      const base = runtimeRegistration();
      const value = runtimeHarness({ profileId, registration: {
        ...base, profiles: base.profiles.map((profile) => ({ ...profile, modules: {
          ...profile.modules, anima: { ...profile.modules.anima, defaultEnabled: true },
        } })),
      }, document: graphDocument({
        nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => graphNode(id)),
        edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c'), graphEdge('cd', 'c', 'd'), graphEdge('de', 'd', 'e')],
      }) });
      const session = await value.create();
      const canvas = runtimeCanvas(value.container);
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds: ['a', 'b', 'd', 'e'] });
      const initial = await session.exportViewState();
      const positions = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id, index) => [id, { x: index * 80 - 160, y: 0, z: 0 }]));
      await session.restoreViewState({ ...initial, positions });
      await session.fitNodes();
      const before = await session.exportViewState();
      tap(value, canvas, await point(session, 'b'), 601, pointerType);
      value.platform.flushFrame();
      const chosen = await session.exportViewState();
      deepEqual(chosen.selectedNodeIds, ['a', 'b'], 'a click through b selects its complete highlighted group, stopping at unlit c');
      deepEqual(session.getActiveView(), { id: 'explore' }, 'Overview group entry has no singular subject');
      deepEqual(chosen.camera, before.camera, 'group entry preserves user framing');
      value.platform.advanceTime(400);
      tap(value, canvas, await point(session, 'b'), 602, pointerType);
      value.platform.flushFrame();
      for (let i = 0; i < 12; i += 1) value.platform.flushTimer();
      const focus = await session.exportViewState();
      deepEqual(focus.selectedNodeIds, ['a', 'b'], 'Focus never resolves or replaces the group again');
      equal(focus.focusedNodeId, 'b', 'second single click presents the chosen member');
      equal(focus.camera.zoom, before.camera.zoom, 'thin seam preserves scale');
      value.platform.advanceTime(400);
      tap(value, canvas, { x: -100, y: -100 }, 603, pointerType);
      value.platform.flushFrame();
      value.platform.advanceTime(400);
      tap(value, canvas, { x: -100, y: -100 }, 604, pointerType);
      value.platform.flushFrame();
      equal(session.getActiveView().id, 'overview', 'two Back operations reach Overview');
      await session.fitNodes();
      value.platform.advanceTime(400);
      tap(value, canvas, await point(session, 'e'), 605, pointerType);
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['d', 'e'], 'choosing a new group replaces the active composition without merging old Memory');
      await session.dispose();
    }
  }
});

test('Focus entry and rapid root hops recenter in one input frame without camera timers', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const pointerType of ['mouse', 'touch'] as const) {
      const value = runtimeHarness({ profileId });
      const session = await value.create();
      const initial = await session.exportViewState();
      await session.restoreViewState({ ...initial, positions: {
        a: { x: -40, y: 0, z: 0 }, b: { x: 40, y: 15, z: 0 }, c: { x: 0, y: -25, z: 0 },
      } });
      await session.setSelection(['a', 'b', 'c']);
      await session.setView('explore');
      value.platform.flushFrame();
      const before = await session.exportViewState();
      const cameraOffset = (camera: typeof before.camera) => ({
        x: camera.position.x - camera.target.x,
        y: camera.position.y - camera.target.y,
        z: camera.position.z - camera.target.z,
      });
      let viewportChanges = 0;
      session.onIntent((intent) => { if (intent.type === 'viewport-changed') viewportChanges += 1; });
      const canvas = runtimeCanvas(value.container);
      for (const [index, id] of ['a', 'b', 'c', 'a'].entries()) {
        value.platform.advanceTime(400);
        tap(value, canvas, await point(session, id), 800 + index, pointerType);
        value.platform.flushFrame();
        const after = await session.exportViewState();
        equal(after.focusedNodeId, id, 'each click commits the intended Focus subject');
        deepEqual(after.camera.target, after.positions[id], 'Focus is fully recentered before any timer runs');
        equal(after.camera.zoom, before.camera.zoom, 'entry and hops preserve zoom');
        deepEqual(after.camera.up, before.camera.up, 'entry and hops preserve orientation');
        const offset = cameraOffset(after.camera);
        const expected = cameraOffset(before.camera);
        assert(Math.hypot(offset.x - expected.x, offset.y - expected.y, offset.z - expected.z) < 1e-9,
          'entry and hops preserve the camera offset and perspective distance');
        equal(value.platform.pendingTimers, 0, 'ordinary Focus changes leave no interpolation callbacks');
        equal(viewportChanges, index + 1, 'each hop emits only its final camera state');
      }
      const settled = (await session.exportViewState()).camera;
      for (let i = 0; i < 12; i += 1) value.platform.flushTimer();
      deepEqual((await session.exportViewState()).camera, settled, 'previous roots cannot move the camera later');
      await session.dispose();
    }
  }
});

test('One-node Constellation refit matches Focus without acquiring a Focus subject', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const pointerType of ['mouse', 'touch'] as const) {
      const value = runtimeHarness({ profileId, document: graphDocument({
        nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
        edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')],
      }) });
      const session = await value.create();
      const initial = await session.exportViewState();
      const basis = { ...initial, selectedNodeIds: ['a'], positions: {
        a: { x: -60, y: 20, z: 0 }, b: { x: 90, y: -40, z: 0 },
        c: { x: 450, y: 10, z: 0 }, d: { x: -240, y: 100, z: 0 },
      } };
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds: ['d'] });
      const canvas = runtimeCanvas(value.container);
      const results = [];
      for (const viewMode of ['explore', 'focus'] as const) {
        await session.restoreViewState({ ...basis, viewMode,
          focusedNodeId: viewMode === 'focus' ? 'a' : undefined });
        value.platform.advanceTime(400);
        for (const type of ['pointerdown', 'pointerup']) {
          const fields = { clientX: -100, clientY: -100, pointerId: 850, pointerType,
            button: pointerType === 'mouse' ? 2 : 0 };
          const event = new value.window.PointerEvent(type, { ...fields, bubbles: true, cancelable: true });
          for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
          canvas.dispatchEvent(event as unknown as Event);
          if (type === 'pointerdown' && pointerType === 'touch') value.platform.flushTimer();
          value.platform.flushFrame();
        }
        const fitted = await session.exportViewState();
        equal(fitted.viewMode, viewMode, 'Center + Fit preserves the committed View');
        equal(fitted.focusedNodeId, viewMode === 'focus' ? 'a' : undefined, 'Constellation fit does not acquire Focus');
        deepEqual(fitted.camera.target, fitted.positions.a, 'refit centers the singleton, rather than its neighbors');
        results.push(fitted.camera);
      }
      deepEqual(results[0], results[1], 'secondary-click Center + Fit and touch background hold share Focus framing in both Views');
      await session.dispose();
    }
  }
});

test('Primary additions commit paths while Ctrl on nonmembers does nothing with mouse and direct touch', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const pointerType of ['mouse', 'touch'] as const) {
      for (const ctrl of [false, true]) {
        const value = runtimeHarness({ profileId, document: graphDocument({
          nodes: ['a', 'b', 'c'].map((id) => graphNode(id)),
          edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')],
        }) });
        const session = await value.create();
        const initial = await session.exportViewState();
        await session.restoreViewState({ ...initial, positions: {
          a: { x: -50, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, c: { x: 50, y: 0, z: 0 },
        } });
        await session.fitNodes();
        await session.setSelection(['a']);
        await session.setView('explore');
        const before = await session.exportViewState();
        tap(value, runtimeCanvas(value.container), await point(session, 'c'), 900, pointerType, ctrl);
        value.platform.flushFrame();
        const after = await session.exportViewState();
        deepEqual(after.selectedNodeIds, ctrl ? ['a'] : ['a', 'c', 'b'],
          'primary activation admits the route while Ctrl leaves a nonmember unchanged');
        equal(after.viewMode, 'explore', 'admission does not descend into Focus');
        deepEqual(after.camera, before.camera, 'admission preserves framing');
        if (ctrl) deepEqual(after, before, 'a Ctrl no-change outcome does not create observations or effects');
        await session.dispose();
      }
    }
  }
});

test('The constellation menu control uses Ego admission instead of exact-set replacement', async () => {
  const value = runtimeHarness({ document: graphDocument({
    nodes: ['a', 'b', 'c'].map((id) => graphNode(id)),
    edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')],
  }) });
  const session = await value.create();
  await session.setSelection(['a']);
  await session.setView('explore');
  const controls = (session as GraphSessionRuntime).createControlPort();
  controls.toggleConstellationNode('c');
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'menu input waits for the normal command boundary');
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a', 'c', 'b'], 'menu additions admit the same connecting route');
  controls.toggleConstellationNode('c');
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a', 'b'], 'menu removal leaves the admitted path member');
  await session.dispose();
});

test('View controls use Ego while external application truth bypasses Judgement and user observations', async () => {
  const original = Judgement.prototype.consider;
  const decisions: string[] = [];
  let deny = false;
  Judgement.prototype.consider = function (intent, constraints) {
    decisions.push((intent.directive as { type: string }).type);
    const consider = original.bind(this) as typeof this.consider;
    return deny ? { status: 'rejected', reason: 'test-rule-denied' }
      : consider(intent, constraints);
  };
  let session: GraphSessionV1 | undefined;
  try {
    for (const local of [false, true]) {
      const value = runtimeHarness({ document: graphDocument({
        nodes: ['a', 'b', 'c'].map((id) => graphNode(id)),
        edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')],
      }), experience: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
        allowedStates: local ? ['explore', 'focus'] : ['overview', 'explore', 'focus'] } });
      session = await value.create();
      const controls = (session as GraphSessionRuntime).createControlPort();
      const intents: string[] = [];
      session.onIntent((intent) => intents.push(intent.type));
      decisions.length = 0;
      deny = true;
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds: ['c'] });
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-attention', nodeIds: ['a'],
        focusNodeId: 'a', framing: 'recenter-focus' });
      deepEqual(decisions, [], 'outside truth does not ask Ego permission');
      deepEqual(intents, [], 'outside arrival creates no endogenous observations');
      const received = await session.exportViewState();
      deepEqual(received.selectedNodeIds, ['a'], 'external Attention is still received under a denying Judgement');
      equal(received.focusedNodeId, 'a', 'external Focus is installed directly');

      controls.focusConstellationNode('c');
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'denied menu Focus cannot admit a member');
      equal((await session.exportViewState()).focusedNodeId, 'a', 'denied menu Focus cannot replace the subject');
      deepEqual(intents, [], 'denied controls create no observations');
      deny = false;
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-attention', nodeIds: ['a'] });
      controls.focusConstellationNode('c');
      value.platform.flushFrame();
      const focused = await session.exportViewState();
      deepEqual(focused.selectedNodeIds, ['a', 'c', 'b'], 'menu Focus admits the same connecting route as canvas Focus');
      equal(focused.focusedNodeId, 'c', 'menu Focus commits its requested subject');
      assert(intents.includes('selection-changed') && intents.includes('focus-changed'), 'deliberate controls emit normal observations');
      assert(decisions.includes('direct-attention'), 'semantic View directives reach Judgement');
      controls.navigateView('back'); value.platform.flushFrame();
      equal(session.getActiveView().id, 'explore', 'toolbar Back follows Escape one View');
      deepEqual((await session.exportViewState()).camera, focused.camera, 'Back retains framing');
      if (!local) {
        controls.navigateView('overview'); value.platform.flushFrame();
        deepEqual((await session.exportViewState()).selectedNodeIds, focused.selectedNodeIds, 'Overview retains the composition');
        controls.navigateView('back'); value.platform.flushFrame();
        equal(session.getActiveView().id, 'overview', 'Back at Overview never goes forward');
      }
      controls.navigateView('clear-constellation'); value.platform.flushFrame();
      const cleared = await session.exportViewState();
      deepEqual(cleared.selectedNodeIds, [], 'clear withdraws only active composition');
      equal(cleared.focusedNodeId, undefined, 'clear releases Focus');
      equal(cleared.viewMode, local ? 'explore' : 'overview', 'empty composition respects consumer View permissions');
      await session.dispose(); session = undefined;
    }
  } finally {
    await session?.dispose();
    Judgement.prototype.consider = original;
  }
});

test('An empty Constellation remains a build View through unrelated filter reconciliation', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  await session.setView('explore');
  await session.applyFilter({ schemaVersion: 1, scope: 'render', node: { op: 'has-token', token: 'keep' } });
  await session.clearFilter('render');
  equal(session.getActiveView().id, 'explore', 'reconciliation cannot eject an intentionally empty build View');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'empty build does not select remembered or random nodes');
  await session.dispose();
});

test('Filtering and member removal release unavailable Focus without selecting a replacement', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  await session.setSelection(['a', 'b']);
  await session.focusNode('b');
  const camera = (await session.exportViewState()).camera;
  await session.applyFilter({ schemaVersion: 1, scope: 'render', node: { op: 'has-token', token: 'keep' } });
  equal(session.getActiveView().id, 'explore', 'removing the subject backs out one View');
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'unavailable members leave the active composition');
  deepEqual((await session.exportViewState()).camera, camera, 'reconciliation preserves framing');
  await session.setSelection([]);
  equal(session.getActiveView().id, 'overview', 'an empty composition resolves to Overview');
  await session.dispose();
});

test('Focus permits zooming out beyond its neighborhood fit', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    const value = runtimeHarness({ profileId });
    const session = await value.create();
    const canvas = runtimeCanvas(value.container);
    await session.setSelection(['a', 'b']);
    await session.focusNode('a');
    const before = await session.exportViewState();
    for (let i = 0; i < 12; i += 1) {
      canvas.dispatchEvent(new value.window.KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }) as unknown as Event);
      value.platform.flushFrame();
    }
    const after = await session.exportViewState();
    if (profileId === 'two-dimensional') assert(after.camera.zoom < before.camera.zoom / 2, 'Focus does not clamp to the neighborhood scale');
    else assert(distance(after.camera) > distance(before.camera) * 2, 'Focus does not clamp to neighborhood distance');
    await session.dispose();
  }
});

function distance(camera: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }): number {
  return Math.hypot(camera.position.x - camera.target.x, camera.position.y - camera.target.y, camera.position.z - camera.target.z);
}
async function point(session: GraphSessionV1, id: string): Promise<{ x: number; y: number }> {
  const state = await session.exportViewState();
  const camera = new GraphCameraController(state.camera, state.dimensions);
  camera.setViewport(640, 360);
  return camera.worldToScreen(state.positions[id]);
}
function tap(value: ReturnType<typeof runtimeHarness>, canvas: HTMLCanvasElement, point: { x: number; y: number }, pointerId: number, pointerType: string, ctrl = false): void {
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new value.window.PointerEvent(type, { clientX: point.x, clientY: point.y, pointerId, pointerType, button: 0, ctrlKey: ctrl, bubbles: true, cancelable: true });
    for (const [key, field] of Object.entries({ clientX: point.x, clientY: point.y, pointerId, pointerType, button: 0, ctrlKey: ctrl })) Object.defineProperty(event, key, { value: field });
    canvas.dispatchEvent(event as unknown as Event);
  }
}


test('Memory constellation colors, visibility, and adoption agree across Views, dimensions, and Anima styling', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const animaEnabled of [false, true]) {
      let scene: GraphRenderSceneV2 | undefined;
      const registry = new GraphRendererRegistryV2();
      registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true,
        create: ({ createCanvas, now }) => {
          const renderer = new CanvasGraphRenderer(createCanvas(), now);
          const update = renderer.updateScene.bind(renderer);
          renderer.updateScene = (next) => { scene = next; update(next); };
          return renderer;
        },
      });
      const base = runtimeRegistration();
      const value = runtimeHarness({ profileId, rendererRegistry: registry, registration: {
        ...base, profiles: base.profiles.map((profile) => ({ ...profile, modules: {
          ...profile.modules, anima: { ...profile.modules.anima, defaultEnabled: animaEnabled },
        } })),
      }, document: graphDocument({ nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => graphNode(id)),
        edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c'), graphEdge('cd', 'c', 'd')],
      }) });
      const session = await value.create();
      const initial = await session.exportViewState();
      await session.restoreViewState({ ...initial,
        camera: { ...initial.camera, zoom: 1, target: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 600 } },
        positions: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => [id, { x: i * 70 - 175, y: 0, z: 0 }])),
      });
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds: ['b', 'c', 'd', 'e'] });
      await session.setSelection(['a', 'b']);
      const memoryColor = DEFAULT_GRAPH_RENDER_THEME_V1.colors.memoryConstellation;
      const memoryColorFor = (strength: number) => multiplyGraphColorAlphaV2(memoryColor, strength);
      const node = (id: string) => scene!.nodes.find((node) => node.id === id)!;
      for (const view of ['overview', 'explore', 'focus'] as const) {
        if (view === 'focus') await session.focusNode('a');
        else await session.setView(view);
        value.platform.flushFrame();
        for (const [id, strength] of [['c', 0.25], ['d', 0.5], ['e', 1]] as const) {
          deepEqual(node(id).finalColor, memoryColorFor(strength),
            'Memory uses its own color faded from oldest to newest');
          equal(node(id).opacity, 1, 'Memory remains visible in every View');
          equal(node(id).labelForceVisible === true, view !== 'focus',
            'Memory labels remain prominent outside Focus and adaptive within Focus');
          equal(node(id).strokeWidth, undefined, 'Memory visibility does not imply deliberate membership');
        }
        assert(JSON.stringify(node('b').finalColor) !== JSON.stringify(memoryColor), 'deliberate membership wins when a subject is also remembered');
        deepEqual(scene!.edges.find((edge) => edge.sourceId === 'c' && edge.targetId === 'd')?.color,
          memoryColorFor(0.25), 'links internal to Memory use the older endpoint strength');
        deepEqual((await session.exportViewState()).selectedNodeIds, ['a', 'b'], 'Memory presentation never changes Attention');
        if (view === 'focus') equal(node('f').opacity, 0, 'ordinary distant context remains void');
        if (view === 'focus') {
          equal(node('b').labelFontSize, node('a').labelFontSize * 0.5,
            'Focus neighbors use half-size labels while the root retains its full label size');
        }
      }
      // A distant remembered object is actually hittable in Focus. Admitting it
      // follows the same path rule as other candidates, without selecting all Memory.
      const canvas = runtimeCanvas(value.container);
      tap(value, canvas, await point(session, 'd'), 901, 'touch');
      value.platform.flushFrame();
      const adopted = await session.exportViewState();
      equal(adopted.focusedNodeId, 'd', 'Focus can explore a visible memory subject');
      deepEqual(adopted.selectedNodeIds, ['a', 'b', 'd', 'c'], 'adoption admits only the target and connecting route');
      deepEqual(node('e').finalColor, memoryColorFor(1), 'unrelated recent Memory remains fully colored');
      await session.setSelection([]);
      await session.setView('overview');
      value.platform.flushFrame();
      deepEqual(node('d').finalColor, memoryColorFor(0.5),
        'clearing deliberate membership restores its recency-weighted Memory color');
      // Choosing a Memory component in Overview adopts its complete remembered group.
      value.platform.advanceTime(400);
      tap(value, canvas, await point(session, 'c'), 902, 'touch');
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['b', 'c', 'd'], 'Overview adopts the connected Memory group');
      equal(session.getActiveView().id, 'explore', 'Memory choice becomes deliberate Constellation');
      await session.applyFilter({ schemaVersion: 1, scope: 'render', node: { op: 'id-in', ids: ['a', 'b', 'c', 'd', 'f'] } });
      value.platform.flushFrame();
      equal(scene!.nodes.some((node) => node.id === 'e'), false, 'Memory cannot bypass structural filtering');
      await session.clearFilter();
      await session.applyExternalInfluence({ schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds: ['c'] });
      value.platform.flushFrame();
      equal(node('e').labelForceVisible, false, 'a subject that leaves recent Memory loses its memory emphasis');
      await session.dispose();
    }
  }
});

test('Committed activation holds its admitted preview until pointer leave', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    let scene: GraphRenderSceneV2 | undefined;
    const registry = new GraphRendererRegistryV2();
    registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true,
      create: ({ createCanvas, now }) => {
        const renderer = new CanvasGraphRenderer(createCanvas(), now);
        const update = renderer.updateScene.bind(renderer);
        renderer.updateScene = (next) => { scene = next; update(next); };
        return renderer;
      },
    });
    const value = runtimeHarness({ profileId, rendererRegistry: registry, document: graphDocument({
      nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
      edges: [graphEdge('ab', 'a', 'b'), graphEdge('cd', 'c', 'd')],
    }) });
    const session = await value.create();
    const initial = await session.exportViewState();
    await session.restoreViewState({ ...initial, selectedNodeIds: ['a', 'd'], viewMode: 'focus', focusedNodeId: 'a',
      positions: { a: { x: -90, y: 0, z: 0 }, b: { x: -30, y: 0, z: 0 },
        c: { x: 30, y: 0, z: 0 }, d: { x: 90, y: 0, z: 0 } },
      camera: { ...initial.camera, zoom: 1, target: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 600 } },
    });
    const canvas = runtimeCanvas(value.container);
    const hover = async (id?: string) => {
      const location = id ? await point(session, id) : { x: -100, y: -100 };
      const fields = { clientX: location.x, clientY: location.y, pointerId: 950, pointerType: 'mouse' };
      const event = new value.window.PointerEvent(id ? 'pointermove' : 'pointerleave', { ...fields, bubbles: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event);
      value.platform.flushFrame();
    };
    await hover('d');
    const preview = scene!.nodes.map((node) => ({ id: node.id, opacity: node.opacity,
      labelOpacity: node.labelOpacity, labelFontSize: node.labelFontSize, labelForceVisible: node.labelForceVisible, strokeWidth: node.strokeWidth }));
    tap(value, canvas, await point(session, 'd'), 951, 'mouse');
    value.platform.flushFrame();
    equal((await session.exportViewState()).focusedNodeId, 'd', 'click commits the previewed Focus subject');
    deepEqual(scene!.nodes.map((node) => ({ id: node.id, opacity: node.opacity,
      labelOpacity: node.labelOpacity, labelFontSize: node.labelFontSize, labelForceVisible: node.labelForceVisible, strokeWidth: node.strokeWidth })), preview,
    'the admitted preview remains visually exact through its commit');
    await hover('d');
    deepEqual(scene!.nodes.map((node) => ({ id: node.id, opacity: node.opacity,
      labelOpacity: node.labelOpacity, labelFontSize: node.labelFontSize, labelForceVisible: node.labelForceVisible, strokeWidth: node.strokeWidth })), preview,
    'movement within the node retains the latched preview');
    await hover();
    equal(scene!.nodes.find((node) => node.id === 'c')!.opacity, 1, 'leaving retains the committed standard Focus neighborhood');
    let hoveredNodeId: string | undefined;
    session.onIntent((intent) => { if (intent.type === 'node-hover-changed') hoveredNodeId = intent.nodeId; });
    await hover('c');
    equal(hoveredNodeId, 'c', 'the standard neighbor is pickable on its new visit');
    equal((await session.exportViewState()).focusedNodeId, 'd', 'the new hover leaves the committed Focus subject intact');
    await session.dispose();
  }
});

test('Overview node drag holds the admitted Constellation preview without replanning it', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    let scene: GraphRenderSceneV2 | undefined;
    const registry = new GraphRendererRegistryV2();
    registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true,
      create: ({ createCanvas, now }) => {
        const renderer = new CanvasGraphRenderer(createCanvas(), now);
        const update = renderer.updateScene.bind(renderer);
        renderer.updateScene = (next) => { scene = next; update(next); };
        return renderer;
      },
    });
    const value = runtimeHarness({ profileId, rendererRegistry: registry, document: graphDocument({
      nodes: ['a', 'b', 'c'].map((id) => graphNode(id)),
      edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')],
    }) });
    const session = await value.create();
    const initial = await session.exportViewState();
    await session.restoreViewState({ ...initial, viewMode: 'overview', selectedNodeIds: [], focusedNodeId: undefined,
      positions: { a: { x: -80, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, c: { x: 80, y: 0, z: 0 } },
      camera: { ...initial.camera, zoom: 1, target: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 600 } },
    });
    const canvas = runtimeCanvas(value.container);
    const nodeScene = () => scene!.nodes.map((node) => ({ id: node.id, opacity: node.opacity,
      finalColor: node.finalColor, labelOpacity: node.labelOpacity,
      labelForceVisible: node.labelForceVisible, strokeWidth: node.strokeWidth }));
    const emit = (type: 'pointermove' | 'pointerdown' | 'pointerup', x: number, y: number) => {
      const fields = { clientX: x, clientY: y, pointerId: 960, pointerType: 'mouse', button: 0 };
      const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event);
    };
    const start = await point(session, 'b');
    emit('pointermove', start.x, start.y);
    value.platform.flushFrame();
    const preview = nodeScene();
    deepEqual(Object.fromEntries(preview.map((node) => [node.id, node.opacity])), { a: 1, b: 1, c: 1 },
      'Overview hover first admits the Constellation preview');
    emit('pointerdown', start.x, start.y);
    emit('pointermove', start.x + 35, start.y + 15);
    value.platform.flushFrame();
    deepEqual(nodeScene(), preview, 'dragging holds the exact preview captured before drag start');
    deepEqual((await session.exportViewState()).selectedNodeIds, [], 'the held preview remains uncommitted during drag');
    emit('pointerup', start.x + 35, start.y + 15);
    value.platform.flushFrame();
    deepEqual(nodeScene(), preview, 'drag release under the moved node continues the same hover visit');
    deepEqual((await session.exportViewState()).selectedNodeIds, [], 'drag release cannot commit the held preview');
    await session.dispose();
  }
});

test('Selective hover previews preserve committed state in 2D and 3D with and without Anima styling', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const animaEnabled of [false, true]) {
      let scene: GraphRenderSceneV2 | undefined;
      const registry = new GraphRendererRegistryV2();
      registry.register({ backendId: 'canvas2d', priority: 0, supports: () => true,
        create: ({ createCanvas, now }) => {
          const renderer = new CanvasGraphRenderer(createCanvas(), now);
          const update = renderer.updateScene.bind(renderer);
          renderer.updateScene = (next) => { scene = next; update(next); };
          return renderer;
        },
      });
      const base = runtimeRegistration();
      const value = runtimeHarness({ profileId, rendererRegistry: registry, registration: {
        ...base, profiles: base.profiles.map((profile) => ({ ...profile, modules: {
          ...profile.modules, anima: { ...profile.modules.anima, defaultEnabled: animaEnabled },
        } })),
      }, document: graphDocument({ nodes: ['a', 'b', 'c', 'd'].map((id) => graphNode(id)),
        edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')] }),
      });
      const session = await value.create();
      const initial = await session.exportViewState();
      await session.restoreViewState({ ...initial,
        camera: { ...initial.camera, zoom: 1, target: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 600 } },
        positions: { a: { x: -120, y: 0, z: 0 }, b: { x: -40, y: 0, z: 0 },
          c: { x: 40, y: 0, z: 0 }, d: { x: 120, y: 0, z: 0 } },
      });
      const canvas = runtimeCanvas(value.container);
      const opacities = () => Object.fromEntries(scene!.nodes.map((node) => [node.id, node.opacity]));
      const hover = async (id?: string, ctrl = false) => {
        const location = id ? await point(session, id) : { x: -100, y: -100 };
        const event = new value.window.PointerEvent(id ? 'pointermove' : 'pointerleave', {
          clientX: location.x, clientY: location.y, pointerId: 700, pointerType: 'mouse', ctrlKey: ctrl, bubbles: true,
        });
        for (const [key, field] of Object.entries({ clientX: location.x, clientY: location.y, pointerId: 700, pointerType: 'mouse', ctrlKey: ctrl })) Object.defineProperty(event, key, { value: field });
        canvas.dispatchEvent(event as unknown as Event);
        value.platform.flushFrame();
        if (animaEnabled) {
          value.platform.advanceTime(id ? 700 : 500);
          value.platform.flushTimer(); value.platform.flushFrame();
        }
      };
      const intents: string[] = [];
      const viewChanges: string[] = [];
      session.onIntent((intent) => intents.push(intent.type));
      session.onViewChanged((view) => viewChanges.push(view.id));
      const overview = await session.exportViewState();
      await hover('b');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 0.24 }, 'Overview previews the admitted Constellation destination');
      deepEqual(scene!.nodes.find((node) => node.id === 'b')!.finalColor,
        animaEnabled ? DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent : DEFAULT_GRAPH_RENDER_THEME_V1.colors.selectedNode,
        'Overview shows the prospective selection');
      deepEqual(await session.exportViewState(), overview, 'Overview hover cannot alter world-facing state or Memory');
      tap(value, canvas, await point(session, 'b'), 690, 'mouse');
      value.platform.flushFrame();
      equal((await session.exportViewState()).viewMode, 'explore', 'first click highlights and enters Constellation');
      const entered = await session.exportViewState();
      deepEqual(entered.camera, overview.camera, 'selection preserves framing until an explicit Center + Fit');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 0.24 },
        'click commits Constellation without any partial Focus hover presentation');
      equal(scene!.nodes.find((node) => node.id === 'a')!.labelForceVisible === true, false,
        'the consumed visit keeps neighbor labels adaptive');
      equal(scene!.nodes.find((node) => node.id === 'c')!.labelForceVisible === true, false,
        'the consumed visit does not force nonmember neighbor labels');
      await hover('b');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 0.24 }, 'same-node movement cannot rearm any hover presentation');
      await hover('b', true);
      assert(scene!.nodes.find((node) => node.id === 'b')!.strokeWidth !== undefined, 'modifier changes cannot preview another action in the consumed visit');
      await hover('b');
      equal(opacities().d, 0.24, 'modifier release cannot rearm Focus preview');
      await hover();
      await hover('b');
      equal(opacities().d, 0, 'leaving and returning rearms Focus preview');
      value.platform.advanceTime(400);
      const focusPreview = { ...opacities() };
      tap(value, canvas, await point(session, 'b'), 693, 'mouse');
      value.platform.flushFrame();
      equal((await session.exportViewState()).focusedNodeId, 'b', 'click commits the previewed Focus subject');
      deepEqual(opacities(), focusPreview, 'the Focus preview exactly matches the committed default Focus scene');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 0 },
        'committed root hover keeps immediate neighbors standard and unrelated context void');
      await hover();
      await session.restoreViewState(overview);
      await hover('b');
      value.platform.advanceTime(400);
      tap(value, canvas, await point(session, 'b'), 691, 'mouse');
      value.platform.flushFrame();
      value.platform.advanceTime(400);
      tap(value, canvas, await point(session, 'b'), 692, 'mouse');
      value.platform.flushFrame();
      equal((await session.exportViewState()).viewMode, 'focus', 'second click without leaving still enters Focus');
      await session.restoreViewState(overview);
      await hover();
      await session.setSelection(['a', 'd']);
      await session.setView('explore');
      let build = await session.exportViewState();
      await hover('c');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'candidate hover previews admission and its path');
      deepEqual(await session.exportViewState(), build, 'candidate/path preview does not commit');
      tap(value, canvas, await point(session, 'c'), 702, 'mouse');
      value.platform.flushFrame();
      const admitted = await session.exportViewState();
      equal(admitted.viewMode, 'explore', 'clicking the hover-lit candidate only admits it');
      equal(admitted.focusedNodeId, undefined, 'the admission click cannot enter Focus');
      deepEqual(admitted.selectedNodeIds, ['a', 'd', 'c', 'b'], 'adding a candidate also commits the intermediate path');
      deepEqual(admitted.camera, build.camera, 'admission preserves framing');
      equal(scene!.nodes.find((node) => node.id === 'c')!.strokeWidth, 1,
        'admission commits its preview and cannot immediately show the next Focus outline');
      await hover('c');
      equal(scene!.nodes.find((node) => node.id === 'c')!.strokeWidth, 1,
        'movement inside the newly admitted node cannot rearm its Focus preview');
      await hover();
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'the admitted route remains highlighted after leave');
      await hover('c');
      equal(scene!.nodes.find((node) => node.id === 'c')!.strokeWidth, animaEnabled ? 3 : 2,
        'a new hover visit previews Focus for the admitted member');
      await hover();
      await session.setSelection(['a', 'd']);
      build = await session.exportViewState();
      await hover('a', true);
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 }, 'Ctrl-hover previews deselection without a path');
      equal(scene!.nodes.find((node) => node.id === 'a')!.labelOpacity, 0,
        'the rendered removal preview suppresses its label even while hovered');
      equal(scene!.nodes.find((node) => node.id === 'a')!.labelForceVisible, false,
        'the removal policy overrides hover forcing with and without optional Anima');
      equal(scene!.nodes.find((node) => node.id === 'a')!.strokeWidth, undefined, 'removed members lose their selection outline');
      deepEqual((await session.exportViewState()).selectedNodeIds, ['a', 'd'], 'Ctrl-hover does not commit deselection');
      tap(value, canvas, await point(session, 'a'), 704, 'mouse', true);
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['d'], 'Ctrl-click commits the removal');
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 },
        'holding Ctrl after removal cannot immediately preview re-adding the node and route');
      await hover('a', true);
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 },
        'Ctrl-hover keeps the deselected target in its committed scene phase');
      equal(scene!.nodes.find((node) => node.id === 'a')!.labelForceVisible, false,
        'the deselected target cannot regain hover-forced labels while Ctrl remains held');
      equal(scene!.nodes.find((node) => node.id === 'a')!.strokeWidth, undefined,
        'the deselected target cannot regain a prospective selection outline');
      const removed = await session.exportViewState();
      tap(value, canvas, await point(session, 'a'), 705, 'mouse', true);
      value.platform.flushFrame();
      deepEqual(await session.exportViewState(), removed, 'repeating Ctrl-click on the deselected node has no effects');
      await session.setSelection(['a', 'd']);
      await hover('a', true);
      canvas.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }) as unknown as Event);
      value.platform.flushFrame();
      if (animaEnabled) { value.platform.advanceTime(700); value.platform.flushTimer(); value.platform.flushFrame(); }
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 },
        'modifier release retains the admitted removal preview until leave');
      await hover('a');
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 }, 'same-node movement retains the admitted removal preview');
      deepEqual(await session.exportViewState(), build, 'Constellation preview preserves all exported state');
      await hover();
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0.24, d: 1 }, 'leaving restores Constellation');
      await session.focusNode('a');
      const committed = await session.exportViewState();
      await hover('d', true);
      deepEqual(opacities(), { a: 1, b: 1, c: 0, d: 0.24 }, 'Ctrl-hover dims the removed member while retaining standard Focus neighbors');
      await hover('d', true);
      deepEqual(opacities(), { a: 1, b: 1, c: 0, d: 0.24 }, 'a removal preview retains its own target without flicker');
      deepEqual(await session.exportViewState(), committed, 'a retained removal target does not change actual state');
      canvas.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }) as unknown as Event);
      value.platform.flushFrame();
      if (animaEnabled) { value.platform.advanceTime(700); value.platform.flushTimer(); value.platform.flushFrame(); }
      deepEqual(opacities(), { a: 1, b: 0, c: 0, d: 1 }, 'Ctrl release previews the exact destination Focus scene');
      await hover('d', true);
      tap(value, canvas, await point(session, 'd'), 703, 'mouse', true);
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'Ctrl-click can remove the target hidden by its own preview');
      await hover();
      await session.setSelection(['a', 'd']);
      build = await session.exportViewState();
      await hover('a', true);
      deepEqual(opacities(), { a: 0.24, b: 1, c: 0, d: 1 }, 'subject removal cue retains the standard Focus neighborhood');
      await hover();
      intents.length = 0;
      viewChanges.length = 0;
      const unchangedFocus = await session.exportViewState();
      await hover('b');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'Focus hopping previews the destination root with standard neighbors');
      deepEqual(await session.exportViewState(), unchangedFocus, 'hover changes neither camera, settings, membership, subject, layout, nor Memory');
      deepEqual(viewChanges, [], 'visual previews do not publish View transitions');
      assert(intents.every((type) => type === 'node-hover-changed'), 'hover emits inspection only');
      await hover();
      deepEqual(opacities(), { a: 1, b: 1, c: 0, d: 1 }, 'leaving restores committed Focus');
      await hover('b');
      await hover('c');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'the next preview subject also reveals its shortest route');
      const prospective = { ...opacities() };
      tap(value, canvas, await point(session, 'c'), 701, 'mouse');
      value.platform.flushFrame();
      const chosen = await session.exportViewState();
      equal(chosen.focusedNodeId, 'c', 'click commits the prospective subject');
      deepEqual(chosen.selectedNodeIds, ['a', 'd', 'c', 'b'], 'a Focus addition also admits its connecting path');
      await hover();
      deepEqual(opacities(), prospective, 'click commits the previewed subject and its connecting path');
      await session.setSelection(['a']);
      await session.focusNode('a');
      const singleFocus = await session.exportViewState();
      await hover('a', true);
      deepEqual(opacities(), { a: 0.24, b: 1, c: 0, d: 0 },
        'last-member removal preview retains Focus rather than exposing Overview');
      equal(scene!.nodes.find((node) => node.id === 'a')!.strokeWidth, undefined,
        'removing the subject drops only its local focus and membership outlines');
      deepEqual(await session.exportViewState(), singleFocus, 'last-member preview has no committed effects');
      await hover();
      deepEqual(opacities(), { a: 1, b: 1, c: 0, d: 0 }, 'canceling removal restores its object emphasis');
      await hover('a', true);
      tap(value, canvas, await point(session, 'a'), 707, 'mouse', true);
      value.platform.flushFrame();
      equal(session.getActiveView().id, 'overview', 'only activation commits the last-member View exit');
      deepEqual(opacities(), { a: 0.24, b: 1, c: 1, d: 1 },
        'the committed Overview retains the admitted removal preview until leave');
      const empty = await session.exportViewState();
      const emptyLabelForce = scene!.nodes.find((node) => node.id === 'a')!.labelForceVisible;
      await hover('a', true);
      equal(scene!.nodes.find((node) => node.id === 'a')!.labelForceVisible, emptyLabelForce,
        'continued Ctrl-hover preserves the committed label policy, including independent Memory');
      deepEqual(await session.exportViewState(), empty, 'continued Ctrl-hover does not reverse the committed exit');
      await session.dispose();
    }
  }
});


test('Hover peeking borrows destination swipe controls and pivot, then restores prior navigation without committing', async () => {
  for (const viewMode of ['overview', 'explore', 'focus'] as const) {
    const value = runtimeHarness({ profileId: 'three-dimensional', document: graphDocument({ nodes: ['a', 'b', 'c'].map(id => graphNode(id)),
      edges: [graphEdge('ab', 'a', 'b'), graphEdge('bc', 'b', 'c')] }) });
    const session = await value.create();
    await session.setSessionOverrides({ modules: { 'force-layout': { enabled: false } } });
    const initial = await session.exportViewState();
    const camera = new GraphCameraController(initial.camera, '3d'); camera.setViewport(640, 360);
    const positions = { a: camera.screenToWorld(220, 180, 1000), b: camera.screenToWorld(400, 180, 1000),
      c: camera.screenToWorld(520, 220, 1000) };
    await session.restoreViewState({ ...initial, positions, viewMode,
      selectedNodeIds: viewMode === 'overview' ? [] : viewMode === 'focus' ? ['a'] : ['b'],
      ...(viewMode === 'focus' ? { focusedNodeId: 'a' } : {}) });
    const canvas = runtimeCanvas(value.container);
    const before = await session.exportViewState();
    const hit = await point(session, 'b');
    const hover = (type: 'pointermove' | 'pointerleave') => {
      const fields = { clientX: hit.x, clientY: hit.y, pointerId: 912, pointerType: 'mouse', button: 0 };
      const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
      for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
      canvas.dispatchEvent(event as unknown as Event); value.platform.advanceTime(20); value.platform.flushFrame();
    };
    const swipe = () => {
      canvas.dispatchEvent(new value.window.WheelEvent('wheel', {
        deltaX: 24, deltaY: 12, deltaMode: 0, bubbles: true, cancelable: true }) as unknown as Event);
      value.platform.advanceTime(20); value.platform.flushFrame();
    };
    hover('pointermove'); value.platform.advanceTime(800); value.platform.flushTimer(); value.platform.flushFrame();
    deepEqual(await session.exportViewState(), before, 'peeking itself does not commit View, membership, subject or camera framing');
    const expected = new GraphCameraController(before.camera, '3d'); expected.setViewport(640, 360);
    expected.orbitByPixels(-24, 12, positions.b);
    swipe();
    const rotated = await session.exportViewState();
    deepEqual(rotated.camera, expected.getState(), 'swipe rotates around the peeked subject even from Overview');
    equal(rotated.viewMode, viewMode, 'navigation does not commit the destination View');
    deepEqual(rotated.selectedNodeIds, before.selectedNodeIds, 'peeking does not admit members');
    equal(rotated.focusedNodeId, before.focusedNodeId, 'peeking does not change the committed subject');
    hover('pointerleave');
    deepEqual((await session.exportViewState()).camera, expected.getState(), 'leaving preserves the entire camera pose while restoring only navigation interest');
    const returned = await session.exportViewState();
    if (viewMode === 'overview') {
      expected.panByPixels(24, 12); swipe();
      deepEqual((await session.exportViewState()).camera, expected.getState(), 'Overview swipe resumes panning after leaving');
    } else {
      expected.orbitByPixels(-24, 12, viewMode === 'focus' ? positions.a : positions.b); swipe();
      deepEqual((await session.exportViewState()).camera, expected.getState(), 'subsequent rotation uses the previous pivot without a pose reset');
    }
    deepEqual(returned.positions, before.positions, 'navigation never changes the graph layout');
    await session.restoreViewState(before);
    hover('pointermove'); value.platform.advanceTime(800); value.platform.flushTimer(); value.platform.flushFrame();
    swipe();
    const peekCamera = (await session.exportViewState()).camera;
    tap(value, canvas, await point(session, 'b'), 913, 'mouse'); value.platform.advanceTime(20); value.platform.flushFrame();
    const committed = await session.exportViewState();
    equal(committed.viewMode, viewMode === 'overview' ? 'explore' : 'focus', 'click commits the exact borrowed destination');
    if (committed.viewMode === 'focus') equal(committed.focusedNodeId, 'b', 'click commits the peeked subject');
    deepEqual(committed.camera, peekCamera, 'committing a navigated peek keeps the camera framing');
    hover('pointerleave');
    deepEqual((await session.exportViewState()).camera, peekCamera, 'leaving a committed peek never restores the old target');
    await session.dispose();
  }
});


test('Constellation peek uses Focus elastic pan in 2D and cancels its return motion on leave', async () => {
  const value = runtimeHarness({ document: graphDocument({ nodes: ['a', 'b'].map(id => graphNode(id)),
    edges: [graphEdge('ab', 'a', 'b')] }) });
  const session = await value.create();
  await session.setSessionOverrides({ modules: { 'force-layout': { enabled: false } } });
  const initial = await session.exportViewState();
  const camera = new GraphCameraController(initial.camera, '2d'); camera.setViewport(640, 360);
  const positions = { a: camera.screenToWorld(220, 180, 1000), b: camera.screenToWorld(420, 180, 1000) };
  await session.restoreViewState({ ...initial, positions, viewMode: 'explore', selectedNodeIds: ['b'] });
  const before = await session.exportViewState();
  const canvas = runtimeCanvas(value.container); const hit = await point(session, 'b');
  const pointer = (type: 'pointermove' | 'pointerleave') => {
    const fields = { clientX: hit.x, clientY: hit.y, pointerId: 914, pointerType: 'mouse', button: 0 };
    const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
    for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
    canvas.dispatchEvent(event as unknown as Event); value.platform.advanceTime(20); value.platform.flushFrame();
  };
  pointer('pointermove');
  const expected = new GraphCameraController(before.camera, '2d'); expected.setViewport(640, 360);
  expected.panByPixels(12 * 0.55, 8 * 0.55);
  const panned = expected.getState().target;
  expected.translateBy({ x: (positions.b.x - panned.x) * 0.22, y: (positions.b.y - panned.y) * 0.22,
    z: (positions.b.z - panned.z) * 0.22 });
  canvas.dispatchEvent(new value.window.WheelEvent('wheel', { deltaX: 12, deltaY: 8, deltaMode: 0,
    bubbles: true, cancelable: true }) as unknown as Event);
  value.platform.advanceTime(20); value.platform.flushFrame();
  deepEqual((await session.exportViewState()).camera, expected.getState(), 'peeked Focus elastic pan pulls toward the prospective root');
  equal(session.getActiveView().id, 'explore', 'borrowed Focus controls do not commit Focus');
  pointer('pointerleave');
  deepEqual((await session.exportViewState()).camera, expected.getState(), 'leave preserves the current camera pose');
  const returned = (await session.exportViewState()).camera;
  value.platform.advanceTime(1000); value.platform.flushTimer(); value.platform.flushFrame();
  deepEqual((await session.exportViewState()).camera, returned, 'no abandoned elastic-return timer moves the camera afterward');
  await session.dispose();
});


test('Graph+ Focus entry and hops preserve the camera; right-click explicitly centers and fits', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    for (const mode of ['global', 'local'] as const) {
      const value = runtimeHarness({ profileId, experience: graphPlusEngineExperienceContractV1(graphPlusExperiencePolicyV1(mode)),
        document: graphDocument({ nodes: ['a', 'b'].map(id => graphNode(id)), edges: [graphEdge('ab', 'a', 'b')] }) });
      const session = await value.create();
      await session.setSessionOverrides({ modules: { 'force-layout': { enabled: false } } });
      const initial = await session.exportViewState();
      const camera = new GraphCameraController(initial.camera, initial.dimensions); camera.setViewport(640, 360);
      const positions = { a: camera.screenToWorld(200, 180, 1000), b: camera.screenToWorld(440, 220, 1000) };
      await session.restoreViewState({ ...initial, positions, selectedNodeIds: ['a', 'b'], viewMode: 'explore' });
      const before = await session.exportViewState(); const canvas = runtimeCanvas(value.container);
      for (const [index, nodeId] of ['a', 'b'].entries()) {
        tap(value, canvas, await point(session, nodeId), 920 + index, 'mouse');
        value.platform.advanceTime(20); value.platform.flushFrame();
        equal((await session.exportViewState()).focusedNodeId, nodeId, 'ordinary click changes the focused subject');
        deepEqual((await session.exportViewState()).camera, before.camera, 'Focus entry and hops change no camera coordinates or scale');
      }
      await session.focusNode('a');
      deepEqual((await session.exportViewState()).camera, before.camera, 'programmatic Focus also preserves framing');
      for (const type of ['pointerdown', 'pointerup']) {
        const fields = { clientX: 10, clientY: 10, pointerId: 924, pointerType: 'mouse', button: 2 };
        const event = new value.window.PointerEvent(type, { ...fields, bubbles: true });
        for (const [key, field] of Object.entries(fields)) Object.defineProperty(event, key, { value: field });
        canvas.dispatchEvent(event as unknown as Event);
      }
      value.platform.advanceTime(20); value.platform.flushFrame();
      const fitted = await session.exportViewState();
      deepEqual(fitted.camera.target, positions.a, 'right-click explicitly centers on the current Focus root');
      assert(JSON.stringify(fitted.camera) !== JSON.stringify(before.camera), 'right-click explicitly changes camera framing');
      await session.dispose();
    }
  }
});
