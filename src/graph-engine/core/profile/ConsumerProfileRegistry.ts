import type {
  ConsumerProfileDescriptorV1,
  ConsumerRegistrationV1,
  EngineModuleDescriptorV1,
  EngineModuleOverrideV1,
  EngineModulePolicyV1,
  GraphDimensionsV1,
  GraphSettingsOverridesV1,
  JsonValue,
  ModuleSettingConstraintV1,
} from '../../contracts/v1/index.ts';

export interface EffectiveModuleProfileV1 {
  readonly id: string;
  readonly policy: EngineModulePolicyV1;
  readonly enabled: boolean;
  readonly settings: Readonly<Record<string, JsonValue>>;
}

export interface EffectiveConsumerProfileV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly descriptorVersion: number;
  readonly dimensions: GraphDimensionsV1;
  readonly requestedCapabilities: readonly string[];
  readonly profileSettings: Readonly<Record<string, JsonValue>>;
  readonly modules: Readonly<Record<string, EffectiveModuleProfileV1>>;
  readonly issues: readonly ProfileResolutionIssueV1[];
}

export interface ProfileResolutionIssueV1 {
  readonly code:
    | 'unknown-module'
    | 'invalid-override'
    | 'locked-setting'
    | 'missing-dependency'
    | 'module-conflict';
  readonly path: string;
  readonly message: string;
  readonly fatal: boolean;
}

export interface RegisteredProfileSummaryV1 {
  readonly consumerId: string;
  readonly consumerDisplayName: string;
  readonly profileId: string;
  readonly profileDisplayName: string;
  readonly active: boolean;
}

export interface PersistedConsumerProfileV1 {
  readonly registration: ConsumerRegistrationV1;
  readonly profileOverrides: Readonly<Record<string, GraphSettingsOverridesV1>>;
}

export interface ConsumerProfileRegistrySnapshotV1 {
  readonly schemaVersion: 1;
  readonly consumers: readonly PersistedConsumerProfileV1[];
}

interface StoredConsumer {
  registration: ConsumerRegistrationV1;
  active: boolean;
}

export class ConsumerProfileRegistry {
  private readonly modules = new Map<string, EngineModuleDescriptorV1>();
  private readonly consumers = new Map<string, StoredConsumer>();
  private readonly userOverrides = new Map<string, GraphSettingsOverridesV1>();

  registerModule(descriptor: EngineModuleDescriptorV1): void {
    validateModuleDescriptor(descriptor);
    this.modules.set(descriptor.id, cloneModuleDescriptor(descriptor));
  }

  registerConsumer(registration: ConsumerRegistrationV1): void {
    validateConsumerRegistration(registration);
    this.consumers.set(registration.consumerId, {
      registration: cloneConsumerRegistration(registration),
      active: true,
    });
  }

  markConsumerInactive(consumerId: string): void {
    const stored = this.consumers.get(consumerId);
    if (stored) stored.active = false;
  }

  deleteConsumer(consumerId: string): void {
    const stored = this.consumers.get(consumerId);
    for (const profile of stored?.registration.profiles ?? []) {
      this.userOverrides.delete(profileKey(consumerId, profile.profileId));
    }
    this.consumers.delete(consumerId);
  }

  setUserOverrides(consumerId: string, profileId: string, overrides: GraphSettingsOverridesV1): void {
    this.requireProfile(consumerId, profileId);
    validateSettingsOverrides(overrides);
    this.userOverrides.set(profileKey(consumerId, profileId), cloneOverrides(overrides));
  }

  clearUserOverrides(consumerId: string, profileId: string): void {
    this.userOverrides.delete(profileKey(consumerId, profileId));
  }

  getUserOverrides(consumerId: string, profileId: string): GraphSettingsOverridesV1 {
    this.requireProfile(consumerId, profileId);
    return cloneOverrides(this.userOverrides.get(profileKey(consumerId, profileId)) ?? {});
  }

  getProfileDescriptor(consumerId: string, profileId: string): ConsumerProfileDescriptorV1 {
    return cloneConsumerProfile(this.requireProfile(consumerId, profileId).profile);
  }

  getModuleDescriptors(): readonly EngineModuleDescriptorV1[] {
    return [...this.modules.values()].map(cloneModuleDescriptor);
  }

  exportSnapshot(): ConsumerProfileRegistrySnapshotV1 {
    return {
      schemaVersion: 1,
      consumers: [...this.consumers.values()].map(({ registration }) => ({
        registration: cloneConsumerRegistration(registration),
        profileOverrides: Object.fromEntries(registration.profiles.map((profile) => [
          profile.profileId,
          cloneOverrides(this.userOverrides.get(profileKey(registration.consumerId, profile.profileId)) ?? {}),
        ])),
      })),
    };
  }

