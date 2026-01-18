import { ItemView, WorkspaceLeaf, Plugin } from 'obsidian';
import GraphPlus from './main.ts';
import { Orchestrator } from '../graph+/orchestration/Orchestrator.ts';


export const GRAPH_PLUS_TYPE = 'graph-plus';

export class GraphView extends ItemView {
  private plugin              : GraphPlus;
  private scheduleGraphRebuild: (() => void) | null = null;
  private unregisters: Array<() => void> = [];
  private garden: Orchestrator | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin as GraphPlus;
  }

  async onOpen() {
    this.containerEl.empty();
    const container       = this.containerEl.createDiv({ cls: 'graph+' });

    this.garden = new Orchestrator({ app: this.app, plugin: this.plugin, containerEl: container });
    await this.garden.open();
  }

  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.garden?.resize(rect.width, rect.height);
  }

  async onClose() {
    await this.garden?.close();
    this.garden = null;
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