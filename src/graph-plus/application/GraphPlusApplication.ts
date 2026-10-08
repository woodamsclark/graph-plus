import type {
  Disposable, GraphDocumentV1, GraphEffectiveSettingsV1, GraphEngineLeaseV1,
  GraphIntentV1, GraphSessionErrorV1, GraphSessionUiOptionsV1, GraphSessionV1, GraphViewStateV1,
  GraphWorldChangedEventV1,
  GraphWorldStateV1,
} from '../../graph-engine/contracts/v1/index.ts';
import { reconcileGraphViewStateV1 } from '../../graph-engine/public.ts';
import { GraphPlusLookupV1 } from '../adapter/index.ts';
import { projectGraphPlusExperienceDocumentV1 } from './GraphPlusDocumentProjection.ts';
import {
  graphPlusEngineExperienceContractV1,
  graphPlusExperiencePolicyV1,
  type GraphPlusExperienceModeV1,
  type GraphPlusExperiencePolicyV1,
} from './GraphPlusExperiencePolicy.ts';
import {
  GraphPlusVaultModelV1,
  type GraphPlusVaultModelSnapshotV1,
  type GraphPlusVaultSourceV1,
} from './GraphPlusVaultModel.ts';
import {
  GraphPlusCheckpointControllerV1, migrateLegacyPositionsV1,
  type GraphPlusCheckpointClockV1, type GraphPlusCheckpointStoreV1,
} from '../persistence/index.ts';
import {
  DEFAULT_GRAPH_PLUS_SESSION_NODE_LIMIT_V1,
  GraphPlusSessionV1,
  type GraphPlusSessionSnapshotV1,
} from './GraphPlusSession.ts';
import {
  adoptGraphPlusSessionOverridesV1, compileGraphPlusFilterV1, createDefaultGraphPlusLensV1,
  graphPlusSessionOverridesV1, type GraphPlusLensStateV1, type ObsidianSearchIndexV1,
} from '../query/index.ts';

export interface GraphPlusNavigatorV1<TFile> {
  openNote(file: TFile): Promise<void>;
  openTag(tag: string): Promise<void>;
}

export interface GraphPlusPresentationOptionsV1<TFile> {
  readonly mode?: GraphPlusExperienceModeV1;
  readonly lease: GraphEngineLeaseV1;
  readonly container: HTMLElement;
  readonly model?: GraphPlusVaultModelV1<TFile>;
  /** Compatibility input for callers not yet sharing a vault model. */
  readonly source?: GraphPlusVaultSourceV1<TFile>;
  readonly countDuplicateLinks?: boolean;
  readonly navigator: GraphPlusNavigatorV1<TFile>;
  readonly vaultId?: string;
  readonly checkpointStore?: GraphPlusCheckpointStoreV1;
  readonly legacyPositions?: unknown;
  readonly initialLens?: GraphPlusLensStateV1;
  readonly restoreSavedLens?: boolean;
  readonly initialRootNodeId?: string;
  readonly profileId?: string;
  readonly dimensions?: '2d' | '3d';
  readonly ui?: GraphSessionUiOptionsV1;
  readonly clock?: GraphPlusCheckpointClockV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
  readonly onCheckpointError?: (error: Error) => void;
  readonly onNotePreview?: (request: {
    readonly nodeId?: string; readonly file?: TFile;
    readonly anchor?: { readonly x: number; readonly y: number };
    readonly active: boolean; readonly immediate?: boolean;
  }) => void;
  readonly initialSession?: GraphPlusSessionSnapshotV1;
  /** Managed applications initially suppress layout until they elect one presentation as authority. */
  readonly initialLayoutAuthority?: boolean;
  /** Shared applications use this hook to refresh canonical truth once as a view opens. */
  readonly beforeOpen?: () => void | Promise<void>;
  /** Current full-graph state used to place a new Local camera over the existing graph. */
  readonly referenceViewState?: () => GraphViewStateV1 | undefined | Promise<GraphViewStateV1 | undefined>;
  /** Application coordination hooks: graph world is shared while viewport state remains local. */
  readonly onOpened?: () => void | Promise<void>;
  readonly onWorldStateChanged?: (event: GraphWorldChangedEventV1) => void | Promise<void>;
}

/** One presentation session whose behavior is selected by experience policy. */
export class GraphPlusPresentationV1<TFile> {
  private readonly policy: GraphPlusExperiencePolicyV1;
  private readonly model: GraphPlusVaultModelV1<TFile>;
  private readonly checkpoint?: GraphPlusCheckpointControllerV1;
  private readonly profileId: string;
  private readonly dimensions: '2d' | '3d';
  private lens: GraphPlusLensStateV1;
  private effectiveSettings?: GraphEffectiveSettingsV1;
  private session?: GraphSessionV1;
  private lookup = new GraphPlusLookupV1<TFile>();
  private searchIndex: ObsidianSearchIndexV1 = new Map();
  private canonicalDocument?: GraphDocumentV1;
  private document?: GraphDocumentV1;
  private sessionSubscriptions: Disposable[] = [];
  private actionRegistration?: Disposable;
  private opened = false;
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private leaseReleased = false;
  private lensQueue: Promise<void> = Promise.resolve();
  private transientRevealNodeId?: string;
  private resettingLayout = false;
  private visibleNodeIds = new Set<string>();
  private readonly pendingActiveConstellationNodes = new Set<string>();
  private rootNodeId?: string;
  private sessionNodeIds: readonly string[];
  private memoryProjection?: {
    readonly session: GraphSessionV1;
    readonly nodeIds: readonly string[];
    readonly completion: Promise<void>;
  };
  private enforcingPolicy = false;
  private referenceLayout?: GraphViewStateV1;
  private layoutAuthority: boolean;

