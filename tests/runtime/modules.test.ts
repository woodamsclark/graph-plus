import type { GraphModuleHost, GraphModulePresentationStateV1 } from '../../src/graph-engine/runtime/modules/index.ts';
import type {
  ConsumerRegistrationV1,
  GraphSessionErrorV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import {
  createShippedGraphModuleRegistryV1,
  DEFAULT_GRAPH_RENDER_THEME_V1,
  GraphCameraController,
  GraphModuleRegistry,
  GraphRequiredModuleErrorV1,
  GraphSessionProfileErrorV1,
  parseGraphColorV2,
} from '../../src/graph-engine/runtime/index.ts';
import { FormModule } from '../../src/graph-engine/runtime/modules/shipped/FormModule.ts';
import {
  buildLinearBuildOutPositionsV1,
  readLinearBuildOutLayoutSettingsV1,
} from '../../src/graph-engine/runtime/modules/shipped/LinearBuildOutLayoutModule.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness, runtimeRegistration, runtimeSurface } from '../support/runtimeHarness.ts';

test('R-MODULE-01 keeps optional Anima inert and restores compatible persisted module state', async () => {
  const value = runtimeHarness();
  value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: { anima: { enabled: true } },
  });
  const session = await value.create();
  const state = await session.exportViewState();
  equal(state.moduleState.anima, null, 'enabled Anima should export its valid empty V1 state');
  assert(value.drawCalls.includes('arc'), 'Anima should not suppress required base rendering');
  session.setSuspended(true);
  session.setSuspended(false);
  await session.restoreViewState(state);
  deepEqual((await session.exportViewState()).moduleState, state.moduleState, 'empty Anima state should restore and export unchanged');
  await session.dispose();

  const invalidState = { ...state, moduleState: { ...state.moduleState, anima: {} } };
  const recovered = await value.create(invalidState);
  const errors: GraphSessionErrorV1[] = [];
  recovered.onError((error) => errors.push(error));
  equal(errors.length, 1, 'invalid optional persisted module state should report one recoverable restore error');
  equal(errors[0]?.recoverable, true, 'invalid optional persisted module state should not prevent reopening');
  equal((await recovered.exportViewState()).moduleState.anima, undefined,
    'invalid optional persisted module state should disable only that optional module');
  await recovered.dispose();
});

test('projection and presentation module phases cannot mutate across their boundary', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  let projectionSawDownstreamState = false;
  let presentationSawConsciousness = false;
  registry.register(definition('projection-boundary-probe', 50, {
    projectSource: (state: Record<string, unknown>) => {
      projectionSawDownstreamState = 'consciousness' in state
        || 'nodeContributions' in state
        || 'theme' in state;
      return {
        nodeContributions: { a: { finalColor: parseGraphColorV2('#010203') } },
      } as never;
    },
  }));
  registry.register(definition('presentation-boundary-probe', 600, {
    contributeFrame: (state: Record<string, unknown>) => {
      presentationSawConsciousness = 'consciousness' in state;
      return {
        document: graphDocument({ nodes: [], edges: [] }),
        renderSelection: { nodeIds: new Set(), edgeIds: new Set() },
      } as never;
    },
  }));
  const value = runtimeHarness({
    document: graphDocument({ nodes: [graphNode('a')], edges: [] }),
    modules: registry,
    registration: withModules({
      'projection-boundary-probe': { policy: 'required' },
      'presentation-boundary-probe': { policy: 'required' },
    }),
  });
  const session = await value.create();

  equal(runtimeSurface(value.container).dataset.renderedNodeCount, '1',
    'presentation hooks must not replace projected graph membership');
  equal(projectionSawDownstreamState, false,
    'projection hooks should run before Consciousness and presentation state exist');
  equal(presentationSawConsciousness, true,
    'presentation hooks should receive reconciled Consciousness after projection');
  assert(value.drawCalls.includes('arc'),
    'presentation hooks must not remove nodes chosen by projection');
  assert(!value.styleAssignments.includes('fillStyle:rgb(1, 2, 3)'),
    'projection hooks must not inject downstream Anima styling');
  await session.dispose();
});

