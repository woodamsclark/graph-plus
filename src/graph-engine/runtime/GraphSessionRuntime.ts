import type {
  ApplyGraphPatchResultV1,
  Disposable,
  FitNodesOptionsV1,
  GraphCameraStateV1,
  GraphChangedEventV1,
  GraphDocumentV1,
  GraphEffectiveSettingsV1,
  GraphExperienceContractV1,
  GraphExternalInfluenceResultV1,
  GraphExternalInfluenceV1,
  GraphFilterRequestV1,
  GraphFilterScopeV1,
  GraphIntentV1,
  GraphNodeActionContextV1,
  GraphPatchV1,
  GraphPerformanceSnapshotV1,
  GraphSessionErrorV1,
  GraphSessionV1,
  GraphSettingsOverridesV1,
  JsonValue,
  GraphViewStateV1,
  GraphWorldChangedEventV1,
  GraphWorldStateV1,
  GraphActiveViewV1,
  GraphViewIdV1,
  GraphViewUiStateV1,
  TransitionOptionsV1,
  Vec3,
} from '../contracts/v1/index.ts';
import { GRAPH_VIEW_DEFINITIONS_V1 } from '../contracts/v1/index.ts';
import { GraphDocumentStore, GraphTopologyIndex } from '../core/document/index.ts';
import { evaluateGraphFilterV1, type GraphFilterSelectionV1 } from '../core/filter/index.ts';
import type { EffectiveConsumerProfileV1 } from '../core/profile/index.ts';
import {
  cloneGraphViewStateV1,
  convertGraphViewStateDimensionsV1,
  reconcileGraphViewStateV1,
} from '../core/state/index.ts';
import {
  Consciousness,
  type ConsciousObservationV1,
  type GraphReactionRuntimeV1,
  type MemorySnapshotV1,
} from './consciousness/index.ts';
import {
  resolveGraphExperienceContractV1,
  resolveGraphExternalInfluenceV1,
} from './experience/index.ts';
import { Vision } from './vision/index.ts';
import {
  attentionFitNodeIdsV1,
  FOCUS_FIT_PADDING_PX,
  immediateNeighborhoodFitNodeIdsV1,
  SINGLE_NODE_FIT_MAX_PROJECTED_SCALE,
  graphInteractionPolicyV1,
  resolveGraphUxStateV1,
  resolveGraphActiveViewV1,
  SessionInteractionRuntime,
  type GraphRuntimeViewChange,
} from './interaction/index.ts';
import {
  GraphModuleHost,
  GraphRequiredModuleErrorV1,
  SHIPPED_GRAPH_MODULE_IDS_V1,
  type GraphModuleFailureV1,
  type GraphModulePresentationStateV1,
  type GraphModuleProjectionStateV1,
  type GraphModuleRegistry,
} from './modules/index.ts';
import type { SessionRuntimePlatformV1 } from './platform/index.ts';
import { GraphLabelRecordCache, EMPTY_GRAPH_LABEL_RECORDS } from './render/GraphLabelRecordCache.ts';
import {
  DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  detectGraphRendererCapabilities,
  selectGraphRenderer,
  type GraphRendererBackendIdV2,
  type GraphRendererCapabilitiesV2,
  type GraphRendererRegistry,
  type GraphRendererSelectionV2,
  type GraphRendererV2,
  type GraphPickSourceV2,
} from './render/index.ts';
import {
  graphVisualThemesEqualV2,
  freezeGraphVisualThemeV2,
  type GraphVisualThemeV2,
} from './theme/index.ts';
import { CanvasSessionSurface, type SessionSurfaceV1 } from './surface/index.ts';
import type {
  GraphNodeActionFailureV1,
  GraphNodeActionRuntimeV1,
} from './actions/index.ts';
import type { GraphSessionControlPortV1 } from './host/index.ts';
import {
  SessionActivityController,
  SessionDiagnostics,
  SessionFrameScheduler,
  SessionProjectionCoordinator,
  type SessionInvalidationClass,
} from './session/index.ts';

export interface GraphSessionRuntimeOptions {
  readonly sessionId: string;
  readonly engineInstanceId: string;
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  readonly experience?: GraphExperienceContractV1;
  readonly profile: EffectiveConsumerProfileV1;
  readonly initialSessionOverrides?: GraphSettingsOverridesV1;
  readonly resolveProfile: (overrides: GraphSettingsOverridesV1) => EffectiveConsumerProfileV1;
  readonly onDisposed?: () => void;
  readonly modules: GraphModuleRegistry;
  readonly themePalette: GraphVisualThemeV2;
  readonly resolveThemePalette?: () => GraphVisualThemeV2;
  readonly restoreViewState?: GraphViewStateV1;
  readonly platform: SessionRuntimePlatformV1;
  readonly nodeActions?: GraphNodeActionRuntimeV1;
  readonly reactions?: GraphReactionRuntimeV1;
  readonly rendererRegistry: GraphRendererRegistry;
  readonly preferredRendererBackend?: GraphRendererBackendIdV2;
  readonly layoutAuthority?: boolean;
}

const RETIRED_GRAPH_SYSTEM_STATE_KEY_V1 = 'graph-system-states-v1';
const CONSCIOUS_MEMORY_STATE_KEY_V1 = 'conscious-memory-v1';
const MAX_RESTORED_POSITION_COORDINATE = 1_000_000_000;
const MIN_PIPELINE_INTERVAL_MS = 1_000 / 60;
const PIPELINE_INTERVAL_TOLERANCE_MS = MIN_PIPELINE_INTERVAL_MS * 0.01;
const LARGE_GRAPH_NODE_COUNT = 500;
const EFFICIENT_PIXEL_RATIO_LIMIT = 2;

export interface GraphSessionRuntimeDiagnostics {
  readonly sessionId: string;
  readonly consumerId: string;
  readonly profileId: string;
  readonly dimensions: '2d' | '3d';
  readonly documentId: string;
  readonly documentRevision: number;
  readonly layoutAuthority: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly manuallySuspended: boolean;
  readonly documentSuspended: boolean;
  readonly suspended: boolean;
  readonly frameScheduled: boolean;
  readonly animationFrameScheduled: boolean;
  readonly wakeTimerScheduled: boolean;
  readonly pendingInvalidations: readonly SessionInvalidationClass[];
  readonly lastFrameInvalidations: readonly SessionInvalidationClass[];
  readonly invalidationCounts: Readonly<Record<SessionInvalidationClass, number>>;
  readonly compositionsThisFrame: number;
  readonly maxCompositionsPerFrame: number;
  readonly compositionWork: Readonly<Record<string, number>>;
  readonly renderCaches: Readonly<Record<string, number>>;
  readonly renderer: {
    readonly selectedBackendId: GraphRendererBackendIdV2;
    readonly registeredBackendIds: readonly GraphRendererBackendIdV2[];
    readonly capabilities: GraphRendererCapabilitiesV2;
    readonly attempts: GraphRendererSelectionV2['attempts'];
    readonly lifecycle: string;
  };
  readonly renderQuality: 'automatic' | 'high-fidelity' | 'energy-saver';
  readonly nativePixelRatio: number;
  readonly effectivePixelRatio: number;
  readonly frameCount: number;
  readonly lastFrameTimestamp: number | null;
  readonly counters: GraphPerformanceSnapshotV1['counters'];
  readonly modules: Readonly<Record<string, unknown>>;
}

export class GraphSessionDisposedErrorV1 extends Error {
  readonly code = 'session-disposed' as const;

  constructor() {
    super('The graph session has been disposed.');
    this.name = 'GraphSessionDisposedErrorV1';
  }
}

