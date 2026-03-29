import type {
  GraphPlusSettings,
  GraphModuleSettings,
  PhysicsModuleSettings,
  RendererModuleSettings,
  UIModuleSettings,
  CameraModuleSettings,
  AnimaSettings,
  InputModuleSettings,
} from '../../graph+/grammar/interfaces.ts';

export function selectGraphSettings(s: GraphPlusSettings): GraphModuleSettings {
  return {
    base: s.base,
    layout: s.layout,
    tuning: s.tuning,
  };
}

export function selectPhysicsSettings(s: GraphPlusSettings): PhysicsModuleSettings {
  return {
    physics: s.physics,
    layout: s.layout,
    tuning: s.tuning,
  };
}

export function selectRendererStateComposerSettings(s: GraphPlusSettings): RendererModuleSettings {
  return {
    base: s.base,
    tuning: s.tuning,
  };
}

export function selectUIInterpreterSettings(s: GraphPlusSettings): UIModuleSettings {
  return {
    ui: s.ui,
    tuning: s.tuning,
  };
}

export function selectInputSettings(s: GraphPlusSettings): InputModuleSettings {
  return {
    ui: s.ui,
  };
}

export function selectCameraSettings(s: GraphPlusSettings): CameraModuleSettings {
  return {
    camera: s.camera,
  };
}

//export function selectAnimaSettings(s: GraphPlusSettings): AnimaSettings {
//  return {
//    anima: s.anima,
//  };
//}