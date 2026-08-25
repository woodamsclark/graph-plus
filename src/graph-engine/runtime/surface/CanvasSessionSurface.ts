import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import type { SessionResizeObserverV1, SessionRuntimePlatformV1 } from '../platform/index.ts';
import type {
  SessionSurfaceStateV1,
  SessionSurfaceV1,
  SessionSurfaceViewportV1,
} from './SessionSurface.ts';

export class CanvasSessionSurface implements SessionSurfaceV1 {
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly platform: SessionRuntimePlatformV1;
  private readonly root: HTMLDivElement;
  private readonly accessibleSummary: HTMLDivElement;
  private readonly resizeObserver: SessionResizeObserverV1;
  private readonly resizeListeners = new Set<(viewport: SessionSurfaceViewportV1) => void>();
  private viewport: SessionSurfaceViewportV1 = { width: 0, height: 0, devicePixelRatio: 1 };
  private disposed = false;

  constructor(options: {
    readonly sessionId: string;
    readonly dimensions: GraphDimensionsV1;
    readonly container: HTMLElement;
    readonly platform: SessionRuntimePlatformV1;
  }) {
    this.container = options.container;
    this.platform = options.platform;
    this.root = this.platform.document.createElement('div');
    this.root.className = 'graph-engine-session';
    this.root.dataset.graphEngineSession = options.sessionId;
    this.root.dataset.dimensions = options.dimensions;
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    this.root.style.position = 'relative';
    this.root.style.overflow = 'hidden';

    this.canvas = this.platform.document.createElement('canvas');
    this.canvas.className = 'graph-engine-surface';
    this.canvas.tabIndex = 0;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Interactive graph surface');

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

    this.root.append(this.canvas, this.accessibleSummary);
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

  onResize(listener: (viewport: SessionSurfaceViewportV1) => void) {
    if (this.disposed) throw new Error('The graph surface has been disposed.');
    this.resizeListeners.add(listener);
    return { dispose: () => this.resizeListeners.delete(listener) };
  }

  setDimensions(dimensions: GraphDimensionsV1): void {
    if (this.disposed) return;
    this.root.dataset.dimensions = dimensions;
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
    if (!this.disposed) this.canvas.style.cursor = cursor;
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
    const devicePixelRatio = this.platform.devicePixelRatio;
    this.viewport = { width, height, devicePixelRatio };
    this.canvas.width = Math.round(width * devicePixelRatio);
    this.canvas.height = Math.round(height * devicePixelRatio);
    this.root.dataset.width = String(width);
    this.root.dataset.height = String(height);
    this.root.dataset.devicePixelRatio = String(devicePixelRatio);
    for (const listener of [...this.resizeListeners]) listener({ ...this.viewport });
  }
}
