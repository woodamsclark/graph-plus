import type {
  GraphIntentV1,
  GraphSessionV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/index.ts';
import { ConsumerNodeActionRegistryV1 } from '../../src/graph-engine/service/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import {
  runtimeCanvas,
  runtimeHarness,
  runtimeRegistration,
} from '../support/runtimeHarness.ts';

test('R-INPUT-01 pans an unfocused wheel and orbits a focused 3d graph', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const viewportIntents: GraphIntentV1[] = [];
  session.onIntent((intent) => {
    if (intent.type === 'viewport-changed') viewportIntents.push(intent);
  });

  const initial = await session.exportViewState();
  wheel(value, canvas, { deltaX: 24, deltaY: 12 });
  value.platform.flushFrame();
  const panned = await session.exportViewState();
  assert(!sameVector(panned.camera.target, initial.camera.target), 'unfocused wheel should move the camera target');
  deepEqual(panned.camera.up, initial.camera.up, 'unfocused wheel should not change camera orientation');

  await session.focusNode('a');
  const focused = await session.exportViewState();
  wheel(value, canvas, { deltaX: 24, deltaY: 12 });
  value.platform.flushFrame();
  const orbited = await session.exportViewState();
  deepEqual(orbited.camera.target, focused.camera.target, 'focused orbit should retain its node target');
  assert(!sameVector(orbited.camera.position, focused.camera.position), 'focused wheel should orbit the camera position');
  assert(viewportIntents.length >= 2, 'both wheel navigation modes should emit viewport intents');

  await session.restoreViewState(focused);
  pointer(value, canvas, 'pointerdown', 320, 180, { pointerId: 91, button: 2 });
  pointer(value, canvas, 'pointermove', 296, 168, { pointerId: 91, button: 2 });
  value.platform.flushFrame();
  const rightDragged = await session.exportViewState();
  assert(vectorDistance(rightDragged.camera.position, orbited.camera.position) < 0.000001, 'trackpad orbit should match the equivalent secondary-button drag');
  pointer(value, canvas, 'pointerup', 296, 168, { pointerId: 91, button: 2 });

  await session.restoreViewState(orbited);
  const zoomBefore = orbited.camera.zoom;
  const distanceBefore = vectorDistance(orbited.camera.position, orbited.camera.target);
  wheel(value, canvas, { deltaY: -30, ctrlKey: true });
  value.platform.flushFrame();
  const zoomed = await session.exportViewState();
  equal(zoomed.camera.zoom, zoomBefore, 'modified scroll should retain the standard perspective focal length');
  const distanceAfter = vectorDistance(zoomed.camera.position, zoomed.camera.target);
  assert(distanceAfter < distanceBefore, 'modified scroll should use the standard perspective dolly');
  deepEqual(zoomed.camera.target, orbited.camera.target, 'standard zoom should stay aimed at the focused target');
  await session.dispose();
});

test('focused wheel zoom anchors to the focused node instead of the pointer', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional'] as const) {
    const value = runtimeHarness({ profileId });
    const session = await value.create();
    const canvas = runtimeCanvas(value.container);
    await session.focusNode('a');
    const before = await session.exportViewState();
    wheel(value, canvas, { x: 20, y: 20, deltaY: -60, ctrlKey: true });
    value.platform.flushFrame();
    const after = await session.exportViewState();
    deepEqual(after.camera.target, before.camera.target,
      `${profileId} focused zoom should retain the focused node as its camera target`);
    await session.dispose();
  }
});

test('desktop trackpad pinch carries bounded momentum and ordinary wheel input cancels it', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const before = await session.exportViewState();

  wheel(value, canvas, { x: 260, y: 140, deltaY: -1, ctrlKey: true });
  value.platform.flushFrame();
  const afterPinch = await session.exportViewState();
  assert(afterPinch.camera.zoom > before.camera.zoom, 'trackpad pinch should zoom immediately');
  equal(value.platform.pendingTimers, 1, 'trackpad pinch should wait briefly before beginning momentum');

  value.platform.flushTimer();
  value.platform.flushFrame();
  const afterMomentum = await session.exportViewState();
  assert(afterMomentum.camera.zoom > afterPinch.camera.zoom,
    'trackpad pinch momentum should continue zooming in the original direction');

  wheel(value, canvas, { deltaY: 1 });
  value.platform.flushFrame();
  equal(value.platform.pendingTimers, 0, 'ordinary wheel input should cancel trackpad pinch momentum');
  await session.dispose();
});

test('camera reset input preserves focus and announces focused reframing', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  await session.focusNode('a');
  key(value, canvas, '0');
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, 'a', 'camera reset must retain active focus');
  const reset = [...intents].reverse().find((intent) => intent.type === 'camera-reset');
  equal(reset?.type === 'camera-reset' ? reset.focusedNodeId : undefined, 'a',
    'camera reset should request consumer neighbor-aware framing for the focused node');
  await session.dispose();
});

test('a focused camera follows its node while the force layout settles', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  value.profiles.setUserOverrides('synthetic-consumer', 'three-dimensional', {
    modules: {
      'force-layout': {
        enabled: true,
        settings: {
          repulsionStrength: 0,
          springStrength: 0,
          centeringStrength: 0.5,
          collisionStrength: 0,
          velocityDecay: 0,
        },
      },
    },
  });
  const session = await value.create();
  await session.focusNode('a');
  const before = await session.exportViewState();
  value.platform.flushFrame();
  const after = await session.exportViewState();

  assert(!sameVector(after.positions.a, before.positions.a), 'the fixture node should move during force settling');
  equal(after.focusedNodeId, 'a', 'force settling must preserve focus identity');
  assert(vectorDistance(after.camera.target, after.positions.a) < 0.000001,
    'the camera target should remain attached to the moving focused node');
  await session.dispose();
});

test('V1.2 coalesces camera input and hover without graph-wide recomputation', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  await session.resetPerformanceMeasurements();

  for (let index = 0; index < 100; index += 1) wheel(value, canvas, { deltaX: 1, deltaY: 0 });
  value.platform.flushFrame();
  const camera = await session.exportPerformanceSnapshot();
  equal(camera.counters?.projectionPasses, 0, 'camera input must not rerun the module projection pipeline');
  equal(camera.counters?.frameCompositions, 0, 'camera input must reuse the existing render frame');
  equal(camera.counters?.documentExports, 0, 'camera identity checks must not export the document');
  equal(intents.filter((intent) => intent.type === 'viewport-changed').length, 1, 'adjacent camera deltas should coalesce into one committed camera command');

  await session.resetPerformanceMeasurements();
  for (let index = 0; index < 100; index += 1) {
    pointer(value, canvas, 'pointermove', 320 + index / 100, 180, { pointerId: 500 });
  }
  value.platform.flushFrame();
  const hover = await session.exportPerformanceSnapshot();
  equal(hover.counters?.hitTests, 1, 'raw hover moves should perform at most one indexed hit test per frame');
  equal(hover.counters?.projectionPasses, 0, 'hover must not rerun the module projection pipeline');
  await session.dispose();
});

