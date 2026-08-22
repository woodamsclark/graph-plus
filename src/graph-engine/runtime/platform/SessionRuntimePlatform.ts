export interface SessionResizeObserverV1 {
  observe(target: Element): void;
  disconnect(): void;
}

export interface SessionRuntimePlatformV1 {
  readonly document: Document;
  readonly window: Window;
  readonly devicePixelRatio: number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  createResizeObserver(callback: ResizeObserverCallback): SessionResizeObserverV1;
  now(): number;
}

export type SessionRuntimePlatformFactoryV1 = (container: HTMLElement) => SessionRuntimePlatformV1;

export function createSessionRuntimePlatformV1(container: HTMLElement): SessionRuntimePlatformV1 {
  const document = container.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error('A graph session container must belong to a document with a window.');
  const ResizeObserverConstructor = window.ResizeObserver;
  if (!ResizeObserverConstructor) throw new Error('The graph session window does not provide ResizeObserver.');

  return {
    document,
    window,
    get devicePixelRatio() {
      return finitePositive(window.devicePixelRatio) ? window.devicePixelRatio : 1;
    },
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    createResizeObserver: (callback) => new ResizeObserverConstructor(callback),
    now: () => window.performance.now(),
  };
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