test('R-MODULE-02 isolates optional setup and tick failures to one session', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  let fragileInstance = 0;
  registry.register(definition('setup-failure', 240, {
    setup: () => { throw new Error('setup exploded'); },
  }));
  registry.register({
    ...definition('fragile', 250, {}),
    create: () => {
      const instance = ++fragileInstance;
      return { tick: () => { if (instance === 1) throw new Error('tick exploded'); } };
    },
  });
  const registration = withModules({
    'setup-failure': { policy: 'optional', defaultEnabled: true },
    fragile: { policy: 'optional', defaultEnabled: true },
  });
  const first = runtimeHarness({ modules: registry, registration });
  const firstSession = await first.create();
  const firstErrors: GraphSessionErrorV1[] = [];
  firstSession.onError((error) => firstErrors.push(error));
  equal(firstErrors.filter((error) => error.moduleId === 'setup-failure').length, 1, 'optional setup failure should be replayed structurally');
  first.platform.flushFrame();
  equal(firstErrors.filter((error) => error.moduleId === 'fragile').length, 1, 'optional tick failure should emit once');
  equal(firstErrors.every((error) => error.recoverable), true, 'optional failures should remain recoverable');
  equal(first.platform.pendingFrames, 0, 'an optional tick failure should not prevent the remaining idle runtime from sleeping');
  first.platform.flushFrame();
  equal(firstErrors.filter((error) => error.moduleId === 'fragile').length, 1, 'disabled optional module should not run again');

  const second = runtimeHarness({ modules: registry, registration });
  const secondSession = await second.create();
  const secondErrors: GraphSessionErrorV1[] = [];
  secondSession.onError((error) => secondErrors.push(error));
  second.platform.flushFrame();
  assert(!secondErrors.some((error) => error.moduleId === 'fragile'), 'one session failure must not disable another module instance');
  equal(second.platform.pendingFrames, 0, 'an unaffected session with no active animation should sleep normally');
  await firstSession.dispose();
  await secondSession.dispose();
});

test('R-MODULE-03 rejects required setup failure and makes later required failure fatal', async () => {
  const setupLog: string[] = [];
  const setupRegistry = createShippedGraphModuleRegistryV1();
  setupRegistry.register(definition('early', 10, {
    setup: () => setupLog.push('early:setup'),
    dispose: () => setupLog.push('early:dispose'),
  }));
  setupRegistry.register(definition('required-setup-failure', 20, {
    setup: () => { setupLog.push('failure:setup'); throw new Error('required setup exploded'); },
    dispose: () => setupLog.push('failure:dispose'),
  }));
  const setup = runtimeHarness({
    modules: setupRegistry,
    registration: withModules({
      early: { policy: 'required' },
      'required-setup-failure': { policy: 'required' },
    }),
  });
  let setupError: unknown;
  try { await setup.create(); } catch (error) { setupError = error; }
  assert(setupError instanceof GraphRequiredModuleErrorV1, 'required setup failure should reject structurally');
  deepEqual(setupLog, ['early:setup', 'failure:setup', 'failure:dispose', 'early:dispose'], 'partial setup should unwind in reverse order');
  equal(setup.container.children.length, 0, 'required setup failure should roll back the mounted surface');

  const tickRegistry = createShippedGraphModuleRegistryV1();
  tickRegistry.register(definition('required-tick-failure', 250, {
    tick: () => { throw new Error('required tick exploded'); },
  }));
  const tick = runtimeHarness({
    modules: tickRegistry,
    registration: withModules({ 'required-tick-failure': { policy: 'required' } }),
  });
  const session = await tick.create();
  const errors: GraphSessionErrorV1[] = [];
  session.onError((error) => errors.push(error));
  tick.platform.flushFrame();
  equal(errors[0]?.code, 'required-module-failed', 'later required failure should emit a fatal structured error');
  equal(errors[0]?.recoverable, false, 'required failure should not claim recovery');
  equal(tick.platform.pendingFrames, 0, 'fatal session should stop scheduling runtime work');
  let fatal: unknown;
  try { await session.exportDocument(); } catch (error) { fatal = error; }
  assert(fatal instanceof GraphRequiredModuleErrorV1, 'fatal session should reject subsequent operations');
  await session.dispose();
});