  restoreSnapshot(snapshot: ConsumerProfileRegistrySnapshotV1): void {
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.consumers)) {
      throw new Error('Unsupported consumer profile snapshot.');
    }
    const restoredConsumers = new Map<string, StoredConsumer>();
    const restoredOverrides = new Map<string, GraphSettingsOverridesV1>();
    for (const stored of snapshot.consumers) {
      validateConsumerRegistration(stored.registration);
      if (restoredConsumers.has(stored.registration.consumerId)) {
        throw new Error(`Duplicate consumer "${stored.registration.consumerId}" in profile snapshot.`);
      }
      const registration = cloneConsumerRegistration(stored.registration);
      restoredConsumers.set(registration.consumerId, { registration, active: false });
      for (const [profileId, overrides] of Object.entries(stored.profileOverrides ?? {}) as [string, GraphSettingsOverridesV1][]) {
        if (!registration.profiles.some((profile) => profile.profileId === profileId)) {
          throw new Error(`Unknown persisted profile "${registration.consumerId}/${profileId}".`);
        }
        validateSettingsOverrides(overrides);
        restoredOverrides.set(profileKey(registration.consumerId, profileId), cloneOverrides(overrides));
      }
    }
    this.consumers.clear();
    this.userOverrides.clear();
    for (const [consumerId, stored] of restoredConsumers) this.consumers.set(consumerId, stored);
    for (const [key, overrides] of restoredOverrides) this.userOverrides.set(key, overrides);
  }

  listProfiles(): readonly RegisteredProfileSummaryV1[] {
    return [...this.consumers.values()].flatMap(({ registration, active }) =>
      registration.profiles.map((profile) => ({
        consumerId: registration.consumerId,
        consumerDisplayName: registration.displayName,
        profileId: profile.profileId,
        profileDisplayName: profile.displayName,
        active,
      })),
    );
  }

  resolve(
    consumerId: string,
    profileId: string,
    options: {
      readonly globalOverrides?: GraphSettingsOverridesV1;
      readonly sessionOverrides?: GraphSettingsOverridesV1;
    } = {},
  ): EffectiveConsumerProfileV1 {
    const { registration, profile } = this.requireProfile(consumerId, profileId);
    const global = cloneOverrides(options.globalOverrides ?? {});
    const user = cloneOverrides(this.userOverrides.get(profileKey(consumerId, profileId)) ?? {});
    const session = cloneOverrides(options.sessionOverrides ?? {});
    validateSettingsOverrides(global);
    validateSettingsOverrides(session);

    const issues: ProfileResolutionIssueV1[] = [];
    const effectiveModules: Record<string, EffectiveModuleProfileV1> = {};
    for (const [moduleId, moduleProfile] of Object.entries(profile.modules)) {
      const descriptor = this.modules.get(moduleId);
      if (!descriptor) {
        issues.push({
          code: 'unknown-module',
          path: `modules.${moduleId}`,
          message: `Profile requests unknown module "${moduleId}".`,
          fatal: moduleProfile.policy === 'required',
        });
        continue;
      }

      let enabled = resolveEnabled(
        moduleProfile.policy,
        global.modules?.[moduleId],
        moduleProfile.defaultEnabled,
        user.modules?.[moduleId],
        session.modules?.[moduleId],
        moduleId,
        issues,
      );
      if (moduleProfile.policy === 'required') enabled = true;
      if (moduleProfile.policy === 'forbidden') enabled = false;

      const settings: Record<string, JsonValue> = {
        ...cloneJsonRecord(descriptor.defaultSettings),
        ...cloneJsonRecord(global.modules?.[moduleId]?.settings ?? {}),
        ...cloneJsonRecord(moduleProfile.defaults ?? {}),
      };
      applyConstrainedSettings(settings, user.modules?.[moduleId]?.settings, moduleProfile.constraints, moduleId, 'user', issues);
      applyConstrainedSettings(settings, session.modules?.[moduleId]?.settings, moduleProfile.constraints, moduleId, 'session', issues);
      for (const [key, value] of Object.entries(moduleProfile.lockedValues ?? {})) {
        settings[key] = cloneJsonValue(value);
      }
      effectiveModules[moduleId] = {
        id: moduleId,
        policy: moduleProfile.policy,
        enabled,
        settings,
      };
    }

    reportUnknownOverrideModules(global, this.modules, 'global', issues);
    reportUnknownOverrideModules(user, this.modules, 'user', issues);
    reportUnknownOverrideModules(session, this.modules, 'session', issues);
    validateModuleGraph(effectiveModules, this.modules, issues);

    const profileSettings = {
      ...cloneJsonRecord(global.profileSettings ?? {}),
      ...cloneJsonRecord(profile.profileSettings ?? {}),
      ...cloneJsonRecord(user.profileSettings ?? {}),
      ...cloneJsonRecord(session.profileSettings ?? {}),
    };

    return {
      consumerId,
      profileId,
      displayName: profile.displayName,
      descriptorVersion: profile.descriptorVersion,
      dimensions: profile.dimensions,
      requestedCapabilities: [...profile.requestedCapabilities],
      profileSettings,
      modules: effectiveModules,
      issues,
    };
  }

  private requireProfile(
    consumerId: string,
    profileId: string,
  ): { registration: ConsumerRegistrationV1; profile: ConsumerProfileDescriptorV1 } {
    const stored = this.consumers.get(consumerId);
    if (!stored) throw new Error(`Unknown consumer "${consumerId}".`);
    const profile = stored.registration.profiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) throw new Error(`Unknown profile "${consumerId}/${profileId}".`);
    return { registration: stored.registration, profile };
  }
}

