import { Window } from 'happy-dom';
import { GraphEngineSettingsUpdatesV1 } from '../../src/obsidian/settings/GraphEngineSettingsUpdates.ts';
import { LatestStatePersistenceV1 } from '../../src/obsidian/settings/LatestStatePersistence.ts';
import { GraphEngineQuickSettingsPanelV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineQuickSettingsPanel.ts';
import type { EffectiveGraphSessionUiPolicyV1 } from '../../src/obsidian/graph-engine-ui/GraphEngineUiPolicy.ts';
import { GraphEngineProviderCoreV1, type GraphEngineSessionUiMountContextV1 } from '../../src/graph-engine/service/index.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { InstrumentedPlatform, runtimeFixture, runtimeHarness } from '../support/runtimeHarness.ts';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('latest-state persistence replaces queued snapshots and drains shutdown through the final write', async () => {
  const saved: number[] = [];
  let release!: () => void;
  const queue = new LatestStatePersistenceV1<number>(async value => {
    saved.push(value);
    if (saved.length === 1) await new Promise<void>(resolve => { release = resolve; });
  });
  const first = queue.save(1); await settle();
  const callers = [queue.save(2), queue.save(3), queue.save(4)];
  const shutdown = queue.drain();
  deepEqual(saved, [1], 'there is only one in-flight disk write');
  release(); await first; await Promise.all(callers); await shutdown;
  deepEqual(saved, [1, 4], 'intermediate pending settings never reach disk');
});

test('latest-state persistence reports failures and retries the newest snapshot on drain', async () => {
  const saved: number[] = [];
  let reject!: (error: Error) => void;
  const queue = new LatestStatePersistenceV1<number>(async value => {
    saved.push(value);
    if (saved.length === 1) await new Promise<void>((_, rejectSave) => { reject = rejectSave; });
  });
  const first = queue.save(1); await settle();
  const latest = queue.save(2);
  reject(new Error('disk failure'));
  const failures = await Promise.allSettled([first, latest]);
  equal(failures.every(value => value.status === 'rejected'), true, 'all waiting callers see the failure');
  await queue.drain();
  deepEqual(saved, [1, 2], 'shutdown retries the newest state rather than the stale failed state');
});

test('plugin persistence retries current authority after a failed checkpoint reference is rolled back', async () => {
  let data = { reference: 'previous', setting: 1 };
  const writes: typeof data[] = [];
  let fail = true;
  const queue = new LatestStatePersistenceV1<void>(async () => {
    writes.push(data);
    if (fail) throw new Error('metadata commit failed');
  });
  data = { reference: 'uncommitted', setting: 2 };
  await queue.save(undefined).catch(() => {});
  data = { ...data, reference: 'previous' };
  fail = false;
  await queue.drain();
  deepEqual(writes.at(-1), { reference: 'previous', setting: 2 },
    'shutdown persists the rolled-back authority and retains concurrent settings');
});

test('slider release applies the final pending frame synchronously before saving', async () => {
  const clock = new InstrumentedPlatform(new Window());
  const events: string[] = [];
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => { events.push('refresh'); }, async () => { events.push('save'); }, error => { throw error; });
  await updates.update('live');
  await updates.update('commit');
  deepEqual(events, ['refresh', 'save'], 'release realizes the final setting before persistence');
  equal(clock.pendingFrames, 0, 'release cancels redundant frame work');
  await updates.close();
});

test('live settings coalesce rapid inputs into one frame and debounce saves until commit', async () => {
  const clock = new InstrumentedPlatform(new Window());
  let value = 0;
  const applied: number[] = [];
  const saved: number[] = [];
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => applied.push(value), async () => { saved.push(value); }, error => { throw error; });
  for (let i = 1; i <= 100; i++) { value = i; await updates.update('live'); }
  equal(clock.pendingFrames, 1, '100 movements should queue one runtime update');
  equal(clock.pendingTimers, 1, '100 movements should retain one save debounce');
  deepEqual(saved, [], 'dragging should not queue saves per movement');
  clock.flushFrame();
  deepEqual(applied, [100], 'the next frame should apply the latest value before release');
  value = 101; await updates.update('live'); clock.flushFrame();
  deepEqual(applied, [100, 101], 'continued dragging should update continuously across frames');
  await updates.update('commit');
  deepEqual(saved, [101], 'release should persist the final value');
  equal(clock.pendingTimers, 0, 'release should cancel the pending debounce');
  await updates.update('commit');
  deepEqual(saved, [101], 'duplicate completion events should not save twice');
  value = 102; await updates.update('live'); clock.flushTimer(); await settle();
  deepEqual(saved, [101, 102], 'a quiet interval should persist without requiring a release event');
  await updates.close();
  equal(clock.pendingFrames, 0, 'close should release scheduled runtime work');
});

test('live settings preserve newer values while saves are in flight and flush on shutdown', async () => {
  const clock = new InstrumentedPlatform(new Window());
  let value = 1;
  const saved: number[] = [];
  let finish!: () => void;
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => {}, async () => {
    saved.push(value);
    if (saved.length === 1) await new Promise<void>(resolve => { finish = resolve; });
  }, error => { throw error; });
  await updates.update('live');
  const first = updates.update('commit'); await settle();
  value = 2; await updates.update('live');
  const closing = updates.close();
  finish(); await first; await closing;
  deepEqual(saved, [1, 2], 'shutdown should await the earlier save and persist the latest pending value');
  equal(clock.pendingTimers, 0, 'shutdown should cancel save timers');
  equal(clock.pendingFrames, 0, 'shutdown should cancel frame requests');
});

