import { App, Plugin, PluginSettingTab, Setting, TextComponent, ToggleComponent } from 'obsidian';
import { GraphView, GREATER_GRAPH_VIEW_TYPE } from './GraphView.ts';
import { Settings } from './types/interfaces.ts';



export const DEFAULT_SETTINGS: Settings = {
  visuals: {
    minNodeRadius       : 3,
    maxNodeRadius       : 20,
    minCenterAlpha      : 0.1,
    maxCenterAlpha      : 0.6,
    highlightDepth      : 1,
    focusSmoothing      : 0.8,
    nodeColor           : undefined, // color overrides left undefined by default to follow theme
    tagColor            : undefined,
    labelColor          : undefined,
    edgeColor           : undefined,
    nodeColorAlpha      : 0.1,
    tagColorAlpha       : 0.1,
    labelBaseFontSize   : 24,
    labelFadeRangePx    : 8,
    labelColorAlpha     : 1.0,
    labelRadius         : 30,
    useInterfaceFont    : true,
    edgeColorAlpha      : 0.1,
    countDuplicateLinks : true,
    drawDoubleLines     : true,
    showTags            : true,
    usePinnedCenterNote : false,
    pinnedCenterNotePath: '',
    useOutlinkFallback  : false,
    hoverScale          : 1.0,
  },
  physics: {
    repulsionStrength   : 5000,
    springStrength      : 1,
    springLength        : 100,
    centerPull          : 0.001,
    damping             : 0.7,
    notePlaneStiffness  : 0,
    tagPlaneStiffness   : 0,
    centerX             : 0,
    centerY             : 0,
    centerZ             : 0,
    mouseGravityEnabled : true,
    gravityRadius       : 6,
    gravityFallOff      : 3,
    mouseGravityRadius  : 15, // change these settings later
    mouseGravityStrength: 1,
    mouseGravityExponent: 2,
  },
  camera: {
    momentumScale       : 0.12,
    dragThreshold       : 4,
    rotateSensitivityX  : 0.005,
    rotateSensitivityY  : 0.005,
    cameraAnimDuration  : 300,
    // initial camera state below. Not UI Settings
    yaw                 : Math.PI / 6, 
    pitch               : Math.PI / 8,
    distance            : 1200,
    targetX             : 0,
    targetY             : 0,
    targetZ             : 0,
    zoom                : 1.0,
    offsetX             : 0,
    offsetY             : 0,
  },
  renderer: {
    canvas: document.createElement('canvas'),
  },

  nodePositions: {},
};