test('R-MODULE-04 rejects dependency conflicts before mounting a session', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  registry.register(definition('left', 250, {}, { conflicts: ['right'] }));
  registry.register(definition('right', 260, {}));
  const value = runtimeHarness({
    modules: registry,
    registration: withModules({ left: { policy: 'required' }, right: { policy: 'required' } }),
  });
  let failure: unknown;
  try { await value.create(); } catch (error) { failure = error; }
  assert(failure instanceof GraphSessionProfileErrorV1, 'conflicting required modules should fail profile activation');
  equal(value.container.children.length, 0, 'module graph failure should occur before surface activation');

  const cyclicRegistry = createShippedGraphModuleRegistryV1();
  cyclicRegistry.register(definition('cycle-a', 250, {}, { dependencies: ['cycle-b'] }));
  cyclicRegistry.register(definition('cycle-b', 260, {}, { dependencies: ['cycle-a'] }));
  const cyclic = runtimeHarness({
    modules: cyclicRegistry,
    registration: withModules({ 'cycle-a': { policy: 'required' }, 'cycle-b': { policy: 'required' } }),
  });
  let cycleFailure: unknown;
  try { await cyclic.create(); } catch (error) { cycleFailure = error; }
  assert(cycleFailure instanceof GraphSessionProfileErrorV1, 'cyclic module dependencies should fail profile activation');
  equal(cyclic.container.children.length, 0, 'dependency cycle should fail before mounting');

  const withoutRendering = runtimeRegistration();
  const noRender = runtimeHarness({
    registration: {
      ...withoutRendering,
      profiles: withoutRendering.profiles.map((profile) => ({
        ...profile,
        modules: { ...profile.modules, rendering: { policy: 'forbidden' } },
      })),
    },
  });
  let renderingFailure: unknown;
  try { await noRender.create(); } catch (error) { renderingFailure = error; }
  assert(renderingFailure instanceof GraphSessionProfileErrorV1, 'mounted sessions should require explicit rendering, camera, and input capability');
  equal(noRender.container.children.length, 0, 'missing base capability should fail before mounting');
});

test('R-MODULE-05 orders hooks deterministically and disposes modules in reverse', async () => {
  const log: string[] = [];
  const registry = createShippedGraphModuleRegistryV1();
  registry.register(definition('first', 280, lifecycle('first', log)));
  registry.register(definition('second', 200, lifecycle('second', log), { dependencies: ['first'] }));
  const value = runtimeHarness({
    modules: registry,
    registration: withModules({ first: { policy: 'required' }, second: { policy: 'required' } }),
  });
  const session = await value.create();
  const setupEntries = log.filter((entry) => entry.endsWith(':setup'));
  deepEqual(setupEntries, ['first:setup', 'second:setup'], 'dependency ordering should win over numeric order');
  const firstFrame = log.indexOf('first:frame');
  const secondFrame = log.indexOf('second:frame');
  assert(firstFrame >= 0 && secondFrame > firstFrame, 'frame contributions should follow deterministic module order');
  log.length = 0;
  await session.dispose();
  deepEqual(log.filter((entry) => entry.endsWith(':dispose')), ['second:dispose', 'first:dispose'], 'disposal should reverse activation order');
});

test('R-MODULE-06 updates one module without remounting the graph session', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  const updates: number[] = [];
  let instances = 0;
  registry.register({
    order: 250,
    descriptor: {
      id: 'live-settings',
      version: '1.0.0',
      displayName: 'Live settings',
      capabilities: ['live-settings'],
      settingsSchemaVersion: 1,
      defaultSettings: { strength: 1 },
    },
    create: ({ settings }) => {
      instances += 1;
      updates.push(settings.strength as number);
      return { updateSettings: (next) => updates.push(next.strength as number) };
    },
  });
  const value = runtimeHarness({
    modules: registry,
    registration: withModules({ 'live-settings': { policy: 'optional', defaultEnabled: true } }),
  });
  const session = await value.create();
  const surface = runtimeSurface(value.container);
  const canvas = runtimeCanvas(value.container);
  await session.setSessionOverrides({ modules: { 'live-settings': { settings: { strength: 4 } } } });
  equal(instances, 1, 'a live-capable module should retain its instance');
  deepEqual(updates, [1, 4], 'the module should receive its effective setting update');
  equal(runtimeSurface(value.container), surface, 'settings must preserve the mounted session surface');
  equal(runtimeCanvas(value.container), canvas, 'settings must preserve the canvas identity');
  const effective = await session.exportEffectiveSettings();
  equal(effective.modules['live-settings']?.settings.strength, 4, 'the session should export its new effective value');
  equal(effective.modules['live-settings']?.settingSources.strength, 'session', 'the effective snapshot should expose the winning settings layer');
  await session.setSessionOverrides({ modules: { 'live-settings': { enabled: false } } });
  equal((await session.exportEffectiveSettings()).modules['live-settings']?.enabled, false, 'module disable should update the effective snapshot');
  await session.setSessionOverrides({ modules: { 'live-settings': { enabled: true, settings: { strength: 2 } } } });
  equal(instances, 2, 're-enabling should construct only the affected module');
  equal(runtimeCanvas(value.container), canvas, 'module replacement must still preserve the canvas');
  await session.dispose();
});

