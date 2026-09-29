import { Window } from 'happy-dom';
import type {
  ConsumerRegistrationV1,
  GraphDocumentV1,
  GraphExperienceContractV1,
  GraphSettingsOverridesV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../../src/graph-engine/core/profile/index.ts';
import {
  DEFAULT_GRAPH_RENDER_THEME_V1,
  GraphModuleRegistry,
  SessionFactory,
  type GraphVisualThemeV2,
  type GraphNodeActionRuntimeV1,
  type GraphRendererBackendIdV2,
  type GraphRendererRegistryV2,
  type SessionResizeObserverV1,
  type SessionRuntimePlatformV1,
} from '../../src/graph-engine/runtime/index.ts';
import { graphDocument, graphEdge, graphNode } from './contractFixtures.ts';
import { assert, equal } from './harness.ts';

export class InstrumentedPlatform implements SessionRuntimePlatformV1 {
  readonly document: Document;
  readonly window: globalThis.Window;
  pixelRatio = 2;
  observedTargets: Element[] = [];
  disconnectedObservers = 0;
  cancelledFrames = 0;
  visibilityListenerAdds = 0;
  visibilityListenerRemoves = 0;
  failObservation = false;
  private currentTime = 100;
  private frameTimestamp = 0;
  private nextHandle = 1;
  private readonly frames = new Map<number, FrameRequestCallback>();
  private readonly timers = new Map<number, () => void>();
  private resizeCallback: ResizeObserverCallback | null = null;

  constructor(window: Window, private readonly realTime = false) {
    this.document = window.document as unknown as Document;
    this.window = window as unknown as globalThis.Window;
    const addEventListener = this.document.addEventListener.bind(this.document);
    const removeEventListener = this.document.removeEventListener.bind(this.document);
    this.document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'visibilitychange') this.visibilityListenerAdds += 1;
      addEventListener(type, listener, options);
    }) as typeof this.document.addEventListener;
    this.document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'visibilitychange') this.visibilityListenerRemoves += 1;
      removeEventListener(type, listener, options);
    }) as typeof this.document.removeEventListener;
  }

  get devicePixelRatio(): number {
    return this.pixelRatio;
  }

  get pendingFrames(): number {
    return this.frames.size;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    if (this.frames.delete(handle)) this.cancelledFrames += 1;
  }

  setTimeout(callback: () => void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  createResizeObserver(callback: ResizeObserverCallback): SessionResizeObserverV1 {
    this.resizeCallback = callback;
    return {
      observe: (target) => {
        if (this.failObservation) throw new Error('resize observation failed');
        this.observedTargets.push(target);
      },
      disconnect: () => {
        this.disconnectedObservers += 1;
        this.observedTargets = [];
      },
    };
  }

  now(): number {
    return this.realTime ? performance.now() : this.currentTime;
  }

  advanceTime(milliseconds: number): void {
    this.currentTime += milliseconds;
  }

  flushFrame(timestamp?: number): void {
    const entry = this.frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) return;
    this.frames.delete(entry[0]);
    this.frameTimestamp = timestamp ?? this.frameTimestamp + 1_000 / 60;
    entry[1](this.frameTimestamp);
  }

  flushTimer(): void {
    const entry = this.timers.entries().next().value as [number, () => void] | undefined;
    if (!entry) return;
    this.timers.delete(entry[0]);
    entry[1]();
  }

  triggerResize(): void {
    this.resizeCallback?.([], {} as ResizeObserver);
  }
}

export function runtimeRegistration(): ConsumerRegistrationV1 {
  return {
    consumerId: 'synthetic-consumer',
    displayName: 'Synthetic Consumer',
    consumerVersion: '1.0.0',
    supportedProtocolVersions: [1],
    profiles: [
      {
        profileId: 'two-dimensional',
        displayName: 'Two dimensional',
        descriptorVersion: 1,
        dimensions: '2d',
        requestedCapabilities: ['render'],
        modules: {
          rendering: { policy: 'required' },
          filtering: { policy: 'required' },
          form: { policy: 'optional', defaultEnabled: false },
          'node-regions': { policy: 'optional', defaultEnabled: false },
          'force-layout': { policy: 'optional', defaultEnabled: false },
          anima: { policy: 'optional', defaultEnabled: false },
        },
      },
      {
        profileId: 'three-dimensional',
        displayName: 'Three dimensional',
        descriptorVersion: 1,
        dimensions: '3d',
        requestedCapabilities: ['render'],
        modules: {
          rendering: { policy: 'required' },
          filtering: { policy: 'required' },
          form: { policy: 'optional', defaultEnabled: false },
          'node-regions': { policy: 'optional', defaultEnabled: false },
          'force-layout': { policy: 'optional', defaultEnabled: false },
          anima: { policy: 'optional', defaultEnabled: false },
        },
      },
    ],
  };
}