test('failed deferred persistence can retry the current value on final commit', async () => {
  const clock = new InstrumentedPlatform(new Window());
  let attempts = 0;
  let errors = 0;
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => {}, async () => {
    if (++attempts === 1) throw new Error('disk failure');
  }, () => { errors++; });
  await updates.update('live'); clock.flushTimer(); await settle();
  equal(errors, 1, 'background persistence failures should be reported');
  await updates.update('commit');
  equal(attempts, 2, 'release should retry the pending save');
  await updates.close();
});

test('Quick Settings sliders update live, expose Reset immediately, and persist release, number entry, and disposal', async () => {
  const runtime = runtimeHarness();
  const clock = new InstrumentedPlatform(runtime.window);
  let context!: GraphEngineSessionUiMountContextV1;
  let refreshes = 0;
  const saved: unknown[] = [];
  const updates = new GraphEngineSettingsUpdatesV1(clock, () => {
    refreshes++; runtime.factory.refreshActiveProfiles();
  }, async () => { saved.push(runtime.profiles.getUserOverrides('synthetic-consumer', 'two-dimensional')); }, error => { throw error; });
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.0', engineInstanceId: 'live-sliders', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
    onProfilesChanged: mode => updates.update(mode),
    sessionUiHost: { mount: value => { context = value; return { dispose() {} }; } },
  });
  const lease = core.connectLocal({ consumerId: 'synthetic-consumer', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
  assert(lease.ok, 'the slider should have a real settings port');
  const session = await lease.lease.createSession({
    consumerId: 'synthetic-consumer', profileId: 'two-dimensional', container: runtime.container, document: runtimeFixture(),
  });
  const panel = new GraphEngineQuickSettingsPanelV1(context, { quickSettings: { visibility: 'shown' } } as EffectiveGraphSessionUiPolicyV1);
  const host = runtime.document.createElement('div'); runtime.container.append(host);
  const sliderProbe = panel as unknown as { slider(parent: HTMLElement, name: string, value: number, min: number, max: number, step: number, moduleId: string, key: string): void };
  sliderProbe.slider(host, 'Node size', 1, 0.1, 5, 0.1, 'rendering', 'nodeRadiusScale');
  const range = host.querySelector<HTMLInputElement>('input[type=range]')!;
  const number = host.querySelector<HTMLInputElement>('input[type=number]')!;
  const reset = host.querySelector<HTMLElement>('[aria-label="Reset to profile default"]')!;
  const emit = (type: string, target: HTMLElement = range) => target.dispatchEvent(new runtime.window.Event(type) as unknown as Event);
  try {
    const countsBefore = runtime.factory.getDiagnostics().sessions[0].counters!.documentExports;
    await (panel as any).refreshGraphCounts();
    equal(runtime.factory.getDiagnostics().sessions[0].counters!.documentExports, countsBefore,
      'Quick Settings counts use statistics without cloning graph data');
    equal(reset.hidden, true, 'Reset should start hidden for a default value');
    const before = runtime.factory.getDiagnostics().sessions[0].counters?.projectionPasses;
    for (const value of ['1.2', '1.8', '2.4']) { range.value = value; emit('input'); }
    equal(context.profileSettings.getUserOverrides().modules?.rendering?.settings?.nodeRadiusScale, 2.4,
      'input should synchronously update the in-memory profile');
    equal(reset.hidden, false, 'the first adjustment should immediately expose Reset');
    equal(host.querySelector('input[type=range]'), range, 'showing Reset must retain the active slider element');
    equal(number.value, '2.4', 'number feedback should follow every input');
    equal(refreshes, 0, 'runtime refreshes should wait for the next frame');
    clock.flushFrame();
    equal(refreshes, 1, 'one burst should refresh runtime once');
    equal((await session.exportEffectiveSettings()).modules.rendering.settings.nodeRadiusScale, 2.4,
      'the graph should receive the latest value before release');
    equal(runtime.factory.getDiagnostics().sessions[0].counters?.projectionPasses, before,
      'node size must not rebuild the graph projection');
    equal(saved.length, 0, 'live runtime updates should not save every input');
    emit('change'); emit('pointerup'); await settle();
    equal(saved.length, 1, 'release events should commit one final settings snapshot');
    number.value = '3.1'; emit('input', number); emit('blur', number); await settle();
    equal(saved.length, 2, 'finishing numeric entry should commit its final value');
    reset.click(); await settle();
    equal(context.profileSettings.getUserOverrides().modules?.rendering?.settings?.nodeRadiusScale, undefined, 'Reset should remove the override');
    equal(reset.hidden, true, 'Reset should immediately disappear when the override is removed');
    range.value = '4'; emit('input'); panel.dispose(); await settle();
    const final = saved.at(-1) as { modules: { rendering: { settings: { nodeRadiusScale: number } } } };
    equal(final.modules.rendering.settings.nodeRadiusScale, 4, 'panel disposal should commit the last pending slider value');
  } finally { panel.dispose(); await updates.close(); await core.dispose(); }
});
