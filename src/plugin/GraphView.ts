import { ItemView, WorkspaceLeaf, Plugin } from 'obsidian';
import { GraphController } from '../graph/GraphController.ts';
import { debounce } from '../shared/debounce.ts';
import GraphPlus from './main.ts';
import { GraphInteractor } from '../graph/GraphInteractor.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphView extends ItemView {
  private graph               : GraphController | null = null;
  private plugin              : GraphPlus;
  private GraphInteractor     : GraphInteractor | null = null;
  private scheduleGraphRefresh: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphPlus;
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

  async onOpen() {
    this.containerEl.empty();
    const container       = this.containerEl.createDiv({ cls: 'graph+' });
    this.graph     = new GraphController(this.app, container, this.plugin);
    await this.graph.init();
    
    // Debounced refresh to avoid thrashing on vault events
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.graph?.refreshGraph();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Greater Graph: refreshGraph error', e);
        }
      }, 200, true);
    }

    // Register only structural vault listeners so the view updates on file changes,
    // not on every keystroke/content metadata parse.
    // Use this.registerEvent so Obsidian will unregister them when the view closes
    this.registerEvent(this.app.vault.on('create', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    // Note: We intentionally do NOT rebuild on metadataCache 'changed' to avoid refreshes
    // while typing. Optional incremental updates can hook into metadata changes separately.
  }

  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.graph?.resize(rect.width, rect.height);
  }

  async onClose() {
    // save node positions?
    this.graph?.destroy();
    this.graph = null;
    this.containerEl.empty();
  }
}