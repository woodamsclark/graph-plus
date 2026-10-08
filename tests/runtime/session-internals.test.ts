import { Window } from 'happy-dom';
import {
  SessionActivityController,
  SessionFrameScheduler,
} from '../../src/graph-engine/runtime/index.ts';
import { deepEqual, equal, assert, test } from '../support/harness.ts';
import { InstrumentedPlatform, runtimeHarness } from '../support/runtimeHarness.ts';
import { GraphPlusViewLifecycleV1 } from '../../src/obsidian/GraphPlusViewLifecycle.ts';

test('unchanged filters and clearing an absent scope perform no projection or world export', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  try {
    const filter = { schemaVersion: 1 as const, scope: 'render' as const, node: { op: 'id-in' as const, ids: ['a', 'c'] } };
    await session.applyFilter(filter);
    const before = value.factory.getDiagnostics().sessions[0].counters!;
    await session.applyFilter(JSON.parse(JSON.stringify(filter)));
    await session.clearFilter('projection');
    const after = value.factory.getDiagnostics().sessions[0].counters!;
    equal(after.projectionPasses, before.projectionPasses, 'equivalent requests and absent filters must be idle');
    const stats = session.getDocumentStats!();
    equal(stats.nodes, 3, 'statistics count canonical nodes');
    equal(stats.edges, 2, 'statistics count canonical edges');
    const state = session.getInteractionState!();
    (state.selectedNodeIds as string[]).push('a');
    deepEqual(session.getInteractionState!().selectedNodeIds, [], 'selectors cannot mutate Attention');
    equal(value.factory.getDiagnostics().sessions[0].counters!.documentExports, after.documentExports, 'counts do not export documents');
    equal(value.factory.getDiagnostics().sessions[0].counters!.viewExports, after.viewExports, 'selectors do not export module state');
    let rejected = false;
    try { await session.applyFilter({ ...filter, node: { op: 'unknown' } } as any); } catch { rejected = true; }
    equal(rejected, true, 'invalid filters are still rejected before changing state');
    await session.clearFilter('render');
    equal(value.factory.getDiagnostics().sessions[0].counters!.projectionPasses, before.projectionPasses + 1, 'clearing a present filter still projects');
  } finally { await session.dispose(); }
});

test('combined lens settings and filtering project once and retain physics, camera and pins', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  try {
    await session.setNodePinned('a', true);
    const original = await session.exportViewState();
    const before = value.factory.getDiagnostics().sessions[0].counters!.projectionPasses;
    const overrides = { modules: { form: { enabled: true, settings: { rootNodeId: 'a', direction: 'either' } } } };
    const filter = { schemaVersion: 1 as const, scope: 'render' as const, node: { op: 'id-in' as const, ids: ['a', 'c'] } };
    await session.setSessionOverridesAndFilter!(overrides, filter);
    equal(value.factory.getDiagnostics().sessions[0].counters!.projectionPasses, before + 1, 'one lens install owns one projection');
    const state = await session.exportViewState();
    deepEqual(state.pinnedNodeIds, original.pinnedNodeIds, 'pins survive the transaction');
    deepEqual(state.camera, original.camera, 'camera survives the transaction');
    await session.setSessionOverridesAndFilter!(overrides, filter);
    equal(value.factory.getDiagnostics().sessions[0].counters!.projectionPasses, before + 1, 'repeated installs are idle');
  } finally { await session.dispose(); }
});

test('lightweight world notifications avoid layout-state exports and preserve full snapshot subscribers', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  const probe = session as any;
  let exports = 0; let invalidations = 0; let fullSnapshots = 0;
  const original = probe.moduleHost.exportCapabilityState.bind(probe.moduleHost);
  probe.moduleHost.exportCapabilityState = (...args: any[]) => { exports++; return original(...args); };
  const light = session.onWorldInvalidated!(() => { invalidations++; });
  try {
    probe.emitWorldChanged('layout');
    equal(invalidations, 1, 'geometry invalidation remains live');
    equal(exports, 0, 'lightweight listeners do not serialize layout state');
    const positions = await session.exportWorldPositions!();
    equal(exports, 0, 'position exports do not serialize layout state');
    const before = await session.exportViewState();
    await session.applyWorldPositions!({ ...positions, documentRevision: positions.documentRevision + 1,
      positions: { ...positions.positions, a: { x: 300, y: 0, z: 0 } } });
    deepEqual((await session.exportViewState()).positions, before.positions, 'stale geometry is ignored');
    await session.applyWorldPositions!({ ...positions, positions: { ...positions.positions, a: { x: 300, y: 0, z: 0 } } });
    equal((await session.exportViewState()).positions.a.x, 300, 'valid geometry is installed live');
    deepEqual((await session.exportViewState()).camera, before.camera, 'Overview camera remains independent');
    const full = session.onWorldChanged(event => { fullSnapshots++; equal(event.state.positions.a.x, 300, 'legacy subscribers retain full snapshots'); });
    probe.emitWorldChanged('layout');
    equal(fullSnapshots, 1, 'the legacy event is still delivered');
    equal(exports, 1, 'full layout serialization is reserved for full snapshot listeners');
    full.dispose();
  } finally { light.dispose(); await session.dispose(); }
});

