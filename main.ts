import { App, Plugin, PluginSettingTab, Setting, TextComponent, ToggleComponent } from 'obsidian';
import { GraphView, GREATER_GRAPH_VIEW_TYPE } from './GraphView.ts';
import { Settings } from './types/interfaces.ts';



export const SETTINGS: Settings = {
  graph: {
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
    hoverScale          : 1.0,
    useCenterNote       : false,
    centerNoteTitle     : '',
    useOutlinkFallback  : false,
  },
  physics: {
    repulsionStrength   : 5000,
    springStrength      : 1,
    springLength        : 100,
    centerPull          : 0.001,
    damping             : 0.7,
    notePlaneStiffness  : 0,
    tagPlaneStiffness   : 0,
    mouseGravityEnabled : true,
    gravityRadius       : 6,
    gravityFallOff      : 3,
    mouseGravityRadius  : 15, // change these settings later
    mouseGravityStrength: 1,
    mouseGravityExponent: 2,
    worldCenterX        : 0,
    worldCenterY        : 0,
    worldCenterZ        : 0,
  },
  camera: {
    momentumScale       : 0.12,
    dragThreshold       : 4,
    rotateSensitivityX  : 0.005,
    rotateSensitivityY  : 0.005,
    cameraAnimDuration  : 300,
    state: {
      yaw                 : Math.PI / 6, 
      pitch               : Math.PI / 8,
      distance            : 1200,
      targetX             : 0,
      targetY             : 0,
      targetZ             : 0,
      offsetX             : 0,
      offsetY             : 0,
    }
  },
  nodePositions: {},
};

