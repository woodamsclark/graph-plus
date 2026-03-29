import type { GraphPlusSettings } from './appSettings.ts';
import type { ModuleSettingsKey, SettingsFor } from '../core/registry.ts';
import type {
  AnimaModuleSettings,
  CameraModuleSettings,
  GraphModuleSettings,
  InputModuleSettings,
  PhysicsModuleSettings,
  RenderComposerSettings,
  UIInterpreterModuleSettings,
} from './scopedSettings.ts';

export function selectGraphSettings(s: GraphPlusSettings): GraphModuleSettings {
  return {
    base:       s.base,
    layout:     s.layout,
    tuning:     s.tuning,
  };
}

export function selectPhysicsSettings(s: GraphPlusSettings): PhysicsModuleSettings {
  return {
    physics:    s.physics,
    layout:     s.layout,
    tuning:     s.tuning,
  };
}

export function selectUIInterpreterSettings(s: GraphPlusSettings): UIInterpreterModuleSettings {
  return {
    ui:         s.ui,
    tuning:     s.tuning,
  };
}

export function selectRenderComposerSettings(s: GraphPlusSettings): RenderComposerSettings {
  return {
    base:       s.base,
    tuning:     s.tuning,
  };
}

export function selectInputSettings(s: GraphPlusSettings): InputModuleSettings {
  return {
    ui:         s.ui,
  };
}

export function selectCameraSettings(s: GraphPlusSettings): CameraModuleSettings {
  return {
    camera:     s.camera,
  };
}

export function selectAnimaSettings(_s: GraphPlusSettings): AnimaModuleSettings {
  return {
    drainPerSecond: 10,
    openNodeGain:   20,
    followNodeGain: 10,
    pinNodeGain:     8,
    dragNodeGain:    6,
  };
}

/**
 * Optional central selector table.
 * Useful if runtime wants generic dispatch.
 */
export const coreSettingsSelectors = {
  graph:            selectGraphSettings,
  physics:          selectPhysicsSettings,
  uiInterpreter:    selectUIInterpreterSettings,
  renderComposer:   selectRenderComposerSettings,
  input:            selectInputSettings,
  camera:           selectCameraSettings,
  anima:            selectAnimaSettings,
} satisfies {
  [K in ModuleSettingsKey]?: (settings: GraphPlusSettings) => SettingsFor<K>;
};