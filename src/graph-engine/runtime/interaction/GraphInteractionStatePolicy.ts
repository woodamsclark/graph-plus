import type { GraphDimensionsV1, GraphViewStateV1 } from '../../contracts/v1/index.ts';

export type GraphUxStateV1 = 'overview' | 'explore' | 'focus';

export interface GraphInteractionStatePolicyV1 {
  readonly state: GraphUxStateV1;
  readonly cameraTarget: 'graph' | 'selection-centroid' | 'focused-node';
  readonly fitTarget: 'graph' | 'selection' | 'focused-neighborhood';
  readonly renderScope: 'graph' | 'graph-with-selection-emphasis' | 'focused-local-view';
  readonly primaryDrag: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly wheel: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly secondaryDrag: 'rotate' | 'radial-zoom';
  readonly mobileTwoFingerDrag: 'pan-or-rotate' | 'radial-zoom';
}

/**
 * The reviewed interaction contract. This is intentionally an internal fixed policy in V1;
 * consumers do not supply alternate state behavior yet.
 */
export const GRAPH_INTERACTION_STATE_POLICIES_V1: Readonly<Record<GraphUxStateV1, GraphInteractionStatePolicyV1>> = {
  overview: {
    state: 'overview',
    cameraTarget: 'graph',
    fitTarget: 'graph',
    renderScope: 'graph',
    primaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'pan' },
    secondaryDrag: 'rotate',
    mobileTwoFingerDrag: 'pan-or-rotate',
  },
  explore: {
    state: 'explore',
    cameraTarget: 'selection-centroid',
    fitTarget: 'selection',
    renderScope: 'graph-with-selection-emphasis',
    primaryDrag: { '2d': 'pan', '3d': 'rotate' },
    wheel: { '2d': 'pan', '3d': 'rotate' },
    secondaryDrag: 'rotate',
    mobileTwoFingerDrag: 'pan-or-rotate',
  },
  focus: {
    state: 'focus',
    cameraTarget: 'focused-node',
    fitTarget: 'focused-neighborhood',
    renderScope: 'focused-local-view',
    primaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    wheel: { '2d': 'elastic-pan', '3d': 'rotate' },
    secondaryDrag: 'radial-zoom',
    mobileTwoFingerDrag: 'radial-zoom',
  },
};

export function resolveGraphUxStateV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphUxStateV1 {
  if (viewState.focusedNodeId !== undefined && viewState.selectedNodeIds.length > 0) return 'focus';
  if (viewState.selectedNodeIds.length > 0) return 'explore';
  return 'overview';
}

export function graphInteractionPolicyV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphInteractionStatePolicyV1 {
  return GRAPH_INTERACTION_STATE_POLICIES_V1[resolveGraphUxStateV1(viewState)];
}