test('V1.9 frame scheduler owns delayed wakes, coalesces invalidations, and clears exactly once', () => {
  const window = new Window();
  const platform = new InstrumentedPlatform(window);
  let active = true;
  let scheduled = 0;
  let frames = 0;
  let invalidations: readonly string[] = [];
  let scheduler!: SessionFrameScheduler;
  scheduler = new SessionFrameScheduler(
    platform,
    () => active,
    () => {
      frames += 1;
      invalidations = scheduler.beginFrame();
    },
    () => { scheduled += 1; },
  );
  scheduler.schedule('geometry', 20);
  scheduler.schedule('presentation', 40);
  equal(platform.pendingTimers, 1, 'the earliest delayed wake should remain the sole timer');
  deepEqual(scheduler.snapshot().pendingInvalidations, ['geometry', 'presentation'], 'causes should coalesce while work waits');
  scheduler.schedule('camera');
  equal(platform.pendingTimers, 0, 'immediate work should cancel the delayed wake');
  equal(platform.pendingFrames, 1, 'immediate work should own one animation frame');
  platform.flushFrame();
  equal(frames, 1, 'the scheduled callback should run once');
  equal(scheduled, 1, 'the scheduler should report one actual browser frame request');
  deepEqual(invalidations, ['geometry', 'presentation', 'camera'], 'the frame should receive every coalesced invalidation');
  equal(scheduler.snapshot().frameScheduled, false, 'completed work should leave no owned frame resource');

  scheduler.schedule('content', 10);
  scheduler.clear();
  equal(platform.pendingTimers, 0, 'clear should release the wake timer');
  deepEqual(scheduler.snapshot().pendingInvalidations, [], 'clear should discard stale causes');
  active = false;
  scheduler.schedule('ui');
  equal(platform.pendingFrames, 0, 'inactive sessions must reject new work');
});

test('V1.9 activity controller centralizes manual, document, and disposal state', () => {
  const activity = new SessionActivityController();
  equal(activity.isSuspended(), false, 'a new session should be active');
  equal(activity.setManualSuspension(true), true, 'the first transition should be observable');
  equal(activity.setManualSuspension(true), false, 'an unchanged transition should be ignored');
  equal(activity.snapshot().manuallySuspended, true, 'manual suspension should be diagnostic');
  activity.setManualSuspension(false);
  activity.setDocumentSuspension(true);
  equal(activity.isSuspended(), true, 'a hidden owner document should suspend work');
  activity.setDocumentSuspension(false);
  equal(activity.isSuspended(true), true, 'fatal module state should participate without becoming activity-owned');
  equal(activity.dispose(), true, 'disposal should transition once');
  equal(activity.dispose(), false, 'disposal should be idempotent');
  equal(activity.snapshot().disposed, true, 'disposed state should remain observable');
});

test('V1.9 runtime diagnostics classify work and reuse presentation-only projection geometry', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  value.platform.flushFrame(1_000 / 60);
  const before = value.factory.getDiagnostics().sessions[0];
  const beforeHits = Number(before?.renderCaches.projectionCacheHits ?? 0);

  await session.setSelection(['a']);
  value.platform.flushFrame(2_000 / 60);
  let diagnostics = value.factory.getDiagnostics().sessions[0];
  assert(Number(diagnostics?.renderCaches.projectionCacheHits ?? 0) > beforeHits,
    'a presentation-only selection frame should reuse projected geometry');
  assert(diagnostics?.lastFrameInvalidations.includes('presentation') === true,
    'selection should be reported as presentation work');

  await session.resetCamera();
  value.platform.flushFrame(3_000 / 60);
  diagnostics = value.factory.getDiagnostics().sessions[0];
  assert(diagnostics?.lastFrameInvalidations.includes('camera') === true,
    'camera reset should be reported as camera work');

  session.setSuspended(true);
  diagnostics = value.factory.getDiagnostics().sessions[0];
  equal(diagnostics?.frameScheduled, false, 'suspension should clear every scheduled frame resource');
  deepEqual(diagnostics?.pendingInvalidations, [], 'suspension should clear pending work causes');
  await session.dispose();
});

