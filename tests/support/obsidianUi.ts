export * from './obsidianSearch.ts';

// The global settings renderer imports the profile modal without opening it.
export class Modal {}

// Minimal host widgets for exercising the real Quick Settings slider event wiring.
// Obsidian owns their native styling and tooltips in the installed plugin.
class Slider {
  readonly sliderEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.sliderEl = parent.ownerDocument.createElement('input');
    this.sliderEl.type = 'range';
    parent.append(this.sliderEl);
  }
  setLimits(min: number, max: number, step: number) {
    this.sliderEl.min = String(min); this.sliderEl.max = String(max); this.sliderEl.step = String(step);
    return this;
  }
  setValue(value: number) { this.sliderEl.value = String(value); return this; }
  getValue() { return Number(this.sliderEl.value); }
  setDynamicTooltip() { return this; }
  setDisabled(value: boolean) { this.sliderEl.disabled = value; return this; }
  onChange(callback: (value: number) => void | Promise<void>) {
    this.sliderEl.addEventListener('change', () => { void callback(this.getValue()); }); return this;
  }
}

class Toggle {
  readonly toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.toggleEl = parent.ownerDocument.createElement('input'); this.toggleEl.type = 'checkbox'; parent.append(this.toggleEl);
  }
  setValue(value: boolean) { this.toggleEl.checked = value; return this; }
  setDisabled(value: boolean) { this.toggleEl.disabled = value; return this; }
  onChange(callback: (value: boolean) => void | Promise<void>) {
    this.toggleEl.addEventListener('change', () => { void callback(this.toggleEl.checked); }); return this;
  }
}

class Dropdown {
  readonly selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) { this.selectEl = parent.ownerDocument.createElement('select'); parent.append(this.selectEl); }
  addOptions(options: Record<string, string>) {
    for (const [value, label] of Object.entries(options)) { const option = this.selectEl.ownerDocument.createElement('option'); option.value = value; option.textContent = label; this.selectEl.append(option); } return this;
  }
  setValue(value: string) { this.selectEl.value = value; return this; }
  setDisabled(value: boolean) { this.selectEl.disabled = value; return this; }
  onChange(callback: (value: string) => void | Promise<void>) {
    this.selectEl.addEventListener('change', () => { void callback(this.selectEl.value); }); return this;
  }
}

class ExtraButton {
  readonly extraSettingsEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.extraSettingsEl = parent.ownerDocument.createElement('button');
    parent.append(this.extraSettingsEl);
  }
  setIcon(icon: string) { this.extraSettingsEl.dataset.icon = icon; return this; }
  setTooltip(text: string) { this.extraSettingsEl.setAttribute('aria-label', text); return this; }
  onClick(callback: () => void | Promise<void>) {
    this.extraSettingsEl.addEventListener('click', () => { void callback(); }); return this;
  }
}

export class Setting {
  readonly settingEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.ownerDocument.createElement('div');
    parent.append(this.settingEl);
  }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
  setName(name: string) { this.settingEl.dataset.name = name; return this; }
  setDesc(description: string) { this.settingEl.dataset.description = description; return this; }
  addSlider(callback: (slider: Slider) => void) { callback(new Slider(this.settingEl)); return this; }
  addToggle(callback: (toggle: Toggle) => void) { callback(new Toggle(this.settingEl)); return this; }
  addDropdown(callback: (dropdown: Dropdown) => void) { callback(new Dropdown(this.settingEl)); return this; }
  addExtraButton(callback: (button: ExtraButton) => void) { callback(new ExtraButton(this.settingEl)); return this; }
}

export function setIcon(element: HTMLElement, icon: string): void { element.dataset.icon = icon; }

export class Notice {
  constructor(readonly message: string) {}
}
