import type {
  Disposable,
  GraphDocumentV1,
  GraphEffectiveSettingsV1,
  GraphEngineLeaseV1,
  GraphSessionErrorV1,
  GraphSessionUiOptionsV1,
  GraphSessionV1,
  GraphSettingsOverridesV1,
  GraphViewStateV1,
} from '../../graph-engine/contracts/v1/index.ts';
import { reconcileGraphViewStateV1 } from '../../graph-engine/public.ts';
import {
  GraphPlusLookupV1,
  VaultGraphAdapterV1,
  type VaultGraphSnapshotV1,
} from '../adapter/index.ts';
import {
  GraphPlusCheckpointControllerV1,
  migrateLegacyPositionsV1,
  type GraphPlusCheckpointClockV1,
  type GraphPlusCheckpointStoreV1,
} from '../persistence/index.ts';
import {
  compileGraphPlusFilterV1,
  createDefaultGraphPlusLensV1,
  graphPlusSessionOverridesV1,
  type GraphPlusLensStateV1,
  type ObsidianSearchIndexV1,
} from '../query/index.ts';

export interface GraphPlusVaultSourceV1<TFile> {
  read(): VaultGraphSnapshotV1<TFile> | Promise<VaultGraphSnapshotV1<TFile>>;
}

export interface GraphPlusNavigatorV1<TFile> {
  openNote(file: TFile): Promise<void>;
  openTag(tag: string): Promise<void>;
}

export interface GraphPlusConsumerOptionsV1<TFile> {
  readonly lease: GraphEngineLeaseV1;
  readonly container: HTMLElement;
  readonly vaultId: string;
  readonly source: GraphPlusVaultSourceV1<TFile>;
  readonly checkpointStore: GraphPlusCheckpointStoreV1;
  readonly navigator: GraphPlusNavigatorV1<TFile>;
  readonly countDuplicateLinks: boolean;
  readonly legacyPositions?: unknown;
  readonly initialLens?: GraphPlusLensStateV1;
  readonly restoreSavedLens?: boolean;
  readonly profileId?: string;
  readonly dimensions?: '2d' | '3d';
  readonly ui?: GraphSessionUiOptionsV1;
  readonly clock?: GraphPlusCheckpointClockV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
}

