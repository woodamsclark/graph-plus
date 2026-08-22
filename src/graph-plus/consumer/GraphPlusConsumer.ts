import type {
  Disposable,
  GraphDocumentV1,
  GraphEngineLeaseV1,
  GraphSessionErrorV1,
  GraphSessionV1,
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
  readonly profileId?: string;
  readonly dimensions?: '2d' | '3d';
  readonly clock?: GraphPlusCheckpointClockV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
}

export class GraphPlusConsumerV1<TFile> {
  private readonly adapter: VaultGraphAdapterV1<TFile>;
  private readonly checkpoint: GraphPlusCheckpointControllerV1;
  private readonly profileId: string;
  private readonly dimensions: '2d' | '3d';
  private lens: GraphPlusLensStateV1;
  private session?: GraphSessionV1;
  private lookup = new GraphPlusLookupV1<TFile>();
  private document?: GraphDocumentV1;
  private sessionSubscriptions: Disposable[] = [];
  private opened = false;
  private leaseReleased = false;
  private lensQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: GraphPlusConsumerOptionsV1<TFile>) {
    this.adapter = new VaultGraphAdapterV1({ countDuplicateLinks: options.countDuplicateLinks });
    this.checkpoint = new GraphPlusCheckpointControllerV1(
      options.vaultId,
      options.checkpointStore,
      options.clock,
    );
    this.profileId = options.profileId ?? 'default';
    this.dimensions = options.dimensions ?? '3d';
    this.lens = clone(options.initialLens ?? createDefaultGraphPlusLensV1());
  }

  async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    try {
      const saved = await this.options.checkpointStore.load(this.options.vaultId);
      if (saved) {
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
        const migrated = migrateLegacyPositionsV1(projection.document, this.options.legacyPositions, {
          profileId: this.profileId,
          dimensions: this.dimensions,
        });
        await this.mount(projection.document, migrated);
        this.checkpoint.schedule();
      }
    } catch (error) {
      this.opened = false;
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
      const state = await this.session.exportViewState();
      await this.checkpoint.flush();
      this.checkpoint.detach();
      this.sessionSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
      await this.session.dispose();
      await this.mount(this.document, state);
    } else {
      await this.applyFilter();
    }
    this.checkpoint.schedule();
  }

  getLens(): GraphPlusLensStateV1 {
    return clone(this.lens);
  }

  getDocument(): GraphDocumentV1 | undefined {
    return this.document ? clone(this.document) : undefined;
  }

  getSession(): GraphSessionV1 | undefined {
    return this.session;
  }

  async close(): Promise<void> {
    this.opened = false;
    await this.lensQueue.catch(() => undefined);
    this.sessionSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
    try {
      await this.checkpoint.closeAndDispose();
    } finally {
      this.session = undefined;
      this.document = undefined;
      this.lookup = new GraphPlusLookupV1<TFile>();
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
    });
    this.session = session;
    this.document = document;
    this.checkpoint.attach(session);
    this.sessionSubscriptions.push(session.onIntent((intent) => {
      if (intent.type !== 'node-activated') return;
      const entry = this.lookup.get(intent.nodeId);
      if (entry?.kind === 'note') void this.options.navigator.openNote(entry.file);
      if (entry?.kind === 'tag') void this.options.navigator.openTag(entry.tag);
    }));
    this.sessionSubscriptions.push(session.onError((error) => this.options.onError?.(error)));
    await this.applyFilter();
  }

  private compatibleViewState(document: GraphDocumentV1, state: GraphViewStateV1): GraphViewStateV1 | undefined {
    try {
      return reconcileGraphViewStateV1(state, {
        document,
        consumerId: 'graph-plus',
        profileId: this.profileId,
        dimensions: this.dimensions,
      });
    } catch {
      return undefined;
    }
  }

  private async applyFilter(): Promise<void> {
    if (!this.session || !this.document) return;
    const compiled = compileGraphPlusFilterV1(this.document, this.lens);
    if (compiled.error) this.options.onError?.(new Error(compiled.error));
    await this.session.applyFilter(compiled.request);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