test('R-MOUNT-06 failed dimension construction rolls back to the active runtime', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  let disposals = 0;
  registry.register({
    order: 250,
    descriptor: {
      id: 'two-d-only-runtime',
      version: '1.0.0',
      displayName: 'Two dimensional runtime',
      capabilities: ['two-d-only-runtime'],
      settingsSchemaVersion: 1,
      defaultSettings: {},
    },
    create: ({ dimensions }) => ({
      setup: () => { if (dimensions === '3d') throw new Error('3d construction rejected'); },
      dispose: () => { disposals += 1; },
    }),
  });
  const value = runtimeHarness({
    modules: registry,
    registration: withModules({ 'two-d-only-runtime': { policy: 'required' } }),
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', { dimensions: '3d' });
  let failed = false;
  try { value.factory.refreshActiveProfiles(); } catch (error) {
    failed = error instanceof GraphRequiredModuleErrorV1;
  }
  equal(failed, true, 'required destination construction failure should reject the switch');
  equal((await session.exportViewState()).dimensions, '2d', 'the active session should retain its prior dimension');
  equal(runtimeCanvas(value.container), canvas, 'failed construction should preserve the active canvas');
  equal(value.platform.pendingFrames, 1, 'failed construction should leave the prior runtime scheduled');
  equal(disposals, 1, 'only the failed replacement instance should be disposed before session teardown');
  await session.dispose();
  equal(disposals, 2, 'the retained active instance should dispose with the session');
});

test('R-FORM-01..03 keeps 2d Form planar and gives 3d Form deterministic branch depth', () => {
  const document = graphDocument({
    nodes: ['root', 'left', 'right', 'left-child', 'right-child', 'right-leaf'].map((id) => graphNode(id)),
    edges: [
      graphEdge('root-left', 'root', 'left'),
      graphEdge('root-right', 'root', 'right'),
      graphEdge('left-child', 'left', 'left-child'),
      graphEdge('right-child', 'right', 'right-child'),
      graphEdge('right-leaf', 'right-child', 'right-leaf'),
    ],
  });
  const positions = Object.fromEntries(document.nodes.map((node) => [node.id, { x: 0, y: 0, z: 0 }]));
  const viewState = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'synthetic-consumer',
    profileId: 'default',
    dimensions: '2d' as const,
    positions,
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: 'orthographic' as const,
    },
    selectedNodeIds: ['root'],
    focusedNodeId: 'root',
    activeFilters: {},
    moduleState: {},
  };
  const selection = {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
  const pipeline = {
    sourceDocument: document,
    document,
    viewState,
    positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    nodeRoles: {},
    edgeRoles: {},
    regions: [],
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
  const settings = { rootNodeId: 'root', ringSpacing: 100, showCrossLinks: true } as const;
  const planar = new FormModule('2d', settings).projectTopology(pipeline);
  const spatial = new FormModule('3d', settings).projectTopology({
    ...pipeline,
    viewState: { ...viewState, dimensions: '3d', camera: { ...viewState.camera, projection: 'perspective' } },
  });
  const repeated = new FormModule('3d', settings).projectTopology({
    ...pipeline,
    viewState: { ...viewState, dimensions: '3d', camera: { ...viewState.camera, projection: 'perspective' } },
  });
  assert(planar?.positions && spatial?.positions && repeated?.positions, 'Form should produce positions in both dimensions');
  equal(Object.values(planar.positions).every((position) => position.z === 0), true, '2d Form must remain planar');
  const spatialDepths = Object.values(spatial.positions).map((position) => position.z);
  assert(new Set(spatialDepths.map((value) => value.toFixed(6))).size >= 4, '3d Form should create several distinct depth planes');
  assert(Math.max(...spatialDepths) - Math.min(...spatialDepths) > 50, '3d branch separation should be visually meaningful');
  deepEqual(spatial.positions, repeated.positions, '3d Form placement should be deterministic');
  deepEqual(spatial.document, planar.document, 'dimension should not alter the Form topology');
  deepEqual(spatial.positions.root, { x: 0, y: 0, z: 0 }, 'the selected root should remain the Form origin');
});

test('L-LINEAR-01 builds a deterministic directed branch from the first node at the origin', () => {
  const document = graphDocument({
    nodes: ['root', 'left', 'right', 'join', 'tail'].map((id) => graphNode(id)),
    edges: [
      graphEdge('root-left', 'root', 'left', { directed: true }),
      graphEdge('root-right', 'root', 'right', { directed: true }),
      graphEdge('left-join', 'left', 'join', { directed: true }),
      graphEdge('right-join', 'right', 'join', { directed: true }),
      graphEdge('join-tail', 'join', 'tail', { directed: true }),
    ],
  });
  const settings = {
    buildDirection: 'up' as const,
    layerSpacing: 100,
    branchSpacing: 80,
    componentSpacing: 300,
  };
  const first = buildLinearBuildOutPositionsV1(document, '2d', settings);
  const repeated = buildLinearBuildOutPositionsV1(document, '2d', settings);
  deepEqual(first.root, { x: 0, y: 0, z: 0 }, 'the first supplied node should be the origin');
  deepEqual(first.left, { x: -40, y: -100, z: 0 }, 'the first branch should occupy the first outward layer');
  deepEqual(first.right, { x: 40, y: -100, z: 0 }, 'siblings should straddle the build axis');
  deepEqual(first.join, { x: 0, y: -200, z: 0 }, 'a join should follow the deepest prerequisite layer');
  deepEqual(first.tail, { x: 0, y: -300, z: 0 }, 'later nodes should continue along the selected axis');
  deepEqual(repeated, first, 'unchanged documents should receive byte-stable positions');
});

test('L-LINEAR-02 supports every planar direction plus 3d in and out', () => {
  const document = graphDocument({
    nodes: ['origin', 'next'].map((id) => graphNode(id)),
    edges: [graphEdge('origin-next', 'origin', 'next', { directed: true })],
  });
  const position = (dimensions: '2d' | '3d', buildDirection: 'up' | 'down' | 'left' | 'right' | 'in' | 'out') =>
    buildLinearBuildOutPositionsV1(document, dimensions, {
      buildDirection,
      layerSpacing: 90,
      branchSpacing: 60,
      componentSpacing: 240,
    });
  deepEqual(position('2d', 'up').next, { x: 0, y: -90, z: 0 }, 'up should use negative screen Y');
  deepEqual(position('2d', 'down').next, { x: 0, y: 90, z: 0 }, 'down should use positive screen Y');
  deepEqual(position('2d', 'left').next, { x: -90, y: 0, z: 0 }, 'left should use negative X');
  deepEqual(position('2d', 'right').next, { x: 90, y: 0, z: 0 }, 'right should use positive X');
  deepEqual(position('3d', 'in').next, { x: 0, y: 0, z: -90 }, 'in should build away from the camera');
  deepEqual(position('3d', 'out').next, { x: 0, y: 0, z: 90 }, 'out should build toward the camera');
  let invalid: unknown;
  try { readLinearBuildOutLayoutSettingsV1('2d', { buildDirection: 'in' }); } catch (error) { invalid = error; }
  assert(String(invalid).includes('requires a 3D profile'), '2d profiles should reject depth-axis directions clearly');
});

test('L-LINEAR-03 ships Linear build-out as a force- and Form-exclusive layout capability', () => {
  const descriptor = createShippedGraphModuleRegistryV1().descriptors()
    .find((candidate) => candidate.id === 'linear-layout');
  equal(descriptor?.displayName, 'Linear build-out', 'the shipped layout should use the public product name');
  deepEqual(descriptor?.capabilities, ['layout', 'linear-layout'], 'consumers should request a neutral linear capability');
  deepEqual(descriptor?.conflicts, ['form', 'force-layout'], 'derived linear positions should not mix with other position owners');
  equal(descriptor?.defaultSettings.buildDirection, 'right', 'the generic default should build in reading direction');
});

test('L-LINEAR-04 initializes an editable build-out without pinning or reflowing later', async () => {
  const document = graphDocument({
    nodes: ['root', 'left', 'right', 'join'].map((id) => graphNode(id)),
    edges: [
      graphEdge('root-left', 'root', 'left', { directed: true }),
      graphEdge('root-right', 'root', 'right', { directed: true }),
      graphEdge('left-join', 'left', 'join', { directed: true }),
      graphEdge('right-join', 'right', 'join', { directed: true }),
    ],
  });
  const registration = withModules({
      form: { policy: 'forbidden' },
      'linear-layout': {
        policy: 'required',
        defaults: { buildDirection: 'up', layerSpacing: 100, branchSpacing: 80 },
      },
      'force-layout': { policy: 'forbidden' },
    });
  const value = runtimeHarness({
    document,
    registration,
  });
  const session = await value.create();
  await session.fitNodes();
  const fitted = await session.exportViewState();
  equal(fitted.camera.target.x, 0, 'a balanced branch should fit on the build axis');
  equal(fitted.camera.target.y, -100, 'camera fitting should use derived origin-to-join positions');
  equal(fitted.camera.target.z, 0, 'a 2d Linear build-out should remain planar');

  await session.focusNode('join');
  deepEqual(
    (await session.exportViewState()).camera.target,
    { x: 0, y: -200, z: 0 },
    'Focus should recenter onto the projected Linear subject without changing its layout',
  );
  await session.focusNode(null);
  await session.fitNodes();

  const beforeDrag = await session.exportViewState();
  const camera = new GraphCameraController(beforeDrag.camera, '2d');
  camera.setViewport(640, 360);
  const branchPoint = camera.worldToScreen({ x: -40, y: -100, z: 0 });
  const canvas = runtimeCanvas(value.container);
  pointer(value, canvas, 'pointerdown', branchPoint.x, branchPoint.y, 41);
  pointer(value, canvas, 'pointermove', branchPoint.x + 36, branchPoint.y + 24, 41);
  value.platform.flushFrame();
  pointer(value, canvas, 'pointerup', branchPoint.x + 36, branchPoint.y + 24, 41);
  value.platform.flushFrame();

  const dragged = await session.exportViewState();
  assert(!dragged.pinnedNodeIds.includes('left'), 'initial Linear build-out placement should not leave dragged nodes pinned');
  deepEqual(
    dragged.positions.join,
    beforeDrag.positions.join,
    'dragging one node should not alter any other editable position',
  );
  await session.fitNodes(['join']);
  deepEqual(
    (await session.exportViewState()).camera.target,
    { x: 0, y: -200, z: 0 },
    'dragging one node must not replace the remaining projected layout',
  );
  await session.restoreViewState(dragged);
  await session.fitNodes(['left']);
  deepEqual(
    (await session.exportViewState()).camera.target,
    dragged.positions.left,
    'a manual adjustment should survive restore without reapplying the initial layout',
  );
  await session.dispose();
});

test('shipped Filter, Form, force layout, and palette contributions stay domain-neutral', async () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', { positionHint: { x: 10, y: 20, z: 0 }, tokens: ['keep'] }),
      graphNode('b', { positionHint: { x: 30, y: 40, z: 0 }, tokens: ['keep'] }),
      graphNode('c', { positionHint: { x: 50, y: 60, z: 0 }, tokens: ['keep'] }),
    ],
    edges: [
      graphEdge('a-b', 'a', 'b'),
      graphEdge('a-c', 'a', 'c'),
      graphEdge('b-c', 'b', 'c'),
    ],
  });
  const form = runtimeHarness({
    document,
    resolveThemePalette: () => ({
      ...DEFAULT_GRAPH_RENDER_THEME_V1,
      colors: {
        ...DEFAULT_GRAPH_RENDER_THEME_V1.colors,
        node: parseGraphColorV2('#123456')!,
        selectedNode: parseGraphColorV2('#234567')!,
        focusedNode: parseGraphColorV2('#345678')!,
        edge: parseGraphColorV2('#456789')!,
        label: parseGraphColorV2('#56789a')!,
      },
      labelFont: { ...DEFAULT_GRAPH_RENDER_THEME_V1.labelFont, sizePx: 13, family: 'serif' },
    }),
  });
  form.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: {
      form: { enabled: true, settings: { rootNodeId: 'a', showCrossLinks: false, ringSpacing: 90 } },
    },
  });
  const formSession = await form.create();
  equal(runtimeSurface(form.container).dataset.projectedEdgeCount, '2', 'Form should omit the generic cross-link from its projection');
  equal((await formSession.exportDocument()).edges.length, 3, 'Form must not mutate the canonical consumer document');
  deepEqual((await formSession.exportViewState()).positions.a, { x: 10, y: 20, z: 0 }, 'Form must preserve the free-layout position for persistence');
  assert(form.styleAssignments.includes('fillStyle:rgb(18, 52, 86)'), 'rendering module should consume an injected host-neutral palette');
  await formSession.dispose();

  const force = runtimeHarness({ document });
  force.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: { 'force-layout': { enabled: true } },
  });
  const forceSession = await force.create();
  const before = await forceSession.exportViewState();
  for (let index = 1; index <= 5; index += 1) force.platform.flushFrame(index * 17);
  const after = await forceSession.exportViewState();
  assert(JSON.stringify(before.positions) !== JSON.stringify(after.positions), 'force layout should evolve generic positions without Anima');
  for (let index = 6; index <= 360; index += 1) force.platform.flushFrame(index * 17);
  const settled = await forceSession.exportViewState();
  const settledDrawCount = force.drawCalls.length;
  for (let index = 361; index <= 380; index += 1) force.platform.flushFrame(index * 17);
  deepEqual((await forceSession.exportViewState()).positions, settled.positions, 'cooled force layout should stop changing positions');
  equal(force.drawCalls.length, settledDrawCount, 'settled graphs should not redraw unchanged frames');
  const forceDescriptor = createShippedGraphModuleRegistryV1().descriptors().find((descriptor) => descriptor.id === 'force-layout');
  deepEqual(forceDescriptor?.dependencies ?? [], [], 'force layout must have no Anima dependency');
  await forceSession.dispose();

  const base = runtimeRegistration();
  const withoutFilter = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        modules: { ...profile.modules, filtering: { policy: 'forbidden' } },
      })),
    },
  });
  const withoutFilterSession = await withoutFilter.create();
  let filteringUnavailable = false;
  try {
    await withoutFilterSession.applyFilter({ schemaVersion: 1, scope: 'render', node: { op: 'has-token', token: 'keep' } });
  } catch {
    filteringUnavailable = true;
  }
  equal(filteringUnavailable, true, 'public filtering should be governed by the active module profile');
  await withoutFilterSession.dispose();
});

