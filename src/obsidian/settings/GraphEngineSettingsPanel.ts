import { Setting } from 'obsidian';
import type {
  EngineModuleDescriptorV1,
  EngineModuleProfileV1,
  JsonValue,
  ModuleSettingConstraintV1,
} from '../../graph-engine/contracts/v1/index.ts';
import { GraphEngineSettingsControllerV1 } from './GraphEngineSettingsController.ts';

export const GRAPH_ENGINE_GLOBAL_PANE = 'engine:global';
export const GRAPH_PLUS_LEGACY_PANE = 'consumer:graph-plus:legacy';

export class GraphEngineSettingsPanelV1 {
  constructor(private readonly controller: GraphEngineSettingsControllerV1) {}

  addPaneSelector(
    parent: HTMLElement,
    selected: string,
    onChange: (value: string) => void,
  ): void {
    new Setting(parent)
      .setName('Settings for')
      .setDesc('Global Graph Engine defaults or one consumer profile.')
      .addDropdown((dropdown) => {
        dropdown.addOption(GRAPH_ENGINE_GLOBAL_PANE, 'Global');
        for (const profile of this.controller.listProfiles()) {
          dropdown.addOption(
            profileKey(profile.consumerId, profile.profileId),
            `${profile.consumerDisplayName} — ${profile.profileDisplayName}${profile.active ? '' : ' (inactive)'}`,
          );
        }
        dropdown.addOption(GRAPH_PLUS_LEGACY_PANE, 'Graph+ legacy controls');
        dropdown.setValue(selected);
        dropdown.onChange(onChange);
      });
  }

  render(parent: HTMLElement, selected: string, refresh: () => void): void {
    if (selected === GRAPH_ENGINE_GLOBAL_PANE) {
      this.renderGlobal(parent, refresh);
      return;
    }
    const parsed = parseProfileKey(selected);
    if (parsed) this.renderProfile(parent, parsed.consumerId, parsed.profileId, refresh);
  }

  private renderGlobal(parent: HTMLElement, refresh: () => void): void {
    parent.createEl('h3', { text: 'Global Graph Engine defaults' });
    parent.createEl('p', {
      text: 'These values are the baseline for every consumer. A consumer profile can refine or lock them.',
      cls: 'setting-item-description',
    });
    new Setting(parent).setName('Reset global settings').addButton((button) => button
      .setButtonText('Reset')
      .onClick(async () => { await this.controller.resetGlobal(); refresh(); }));
    const overrides = this.controller.getGlobalOverrides();
    for (const descriptor of this.controller.listModules()) {
      this.renderModule(parent, descriptor, undefined, {
        enabled: overrides.modules?.[descriptor.id]?.enabled,
        settings: overrides.modules?.[descriptor.id]?.settings,
        effectiveSettings: {
          ...descriptor.defaultSettings,
          ...(overrides.modules?.[descriptor.id]?.settings ?? {}),
        },
        setEnabled: async (value) => this.controller.setGlobalModuleEnabled(descriptor.id, value),
        setSetting: async (key, value) => this.controller.setGlobalModuleSetting(descriptor.id, key, value),
      }, refresh);
    }
  }

  private renderProfile(parent: HTMLElement, consumerId: string, profileId: string, refresh: () => void): void {
    const summary = this.controller.listProfiles().find((profile) => profile.consumerId === consumerId && profile.profileId === profileId);
    const descriptor = this.controller.getProfileDescriptor(consumerId, profileId);
    const effective = this.controller.getEffectiveProfile(consumerId, profileId);
    const overrides = this.controller.getProfileOverrides(consumerId, profileId);
    parent.createEl('h3', { text: `${summary?.consumerDisplayName ?? consumerId} — ${descriptor.displayName}` });
    parent.createEl('p', {
      text: summary?.active
        ? 'Registered now. Changes affect new graph sessions for this profile.'
        : 'Inactive: the consumer is not currently registered. Its settings are retained for the next registration.',
      cls: 'setting-item-description',
    });
    new Setting(parent).setName('Reset profile overrides').addButton((button) => button
      .setButtonText('Reset')
      .onClick(async () => { await this.controller.resetProfile(consumerId, profileId); refresh(); }));
    for (const [moduleId, profileModule] of Object.entries(descriptor.modules)) {
      const moduleDescriptor = this.controller.listModules().find((module) => module.id === moduleId);
      if (!moduleDescriptor) continue;
      this.renderModule(parent, moduleDescriptor, profileModule, {
        enabled: overrides.modules?.[moduleId]?.enabled,
        settings: overrides.modules?.[moduleId]?.settings,
        effectiveSettings: effective.modules[moduleId]?.settings ?? {},
        setEnabled: async (value) => this.controller.setProfileModuleEnabled(consumerId, profileId, moduleId, value),
        setSetting: async (key, value) => this.controller.setProfileModuleSetting(consumerId, profileId, moduleId, key, value),
      }, refresh);
    }
    for (const issue of effective.issues) {
      parent.createEl('p', { text: issue.message, cls: 'mod-warning' });
    }
  }