function resolveEnabled(
  policy: EngineModulePolicyV1,
  global: EngineModuleOverrideV1 | undefined,
  profileDefault: boolean | undefined,
  user: EngineModuleOverrideV1 | undefined,
  session: EngineModuleOverrideV1 | undefined,
  moduleId: string,
  issues: ProfileResolutionIssueV1[],
): boolean {
  if (policy === 'required') {
    reportForbiddenEnabledOverride(user?.enabled, true, moduleId, 'user', issues);
    reportForbiddenEnabledOverride(session?.enabled, true, moduleId, 'session', issues);
    return true;
  }
  if (policy === 'forbidden') {
    reportForbiddenEnabledOverride(user?.enabled, false, moduleId, 'user', issues);
    reportForbiddenEnabledOverride(session?.enabled, false, moduleId, 'session', issues);
    return false;
  }
  return session?.enabled ?? user?.enabled ?? profileDefault ?? global?.enabled ?? false;
}

function reportForbiddenEnabledOverride(
  requested: boolean | undefined,
  requiredValue: boolean,
  moduleId: string,
  layer: string,
  issues: ProfileResolutionIssueV1[],
): void {
  if (requested === undefined || requested === requiredValue) return;
  issues.push({
    code: 'invalid-override',
    path: `${layer}.modules.${moduleId}.enabled`,
    message: `Module policy locks enabled to ${String(requiredValue)}.`,
    fatal: false,
  });
}

function applyConstrainedSettings(
  target: Record<string, JsonValue>,
  source: Readonly<Record<string, JsonValue>> | undefined,
  constraints: Readonly<Record<string, ModuleSettingConstraintV1>> | undefined,
  moduleId: string,
  layer: string,
  issues: ProfileResolutionIssueV1[],
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    const constraint = constraints?.[key];
    if (constraint?.type === 'readonly') {
      issues.push({
        code: 'locked-setting',
        path: `${layer}.modules.${moduleId}.settings.${key}`,
        message: `Setting "${key}" is read-only for this profile.`,
        fatal: false,
      });
      continue;
    }
    if (constraint?.type === 'number'
      && (typeof value !== 'number'
        || (constraint.min !== undefined && value < constraint.min)
        || (constraint.max !== undefined && value > constraint.max))) {
      issues.push(invalidSetting(moduleId, key, layer, 'outside the permitted numeric range'));
      continue;
    }
    if (constraint?.type === 'enum' && !constraint.allowed.some((allowed) => jsonEqual(allowed, value))) {
      issues.push(invalidSetting(moduleId, key, layer, 'outside the permitted values'));
      continue;
    }
    target[key] = cloneJsonValue(value);
  }
}