  constructor(private readonly options: GraphPlusPresentationOptionsV1<TFile>) {
    this.policy = graphPlusExperiencePolicyV1(options.mode ?? 'global');
    if (!options.model && !options.source) throw new Error('Graph+ requires a vault model or vault source.');
    this.model = options.model ?? new GraphPlusVaultModelV1(options.source!, {
      countDuplicateLinks: options.countDuplicateLinks ?? false,
    });
    this.lens = clone(options.initialLens ?? createDefaultGraphPlusLensV1());
    this.profileId = options.profileId ?? 'default';
    this.dimensions = options.dimensions ?? '2d';
    this.layoutAuthority = options.initialLayoutAuthority ?? true;
    this.rootNodeId = options.initialRootNodeId;
    this.sessionNodeIds = [...(options.initialSession?.nodeIds ?? (this.rootNodeId ? [this.rootNodeId] : []))];
    if (this.policy.persistence === 'checkpoint') {
      if (!options.vaultId || !options.checkpointStore) {
        throw new Error('Global Graph+ requires vault checkpoint storage.');
      }
      this.checkpoint = new GraphPlusCheckpointControllerV1(
        options.vaultId, options.checkpointStore, options.clock, 500,
        () => clone(this.lens), stripGraphPlusRenderFilter,
        error => (this.options.onCheckpointError ?? this.options.onError)?.(error),
      );
    }
  }

  get mode(): GraphPlusExperienceModeV1 { return this.policy.mode; }
  get experiencePolicy(): GraphPlusExperiencePolicyV1 { return this.policy; }

  async open(): Promise<void> {
    if (this.closing) throw new Error('Graph+ presentation is closing.');
    if (this.opening) return this.opening;
    if (this.opened) return;
    const opening = this.openOnce();
    this.opening = opening;
    try { await opening; } finally { if (this.opening === opening) this.opening = undefined; }
  }

  private async openOnce(): Promise<void> {
    this.opened = true;
    try {
      this.actionRegistration = this.options.lease.registerNodeActions([{
        id: 'open-node',
        label: (context) => this.nodeKind(context.nodeId) === 'tag' ? 'Open tag' : 'Open note',
        icon: 'file-text',
        isAvailable: (context) => this.nodeKind(context.nodeId) !== undefined,
        run: (context) => this.openNode(context.nodeId),
      }, {
        id: 'clear-constellation', label: 'Clear constellation', icon: 'eraser',
        isAvailable: context => context.selectedNodeIds.includes(context.nodeId),
        run: () => this.clearConstellation(),
      }]);
      if (this.policy.persistence === 'checkpoint') await this.openGlobal();
      else await this.openLocal();
      if (this.options.initialSession) {
        await this.applySessionSnapshot(this.options.initialSession);
        if (this.options.initialSession.activeNodeId) {
          await this.addActiveNodesToConstellation([this.options.initialSession.activeNodeId]);
        }
      }
      await this.options.onOpened?.();
    } catch (error) {
      this.opened = false;
      this.actionRegistration?.dispose();
      this.actionRegistration = undefined;
      this.options.onError?.(asError(error));
      throw error;
    }
  }

  private async openGlobal(): Promise<void> {
    const saved = await this.options.checkpointStore!.load(this.options.vaultId!);
    if (saved) {
      if (saved.lens && this.options.restoreSavedLens !== false) this.lens = clone(saved.lens);
      const migrated = saved.viewState ?? migrateLegacyPositionsV1(saved.document, this.options.legacyPositions, {
        profileId: this.profileId, dimensions: this.dimensions,
      });
      await this.mount(saved.document, migrated);
      await this.options.beforeOpen?.();
      if (!this.canonicalDocument) await this.applyCanonicalSnapshot(await this.model.open());
      return;
    }
    await this.options.beforeOpen?.();
    const model = await this.model.open();
    this.adoptModel(model);
    const migrated = migrateLegacyPositionsV1(model.document, this.options.legacyPositions, {
      profileId: this.profileId, dimensions: this.dimensions,
    });
    await this.mount(model.document, migrated);
    this.checkpoint?.schedule();
  }

  private async openLocal(): Promise<void> {
    await this.options.beforeOpen?.();
    const model = await this.model.open();
    this.adoptModel(model);
    const document = this.projectDocument();
    const reference = await this.resolveReferenceViewState();
    const restored = reference ? this.localViewState(document, reference) : undefined;
    await this.mount(document, restored);
    await this.enforceExperiencePolicy('preserve');
    await this.fitProjectedDocument();
  }

  async reconcile(): Promise<void> {
    if (this.resettingLayout || !this.session) return;
    try {
      await this.applyCanonicalSnapshot(await this.model.reconcile());
    } catch (error) { this.options.onError?.(asError(error)); }
  }

  /** Receives canonical vault truth from the shared Graph+ application. */
  async applyCanonicalSnapshot(model: GraphPlusVaultModelSnapshotV1<TFile>): Promise<void> {
    if (this.resettingLayout || !this.session) return;
    this.adoptModel(model);
    if (model.document !== this.document) {
      await this.session.replaceDocument(model.document);
      this.document = model.document;
    }
    await this.applyFilter();
    await this.addActiveNodesToConstellation([]);
    this.checkpoint?.schedule();
  }

  setLens(next: GraphPlusLensStateV1): Promise<void> {
    const requested = clone(next);
    this.lensQueue = this.lensQueue.catch(() => undefined).then(() => this.applyLensState(requested));
    return this.lensQueue;
  }

  private async applyLensState(next: GraphPlusLensStateV1): Promise<void> {
    const previousRuntimeSettings = JSON.stringify(graphPlusSessionOverridesV1(this.lens));
    this.lens = clone(next);
    if (!this.session || !this.document) return;
    if (previousRuntimeSettings !== JSON.stringify(graphPlusSessionOverridesV1(this.lens))) {
      await this.session.setSessionOverrides(graphPlusSessionOverridesV1(this.lens));
      this.effectiveSettings = await this.session.exportEffectiveSettings();
    }
    await this.applyFilter();
    this.checkpoint?.schedule();
  }