test('a background tap clears stale hover even when focus is already empty', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');
  pointer(value, canvas, 'pointermove', point.x, point.y, { pointerId: 501 });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'the fixture should begin with a hovered node');
  click(value, canvas, { x: -100, y: -100 }, { pointerId: 502 });
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, undefined, 'the fixture should remain unfocused');
  assert(canvas.style.cursor.includes('data:image/svg+xml'),
    'background activation should restore the idle donut cursor independently of focus state');
  await session.dispose();
});

test('R-INPUT-03, R-INPUT-04, and R-INPUT-08 use focus-state consumer activation', async () => {
  let actionRuns = 0;
  const actions = new ConsumerNodeActionRegistryV1();
  actions.register('synthetic-consumer', {}, [{
    id: 'open-node',
    label: 'Open node',
    run: () => { actionRuns += 1; },
  }]);
  const base = runtimeRegistration();
  const value = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        interaction: { activationActionIds: ['open-node'] },
      })),
    },
    nodeActions: actions.runtimeFor('synthetic-consumer'),
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  const point = await nodePoint(session, 'a');

  click(value, canvas, point, { pointerId: 1 });
  value.platform.flushFrame();
  equal(intents.filter((intent) => intent.type === 'selection-changed').length, 1, 'single click should emit one selection intent');
  equal(intents.filter((intent) => intent.type === 'focus-changed').length, 1, 'single click should emit one focus intent');
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'single click should select its neutral node ID');
  equal((await session.exportViewState()).focusedNodeId, 'a', 'single click should focus its neutral node ID');

  value.platform.advanceTime(5_000);
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 2 });
  value.platform.flushFrame();
  equal(actionRuns, 1, 'a later focused-node click should run the primary action without timing dependence');
  equal(intents.filter((intent) => intent.type === 'node-activated' && intent.activation === 'primary').length, 1, 'focused-node action should emit one primary activation intent');

  value.platform.advanceTime(400);
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 3, button: 2 });
  value.platform.flushFrame();
  const contexts = intents.filter((intent) => intent.type === 'node-context-requested');
  equal(contexts.length, 1, 'secondary click should emit one context request');
  const context = contexts[0];
  assert(context.type === 'node-context-requested', 'context request should narrow structurally');
  equal(context.nodeId, 'a', 'context request should identify its hit-tested node');
  equal(context.modality, 'mouse', 'context request should preserve pointer modality');

  key(value, canvas, 'Enter');
  value.platform.flushFrame();
  equal(actionRuns, 2, 'Enter should invoke the same resolved primary action');
  equal(intents.filter((intent) => intent.type === 'node-activated' && intent.activation === 'keyboard').length, 1, 'Enter should emit one keyboard activation');
  for (const intent of intents) {
    equal(intent.sessionId, session.sessionId, 'intent should identify its session');
    equal(intent.documentId, 'fixture', 'intent should carry neutral document identity');
    equal(intent.documentRevision, 0, 'intent should carry the producing revision');
  }
  await session.dispose();
  actions.dispose();

});

test('R-REGION-04 first tag click selects visible recursive children and second click activates the tag', async () => {
  let actionContext: { nodeId: string; selectedNodeIds: readonly string[]; focusedNodeId?: string } | undefined;
  const actions = new ConsumerNodeActionRegistryV1();
  actions.register('synthetic-consumer', {}, [{
    id: 'study-region',
    label: 'Study region',
    run: (context) => {
      actionContext = {
        nodeId: context.nodeId,
        selectedNodeIds: context.selectedNodeIds,
        ...(context.focusedNodeId ? { focusedNodeId: context.focusedNodeId } : {}),
      };
    },
  }]);
  const base = runtimeRegistration();
  const document = graphDocument({
    nodes: [
      graphNode('tag', { positionHint: { x: 0, y: 0, z: 0 } }),
      graphNode('subtag', { positionHint: { x: -100, y: 0, z: 0 } }),
      graphNode('nested', { positionHint: { x: -160, y: 0, z: 0 } }),
      graphNode('direct', { positionHint: { x: 140, y: 0, z: 0 } }),
      graphNode('hidden', { positionHint: { x: 0, y: 120, z: 0 }, tokens: ['hide'] }),
    ],
    edges: [],
    nodeRegions: {
      version: 1,
      definitions: [
        { regionNodeId: 'tag', directMemberNodeIds: ['subtag', 'direct', 'hidden'] },
        { regionNodeId: 'subtag', directMemberNodeIds: ['nested'] },
      ],
    },
  });
  const value = runtimeHarness({
    document,
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        interaction: { activationActionIds: ['study-region'] },
      })),
    },
    nodeActions: actions.runtimeFor('synthetic-consumer'),
  });
  const session = await value.create();
  await session.applyFilter({
    schemaVersion: 1,
    scope: 'render',
    node: { op: 'not', operand: { op: 'has-token', token: 'hide' } },
  });
  const canvas = runtimeCanvas(value.container);
  click(value, canvas, await nodePoint(session, 'tag'), { pointerId: 201 });
  value.platform.flushFrame();
  const selected = await session.exportViewState();
  deepEqual(selected.selectedNodeIds, ['subtag', 'nested', 'direct'], 'first click should select visible descendants through child tags and exclude the owner');
  equal(selected.focusedNodeId, 'tag', 'the clicked tag node should own focus');
  deepEqual(selected.camera.target, selected.positions.tag,
    'region framing should stay centered on the clicked owner rather than one of its selected descendants');

  click(value, canvas, await nodePoint(session, 'tag'), { pointerId: 202 });
  value.platform.flushFrame();
  deepEqual(actionContext, {
    nodeId: 'tag',
    selectedNodeIds: ['subtag', 'nested', 'direct'],
    focusedNodeId: 'tag',
  }, 'second click should invoke the consumer action with the selected region context');
  await session.dispose();
  actions.dispose();

  const projectionValue = runtimeHarness({ document });
  const projectionSession = await projectionValue.create();
  await projectionSession.applyFilter({
    schemaVersion: 1,
    scope: 'projection',
    node: { op: 'not', operand: { op: 'has-token', token: 'hide' } },
  });
  const projectionCanvas = runtimeCanvas(projectionValue.container);
  click(projectionValue, projectionCanvas, await nodePoint(projectionSession, 'tag'), { pointerId: 203 });
  projectionValue.platform.flushFrame();
  deepEqual((await projectionSession.exportViewState()).selectedNodeIds, ['subtag', 'nested', 'direct'], 'projection filtering should preserve filtered region definitions and visible recursive selection');
  await projectionSession.dispose();
});

