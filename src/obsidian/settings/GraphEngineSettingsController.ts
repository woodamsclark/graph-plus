import type {
  ConsumerProfileDescriptorV1,
  EngineModuleDescriptorV1,
  GraphDimensionsV1,
  GraphSettingsOverridesV1,
  JsonValue,
} from '../../graph-engine/contracts/v1/index.ts';
import {
  ConsumerProfileRegistry,
  type EffectiveConsumerProfileV1,
  type RegisteredProfileSummaryV1,
} from '../../graph-engine/core/profile/index.ts';

export class GraphEngineSettingsControllerV1 {
  constructor(
    private readonly profiles: ConsumerProfileRegistry,
    private globalOverrides: GraphSettingsOverridesV1,
    private readonly save: () => void | Promise<void>,
    private readonly dimensionControlEnabled = false,
  ) {}

  listProfiles(): readonly RegisteredProfileSummaryV1[] {
    return this.profiles.listProfiles();
  }

  listModules(): readonly EngineModuleDescriptorV1[] {
    return this.profiles.getModuleDescriptors();
  }

  getGlobalOverrides(): GraphSettingsOverridesV1 {
    return clone(this.globalOverrides);
  }

  getProfileDescriptor(consumerId: string, profileId: string): ConsumerProfileDescriptorV1 {
    return this.profiles.getProfileDescriptor(consumerId, profileId);
  }

  getEffectiveProfile(consumerId: string, profileId: string): EffectiveConsumerProfileV1 {
    return this.profiles.resolve(consumerId, profileId, { globalOverrides: this.globalOverrides });
  }

  getProfileOverrides(consumerId: string, profileId: string): GraphSettingsOverridesV1 {
    return this.profiles.getUserOverrides(consumerId, profileId);
  }

  canEditProfileDimensions(consumerId: string, profileId: string): boolean {
    const descriptor = this.profiles.getProfileDescriptor(consumerId, profileId);
    const allowed = descriptor.allowedDimensions ?? ['2d', '3d'];
    return this.dimensionControlEnabled
      && descriptor.uiDefaults?.dimensionControlVisible === true
      && allowed.length > 1;
  }

  async setProfileDimensions(
    consumerId: string,
    profileId: string,
    dimensions: GraphDimensionsV1 | undefined,
  ): Promise<void> {
    const descriptor = this.profiles.getProfileDescriptor(consumerId, profileId);
    const allowed = descriptor.allowedDimensions ?? ['2d', '3d'];
    if (dimensions !== undefined && !allowed.includes(dimensions)) {
      throw new Error(`Dimension "${dimensions}" is not permitted for ${consumerId}/${profileId}.`);
    }
    await this.transactProfile(consumerId, profileId, (current) => ({ ...current, dimensions }));
  }

  async setProfileSetting(
    consumerId: string,
    profileId: string,
    key: string,
    value: JsonValue | undefined,
  ): Promise<void> {
    await this.transactProfile(consumerId, profileId, (current) => {
      const profileSettings = { ...(current.profileSettings ?? {}) };
      if (value === undefined) delete profileSettings[key];
      else profileSettings[key] = value;
      return {
        ...current,
        profileSettings: Object.keys(profileSettings).length ? profileSettings : undefined,
      };
    });
  }

  async setGlobalModuleEnabled(moduleId: string, enabled: boolean | undefined): Promise<void> {
    await this.transactGlobal((current) => changeModule(current, moduleId, (module) => ({ ...module, enabled })));
  }

  async setGlobalModuleSetting(moduleId: string, key: string, value: JsonValue | undefined): Promise<void> {
    await this.transactGlobal((current) => changeModule(current, moduleId, (module) => ({
      ...module,
      settings: changeSetting(module.settings, key, value),
    })));
  }

  async resetGlobal(): Promise<void> {
    await this.transactGlobal(() => ({}));
  }

  async setProfileModuleEnabled(
    consumerId: string,
    profileId: string,
    moduleId: string,
    enabled: boolean | undefined,
  ): Promise<void> {
    await this.transactProfile(consumerId, profileId, (current) =>
      changeModule(current, moduleId, (module) => ({ ...module, enabled })));
  }

  async setProfileModuleSetting(
    consumerId: string,
    profileId: string,
    moduleId: string,
    key: string,
    value: JsonValue | undefined,
  ): Promise<void> {
    await this.transactProfile(consumerId, profileId, (current) => changeModule(current, moduleId, (module) => ({
      ...module,
      settings: changeSetting(module.settings, key, value),
    })));
  }

  async resetProfile(consumerId: string, profileId: string): Promise<void> {
    await this.transactProfile(consumerId, profileId, () => ({}));
  }

  private async transactGlobal(
    change: (current: GraphSettingsOverridesV1) => GraphSettingsOverridesV1,
  ): Promise<void> {
    const previous = clone(this.globalOverrides);
    this.globalOverrides = clone(change(previous));
    try {
      await this.save();
    } catch (error) {
      this.globalOverrides = previous;
      try { await this.save(); } catch {}
      throw error;
    }
  }

  private async transactProfile(
    consumerId: string,
    profileId: string,
    change: (current: GraphSettingsOverridesV1) => GraphSettingsOverridesV1,
  ): Promise<void> {
    const previous = this.profiles.getUserOverrides(consumerId, profileId);
    this.profiles.setUserOverrides(consumerId, profileId, clone(change(clone(previous))));
    try {
      await this.save();
    } catch (error) {
      this.profiles.setUserOverrides(consumerId, profileId, previous);
      try { await this.save(); } catch {}
      throw error;
    }
  }
}

function changeModule(
  overrides: GraphSettingsOverridesV1,
  moduleId: string,
  change: (module: { readonly enabled?: boolean; readonly settings?: Readonly<Record<string, JsonValue>> }) => {
    readonly enabled?: boolean;
    readonly settings?: Readonly<Record<string, JsonValue>>;
  },
): GraphSettingsOverridesV1 {
  const modules = { ...(overrides.modules ?? {}) };
  const next = change(modules[moduleId] ?? {});
  if (next.enabled === undefined && Object.keys(next.settings ?? {}).length === 0) delete modules[moduleId];
  else modules[moduleId] = next;
  return { ...clone(overrides), modules: Object.keys(modules).length > 0 ? modules : undefined };
}

function changeSetting(
  settings: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> | undefined {
  const next = { ...(settings ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