  private renderModule(
    parent: HTMLElement,
    descriptor: EngineModuleDescriptorV1,
    profile: EngineModuleProfileV1 | undefined,
    state: {
      readonly enabled?: boolean;
      readonly settings?: Readonly<Record<string, JsonValue>>;
      readonly effectiveSettings: Readonly<Record<string, JsonValue>>;
      readonly setEnabled: (value: boolean | undefined) => Promise<void>;
      readonly setSetting: (key: string, value: JsonValue | undefined) => Promise<void>;
    },
    refresh: () => void,
  ): void {
    const policy = profile?.policy;
    const enabledSetting = new Setting(parent)
      .setName(descriptor.displayName)
      .setDesc(policy === 'required' ? 'Required by the consumer author.'
        : policy === 'forbidden' ? 'Disabled by the consumer author.'
          : 'Optional Graph Engine module.');
    enabledSetting.addToggle((toggle) => {
      const fallback = profile?.defaultEnabled ?? false;
      toggle.setValue(policy === 'required' ? true : policy === 'forbidden' ? false : state.enabled ?? fallback);
      toggle.setDisabled(policy === 'required' || policy === 'forbidden');
      toggle.onChange(async (value) => { await state.setEnabled(value); refresh(); });
    });
    const keys = new Set([
      ...Object.keys(descriptor.defaultSettings),
      ...Object.keys(profile?.defaults ?? {}),
      ...Object.keys(profile?.lockedValues ?? {}),
      ...Object.keys(state.effectiveSettings),
    ]);
    for (const key of keys) {
      const constraint = profile?.constraints?.[key];
      const locked = key in (profile?.lockedValues ?? {}) || constraint?.type === 'readonly';
      this.renderValue(parent, `${descriptor.displayName}: ${humanize(key)}`, state.effectiveSettings[key], constraint, locked,
        async (value) => { await state.setSetting(key, value); refresh(); });
    }
  }

  private renderValue(
    parent: HTMLElement,
    name: string,
    value: JsonValue,
    constraint: ModuleSettingConstraintV1 | undefined,
    locked: boolean,
    save: (value: JsonValue) => Promise<void>,
  ): void {
    const setting = new Setting(parent).setName(name).setDesc(locked ? 'Locked by the consumer author.' : '');
    if (constraint?.type === 'enum') {
      setting.addDropdown((dropdown) => {
        for (const allowed of constraint.allowed) dropdown.addOption(JSON.stringify(allowed), String(allowed));
        dropdown.setValue(JSON.stringify(value));
        dropdown.setDisabled(locked);
        dropdown.onChange(async (raw) => save(JSON.parse(raw) as JsonValue));
      });
      return;
    }
    if (typeof value === 'boolean') {
      setting.addToggle((toggle) => toggle.setValue(value).setDisabled(locked).onChange(async (next) => save(next)));
      return;
    }
    setting.addText((text) => {
      text.setValue(formatValue(value));
      text.setDisabled(locked);
      text.onChange(async (raw) => {
        const parsed = parseValue(raw, value);
        if (constraint?.type === 'number' && typeof parsed === 'number') {
          await save(Math.min(constraint.max ?? parsed, Math.max(constraint.min ?? parsed, parsed)));
        } else await save(parsed);
      });
    });
  }
}

function profileKey(consumerId: string, profileId: string): string {
  return `profile:${encodeURIComponent(consumerId)}:${encodeURIComponent(profileId)}`;
}

function parseProfileKey(value: string): { consumerId: string; profileId: string } | undefined {
  const match = /^profile:([^:]+):([^:]+)$/.exec(value);
  return match ? { consumerId: decodeURIComponent(match[1]), profileId: decodeURIComponent(match[2]) } : undefined;
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatValue(value: JsonValue): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function parseValue(raw: string, previous: JsonValue): JsonValue {
  if (typeof previous === 'number') {
    const number = Number(raw);
    return Number.isFinite(number) ? number : previous;
  }
  if (typeof previous === 'string') return raw;
  try { return JSON.parse(raw) as JsonValue; } catch { return previous; }
}
