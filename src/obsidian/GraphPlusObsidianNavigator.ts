import type { App, TFile } from 'obsidian';
import type { GraphPlusNavigatorV1 } from '../graph-plus/consumer/index.ts';

export class GraphPlusObsidianNavigatorV1 implements GraphPlusNavigatorV1<TFile> {
  constructor(private readonly app: App) {}

  async openNote(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async openTag(tag: string): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType('search')[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: 'search', active: true, state: { query: `tag:#${tag}` } }, { focus: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
