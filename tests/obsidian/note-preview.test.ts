import { Window } from 'happy-dom';
import { GraphPlusNotePreviewControllerV1 } from '../../src/obsidian/GraphPlusNotePreviewController.ts';
import { assert, equal, test } from '../support/harness.ts';
import { resolveAnimaPreviewCard } from '../../src/graph-engine/runtime/modules/shipped/AnimaPreviewPresentation.ts';

test('V1.8 Anima preview placement fits narrow and edge-adjacent viewports', () => {
  for (const width of [180, 320, 1200]) {
    for (const x of [0, width / 2, width]) {
      const card = resolveAnimaPreviewCard({
        anchor: { x, y: 300 }, viewport: { width, height: 320 }, measuredHeight: 900,
      });
      assert(card.left >= 12 && card.left + card.width <= width - 12,
        'the whole card must remain inside the horizontal viewport');
      assert(card.top >= 12 && card.top + card.maxHeight <= 308,
        'a long note must remain bounded vertically');
    }
  }
});

test('V1.8 custom note preview delays, renders, scrolls, hands off, and dismisses semantically', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  container.getBoundingClientRect = () => bounds(640, 360);
  canvas.getBoundingClientRect = () => bounds(640, 360);
  container.append(canvas);
  document.body.append(container);
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let dismissed = 0;
  const surfaceStates: boolean[] = [];
  let disposedRenders = 0;
  const controller = new GraphPlusNotePreviewControllerV1({
    container,
    isVisible: () => true,
    readFile: async () => '# Preview body',
    renderMarkdown: async (markdown, element) => {
      element.textContent = markdown;
      return { dispose: () => { disposedRenders += 1; } };
    },
    openFile: async () => undefined,
    onPreviewSurfaceActive: (active) => { surfaceStates.push(active); },
    onDismissRequested: () => { dismissed += 1; },
    clock: {
      setTimeout: (callback) => {
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => { timers.delete(handle); },
    },
  });

  controller.update({
    nodeId: 'note:a', file: { path: 'notes/a.md' }, anchor: { x: 100, y: 80 }, active: true,
  });
  equal(controller.getPhase(), 'waiting', 'semantic preview should become active before its card delay');
  equal(container.querySelector('.graphplus-note-preview'), null, 'the card should respect its bounded opening delay');
  await runTimers(timers);
  const card = container.querySelector('.graphplus-note-preview') as HTMLElement | null;
  assert(card, 'the custom preview card should mount after the delay');
  equal(card.style.left, '118px', 'placement should use CSS coordinates independently of backing resolution');
  equal(card.getAttribute('role'), 'region', 'the preview should expose a named semantic region');
  equal(card.querySelector('.graphplus-note-preview-body')?.textContent, '# Preview body',
    'the custom surface should render current note Markdown through its host renderer');

  card.dispatchEvent(new window.PointerEvent('pointerenter') as unknown as Event);
  equal(controller.getPhase(), 'card-active', 'entering the card should transfer semantic preview ownership');
  controller.update({ active: false });
  await runTimers(timers);
  assert(container.querySelector('.graphplus-note-preview'), 'Mod release inside the card should keep it interactive');
  const wheel = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  card.dispatchEvent(wheel as unknown as Event);
  equal(wheel.defaultPrevented, false, 'the custom preview should retain native scrolling behavior');

  card.dispatchEvent(new window.PointerEvent('pointerleave') as unknown as Event);
  await runTimers(timers);
  equal(container.querySelector('.graphplus-note-preview'), null, 'leaving the card should dismiss the custom preview');
  equal(dismissed, 1, 'card dismissal should request one engine semantic-preview clear');
  equal(disposedRenders, 1, 'dismissal should dispose rendered Markdown children');
  assert(surfaceStates.includes(true) && surfaceStates.at(-1) === false,
    'the host should report preview-surface enter and leave to the engine');
  controller.dispose();
});

test('V1.8 rapid preview transfer cannot render stale note content', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  container.getBoundingClientRect = () => bounds(640, 360);
  canvas.getBoundingClientRect = () => bounds(640, 360);
  container.append(canvas);
  document.body.append(container);
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const reads = new Map<string, (value: string) => void>();
  const controller = new GraphPlusNotePreviewControllerV1({
    container,
    isVisible: () => true,
    readFile: (file) => new Promise((resolve) => { reads.set(file.path, resolve); }),
    renderMarkdown: async (markdown, element) => {
      element.textContent = markdown;
      return { dispose: () => undefined };
    },
    openFile: async () => undefined,
    onPreviewSurfaceActive: () => undefined,
    onDismissRequested: () => undefined,
    clock: {
      setTimeout: (callback) => {
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => { timers.delete(handle); },
    },
  });
  controller.update({ nodeId: 'a', file: { path: 'a.md' }, anchor: { x: 80, y: 80 }, active: true });
  await runTimers(timers, 1);
  controller.update({ nodeId: 'b', file: { path: 'b.md' }, anchor: { x: 120, y: 80 }, active: true });
  await runTimers(timers, 1);
  reads.get('a.md')?.('stale A');
  await Promise.resolve();
  reads.get('b.md')?.('current B');
  await Promise.resolve();
  await Promise.resolve();
  equal(container.querySelector('.graphplus-note-preview-body')?.textContent, 'current B',
    'a late read from the prior target must not replace the current card');
  controller.dispose();
});

async function runTimers(timers: Map<number, () => void>, limit = Number.POSITIVE_INFINITY): Promise<void> {
  let count = 0;
  while (timers.size && count < limit) {
    const [handle, callback] = timers.entries().next().value as [number, () => void];
    timers.delete(handle);
    callback();
    count += 1;
    await Promise.resolve();
    await Promise.resolve();
  }
}

function bounds(width: number, height: number): DOMRect {
  return {
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
    toJSON: () => ({}),
  } as DOMRect;
}