export class GraphSessionRuntime implements GraphSessionV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;

  private readonly consumerId: string;
  private readonly profileId: string;
  private profile: EffectiveConsumerProfileV1;
  private sessionOverrides: GraphSettingsOverridesV1;
  private readonly resolveProfile: (overrides: GraphSettingsOverridesV1) => EffectiveConsumerProfileV1;
  private readonly onDisposed?: () => void;
  private readonly container: HTMLElement;
  private readonly platform: SessionRuntimePlatformV1;
  private themePalette: GraphVisualThemeV2;
  private readonly resolveThemePalette?: () => GraphVisualThemeV2;
  private readonly nodeActions?: GraphNodeActionRuntimeV1;
  private readonly reactions?: GraphReactionRuntimeV1;
  private readonly modules: GraphModuleRegistry;
  private surface!: SessionSurfaceV1;
  private readonly experience: GraphExperienceContractV1;
  private readonly consciousness: Consciousness;
  private vision!: Vision;
  private projection!: SessionProjectionCoordinator;
  private renderer!: GraphRendererV2;
  private rendererSelection!: GraphRendererSelectionV2;
  private renderSceneRevision = 0;
  private readonly labelRecordCache = new GraphLabelRecordCache();
  private pendingDragGeometry = false;
  private physicsOverrideHeld = false;
  private presentationRevision = 0;
  private interaction!: SessionInteractionRuntime;
  private moduleHost!: GraphModuleHost;
  private projectionView!: GraphModuleProjectionStateV1;
  private moduleView!: GraphModulePresentationStateV1;
  private surfaceResizeSubscription: Disposable | null = null;
  private store: GraphDocumentStore;
  private viewState: GraphViewStateV1;
  private projectionSelection: GraphFilterSelectionV1;
  private renderSelection: GraphFilterSelectionV1;
  private documentTopologyCache?: {
    readonly document: GraphDocumentV1;
    readonly topology: GraphTopologyIndex;
  };
  private presentationTopologyCache?: {
    readonly document: GraphDocumentV1;
    readonly nodeIds: ReadonlySet<string>;
    readonly edgeIds: ReadonlySet<string>;
    readonly topology: GraphTopologyIndex;
    readonly revision: number;
  };
  private topologyRevision = 0;
  private readonly intentListeners = new Set<(intent: GraphIntentV1) => void>();
  private readonly graphChangedListeners = new Set<(event: GraphChangedEventV1) => void>();
  private readonly worldChangedListeners = new Set<(event: GraphWorldChangedEventV1) => void>();
  private readonly errorListeners = new Set<(error: GraphSessionErrorV1) => void>();
  private readonly overrideListeners = new Set<(overrides: GraphSettingsOverridesV1) => void>();
  private scheduler!: SessionFrameScheduler;
  private readonly activity = new SessionActivityController();
  private readonly diagnostics = new SessionDiagnostics();
  private activeFrameInvalidations: Set<SessionInvalidationClass> | null = null;
  private readonly pendingCompositionInvalidations = new Set<SessionInvalidationClass>();
  private lastFrameTimestamp: number | null = null;
  private fatalModuleError: GraphRequiredModuleErrorV1 | null = null;
  private readonly deferredErrors: GraphSessionErrorV1[] = [];
  private observedSelectedNodeIds = new Set<string>();
  private observedFocusedNodeId?: string;
  private observedView?: string;
  private observedVisionFocusSubjectId?: string;
  private readonly viewListeners = new Set<(view: GraphActiveViewV1) => void>();
  private readonly viewUiState = new Map<GraphViewIdV1, GraphViewUiStateV1>();
  private layoutAuthority: boolean;

  private readonly onVisibilityChange = (): void => {
    this.activity.setDocumentSuspension(this.platform.document.hidden);
    this.synchronizeRuntimeActivity();
  };

  private readonly onAnimationFrame: FrameRequestCallback = (timestamp) => {
    if (this.isSuspended()) return;
    if (this.lastFrameTimestamp !== null
      && timestamp - this.lastFrameTimestamp < MIN_PIPELINE_INTERVAL_MS - PIPELINE_INTERVAL_TOLERANCE_MS) {
      this.scheduleFrame(MIN_PIPELINE_INTERVAL_MS - (timestamp - this.lastFrameTimestamp));
      return;
    }
    this.activeFrameInvalidations = new Set([
      ...this.scheduler.beginFrame(), ...this.pendingCompositionInvalidations,
    ]);
    this.diagnostics.beginDisplayFrame();
    let tickResult: ReturnType<GraphModuleHost['tick']>;
    try {
      const frameStart = this.platform.now();
      const interactionStart = this.platform.now();
      this.interaction.tick();
      const held = this.interaction.isPhysicsOverrideHeld();
      if (held !== this.physicsOverrideHeld) {
        this.physicsOverrideHeld = held;
        this.moduleHost.updateProfile(this.physicsOverrideProfile(this.profile));
      }
      const dragGeometryPending = this.pendingDragGeometry;
      if (dragGeometryPending) {
        this.pendingDragGeometry = false;
        this.moduleHost.viewChanged(this.viewState);
        this.emitWorldChanged('interaction');
      }
      const interactionMs = duration(interactionStart, this.platform.now());
      const hitTestMs = this.interaction.consumeHitTestDuration();
      this.diagnostics.counters.hitTests += this.interaction.consumeHitTestCount();
      const deltaSeconds = this.lastFrameTimestamp === null ? 1 / 60 : Math.max(0, (timestamp - this.lastFrameTimestamp) / 1000);
      this.lastFrameTimestamp = timestamp;
      const moduleStart = this.platform.now();
      const previousCameraFollowPoint = this.vision.deriveCentroid(
        this.interaction.getCameraTrackingNodeIds(), this.moduleView.positions,
      );
      this.diagnostics.counters.moduleTicks += 1;
      tickResult = this.moduleHost.tick({
        ...this.moduleView,
        physicsOverrideHeld: held,
        cursorAttractionSteps: this.resolveCursorAttractionSteps(),
        draggedNodeId: this.interaction.getDraggedNodeId(),
        hoveredNodeId: this.interaction.getHoveredNodeId(),
        selectionPresentationSuspended: this.interaction.isSelectionPresentationSuspended(),
        selectionNeighborRevealActive: this.interaction.isSelectionNeighborRevealActive(),
        previewedNodeId: this.interaction.getPreviewedNodeId(),
      }, deltaSeconds);
      const positions = tickResult?.positions;
      const moduleTickMs = duration(moduleStart, this.platform.now());
      let geometryCompositionPending = dragGeometryPending;
      if (positions) {
        const requiresComposition = positions !== this.moduleView.positions;
        const nextCameraFollowPoint = this.vision.deriveCentroid(
          this.interaction.getCameraTrackingNodeIds(), positions,
        );
        this.viewState = { ...this.viewState, positions };
        if (previousCameraFollowPoint && nextCameraFollowPoint) {
          this.vision.translateBy(subtractVec(nextCameraFollowPoint, previousCameraFollowPoint));
          this.synchronizeCameraState();
        }
        this.projectionView = { ...this.projectionView, positions, viewState: this.viewState };
        this.moduleView = { ...this.moduleView, positions, viewState: this.viewState };
        this.emitWorldChanged('layout');
        if (requiresComposition) geometryCompositionPending = true;
        else if (!geometryCompositionPending) {
          this.projection.markGeometryDirty();
          this.activeFrameInvalidations.add('geometry');
        }
      }
      if (geometryCompositionPending) this.refreshFrame(false, 'geometry');
      if (tickResult?.camera) {
        this.vision.setState(tickResult.camera);
        this.synchronizeCameraState();
        this.projectionView = { ...this.projectionView, viewState: this.viewState };
        this.moduleView = { ...this.moduleView, viewState: this.viewState };
        this.projection.markDirty();
        this.activeFrameInvalidations.add('camera');
      }
      if (this.projection.nextPreviewFrameDelayMs(this.platform.now()) !== undefined) {
        this.refreshFrame(false, 'presentation');
      }
      if (this.isSuspended()) return;
      const compositionStart = this.platform.now();
      this.flushPendingComposition();
      if (this.isSuspended()) return;
      const compositionMs = duration(compositionStart, this.platform.now());
      // Cursor-only input can change proximity labels without changing hover or geometry.
      if (this.activeFrameInvalidations.has('presentation')) this.projection.markDirty();
      this.updateRendererScene([...this.activeFrameInvalidations]);
      const render = this.projection.render(this.renderer);
      if (render) {
        const latestFramePerformance = {
          interactionMs, hitTestMs, moduleTickMs, compositionMs, ...render,
          totalMs: duration(frameStart, this.platform.now()),
        };
        const frameCount = this.diagnostics.recordFrame(latestFramePerformance, [...this.activeFrameInvalidations]);
        this.surface.recordFrame(frameCount);
      }
    } finally {
      this.activeFrameInvalidations = null;
      this.diagnostics.endDisplayFrame();
    }
    if (tickResult?.requestNextFrame) {
      const delay = tickResult.nextFrameDelayMs ?? 0;
      // A display-rate module needs the next rAF, not a full interval timer
      // followed by another rAF. The module host still owns tick admission.
      this.scheduleFrame(delay <= MIN_PIPELINE_INTERVAL_MS ? 0 : delay, 'geometry');
    }
    const previewDelay = this.projection.nextPreviewFrameDelayMs(this.platform.now());
    if (previewDelay !== undefined) this.scheduleFrame(previewDelay, 'presentation');
    // An observer/module may queue a new semantic change during composition or rendering.
    if (this.pendingCompositionInvalidations.size > 0) this.scheduleFrame();
  };

  constructor(options: GraphSessionRuntimeOptions) {
    this.sessionId = options.sessionId;
    this.engineInstanceId = options.engineInstanceId;
    this.consumerId = options.consumerId;
    this.profileId = options.profileId;
    this.profile = options.profile;
    this.sessionOverrides = cloneOverrides(options.initialSessionOverrides ?? {});
    this.resolveProfile = options.resolveProfile;
    this.onDisposed = options.onDisposed;
    this.container = options.container;
    this.platform = options.platform;
    this.themePalette = freezeGraphVisualThemeV2(options.themePalette);
    this.resolveThemePalette = options.resolveThemePalette;
    this.nodeActions = options.nodeActions;
    this.reactions = options.reactions;
    this.modules = options.modules;
    this.layoutAuthority = options.layoutAuthority ?? true;
    this.experience = resolveGraphExperienceContractV1(options.experience);
    this.scheduler = new SessionFrameScheduler(
      this.platform,
      () => !this.isSuspended(),
      this.onAnimationFrame,
      () => { this.diagnostics.counters.scheduledFrames += 1; },
    );
    this.assertPlatformOwnership();
    this.store = new GraphDocumentStore(options.document);
    const restored = options.restoreViewState
      ? withoutRetiredGraphSystemState(options.restoreViewState)
      : undefined;
    const plausibleRestored = restored && hasPlausibleRestoredPositions(restored)
      ? restored
      : undefined;
    if (restored && !plausibleRestored) {
      this.deferredErrors.push({
        code: 'incompatible-view-state',
        message: 'Saved graph positions exceeded safe numerical bounds. graph-engine regenerated the layout.',
        recoverable: true,
      });
    }
    const restoredViewState = plausibleRestored
      ? this.prepareRestoredViewState(plausibleRestored)
      : undefined;
    const restoredLayout = restoredViewState
      ? addMissingPositions(
          reconcileGraphViewStateV1(restoredViewState, this.restoreContext()),
          this.store.readDocument(),
          this.profile.dimensions,
          usesGeneratedInitialPositions(this.profile.profileSettings),
        )
      : undefined;
    this.consciousness = new Consciousness(
      this.experience,
      readMemorySnapshot(restoredLayout?.moduleState[CONSCIOUS_MEMORY_STATE_KEY_V1]),
    );
    const freshOverview = this.createInitialViewState();
    this.viewState = restoredLayout ?? freshOverview;
    this.viewState = withAttention(
      this.viewState,
      this.reconcileAttention(this.viewState.selectedNodeIds),
    );
    this.synchronizeObservedConsciousState();
    this.projectionSelection = allOf(this.store.readDocument());
    this.renderSelection = allOf(this.store.readDocument());

    let visibilityListenerInstalled = false;
    try {
      this.vision = new Vision(this.viewState.camera, this.profile.dimensions);
      this.surface = new CanvasSessionSurface({
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        container: this.container,
        platform: this.platform,
        pixelRatioLimit: renderPixelRatioLimit(this.profile, this.store.readDocument().nodes.length),
      });
      this.projection = new SessionProjectionCoordinator(
        () => { this.diagnostics.counters.projectionPasses += 1; },
        () => { this.diagnostics.recordComposition(); },
      );
      const capabilities = detectGraphRendererCapabilities(this.platform.document, this.platform.window);
      this.rendererSelection = selectGraphRenderer({
        registry: options.rendererRegistry,
        capabilities,
        context: { createCanvas: () => this.surface.createRendererCanvas(), now: () => this.platform.now() },
        preferredBackend: options.preferredRendererBackend,
      });
      this.renderer = this.rendererSelection.renderer;
      this.surface.setRendererBackend(this.renderer.backendId);
      const viewport = this.surface.getViewport();
      this.vision.setViewport(viewport.width, viewport.height);
      this.renderer.resize(viewport);
      this.surfaceResizeSubscription = this.surface.onResize((next) => {
        this.vision.setViewport(next.width, next.height);
        this.renderer.resize(next);
        this.projection.markDirty();
        this.scheduleFrame(0, 'camera');
      });
      this.moduleHost = this.createModuleHost(this.profile, this.viewState.moduleState);
      this.consciousness.reconcile({
        attentionNodeIds: this.viewState.selectedNodeIds,
        availableNodeIds: new Set(Object.keys(this.viewState.positions)),
        relationships: this.documentTopology().relationships('either'),
      });
      this.interaction = new SessionInteractionRuntime({
        spacePhysicsOverride: this.consumerId === 'graph-plus',
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        platform: this.platform,
        surface: this.surface,
        interactionElement: this.renderer.interactionElement,
        vision: this.vision,
        experience: this.experience,
        ego: this.consciousness.ego,
        getAttention: () => this.consciousness.attention,
        getOverviewConstellationNodeIds: () => this.consciousness.awareness.nodeIds,
        getRememberedNodeIds: () => this.consciousness.remembered.nodeIds,
        setAttention: (nodeIds) => this.reconcileAttention(nodeIds),
        hitTest: (point, pointerKind, retainedHoverNodeId) => {
          // A removal preview may hide its own target. Retain only that already acquired
          // subject for picking, using the backend's real projected hit shape.
          const frame = this.projection.frames.get();
          if (!frame) return null;
          const request = { point, pointerKind };
          const hit = this.renderer.pick(request, this.pickSource(frame, retainedHoverNodeId));
          if (hit || resolveGraphActiveViewV1(this.viewState).id === 'focus') return hit;
          // A temporary Focus scene cannot revoke non-void source-View hover targets.
          const committed = this.projection.committedPickState.get();
          return committed ? this.renderer.pick(request, this.pickSource(committed)) : null;
        },
        getDocument: () => this.store.readDocument(),
        getViewState: () => this.viewState,
        getInteractivePositions: () => this.moduleView?.positions ?? this.viewState.positions,
        getNodeSelection: (nodeId) => this.resolveNodeSelection(nodeId),
        isNodeDraggable: () => !this.moduleView?.formActive,
        setViewState: (state) => { this.viewState = state; },
        patchNodePosition: (nodeId, position) => this.patchDraggedNodePosition(nodeId, position),
        getRenderSelection: () => this.renderSelection,
        getPlanningTopology: () => {
          const document = this.store.readDocument();
          const presentation = this.presentationTopology(document);
          return {
            revision: presentation.revision,
            topology: presentation.topology,
            availableNodeIds: this.documentTopology(document).nodeIds,
          };
        },
        resetCamera: () => this.resetCameraState(),
        getDragReleasePolicy: () => this.profile.profileSettings.dragRelease === 'pin' ? 'pin' : 'dynamic',
        getDragConstraintPolicy: () => this.profile.profileSettings.dragConstraint === 'transient'
          ? 'transient'
          : 'persistent-pin',
        onViewStateChanged: (change) => this.handleRuntimeViewChange(change),
        onIntent: (intent) => this.emitIntent(intent),
        onActivateNode: (nodeId) => this.invokePrimaryNodeAction(nodeId),
        onInputQueued: () => this.scheduleFrame(0, 'presentation'),
      });
      this.platform.document.addEventListener('visibilitychange', this.onVisibilityChange);
      visibilityListenerInstalled = true;
      this.activity.setDocumentSuspension(this.platform.document.hidden);
      this.recomputeView();
      this.flushPendingComposition();
      if (!restoredLayout) this.fitPositions(Object.values(this.moduleView.positions));
      this.refreshFrame();
      this.flushPendingComposition();
      this.updateRendererScene(['content']);
      this.renderer.render();
      this.synchronizeRuntimeActivity();
    } catch (error) {
      this.clearScheduledFrame();
      this.interaction?.dispose();
      this.moduleHost?.dispose();
      this.surfaceResizeSubscription?.dispose();
      this.surfaceResizeSubscription = null;
      if (visibilityListenerInstalled) {
        this.platform.document.removeEventListener('visibilitychange', this.onVisibilityChange);
      }
      this.renderer?.dispose();
      this.surface?.dispose();
      this.activity.dispose();
      throw error;
    }
  }

  async replaceDocument(document: GraphDocumentV1): Promise<void> {
    this.requireActive();
    const previous = this.store.readDocument();
    const previousCamera = this.vision.getState();
    try {
      const nextStore = new GraphDocumentStore(document);
      const next = nextStore.readDocument();
      this.store = nextStore;
      this.refreshRenderQuality(next.nodes.length);
      this.viewState = previous.documentId === next.documentId
        ? addMissingPositions(
            reconcileGraphViewStateV1(this.viewState, this.restoreContext()),
            next,
            this.profile.dimensions,
            usesGeneratedInitialPositions(this.profile.profileSettings),
          )
        : { ...this.createInitialViewState(), camera: previousCamera };
      this.viewState = withAttention(
        this.viewState,
        this.reconcileAttention(this.viewState.selectedNodeIds),
      );
      this.synchronizeObservedConsciousState();
      this.vision.setState(this.viewState.camera);
      this.moduleHost.documentChanged(next);
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView();
      this.emitGraphChanged({
        sessionId: this.sessionId,
        documentId: next.documentId,
        previousRevision: previous.revision,
        revision: next.revision,
        cause: 'replace-document',
      });
      this.emitWorldChanged('document');
    } catch (error) {
      this.emitError({
        code: 'invalid-document',
        message: errorMessage(error),
        recoverable: true,
      });
      throw error;
    }
  }

  async applyPatch(patch: GraphPatchV1): Promise<ApplyGraphPatchResultV1> {
    this.requireActive();
    const result = this.store.applyPatch(patch);
    if (!result.applied) {
      if (result.error.code === 'stale-revision') {
        this.emitError({
          code: 'stale-revision',
          message: result.error.message,
          recoverable: true,
        });
      }
      return result;
    }
    this.refreshRenderQuality(this.store.readDocument().nodes.length);
    this.viewState = addMissingPositions(
      reconcileGraphViewStateV1(this.viewState, this.restoreContext()),
      this.store.readDocument(),
      this.profile.dimensions,
      usesGeneratedInitialPositions(this.profile.profileSettings),
    );
    this.viewState = withAttention(
      this.viewState,
      this.reconcileAttention(this.viewState.selectedNodeIds),
    );
    this.moduleHost.documentChanged(this.store.readDocument());
    this.moduleHost.viewChanged(this.viewState);
    this.recomputeView();
    this.emitGraphChanged({
      sessionId: this.sessionId,
      documentId: this.store.documentId,
      previousRevision: result.previousRevision,
      revision: result.revision,
      patch: clonePatch(patch),
      cause: 'patch',
    });
    this.emitWorldChanged('document');
    return result;
  }

  async exportDocument(): Promise<GraphDocumentV1> {
    this.requireActive();
    this.diagnostics.counters.documentExports += 1;
    return this.store.exportDocument();
  }

  async applyFilter(filter: GraphFilterRequestV1): Promise<void> {
    this.requireActive();
    if (!this.moduleHost.has(SHIPPED_GRAPH_MODULE_IDS_V1.filtering)) {
      throw new Error('Filtering is unavailable in the active graph profile.');
    }
    evaluateGraphFilterV1(this.store.readDocument(), filter);
    this.viewState = cloneGraphViewStateV1({
      ...this.viewState,
      activeFilters: {
        ...this.viewState.activeFilters,
        [filter.scope]: cloneFilter(filter),
      },
    });
    this.moduleHost.viewChanged(this.viewState);
    this.recomputeView();
  }

  async clearFilter(scope?: GraphFilterScopeV1): Promise<void> {
    this.requireActive();
    const activeFilters = { ...this.viewState.activeFilters };
    if (scope === undefined) {
      delete activeFilters.render;
      delete activeFilters.projection;
    } else {
      delete activeFilters[scope];
    }
    this.viewState = cloneGraphViewStateV1({ ...this.viewState, activeFilters });
    this.moduleHost.viewChanged(this.viewState);
    this.recomputeView();
  }

  getActiveView(): GraphActiveViewV1 {
    this.requireActive();
    return resolveGraphActiveViewV1(this.viewState);
  }

  getAvailableViews(): readonly GraphViewIdV1[] {
    this.requireActive();
    return [...this.experience.allowedStates];
  }

  async setView(viewId: GraphViewIdV1): Promise<void> {
    this.requireActive();
    if (!this.experience.allowedStates.includes(viewId)) throw new Error(`View ${viewId} is not permitted.`);
    if (viewId === 'focus' && this.viewState.selectedNodeIds.length === 0) {
      throw new Error('Focus requires an available constellation member.');
    }
    if (viewId === 'focus' && this.viewState.focusedNodeId === undefined) {
      throw new Error('Focus requires an explicit subject.');
    }
    this.interaction.reset();
    this.setFocusState(viewId === 'focus' ? this.viewState.focusedNodeId : undefined, viewId);
  }

  getViewUiState(viewId: GraphViewIdV1): GraphViewUiStateV1 | undefined {
    this.requireActive();
    const state = this.viewUiState.get(viewId);
    return state && { ...state, expandedSectionIds: [...state.expandedSectionIds] };
  }

  setViewUiState(viewId: GraphViewIdV1, state: GraphViewUiStateV1): void {
    this.requireActive();
    this.viewUiState.set(viewId, { ...state, expandedSectionIds: [...new Set(state.expandedSectionIds)] });
  }

  async setSelection(nodeIds: readonly string[]): Promise<void> {
    this.requireActive();
    this.setSelectionState(nodeIds);
  }

  async focusNode(nodeId: string | null): Promise<void> {
    this.requireActive();
    if (nodeId !== null && !this.renderSelection.nodeIds.has(nodeId)) {
      throw new Error(`Cannot focus unavailable node "${nodeId}".`);
    }
    // External Focus changes end the old hover visit before evaluating the new scene.
    this.interaction.reset();
    if (nodeId === null) {
      this.interaction.cancelCameraTransition();
      this.setFocusState(undefined, this.viewState.selectedNodeIds.length > 0 ? 'explore' : 'overview');
      return;
    }
    const changed = this.viewState.focusedNodeId !== nodeId;
    if (!this.viewState.selectedNodeIds.includes(nodeId)) {
      this.setSelectionState([...this.viewState.selectedNodeIds, nodeId]);
    }
    this.setFocusState(nodeId);
    if (changed && this.experience.framing.focus.entry !== 'preserve') this.interaction.recenterSubject(nodeId);
  }

  async setNodeHover(nodeId: string | null): Promise<void> {
    this.requireActive();
    if (nodeId !== null && (!this.renderSelection.nodeIds.has(nodeId)
      || !this.store.readDocument().nodes.some(node => node.id === nodeId))) return;
    this.interaction.queueNodeHover(nodeId ?? undefined);
  }

  async applyExternalInfluence(
    influence: GraphExternalInfluenceV1,
  ): Promise<GraphExternalInfluenceResultV1> {
    this.requireActive();
    const document = this.store.readDocument();
    const topology = this.documentTopology(document);
    const availableNodeIds = topology.nodeIds;
    const resolution = resolveGraphExternalInfluenceV1({
      influence,
      experience: this.experience,
      availableNodeIds,
    });
    if (resolution.result.status !== 'rejected' && resolution.rememberedNodeIds !== undefined) {
      const consciousness = this.consciousness.receiveExogenous({
        source: 'exogenous',
        type: 'replace-remembered-subjects',
        nodeIds: resolution.rememberedNodeIds,
      }, {
        availableNodeIds,
        relationships: topology.relationships('either'),
      });
      this.refreshFrame();
      return {
        ...resolution.result,
        rememberedNodeIds: [...consciousness.remembered.nodeIds],
      };
    }
    if (resolution.result.status === 'rejected' || resolution.attentionNodeIds === undefined) {
      return resolution.result;
    }
    const consciousness = this.consciousness.receiveExogenous({
      source: 'exogenous',
      type: 'replace-attention',
      nodeIds: resolution.attentionNodeIds,
    }, {
      availableNodeIds,
      relationships: topology.relationships('either'),
    });
    const attentionNodeIds = [...consciousness.attention.nodeIds];
    const focusedNodeId = resolution.focusedNodeId !== undefined
      && consciousness.attention.nodeIds.has(resolution.focusedNodeId)
      ? resolution.focusedNodeId
      : undefined;
    const currentMode = resolveGraphUxStateV1(this.viewState);
    const viewMode = focusedNodeId !== undefined ? 'focus'
      : currentMode === 'focus' || (!this.experience.allowedStates.includes(currentMode)
        && this.experience.allowedStates.includes('explore')) ? 'explore' : currentMode;
    const stateChanged = !sameIds(attentionNodeIds, this.viewState.selectedNodeIds)
      || focusedNodeId !== this.viewState.focusedNodeId || viewMode !== currentMode;
    if (stateChanged) {
      const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.viewState;
      this.viewState = focusedNodeId === undefined
        ? { ...withoutFocus, selectedNodeIds: attentionNodeIds, viewMode }
        : { ...withoutFocus, selectedNodeIds: attentionNodeIds, focusedNodeId, viewMode };
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView();
    }
    if (influence.type === 'replace-attention' && influence.framing === 'recenter-focus' && focusedNodeId !== undefined) {
      this.interaction.recenterSubject(focusedNodeId);
    }
    if (influence.type === 'replace-attention' && influence.framing === 'fit-state') {
      if (focusedNodeId !== undefined) {
        this.fitPositions(this.focusNeighborhoodNodeIds(focusedNodeId)
          .map((id) => this.moduleView.positions[id]).filter((p): p is Vec3 => p !== undefined),
          this.moduleView.positions[focusedNodeId], undefined, true);
      }
      else if (attentionNodeIds.length > 0) {
        const fitNodeIds = attentionFitNodeIdsV1(
          attentionNodeIds,
          document.edges,
          this.renderSelection.nodeIds,
          this.renderSelection.edgeIds,
        );
        await this.fitNodes(fitNodeIds, attentionNodeIds.length === 1
          ? { centerNodeId: attentionNodeIds[0] }
          : undefined);
      }
      else await this.fitNodes();
    }
    return {
      ...resolution.result,
      attentionNodeIds,
      ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
    };
  }

  async setPreviewSurfaceActive(active: boolean): Promise<void> {
    this.requireActive();
    this.interaction.setPreviewSurfaceActive(active);
  }

  async clearPreview(): Promise<void> {
    this.requireActive();
    this.interaction.clearPreview();
  }

  async setNodePinned(nodeId: string, pinned: boolean): Promise<void> {
    this.requireActive();
    if (!this.store.hasNode(nodeId)) {
      throw new Error(`Cannot ${pinned ? 'pin' : 'unpin'} unknown node "${nodeId}".`);
    }
    const current = new Set(this.viewState.pinnedNodeIds);
    if (pinned) current.add(nodeId);
    else current.delete(nodeId);
    const pinnedNodeIds = [...current];
    if (sameIds(pinnedNodeIds, this.viewState.pinnedNodeIds)) return;
    this.viewState = { ...this.viewState, pinnedNodeIds };
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'geometry');
    this.emitWorldChanged('pin');
  }

  async fitNodes(nodeIds?: readonly string[], options?: FitNodesOptionsV1): Promise<void> {
    this.requireActive();
    assertTransition(options);
    const document = this.store.readDocument();
    const candidates = nodeIds ?? [...this.renderSelection.nodeIds];
    const positions = [...new Set(candidates)]
      .filter((id) => document.nodes.some((node) => node.id === id))
      .map((id) => this.moduleView.positions[id])
      .filter((position): position is Vec3 => position !== undefined);
    if (!positions.length) return;
    const center = options?.centerNodeId
      ? this.moduleView.positions[options.centerNodeId]
      : undefined;
    if (options?.centerNodeId && !center) {
      throw new Error(`Cannot center camera on unknown node "${options.centerNodeId}".`);
    }
    const minimumRadius = options?.minimumRadius;
    if (minimumRadius !== undefined && (!Number.isFinite(minimumRadius) || minimumRadius < 0)) {
      throw new Error('Fit minimum radius must be a non-negative finite number.');
    }
    this.interaction.cancelCameraTransition();
    this.interaction.resetVisionInterest();
    this.fitPositions(positions, center, minimumRadius);
  }

  async resetCamera(options?: TransitionOptionsV1): Promise<void> {
    this.requireActive();
    assertTransition(options);
    this.interaction.cancelCameraTransition();
    this.interaction.resetVisionInterest();
    this.resetCameraState();
    const focusedNodeId = this.viewState.focusedNodeId;
    this.synchronizeCameraState();
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'camera');
    const document = this.store.readDocument();
    this.emitIntent({
      sessionId: this.sessionId,
      documentId: document.documentId,
      documentRevision: document.revision,
      timestamp: this.platform.now(),
      type: 'camera-reset',
      ...(focusedNodeId ? { focusedNodeId } : {}),
    });
  }

  async exportViewState(): Promise<GraphViewStateV1> {
    this.requireActive();
    this.diagnostics.counters.viewExports += 1;
    this.synchronizeModuleState();
    return cloneGraphViewStateV1(withoutRetiredGraphSystemState(this.viewState));
  }

  async restoreViewState(state: GraphViewStateV1): Promise<void> {
    this.requireActive();
    try {
      const source = withoutRetiredGraphSystemState(state);
      if (!hasPlausibleRestoredPositions(source)) {
        throw new Error('Saved graph positions exceed safe numerical bounds.');
      }
      const prepared = this.prepareRestoredViewState(source);
      const restoredViewState = normalizePerspectiveViewState(addMissingPositions(
        reconcileGraphViewStateV1(prepared, this.restoreContext()),
        this.store.readDocument(),
        this.profile.dimensions,
        usesGeneratedInitialPositions(this.profile.profileSettings),
      ), this.profile.dimensions, focalLengthMm(this.profile.profileSettings));
      this.viewState = restoredViewState;
      const restoredMemory = readMemorySnapshot(
        restoredViewState.moduleState[CONSCIOUS_MEMORY_STATE_KEY_V1],
      );
      this.consciousness.restoreMemory(restoredMemory ?? {
        schemaVersion: 1,
        observationCount: 0,
        buckets: [],
      });
      this.viewState = withAttention(
        this.viewState,
        this.reconcileAttention(this.viewState.selectedNodeIds),
      );
      this.vision.setState(this.viewState.camera);
      this.moduleHost.restoreState(this.viewState.moduleState);
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView();
      this.emitWorldChanged('restore');
    } catch (error) {
      this.emitError({
        code: 'incompatible-view-state',
        message: errorMessage(error),
        recoverable: true,
      });
      throw error;
    }
  }

  async exportWorldState(): Promise<GraphWorldStateV1> {
    this.requireActive();
    const document = this.store.readDocument();
    return {
      schemaVersion: 1,
      documentId: document.documentId,
      documentRevision: document.revision,
      dimensions: this.profile.dimensions,
      positions: clonePositions(this.viewState.positions),
      pinnedNodeIds: [...this.viewState.pinnedNodeIds],
      layoutModuleState: this.moduleHost.exportCapabilityState('layout'),
    };
  }

  async applyWorldState(state: GraphWorldStateV1): Promise<void> {
    this.requireActive();
    const document = this.store.readDocument();
    if (state.documentId !== document.documentId || state.documentRevision !== document.revision) return;
    if (state.dimensions !== this.profile.dimensions) return;
    const known = new Set(document.nodes.map((node) => node.id));
    const positions = Object.fromEntries(document.nodes.map((node) => {
      const position = state.positions[node.id] ?? this.viewState.positions[node.id];
      return [node.id, position ? { ...position } : { x: 0, y: 0, z: 0 }] as const;
    }));
    const pinnedNodeIds = [...new Set(state.pinnedNodeIds)].filter((nodeId) => known.has(nodeId));
    const geometryChanged = !samePositions(positions, this.viewState.positions)
      || !sameIds(pinnedNodeIds, this.viewState.pinnedNodeIds);
    this.moduleHost.restoreCapabilityState('layout', state.layoutModuleState);
    if (!geometryChanged) return;
    const previousFollowPoint = this.vision.deriveCentroid(
      this.interaction.getCameraTrackingNodeIds(),
      this.viewState.positions,
    );
    this.viewState = cloneGraphViewStateV1({ ...this.viewState, positions, pinnedNodeIds });
    const nextFollowPoint = this.vision.deriveCentroid(
      this.interaction.getCameraTrackingNodeIds(),
      positions,
    );
    if (previousFollowPoint && nextFollowPoint) {
      this.vision.translateBy(subtractVec(nextFollowPoint, previousFollowPoint));
      this.synchronizeCameraState();
    }
    this.moduleHost.viewChanged(this.viewState);
    this.projectionView = { ...this.projectionView, positions, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, positions, viewState: this.viewState };
    this.refreshFrame(true, 'geometry');
    this.updateSurface();
  }

  setLayoutAuthority(authority: boolean): void {
    this.requireActive();
    if (this.layoutAuthority === authority) return;
    this.layoutAuthority = authority;
    if (authority) {
      this.moduleHost.viewChanged(this.viewState);
      this.scheduleFrame(0, 'geometry');
    }
  }

  async setSessionOverrides(overrides: GraphSettingsOverridesV1): Promise<void> {
    this.requireActive();
    const requested = cloneOverrides(overrides);
    this.applyResolvedProfile(this.resolveProfile(requested));
    this.sessionOverrides = requested;
    this.emitSessionOverridesChanged();
  }

  createControlPort(): GraphSessionControlPortV1 {
    return {
      toggleConstellationNode: (nodeId, modality) => {
        this.requireActive();
        this.interaction.queueConstellationToggle(nodeId, modality);
      },
      navigateView: (navigationAction) => {
        this.requireActive();
        this.interaction.queueViewIntent({ phase: 'activate', target: { kind: 'background' },
          modality: 'keyboard', modifiers: { ctrl: false, meta: false, shift: false, alt: false }, navigationAction });
      },
      focusConstellationNode: (nodeId, modality = 'keyboard') => {
        this.requireActive();
        this.interaction.queueViewIntent({ phase: 'activate', target: { kind: 'node', nodeId },
          modality, modifiers: { ctrl: false, meta: false, shift: false, alt: false }, objectAction: 'focus' });
      },
      setNodePinned: async (nodeId, pinned) => {
        this.requireActive();
        const outcome = this.consciousness.ego.consider(this.consciousness.ego.intend({ type: 'pin-subject', nodeId, pinned }));
        if (outcome.status !== 'rejected') await this.setNodePinned(outcome.directive.nodeId, outcome.directive.pinned);
      },
      getSessionOverrides: () => cloneOverrides(this.sessionOverrides),
      onSessionOverridesChanged: (listener) => {
        this.overrideListeners.add(listener);
        return { dispose: () => this.overrideListeners.delete(listener) };
      },
      setModuleEnabled: async (moduleId, enabled) => {
        this.requireActive();
        const outcome = this.consciousness.ego.consider(this.consciousness.ego.intend({ type: 'configure-module', moduleId, enabled }));
        if (outcome.status !== 'rejected') await this.patchModuleOverride(outcome.directive.moduleId, { enabled: outcome.directive.enabled });
      },
      setModuleSetting: async (moduleId, key, value) => {
        this.requireActive();
        const outcome = this.consciousness.ego.consider(this.consciousness.ego.intend({ type: 'configure-module-setting', moduleId, key, value }));
        if (outcome.status !== 'rejected') await this.patchModuleSetting(outcome.directive.moduleId, outcome.directive.key, outcome.directive.value);
      },
      createNodeActionContext: (nodeId) => this.nodeActionContext(nodeId),
      resolveNodeActions: (actionIds, nodeId) => {
        if (!this.nodeActions || !this.hasNode(nodeId)) return [];
        return this.nodeActions.resolve(
          actionIds,
          this.nodeActionContext(nodeId),
          (failure) => this.handleNodeActionFailure(failure),
        );
      },
      invokeNodeAction: (actionId, nodeId) => {
        this.requireActive();
        const outcome = this.consciousness.ego.consider(this.consciousness.ego.intend({ type: 'invoke-node-action', actionId, nodeId }));
        if (outcome.status === 'rejected') return false;
        ({ actionId, nodeId } = outcome.directive);
        if (!this.hasNode(nodeId)) return false;
        return this.nodeActions?.invoke(
          actionId,
          this.nodeActionContext(nodeId),
          (failure) => this.handleNodeActionFailure(failure),
        ) ?? false;
      },
    };
  }

  refreshResolvedProfile(): void {
    this.requireActive();
    this.applyResolvedProfile(this.resolveProfile(this.sessionOverrides));
  }

  refreshThemePalette(): void {
    this.requireActive();
    const resolved = this.resolveThemePalette?.();
    if (!resolved || graphVisualThemesEqualV2(this.themePalette, resolved)) return;
    const next = freezeGraphVisualThemeV2({ ...resolved, revision: this.themePalette.revision + 1 });
    this.themePalette = next;
    this.moduleHost.themeChanged(next);
    this.renderer.updateTheme(next);
    this.refreshFrame(true, 'presentation');
  }

  private physicsOverrideProfile(profile: EffectiveConsumerProfileV1): EffectiveConsumerProfileV1 {
    const force = profile.modules['force-layout'];
    if (!this.physicsOverrideHeld || !force || force.policy === 'forbidden' || force.enabled) return profile;
    return { ...profile, modules: { ...profile.modules, 'force-layout': { ...force, enabled: true } } };
  }

  private applyResolvedProfile(next: EffectiveConsumerProfileV1): void {
    const fatalIssues = next.issues.filter((issue) => issue.fatal);
    if (fatalIssues.length) throw new Error(fatalIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    if (!next.modules[SHIPPED_GRAPH_MODULE_IDS_V1.rendering]?.enabled) {
      throw new Error('A mounted graph session requires the rendering module.');
    }
    if (
      next.dimensions === '3d'
      && next.modules[SHIPPED_GRAPH_MODULE_IDS_V1.nodeRegions]?.enabled
      && next.modules[SHIPPED_GRAPH_MODULE_IDS_V1.nodeRegions]?.policy === 'required'
    ) {
      throw new Error('modules.node-regions: Required node regions are available only in 2D.');
    }
    if (next.dimensions !== this.profile.dimensions) {
      this.reconfigureDimensions(next);
      return;
    }
    this.moduleHost.updateProfile(this.physicsOverrideProfile(next));
    this.vision.setPerspectiveZoom(focalLengthMm(next.profileSettings) / 24);
    this.synchronizeCameraState();
    this.profile = next;
    this.refreshRenderQuality();
    this.recomputeView(false);
  }

  private reconfigureDimensions(next: EffectiveConsumerProfileV1): void {
    const previousProfile = this.profile;
    this.synchronizeModuleState();
    const previousViewState = cloneGraphViewStateV1(this.viewState);
    const previousCamera = this.vision.getState();
    const previousHost = this.moduleHost;
    const viewport = this.surface.getViewport();
    const converted = convertGraphViewStateDimensionsV1(this.viewState, {
      dimensions: next.dimensions,
      focalLengthMm: focalLengthMm(next.profileSettings),
      viewportHeight: viewport.height,
    });
    const deferredFailures: GraphModuleFailureV1[] = [];
    let committed = false;
    const replacementHost = this.createModuleHost(
      next,
      converted.moduleState,
      () => committed ? this.viewState : converted,
      (failure) => deferredFailures.push(failure),
    );
    this.interaction.setEnabled(false);
    this.clearScheduledFrame();
    this.lastFrameTimestamp = null;
    try {
      this.viewState = converted;
      this.profile = next;
      this.refreshRenderQuality();
      this.vision.reconfigure(converted.camera, next.dimensions);
      this.interaction.setDimensions(next.dimensions);
      this.surface.setDimensions(next.dimensions);
      this.moduleHost = replacementHost;
      committed = true;
      // A replacement layout module may restore a cooled snapshot. Dimension
      // conversion changes its physical space, so explicitly wake it after the
      // new host becomes active.
      this.moduleHost.documentChanged(this.store.readDocument());
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView(false);
      this.refreshFrame();
      previousHost.dispose();
      for (const failure of deferredFailures) this.handleModuleFailure(failure);
    } catch (error) {
      this.moduleHost = previousHost;
      this.profile = previousProfile;
      this.refreshRenderQuality();
      this.viewState = previousViewState;
      this.vision.reconfigure(previousCamera, previousProfile.dimensions);
      this.interaction.setDimensions(previousProfile.dimensions);
      this.surface.setDimensions(previousProfile.dimensions);
      replacementHost.dispose();
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView(false);
      this.refreshFrame();
      throw error;
    } finally {
      this.synchronizeRuntimeActivity();
    }
  }

  private createModuleHost(
    profile: EffectiveConsumerProfileV1,
    initialModuleState: Readonly<Record<string, JsonValue>>,
    getViewState: () => GraphViewStateV1 = () => this.viewState,
    onFailure: (failure: GraphModuleFailureV1) => void = (failure) => this.handleModuleFailure(failure),
  ): GraphModuleHost {
    return new GraphModuleHost({
      registry: this.modules,
      profile,
      sessionId: this.sessionId,
      themePalette: this.themePalette,
      initialModuleState,
      getDocument: () => this.store.readDocument(),
      getViewState,
      canRunLayout: () => this.layoutAuthority,
      onFailure,
    });
  }

  private prepareRestoredViewState(state: GraphViewStateV1): GraphViewStateV1 {
    if (state.dimensions === this.profile.dimensions) return state;
    if (!this.profile.allowedDimensions.includes(state.dimensions)) return state;
    const bounds = this.container.getBoundingClientRect();
    return convertGraphViewStateDimensionsV1(state, {
      dimensions: this.profile.dimensions,
      focalLengthMm: focalLengthMm(this.profile.profileSettings),
      viewportHeight: bounds.height,
    });
  }

  private async patchModuleOverride(
    moduleId: string,
    patch: { readonly enabled?: boolean },
  ): Promise<void> {
    const overrides = cloneOverrides(this.sessionOverrides);
    const modules = { ...(overrides.modules ?? {}) };
    const current = modules[moduleId] ?? {};
    const next = { ...current, ...patch };
    if (next.enabled === undefined && Object.keys(next.settings ?? {}).length === 0) delete modules[moduleId];
    else modules[moduleId] = next;
    await this.setSessionOverrides({
      ...overrides,
      modules: Object.keys(modules).length ? modules : undefined,
    });
  }

  private async patchModuleSetting(
    moduleId: string,
    key: string,
    value: JsonValue | undefined,
  ): Promise<void> {
    const overrides = cloneOverrides(this.sessionOverrides);
    const modules = { ...(overrides.modules ?? {}) };
    const current = modules[moduleId] ?? {};
    const settings = { ...(current.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    const next = { ...current, settings: Object.keys(settings).length ? settings : undefined };
    if (next.enabled === undefined && next.settings === undefined) delete modules[moduleId];
    else modules[moduleId] = next;
    await this.setSessionOverrides({
      ...overrides,
      modules: Object.keys(modules).length ? modules : undefined,
    });
  }

  async exportEffectiveSettings(): Promise<GraphEffectiveSettingsV1> {
    this.requireActive();
    return {
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: this.profile.dimensions,
      dimensionsSource: this.profile.dimensionsSource,
      profileSettings: cloneJsonRecord(this.profile.profileSettings),
      profileSettingSources: { ...this.profile.profileSettingSources },
      modules: Object.fromEntries(Object.entries(this.profile.modules).map(([id, module]) => [id, {
        enabled: module.enabled,
        enabledSource: module.enabledSource,
        settings: cloneJsonRecord(module.settings),
        settingSources: { ...module.settingSources },
      }])),
    };
  }

  async exportPerformanceSnapshot(): Promise<GraphPerformanceSnapshotV1> {
    this.requireActive();
    return this.diagnostics.performanceSnapshot();
  }

  async resetPerformanceMeasurements(): Promise<void> {
    this.requireActive();
    this.diagnostics.reset();
  }

  getDiagnostics(): GraphSessionRuntimeDiagnostics {
    const document = this.store.readDocument();
    const activity = this.activity.snapshot(this.fatalModuleError !== null);
    const scheduler = this.scheduler.snapshot();
    const diagnostics = this.diagnostics.runtimeSnapshot();
    return {
      sessionId: this.sessionId,
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: this.profile.dimensions,
      documentId: document.documentId,
      documentRevision: document.revision,
      layoutAuthority: this.layoutAuthority,
      nodeCount: document.nodes.length,
      edgeCount: document.edges.length,
      manuallySuspended: activity.manuallySuspended,
      documentSuspended: activity.documentSuspended,
      suspended: activity.suspended,
      frameScheduled: scheduler.frameScheduled,
      animationFrameScheduled: scheduler.animationFrameScheduled,
      wakeTimerScheduled: scheduler.wakeTimerScheduled,
      pendingInvalidations: scheduler.pendingInvalidations,
      lastFrameInvalidations: diagnostics.lastFrameInvalidations,
      invalidationCounts: diagnostics.invalidationCounts,
      compositionsThisFrame: diagnostics.compositionsThisFrame,
      maxCompositionsPerFrame: diagnostics.maxCompositionsPerFrame,
      compositionWork: this.projection.getDiagnostics(),
      renderCaches: this.renderer.getRendererDiagnostics().resources,
      renderer: {
        selectedBackendId: this.renderer.backendId,
        registeredBackendIds: this.rendererSelection.registeredBackendIds,
        capabilities: this.rendererSelection.capabilities,
        attempts: this.rendererSelection.attempts,
        lifecycle: this.renderer.getRendererDiagnostics().lifecycle,
      },
      renderQuality: renderQuality(this.profile),
      nativePixelRatio: this.platform.devicePixelRatio,
      effectivePixelRatio: this.surface.getViewport().devicePixelRatio,
      frameCount: diagnostics.frameCount,
      lastFrameTimestamp: this.lastFrameTimestamp,
      counters: diagnostics.counters,
      modules: this.moduleHost.getDiagnostics(),
    };
  }

  onViewChanged(listener: (view: GraphActiveViewV1) => void): Disposable {
    this.requireActive();
    this.viewListeners.add(listener);
    return { dispose: () => { this.viewListeners.delete(listener); } };
  }

  onIntent(listener: (intent: GraphIntentV1) => void): Disposable {
    return this.subscribe(this.intentListeners, listener);
  }

  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable {
    return this.subscribe(this.graphChangedListeners, listener);
  }

  onWorldChanged(listener: (event: GraphWorldChangedEventV1) => void): Disposable {
    return this.subscribe(this.worldChangedListeners, listener);
  }

  onError(listener: (error: GraphSessionErrorV1) => void): Disposable {
    const subscription = this.subscribe(this.errorListeners, listener);
    const deferred = this.deferredErrors.splice(0);
    for (const error of deferred) {
      try { listener({ ...error }); } catch {}
    }
    return subscription;
  }

  setSuspended(suspended: boolean): void {
    this.requireActive();
    if (!this.activity.setManualSuspension(suspended)) return;
    this.synchronizeRuntimeActivity();
  }

  async dispose(): Promise<void> {
    if (!this.activity.dispose()) return;
    this.clearScheduledFrame();
    this.interaction.dispose();
    this.moduleHost.dispose();
    this.projection.clear();
    this.surfaceResizeSubscription?.dispose();
    this.surfaceResizeSubscription = null;
    this.platform.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.intentListeners.clear();
    this.viewListeners.clear();
    this.graphChangedListeners.clear();
    this.worldChangedListeners.clear();
    this.errorListeners.clear();
    this.overrideListeners.clear();
    this.renderer.dispose();
    this.surface.dispose();
    this.onDisposed?.();
  }

  private refreshRenderQuality(nodeCount = this.store.readDocument().nodes.length): void {
    this.surface?.setPixelRatioLimit(renderPixelRatioLimit(this.profile, nodeCount));
  }

  private restoreContext() {
    return {
      document: this.store.readDocument(),
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: this.profile.dimensions,
    } as const;
  }

  private createInitialViewState(profile: EffectiveConsumerProfileV1 = this.profile): GraphViewStateV1 {
    const document = this.store.readDocument();
    return {
      schemaVersion: 1,
      documentId: document.documentId,
      documentRevision: document.revision,
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: profile.dimensions,
      positions: Object.fromEntries(
        document.nodes.map((node, index) => [
          node.id,
          profile.profileSettings.initialPositionStrategy !== 'generated' && node.positionHint
            ? { ...node.positionHint }
            : defaultNodePosition(index, profile.dimensions),
        ]),
      ),
      pinnedNodeIds: [],
      camera: defaultCamera(profile.dimensions, focalLengthMm(profile.profileSettings)),
      selectedNodeIds: [],
      viewMode: 'overview',
      activeFilters: {},
      moduleState: {},
    };
  }

  private recomputeView(resetInteraction = true): void {
    if (resetInteraction) this.interaction.reset();
    const document = this.store.readDocument();
    const previousCameraFollowPoint = this.vision.deriveCentroid(
      this.interaction.getCameraTrackingNodeIds(),
      this.viewState.positions,
    );
    this.projectionView = this.projection.project(this.moduleHost, {
      sourceDocument: document,
      document,
      viewState: this.viewState,
      positions: this.viewState.positions,
      projectionSelection: allOf(document),
      renderSelection: allOf(document),
      formActive: false,
      nodeRoles: {},
      edgeRoles: {},
      regions: [],
      regionLayouts: [],
    });
    if (this.projectionView.commitPositions) {
      const nextCameraFollowPoint = this.vision.deriveCentroid(
        this.interaction.getCameraTrackingNodeIds(),
        this.projectionView.positions,
      );
      this.viewState = cloneGraphViewStateV1({
        ...this.viewState,
        positions: this.projectionView.positions,
      });
      if (previousCameraFollowPoint && nextCameraFollowPoint) {
        this.vision.translateBy(subtractVec(nextCameraFollowPoint, previousCameraFollowPoint));
        this.synchronizeCameraState();
      }
      this.projectionView = {
        ...this.projectionView,
        positions: this.viewState.positions,
        viewState: this.viewState,
        commitPositions: false,
      };
      this.moduleHost.viewChanged(this.viewState);
    }
    this.projectionSelection = this.projectionView.projectionSelection;
    this.renderSelection = this.projectionView.renderSelection;
    // Build filtered adjacency with the content transaction so pointer input never
    // pays graph-wide topology construction on its first hover.
    this.presentationTopology(document);
    const availableAttention = this.viewState.selectedNodeIds.filter((id) => this.renderSelection.nodeIds.has(id));
    const focusAvailable = this.viewState.focusedNodeId !== undefined
      && availableAttention.includes(this.viewState.focusedNodeId);
    const mode = resolveGraphUxStateV1(this.viewState);
    const nextMode = availableAttention.length === 0
      ? mode === 'explore' && this.viewState.selectedNodeIds.length === 0 ? 'explore' : 'overview'
      : mode === 'focus' && !focusAvailable ? 'explore' : mode;
    const { focusedNodeId: _focus, ...withoutFocus } = this.viewState;
    this.viewState = {
      ...withoutFocus, selectedNodeIds: this.reconcileAttention(availableAttention), viewMode: nextMode,
      ...(focusAvailable && nextMode === 'focus' ? { focusedNodeId: _focus } : {}),
    };
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'content');
    this.updateSurface();
  }

  private observeCommittedView(): void {
    const view = resolveGraphActiveViewV1(this.viewState);
    if (view.id === 'focus') {
      this.consciousness.ego.intendVision({ kind: 'follow-subject', nodeId: view.subjectNodeId });
    } else if (this.observedVisionFocusSubjectId !== undefined
      && GRAPH_VIEW_DEFINITIONS_V1.focus.framing.exitInterest === 'retain-focal-point') {
      this.consciousness.ego.intendVision({ kind: 'retain-focal-point' });
    }
    this.observedVisionFocusSubjectId = view.id === 'focus' ? view.subjectNodeId : undefined;
    const key = JSON.stringify(view);
    if (key !== this.observedView) {
      this.observedView = key;
      for (const listener of [...this.viewListeners]) {
        try { listener({ ...view }); } catch { /* Observers cannot veto committed state. */ }
      }
    }
  }

  private refreshFrame(
    schedule = true,
    invalidation: SessionInvalidationClass = 'presentation',
  ): void {
    this.observeCommittedView();
    if (this.moduleView) {
      // Physics/choreography consume current committed structural inputs even
      // when their renderer presentation is waiting for the display callback.
      this.moduleView = { ...this.moduleView, ...this.projectionView,
        viewState: this.viewState, consciousness: this.consciousness.snapshot() };
    }
    this.activeFrameInvalidations?.add(invalidation);
    if (invalidation === 'camera' || invalidation === 'ui') this.projection.markDirty();
    else this.pendingCompositionInvalidations.add(invalidation);
    if (schedule) this.scheduleFrame(0, invalidation);
  }

  /** The initial scene and the end of an eligible display callback are the only flush boundaries. */
  private flushPendingComposition(): void {
    const pending = this.pendingCompositionInvalidations;
    if (pending.size === 0) return;
    const invalidation = pending.has('content') ? 'content' : pending.has('geometry') ? 'geometry' : 'presentation';
    for (const reason of pending) this.activeFrameInvalidations?.add(reason);
    if (pending.has('presentation')) this.presentationRevision += 1;
    pending.clear();
    this.moduleView = this.projection.compose({
      host: this.moduleHost,
      consciousness: this.consciousness,
      experience: this.experience,
      resolveObjectActivationPreview: () => this.interaction?.getObjectActivationPreview() ?? null,
      projectionView: this.projectionView,
      viewState: this.viewState,
      theme: this.themePalette,
      presentationPolicy: DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      draggedNodeId: this.interaction?.getDraggedNodeId(),
      hoveredNodeId: this.interaction?.getPresentationHoveredNodeId(),
      selectionPresentationSuspended: this.interaction?.isSelectionPresentationSuspended(),
      selectionNeighborRevealActive: this.interaction?.isSelectionNeighborRevealActive(),
      previewedNodeId: this.interaction?.getPreviewedNodeId(),
      invalidation,
      now: this.platform.now(),
      previewCommitted: this.interaction?.isHoverPreviewCommitted(),
    });
  }

  private resolveCursorFieldTarget(): {
    nodeId: string; point: { x: number; y: number; depth: number }; distance: number; radius: number;
  } | undefined {
    const cursor = this.interaction?.getCursorPoint();
    const frame = this.projection.frames.get();
    const radius = frame?.policy?.cursorAttractionRadiusPx ?? 0;
    if (!cursor || !frame || radius <= 0 || this.moduleView.formActive
      || this.interaction.getDraggedNodeId() !== undefined) return undefined;
    const fixed = new Set([...this.viewState.pinnedNodeIds, ...this.interaction.getCameraTrackingNodeIds()]);
    if (this.viewState.focusedNodeId !== undefined) fixed.add(this.viewState.focusedNodeId);
    const nearest = this.renderer.queryNearest({ point: cursor, radius, exclusions: fixed,
      isEligible: nodeId => this.moduleView.positions[nodeId] !== undefined,
    }, { ...this.pickSource(frame), nodeIds: undefined });
    return nearest ? { nodeId: nearest.nodeId, point: nearest.point, distance: nearest.distance, radius } : undefined;
  }

  private resolveCursorAttractionSteps(): Readonly<Record<string, Vec3>> | undefined {
    const nearest = this.resolveCursorFieldTarget();
    // A centered nearest node still owns the well; never pull a runner-up instead.
    if (!nearest || nearest.distance < 0.5) return undefined;
    const cursor = this.interaction.getCursorPoint()!;
    const { nodeId, point, distance, radius } = nearest;
    const clingy = this.projection.frames.get()?.policy?.cursorAttractionMode === 'clingy';
    // A softened hyperbolic well, normalized to zero at the edge. Clingy is
    // narrower and deeper; both remain bounded and cannot overshoot the cursor.
    const core = radius * (clingy ? 0.3 : 0.7);
    const edge = 1 / Math.sqrt(1 + (radius / core) ** 2);
    const well = (1 / Math.sqrt(1 + (distance / core) ** 2) - edge) / (1 - edge);
    const amount = Math.min((clingy ? 0.28 : 0.035) * well, (clingy ? 6 : 1.5) / distance);
    const target = this.vision.screenToWorld(point.x + (cursor.x - point.x) * amount,
      point.y + (cursor.y - point.y) * amount, point.depth);
    const position = this.moduleView.positions[nodeId];
    return { [nodeId]: { x: target.x - position.x, y: target.y - position.y, z: target.z - position.z } };
  }

  private pickSource(frame: GraphPickSourceV2['frame'], retainedNodeId?: string): GraphPickSourceV2 {
    return {
      frame,
      retainedNodeId,
      ...(this.pendingDragGeometry || this.pendingCompositionInvalidations.has('geometry')
        || this.pendingCompositionInvalidations.has('content') ? { positions: this.moduleView.positions } : {}),
      ...(this.pendingCompositionInvalidations.has('content') ? { nodeIds: this.renderSelection.nodeIds } : {}),
      view: {
        dimensions: this.profile.dimensions,
        camera: this.vision.getState(),
        viewport: this.surface.getViewport(),
      },
    };
  }

  private updateRendererScene(invalidations: readonly SessionInvalidationClass[]): void {
    const frame = this.projection.frames.get();
    if (!frame) return;
    this.renderSceneRevision += 1;
    this.renderer.updateScene({
      ...frame,
      // Hover/peek policy owns labels while a node or its note preview is active.
      policy: this.interaction.getPresentationHoveredNodeId() !== undefined
        ? { ...frame.policy, cursorLabelRevealRadiusPx: 0 } : frame.policy,
      cursorScreenPoint: this.interaction.getCursorPoint(),
      revision: this.renderSceneRevision,
      presentationRevision: this.presentationRevision,
      view: {
        dimensions: this.profile.dimensions,
        camera: this.vision.getState(),
        viewport: this.surface.getViewport(),
      },
      labels: this.renderer.labelRepresentation === 'node-fields'
        ? EMPTY_GRAPH_LABEL_RECORDS : this.labelRecordCache.resolve(frame),
    }, invalidations);
  }

  private updateSurface(): void {
    const document = this.store.readDocument();
    this.surface.update({
      documentId: document.documentId,
      documentRevision: document.revision,
      projectedNodeCount: this.projectionSelection.nodeIds.size,
      projectedEdgeCount: this.projectionSelection.edgeIds.size,
      renderedNodeCount: this.renderSelection.nodeIds.size,
      renderedEdgeCount: this.renderSelection.edgeIds.size,
      selectedNodeCount: this.viewState.selectedNodeIds.length,
      focusedNodeId: this.viewState.focusedNodeId,
    });
  }

  private patchDraggedNodePosition(nodeId: string, position: Vec3): void {
    // These are private working maps (including solver-owned buffers). Public
    // exports/restores clone their positions; never mutate a borrowed snapshot.
    const positions = this.projectionView.positions as Record<string, Vec3>;
    positions[nodeId] = { ...position };
    if (this.viewState.positions !== positions) {
      (this.viewState.positions as Record<string, Vec3>)[nodeId] = { ...position };
    }
    this.viewState = { ...this.viewState };
    this.moduleHost.nodePositionChanged(nodeId, position, positions);
  }

  private handleRuntimeViewChange(change: GraphRuntimeViewChange): void {
    const draggedNodeId = change === 'positions' ? this.interaction.getDraggedNodeId() : undefined;
    this.projectionView = {
      ...this.projectionView,
      viewState: this.viewState,
      ...(change === 'positions' ? {
        positions: draggedNodeId ? this.projectionView.positions : this.viewState.positions,
      } : {}),
    };
    this.moduleView = { ...this.moduleView, viewState: this.viewState, positions: this.projectionView.positions };
    // Drag packets can arrive several times in one frame. Compose and publish only the final position.
    if (change === 'positions' && draggedNodeId) {
      this.pendingDragGeometry = true;
      this.scheduleFrame(0, 'geometry');
      return;
    }
    if (change === 'camera') {
      this.moduleHost.viewChanged(this.viewState);
      this.projection.markDirty();
      this.activeFrameInvalidations?.add('camera');
      return;
    }
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, change === 'positions' ? 'geometry' : 'presentation');
    if (change === 'positions') this.emitWorldChanged('interaction');
    if (change === 'interaction') this.updateSurface();
  }

  private synchronizeCameraState(): void {
    this.viewState = { ...this.viewState, camera: this.vision.getState() };
  }

  private resetCameraState(): void {
    this.vision.setState(defaultCamera(this.profile.dimensions, focalLengthMm(this.profile.profileSettings)));
    const document = this.store.readDocument();
    const policy = graphInteractionPolicyV1(this.viewState);
    const visibleSelectedNodeIds = this.viewState.selectedNodeIds
      .filter((id) => this.renderSelection.nodeIds.has(id));
    const candidates = policy.fitTarget === 'focused-neighborhood' && this.viewState.focusedNodeId
      ? this.focusNeighborhoodNodeIds(this.viewState.focusedNodeId)
      : policy.fitTarget === 'selection'
        ? visibleSelectedNodeIds
        : [...this.renderSelection.nodeIds];
    const positions = candidates
      .filter((id) => document.nodes.some((node) => node.id === id))
      .map((id) => this.moduleView.positions[id])
      .filter((position): position is Vec3 => position !== undefined);
    const center = policy.fitCenter === 'focused-node' && this.viewState.focusedNodeId
      ? this.moduleView.positions[this.viewState.focusedNodeId]
      : policy.fitTarget === 'selection' && visibleSelectedNodeIds.length === 1
        ? this.moduleView.positions[visibleSelectedNodeIds[0]]
        : undefined;
    this.vision.fit(positions,
      policy.fitTarget === 'focused-neighborhood' ? FOCUS_FIT_PADDING_PX : 48,
      center, 0,
      policy.fitTarget === 'focused-neighborhood' ? 'square' : 'viewport',
      positions.length === 1 ? SINGLE_NODE_FIT_MAX_PROJECTED_SCALE : undefined);
  }

  /** Explicit Focus fit uses the complete presentation field, including distant members. */
  private focusNeighborhoodNodeIds(focusedNodeId: string): readonly string[] {
    return [...new Set([
      ...this.viewState.selectedNodeIds.filter((id) => this.renderSelection.nodeIds.has(id)),
      ...[...this.consciousness.remembered.nodeIds].filter((id) => this.renderSelection.nodeIds.has(id)),
      ...immediateNeighborhoodFitNodeIdsV1(
        focusedNodeId, this.store.readDocument().edges,
        this.renderSelection.nodeIds, this.renderSelection.edgeIds,
      ),
    ])];
  }

  private fitPositions(
    positions: readonly Vec3[],
    center?: Vec3,
    minimumRadius?: number,
    squareFrame = false,
  ): void {
    if (!positions.length) return;
    this.vision.fit(
      positions,
      squareFrame ? FOCUS_FIT_PADDING_PX : 48,
      center,
      minimumRadius,
      squareFrame ? 'square' : 'viewport',
      positions.length === 1 ? SINGLE_NODE_FIT_MAX_PROJECTED_SCALE : undefined,
    );
    this.synchronizeCameraState();
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'camera');
  }

  private setSelectionState(nodeIds: readonly string[]): void {
    const selectedNodeIds = this.reconcileAttention(
      [...new Set(nodeIds)].filter((id) => this.renderSelection.nodeIds.has(id)),
    );
    const focusedNodeId = this.viewState.focusedNodeId === undefined || !selectedNodeIds.includes(this.viewState.focusedNodeId)
      ? undefined
      : this.viewState.focusedNodeId;
    const currentMode = resolveGraphUxStateV1(this.viewState);
    const viewMode = selectedNodeIds.length === 0
      ? currentMode === 'explore' && this.viewState.selectedNodeIds.length === 0 ? 'explore' : 'overview'
      : focusedNodeId === undefined && currentMode === 'focus'
      ? 'explore'
      : currentMode;
    if (sameIds(selectedNodeIds, this.viewState.selectedNodeIds)
      && focusedNodeId === this.viewState.focusedNodeId
      && this.viewState.viewMode === viewMode) return;
    const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.viewState;
    this.viewState = focusedNodeId === undefined
      ? { ...withoutFocus, selectedNodeIds, viewMode }
      : { ...withoutFocus, selectedNodeIds, focusedNodeId, viewMode };
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'presentation');
    this.updateSurface();
  }

  private reconcileAttention(nodeIds: readonly string[]): string[] {
    const topology = this.documentTopology();
    return [...this.consciousness.reconcile({
      attentionNodeIds: nodeIds,
      availableNodeIds: topology.nodeIds,
      relationships: topology.relationships('either'),
    }).attention.nodeIds];
  }

  private setFocusState(
    nodeId: string | undefined,
    requestedViewMode?: 'overview' | 'explore' | 'focus',
  ): void {
    if (nodeId !== undefined && !this.store.hasNode(nodeId)) return;
    const currentMode = resolveGraphUxStateV1(this.viewState);
    const viewMode = requestedViewMode ?? (nodeId !== undefined
      ? 'focus'
      : currentMode === 'focus'
        ? this.viewState.selectedNodeIds.length > 0 ? 'explore' : 'overview'
        : currentMode);
    if (this.viewState.focusedNodeId === nodeId && this.viewState.viewMode === viewMode) return;
    const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.viewState;
    const selectedNodeIds = viewMode === 'overview' && currentMode !== 'overview'
      && this.experience.attention.clearOnOverviewEntry
      ? this.reconcileAttention([]) : this.viewState.selectedNodeIds;
    this.viewState = nodeId === undefined
      ? { ...withoutFocus, selectedNodeIds, viewMode }
      : { ...withoutFocus, selectedNodeIds, focusedNodeId: nodeId, viewMode };
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'presentation');
    this.updateSurface();
  }

  private emitIntent(intent: GraphIntentV1): void {
    this.reactToIntent(intent);
    for (const listener of [...this.intentListeners]) {
      try {
        listener(cloneIntent(intent));
      } catch {
        // Consumer intent handlers are isolated from the runtime pipeline.
      }
    }
  }

  private reactToIntent(intent: GraphIntentV1): void {
    const registrations = this.reactions?.registrations() ?? [];
    for (const observation of this.consciousObservations(intent)) {
      for (const reaction of this.consciousness.observe(observation, registrations)) {
        const outcome = this.consciousness.ego.consider(
          this.consciousness.ego.intend(reaction),
        );
        if (outcome.status === 'rejected' || !this.nodeActions || !this.hasNode(outcome.directive.subjectId)) continue;
        this.nodeActions.invoke(
          outcome.directive.actionId,
          this.nodeActionContext(outcome.directive.subjectId),
          (failure) => this.handleNodeActionFailure(failure),
        );
      }
    }
  }

  private consciousObservations(intent: GraphIntentV1): readonly ConsciousObservationV1[] {
    if (intent.type === 'node-activated') {
      return [{ type: 'node-activated', subjectId: intent.nodeId, timestamp: intent.timestamp }];
    }
    if (intent.type === 'node-drag-ended') {
      return [{ type: 'node-drag-ended', subjectId: intent.nodeId, timestamp: intent.timestamp }];
    }
    if (intent.type === 'selection-changed') {
      const next = new Set(intent.selectedNodeIds);
      const added = intent.selectedNodeIds.filter((nodeId) => !this.observedSelectedNodeIds.has(nodeId));
      this.observedSelectedNodeIds = next;
      return added.map((subjectId) => ({ type: 'node-selected', subjectId, timestamp: intent.timestamp }));
    }
    if (intent.type === 'focus-changed') {
      const changed = intent.focusedNodeId !== undefined
        && intent.focusedNodeId !== this.observedFocusedNodeId;
      this.observedFocusedNodeId = intent.focusedNodeId;
      return changed
        ? [{ type: 'node-focused', subjectId: intent.focusedNodeId!, timestamp: intent.timestamp }]
        : [];
    }
    return [];
  }

  private synchronizeObservedConsciousState(): void {
    this.observedSelectedNodeIds = new Set(this.viewState.selectedNodeIds);
    this.observedFocusedNodeId = this.viewState.focusedNodeId;
  }

  private synchronizeModuleState(): void {
    const moduleState = this.moduleHost.exportState(this.viewState.moduleState);
    this.viewState = cloneGraphViewStateV1({
      ...this.viewState,
      moduleState: {
        ...moduleState,
        [CONSCIOUS_MEMORY_STATE_KEY_V1]: JSON.parse(JSON.stringify(
          this.consciousness.reactions.memory.snapshot(),
        )) as JsonValue,
      },
    });
  }

  private handleModuleFailure(failure: GraphModuleFailureV1): void {
    const required = failure.policy === 'required';
    if (!required && failure.hook === 'restore-state'
      && Object.prototype.hasOwnProperty.call(this.viewState.moduleState, failure.moduleId)) {
      const moduleState = { ...this.viewState.moduleState };
      delete moduleState[failure.moduleId];
      this.viewState = cloneGraphViewStateV1({ ...this.viewState, moduleState });
    }
    this.emitError({
      code: required ? 'required-module-failed' : 'module-failed',
      message: `Graph module "${failure.moduleId}" failed during ${failure.hook}: ${errorMessage(failure.error)}`,
      moduleId: failure.moduleId,
      recoverable: !required,
    });
    if (!required || this.fatalModuleError) return;
    this.fatalModuleError = new GraphRequiredModuleErrorV1(failure.moduleId, failure.hook, failure.error);
    this.clearScheduledFrame();
    this.lastFrameTimestamp = null;
    this.interaction?.setEnabled(false);
  }

  private invokePrimaryNodeAction(nodeId: string): boolean {
    const actionIds = this.profile.interaction?.activationActionIds ?? [];
    if (!this.nodeActions || actionIds.length === 0) return false;
    const context = this.nodeActionContext(nodeId);
    return this.nodeActions.invokeFirst(
      actionIds,
      context,
      (failure) => this.handleNodeActionFailure(failure),
    );
  }

  private nodeActionContext(nodeId: string): GraphNodeActionContextV1 {
    const document = this.store.readDocument();
    return {
      consumerId: this.consumerId,
      profileId: this.profileId,
      session: this,
      documentId: document.documentId,
      documentRevision: document.revision,
      nodeId,
      selectedNodeIds: [...this.viewState.selectedNodeIds],
      ...(this.viewState.focusedNodeId ? { focusedNodeId: this.viewState.focusedNodeId } : {}),
    };
  }

  private hasNode(nodeId: string): boolean {
    return this.store.hasNode(nodeId);
  }

  private resolveNodeSelection(nodeId: string): readonly string[] {
    const document = this.store.readDocument();
    const presentation = this.presentationTopology(document);
    const group = this.consciousness.resolveOverviewConstellation(
      nodeId, this.renderSelection.nodeIds,
      presentation.topology.relationships('either'),
      String(presentation.revision),
    );
    return group?.nodeIds ?? [];
  }

  private documentTopology(document = this.store.readDocument()): GraphTopologyIndex {
    if (this.documentTopologyCache?.document === document) return this.documentTopologyCache.topology;
    const topology = new GraphTopologyIndex(document);
    this.documentTopologyCache = { document, topology };
    return topology;
  }

  private presentationTopology(document = this.store.readDocument()): NonNullable<GraphSessionRuntime['presentationTopologyCache']> {
    const cached = this.presentationTopologyCache;
    if (cached?.document === document && cached.nodeIds === this.renderSelection.nodeIds
      && cached.edgeIds === this.renderSelection.edgeIds) return cached;
    const next = {
      document,
      nodeIds: this.renderSelection.nodeIds,
      edgeIds: this.renderSelection.edgeIds,
      topology: new GraphTopologyIndex(document, this.renderSelection),
      revision: ++this.topologyRevision,
    };
    this.presentationTopologyCache = next;
    return next;
  }

  private handleNodeActionFailure(failure: GraphNodeActionFailureV1): void {
    this.emitError({
      code: 'consumer-action-failed',
      actionId: failure.actionId,
      message: `Consumer action "${failure.actionId}" failed during ${failure.phase}: ${errorMessage(failure.error)}`,
      recoverable: true,
    });
  }

  private synchronizeRuntimeActivity(): void {
    const suspended = this.isSuspended();
    this.interaction.setEnabled(!suspended);
    this.moduleHost.setSuspended(suspended);
    if (suspended) {
      this.projection.resetPreviewAnimation();
      this.refreshFrame(false, 'presentation');
      this.lastFrameTimestamp = null;
      this.clearScheduledFrame();
      return;
    }
    this.scheduleFrame(0, 'presentation');
  }

  private scheduleFrame(
    delayMs = 0,
    invalidation: SessionInvalidationClass = 'presentation',
  ): void {
    if (this.activeFrameInvalidations !== null) {
      this.activeFrameInvalidations.add(invalidation);
      return;
    }
    this.scheduler.schedule(invalidation, delayMs);
  }

  private clearScheduledFrame(): void {
    this.scheduler.clear();
  }

  private isSuspended(): boolean {
    return this.activity.isSuspended(this.fatalModuleError !== null);
  }

  private requireActive(): void {
    if (this.activity.isDisposed()) throw new GraphSessionDisposedErrorV1();
    if (this.fatalModuleError) throw this.fatalModuleError;
  }

  private assertPlatformOwnership(): void {
    if (this.container.ownerDocument !== this.platform.document || this.platform.document.defaultView !== this.platform.window) {
      throw new Error('Session platform must come from the container\'s owning document and window.');
    }
  }

  private subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Disposable {
    this.requireActive();
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  private emitGraphChanged(event: GraphChangedEventV1): void {
    for (const listener of [...this.graphChangedListeners]) {
      try {
        listener(cloneGraphChangedEvent(event));
      } catch {
        // Consumer callbacks cannot make an already-applied graph operation fail.
      }
    }
  }

  private emitWorldChanged(cause: GraphWorldChangedEventV1['cause']): void {
    if (!this.worldChangedListeners.size) return;
    const document = this.store.readDocument();
    const state: GraphWorldStateV1 = {
      schemaVersion: 1,
      documentId: document.documentId,
      documentRevision: document.revision,
      dimensions: this.profile.dimensions,
      positions: clonePositions(this.viewState.positions),
      pinnedNodeIds: [...this.viewState.pinnedNodeIds],
      layoutModuleState: this.moduleHost.exportCapabilityState('layout'),
    };
    for (const listener of [...this.worldChangedListeners]) {
      try { listener({ sessionId: this.sessionId, cause, state }); } catch {}
    }
  }

  private emitError(error: GraphSessionErrorV1): void {
    if (!this.errorListeners.size) {
      this.deferredErrors.push({ ...error });
      return;
    }
    for (const listener of [...this.errorListeners]) {
      try {
        listener({ ...error });
      } catch {
        // Error listeners are isolated from the session and from one another.
      }
    }
  }

  private emitSessionOverridesChanged(): void {
    const overrides = cloneOverrides(this.sessionOverrides);
    for (const listener of [...this.overrideListeners]) {
      try { listener(cloneOverrides(overrides)); } catch {}
    }
  }
}

