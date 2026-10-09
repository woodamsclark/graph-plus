import { startGraphPlusShutdownV1, waitForGraphPlusShutdownV1 } from '../../src/obsidian/GraphPlusShutdown.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('shutdown waits for checkpoints and queued persistence before leases/provider and blocks reload', async () => {
  const events: string[] = [];
  const checkpoint = gate(); const persistence = gate();
  const steps = {
    stopActivity: () => { events.push('stop-activity'); },
    closePresentations: async () => { events.push('checkpoint-start'); await checkpoint.promise; events.push('checkpoint-done'); },
    drainPersistence: async () => { events.push('persistence-start'); await persistence.promise; events.push('persistence-done'); },
    releaseLease: async () => { events.push('lease'); },
    stopProvider: async () => { events.push('provider'); },
    clearReferences: () => { events.push('clear'); },
  };
  const completion = startGraphPlusShutdownV1('shutdown-order-test', steps);
  equal(startGraphPlusShutdownV1('shutdown-order-test', steps), completion, 'duplicate shutdown shares completion');
  let reloaded = false;
  const reload = waitForGraphPlusShutdownV1('shutdown-order-test').then(() => { reloaded = true; });
  await Promise.resolve();
  deepEqual(events, ['stop-activity', 'checkpoint-start'], 'provider stays alive while checkpoint is pending');
  checkpoint.release();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  equal(reloaded, false, 'new load still waits for plugin-data persistence');
  persistence.release(); await completion; await reload;
  deepEqual(events, ['stop-activity', 'checkpoint-start', 'checkpoint-done', 'persistence-start', 'persistence-done', 'lease', 'provider', 'clear'], 'ordered shutdown');
});

test('shutdown completes cleanup after save failure and releases its reload barrier', async () => {
  const events: string[] = [];
  let reported: unknown;
  await startGraphPlusShutdownV1('shutdown-failure-test', {
    stopActivity: () => { events.push('stop'); },
    closePresentations: async () => { throw new Error('checkpoint rejected'); },
    drainPersistence: async () => { events.push('drain'); },
    releaseLease: async () => { events.push('lease'); },
    stopProvider: async () => { events.push('provider'); },
    clearReferences: () => { events.push('clear'); },
  }).catch(error => { reported = error; });
  assert(reported instanceof Error && reported.message.includes('checkpoint rejected'), 'save failure is reported');
  deepEqual(events, ['stop', 'drain', 'lease', 'provider', 'clear'], 'cleanup is not abandoned');
  await waitForGraphPlusShutdownV1('shutdown-failure-test');
});
