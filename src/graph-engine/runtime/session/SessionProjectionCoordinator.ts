import type { GraphViewStateV1 } from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import type { GraphModuleHost, GraphModulePipelineStateV1 } from '../modules/index.ts';
import {
  CanvasGraphRenderer,
  composeGraphRenderFrameV1,
  GraphFrameStore,
  type GraphRenderTimingV1,
} from '../render/index.ts';
import type { SessionInvalidationClassV1 } from './SessionFrameScheduler.ts';

/** Owns the projection-to-frame boundary and its render dirty state for one session. */
export class SessionProjectionCoordinatorV1 {
  readonly frames = new GraphFrameStore();
  private dirty = true;
  private geometryRevision = 0;

  constructor(
    private readonly onProjection: () => void,
    private readonly onComposition: () => void,
  ) {}

  project(host: GraphModuleHost, state: GraphModulePipelineStateV1): GraphModulePipelineStateV1 {
    this.onProjection();
    return host.project(state);
  }

  compose(options: {
    readonly host: GraphModuleHost;
    readonly projectionView: GraphModulePipelineStateV1;
    readonly viewState: GraphViewStateV1;
    readonly selection: GraphFilterSelectionV1;
    readonly draggedNodeId?: string;
    readonly hoveredNodeId?: string;
    readonly previewedNodeId?: string;
    readonly invalidation: SessionInvalidationClassV1;
  }): GraphModulePipelineStateV1 {
    this.onComposition();
    if (options.invalidation === 'geometry' || options.invalidation === 'content') this.geometryRevision += 1;
    const moduleView = options.host.contribute({
      ...options.projectionView,
      draggedNodeId: options.draggedNodeId,
      hoveredNodeId: options.hoveredNodeId,
      previewedNodeId: options.previewedNodeId,
    });
    this.frames.set(composeGraphRenderFrameV1({
      document: moduleView.document,
      viewState: options.viewState,
      selection: options.selection,
      positions: moduleView.positions,
      nodeContributions: moduleView.nodeContributions,
      edgeContributions: moduleView.edgeContributions,
      regionContributions: moduleView.regionContributions,
      theme: moduleView.theme,
      hoveredNodeId: options.hoveredNodeId,
      geometryRevision: this.geometryRevision,
    }));
    this.dirty = true;
    return moduleView;
  }

  markDirty(): void { this.dirty = true; }

  markGeometryDirty(): void {
    this.geometryRevision += 1;
    const frame = this.frames.get();
    if (frame) this.frames.set({ ...frame, geometryRevision: this.geometryRevision });
    this.dirty = true;
  }

  render(renderer: CanvasGraphRenderer): GraphRenderTimingV1 | undefined {
    if (!this.dirty) return undefined;
    const timing = renderer.render();
    this.dirty = false;
    return timing;
  }

  clear(): void {
    this.frames.set(null);
    this.dirty = false;
  }
}
