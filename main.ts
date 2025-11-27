import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { GraphView, GREATER_GRAPH_VIEW_TYPE } from './GraphView2.ts';

export interface GlowSettings {
  minNodeRadius: number;
  maxNodeRadius: number;
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
  // whether to use Obsidian's interface font for labels (true) or a monospace/code font (false)
  useInterfaceFont?: boolean;
}

export interface GreaterGraphSettings {
  glow: GlowSettings;
  physics?: {
    repulsionStrength?: number;
    springStrength?: number;
    springLength?: number;
    centerPull?: number;
    damping?: number;
    // plane constraints & 3D center
    notePlaneStiffness?: number;
    tagPlaneStiffness?: number;
    centerX?: number;
    centerY?: number;
    centerZ?: number;
    // mouse attraction tuning
    mouseAttractionRadius?: number;
    mouseAttractionStrength?: number;
    mouseAttractionExponent?: number;
  };
  // whether to count duplicate links (multiple links between same files) when computing in/out degrees
  countDuplicateLinks?: boolean;
  // render mutual links as two parallel lines when enabled
  mutualLinkDoubleLine?: boolean;
  interaction?: {
    momentumScale?: number;
    dragThreshold?: number; // in screen pixels
  };
  // persistent node positions keyed by vault name, then by file path
  // settings.nodePositions[vaultId][filePath] = { x, y }
  nodePositions?: Record<string, Record<string, { x: number; y: number }>>;
  // visibility toggles
  showTags?: boolean;
}

