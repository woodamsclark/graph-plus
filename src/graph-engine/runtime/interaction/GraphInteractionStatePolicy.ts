import type { GraphViewStateV1 } from '../../contracts/v1/index.ts';
import {
  EGO_UI_STATE_CONTRACTS_V1,
  egoUiStateContractV1,
  resolveEgoUiStateV1,
  type EgoUiStateContractV1,
  type EgoUiStateV1,
} from '../ego/index.ts';

/** @deprecated Use EgoUiStateV1. Kept as the interaction compatibility surface. */
export type GraphUxStateV1 = EgoUiStateV1;
/** @deprecated Use EgoUiStateContractV1. Ego owns the complete UI-state contract. */
export type GraphInteractionStatePolicyV1 = EgoUiStateContractV1;

/** @deprecated Compatibility alias; the authoritative contracts live in Ego. */
export const GRAPH_INTERACTION_STATE_POLICIES_V1 = EGO_UI_STATE_CONTRACTS_V1;

export function resolveGraphUxStateV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphUxStateV1 {
  return resolveEgoUiStateV1(viewState);
}

export function graphInteractionPolicyV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphInteractionStatePolicyV1 {
  return egoUiStateContractV1(viewState);
}
