import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { GraphView, GREATER_GRAPH_VIEW_TYPE } from './GraphView2.ts';

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
  distanceInnerRadiusMultiplier?: number;
  distanceOuterRadiusMultiplier?: number;
  distanceCurveSteepness?: number;
  // focus/dimming controls
  focusSmoothingRate?: number;
  edgeDimMin?: number;
  edgeDimMax?: number;
  nodeMinBodyAlpha?: number;
  // optional color overrides (CSS color strings). If unset, theme vars are used.
  nodeColor?: string;
  labelColor?: string;
  edgeColor?: string;
}

export interface GreaterGraphSettings {
  glow: GlowSettings;
  physics?: {
    repulsionStrength?: number;
    springStrength?: number;
    springLength?: number;
    centerPull?: number;
    damping?: number;
    // mouse attraction tuning
    mouseAttractionRadius?: number;
    mouseAttractionStrength?: number;
    mouseAttractionExponent?: number;
  };
  interaction?: {
    momentumScale?: number;
    dragThreshold?: number; // in screen pixels
  };
  // persistent node positions keyed by vault name, then by file path
  // settings.nodePositions[vaultId][filePath] = { x, y }
  nodePositions?: Record<string, Record<string, { x: number; y: number }>>;
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
        distanceInnerRadiusMultiplier: 1.0,
        distanceOuterRadiusMultiplier: 2.5,
        distanceCurveSteepness: 2.0,
        // focus/dimming defaults
        focusSmoothingRate: 8,
        edgeDimMin: 0.08,
        edgeDimMax: 0.9,
        nodeMinBodyAlpha: 0.3,
        // color overrides left undefined by default to follow theme
        nodeColor: undefined,
        labelColor: undefined,
        edgeColor: undefined,
  },
  physics: {
    // calmer, Obsidian-like defaults
    repulsionStrength: 10,
    springStrength: 0.04,
    springLength: 130,
    centerPull: 0.0004,
    damping: 0.92,
    mouseAttractionRadius: 80,
    mouseAttractionStrength: 0.15,
    mouseAttractionExponent: 3.5,
  },
  interaction: {
    momentumScale: 0.12,
    dragThreshold: 4,
  },
  nodePositions: {},
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
    // Change this to open as a tab
    const leaves = this.app.workspace.getLeavesOfType(GREATER_GRAPH_VIEW_TYPE);
    if (leaves.length === 0) {
      // open in the main area as a new tab/leaf
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GREATER_GRAPH_VIEW_TYPE,
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

// SETTINGS TAB

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

    new Setting(containerEl)
      .setName('Inner distance multiplier')
      .setDesc('Distance (in node radii) where distance-based glow is fully active.')
      .addText((text) =>
        text.setValue(String(glow.distanceInnerRadiusMultiplier ?? 1.0)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > 0) {
            glow.distanceInnerRadiusMultiplier = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Outer distance multiplier')
      .setDesc('Distance (in node radii) beyond which the mouse has no effect on glow.')
      .addText((text) =>
        text.setValue(String(glow.distanceOuterRadiusMultiplier ?? 2.5)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > (glow.distanceInnerRadiusMultiplier ?? 0)) {
            glow.distanceOuterRadiusMultiplier = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Distance curve steepness')
      .setDesc('Controls how quickly glow ramps up as the cursor approaches a node. Higher values = steeper S-curve.')
      .addText((text) =>
        text.setValue(String(glow.distanceCurveSteepness ?? 2.0)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > 0) {
            glow.distanceCurveSteepness = num;
            await this.plugin.saveSettings();
          }
        })
      );

    // Focus / dimming controls
    new Setting(containerEl)
      .setName('Focus smoothing rate')
      .setDesc('How quickly nodes fade in/out when hover focus changes (higher = faster, per second).')
      .addText((text) =>
        text.setValue(String(glow.focusSmoothingRate ?? 8)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num > 0) {
            glow.focusSmoothingRate = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Edge dim minimum alpha')
      .setDesc('Minimum alpha used for dimmed edges (0-1).')
      .addText((text) =>
        text.setValue(String(glow.edgeDimMin ?? 0.08)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.edgeDimMin = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Edge dim maximum alpha')
      .setDesc('Maximum alpha used for focused edges (0-1).')
      .addText((text) =>
        text.setValue(String(glow.edgeDimMax ?? 0.9)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.edgeDimMax = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Node minimum body alpha')
      .setDesc('Minimum fill alpha for dimmed nodes (0-1).')
      .addText((text) =>
        text.setValue(String(glow.nodeMinBodyAlpha ?? 0.3)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            glow.nodeMinBodyAlpha = num;
            await this.plugin.saveSettings();
          }
        })
      );

    // Color overrides (optional)
    containerEl.createEl('h2', { text: 'Colors' });

    new Setting(containerEl)
      .setName('Node color (override)')
      .setDesc('Optional CSS color string to override the theme accent for node fill. Leave empty to use the active theme.')
      .addText((text) =>
        text.setValue(String(glow.nodeColor ?? '')).onChange(async (value) => {
          const v = value.trim();
          glow.nodeColor = v === '' ? undefined : v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Edge color (override)')
      .setDesc('Optional CSS color string to override edge stroke color. Leave empty to use a theme-appropriate color.')
      .addText((text) =>
        text.setValue(String(glow.edgeColor ?? '')).onChange(async (value) => {
          const v = value.trim();
          glow.edgeColor = v === '' ? undefined : v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Label color (override)')
      .setDesc('Optional CSS color string to override label text color. Leave empty to use the active theme text color.')
      .addText((text) =>
        text.setValue(String(glow.labelColor ?? '')).onChange(async (value) => {
          const v = value.trim();
          glow.labelColor = v === '' ? undefined : v;
          await this.plugin.saveSettings();
        })
      );

    // Physics settings
    const phys = this.plugin.settings.physics || {};

    containerEl.createEl('h2', { text: 'Greater Graph – Physics' });

    new Setting(containerEl)
      .setName('Repulsion strength')
      .setDesc('Controls node-node repulsion strength (higher = more separation).')
      .addText((text) =>
        text.setValue(String(phys.repulsionStrength ?? 4000)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.repulsionStrength = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Spring strength')
      .setDesc('Spring force constant for edges (higher = stiffer).')
      .addText((text) =>
        text.setValue(String(phys.springStrength ?? 0.08)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.springStrength = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Spring length')
      .setDesc('Preferred length (px) for edge springs.')
      .addText((text) =>
        text.setValue(String(phys.springLength ?? 80)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.springLength = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Center pull')
      .setDesc('Force pulling nodes toward center (small value).')
      .addText((text) =>
        text.setValue(String(phys.centerPull ?? 0.02)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.centerPull = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Damping')
      .setDesc('Velocity damping (0-1). Higher values reduce motion faster.')
      .addText((text) =>
        text.setValue(String(phys.damping ?? 0.85)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0 && num <= 1) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.damping = num;
            await this.plugin.saveSettings();
          }
        })
      );
    // Interaction settings (drag momentum / thresholds)
    containerEl.createEl('h2', { text: 'Interaction' });

    const interaction = this.plugin.settings.interaction || {};

    new Setting(containerEl)
      .setName('Drag momentum scale')
      .setDesc('Multiplier applied to the sampled drag velocity when releasing a dragged node.')
      .addText((text) =>
        text.setValue(String(interaction.momentumScale ?? 0.12)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.interaction = this.plugin.settings.interaction || {};
            this.plugin.settings.interaction.momentumScale = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Drag threshold (px)')
      .setDesc('Screen-space movement (pixels) required to count as a drag rather than a click.')
      .addText((text) =>
        text.setValue(String(interaction.dragThreshold ?? 4)).onChange(async (value) => {
          const num = Number(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.interaction = this.plugin.settings.interaction || {};
            this.plugin.settings.interaction.dragThreshold = num;
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
