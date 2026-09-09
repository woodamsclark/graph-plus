import type {
  Disposable,
  GraphDocumentV1,
  GraphEngineLeaseV1,
  GraphSessionErrorV1,
  GraphSessionUiOptionsV1,
  GraphSessionV1,
} from '../../graph-engine/contracts/v1/index.ts';
import {
  GraphPlusLookupV1,
  VaultGraphAdapterV1,
} from '../adapter/index.ts';
import {
  adoptGraphPlusSessionOverridesV1,
  compileGraphPlusFilterV1,
  createDefaultGraphPlusLensV1,
  graphPlusSessionOverridesV1,
  type GraphPlusLensStateV1,
  type ObsidianSearchIndexV1,
} from '../query/index.ts';
import type { GraphPlusNavigatorV1, GraphPlusVaultSourceV1 } from './GraphPlusConsumer.ts';
import { GraphPlusNeighborhoodFramerV1 } from './GraphPlusNeighborhoodFramer.ts';

export interface LocalGraphPlusConsumerOptionsV1<TFile> {
  readonly lease: GraphEngineLeaseV1;
  readonly container: HTMLElement;
  readonly source: GraphPlusVaultSourceV1<TFile>;
  readonly navigator: GraphPlusNavigatorV1<TFile>;
  readonly countDuplicateLinks: boolean;
  readonly initialRootNodeId?: string;
  readonly initialDepth?: number;
  readonly initialLens?: GraphPlusLensStateV1;
  readonly profileId?: string;
  readonly ui?: GraphSessionUiOptionsV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
  readonly onNotePreview?: (request: {
    readonly nodeId?: string;
    readonly file?: TFile;
    readonly anchor?: { readonly x: number; readonly y: number };
    readonly active: boolean;
    readonly immediate?: boolean;
    readonly persistent?: boolean;
  }) => void;
}

/**
 * An ephemeral active-note graph. It owns an independent engine session and
 * deliberately never reads or writes the global Graph+ layout checkpoint.
 */
export class LocalGraphPlusConsumerV1<TFile> {
  private readonly adapter: VaultGraphAdapterV1<TFile>;
  private readonly profileId: string;
  private lens: GraphPlusLensStateV1;
  private depth: number;
  private rootNodeId?: string;
  private canonicalDocument?: GraphDocumentV1;
  private localDocument?: GraphDocumentV1;
  private lookup = new GraphPlusLookupV1<TFile>();
  private searchIndex: ObsidianSearchIndexV1 = new Map();
  private session?: GraphSessionV1;
  private subscriptions: Disposable[] = [];
  private actionRegistration?: Disposable;
  private lensQueue: Promise<void> = Promise.resolve();
  private opened = false;
  private leaseReleased = false;
  private focusedNodeId?: string;
  private previewNodeId?: string;
  private persistentPreviewNodeId?: string;
  private readonly neighborhoodFramer: GraphPlusNeighborhoodFramerV1;

  constructor(private readonly options: LocalGraphPlusConsumerOptionsV1<TFile>) {
    this.adapter = new VaultGraphAdapterV1({ countDuplicateLinks: options.countDuplicateLinks });
    this.profileId = options.profileId ?? 'default';
    this.lens = clone(options.initialLens ?? createDefaultGraphPlusLensV1());
    this.depth = localDepth(options.initialDepth);
    this.rootNodeId = options.initialRootNodeId;
    this.neighborhoodFramer = new GraphPlusNeighborhoodFramerV1({
      container: options.container,
      getSession: () => this.session,
      getDocument: () => this.localDocument,
    });
  }