function renderQuality(profile: EffectiveConsumerProfileV1): 'automatic' | 'high-fidelity' | 'energy-saver' {
  const value = profile.modules[SHIPPED_GRAPH_MODULE_IDS_V1.rendering]?.settings.renderQuality;
  return value === 'high-fidelity' || value === 'energy-saver' ? value : 'automatic';
}

function renderPixelRatioLimit(profile: EffectiveConsumerProfileV1, nodeCount: number): number | undefined {
  const quality = renderQuality(profile);
  if (quality === 'high-fidelity') return undefined;
  if (quality === 'energy-saver' || nodeCount >= LARGE_GRAPH_NODE_COUNT) return EFFICIENT_PIXEL_RATIO_LIMIT;
  return undefined;
}

function duration(start: number, end: number): number {
  return Math.max(0, end - start);
}

function allOf(document: GraphDocumentV1): GraphFilterSelectionV1 {
  return {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
}

function defaultCamera(dimensions: '2d' | '3d', focalLength: number): GraphCameraStateV1 {
  return {
    position: dimensions === '2d' ? { x: 0, y: 0, z: 10 } : { x: 0, y: 0, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: dimensions === '2d' ? 1 : focalLength / 24,
    projection: dimensions === '2d' ? 'orthographic' : 'perspective',
  };
}

function focalLengthMm(settings: Readonly<Record<string, import('../contracts/v1/index.ts').JsonValue>>): number {
  const value = settings.focalLengthMm;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 50;
}

function usesGeneratedInitialPositions(settings: Readonly<Record<string, JsonValue>>): boolean {
  return settings.initialPositionStrategy === 'generated';
}

function hasPlausibleRestoredPositions(state: GraphViewStateV1): boolean {
  return Object.values(state.positions).every((position) =>
    Math.abs(position.x) <= MAX_RESTORED_POSITION_COORDINATE
    && Math.abs(position.y) <= MAX_RESTORED_POSITION_COORDINATE
    && Math.abs(position.z) <= MAX_RESTORED_POSITION_COORDINATE);
}

function withoutRetiredGraphSystemState(state: GraphViewStateV1): GraphViewStateV1 {
  if (state.moduleState[RETIRED_GRAPH_SYSTEM_STATE_KEY_V1] === undefined) return state;
  const moduleState = { ...state.moduleState };
  delete moduleState[RETIRED_GRAPH_SYSTEM_STATE_KEY_V1];
  return { ...state, moduleState };
}

function normalizePerspectiveViewState(
  state: GraphViewStateV1,
  dimensions: '2d' | '3d',
  focalLength: number,
): GraphViewStateV1 {
  if (dimensions !== '3d' || state.camera.projection !== 'perspective') return state;
  const nextZoom = focalLength / 24;
  const previousZoom = Math.max(0.02, state.camera.zoom);
  const offset = subtractVec(state.camera.position, state.camera.target);
  return cloneGraphViewStateV1({
    ...state,
    camera: {
      ...state.camera,
      position: addVec(state.camera.target, scaleVec(offset, nextZoom / previousZoom)),
      zoom: nextZoom,
    },
  });
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function cloneFilter(filter: GraphFilterRequestV1): GraphFilterRequestV1 {
  return JSON.parse(JSON.stringify(filter)) as GraphFilterRequestV1;
}

function clonePatch(patch: GraphPatchV1): GraphPatchV1 {
  return JSON.parse(JSON.stringify(patch)) as GraphPatchV1;
}

function cloneGraphChangedEvent(event: GraphChangedEventV1): GraphChangedEventV1 {
  return {
    ...event,
    ...(event.patch === undefined ? {} : { patch: clonePatch(event.patch) }),
  };
}

function addMissingPositions(
  state: GraphViewStateV1,
  document: GraphDocumentV1,
  dimensions: '2d' | '3d',
  nativePlacement = false,
): GraphViewStateV1 {
  const additions = document.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => state.positions[node.id] === undefined);
  if (!additions.length) return state;
  const additionsById = new Set(additions.map(({ node }) => node.id));
  const positions = { ...state.positions };
  const adjacency = new Map<string, string[]>();
  for (const edge of document.edges) {
    const source = adjacency.get(edge.sourceId) ?? [];
    source.push(edge.targetId); adjacency.set(edge.sourceId, source);
    const target = adjacency.get(edge.targetId) ?? [];
    target.push(edge.sourceId); adjacency.set(edge.targetId, target);
  }
  const cloudRadius = Math.max(120, ...Object.values(positions).map((position) => Math.hypot(position.x, position.y, position.z))) + 120;
  for (const { node, index } of additions) {
    if (!nativePlacement) {
      positions[node.id] = node.positionHint ? { ...node.positionHint } : defaultNodePosition(index, dimensions);
      continue;
    }
    const neighbors = (adjacency.get(node.id) ?? [])
      .filter((id) => !additionsById.has(id) || positions[id] !== undefined)
      .map((id) => positions[id])
      .filter((position): position is Vec3 => position !== undefined);
    const jitter = deterministicPlacementDirection(node.id, dimensions);
    if (neighbors.length) {
      positions[node.id] = {
        x: neighbors.reduce((sum, value) => sum + value.x, 0) / neighbors.length + jitter.x * 24,
        y: neighbors.reduce((sum, value) => sum + value.y, 0) / neighbors.length + jitter.y * 24,
        z: dimensions === '2d' ? 0 : neighbors.reduce((sum, value) => sum + value.z, 0) / neighbors.length + jitter.z * 24,
      };
    } else {
      positions[node.id] = {
        x: jitter.x * cloudRadius,
        y: jitter.y * cloudRadius,
        z: dimensions === '2d' ? 0 : jitter.z * cloudRadius,
      };
    }
    additionsById.delete(node.id);
  }
  return cloneGraphViewStateV1({
    ...state,
    positions,
  });
}

function deterministicPlacementDirection(id: string, dimensions: '2d' | '3d'): Vec3 {
  let hash = 2166136261;
  for (const character of id) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const angle = (hash >>> 0) / 0xffffffff * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle), z: dimensions === '3d' ? Math.sin(angle * 0.73) * 0.6 : 0 };
}