export function runtimeFixture(): GraphDocumentV1 {
  return graphDocument({
    nodes: [
      graphNode('a', { tokens: ['keep'], positionHint: { x: 10, y: 20, z: 0 } }),
      graphNode('b', { tokens: ['remove'], positionHint: { x: 30, y: 40, z: 0 } }),
      graphNode('c', { tokens: ['keep'] }),
    ],
    edges: [
      graphEdge('a-b', 'a', 'b', { tokens: ['ordinary'] }),
      graphEdge('a-c', 'a', 'c', { tokens: ['important'], directed: true }),
    ],
  });
}

export function runtimeHarness(options: {
  consumerId?: string;
  profileId?: string;
  document?: GraphDocumentV1;
  experience?: GraphExperienceContractV1;
  registration?: ConsumerRegistrationV1;
  modules?: GraphModuleRegistry;
  getGlobalOverrides?: () => GraphSettingsOverridesV1;
  resolveThemePalette?: (container: HTMLElement) => GraphVisualThemeV2;
  nodeActions?: GraphNodeActionRuntimeV1;
  realTime?: boolean;
  rendererRegistry?: GraphRendererRegistryV2;
  preferredRendererBackend?: GraphRendererBackendIdV2;
} = {}) {
  const window = new Window();
  const drawCalls: string[] = [];
  const drawArguments: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  const styleAssignments: string[] = [];
  const Canvas = (window as unknown as { HTMLCanvasElement: { prototype: HTMLCanvasElement } }).HTMLCanvasElement;
  Canvas.prototype.getContext = function getContext(contextId: string) {
    return contextId === '2d' ? fakeCanvasContext(drawCalls, styleAssignments, drawArguments) : null;
  } as HTMLCanvasElement['getContext'];
  const document = window.document as unknown as Document;
  const container = document.createElement('section');
  const size = { width: 640, height: 360 };
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({
      width: size.width,
      height: size.height,
      x: 0,
      y: 0,
      top: 0,
      right: size.width,
      bottom: size.height,
      left: 0,
    }),
  });
  document.body.append(container);
  const platform = new InstrumentedPlatform(window, options.realTime ?? false);
  const profiles = new ConsumerProfileRegistry();
  profiles.registerConsumer(options.registration ?? runtimeRegistration());
  const factory = new SessionFactory({
    engineInstanceId: 'engine-test',
    profiles,
    createSessionId: () => 'session-test',
    createPlatform: (target) => {
      equal(target, container, 'factory must derive its platform from the supplied container');
      return platform;
    },
    ...(options.modules ? { modules: options.modules } : {}),
    ...(options.getGlobalOverrides ? { getGlobalOverrides: options.getGlobalOverrides } : {}),
    resolveThemePalette: options.resolveThemePalette ?? (() => DEFAULT_GRAPH_RENDER_THEME_V1),
    ...(options.rendererRegistry ? { rendererRegistry: options.rendererRegistry } : {}),
    ...(options.preferredRendererBackend ? { preferredRendererBackend: options.preferredRendererBackend } : {}),
  });
  return {
    window,
    document,
    container,
    platform,
    profiles,
    factory,
    drawCalls,
    drawArguments,
    styleAssignments,
    resize: (width: number, height: number, pixelRatio: number) => {
      size.width = width;
      size.height = height;
      platform.pixelRatio = pixelRatio;
      platform.triggerResize();
    },
    create: (restoreViewState?: Parameters<typeof factory.createSession>[0]['restoreViewState']) => factory.createSession({
        consumerId: options.consumerId ?? 'synthetic-consumer',
        profileId: options.profileId ?? 'two-dimensional',
        container,
        document: options.document ?? runtimeFixture(),
        experience: options.experience,
        restoreViewState,
      }, { nodeActions: options.nodeActions }),
  };
}

export function runtimeSurface(container: HTMLElement): HTMLElement {
  const value = container.querySelector<HTMLElement>('[data-graph-engine-session]');
  assert(value, 'session surface should be mounted');
  return value;
}

export function runtimeCanvas(container: HTMLElement): HTMLCanvasElement {
  const value = runtimeSurface(container).querySelector<HTMLCanvasElement>('canvas');
  assert(value, 'session canvas should be mounted');
  return value;
}

function fakeCanvasContext(
  calls: string[],
  styleAssignments: string[],
  drawArguments: Array<{ readonly method: string; readonly args: readonly unknown[] }>,
): CanvasRenderingContext2D {
  const methods = [
    'arc',
    'beginPath',
    'clearRect',
    'closePath',
    'fill',
    'fillRect',
    'fillText',
    'lineTo',
    'moveTo',
    'quadraticCurveTo',
    'restore',
    'save',
    'setLineDash',
    'setTransform',
    'stroke',
  ];
  return new Proxy({} as CanvasRenderingContext2D, {
    get(target, property) {
      if (property === 'measureText') {
        return (value: string) => {
          calls.push('measureText');
          return { width: value.length * 7 };
        };
      }
      if (typeof property === 'string' && methods.includes(property)) {
        return (...args: unknown[]) => {
          calls.push(property);
          drawArguments.push({ method: property, args });
        };
      }
      return Reflect.get(target, property);
    },
    set(target, property, value) {
      if (typeof property === 'string') styleAssignments.push(`${property}:${String(value)}`);
      return Reflect.set(target, property, value);
    },
  });
}
