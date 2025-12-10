import { App, ItemView, WorkspaceLeaf, Plugin, TFile, Platform } from 'obsidian';
import { GraphManager } from './graph/GraphManager.ts';
import { debounce } from './utils/debounce.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphView extends ItemView {
  private manager             : GraphManager | null = null;
  private plugin              : Plugin;
  private scheduleGraphRefresh: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
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
    const container = this.containerEl.createDiv({ cls: 'graph+' });
    this.manager    = new GraphManager(this.app, container, this.plugin);
    await this.manager.init();
    if (this.manager) {
      this.manager.setOnNodeClick((node) => this.openNodeFile(node));
    }
    // Debounced refresh to avoid thrashing on vault events
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.manager?.refreshGraph();
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
    this.manager?.resize(rect.width, rect.height);
  }

  async onClose() {
    // save node positions?
    this.manager?.destroy();
    this.manager = null;
    this.containerEl.empty();
  }

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;
    let file: TFile | null = null;
    if ((node as any).file) file = (node as any).file as TFile;
    else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      console.error('Greater Graph: failed to open file', e);
    } 
  }
}