export default class GreaterGraphPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private settingsListeners: Array<() => void> = [];

  async onload() {
    await this.loadSettings();

    this.registerView(GREATER_GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));

    this.addCommand({
      id  : 'open-greater-graph',
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
    if (!this.settings.visuals) this.settings.visuals = DEFAULT_SETTINGS.visuals;
    // enforce min/max radius invariant
    try {
      const g = this.settings.visuals;
      if (typeof g.maxNodeRadius === 'number' && typeof g.minNodeRadius === 'number') {
        if (g.maxNodeRadius < g.minNodeRadius + 2) g.maxNodeRadius = g.minNodeRadius + 2;
      }
    } catch (e) {}
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

    const physics = this.plugin.settings.physics;

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

      const num = document.createElement('input');
      num.type = 'number';
      num.min = String(opts.min); num.max = String(opts.max); num.step = String(opts.step ?? (opts.step === 0 ? 0 : (opts.step || 1)));
      num.value = String(opts.value);
      num.style.minWidth = '56px';
      num.style.textAlign = 'right';
      num.style.width = '80px';

      range.addEventListener('input', (e) => { num.value = (e.target as HTMLInputElement).value; });
      range.addEventListener('change', async (e) => { const v = Number((e.target as HTMLInputElement).value); await opts.onChange(v); });
      num.addEventListener('input', (e) => { range.value = (e.target as HTMLInputElement).value; });
      num.addEventListener('change', async (e) => { const v = Number((e.target as HTMLInputElement).value); await opts.onChange(v); });

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
            num.value = range.value;
            await opts.onChange(Number(range.value));
          } else {
            // if resetValue undefined -> delete stored setting by calling onChange with NaN
            await opts.onChange(NaN as any);
          }
        } catch (e) {}
      });

      wrap.appendChild(range);
      wrap.appendChild(num);
      wrap.appendChild(rbtn);
      (s as any).controlEl.appendChild(wrap);
      return { range, num, reset: rbtn };
    };

    // Minimum node radius (UI in pixels)
    addSliderSetting(containerEl, {
      name: 'Minimum node radius',
      desc: 'Minimum radius for the smallest node (in pixels).',
      value: DEFAULT_SETTINGS.visuals.minNodeRadius ?? DEFAULT_SETTINGS.visuals.minNodeRadius,
      min: 1,
      max: 20,
      step: 1,
      resetValue: DEFAULT_SETTINGS.visuals.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          DEFAULT_SETTINGS.visuals.minNodeRadius = Math.round(v);
          // ensure max >= min + 2
          if (typeof DEFAULT_SETTINGS.visuals.maxNodeRadius === 'number' && DEFAULT_SETTINGS.visuals.maxNodeRadius < DEFAULT_SETTINGS.visuals.minNodeRadius + 2) {
            DEFAULT_SETTINGS.visuals.maxNodeRadius = DEFAULT_SETTINGS.visuals.minNodeRadius + 2;
          }
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.minNodeRadius = DEFAULT_SETTINGS.visuals.minNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum node radius',
      desc: 'Maximum radius for the most connected node (in pixels).',
      value: DEFAULT_SETTINGS.visuals.maxNodeRadius ?? DEFAULT_SETTINGS.visuals.maxNodeRadius,
      min: 8,
      max: 80,
      step: 1,
      resetValue: DEFAULT_SETTINGS.visuals.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.maxNodeRadius = Math.round(v);
          if (typeof DEFAULT_SETTINGS.visuals.minNodeRadius === 'number' && DEFAULT_SETTINGS.visuals.maxNodeRadius < DEFAULT_SETTINGS.visuals.minNodeRadius + 2) DEFAULT_SETTINGS.visuals.maxNodeRadius = DEFAULT_SETTINGS.visuals.minNodeRadius + 2;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.maxNodeRadius = DEFAULT_SETTINGS.visuals.maxNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Minimum center glow opacity',
      desc: 'Opacity (0–0.8) at the glow center for the least connected node.',
      value: DEFAULT_SETTINGS.visuals.minCenterAlpha ?? DEFAULT_SETTINGS.visuals.minCenterAlpha,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.visuals.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
          DEFAULT_SETTINGS.visuals.minCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.minCenterAlpha = DEFAULT_SETTINGS.visuals.minCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum center glow opacity',
      desc: 'Opacity (0–1) at the glow center for the most connected node.',
      value: DEFAULT_SETTINGS.visuals.maxCenterAlpha ?? DEFAULT_SETTINGS.visuals.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.visuals.maxCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          DEFAULT_SETTINGS.visuals.maxCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.maxCenterAlpha = DEFAULT_SETTINGS.visuals.maxCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    

    addSliderSetting(containerEl, {
      name: 'Highlight depth',
      desc: 'Graph distance (in hops) from the hovered node that will be highlighted.',
      value: DEFAULT_SETTINGS.visuals.highlightDepth,
      min: 0,
      max: 5,
      step: 1,
      resetValue: DEFAULT_SETTINGS.visuals.highlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
          DEFAULT_SETTINGS.visuals.highlightDepth = Math.max(0, Math.floor(v));
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.highlightDepth = DEFAULT_SETTINGS.visuals.highlightDepth;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity Radius',
      desc: 'Scales each node\'s screen-space radius for glow/mouse gravity.',
      value: physics.gravityRadius ?? DEFAULT_SETTINGS.physics.gravityRadius!,
      min: 1,
      max: 20,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.physics.gravityRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityRadius = DEFAULT_SETTINGS.physics.gravityRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity curve steepness',
      desc: 'Controls falloff steepness; higher = stronger near cursor.',
      value: physics.gravityFallOff ?? DEFAULT_SETTINGS.physics.gravityFallOff!,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.physics.gravityFallOff,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityFallOff = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityFallOff = DEFAULT_SETTINGS.physics.gravityFallOff;
          await this.plugin.saveSettings();
        }
      },
    });

        addSliderSetting(containerEl, {
      name: 'Label Radius',
      desc: 'Screen-space label reveal radius (× node size).',
      value: DEFAULT_SETTINGS.visuals.labelRadius ?? DEFAULT_SETTINGS.visuals.labelRadius!,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.visuals.labelRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          DEFAULT_SETTINGS.visuals.labelRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.labelRadius = DEFAULT_SETTINGS.visuals.labelRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    // Focus / dimming controls
    addSliderSetting(containerEl, {
      name: 'Focus smoothing rate',
      desc: 'Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.',
      value: DEFAULT_SETTINGS.visuals.focusSmoothing ?? DEFAULT_SETTINGS.visuals.focusSmoothing,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.visuals.focusSmoothing,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          DEFAULT_SETTINGS.visuals.focusSmoothing = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.focusSmoothing = DEFAULT_SETTINGS.visuals.focusSmoothing;
          await this.plugin.saveSettings();
        }
      },
    });

    // Edge dim / node body alpha controls removed per settings simplification.

    // Color overrides (optional)
    containerEl.createEl('h2', { text: 'Colors' });

    {
      const s = new Setting(containerEl)
        .setName('Node color (override)')
        .setDesc('Optional color to override the theme accent for node fill. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = DEFAULT_SETTINGS.visuals.nodeColor ? String(DEFAULT_SETTINGS.visuals.nodeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        DEFAULT_SETTINGS.visuals.nodeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const alphaInput = document.createElement('input');
      alphaInput.type = 'number'; alphaInput.min = '0.1'; alphaInput.max = '1'; alphaInput.step = '0.01';
      alphaInput.value = String(DEFAULT_SETTINGS.visuals.nodeColorAlpha ?? DEFAULT_SETTINGS.visuals.nodeColorAlpha);
      alphaInput.style.width = '68px'; alphaInput.style.marginLeft = '8px';
      alphaInput.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        DEFAULT_SETTINGS.visuals.nodeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.visuals.nodeColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { DEFAULT_SETTINGS.visuals.nodeColor = undefined; DEFAULT_SETTINGS.visuals.nodeColorAlpha = DEFAULT_SETTINGS.visuals.nodeColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; alphaInput.value = String(DEFAULT_SETTINGS.visuals.nodeColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(colorInput);
      (s as any).controlEl.appendChild(alphaInput);
    }

    {
      const s = new Setting(containerEl)
        .setName('Edge color (override)')
        .setDesc('Optional color to override edge stroke color. Leave unset to use a theme-appropriate color.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = DEFAULT_SETTINGS.visuals.edgeColor ? String(DEFAULT_SETTINGS.visuals.edgeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        DEFAULT_SETTINGS.visuals.edgeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const edgeAlpha = document.createElement('input');
      edgeAlpha.type = 'number'; edgeAlpha.min = '0.1'; edgeAlpha.max = '1'; edgeAlpha.step = '0.01';
      edgeAlpha.value = String(DEFAULT_SETTINGS.visuals.edgeColorAlpha ?? DEFAULT_SETTINGS.visuals.edgeColorAlpha);
      edgeAlpha.style.width = '68px'; edgeAlpha.style.marginLeft = '8px';
      edgeAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        DEFAULT_SETTINGS.visuals.edgeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.visuals.edgeColorAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { DEFAULT_SETTINGS.visuals.edgeColor = undefined; DEFAULT_SETTINGS.visuals.edgeColorAlpha = DEFAULT_SETTINGS.visuals.edgeColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; edgeAlpha.value = String(DEFAULT_SETTINGS.visuals.edgeColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(edgeAlpha);
    }

    // Tag color (override)
    {
      const s = new Setting(containerEl)
        .setName('Tag color (override)')
        .setDesc('Optional color to override tag node color. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = DEFAULT_SETTINGS.visuals.tagColor ? String(DEFAULT_SETTINGS.visuals.tagColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        DEFAULT_SETTINGS.visuals.tagColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const tagAlpha = document.createElement('input'); tagAlpha.type = 'number'; tagAlpha.min = '0.1'; tagAlpha.max = '1'; tagAlpha.step = '0.01';
      tagAlpha.value = String(DEFAULT_SETTINGS.visuals.tagColorAlpha ?? DEFAULT_SETTINGS.visuals.tagColorAlpha);
      tagAlpha.style.width = '68px'; tagAlpha.style.marginLeft = '8px';
      tagAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        DEFAULT_SETTINGS.visuals.tagColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.visuals.tagColorAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { DEFAULT_SETTINGS.visuals.tagColor = undefined; DEFAULT_SETTINGS.visuals.tagColorAlpha = DEFAULT_SETTINGS.visuals.tagColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; tagAlpha.value = String(DEFAULT_SETTINGS.visuals.tagColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(tagAlpha);
    }

    {
      const s = new Setting(containerEl)
        .setName('Label color (override)')
        .setDesc('Optional color to override the label text color. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = DEFAULT_SETTINGS.visuals.labelColor ? String(DEFAULT_SETTINGS.visuals.labelColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        DEFAULT_SETTINGS.visuals.labelColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const labelAlpha = document.createElement('input');
      labelAlpha.type = 'number'; labelAlpha.min = '0'; labelAlpha.max = '1'; labelAlpha.step = '0.01';
      labelAlpha.value = String(DEFAULT_SETTINGS.visuals.labelColorAlpha ?? DEFAULT_SETTINGS.visuals.labelColorAlpha);
      labelAlpha.style.width = '68px'; labelAlpha.style.marginLeft = '8px';
      labelAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        DEFAULT_SETTINGS.visuals.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.visuals.labelColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { DEFAULT_SETTINGS.visuals.labelColor = undefined; DEFAULT_SETTINGS.visuals.labelColorAlpha = DEFAULT_SETTINGS.visuals.labelColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; labelAlpha.value = String(DEFAULT_SETTINGS.visuals.labelColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(labelAlpha);
    }

    new Setting(containerEl)
      .setName('Use interface font for labels')
      .setDesc('When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.')
      .addToggle((t: ToggleComponent ) => t.setValue(Boolean(DEFAULT_SETTINGS.visuals.useInterfaceFont)).onChange(async (v: boolean) => {
        DEFAULT_SETTINGS.visuals.useInterfaceFont = Boolean(v);
        await this.plugin.saveSettings();
      }));

    addSliderSetting(containerEl, {
      name: 'Base label font size',
      desc: 'Base font size for labels in pixels (before camera zoom scaling).',
      value: DEFAULT_SETTINGS.visuals.labelBaseFontSize ?? DEFAULT_SETTINGS.visuals.labelBaseFontSize,
      min: 6,
      max: 24,
      step: 1,
      resetValue: DEFAULT_SETTINGS.visuals.labelBaseFontSize,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 72) {
          DEFAULT_SETTINGS.visuals.labelBaseFontSize = Math.round(v);
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          DEFAULT_SETTINGS.visuals.labelBaseFontSize = DEFAULT_SETTINGS.visuals.labelBaseFontSize;
          await this.plugin.saveSettings();
        }
      },
    });

    // Physics settings
    const phys = this.plugin.settings.physics || {};

    containerEl.createEl('h2', { text: 'Greater Graph – Physics' });

    // Repulsion: UI 0..1 maps to internal repulsion = ui^2 * 2000
    const repulsionUi = (() => {
      const internal = (phys.repulsionStrength ?? DEFAULT_SETTINGS.physics!.repulsionStrength);
      const ui = Math.sqrt(Math.max(0, internal / 2000));
      return Math.min(1, Math.max(0, ui));
    })();
    addSliderSetting(containerEl, {
      name: 'Repulsion strength',
      desc: 'UI 0–1 (mapped internally). Higher = more node separation.',
      value: repulsionUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: repulsionUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = (v * v) * 2000;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = DEFAULT_SETTINGS.physics!.repulsionStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    // Spring strength: UI 0..1 -> internal = ui * 0.5
    const springUi = Math.min(1, Math.max(0, (phys.springStrength ?? DEFAULT_SETTINGS.physics!.springStrength) / 0.5));
    addSliderSetting(containerEl, {
      name: 'Spring strength',
      desc: 'UI 0–1 mapped to internal spring constant (higher = stiffer).',
      value: springUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: springUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = v * 0.5;
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
      value: phys.springLength ?? DEFAULT_SETTINGS.physics!.springLength,
      min: 20,
      max: 400,
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

    // Center pull UI 0..1 -> internal = ui * 0.01
    const centerUi = Math.min(1, Math.max(0, (phys.centerPull ?? DEFAULT_SETTINGS.physics!.centerPull) / 0.01));
    addSliderSetting(containerEl, {
      name: 'Center pull',
      desc: 'UI 0–1 mapped to a small centering force (internal scale).',
      value: centerUi,
      min: 0,
      max: 1,
      step: 0.001,
      resetValue: 0.1,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = v * 0.01;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = DEFAULT_SETTINGS.physics!.centerPull;
          await this.plugin.saveSettings();
        }
      },
    });

    // Damping: use UI 0.7–1.0 (use directly as internal damping)
    addSliderSetting(containerEl, {
      name: 'Damping',
      desc: 'Velocity damping (0.7–1.0). Higher values reduce motion faster.',
      value: phys.damping ?? DEFAULT_SETTINGS.physics!.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics!.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
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
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(this.plugin.settings.visuals.countDuplicateLinks)).onChange(async (v: boolean) => {
        this.plugin.settings.visuals.countDuplicateLinks = Boolean(v);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Double-line mutual links')
      .setDesc('When enabled, mutual links (A ↔ B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.')
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(this.plugin.settings.visuals.drawDoubleLines)).onChange(async (v: boolean) => {
        this.plugin.settings.visuals.drawDoubleLines = Boolean(v);
        await this.plugin.saveSettings();
      }));

    // Tag visibility toggle
    new Setting(containerEl)
      .setName('Show tag nodes')
      .setDesc('Toggle visibility of tag nodes and their edges in the graph.')
      .addToggle((t: ToggleComponent) => t.setValue(this.plugin.settings.visuals.showTags !== false).onChange(async (v: boolean) => {
        this.plugin.settings.visuals.showTags = Boolean(v);
        await this.plugin.saveSettings();
      }));
    
    // (Mouse attraction controls below — single copy retained later in the settings)

    // Plane stiffness controls (UI 0..1 -> internal = ui * 0.02)
      const notePlaneUi = Math.min(1, Math.max(0, (phys.notePlaneStiffness ?? DEFAULT_SETTINGS.physics!.notePlaneStiffness) / 0.02));
      addSliderSetting(containerEl, {
        name: 'Note plane stiffness (z)',
        desc: 'How strongly notes are pulled toward the z=0 plane (UI 0–1).',
        value: notePlaneUi,
        min: 0,
        max: 1,
        step: 0.01,
        resetValue: 0.2,
        onChange: async (v) => {
          if (!Number.isNaN(v) && v >= 0 && v <= 1) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.notePlaneStiffness = v * 0.02;
            await this.plugin.saveSettings();
          } else if (Number.isNaN(v)) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.notePlaneStiffness = DEFAULT_SETTINGS.physics!.notePlaneStiffness;
            await this.plugin.saveSettings();
          }
        },
      });

      const tagPlaneUi = Math.min(1, Math.max(0, (phys.tagPlaneStiffness ?? DEFAULT_SETTINGS.physics!.tagPlaneStiffness) / 0.02));
      addSliderSetting(containerEl, {
        name: 'Tag plane stiffness (x)',
        desc: 'How strongly tag nodes are pulled toward the x=0 plane (UI 0–1).',
        value: tagPlaneUi,
        min: 0,
        max: 1,
        step: 0.01,
        resetValue: 0.4,
        onChange: async (v) => {
          if (!Number.isNaN(v) && v >= 0 && v <= 1) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.tagPlaneStiffness = v * 0.02;
            await this.plugin.saveSettings();
          } else if (Number.isNaN(v)) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.tagPlaneStiffness = DEFAULT_SETTINGS.physics!.tagPlaneStiffness;
            await this.plugin.saveSettings();
          }
        },
      });

      // Mouse gravity toggle (replaces old radius control)
      new Setting(containerEl)
        .setName('Mouse gravity')
        .setDesc('Enable the mouse gravity well that attracts nearby nodes.')
        .addToggle((t: any) => t
          .setValue(Boolean((phys as any).mouseGravityEnabled !== false))
          .onChange(async (v: any) => {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.mouseGravityEnabled = Boolean(v);
            await this.plugin.saveSettings();
          }));

      

    // Center Node settings
    containerEl.createEl('h2', { text: 'Center Node' });
    new Setting(containerEl)
      .setName('Use pinned center note')
      .setDesc('Prefer a specific note path as the graph center. Falls back to max in-links if not found.')
      .addToggle((t: ToggleComponent) => t
        .setValue(Boolean(this.plugin.settings.usePinnedCenterNote))
        .onChange(async (v: boolean) => {
          this.plugin.settings.usePinnedCenterNote = Boolean(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pinned center note path')
      .setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).')
      .addText((txt: TextComponent) => txt
        .setPlaceholder('path/to/note')
        .setValue(this.plugin.settings.pinnedCenterNotePath || '')
        .onChange(async (v: string) => {
          this.plugin.settings.pinnedCenterNotePath = (v || '').trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Fallback: prefer out-links')
      .setDesc('When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)')
      .addToggle((t: ToggleComponent) => t
        .setValue(Boolean(this.plugin.settings.useOutlinkFallback))
        .onChange(async (v: boolean) => {
          this.plugin.settings.useOutlinkFallback = Boolean(v);
          await this.plugin.saveSettings();
        }));
  }
}
