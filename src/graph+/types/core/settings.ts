import type { ModuleLifecycle, Rebuildable } from './lifecycle.ts';
import type { ModuleSettingsKey, SettingsFor } from './registry.ts';

export interface SettingsAware<K extends ModuleSettingsKey> {
  updateSettings(settings: SettingsFor<K>): void;
}

export interface ModuleWithSettings<K extends ModuleSettingsKey>
  extends 
    ModuleLifecycle,
    SettingsAware<K>,
    Rebuildable {}