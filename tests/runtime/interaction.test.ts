import type {
  GraphIntentV1,
  GraphSessionV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/index.ts';
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
  equal(zoomed.camera.zoom, zoomBefore, 'perspective zoom should preserve the profile focal length');
  assert(vectorDistance(zoomed.camera.position, zoomed.camera.target) < distanceBefore, 'perspective zoom-in should dolly the camera toward its target');
  await session.dispose();
});

test('R-INPUT-03 and R-INPUT-04 emit one neutral intent for each selection, focus, and activation', async () => {
  const value = runtimeHarness();
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

  value.platform.advanceTime(50);
  click(value, canvas, await nodePoint(session, 'a'), { pointerId: 2 });
  value.platform.flushFrame();
  equal(intents.filter((intent) => intent.type === 'node-activated' && intent.activation === 'primary').length, 1, 'double click should emit one primary activation');

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
  equal(intents.filter((intent) => intent.type === 'node-activated' && intent.activation === 'keyboard').length, 1, 'Enter should emit one keyboard activation');
  for (const intent of intents) {
    equal(intent.sessionId, session.sessionId, 'intent should identify its session');
    equal(intent.documentId, 'fixture', 'intent should carry neutral document identity');
    equal(intent.documentRevision, 0, 'intent should carry the producing revision');
  }
  await session.dispose();
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

test('background pan clears selection and focus only after crossing its threshold', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  await session.setSelection(['a']);
  await session.focusNode('a');
  const intents: GraphIntentV1[] = [];
  session.onIntent((intent) => intents.push(intent));
  pointer(value, canvas, 'pointerdown', -100, -100, { pointerId: 32 });
  pointer(value, canvas, 'pointermove', -98, -98, { pointerId: 32 });
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, 'a', 'sub-threshold motion should retain focus');
  deepEqual((await session.exportViewState()).selectedNodeIds, ['a'], 'sub-threshold motion should retain selection');
  pointer(value, canvas, 'pointermove', -70, -80, { pointerId: 32 });
  value.platform.flushFrame();
  equal((await session.exportViewState()).focusedNodeId, undefined, 'pan threshold should clear focus');
  deepEqual((await session.exportViewState()).selectedNodeIds, [], 'pan threshold should clear selection');
  equal(intents.filter((intent) => intent.type === 'focus-changed').length, 1, 'pan should emit one focus clear');
  equal(intents.filter((intent) => intent.type === 'selection-changed').length, 1, 'pan should emit one selection clear');
  await session.dispose();
});

test('mobile one-finger background drag orbits with and without a focused node', async () => {
  for (const focused of [false, true]) {
    const value = runtimeHarness({ profileId: 'three-dimensional' });
    const session = await value.create();
    const canvas = runtimeCanvas(value.container);
    if (focused) {
      await session.setSelection(['a']);
      await session.focusNode('a');
    }
    const before = await session.exportViewState();
    pointer(value, canvas, 'pointerdown', -100, -100, { pointerId: focused ? 34 : 33, pointerType: 'touch' });
    pointer(value, canvas, 'pointermove', -40, -70, { pointerId: focused ? 34 : 33, pointerType: 'touch' });
    value.platform.flushFrame();
    const after = await session.exportViewState();
    assert(!sameVector(after.camera.position, before.camera.position), `touch orbit should work when focused=${String(focused)}`);
    if (focused) {
      equal(after.focusedNodeId, 'a', 'touch orbit should retain focus');
      deepEqual(after.selectedNodeIds, ['a'], 'touch orbit should retain selection');
    }
    await session.dispose();
  }
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
  key(keyboard, canvas, '0');
  keyboard.platform.flushFrame();
  deepEqual((await session.exportViewState()).camera.target, { x: 0, y: 0, z: 0 }, 'zero key should reset camera');
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
  pointer(touch, touchCanvas, 'pointermove', 75, 90, { pointerId: 10, pointerType: 'touch' });
  pointer(touch, touchCanvas, 'pointermove', 235, 90, { pointerId: 11, pointerType: 'touch' });
  touch.platform.flushFrame();
  const touchAfter = await touchSession.exportViewState();
  assert(!sameVector(touchAfter.camera.target, touchBefore.camera.target), 'two-finger centroid movement should pan');
  assert(touchAfter.camera.zoom > touchBefore.camera.zoom, 'two-finger spread should zoom in');
  await touchSession.dispose();
  equal(touch.platform.pendingTimers, 0, 'disposing input should clear its owning-window timer');
  pointer(touch, touchCanvas, 'pointerdown', 50, 50, { pointerId: 12, pointerType: 'touch' });
  equal(touch.platform.pendingTimers, 0, 'disposed canvas should have no live input listeners');
});

test('renderer draws generic nodes, labels, edges, and directed arrows in both profile dimensions', async () => {
  for (const profileId of ['two-dimensional', 'three-dimensional']) {
    const value = runtimeHarness({ profileId });
    const session = await value.create();
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
  equal(canvas.style.cursor, 'default', 'view invalidation should clear transient drag and hover state');
  const invalidated = await session.exportViewState();
  pointer(value, canvas, 'pointermove', point.x + 80, point.y + 40, { pointerId: 40 });
  pointer(value, canvas, 'pointerup', point.x + 80, point.y + 40, { pointerId: 40 });
  value.platform.flushFrame();
  deepEqual((await session.exportViewState()).positions.a, invalidated.positions.a, 'a hidden node must not keep dragging after invalidation');

  session.setSuspended(true);
  equal(canvas.style.cursor, 'default', 'suspension should leave a neutral cursor');
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
  options: { pointerId: number; button?: number },
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
  options: { pointerId: number; button?: number; pointerType?: string },
): void {
  const event = new value.window.PointerEvent(type, {
    clientX,
    clientY,
    pointerId: options.pointerId,
    pointerType: options.pointerType ?? 'mouse',
    button: options.button ?? 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId });
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'button', { value: options.button ?? 0 });
  canvas.dispatchEvent(event as unknown as Event);
}

function wheel(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  options: { deltaX?: number; deltaY: number; ctrlKey?: boolean; metaKey?: boolean },
): void {
  const event = new value.window.WheelEvent('wheel', {
    clientX: 320,
    clientY: 180,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  } as any);
  Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey ?? false });
  Object.defineProperty(event, 'metaKey', { value: options.metaKey ?? false });
  Object.defineProperty(event, 'clientX', { value: 320 });
  Object.defineProperty(event, 'clientY', { value: 180 });
  canvas.dispatchEvent(event as unknown as Event);
}

function key(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  keyValue: string,
): void {
  const event = new value.window.KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event as unknown as Event);
}

function sameVector(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function vectorDistance(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
