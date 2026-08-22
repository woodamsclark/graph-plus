import type {
  ApplyGraphPatchResultV1,
  Disposable,
  GraphCameraStateV1,
  GraphChangedEventV1,
  GraphDocumentV1,
  GraphFilterRequestV1,
  GraphFilterScopeV1,
  GraphIntentV1,
  GraphPatchV1,
  GraphSessionErrorV1,
  GraphSessionV1,
  GraphViewStateV1,
  TransitionOptionsV1,
  Vec3,
} from '../contracts/v1/index.ts';
import { GraphDocumentStore } from '../core/document/index.ts';
import { evaluateGraphFilterV1, type GraphFilterSelectionV1 } from '../core/filter/index.ts';
import type { EffectiveConsumerProfileV1 } from '../core/profile/index.ts';
import {
  cloneGraphViewStateV1,
  reconcileGraphViewStateV1,
} from '../core/state/index.ts';
import { GraphCameraController } from './camera/index.ts';
import { SessionInteractionRuntime } from './interaction/index.ts';
import type { SessionRuntimePlatformV1 } from './platform/index.ts';
import {
  CanvasGraphRenderer,
  composeGraphRenderFrameV1,
  GraphFrameStore,
} from './render/index.ts';
import { CanvasSessionSurface, type SessionSurfaceV1 } from './surface/index.ts';