test('C-SETTING-02 topology weighting is the only shipped free-layout mode', () => {
  const descriptor = createShippedGraphModuleRegistryV1().descriptors()
    .find((candidate) => candidate.id === 'force-layout');
  equal(descriptor?.defaultSettings.weightingMode, undefined, 'the retired mode selector should not remain in shipped settings');
  equal(descriptor?.defaultSettings.springLength, 250, 'the weighted baseline should use the native-motion ordinary distance');
});

test('L-COMPONENT-01 weighted component centering separates islands', async () => {
  const document = graphDocument({
    nodes: ['a', 'b', 'c'].map((id) => graphNode(id, { positionHint: { x: 0, y: 0, z: 0 } })),
    edges: [],
  });
  const value = runtimeHarness({ document });
  value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: {
      'force-layout': {
        enabled: true,
        settings: {
          repulsionStrength: 0,
          springStrength: 0,
          centeringStrength: 0.02,
          alphaDecay: 0.02,
        },
      },
    },
  });
  const session = await value.create();
  for (let index = 1; index <= 40; index += 1) value.platform.flushFrame(index * 17);
  const packed = await session.exportViewState();
  assert(Math.hypot(packed.positions.b.x, packed.positions.b.y) > 20, 'a disconnected component should move toward its own packing target');
  assert(Math.hypot(packed.positions.c.x, packed.positions.c.y) > 20, 'each isolated node should remain a packable component');
  await session.dispose();
});

