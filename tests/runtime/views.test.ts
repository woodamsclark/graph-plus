import { GRAPH_VIEW_DEFINITIONS_V1, type GraphSessionV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import { CanvasGraphRenderer, GraphRendererRegistryV2, type GraphRenderSceneV2 } from '../../src/graph-engine/runtime/render/index.ts';
import { GraphCameraController, type GraphSessionRuntime } from '../../src/graph-engine/runtime/index.ts';
import { DEFAULT_GRAPH_RENDER_THEME_V1 } from '../../src/graph-engine/runtime/render/index.ts';
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

test('Primary and Ctrl additions commit connecting paths with mouse and direct touch', async () => {
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
        deepEqual(after.selectedNodeIds, ['a', 'c', 'b'], 'activation admits the candidate and route even without prior hover');
        equal(after.viewMode, 'explore', 'admission does not descend into Focus');
        deepEqual(after.camera, before.camera, 'admission preserves framing');
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


test('Hover previews View activation in 2D and 3D, independently of optional Anima styling', async () => {
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
      };
      const intents: string[] = [];
      const viewChanges: string[] = [];
      session.onIntent((intent) => intents.push(intent.type));
      session.onViewChanged((view) => viewChanges.push(view.id));
      const overview = await session.exportViewState();
      await hover('b');
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'Overview retains its full undimmed field');
      deepEqual(scene!.nodes.find((node) => node.id === 'b')!.finalColor,
        animaEnabled ? DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent : DEFAULT_GRAPH_RENDER_THEME_V1.colors.selectedNode,
        'Overview shows the prospective selection');
      deepEqual(await session.exportViewState(), overview, 'Overview hover cannot alter world-facing state or Memory');
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
      await hover();
      deepEqual(opacities(), { a: 1, b: 1, c: 1, d: 1 }, 'the admitted route remains highlighted after leave');
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
      canvas.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }) as unknown as Event);
      value.platform.flushFrame();
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0, d: 1 }, 'releasing Ctrl previews the ordinary member click at the same pointer');
      await hover('a');
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0, d: 1 }, 'Constellation previews Focus around the hovered member');
      deepEqual(await session.exportViewState(), build, 'Constellation preview preserves all exported state');
      await hover();
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0.24, d: 1 }, 'leaving restores Constellation');
      await session.focusNode('a');
      const committed = await session.exportViewState();
      await hover('d', true);
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0, d: 0 }, 'Ctrl-hover on a distant Focus member previews voiding');
      await hover('d', true);
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0, d: 0 }, 'a removal preview retains its own target without flicker');
      deepEqual(await session.exportViewState(), committed, 'a retained removal target does not change actual state');
      canvas.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }) as unknown as Event);
      value.platform.flushFrame();
      deepEqual(opacities(), { a: 1, b: 0, c: 0, d: 1 }, 'Ctrl release returns to the ordinary Focus preview of the same member');
      await hover('d', true);
      tap(value, canvas, await point(session, 'd'), 703, 'mouse', true);
      value.platform.flushFrame();
      deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'Ctrl-click can remove the target hidden by its own preview');
      await hover();
      await session.setSelection(['a', 'd']);
      build = await session.exportViewState();
      await hover('a', true);
      deepEqual(opacities(), { a: 0.24, b: 0.24, c: 0.24, d: 1 }, 'Ctrl-hover of the subject previews releasing Focus');
      await hover();
      intents.length = 0;
      viewChanges.length = 0;
      await hover('b');
      deepEqual(opacities(), { a: 1, b: 1, c: 0.24, d: 1 }, 'Focus reveals the hovered neighbor neighborhood');
      deepEqual(await session.exportViewState(), committed, 'hover changes neither camera, settings, membership, subject, layout, nor Memory');
      deepEqual(viewChanges, [], 'visual previews do not publish View transitions');
      assert(intents.every((type) => type === 'node-hover-changed'), 'hover emits inspection only');
      await hover();
      deepEqual(opacities(), { a: 1, b: 0.24, c: 0, d: 1 }, 'leaving restores committed Focus');
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
      await session.dispose();
    }
  }
});
