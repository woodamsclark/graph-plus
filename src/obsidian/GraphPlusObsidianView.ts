import {
  ItemView, MarkdownView,
  type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf,
} from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import {
  GraphPlusApplicationV1,
  type GraphPlusExperienceModeV1,
} from '../graph-plus/application/index.ts';
import {
  coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1,
} from '../graph-plus/query/index.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import { GraphPlusNotePreviewControllerV1 } from './GraphPlusNotePreviewController.ts';
import { createGraphPlusNotePreviewControllerV1 } from './createGraphPlusNotePreviewController.ts';
import { GraphPlusViewLifecycleV1 } from './GraphPlusViewLifecycle.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphEnginePlugin from './main.ts';

/** Obsidian hosts one Graph+ application; experience policy supplies Global or Local behavior. */
export abstract class GraphPlusObsidianViewV1 extends ItemView {
  protected readonly plugin: GraphEnginePlugin;
  protected readonly experienceMode: GraphPlusExperienceModeV1;
  private application?: GraphPlusApplicationV1<TFile>;
  private fallback?: Disposable;
  private lifecycle?: GraphPlusViewLifecycleV1;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private pendingDepth = 1;
  private stateRestored = false;
  private notePreview?: GraphPlusNotePreviewControllerV1<TFile>;
  private activeFileToFollow?: TFile;
  private followRunning = false;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin, experienceMode: GraphPlusExperienceModeV1) {
    super(leaf);
    this.plugin = plugin as GraphEnginePlugin;
    this.experienceMode = experienceMode;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const classes = this.experienceMode === 'local'
      ? 'greater-graph-view graphplus-view graphplus-local-view'
      : 'greater-graph-view graphplus-view';
    const container = this.contentEl.createDiv({ cls: classes });
    this.lifecycle = new GraphPlusViewLifecycleV1(this.contentEl, {
      setSuspended: (suspended) => this.application?.setSuspended(suspended),
      clearPreview: () => this.notePreview?.clear(),
      reconcile: () => this.application?.reconcile(),
    });
    this.notePreview = createGraphPlusNotePreviewControllerV1({
      app: this.app,
      container: this.contentEl,
      isVisible: () => this.lifecycle?.isVisible ?? false,
      onPreviewSurfaceActive: (active) => this.application?.setPreviewSurfaceActive(active),
      onDismissRequested: () => this.application?.clearPreview(),
    });
    if (!this.stateRestored) this.pendingLens = { ...this.pendingLens, showTags: this.plugin.settings.showTags };
    try {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(this.pendingLens);
      const activeFile = this.experienceMode === 'local'
        ? this.activeMarkdownFile() ?? this.app.workspace.getActiveFile()
        : null;
      const lease = this.plugin.acquireGraphPlusLease();
      let application!: GraphPlusApplicationV1<TFile>;
      application = new GraphPlusApplicationV1({
        mode: this.experienceMode,
        lease,
        container,
        model: this.plugin.graphPlusVaultModel,
        navigator: new GraphPlusObsidianNavigatorV1(this.app),
        ...(this.experienceMode === 'global' ? {
          vaultId: this.app.vault.getName(),
          checkpointStore: this.plugin.graphPlusCheckpointStore,
          legacyPositions: this.plugin.getLegacyGraphState(this.app.vault.getName()),
          restoreSavedLens: !this.stateRestored,
          clock: createWindowClock(container),
        } : {
          initialRootNodeId: activeFile?.extension === 'md' ? noteNodeId(activeFile.path) : undefined,
          initialDepth: this.pendingDepth,
        }),
        initialLens: this.pendingLens,
        ui: {
          quickSettings: {
            contributions: createGraphPlusUiContributionsV1(
              () => application,
              this.experienceMode === 'local' ? () => application : undefined,
            ),
          },
        },
        onError: (error) => console.error(`[${this.experienceMode} graph+] application error`, error),
        onNotePreview: (request) => this.notePreview?.update(request),
      });
      this.application = application;
      await application.open();
      this.registerHostEvents();
      this.synchronizeLeafVisibility();
      if (this.experienceMode === 'local') this.requestActiveFileFollow(activeFile);
    } catch (error) {
      console.error(`[${this.experienceMode} graph+] failed to open`, error);
      await this.application?.close().catch(() => undefined);
      this.application = undefined;
      this.fallback = mountGraphEngineUnavailableSurfaceV1(container, {
        code: 'initialization-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onClose(): Promise<void> {
    this.lifecycle?.dispose();
    this.lifecycle = undefined;
    await this.application?.close();
    this.application = undefined;
    this.fallback?.dispose();
    this.fallback = undefined;
    this.activeFileToFollow = undefined;
    this.followRunning = false;
    this.notePreview?.dispose();
    this.notePreview = undefined;
  }

  getLifecycleDiagnostics(): Readonly<Record<string, unknown>> {
    return {
      type: this.getViewType(),
      experienceMode: this.experienceMode,
      contentShown: this.contentEl.isShown(),
      trackedVisible: this.lifecycle?.isVisible ?? false,
      hasApplication: this.application !== undefined,
      listenerCount: this.lifecycle?.listenerCount ?? 0,
      rebuildScheduled: this.lifecycle?.rebuildScheduled ?? false,
      reconcilePending: this.lifecycle?.hasReconcilePending ?? false,
      ...(this.experienceMode === 'local' ? { followRunning: this.followRunning } : {}),
    };
  }

  getState(): Record<string, unknown> {
    return {
      mode: this.experienceMode,
      lens: this.application?.getLens() ?? this.pendingLens,
      ...(this.experienceMode === 'local'
        ? { depth: this.application?.getLocalDepth() ?? this.pendingDepth }
        : {}),
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    if (!isRecord(state)) return;
    const lens = coerceGraphPlusLensStateV1(state.lens);
    if (lens) {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(lens);
      await this.application?.setLens(this.pendingLens);
    }
    if (this.experienceMode === 'local') {
      this.pendingDepth = coerceDepth(state.depth);
      await this.application?.setLocalDepth(this.pendingDepth);
    }
    this.stateRestored = true;
  }

  async showFile(file: TFile): Promise<boolean> {
    const application = this.application;
    if (!application) return false;
    await application.open();
    if (this.application !== application) return false;
    return application.revealAndFocusNode(noteNodeId(file.path));
  }

  async resetGraphLayoutData(): Promise<boolean> {
    this.lifecycle?.cancelReconcile();
    this.notePreview?.clear();
    return this.application?.resetLayoutData() ?? false;
  }

  private registerHostEvents(): void {
    if (!this.lifecycle || this.lifecycle.listenerCount > 0) return;
    const schedule = (): void => this.lifecycle?.scheduleReconcile();
    const createRef = this.app.vault.on('create', schedule);
    const modifyRef = this.app.vault.on('modify', schedule);
    const deleteRef = this.app.vault.on('delete', schedule);
    const renameRef = this.app.vault.on('rename', schedule);
    const metadataRef = this.app.metadataCache.on('changed', schedule);
    const activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
      this.synchronizeLeafVisibility();
      if (this.experienceMode === 'local') this.requestActiveFileFollow(this.activeMarkdownFile());
    });
    this.lifecycle.register(
      () => this.app.vault.offref(createRef),
      () => this.app.vault.offref(modifyRef),
      () => this.app.vault.offref(deleteRef),
      () => this.app.vault.offref(renameRef),
      () => this.app.metadataCache.offref(metadataRef),
      () => this.app.workspace.offref(activeLeafRef),
    );
    if (this.experienceMode === 'local') {
      const fileOpenRef = this.app.workspace.on('file-open', (file) => this.requestActiveFileFollow(file));
      this.lifecycle.register(() => this.app.workspace.offref(fileOpenRef));
    }
  }

  private synchronizeLeafVisibility(): void {
    if (!this.lifecycle?.synchronizeVisibility() || this.experienceMode !== 'local') return;
    this.requestActiveFileFollow(this.activeFileToFollow ?? this.app.workspace.getActiveFile());
  }

  private activeMarkdownFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private requestActiveFileFollow(file: TFile | null): void {
    if (this.experienceMode !== 'local' || !file || file.extension !== 'md') return;
    this.activeFileToFollow = file;
    if (!this.lifecycle?.isVisible || this.followRunning || !this.application) return;
    this.followRunning = true;
    void this.drainActiveFileFollow();
  }

  private async drainActiveFileFollow(): Promise<void> {
    try {
      while (this.lifecycle?.isVisible && this.application && this.activeFileToFollow) {
        const file = this.activeFileToFollow;
        this.activeFileToFollow = undefined;
        await this.application.followActiveNode(noteNodeId(file.path));
      }
    } finally {
      this.followRunning = false;
      if (this.lifecycle?.isVisible && this.application && this.activeFileToFollow) {
        this.requestActiveFileFollow(this.activeFileToFollow);
      }
    }
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

function coerceDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.round(value))) : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
