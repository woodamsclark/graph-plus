import { App, PluginSettingTab, Setting } from 'obsidian';
import type GraphPlus from '../main.ts';
import {
  GRAPH_ENGINE_GLOBAL_PANE,
  GRAPH_PLUS_CONSUMER_PANE,
  GraphEngineSettingsPanelV1,
} from './GraphEngineSettingsPanel.ts';

export class GraphPlusSettingTab extends PluginSettingTab {
  private selectedPane = GRAPH_ENGINE_GLOBAL_PANE;

  constructor(app: App, private readonly graphPlus: GraphPlus) {
    super(app, graphPlus);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Graph+ and Graph Engine' });
    const enginePanel = new GraphEngineSettingsPanelV1(this.graphPlus.engineSettings);
    enginePanel.addPaneSelector(containerEl, this.selectedPane, (value) => {
      this.selectedPane = value;
      this.display();
    });
    if (this.selectedPane === GRAPH_PLUS_CONSUMER_PANE) {
      this.renderGraphPlus(containerEl);
      return;
    }
    enginePanel.render(containerEl, this.selectedPane, () => this.display());
  }

  private renderGraphPlus(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Graph+ product' });
    parent.createEl('p', {
      text: 'Graph+ interprets your vault as notes and tags. Graph Engine remains available to external consumers when Graph+ is disabled.',
      cls: 'setting-item-description',
    });
    const settings = this.graphPlus.settings;
    new Setting(parent).setName('Enable Graph+').setDesc('Allow the bundled vault graph view and Open: graph+ command.')
      .addToggle((toggle) => toggle.setValue(settings.enabled).onChange(async (enabled) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, enabled });
      }));
    new Setting(parent).setName('Show tags by default').setDesc('New Graph+ views begin with tag nodes visible.')
      .addToggle((toggle) => toggle.setValue(settings.showTags).onChange(async (showTags) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, showTags });
      }));
    new Setting(parent).setName('Count duplicate links').setDesc('Use repeated note links as neutral edge weight.')
      .addToggle((toggle) => toggle.setValue(settings.countDuplicateLinks).onChange(async (countDuplicateLinks) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, countDuplicateLinks });
      }));
  }
}
