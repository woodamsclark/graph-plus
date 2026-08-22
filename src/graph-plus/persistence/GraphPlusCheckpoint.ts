import {
  assertGraphDocumentV1,
  assertGraphViewStateV1,
  type Disposable,
  type GraphDocumentV1,
  type GraphSessionV1,
  type GraphViewStateV1,
} from '../../graph-engine/public.ts';

export interface GraphPlusCheckpointV1 {
  readonly document: GraphDocumentV1;
  readonly viewState?: GraphViewStateV1;
  readonly savedAt: number;
}

export interface GraphPlusCheckpointStoreV1 {
  load(vaultId: string): Promise<GraphPlusCheckpointV1 | undefined>;
  save(vaultId: string, checkpoint: GraphPlusCheckpointV1): Promise<void>;
}

export interface GraphPlusCheckpointClockV1 {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class GraphPlusCheckpointControllerV1 {
  private session?: GraphSessionV1;
  private timer: unknown;
  private subscriptions: Disposable[] = [];
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly vaultId: string,
    private readonly store: GraphPlusCheckpointStoreV1,
    private readonly clock: GraphPlusCheckpointClockV1 = defaultClock,
    private readonly debounceMs = 500,
  ) {}

  attach(session: GraphSessionV1): void {
    this.detach();
    this.session = session;
    this.subscriptions.push(session.onGraphChanged(() => this.schedule()));
    this.subscriptions.push(session.onIntent((intent) => {
      if (intent.type === 'viewport-changed' || intent.type === 'node-drag-ended'
        || intent.type === 'selection-changed' || intent.type === 'focus-changed') this.schedule();
    }));
  }

  schedule(): void {
    if (!this.session) return;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  flush(): Promise<void> {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    const session = this.session;
    if (!session) return this.flushQueue;
    this.flushQueue = this.flushQueue.catch(() => undefined).then(async () => {
      const [document, viewState] = await Promise.all([session.exportDocument(), session.exportViewState()]);
      await this.store.save(this.vaultId, { document, viewState, savedAt: this.clock.now() });
    });
    return this.flushQueue;
  }

  async closeAndDispose(): Promise<void> {
    try {
      await this.flush();
    } finally {
      const session = this.session;
      this.detach();
      await session?.dispose();
    }
  }

  detach(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    this.session = undefined;
  }
}

export function validateGraphPlusCheckpointV1(value: unknown): GraphPlusCheckpointV1 | undefined {
  if (!isRecord(value)) return undefined;
  try {
    assertGraphDocumentV1(value.document);
    if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return undefined;
    let viewState: GraphViewStateV1 | undefined;
    if (value.viewState !== undefined) {
      try {
        assertGraphViewStateV1(value.viewState);
        viewState = value.viewState;
      } catch {
        viewState = undefined;
      }
    }
    return JSON.parse(JSON.stringify({
      document: value.document,
      ...(viewState ? { viewState } : {}),
      savedAt: value.savedAt,
    })) as GraphPlusCheckpointV1;
  } catch {
    return undefined;
  }
}

export function migrateLegacyPositionsV1(
  document: GraphDocumentV1,
  legacy: unknown,
  options: { readonly profileId: string; readonly dimensions: '2d' | '3d' },
): GraphViewStateV1 | undefined {
  if (!isRecord(legacy) || !isRecord(legacy.nodePositions)) return undefined;
  const positions: Record<string, { x: number; y: number; z: number }> = {};
  for (const node of document.nodes) {
    const legacyId = node.attributes?.kind === 'note'
      ? String(node.attributes.path ?? '')
      : node.attributes?.kind === 'tag'
        ? String((node.attributes.tags as readonly string[] | undefined)?.[0] ?? '')
        : '';
    const position = legacy.nodePositions[legacyId];
    if (isPosition(position)) positions[node.id] = { x: position.x, y: position.y, z: position.z };
  }
  if (Object.keys(positions).length === 0) return undefined;
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'graph-plus',
    profileId: options.profileId,
    dimensions: options.dimensions,
    positions,
    pinnedNodeIds: [],
    camera: options.dimensions === '2d'
      ? {
          position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
        }
      : {
          position: { x: 0, y: 0, z: 600 }, target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'perspective',
        },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
}

const defaultClock: GraphPlusCheckpointClockV1 = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isPosition(value: unknown): value is { x: number; y: number; z: number } {
  return isRecord(value) && [value.x, value.y, value.z].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