  getLens(): GraphPlusLensStateV1 { return clone(this.lens); }
  getEffectiveSettings(): GraphEffectiveSettingsV1 | undefined {
    return this.effectiveSettings ? clone(this.effectiveSettings) : undefined;
  }
  getDocument(): GraphDocumentV1 | undefined {
    return this.document ? clone(this.document) : undefined;
  }
  getProjectedDocument(): GraphDocumentV1 | undefined { return this.document ? clone(this.document) : undefined; }
  getLocalDocument(): GraphDocumentV1 | undefined { return this.getProjectedDocument(); }
  getSession(): GraphSessionV1 | undefined { return this.session; }

  async followActiveNode(nodeId?: string): Promise<boolean> {
    if (!this.policy.followActiveNote || !this.session) return false;
    if (nodeId === undefined) {
      if (this.rootNodeId === undefined && this.document?.nodes.length === 0) {
        await this.enforceExperiencePolicy();
        return true;
      }
      this.rootNodeId = undefined;
      await this.enforceExperiencePolicy();
      return true;
    }
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)) return false;
    this.sessionNodeIds = [
      ...this.sessionNodeIds.filter((sessionNodeId) => sessionNodeId !== nodeId),
      nodeId,
    ].slice(-DEFAULT_GRAPH_PLUS_SESSION_NODE_LIMIT_V1);
    if (this.rootNodeId === nodeId) {
      await this.enforceExperiencePolicy();
      return true;
    }
    this.rootNodeId = nodeId;
    await this.enforceExperiencePolicy();
    return true;
  }

  async addActiveNodesToConstellation(nodeIds: readonly string[]): Promise<void> {
    if (!this.session || !this.document || this.resettingLayout) return;
    for (const id of nodeIds) this.pendingActiveConstellationNodes.add(id);
    const available = new Set(this.document.nodes.map(node => node.id));
    const admitted = [...this.pendingActiveConstellationNodes].filter(id => available.has(id));
    const state = await this.session.exportViewState();
    const members = [...new Set([...state.selectedNodeIds, ...admitted])];
    if (sameNodeIds(members, state.selectedNodeIds)) {
      for (const id of admitted) this.pendingActiveConstellationNodes.delete(id);
      return;
    }
    const result = await this.session.applyExternalInfluence({
      schemaVersion: 1, type: 'replace-attention', nodeIds: members,
      ...(state.focusedNodeId ? { focusNodeId: state.focusedNodeId } : {}), framing: 'preserve',
    });
    if (result.status === 'rejected') throw new Error(`Active-note constellation was rejected: ${result.reason}`);
    for (const id of admitted) this.pendingActiveConstellationNodes.delete(id);
  }

  async applySessionSnapshot(snapshot: GraphPlusSessionSnapshotV1): Promise<void> {
    this.sessionNodeIds = snapshot.nodeIds
      .filter((nodeId) => nodeId !== snapshot.activeNodeId)
      .slice(-DEFAULT_GRAPH_PLUS_SESSION_NODE_LIMIT_V1);
    if (!this.session || !this.canonicalDocument) return;
    const session = this.session;
    const nodeIds = this.policy.memoryConstellations === 'enabled' ? this.sessionNodeIds : [];
    if (this.memoryProjection?.session === session && sameNodeIds(nodeIds, this.memoryProjection.nodeIds)) {
      return this.memoryProjection.completion;
    }
    const projection = {
      session,
      nodeIds: [...nodeIds],
      completion: session.applyExternalInfluence({
        schemaVersion: 1, type: 'replace-remembered-subjects', nodeIds,
      }).then(result => {
        if (result.status === 'rejected') throw new Error(`Graph+ session Memory was rejected: ${result.reason}`);
      }),
    };
    this.memoryProjection = projection;
    try { await projection.completion; } catch (error) {
      // Failed installs are retryable; identical in-flight installs share completion.
      if (this.memoryProjection === projection) this.memoryProjection = undefined;
      throw error;
    }
  }

  async clearConstellation(): Promise<void> {
    this.pendingActiveConstellationNodes.clear();
    const state = await this.session?.exportViewState();
    if (!state) return;
    // Local remains Focus-only; its root is the minimum required Attention subject.
    await this.session?.setSelection(this.policy.mode === 'local' && state.focusedNodeId ? [state.focusedNodeId] : []);
  }

  async recenterFocusedNode(): Promise<void> {
    const state = await this.session?.exportViewState();
    if (state?.focusedNodeId) await this.receiveApplicationAttention(state.focusedNodeId, 'recenter-focus');
  }

  async focusNode(nodeId: string): Promise<void> {
    if (!this.session) return;
    await this.session.clearPreview();
    await this.receiveApplicationAttention(nodeId, 'recenter-focus');
  }

  async revealAndFocusNode(nodeId: string): Promise<boolean> {
    const source = this.canonicalDocument ?? this.document;
    if (!this.session || !source) return false;
    if (!source.nodes.some((node) => node.id === nodeId)) return false;
    this.transientRevealNodeId = nodeId;
    await this.session.clearPreview();
    await this.applyFilter();
    await this.receiveApplicationAttention(nodeId, 'preserve');
    // Show in Graph+ is an explicit reveal operation, including a neighborhood fit.
    const document = await this.session.exportDocument();
    const nodeIds = [...new Set([nodeId, ...document.edges.flatMap((edge) =>
      edge.sourceId === nodeId ? [edge.targetId] : edge.targetId === nodeId ? [edge.sourceId] : [])])];
    await this.session.fitNodes(nodeIds, { centerNodeId: nodeId });
    return true;
  }

  /* Mind Map deferred: retain the entry point for the later feature.
  async mindMapFromNode(nodeId: string): Promise<void> {
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)
      && !this.document?.nodes.some((node) => node.id === nodeId)) return;
    await this.setLens({ ...clone(this.lens), form: { ...this.lens.form, rootNodeId: nodeId, enabled: true } });
    await this.session?.setSelection([nodeId]);
  }

  */

  async openNode(nodeId: string): Promise<void> {
    const entry = this.lookup.get(nodeId);
    if (entry?.kind === 'note') await this.options.navigator.openNote(entry.file);
    if (entry?.kind === 'tag') await this.options.navigator.openTag(entry.tag);
  }
  nodeKind(nodeId: string): 'note' | 'tag' | undefined { return this.lookup.get(nodeId)?.kind; }
  async setNodePinned(nodeId: string, pinned: boolean): Promise<void> {
    await this.session?.setNodePinned(nodeId, pinned);
  }
  setSuspended(suspended: boolean): void { this.session?.setSuspended(suspended); }
  async setPreviewSurfaceActive(active: boolean): Promise<void> { await this.session?.setPreviewSurfaceActive(active); }
  async clearPreview(): Promise<void> { await this.session?.clearPreview(); }
  async hoverDocumentLink(nodeId?: string): Promise<void> {
    if (this.policy.mode === 'local') await this.session?.setNodeHover?.(nodeId ?? null);
  }

  async resetLayoutData(): Promise<boolean> {
    if (this.policy.persistence !== 'checkpoint' || this.resettingLayout || !this.session || !this.document) return false;
    this.resettingLayout = true;
    try {
      await this.lensQueue.catch(() => undefined);
      const document = this.document;
      const discardedSession = this.session;
      this.disposeSessionSubscriptions();
      this.options.onNotePreview?.({ active: false });
      this.transientRevealNodeId = undefined;
      await this.checkpoint?.detachAndWait();
      this.session = undefined;
      this.effectiveSettings = undefined;
      await discardedSession.dispose();
      await this.options.checkpointStore!.save(this.options.vaultId!, {
        document, lens: clone(this.lens), savedAt: this.options.clock?.now() ?? Date.now(),
      }, { documentChanged: false });
      await this.mount(document);
      await this.checkpoint?.flush();
      return true;
    } finally { this.resettingLayout = false; }
  }

  close(): Promise<void> {
    return this.closing ??= this.closeOnce();
  }

  private async closeOnce(): Promise<void> {
    this.opened = false;
    this.session?.setSuspended(true);
    await this.opening?.catch(() => undefined);
    await this.lensQueue.catch(() => undefined);
    this.session?.setSuspended(true);
    this.disposeSessionSubscriptions();
    this.actionRegistration?.dispose();
    this.actionRegistration = undefined;
    try {
      if (this.checkpoint) await this.checkpoint.closeAndDispose();
      else await this.session?.dispose();
    } finally {
      this.session = undefined;
      this.memoryProjection = undefined;
      this.effectiveSettings = undefined;
      this.document = undefined;
      this.canonicalDocument = undefined;
      this.lookup = new GraphPlusLookupV1<TFile>();
      this.searchIndex = new Map();
      this.transientRevealNodeId = undefined;
      this.visibleNodeIds.clear();
      this.pendingActiveConstellationNodes.clear();
      if (!this.leaseReleased) {
        this.leaseReleased = true;
        await this.options.lease.release();
      }
    }
  }

  private async mount(document: GraphDocumentV1, restoreViewState?: GraphViewStateV1): Promise<void> {
    const compatibleViewState = restoreViewState ? this.compatibleViewState(document, restoreViewState) : undefined;
    const session = await this.options.lease.createSession({
      consumerId: 'graph-plus', profileId: this.profileId, container: this.options.container,
      document, experience: graphPlusEngineExperienceContractV1(this.policy),
      restoreViewState: compatibleViewState,
      layoutAuthority: this.layoutAuthority,
      sessionOverrides: graphPlusSessionOverridesV1(this.lens), ui: this.options.ui,
      onSessionOverridesChanged: (overrides) => this.adoptSessionOverrides(overrides),
    });
    this.session = session;
    this.memoryProjection = undefined;
    this.effectiveSettings = await session.exportEffectiveSettings();
    this.document = document;
    this.checkpoint?.attach(session, document);
    this.sessionSubscriptions.push(session.onError((error) => this.options.onError?.(error)));
    this.sessionSubscriptions.push(session.onIntent((intent) => this.handleIntent(intent, session)));
    this.sessionSubscriptions.push(session.onWorldChanged((event) => {
      void this.options.onWorldStateChanged?.(event);
    }));
    await this.applyFilter();
  }

  private handleIntent(intent: GraphIntentV1, session: GraphSessionV1): void {
    if (intent.type === 'preview-changed') {
      const entry = intent.nodeId ? this.lookup.get(intent.nodeId) : undefined;
      if (intent.nodeId && entry?.kind !== 'note') {
        void session.clearPreview();
      } else {
        this.options.onNotePreview?.({
          ...(intent.nodeId ? { nodeId: intent.nodeId } : {}),
          ...(entry?.kind === 'note' ? { file: entry.file } : {}),
          ...(intent.anchor ? { anchor: intent.anchor } : {}),
          active: intent.nodeId !== undefined && entry?.kind === 'note', immediate: !intent.closing,
        });
      }
    }
    if (intent.type === 'focus-changed' && intent.focusedNodeId !== this.transientRevealNodeId
      && this.transientRevealNodeId) {
      this.transientRevealNodeId = undefined;
      void this.applyFilter();
    }
    if (intent.type === 'focus-changed' && this.policy.followActiveNote
      && intent.focusedNodeId && intent.focusedNodeId !== this.rootNodeId) {
      const entry = this.lookup.get(intent.focusedNodeId);
      if (entry?.kind === 'note') void this.options.navigator.openNote(entry.file);
    }
  }

  async exportWorldState(): Promise<GraphWorldStateV1 | undefined> {
    return this.session?.exportWorldState();
  }

  async adoptSharedWorldState(state: GraphWorldStateV1): Promise<void> {
    await this.session?.applyWorldState(state);
    this.checkpoint?.schedule();
  }

  setLayoutAuthority(authority: boolean): void {
    this.layoutAuthority = authority;
    this.session?.setLayoutAuthority(authority);
  }

  private adoptModel(model: GraphPlusVaultModelSnapshotV1<TFile>): void {
    this.canonicalDocument = model.document;
    this.lookup = model.lookup;
    this.searchIndex = model.searchIndex;
  }

  /** A request arriving from outside Graph+ is received truth, never an Ego action. */
  private async receiveApplicationAttention(nodeId: string, framing: 'preserve' | 'recenter-focus'): Promise<void> {
    const previous = await this.session?.exportViewState();
    const nodeIds = previous?.viewMode === 'focus'
      ? [...new Set([...previous.selectedNodeIds, ...(previous.focusedNodeId ? [previous.focusedNodeId] : []), nodeId])] : [nodeId];
    const result = await this.session?.applyExternalInfluence({
      schemaVersion: 1, type: 'replace-attention', nodeIds, focusNodeId: nodeId, framing,
    });
    if (result?.status === 'rejected') throw new Error(`Graph+ application input was rejected: ${result.reason}`);
  }

  private projectDocument(): GraphDocumentV1 {
    return projectGraphPlusExperienceDocumentV1({
      policy: this.policy,
      canonicalDocument: this.canonicalDocument,
    });
  }

  private async enforceExperiencePolicy(
    changedFocusFraming: 'preserve' | 'recenter-focus' = 'recenter-focus',
  ): Promise<void> {
    if (this.enforcingPolicy || this.policy.canonicalRootState === 'none') return;
    const root = this.rootNodeId;
    if (!this.session) return;
    if (root && !this.document?.nodes.some((node) => node.id === root)) return;
    this.enforcingPolicy = true;
    try {
      const state = await this.session.exportViewState();
      const available = new Set(this.document?.nodes.map((node) => node.id) ?? []);
      const candidateRoot = root ?? state.focusedNodeId;
      const focusNodeId = candidateRoot && available.has(candidateRoot) ? candidateRoot : undefined;
      // Canonical note arrival extends the current working constellation. Focus
      // moves locally, while the prior subject and deliberate members stay admitted.
      const attentionNodeIds = [...new Set([...state.selectedNodeIds,
        ...(state.focusedNodeId ? [state.focusedNodeId] : []), ...(focusNodeId ? [focusNodeId] : [])])];
      const consciousStateChanged = !sameNodeIds(state.selectedNodeIds, attentionNodeIds)
        || state.focusedNodeId !== focusNodeId;
      const result = await this.session.applyExternalInfluence({
        schemaVersion: 1,
        type: 'replace-attention',
        nodeIds: attentionNodeIds,
        ...(focusNodeId ? { focusNodeId } : {}),
        framing: consciousStateChanged && focusNodeId ? changedFocusFraming : 'preserve',
      });
      if (result.status === 'rejected') {
        throw new Error(`Graph+ experience rejected canonical subject: ${result.reason}`);
      }
    } finally { this.enforcingPolicy = false; }
  }

  private async resolveReferenceViewState(): Promise<GraphViewStateV1 | undefined> {
    const live = await this.options.referenceViewState?.();
    if (live) this.referenceLayout = clone(live);
    if (!this.referenceLayout && this.options.vaultId && this.options.checkpointStore) {
      const saved = (await this.options.checkpointStore.load(this.options.vaultId))?.viewState;
      if (saved) this.referenceLayout = clone(saved);
    }
    return this.referenceLayout ? clone(this.referenceLayout) : undefined;
  }

  private localViewState(
    document: GraphDocumentV1,
    reference: GraphViewStateV1,
    previous?: GraphViewStateV1,
  ): GraphViewStateV1 {
    const available = new Set(document.nodes.map((node) => node.id));
    const base = previous ?? reference;
    const positions = Object.fromEntries(document.nodes.flatMap((node) => {
      const position = base.positions[node.id] ?? reference.positions[node.id];
      return position ? [[node.id, { ...position }] as const] : [];
    }));
    const selectedNodeIds = (previous?.selectedNodeIds ?? []).filter((nodeId) => available.has(nodeId));
    const focusedNodeId = previous?.focusedNodeId && selectedNodeIds.includes(previous.focusedNodeId)
      ? previous.focusedNodeId
      : undefined;
    return {
      schemaVersion: 1,
      documentId: document.documentId,
      documentRevision: document.revision,
      consumerId: 'graph-plus',
      profileId: this.profileId,
      dimensions: base.dimensions,
      positions,
      pinnedNodeIds: base.pinnedNodeIds.filter((nodeId) => available.has(nodeId)),
      camera: clone(base.camera),
      selectedNodeIds,
      ...(focusedNodeId ? { focusedNodeId } : {}),
      viewMode: focusedNodeId ? 'focus' : previous?.viewMode ?? 'explore',
      activeFilters: clone(previous?.activeFilters ?? {}),
      moduleState: {
        ...clone(base.moduleState),
        'force-layout': settledForceLayoutState(),
      },
    };
  }

  private async fitProjectedDocument(): Promise<void> {
    if (!this.session || !this.document?.nodes.length) return;
    const centerNodeId = this.rootNodeId
      && this.document.nodes.some((node) => node.id === this.rootNodeId)
      ? this.rootNodeId
      : undefined;
    const nodeIds = centerNodeId
      ? [...new Set([centerNodeId, ...this.document.edges.flatMap((edge) =>
        edge.sourceId === centerNodeId ? [edge.targetId]
          : edge.targetId === centerNodeId ? [edge.sourceId] : [])])]
      : this.document.nodes.map((node) => node.id);
    await this.session.fitNodes(nodeIds, centerNodeId ? { centerNodeId } : undefined);
  }

  private adoptSessionOverrides(overrides: Parameters<typeof adoptGraphPlusSessionOverridesV1>[1]): void {
    this.lens = adoptGraphPlusSessionOverridesV1(this.lens, overrides);
    this.checkpoint?.schedule();
  }

  private compatibleViewState(document: GraphDocumentV1, state: GraphViewStateV1): GraphViewStateV1 | undefined {
    try {
      return reconcileGraphViewStateV1(state, {
        document, consumerId: 'graph-plus', profileId: this.profileId, dimensions: state.dimensions,
      });
    } catch { return undefined; }
  }

  private async applyFilter(): Promise<readonly string[]> {
    if (!this.session || !this.document) return [];
    const compiled = compileGraphPlusFilterV1(this.document, this.lens, this.searchIndex);
    if (compiled.error) this.options.onError?.(new Error(compiled.error));
    const rootId = this.lens.form.rootNodeId;
    if (this.effectiveSettings?.modules.form?.enabled && rootId && !compiled.visibleNodeIds.includes(rootId)) {
      this.lens = { ...this.lens, form: { ...this.lens.form, enabled: false } };
      await this.session.setSessionOverrides(graphPlusSessionOverridesV1(this.lens));
      this.effectiveSettings = await this.session.exportEffectiveSettings();
      this.options.onError?.(new Error('Mind Map paused because its selected root is hidden by the active filter.'));
    }
    const visibleNodeIds = this.transientRevealNodeId
      ? [...new Set([...compiled.visibleNodeIds, this.transientRevealNodeId])]
      : compiled.visibleNodeIds;
    this.visibleNodeIds = new Set(visibleNodeIds);
    await this.session.applyFilter({ ...compiled.request, node: { op: 'id-in', ids: visibleNodeIds } });
    return visibleNodeIds;
  }

  private disposeSessionSubscriptions(): void {
    this.sessionSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
  }

}

