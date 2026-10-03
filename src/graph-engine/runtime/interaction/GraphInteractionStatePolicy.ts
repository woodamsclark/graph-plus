import { GRAPH_VIEW_DEFINITIONS_V1, type GraphActiveViewV1 } from '../../contracts/v1/index.ts';
import type { GraphDimensionsV1, GraphEdgeV1, GraphViewStateV1 } from '../../contracts/v1/index.ts';

export type GraphUxStateV1 = 'overview' | 'explore' | 'focus';

/** Focus uses the full square safe frame without an additional camera inset. */
export const FOCUS_FIT_PADDING_PX = 0;

/** A point has no spatial bounds; keep a lone-node refit at a readable visual scale. */
export const SINGLE_NODE_FIT_MAX_PROJECTED_SCALE = 5;

const MOBILE_SINGLE_NODE_FIT_REFERENCE_SHORT_EDGE_PX = 600;

/** Preserve the desktop result while keeping the same apparent proportion on narrow touch screens. */
export function singleNodeFitMaxProjectedScale(
  viewport: { readonly width: number; readonly height: number },
  modality?: 'mouse' | 'touch' | 'pen',
): number {
  if (modality !== 'touch') return SINGLE_NODE_FIT_MAX_PROJECTED_SCALE;
  const shortEdge = Math.max(1, Math.min(viewport.width, viewport.height));
  const ratio = Math.min(1, shortEdge / MOBILE_SINGLE_NODE_FIT_REFERENCE_SHORT_EDGE_PX);
  return SINGLE_NODE_FIT_MAX_PROJECTED_SCALE * ratio * ratio;
}

export function immediateNeighborhoodFitNodeIdsV1(
  nodeId: string,
  edges: readonly GraphEdgeV1[],
  visibleNodeIds: ReadonlySet<string>,
  visibleEdgeIds: ReadonlySet<string>,
): readonly string[] {
  const neighbors = edges.flatMap((edge) => {
    if (!visibleEdgeIds.has(edge.id)) return [];
    if (edge.sourceId === nodeId && visibleNodeIds.has(edge.targetId)) return [edge.targetId];
    if (edge.targetId === nodeId && visibleNodeIds.has(edge.sourceId)) return [edge.sourceId];
    return [];
  });
  return [...new Set([nodeId, ...neighbors])].filter((id) => visibleNodeIds.has(id));
}

export function attentionFitNodeIdsV1(
  attentionNodeIds: readonly string[],
  edges: readonly GraphEdgeV1[],
  visibleNodeIds: ReadonlySet<string>,
  visibleEdgeIds: ReadonlySet<string>,
): readonly string[] {
  const visibleAttention = [...new Set(attentionNodeIds)].filter((id) => visibleNodeIds.has(id));
  return visibleAttention.length === 1
    ? immediateNeighborhoodFitNodeIdsV1(visibleAttention[0], edges, visibleNodeIds, visibleEdgeIds)
    : visibleAttention;
}

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
  /** Highlighted subjects have no navigation ownership in Overview. */
  readonly cameraTracking: 'none' | 'constellation' | 'focused-node';
  readonly zoomAnchor: 'pointer' | 'tracked-subject';
  readonly nodeDrag: 'all-visible' | 'constellation-members';
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
    nodeDrag: GRAPH_VIEW_DEFINITIONS_V1.overview.interactions.nodeDrag,
    state: 'overview', cameraTracking: GRAPH_VIEW_DEFINITIONS_V1.overview.framing.interest, zoomAnchor: GRAPH_VIEW_DEFINITIONS_V1.overview.framing.zoomAnchor, fitTarget: 'graph', fitCenter: 'centroid',
    primaryDrag: { '2d': 'pan', '3d': 'pan' }, mobilePrimaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'pan' }, secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
  explore: {
    nodeDrag: GRAPH_VIEW_DEFINITIONS_V1.explore.interactions.nodeDrag,
    state: 'explore', cameraTracking: GRAPH_VIEW_DEFINITIONS_V1.explore.framing.interest, zoomAnchor: GRAPH_VIEW_DEFINITIONS_V1.explore.framing.zoomAnchor, fitTarget: 'selection', fitCenter: 'centroid',
    primaryDrag: { '2d': 'pan', '3d': 'pan' }, mobilePrimaryDrag: { '2d': 'pan', '3d': 'rotate' },
    wheel: { '2d': 'pan', '3d': 'rotate' }, secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
  focus: {
    nodeDrag: GRAPH_VIEW_DEFINITIONS_V1.focus.interactions.nodeDrag,
    state: 'focus', cameraTracking: GRAPH_VIEW_DEFINITIONS_V1.focus.framing.interest, zoomAnchor: GRAPH_VIEW_DEFINITIONS_V1.focus.framing.zoomAnchor, fitTarget: 'focused-neighborhood', fitCenter: 'focused-node',
    primaryDrag: { '2d': 'elastic-pan', '3d': 'pan' },
    mobilePrimaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    wheel: { '2d': 'elastic-pan', '3d': 'rotate' }, secondaryDrag: 'radial-zoom',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
  },
};

export function resolveGraphUxStateV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId' | 'viewMode'>,
): GraphUxStateV1 {
  if (viewState.viewMode === 'focus' && viewState.focusedNodeId !== undefined) return 'focus';
  if (viewState.viewMode === 'explore') return 'explore';
  if (viewState.viewMode === 'overview') return 'overview';
  if (viewState.focusedNodeId !== undefined && viewState.selectedNodeIds.length > 0) return 'focus';
  if (viewState.selectedNodeIds.length > 0) return 'explore';
  return 'overview';
}

export function createGraphInteractionContextV1(options: {
  readonly viewState: Pick<GraphViewStateV1,
    'dimensions' | 'selectedNodeIds' | 'pinnedNodeIds' | 'focusedNodeId' | 'viewMode'>;
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
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId' | 'viewMode'>,
): GraphInteractionStatePolicyV1 {
  return GRAPH_INTERACTION_STATE_POLICIES_V1[resolveGraphUxStateV1(viewState)];
}

export function resolveGraphActiveViewV1(
  state: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId' | 'viewMode'>,
): GraphActiveViewV1 {
  const id = resolveGraphUxStateV1(state);
  return id === 'focus' ? { id, subjectNodeId: state.focusedNodeId! } : { id };
}

/** Eligibility uses committed membership, independent of Anima or prospective hover scenes. */
export function canDragGraphNodeV1(
  nodeId: string,
  state: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId' | 'viewMode'>,
): boolean {
  return graphInteractionPolicyV1(state).nodeDrag === 'all-visible' || state.selectedNodeIds.includes(nodeId);
}
