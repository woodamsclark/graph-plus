import type {
  ApplyGraphPatchResultV1,
  Disposable,
  FitNodesOptionsV1,
  GraphCameraStateV1,
  GraphChangedEventV1,
  GraphDocumentV1,
  GraphEffectiveSettingsV1,
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
  TransitionOptionsV1,
  Vec3,
} from '../contracts/v1/index.ts';
import { GraphDocumentStore } from '../core/document/index.ts';
import { evaluateGraphFilterV1, type GraphFilterSelectionV1 } from '../core/filter/index.ts';
import { GraphNodeRegionIndexV1 } from '../core/regions/index.ts';
import type { EffectiveConsumerProfileV1 } from '../core/profile/index.ts';
import {
  cloneGraphViewStateV1,
  convertGraphViewStateDimensionsV1,
  reconcileGraphViewStateV1,
} from '../core/state/index.ts';
import { GraphCameraController } from './camera/index.ts';
import { SessionInteractionRuntime, type GraphRuntimeViewChangeV1 } from './interaction/index.ts';
import {
  GraphModuleHost,
  GraphRequiredModuleErrorV1,
  SHIPPED_GRAPH_MODULE_IDS_V1,
  type GraphModuleFailureV1,
  type GraphModulePipelineStateV1,
  type GraphModuleRegistry,
} from './modules/index.ts';
import type { SessionRuntimePlatformV1 } from './platform/index.ts';
import {
  CanvasGraphRenderer,
  type GraphRenderThemeV1,
} from './render/index.ts';
import { CanvasSessionSurface, type SessionSurfaceV1 } from './surface/index.ts';
import type {
  GraphNodeActionFailureV1,
  GraphNodeActionRuntimeV1,
} from './actions/index.ts';
import type { GraphSessionControlPortV1 } from './host/index.ts';
import {
  SessionActivityControllerV1,
  SessionDiagnosticsV1,
  SessionFrameSchedulerV1,
  SessionProjectionCoordinatorV1,
  type SessionInvalidationClassV1,
} from './session/index.ts';

export interface GraphSessionRuntimeOptionsV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  readonly profile: EffectiveConsumerProfileV1;
  readonly initialSessionOverrides?: GraphSettingsOverridesV1;
  readonly resolveProfile: (overrides: GraphSettingsOverridesV1) => EffectiveConsumerProfileV1;
  readonly onDisposed?: () => void;
  readonly modules: GraphModuleRegistry;
  readonly themePalette: GraphRenderThemeV1;
  readonly resolveThemePalette?: () => GraphRenderThemeV1;
  readonly restoreViewState?: GraphViewStateV1;
  readonly platform: SessionRuntimePlatformV1;
  readonly nodeActions?: GraphNodeActionRuntimeV1;
}

const RETIRED_GRAPH_SYSTEM_STATE_KEY_V1 = 'graph-system-states-v1';
const MAX_RESTORED_POSITION_COORDINATE = 1_000_000_000;
const MIN_PIPELINE_INTERVAL_MS = 1_000 / 60;
const LARGE_GRAPH_NODE_COUNT = 500;
const EFFICIENT_PIXEL_RATIO_LIMIT = 2;

