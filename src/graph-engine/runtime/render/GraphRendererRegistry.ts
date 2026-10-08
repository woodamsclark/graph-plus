import { CanvasGraphRenderer } from './CanvasGraphRenderer.ts';
import type {
  GraphRendererBackendIdV2,
  GraphRendererCapabilitiesV2,
  GraphRendererFactoryContextV2,
  GraphRendererFactoryV2,
  GraphRendererSelectionV2,
} from './GraphRenderer.ts';

export class GraphRendererRegistry {
  private readonly factories = new Map<GraphRendererBackendIdV2, GraphRendererFactoryV2>();

  register(factory: GraphRendererFactoryV2): void {
    if (this.factories.has(factory.backendId)) throw new Error(`Renderer backend "${factory.backendId}" is already registered.`);
    this.factories.set(factory.backendId, factory);
  }

  descriptors(): readonly GraphRendererFactoryV2[] {
    return [...this.factories.values()].sort((left, right) => right.priority - left.priority || left.backendId.localeCompare(right.backendId));
  }
}

export function createDefaultGraphRendererRegistry(): GraphRendererRegistry {
  const registry = new GraphRendererRegistry();
  registry.register({
    backendId: 'canvas2d',
    priority: 0,
    supports: (capabilities) => capabilities.canvas2d.apiAvailable,
    create: ({ createCanvas, now }) => new CanvasGraphRenderer(createCanvas(), now),
  });
  return registry;
}

export function detectGraphRendererCapabilities(document: Document, window: Window): GraphRendererCapabilitiesV2 {
  const supports = (contextId: '2d' | 'webgl' | 'webgl2'): boolean => {
    try {
      return document.createElement('canvas').getContext(contextId) !== null;
    } catch {
      return false;
    }
  };
  return {
    canvas2d: { apiAvailable: supports('2d') },
    webgl: { apiAvailable: supports('webgl') },
    webgl2: { apiAvailable: supports('webgl2') },
    webgpu: { apiAvailable: 'gpu' in (window.navigator as Navigator & { gpu?: unknown }) },
  };
}

export function selectGraphRenderer(options: {
  readonly registry: GraphRendererRegistry;
  readonly capabilities: GraphRendererCapabilitiesV2;
  readonly context: GraphRendererFactoryContextV2;
  readonly preferredBackend?: GraphRendererBackendIdV2;
}): GraphRendererSelectionV2 {
  const descriptors = options.registry.descriptors();
  const ordered = options.preferredBackend
    ? [...descriptors].sort((left, right) => Number(right.backendId === options.preferredBackend) - Number(left.backendId === options.preferredBackend))
    : descriptors;
  const attempts: Array<{ backendId: GraphRendererBackendIdV2; ok: boolean; reason?: string }> = [];
  for (const factory of ordered) {
    if (!factory.supports(options.capabilities)) {
      attempts.push({ backendId: factory.backendId, ok: false, reason: 'capability-unavailable' });
      continue;
    }
    let renderer: ReturnType<GraphRendererFactoryV2['create']> | undefined;
    try {
      renderer = factory.create(options.context);
      const initialization = renderer.initialize();
      if (initialization instanceof Promise) {
        void initialization.catch(() => undefined);
        throw new Error('Asynchronous renderer initialization is not supported by this runtime revision.');
      }
      attempts.push({ backendId: factory.backendId, ok: true });
      return {
        renderer,
        capabilities: options.capabilities,
        registeredBackendIds: descriptors.map((descriptor) => descriptor.backendId),
        attempts,
      };
    } catch (error) {
      try { renderer?.dispose(); } catch {}
      attempts.push({ backendId: factory.backendId, ok: false, reason: errorMessage(error) });
    }
  }
  throw new Error(`No graph renderer could initialize: ${attempts.map((attempt) => `${attempt.backendId}: ${attempt.reason}`).join('; ')}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