export class GraphPlusConsumerV1<TFile> {
  private readonly adapter: VaultGraphAdapterV1<TFile>;
  private readonly checkpoint: GraphPlusCheckpointControllerV1;
  private readonly profileId: string;
  private readonly dimensions: '2d' | '3d';
  private lens: GraphPlusLensStateV1;
  private effectiveSettings?: GraphEffectiveSettingsV1;
  private session?: GraphSessionV1;
  private lookup = new GraphPlusLookupV1<TFile>();
  private searchIndex: ObsidianSearchIndexV1 = new Map();
  private document?: GraphDocumentV1;
  private sessionSubscriptions: Disposable[] = [];
  private actionRegistration?: Disposable;
  private opened = false;
  private leaseReleased = false;
  private lensQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: GraphPlusConsumerOptionsV1<TFile>) {
    this.adapter = new VaultGraphAdapterV1({ countDuplicateLinks: options.countDuplicateLinks });
    this.lens = clone(options.initialLens ?? createDefaultGraphPlusLensV1());
    this.checkpoint = new GraphPlusCheckpointControllerV1(
      options.vaultId,
      options.checkpointStore,
      options.clock,
      500,
      () => clone(this.lens),
    );
    this.profileId = options.profileId ?? 'default';
    this.dimensions = options.dimensions ?? '2d';
  }

  async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    try {
      this.actionRegistration = this.options.lease.registerNodeActions([{
        id: 'open-node',
        label: (context) => this.nodeKind(context.nodeId) === 'tag' ? 'Open tag' : 'Open note',
        icon: 'file-text',
        isAvailable: (context) => this.nodeKind(context.nodeId) !== undefined,
        run: (context) => this.openNode(context.nodeId),
      }]);
      const saved = await this.options.checkpointStore.load(this.options.vaultId);
      if (saved) {
        if (saved.lens && this.options.restoreSavedLens !== false) this.lens = clone(saved.lens);
        const migrated = saved.viewState ?? migrateLegacyPositionsV1(saved.document, this.options.legacyPositions, {
          profileId: this.profileId,
          dimensions: this.dimensions,
        });
        await this.mount(saved.document, migrated);
        await this.reconcile();
      } else {
        const snapshot = await this.options.source.read();
        const projection = this.adapter.build(snapshot);
        this.lookup = projection.lookup;
        this.searchIndex = projection.searchIndex;
        const migrated = migrateLegacyPositionsV1(projection.document, this.options.legacyPositions, {
          profileId: this.profileId,
          dimensions: this.dimensions,
        });
        await this.mount(projection.document, migrated);
        this.checkpoint.schedule();
      }
    } catch (error) {
      this.opened = false;
      this.actionRegistration?.dispose();
      this.actionRegistration = undefined;
      this.options.onError?.(asError(error));
      throw error;
    }
  }

  async reconcile(): Promise<void> {
    if (!this.session || !this.document) return;
    try {
      const snapshot = await this.options.source.read();
      const projection = this.adapter.reconcile(this.document, snapshot);
      this.lookup = projection.lookup;
      this.searchIndex = projection.searchIndex;
      if (projection.document !== this.document) {
        await this.session.replaceDocument(projection.document);
        this.document = projection.document;
      }
      await this.applyFilter();
      this.checkpoint.schedule();
    } catch (error) {
      this.options.onError?.(asError(error));
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
    await this.applyFilter();
    this.checkpoint.schedule();
  }

  getLens(): GraphPlusLensStateV1 {
    return clone(this.lens);
  }

  getEffectiveSettings(): GraphEffectiveSettingsV1 | undefined {
    return this.effectiveSettings ? clone(this.effectiveSettings) : undefined;
  }

  getDocument(): GraphDocumentV1 | undefined {
    return this.document ? clone(this.document) : undefined;
  }

  getSession(): GraphSessionV1 | undefined {
    return this.session;
  }

  async focusNode(nodeId: string): Promise<void> {
    if (!this.session) return;
    await this.session.setSelection([nodeId]);
    await this.session.focusNode(nodeId);
  }

  async mindMapFromNode(nodeId: string): Promise<void> {
    if (!this.document?.nodes.some((node) => node.id === nodeId)) return;
    const next: GraphPlusLensStateV1 = {
      ...clone(this.lens),
      form: { ...this.lens.form, rootNodeId: nodeId, enabled: true },
    };
    await this.setLens(next);
    await this.session?.setSelection([nodeId]);
    await this.session?.fitNodes();
  }

  async openNode(nodeId: string): Promise<void> {
    const entry = this.lookup.get(nodeId);
    if (entry?.kind === 'note') await this.options.navigator.openNote(entry.file);
    if (entry?.kind === 'tag') await this.options.navigator.openTag(entry.tag);
  }

  nodeKind(nodeId: string): 'note' | 'tag' | undefined {
    return this.lookup.get(nodeId)?.kind;
  }

  async setNodePinned(nodeId: string, pinned: boolean): Promise<void> {
    await this.session?.setNodePinned(nodeId, pinned);
  }

  async close(): Promise<void> {
    this.opened = false;
    await this.lensQueue.catch(() => undefined);
    this.sessionSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
    this.actionRegistration?.dispose();
    this.actionRegistration = undefined;
    try {
      await this.checkpoint.closeAndDispose();
    } finally {
      this.session = undefined;
      this.effectiveSettings = undefined;
      this.document = undefined;
      this.lookup = new GraphPlusLookupV1<TFile>();
      this.searchIndex = new Map();
      if (!this.leaseReleased) {
        this.leaseReleased = true;
        await this.options.lease.release();
      }
    }
  }

  private async mount(document: GraphDocumentV1, restoreViewState?: GraphViewStateV1): Promise<void> {
    const compatibleViewState = restoreViewState ? this.compatibleViewState(document, restoreViewState) : undefined;
    const session = await this.options.lease.createSession({
      consumerId: 'graph-plus',
      profileId: this.profileId,
      container: this.options.container,
      document,
      restoreViewState: compatibleViewState,
      sessionOverrides: graphPlusSessionOverridesV1(this.lens),
      ui: this.options.ui,
      onSessionOverridesChanged: (overrides) => this.adoptSessionOverrides(overrides),
    });
    this.session = session;
    this.effectiveSettings = await session.exportEffectiveSettings();
    this.document = document;
    this.checkpoint.attach(session, document);
    this.sessionSubscriptions.push(session.onError((error) => this.options.onError?.(error)));
    await this.applyFilter();
  }

  private adoptSessionOverrides(overrides: GraphSettingsOverridesV1): void {
    const form = overrides.modules?.form;
    const settings = form?.settings ?? {};
    const direction = settings.direction;
    const edgeToken = settings.edgeToken;
    const maxDepth = settings.maxDepth;
    this.lens = {
      ...this.lens,
      form: {
        enabled: form?.enabled ?? this.lens.form.enabled,
        ...(typeof settings.rootNodeId === 'string' ? { rootNodeId: settings.rootNodeId } : {}),
        direction: direction === 'incoming' || direction === 'outgoing' ? direction : 'either',
        ...(typeof edgeToken === 'string' && edgeToken.startsWith('relation:')
          ? { relation: edgeToken.slice('relation:'.length) }
          : {}),
        ...(typeof maxDepth === 'number' && Number.isSafeInteger(maxDepth) ? { maxDepth } : {}),
        showCrossLinks: settings.showCrossLinks !== false,
        showDisconnected: settings.showDisconnected === true,
        colorBranches: settings.colorBranches !== false,
      },
    };
    this.checkpoint.schedule();
  }

  private compatibleViewState(document: GraphDocumentV1, state: GraphViewStateV1): GraphViewStateV1 | undefined {
    try {
      return reconcileGraphViewStateV1(state, {
        document,
        consumerId: 'graph-plus',
        profileId: this.profileId,
        dimensions: state.dimensions,
      });
    } catch {
      return undefined;
    }
  }

  private async applyFilter(): Promise<void> {
    if (!this.session || !this.document) return;
    const compiled = compileGraphPlusFilterV1(this.document, this.lens, this.searchIndex);
    if (compiled.error) this.options.onError?.(new Error(compiled.error));
    const rootId = this.lens.form.rootNodeId;
    if (this.lens.form.enabled && rootId && !compiled.visibleNodeIds.includes(rootId)) {
      this.lens = { ...this.lens, form: { ...this.lens.form, enabled: false } };
      await this.session.setSessionOverrides(graphPlusSessionOverridesV1(this.lens));
      this.effectiveSettings = await this.session.exportEffectiveSettings();
      this.options.onError?.(new Error('Mind Map paused because its selected root is hidden by the active filter.'));
    }
    await this.session.applyFilter(compiled.request);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