export interface GraphPlusApplicationOptionsV1<TFile> {
  readonly model: GraphPlusVaultModelV1<TFile>;
  readonly navigator: GraphPlusNavigatorV1<TFile>;
  readonly onError?: (error: Error) => void;
  readonly session?: GraphPlusSessionV1;
  readonly now?: () => number;
  readonly reconcileDelayMs?: number;
}

export type GraphPlusPresentationAttachOptionsV1<TFile> = Omit<
  GraphPlusPresentationOptionsV1<TFile>,
  | 'model' | 'navigator' | 'source' | 'countDuplicateLinks' | 'beforeOpen' | 'referenceViewState'
  | 'onOpened' | 'onWorldStateChanged' | 'initialLayoutAuthority'
>;

/** Activity outside Graph+; application policy translates it into conscious state. */
export type GraphPlusUnconsciousActivityV1 =
  | { readonly type: 'canonical-vault-invalidated' }
  | { readonly type: 'active-note-changed'; readonly nodeId?: string; readonly timestamp?: number }
  | { readonly type: 'document-link-hovered'; readonly nodeId?: string }
  | { readonly type: 'workspace-layout-changed' };

/** @deprecated Host transport name; use the application boundary's unconscious activity type. */
export type GraphPlusHostEventV1 = GraphPlusUnconsciousActivityV1;

