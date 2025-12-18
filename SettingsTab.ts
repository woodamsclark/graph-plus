import { App, PluginSettingTab, Setting, TextComponent, ToggleComponent } from 'obsidian';
import GraphPlus from './main.ts';
import { getSettings, updateSettings } from './utilities/settingsStore.ts';
import { GraphPlusSettings } from './utilities/interfaces.ts';
import { DEFAULT_SETTINGS } from './utilities/defaultSettings.ts';

declare module 'obsidian' {
  interface Setting {
    controlEl: HTMLElement;
  }
}

export class GraphPlusSettingTab extends PluginSettingTab {
  plugin: GraphPlus;

  constructor(app: App, plugin: GraphPlus) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const settings          = getSettings();
    const { containerEl }   = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Graph Settings' });

    // helper to create a slider with reset button inside a Setting
    const addSliderSetting  = (parent: HTMLElement, opts: { 
        name        : string; 
        desc?       : string; 
        value       : number; 
        min         : number; 
        max         : number; 
        step?       : number; 
        onChange    : (v: number) => Promise<void>  | void; 
        resetValue? : number                        | undefined; 
    }) => {
      const s               = new Setting(parent).setName(opts.name).setDesc(opts.desc || '');
      const wrap            = document.createElement('div');
      wrap.style.display    = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap        = '8px';

      const range           = document.createElement('input');
      range.type            = 'range';
      range.min             = String(opts.min);
      range.max             = String(opts.max);
      range.step            = String(opts.step ?? (opts.step === 0 ? 0 : (opts.step || 1)));
      range.value           = String(opts.value);
      range.style.flex      = '1';

      const num             = document.createElement('input');
      num.type              = 'number';
      num.min               = String(opts.min); 
      num.max               = String(opts.max); 
      num.step              = String(opts.step ?? (opts.step === 0 ? 0 : (opts.step || 1)));
      num.value             = String(opts.value);
      num.style.minWidth    = '56px';
      num.style.textAlign   = 'right';
      num.style.width       = '80px';

      range.addEventListener('input', (e)         => { num.value    = (e.target         as HTMLInputElement).value; });
      num.addEventListener  ('input', (e)         => { range.value  = (e.target         as HTMLInputElement).value; });
      range.addEventListener('change', async (e)  => { const v      = Number((e.target  as HTMLInputElement).value); await opts.onChange(v); });
      num.addEventListener  ('change', async (e)  => { const v      = Number((e.target  as HTMLInputElement).value); await opts.onChange(v); });

      const rbtn            = document.createElement('button');
      rbtn.type             = 'button';
      rbtn.textContent      = '↺';
      rbtn.title            = 'Reset to default';
      rbtn.style.border     = 'none';
      rbtn.style.background = 'transparent';
      rbtn.style.cursor     = 'pointer';
      rbtn.addEventListener('click', async () => {
        try {
          if (typeof opts.resetValue === 'number') {
            range.value = String(opts.resetValue);
            num.value   = range.value;
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
      s.controlEl.appendChild(wrap);
      return { range, num, reset: rbtn };
    };

    const addNumericSlider = (parent: HTMLElement, opts: {
  name      : string;
  desc?     : string;
  min       : number;
  max       : number;
  step?     : number;
  get       : (s: GraphPlusSettings)            => number;
  getDefault: (s: GraphPlusSettings)            => number;
  set       : (s: GraphPlusSettings, v: number) => void;
  clamp?    : (v: number)                       => number;
}) => {
  const current = opts.get(settings);
  const def     = opts.getDefault(DEFAULT_SETTINGS);

  addSliderSetting(parent, {
    name : opts.name,
    desc : opts.desc,
    value: current,
    min  : opts.min,
    max  : opts.max,
    step : opts.step,
    resetValue: def,
    onChange: async (raw) => {
      if (Number.isNaN(raw)) {
        // reset to default
        const dv = opts.clamp ? opts.clamp(def) : def;
        this.applySettings((s) => { opts.set(s, dv); });
        return;
      }
      const v = opts.clamp ? opts.clamp(raw) : raw;
      this.applySettings((s) => { opts.set(s, v); });
    },
  });
};


    // Minimum node radius (UI in pixels)
    addNumericSlider(containerEl, {
      name      : 'Minimum node radius',
      desc      : 'Minimum radius for the smallest node (in pixels).',
      min       : 1,
      max       : 20,
      step      : 1,
      get       : (s) => s.graph.minNodeRadius,
      getDefault: (s) => s.graph.minNodeRadius,
      set       : (s, v) => { s.graph.minNodeRadius = Math.round(v); },
      clamp     : (v) => Math.max(1, Math.min(20, Math.round(v))),
    });


    addNumericSlider(containerEl, {
      name      : 'Maximum node radius',
      desc      : 'Maximum radius for the most connected node (in pixels).',
      min       : 8,
      max       : 80,
      step      : 1,
      get       : (s) => s.graph.maxNodeRadius,
      getDefault: (s) => s.graph.maxNodeRadius,
      set       : (s, v) => { s.graph.maxNodeRadius = Math.round(v); },
      clamp     : (v) => Math.max(8, Math.min(80, Math.round(v))),
    });

    /*
    addNumericSlider(containerEl, {
      name      : 'Minimum center glow opacity',
      desc      : 'Opacity (0–0.8) at the glow center for the least connected node.',
      min       : 0,
      max       : 0.8,
      step      : 0.01,
      get       : (s) => s.graph.minCenterAlpha,
      getDefault: (s) => s.graph.minCenterAlpha,
      set       : (s, v) => { s.graph.minCenterAlpha = v; },
      clamp     : (v) => Math.max(0, Math.min(0.8, v)),
    });


    addNumericSlider(containerEl, {
      name: 'Maximum center glow opacity',
      desc: 'Opacity (0–1) at the glow center for the most connected node.',
      value: settings.graph.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      get       : (s) => s.graph.maxCenterAlpha,
      getDefault: (s) => s.graph.maxCenterAlpha,
      set       : (s, v) => { s.graph.maxCenterAlpha = v; },
      clamp     : (v) => Math.max(0, Math.min(1, v)),
    });
    */

    addSliderSetting(containerEl, {
      name: 'Highlight depth',
      desc: 'Graph distance (in hops) from the hovered node that will be highlighted.',
      value: settings.graph.highlightDepth,
      min: 0,
      max: 5,
      step: 1,
      resetValue: DEFAULT_SETTINGS.graph.highlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
            this.applySettings((s) => { s.graph.highlightDepth = v; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.graph.highlightDepth = settings.graph.highlightDepth; });
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity Radius',
      desc: 'Scales each node\'s screen-space radius for glow/mouse gravity.',
      value: settings.physics.mouseGravityRadius,
      min: 10,
      max: 30,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.mouseGravityRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          this.applySettings((s) => { s.physics.mouseGravityRadius = v; });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => { s.physics.mouseGravityRadius = settings.physics.mouseGravityRadius; });
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Gravity strength',
      desc: 'Overall strength of the mouse gravity effect.',
      value: settings.physics.mouseGravityStrength,
      min: 1,
      max: 20,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.mouseGravityStrength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          this.applySettings((s) => { s.physics.mouseGravityStrength = v; });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => { s.physics.mouseGravityStrength = settings.physics.mouseGravityStrength; });
        }
      },
    });