export default class GreaterGraphPlugin extends Plugin {
  settings: Settings = SETTINGS;
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
    this.settings = Object.assign({}, SETTINGS, data || {});
    if (!this.settings.graph) this.settings.graph = SETTINGS.graph;
    // enforce min/max radius invariant
    try {
      const g = this.settings.graph;
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
      value: SETTINGS.graph.minNodeRadius ?? SETTINGS.graph.minNodeRadius,
      min: 1,
      max: 20,
      step: 1,
      resetValue: SETTINGS.graph.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          SETTINGS.graph.minNodeRadius = Math.round(v);
          // ensure max >= min + 2
          if (typeof SETTINGS.graph.maxNodeRadius === 'number' && SETTINGS.graph.maxNodeRadius < SETTINGS.graph.minNodeRadius + 2) {
            SETTINGS.graph.maxNodeRadius = SETTINGS.graph.minNodeRadius + 2;
          }
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.minNodeRadius = SETTINGS.graph.minNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum node radius',
      desc: 'Maximum radius for the most connected node (in pixels).',
      value: SETTINGS.graph.maxNodeRadius ?? SETTINGS.graph.maxNodeRadius,
      min: 8,
      max: 80,
      step: 1,
      resetValue: SETTINGS.graph.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v)) {
          SETTINGS.graph.maxNodeRadius = Math.round(v);
          if (typeof SETTINGS.graph.minNodeRadius === 'number' && SETTINGS.graph.maxNodeRadius < SETTINGS.graph.minNodeRadius + 2) SETTINGS.graph.maxNodeRadius = SETTINGS.graph.minNodeRadius + 2;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.maxNodeRadius = SETTINGS.graph.maxNodeRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Minimum center glow opacity',
      desc: 'Opacity (0–0.8) at the glow center for the least connected node.',
      value: SETTINGS.graph.minCenterAlpha ?? SETTINGS.graph.minCenterAlpha,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: SETTINGS.graph.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
          SETTINGS.graph.minCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.minCenterAlpha = SETTINGS.graph.minCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Maximum center glow opacity',
      desc: 'Opacity (0–1) at the glow center for the most connected node.',
      value: SETTINGS.graph.maxCenterAlpha ?? SETTINGS.graph.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.graph.maxCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          SETTINGS.graph.maxCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.maxCenterAlpha = SETTINGS.graph.maxCenterAlpha;
          await this.plugin.saveSettings();
        }
      },
    });

    

    addSliderSetting(containerEl, {
      name: 'Highlight depth',
      desc: 'Graph distance (in hops) from the hovered node that will be highlighted.',
      value: SETTINGS.graph.highlightDepth,
      min: 0,
      max: 5,
      step: 1,
      resetValue: SETTINGS.graph.highlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
          SETTINGS.graph.highlightDepth = Math.max(0, Math.floor(v));
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.highlightDepth = SETTINGS.graph.highlightDepth;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity Radius',
      desc: 'Scales each node\'s screen-space radius for glow/mouse gravity.',
      value: physics.gravityRadius ?? SETTINGS.physics.gravityRadius!,
      min: 1,
      max: 20,
      step: 0.1,
      resetValue: SETTINGS.physics.gravityRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityRadius = SETTINGS.physics.gravityRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity curve steepness',
      desc: 'Controls falloff steepness; higher = stronger near cursor.',
      value: physics.gravityFallOff ?? SETTINGS.physics.gravityFallOff!,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: SETTINGS.physics.gravityFallOff,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityFallOff = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityFallOff = SETTINGS.physics.gravityFallOff;
          await this.plugin.saveSettings();
        }
      },
    });

        addSliderSetting(containerEl, {
      name: 'Label Radius',
      desc: 'Screen-space label reveal radius (× node size).',
      value: SETTINGS.graph.labelRadius ?? SETTINGS.graph.labelRadius!,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: SETTINGS.graph.labelRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          SETTINGS.graph.labelRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.labelRadius = SETTINGS.graph.labelRadius;
          await this.plugin.saveSettings();
        }
      },
    });

    // Focus / dimming controls
    addSliderSetting(containerEl, {
      name: 'Focus smoothing rate',
      desc: 'Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.',
      value: SETTINGS.graph.focusSmoothing ?? SETTINGS.graph.focusSmoothing,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.graph.focusSmoothing,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          SETTINGS.graph.focusSmoothing = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.focusSmoothing = SETTINGS.graph.focusSmoothing;
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
      try { colorInput.value = SETTINGS.graph.nodeColor ? String(SETTINGS.graph.nodeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        SETTINGS.graph.nodeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const alphaInput = document.createElement('input');
      alphaInput.type = 'number'; alphaInput.min = '0.1'; alphaInput.max = '1'; alphaInput.step = '0.01';
      alphaInput.value = String(SETTINGS.graph.nodeColorAlpha ?? SETTINGS.graph.nodeColorAlpha);
      alphaInput.style.width = '68px'; alphaInput.style.marginLeft = '8px';
      alphaInput.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        SETTINGS.graph.nodeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.nodeColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { SETTINGS.graph.nodeColor = undefined; SETTINGS.graph.nodeColorAlpha = SETTINGS.graph.nodeColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; alphaInput.value = String(SETTINGS.graph.nodeColorAlpha); });
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
      try { colorInput.value = SETTINGS.graph.edgeColor ? String(SETTINGS.graph.edgeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        SETTINGS.graph.edgeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const edgeAlpha = document.createElement('input');
      edgeAlpha.type = 'number'; edgeAlpha.min = '0.1'; edgeAlpha.max = '1'; edgeAlpha.step = '0.01';
      edgeAlpha.value = String(SETTINGS.graph.edgeColorAlpha ?? SETTINGS.graph.edgeColorAlpha);
      edgeAlpha.style.width = '68px'; edgeAlpha.style.marginLeft = '8px';
      edgeAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        SETTINGS.graph.edgeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.edgeColorAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { SETTINGS.graph.edgeColor = undefined; SETTINGS.graph.edgeColorAlpha = SETTINGS.graph.edgeColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; edgeAlpha.value = String(SETTINGS.graph.edgeColorAlpha); });
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
      try { colorInput.value = SETTINGS.graph.tagColor ? String(SETTINGS.graph.tagColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        SETTINGS.graph.tagColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const tagAlpha = document.createElement('input'); tagAlpha.type = 'number'; tagAlpha.min = '0.1'; tagAlpha.max = '1'; tagAlpha.step = '0.01';
      tagAlpha.value = String(SETTINGS.graph.tagColorAlpha ?? SETTINGS.graph.tagColorAlpha);
      tagAlpha.style.width = '68px'; tagAlpha.style.marginLeft = '8px';
      tagAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        SETTINGS.graph.tagColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.tagColorAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { SETTINGS.graph.tagColor = undefined; SETTINGS.graph.tagColorAlpha = SETTINGS.graph.tagColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; tagAlpha.value = String(SETTINGS.graph.tagColorAlpha); });
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
      try { colorInput.value = SETTINGS.graph.labelColor ? String(SETTINGS.graph.labelColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        SETTINGS.graph.labelColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const labelAlpha = document.createElement('input');
      labelAlpha.type = 'number'; labelAlpha.min = '0'; labelAlpha.max = '1'; labelAlpha.step = '0.01';
      labelAlpha.value = String(SETTINGS.graph.labelColorAlpha ?? SETTINGS.graph.labelColorAlpha);
      labelAlpha.style.width = '68px'; labelAlpha.style.marginLeft = '8px';
      labelAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        SETTINGS.graph.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : SETTINGS.graph.labelColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { SETTINGS.graph.labelColor = undefined; SETTINGS.graph.labelColorAlpha = SETTINGS.graph.labelColorAlpha; await this.plugin.saveSettings(); colorInput.value = '#000000'; labelAlpha.value = String(SETTINGS.graph.labelColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(labelAlpha);
    }

    new Setting(containerEl)
      .setName('Use interface font for labels')
      .setDesc('When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.')
      .addToggle((t: ToggleComponent ) => t.setValue(Boolean(SETTINGS.graph.useInterfaceFont)).onChange(async (v: boolean) => {
        SETTINGS.graph.useInterfaceFont = Boolean(v);
        await this.plugin.saveSettings();
      }));

    addSliderSetting(containerEl, {
      name: 'Base label font size',
      desc: 'Base font size for labels in pixels (before camera zoom scaling).',
      value: SETTINGS.graph.labelBaseFontSize ?? SETTINGS.graph.labelBaseFontSize,
      min: 6,
      max: 24,
      step: 1,
      resetValue: SETTINGS.graph.labelBaseFontSize,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 72) {
          SETTINGS.graph.labelBaseFontSize = Math.round(v);
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.labelBaseFontSize = SETTINGS.graph.labelBaseFontSize;
          await this.plugin.saveSettings();
        }
      },
    });

    // Physics settings
    const phys = this.plugin.settings.physics || {};

    containerEl.createEl('h2', { text: 'Greater Graph – Physics' });

    // Repulsion: UI 0..1 maps to internal repulsion = ui^2 * 2000
    const repulsionUi = (() => {
      const internal = (phys.repulsionStrength ?? SETTINGS.physics!.repulsionStrength);
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
          this.plugin.settings.physics.repulsionStrength = SETTINGS.physics!.repulsionStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    // Spring strength: UI 0..1 -> internal = ui * 0.5
    const springUi = Math.min(1, Math.max(0, (phys.springStrength ?? SETTINGS.physics!.springStrength) / 0.5));
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
          this.plugin.settings.physics.springStrength = SETTINGS.physics!.springStrength;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Spring length',
      desc: 'Preferred length (px) for edge springs.',
      value: phys.springLength ?? SETTINGS.physics!.springLength,
      min: 20,
      max: 400,
      step: 1,
      resetValue: SETTINGS.physics!.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = SETTINGS.physics!.springLength;
          await this.plugin.saveSettings();
        }
      },
    });

    // Center pull UI 0..1 -> internal = ui * 0.01
    const centerUi = Math.min(1, Math.max(0, (phys.centerPull ?? SETTINGS.physics!.centerPull) / 0.01));
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
          this.plugin.settings.physics.centerPull = SETTINGS.physics!.centerPull;
          await this.plugin.saveSettings();
        }
      },
    });

    // Damping: use UI 0.7–1.0 (use directly as internal damping)
    addSliderSetting(containerEl, {
      name: 'Damping',
      desc: 'Velocity damping (0.7–1.0). Higher values reduce motion faster.',
      value: phys.damping ?? SETTINGS.physics!.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.physics!.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = SETTINGS.physics!.damping;
          await this.plugin.saveSettings();
        }
      },
    });

    // Count duplicate links option
    new Setting(containerEl)
      .setName('Count duplicate links')
      .setDesc('If enabled, multiple links between the same two files will be counted when computing in/out degrees.')
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(this.plugin.settings.graph.countDuplicateLinks)).onChange(async (v: boolean) => {
        this.plugin.settings.graph.countDuplicateLinks = Boolean(v);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Double-line mutual links')
      .setDesc('When enabled, mutual links (A ↔ B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.')
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(this.plugin.settings.graph.drawDoubleLines)).onChange(async (v: boolean) => {
        this.plugin.settings.graph.drawDoubleLines = Boolean(v);
        await this.plugin.saveSettings();
      }));

    // Tag visibility toggle
    new Setting(containerEl)
      .setName('Show tag nodes')
      .setDesc('Toggle visibility of tag nodes and their edges in the graph.')
      .addToggle((t: ToggleComponent) => t.setValue(this.plugin.settings.graph.showTags !== false).onChange(async (v: boolean) => {
        this.plugin.settings.graph.showTags = Boolean(v);
        await this.plugin.saveSettings();
      }));
    
    // (Mouse attraction controls below — single copy retained later in the settings)

    // Plane stiffness controls (UI 0..1 -> internal = ui * 0.02)
      const notePlaneUi = Math.min(1, Math.max(0, (phys.notePlaneStiffness ?? SETTINGS.physics!.notePlaneStiffness) / 0.02));
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
            this.plugin.settings.physics.notePlaneStiffness = SETTINGS.physics!.notePlaneStiffness;
            await this.plugin.saveSettings();
          }
        },
      });

      const tagPlaneUi = Math.min(1, Math.max(0, (phys.tagPlaneStiffness ?? SETTINGS.physics!.tagPlaneStiffness) / 0.02));
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
            this.plugin.settings.physics.tagPlaneStiffness = SETTINGS.physics!.tagPlaneStiffness;
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
        .setValue(Boolean(this.plugin.settings.graph.useCenterNote))
        .onChange(async (v: boolean) => {
          this.plugin.settings.graph.useCenterNote = Boolean(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pinned center note path')
      .setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).')
      .addText((txt: TextComponent) => txt
        .setPlaceholder('path/to/note')
        .setValue(this.plugin.settings.graph.centerNoteTitle || '')
        .onChange(async (v: string) => {
          this.plugin.settings.graph.centerNoteTitle = (v || '').trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Fallback: prefer out-links')
      .setDesc('When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)')
      .addToggle((t: ToggleComponent) => t
        .setValue(Boolean(this.plugin.settings.graph.useOutlinkFallback))
        .onChange(async (v: boolean) => {
          this.plugin.settings.graph.useOutlinkFallback = Boolean(v);
          await this.plugin.saveSettings();
        }));
  }
}