function validateModuleGraph(
  effective: Readonly<Record<string, EffectiveModuleProfileV1>>,
  descriptors: ReadonlyMap<string, EngineModuleDescriptorV1>,
  issues: ProfileResolutionIssueV1[],
): void {
  for (const module of Object.values(effective)) {
    if (!module.enabled) continue;
    const descriptor = descriptors.get(module.id);
    if (!descriptor) continue;
    for (const dependency of descriptor.dependencies ?? []) {
      if (!effective[dependency]?.enabled) {
        issues.push({
          code: 'missing-dependency',
          path: `modules.${module.id}`,
          message: `Enabled module "${module.id}" requires "${dependency}".`,
          fatal: true,
        });
      }
    }
    for (const conflict of descriptor.conflicts ?? []) {
      if (effective[conflict]?.enabled) {
        issues.push({
          code: 'module-conflict',
          path: `modules.${module.id}`,
          message: `Enabled module "${module.id}" conflicts with "${conflict}".`,
          fatal: true,
        });
      }
    }
  }
  const enabledIds = Object.values(effective).filter((module) => module.enabled).map((module) => module.id).sort();
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  let cycleReported = false;
  const visit = (moduleId: string): void => {
    if (complete.has(moduleId) || cycleReported) return;
    if (visiting.has(moduleId)) {
      const start = path.indexOf(moduleId);
      const cycle = [...path.slice(Math.max(0, start)), moduleId];
      issues.push({
        code: 'module-conflict',
        path: `modules.${moduleId}`,
        message: `Enabled module dependency cycle: ${cycle.join(' -> ')}.`,
        fatal: true,
      });
      cycleReported = true;
      return;
    }
    visiting.add(moduleId);
    path.push(moduleId);
    for (const dependency of descriptors.get(moduleId)?.dependencies ?? []) {
      if (effective[dependency]?.enabled) visit(dependency);
    }
    path.pop();
    visiting.delete(moduleId);
    complete.add(moduleId);
  };
  for (const moduleId of enabledIds) visit(moduleId);
}

function reportUnknownOverrideModules(
  overrides: GraphSettingsOverridesV1,
  descriptors: ReadonlyMap<string, EngineModuleDescriptorV1>,
  layer: string,
  issues: ProfileResolutionIssueV1[],
): void {
  for (const moduleId of Object.keys(overrides.modules ?? {})) {
    if (!descriptors.has(moduleId)) {
      issues.push({
        code: 'unknown-module',
        path: `${layer}.modules.${moduleId}`,
        message: `Override targets unknown module "${moduleId}".`,
        fatal: false,
      });
    }
  }
}

function invalidSetting(moduleId: string, key: string, layer: string, reason: string): ProfileResolutionIssueV1 {
  return {
    code: 'invalid-override',
    path: `${layer}.modules.${moduleId}.settings.${key}`,
    message: `Setting "${key}" is ${reason}.`,
    fatal: false,
  };
}

function validateModuleDescriptor(descriptor: EngineModuleDescriptorV1): void {
  requireId(descriptor.id, 'module id');
  requireId(descriptor.version, 'module version');
  requireId(descriptor.displayName, 'module display name');
  if (!Number.isSafeInteger(descriptor.settingsSchemaVersion) || descriptor.settingsSchemaVersion < 0) {
    throw new Error('Module settings schema version must be a non-negative safe integer.');
  }
  validateStringArray(descriptor.capabilities, 'module capabilities');
  validateStringArray(descriptor.dependencies ?? [], 'module dependencies');
  validateStringArray(descriptor.conflicts ?? [], 'module conflicts');
  cloneJsonRecord(descriptor.defaultSettings);
}

function validateConsumerRegistration(registration: ConsumerRegistrationV1): void {
  requireId(registration.consumerId, 'consumer id');
  requireId(registration.displayName, 'consumer display name');
  requireId(registration.consumerVersion, 'consumer version');
  if (!registration.supportedProtocolVersions.includes(1)) throw new Error('Consumer must support protocol version 1.');
  if (registration.supportedProtocolVersions.some((version) => !Number.isSafeInteger(version) || version < 1)) {
    throw new Error('Supported protocol versions must be positive safe integers.');
  }
  const profileIds = new Set<string>();
  for (const profile of registration.profiles) {
    requireId(profile.profileId, 'profile id');
    requireId(profile.displayName, 'profile display name');
    if (profileIds.has(profile.profileId)) throw new Error(`Duplicate profile "${profile.profileId}".`);
    profileIds.add(profile.profileId);
    if (!Number.isSafeInteger(profile.descriptorVersion) || profile.descriptorVersion < 0) {
      throw new Error('Profile descriptor version must be a non-negative safe integer.');
    }
    validateStringArray(profile.requestedCapabilities, 'requested capabilities');
    cloneJsonRecord(profile.profileSettings ?? {});
    for (const [moduleId, module] of Object.entries(profile.modules)) {
      requireId(moduleId, 'profile module id');
      if (module.policy !== 'required' && module.policy !== 'optional' && module.policy !== 'forbidden') {
        throw new Error(`Invalid policy for module "${moduleId}".`);
      }
      if (module.defaultEnabled !== undefined && typeof module.defaultEnabled !== 'boolean') {
        throw new Error(`Default enabled value for module "${moduleId}" must be boolean.`);
      }
      cloneJsonRecord(module.defaults ?? {});
      cloneJsonRecord(module.lockedValues ?? {});
      for (const [setting, constraint] of Object.entries(module.constraints ?? {})) {
        validateConstraint(moduleId, setting, constraint);
      }
    }
  }
}