        addSliderSetting(containerEl, {
      name: 'Label Radius',
      desc: 'Screen-space label reveal radius (× node size).',
      value: settings.graph.labelRadius,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.graph.labelRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          this.applySettings((s) => { s.graph.labelRadius = v; });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => { s.graph.labelRadius = settings.graph.labelRadius; });
        }
      },
    });

    // Focus / dimming controls
    addSliderSetting(containerEl, {
      name: 'Focus smoothing rate',
      desc: 'Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.',
      value: settings.graph.focusSmoothing,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.graph.focusSmoothing,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => { s.graph.focusSmoothing = v; });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => { s.graph.focusSmoothing = settings.graph.focusSmoothing; });
        }
      },
    });

    //// COLORS ////
    containerEl.createEl('h2', { text: 'Color Settings' });

    {
      const s = new Setting(containerEl)
        .setName('Node color (override)')
        .setDesc('Optional color to override the theme accent for node fill. Leave unset to use the active theme.');
      const colorInput  = document.createElement('input');
      colorInput.type   = 'color';
      try { 
        colorInput.value = settings.graph.nodeColor ? String(settings.graph.nodeColor) : '#000000'; 
    } catch (e) { 
        colorInput.value = '#000000';
    }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        this.applySettings((s) => { s.graph.nodeColor = v === '' ? undefined : v; });
      });

      const rb                      = document.createElement('button'); 
      rb.type                       = 'button'; 
      rb.textContent                = '↺'; 
      rb.title                      = 'Reset to default'; 
      rb.style.marginLeft           = '8px'; 
      rb.style.border               = 'none'; 
      rb.style.background           = 'transparent'; 
      rb.style.cursor               = 'pointer';
      const alphaInput              = document.createElement('input');
      alphaInput.type               = 'number'; 
      alphaInput.min                = '0.1'; 
      alphaInput.max                = '1'; 
      alphaInput.step               = '0.01';
      alphaInput.value              = String(settings.graph.nodeColorAlpha);
      alphaInput.style.width        = '68px'; 
      alphaInput.style.marginLeft   = '8px';
      alphaInput.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.applySettings((s) => { s.graph.nodeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : settings.graph.nodeColorAlpha; });
      });
      rb.addEventListener('click', async () => { 
        this.applySettings((s) => { s.graph.nodeColor = undefined; s.graph.nodeColorAlpha = settings.graph.nodeColorAlpha; });
        colorInput.value                = '#000000'; 
        alphaInput.value                = String(settings.graph.nodeColorAlpha); 
    });
      s.controlEl.appendChild(rb);
      const hint                = document.createElement('span'); 
      hint.textContent          = '(alpha)'; 
      hint.style.marginLeft     = '8px'; 
      hint.style.marginRight    = '6px';
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(colorInput);
      s.controlEl.appendChild(alphaInput);
    }

    {
      const s = new Setting(containerEl)
        .setName('Edge color (override)')
        .setDesc('Optional color to override edge stroke color. Leave unset to use a theme-appropriate color.');
      const colorInput  = document.createElement('input');
      colorInput.type   = 'color';
      
      try { 
        colorInput.value = settings.graph.edgeColor ? String(settings.graph.edgeColor) : '#000000'; 
      } catch (e) { 
        colorInput.value = '#000000'; 
      }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        this.applySettings((s) => { s.graph.edgeColor = v === '' ? undefined : v; });
      });
      const rb                      = document.createElement('button'); 
      rb.type                       = 'button'; 
      rb.textContent                = '↺'; 
      rb.title                      = 'Reset to default'; 
      rb.style.marginLeft           = '8px'; 
      rb.style.border               = 'none'; 
      rb.style.background           = 'transparent'; 
      rb.style.cursor               = 'pointer';
      const edgeAlpha               = document.createElement('input');
      edgeAlpha.type                = 'number'; 
      edgeAlpha.min                 = '0.1'; 
      edgeAlpha.max                 = '1'; 
      edgeAlpha.step                = '0.01';
      edgeAlpha.value               = String(settings.graph.edgeColorAlpha);
      edgeAlpha.style.width         = '68px'; 
      edgeAlpha.style.marginLeft    = '8px';
      edgeAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.applySettings((s) => { s.graph.edgeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : settings.graph.edgeColorAlpha; });
      });

      rb.addEventListener('click', async () => { 
        this.applySettings((s) => { s.graph.edgeColor = undefined; s.graph.edgeColorAlpha = settings.graph.edgeColorAlpha; });  
        colorInput.value = '#000000'; 
        edgeAlpha.value = String(settings.graph.edgeColorAlpha); 
      });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint                = document.createElement('span'); 
      hint.textContent          = '(alpha)'; 
      hint.style.marginLeft     = '8px'; 
      hint.style.marginRight    = '6px';
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(edgeAlpha);
    }

    // Tag color (override)
    {
      const s = new Setting(containerEl)
        .setName('Tag color (override)')
        .setDesc('Optional color to override tag node color. Leave unset to use the active theme.');
      const colorInput              = document.createElement('input');
      colorInput.type               = 'color';
      try { 
        colorInput.value            = settings.graph.tagColor ? String(settings.graph.tagColor) : '#000000';
      } catch (e) { 
        colorInput.value            = '#000000'; 
    }
      colorInput.style.marginLeft   = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        settings.graph.tagColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb                  = document.createElement('button'); 
      rb.type                   = 'button'; 
      rb.textContent            = '↺'; 
      rb.title                  = 'Reset to default'; 
      rb.style.marginLeft       = '8px';
      rb.style.border           = 'none'; 
      rb.style.background       = 'transparent'; 
      rb.style.cursor           = 'pointer';
      const tagAlpha            = document.createElement('input'); 
      tagAlpha.type             = 'number'; 
      tagAlpha.min              = '0.1'; 
      tagAlpha.max              = '1'; 
      tagAlpha.step             = '0.01';
      tagAlpha.value            = String(settings.graph.tagColorAlpha);
      tagAlpha.style.width      = '68px'; 
      tagAlpha.style.marginLeft = '8px';
      tagAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.applySettings((s) => { s.graph.tagColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : settings.graph.tagColorAlpha; });
      });

      rb.addEventListener('click', async () => {
        this.applySettings((s) => { s.graph.tagColor = undefined; s.graph.tagColorAlpha = settings.graph.tagColorAlpha; });
        await this.plugin.saveSettings(); 
        colorInput.value                = '#000000'; 
        tagAlpha.value                  = String(settings.graph.tagColorAlpha); 
    });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint                = document.createElement('span'); 
      hint.textContent          = '(alpha)'; 
      hint.style.marginLeft     = '8px'; 
      hint.style.marginRight    = '6px';
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(tagAlpha);
    }

    {
      const s = new Setting(containerEl)
        .setName('Label color (override)')
        .setDesc('Optional color to override the label text color. Leave unset to use the active theme.');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      try { 
        colorInput.value = settings.graph.labelColor ? String(settings.graph.labelColor) : '#000000'; 
      } catch (e) { 
        colorInput.value = '#000000'; 
      }
      colorInput.style.marginLeft = '8px';
      colorInput.addEventListener('change', async (e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        settings.graph.labelColor = v === '' ? undefined : v;
        await this.plugin.saveSettings();
      });
      const rb                          = document.createElement('button'); 
      rb.type                           = 'button'; rb.textContent = '↺'; 
      rb.title                          = 'Reset to default'; 
      rb.style.marginLeft               = '8px'; 
      rb.style.border                   ='none'; 
      rb.style.background               ='transparent'; 
      rb.style.cursor                   ='pointer';
      const labelAlpha                  = document.createElement('input');
      labelAlpha.type                   = 'number'; 
      labelAlpha.min                    = '0'; 
      labelAlpha.max                    = '1'; 
      labelAlpha.step                   = '0.01';
      labelAlpha.value                  = String(settings.graph.labelColorAlpha);
      labelAlpha.style.width            = '68px'; 
      labelAlpha.style.marginLeft       = '8px';
      labelAlpha.addEventListener('change', async (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.applySettings((s) => { s.graph.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : settings.graph.labelColorAlpha; });
      });
      rb.addEventListener('click', async () => {
        this.applySettings((s) => { s.graph.labelColor = undefined; s.graph.labelColorAlpha = settings.graph.labelColorAlpha; });
        colorInput.value = '#000000'; 
        labelAlpha.value = String(settings.graph.labelColorAlpha); });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement('span'); 
      hint.textContent          = '(alpha)'; 
      hint.style.marginLeft     = '8px'; 
      hint.style.marginRight    = '6px';
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(labelAlpha);
    }

    new Setting(containerEl)
      .setName('Use interface font for labels')
      .setDesc('When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.')
      .addToggle((t: ToggleComponent ) => t.setValue(Boolean(settings.graph.useInterfaceFont)).onChange(async (v: boolean) => {
        this.applySettings((s) => { s.graph.useInterfaceFont = v; });
      }));

    addSliderSetting(containerEl, {
      name: 'Base label font size',
      desc: 'Base font size for labels in pixels (before camera zoom scaling).',
      value: settings.graph.labelBaseFontSize,
      min: 6,
      max: 24,
      step: 1,
      resetValue: DEFAULT_SETTINGS.graph.labelBaseFontSize,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 72) {
            this.applySettings((s) => { s.graph.labelBaseFontSize = Math.round(v); });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.graph.labelBaseFontSize = settings.graph.labelBaseFontSize; });
        }
      },
    });

    //// settings.physics ////
    containerEl.createEl('h2', { text: 'Physics Settings' });

    const repulsionUi = (() => {
      const internal = (settings.physics.repulsionStrength);
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
            this.applySettings((s) => { s.physics.repulsionStrength = v * v * 2000; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.repulsionStrength = settings.physics.repulsionStrength; });
        }
      },
    });

    const springUi = Math.min(1, Math.max(0, (settings.physics.springStrength) / 0.5));
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
            this.applySettings((s) => { s.physics.springStrength = v * 0.5; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.springStrength = settings.physics!.springStrength; });
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Spring length',
      desc: 'Preferred length (px) for edge springs.',
      value: settings.physics.springLength,
      min: 20,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics!.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
            this.applySettings((s) => { s.physics.springLength = v; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.springLength = settings.physics!.springLength; });
        }
      },
    });

    const centerUi = Math.min(1, Math.max(0, (settings.physics.centerPull) / 0.01));
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
            this.applySettings((s) => { s.physics.centerPull = v * 0.01; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.centerPull = 0; });
        }
      },
    });

    addSliderSetting(containerEl, {
      name: 'Damping',
      desc: 'Velocity damping (0.7–1.0). Higher values reduce motion faster.',
      value: settings.physics.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
          this.applySettings((s) => { s.physics.damping = v; });
        } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.damping = settings.physics.damping; });
        }
      },
    });

    new Setting(containerEl)
      .setName('Count duplicate links')
      .setDesc('If enabled, multiple links between the same two files will be counted when computing in/out degrees.')
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(settings.graph.countDuplicateLinks)).onChange(async (v: boolean) => {
        this.applySettings((s) => { s.graph.countDuplicateLinks = Boolean(v); });
      }));

    new Setting(containerEl)
      .setName('Double-line mutual links')
      .setDesc('When enabled, mutual links (A ↔ B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.')
      .addToggle((t: ToggleComponent) => t.setValue(Boolean(settings.graph.drawDoubleLines)).onChange(async (v: boolean) => {
        this.applySettings((s) => { s.graph.drawDoubleLines = Boolean(v); });
      }));

    new Setting(containerEl)
      .setName('Show tag nodes')
      .setDesc('Toggle visibility of tag nodes and their edges in the graph.')
      .addToggle((t: ToggleComponent) => t.setValue(settings.graph.showTags !== false).onChange(async (v: boolean) => {
        this.applySettings((s) => { s.graph.showTags = Boolean(v); });
      }));

      const notePlaneUi = Math.min(1, Math.max(0, (settings.physics.notePlaneStiffness) / 0.02));
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
            this.applySettings((s) => { s.physics.notePlaneStiffness = v * 0.02; });
          } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.notePlaneStiffness = 0; });
          }
        },
      });

      const tagPlaneUi = Math.min(1, Math.max(0, (settings.physics.tagPlaneStiffness) / 0.02));
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
            this.applySettings((s) => { s.physics.tagPlaneStiffness = v * 0.02; });
          } else if (Number.isNaN(v)) {
            this.applySettings((s) => { s.physics.tagPlaneStiffness = 0; });
          }
        },
      });

      // Mouse gravity toggle (replaces old radius control)
      new Setting(containerEl)
        .setName('Mouse gravity')
        .setDesc('Enable the mouse gravity well that attracts nearby nodes.')
        .addToggle((t: any) => t
          .setValue(Boolean((settings.physics as any).mouseGravityEnabled !== false))
          .onChange(async (v: any) => {
            this.applySettings((s) => { (s.physics as any).mouseGravityEnabled = Boolean(v); });
          }));

      

    // Center Node settings
    containerEl.createEl('h2', { text: 'Center Node' });
    new Setting(containerEl)
      .setName('Use pinned center note')
      .setDesc('Prefer a specific note path as the graph center. Falls back to max in-links if not found.')
      .addToggle((t: ToggleComponent) => t
        .setValue(Boolean(settings.graph.useCenterNote))
        .onChange(async (v: boolean) => {
          this.applySettings((s) => { s.graph.useCenterNote = Boolean(v); });
        }));

    new Setting(containerEl)
      .setName('Pinned center note path')
      .setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).')
      .addText((txt: TextComponent) => txt
        .setPlaceholder('path/to/note')
        .setValue(settings.graph.centerNoteTitle || '')
        .onChange(async (v: string) => {
            this.applySettings((s) => { s.graph.centerNoteTitle = (v || '').trim(); });
        }));

    new Setting(containerEl)
      .setName('Fallback: prefer out-links')
      .setDesc('When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)')
      .addToggle((t: ToggleComponent) => t
        .setValue(Boolean(settings.graph.useOutlinkFallback))
        .onChange(async (v: boolean) => {
            this.applySettings((s) => { s.graph.useOutlinkFallback = Boolean(v); });
        }));
  }
  async applySettings(mutator: (s: GraphPlusSettings) => void) {
    updateSettings(mutator);
    await this.plugin.saveSettings();
  }
}
