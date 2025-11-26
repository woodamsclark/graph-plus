import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { GraphView, GREATER_GRAPH_VIEW_TYPE } from './GraphView';

export interface GlowSettings {
  minNodeRadius: number;
  maxNodeRadius: number;
  glowRadiusMultiplier: number;
  minCenterAlpha: number;
  maxCenterAlpha: number;
  hoverBoostFactor: number;
  neighborBoostFactor?: number;
  dimFactor?: number;
  hoverHighlightDepth?: number;
}

export interface GreaterGraphSettings {
  glow: GlowSettings;
}

export const DEFAULT_SETTINGS: GreaterGraphSettings = {
  glow: {
    minNodeRadius: 4,
    maxNodeRadius: 14,
    glowRadiusMultiplier: 2.0,
    minCenterAlpha: 0.10,
    maxCenterAlpha: 0.40,
    hoverBoostFactor: 1.6,
    neighborBoostFactor: 1.2,
    dimFactor: 0.3,
    hoverHighlightDepth: 1,
  },
};

export default class GreaterGraphPlugin extends Plugin {
  settings: GreaterGraphSettings = DEFAULT_SETTINGS;
  private settingsListeners: Array<() => void> = [];

  async onload() {
    await this.loadSettings();

    this.registerView(GREATER_GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));

    this.addCommand({
      id: 'open-greater-graph',
      name: 'Open Greater Graph',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new GreaterGraphSettingTab(this.app, this));
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(GREATER_GRAPH_VIEW_TYPE);
    if (leaves.length === 0) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      await rightLeaf.setViewState({
        type: GREATER_GRAPH_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(rightLeaf);
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  onunload() {
    // View teardown is handled by GraphView.onClose
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
    if (!this.settings.glow) this.settings.glow = DEFAULT_SETTINGS.glow;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.notifySettingsChanged();
  }

  registerSettingsListener(listener: () => void) {
    this.settingsListeners.push(listener);
    // return an unregister function
    return () => {
      const idx = this.settingsListeners.indexOf(listener);
      if (idx !== -1) this.settingsListeners.splice(idx, 1);
    };
  }

  notifySettingsChanged() {
    for (const l of this.settingsListeners) {
      try {
        l();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Greater Graph settings listener error:', e);
      }
    }
  }
}

class GreaterGraphSettingTab extends PluginSettingTab {
  plugin: GreaterGraphPlugin;

  constructor(app: App, plugin: GreaterGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Greater Graph – Glow Settings' });

    const glow = this.plugin.settings.glow;

    new Setting(containerEl)
      .setName('Minimum node radius')
      .setDesc('Minimum radius for the smallest node (in pixels).')
      .addText((text) =>
        text.setValue(String(glow.minNodeRadius)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > 0) {
            glow.minNodeRadius = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Maximum node radius')
      .setDesc('Maximum radius for the most connected node (in pixels).')
      .addText((text) =>
        text.setValue(String(glow.maxNodeRadius)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= glow.minNodeRadius) {
            glow.maxNodeRadius = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Glow radius multiplier')
      .setDesc('Glow radius as a multiple of the node radius.')
      .addText((text) =>
        text.setValue(String(glow.glowRadiusMultiplier)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > 0) {
            glow.glowRadiusMultiplier = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Minimum center glow opacity')
      .setDesc('Opacity (0–1) at the glow center for the least connected node.')
      .addText((text) =>
        text.setValue(String(glow.minCenterAlpha)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.minCenterAlpha = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Maximum center glow opacity')
      .setDesc('Opacity (0–1) at the glow center for the most connected node.')
      .addText((text) =>
        text.setValue(String(glow.maxCenterAlpha)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.maxCenterAlpha = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Hover glow boost')
      .setDesc('Multiplier applied to the center glow when a node is hovered.')
      .addText((text) =>
        text.setValue(String(glow.hoverBoostFactor)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 1.0) {
            glow.hoverBoostFactor = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Neighbor glow boost')
      .setDesc('Multiplier applied to nodes within the highlight depth (excluding hovered node).')
      .addText((text) =>
        text.setValue(String(glow.neighborBoostFactor ?? 1.2)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 1.0) {
            glow.neighborBoostFactor = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Dim factor for distant nodes')
      .setDesc('Multiplier (0–1) applied to nodes outside the highlight depth.')
      .addText((text) =>
        text.setValue(String(glow.dimFactor ?? 0.3)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.dimFactor = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Highlight depth')
      .setDesc('Graph distance (in hops) from the hovered node that will be highlighted.')
      .addText((text) =>
        text.setValue(String(glow.hoverHighlightDepth ?? 1)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && Number.isInteger(num) && num >= 0) {
            glow.hoverHighlightDepth = Math.max(0, Math.floor(num));
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
