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
  tagColor?: string;
  labelColor?: string;
  edgeColor?: string;
  // base font size for labels (world-space units mapped to screen px via camera zoom)
  labelBaseFontSize?: number;
  // label visibility/fade (screen-space px)
  labelMinVisibleRadiusPx?: number;
  labelFadeRangePx?: number;
  // explicit glow radius in pixels (null/undefined to use multiplier-based glow)
  glowRadiusPx?: number | null;
  // per-color alpha multipliers (0..1)
  nodeColorAlpha?: number;
  // maximum alpha to use when the node/tag/edge is hovered (0..1)
  nodeColorMaxAlpha?: number;
  tagColorAlpha?: number;
  tagColorMaxAlpha?: number;
  labelColorAlpha?: number;
  edgeColorAlpha?: number;
  edgeColorMaxAlpha?: number;
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
  // Center node selection
  usePinnedCenterNote?: boolean;
  pinnedCenterNotePath?: string;
  // When choosing a center by degree, prefer out-degree (out-links) instead of in-degree
  useOutlinkFallback?: boolean;
}

export const DEFAULT_SETTINGS: GreaterGraphSettings = {
  glow: {
    minNodeRadius: 3,
    maxNodeRadius: 20,
    minCenterAlpha: 0.1,
    maxCenterAlpha: 0.6,
    hoverBoostFactor: 10,
    // neighborBoostFactor is intentionally left undefined; renderer should link it to hoverBoostFactor
    neighborBoostFactor: undefined,
    // dimFactor removed from UI but kept available for fallback
    dimFactor: undefined,
    hoverHighlightDepth: 1,
    distanceInnerRadiusMultiplier: 1,
    distanceOuterRadiusMultiplier: 30,
    distanceCurveSteepness: 1.0,
    // focus/dimming defaults
    focusSmoothingRate: 0.8,
    edgeDimMin: undefined,
    edgeDimMax: undefined,
    nodeMinBodyAlpha: undefined,
        // color overrides left undefined by default to follow theme
        nodeColor: undefined,
        nodeColorAlpha: 0.1,
        nodeColorMaxAlpha: 1.0,
        tagColor: undefined,
        tagColorAlpha: 0.1,
        tagColorMaxAlpha: 1.0,
        labelColor: undefined,
        labelBaseFontSize: 24,
        labelMinVisibleRadiusPx: 6,
        labelFadeRangePx: 8,
        glowRadiusPx: null,
        labelColorAlpha: 1.0,
        useInterfaceFont: true,
        edgeColor: undefined,
        edgeColorAlpha: 0.1,
        edgeColorMaxAlpha: 0.6,
  },
  physics: {
    // Physics defaults (use direct/internal scale values)
    repulsionStrength: 5000,
    springStrength: 1,
    springLength: 100,
    // Center pull internal
    centerPull: 0.001,
    // Damping internal (0..1)
    damping: 0.7,
    // plane stiffness defaults
    notePlaneStiffness: 0,
    tagPlaneStiffness: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    // mouse attractor (renamed in UI to 'mouse gravity well')
    mouseAttractionRadius: 30,
    mouseAttractionStrength: 1,
    mouseAttractionExponent: 1,
  },
  countDuplicateLinks: true,
  interaction: {
    momentumScale: 0.12,
    dragThreshold: 4,
  },
  nodePositions: {},
  mutualLinkDoubleLine: true,
  showTags: true,
  usePinnedCenterNote: false,
  pinnedCenterNotePath: '',
  useOutlinkFallback: false,
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
    // enforce min/max radius invariant
    try {
      const g = this.settings.glow;
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
      value: glow.minNodeRadius ?? DEFAULT_SETTINGS.glow.minNodeRadius,
      min: 1,
      max: 20,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.minNodeRadius = Math.round(v);
          // ensure max >= min + 2
          if (typeof glow.maxNodeRadius === 'number' && glow.maxNodeRadius < glow.minNodeRadius + 2) {
            glow.maxNodeRadius = glow.minNodeRadius + 2;
          }
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
      value: glow.maxNodeRadius ?? DEFAULT_SETTINGS.glow.maxNodeRadius,
      min: 8,
      max: 80,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v)) {
          glow.maxNodeRadius = Math.round(v);
          if (typeof glow.minNodeRadius === 'number' && glow.maxNodeRadius < glow.minNodeRadius + 2) glow.maxNodeRadius = glow.minNodeRadius + 2;
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
      desc: 'Opacity (0–0.8) at the glow center for the least connected node.',
      value: glow.minCenterAlpha ?? DEFAULT_SETTINGS.glow.minCenterAlpha,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
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
      value: glow.maxCenterAlpha ?? DEFAULT_SETTINGS.glow.maxCenterAlpha,
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
      value: glow.hoverBoostFactor ?? DEFAULT_SETTINGS.glow.hoverBoostFactor,
      min: 1,
      max: 100,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.glow.hoverBoostFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1.0 && v <= 100) {
          glow.hoverBoostFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.hoverBoostFactor = DEFAULT_SETTINGS.glow.hoverBoostFactor;
          await this.plugin.saveSettings();
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Highlight depth',
      desc: 'Graph distance (in hops) from the hovered node that will be highlighted.',
      value: glow.hoverHighlightDepth ?? 1,
      min: 0,
      max: 5,
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
      min: 0.5,
      max: 100,
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
      value: glow.distanceOuterRadiusMultiplier ?? DEFAULT_SETTINGS.glow.distanceOuterRadiusMultiplier,
      min: 1,
      max: 100,
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
      min: 0.5,
      max: 5,
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
    addSliderSetting(containerEl, {
      name: 'Focus smoothing rate',
      desc: 'Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.',
      value: glow.focusSmoothingRate ?? DEFAULT_SETTINGS.glow.focusSmoothingRate,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.focusSmoothingRate,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.focusSmoothingRate = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.focusSmoothingRate = DEFAULT_SETTINGS.glow.focusSmoothingRate;
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
      try { colorInput.value = glow.nodeColor ? String(glow.nodeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        glow.nodeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const alphaInput = document.createElement('input');
      alphaInput.type = 'number'; alphaInput.min = '0.1'; alphaInput.max = '1'; alphaInput.step = '0.01';
      alphaInput.value = String(glow.nodeColorAlpha ?? DEFAULT_SETTINGS.glow.nodeColorAlpha);
      alphaInput.style.width = '68px'; alphaInput.style.marginLeft = '8px';
      alphaInput.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.nodeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.nodeColorAlpha;
        await this.plugin.saveSettings();
      });
      const maxAlphaInput = document.createElement('input');
      maxAlphaInput.type = 'number'; maxAlphaInput.min = '0.1'; maxAlphaInput.max = '1'; maxAlphaInput.step = '0.01';
      maxAlphaInput.value = String((glow.nodeColorMaxAlpha ?? DEFAULT_SETTINGS.glow.nodeColorMaxAlpha));
      maxAlphaInput.style.width = '68px'; maxAlphaInput.style.marginLeft = '6px';
      maxAlphaInput.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.nodeColorMaxAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.nodeColorMaxAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { glow.nodeColor = undefined; glow.nodeColorAlpha = undefined; glow.nodeColorMaxAlpha = undefined; await this.plugin.saveSettings(); colorInput.value = '#000000'; alphaInput.value = String(DEFAULT_SETTINGS.glow.nodeColorAlpha); maxAlphaInput.value = String(DEFAULT_SETTINGS.glow.nodeColorMaxAlpha); });
      (s as any).controlEl.appendChild(rb);
      const hint = document.createElement('span'); hint.textContent = '(alpha: min|max)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(colorInput);
      (s as any).controlEl.appendChild(alphaInput);
      (s as any).controlEl.appendChild(maxAlphaInput);
    }

    {
      const s = new Setting(containerEl)
        .setName('Edge color (override)')
        .setDesc('Optional color to override edge stroke color. Leave unset to use a theme-appropriate color.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = glow.edgeColor ? String(glow.edgeColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        glow.edgeColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const edgeAlpha = document.createElement('input');
      edgeAlpha.type = 'number'; edgeAlpha.min = '0.1'; edgeAlpha.max = '1'; edgeAlpha.step = '0.01';
      edgeAlpha.value = String(glow.edgeColorAlpha ?? DEFAULT_SETTINGS.glow.edgeColorAlpha);
      edgeAlpha.style.width = '68px'; edgeAlpha.style.marginLeft = '8px';
      edgeAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.edgeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.edgeColorAlpha;
        await this.plugin.saveSettings();
      });

      const edgeMaxAlpha = document.createElement('input');
      edgeMaxAlpha.type = 'number'; edgeMaxAlpha.min = '0.1'; edgeMaxAlpha.max = '1'; edgeMaxAlpha.step = '0.01';
      edgeMaxAlpha.value = String(glow.edgeColorMaxAlpha ?? DEFAULT_SETTINGS.glow.edgeColorMaxAlpha);
      edgeMaxAlpha.style.width = '68px'; edgeMaxAlpha.style.marginLeft = '6px';
      edgeMaxAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.edgeColorMaxAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.edgeColorMaxAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { glow.edgeColor = undefined; glow.edgeColorAlpha = undefined; glow.edgeColorMaxAlpha = undefined; await this.plugin.saveSettings(); colorInput.value = '#000000'; edgeAlpha.value = String(DEFAULT_SETTINGS.glow.edgeColorAlpha); edgeMaxAlpha.value = String(DEFAULT_SETTINGS.glow.edgeColorMaxAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha: min|max)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(edgeAlpha);
      (s as any).controlEl.appendChild(edgeMaxAlpha);
    }

    // Tag color (override)
    {
      const s = new Setting(containerEl)
        .setName('Tag color (override)')
        .setDesc('Optional color to override tag node color. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = glow.tagColor ? String(glow.tagColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        glow.tagColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const tagAlpha = document.createElement('input'); tagAlpha.type = 'number'; tagAlpha.min = '0.1'; tagAlpha.max = '1'; tagAlpha.step = '0.01';
      tagAlpha.value = String(glow.tagColorAlpha ?? DEFAULT_SETTINGS.glow.tagColorAlpha);
      tagAlpha.style.width = '68px'; tagAlpha.style.marginLeft = '8px';
      tagAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.tagColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.tagColorAlpha;
        await this.plugin.saveSettings();
      });

      const tagMaxAlpha = document.createElement('input'); tagMaxAlpha.type = 'number'; tagMaxAlpha.min = '0.1'; tagMaxAlpha.max = '1'; tagMaxAlpha.step = '0.01';
      tagMaxAlpha.value = String(glow.tagColorMaxAlpha ?? DEFAULT_SETTINGS.glow.tagColorMaxAlpha);
      tagMaxAlpha.style.width = '68px'; tagMaxAlpha.style.marginLeft = '6px';
      tagMaxAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.tagColorMaxAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : DEFAULT_SETTINGS.glow.tagColorMaxAlpha;
        await this.plugin.saveSettings();
      });

      rb.addEventListener('click', async () => { glow.tagColor = undefined; glow.tagColorAlpha = undefined; glow.tagColorMaxAlpha = undefined; await this.plugin.saveSettings(); colorInput.value = '#000000'; tagAlpha.value = String(DEFAULT_SETTINGS.glow.tagColorAlpha); tagMaxAlpha.value = String(DEFAULT_SETTINGS.glow.tagColorMaxAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha: min|max)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(tagAlpha);
      (s as any).controlEl.appendChild(tagMaxAlpha);
    }

    {
      const s = new Setting(containerEl)
        .setName('Label color (override)')
        .setDesc('Optional color to override the label text color. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { colorInput.value = glow.labelColor ? String(glow.labelColor) : '#000000'; } catch (e) { colorInput.value = '#000000'; }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        glow.labelColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = '↺'; rb.title = 'Reset to default'; rb.style.marginLeft = '8px'; rb.style.border='none'; rb.style.background='transparent'; rb.style.cursor='pointer';
      const labelAlpha = document.createElement('input');
      labelAlpha.type = 'number'; labelAlpha.min = '0'; labelAlpha.max = '1'; labelAlpha.step = '0.01';
      labelAlpha.value = String(glow.labelColorAlpha ?? DEFAULT_SETTINGS.glow.labelColorAlpha);
      labelAlpha.style.width = '68px'; labelAlpha.style.marginLeft = '8px';
      labelAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        glow.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.labelColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener('click', async () => { glow.labelColor = undefined; glow.labelColorAlpha = undefined; await this.plugin.saveSettings(); colorInput.value = '#000000'; labelAlpha.value = String(DEFAULT_SETTINGS.glow.labelColorAlpha); });
      (s as any).controlEl.appendChild(rb);
      (s as any).controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); hint.textContent = '(alpha)'; hint.style.marginLeft = '8px'; hint.style.marginRight = '6px';
      (s as any).controlEl.appendChild(hint);
      (s as any).controlEl.appendChild(labelAlpha);
    }

    new Setting(containerEl)
      .setName('Use interface font for labels')
      .setDesc('When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.')
      .addToggle((t) => t.setValue(Boolean(glow.useInterfaceFont)).onChange(async (v) => {
        glow.useInterfaceFont = Boolean(v);
        await this.plugin.saveSettings();
      }));

    addSliderSetting(containerEl, {
      name: 'Base label font size',
      desc: 'Base font size for labels in pixels (before camera zoom scaling).',
      value: glow.labelBaseFontSize ?? DEFAULT_SETTINGS.glow.labelBaseFontSize,
      min: 6,
      max: 24,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.labelBaseFontSize,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 72) {
          glow.labelBaseFontSize = Math.round(v);
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.labelBaseFontSize = DEFAULT_SETTINGS.glow.labelBaseFontSize;
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

      // Mouse attractor settings
      addSliderSetting(containerEl, {
        name: 'Mouse gravity well (radius px)',
        desc: 'Maximum distance (in pixels) from cursor where the gravity well attracts nodes.',
        value: phys.mouseAttractionRadius ?? DEFAULT_SETTINGS.physics!.mouseAttractionRadius,
        min: 10,
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

      // mouse attraction strength: UI 0..1 -> internal = ui * 0.1
      const mouseStrengthUi = Math.min(1, Math.max(0, (phys.mouseAttractionStrength ?? DEFAULT_SETTINGS.physics!.mouseAttractionStrength) / 0.1));
      addSliderSetting(containerEl, {
        name: 'Mouse attraction strength',
        desc: 'UI 0–1 mapped to internal small force scale (higher = stronger pull).',
        value: mouseStrengthUi,
        min: 0,
        max: 1,
        step: 0.01,
        resetValue: 0.2,
        onChange: async (v) => {
          if (!Number.isNaN(v) && v >= 0 && v <= 1) {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            this.plugin.settings.physics.mouseAttractionStrength = v * 0.1;
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
        desc: 'How sharply attraction ramps as the cursor approaches (1 = linear; higher = snappier near cursor).',
        value: phys.mouseAttractionExponent ?? DEFAULT_SETTINGS.physics!.mouseAttractionExponent,
        min: 1,
        max: 6,
        step: 0.1,
        resetValue: DEFAULT_SETTINGS.physics!.mouseAttractionExponent,
        onChange: async (v) => {
          if (!Number.isNaN(v) && v >= 1 && v <= 6) {
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

    // Center Node settings
    containerEl.createEl('h2', { text: 'Center Node' });
    new Setting(containerEl)
      .setName('Use pinned center note')
      .setDesc('Prefer a specific note path as the graph center. Falls back to max in-links if not found.')
      .addToggle((t) => t
        .setValue(Boolean(this.plugin.settings.usePinnedCenterNote))
        .onChange(async (v: boolean) => {
          this.plugin.settings.usePinnedCenterNote = Boolean(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pinned center note path')
      .setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).')
      .addText((txt) => txt
        .setPlaceholder('path/to/note')
        .setValue(this.plugin.settings.pinnedCenterNotePath || '')
        .onChange(async (v: string) => {
          this.plugin.settings.pinnedCenterNotePath = (v || '').trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Fallback: prefer out-links')
      .setDesc('When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)')
      .addToggle((t) => t
        .setValue(Boolean(this.plugin.settings.useOutlinkFallback))
        .onChange(async (v: boolean) => {
          this.plugin.settings.useOutlinkFallback = Boolean(v);
          await this.plugin.saveSettings();
        }));
  }
}
