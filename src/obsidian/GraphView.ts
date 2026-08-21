import { ItemView, WorkspaceLeaf, Plugin, type ViewStateResult } from 'obsidian';
import GraphPlus from './main.ts';
import { GraphEngineRuntime } from '../graph+/engine/runtime/GraphEngineRuntime.ts';
import type { GraphLensState } from '../graph+/types/domain/lens.ts';
import { createDefaultGraphLens } from '../graph+/types/domain/lens.ts';
import { getSettings } from './settings/settingsStore.ts';


export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphView extends ItemView {
  private plugin              : GraphPlus;
  private scheduleGraphRebuild: (() => void) | null = null;
  private unregisters: Array<() => void> = [];
  private graphEngine: GraphEngineRuntime | null = null;
  private pendingLensState: GraphLensState | null = null;
  private rebuildTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphPlus;
  }

  async onOpen() {
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'greater-graph-view graphplus-view' });

    this.graphEngine = new GraphEngineRuntime({
      app: this.app,
      plugin: this.plugin,
      containerEl: container,
      initialLensState: this.pendingLensState ?? undefined,
      onLensStateChange: (state) => {
        this.pendingLensState = state;
        this.app.workspace.requestSaveLayout();
      },
    });
    await this.graphEngine.open();
    this.registerGraphRebuildEvents();
  }

  onResize() {
    const rect = this.contentEl.getBoundingClientRect();
    this.graphEngine?.resize(rect.width, rect.height);
  }

  async onClose() {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    for (const unregister of this.unregisters.splice(0)) unregister();
    await this.graphEngine?.close();
    this.graphEngine = null;
  }

  getViewType(): string {
    return GRAPH_PLUS_TYPE;
  }

  getDisplayText(): string {
    return 'graph+';
  }

  getIcon(): string {
    return 'dot-network';
  }

  getState(): Record<string, unknown> {
    return {
      lens: this.graphEngine?.getLensState() ?? this.pendingLensState,
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const raw = isRecord(state) && isRecord(state.lens) ? state.lens : null;
    if (!raw) return;
    this.pendingLensState = coerceLens(raw);
    this.graphEngine?.setLensState(this.pendingLensState);
  }

  private registerGraphRebuildEvents(): void {
    if (this.unregisters.length) return;
    const schedule = () => {
      if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => {
        this.rebuildTimer = null;
        void this.graphEngine?.rebuildGraph();
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

function coerceLens(raw: Record<string, unknown>): GraphLensState {
  const fallback = createDefaultGraphLens(getSettings().base.showTags);
  const filter = isRecord(raw.filter) ? raw.filter : {};
  const form = isRecord(raw.form) ? raw.form : {};
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  return {
    filter: {
      query: typeof filter.query === 'string' ? filter.query : fallback.filter.query,
      showTags: typeof filter.showTags === 'boolean' ? filter.showTags : fallback.filter.showTags,
      showAttachments: typeof filter.showAttachments === 'boolean' ? filter.showAttachments : fallback.filter.showAttachments,
      showUnresolved: typeof filter.showUnresolved === 'boolean' ? filter.showUnresolved : fallback.filter.showUnresolved,
      showOrphans: typeof filter.showOrphans === 'boolean' ? filter.showOrphans : fallback.filter.showOrphans,
    },
    groups: groups.filter(isRecord).map((group, index) => ({
      id: typeof group.id === 'string' ? group.id : `group-${index}`,
      query: typeof group.query === 'string' ? group.query : '',
      color: typeof group.color === 'string' ? group.color : '#4fc3f7',
    })),
    form: {
      mode: form.mode === 'mind-map' ? 'mind-map' : 'free',
      rootId: typeof form.rootId === 'string' ? form.rootId : null,
      direction: form.direction === 'incoming' || form.direction === 'outgoing' ? form.direction : 'both',
      relation: typeof form.relation === 'string' ? form.relation : '',
      maxDepth: typeof form.maxDepth === 'number' ? form.maxDepth : null,
      showCrossLinks: typeof form.showCrossLinks === 'boolean' ? form.showCrossLinks : true,
      showDisconnected: typeof form.showDisconnected === 'boolean' ? form.showDisconnected : false,
      colorBranches: typeof form.colorBranches === 'boolean' ? form.colorBranches : true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
