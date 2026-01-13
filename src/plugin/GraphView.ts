import { ItemView, WorkspaceLeaf, Plugin } from 'obsidian';
import { GraphController } from '../graph/GraphController.ts';
import { debounce } from '../shared/debounce.ts';
import GraphPlus from './main.ts';
import { GraphInteractor } from '../graph/GraphInteractor.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphView extends ItemView {
  private graphController               : GraphController | null = null;
  private plugin              : GraphPlus;
  private scheduleGraphRebuild: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphPlus;
  }

  async onOpen() {
    this.containerEl.empty();
    const container       = this.containerEl.createDiv({ cls: 'graph+' });
    this.graphController  = new GraphController(this.app, container, this.plugin);
    await this.graphController.init();
    
    // Debounced refresh to avoid thrashing on vault events
    if (!this.scheduleGraphRebuild)
      this.scheduleGraphRebuild = debounce(() => { void this.graphController?.rebuildGraph(); }, 200, false); // void instead of await

    

    // Register only structural vault listeners so the view updates on file changes,
    // not on every keystroke/content metadata parse.
    // Use this.registerEvent so Obsidian will unregister them when the view closes
    this.registerEvent(this.app.vault.on('create', () => this.scheduleGraphRebuild?.()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleGraphRebuild?.()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleGraphRebuild?.()));

    // Note: We intentionally do NOT rebuild on metadataCache 'changed' to avoid refreshes
    // while typing. Optional incremental updates can hook into metadata changes separately.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.graphController?.refreshTheme();  // rebuild snapshot of obsidian css themes in renderer
      })
    );
  }

  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.graphController?.resize(rect.width, rect.height);
  }

  async onClose() {
    // save node positions?
    this.graphController?.destroy();
    this.graphController = null;
    this.containerEl.empty();
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
}