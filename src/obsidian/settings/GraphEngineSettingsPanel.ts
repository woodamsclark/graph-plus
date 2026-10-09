import { App, Modal, Setting } from 'obsidian';
import type { GraphDimensionsV1, GraphSettingSourceV1, JsonValue } from '../../graph-engine/contracts/v1/index.ts';
import { GraphEngineSettingsControllerV1 } from './GraphEngineSettingsController.ts';
import {
  GRAPH_SETTING_PRESENTATIONS_V1,
  graphSettingDisplayValueV1,
  graphSettingStoredValueV1,
  type GraphSettingCategoryV1,
  type GraphSettingPresentationV1,
} from './GraphEngineSettingsCatalog.ts';
import { preserveSettingsScrollV1 } from './SettingsScroll.ts';

const CATEGORY_TITLES: Readonly<Record<GraphSettingCategoryV1, string>> = {
  appearance: 'Appearance',
  'layout-motion': 'Layout and motion',
};

export class GraphEngineSettingsPanelV1 {
  constructor(private readonly controller: GraphEngineSettingsControllerV1) {}

  renderGlobal(parent: HTMLElement, refresh: () => void): void {
    for (const category of ['appearance', 'layout-motion'] as const) {
      parent.createEl('h3', { text: CATEGORY_TITLES[category] });
      for (const presentation of presentations(category, 'global')) {
        const profiles = this.controller.listProfiles();
        if (profiles.length && profiles.every(profile => this.controller
          .getProfileDescriptor(profile.consumerId, profile.profileId).modules[presentation.moduleId]?.policy === 'forbidden')) continue;
        const descriptor = this.controller.listModules().find((module) => module.id === presentation.moduleId);
        if (!descriptor) continue;
        const override = this.controller.getGlobalOverrides().modules?.[presentation.moduleId]?.settings?.[presentation.key];
        const value = override ?? descriptor.defaultSettings[presentation.key];
        renderCatalogSetting(parent, presentation, value, override !== undefined, {
          source: override === undefined ? 'Engine default' : 'Global override',
          save: async (next) => {
            await this.controller.setGlobalModuleSetting(presentation.moduleId, presentation.key, next);
            refresh();
          },
        });
      }
    }
  }

  renderProfiles(parent: HTMLElement, app: App, refresh: () => void): void {
    parent.createEl('h3', { text: 'Profiles' });
    parent.createEl('p', {
      text: 'Profiles inherit these settings and keep only their intentional differences.',
      cls: 'setting-item-description',
    });
    for (const profile of this.controller.listProfiles()) {
      new Setting(parent)
        .setName(`${profile.consumerDisplayName} — ${profile.profileDisplayName}`)
        .setDesc(profile.active ? 'Active' : 'Available when its consumer is active')
        .addButton((button) => button
          .setButtonText('Customize…')
          .onClick(() => new GraphEngineProfileSettingsModalV1(
            app,
            this.controller,
            profile.consumerId,
            profile.profileId,
            refresh,
          ).open()));
    }
  }
}

class GraphEngineProfileSettingsModalV1 extends Modal {
  constructor(
    app: App,
    private readonly controller: GraphEngineSettingsControllerV1,
    private readonly consumerId: string,
    private readonly profileId: string,
    private readonly onChanged: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.onChanged();
  }