test('R-REGION-01 renders live 2d boundaries and hides only the visual layer', async () => {
  const document = graphDocument({
    nodes: [
      graphNode('tag', { positionHint: { x: 0, y: 0, z: 0 } }),
      graphNode('left', { positionHint: { x: -80, y: 30, z: 0 } }),
      graphNode('right', { positionHint: { x: 90, y: -20, z: 0 } }),
    ],
    edges: [],
    nodeRegions: {
      version: 1,
      definitions: [{ regionNodeId: 'tag', directMemberNodeIds: ['left', 'right'] }],
    },
  });
  const value = runtimeHarness({ document });
  value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: { 'node-regions': { enabled: true, settings: { boundariesVisible: true } } },
  });
  const session = await value.create();
  assert(value.drawCalls.includes('quadraticCurveTo'), 'an enabled 2d region should draw a non-circular smooth boundary');

  value.drawCalls.length = 0;
  await session.setSessionOverrides({
    modules: { 'node-regions': { enabled: true, settings: { boundariesVisible: false } } },
  });
  value.platform.flushFrame();
  equal(value.drawCalls.includes('quadraticCurveTo'), false, 'the boundary setting should remove only region drawing');
  equal((await session.exportEffectiveSettings()).modules['node-regions']?.settings.boundariesVisible, false, 'the effective profile should retain the quick-setting value');

  value.drawCalls.length = 0;
  await session.setSessionOverrides({
    modules: { 'node-regions': { enabled: true, settings: { boundariesVisible: true } } },
  });
  value.platform.flushFrame();
  assert(value.drawCalls.includes('quadraticCurveTo'), 'restoring boundaries should derive a fresh contour from current graph state');
  await session.dispose();
});