test('profile visual settings retain projection, attention, camera and pins while structural settings reproject', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  try {
    await session.setSelection(['a', 'b']);
    await session.setNodePinned('a', true);
    value.platform.flushFrame();
    const state = await session.exportViewState();
    const before = value.factory.getDiagnostics().sessions[0].counters?.projectionPasses;
    for (const scale of [1.2, 1.7, 2.4]) {
      value.profiles.setUserOverrides('synthetic-consumer', 'two-dimensional', {
        modules: { rendering: { settings: { nodeRadiusScale: scale, edgeThicknessScale: scale } } },
      });
      value.factory.refreshActiveProfiles();
      value.platform.flushFrame();
    }
    equal(value.factory.getDiagnostics().sessions[0].counters?.projectionPasses, before,
      'node size and link thickness should never rebuild the graph projection');
    const after = await session.exportViewState();
    deepEqual(after.selectedNodeIds, state.selectedNodeIds, 'visual edits should retain the constellation');
    deepEqual(after.pinnedNodeIds, state.pinnedNodeIds, 'visual edits should retain pins');
    deepEqual(after.camera, state.camera, 'visual edits should retain framing');
    const compositions = value.factory.getDiagnostics().sessions[0].counters?.frameCompositions;
    value.factory.refreshActiveProfiles(); value.platform.flushFrame();
    equal(value.factory.getDiagnostics().sessions[0].counters?.frameCompositions, compositions,
      'an unchanged effective profile should cause no extra composition');
    await session.setSessionOverrides({ modules: { form: { enabled: true, settings: { rootNodeId: 'a' } } } });
    assert(value.factory.getDiagnostics().sessions[0].counters!.projectionPasses > before!,
      'structural module changes must still run the graph projection');
  } finally { await session.dispose(); }
});

test('live force profile updates retain the mounted graph projection and force topology analysis', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  try {
    await session.setSessionOverrides({ modules: { 'force-layout': { enabled: true } } });
    value.platform.flushFrame(); value.platform.flushFrame();
    const before = value.factory.getDiagnostics().sessions[0];
    const analyses = (before.modules['force-layout'] as { topologyAnalysisCount: number }).topologyAnalysisCount;
    for (const strength of [0.2, 0.4, 0.7]) {
      await session.setSessionOverrides({ modules: { 'force-layout': { enabled: true, settings: { springStrength: strength } } } });
      value.platform.flushFrame(); value.platform.flushFrame();
    }
    const after = value.factory.getDiagnostics().sessions[0];
    equal(after.counters?.projectionPasses, before.counters?.projectionPasses,
      'force coefficients should not rerun the graph projection');
    equal((after.modules['force-layout'] as { topologyAnalysisCount: number }).topologyAnalysisCount, analyses,
      'coefficient updates should reuse the mounted solver topology');
  } finally { await session.dispose(); }
});

test('shared graph+ lifecycle suspends hidden leaves and releases host listeners on close', () => {
  const window = new Window();
  const content = window.document.createElement('section') as unknown as HTMLElement;
  let visible = true;
  (content as HTMLElement & { isShown: () => boolean }).isShown = () => visible;
  const suspensions: boolean[] = [];
  let previewClears = 0;
  let unregisters = 0;
  const lifecycle = new GraphPlusViewLifecycleV1(content, {
    setSuspended: (suspended) => suspensions.push(suspended),
    clearPreview: () => { previewClears += 1; },
  });
  lifecycle.register(() => { unregisters += 1; });
  visible = false;
  equal(lifecycle.synchronizeVisibility(), false, 'hidden state should be returned to follow routing');
  deepEqual(suspensions, [true], 'the shared owner should suspend the consumer once');
  equal(previewClears, 1, 'hiding should clear preview ownership once');
  visible = true;
  equal(lifecycle.synchronizeVisibility(), true, 'visible state should resume follow routing');
  deepEqual(suspensions, [true, false], 'showing should resume the same consumer');
  lifecycle.dispose();
  equal(unregisters, 1, 'disposal should release registered host events exactly once');
});


test('opening a collapsed graph side pane emits one reveal callback without repeating on resize', () => {
  const window = new Window();
  const split = window.document.createElement('div'); split.className = 'workspace-split is-collapsed';
  const content = window.document.createElement('section') as unknown as HTMLElement;
  split.append(content as unknown as typeof split);
  (content as HTMLElement & { isShown: () => boolean }).isShown = () => true;
  let reveals = 0;
  const lifecycle = new GraphPlusViewLifecycleV1(content, {
    setSuspended: () => undefined, clearPreview: () => undefined, onRevealed: () => { reveals++; },
  });
  equal(lifecycle.synchronizeVisibility(), false, 'a collapsed sidebar is hidden even when its content reports shown');
  split.classList.remove('is-collapsed'); lifecycle.synchronizeVisibility(); lifecycle.synchronizeVisibility();
  equal(reveals, 1, 'reopening recenters once, ordinary resize does not repeat it');
  split.classList.add('is-collapsed'); lifecycle.synchronizeVisibility();
  split.classList.remove('is-collapsed'); lifecycle.synchronizeVisibility();
  equal(reveals, 2, 'each reopening emits another recenter request');
});