/**
 * The single Graph+ application. It owns canonical vault reconciliation and
 * distributes one graph world to viewport-independent Global and Local presentations.
 */
export class GraphPlusApplicationV1<TFile> {
  private readonly presentations = new Set<GraphPlusPresentationV1<TFile>>();
  private readonly closingPresentations = new Map<GraphPlusPresentationV1<TFile>, Promise<void>>();
  private disposal?: Promise<void>;
  private readonly hostActivityListeners = new Set<() => void>();
  private reconcileTimer?: ReturnType<typeof setTimeout>;
  private reconcileRunning?: Promise<void>;
  private reconcileAgain = false;
  private canonicalDirty = true;
  private disposed = false;
  private activeNodeQueued = false;
  private activeNodeGeneration = 0;
  private pendingActiveNodeId?: string;
  private readonly pendingConstellationNodeIds = new Set<string>();
  private activeNodeFollow?: Promise<void>;
  private pendingSessionSnapshot: GraphPlusSessionSnapshotV1;
  private readonly workspaceSession: GraphPlusSessionV1;
  private sharedWorldState?: GraphWorldStateV1;
  private worldStateQueue: Promise<void> = Promise.resolve();
  private layoutAuthority?: GraphPlusPresentationV1<TFile>;

  constructor(private readonly options: GraphPlusApplicationOptionsV1<TFile>) {
    this.workspaceSession = options.session ?? new GraphPlusSessionV1();
    this.pendingSessionSnapshot = this.workspaceSession.snapshot();
  }

