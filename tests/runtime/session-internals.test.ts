import { Window } from 'happy-dom';
import {
  SessionActivityController,
  SessionFrameScheduler,
} from '../../src/graph-engine/runtime/index.ts';
import { deepEqual, equal, assert, test } from '../support/harness.ts';
import { InstrumentedPlatform, runtimeHarness } from '../support/runtimeHarness.ts';
import { GraphPlusViewLifecycleV1 } from '../../src/obsidian/GraphPlusViewLifecycle.ts';

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
