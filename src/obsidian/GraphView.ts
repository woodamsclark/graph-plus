import { ItemView, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { ObsidianVaultGraphSourceV1 } from '../graph-plus/adapter/index.ts';
import { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import { coerceGraphPlusLensStateV1, createDefaultGraphPlusLensV1, type GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import { createGraphPlusUiContributionsV1 } from './GraphPlusUiContributions.ts';
import type GraphPlus from './main.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphPlusView extends ItemView {
  private readonly plugin: GraphPlus;
  private consumer?: GraphPlusConsumerV1<TFile>;
  private fallback?: Disposable;
  private unregisters: Array<() => void> = [];
  private rebuildTimer: number | undefined;
  private pendingLens: GraphPlusLensStateV1 = createDefaultGraphPlusLensV1();
  private stateRestored = false;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphPlus;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'greater-graph-view graphplus-view' });
    if (!this.stateRestored) this.pendingLens = { ...this.pendingLens, showTags: this.plugin.settings.showTags };
    try {
      this.pendingLens = await this.plugin.migrateLegacyLensSettings(this.pendingLens);
      const lease = this.plugin.acquireGraphPlusLease();
      let consumer!: GraphPlusConsumerV1<TFile>;
      consumer = new GraphPlusConsumerV1({
        lease,
        container,
        vaultId: this.app.vault.getName(),
        source: new ObsidianVaultGraphSourceV1(this.app),
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
        onError: (error) => console.error('[Graph+] consumer error', error),
      });
      this.consumer = consumer;
      await consumer.open();
      this.registerGraphRebuildEvents();
    } catch (error) {
      console.error('[Graph+] failed to open', error);
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
  }

  getViewType(): string { return GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'graph+'; }
  getIcon(): string { return 'dot-network'; }

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
    this.unregisters.push(
      () => this.app.vault.offref(createRef),
      () => this.app.vault.offref(modifyRef),
      () => this.app.vault.offref(deleteRef),
      () => this.app.vault.offref(renameRef),
      () => this.app.metadataCache.offref(metadataRef),
    );
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
