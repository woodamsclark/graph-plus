import type {
  ConsumerProfileDescriptorV1,
  Disposable,
  GraphDimensionsV1,
  GraphSessionOptionsV1,
  GraphSessionV1,
  GraphSettingsOverridesV1,
  JsonValue,
} from '../contracts/v1/index.ts';
import type { EffectiveConsumerProfileV1 } from '../core/profile/index.ts';
import type { GraphSessionControlPortV1 } from '../runtime/index.ts';

export type GraphEngineProfileUpdateModeV1 = 'live' | 'commit';

export interface GraphEngineProfileSettingsPortV1 {
  getDescriptor(): ConsumerProfileDescriptorV1;
  getEffectiveProfile(): EffectiveConsumerProfileV1;
  getUserOverrides(): GraphSettingsOverridesV1;
  setDimensions(dimensions: GraphDimensionsV1 | undefined): Promise<void>;
  setProfileSetting(key: string, value: JsonValue | undefined): Promise<void>;
  setModuleSetting(moduleId: string, key: string, value: JsonValue | undefined, mode?: 'live'): Promise<void>;
  commitSettings(): Promise<void>;
}

export interface GraphEngineSessionUiMountContextV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly session: GraphSessionV1;
  readonly sessionOptions: GraphSessionOptionsV1;
  readonly controls: GraphSessionControlPortV1;
  readonly profileSettings: GraphEngineProfileSettingsPortV1;
}

export interface GraphEngineSessionUiHostV1 {
  mount(context: GraphEngineSessionUiMountContextV1): Disposable | Promise<Disposable>;
}