test('R-INPUT-10 has no view-action fallback when no consumer action resolves', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  click(value, canvas, point, { pointerId: 101 });
  value.platform.flushFrame();
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 102 });
  value.platform.flushFrame();
  key(value, canvas, 'Enter');
  value.platform.flushFrame();
  equal(intents.filter((intent) => intent.type === 'node-activated').length, 0, 'unregistered actions should produce no activation intent or fallback');
  equal((await session.exportViewState()).pinnedNodeIds.length, 0, 'activation must not fall through to pin');
  await session.dispose();
});

test('R-INPUT-14 isolates busy and rejected consumer actions', async () => {
  let actionRuns = 0;
  let rejectRun: ((error: Error) => void) | undefined;
  const actions = new ConsumerNodeActionRegistryV1();
  actions.register('synthetic-consumer', {}, [{
    id: 'async-action',
    label: 'Async action',
    run: () => {
      actionRuns += 1;
      if (actionRuns > 1) return;
      return new Promise<void>((_resolve, reject) => { rejectRun = reject; });
    },
  }]);
  const base = runtimeRegistration();
  const value = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        interaction: { activationActionIds: ['async-action'] },
      })),
    },
    nodeActions: actions.runtimeFor('synthetic-consumer'),
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const errors: Parameters<Parameters<typeof session.onError>[0]>[0][] = [];
  const intents: GraphIntentV1[] = [];
  session.onError((error) => errors.push(error));
  session.onIntent((intent) => intents.push(intent));
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 111 });
  value.platform.flushFrame();
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 112 });
  value.platform.flushFrame();
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 113 });
  value.platform.flushFrame();
  equal(actionRuns, 1, 'a running action should suppress duplicate activation');
  equal(intents.filter((intent) => intent.type === 'node-activated').length, 1, 'only the started action should emit activation');
  assert(rejectRun, 'first action should expose its controlled rejection');
  rejectRun(new Error('expected action failure'));
  await Promise.resolve();
  await Promise.resolve();
  equal(errors.length, 1, 'rejection should report exactly one local session error');
  equal(errors[0]?.code, 'consumer-action-failed', 'action failure should remain structurally distinct');
  equal(errors[0]?.actionId, 'async-action', 'action failure should identify its consumer action');
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 114 });
  value.platform.flushFrame();
  equal(actionRuns, 2, 'the action should become available again after rejection cleanup');
  await session.dispose();
  actions.dispose();
});

test('R-INPUT-08 ignores repeated, composing, modified, and pre-cancelled Enter', async () => {
  let actionRuns = 0;
  const actions = new ConsumerNodeActionRegistryV1();
  actions.register('synthetic-consumer', {}, [{ id: 'primary', label: 'Primary', run: () => { actionRuns += 1; } }]);
  const base = runtimeRegistration();
  const value = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({ ...profile, interaction: { activationActionIds: ['primary'] } })),
    },
    nodeActions: actions.runtimeFor('synthetic-consumer'),
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.focusNode('a');
  key(value, canvas, 'Enter', { repeat: true });
  key(value, canvas, 'Enter', { composing: true });
  key(value, canvas, 'Enter', { shift: true });
  key(value, canvas, 'Enter', { prevented: true });
  value.platform.flushFrame();
  equal(actionRuns, 0, 'ineligible keyboard events must not invoke consumer actions');
  key(value, canvas, 'Enter');
  value.platform.flushFrame();
  equal(actionRuns, 1, 'one ordinary Enter should invoke once');
  await session.dispose();
  actions.dispose();
});

test('R-INPUT-05 excludes render-filtered and projection-filtered nodes from hit testing', async () => {
  for (const scope of ['render', 'projection'] as const) {
    const value = runtimeHarness();
    const session = await value.create();
    const canvas = runtimeCanvas(value.container);
    const point = await nodePoint(session, 'b');
    const intents: GraphIntentV1[] = [];
    session.onIntent((intent) => intents.push(intent));
    await session.applyFilter({
      schemaVersion: 1,
      scope,
      node: { op: 'has-token', token: 'keep' },
    });
    click(value, canvas, point, { pointerId: 4 });
    value.platform.flushFrame();
    assert(!intents.some((intent) => intent.type === 'node-activated'), `${scope} hidden node must not activate`);
    assert(!intents.some((intent) => intent.type === 'selection-changed' && intent.selectedNodeIds.includes('b')), `${scope} hidden node must not select`);
    equal((await session.exportViewState()).focusedNodeId, undefined, `${scope} hidden node must not focus`);
    await session.dispose();
  }
});

test('R-INPUT-06 updates view position and emits one revision-bearing drag intent', async () => {
  const base = runtimeRegistration();
  const value = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({ ...profile, profileSettings: { dragRelease: 'pin' } })),
    },
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const before = await session.exportViewState();
  const point = await nodePoint(session, 'a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));

  pointer(value, canvas, 'pointermove', point.x, point.y, { pointerId: 5 });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'hovered visible node should use pointer cursor');

  pointer(value, canvas, 'pointerdown', point.x, point.y, { pointerId: 5 });
  pointer(value, canvas, 'pointermove', point.x + 50, point.y + 20, { pointerId: 5 });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'grabbing', 'active node drag should use grabbing cursor');
  pointer(value, canvas, 'pointerup', point.x + 50, point.y + 20, { pointerId: 5 });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'completed drag should return to hovered cursor');

  const after = await session.exportViewState();
  assert(!sameVector(after.positions.a, before.positions.a), 'drag should mutate only the node view position');
  const dragIntents = intents.filter((intent) => intent.type === 'node-drag-ended');
  equal(dragIntents.length, 1, 'drag completion should emit exactly one intent');
  const dragIntent = dragIntents[0];
  assert(dragIntent.type === 'node-drag-ended', 'drag intent should be structurally narrowed');
  deepEqual(dragIntent.position, after.positions.a, 'drag intent should contain the final neutral position');
  equal(dragIntent.documentRevision, 0, 'drag intent should identify its producing revision');
  assert(after.pinnedNodeIds.includes('a'), 'pin release policy should retain the dragged node');
  await session.setNodePinned('a', false);
  assert(!(await session.exportViewState()).pinnedNodeIds.includes('a'), 'public pin control should release the node reversibly');

  await session.applyPatch({
    schemaVersion: 1,
    patchId: 'after-intent',
    baseRevision: 0,
    operations: [{ type: 'add-node', node: graphNode('later') }],
  });
  equal(dragIntent.documentRevision, 0, 'previous intent should remain revision-stable after a document patch');
  await session.dispose();
});

