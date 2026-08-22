import type {
  ConsumerRegistrationV1,
  GraphSessionErrorV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import {
  createShippedGraphModuleRegistryV1,
  GraphModuleRegistry,
  GraphRequiredModuleErrorV1,
  GraphSessionProfileErrorV1,
} from '../../src/graph-engine/runtime/index.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeHarness, runtimeRegistration, runtimeSurface } from '../support/runtimeHarness.ts';

test('R-MODULE-01 keeps optional Anima inert and round-trips its empty state', async () => {
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
  equal(errors[0]?.moduleId, 'anima', 'invalid optional module state should report the affected module');
  equal(errors[0]?.recoverable, true, 'invalid optional state should disable only that module');
  equal((await recovered.exportViewState()).moduleState.anima, undefined, 'rejected optional state should not persist into the next save');
  await recovered.dispose();
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
  equal(first.platform.pendingFrames, 1, 'optional failure should leave the required runtime active');
  first.platform.flushFrame();
  equal(firstErrors.filter((error) => error.moduleId === 'fragile').length, 1, 'disabled optional module should not run again');

  const second = runtimeHarness({ modules: registry, registration });
  const secondSession = await second.create();
  const secondErrors: GraphSessionErrorV1[] = [];
  secondSession.onError((error) => secondErrors.push(error));
  second.platform.flushFrame();
  assert(!secondErrors.some((error) => error.moduleId === 'fragile'), 'one session failure must not disable another module instance');
  equal(second.platform.pendingFrames, 1, 'unaffected session should continue rendering');
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
      backgroundColor: 'transparent',
      nodeColor: '#123456',
      selectedNodeColor: '#234567',
      focusedNodeColor: '#345678',
      edgeColor: '#456789',
      labelColor: '#56789a',
      labelFont: '13px serif',
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
  assert(form.styleAssignments.includes('fillStyle:#123456'), 'rendering module should consume an injected host-neutral palette');
  await formSession.dispose();

  const force = runtimeHarness({ document });
  force.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
    modules: { 'force-layout': { enabled: true } },
  });
  const forceSession = await force.create();
  const before = await forceSession.exportViewState();
  for (let index = 1; index <= 5; index += 1) force.platform.flushFrame(index * 16);
  const after = await forceSession.exportViewState();
  assert(JSON.stringify(before.positions) !== JSON.stringify(after.positions), 'force layout should evolve generic positions without Anima');
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
