import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1, GraphModuleProjectionPatchV1 } from '../GraphModuleTypes.ts';

export class AnimaModule implements GraphModuleInstanceV1 {
  private labelPosition: 'above' | 'below';
  private topologyCache?: {
    readonly document: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document'];
    readonly nodeIds: ReadonlySet<string>;
    readonly edgeIds: ReadonlySet<string>;
    readonly visibleEdges: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document']['edges'];
    readonly relationships: ReadonlyMap<string, ReadonlySet<string>>;
    readonly degree: ReadonlyMap<string, number>;
  };

  constructor(
    private readonly palette: GraphRenderThemeV1,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.labelPosition = readLabelPosition(settings.labelPosition);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.labelPosition = readLabelPosition(settings.labelPosition);
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
    const activeId = state.draggedNodeId ?? state.viewState.focusedNodeId ?? state.hoveredNodeId;
    const activeNeighborhood = activeId === undefined
      ? undefined
      : new Set([activeId, ...(relationships.get(activeId) ?? [])]);
    const nodeContributions = Object.fromEntries(state.document.nodes
      .filter((node) => visibleNodes.has(node.id))
      .map((node) => {
        const prior = state.nodeContributions[node.id];
        const visibleDegree = degree.get(node.id) ?? 0;
        const structuralScale = positive(prior?.radiusScale, 1);
        const radius = positive(prior?.baseRadiusScale, 1)
          * clamp(3 * Math.sqrt(visibleDegree + 1), 8, 30) * structuralScale;
        const isActive = node.id === activeId;
        const color = isActive
          ? this.palette.highlightNodeColor ?? this.palette.focusedNodeColor
          : state.viewState.focusedNodeId === node.id
            ? this.palette.focusedNodeColor
            : prior?.color ?? (node.tokens?.includes('kind:tag') ? this.palette.tagNodeColor : undefined) ?? this.palette.nodeColor;
        const selected = state.viewState.selectedNodeIds.includes(node.id);
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        return [node.id, {
          ...prior,
          radius,
          finalColor: color,
          opacity: activeNeighborhood === undefined || activeNeighborhood.has(node.id) ? 1 : 0.2,
          labelOpacity: activeNeighborhood === undefined || activeNeighborhood.has(node.id) ? 1 : 0.2,
          labelFontSize: 14 + radius / 4,
          labelAlwaysVisible: prior?.labelAlwaysVisible || isActive || selected || node.id === state.viewState.focusedNodeId,
          ...(selected || pinned ? {
            strokeColor: this.palette.nodeOutlineColor ?? this.palette.labelColor,
            strokeWidth: pinned ? 2 : 1,
          } : {}),
        }];
      }));
    const edgeContributions = Object.fromEntries(visibleEdges.map((edge) => {
      const prior = state.edgeContributions[edge.id];
      const incident = activeId !== undefined && (edge.sourceId === activeId || edge.targetId === activeId);
      return [edge.id, {
        ...prior,
        thickness: positive(prior?.baseThicknessScale, 1) * positive(prior?.thicknessScale, 1),
        opacity: activeId === undefined || incident ? 1 : 0.2,
        arrowColor: this.palette.arrowColor ?? this.palette.edgeColor,
        arrowOpacity: activeId === undefined || incident ? 1 : 0.2,
        ...(incident ? { color: this.palette.highlightNodeColor ?? this.palette.focusedNodeColor } : {}),
      }];
    }));
    return {
      nodeContributions,
      edgeContributions,
      theme: {
        ...state.theme,
        nodeScaleMode: 'sqrt-orthographic',
        labelScaleMode: 'sqrt-orthographic',
        labelPosition: this.labelPosition,
        minimumPerspectiveNodeRadius: 4,
        minimumPerspectiveTouchHitRadius: 22,
        edgeAggregation: 'unordered-pair',
        showArrows: state.theme.showArrows === true,
      },
    };
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

function positive(value: JsonValue | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
