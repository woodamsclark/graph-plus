import type { GraphDimensionsV1, GraphViewStateV1 } from '../../contracts/v1/index.ts';

export type GraphUxStateV1 = 'overview' | 'explore' | 'focus';

export interface GraphInteractionContextV1 {
  readonly state: GraphUxStateV1;
  /** @deprecated Compatibility spelling for legacy interaction readers. */
  readonly mode: GraphUxStateV1;
  readonly dimensions: GraphDimensionsV1;
  readonly selectedNodeIds: ReadonlySet<string>;
  readonly pinnedNodeIds: ReadonlySet<string>;
  readonly focusedNodeId?: string;
  readonly hoveredNodeId?: string;
  readonly draggedNodeId?: string;
  readonly previewedNodeId?: string;
  readonly selectionPresentationSuspended: boolean;
  readonly selectionNeighborRevealActive: boolean;
}

export interface GraphInteractionStatePolicyV1 {
  readonly state: GraphUxStateV1;
  readonly fitTarget: 'graph' | 'selection' | 'focused-neighborhood';
  readonly fitCenter: 'centroid' | 'focused-node';
  readonly primaryDrag: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly mobilePrimaryDrag: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly wheel: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly secondaryDrag: 'rotate' | 'radial-zoom';
  readonly mobileTwoFingerDrag: Readonly<Record<GraphDimensionsV1, 'pan-and-zoom' | 'rotate-and-zoom'>>;
}

export const GRAPH_INTERACTION_STATE_POLICIES_V1: Readonly<Record<GraphUxStateV1, GraphInteractionStatePolicyV1>> = {
  overview: {
    state: 'overview', fitTarget: 'graph', fitCenter: 'centroid',
    primaryDrag: { '2d': 'pan', '3d': 'pan' }, mobilePrimaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'pan' }, secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
  explore: {
    state: 'explore', fitTarget: 'selection', fitCenter: 'centroid',
    primaryDrag: { '2d': 'pan', '3d': 'pan' }, mobilePrimaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'rotate' }, secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
  focus: {
    state: 'focus', fitTarget: 'focused-neighborhood', fitCenter: 'focused-node',
    primaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    mobilePrimaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    wheel: { '2d': 'elastic-pan', '3d': 'rotate' }, secondaryDrag: 'radial-zoom',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
};

export function resolveGraphUxStateV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphUxStateV1 {
  if (viewState.focusedNodeId !== undefined && viewState.selectedNodeIds.length > 0) return 'focus';
  if (viewState.selectedNodeIds.length > 0) return 'explore';
  return 'overview';
}

export function createGraphInteractionContextV1(options: {
  readonly viewState: Pick<GraphViewStateV1,
    'dimensions' | 'selectedNodeIds' | 'pinnedNodeIds' | 'focusedNodeId'>;
  readonly hoveredNodeId?: string;
  readonly draggedNodeId?: string;
  readonly previewedNodeId?: string;
  readonly selectionPresentationSuspended?: boolean;
  readonly selectionNeighborRevealActive?: boolean;
}): GraphInteractionContextV1 {
  const state = resolveGraphUxStateV1(options.viewState);
  return {
    state,
    mode: state,
    dimensions: options.viewState.dimensions,
    selectedNodeIds: new Set(options.viewState.selectedNodeIds),
    pinnedNodeIds: new Set(options.viewState.pinnedNodeIds),
    ...(options.viewState.focusedNodeId === undefined ? {} : { focusedNodeId: options.viewState.focusedNodeId }),
    ...(options.hoveredNodeId === undefined ? {} : { hoveredNodeId: options.hoveredNodeId }),
    ...(options.draggedNodeId === undefined ? {} : { draggedNodeId: options.draggedNodeId }),
    ...(options.previewedNodeId === undefined ? {} : { previewedNodeId: options.previewedNodeId }),
    selectionPresentationSuspended: options.selectionPresentationSuspended === true,
    selectionNeighborRevealActive: options.selectionNeighborRevealActive === true,
  };
}

export function graphInteractionPolicyV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): GraphInteractionStatePolicyV1 {
  return GRAPH_INTERACTION_STATE_POLICIES_V1[resolveGraphUxStateV1(viewState)];
}
