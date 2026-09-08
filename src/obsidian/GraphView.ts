import { Component, ItemView, MarkdownRenderer, MarkdownView, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import { coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import { GraphPlusNotePreviewControllerV1 } from './GraphPlusNotePreviewController.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphEnginePlugin from './main.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphPlusView extends ItemView {
  private readonly plugin: GraphEnginePlugin;
  private consumer?: GraphPlusConsumerV1<TFile>;
  private fallback?: Disposable;
  private unregisters: Array<() => void> = [];
  private rebuildTimer: number | undefined;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private stateRestored = false;
  private leafVisible = true;
  private reconcilePending = false;
  private notePreview?: GraphPlusNotePreviewControllerV1<TFile>;
  private activeFileToFollow?: TFile;
  private followRunning = false;
  private followCompletion: Promise<void> = Promise.resolve();
  private explicitNavigation = false;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphEnginePlugin;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'greater-graph-view graphplus-view' });
    this.notePreview = new GraphPlusNotePreviewControllerV1({
      container: this.contentEl,
      isVisible: () => this.leafVisible,
      readFile: (file) => this.app.vault.cachedRead(file),
      renderMarkdown: async (markdown, element, sourcePath) => {
        const component = new Component();
        component.load();
        try {
          await MarkdownRenderer.render(this.app, markdown, element, sourcePath, component);
          return { dispose: () => component.unload() };
        } catch (error) {
          component.unload();
          throw error;
        }
      },
      openFile: (file) => this.app.workspace.getLeaf(false).openFile(file),
      openLink: (link, sourcePath, newLeaf) => this.app.workspace.openLinkText(link, sourcePath, newLeaf),
      onPreviewSurfaceActive: (active) => this.consumer?.setPreviewSurfaceActive(active),
      onDismissRequested: () => this.consumer?.clearPreview(),
    });
    if (!this.stateRestored) this.pendingLens = { ...this.pendingLens, showTags: this.plugin.settings.showTags };
    try {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(this.pendingLens);
      const lease = this.plugin.acquireGraphPlusLease();
      let consumer!: GraphPlusConsumerV1<TFile>;
      consumer = new GraphPlusConsumerV1({
        lease,
        container,
        vaultId: this.app.vault.getName(),
        source: this.plugin.graphPlusVaultSource,
        checkpointStore: this.plugin.graphPlusCheckpointStore,
        navigator: new GraphPlusObsidianNavigatorV1(this.app),
        countDuplicateLinks: this.plugin.settings.countDuplicateLinks,
        legacyPositions: this.plugin.getLegacyGraphState(this.app.vault.getName()),
        initialLens: this.pendingLens,
        restoreSavedLens: !this.stateRestored,
        clock: createWindowClock(container),
        ui: {
          quickSettings: { contributions: createGraphPlusUiContributionsV1(() => consumer) },
        },
        onError: (error) => console.error('[graph+] consumer error', error),
        onNotePreview: (request) => this.updateNotePreview(request),
      });
      this.consumer = consumer;
      await consumer.open();
      this.registerGraphRebuildEvents();
      this.synchronizeLeafVisibility();
      this.requestActiveFileFollow(this.app.workspace.getActiveFile());
    } catch (error) {
      console.error('[graph+] failed to open', error);
      await this.consumer?.close().catch(() => undefined);
      this.consumer = undefined;
      this.fallback = mountGraphEngineUnavailableSurfaceV1(container, {
        code: 'initialization-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onClose(): Promise<void> {
    const window = this.contentEl.ownerDocument.defaultView;
    if (this.rebuildTimer !== undefined) window?.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.unregisters.splice(0).forEach((unregister) => unregister());
    await this.consumer?.close();
    this.consumer = undefined;
    this.fallback?.dispose();
    this.fallback = undefined;
    this.reconcilePending = false;
    this.activeFileToFollow = undefined;
    this.followRunning = false;
    this.explicitNavigation = false;
    this.notePreview?.dispose();
    this.notePreview = undefined;
  }

  getViewType(): string { return GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'graph+'; }
  getIcon(): string { return 'dot-network'; }

  getLifecycleDiagnostics(): Readonly<Record<string, unknown>> {
    return {
      type: GRAPH_PLUS_TYPE,
      contentShown: this.contentEl.isShown(),
      trackedVisible: this.leafVisible,
      hasConsumer: this.consumer !== undefined,
      listenerCount: this.unregisters.length,
      rebuildScheduled: this.rebuildTimer !== undefined,
      reconcilePending: this.reconcilePending,
      followRunning: this.followRunning,
    };
  }

  async showFile(file: TFile): Promise<boolean> {
    this.explicitNavigation = true;
    this.activeFileToFollow = undefined;
    try {
      await this.followCompletion;
      this.activeFileToFollow = undefined;
      return this.consumer?.revealAndFocusNode(noteNodeId(file.path)) ?? false;
    } finally {
      this.explicitNavigation = false;
    }
  }

  async resetGraphLayoutData(): Promise<boolean> {
    const window = this.contentEl.ownerDocument.defaultView;
    if (this.rebuildTimer !== undefined) window?.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.reconcilePending = false;
    this.notePreview?.clear();
    return this.consumer?.resetLayoutData() ?? false;
  }

  getState(): Record<string, unknown> {
    return { lens: this.consumer?.getLens() ?? this.pendingLens };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const lens = coerceGraphPlusLensStateV1(isRecord(state) ? state.lens : undefined);
    if (!lens) return;
    this.pendingLens = await this.plugin.migrateLegacyLensSettings(lens);
    this.stateRestored = true;
    await this.consumer?.setLens(this.pendingLens);
  }

  private registerGraphRebuildEvents(): void {
    if (this.unregisters.length > 0) return;
    const schedule = (): void => {
      if (!this.leafVisible) {
        this.reconcilePending = true;
        return;
      }
      const window = this.contentEl.ownerDocument.defaultView;
      if (this.rebuildTimer !== undefined) window?.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window?.setTimeout(() => {
        this.rebuildTimer = undefined;
        void this.consumer?.reconcile();
      }, 180);
    };
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
    this.unregisters.push(
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
    const visible = this.contentEl.isShown();
    if (this.leafVisible === visible && !this.reconcilePending) return;
    this.leafVisible = visible;
    if (!visible && this.rebuildTimer !== undefined) {
      this.contentEl.ownerDocument.defaultView?.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = undefined;
      this.reconcilePending = true;
    }
    this.consumer?.setSuspended(!visible);
    if (!visible) this.notePreview?.clear();
    if (!visible) return;
    if (this.reconcilePending) {
      this.reconcilePending = false;
      void this.consumer?.reconcile();
    }
    this.requestActiveFileFollow(this.activeFileToFollow ?? this.app.workspace.getActiveFile());
  }

  private activeMarkdownFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private requestActiveFileFollow(file: TFile | null): void {
    if (this.explicitNavigation || !file || file.extension !== 'md') return;
    this.activeFileToFollow = file;
    if (!this.leafVisible || this.followRunning || !this.consumer) return;
    this.followRunning = true;
    this.followCompletion = this.drainActiveFileFollow().catch((error) => {
      console.error('[graph+] active-note follow failed', error);
    });
    void this.followCompletion;
  }

  private async drainActiveFileFollow(): Promise<void> {
    try {
      while (this.leafVisible && this.consumer && this.activeFileToFollow) {
        const file = this.activeFileToFollow;
        this.activeFileToFollow = undefined;
        await this.consumer.followActiveNode(noteNodeId(file.path));
      }
    } finally {
      this.followRunning = false;
      if (!this.explicitNavigation && this.leafVisible && this.consumer && this.activeFileToFollow) {
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

function createWindowClock(container: HTMLElement) {
  const window = container.ownerDocument.defaultView;
  return {
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) => window?.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => window?.clearTimeout(handle as number),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
