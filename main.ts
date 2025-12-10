import { App, Plugin, PluginSettingTab, Setting, TextComponent, ToggleComponent } from 'obsidian';
import { GraphView, GRAPH_PLUS_TYPE } from './GraphView.ts';
import { initSettings, getSettings, updateSettings } from './utilities/settingsStore.ts';
import { GraphPlusSettingTab } from './SettingsTab.ts';
import { DEFAULT_SETTINGS } from './utilities/defaultSettings.ts';


export default class GraphPlus extends Plugin {

  async onload() {
    initSettings({ ...DEFAULT_SETTINGS });
    this.registerView(GRAPH_PLUS_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id  : 'open-graph+',
      name: 'open graph+',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new GraphPlusSettingTab(this.app, this));
  }

  async activateView() {
    // Change this to open as a tab
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length === 0) {
      // open in the main area as a new tab/leaf
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GRAPH_PLUS_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  onunload() {
    // View teardown is handled by GraphView.onClose
  }

  async saveSettings() {
    await this.saveData(getSettings());
  }
}