  async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    try {
      this.actionRegistration = this.options.lease.registerNodeActions([
        {
          id: 'open-node',
          label: (context) => this.nodeKind(context.nodeId) === 'tag' ? 'Open tag' : 'Open note',
          icon: 'file-text',
          isAvailable: (context) => this.nodeKind(context.nodeId) !== undefined,
          run: (context) => this.openNode(context.nodeId),
        },
        {
          id: 'show-preview',
          label: 'Show preview',
          icon: 'panel-right',
          isAvailable: (context) => this.nodeKind(context.nodeId) === 'note',
          run: (context) => this.showNotePreview(context.nodeId, true),
        },
      ]);
      const snapshot = await this.options.source.read();
      const projection = this.adapter.build(snapshot);
      this.canonicalDocument = projection.document;
      this.lookup = projection.lookup;
      this.searchIndex = projection.searchIndex;
      const localDocument = this.buildLocalDocument();
      this.localDocument = localDocument;
      const session = await this.options.lease.createSession({
        consumerId: 'graph-plus',
        profileId: this.profileId,
        container: this.options.container,
        document: localDocument,
        sessionOverrides: graphPlusSessionOverridesV1(this.lens),
        ui: this.options.ui,
        onSessionOverridesChanged: (overrides) => {
          this.lens = adoptGraphPlusSessionOverridesV1(this.lens, overrides);
        },
      });
      this.session = session;
      this.subscriptions.push(session.onError((error) => this.options.onError?.(error)));
      this.subscriptions.push(session.onIntent((intent) => {
        if (intent.type === 'viewport-changed') {
          this.neighborhoodFramer.cancel();
          if (this.previewNodeId) void this.showNotePreview(
            this.previewNodeId,
            this.previewNodeId === this.persistentPreviewNodeId,
            undefined,
            true,
          );
          return;
        }
        if (intent.type === 'camera-reset') {
          if (intent.focusedNodeId) void this.frameNeighborhood(intent.focusedNodeId);
          return;
        }
        if (intent.type === 'focus-changed') {
          this.focusedNodeId = intent.focusedNodeId;
          if (this.focusedNodeId) void this.frameNeighborhood(this.focusedNodeId);
          else this.neighborhoodFramer.cancel();
          return;
        }
        if (intent.type !== 'preview-changed') return;
        if (this.persistentPreviewNodeId) return;
        const entry = intent.nodeId ? this.lookup.get(intent.nodeId) : undefined;
        if (intent.nodeId && entry?.kind !== 'note') {
          void session.clearPreview();
          return;
        }
        if (intent.nodeId && entry?.kind === 'note') {
          void this.showNotePreview(intent.nodeId, false, intent.anchor, !intent.closing);
        } else {
          this.previewNodeId = undefined;
          this.options.onNotePreview?.({ active: false, immediate: !intent.closing });
        }
      }));
      await this.presentRoot();
    } catch (error) {
      this.opened = false;
      this.actionRegistration?.dispose();
      this.actionRegistration = undefined;
      this.options.onError?.(asError(error));
      throw error;
    }
  }

  async reconcile(): Promise<void> {
    if (!this.session || !this.canonicalDocument) return;
    try {
      const snapshot = await this.options.source.read();
      const projection = this.adapter.reconcile(this.canonicalDocument, snapshot);
      this.canonicalDocument = projection.document;
      this.lookup = projection.lookup;
      this.searchIndex = projection.searchIndex;
      await this.replaceLocalDocument();
    } catch (error) {
      this.options.onError?.(asError(error));
    }
  }

  async followActiveNode(nodeId: string): Promise<boolean> {
    if (!this.session || !this.canonicalDocument) return false;
    if (!this.canonicalDocument.nodes.some((node) => node.id === nodeId)) await this.reconcile();
    if (!this.canonicalDocument?.nodes.some((node) => node.id === nodeId)) return false;
    if (this.rootNodeId === nodeId) return true;
    this.rootNodeId = nodeId;
    await this.replaceLocalDocument();
    return true;
  }

  setLens(next: GraphPlusLensStateV1): Promise<void> {
    const requested = clone(next);
    this.lensQueue = this.lensQueue.catch(() => undefined).then(async () => {
      this.lens = requested;
      await this.session?.setSessionOverrides(graphPlusSessionOverridesV1(this.lens));
      await this.replaceLocalDocument();
    });
    return this.lensQueue;
  }

  getLens(): GraphPlusLensStateV1 { return clone(this.lens); }
  getDocument(): GraphDocumentV1 | undefined { return this.canonicalDocument ? clone(this.canonicalDocument) : undefined; }
  getLocalDocument(): GraphDocumentV1 | undefined { return this.localDocument ? clone(this.localDocument) : undefined; }
  getSession(): GraphSessionV1 | undefined { return this.session; }
  getLocalDepth(): number { return this.depth; }

  async setLocalDepth(depth: number): Promise<void> {
    const next = localDepth(depth);
    if (next === this.depth) return;
    this.depth = next;
    await this.replaceLocalDocument();
  }

  setSuspended(suspended: boolean): void {
    if (suspended) this.neighborhoodFramer.cancel();
    this.session?.setSuspended(suspended);
    if (!suspended && this.focusedNodeId) void this.frameNeighborhood(this.focusedNodeId);
  }

  async setPreviewSurfaceActive(active: boolean): Promise<void> {
    await this.session?.setPreviewSurfaceActive(active);
  }

  async clearPreview(): Promise<void> {
    this.previewNodeId = undefined;
    this.persistentPreviewNodeId = undefined;
    await this.session?.clearPreview();
  }

  private async showNotePreview(
    nodeId: string,
    persistent: boolean,
    fallbackAnchor?: { readonly x: number; readonly y: number; readonly scale?: number },
    immediate = true,
  ): Promise<void> {
    const entry = this.lookup.get(nodeId);
    if (entry?.kind !== 'note') return;
    if (persistent) this.persistentPreviewNodeId = nodeId;
    this.previewNodeId = nodeId;
    const anchor = await this.nodeScreenPoint(nodeId) ?? fallbackAnchor;
    if (this.previewNodeId !== nodeId || !anchor) return;
    this.options.onNotePreview?.({ nodeId, file: entry.file, anchor, active: true, immediate, persistent });
  }

  private async nodeScreenPoint(nodeId: string): Promise<{
    readonly x: number;
    readonly y: number;
    readonly scale: number;
  } | undefined> {
    return this.session?.getNodeScreenPoint(nodeId);
  }

  async openNode(nodeId: string): Promise<void> {
    const entry = this.lookup.get(nodeId);
    if (entry?.kind === 'note') await this.options.navigator.openNote(entry.file);
    if (entry?.kind === 'tag') await this.options.navigator.openTag(entry.tag);
  }

  nodeKind(nodeId: string): 'note' | 'tag' | undefined { return this.lookup.get(nodeId)?.kind; }

  async close(): Promise<void> {
    this.opened = false;
    this.neighborhoodFramer.cancel();
    await this.lensQueue.catch(() => undefined);
    this.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    this.actionRegistration?.dispose();
    this.actionRegistration = undefined;
    this.options.onNotePreview?.({ active: false });
    try {
      await this.session?.dispose();
    } finally {
      this.session = undefined;
      this.canonicalDocument = undefined;
      this.localDocument = undefined;
      this.focusedNodeId = undefined;
      if (!this.leaseReleased) {
        this.leaseReleased = true;
        await this.options.lease.release();
      }
    }
  }

  private async replaceLocalDocument(): Promise<void> {
    if (!this.session) return;
    const localDocument = this.buildLocalDocument();
    if (sameLocalGraph(this.localDocument, localDocument)) return;
    this.neighborhoodFramer.cancel();
    this.localDocument = localDocument;
    await this.session.replaceDocument(localDocument);
    await this.presentRoot();
  }

  private async presentRoot(): Promise<void> {
    const root = this.rootNodeId;
    if (!this.session || !root || !this.localDocument?.nodes.some((node) => node.id === root)) return;
    this.neighborhoodFramer.cancel();
    await this.session.setNodePinned(root, true);
    await this.session.setSelection([root]);
    await this.session.focusNode(root);
    this.focusedNodeId = root;
    await this.frameNeighborhood(root);
  }

  private async frameNeighborhood(nodeId: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    const settings = await session.exportEffectiveSettings();
    if (session !== this.session || this.focusedNodeId !== nodeId) return;
    const force = settings.modules['force-layout']?.settings;
    const springLength = finitePositive(force?.springLength, 250);
    const maximumLengthScale = finitePositive(force?.maximumSpringLengthScale, 1.85);
    await this.neighborhoodFramer.frame(nodeId, {
      minimumRadius: springLength * maximumLengthScale,
      followSettling: false,
    });
  }

  private buildLocalDocument(): GraphDocumentV1 {
    const canonical = this.canonicalDocument;
    const root = this.rootNodeId;
    if (!canonical || !root || !canonical.nodes.some((node) => node.id === root)) {
      return {
        schemaVersion: 1,
        documentId: `${canonical?.documentId ?? 'graph-plus:vault:unavailable'}:local:empty`,
        revision: canonical?.revision ?? 0,
        nodes: [],
        edges: [],
      };
    }
    const compiled = compileGraphPlusFilterV1(canonical, this.lens, this.searchIndex);
    if (compiled.error) this.options.onError?.(new Error(compiled.error));
    const eligible = new Set(compiled.visibleNodeIds);
    eligible.add(root);
    const included = withinDepth(canonical, root, this.depth, eligible);
    const nodesById = new Map(canonical.nodes.map((node) => [node.id, node]));
    const nodes = [root, ...[...included].filter((nodeId) => nodeId !== root).sort()]
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is GraphDocumentV1['nodes'][number] => node !== undefined);
    const edges = canonical.edges.filter((edge) => included.has(edge.sourceId) && included.has(edge.targetId));
    const nodeRegions = canonical.nodeRegions ? {
      version: 1 as const,
      definitions: canonical.nodeRegions.definitions
        .filter((definition) => included.has(definition.regionNodeId))
        .map((definition) => ({
          regionNodeId: definition.regionNodeId,
          directMemberNodeIds: definition.directMemberNodeIds.filter((nodeId) => included.has(nodeId)),
        })),
    } : undefined;
    return {
      schemaVersion: 1,
      documentId: `${canonical.documentId}:local:${encodeURIComponent(root)}`,
      revision: canonical.revision,
      nodes,
      edges,
      ...(nodeRegions ? { nodeRegions } : {}),
    };
  }
}