function validateConstraint(moduleId: string, setting: string, constraint: ModuleSettingConstraintV1): void {
  if (constraint.type === 'readonly') return;
  if (constraint.type === 'enum') {
    if (!Array.isArray(constraint.allowed)) throw new Error(`Enum constraint for "${moduleId}.${setting}" needs allowed values.`);
    constraint.allowed.forEach(cloneJsonValue);
    return;
  }
  if (constraint.type === 'number') {
    if (constraint.min !== undefined && !Number.isFinite(constraint.min)) throw new Error(`Invalid minimum for "${moduleId}.${setting}".`);
    if (constraint.max !== undefined && !Number.isFinite(constraint.max)) throw new Error(`Invalid maximum for "${moduleId}.${setting}".`);
    if (constraint.min !== undefined && constraint.max !== undefined && constraint.min > constraint.max) {
      throw new Error(`Minimum exceeds maximum for "${moduleId}.${setting}".`);
    }
    return;
  }
  throw new Error(`Unknown constraint for "${moduleId}.${setting}".`);
}

function validateSettingsOverrides(overrides: GraphSettingsOverridesV1): void {
  cloneJsonRecord(overrides.profileSettings ?? {});
  for (const module of Object.values(overrides.modules ?? {})) {
    if (module.enabled !== undefined && typeof module.enabled !== 'boolean') throw new Error('Module enabled override must be boolean.');
    cloneJsonRecord(module.settings ?? {});
  }
}

function cloneModuleDescriptor(descriptor: EngineModuleDescriptorV1): EngineModuleDescriptorV1 {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    dependencies: descriptor.dependencies ? [...descriptor.dependencies] : undefined,
    conflicts: descriptor.conflicts ? [...descriptor.conflicts] : undefined,
    defaultSettings: cloneJsonRecord(descriptor.defaultSettings),
  };
}

function cloneConsumerRegistration(registration: ConsumerRegistrationV1): ConsumerRegistrationV1 {
  return {
    ...registration,
    supportedProtocolVersions: [...registration.supportedProtocolVersions],
    profiles: registration.profiles.map(cloneConsumerProfile),
  };
}

function cloneConsumerProfile(profile: ConsumerProfileDescriptorV1): ConsumerProfileDescriptorV1 {
  return {
    ...profile,
    requestedCapabilities: [...profile.requestedCapabilities],
    profileSettings: profile.profileSettings ? cloneJsonRecord(profile.profileSettings) : undefined,
    modules: Object.fromEntries(Object.entries(profile.modules).map(([moduleId, module]) => [moduleId, {
      ...module,
      defaults: module.defaults ? cloneJsonRecord(module.defaults) : undefined,
      constraints: module.constraints
        ? Object.fromEntries(Object.entries(module.constraints).map(([key, constraint]) => [key, cloneConstraint(constraint)]))
        : undefined,
      lockedValues: module.lockedValues ? cloneJsonRecord(module.lockedValues) : undefined,
    }])),
  };
}

function cloneOverrides(overrides: GraphSettingsOverridesV1): GraphSettingsOverridesV1 {
  return {
    profileSettings: overrides.profileSettings ? cloneJsonRecord(overrides.profileSettings) : undefined,
    modules: overrides.modules
      ? Object.fromEntries(Object.entries(overrides.modules).map(([moduleId, module]) => [moduleId, {
          enabled: module.enabled,
          settings: module.settings ? cloneJsonRecord(module.settings) : undefined,
        }]))
      : undefined,
  };
}

function cloneJsonRecord(record: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cloneJsonValue(value)]));
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (!isJsonValue(value)) throw new Error('Settings values must be finite JSON values.');
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === 'object') return cloneJsonRecord(value as Readonly<Record<string, JsonValue>>);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON numbers must be finite.');
  return value;
}

function cloneConstraint(constraint: ModuleSettingConstraintV1): ModuleSettingConstraintV1 {
  if (constraint.type === 'enum') return { type: 'enum', allowed: constraint.allowed.map(cloneJsonValue) };
  return { ...constraint };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function profileKey(consumerId: string, profileId: string): string {
  return JSON.stringify([consumerId, profileId]);
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function validateStringArray(value: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`${label} must contain non-empty strings.`);
  }
}