export interface GraphSessionRuntimeDiagnosticsV1 {
  readonly sessionId: string;
  readonly consumerId: string;
  readonly profileId: string;
  readonly dimensions: '2d' | '3d';
  readonly documentId: string;
  readonly documentRevision: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly manuallySuspended: boolean;
  readonly documentSuspended: boolean;
  readonly suspended: boolean;
  readonly frameScheduled: boolean;
  readonly animationFrameScheduled: boolean;
  readonly wakeTimerScheduled: boolean;
  readonly pendingInvalidations: readonly SessionInvalidationClassV1[];
  readonly lastFrameInvalidations: readonly SessionInvalidationClassV1[];
  readonly invalidationCounts: Readonly<Record<SessionInvalidationClassV1, number>>;
  readonly renderCaches: Readonly<Record<string, number>>;
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
  private readonly themePalette: GraphRenderThemeV1;
  private readonly resolveThemePalette?: () => GraphRenderThemeV1;
  private readonly nodeActions?: GraphNodeActionRuntimeV1;
  private readonly modules: GraphModuleRegistry;
  private surface!: SessionSurfaceV1;
  private camera!: GraphCameraController;
  private projection!: SessionProjectionCoordinatorV1;
  private renderer!: CanvasGraphRenderer;
  private interaction!: SessionInteractionRuntime;
  private moduleHost!: GraphModuleHost;
  private projectionView!: GraphModulePipelineStateV1;
  private moduleView!: GraphModulePipelineStateV1;
  private surfaceResizeSubscription: Disposable | null = null;
  private store: GraphDocumentStore;
  private viewState: GraphViewStateV1;
  private projectionSelection: GraphFilterSelectionV1;
  private renderSelection: GraphFilterSelectionV1;
  private readonly intentListeners = new Set<(intent: GraphIntentV1) => void>();
  private readonly graphChangedListeners = new Set<(event: GraphChangedEventV1) => void>();
  private readonly errorListeners = new Set<(error: GraphSessionErrorV1) => void>();
  private readonly overrideListeners = new Set<(overrides: GraphSettingsOverridesV1) => void>();
  private scheduler!: SessionFrameSchedulerV1;
  private readonly activity = new SessionActivityControllerV1();
  private readonly diagnostics = new SessionDiagnosticsV1();
  private activeFrameInvalidations: Set<SessionInvalidationClassV1> | null = null;
  private lastFrameTimestamp: number | null = null;
  private fatalModuleError: GraphRequiredModuleErrorV1 | null = null;
  private readonly deferredErrors: GraphSessionErrorV1[] = [];

  private readonly onVisibilityChange = (): void => {
    this.activity.setDocumentSuspension(this.platform.document.hidden);
    this.synchronizeRuntimeActivity();
  };

