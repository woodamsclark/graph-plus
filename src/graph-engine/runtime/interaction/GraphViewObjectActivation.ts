import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { GraphEdgeV1, GraphViewIdV1 } from '../../contracts/v1/index.ts';
import type { GraphRuntimeCommandV1 } from './GraphInteractionTypes.ts';

type ObjectActivation = Omit<Extract<GraphRuntimeCommandV1, { type: 'direct-attention' }>, 'identity' | 'timestamp'>;

/** Shared translation for primary/Ctrl object clicks and their noncommitting previews. */
export function planGraphViewObjectActivationV1(options: {
  readonly viewId: GraphViewIdV1;
  readonly nodeId: string;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly ctrl?: boolean;
  readonly getConstellation: (nodeId: string) => readonly string[];
  readonly constellationPathNodeIds?: readonly string[];
}): ObjectActivation | undefined {
  const addedNodeIds = [...new Set([...options.attentionNodeIds, options.nodeId,
    ...(options.constellationPathNodeIds ?? [])])];
  if (options.ctrl) {
    const nodeIds = options.attentionNodeIds.includes(options.nodeId)
      ? options.attentionNodeIds.filter((id) => id !== options.nodeId)
      : addedNodeIds;
    const clearFocus = options.focusedNodeId === options.nodeId && !nodeIds.includes(options.nodeId);
    return {
      type: 'direct-attention', nodeIds, subjectNodeId: options.nodeId, clearFocus,
      viewMode: nodeIds.length === 0 ? 'overview'
        : options.viewId === 'focus' && clearFocus ? 'explore' : options.viewId,
    };
  }
  const activation = GRAPH_VIEW_DEFINITIONS_V1[options.viewId].interactions.objectActivation;
  if (activation === 'choose-constellation') {
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
  /** Committed Attention in Constellation/Focus; visible Awareness in Overview. */
  readonly targetNodeIds: ReadonlySet<string>;
}

/** Shortest undirected graph route to an existing constellation; stable ID order resolves ties. */
export function resolveGraphHoverPathV1(nodeId: string, options: GraphHoverPathOptionsV1): readonly string[] {
  const targets = new Set([...options.targetNodeIds].filter((id) => options.visibleNodeIds.has(id)));
  if (!options.visibleNodeIds.has(nodeId) || targets.size === 0 || targets.has(nodeId)) return [];
  const neighbors = new Map<string, Set<string>>();
  for (const edge of options.edges) {
    if (!options.visibleEdgeIds.has(edge.id) || !options.visibleNodeIds.has(edge.sourceId)
      || !options.visibleNodeIds.has(edge.targetId)) continue;
    if (!neighbors.has(edge.sourceId)) neighbors.set(edge.sourceId, new Set());
    if (!neighbors.has(edge.targetId)) neighbors.set(edge.targetId, new Set());
    neighbors.get(edge.sourceId)!.add(edge.targetId);
    neighbors.get(edge.targetId)!.add(edge.sourceId);
  }
  const predecessors = new Map<string, string | undefined>([[nodeId, undefined]]);
  const frontier = [nodeId];
  for (let i = 0; i < frontier.length; i += 1) {
    const current = frontier[i];
    if (targets.has(current)) {
      const path: string[] = [];
      let cursor: string | undefined = current;
      while (cursor !== undefined) { path.push(cursor); cursor = predecessors.get(cursor); }
      return path.reverse();
    }
    for (const neighbor of [...(neighbors.get(current) ?? [])].sort()) {
      if (predecessors.has(neighbor)) continue;
      predecessors.set(neighbor, current);
      frontier.push(neighbor);
    }
  }
  return [];
}
