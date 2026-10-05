import { blendAnimaScenesV1 } from '../anima/AnimaSceneBlend.ts';
import type { GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';
import type { GraphViewStateV1, GraphExperienceContractV1 } from '../../contracts/v1/index.ts';
import { GraphTopologyIndex } from '../../core/document/GraphTopologyIndex.ts';
import { compileAnimaSceneV1 } from '../anima/index.ts';
import { createAnimusSnapshotV1 } from '../animus/index.ts';
import type { Consciousness } from '../consciousness/index.ts';
import type {
  GraphModuleHost,
  GraphModulePresentationStateV1,
  GraphModuleProjectionStateV1,
} from '../modules/index.ts';
import {
  GraphFrameStore,
  type GraphPresentationPolicyV2,
  type GraphRendererV2,
  type GraphRenderTimingV1,
} from '../render/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type { SessionInvalidationClassV1 } from './SessionFrameScheduler.ts';

/** Owns the projection-to-frame boundary and its render dirty state for one session. */
export class SessionProjectionCoordinatorV1 {
  readonly frames = new GraphFrameStore();
  private dirty = true;
  private geometryRevision = 0;
  private topologyCache?: {
    readonly document: GraphModuleProjectionStateV1['document'];
    readonly topology: GraphTopologyIndex;
  };

  constructor(
    private readonly onProjection: () => void,
    private readonly onComposition: () => void,
  ) {}

  project(host: GraphModuleHost, state: GraphModuleProjectionStateV1): GraphModuleProjectionStateV1 {
    this.onProjection();
    return host.project(state);
  }

  compose(options: {
    readonly host: GraphModuleHost;
    readonly consciousness: Consciousness;
    readonly experience?: GraphExperienceContractV1;
    readonly resolveObjectActivationPreview?: () => GraphInteractionPreviewV1 | null;
    readonly projectionView: GraphModuleProjectionStateV1;
    readonly viewState: GraphViewStateV1;
    readonly theme: GraphVisualThemeV2;
    readonly presentationPolicy: GraphPresentationPolicyV2;
    readonly draggedNodeId?: string;
    readonly hoveredNodeId?: string;
    /** Continuous Overview expression, resolved in cursor screen space by the session. */
    readonly overviewPreviewStrength?: number;
    readonly selectionPresentationSuspended?: boolean;
    readonly selectionNeighborRevealActive?: boolean;
    readonly previewedNodeId?: string;
    readonly invalidation: SessionInvalidationClassV1;
  }): GraphModulePresentationStateV1 {
    this.onComposition();
    if (options.invalidation === 'geometry' || options.invalidation === 'content') this.geometryRevision += 1;
    const topology = this.topology(options.projectionView.document);
    const consciousness = options.consciousness.reconcile({
      attentionNodeIds: options.viewState.selectedNodeIds,
      availableNodeIds: topology.nodeIds,
      relationships: topology.relationships('either'),
    });
    const objectActivationPreview = options.resolveObjectActivationPreview?.();
    const moduleView = options.host.contribute({
      ...options.projectionView,
      viewState: options.viewState,
      consciousness,
      experience: options.experience,
      objectActivationPreview,
      draggedNodeId: options.draggedNodeId,
      hoveredNodeId: options.hoveredNodeId,
      selectionPresentationSuspended: options.selectionPresentationSuspended,
      selectionNeighborRevealActive: options.selectionNeighborRevealActive,
      previewedNodeId: options.previewedNodeId,
      nodeContributions: {},
      edgeContributions: {},
      regionContributions: [],
      theme: options.theme,
      presentationPolicy: options.presentationPolicy,
      motionTargets: {},
    });
    const snapshot = createAnimusSnapshotV1({
      document: moduleView.document,
      viewState: options.viewState,
      displaySelection: moduleView.renderSelection,
      positions: moduleView.positions,
      nodeRoles: moduleView.nodeRoles,
      edgeRoles: moduleView.edgeRoles,
      regions: moduleView.regions,
      draggedNodeId: options.draggedNodeId,
      hoveredNodeId: options.hoveredNodeId,
      previewedNodeId: options.previewedNodeId,
      selectionPresentationSuspended: options.selectionPresentationSuspended,
      selectionNeighborRevealActive: options.selectionNeighborRevealActive,
    });
    const previewFrame = compileAnimaSceneV1({
      snapshot,
      consciousness,
      experience: options.experience,
      objectActivationPreview,
      nodeContributions: moduleView.nodeContributions,
      edgeContributions: moduleView.edgeContributions,
      regionContributions: moduleView.regionContributions,
      theme: moduleView.theme,
      presentationPolicy: moduleView.presentationPolicy,
      geometryRevision: this.geometryRevision,
    });
    if (options.overviewPreviewStrength !== undefined && options.overviewPreviewStrength < 1
      && objectActivationPreview !== null && objectActivationPreview !== undefined) {
      // Evaluate baseline and preview through the same presentation pipeline.
      // Neither evaluation runs layout, projection, or commits Consciousness.
      const baselineView = options.host.contribute({
        ...options.projectionView, viewState: options.viewState, consciousness, experience: options.experience,
        objectActivationPreview: null, hoveredNodeId: undefined, draggedNodeId: options.draggedNodeId,
        nodeContributions: {}, edgeContributions: {}, regionContributions: [],
        theme: options.theme, presentationPolicy: options.presentationPolicy, motionTargets: {},
      });
      const baselineSnapshot = createAnimusSnapshotV1({
        document: baselineView.document, viewState: options.viewState, displaySelection: baselineView.renderSelection,
        positions: baselineView.positions, nodeRoles: baselineView.nodeRoles, edgeRoles: baselineView.edgeRoles,
        regions: baselineView.regions,
      });
      const baselineFrame = compileAnimaSceneV1({
        snapshot: baselineSnapshot, consciousness, experience: options.experience, objectActivationPreview: null,
        nodeContributions: baselineView.nodeContributions, edgeContributions: baselineView.edgeContributions,
        regionContributions: baselineView.regionContributions, theme: baselineView.theme,
        presentationPolicy: baselineView.presentationPolicy, geometryRevision: this.geometryRevision,
      });
      this.frames.set(blendAnimaScenesV1(baselineFrame, previewFrame, options.overviewPreviewStrength));
    } else this.frames.set(previewFrame);
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

  render(renderer: GraphRendererV2): GraphRenderTimingV1 | undefined {
    if (!this.dirty) return undefined;
    const timing = renderer.render();
    this.dirty = false;
    return timing;
  }

  clear(): void {
    this.frames.set(null);
    this.dirty = false;
  }

  private topology(document: GraphModuleProjectionStateV1['document']): GraphTopologyIndex {
    if (this.topologyCache?.document === document) return this.topologyCache.topology;
    const topology = new GraphTopologyIndex(document);
    this.topologyCache = { document, topology };
    return topology;
  }
}
