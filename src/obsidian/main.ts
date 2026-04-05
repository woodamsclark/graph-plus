import { Plugin } from 'obsidian';
import { GraphView, GRAPH_PLUS_TYPE } from './GraphView.ts';
import { initSettings, getSettings } from './settings/settingsStore.ts';
import { GraphPlusSettingTab } from './settings/SettingsTab.ts';
import { DEFAULT_SETTINGS } from './settings/defaultSettings.ts';
import { GraphPlusSettings } from '../graph+/types/settings/appSettings.ts';


export default class GraphPlus extends Plugin {
  settings!: GraphPlusSettings;

  async onload() {
    const raw = (await this.loadData()) ?? {};
    initSettings({
      ...DEFAULT_SETTINGS,
      ...raw,
      base:     { ...DEFAULT_SETTINGS.base, ...raw.base },
      layout:   { ...DEFAULT_SETTINGS.layout, ...raw.layout },
      physics:  { ...DEFAULT_SETTINGS.physics, ...raw.physics },
      camera:   {
                  ...DEFAULT_SETTINGS.camera,
                  ...raw.camera,
                  state: {
                    ...DEFAULT_SETTINGS.camera.initialState,
                    ...raw.camera?.state,
                  },
                },
      ui:       { ...DEFAULT_SETTINGS.ui, ...raw.ui },
                });
    this.settings = getSettings();

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
    const raw       = (await this.loadData()) ?? {};
    const settings  = getSettings();

    await this.saveData({
      ...raw,
      base:     settings.base,
      layout:   settings.layout,
      physics:  settings.physics,
      camera:   settings.camera,
      ui:       settings.ui,
      tuning:   settings.tuning,
    });
  }
}
