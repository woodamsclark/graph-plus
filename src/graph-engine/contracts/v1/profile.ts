import type { GraphDimensionsV1 } from './view-state.ts';
import type { JsonValue } from './values.ts';

export type EngineModulePolicyV1 = 'required' | 'optional' | 'forbidden';

export interface EngineModuleDescriptorV1 {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly dependencies?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly settingsSchemaVersion: number;
  readonly defaultSettings: Readonly<Record<string, JsonValue>>;
}

export interface EngineModuleProfileV1 {
  readonly policy: EngineModulePolicyV1;
  readonly defaultEnabled?: boolean;
  readonly defaults?: Readonly<Record<string, JsonValue>>;
  readonly constraints?: Readonly<Record<string, ModuleSettingConstraintV1>>;
  readonly lockedValues?: Readonly<Record<string, JsonValue>>;
}

export type ModuleSettingConstraintV1 =
  | { readonly type: 'enum'; readonly allowed: readonly JsonValue[] }
  | { readonly type: 'number'; readonly min?: number; readonly max?: number }
  | { readonly type: 'readonly' };

export interface ConsumerRegistrationV1 {
  readonly consumerId: string;
  readonly displayName: string;
  readonly consumerVersion: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly profiles: readonly ConsumerProfileDescriptorV1[];
}

export interface ConsumerProfileDescriptorV1 {
  readonly profileId: string;
  readonly displayName: string;
  readonly descriptorVersion: number;
  readonly dimensions: GraphDimensionsV1;
  readonly requestedCapabilities: readonly string[];
  readonly modules: Readonly<Record<string, EngineModuleProfileV1>>;
  readonly profileSettings?: Readonly<Record<string, JsonValue>>;
}

export interface EngineModuleOverrideV1 {
  readonly enabled?: boolean;
  readonly settings?: Readonly<Record<string, JsonValue>>;
}

export interface GraphSettingsOverridesV1 {
  readonly profileSettings?: Readonly<Record<string, JsonValue>>;
  readonly modules?: Readonly<Record<string, EngineModuleOverrideV1>>;
}
