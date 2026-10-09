import { AnimaHoverPreviewAnimation, blendAnimaPreviewFrame } from '../anima/AnimaHoverPreviewAnimation.ts';
import type { GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';
import type { GraphViewStateV1, GraphExperienceContractV1 } from '../../contracts/v1/index.ts';
import { GraphTopologyIndex } from '../../core/document/GraphTopologyIndex.ts';
import { createAnimaConsciousnessPresentationV1 } from '../anima/AnimaAwareness.ts';
import { createGraphInteractionContextV1 } from '../interaction/GraphInteractionStatePolicy.ts';
import { compileAnimaSceneV1 } from '../anima/index.ts';
import { compileAnimaPickFrame } from '../anima/AnimaSceneCompiler.ts';
import { CommittedPickState } from '../render/CommittedPickState.ts';
import { createAnimusSnapshotV1, type AnimusSnapshotV1 } from '../animus/index.ts';
import type { Consciousness, ConsciousnessSnapshot } from '../consciousness/index.ts';
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
import type { SessionInvalidationClass } from './SessionFrameScheduler.ts';

interface CompositionOptions {
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
  readonly invalidation: SessionInvalidationClass;
  readonly now: number;
  readonly previewCommitted?: boolean;
}

interface PresentationFrame {
  readonly moduleView: GraphModulePresentationStateV1;
  readonly frame: GraphRenderFrameV1;
}

/** Owns the projection-to-frame boundary and its render dirty state for one session. */
export class SessionProjectionCoordinator {
  readonly frames = new GraphFrameStore();
  readonly committedPickState = new CommittedPickState();
  private dirty = true;
  private readonly hoverAnimation = new AnimaHoverPreviewAnimation();
  private previewTargetContext?: string;
  private previewPresentationContext?: string;
  private readonly previewTargetFrames = new Map<string, GraphRenderFrameV1>();
  private geometryRevision = 0;
  private geometryOnly = false;
  private baselineCache?: { input: GraphModulePresentationStateV1; result: PresentationFrame };
  private consciousnessCache?: { owner: Consciousness; document: GraphModuleProjectionStateV1['document']; key: string; snapshot: ConsciousnessSnapshot };
  private readonly work = { consciousnessReconciliations: 0, geometryRefreshes: 0, modulePresentationContributions: 0, animusSnapshots: 0, animaSemanticResolves: 0, pickGeometryCompiles: 0, fullSceneCompiles: 0 };

  getDiagnostics(): Readonly<typeof this.work> { return { ...this.work }; }
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

  compose(options: CompositionOptions): GraphModulePresentationStateV1 {
    this.onComposition();
    if (options.invalidation === 'geometry' || options.invalidation === 'content') this.geometryRevision += 1;
    this.geometryOnly = options.invalidation === 'geometry' && options.host.canReuseGeometryPresentation?.() === true;
    if (options.invalidation === 'content') this.baselineCache = undefined;
    const consciousness = this.reconcileConsciousness(options);
    const objectActivationPreview = options.resolveObjectActivationPreview?.();
    const input: GraphModulePresentationStateV1 = {
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
    const animated = options.host.has('anima') && objectActivationPreview?.activation !== 'remove-membership'
      && objectActivationPreview?.activation !== 'toggle-membership';
    let result: PresentationFrame;
    if (animated) {
      result = this.resolvePreviewPresentation(options, input, objectActivationPreview);
    } else {
      this.resetPreviewAnimation();
      result = this.createPresentationFrame(options.host, input, objectActivationPreview);
      this.committedPickState.set(objectActivationPreview
        ? this.createCommittedPickFrame(options.host, input) : result.frame);
    }
    this.frames.set(result.frame);
    this.dirty = true;
    return result.moduleView;
  }

  private reconcileConsciousness(options: CompositionOptions): ConsciousnessSnapshot {
    const document = options.projectionView.document;
    const key = JSON.stringify([options.viewState.selectedNodeIds, [...options.consciousness.remembered.nodeIds]]);
    const cached = this.consciousnessCache;
    if (options.invalidation !== 'content' && cached?.owner === options.consciousness && cached.document === document && cached.key === key) return cached.snapshot;
    const topology = this.topology(options.projectionView.document);
    this.work.consciousnessReconciliations += 1;
    const snapshot = options.consciousness.reconcile({
      attentionNodeIds: options.viewState.selectedNodeIds,
      availableNodeIds: topology.nodeIds,
      relationships: topology.relationships('either'),
    });
    this.consciousnessCache = { owner: options.consciousness, document, key, snapshot };
    return snapshot;
  }

  private createPresentationFrame(
    host: GraphModuleHost,
    input: GraphModulePresentationStateV1,
    preview: GraphInteractionPreviewV1 | null | undefined,
    hoveredInput: string | null | undefined = input.hoveredNodeId,
  ): PresentationFrame {
    const presentationInput: GraphModulePresentationStateV1 = { ...input, objectActivationPreview: preview, hoveredNodeId: hoveredInput ?? undefined };
    const cached = this.baselineCache;
    if (!preview && this.geometryOnly && cached && samePresentationInputs(cached.input, presentationInput)) {
      this.work.geometryRefreshes += 1;
      const result = { moduleView: { ...cached.result.moduleView, positions: input.positions, viewState: input.viewState },
        frame: this.refreshGeometry(cached.result.frame, input.positions) };
      this.baselineCache = { input: presentationInput, result };
      return result;
    }
    const moduleView = this.dressPresentation(host, presentationInput);
    const snapshot = this.createAnimusSnapshot(presentationInput, moduleView);
    const frame = this.compileScene(presentationInput, moduleView, snapshot);
    const result = { moduleView, frame };
    if (!preview) this.baselineCache = { input: presentationInput, result };
    return result;
  }

  private createCommittedPickFrame(host: GraphModuleHost, input: GraphModulePresentationStateV1) {
    const moduleView = this.dressPresentation(host, { ...input, objectActivationPreview: null });
    this.work.pickGeometryCompiles += 1;
    return compileAnimaPickFrame(moduleView, this.geometryRevision);
  }

  private dressPresentation(host: GraphModuleHost, presentationInput: GraphModulePresentationStateV1): GraphModulePresentationStateV1 {
    const input = presentationInput;
    const preview = input.objectActivationPreview;
    const cached = this.baselineCache;
    const previousSemantic = !preview && cached && samePresentationInputs(cached.input, presentationInput)
      ? cached.result.moduleView.animaPresentation : undefined;
    if (!previousSemantic) this.work.animaSemanticResolves += 1;
    const animaPresentation = previousSemantic ?? createAnimaConsciousnessPresentationV1({
      ...input.consciousness, interaction: createGraphInteractionContextV1(presentationInput),
      experience: input.experience, objectActivationPreview: preview, document: input.document,
      visibleNodeIds: input.renderSelection.nodeIds, visibleEdgeIds: input.renderSelection.edgeIds,
    });

    return this.contributePresentation(host, { ...presentationInput, animaPresentation });
  }

  private contributePresentation(host: GraphModuleHost, input: GraphModulePresentationStateV1): GraphModulePresentationStateV1 {
    this.work.modulePresentationContributions += 1;
    return host.contribute(input);
  }

  private createAnimusSnapshot(input: GraphModulePresentationStateV1, moduleView: GraphModulePresentationStateV1): AnimusSnapshotV1 {
    this.work.animusSnapshots += 1;
    return createAnimusSnapshotV1({
      document: moduleView.document,
      viewState: input.viewState,
      displaySelection: moduleView.renderSelection,
      positions: moduleView.positions,
      nodeRoles: moduleView.nodeRoles,
      edgeRoles: moduleView.edgeRoles,
      regions: moduleView.regions,
      draggedNodeId: input.draggedNodeId,
      hoveredNodeId: input.hoveredNodeId,
      previewedNodeId: input.previewedNodeId,
      selectionPresentationSuspended: input.selectionPresentationSuspended,
      selectionNeighborRevealActive: input.selectionNeighborRevealActive,
    });
  }

  private compileScene(
    input: GraphModulePresentationStateV1,
    moduleView: GraphModulePresentationStateV1,
    snapshot: AnimusSnapshotV1,
  ): GraphRenderFrameV1 {
    this.work.fullSceneCompiles += 1;
    return compileAnimaSceneV1({
      snapshot,
      animaPresentation: moduleView.animaPresentation,
      consciousness: input.consciousness,
      experience: input.experience,
      objectActivationPreview: input.objectActivationPreview,
      nodeContributions: moduleView.nodeContributions,
      edgeContributions: moduleView.edgeContributions,
      regionContributions: moduleView.regionContributions,
      theme: moduleView.theme,
      presentationPolicy: moduleView.presentationPolicy,
      geometryRevision: this.geometryRevision,
    });
  }

  private resolvePreviewPresentation(
    options: CompositionOptions,
    input: GraphModulePresentationStateV1,
    objectActivationPreview: GraphInteractionPreviewV1 | null | undefined,
  ): PresentationFrame {
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
    // delay/fade. Module setting updates explicitly expire target visuals;
    // structural roles change with content. Position and camera updates retain targets.
    const presentationContext = JSON.stringify([
      options.theme.revision,
      options.presentationPolicy,
      options.experience,
      options.viewState.pinnedNodeIds,
      [...input.consciousness.remembered.nodeIds],
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
    // Keep the committed small Focus label as the animation's starting point.
    // Every primary hover keeps its own label visible while proximity is paused;
    // the destination scene and new root size still wait for the timed peek.
    const baseline = this.createPresentationFrame(options.host, input, null, focusLabelEntry ? null : options.hoveredNodeId);
    this.committedPickState.set(baseline.frame);
    const hoverLabelEntry = options.hoveredNodeId !== undefined
      && objectActivationPreview?.activation === 'primary' && baseline.frame.policy?.labelMode !== 'off';
    let frame = hoverLabelEntry ? { ...baseline.frame, nodes: baseline.frame.nodes.map(node =>
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
        targetFrame = this.createPresentationFrame(options.host, input, layer.preview, layer.hoveredNodeId).frame;

        this.previewTargetFrames.set(layer.key, targetFrame);
      }

      frame = blendAnimaPreviewFrame(
        frame,
        targetFrame,
        layer.strength,
      );
    }

    return { moduleView: baseline.moduleView, frame };
  }

  private refreshGeometry(frame: GraphRenderFrameV1, positions: GraphModulePresentationStateV1['positions']): GraphRenderFrameV1 {
    return { ...frame, geometryRevision: this.geometryRevision,
      nodes: frame.nodes.map(node => ({ ...node, position: positions[node.id] ?? node.position })) };
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

  invalidatePresentation(): void {
    this.baselineCache = undefined;
    this.previewTargetFrames.clear();
    this.dirty = true;
  }

  markGeometryDirty(): void {
    this.geometryRevision += 1;
    const frame = this.frames.get();
    if (frame) this.frames.set({ ...frame, geometryRevision: this.geometryRevision });
    const committed = this.committedPickState.get();
    if (committed) this.committedPickState.set({ ...committed, geometryRevision: this.geometryRevision });
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

    this.baselineCache = undefined;
    this.consciousnessCache = undefined;
    this.frames.set(null);
    this.committedPickState.set(null);
    this.dirty = false;
  }

  private topology(document: GraphModuleProjectionStateV1['document']): GraphTopologyIndex {
    if (this.topologyCache?.document === document) return this.topologyCache.topology;
    const topology = new GraphTopologyIndex(document);
    this.topologyCache = { document, topology };
    return topology;
  }
}

/** Geometry and camera are deliberately absent; structural inputs retain their identities. */
function samePresentationInputs(a: GraphModulePresentationStateV1, b: GraphModulePresentationStateV1): boolean {
  return a.document === b.document && a.renderSelection === b.renderSelection
    && a.nodeRoles === b.nodeRoles && a.edgeRoles === b.edgeRoles && a.regions === b.regions
    && a.theme === b.theme && a.presentationPolicy === b.presentationPolicy && a.experience === b.experience
    && a.consciousness === b.consciousness && a.hoveredNodeId === b.hoveredNodeId
    && a.draggedNodeId === b.draggedNodeId && a.previewedNodeId === b.previewedNodeId
    && a.selectionPresentationSuspended === b.selectionPresentationSuspended
    && a.selectionNeighborRevealActive === b.selectionNeighborRevealActive
    && JSON.stringify([a.viewState.dimensions, a.viewState.viewMode, a.viewState.focusedNodeId, a.viewState.selectedNodeIds, a.viewState.pinnedNodeIds])
      === JSON.stringify([b.viewState.dimensions, b.viewState.viewMode, b.viewState.focusedNodeId, b.viewState.selectedNodeIds, b.viewState.pinnedNodeIds]);
}
