import { Window } from 'happy-dom';
import { mountGraphPlusCheckpointRecoverySurfaceV1 } from '../../src/obsidian/GraphPlusCheckpointRecoverySurface.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

test('recovery surface explains preservation and offers only available explicit actions', async () => {
  const window = new Window();
  const container = window.document.createElement('div') as unknown as HTMLElement;
  const called: string[] = [];
  const options = {
    message: 'Saved data has been preserved.',
    onRetry: async () => { called.push('retry'); },
    onReset: async () => { called.push('confirm-reset'); },
    onError: () => { throw new Error('unexpected failure'); },
  };
  const first = mountGraphPlusCheckpointRecoverySurfaceV1(container, options);
  deepEqual(Array.from(container.querySelectorAll('button')).map(button => button.textContent), ['Retry', 'Reset saved layout…'], 'no previous restore is promised without a backup');
  assert(container.querySelector('[role="alert"]')?.textContent?.includes('preserved'), 'saved-state protection is visible');
  const reset = container.querySelectorAll('button')[1];
  reset.click(); await Promise.resolve(); await Promise.resolve();
  deepEqual(called, ['confirm-reset'], 'reset opens the explicit confirmation action');
  first.dispose(); equal(container.childElementCount, 0, 'surface disposal removes the controls');
  mountGraphPlusCheckpointRecoverySurfaceV1(container, {
    ...options, onRestorePrevious: async () => { called.push('previous'); },
  });
  equal(container.querySelectorAll('button')[1].textContent, 'Restore previous layout', 'valid backup exposes recovery');
});

test('recovery controls serialize actions and report failure while leaving retry available', async () => {
  const window = new Window();
  const container = window.document.createElement('div') as unknown as HTMLElement;
  let resume!: () => void; let runs = 0; let failure: unknown;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  mountGraphPlusCheckpointRecoverySurfaceV1(container, {
    message: 'Preserved', onRetry: async () => { runs += 1; await waiting; throw new Error('still inaccessible'); },
    onRestorePrevious: async () => { runs += 1; }, onReset: async () => { runs += 1; },
    onError: error => { failure = error; },
  });
  const buttons = Array.from(container.querySelectorAll('button'));
  buttons[0].click(); buttons[1].click();
  await Promise.resolve();
  equal(runs, 1, 'a second recovery action is not admitted while retry runs');
  assert(buttons.every(button => button.disabled), 'all actions are disabled while recovery runs');
  resume(); for (let i = 0; i < 8; i++) await Promise.resolve();
  assert(failure instanceof Error && failure.message === 'still inaccessible', 'failure reaches the host');
  assert(buttons.every(button => !button.disabled), 'retry remains available after failure');
});
