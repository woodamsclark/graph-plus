/**
 * Open registry for module settings contracts.
 * Other modules can augment this via declaration merging.
 */
export interface ModuleSettingsRegistry {}

/**
 * Keys are contributed by core and by external modules.
 */
export type ModuleSettingsKey = keyof ModuleSettingsRegistry;

/**
 * Resolve the settings type for a given module key.
 */
export type SettingsFor<K extends ModuleSettingsKey> = ModuleSettingsRegistry[K];