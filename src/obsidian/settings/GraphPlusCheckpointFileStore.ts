import {
  type GraphPlusCheckpointSaveOptionsV1,
  type GraphPlusCheckpointStoreV1,
  type GraphPlusCheckpointV1,
  validateGraphPlusCheckpointV1,
} from '../../graph-plus/persistence/index.ts';
import {
  readGraphPlusCheckpointReferenceV1,
  readGraphPlusCheckpointV1,
  validateGraphPlusCheckpointReferenceV1,
  withGraphPlusCheckpointReferenceV1,
  type GraphPlusCheckpointReferenceV1,
  type GraphPlusPluginDataV1,
} from './GraphPlusPluginDataStore.ts';

export interface GraphPlusCheckpointFileAdapterV1 {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface GraphPlusCheckpointFileStoreOptionsV1 {
  readonly adapter: GraphPlusCheckpointFileAdapterV1;
  readonly directory: string;
  readonly getData: () => GraphPlusPluginDataV1;
  readonly setData: (data: GraphPlusPluginDataV1) => void;
  readonly persistData: () => Promise<void>;
  readonly createNonce?: () => string;
}

export type GraphPlusCheckpointRecoveryReasonV1 =
  | 'missing-file' | 'inaccessible-file' | 'corrupt-json' | 'invalid-checkpoint';

export class GraphPlusCheckpointRecoveryErrorV1 extends Error {
  constructor(readonly vaultId: string, readonly reason: GraphPlusCheckpointRecoveryReasonV1) {
    super(`Graph+ could not recover the saved layout (${reason.replace(/-/g, ' ')}). Your saved data has been preserved. Retry, restore the previous layout, or explicitly reset the saved layout.`);
    this.name = 'GraphPlusCheckpointRecoveryError';
  }
}

/** Large documents live outside data.json; one previous generation remains recoverable. */
export class GraphPlusCheckpointFileStoreV1 implements GraphPlusCheckpointStoreV1 {
  private readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly failures = new Map<string, GraphPlusCheckpointRecoveryErrorV1>();
  private readonly verifiedVaults = new Set<string>();

  constructor(private readonly options: GraphPlusCheckpointFileStoreOptionsV1) {
    this.directory = normalizePath(options.directory);
  }

  load(vaultId: string): Promise<GraphPlusCheckpointV1 | undefined> {
    return this.enqueue(() => this.loadCurrent(vaultId));
  }

  save(vaultId: string, checkpoint: GraphPlusCheckpointV1, options?: GraphPlusCheckpointSaveOptionsV1): Promise<void> {
    return this.enqueue(() => this.saveCurrent(vaultId, checkpoint, options));
  }

  async drain(): Promise<void> { await this.queue; }

  hasPrevious(vaultId: string): boolean {
    return validateGraphPlusCheckpointReferenceV1(this.options.getData().consumers.graphPlus.checkpointBackups?.[vaultId]) !== undefined;
  }

  /** Explicit user recovery only. Archive failed metadata before replacing its reference. */
  recover(vaultId: string, action: 'previous' | 'reset'): Promise<void> {
    return this.enqueue(async () => {
      if (action === 'previous') {
        await this.readStored(vaultId, this.options.getData().consumers.graphPlus.checkpointBackups?.[vaultId]);
      }
      const data = this.options.getData();
      const graphPlus = data.consumers.graphPlus;
      const previous = graphPlus.checkpointBackups?.[vaultId];
      if (action === 'previous' && !previous) throw new Error('No previous Graph+ checkpoint is available.');
      await this.ensureDirectory();
      const archive = `${this.directory}/${hashString(vaultId)}-recovery-${Date.now()}-${this.nonce()}.json`;
      await this.options.adapter.write(archive, JSON.stringify({
        vaultId, checkpoint: graphPlus.checkpoints?.[vaultId], previous,
        document: graphPlus.graphDocuments?.[vaultId], viewState: graphPlus.viewStates?.[vaultId],
        legacyState: record(data.graphStateByVault)?.[vaultId],
      }));
      // Settings may have changed during the archive write; edit only this vault's layout entries.
      const latest = this.options.getData();
      const current = latest.consumers.graphPlus;
      const checkpoints = withoutKey(current.checkpoints, vaultId);
      await this.commit(vaultId, {
        ...latest,
        graphStateByVault: withoutKey(record(latest.graphStateByVault), vaultId),
        consumers: {
          ...latest.consumers,
          graphPlus: {
            ...current,
            checkpoints: action === 'previous' ? { ...checkpoints, [vaultId]: previous } : checkpoints,
            checkpointBackups: withoutKey(current.checkpointBackups, vaultId),
            graphDocuments: withoutKey(current.graphDocuments, vaultId),
            viewStates: withoutKey(current.viewStates, vaultId),
          },
        },
      });
      this.failures.delete(vaultId);
      this.verifiedVaults.delete(vaultId);
    });
  }