test('pointer background drags pan in 2d and secondary-drag orbits in 3d', async () => {
  const twoD = runtimeHarness();
  const twoDSession = await twoD.create();
  const twoDCanvas = runtimeCanvas(twoD.container);
  const twoDBefore = await twoDSession.exportViewState();
  pointer(twoD, twoDCanvas, 'pointerdown', -100, -100, { pointerId: 30 });
  pointer(twoD, twoDCanvas, 'pointermove', -50, -70, { pointerId: 30 });
  twoD.platform.flushFrame();
  assert(!sameVector((await twoDSession.exportViewState()).camera.target, twoDBefore.camera.target), 'primary background drag should pan 2d camera');
  pointer(twoD, twoDCanvas, 'pointerup', -50, -70, { pointerId: 30 });
  twoD.platform.flushFrame();
  await twoDSession.dispose();

  const threeD = runtimeHarness({ profileId: 'three-dimensional' });
  const threeDSession = await threeD.create();
  const threeDCanvas = runtimeCanvas(threeD.container);
  const threeDBefore = await threeDSession.exportViewState();
  pointer(threeD, threeDCanvas, 'pointerdown', -100, -100, { pointerId: 31, button: 2 });
  pointer(threeD, threeDCanvas, 'pointermove', -40, -70, { pointerId: 31, button: 2 });
  threeD.platform.flushFrame();
  assert(!sameVector((await threeDSession.exportViewState()).camera.position, threeDBefore.camera.position), 'secondary background drag should orbit 3d camera');
  pointer(threeD, threeDCanvas, 'pointerup', -40, -70, { pointerId: 31, button: 2 });
  threeD.platform.flushFrame();
  await threeDSession.dispose();
});

test('desktop primary background pan offsets the camera while preserving focus and selection', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.setSelection(['a']);
  await session.focusNode('a');
  const before = await session.exportViewState();
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  pointer(value, canvas, 'pointerdown', -100, -100, { pointerId: 32 });
  pointer(value, canvas, 'pointermove', -98, -98, { pointerId: 32 });
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, 'a', 'sub-threshold motion should retain focus');
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'sub-threshold motion should retain selection');
  pointer(value, canvas, 'pointermove', -70, -80, { pointerId: 32 });
  value.platform.flushFrame();
  const after = await session.exportViewState();
  equal(after.focusedNodeId, 'a', 'desktop primary pan should preserve focus');
  deepEqual(after.selectedNodeIds, ['a'], 'desktop primary pan should preserve selection');
  assert(!sameVector(after.camera.target, before.camera.target), 'desktop primary pan should offset the focused camera target');
  equal(intents.filter((intent) => intent.type === 'focus-changed').length, 0, 'desktop primary pan should emit no focus change');
  equal(intents.filter((intent) => intent.type === 'selection-changed').length, 0, 'desktop primary pan should emit no selection change');
  await session.dispose();
});

test('R-INPUT-17 mobile one-finger background drag pans unfocused and orbits focused 3D', async () => {
  const unfocused = runtimeHarness({ profileId: 'three-dimensional' });
  const unfocusedSession = await unfocused.create();
  const unfocusedCanvas = runtimeCanvas(unfocused.container);
  const unfocusedBefore = await unfocusedSession.exportViewState();
  pointer(unfocused, unfocusedCanvas, 'pointerdown', -100, -100, { pointerId: 33, pointerType: 'touch' });
  pointer(unfocused, unfocusedCanvas, 'pointermove', -40, -70, { pointerId: 33, pointerType: 'touch' });
  unfocused.platform.flushFrame();
  const unfocusedAfter = await unfocusedSession.exportViewState();
  assert(!sameVector(unfocusedAfter.camera.target, unfocusedBefore.camera.target),
    'an unfocused one-finger background drag should pan 3D');
  await unfocusedSession.dispose();

  const focused = runtimeHarness({ profileId: 'three-dimensional' });
  const focusedSession = await focused.create();
  const focusedCanvas = runtimeCanvas(focused.container);
  await focusedSession.setSelection(['a']);
  await focusedSession.focusNode('a');
  const focusedBefore = await focusedSession.exportViewState();
  pointer(focused, focusedCanvas, 'pointerdown', -100, -100, { pointerId: 34, pointerType: 'touch' });
  pointer(focused, focusedCanvas, 'pointermove', -40, -70, { pointerId: 34, pointerType: 'touch' });
  focused.platform.flushFrame();
  const focusedAfter = await focusedSession.exportViewState();
  assert(!sameVector(focusedAfter.camera.position, focusedBefore.camera.position),
    'a focused one-finger background drag should orbit the 3D camera');
  deepEqual(focusedAfter.camera.target, focusedBefore.camera.target,
    'focused one-finger orbit should retain the focal target');
  equal(focusedAfter.focusedNodeId, 'a', 'focused one-finger orbit should retain focus');
  deepEqual(focusedAfter.selectedNodeIds, ['a'], 'focused one-finger orbit should retain selection');
  await focusedSession.dispose();
});

