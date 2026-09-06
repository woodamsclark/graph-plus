import { ItemView, MarkdownView, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import { LocalGraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import { coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphEnginePlugin from './main.ts';

export const LOCAL_GRAPH_PLUS_TYPE = 'graph-plus-local';

export class LocalGraphPlusView extends ItemView {
  private readonly plugin: GraphEnginePlugin;
  private consumer?: LocalGraphPlusConsumerV1<TFile>;
  private fallback?: Disposable;
  private unregisters: Array<() => void> = [];
  private rebuildTimer: number | undefined;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private pendingDepth = 1;
  private stateRestored = false;
  private leafVisible = true;
  private reconcilePending = false;
  private previewAnchor?: HTMLElement;
  private activeFileToFollow?: TFile;
  private followRunning = false;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphEnginePlugin;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'greater-graph-view graphplus-view graphplus-local-view' });
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
    this.clearNotePreview();
  }

  getViewType(): string { return LOCAL_GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'local graph+'; }
  getIcon(): string { return 'network'; }

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
    if (!visible) this.clearNotePreview();
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
    if (!file || file.extension !== 'md') return;
    this.activeFileToFollow = file;
    if (!this.leafVisible || this.followRunning || !this.consumer) return;
    this.followRunning = true;
    void this.drainActiveFileFollow();
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
      if (this.leafVisible && this.consumer && this.activeFileToFollow) {
        this.requestActiveFileFollow(this.activeFileToFollow);
      }
    }
  }

  private updateNotePreview(request: {
    readonly file?: TFile;
    readonly anchor?: { readonly x: number; readonly y: number };
    readonly mod: boolean;
  }): void {
    if (!request.mod || !request.file || !request.anchor || !this.leafVisible) {
      this.clearNotePreview();
      return;
    }
    this.clearNotePreview();
    const canvas = this.contentEl.querySelector('canvas');
    if (!(canvas instanceof this.contentEl.ownerDocument.defaultView!.HTMLCanvasElement)) return;
    const bounds = canvas.getBoundingClientRect();
    const deviceRatio = Math.max(1, this.contentEl.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    const logicalWidth = canvas.width / deviceRatio;
    const ratio = logicalWidth > 0 ? bounds.width / logicalWidth : 1;
    const anchor = this.contentEl.createDiv({ cls: 'graphplus-native-preview-anchor' });
    anchor.style.position = 'absolute';
    anchor.style.pointerEvents = 'none';
    anchor.style.width = '1px';
    anchor.style.height = '1px';
    anchor.style.left = `${bounds.left - this.contentEl.getBoundingClientRect().left + request.anchor.x * ratio}px`;
    anchor.style.top = `${bounds.top - this.contentEl.getBoundingClientRect().top + request.anchor.y * ratio}px`;
    this.previewAnchor = anchor;
    const window = this.contentEl.ownerDocument.defaultView!;
    const mac = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform ?? '');
    const event = new window.MouseEvent('mouseover', {
      bubbles: true,
      clientX: bounds.left + request.anchor.x * ratio,
      clientY: bounds.top + request.anchor.y * ratio,
      metaKey: mac,
      ctrlKey: !mac,
    });
    this.app.workspace.trigger('hover-link', {
      event,
      source: LOCAL_GRAPH_PLUS_TYPE,
      hoverParent: this.leaf,
      targetEl: anchor,
      linktext: request.file.path,
      sourcePath: request.file.path,
    });
  }

  private clearNotePreview(): void {
    if (this.previewAnchor) {
      const window = this.contentEl.ownerDocument.defaultView;
      if (window) this.previewAnchor.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
      this.previewAnchor.remove();
      this.previewAnchor = undefined;
    }
    const popover = this.leaf.hoverPopover as unknown as { hide?: () => void } | null;
    popover?.hide?.();
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