export interface GraphSessionRuntimeOptionsV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  readonly profile: EffectiveConsumerProfileV1;
  readonly restoreViewState?: GraphViewStateV1;
  readonly platform: SessionRuntimePlatformV1;
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
  private readonly profile: EffectiveConsumerProfileV1;
  private readonly container: HTMLElement;
  private readonly platform: SessionRuntimePlatformV1;
  private surface!: SessionSurfaceV1;
  private camera!: GraphCameraController;
  private frames!: GraphFrameStore;
  private renderer!: CanvasGraphRenderer;
  private interaction!: SessionInteractionRuntime;
  private surfaceResizeSubscription: Disposable | null = null;
  private store: GraphDocumentStore;
  private viewState: GraphViewStateV1;
  private projectionSelection: GraphFilterSelectionV1;
  private renderSelection: GraphFilterSelectionV1;
  private readonly intentListeners = new Set<(intent: GraphIntentV1) => void>();
  private readonly graphChangedListeners = new Set<(event: GraphChangedEventV1) => void>();
  private readonly errorListeners = new Set<(error: GraphSessionErrorV1) => void>();
  private animationFrame: number | null = null;
  private frameCount = 0;
  private manuallySuspended = false;
  private documentSuspended = false;
  private disposed = false;

  private readonly onVisibilityChange = (): void => {
    this.documentSuspended = this.platform.document.hidden;
    this.synchronizeRuntimeActivity();
  };

  private readonly onAnimationFrame: FrameRequestCallback = () => {
    this.animationFrame = null;
    if (this.isSuspended()) return;
    this.interaction.tick();
    this.refreshFrame();
    this.renderer.render();
    this.frameCount += 1;
    this.surface.recordFrame(this.frameCount);
    this.scheduleFrame();
  };

  constructor(options: GraphSessionRuntimeOptionsV1) {
    this.sessionId = options.sessionId;
    this.engineInstanceId = options.engineInstanceId;
    this.consumerId = options.consumerId;
    this.profileId = options.profileId;
    this.profile = options.profile;
    this.container = options.container;
    this.platform = options.platform;
    this.assertPlatformOwnership();
    this.store = new GraphDocumentStore(options.document);
    this.viewState = options.restoreViewState
      ? addMissingPositions(
          reconcileGraphViewStateV1(options.restoreViewState, this.restoreContext()),
          this.store.exportDocument(),
          this.profile.dimensions,
        )
      : this.createInitialViewState();
    this.projectionSelection = allOf(this.store.exportDocument());
    this.renderSelection = allOf(this.store.exportDocument());

    let visibilityListenerInstalled = false;
    try {
      this.camera = new GraphCameraController(this.viewState.camera, this.profile.dimensions);
      this.surface = new CanvasSessionSurface({
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        container: this.container,
        platform: this.platform,
      });
      this.frames = new GraphFrameStore();
      this.renderer = new CanvasGraphRenderer(this.surface.canvas, this.camera, this.frames);
      const viewport = this.surface.getViewport();
      this.camera.setViewport(viewport.width, viewport.height);
      this.renderer.resize(viewport.width, viewport.height, viewport.devicePixelRatio);
      this.surfaceResizeSubscription = this.surface.onResize((next) => {
        this.camera.setViewport(next.width, next.height);
        this.renderer.resize(next.width, next.height, next.devicePixelRatio);
      });
      this.interaction = new SessionInteractionRuntime({
        sessionId: this.sessionId,
        dimensions: this.profile.dimensions,
        platform: this.platform,
        surface: this.surface,
        camera: this.camera,
        frames: this.frames,
        getDocument: () => this.store.exportDocument(),
        getViewState: () => this.viewState,
        setViewState: (state) => { this.viewState = state; },
        getRenderSelection: () => this.renderSelection,
        getResetCamera: () => defaultCamera(this.profile.dimensions),
        onViewStateChanged: () => {
          this.refreshFrame();
          this.updateSurface();
        },
        onIntent: (intent) => this.emitIntent(intent),
      });
      this.platform.document.addEventListener('visibilitychange', this.onVisibilityChange);
      visibilityListenerInstalled = true;
      this.documentSuspended = this.platform.document.hidden;
      this.recomputeView();
      if (!options.restoreViewState) this.fitPositions(Object.values(this.viewState.positions));
      this.refreshFrame();
      this.renderer.render();
      this.synchronizeRuntimeActivity();
    } catch (error) {
      if (this.animationFrame !== null) this.platform.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.interaction?.dispose();
      this.surfaceResizeSubscription?.dispose();
      this.surfaceResizeSubscription = null;
      if (visibilityListenerInstalled) {
        this.platform.document.removeEventListener('visibilitychange', this.onVisibilityChange);
      }
      this.surface?.dispose();
      this.disposed = true;
      throw error;
    }
  }

  async replaceDocument(document: GraphDocumentV1): Promise<void> {
    this.requireActive();
    const previous = this.store.exportDocument();
    try {
      const nextStore = new GraphDocumentStore(document);
      const next = nextStore.exportDocument();
      this.store = nextStore;
      this.viewState = previous.documentId === next.documentId
        ? addMissingPositions(
            reconcileGraphViewStateV1(this.viewState, this.restoreContext()),
            next,
            this.profile.dimensions,
          )
        : this.createInitialViewState();
      this.camera.setState(this.viewState.camera);
      this.recomputeView();
      if (previous.documentId !== next.documentId) this.fitPositions(Object.values(this.viewState.positions));
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
    this.viewState = addMissingPositions(
      reconcileGraphViewStateV1(this.viewState, this.restoreContext()),
      this.store.exportDocument(),
      this.profile.dimensions,
    );
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
    return this.store.exportDocument();
  }

  async applyFilter(filter: GraphFilterRequestV1): Promise<void> {
    this.requireActive();
    evaluateGraphFilterV1(this.store.exportDocument(), filter);
    this.viewState = cloneGraphViewStateV1({
      ...this.viewState,
      activeFilters: {
        ...this.viewState.activeFilters,
        [filter.scope]: cloneFilter(filter),
      },
    });
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
    this.recomputeView();
  }

  async setSelection(nodeIds: readonly string[]): Promise<void> {
    this.requireActive();
    this.setSelectionState(nodeIds);
  }

  async focusNode(nodeId: string | null): Promise<void> {
    this.requireActive();
    if (nodeId !== null && !this.store.exportDocument().nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Cannot focus unknown node "${nodeId}".`);
    }
    this.setFocusState(nodeId ?? undefined);
  }

  async fitNodes(nodeIds?: readonly string[], options?: TransitionOptionsV1): Promise<void> {
    this.requireActive();
    assertTransition(options);
    const document = this.store.exportDocument();
    const candidates = nodeIds ?? [...this.renderSelection.nodeIds];
    const positions = [...new Set(candidates)]
      .filter((id) => document.nodes.some((node) => node.id === id))
      .map((id) => this.viewState.positions[id])
      .filter((position): position is Vec3 => position !== undefined);
    if (!positions.length) return;
    this.fitPositions(positions);
  }

  async resetCamera(options?: TransitionOptionsV1): Promise<void> {
    this.requireActive();
    assertTransition(options);
    this.camera.setState(defaultCamera(this.profile.dimensions));
    this.synchronizeCameraState();
    this.refreshFrame();
  }

  async exportViewState(): Promise<GraphViewStateV1> {
    this.requireActive();
    return cloneGraphViewStateV1(this.viewState);
  }

  async restoreViewState(state: GraphViewStateV1): Promise<void> {
    this.requireActive();
    try {
      this.viewState = addMissingPositions(
        reconcileGraphViewStateV1(state, this.restoreContext()),
        this.store.exportDocument(),
        this.profile.dimensions,
      );
      this.camera.setState(this.viewState.camera);
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

  onIntent(listener: (intent: GraphIntentV1) => void): Disposable {
    return this.subscribe(this.intentListeners, listener);
  }

  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable {
    return this.subscribe(this.graphChangedListeners, listener);
  }

  onError(listener: (error: GraphSessionErrorV1) => void): Disposable {
    return this.subscribe(this.errorListeners, listener);
  }

  setSuspended(suspended: boolean): void {
    this.requireActive();
    if (this.manuallySuspended === suspended) return;
    this.manuallySuspended = suspended;
    this.synchronizeRuntimeActivity();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrame !== null) {
      this.platform.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.interaction.dispose();
    this.frames.set(null);
    this.surfaceResizeSubscription?.dispose();
    this.surfaceResizeSubscription = null;
    this.platform.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.intentListeners.clear();
    this.graphChangedListeners.clear();
    this.errorListeners.clear();
    this.surface.dispose();
  }

  private restoreContext() {
    return {
      document: this.store.exportDocument(),
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: this.profile.dimensions,
    } as const;
  }

  private createInitialViewState(): GraphViewStateV1 {
    const document = this.store.exportDocument();
    return {
      schemaVersion: 1,
      documentId: document.documentId,
      documentRevision: document.revision,
      consumerId: this.consumerId,
      profileId: this.profileId,
      dimensions: this.profile.dimensions,
      positions: Object.fromEntries(
        document.nodes.map((node, index) => [
          node.id,
          node.positionHint ? { ...node.positionHint } : defaultNodePosition(index, this.profile.dimensions),
        ]),
      ),
      pinnedNodeIds: [],
      camera: defaultCamera(this.profile.dimensions),
      selectedNodeIds: [],
      activeFilters: {},
      moduleState: {},
    };
  }

  private recomputeView(): void {
    this.interaction.reset();
    const document = this.store.exportDocument();
    const projectionFilter = this.viewState.activeFilters.projection;
    this.projectionSelection = projectionFilter
      ? evaluateGraphFilterV1(document, projectionFilter)
      : allOf(document);
    const projected = selectDocument(document, this.projectionSelection);
    const renderFilter = this.viewState.activeFilters.render;
    this.renderSelection = renderFilter
      ? evaluateGraphFilterV1(projected, renderFilter)
      : allOf(projected);
    this.refreshFrame();
    this.updateSurface();
  }

  private refreshFrame(): void {
    this.frames.set(composeGraphRenderFrameV1({
      document: this.store.exportDocument(),
      viewState: this.viewState,
      selection: this.renderSelection,
    }));
  }

  private updateSurface(): void {
    const document = this.store.exportDocument();
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

  private synchronizeCameraState(): void {
    this.viewState = cloneGraphViewStateV1({ ...this.viewState, camera: this.camera.getState() });
  }

  private fitPositions(positions: readonly Vec3[]): void {
    if (!positions.length) return;
    this.camera.fit(positions);
    this.synchronizeCameraState();
    this.refreshFrame();
  }

  private setSelectionState(nodeIds: readonly string[]): void {
    const known = new Set(this.store.exportDocument().nodes.map((node) => node.id));
    const selectedNodeIds = [...new Set(nodeIds)].filter((id) => known.has(id));
    if (sameIds(selectedNodeIds, this.viewState.selectedNodeIds)) return;
    this.viewState = cloneGraphViewStateV1({ ...this.viewState, selectedNodeIds });
    this.refreshFrame();
    this.updateSurface();
  }

  private setFocusState(nodeId: string | undefined): void {
    if (nodeId !== undefined && !this.store.exportDocument().nodes.some((node) => node.id === nodeId)) return;
    if (this.viewState.focusedNodeId === nodeId) return;
    const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.viewState;
    this.viewState = cloneGraphViewStateV1(nodeId === undefined ? withoutFocus : { ...withoutFocus, focusedNodeId: nodeId });
    if (nodeId) {
      const position = this.viewState.positions[nodeId];
      if (position) {
        this.camera.setTarget(position);
        this.synchronizeCameraState();
      }
    }
    this.refreshFrame();
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

  private synchronizeRuntimeActivity(): void {
    const suspended = this.isSuspended();
    this.interaction.setEnabled(!suspended);
    if (suspended) {
      if (this.animationFrame !== null) {
        this.platform.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      return;
    }
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.animationFrame === null && !this.isSuspended()) {
      this.animationFrame = this.platform.requestAnimationFrame(this.onAnimationFrame);
    }
  }

  private isSuspended(): boolean {
    return this.disposed || this.manuallySuspended || this.documentSuspended;
  }

  private requireActive(): void {
    if (this.disposed) throw new GraphSessionDisposedErrorV1();
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
    for (const listener of [...this.errorListeners]) {
      try {
        listener({ ...error });
      } catch {
        // Error listeners are isolated from the session and from one another.
      }
    }
  }
}

function allOf(document: GraphDocumentV1): GraphFilterSelectionV1 {
  return {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
}

function selectDocument(document: GraphDocumentV1, selection: GraphFilterSelectionV1): GraphDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    revision: document.revision,
    nodes: document.nodes.filter((node) => selection.nodeIds.has(node.id)),
    edges: document.edges.filter((edge) => selection.edgeIds.has(edge.id)),
  };
}

function defaultCamera(dimensions: '2d' | '3d'): GraphCameraStateV1 {
  return {
    position: dimensions === '2d' ? { x: 0, y: 0, z: 10 } : { x: 0, y: 0, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
    projection: dimensions === '2d' ? 'orthographic' : 'perspective',
  };
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
): GraphViewStateV1 {
  const additions = document.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => state.positions[node.id] === undefined);
  if (!additions.length) return state;
  return cloneGraphViewStateV1({
    ...state,
    positions: {
      ...state.positions,
      ...Object.fromEntries(additions.map(({ node, index }) => [
        node.id,
        node.positionHint ? { ...node.positionHint } : defaultNodePosition(index, dimensions),
      ])),
    },
  });
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