test('focused 3D drag over another node orbits without moving or transiently highlighting it', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.setSelection(['a']);
  await session.focusNode('a');
  const before = await session.exportViewState();
  const otherPoint = await nodePoint(session, 'b');
  pointer(value, canvas, 'pointerdown', otherPoint.x, otherPoint.y, { pointerId: 35, pointerType: 'touch' });
  pointer(value, canvas, 'pointermove', otherPoint.x + 50, otherPoint.y + 25, { pointerId: 35, pointerType: 'touch' });
  value.platform.flushFrame();
  pointer(value, canvas, 'pointerup', otherPoint.x + 50, otherPoint.y + 25, { pointerId: 35, pointerType: 'touch' });
  value.platform.flushFrame();
  const afterOrbit = await session.exportViewState();
  equal(afterOrbit.focusedNodeId, 'a', 'the original focus should survive a drag beginning over another node');
  deepEqual(afterOrbit.selectedNodeIds, ['a'], 'the original selection should survive the orbit gesture');
  deepEqual(afterOrbit.positions.b, before.positions.b, 'the hit node must not enter node drag while 3D focus is active');
  assert(!sameVector(afterOrbit.camera.position, before.camera.position), 'the same gesture should orbit the camera');

  const stationaryOtherPoint = await nodePoint(session, 'b');
  click(value, canvas, stationaryOtherPoint, { pointerId: 36, pointerType: 'touch' });
  value.platform.flushFrame();
  value.platform.flushTimer();
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, 'b',
    'a stationary click on another node should still transfer focus');
  await session.dispose();
});

test('desktop can drag a stably hovered direct neighbor while retaining the original focus', async () => {
  const value = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.setSelection(['a']);
  await session.focusNode('a');
  const neighborPoint = await nodePoint(session, 'b');
  pointer(value, canvas, 'pointermove', neighborPoint.x, neighborPoint.y, { pointerId: 370, pointerType: 'mouse' });
  value.platform.flushFrame();
  const before = await session.exportViewState();
  pointer(value, canvas, 'pointerdown', neighborPoint.x, neighborPoint.y, { pointerId: 371, pointerType: 'mouse' });
  pointer(value, canvas, 'pointermove', neighborPoint.x + 40, neighborPoint.y + 25, { pointerId: 371, pointerType: 'mouse' });
  value.platform.flushFrame();
  pointer(value, canvas, 'pointerup', neighborPoint.x + 40, neighborPoint.y + 25, { pointerId: 371, pointerType: 'mouse' });
  value.platform.flushFrame();
  const after = await session.exportViewState();
  assert(!sameVector(after.positions.b, before.positions.b), 'the direct neighbor should move with the desktop drag');
  equal(after.focusedNodeId, 'a', 'neighbor drag should retain the original focused node');
  deepEqual(after.selectedNodeIds, ['a'], 'neighbor drag should retain the original selection');
  deepEqual(after.camera.position, before.camera.position, 'neighbor drag should not orbit the camera');
  await session.dispose();
});

test('V1.7 double tap hold and vertical drag owns precision zoom in 2D and focused 3D', async () => {
  const flat = runtimeHarness();
  const flatSession = await flat.create();
  const flatCanvas = runtimeCanvas(flat.container);
  const flatPoint = await nodePoint(flatSession, 'a');
  click(flat, flatCanvas, flatPoint, { pointerId: 100, pointerType: 'touch' });
  flat.platform.flushFrame();
  const flatBefore = await flatSession.exportViewState();
  pointer(flat, flatCanvas, 'pointerdown', flatPoint.x, flatPoint.y, { pointerId: 101, pointerType: 'touch' });
  pointer(flat, flatCanvas, 'pointermove', flatPoint.x, flatPoint.y + 30, { pointerId: 101, pointerType: 'touch' });
  flat.platform.flushFrame();
  const flatIn = await flatSession.exportViewState();
  assert(flatIn.camera.zoom > flatBefore.camera.zoom, 'pulling down should zoom a 2D graph in');
  deepEqual(flatIn.selectedNodeIds, flatBefore.selectedNodeIds, 'precision zoom over a node must not select it');
  pointer(flat, flatCanvas, 'pointermove', flatPoint.x, flatPoint.y - 10, { pointerId: 101, pointerType: 'touch' });
  flat.platform.flushFrame();
  const flatReversed = await flatSession.exportViewState();
  assert(flatReversed.camera.zoom < flatIn.camera.zoom, 'reversing upward should reverse zoom continuously');
  pointer(flat, flatCanvas, 'pointerup', flatPoint.x, flatPoint.y - 10, { pointerId: 101, pointerType: 'touch' });
  flat.platform.flushFrame();
  equal(flat.platform.pendingTimers, 0, 'completed precision zoom should leave no touch timer behind');
  await flatSession.dispose();

  const spatial = runtimeHarness({ profileId: 'three-dimensional' });
  const spatialSession = await spatial.create();
  const spatialCanvas = runtimeCanvas(spatial.container);
  await spatialSession.setSelection(['a']);
  await spatialSession.focusNode('a');
  const spatialPoint = await nodePoint(spatialSession, 'b');
  click(spatial, spatialCanvas, spatialPoint, { pointerId: 102, pointerType: 'touch' });
  spatial.platform.flushFrame();
  const spatialBefore = await spatialSession.exportViewState();
  pointer(spatial, spatialCanvas, 'pointerdown', spatialPoint.x, spatialPoint.y, { pointerId: 103, pointerType: 'touch' });
  pointer(spatial, spatialCanvas, 'pointermove', spatialPoint.x, spatialPoint.y + 30, { pointerId: 103, pointerType: 'touch' });
  spatial.platform.flushFrame();
  const spatialAfter = await spatialSession.exportViewState();
  assert(vectorDistance(spatialAfter.camera.position, spatialAfter.camera.target)
    < vectorDistance(spatialBefore.camera.position, spatialBefore.camera.target),
  'pulling down should dolly a perspective graph in');
  equal(spatialAfter.focusedNodeId, 'a', 'focused 3D precision zoom must retain the existing focus');
  deepEqual(spatialAfter.positions.b, spatialBefore.positions.b, 'precision zoom beginning over a node must not drag it');
  pointer(spatial, spatialCanvas, 'pointerup', spatialPoint.x, spatialPoint.y + 30, { pointerId: 103, pointerType: 'touch' });
  spatial.platform.flushFrame();
  await spatialSession.dispose();
});