  createPresentation(
    options: GraphPlusPresentationAttachOptionsV1<TFile>,
  ): GraphPlusPresentationV1<TFile> {
    if (this.disposed) throw new Error('Graph+ application is disposed.');
    // A new presentation starts from bounded Memory and the current active note,
    // not admissions left over from a previous period with open panes.
    if (this.presentations.size === 0) this.discardPendingActiveNodes();
    if (options.initialRootNodeId && this.workspaceSession.snapshot().nodeIds.length === 0) {
      this.pendingSessionSnapshot = this.workspaceSession.experienceFileActivation(
        options.initialRootNodeId,
        this.options.now?.() ?? Date.now(),
      );
    }
    let presentation!: GraphPlusPresentationV1<TFile>;
    presentation = new GraphPlusPresentationV1({
      ...options,
      model: this.options.model,
      navigator: this.options.navigator,
      initialSession: this.workspaceSession.snapshot(),
      beforeOpen: () => this.reconcileOnOpen(),
      referenceViewState: () => this.exportGlobalViewState(presentation),
      onOpened: () => this.presentationOpened(presentation),
      onWorldStateChanged: (event) => this.queueWorldStateFrom(presentation, event),
      initialLayoutAuthority: false,
    });
    this.presentations.add(presentation);
    return presentation;
  }

