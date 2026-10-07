import { AnimaHoverPreviewAnimationV1, blendAnimaPreviewFrameV1 } from '../anima/AnimaHoverPreviewAnimation.ts';
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
  type GraphRenderFrameV1,
  type GraphRenderTimingV1,
} from '../render/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type { SessionInvalidationClassV1 } from './SessionFrameScheduler.ts';

/** Owns the projection-to-frame boundary and its render dirty state for one session. */
export class SessionProjectionCoordinatorV1 {
  readonly frames = new GraphFrameStore();
  readonly committedFrames = new GraphFrameStore();
  private dirty = true;
  private readonly hoverAnimation = new AnimaHoverPreviewAnimationV1();
  private previewTargetContext?: string;
  private previewPresentationContext?: string;
  private readonly previewTargetFrames = new Map<string, GraphRenderFrameV1>();
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
    readonly selectionPresentationSuspended?: boolean;
    readonly selectionNeighborRevealActive?: boolean;
    readonly previewedNodeId?: string;
    readonly invalidation: SessionInvalidationClassV1;
    readonly now: number;
    readonly previewCommitted?: boolean;
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
    const input = {
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
    };
    const compile = (preview: GraphInteractionPreviewV1 | null | undefined, hoveredInput: string | null | undefined = options.hoveredNodeId) => {
      const hoveredNodeId = hoveredInput ?? undefined;
      const moduleView = options.host.contribute({ ...input, objectActivationPreview: preview, hoveredNodeId });
      const snapshot = createAnimusSnapshotV1({
        document: moduleView.document,
        viewState: options.viewState,
        displaySelection: moduleView.renderSelection,
        positions: moduleView.positions,
        nodeRoles: moduleView.nodeRoles,
        edgeRoles: moduleView.edgeRoles,
        regions: moduleView.regions,
        draggedNodeId: options.draggedNodeId,
        hoveredNodeId,
        previewedNodeId: options.previewedNodeId,
        selectionPresentationSuspended: options.selectionPresentationSuspended,
        selectionNeighborRevealActive: options.selectionNeighborRevealActive,
      });
      const frame = compileAnimaSceneV1({
        snapshot,
        consciousness,
        experience: options.experience,
        objectActivationPreview: preview,
        nodeContributions: moduleView.nodeContributions,
        edgeContributions: moduleView.edgeContributions,
        regionContributions: moduleView.regionContributions,
        theme: moduleView.theme,
        presentationPolicy: moduleView.presentationPolicy,
        geometryRevision: this.geometryRevision,
      });
      return { moduleView, frame };
    };
    const animated = options.host.has('anima') && objectActivationPreview?.activation !== 'remove-membership'
      && objectActivationPreview?.activation !== 'toggle-membership';
    if (!animated) {
      this.hoverAnimation.clear();
      this.previewTargetFrames.clear();
      this.previewTargetContext = undefined;
      this.previewPresentationContext = undefined;
      const result = compile(objectActivationPreview);
      this.committedFrames.set(objectActivationPreview ? compile(null).frame : result.frame);
      this.frames.set(result.frame);
      this.dirty = true;
      return result.moduleView;
    }

    const previewContext = JSON.stringify([
      input.document.documentId,
      input.document.revision,
      options.viewState.dimensions,
      options.viewState.viewMode,
      options.viewState.focusedNodeId,
      options.viewState.selectedNodeIds,
      [...input.renderSelection.nodeIds],
      [...input.renderSelection.edgeIds],
    ]);

    if (this.previewTargetContext !== previewContext) {
      this.previewTargetContext = previewContext;
      this.previewTargetFrames.clear();
    }

    // Target validity and visit timing have different owners. Theme, settings,
    // pins and semantic changes redress the existing visit without replaying its
    // delay/fade. Content transactions include module settings and structural
    // roles; position and camera updates deliberately do not expire targets.
    const presentationContext = JSON.stringify([
      options.theme.revision,
      options.presentationPolicy,
      options.experience,
      options.viewState.pinnedNodeIds,
      [...consciousness.remembered.nodeIds],
      options.draggedNodeId,
      options.previewedNodeId,
      options.selectionPresentationSuspended,
      options.selectionNeighborRevealActive,
    ]);
    if (options.invalidation === 'content' || this.previewPresentationContext !== presentationContext) {
      this.previewPresentationContext = presentationContext;
      this.previewTargetFrames.clear();
    }

    const layers = this.hoverAnimation.update({
      context: previewContext,
      preview: objectActivationPreview,
      hoveredNodeId: options.hoveredNodeId,
      committed: options.previewCommitted === true,
      now: options.now,
    });

    const focusLabelEntry = options.viewState.viewMode === 'focus'
      && options.hoveredNodeId !== undefined && options.hoveredNodeId !== options.viewState.focusedNodeId
      && objectActivationPreview?.activation === 'primary';
    // Keep the committed small label as the animation's starting point. Hover
    // reveal is immediate; the new root size still waits for the timed peek.
    const baseline = compile(null, focusLabelEntry ? null : options.hoveredNodeId);
    this.committedFrames.set(baseline.frame);
    let frame = focusLabelEntry ? { ...baseline.frame, nodes: baseline.frame.nodes.map(node =>
      node.id === options.hoveredNodeId ? { ...node, showLabel: true, labelForceVisible: true,
        labelAlwaysVisible: true, labelOpacity: 1, labelFontSize: Math.max(12, node.labelFontSize) } : node) } : baseline.frame;

    const activeLayerKeys = new Set(layers.map(layer => layer.key));

    for (const key of this.previewTargetFrames.keys()) {
      if (!activeLayerKeys.has(key)) {
        this.previewTargetFrames.delete(key);
      }
    }

    for (const layer of layers) {
      let targetFrame = this.previewTargetFrames.get(layer.key);

      if (!targetFrame) {
        targetFrame = compile(
          layer.preview,
          layer.hoveredNodeId,
        ).frame;

        this.previewTargetFrames.set(layer.key, targetFrame);
      }

      frame = blendAnimaPreviewFrameV1(
        frame,
        targetFrame,
        layer.strength,
      );
    }

    this.frames.set(frame);
    this.dirty = true;
    return baseline.moduleView;
  }

  resetPreviewAnimation(): void {
    this.hoverAnimation.clear();
    this.previewTargetFrames.clear();
    this.previewTargetContext = undefined;
    this.previewPresentationContext = undefined;
  }

  nextPreviewFrameDelayMs(now: number): number | undefined {
    return this.hoverAnimation.nextFrameDelayMs(now);
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
    this.hoverAnimation.clear();
    this.previewTargetFrames.clear();
    this.previewTargetContext = undefined;
    this.previewPresentationContext = undefined;

    this.frames.set(null);
    this.committedFrames.set(null);
    this.dirty = false;
  }

  private topology(document: GraphModuleProjectionStateV1['document']): GraphTopologyIndex {
    if (this.topologyCache?.document === document) return this.topologyCache.topology;
    const topology = new GraphTopologyIndex(document);
    this.topologyCache = { document, topology };
    return topology;
  }
}
