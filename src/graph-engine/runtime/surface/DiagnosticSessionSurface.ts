import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import type { SessionResizeObserverV1, SessionRuntimePlatformV1 } from '../platform/index.ts';

export interface SessionSurfaceStateV1 {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly projectedNodeCount: number;
  readonly projectedEdgeCount: number;
  readonly renderedNodeCount: number;
  readonly renderedEdgeCount: number;
  readonly selectedNodeCount: number;
  readonly focusedNodeId?: string;
}

export interface SessionSurfaceV1 {
  update(state: SessionSurfaceStateV1): void;
  recordFrame(frameCount: number): void;
  dispose(): void;
}

export class DiagnosticSessionSurface implements SessionSurfaceV1 {
  private readonly container: HTMLElement;
  private readonly platform: SessionRuntimePlatformV1;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly accessibleSummary: HTMLDivElement;
  private readonly resizeObserver: SessionResizeObserverV1;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.root.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    const bounds = this.container.getBoundingClientRect();
    const width = Math.max(0, bounds.width || this.container.clientWidth || 0);
    const height = Math.max(0, bounds.height || this.container.clientHeight || 0);
    const ratio = this.platform.devicePixelRatio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.root.dataset.width = String(width);
    this.root.dataset.height = String(height);
    this.root.dataset.devicePixelRatio = String(ratio);
  }
}
