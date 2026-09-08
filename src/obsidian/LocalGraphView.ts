import { ItemView, MarkdownView, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import { LocalGraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import { coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import { GraphPlusNotePreviewControllerV1 } from './GraphPlusNotePreviewController.ts';
import { createGraphPlusNotePreviewControllerV1 } from './createGraphPlusNotePreviewController.ts';
import { GraphPlusViewLifecycleV1 } from './GraphPlusViewLifecycle.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphEnginePlugin from './main.ts';

export const LOCAL_GRAPH_PLUS_TYPE = 'graph-plus-local';

export class LocalGraphPlusView extends ItemView {
  private readonly plugin: GraphEnginePlugin;
  private consumer?: LocalGraphPlusConsumerV1<TFile>;
  private fallback?: Disposable;
  private lifecycle?: GraphPlusViewLifecycleV1;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private pendingDepth = 1;
  private stateRestored = false;
  private notePreview?: GraphPlusNotePreviewControllerV1<TFile>;
  private activeFileToFollow?: TFile;
  private followRunning = false;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphEnginePlugin;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'greater-graph-view graphplus-view graphplus-local-view' });
    this.lifecycle = new GraphPlusViewLifecycleV1(this.contentEl, {
      setSuspended: (suspended) => this.consumer?.setSuspended(suspended),
      clearPreview: () => this.notePreview?.clear(),
      reconcile: () => this.consumer?.reconcile(),
    });
    this.notePreview = createGraphPlusNotePreviewControllerV1({
      app: this.app,
      container: this.contentEl,
      isVisible: () => this.lifecycle?.isVisible ?? false,
      onPreviewSurfaceActive: (active) => this.consumer?.setPreviewSurfaceActive(active),
      onDismissRequested: () => this.consumer?.clearPreview(),
    });
    if (!this.stateRestored) this.pendingLens = { ...this.pendingLens, showTags: this.plugin.settings.showTags };
    try {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(this.pendingLens);
      const activeFile = this.activeMarkdownFile() ?? this.app.workspace.getActiveFile();
      const lease = this.plugin.acquireGraphPlusLease();
      let consumer!: LocalGraphPlusConsumerV1<TFile>;
      consumer = new LocalGraphPlusConsumerV1({
        lease,
        container,
        source: this.plugin.graphPlusVaultSource,
        navigator: new GraphPlusObsidianNavigatorV1(this.app),
        countDuplicateLinks: this.plugin.settings.countDuplicateLinks,
        initialRootNodeId: activeFile?.extension === 'md' ? noteNodeId(activeFile.path) : undefined,
        initialDepth: this.pendingDepth,
        initialLens: this.pendingLens,
        ui: {
          quickSettings: {
            contributions: createGraphPlusUiContributionsV1(() => consumer, () => consumer),
          },
        },
        onError: (error) => console.error('[local graph+] consumer error', error),
        onNotePreview: (request) => this.updateNotePreview(request),
      });
      this.consumer = consumer;
      await consumer.open();
      this.registerEvents();
      this.synchronizeLeafVisibility();
      this.requestActiveFileFollow(activeFile);
    } catch (error) {
      console.error('[local graph+] failed to open', error);
      await this.consumer?.close().catch(() => undefined);
      this.consumer = undefined;
      this.fallback = mountGraphEngineUnavailableSurfaceV1(container, {
        code: 'initialization-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onClose(): Promise<void> {
    this.lifecycle?.dispose();
    this.lifecycle = undefined;
    await this.consumer?.close();
    this.consumer = undefined;
    this.fallback?.dispose();
    this.fallback = undefined;
    this.activeFileToFollow = undefined;
    this.followRunning = false;
    this.notePreview?.dispose();
    this.notePreview = undefined;
  }

  getViewType(): string { return LOCAL_GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'local graph+'; }
  getIcon(): string { return 'network'; }

  getLifecycleDiagnostics(): Readonly<Record<string, unknown>> {
    return {
      type: LOCAL_GRAPH_PLUS_TYPE,
      contentShown: this.contentEl.isShown(),
      trackedVisible: this.lifecycle?.isVisible ?? false,
      hasConsumer: this.consumer !== undefined,
      listenerCount: this.lifecycle?.listenerCount ?? 0,
      rebuildScheduled: this.lifecycle?.rebuildScheduled ?? false,
      reconcilePending: this.lifecycle?.hasReconcilePending ?? false,
      followRunning: this.followRunning,
    };
  }

  getState(): Record<string, unknown> {
    return {
      lens: this.consumer?.getLens() ?? this.pendingLens,
      depth: this.consumer?.getLocalDepth() ?? this.pendingDepth,
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    if (!isRecord(state)) return;
    const lens = coerceGraphPlusLensStateV1(state.lens);
    if (lens) {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(lens);
      await this.consumer?.setLens(this.pendingLens);
    }
    this.pendingDepth = coerceDepth(state.depth);
    await this.consumer?.setLocalDepth(this.pendingDepth);
    this.stateRestored = true;
  }

  private registerEvents(): void {
    if (!this.lifecycle || this.lifecycle.listenerCount > 0) return;
    const schedule = (): void => this.lifecycle?.scheduleReconcile();
    const createRef = this.app.vault.on('create', schedule);
    const modifyRef = this.app.vault.on('modify', schedule);
    const deleteRef = this.app.vault.on('delete', schedule);
    const renameRef = this.app.vault.on('rename', schedule);
    const metadataRef = this.app.metadataCache.on('changed', schedule);
    const activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
      this.synchronizeLeafVisibility();
      this.requestActiveFileFollow(this.activeMarkdownFile());
    });
    const fileOpenRef = this.app.workspace.on('file-open', (file) => this.requestActiveFileFollow(file));
    this.lifecycle.register(
      () => this.app.vault.offref(createRef),
      () => this.app.vault.offref(modifyRef),
      () => this.app.vault.offref(deleteRef),
      () => this.app.vault.offref(renameRef),
      () => this.app.metadataCache.offref(metadataRef),
      () => this.app.workspace.offref(activeLeafRef),
      () => this.app.workspace.offref(fileOpenRef),
    );
  }

  private synchronizeLeafVisibility(): void {
    if (!this.lifecycle?.synchronizeVisibility()) return;
    this.requestActiveFileFollow(this.activeFileToFollow ?? this.app.workspace.getActiveFile());
  }

  private activeMarkdownFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private requestActiveFileFollow(file: TFile | null): void {
    if (!file || file.extension !== 'md') return;
    this.activeFileToFollow = file;
    if (!this.lifecycle?.isVisible || this.followRunning || !this.consumer) return;
    this.followRunning = true;
    void this.drainActiveFileFollow();
  }

  private async drainActiveFileFollow(): Promise<void> {
    try {
      while (this.lifecycle?.isVisible && this.consumer && this.activeFileToFollow) {
        const file = this.activeFileToFollow;
        this.activeFileToFollow = undefined;
        await this.consumer.followActiveNode(noteNodeId(file.path));
      }
    } finally {
      this.followRunning = false;
      if (this.lifecycle?.isVisible && this.consumer && this.activeFileToFollow) {
        this.requestActiveFileFollow(this.activeFileToFollow);
      }
    }
  }

  private updateNotePreview(request: {
    readonly immediate?: boolean;
    readonly nodeId?: string;
    readonly file?: TFile;
    readonly anchor?: { readonly x: number; readonly y: number };
    readonly active: boolean;
  }): void {
    this.notePreview?.update(request);
  }
}

function coerceDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.round(value)))
    : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
