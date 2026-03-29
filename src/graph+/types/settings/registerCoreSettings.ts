import type { ModuleSettingsRegistry } from '../core/registry.ts';
import type {
  GraphModuleSettings,
  PhysicsModuleSettings,
  UIInterpreterModuleSettings,
  RenderComposerSettings,
  InputModuleSettings,
  CameraModuleSettings,
  AnimaModuleSettings,
} from './scopedSettings.ts';

declare module '../core/registry.ts' {
  interface ModuleSettingsRegistry {
    graph:          GraphModuleSettings;
    physics:        PhysicsModuleSettings;
    uiInterpreter:  UIInterpreterModuleSettings;
    renderComposer: RenderComposerSettings;
    input:          InputModuleSettings;
    camera:         CameraModuleSettings;
    anima:          AnimaModuleSettings;
  }
}

// keep this file a module
export {};