  private render(): void {
    const content = this.contentEl;
    preserveSettingsScrollV1(content, () => {
      content.empty();
      const summary = this.controller.listProfiles().find((profile) =>
        profile.consumerId === this.consumerId && profile.profileId === this.profileId);
      const descriptor = this.controller.getProfileDescriptor(this.consumerId, this.profileId);
      const effective = this.controller.getEffectiveProfile(this.consumerId, this.profileId);
      const overrides = this.controller.getProfileOverrides(this.consumerId, this.profileId);
      content.createEl('h2', { text: `${summary?.consumerDisplayName ?? this.consumerId} — ${descriptor.displayName}` });
      content.createEl('p', {
        text: 'Only values changed here override the global graph settings.',
        cls: 'setting-item-description',
      });

      if (this.controller.canEditProfileDimensions(this.consumerId, this.profileId)) {
        const dimensionsOverridden = overrides.dimensions !== undefined;
        const setting = new Setting(content)
          .setName('Graph dimensions')
          .setDesc(dimensionsOverridden ? 'Profile override' : sourceLabel(effective.dimensionsSource));
        setting.addDropdown((dropdown) => {
          for (const dimensions of descriptor.allowedDimensions ?? ['2d', '3d']) {
            dropdown.addOption(dimensions, dimensions === '2d' ? '2D' : '3D');
          }
          dropdown.setValue(effective.dimensions).onChange(async (value) => {
            await this.controller.setProfileDimensions(
              this.consumerId,
              this.profileId,
              value as GraphDimensionsV1,
            );
            this.render();
          });
        });
        if (dimensionsOverridden) setting.addExtraButton((button) => button
          .setIcon('rotate-ccw')
          .setTooltip('Use inherited value')
          .onClick(async () => {
            await this.controller.setProfileDimensions(this.consumerId, this.profileId, undefined);
            this.render();
          }));
      }

      new Setting(content)
        .setName('Profile overrides')
        .setDesc('Return every customized value in this profile to its inherited value.')
        .addButton((button) => button.setButtonText('Reset all').onClick(async () => {
          await this.controller.resetProfile(this.consumerId, this.profileId);
          this.render();
        }));

      for (const category of ['appearance', 'layout-motion'] as const) {
        const values = presentations(category, 'profile').filter((presentation) => descriptor.modules[presentation.moduleId]
          && descriptor.modules[presentation.moduleId].policy !== 'forbidden');
        if (values.length === 0) continue;
        content.createEl('h3', { text: CATEGORY_TITLES[category] });
        for (const presentation of values) {
          const moduleProfile = descriptor.modules[presentation.moduleId];
          const locked = moduleProfile?.lockedValues?.[presentation.key] !== undefined
            || moduleProfile?.constraints?.[presentation.key]?.type === 'readonly';
          const override = overrides.modules?.[presentation.moduleId]?.settings?.[presentation.key];
          const module = effective.modules[presentation.moduleId];
          if (!module || module.settings[presentation.key] === undefined) continue;
          renderCatalogSetting(content, presentation, module.settings[presentation.key], override !== undefined, {
            locked,
            source: locked ? 'Locked by consumer' : sourceLabel(module.settingSources[presentation.key]),
            save: async (next) => {
              await this.controller.setProfileModuleSetting(
                this.consumerId,
                this.profileId,
                presentation.moduleId,
                presentation.key,
                next,
              );
              this.render();
            },
          });
        }
      }
      for (const issue of effective.issues) content.createEl('p', { text: issue.message, cls: 'mod-warning' });
    });
  }
}

function presentations(category: GraphSettingCategoryV1, scope: 'global' | 'profile') {
  return GRAPH_SETTING_PRESENTATIONS_V1.filter((value) => value.category === category && value.scopes.includes(scope));
}

function renderCatalogSetting(
  parent: HTMLElement,
  presentation: GraphSettingPresentationV1,
  rawValue: JsonValue | undefined,
  overridden: boolean,
  options: {
    readonly source: string;
    readonly locked?: boolean;
    readonly save: (value: JsonValue | undefined) => Promise<void>;
  },
): void {
  const { control } = presentation;
  const displayValue = graphSettingDisplayValueV1(presentation, rawValue);
  const setting = new Setting(parent)
    .setName(presentation.name)
    .setDesc(`${presentation.description} ${options.source}.`);
  if (control.type === 'toggle') {
    setting.addToggle((toggle) => toggle
      .setValue(displayValue === true)
      .setDisabled(options.locked === true)
      .onChange(async (value) => options.save(value)));
  } else if (control.type === 'select') {
    setting.addDropdown((dropdown) => dropdown
      .addOptions(control.options)
      .setValue(typeof displayValue === 'string' ? displayValue : Object.keys(control.options)[0] ?? '')
      .setDisabled(options.locked === true)
      .onChange(async (value) => options.save(value)));
  } else {
    const value = typeof displayValue === 'number' && Number.isFinite(displayValue)
      ? displayValue
      : control.min;
    setting.settingEl.classList.add('graph-engine-slider-setting');
    setting.addSlider((slider) => slider
      .setLimits(control.min, control.max, control.step)
      .setValue(value)
      .setDynamicTooltip()
      .setDisabled(options.locked === true)
      .onChange(async (next) => options.save(graphSettingStoredValueV1(presentation, next))));
  }
  if (overridden && !options.locked) setting.addExtraButton((button) => button
    .setIcon('rotate-ccw')
    .setTooltip('Use inherited value')
    .onClick(async () => options.save(undefined)));
}

function sourceLabel(source: GraphSettingSourceV1 | undefined): string {
  switch (source) {
    case 'global': return 'Inherited from Global';
    case 'consumer-profile': return 'Consumer default';
    case 'user-profile': return 'Profile override';
    case 'session': return 'Current session override';
    case 'locked': return 'Locked by consumer';
    default: return 'Engine default';
  }
}
