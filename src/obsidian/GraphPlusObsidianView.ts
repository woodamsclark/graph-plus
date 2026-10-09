import { ItemView, Modal, Notice, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import {
  GraphPlusPresentationV1,
  type GraphPlusApplicationV1,
  type GraphPlusExperienceModeV1,
} from '../graph-plus/application/index.ts';
import {
  coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1,
} from '../graph-plus/query/index.ts';
import { GraphPlusNotePreviewControllerV1 } from './GraphPlusNotePreviewController.ts';
import { createGraphPlusNotePreviewControllerV1 } from './createGraphPlusNotePreviewController.ts';
import { GraphPlusViewLifecycleV1 } from './GraphPlusViewLifecycle.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphEnginePlugin from './main.ts';
import { GraphPlusCheckpointRecoveryErrorV1 } from './settings/GraphPlusCheckpointFileStore.ts';
import { mountGraphPlusCheckpointRecoverySurfaceV1 } from './GraphPlusCheckpointRecoverySurface.ts';

/** Obsidian hosts one Graph+ application; experience policy supplies Global or Local behavior. */
export abstract class GraphPlusObsidianViewV1 extends ItemView {
  protected readonly plugin: GraphEnginePlugin;
  protected readonly experienceMode: GraphPlusExperienceModeV1;
  private application?: GraphPlusPresentationV1<TFile>;
  private applicationOwner?: GraphPlusApplicationV1<TFile>;
  private fallback?: Disposable;
  private lifecycle?: GraphPlusViewLifecycleV1;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private stateRestored = false;
  private notePreview?: GraphPlusNotePreviewControllerV1<TFile>;
  private lastCheckpointWarning = 0;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin, experienceMode: GraphPlusExperienceModeV1) {
    super(leaf);
    this.plugin = plugin as GraphEnginePlugin;
    this.experienceMode = experienceMode;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const classes = this.experienceMode === 'local'
      ? 'graphplus-view graphplus-local-view'
      : 'graphplus-view';
    const container = this.contentEl.createDiv({ cls: classes });
    this.lifecycle = new GraphPlusViewLifecycleV1(this.contentEl, {
      setSuspended: (suspended) => this.application?.setSuspended(suspended),
      clearPreview: () => this.notePreview?.clear(),
      onRevealed: () => {
        if (this.experienceMode === 'local') void this.application?.recenterFocusedNode();
      },
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
      const lease = this.plugin.acquireGraphPlusLease();
      this.applicationOwner = this.plugin.graphPlusApplication;
      let application!: GraphPlusPresentationV1<TFile>;
      application = this.plugin.graphPlusApplication.createPresentation({
        mode: this.experienceMode,
        lease,
        container,
        vaultId: this.app.vault.getName(),
        checkpointStore: this.plugin.graphPlusCheckpointStore,
        ...(this.experienceMode === 'global' ? {
          legacyPositions: this.plugin.getLegacyGraphState(this.app.vault.getName()),
          restoreSavedLens: !this.stateRestored,
          clock: createWindowClock(container),
        } : {
          initialRootNodeId: this.plugin.obsidianGraphBridge.activeNoteNodeId(),
        }),
        initialLens: this.pendingLens,
        ui: {
          quickSettings: {
            contributions: createGraphPlusUiContributionsV1(() => application),
          },
        },
        onError: error => console.error(`[${this.experienceMode} graph+] application error`, error),
        onCheckpointError: error => {
          console.error('[graph+] checkpoint save failed', error);
          if (Date.now() - this.lastCheckpointWarning > 10_000) {
            this.lastCheckpointWarning = Date.now();
            new Notice('Graph+ could not save its layout. Existing saved data has not been replaced.');
          }
        },
        onNotePreview: (request) => this.notePreview?.update(request),
      });
      this.application = application;
      await application.open();
      const activity = this.plugin.graphPlusApplication.onHostActivity(() => this.synchronizeLeafVisibility());
      this.lifecycle.register(() => activity.dispose());
      this.synchronizeLeafVisibility();
    } catch (error) {
      console.error(`[${this.experienceMode} graph+] failed to open`, error);
      if (this.application) {
        await this.applicationOwner?.closePresentation(this.application).catch(() => undefined);
      }
      this.application = undefined;
      this.applicationOwner = undefined;
      if (error instanceof GraphPlusCheckpointRecoveryErrorV1) this.mountRecovery(container, error);
      else this.fallback = mountGraphEngineUnavailableSurfaceV1(container, {
        code: 'initialization-failed', message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onClose(): Promise<void> {
    this.lifecycle?.dispose();
    this.lifecycle = undefined;
    try {
      if (this.application) await this.applicationOwner?.closePresentation(this.application);
    } finally {
      this.application = undefined;
      this.applicationOwner = undefined;
      this.fallback?.dispose();
      this.fallback = undefined;
      this.notePreview?.dispose();
      this.notePreview = undefined;
    }
  }

  private mountRecovery(container: HTMLElement, error: GraphPlusCheckpointRecoveryErrorV1): void {
    this.fallback = mountGraphPlusCheckpointRecoverySurfaceV1(container, {
      message: error.message,
      onRetry: async () => { await this.onClose(); await this.onOpen(); },
      ...(this.plugin.hasPreviousGraphPlusCheckpoint() ? {
        onRestorePrevious: () => this.plugin.recoverGraphPlusCheckpoint('previous'),
      } : {}),
      onReset: async () => {
        new GraphPlusRecoveryResetModalV1(this.app, () => this.plugin.recoverGraphPlusCheckpoint('reset')).open();
      },
      onError: failure => new Notice(failure instanceof Error ? failure.message : String(failure)),
    });
  }

  getLifecycleDiagnostics(): Readonly<Record<string, unknown>> {
    return {
      type: this.getViewType(),
      experienceMode: this.experienceMode,
      contentShown: this.contentEl.isShown(),
      trackedVisible: this.lifecycle?.isVisible ?? false,
      hasApplication: this.application !== undefined,
      listenerCount: this.lifecycle?.listenerCount ?? 0,
    };
  }

  getState(): Record<string, unknown> {
    return {
      mode: this.experienceMode,
      lens: this.application?.getLens() ?? this.pendingLens,
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    if (!isRecord(state)) return;
    const lens = coerceGraphPlusLensStateV1(state.lens);
    if (lens) {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(lens);
      await this.application?.setLens(this.pendingLens);
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
    this.notePreview?.clear();
    return this.application?.resetLayoutData() ?? false;
  }

  onResize(): void { this.synchronizeLeafVisibility(); }

  private synchronizeLeafVisibility(): void {
    this.lifecycle?.synchronizeVisibility();
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

class GraphPlusRecoveryResetModalV1 extends Modal {
  constructor(app: Modal['app'], private readonly reset: () => Promise<void>) { super(app); }

  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Reset the saved graph layout?' });
    this.contentEl.createEl('p', {
      text: 'Graph+ will generate a fresh layout. The failed saved data will be archived for manual recovery. Your notes and plugin settings will be preserved.',
    });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const reset = actions.createEl('button', { text: 'Reset saved layout', cls: 'mod-warning' });
    reset.addEventListener('click', () => {
      reset.disabled = true;
      void this.reset().then(() => this.close()).catch(error => {
        reset.disabled = false;
        new Notice(error instanceof Error ? error.message : String(error));
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
