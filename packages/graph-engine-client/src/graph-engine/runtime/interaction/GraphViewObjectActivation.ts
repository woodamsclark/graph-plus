import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { GraphEdgeV1, GraphViewIdV1 } from '../../contracts/v1/index.ts';
import { GraphTopologyIndex } from '../../core/document/GraphTopologyIndex.ts';
import type { GraphRuntimeCommandV1 } from './GraphInteractionTypes.ts';

type ObjectActivation = Omit<Extract<GraphRuntimeCommandV1, { type: 'direct-attention' }>, 'identity' | 'timestamp'>;

/** Shared translation for primary/Ctrl clicks, explicit menu toggles, and their previews. */
export function planGraphViewObjectActivationV1(options: {
  readonly viewId: GraphViewIdV1;
  readonly nodeId: string;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly ctrl?: boolean;
  readonly membershipAction?: 'remove' | 'toggle';
  readonly objectAction?: 'focus';
  readonly highlightedNodeIds?: ReadonlySet<string>;
  readonly getConstellation: (nodeId: string) => readonly string[];
  readonly constellationPathNodeIds?: readonly string[];
}): ObjectActivation | undefined {
  const addedNodeIds = [...new Set([...options.attentionNodeIds,
    ...(options.viewId === 'focus' && options.focusedNodeId ? [options.focusedNodeId] : []), options.nodeId,
    ...(options.constellationPathNodeIds ?? [])])];
  const membershipAction = options.membershipAction ?? (options.ctrl ? 'remove' : undefined);
  if (options.objectAction === 'focus') return {
    type: 'direct-attention', nodeIds: addedNodeIds,
    subjectNodeId: options.nodeId, focusNodeId: options.nodeId, viewMode: 'focus',
  };
  if (membershipAction) {
    const nodeIds = membershipAction === 'remove' || options.attentionNodeIds.includes(options.nodeId)
      ? options.attentionNodeIds.filter((id) => id !== options.nodeId) : addedNodeIds;
    const clearFocus = options.focusedNodeId === options.nodeId && !nodeIds.includes(options.nodeId);
    return {
      type: 'direct-attention', nodeIds, subjectNodeId: options.nodeId, clearFocus,
      viewMode: nodeIds.length === 0 ? 'overview'
        : options.viewId === 'focus' && clearFocus ? 'explore' : options.viewId,
    };
  }
  const activation = GRAPH_VIEW_DEFINITIONS_V1[options.viewId].interactions.objectActivation;
  if (activation === 'highlight-or-choose-constellation') {
    if (!(options.highlightedNodeIds ?? new Set(options.attentionNodeIds)).has(options.nodeId)) return {
      type: 'direct-attention', nodeIds: addedNodeIds, subjectNodeId: options.nodeId,
      clearFocus: true, viewMode: 'explore',
    };
    const nodeIds = [...new Set(options.getConstellation(options.nodeId))];
    return nodeIds.includes(options.nodeId) ? {
      type: 'direct-attention', nodeIds, subjectNodeId: options.nodeId,
      clearFocus: true, viewMode: 'explore',
    } : undefined;
  }
  if (activation === 'admit-or-present-object' && !options.attentionNodeIds.includes(options.nodeId)) {
    return {
      type: 'direct-attention', nodeIds: addedNodeIds,
      subjectNodeId: options.nodeId, clearFocus: true, viewMode: 'explore',
    };
  }
  return {
    type: 'direct-attention', nodeIds: addedNodeIds,
    subjectNodeId: options.nodeId, focusNodeId: options.nodeId, viewMode: 'focus',
  };
}

export interface GraphHoverPathOptionsV1 {
  readonly edges: readonly GraphEdgeV1[];
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly visibleEdgeIds: ReadonlySet<string>;
  /** Reuse the session's filtered topology instead of rebuilding it for each candidate. */
  readonly topology?: GraphTopologyIndex;
  /** Committed Attention: route previews and admission never target passive Memory. */
  readonly targetNodeIds: ReadonlySet<string>;
}

/** Shortest undirected graph route to an existing constellation; stable ID order resolves ties. */
export function resolveGraphHoverPathV1(nodeId: string, options: GraphHoverPathOptionsV1): readonly string[] {
  const targets = new Set([...options.targetNodeIds].filter((id) => options.visibleNodeIds.has(id)));
  if (!options.visibleNodeIds.has(nodeId) || targets.size === 0 || targets.has(nodeId)) return [];
  const topology = options.topology ?? new GraphTopologyIndex({
    schemaVersion: 1,
    documentId: 'graph-interaction-path',
    revision: 0,
    nodes: [...options.visibleNodeIds].map((id) => ({ id })),
    edges: options.edges,
  }, { nodeIds: options.visibleNodeIds, edgeIds: options.visibleEdgeIds });
  return topology.shortestPathToAny(nodeId, targets, 'either') ?? [];
}
