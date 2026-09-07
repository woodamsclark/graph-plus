import { Window } from 'happy-dom';
import { GraphPlusNotePreviewControllerV1 } from '../../src/obsidian/GraphPlusNotePreviewController.ts';
import { assert, equal, test } from '../support/harness.ts';

test('native note preview remains interactive during pointer handoff and closes after exit', () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360,
    toJSON: () => ({}),
  });
  container.append(canvas);
  document.body.append(container);
  const hoverEl = document.createElement('div');
  document.body.append(hoverEl);
  let popover: { hoverEl: HTMLElement; hide: () => void } | null = null;
  let hidden = 0;
  let requests = 0;
  let nativeTarget: HTMLElement | undefined;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const controller = new GraphPlusNotePreviewControllerV1({
    container,
    source: 'graph-plus',
    hoverParent: {},
    getHoverPopover: () => popover,
    triggerHoverLink: (request) => {
      requests += 1;
      nativeTarget = request.targetEl;
      popover = { hoverEl, hide: () => { hidden += 1; } };
    },
    isVisible: () => true,
    clock: {
      setTimeout: (callback) => {
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => { timers.delete(handle); },
    },
  });

  controller.update({ file: { path: 'notes/a.md' }, anchor: { x: 100, y: 80 }, mod: true });
  equal(requests, 1, 'valid Mod hover should request one native preview');
  const anchor = container.querySelector('.graphplus-native-preview-anchor') as HTMLElement | null;
  assert(anchor, 'preview should retain its native anchor');
  equal(nativeTarget, anchor, 'Obsidian should receive the cursor-sized anchor as its native hover target');
  equal(anchor.style.pointerEvents, 'auto', 'the native hover target should participate in desktop hit testing');

  controller.update({ mod: false });
  anchor.dispatchEvent(new window.PointerEvent('pointerenter') as unknown as Event);
  for (const callback of [...timers.values()]) callback();
  timers.clear();
  assert(container.querySelector('.graphplus-native-preview-anchor'), 'stationary hover should preserve the preview anchor');
  anchor.dispatchEvent(new window.PointerEvent('pointerleave') as unknown as Event);
  hoverEl.dispatchEvent(new window.PointerEvent('pointerenter') as unknown as Event);
  for (const callback of [...timers.values()]) callback();
  timers.clear();
  assert(container.querySelector('.graphplus-native-preview-anchor'), 'entering the popover should preserve the preview');
  const wheel = new window.WheelEvent('wheel', { cancelable: true, deltaY: 80 });
  hoverEl.dispatchEvent(wheel as unknown as Event);
  equal(wheel.defaultPrevented, false, 'graph+ should leave preview scrolling to Obsidian');

  hoverEl.dispatchEvent(new window.PointerEvent('pointerleave') as unknown as Event);
  for (const callback of [...timers.values()]) callback();
  timers.clear();
  equal(container.querySelector('.graphplus-native-preview-anchor'), null, 'leaving the popover should release the anchor');
  equal(hidden, 1, 'leaving the popover should dismiss the native preview once');
});