  closePresentation(presentation: GraphPlusPresentationV1<TFile>): Promise<void> {
    const closing = this.closingPresentations.get(presentation);
    if (closing) return closing;
    if (!this.presentations.delete(presentation)) return Promise.resolve();
    if (this.presentations.size === 0) this.discardPendingActiveNodes();
    const completion = this.closePresentationOnce(presentation);
    this.closingPresentations.set(presentation, completion);
    const finish = () => this.closingPresentations.delete(presentation);
    void completion.then(finish, finish);
    return completion;
  }

  private async closePresentationOnce(presentation: GraphPlusPresentationV1<TFile>): Promise<void> {
    const wasLayoutAuthority = this.layoutAuthority === presentation;
    if (wasLayoutAuthority) {
      presentation.setLayoutAuthority(false);
      this.layoutAuthority = undefined;
    }
    try { await presentation.close(); } finally {
      if (wasLayoutAuthority && !this.disposed) this.electLayoutAuthority();
    }
    if (this.presentations.size === 0) {
      this.canonicalDirty = true;
      this.cancelScheduledReconcile();
      this.activeNodeQueued = false;
      await this.activeNodeFollow?.catch(() => undefined);
    }
  }

  onHostActivity(listener: () => void): Disposable {
    if (this.disposed) return { dispose: () => undefined };
    this.hostActivityListeners.add(listener);
    return { dispose: () => this.hostActivityListeners.delete(listener) };
  }

  getSessionSnapshot(): GraphPlusSessionSnapshotV1 {
    return this.workspaceSession.snapshot();
  }

  private async exportGlobalViewState(
    requester: GraphPlusPresentationV1<TFile>,
  ): Promise<GraphViewStateV1 | undefined> {
    const reference = this.layoutAuthority?.getSession() !== undefined
      ? this.layoutAuthority
      : [...this.presentations].find((candidate) =>
          candidate !== requester && candidate.getSession() !== undefined);
    return reference?.getSession()?.exportViewState();
  }

  private presentationOpened(presentation: GraphPlusPresentationV1<TFile>): Promise<void> {
    return this.enqueueWorldState(async () => {
      if (this.disposed || !this.presentations.has(presentation)) return;
      if (this.sharedWorldState) await presentation.adoptSharedWorldState(this.sharedWorldState);
      else {
        const state = await presentation.exportWorldState();
        if (state) this.sharedWorldState = clone(state);
      }
      if (!this.layoutAuthority) {
        this.layoutAuthority = presentation;
        presentation.setLayoutAuthority(true);
      }
    });
  }

  private queueWorldStateFrom(
    source: GraphPlusPresentationV1<TFile>,
    event: GraphWorldChangedEventV1,
  ): Promise<void> {
    return this.enqueueWorldState(async () => {
      if (this.disposed || !this.presentations.has(source)) return;
      if ((event.cause === 'layout' || event.cause === 'document' || event.cause === 'restore')
        && source !== this.layoutAuthority) return;
      const state = event.state;
      this.sharedWorldState = clone(state);
      await Promise.all([...this.presentations]
        .filter((presentation) => presentation !== source && presentation.getSession() !== undefined)
        .map((presentation) => presentation.adoptSharedWorldState(state)));
    });
  }

  private enqueueWorldState(operation: () => Promise<void>): Promise<void> {
    const queued = this.worldStateQueue.catch(() => undefined).then(operation);
    this.worldStateQueue = queued;
    void queued.catch((error) => this.options.onError?.(asError(error)));
    return queued;
  }

  private electLayoutAuthority(): void {
    if (this.layoutAuthority?.getSession() !== undefined) return;
    this.layoutAuthority = [...this.presentations]
      .find((presentation) => presentation.getSession() !== undefined);
    this.layoutAuthority?.setLayoutAuthority(true);
  }

  /** Compatibility ingress for existing hosts. */
  receiveHostEvent(event: GraphPlusHostEventV1): void {
    this.receiveUnconsciousActivity(event);
  }

  receiveUnconsciousActivity(event: GraphPlusUnconsciousActivityV1): void {
    if (this.disposed) return;
    if (event.type === 'document-link-hovered') {
      for (const presentation of this.presentations) void presentation.hoverDocumentLink(event.nodeId);
      return;
    }
    if (event.type === 'canonical-vault-invalidated') {
      this.canonicalDirty = true;
      if (this.reconcileRunning) this.reconcileAgain = true;
      else if (this.presentations.size > 0) this.scheduleReconcile();
      return;
    }
    if (event.type === 'active-note-changed') {
      const previousActiveNodeId = this.workspaceSession.snapshot().activeNodeId;
      this.pendingSessionSnapshot = this.workspaceSession.experienceFileActivation(
        event.nodeId,
        event.timestamp ?? this.options.now?.() ?? Date.now(),
      );
      if (event.nodeId !== previousActiveNodeId) {
        if (this.presentations.size > 0) {
          if (event.nodeId) this.pendingConstellationNodeIds.add(event.nodeId);
          this.queueActiveNode(event.nodeId, this.pendingSessionSnapshot);
        }
      }
    }
    for (const listener of this.hostActivityListeners) listener();
  }

  async reconcile(): Promise<void> {
    if (this.disposed) return;
    this.cancelScheduledReconcile();
    if (this.presentations.size === 0) {
      this.canonicalDirty = true;
      return;
    }
    if (this.reconcileRunning) {
      return this.reconcileRunning;
    }
    const operation = this.reconcileUntilSettled();
    this.reconcileRunning = operation;
    try { await operation; } finally {
      if (this.reconcileRunning === operation) this.reconcileRunning = undefined;
    }
  }

  async followActiveNode(nodeId?: string): Promise<void> {
    if (this.disposed) return;
    const locals = [...this.presentations].filter((presentation) => presentation.experiencePolicy.followActiveNote);
    await Promise.all(locals.map((presentation) => presentation.followActiveNode(nodeId)));
  }

