import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1, GraphModuleProjectionPatchV1 } from '../GraphModuleTypes.ts';

export class AnimaModule implements GraphModuleInstanceV1 {
  private nodeZoomContrast: number;
  private labelPosition: 'above' | 'below';
  private adaptiveLabelThreshold2d: number;
  private adaptiveLabelThreshold3d: number;
  private topologyCache?: {
    readonly document: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document'];
    readonly nodeIds: ReadonlySet<string>;
    readonly edgeIds: ReadonlySet<string>;
    readonly visibleEdges: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document']['edges'];
    readonly relationships: ReadonlyMap<string, ReadonlySet<string>>;
    readonly degree: ReadonlyMap<string, number>;
  };

  constructor(
    private palette: GraphVisualThemeV2,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    // Keep the original persisted key so existing experimental slider values survive this broader curve.
    this.nodeZoomContrast = readUnitInterval(settings.nodeWorldScaleBlend, 0);
    this.labelPosition = readLabelPosition(settings.labelPosition);
    this.adaptiveLabelThreshold2d = readThreshold(settings.adaptiveLabelThreshold2d, 50);
    this.adaptiveLabelThreshold3d = readThreshold(settings.adaptiveLabelThreshold3d, 50);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.nodeZoomContrast = readUnitInterval(settings.nodeWorldScaleBlend, 0);
    this.labelPosition = readLabelPosition(settings.labelPosition);
    this.adaptiveLabelThreshold2d = readThreshold(settings.adaptiveLabelThreshold2d, 50);
    this.adaptiveLabelThreshold3d = readThreshold(settings.adaptiveLabelThreshold3d, 50);
  }

  restoreState(state: JsonValue): void {
    if (state !== null) throw new Error('Anima V1 state must be null.');
  }

  exportState(): JsonValue {
    return null;
  }

