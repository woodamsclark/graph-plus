import type { Disposable } from '../../contracts/v1/index.ts';

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

export interface SessionSurfaceViewportV1 {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface SessionSurfaceV1 {
  readonly canvas: HTMLCanvasElement;
  getViewport(): SessionSurfaceViewportV1;
  onResize(listener: (viewport: SessionSurfaceViewportV1) => void): Disposable;
  update(state: SessionSurfaceStateV1): void;
  recordFrame(frameCount: number): void;
  setCursor(cursor: 'default' | 'pointer' | 'grabbing'): void;
  dispose(): void;
}
