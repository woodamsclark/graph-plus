import type { GraphDocumentV1 } from '../../graph-engine/contracts/v1/index.ts';
import {
  GraphPlusLookupV1,
  VaultGraphAdapterV1,
  type VaultGraphProjectionV1,
  type VaultGraphSnapshotV1,
} from '../adapter/index.ts';
import type { GraphNodeSearchIndexV1 } from '../query/index.ts';

export interface GraphPlusVaultSourceV1<TFile> {
  read(): VaultGraphSnapshotV1<TFile> | Promise<VaultGraphSnapshotV1<TFile>>;
}

export interface GraphPlusVaultModelSnapshotV1<TFile> {
  readonly document: GraphDocumentV1;
  readonly lookup: GraphPlusLookupV1<TFile>;
  readonly searchIndex: GraphNodeSearchIndexV1;
}

/**
 * One canonical Graph+ interpretation of the vault. Experiences derive different
 * documents from this snapshot instead of adapting the same vault independently.
 */
export class GraphPlusVaultModelV1<TFile> {
  private adapter: VaultGraphAdapterV1<TFile>;
  private countDuplicateLinks: boolean;
  private current?: VaultGraphProjectionV1<TFile>;
  private tail: Promise<void> = Promise.resolve();
  private opening?: Promise<GraphPlusVaultModelSnapshotV1<TFile>>;
  private reconciling?: Promise<GraphPlusVaultModelSnapshotV1<TFile>>;

  constructor(
    private readonly source: GraphPlusVaultSourceV1<TFile>,
    options: { readonly countDuplicateLinks: boolean },
  ) {
    this.countDuplicateLinks = options.countDuplicateLinks;
    this.adapter = new VaultGraphAdapterV1(options);
  }

  setCountDuplicateLinks(value: boolean): boolean {
    if (value === this.countDuplicateLinks) return false;
    this.countDuplicateLinks = value;
    this.adapter = new VaultGraphAdapterV1({ countDuplicateLinks: value });
    return true;
  }

  read(): GraphPlusVaultModelSnapshotV1<TFile> | undefined {
    return this.current;
  }

  open(): Promise<GraphPlusVaultModelSnapshotV1<TFile>> {
    if (this.current) return Promise.resolve(this.current);
    if (this.opening) return this.opening;
    if (this.reconciling) return this.reconciling;
    const opening = this.enqueue(async () => {
      if (this.current) return this.current;
      this.current = this.adapter.build(await this.source.read());
      return this.current;
    });
    this.opening = opening;
    void opening.then(
      () => { if (this.opening === opening) this.opening = undefined; },
      () => { if (this.opening === opening) this.opening = undefined; },
    );
    return opening;
  }

  reconcile(): Promise<GraphPlusVaultModelSnapshotV1<TFile>> {
    if (this.reconciling) return this.reconciling;
    if (this.opening) return this.opening;
    const reconciling = this.enqueue(async () => {
      const snapshot = await this.source.read();
      this.current = this.current
        ? this.adapter.reconcile(this.current.document, snapshot)
        : this.adapter.build(snapshot);
      return this.current;
    });
    this.reconciling = reconciling;
    void reconciling.then(
      () => { if (this.reconciling === reconciling) this.reconciling = undefined; },
      () => { if (this.reconciling === reconciling) this.reconciling = undefined; },
    );
    return reconciling;
  }

  private enqueue(
    operation: () => Promise<GraphPlusVaultModelSnapshotV1<TFile>>,
  ): Promise<GraphPlusVaultModelSnapshotV1<TFile>> {
    const next = this.tail.catch(() => undefined).then(operation);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