function defaultNodePosition(index: number, dimensions: '2d' | '3d'): Vec3 {
  if (index === 0) return { x: 0, y: 0, z: 0 };
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = 42 * Math.sqrt(index);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: dimensions === '3d' ? ((index * 47) % 101) - 50 : 0,
  };
}

function withAttention(state: GraphViewStateV1, selectedNodeIds: readonly string[]): GraphViewStateV1 {
  if (selectedNodeIds.length > 0) return { ...state, selectedNodeIds: [...selectedNodeIds] };
  const { focusedNodeId: _focusedNodeId, ...withoutFocus } = state;
  return { ...withoutFocus, selectedNodeIds: [] };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function clonePositions(positions: Readonly<Record<string, Vec3>>): Readonly<Record<string, Vec3>> {
  return Object.fromEntries(Object.entries(positions).map(([nodeId, position]) => [nodeId, { ...position }]));
}

function samePositions(
  left: Readonly<Record<string, Vec3>>,
  right: Readonly<Record<string, Vec3>>,
): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length && leftIds.every((nodeId) => {
    const a = left[nodeId];
    const b = right[nodeId];
    return b !== undefined && a.x === b.x && a.y === b.y && a.z === b.z;
  });
}

function cloneIntent(intent: GraphIntentV1): GraphIntentV1 {
  return JSON.parse(JSON.stringify(intent)) as GraphIntentV1;
}

function readMemorySnapshot(value: JsonValue | undefined): MemorySnapshotV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, JsonValue>;
  if (candidate.schemaVersion !== 1 || !Number.isSafeInteger(candidate.observationCount)
    || !Array.isArray(candidate.buckets)) return undefined;
  return candidate as unknown as MemorySnapshotV1;
}

function assertTransition(options?: TransitionOptionsV1): void {
  if (options?.signal?.aborted) throw abortError();
  if (options?.durationMs !== undefined && (!Number.isFinite(options.durationMs) || options.durationMs < 0)) {
    throw new Error('Transition duration must be a non-negative finite number.');
  }
}

function abortError(): Error {
  const error = new Error('The graph transition was aborted.');
  error.name = 'AbortError';
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneOverrides(value: GraphSettingsOverridesV1): GraphSettingsOverridesV1 {
  return JSON.parse(JSON.stringify(value)) as GraphSettingsOverridesV1;
}

function cloneJsonRecord(value: Readonly<Record<string, import('../contracts/v1/index.ts').JsonValue>>): Readonly<Record<string, import('../contracts/v1/index.ts').JsonValue>> {
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, import('../contracts/v1/index.ts').JsonValue>>;
}
