import {
  getSettingsSchema,
  getSettingsFieldContext,
  type FieldDescriptor,
  type SliderField,
  type ToggleField,
  type ColorField,
  type TextField,
  type SectionDescriptor,
} from '../../obsidian/settings/settingsSchema.ts';

import type { GraphPlusSettings } from '../grammar/interfaces.ts';
import { getSettings, updateSettings } from '../../obsidian/settings/settingsStore.ts';

type OverlayDeps = {
  getContainer: () => HTMLElement;
  onSettingsApplied?: (mode: 'live' | 'rebuild') => Promise<void> | void;
};

export class LiveSettingsOverlay {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private mounted = false;
  private collapsed = false;

  constructor(private deps: OverlayDeps) {}

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    const root = document.createElement('div');
    root.className = 'graphplus-live-settings-overlay';
    this.applyRootStyles(root);

    const header = document.createElement('div');
    header.textContent = 'Graph+ Settings';
    header.style.fontWeight = '600';
    header.style.padding = '8px 10px';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const headerButtons = document.createElement('div');
    headerButtons.style.display = 'flex';
    headerButtons.style.gap = '6px';

    const collapseBtn = this.makeButton('–', () => {
      this.collapsed = !this.collapsed;
      if (this.body) {
        this.body.style.display = this.collapsed ? 'none' : 'block';
      }
    });

    const refreshBtn = this.makeButton('↻', () => {
      this.renderBody();
    });

    headerButtons.appendChild(refreshBtn);
    headerButtons.appendChild(collapseBtn);
    header.appendChild(headerButtons);

    const body = document.createElement('div');
    body.style.padding = '8px 10px';
    body.style.overflow = 'auto';
    body.style.maxHeight = 'calc(100vh - 110px)';

    root.appendChild(header);
    root.appendChild(body);

    this.root = root;
    this.body = body;