test('R-REGION-02 membership forces remain active when boundaries are hidden', async () => {
  const document = graphDocument({
    nodes: [
      graphNode('tag', { positionHint: { x: -120, y: 0, z: 0 } }),
      graphNode('note', { positionHint: { x: 120, y: 0, z: 0 } }),
    ],
    edges: [],
    nodeRegions: {
      version: 1,
      definitions: [{ regionNodeId: 'tag', directMemberNodeIds: ['note'] }],
    },
  });
  const value = runtimeHarness({ document });
  value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: {
      'node-regions': {
        enabled: true,
        settings: { boundariesVisible: false, membershipStrength: 1, membershipDistance: 30 },
      },
      'force-layout': {
        enabled: true,
        settings: { repulsionStrength: 0, springStrength: 0, centeringStrength: 0 },
      },
    },
  });
  const session = await value.create();
  const before = await session.exportViewState();
  for (let index = 1; index <= 20; index += 1) value.platform.flushFrame(index * 17);
  const after = await session.exportViewState();
  const beforeDistance = Math.abs(before.positions.note.x - before.positions.tag.x);
  const afterDistance = Math.abs(after.positions.note.x - after.positions.tag.x);
  assert(afterDistance < beforeDistance, 'direct membership should pull the tag and its member closer together');
  equal(value.drawCalls.includes('quadraticCurveTo'), false, 'hidden boundaries should stay absent while membership forces run');
  await session.dispose();
});

