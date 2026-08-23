import { ItemView, type Plugin, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { mountGraphEngineUnavailableSurfaceV1, type Disposable } from '../graph-engine/public.ts';
import { ObsidianVaultGraphSourceV1 } from '../graph-plus/adapter/index.ts';
import { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import { createDefaultGraphPlusLensV1, type GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { GraphPlusControlsPanelV1 } from './GraphPlusControlsPanel.ts';
import { GraphPlusObsidianNavigatorV1 } from './GraphPlusObsidianNavigator.ts';
import type GraphPlus from './main.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphPlusView extends ItemView {
  private readonly plugin: GraphPlus;
  private consumer?: GraphPlusConsumerV1<TFile>;
  private controls?: GraphPlusControlsPanelV1<TFile>;
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
      const lease = this.plugin.acquireGraphPlusLease();
      this.consumer = new GraphPlusConsumerV1({
        lease,
        container,
        vaultId: this.app.vault.getName(),
        source: new ObsidianVaultGraphSourceV1(this.app),
        checkpointStore: this.plugin.graphPlusCheckpointStore,
        navigator: new GraphPlusObsidianNavigatorV1(this.app),
        countDuplicateLinks: this.plugin.settings.countDuplicateLinks,
        legacyPositions: this.plugin.getLegacyGraphState(this.app.vault.getName()),
        initialLens: this.pendingLens,
        clock: createWindowClock(container),
        onError: (error) => console.error('[Graph+] consumer error', error),
      });
      await this.consumer.open();
      this.controls = new GraphPlusControlsPanelV1(
        container,
        this.consumer,
      );
      this.controls.mount();
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
    this.controls?.unmount();
    this.controls = undefined;
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
    const lens = coerceLens(isRecord(state) ? state.lens : undefined);
    if (!lens) return;
    this.pendingLens = lens;
    this.stateRestored = true;
    await this.consumer?.setLens(lens);
  }

  private registerGraphRebuildEvents(): void {
    if (this.unregisters.length > 0) return;
    const schedule = (): void => {
      const window = this.contentEl.ownerDocument.defaultView;
      if (this.rebuildTimer !== undefined) window?.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window?.setTimeout(() => {
        this.rebuildTimer = undefined;
        void this.consumer?.reconcile().then(() => this.controls?.refresh());
      }, 180);
    };
    const createRef = this.app.vault.on('create', schedule);
    const deleteRef = this.app.vault.on('delete', schedule);
    const renameRef = this.app.vault.on('rename', schedule);
    const metadataRef = this.app.metadataCache.on('changed', schedule);
    this.unregisters.push(
      () => this.app.vault.offref(createRef),
      () => this.app.vault.offref(deleteRef),
      () => this.app.vault.offref(renameRef),
      () => this.app.metadataCache.offref(metadataRef),
    );
  }
}

function coerceLens(value: unknown): GraphPlusLensStateV1 | undefined {
  if (!isRecord(value)) return undefined;
  const fallback = createDefaultGraphPlusLensV1();
  const form = isRecord(value.form) ? value.form : {};
  return {
    query: typeof value.query === 'string' ? value.query : fallback.query,
    showTags: typeof value.showTags === 'boolean' ? value.showTags : fallback.showTags,
    showOrphans: typeof value.showOrphans === 'boolean' ? value.showOrphans : fallback.showOrphans,
    display: isRecord(value.display) ? {
      ...(value.display.labelMode === 'adaptive' || value.display.labelMode === 'all' || value.display.labelMode === 'off'
        ? { labelMode: value.display.labelMode }
        : typeof value.display.showLabels === 'boolean' && value.display.showLabels === false
          ? { labelMode: 'off' as const }
          : {}),
      ...optionalLegacyNumber(value.display.nodeRadiusScale, 1, true, 'nodeRadiusScale'),
      ...optionalLegacyNumber(value.display.edgeThicknessScale, 1, true, 'edgeThicknessScale'),
    } : fallback.display,
    force: isRecord(value.force) ? {
      ...optionalLegacyNumber(value.force.repulsionStrength, 18000, false, 'repulsionStrength'),
      ...optionalLegacyNumber(value.force.springStrength, 3.5, false, 'springStrength'),
      ...optionalLegacyNumber(value.force.springLength, 80, true, 'springLength'),
      ...optionalLegacyNumber(value.force.centeringStrength, 0.45, false, 'centeringStrength'),
    } : fallback.force,
    form: {
      enabled: typeof form.enabled === 'boolean' ? form.enabled : fallback.form.enabled,
      ...(typeof form.rootNodeId === 'string' && form.rootNodeId ? { rootNodeId: form.rootNodeId } : {}),
      direction: form.direction === 'incoming' || form.direction === 'outgoing' ? form.direction : 'either',
      ...(typeof form.relation === 'string' && form.relation ? { relation: form.relation } : {}),
      ...(typeof form.maxDepth === 'number' ? { maxDepth: form.maxDepth } : {}),
      showCrossLinks: typeof form.showCrossLinks === 'boolean' ? form.showCrossLinks : fallback.form.showCrossLinks,
      showDisconnected: typeof form.showDisconnected === 'boolean' ? form.showDisconnected : fallback.form.showDisconnected,
      colorBranches: typeof form.colorBranches === 'boolean' ? form.colorBranches : fallback.form.colorBranches,
    },
  };
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

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalLegacyNumber(
  value: unknown,
  legacyDefault: number,
  positive: boolean,
  key: string,
): Record<string, number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  if (positive ? value <= 0 : value < 0) return {};
  return value === legacyDefault ? {} : { [key]: value };
}
