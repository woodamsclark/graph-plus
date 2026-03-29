import type {
  GraphPlusSettings,
  CameraSettings,
  UISettings,
} from './appSettings.ts';

export type GraphModuleSettings         = Pick<GraphPlusSettings, 'base'    | 'layout'  | 'tuning'>;
export type PhysicsModuleSettings       = Pick<GraphPlusSettings, 'physics' | 'layout'  | 'tuning'>;
export type UIInterpreterModuleSettings = Pick<GraphPlusSettings, 'ui'      | 'tuning'>;
export type RendererModuleSettings      = Pick<GraphPlusSettings, 'base'    | 'tuning'>;
export type UIModuleSettings            = Pick<GraphPlusSettings, 'ui'      | 'tuning'>;
export type RenderComposerSettings      = Pick<GraphPlusSettings, 'base'    | 'tuning'>;

export type InputModuleSettings = {
  ui: UISettings;
};

export type CameraModuleSettings = {
  camera: CameraSettings;
};

export type AnimaModuleSettings = {
  drainPerSecond:   number;
  openNodeGain:     number;
  followNodeGain:   number;
  pinNodeGain:      number;
  dragNodeGain:     number;
};