function withinDepth(
  document: GraphDocumentV1,
  rootNodeId: string,
  maxDepth: number,
  eligible: ReadonlySet<string>,
): ReadonlySet<string> {
  const included = new Set([rootNodeId]);
  const adjacency = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (!eligible.has(edge.sourceId) || !eligible.has(edge.targetId)) continue;
    const source = adjacency.get(edge.sourceId) ?? new Set<string>();
    source.add(edge.targetId);
    adjacency.set(edge.sourceId, source);
    const target = adjacency.get(edge.targetId) ?? new Set<string>();
    target.add(edge.sourceId);
    adjacency.set(edge.targetId, target);
  }
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootNodeId, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      if (included.has(neighbor)) continue;
      included.add(neighbor);
      queue.push({ nodeId: neighbor, depth: current.depth + 1 });
    }
  }
  return included;
}

function localDepth(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.round(value)))
    : 1;
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sameLocalGraph(left: GraphDocumentV1 | undefined, right: GraphDocumentV1): boolean {
  if (!left || left.documentId !== right.documentId) return false;
  return JSON.stringify({ nodes: left.nodes, edges: left.edges, nodeRegions: left.nodeRegions })
    === JSON.stringify({ nodes: right.nodes, edges: right.edges, nodeRegions: right.nodeRegions });
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
