import {
  type GraphPlusCheckpointSaveOptionsV1,
  type GraphPlusCheckpointStoreV1,
  type GraphPlusCheckpointV1,
  validateGraphPlusCheckpointV1,
} from '../../graph-plus/persistence/index.ts';
import {
  readGraphPlusCheckpointReferenceV1,
  readGraphPlusCheckpointV1,
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

/**
 * Keeps large canonical Graph+ documents outside Obsidian's monolithic data.json.
 * Lightweight view/camera/lens metadata remains in plugin data, so camera-only saves
 * cannot stringify or rewrite the unchanged graph document.
 */
export class GraphPlusCheckpointFileStoreV1 implements GraphPlusCheckpointStoreV1 {
  private readonly directory: string;

  constructor(private readonly options: GraphPlusCheckpointFileStoreOptionsV1) {
    this.directory = normalizePath(options.directory);
  }

  async load(vaultId: string): Promise<GraphPlusCheckpointV1 | undefined> {
    const data = this.options.getData();
    const reference = readGraphPlusCheckpointReferenceV1(data, vaultId);
    if (!reference) return readGraphPlusCheckpointV1(data, vaultId);
    try {
      const document = JSON.parse(await this.options.adapter.read(reference.documentPath)) as unknown;
      return validateGraphPlusCheckpointV1({
        document,
        ...(reference.viewState ? { viewState: reference.viewState } : {}),
        ...(reference.lens ? { lens: reference.lens } : {}),
        savedAt: reference.savedAt,
      });
    } catch {
      return undefined;
    }
  }

  async save(
    vaultId: string,
    checkpoint: GraphPlusCheckpointV1,
    options?: GraphPlusCheckpointSaveOptionsV1,
  ): Promise<void> {
    const previousData = this.options.getData();
    const previousReference = readGraphPlusCheckpointReferenceV1(previousData, vaultId);
    const identityChanged = !previousReference
      || previousReference.documentId !== checkpoint.document.documentId
      || previousReference.documentRevision !== checkpoint.document.revision;
    const previousFileMissing = !previousReference
      || !(await this.options.adapter.exists(previousReference.documentPath));
    const writeDocument = options?.documentChanged !== false || identityChanged || previousFileMissing;

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
      storageVersion: 'document-file-v1',
      documentPath,
      documentId: source.document.documentId,
      documentRevision: source.document.revision,
      ...(source.viewState ? { viewState: source.viewState } : {}),
      ...(source.lens ? { lens: source.lens } : {}),
      savedAt: source.savedAt,
    };
    const nextData = withGraphPlusCheckpointReferenceV1(previousData, vaultId, nextReference);
    this.options.setData(nextData);
    try {
      await this.options.persistData();
    } catch (error) {
      if (this.options.getData() === nextData) this.options.setData(previousData);
      throw error;
    }

    if (writeDocument && previousReference && previousReference.documentPath !== documentPath) {
      try {
        if (await this.options.adapter.exists(previousReference.documentPath)) {
          await this.options.adapter.remove(previousReference.documentPath);
        }
      } catch {
        // The committed reference is authoritative. An orphaned superseded document
        // is harmless and preferable to turning a successful checkpoint into failure.
      }
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!(await this.options.adapter.exists(this.directory))) await this.options.adapter.mkdir(this.directory);
  }

  private nextDocumentPath(vaultId: string, checkpoint: GraphPlusCheckpointV1): string {
    const nonce = this.options.createNonce?.() ?? Math.random().toString(36).slice(2, 10);
    const filename = `${hashString(vaultId)}-${checkpoint.document.revision}-${checkpoint.savedAt}-${nonce}.json`;
    return normalizePath(`${this.directory}/${filename}`);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
