import type {
  GraphNodeActionContextV1,
  GraphSettingsOverridesV1,
  Disposable,
  JsonValue,
} from '../../contracts/v1/index.ts';
import type { GraphResolvedNodeActionV1 } from '../actions/index.ts';

export interface GraphSessionControlPortV1 {
  getSessionOverrides(): GraphSettingsOverridesV1;
  onSessionOverridesChanged(listener: (overrides: GraphSettingsOverridesV1) => void): Disposable;
  setModuleEnabled(moduleId: string, enabled: boolean | undefined): Promise<void>;
  setModuleSetting(moduleId: string, key: string, value: JsonValue | undefined): Promise<void>;
  createNodeActionContext(nodeId: string): GraphNodeActionContextV1;
  resolveNodeActions(actionIds: readonly string[], nodeId: string): readonly GraphResolvedNodeActionV1[];
  invokeNodeAction(actionId: string, nodeId: string): boolean;
}