  private async loadCurrent(vaultId: string): Promise<GraphPlusCheckpointV1 | undefined> {
    const data = this.options.getData();
    const consumer = data.consumers.graphPlus;
    try {
      let checkpoint: GraphPlusCheckpointV1 | undefined;
      if (consumer.checkpoints?.[vaultId] !== undefined) {
        checkpoint = await this.readStored(vaultId, consumer.checkpoints[vaultId]);
      } else if (consumer.graphDocuments?.[vaultId] !== undefined || consumer.viewStates?.[vaultId] !== undefined) {
        checkpoint = readGraphPlusCheckpointV1(data, vaultId);
        if (!checkpoint) throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'invalid-checkpoint');
      }
      this.failures.delete(vaultId);
      this.verifiedVaults.add(vaultId);
      return checkpoint;
    } catch (error) {
      const failure = error instanceof GraphPlusCheckpointRecoveryErrorV1
        ? error : new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'inaccessible-file');
      this.failures.set(vaultId, failure);
      this.verifiedVaults.delete(vaultId);
      throw failure;
    }
  }

  private async readStored(vaultId: string, value: unknown): Promise<GraphPlusCheckpointV1> {
    const reference = validateGraphPlusCheckpointReferenceV1(value);
    if (!reference) {
      const inline = validateGraphPlusCheckpointV1(value);
      if (inline) return inline;
      throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'invalid-checkpoint');
    }
    if (!this.ownsPath(reference.documentPath)) throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'invalid-checkpoint');
    let serialized: string;
    try {
      if (!(await this.options.adapter.exists(reference.documentPath))) {
        throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'missing-file');
      }
      serialized = await this.options.adapter.read(reference.documentPath);
    } catch (error) {
      if (error instanceof GraphPlusCheckpointRecoveryErrorV1) throw error;
      throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'inaccessible-file');
    }
    let document: unknown;
    try { document = JSON.parse(serialized); } catch { throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'corrupt-json'); }
    const checked = validateGraphPlusCheckpointV1({
      document, viewState: reference.viewState, lens: reference.lens, savedAt: reference.savedAt,
    });
    if (!checked || checked.document.documentId !== reference.documentId
      || checked.document.revision !== reference.documentRevision) {
      throw new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'invalid-checkpoint');
    }
    return checked;
  }

  private async saveCurrent(vaultId: string, checkpoint: GraphPlusCheckpointV1, options?: GraphPlusCheckpointSaveOptionsV1): Promise<void> {
    const failedRecovery = this.failures.get(vaultId);
    if (failedRecovery) throw failedRecovery;
    if (!this.verifiedVaults.has(vaultId)) await this.loadCurrent(vaultId);
    const previousData = this.options.getData();
    const previousReference = readGraphPlusCheckpointReferenceV1(previousData, vaultId);
    const oldBackup = validateGraphPlusCheckpointReferenceV1(previousData.consumers.graphPlus.checkpointBackups?.[vaultId]);
    const identityChanged = !previousReference || previousReference.documentId !== checkpoint.document.documentId
      || previousReference.documentRevision !== checkpoint.document.revision;
    // A disappearing referenced file is failed recovery, never a request for a fresh layout.
    if (previousReference && !(await this.options.adapter.exists(previousReference.documentPath))) {
      const failure = new GraphPlusCheckpointRecoveryErrorV1(vaultId, 'missing-file');
      this.failures.set(vaultId, failure);
      throw failure;
    }
    const writeDocument = options?.documentChanged !== false || identityChanged;
    let documentPath = previousReference?.documentPath;
    let checkedCheckpoint: GraphPlusCheckpointV1 | undefined;
    if (writeDocument) {
      checkedCheckpoint = validateGraphPlusCheckpointV1(checkpoint);
      if (!checkedCheckpoint) throw new Error('Cannot persist an invalid graph+ checkpoint.');
      await this.ensureDirectory();
      documentPath = this.nextDocumentPath(vaultId, checkedCheckpoint);
      await this.options.adapter.write(documentPath, JSON.stringify(checkedCheckpoint.document));
    }
    if (!documentPath) throw new Error('graph+ checkpoint document storage is unavailable.');
    const source = checkedCheckpoint ?? checkpoint;
    const nextReference: GraphPlusCheckpointReferenceV1 = {
      storageVersion: 'document-file-v1', documentPath,
      documentId: source.document.documentId, documentRevision: source.document.revision,
      ...(source.viewState ? { viewState: source.viewState } : {}),
      ...(source.lens ? { lens: source.lens } : {}), savedAt: source.savedAt,
    };
    const nextBackup = writeDocument && previousReference ? previousReference : oldBackup;
    const nextData = withGraphPlusCheckpointReferenceV1(this.options.getData(), vaultId, nextReference);
    await this.commit(vaultId, {
      ...nextData,
      consumers: {
        ...nextData.consumers,
        graphPlus: {
          ...nextData.consumers.graphPlus,
          ...(nextBackup ? { checkpointBackups: {
            ...nextData.consumers.graphPlus.checkpointBackups, [vaultId]: nextBackup,
          } } : {}),
        },
      },
    });
    if (oldBackup && oldBackup.documentPath !== documentPath && oldBackup.documentPath !== nextBackup?.documentPath
      && this.ownsPath(oldBackup.documentPath)) {
      try {
        if (await this.options.adapter.exists(oldBackup.documentPath)) await this.options.adapter.remove(oldBackup.documentPath);
      } catch { /* Keep harmless orphaned files if pruning fails. */ }
    }
  }

  private async commit(vaultId: string, nextData: GraphPlusPluginDataV1): Promise<void> {
    const previous = this.options.getData();
    this.options.setData(nextData);
    try { await this.options.persistData(); } catch (error) {
      const latest = this.options.getData();
      if (latest === nextData) this.options.setData(previous);
      else if (latest.consumers.graphPlus.checkpoints?.[vaultId] === nextData.consumers.graphPlus.checkpoints?.[vaultId]) {
        const current = latest.consumers.graphPlus;
        const old = previous.consumers.graphPlus;
        this.options.setData({
          ...latest,
          graphStateByVault: restoreKey(record(latest.graphStateByVault), record(previous.graphStateByVault), vaultId),
          consumers: {
            ...latest.consumers,
            graphPlus: {
              ...current,
              checkpoints: restoreKey(current.checkpoints, old.checkpoints, vaultId),
              checkpointBackups: restoreKey(current.checkpointBackups, old.checkpointBackups, vaultId),
              graphDocuments: restoreKey(current.graphDocuments, old.graphDocuments, vaultId),
              viewStates: restoreKey(current.viewStates, old.viewStates, vaultId),
            },
          },
        });
        // A concurrent settings save may have queued the failed new reference.
        // Queue the corrected metadata after it without rolling those settings back.
        try { await this.options.persistData(); } catch { /* The original storage failure remains actionable. */ }
      }
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation);
    this.queue = next;
    return next;
  }

  private ownsPath(path: string): boolean {
    return path === normalizePath(path) && path.startsWith(`${this.directory}/`)
      && !path.slice(this.directory.length + 1).includes('/') && !path.includes('/../');
  }

  private async ensureDirectory(): Promise<void> {
    if (!(await this.options.adapter.exists(this.directory))) await this.options.adapter.mkdir(this.directory);
  }

  private nonce(): string { return this.options.createNonce?.() ?? Math.random().toString(36).slice(2, 10); }

  private nextDocumentPath(vaultId: string, checkpoint: GraphPlusCheckpointV1): string {
    return `${this.directory}/${hashString(vaultId)}-${checkpoint.document.revision}-${checkpoint.savedAt}-${this.nonce()}.json`;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function withoutKey(values: Readonly<Record<string, unknown>> | undefined, key: string): Record<string, unknown> | undefined {
  if (!values) return undefined;
  const next = { ...values };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
}

function restoreKey(current: Readonly<Record<string, unknown>> | undefined, previous: Readonly<Record<string, unknown>> | undefined, key: string): Record<string, unknown> | undefined {
  const restored = withoutKey(current, key);
  return previous && Object.prototype.hasOwnProperty.call(previous, key)
    ? { ...restored, [key]: previous[key] } : restored;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
