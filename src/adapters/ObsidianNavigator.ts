import { App, TFile } from "obsidian";

export class ObsidianNavigator {
  constructor(private app: App) {}

  async openNodeById(nodeId: string): Promise<void> {
    const af = this.app.vault.getAbstractFileByPath(nodeId);
    const file = af instanceof TFile ? af : null;
    if (!file) return;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async openTagSearch(tagId: string): Promise<void> {
    const query = `tag:#${tagId}`;
    const leaf =
      this.app.workspace.getLeavesOfType("search")[0] ??
      this.app.workspace.getRightLeaf(false);

    if (!leaf) return;

    await leaf.setViewState(
      { type: "search", active: true, state: { query } },
      { focus: true }
    );
    this.app.workspace.revealLeaf(leaf);
  }
}