test('V1.7 semantic hover reports Mod changes without mutating graph state', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  const mac = /Mac|iPhone|iPad|iPod/i.test(value.window.navigator.platform ?? '');
  pointer(value, canvas, 'pointermove', point.x, point.y, {
    pointerId: 104,
    pointerType: 'mouse',
    metaKey: mac,
    ctrlKey: !mac,
  });
  value.platform.flushFrame();
  const hover = [...intents].reverse().find((intent) => intent.type === 'node-hover-changed');
  const preview = [...intents].reverse().find((intent) => intent.type === 'preview-changed');
  equal(hover?.type === 'node-hover-changed' ? hover.nodeId : undefined, 'a', 'hover should expose the hit node');
  equal(hover?.type === 'node-hover-changed' ? hover.mod : false, true, 'hover should expose semantic platform Mod');
  equal(preview?.type === 'preview-changed' ? preview.nodeId : undefined, 'a',
    'Mod hover should establish an independent semantic preview target');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'preview eligibility must not alter selection');
  pointer(value, canvas, 'pointermove', -100, -100, {
    pointerId: 104,
    pointerType: 'mouse',
    metaKey: mac,
    ctrlKey: !mac,
  });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'Mod preview latch should survive transient pointer hit-test misses');
  const heldLeave = new value.window.PointerEvent('pointerleave', {
    pointerId: 104,
    pointerType: 'mouse',
  });
  Object.defineProperty(heldLeave, 'pointerType', { value: 'mouse' });
  canvas.dispatchEvent(heldLeave as unknown as Event);
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'Mod hover should remain latched when the pointer leaves for a preview');
  const release = new value.window.KeyboardEvent('keyup', { key: 'Meta', metaKey: false, ctrlKey: false });
  value.window.dispatchEvent(release);
  value.platform.flushFrame();
  value.platform.flushTimer();
  assert(canvas.style.cursor.includes('data:image/svg+xml'),
    'releasing Mod outside the canvas should restore the idle donut cursor after clearing the latched hover');
  const dismissed = [...intents].reverse().find((intent) => intent.type === 'preview-changed');
  equal(dismissed?.type === 'preview-changed' ? dismissed.nodeId : 'missing', undefined,
    'releasing Mod should emit semantic preview dismissal');
  await session.dispose();
});

test('V1.8 preview surface ownership holds Anima preview through Mod release', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  const mac = /Mac|iPhone|iPad|iPod/i.test(value.window.navigator.platform ?? '');
  pointer(value, canvas, 'pointermove', point.x, point.y, {
    pointerId: 105, pointerType: 'mouse', metaKey: mac, ctrlKey: !mac,
  });
  value.platform.flushFrame();
  pointer(value, canvas, 'pointermove', -100, -100, {
    pointerId: 105, pointerType: 'mouse', metaKey: mac, ctrlKey: !mac,
  });
  value.platform.flushFrame();
  await session.setPreviewSurfaceActive(true);
  equal(value.platform.pendingTimers, 0, 'card entry should cancel the pending handoff release');
  canvas.dispatchEvent(new value.window.PointerEvent('pointerleave', { pointerId: 105, pointerType: 'mouse' }) as unknown as Event);
  value.window.dispatchEvent(new value.window.KeyboardEvent('keyup', { key: 'Meta', metaKey: false, ctrlKey: false }));
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'pointer', 'card-active semantic preview should survive Mod release outside the canvas');
  await session.setPreviewSurfaceActive(false);
  await session.clearPreview();
  assert(canvas.style.cursor.includes('data:image/svg+xml'),
    'card dismissal should restore the idle donut cursor after releasing the independent preview target');
  const previewIntents = intents.filter((intent) => intent.type === 'preview-changed');
  equal(previewIntents.length, 3, 'target, handoff, and final dismissal should each emit once');
  await session.dispose();
});

test('R-INPUT-18 two-finger translation pans focused 3D and 2D without losing focused 3D state', async () => {
  const spatial = runtimeHarness({ profileId: 'three-dimensional' });
  const spatialSession = await spatial.create();
  const spatialCanvas = runtimeCanvas(spatial.container);
  await spatialSession.setSelection(['a']);
  await spatialSession.focusNode('a');
  const spatialBefore = await spatialSession.exportViewState();
  pointer(spatial, spatialCanvas, 'pointerdown', 100, 100, { pointerId: 70, pointerType: 'touch' });
  pointer(spatial, spatialCanvas, 'pointerdown', 200, 100, { pointerId: 71, pointerType: 'touch' });
  pointer(spatial, spatialCanvas, 'pointermove', 130, 100, { pointerId: 70, pointerType: 'touch' });
  pointer(spatial, spatialCanvas, 'pointermove', 230, 100, { pointerId: 71, pointerType: 'touch' });
  spatial.platform.flushFrame();
  const spatialAfter = await spatialSession.exportViewState();
  assert(!sameVector(spatialAfter.camera.position, spatialBefore.camera.position),
    'two-finger translation should move a focused 3D camera');
  assert(!sameVector(spatialAfter.camera.target, spatialBefore.camera.target),
    'two-finger translation should pan the focus offset');
  assert(vectorDistance(cameraOffset(spatialAfter.camera), cameraOffset(spatialBefore.camera)) < 0.000001,
    'focused 3D panning should preserve camera orientation and distance');
  equal(spatialAfter.focusedNodeId, 'a', '3D two-finger pan should retain focus');
  deepEqual(spatialAfter.selectedNodeIds, ['a'], '3D two-finger pan should retain selection');
  await spatialSession.dispose();

  const flat = runtimeHarness();
  const flatSession = await flat.create();
  const flatCanvas = runtimeCanvas(flat.container);
  await flatSession.setSelection(['a']);
  await flatSession.focusNode('a');
  const flatBefore = await flatSession.exportViewState();
  const intents: GraphIntentV1[] = [];
  flatSession.onIntent((intent) => intents.push(intent));
  pointer(flat, flatCanvas, 'pointerdown', 100, 100, { pointerId: 72, pointerType: 'touch' });
  pointer(flat, flatCanvas, 'pointerdown', 200, 100, { pointerId: 73, pointerType: 'touch' });
  pointer(flat, flatCanvas, 'pointermove', 130, 100, { pointerId: 72, pointerType: 'touch' });
  pointer(flat, flatCanvas, 'pointermove', 230, 100, { pointerId: 73, pointerType: 'touch' });
  flat.platform.flushFrame();
  const flatAfter = await flatSession.exportViewState();
  assert(!sameVector(flatAfter.camera.target, flatBefore.camera.target), 'two-finger translation should pan a 2d camera');
  equal(flatAfter.focusedNodeId, undefined, 'committed 2d pan should clear focus');
  deepEqual(flatAfter.selectedNodeIds, [], 'committed 2d pan should clear selection');
  equal(intents.filter((intent) => intent.type === 'focus-changed').length, 1, '2d two-finger pan should clear focus once');
  equal(intents.filter((intent) => intent.type === 'selection-changed').length, 1, '2d two-finger pan should clear selection once');
  await flatSession.dispose();
});

