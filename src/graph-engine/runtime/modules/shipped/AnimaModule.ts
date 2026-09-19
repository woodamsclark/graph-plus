import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1, GraphModuleProjectionPatchV1 } from '../GraphModuleTypes.ts';

export class AnimaModule implements GraphModuleInstanceV1 {
  private nodeWorldScaleBlend: number;
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
    this.nodeWorldScaleBlend = readUnitInterval(settings.nodeWorldScaleBlend, 0);
    this.labelPosition = readLabelPosition(settings.labelPosition);
    this.adaptiveLabelThreshold2d = readThreshold(settings.adaptiveLabelThreshold2d, 50);
    this.adaptiveLabelThreshold3d = readThreshold(settings.adaptiveLabelThreshold3d, 50);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.nodeWorldScaleBlend = readUnitInterval(settings.nodeWorldScaleBlend, 0);
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
    const taggedIds = new Set(state.viewState.selectedNodeIds);
    if (focusedId !== undefined) taggedIds.add(focusedId);
    const hoveredId = state.hoveredNodeId;
    const hoveredNeighborhood = hoveredId === undefined
      ? new Set<string>()
      : new Set([hoveredId, ...(relationships.get(hoveredId) ?? [])]);
    const transientId = state.draggedNodeId ?? state.previewedNodeId;
    const transientNeighborhood = transientId === undefined
      ? undefined
      : new Set([transientId, ...(relationships.get(transientId) ?? [])]);
    const exploreActive = taggedIds.size > 0 && state.taggingActive !== true;
    const visibleIds = transientNeighborhood ?? (exploreActive
      ? new Set([...taggedIds, ...hoveredNeighborhood])
      : undefined);
    const litNodeIds = transientId !== undefined
      ? new Set([transientId])
      : exploreActive
        ? new Set([...taggedIds, ...(hoveredId === undefined ? [] : [hoveredId])])
        : new Set([...taggedIds, ...hoveredNeighborhood]);
    const edgeIsLit = (sourceId: string, targetId: string): boolean => {
      if (transientId !== undefined) return sourceId === transientId || targetId === transientId;
      const joinsTaggedStructure = taggedIds.has(sourceId) && taggedIds.has(targetId);
      const joinsHoveredNode = hoveredId !== undefined && (sourceId === hoveredId || targetId === hoveredId);
      return joinsTaggedStructure || joinsHoveredNode;
    };
    const nodeContributions = Object.fromEntries(state.document.nodes
      .filter((node) => visibleNodes.has(node.id))
      .map((node) => {
        const prior = state.nodeContributions[node.id];
        const visibleDegree = degree.get(node.id) ?? 0;
        const structuralScale = positive(prior?.radiusScale, 1);
        const radius = positive(prior?.baseRadiusScale, 1)
          * clamp(3 * Math.sqrt(visibleDegree + 1), 8, 30) * structuralScale;
        const isLit = litNodeIds.has(node.id);
        const color = isLit
          ? this.palette.colors.animaAccent
          : prior?.color ?? (node.tokens?.includes('kind:tag') ? this.palette.colors.tagNode : undefined) ?? this.palette.colors.node;
        const selected = state.viewState.selectedNodeIds.includes(node.id);
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        const suppressAdaptiveLabel = state.presentationPolicy?.labelMode === 'adaptive'
          && visibleIds !== undefined
          && !visibleIds.has(node.id);
        return [node.id, {
          ...prior,
          radius,
          finalColor: color,
          opacity: visibleIds === undefined || visibleIds.has(node.id) ? 1 : 0.2,
          labelOpacity: visibleIds === undefined || visibleIds.has(node.id) ? 1 : 0.2,
          showLabel: prior?.showLabel !== false && !suppressAdaptiveLabel,
          labelFontSize: 14 + radius / 4,
          labelAlwaysVisible: prior?.labelAlwaysVisible || isLit || selected || node.id === focusedId,
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
        nodeWorldScaleBlend: this.nodeWorldScaleBlend,
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

function positive(value: JsonValue | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
