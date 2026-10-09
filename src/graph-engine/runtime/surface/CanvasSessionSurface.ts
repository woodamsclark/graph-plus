import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import type { SessionResizeObserverV1, SessionRuntimePlatformV1 } from '../platform/index.ts';
import type { GraphRendererBackendIdV2 } from '../render/index.ts';
import type {
  SessionSurfaceStateV1,
  SessionSurfaceV1,
  SessionSurfaceViewportV1,
} from './SessionSurface.ts';

const IDLE_DONUT_CURSOR = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 16 16%22%3E%3Ccircle cx=%228%22 cy=%228%22 r=%224.5%22 fill=%22none%22 stroke=%22%23111%22 stroke-width=%223.5%22/%3E%3Ccircle cx=%228%22 cy=%228%22 r=%224.5%22 fill=%22none%22 stroke=%22%23f7f2e8%22 stroke-width=%221.4%22/%3E%3C/svg%3E") 8 8, default';
// Three poses share a centered hotspot: pressed low, resting, and raised on hover.
function donutCursor(radius: number, fallback: 'pointer' | 'grabbing'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="${radius}" fill="none" stroke="#111" stroke-width="3.5"/><circle cx="10" cy="10" r="${radius}" fill="none" stroke="#f7f2e8" stroke-width="1.4"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, ${fallback}`;
}

const CURSOR_IMAGES = {
  default: IDLE_DONUT_CURSOR,
  pointer: donutCursor(6, 'pointer'),
  grabbing: donutCursor(3, 'grabbing'),
};

export class CanvasSessionSurface implements SessionSurfaceV1 {

  private readonly container: HTMLElement;
  private readonly platform: SessionRuntimePlatformV1;
  private readonly root: HTMLDivElement;
  private readonly accessibleSummary: HTMLDivElement;
  private readonly resizeObserver: SessionResizeObserverV1;
  private readonly resizeListeners = new Set<(viewport: SessionSurfaceViewportV1) => void>();
  private viewport: SessionSurfaceViewportV1 = { width: 0, height: 0, devicePixelRatio: 1 };
  private activeCanvas?: HTMLCanvasElement;
  private pixelRatioLimit?: number;
  private disposed = false;

  constructor(options: {
    readonly sessionId: string;
    readonly dimensions: GraphDimensionsV1;
    readonly container: HTMLElement;
    readonly platform: SessionRuntimePlatformV1;
    readonly pixelRatioLimit?: number;
  }) {
    this.container = options.container;
    this.platform = options.platform;
    this.pixelRatioLimit = finitePositive(options.pixelRatioLimit) ? options.pixelRatioLimit : undefined;
    this.root = this.platform.document.createElement('div');
    this.root.className = 'graph-engine-session';
    this.root.dataset.graphEngineSession = options.sessionId;
    this.root.dataset.dimensions = options.dimensions;
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    this.root.style.position = 'relative';
    this.root.style.overflow = 'hidden';

    this.accessibleSummary = this.platform.document.createElement('div');
    this.accessibleSummary.className = 'graph-engine-accessible-summary';
    this.accessibleSummary.setAttribute('role', 'status');
    this.accessibleSummary.setAttribute('aria-live', 'polite');
    this.accessibleSummary.style.position = 'absolute';
    this.accessibleSummary.style.width = '1px';
    this.accessibleSummary.style.height = '1px';
    this.accessibleSummary.style.overflow = 'hidden';
    this.accessibleSummary.style.clipPath = 'inset(50%)';
    this.accessibleSummary.style.whiteSpace = 'nowrap';

    this.root.append(this.accessibleSummary);
    this.resizeObserver = this.platform.createResizeObserver(() => this.resize());
    try {
      this.container.append(this.root);
      this.resizeObserver.observe(this.container);
      this.resize();
    } catch (error) {
      this.resizeObserver.disconnect();
      this.root.remove();
      this.disposed = true;
      throw error;
    }
  }

  getViewport(): SessionSurfaceViewportV1 {
    return { ...this.viewport };
  }

  get canvas(): HTMLCanvasElement {
    if (!this.activeCanvas) throw new Error('The graph renderer has not mounted a canvas.');
    return this.activeCanvas;
  }

  createRendererCanvas(): HTMLCanvasElement {
    if (this.disposed) throw new Error('The graph surface has been disposed.');
    this.activeCanvas?.remove();
    const canvas = this.platform.document.createElement('canvas');
    canvas.className = 'graph-engine-surface';
    canvas.tabIndex = 0;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Interactive graph surface');
    canvas.width = Math.round(this.viewport.width * this.viewport.devicePixelRatio);
    canvas.height = Math.round(this.viewport.height * this.viewport.devicePixelRatio);
    this.root.insertBefore(canvas, this.accessibleSummary);
    this.activeCanvas = canvas;
    return canvas;
  }

  onResize(listener: (viewport: SessionSurfaceViewportV1) => void) {
    if (this.disposed) throw new Error('The graph surface has been disposed.');
    this.resizeListeners.add(listener);
    return { dispose: () => this.resizeListeners.delete(listener) };
  }

  setPixelRatioLimit(limit?: number): void {
    const next = finitePositive(limit) ? limit : undefined;
    if (next === this.pixelRatioLimit) return;
    this.pixelRatioLimit = next;
    this.resize();
  }

  setDimensions(dimensions: GraphDimensionsV1): void {
    if (this.disposed) return;
    this.root.dataset.dimensions = dimensions;
  }

  setRendererBackend(backendId: GraphRendererBackendIdV2): void {
    if (!this.disposed) this.root.dataset.rendererBackend = backendId;
  }

  update(state: SessionSurfaceStateV1): void {
    if (this.disposed) return;
    this.root.dataset.documentId = state.documentId;
    this.root.dataset.documentRevision = String(state.documentRevision);
    this.root.dataset.projectedNodeCount = String(state.projectedNodeCount);
    this.root.dataset.projectedEdgeCount = String(state.projectedEdgeCount);
    this.root.dataset.renderedNodeCount = String(state.renderedNodeCount);
    this.root.dataset.renderedEdgeCount = String(state.renderedEdgeCount);
    this.root.dataset.selectedNodeCount = String(state.selectedNodeCount);
    this.root.dataset.focusedNodeId = state.focusedNodeId ?? '';
    this.accessibleSummary.textContent = `Graph ${state.documentId}, ${state.renderedNodeCount} nodes and ${state.renderedEdgeCount} edges.`;
  }

  recordFrame(frameCount: number): void {
    if (!this.disposed) this.root.dataset.frameCount = String(frameCount);
  }

  setCursor(cursor: 'default' | 'pointer' | 'grabbing'): void {
    if (!this.disposed) this.canvas.style.cursor = CURSOR_IMAGES[cursor];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.resizeListeners.clear();
    this.root.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    const bounds = this.container.getBoundingClientRect();
    const width = Math.max(0, bounds.width || this.container.clientWidth || 0);
    const height = Math.max(0, bounds.height || this.container.clientHeight || 0);
    const nativePixelRatio = this.platform.devicePixelRatio;
    const devicePixelRatio = this.pixelRatioLimit === undefined
      ? nativePixelRatio
      : Math.min(nativePixelRatio, this.pixelRatioLimit);
    this.viewport = { width, height, devicePixelRatio };
    if (this.activeCanvas) {
      this.activeCanvas.width = Math.round(width * devicePixelRatio);
      this.activeCanvas.height = Math.round(height * devicePixelRatio);
    }
    this.root.dataset.width = String(width);
    this.root.dataset.height = String(height);
    this.root.dataset.devicePixelRatio = String(devicePixelRatio);
    for (const listener of [...this.resizeListeners]) listener({ ...this.viewport });
  }
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
