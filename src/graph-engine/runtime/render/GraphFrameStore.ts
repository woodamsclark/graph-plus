import type { GraphRenderFrameV1 } from './GraphRenderTypes.ts';

export class GraphFrameStore {
  private frame: GraphRenderFrameV1 | null = null;

  get(): GraphRenderFrameV1 | null {
    return this.frame;
  }

  set(frame: GraphRenderFrameV1 | null): void {
    this.frame = frame;
  }
}
