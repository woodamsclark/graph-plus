import { App, PluginSettingTab, Setting, TextComponent, ToggleComponent } from 'obsidian';
import GraphPlus from '../main.ts';
import { getSettings, updateSettings } from '../settings/settingsStore.ts';
import { GraphPlusSettings, PointerKind } from '../../graph+/grammar/interfaces.ts';
import { DEFAULT_SETTINGS } from '../settings/defaultSettings.ts';
import {
  getSettingsSchema,
  getSettingsFieldContext,
  type FieldContext,
  type SectionDescriptor,
  type FieldDescriptor,
  type SliderField,
  type ToggleField,
  type ColorField,
  type TextField,
} from './settingsSchema.ts';

declare module 'obsidian' {
  interface Setting {
    controlEl: HTMLElement;
  }
}


const round = (value: number, decimals = 3): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

const formatStringArray = (value: string[] | undefined): string => {
  return Array.isArray(value) ? value.join(', ') : '';
};

export class GraphPlusSettingTab extends PluginSettingTab {
  plugin: GraphPlus;

  constructor(app: App, plugin: GraphPlus) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const settings = getSettings();
    const defaults = DEFAULT_SETTINGS;
    const ctx: FieldContext = getSettingsFieldContext(settings);
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'GraphPlus Settings' });

    for (const section of getSettingsSchema()) {
      this.renderSection(containerEl, section, ctx);
    }
  }

  private renderSection(parent: HTMLElement, section: SectionDescriptor, ctx: FieldContext): void {
    parent.createEl('h3', { text: section.title });

    for (const field of section.fields) {
      if (field.visible && !field.visible(ctx)) {
        continue;
      }

      this.renderField(parent, field, ctx);
    }
  }

  private renderField(parent: HTMLElement, field: FieldDescriptor, ctx: FieldContext): void {
    switch (field.kind) {
      case 'slider':
        this.renderSliderField(parent, field, ctx);
        return;
      case 'toggle':
        this.renderToggleField(parent, field, ctx);
        return;
      case 'color':
        this.renderColorField(parent, field, ctx);
        return;
      case 'text':
        this.renderTextField(parent, field, ctx);
        return;
    }
  }

  private renderSliderField(parent: HTMLElement, field: SliderField, ctx: FieldContext): void {
    const currentValue = field.get(ctx.settings);
    const defaultValue = field.getDefault(ctx.defaults);
    const uiValue = field.toUi ? field.toUi(currentValue, ctx) : currentValue;

    const setting = new Setting(parent)
      .setName(field.name)
      .setDesc(field.desc || '');

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(field.min);
    range.max = String(field.max);
    range.step = String(field.step ?? 1);
    range.value = String(uiValue);
    range.style.flex = '1';

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = String(field.min);
    numberInput.max = String(field.max);
    numberInput.step = String(field.step ?? 1);
    numberInput.value = String(uiValue);
    numberInput.style.minWidth = '72px';
    numberInput.style.textAlign = 'right';
    numberInput.style.width = '84px';

    const syncValue = (rawValue: string) => {
      range.value = rawValue;
      numberInput.value = rawValue;
    };

    range.addEventListener('input', (e) => {
      syncValue((e.target as HTMLInputElement).value);
    });

    numberInput.addEventListener('input', (e) => {
      syncValue((e.target as HTMLInputElement).value);
    });

    const commitValue = async (raw: number) => {
      if (Number.isNaN(raw)) {
        const resetUiValue = field.toUi ? field.toUi(defaultValue, ctx) : defaultValue;
        syncValue(String(resetUiValue));
        await this.applySettings((settings) => {
          field.set(settings, defaultValue);
        });
        return;
      }

      const clampedUi = field.clamp ? field.clamp(raw) : raw;
      const resolvedValue = field.fromUi ? field.fromUi(clampedUi, ctx) : clampedUi;
      syncValue(String(clampedUi));
      await this.applySettings((settings) => {
        field.set(settings, resolvedValue);
      });
    };

    range.addEventListener('change', async (e) => {
      await commitValue(Number((e.target as HTMLInputElement).value));
    });

    numberInput.addEventListener('change', async (e) => {
      await commitValue(Number((e.target as HTMLInputElement).value));
    });

    const resetButton = this.createResetButton(async () => {
      await commitValue(NaN);
    });

    wrap.appendChild(range);
    wrap.appendChild(numberInput);
    wrap.appendChild(resetButton);
    setting.controlEl.appendChild(wrap);
  }

  private renderToggleField(parent: HTMLElement, field: ToggleField, ctx: FieldContext): void {
    const setting = new Setting(parent)
      .setName(field.name)
      .setDesc(field.desc || '');

    setting.addToggle((toggle: ToggleComponent) => {
      toggle.setValue(field.get(ctx.settings));
      toggle.onChange(async (value: boolean) => {
        await this.applySettings((settings) => {
          field.set(settings, value);
        });
      });
    });

    setting.controlEl.appendChild(
      this.createResetButton(async () => {
        await this.applySettings((settings) => {
          field.set(settings, field.getDefault(ctx.defaults));
        });
        this.display();
      }),
    );
  }

  private renderColorField(parent: HTMLElement, field: ColorField, ctx: FieldContext): void {
    const setting = new Setting(parent)
      .setName(field.name)
      .setDesc(field.desc || '');

    const fallback = field.fallback ?? '#000000';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';

    try {
      colorInput.value = field.get(ctx.settings) ?? fallback;
    } catch {
      colorInput.value = fallback;
    }

    colorInput.style.marginLeft = '8px';
    colorInput.addEventListener('change', async (e) => {
      const value = (e.target as HTMLInputElement).value.trim();
      await this.applySettings((settings) => {
        field.set(settings, value === '' ? undefined : value);
      });
    });

    const alphaHint = document.createElement('span');
    alphaHint.textContent = '(alpha ignored by picker)';
    alphaHint.style.marginLeft = '8px';
    alphaHint.style.marginRight = '6px';
    alphaHint.style.fontSize = '12px';

    const resetButton = this.createResetButton(async () => {
      const defaultValue = field.getDefault(ctx.defaults);
      await this.applySettings((settings) => {
        field.set(settings, defaultValue);
      });
      this.display();
    });

    setting.controlEl.appendChild(resetButton);
    setting.controlEl.appendChild(alphaHint);
    setting.controlEl.appendChild(colorInput);
  }

  private renderTextField(parent: HTMLElement, field: TextField, ctx: FieldContext): void {
    const setting = new Setting(parent)
      .setName(field.name)
      .setDesc(field.desc || '');

    setting.addText((text: TextComponent) => {
      text.setValue(field.get(ctx.settings));
      if (field.placeholder) {
        text.setPlaceholder(field.placeholder);
      }
      text.onChange(async (value: string) => {
        const parsed = field.parse ? field.parse(value, ctx) : value;
        await this.applySettings((settings) => {
          field.set(settings, parsed);
        });
      });
    });

    setting.controlEl.appendChild(
      this.createResetButton(async () => {
        await this.applySettings((settings) => {
          field.set(settings, field.getDefault(ctx.defaults));
        });
        this.display();
      }),
    );
  }

  private createResetButton(onClick: () => Promise<void> | void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '↺';
    button.title = 'Reset to default';
    button.style.marginLeft = '8px';
    button.style.border = 'none';
    button.style.background = 'transparent';
    button.style.cursor = 'pointer';
    button.addEventListener('click', async () => {
      try {
        await onClick();
      } catch {
        // no-op
      }
    });
    return button;
  }

  async applySettings(mutator: (s: GraphPlusSettings) => void) {
    updateSettings(mutator);
    await this.plugin.saveSettings();
  }
}