export const DEFAULT_SETTINGS: GreaterGraphSettings = {
  glow: {
    minNodeRadius: 4,
    maxNodeRadius: 14,
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
          useInterfaceFont: true,
        edgeColor: undefined,
  },
  physics: {
    // calmer, Obsidian-like defaults
    repulsionStrength: 10,
    springStrength: 0.04,
    springLength: 130,
    centerPull: 0.0004,
    damping: 0.92,
    notePlaneStiffness: 0.02,
    tagPlaneStiffness: 0.02,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    mouseAttractionRadius: 80,
    mouseAttractionStrength: 0.15,
    mouseAttractionExponent: 3.5,
  },
  interaction: {
    momentumScale: 0.12,
    dragThreshold: 4,
  },
  nodePositions: {},
  mutualLinkDoubleLine: true,
  showTags: true,
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

    // helper to create a slider with reset button inside a Setting
    const addSliderSetting = (parent: HTMLElement, opts: { name: string; desc?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => Promise<void> | void; resetValue?: number | undefined; }) => {
      const s = new Setting(parent).setName(opts.name).setDesc(opts.desc || '');
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';

      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(opts.min);
      range.max = String(opts.max);
      range.step = String(opts.step ?? (opts.step === 0 ? 0 : (opts.step || 1)));
      range.value = String(opts.value);
      range.style.flex = '1';

      const label = document.createElement('div');
      label.textContent = String(opts.value);
      label.style.minWidth = '56px';
      label.style.textAlign = 'right';

      range.addEventListener('input', (e) => { label.textContent = (e.target as HTMLInputElement).value; });
      range.addEventListener('change', async (e) => { const v = Number((e.target as HTMLInputElement).value); await opts.onChange(v); });

      const rbtn = document.createElement('button');
      rbtn.type = 'button';
      rbtn.textContent = '↺';
      rbtn.title = 'Reset to default';
      rbtn.style.border = 'none';
      rbtn.style.background = 'transparent';
      rbtn.style.cursor = 'pointer';
      rbtn.addEventListener('click', async () => {
        try {
          if (typeof opts.resetValue === 'number') {
            range.value = String(opts.resetValue);
            label.textContent = range.value;
            await opts.onChange(Number(range.value));
          } else {
            // if resetValue undefined -> delete stored setting by calling onChange with NaN
            await opts.onChange(NaN as any);
          }
        } catch (e) {}
      });

      wrap.appendChild(range);
      wrap.appendChild(label);
      wrap.appendChild(rbtn);
      (s as any).controlEl.appendChild(wrap);
      return { range, label, reset: rbtn };
    };

    // Minimum node radius
    addSliderSetting(containerEl, {
      name: 'Minimum node radius',
      desc: 'Minimum radius for the smallest node (in pixels).',
      value: glow.minNodeRadius,
      min: 1,
      max: 40,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.minNodeRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.minNodeRadius = DEFAULT_SETTINGS.glow.minNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum node radius',
      desc: 'Maximum radius for the most connected node (in pixels).',
      value: glow.maxNodeRadius,
      min: 4,
      max: 120,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= glow.minNodeRadius) {
          glow.maxNodeRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.maxNodeRadius = DEFAULT_SETTINGS.glow.maxNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    new Setting(containerEl)
      .setName('')

    addSliderSetting(containerEl, {
      name: 'Minimum center glow opacity',
      desc: 'Opacity (0–1) at the glow center for the least connected node.',
      value: glow.minCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.minCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.minCenterAlpha = DEFAULT_SETTINGS.glow.minCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum center glow opacity',
      desc: 'Opacity (0–1) at the glow center for the most connected node.',
      value: glow.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.maxCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.maxCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.maxCenterAlpha = DEFAULT_SETTINGS.glow.maxCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Hover glow boost',
      desc: 'Multiplier applied to the center glow when a node is hovered.',
      value: glow.hoverBoostFactor,
      min: 1,
      max: 5,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.hoverBoostFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1.0) {
          glow.hoverBoostFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.hoverBoostFactor = DEFAULT_SETTINGS.glow.hoverBoostFactor;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Neighbor glow boost',
      desc: 'Multiplier applied to nodes within the highlight depth (excluding hovered node).',
      value: glow.neighborBoostFactor ?? 1.2,
      min: 1,
      max: 5,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.neighborBoostFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1.0) {
          glow.neighborBoostFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.neighborBoostFactor = DEFAULT_SETTINGS.glow.neighborBoostFactor;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Dim factor for distant nodes',
      desc: 'Multiplier (0–1) applied to nodes outside the highlight depth.',
      value: glow.dimFactor ?? 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.dimFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.dimFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.dimFactor = DEFAULT_SETTINGS.glow.dimFactor;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Highlight depth',
      desc: 'Graph distance (in hops) from the hovered node that will be highlighted.',
      value: glow.hoverHighlightDepth ?? 1,
      min: 0,
      max: 6,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.hoverHighlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
          glow.hoverHighlightDepth = Math.max(0, Math.floor(v));
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.hoverHighlightDepth = DEFAULT_SETTINGS.glow.hoverHighlightDepth;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Inner distance multiplier',
      desc: 'Distance (in node radii) where distance-based glow is fully active.',
      value: glow.distanceInnerRadiusMultiplier ?? 1.0,
      min: 0.1,
      max: 3,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceInnerRadiusMultiplier,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.distanceInnerRadiusMultiplier = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceInnerRadiusMultiplier = DEFAULT_SETTINGS.glow.distanceInnerRadiusMultiplier;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Outer distance multiplier',
      desc: 'Distance (in node radii) beyond which the mouse has no effect on glow.',
      value: glow.distanceOuterRadiusMultiplier ?? 2.5,
      min: 0.5,
      max: 6,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceOuterRadiusMultiplier,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > (glow.distanceInnerRadiusMultiplier ?? 0)) {
          glow.distanceOuterRadiusMultiplier = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceOuterRadiusMultiplier = DEFAULT_SETTINGS.glow.distanceOuterRadiusMultiplier;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Distance curve steepness',
      desc: 'Controls how quickly glow ramps up as the cursor approaches a node. Higher values = steeper S-curve.',
      value: glow.distanceCurveSteepness ?? 2.0,
      min: 0.1,
      max: 8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceCurveSteepness,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.distanceCurveSteepness = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceCurveSteepness = DEFAULT_SETTINGS.glow.distanceCurveSteepness;
          await this.plugin.saveSettings();
        }
      },
    });

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

    {
      const s = new Setting(containerEl)
        .setName('Node color (override)')
        .setDesc('Optional CSS color string to override the theme accent for node fill. Leave empty to use the active theme.');
      let txt: any = null;
      s.addText((t) => { txt = t; return t.setValue(String(glow.nodeColor ?? '')).onChange(async (value) => {
        const v = value.trim();
        glow.nodeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      }); });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      rb.addEventListener('click', async () => { glow.nodeColor = undefined; await this.plugin.saveSettings(); if (txt) (txt as any).setValue(''); });
      (s as any).controlEl.appendChild(rb);
    }

    {
      const s = new Setting(containerEl)
        .setName('Edge color (override)')
        .setDesc('Optional CSS color string to override edge stroke color. Leave empty to use a theme-appropriate color.');
      let txt: any = null;
      s.addText((t) => { txt = t; return t.setValue(String(glow.edgeColor ?? '')).onChange(async (value) => {
        const v = value.trim();
        glow.edgeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      }); });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      rb.addEventListener('click', async () => { glow.edgeColor = undefined; await this.plugin.saveSettings(); if (txt) (txt as any).setValue(''); });
      (s as any).controlEl.appendChild(rb);
    }

    {
      const s = new Setting(containerEl)
        .setName('Label color (override)')
        .setDesc('Optional CSS color string to override label text color. Leave empty to use the active theme text color.');
      let txt: any = null;
      s.addText((t) => { txt = t; return t.setValue(String(glow.labelColor ?? '')).onChange(async (value) => {
        const v = value.trim();
        glow.labelColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      }); });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      rb.addEventListener('click', async () => { glow.labelColor = undefined; await this.plugin.saveSettings(); if (txt) (txt as any).setValue(''); });
      (s as any).controlEl.appendChild(rb);
    }

    new Setting(containerEl)
      .setName('Use interface font for labels')
      .setDesc('When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.')
      .addToggle((t) => t.setValue(Boolean(glow.useInterfaceFont)).onChange(async (v) => {
        glow.useInterfaceFont = Boolean(v);
        await this.plugin.saveSettings();
      }));

    // Physics settings
    const phys = this.plugin.settings.physics || {};

    containerEl.createEl('h2', { text: 'Greater Graph – Physics' });

    addSliderSetting(containerEl, {
      name: 'Repulsion strength',
      desc: 'Controls node-node repulsion strength (higher = more separation).',
      value: phys.repulsionStrength ?? 4000,
      min: 0,
      max: 10000,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics!.repulsionStrength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = DEFAULT_SETTINGS.physics!.repulsionStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Spring strength',
      desc: 'Spring force constant for edges (higher = stiffer).',
      value: phys.springStrength ?? 0.08,
      min: 0,
      max: 0.2,
      step: 0.001,
      resetValue: DEFAULT_SETTINGS.physics!.springStrength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = DEFAULT_SETTINGS.physics!.springStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Spring length',
      desc: 'Preferred length (px) for edge springs.',
      value: phys.springLength ?? 80,
      min: 10,
      max: 500,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics!.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = DEFAULT_SETTINGS.physics!.springLength;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Center pull',
      desc: 'Force pulling nodes toward center (small value).',
      value: phys.centerPull ?? 0.02,
      min: 0,
      max: 0.01,
      step: 0.0001,
      resetValue: DEFAULT_SETTINGS.physics!.centerPull,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = DEFAULT_SETTINGS.physics!.centerPull;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Damping',
      desc: 'Velocity damping (0-1). Higher values reduce motion faster.',
      value: phys.damping ?? 0.85,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics!.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = DEFAULT_SETTINGS.physics!.damping;
          await this.plugin.saveSettings();
        }
      },
    });

    // Count duplicate links option
    new Setting(containerEl)
      .setName('Count duplicate links')
      .setDesc('If enabled, multiple links between the same two files will be counted when computing in/out degrees.')
      .addToggle((t) => t.setValue(Boolean(this.plugin.settings.countDuplicateLinks)).onChange(async (v) => {
        this.plugin.settings.countDuplicateLinks = Boolean(v);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Double-line mutual links')
      .setDesc('When enabled, mutual links (A ↔ B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.')
      .addToggle((t) => t.setValue(Boolean(this.plugin.settings.mutualLinkDoubleLine)).onChange(async (v) => {
        this.plugin.settings.mutualLinkDoubleLine = Boolean(v);
        await this.plugin.saveSettings();
      }));

    // Tag visibility toggle
    new Setting(containerEl)
      .setName('Show tag nodes')
      .setDesc('Toggle visibility of tag nodes and their edges in the graph.')
      .addToggle((t) => t.setValue(this.plugin.settings.showTags !== false).onChange(async (v) => {
        this.plugin.settings.showTags = Boolean(v);
        await this.plugin.saveSettings();
      }));
    
    // Mouse attractor settings
    addSliderSetting(containerEl, {
      name: 'Mouse attraction radius (px)',
      desc: 'Maximum distance (in pixels) from cursor where the attraction applies.',
      value: phys.mouseAttractionRadius ?? 80,
      min: 0,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics!.mouseAttractionRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = DEFAULT_SETTINGS.physics!.mouseAttractionRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Mouse attraction strength',
      desc: 'Base force scale applied toward the cursor when within radius (higher = stronger pull).',
      value: phys.mouseAttractionStrength ?? 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics!.mouseAttractionStrength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = DEFAULT_SETTINGS.physics!.mouseAttractionStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Mouse attraction exponent',
      desc: 'How sharply attraction ramps as the cursor approaches (typical values: 3–4).',
      value: phys.mouseAttractionExponent ?? 3.5,
      min: 0.1,
      max: 10,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.physics!.mouseAttractionExponent,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionExponent = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionExponent = DEFAULT_SETTINGS.physics!.mouseAttractionExponent;
          await this.plugin.saveSettings();
        }
      },
    });
    // Interaction settings (drag momentum / thresholds)
    containerEl.createEl('h2', { text: 'Interaction' });

    const interaction = this.plugin.settings.interaction || {};

    addSliderSetting(containerEl, {
      name: 'Drag momentum scale',
      desc: 'Multiplier applied to the sampled drag velocity when releasing a dragged node.',
      value: interaction.momentumScale ?? 0.12,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.interaction!.momentumScale,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.momentumScale = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.momentumScale = DEFAULT_SETTINGS.interaction!.momentumScale;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Drag threshold (px)',
      desc: 'Screen-space movement (pixels) required to count as a drag rather than a click.',
      value: interaction.dragThreshold ?? 4,
      min: 0,
      max: 40,
      step: 1,
      resetValue: DEFAULT_SETTINGS.interaction!.dragThreshold,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.dragThreshold = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.dragThreshold = DEFAULT_SETTINGS.interaction!.dragThreshold;
          await this.plugin.saveSettings();
        }
      },
    });
    // Plane constraint stiffness sliders
    addSliderSetting(containerEl, {
      name: 'Note plane stiffness (z)',
      desc: 'Pull strength keeping notes near z = 0 (soft constraint).',
      value: phys.notePlaneStiffness ?? DEFAULT_SETTINGS.physics!.notePlaneStiffness!,
      min: 0,
      max: 0.2,
      step: 0.001,
      resetValue: DEFAULT_SETTINGS.physics!.notePlaneStiffness,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.notePlaneStiffness = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.notePlaneStiffness = DEFAULT_SETTINGS.physics!.notePlaneStiffness;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Tag plane stiffness (x)',
      desc: 'Pull strength keeping tags near x = 0 (soft constraint).',
      value: phys.tagPlaneStiffness ?? DEFAULT_SETTINGS.physics!.tagPlaneStiffness!,
      min: 0,
      max: 0.2,
      step: 0.001,
      resetValue: DEFAULT_SETTINGS.physics!.tagPlaneStiffness,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.tagPlaneStiffness = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.tagPlaneStiffness = DEFAULT_SETTINGS.physics!.tagPlaneStiffness;
          await this.plugin.saveSettings();
        }
      },
    });
  }
}