  contributeFrame(
    state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0],
  ): GraphModuleProjectionPatchV1 | void {
    const visibleNodes = state.renderSelection.nodeIds;
    const { visibleEdges, relationships, degree } = this.presentationTopology(state);
    const focusedId = state.viewState.focusedNodeId;
    const selectedIds = new Set(state.viewState.selectedNodeIds);
    const taggedIds = new Set(selectedIds);
    if (focusedId !== undefined) taggedIds.add(focusedId);
    const hoveredId = state.hoveredNodeId;
    const hoveredNeighborhood = hoveredId === undefined
      ? new Set<string>()
      : new Set([hoveredId, ...(relationships.get(hoveredId) ?? [])]);
    const transientId = state.draggedNodeId ?? state.previewedNodeId;
    const transientNeighborhood = transientId === undefined
      ? undefined
      : new Set([transientId, ...(relationships.get(transientId) ?? [])]);
    const exploreActive = taggedIds.size > 0 && state.selectionPresentationSuspended !== true;
    const hoveredIsTagged = hoveredId !== undefined && selectedIds.has(hoveredId);
    const pathTargetIds = selectedIds.size > 0 ? selectedIds : taggedIds;
    const exploreHoverPath = exploreActive && hoveredId !== undefined && !hoveredIsTagged
      ? shortestPathToAny(hoveredId, pathTargetIds, relationships)
      : undefined;
    const exploreHoverIds = hoveredId === undefined
      ? new Set<string>()
      : hoveredIsTagged
        ? hoveredNeighborhood
        : new Set(exploreHoverPath ?? [hoveredId]);
    const visibleIds = transientNeighborhood ?? (exploreActive
      ? new Set([...taggedIds, ...exploreHoverIds])
      : undefined);
    const labelVisibleIds = transientNeighborhood ?? (exploreActive ? taggedIds : undefined);
    const litNodeIds = transientId !== undefined
      ? new Set([transientId])
      : exploreActive
        ? new Set([...taggedIds, ...exploreHoverIds])
        : new Set([...taggedIds, ...hoveredNeighborhood]);
    const pathEdgePairs = edgePairs(exploreHoverPath);
    const edgeIsLit = (sourceId: string, targetId: string): boolean => {
      if (transientId !== undefined) return sourceId === transientId || targetId === transientId;
      const joinsTaggedStructure = taggedIds.has(sourceId) && taggedIds.has(targetId);
      if (joinsTaggedStructure) return true;
      if (hoveredId === undefined) return false;
      if (!exploreActive || hoveredIsTagged) return sourceId === hoveredId || targetId === hoveredId;
      return pathEdgePairs.has(unorderedPair(sourceId, targetId));
    };
    const nodesWithRadius = state.document.nodes
      .filter((node) => visibleNodes.has(node.id))
      .map((node) => {
        const prior = state.nodeContributions[node.id];
        const visibleDegree = degree.get(node.id) ?? 0;
        const structuralScale = positive(prior?.radiusScale, 1);
        const radius = positive(prior?.baseRadiusScale, 1)
          * clamp(3 * Math.sqrt(visibleDegree + 1), 8, 30) * structuralScale;
        return { node, prior, radius };
      });
    let smallestRadius = Number.POSITIVE_INFINITY;
    let largestRadius = Number.NEGATIVE_INFINITY;
    for (const { radius } of nodesWithRadius) {
      smallestRadius = Math.min(smallestRadius, radius);
      largestRadius = Math.max(largestRadius, radius);
    }
    const maximumScaleExponent = 0.5 + this.nodeZoomContrast * 1.5;
    const nodeContributions = Object.fromEntries(nodesWithRadius
      .map(({ node, prior, radius }) => {
        const isLit = litNodeIds.has(node.id);
        const color = isLit
          ? this.palette.colors.animaAccent
          : prior?.color ?? (node.tokens?.includes('kind:tag') ? this.palette.colors.tagNode : undefined) ?? this.palette.colors.node;
        const selected = state.viewState.selectedNodeIds.includes(node.id);
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        const suppressAdaptiveLabel = state.presentationPolicy?.labelMode === 'adaptive'
          && labelVisibleIds !== undefined
          && !labelVisibleIds.has(node.id);
        return [node.id, {
          ...prior,
          radius,
          nodeScaleExponent: lerp(0.5, maximumScaleExponent,
            normalize(radius, smallestRadius, largestRadius)),
          finalColor: color,
          opacity: visibleIds === undefined || visibleIds.has(node.id) ? 1 : 0.2,
          labelOpacity: labelVisibleIds === undefined || labelVisibleIds.has(node.id) ? 1 : 0.2,
          showLabel: prior?.showLabel !== false && !suppressAdaptiveLabel,
          labelFontSize: 14 + radius / 4,
          labelAlwaysVisible: prior?.labelAlwaysVisible || selected || node.id === focusedId,
          ...(selected || pinned ? {
            strokeColor: this.palette.colors.nodeOutline,
            strokeWidth: pinned ? 2 : 1,
          } : {}),
        }];
      }));
    const edgeContributions = Object.fromEntries(visibleEdges.map((edge) => {
      const prior = state.edgeContributions[edge.id];
      const lit = edgeIsLit(edge.sourceId, edge.targetId);
      const visible = visibleIds === undefined || lit;
      return [edge.id, {
        ...prior,
        thickness: positive(prior?.baseThicknessScale, 1) * positive(prior?.thicknessScale, 1),
        opacity: visible ? 1 : 0.2,
        arrowColor: this.palette.colors.arrow,
        arrowOpacity: visible ? 1 : 0.2,
        ...(lit ? { color: this.palette.colors.highlightedNode } : {}),
      }];
    }));
    return {
      nodeContributions,
      edgeContributions,
      presentationPolicy: {
        ...(state.presentationPolicy ?? {}),
        nodeScaleMode: 'sqrt-orthographic',
        nodeScaleExponent: 0.5,
        labelScaleMode: 'fixed',
        labelPosition: this.labelPosition,
        adaptiveLabelThreshold: state.viewState.dimensions === '3d'
          ? this.adaptiveLabelThreshold3d
          : this.adaptiveLabelThreshold2d,
        minimumPerspectiveNodeRadius: 4,
        minimumPerspectiveNodeScale: 0.5,
        minimumPerspectiveTouchHitRadius: 22,
        edgeAggregation: 'unordered-pair',
        showArrows: state.presentationPolicy?.showArrows === true,
      },
    };
  }

  onThemeChanged(theme: GraphVisualThemeV2): void {
    this.palette = theme;
  }

  private presentationTopology(
    state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0],
  ): NonNullable<AnimaModule['topologyCache']> {
    const cached = this.topologyCache;
    if (cached?.document === state.document
      && cached.nodeIds === state.renderSelection.nodeIds
      && cached.edgeIds === state.renderSelection.edgeIds) return cached;
    const visibleNodes = state.renderSelection.nodeIds;
    const visibleEdges = state.document.edges.filter((edge) => state.renderSelection.edgeIds.has(edge.id)
      && visibleNodes.has(edge.sourceId) && visibleNodes.has(edge.targetId));
    const relationships = new Map<string, Set<string>>();
    const degreeKeys = new Map<string, Set<string>>();
    for (const nodeId of visibleNodes) {
      relationships.set(nodeId, new Set());
      degreeKeys.set(nodeId, new Set());
    }
    for (const edge of visibleEdges) {
      if (edge.sourceId === edge.targetId) continue;
      relationships.get(edge.sourceId)?.add(edge.targetId);
      relationships.get(edge.targetId)?.add(edge.sourceId);
      const ordered = edge.directed === false
        ? [edge.sourceId, edge.targetId].sort().join('\u0000')
        : `${edge.sourceId}\u0000${edge.targetId}`;
      degreeKeys.get(edge.sourceId)?.add(ordered);
      degreeKeys.get(edge.targetId)?.add(ordered);
    }
    const next = {
      document: state.document,
      nodeIds: state.renderSelection.nodeIds,
      edgeIds: state.renderSelection.edgeIds,
      visibleEdges,
      relationships,
      degree: new Map([...degreeKeys].map(([id, keys]) => [id, keys.size])),
    };
    this.topologyCache = next;
    return next;
  }
}

function readLabelPosition(value: JsonValue | undefined): 'above' | 'below' {
  return value === 'above' ? 'above' : 'below';
}

function readThreshold(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 100)
    : fallback;
}

function readUnitInterval(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : fallback;
}

function normalize(value: number, min: number, max: number): number {
  return max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function shortestPathToAny(
  startId: string,
  targetIds: ReadonlySet<string>,
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] | undefined {
  if (targetIds.has(startId)) return [startId];
  const previous = new Map<string, string | undefined>([[startId, undefined]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const neighbor of [...(relationships.get(current) ?? [])].sort()) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (targetIds.has(neighbor)) return reconstructPath(neighbor, previous);
      queue.push(neighbor);
    }
  }
  return undefined;
}

function reconstructPath(targetId: string, previous: ReadonlyMap<string, string | undefined>): readonly string[] {
  const path: string[] = [];
  let current: string | undefined = targetId;
  while (current !== undefined) {
    path.push(current);
    current = previous.get(current);
  }
  return path.reverse();
}

function edgePairs(path: readonly string[] | undefined): ReadonlySet<string> {
  const pairs = new Set<string>();
  if (!path) return pairs;
  for (let index = 1; index < path.length; index += 1) {
    pairs.add(unorderedPair(path[index - 1], path[index]));
  }
  return pairs;
}

function unorderedPair(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function positive(value: JsonValue | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