  private readonly onAnimationFrame: FrameRequestCallback = (timestamp) => {
    if (this.isSuspended()) return;
    if (this.lastFrameTimestamp !== null
      && timestamp - this.lastFrameTimestamp < MIN_PIPELINE_INTERVAL_MS - 0.001) {
      this.scheduleFrame(MIN_PIPELINE_INTERVAL_MS - (timestamp - this.lastFrameTimestamp));
      return;
    }
    this.activeFrameInvalidations = new Set(this.scheduler.beginFrame());
    const frameStart = this.platform.now();
    const interactionStart = this.platform.now();
    this.interaction.tick();
    const interactionMs = duration(interactionStart, this.platform.now());
    const hitTestMs = this.interaction.consumeHitTestDuration();
    this.diagnostics.counters.hitTests += this.interaction.consumeHitTestCount();
    const deltaSeconds = this.lastFrameTimestamp === null ? 1 / 60 : Math.max(0, (timestamp - this.lastFrameTimestamp) / 1000);
    this.lastFrameTimestamp = timestamp;
    const focusedNodeId = this.viewState.focusedNodeId;
    const focusedPosition = focusedNodeId ? this.moduleView.positions[focusedNodeId] : undefined;
    const previousFocusedPosition = focusedPosition ? { ...focusedPosition } : undefined;
    const moduleStart = this.platform.now();
    this.diagnostics.counters.moduleTicks += 1;
    const tickResult = this.moduleHost.tick({
      ...this.moduleView,
      draggedNodeId: this.interaction.getDraggedNodeId(),
      hoveredNodeId: this.interaction.getHoveredNodeId(),
      previewedNodeId: this.interaction.getPreviewedNodeId(),
    }, deltaSeconds);
    const positions = tickResult?.positions;
    const moduleTickMs = duration(moduleStart, this.platform.now());
    const compositionStart = this.platform.now();
    if (positions) {
      const nextFocusedPosition = focusedNodeId ? positions[focusedNodeId] : undefined;
      const requiresComposition = positions !== this.moduleView.positions;
      this.viewState = { ...this.viewState, positions };
      if (!tickResult?.camera && previousFocusedPosition && nextFocusedPosition) {
        const camera = this.camera.getState();
        this.camera.setTarget({
          x: camera.target.x + nextFocusedPosition.x - previousFocusedPosition.x,
          y: camera.target.y + nextFocusedPosition.y - previousFocusedPosition.y,
          z: camera.target.z + nextFocusedPosition.z - previousFocusedPosition.z,
        });
        this.synchronizeCameraState();
      }
      this.projectionView = { ...this.projectionView, positions, viewState: this.viewState };
      this.moduleView = { ...this.moduleView, positions, viewState: this.viewState };
      if (requiresComposition) this.refreshFrame(false, 'geometry');
      else {
        this.projection.markGeometryDirty();
        this.activeFrameInvalidations.add('geometry');
      }
    }
    if (tickResult?.camera) {
      this.camera.setState(tickResult.camera);
      this.synchronizeCameraState();
      this.projectionView = { ...this.projectionView, viewState: this.viewState };
      this.moduleView = { ...this.moduleView, viewState: this.viewState };
      this.projection.markDirty();
      this.activeFrameInvalidations.add('camera');
    }
    const compositionMs = duration(compositionStart, this.platform.now());
    if (this.isSuspended()) {
      this.activeFrameInvalidations = null;
      return;
    }
    const render = this.projection.render(this.renderer);
    if (render) {
      const latestFramePerformance = {
        interactionMs,
        hitTestMs,
        moduleTickMs,
        compositionMs,
        ...render,
        totalMs: duration(frameStart, this.platform.now()),
      };
      const frameCount = this.diagnostics.recordFrame(latestFramePerformance, [...this.activeFrameInvalidations]);
      this.surface.recordFrame(frameCount);
    }
    this.activeFrameInvalidations = null;
    if (tickResult?.requestNextFrame) this.scheduleFrame(tickResult.nextFrameDelayMs, 'geometry');
  };

