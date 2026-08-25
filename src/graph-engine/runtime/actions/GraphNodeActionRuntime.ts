import type {
  GraphNodeActionContextV1,
} from '../../contracts/v1/index.ts';

export interface GraphResolvedNodeActionV1 {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

export interface GraphNodeActionFailureV1 {
  readonly actionId: string;
  readonly phase: 'availability' | 'label' | 'run';
  readonly error: unknown;
}

export interface GraphNodeActionRuntimeV1 {
  resolve(
    actionIds: readonly string[],
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): readonly GraphResolvedNodeActionV1[];
  invoke(
    actionId: string,
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): boolean;
  invokeFirst(
    actionIds: readonly string[],
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): boolean;
}