test('R-REGION-03 optional regions are inert in 3d and required regions reject clearly', async () => {
  const document = graphDocument({
    nodes: [graphNode('tag'), graphNode('note')],
    edges: [],
    nodeRegions: {
      version: 1,
      definitions: [{ regionNodeId: 'tag', directMemberNodeIds: ['note'] }],
    },
  });
  const optional = runtimeHarness({ profileId: 'three-dimensional', document });
  optional.profiles.setUserOverrides('synthetic-consumer', 'three-dimensional', {
    modules: { 'node-regions': { enabled: true } },
  });
  const optionalSession = await optional.create();
  equal(optional.drawCalls.includes('quadraticCurveTo'), false, 'optional regions should contribute no 3d boundary');
  await optionalSession.dispose();

  const required = runtimeHarness({
    profileId: 'three-dimensional',
    document,
    registration: withModules({ 'node-regions': { policy: 'required' } }),
  });
  let failure: unknown;
  try { await required.create(); } catch (error) { failure = error; }
  assert(failure instanceof GraphSessionProfileErrorV1, 'a required 3d node-region profile should fail before mounting');
  assert(String(failure).includes('available only in 2D'), 'the policy failure should explain the dimensional boundary');
});

function withModules(
  modules: ConsumerRegistrationV1['profiles'][number]['modules'],
): ConsumerRegistrationV1 {
  const base = runtimeRegistration();
  return {
    ...base,
    profiles: base.profiles.map((profile) => ({
      ...profile,
      modules: { ...profile.modules, ...modules },
    })),
  };
}

function definition(
  id: string,
  order: number,
  instance: ReturnType<typeof lifecycle> | Record<string, (...args: never[]) => unknown>,
  descriptor: { readonly dependencies?: readonly string[]; readonly conflicts?: readonly string[] } = {},
) {
  return {
    order,
    descriptor: {
      id,
      version: '1.0.0',
      displayName: id,
      capabilities: [id],
      settingsSchemaVersion: 1,
      defaultSettings: {},
      ...descriptor,
    },
    create: () => instance,
  };
}

function lifecycle(id: string, log: string[]) {
  return {
    setup: () => log.push(`${id}:setup`),
    contributeFrame: () => { log.push(`${id}:frame`); },
    setSuspended: (suspended: boolean) => log.push(`${id}:suspend:${String(suspended)}`),
    dispose: () => log.push(`${id}:dispose`),
  };
}

function pointer(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  pointerId: number,
): void {
  const event = new value.window.PointerEvent(type, {
    clientX,
    clientY,
    pointerId,
    pointerType: 'mouse',
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'button', { value: 0 });
  canvas.dispatchEvent(event as unknown as Event);
}


test('uncached module patches may reuse a working record without freezing changed hit shapes', async () => {
  const registry = createShippedGraphModuleRegistryV1();
  const nodes: Record<string, { radius: number }> = { a: { radius: 8 } };
  registry.register(definition('working-presentation', 600, {
    contributeFrame: () => ({ nodeContributions: nodes }),
  }));
  const value = runtimeHarness({ modules: registry, registration: withModules({ 'working-presentation': { policy: 'required' } }) });
  const session = await value.create();
  try {
    const probe = session as unknown as { moduleHost: GraphModuleHost; moduleView: GraphModulePresentationStateV1 };
    const input = { ...probe.moduleView, nodeContributions: {}, edgeContributions: {} };
    equal(probe.moduleHost.contribute(input).nodeContributions.a.radius, 8, 'initial radius is contributed');
    nodes.a = { radius: 20 };
    equal(probe.moduleHost.contribute(input).nodeContributions.a.radius, 20, 'reusing a patch record preserves changed radius');
  } finally { await session.dispose(); }
});