  constructor(options: GraphSessionRuntimeOptionsV1) {
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
    this.themePalette = options.themePalette;
    this.resolveThemePalette = options.resolveThemePalette;
    this.nodeActions = options.nodeActions;
    this.modules = options.modules;
    this.scheduler = new SessionFrameSchedulerV1(
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
    this.viewState = normalizePerspectiveViewState(restoredViewState
      ? addMissingPositions(
          reconcileGraphViewStateV1(restoredViewState, this.restoreContext()),
          this.store.readDocument(),
          this.profile.dimensions,
          usesGeneratedInitialPositions(this.profile.profileSettings),
        )
      : this.createInitialViewState(), this.profile.dimensions, focalLengthMm(this.profile.profileSettings));
    this.projectionSelection = allOf(this.store.readDocument());
    this.renderSelection = allOf(this.store.readDocument());

    let visibilityListenerInstalled = false;
    try {
      this.camera = new GraphCameraController(this.viewState.camera, this.profile.dimensions);
      this.surface = new CanvasSessionSurface({
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        container: this.container,
        platform: this.platform,
        pixelRatioLimit: renderPixelRatioLimit(this.profile, this.store.readDocument().nodes.length),
      });
      this.projection = new SessionProjectionCoordinatorV1(
        () => { this.diagnostics.counters.projectionPasses += 1; },
        () => { this.diagnostics.counters.frameCompositions += 1; },
      );
      this.renderer = new CanvasGraphRenderer(this.surface.canvas, this.camera, this.projection.frames, () => this.platform.now());
      const viewport = this.surface.getViewport();
      this.camera.setViewport(viewport.width, viewport.height);
      this.renderer.resize(viewport.width, viewport.height, viewport.devicePixelRatio);
      this.surfaceResizeSubscription = this.surface.onResize((next) => {
        this.camera.setViewport(next.width, next.height);
        this.renderer.resize(next.width, next.height, next.devicePixelRatio);
        this.projection.markDirty();
        this.scheduleFrame(0, 'camera');
      });
      this.moduleHost = this.createModuleHost(this.profile, this.viewState.moduleState);
      this.interaction = new SessionInteractionRuntime({
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        platform: this.platform,
        surface: this.surface,
        camera: this.camera,
        hitTest: (point, pointerKind) => this.renderer.hitTest(point, pointerKind),
        getDocument: () => this.store.readDocument(),
        getViewState: () => this.viewState,
        getInteractivePositions: () => this.moduleView?.positions ?? this.viewState.positions,
        getNodeSelection: (nodeId) => this.resolveNodeSelection(nodeId),
        isNodeDraggable: () => !this.moduleView?.formActive,
        setViewState: (state) => { this.viewState = state; },
        getRenderSelection: () => this.renderSelection,
        getResetCamera: () => defaultCamera(this.profile.dimensions, focalLengthMm(this.profile.profileSettings)),
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
      if (!restoredViewState) this.fitPositions(Object.values(this.moduleView.positions));
      this.refreshFrame();
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
      this.surface?.dispose();
      this.activity.dispose();
      throw error;
    }
  }

  async replaceDocument(document: GraphDocumentV1): Promise<void> {
    this.requireActive();
    const previous = this.store.readDocument();
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
        : this.createInitialViewState();
      this.camera.setState(this.viewState.camera);
      this.moduleHost.documentChanged(next);
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView();
      if (previous.documentId !== next.documentId) this.fitPositions(Object.values(this.moduleView.positions));
      this.emitGraphChanged({
        sessionId: this.sessionId,
        documentId: next.documentId,
        previousRevision: previous.revision,
        revision: next.revision,
        cause: 'replace-document',
      });
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

  async setSelection(nodeIds: readonly string[]): Promise<void> {
    this.requireActive();
    this.setSelectionState(nodeIds);
  }

  async focusNode(nodeId: string | null): Promise<void> {
    this.requireActive();
    if (nodeId !== null && !this.store.hasNode(nodeId)) {
      throw new Error(`Cannot focus unknown node "${nodeId}".`);
    }
    this.interaction.clearPreview();
    this.setFocusState(nodeId ?? undefined);
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
    this.fitPositions(positions, center, minimumRadius);
  }

  async resetCamera(options?: TransitionOptionsV1): Promise<void> {
    this.requireActive();
    assertTransition(options);
    this.camera.setState(defaultCamera(this.profile.dimensions, focalLengthMm(this.profile.profileSettings)));
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
      ...(this.viewState.focusedNodeId ? { focusedNodeId: this.viewState.focusedNodeId } : {}),
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
      this.camera.setState(this.viewState.camera);
      this.moduleHost.restoreState(this.viewState.moduleState);
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView();
    } catch (error) {
      this.emitError({
        code: 'incompatible-view-state',
        message: errorMessage(error),
        recoverable: true,
      });
      throw error;
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
      getSessionOverrides: () => cloneOverrides(this.sessionOverrides),
      onSessionOverridesChanged: (listener) => {
        this.overrideListeners.add(listener);
        return { dispose: () => this.overrideListeners.delete(listener) };
      },
      setModuleEnabled: (moduleId, enabled) => this.patchModuleOverride(moduleId, { enabled }),
      setModuleSetting: (moduleId, key, value) => this.patchModuleSetting(moduleId, key, value),
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
    const next = this.resolveThemePalette?.();
    if (!next) return;
    Object.assign(this.themePalette as unknown as Record<string, unknown>, next);
    this.moduleHost.updateProfile(this.profile);
    this.recomputeView(false);
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
    this.moduleHost.updateProfile(next);
    this.camera.setPerspectiveZoom(focalLengthMm(next.profileSettings) / 24);
    this.synchronizeCameraState();
    this.profile = next;
    this.refreshRenderQuality();
    this.recomputeView(false);
  }

  private reconfigureDimensions(next: EffectiveConsumerProfileV1): void {
    const previousProfile = this.profile;
    this.synchronizeModuleState();
    const previousViewState = cloneGraphViewStateV1(this.viewState);
    const previousCamera = this.camera.getState();
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
      this.camera.reconfigure(converted.camera, next.dimensions);
      this.interaction.setDimensions(next.dimensions);
      this.surface.setDimensions(next.dimensions);
      this.moduleHost = replacementHost;
      committed = true;
      this.moduleHost.viewChanged(this.viewState);
      this.recomputeView(false);
      if (this.moduleView.formActive) this.fitPositions(Object.values(this.moduleView.positions));
      else this.refreshFrame();
      previousHost.dispose();
      for (const failure of deferredFailures) this.handleModuleFailure(failure);
    } catch (error) {
      this.moduleHost = previousHost;
      this.profile = previousProfile;
      this.refreshRenderQuality();
      this.viewState = previousViewState;
      this.camera.reconfigure(previousCamera, previousProfile.dimensions);
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

  getDiagnostics(): GraphSessionRuntimeDiagnosticsV1 {
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
      renderCaches: this.renderer.getDiagnostics(),
      renderQuality: renderQuality(this.profile),
      nativePixelRatio: this.platform.devicePixelRatio,
      effectivePixelRatio: this.surface.getViewport().devicePixelRatio,
      frameCount: diagnostics.frameCount,
      lastFrameTimestamp: this.lastFrameTimestamp,
      counters: diagnostics.counters,
      modules: this.moduleHost.getDiagnostics(),
    };
  }

  onIntent(listener: (intent: GraphIntentV1) => void): Disposable {
    return this.subscribe(this.intentListeners, listener);
  }

  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable {
    return this.subscribe(this.graphChangedListeners, listener);
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
    this.graphChangedListeners.clear();
    this.errorListeners.clear();
    this.overrideListeners.clear();
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
      activeFilters: {},
      moduleState: {},
    };
  }

  private recomputeView(resetInteraction = true): void {
    if (resetInteraction) this.interaction.reset();
    const document = this.store.readDocument();
    this.projectionView = this.projection.project(this.moduleHost, {
      sourceDocument: document,
      document,
      viewState: this.viewState,
      positions: this.viewState.positions,
      projectionSelection: allOf(document),
      renderSelection: allOf(document),
      formActive: false,
      hoveredNodeId: this.interaction?.getHoveredNodeId(),
      previewedNodeId: this.interaction?.getPreviewedNodeId(),
      nodeContributions: {},
      edgeContributions: {},
      regionLayouts: [],
      regionContributions: [],
      theme: this.themePalette,
      motionTargets: {},
    });
    this.moduleView = this.projectionView;
    if (this.moduleView.commitPositions) {
      this.viewState = cloneGraphViewStateV1({
        ...this.viewState,
        positions: this.moduleView.positions,
      });
      this.moduleView = {
        ...this.moduleView,
        positions: this.viewState.positions,
        viewState: this.viewState,
        commitPositions: false,
      };
      this.projectionView = this.moduleView;
      this.moduleHost.viewChanged(this.viewState);
    }
    this.projectionSelection = this.moduleView.projectionSelection;
    this.renderSelection = this.moduleView.renderSelection;
    this.refreshFrame(true, 'content');
    this.updateSurface();
  }

  private refreshFrame(
    schedule = true,
    invalidation: SessionInvalidationClassV1 = 'presentation',
  ): void {
    this.activeFrameInvalidations?.add(invalidation);
    this.moduleView = this.projection.compose({
      host: this.moduleHost,
      projectionView: this.projectionView,
      viewState: this.viewState,
      selection: this.renderSelection,
      draggedNodeId: this.interaction?.getDraggedNodeId(),
      hoveredNodeId: this.interaction?.getHoveredNodeId(),
      previewedNodeId: this.interaction?.getPreviewedNodeId(),
      invalidation,
    });
    if (schedule) this.scheduleFrame(0, invalidation);
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

  private handleRuntimeViewChange(change: GraphRuntimeViewChangeV1): void {
    const draggedNodeId = change === 'positions' ? this.interaction.getDraggedNodeId() : undefined;
    const draggedPosition = draggedNodeId ? this.viewState.positions[draggedNodeId] : undefined;
    this.projectionView = {
      ...this.projectionView,
      viewState: this.viewState,
      ...(change === 'positions' ? {
        positions: draggedNodeId && draggedPosition
          ? { ...this.projectionView.positions, [draggedNodeId]: draggedPosition }
          : this.viewState.positions,
      } : {}),
    };
    this.moduleView = { ...this.moduleView, viewState: this.viewState, positions: this.projectionView.positions };
    if (change === 'camera') {
      this.moduleHost.viewChanged(this.viewState);
      this.projection.markDirty();
      this.activeFrameInvalidations?.add('camera');
      return;
    }
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, change === 'positions' ? 'geometry' : 'presentation');
    if (change === 'interaction') this.updateSurface();
  }

  private synchronizeCameraState(): void {
    this.viewState = { ...this.viewState, camera: this.camera.getState() };
  }

  private fitPositions(positions: readonly Vec3[], center?: Vec3, minimumRadius?: number): void {
    if (!positions.length) return;
    this.camera.fit(positions, 48, undefined, center, minimumRadius);
    this.synchronizeCameraState();
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'camera');
  }

  private setSelectionState(nodeIds: readonly string[]): void {
    const selectedNodeIds = [...new Set(nodeIds)].filter((id) => this.store.hasNode(id));
    if (sameIds(selectedNodeIds, this.viewState.selectedNodeIds)) return;
    this.viewState = { ...this.viewState, selectedNodeIds };
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'presentation');
    this.updateSurface();
  }

  private setFocusState(nodeId: string | undefined): void {
    if (nodeId !== undefined && !this.store.hasNode(nodeId)) return;
    if (this.viewState.focusedNodeId === nodeId) return;
    const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.viewState;
    this.viewState = nodeId === undefined ? withoutFocus : { ...withoutFocus, focusedNodeId: nodeId };
    if (nodeId) {
      const position = this.moduleView.positions[nodeId];
      if (position) {
        this.camera.setTarget(position);
        this.synchronizeCameraState();
      }
    }
    this.projectionView = { ...this.projectionView, viewState: this.viewState };
    this.moduleView = { ...this.moduleView, viewState: this.viewState };
    this.moduleHost.viewChanged(this.viewState);
    this.refreshFrame(true, 'presentation');
    if (nodeId) this.scheduleFrame(0, 'camera');
    this.updateSurface();
  }

  private emitIntent(intent: GraphIntentV1): void {
    for (const listener of [...this.intentListeners]) {
      try {
        listener(cloneIntent(intent));
      } catch {
        // Consumer intent handlers are isolated from the runtime pipeline.
      }
    }
  }

  private synchronizeModuleState(): void {
    this.viewState = cloneGraphViewStateV1({
      ...this.viewState,
      moduleState: this.moduleHost.exportState(this.viewState.moduleState),
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
    const regions = new GraphNodeRegionIndexV1(this.store.readDocument());
    if (!regions.isRegionNode(nodeId)) return [nodeId];
    const visibleMembers = regions.recursiveMembers(nodeId, this.renderSelection.nodeIds);
    return visibleMembers.length ? visibleMembers : [nodeId];
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
      this.lastFrameTimestamp = null;
      this.clearScheduledFrame();
      return;
    }
    this.scheduleFrame(0, 'presentation');
  }

  private scheduleFrame(
    delayMs = 0,
    invalidation: SessionInvalidationClassV1 = 'presentation',
  ): void {
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

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function cloneIntent(intent: GraphIntentV1): GraphIntentV1 {
  return JSON.parse(JSON.stringify(intent)) as GraphIntentV1;
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