test('stationary mobile long-press requests node context without selecting or focusing', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  pointer(value, canvas, 'pointerdown', point.x, point.y, { pointerId: 35, pointerType: 'touch' });
  value.platform.flushTimer();
  value.platform.flushFrame();
  equal(intents.filter((intent) => intent.type === 'node-context-requested').length, 1, 'long press should emit one context request');
  equal((await session.exportViewState()).focusedNodeId, undefined, 'opening context should not focus');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'opening context should not select');
  await session.dispose();
});

test('stationary mobile background long-press resets the camera without requesting node context', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.resetCamera();
  const reset = await session.exportViewState();
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  wheel(value, canvas, { deltaX: 40, deltaY: 24 });
  value.platform.flushFrame();
  assert(!sameVector((await session.exportViewState()).camera.target, reset.camera.target),
    'the camera should begin away from its reset target');
  const beforeLongPress = await session.exportViewState();
  const expectedTarget = positionsCenter(Object.values(beforeLongPress.positions));
  pointer(value, canvas, 'pointerdown', -100, -100, { pointerId: 36, pointerType: 'touch' });
  value.platform.flushTimer();
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).camera.target, expectedTarget,
    'background long press should reset and fit the complete visible graph');
  equal(intents.filter((intent) => intent.type === 'node-context-requested').length, 0,
    'background long press should not request a node menu');
  pointer(value, canvas, 'pointerup', -100, -100, { pointerId: 36, pointerType: 'touch' });
  await session.dispose();
});

test('R-INPUT-02 handles keyboard and two-finger navigation within one session', async () => {
  const keyboard = runtimeHarness({ profileId: 'three-dimensional' });
  const session = await keyboard.create();
  const canvas = runtimeCanvas(keyboard.container);
  const before = await session.exportViewState();
  key(keyboard, canvas, 'ArrowRight');
  keyboard.platform.flushFrame();
  assert(!sameVector((await session.exportViewState()).camera.target, before.camera.target), 'arrow key should pan');
  const beforeKeyboardZoom = await session.exportViewState();
  const distanceBeforeKeyboardZoom = vectorDistance(beforeKeyboardZoom.camera.position, beforeKeyboardZoom.camera.target);
  key(keyboard, canvas, '+');
  keyboard.platform.flushFrame();
  const afterKeyboardZoom = await session.exportViewState();
  equal(afterKeyboardZoom.camera.zoom, beforeKeyboardZoom.camera.zoom, 'perspective keyboard zoom should preserve focal length');
  assert(vectorDistance(afterKeyboardZoom.camera.position, afterKeyboardZoom.camera.target) < distanceBeforeKeyboardZoom, 'plus key should dolly in');
  const expectedResetTarget = positionsCenter(Object.values(afterKeyboardZoom.positions));
  key(keyboard, canvas, '0');
  keyboard.platform.flushFrame();
  deepEqual((await session.exportViewState()).camera.target, expectedResetTarget,
    'zero key should restore the profile angle and fit the visible graph');
  key(keyboard, canvas, 'f');
  keyboard.platform.flushFrame();
  assert(!sameVector((await session.exportViewState()).camera.target, { x: 0, y: 0, z: 0 }), 'fit key should target visible graph bounds');
  await session.dispose();

  const touch = runtimeHarness();
  const touchSession = await touch.create();
  const touchCanvas = runtimeCanvas(touch.container);
  const touchBefore = await touchSession.exportViewState();
  pointer(touch, touchCanvas, 'pointerdown', 100, 100, { pointerId: 10, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointerdown', 200, 100, { pointerId: 11, pointerType: 'touch' });
  equal(touch.platform.pendingTimers, 0, 'starting a multi-touch gesture should cancel the single-touch long-press timer');
  pointer(touch, touchCanvas, 'pointermove', 125, 90, { pointerId: 10, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointermove', 225, 90, { pointerId: 11, pointerType: 'touch' });
  touch.platform.flushFrame();
  const touchAfterPan = await touchSession.exportViewState();
  assert(!sameVector(touchAfterPan.camera.target, touchBefore.camera.target), 'two-finger centroid movement should pan 2d');
  equal(touchAfterPan.camera.zoom, touchBefore.camera.zoom, 'translation should not accidentally zoom');
  pointer(touch, touchCanvas, 'pointerup', 125, 90, { pointerId: 10, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointerup', 225, 90, { pointerId: 11, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointerdown', 100, 100, { pointerId: 13, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointerdown', 200, 100, { pointerId: 14, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointermove', 90, 100, { pointerId: 13, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointermove', 80, 100, { pointerId: 13, pointerType: 'touch' });
  touch.platform.flushFrame();
  const touchAfterPinch = await touchSession.exportViewState();
  assert(touchAfterPinch.camera.zoom > touchAfterPan.camera.zoom, 'pinch spread should win and zoom in');
  assert(touchAfterPinch.camera.zoom > touchAfterPan.camera.zoom,
    'pinch should use the restored mobile zoom response');
  await touchSession.dispose();
  equal(touch.platform.pendingTimers, 0, 'disposing input should clear its owning-window timer');
  pointer(touch, touchCanvas, 'pointerdown', 50, 50, { pointerId: 12, pointerType: 'touch' });
  equal(touch.platform.pendingTimers, 0, 'disposed canvas should have no live input listeners');
});

function positionsCenter(positions: readonly { readonly x: number; readonly y: number; readonly z: number }[]) {
  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  const zs = positions.map((position) => position.z);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
}

test('renderer draws generic nodes, labels, edges, and directed arrows in both profile dimensions', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional']) {
    const value = runtimeHarness({ profileId });
    const session = await value.create();
    await session.setSessionOverrides({ modules: { rendering: { settings: { showArrows: true } } } });
    value.platform.flushFrame();
    assert(value.drawCalls.includes('clearRect'), `${profileId} renderer should clear its canvas`);
    assert(value.drawCalls.includes('arc'), `${profileId} renderer should draw nodes`);
    assert(value.drawCalls.includes('fillText'), `${profileId} renderer should draw labels`);
    assert(value.drawCalls.includes('lineTo'), `${profileId} renderer should draw edges`);
    assert(value.drawCalls.includes('closePath'), `${profileId} renderer should draw directed arrowheads`);
    await session.dispose();
  }
});

test('profile-backed adaptive, all, and off label modes update live', async () => {
  const nodes = Array.from({ length: 40 }, (_, index) => graphNode(`node-${index}`, {
    positionHint: { x: 0, y: 0, z: 0 },
  }));
  const value = runtimeHarness({ document: graphDocument({ nodes, edges: [] }) });
  const session = await value.create();
  value.drawCalls.length = 0;
  value.platform.flushFrame();
  const adaptiveLabels = value.drawCalls.filter((call) => call === 'fillText').length;
  assert(adaptiveLabels < nodes.length, 'adaptive mode should reject colliding labels');

  value.drawCalls.length = 0;
  await session.setSessionOverrides({ modules: { rendering: { settings: { labelMode: 'all' } } } });
  value.platform.flushFrame();
  equal(value.drawCalls.filter((call) => call === 'fillText').length, nodes.length, 'all mode should draw every onscreen label');

  value.drawCalls.length = 0;
  await session.setSessionOverrides({ modules: { rendering: { settings: { labelMode: 'off' } } } });
  value.platform.flushFrame();
  equal(value.drawCalls.filter((call) => call === 'fillText').length, 0, 'off mode should draw no labels');
  equal((await session.exportEffectiveSettings()).modules.rendering?.settings.labelMode, 'off', 'effective settings should expose label mode');
  await session.dispose();

  const base = runtimeRegistration();
  const profileDefault = runtimeHarness({
    registration: {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        modules: {
          ...profile.modules,
          rendering: { ...profile.modules.rendering, defaults: { labelMode: 'off' } },
        },
      })),
    },
  });
  const profileSession = await profileDefault.create();
  equal((await profileSession.exportEffectiveSettings()).modules.rendering?.settings.labelMode, 'off', 'a consumer profile should control its default label mode');
  await profileSession.dispose();
});

test('3d hit testing chooses the nearest visible node at an overlapping screen point', async () => {
  const value = runtimeHarness({
    profileId: 'three-dimensional',
    document: graphDocument({
      nodes: [
        graphNode('far', { positionHint: { x: 0, y: 0, z: 0 } }),
        graphNode('near', { positionHint: { x: 0, y: 0, z: 50 } }),
      ],
      edges: [],
    }),
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  click(value, canvas, { x: 320, y: 180 }, { pointerId: 20 });
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).selectedNodeIds, ['near'], 'nearest depth should win overlapping hit test');
  await session.dispose();
});

test('suspension and view invalidation clear transient gestures and cursors', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const point = await nodePoint(session, 'a');

  pointer(value, canvas, 'pointerdown', point.x, point.y, { pointerId: 40 });
  pointer(value, canvas, 'pointermove', point.x + 30, point.y + 10, { pointerId: 40 });
  value.platform.flushFrame();
  equal(canvas.style.cursor, 'grabbing', 'active drag should own the grabbing cursor');

  await session.applyFilter({
    schemaVersion: 1,
    scope: 'render',
    node: { op: 'has-token', token: 'remove' },
  });
  assert(canvas.style.cursor.includes('data:image/svg+xml'),
    'view invalidation should restore the idle donut cursor after clearing transient drag and hover state');
  const invalidated = await session.exportViewState();
  pointer(value, canvas, 'pointermove', point.x + 80, point.y + 40, { pointerId: 40 });
  pointer(value, canvas, 'pointerup', point.x + 80, point.y + 40, { pointerId: 40 });
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).positions.a, invalidated.positions.a, 'a hidden node must not keep dragging after invalidation');

  session.setSuspended(true);
  assert(canvas.style.cursor.includes('data:image/svg+xml'),
    'suspension should leave the neutral idle donut cursor');
  equal(value.platform.pendingTimers, 0, 'suspension should clear input-owned timers');
  session.setSuspended(false);
  await session.dispose();
});