  async setCountDuplicateLinks(value: boolean): Promise<void> {
    if (this.disposed || !this.options.model.setCountDuplicateLinks(value)) return;
    this.canonicalDirty = true;
    if (this.reconcileRunning) this.reconcileAgain = true;
    await this.reconcile();
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.cancelScheduledReconcile();
    this.reconcileAgain = false;
    this.activeNodeQueued = false;
    for (const presentation of this.presentations) presentation.setSuspended(true);
    return this.disposal = this.disposeOnce();
  }

  private async disposeOnce(): Promise<void> {
    await this.reconcileRunning?.catch(() => undefined);
    await this.activeNodeFollow?.catch(() => undefined);
    await this.worldStateQueue.catch(() => undefined);
    const results = await Promise.allSettled([
      ...this.closingPresentations.values(),
      ...[...this.presentations].map((presentation) => this.closePresentation(presentation)),
    ]);
    this.presentations.clear();
    this.pendingConstellationNodeIds.clear();
    this.hostActivityListeners.clear();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  private async reconcileUntilSettled(): Promise<void> {
    do {
      this.reconcileAgain = false;
      try {
        const snapshot = await this.options.model.reconcile();
        if (this.disposed) return;
        const presentations = [...this.presentations];
        const globals = presentations.filter((presentation) => presentation.mode === 'global');
        const locals = presentations.filter((presentation) => presentation.mode === 'local');
        await Promise.all(globals.map((presentation) => presentation.applyCanonicalSnapshot(snapshot)));
        await Promise.all(locals.map((presentation) => presentation.applyCanonicalSnapshot(snapshot)));
        const layoutAuthority = this.layoutAuthority?.getSession() !== undefined
          ? this.layoutAuthority
          : globals.find((presentation) => presentation.getSession() !== undefined)
            ?? locals.find((presentation) => presentation.getSession() !== undefined);
        if (layoutAuthority) {
          if (!this.layoutAuthority) {
            this.layoutAuthority = layoutAuthority;
            layoutAuthority.setLayoutAuthority(true);
          }
          await this.enqueueWorldState(() => this.refreshSharedWorldFrom(layoutAuthority));
        }
        if (!this.reconcileAgain) this.canonicalDirty = false;
      } catch (error) {
        this.options.onError?.(asError(error));
      }
    } while (!this.disposed && this.presentations.size > 0 && this.reconcileAgain);
  }

  private async reconcileOnOpen(): Promise<void> {
    if (this.disposed || (!this.canonicalDirty && this.options.model.read())) return;
    await this.reconcile();
  }

  private scheduleReconcile(): void {
    this.cancelScheduledReconcile();
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.reconcile();
    }, Math.max(0, this.options.reconcileDelayMs ?? 180));
  }

  private cancelScheduledReconcile(): void {
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
  }

  private queueActiveNode(nodeId?: string, snapshot = this.workspaceSession.snapshot()): void {
    if (this.disposed || this.presentations.size === 0) return;
    this.pendingActiveNodeId = nodeId;
    this.pendingSessionSnapshot = snapshot;
    this.activeNodeQueued = true;
    if (this.activeNodeFollow) return;
    const operation = this.drainActiveNodeQueue();
    this.activeNodeFollow = operation;
    void operation.catch((error) => this.options.onError?.(asError(error))).finally(() => {
      if (this.activeNodeFollow === operation) this.activeNodeFollow = undefined;
      if (this.activeNodeQueued && !this.disposed && this.presentations.size > 0) {
        this.queueActiveNode(this.pendingActiveNodeId, this.pendingSessionSnapshot);
      }
    });
  }

  private discardPendingActiveNodes(): void {
    this.activeNodeGeneration += 1;
    this.pendingConstellationNodeIds.clear();
    this.pendingActiveNodeId = undefined;
    this.activeNodeQueued = false;
  }

  private async drainActiveNodeQueue(): Promise<void> {
    while (this.activeNodeQueued && !this.disposed && this.presentations.size > 0) {
      const generation = this.activeNodeGeneration;
      const nodeId = this.pendingActiveNodeId;
      const snapshot = this.pendingSessionSnapshot;
      const admittedNodeIds = [...this.pendingConstellationNodeIds];
      this.pendingConstellationNodeIds.clear();
      this.activeNodeQueued = false;
      await this.followActiveNode(nodeId);
      if (generation !== this.activeNodeGeneration) continue;
      await Promise.all([...this.presentations].map(
        presentation => presentation.addActiveNodesToConstellation(admittedNodeIds),
      ));
      if (generation !== this.activeNodeGeneration) continue;
      await Promise.all([...this.presentations].map(
        (presentation) => presentation.applySessionSnapshot(snapshot),
      ));
    }
  }

  private async refreshSharedWorldFrom(authority: GraphPlusPresentationV1<TFile>): Promise<void> {
    const state = await authority.exportWorldState();
    if (!state) return;
    this.sharedWorldState = clone(state);
    await Promise.all([...this.presentations]
      .filter((presentation) => presentation !== authority && presentation.getSession() !== undefined)
      .map((presentation) => presentation.adoptSharedWorldState(state)));
  }
}

/** @deprecated Use GraphPlusApplicationV1 to create managed presentations. */
export const GraphPlusConsumerV1 = GraphPlusPresentationV1;
export type GraphPlusConsumerOptionsV1<TFile> = GraphPlusPresentationOptionsV1<TFile>;

function stripGraphPlusRenderFilter(state: GraphViewStateV1): GraphViewStateV1 {
  const { render: _render, ...activeFilters } = state.activeFilters;
  return { ...state, activeFilters };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
function sameNodeIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((nodeId, index) => nodeId === right[index]);
}
function settledForceLayoutState() {
  return { schemaVersion: 1, alpha: 0, alphaTarget: 0, running: false, velocities: {} };
}