    this.renderBody();
    this.deps.getContainer().appendChild(root);
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
    this.body = null;
    this.mounted = false;
  }

  toggle(): void {
    if (!this.root) return;
    this.root.style.display = this.root.style.display === 'none' ? 'block' : 'none';
  }

  private renderBody(): void {
    if (!this.body) return;
    this.body.empty();

    const settings = getSettings();
    const ctx = getSettingsFieldContext(settings);

    for (const section of getSettingsSchema()) {
      this.renderSection(this.body, section, ctx.settings);
    }
  }

  private renderSection(parent: HTMLElement, section: SectionDescriptor, settings: GraphPlusSettings): void {
    const ctx = getSettingsFieldContext(settings);

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '12px';
    wrapper.style.paddingBottom = '12px';
    wrapper.style.borderBottom = '1px solid rgba(255,255,255,0.08)';

    const title = document.createElement('div');
    title.textContent = section.title;
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    wrapper.appendChild(title);

    for (const field of section.fields) {
      if (field.visible && !field.visible(ctx)) continue;
      this.renderField(wrapper, field, settings);
    }

    parent.appendChild(wrapper);
  }

  private renderField(parent: HTMLElement, field: FieldDescriptor, settings: GraphPlusSettings): void {
    switch (field.kind) {
      case 'slider':
        this.renderSliderField(parent, field, settings);
        return;
      case 'toggle':
        this.renderToggleField(parent, field, settings);
        return;
      case 'color':
        this.renderColorField(parent, field, settings);
        return;
      case 'text':
        this.renderTextField(parent, field, settings);
        return;
    }
  }

  private renderSliderField(parent: HTMLElement, field: SliderField, settings: GraphPlusSettings): void {
    const ctx = getSettingsFieldContext(settings);
    const currentValue = field.get(settings);
    const uiValue = field.toUi ? field.toUi(currentValue, ctx) : currentValue;

    const row = this.makeFieldRow(field.name, field.desc, field.updateMode);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';

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
    numberInput.style.width = '72px';

    const reset = this.makeButton('↺', async () => {
      const defaults = getSettingsFieldContext(getSettings()).defaults;
      const defaultValue = field.getDefault(defaults);
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, defaultValue);
      });
      this.renderBody();
    });

    const syncUi = (value: string) => {
      range.value = value;
      numberInput.value = value;
    };

    const commit = async (raw: number) => {
      if (Number.isNaN(raw)) return;
      const clampedUi = field.clamp ? field.clamp(raw) : raw;
      const resolved = field.fromUi ? field.fromUi(clampedUi, getSettingsFieldContext(getSettings())) : clampedUi;
      syncUi(String(clampedUi));

      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, resolved);
      });
    };

    range.addEventListener('input', async (e) => {
      const raw = Number((e.target as HTMLInputElement).value);
      syncUi(String(raw));
      await commit(raw);
    });

    numberInput.addEventListener('change', async (e) => {
      const raw = Number((e.target as HTMLInputElement).value);
      await commit(raw);
    });

    controls.appendChild(range);
    controls.appendChild(numberInput);
    controls.appendChild(reset);
    row.appendChild(controls);
    parent.appendChild(row);
  }

  private renderToggleField(parent: HTMLElement, field: ToggleField, settings: GraphPlusSettings): void {
    const row = this.makeFieldRow(field.name, field.desc, field.updateMode);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'space-between';
    controls.style.alignItems = 'center';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = field.get(settings);

    const reset = this.makeButton('↺', async () => {
      const defaults = getSettingsFieldContext(getSettings()).defaults;
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, field.getDefault(defaults));
      });
      this.renderBody();
    });

    toggle.addEventListener('change', async () => {
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, toggle.checked);
      });
    });

    controls.appendChild(toggle);
    controls.appendChild(reset);
    row.appendChild(controls);
    parent.appendChild(row);
  }

  private renderColorField(parent: HTMLElement, field: ColorField, settings: GraphPlusSettings): void {
    const row = this.makeFieldRow(field.name, field.desc, field.updateMode);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = field.get(settings) ?? field.fallback ?? '#000000';

    const clearBtn = this.makeButton('Clear', async () => {
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, undefined);
      });
      this.renderBody();
    });

    const resetBtn = this.makeButton('↺', async () => {
      const defaults = getSettingsFieldContext(getSettings()).defaults;
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, field.getDefault(defaults));
      });
      this.renderBody();
    });

    colorInput.addEventListener('input', async () => {
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, colorInput.value);
      });
    });

    controls.appendChild(colorInput);
    controls.appendChild(clearBtn);
    controls.appendChild(resetBtn);
    row.appendChild(controls);
    parent.appendChild(row);
  }

  private renderTextField(parent: HTMLElement, field: TextField, settings: GraphPlusSettings): void {
    const row = this.makeFieldRow(field.name, field.desc, field.updateMode);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.get(settings);
    input.placeholder = field.placeholder ?? '';
    input.style.flex = '1';

    const resetBtn = this.makeButton('↺', async () => {
      const defaults = getSettingsFieldContext(getSettings()).defaults;
      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, field.getDefault(defaults));
      });
      this.renderBody();
    });

    input.addEventListener('change', async () => {
      const next = field.parse
        ? field.parse(input.value, getSettingsFieldContext(getSettings()))
        : input.value;

      await this.applyFieldChange(field.updateMode ?? 'live', (s) => {
        field.set(s, next);
      });
    });

    controls.appendChild(input);
    controls.appendChild(resetBtn);
    row.appendChild(controls);
    parent.appendChild(row);
  }

  private async applyFieldChange(
    mode: 'live' | 'rebuild',
    mutator: (s: GraphPlusSettings) => void,
  ): Promise<void> {
    updateSettings(mutator);
    await this.deps.onSettingsApplied?.(mode);
  }

  private makeFieldRow(name: string, desc?: string, mode?: 'live' | 'rebuild'): HTMLDivElement {
    const row = document.createElement('div');
    row.style.marginBottom = '10px';

    const label = document.createElement('div');
    label.style.display = 'flex';
    label.style.justifyContent = 'space-between';
    label.style.alignItems = 'center';
    label.style.marginBottom = '4px';

    const title = document.createElement('div');
    title.textContent = name;
    title.style.fontSize = '12px';
    title.style.fontWeight = '600';

    const badge = document.createElement('div');
    badge.textContent = mode ?? 'live';
    badge.style.fontSize = '10px';
    badge.style.opacity = '0.7';

    label.appendChild(title);
    label.appendChild(badge);

    row.appendChild(label);

    if (desc) {
      const descEl = document.createElement('div');
      descEl.textContent = desc;
      descEl.style.fontSize = '11px';
      descEl.style.opacity = '0.75';
      descEl.style.marginBottom = '6px';
      row.appendChild(descEl);
    }

    return row;
  }

  private makeButton(text: string, onClick: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cursor = 'pointer';
    button.style.fontSize = '11px';
    button.style.padding = '2px 6px';

    button.addEventListener('click', async () => {
      await onClick();
    });

    return button;
  }

  private applyRootStyles(el: HTMLDivElement): void {
    el.style.position = 'absolute';
    el.style.top = '12px';
    el.style.right = '12px';
    el.style.width = '320px';
    el.style.maxWidth = 'calc(100% - 24px)';
    el.style.zIndex = '1000';
    el.style.background = 'rgba(20, 20, 20, 0.92)';
    el.style.backdropFilter = 'blur(8px)';
    el.style.color = 'var(--text-normal)';
    el.style.border = '1px solid rgba(255,255,255,0.10)';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
    el.style.fontSize = '12px';
    el.style.pointerEvents = 'auto';
  }
}