async function nodePoint(session: GraphSessionV1, nodeId: string): Promise<{ x: number; y: number }> {
  const state = await session.exportViewState();
  const position = state.positions[nodeId];
  assert(position, `node ${nodeId} should have a runtime position`);
  const camera = new GraphCameraController(state.camera, state.dimensions);
  camera.setViewport(640, 360);
  const projected = camera.worldToScreen(position);
  return { x: projected.x, y: projected.y };
}

function click(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
  options: { pointerId: number; button?: number; pointerType?: string },
): void {
  pointer(value, canvas, 'pointerdown', point.x, point.y, options);
  pointer(value, canvas, 'pointerup', point.x, point.y, options);
}

function pointer(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  options: { pointerId: number; button?: number; pointerType?: string; ctrlKey?: boolean; metaKey?: boolean },
): void {
  const event = new value.window.PointerEvent(type, {
    clientX,
    clientY,
    pointerId: options.pointerId,
    pointerType: options.pointerType ?? 'mouse',
    button: options.button ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId });
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'button', { value: options.button ?? 0 });
  Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey ?? false });
  Object.defineProperty(event, 'metaKey', { value: options.metaKey ?? false });
  canvas.dispatchEvent(event as unknown as Event);
}

function wheel(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  options: { x?: number; y?: number; deltaX?: number; deltaY: number; ctrlKey?: boolean; metaKey?: boolean },
): void {
  const event = new value.window.WheelEvent('wheel', {
    clientX: options.x ?? 320,
    clientY: options.y ?? 180,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  } as any);
  Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey ?? false });
  Object.defineProperty(event, 'metaKey', { value: options.metaKey ?? false });
  Object.defineProperty(event, 'clientX', { value: options.x ?? 320 });
  Object.defineProperty(event, 'clientY', { value: options.y ?? 180 });
  canvas.dispatchEvent(event as unknown as Event);
}

function key(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  keyValue: string,
  options: { repeat?: boolean; composing?: boolean; shift?: boolean; prevented?: boolean } = {},
): void {
  const event = new value.window.KeyboardEvent('keydown', {
    key: keyValue,
    repeat: options.repeat ?? false,
    shiftKey: options.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (options.composing) Object.defineProperty(event, 'isComposing', { value: true });
  if (options.prevented) event.preventDefault();
  canvas.dispatchEvent(event as unknown as Event);
}

function sameVector(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function cameraOffset(camera: {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
}): { x: number; y: number; z: number } {
  return {
    x: camera.position.x - camera.target.x,
    y: camera.position.y - camera.target.y,
    z: camera.position.z - camera.target.z,
  };
}

function vectorDistance(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
