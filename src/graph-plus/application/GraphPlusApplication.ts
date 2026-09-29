import type {
  Disposable, GraphDocumentV1, GraphEffectiveSettingsV1, GraphEngineLeaseV1,
  GraphIntentV1, GraphSessionErrorV1, GraphSessionUiOptionsV1, GraphSessionV1, GraphViewStateV1,
} from '../../graph-engine/contracts/v1/index.ts';
import { reconcileGraphViewStateV1 } from '../../graph-engine/public.ts';
import { GraphPlusLookupV1 } from '../adapter/index.ts';
import {
  projectGraphPlusExperienceDocumentV1,
  sameGraphPlusExperienceDocumentV1,
} from './GraphPlusDocumentProjection.ts';
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
  readonly initialDepth?: number;
  readonly profileId?: string;
  readonly dimensions?: '2d' | '3d';
  readonly ui?: GraphSessionUiOptionsV1;
  readonly clock?: GraphPlusCheckpointClockV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
  readonly onNotePreview?: (request: {
    readonly nodeId?: string; readonly file?: TFile;
    readonly anchor?: { readonly x: number; readonly y: number };
    readonly active: boolean; readonly immediate?: boolean;
  }) => void;
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
  private leaseReleased = false;
  private lensQueue: Promise<void> = Promise.resolve();
  private transientRevealNodeId?: string;
  private resettingLayout = false;
  private visibleNodeIds = new Set<string>();
  private rootNodeId?: string;
  private depth: number;
  private enforcingPolicy = false;

  constructor(private readonly options: GraphPlusPresentationOptionsV1<TFile>) {
    this.policy = graphPlusExperiencePolicyV1(options.mode ?? 'global');
    if (!options.model && !options.source) throw new Error('Graph+ requires a vault model or vault source.');
    this.model = options.model ?? new GraphPlusVaultModelV1(options.source!, {
      countDuplicateLinks: options.countDuplicateLinks ?? false,
    });
    this.lens = clone(options.initialLens ?? createDefaultGraphPlusLensV1());
    this.profileId = options.profileId ?? 'default';
    this.dimensions = options.dimensions ?? '2d';
    this.rootNodeId = options.initialRootNodeId;
    this.depth = localDepth(options.initialDepth);
    if (this.policy.persistence === 'checkpoint') {
      if (!options.vaultId || !options.checkpointStore) {
        throw new Error('Global Graph+ requires vault checkpoint storage.');
      }
      this.checkpoint = new GraphPlusCheckpointControllerV1(
        options.vaultId, options.checkpointStore, options.clock, 500,
        () => clone(this.lens), stripGraphPlusProjectionFilter,
      );
    }
  }

  get mode(): GraphPlusExperienceModeV1 { return this.policy.mode; }
  get experiencePolicy(): GraphPlusExperiencePolicyV1 { return this.policy; }

  async open(): Promise<void> {
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
      }]);
      if (this.policy.persistence === 'checkpoint') await this.openGlobal();
      else await this.openLocal();
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
      await this.applyCanonicalSnapshot(await this.model.open());
      return;
    }
    const model = await this.model.open();
    this.adoptModel(model);
    const migrated = migrateLegacyPositionsV1(model.document, this.options.legacyPositions, {
      profileId: this.profileId, dimensions: this.dimensions,
    });
    await this.mount(model.document, migrated);
    this.checkpoint?.schedule();
  }

  private async openLocal(): Promise<void> {
    const model = await this.model.open();
    this.adoptModel(model);
    await this.mount(this.projectDocument());
    await this.enforceExperiencePolicy();
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
    if (this.policy.documentScope === 'vault') {
      if (model.document !== this.document) {
        await this.session.replaceDocument(model.document);
        this.document = model.document;
      }
      await this.applyFilter();
      this.checkpoint?.schedule();
    } else {
      await this.replaceProjectedDocument();
    }
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
    if (this.policy.documentScope === 'vault') {
      await this.applyFilter();
      this.checkpoint?.schedule();
    } else await this.replaceProjectedDocument();
  }

  getLens(): GraphPlusLensStateV1 { return clone(this.lens); }
  getEffectiveSettings(): GraphEffectiveSettingsV1 | undefined {
    return this.effectiveSettings ? clone(this.effectiveSettings) : undefined;
  }
  getDocument(): GraphDocumentV1 | undefined {
    const value = this.policy.documentScope === 'vault' ? this.document : this.canonicalDocument;
    return value ? clone(value) : undefined;
  }
  getProjectedDocument(): GraphDocumentV1 | undefined { return this.document ? clone(this.document) : undefined; }
  getLocalDocument(): GraphDocumentV1 | undefined { return this.getProjectedDocument(); }
  getSession(): GraphSessionV1 | undefined { return this.session; }
  getLocalDepth(): number { return this.depth; }

  async setLocalDepth(depth: number): Promise<void> {
    if (this.policy.documentScope !== 'root-neighborhood') return;
    const next = localDepth(depth);
    if (next === this.depth) return;
    this.depth = next;
    await this.replaceProjectedDocument();
  }

  async followActiveNode(nodeId?: string): Promise<boolean> {
    if (!this.policy.followActiveNote || !this.session) return false;
    if (nodeId === undefined) {
      if (this.rootNodeId === undefined && this.document?.nodes.length === 0) {
        await this.enforceExperiencePolicy();
        return true;
      }
      this.rootNodeId = undefined;
      await this.replaceProjectedDocument(true);
      return true;
    }
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)) await this.reconcile();
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)) return false;
    if (this.rootNodeId === nodeId) {
      await this.enforceExperiencePolicy();
      return true;
    }
    this.rootNodeId = nodeId;
    await this.replaceProjectedDocument(true);
    return true;
  }

  async focusNode(nodeId: string): Promise<void> {
    if (!this.session) return;
    await this.session.clearPreview();
    await this.session.setSelection([nodeId]);
    await this.session.focusNode(nodeId);
  }

  async revealAndFocusNode(nodeId: string): Promise<boolean> {
    const source = this.canonicalDocument ?? this.document;
    if (!this.session || !source) return false;
    if (!source.nodes.some((node) => node.id === nodeId)) await this.reconcile();
    if (!(this.canonicalDocument ?? this.document)?.nodes.some((node) => node.id === nodeId)) return false;
    if (this.policy.documentScope === 'root-neighborhood') {
      this.rootNodeId = nodeId;
      await this.replaceProjectedDocument(true);
      return true;
    }
    this.transientRevealNodeId = nodeId;
    await this.session.clearPreview();
    await this.applyFilter();
    await this.session.setSelection([nodeId]);
    await this.session.focusNode(nodeId);
    return true;
  }

  async mindMapFromNode(nodeId: string): Promise<void> {
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)
      && !this.document?.nodes.some((node) => node.id === nodeId)) return;
    await this.setLens({ ...clone(this.lens), form: { ...this.lens.form, rootNodeId: nodeId, enabled: true } });
    await this.session?.setSelection([nodeId]);
  }

  async openNode(nodeId: string): Promise<void> {
    const entry = this.lookup.get(nodeId);
    if (entry?.kind === 'note') await this.options.navigator.openNote(entry.file);
    if (entry?.kind === 'tag') await this.options.navigator.openTag(entry.tag);
  }
  nodeKind(nodeId: string): 'note' | 'tag' | undefined { return this.lookup.get(nodeId)?.kind; }
  async setNodePinned(nodeId: string, pinned: boolean): Promise<void> { await this.session?.setNodePinned(nodeId, pinned); }
  setSuspended(suspended: boolean): void { this.session?.setSuspended(suspended); }
  async setPreviewSurfaceActive(active: boolean): Promise<void> { await this.session?.setPreviewSurfaceActive(active); }
  async clearPreview(): Promise<void> { await this.session?.clearPreview(); }

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

  async close(): Promise<void> {
    this.opened = false;
    await this.lensQueue.catch(() => undefined);
    this.disposeSessionSubscriptions();
    this.actionRegistration?.dispose();
    this.actionRegistration = undefined;
    try {
      if (this.checkpoint) await this.checkpoint.closeAndDispose();
      else await this.session?.dispose();
    } finally {
      this.session = undefined;
      this.effectiveSettings = undefined;
      this.document = undefined;
      this.canonicalDocument = undefined;
      this.lookup = new GraphPlusLookupV1<TFile>();
      this.searchIndex = new Map();
      this.transientRevealNodeId = undefined;
      this.visibleNodeIds.clear();
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
      sessionOverrides: graphPlusSessionOverridesV1(this.lens), ui: this.options.ui,
      onSessionOverridesChanged: (overrides) => this.adoptSessionOverrides(overrides),
    });
    this.session = session;
    this.effectiveSettings = await session.exportEffectiveSettings();
    this.document = document;
    this.checkpoint?.attach(session, document);
    this.sessionSubscriptions.push(session.onError((error) => this.options.onError?.(error)));
    this.sessionSubscriptions.push(session.onIntent((intent) => this.handleIntent(intent, session)));
    if (this.policy.documentScope === 'vault') await this.applyFilter();
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
  }

  private adoptModel(model: GraphPlusVaultModelSnapshotV1<TFile>): void {
    this.canonicalDocument = model.document;
    this.lookup = model.lookup;
    this.searchIndex = model.searchIndex;
  }

  private async replaceProjectedDocument(enforceCanonicalRoot = false): Promise<void> {
    if (!this.session) return;
    const projected = this.projectDocument();
    if (!sameGraphPlusExperienceDocumentV1(this.document, projected)) {
      await this.session.replaceDocument(projected);
      this.document = projected;
    }
    if (enforceCanonicalRoot) {
      await this.enforceExperiencePolicy();
      return;
    }
    const state = await this.session.exportViewState();
    const focusRemainsValid = state.focusedNodeId !== undefined
      && state.selectedNodeIds.includes(state.focusedNodeId)
      && projected.nodes.some((node) => node.id === state.focusedNodeId);
    if (!focusRemainsValid) await this.enforceExperiencePolicy();
  }

  private projectDocument(): GraphDocumentV1 {
    return projectGraphPlusExperienceDocumentV1({
      policy: this.policy,
      canonicalDocument: this.canonicalDocument,
      rootNodeId: this.rootNodeId,
      depth: this.depth,
      lens: this.lens,
      searchIndex: this.searchIndex,
      onError: (error) => this.options.onError?.(error),
    });
  }

  private async enforceExperiencePolicy(): Promise<void> {
    if (this.enforcingPolicy || this.policy.canonicalRootState === 'none') return;
    const root = this.rootNodeId;
    if (!this.session) return;
    if (root && !this.document?.nodes.some((node) => node.id === root)) return;
    this.enforcingPolicy = true;
    try {
      const state = await this.session.exportViewState();
      const consciousStateChanged = root
        ? state.selectedNodeIds.length !== 1
          || state.selectedNodeIds[0] !== root
          || state.focusedNodeId !== root
        : state.selectedNodeIds.length > 0 || state.focusedNodeId !== undefined;
      const result = await this.session.applyExternalInfluence({
        schemaVersion: 1,
        type: 'replace-attention',
        nodeIds: root ? [root] : [],
        ...(root ? { focusNodeId: root } : {}),
        framing: consciousStateChanged ? 'fit-state' : 'preserve',
      });
      if (result.status === 'rejected') {
        throw new Error(`Graph+ experience rejected canonical subject: ${result.reason}`);
      }
      if (root) {
        if (!state.pinnedNodeIds.includes(root)) await this.session.setNodePinned(root, true);
      }
    } finally { this.enforcingPolicy = false; }
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
    if (this.lens.form.enabled && rootId && !compiled.visibleNodeIds.includes(rootId)) {
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
}

export type GraphPlusPresentationAttachOptionsV1<TFile> = Omit<
  GraphPlusPresentationOptionsV1<TFile>,
  'model' | 'navigator' | 'source' | 'countDuplicateLinks'
>;

export type GraphPlusHostEventV1 =
  | { readonly type: 'canonical-vault-invalidated' }
  | { readonly type: 'active-note-changed'; readonly nodeId?: string };

/**
 * The single Graph+ application. It owns canonical vault reconciliation and
 * distributes received truth to independent Global and Local presentations.
 */
export class GraphPlusApplicationV1<TFile> {
  private readonly presentations = new Set<GraphPlusPresentationV1<TFile>>();
  private readonly hostActivityListeners = new Set<() => void>();
  private reconcileTimer?: ReturnType<typeof setTimeout>;
  private reconcileRunning?: Promise<void>;
  private reconcileAgain = false;
  private activeNodeQueued = false;
  private pendingActiveNodeId?: string;
  private activeNodeFollow?: Promise<void>;

  constructor(private readonly options: GraphPlusApplicationOptionsV1<TFile>) {}

  createPresentation(
    options: GraphPlusPresentationAttachOptionsV1<TFile>,
  ): GraphPlusPresentationV1<TFile> {
    const presentation = new GraphPlusPresentationV1({
      ...options,
      model: this.options.model,
      navigator: this.options.navigator,
    });
    this.presentations.add(presentation);
    return presentation;
  }

  async closePresentation(presentation: GraphPlusPresentationV1<TFile>): Promise<void> {
    if (!this.presentations.delete(presentation)) return;
    await presentation.close();
  }

  onHostActivity(listener: () => void): Disposable {
    this.hostActivityListeners.add(listener);
    return { dispose: () => this.hostActivityListeners.delete(listener) };
  }

  receiveHostEvent(event: GraphPlusHostEventV1): void {
    if (event.type === 'canonical-vault-invalidated') {
      this.scheduleReconcile();
      return;
    }
    if (event.type === 'active-note-changed') this.queueActiveNode(event.nodeId);
    for (const listener of this.hostActivityListeners) listener();
  }

  scheduleReconcile(delayMs = 180): void {
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.reconcile();
    }, delayMs);
  }

  async reconcile(): Promise<void> {
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    if (this.reconcileRunning) {
      this.reconcileAgain = true;
      return this.reconcileRunning;
    }
    const operation = this.reconcileUntilSettled();
    this.reconcileRunning = operation;
    try { await operation; } finally {
      if (this.reconcileRunning === operation) this.reconcileRunning = undefined;
    }
  }

  async followActiveNode(nodeId?: string): Promise<void> {
    const locals = [...this.presentations].filter((presentation) => presentation.experiencePolicy.followActiveNote);
    if (nodeId && !this.options.model.read()?.document.nodes.some((node) => node.id === nodeId)) {
      await this.reconcile();
    }
    await Promise.all(locals.map((presentation) => presentation.followActiveNode(nodeId)));
  }

  async dispose(): Promise<void> {
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    await this.reconcileRunning?.catch(() => undefined);
    await this.activeNodeFollow?.catch(() => undefined);
    await Promise.all([...this.presentations].map((presentation) => presentation.close()));
    this.presentations.clear();
    this.hostActivityListeners.clear();
  }

  private async reconcileUntilSettled(): Promise<void> {
    do {
      this.reconcileAgain = false;
      try {
        const snapshot = await this.options.model.reconcile();
        await Promise.all([...this.presentations].map(
          (presentation) => presentation.applyCanonicalSnapshot(snapshot),
        ));
      } catch (error) {
        this.options.onError?.(asError(error));
      }
    } while (this.reconcileAgain);
  }

  private queueActiveNode(nodeId?: string): void {
    this.pendingActiveNodeId = nodeId;
    this.activeNodeQueued = true;
    if (this.activeNodeFollow) return;
    const operation = this.drainActiveNodeQueue();
    this.activeNodeFollow = operation;
    void operation.catch((error) => this.options.onError?.(asError(error))).finally(() => {
      if (this.activeNodeFollow === operation) this.activeNodeFollow = undefined;
      if (this.activeNodeQueued) this.queueActiveNode(this.pendingActiveNodeId);
    });
  }

  private async drainActiveNodeQueue(): Promise<void> {
    while (this.activeNodeQueued) {
      const nodeId = this.pendingActiveNodeId;
      this.activeNodeQueued = false;
      await this.followActiveNode(nodeId);
    }
  }
}

/** @deprecated Use GraphPlusApplicationV1 to create managed presentations. */
export const GraphPlusConsumerV1 = GraphPlusPresentationV1;
export type GraphPlusConsumerOptionsV1<TFile> = GraphPlusPresentationOptionsV1<TFile>;

function localDepth(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.round(value))) : 1;
}
function stripGraphPlusProjectionFilter(state: GraphViewStateV1): GraphViewStateV1 {
  const { projection: _projection, ...activeFilters } = state.activeFilters;
  return { ...state, activeFilters };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
