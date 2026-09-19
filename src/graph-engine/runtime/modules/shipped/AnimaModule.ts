import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1, GraphModuleProjectionPatchV1 } from '../GraphModuleTypes.ts';
import { resolveAnimaNodeRadiusV1 } from './NodeGeometry.ts';

export class AnimaModule implements GraphModuleInstanceV1 {
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
    this.labelPosition = readLabelPosition(settings.labelPosition);
    this.adaptiveLabelThreshold2d = readThreshold(settings.adaptiveLabelThreshold2d, 50);
    this.adaptiveLabelThreshold3d = readThreshold(settings.adaptiveLabelThreshold3d, 50);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
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

  selectRender(
    state: Parameters<NonNullable<GraphModuleInstanceV1['selectRender']>>[0],
  ): GraphModuleProjectionPatchV1 {
    const visibleNodes = state.renderSelection.nodeIds;
    const { degree } = this.presentationTopology(state);
    return {
      nodeContributions: Object.fromEntries(state.document.nodes
        .filter((node) => visibleNodes.has(node.id))
        .map((node) => [node.id, {
          ...state.nodeContributions[node.id],
          radius: resolveAnimaNodeRadiusV1(degree.get(node.id) ?? 0, state.nodeContributions[node.id]),
        }])),
    };
  }

  contributeFrame(
    state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0],
  ): GraphModuleProjectionPatchV1 | void {
    const visibleNodes = state.renderSelection.nodeIds;
    const { visibleEdges, relationships, degree } = this.presentationTopology(state);
    const focusedId = state.viewState.focusedNodeId;
    const inspectedNeighborId = focusedId !== undefined
      && state.hoveredNodeId !== undefined
      && relationships.get(focusedId)?.has(state.hoveredNodeId)
      ? state.hoveredNodeId
      : undefined;
    const activeIds = state.draggedNodeId !== undefined
      ? new Set([state.draggedNodeId])
      : state.previewedNodeId !== undefined
        ? new Set([state.previewedNodeId])
        : new Set([
          ...(focusedId === undefined ? [] : [focusedId]),
          ...(inspectedNeighborId === undefined ? [] : [inspectedNeighborId]),
          ...(focusedId === undefined && state.hoveredNodeId !== undefined ? [state.hoveredNodeId] : []),
        ]);
    const activeNeighborhood = activeIds.size === 0
      ? undefined
      : new Set([...activeIds].flatMap((nodeId) => [nodeId, ...(relationships.get(nodeId) ?? [])]));
    const nodeContributions = Object.fromEntries(state.document.nodes
      .filter((node) => visibleNodes.has(node.id))
      .map((node) => {
        const prior = state.nodeContributions[node.id];
        const visibleDegree = degree.get(node.id) ?? 0;
        const radius = positive(prior?.radius, resolveAnimaNodeRadiusV1(visibleDegree, prior));
        const isActive = activeIds.has(node.id);
        const color = isActive
          ? this.palette.colors.animaAccent
          : state.viewState.focusedNodeId === node.id
            ? this.palette.colors.focusedNode
            : prior?.color ?? (node.tokens?.includes('kind:tag') ? this.palette.colors.tagNode : undefined) ?? this.palette.colors.node;
        const selected = state.viewState.selectedNodeIds.includes(node.id);
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        const suppressAdaptiveLabel = state.presentationPolicy?.labelMode === 'adaptive'
          && activeNeighborhood !== undefined
          && !activeNeighborhood.has(node.id);
        return [node.id, {
          ...prior,
          radius,
          finalColor: color,
          opacity: activeNeighborhood === undefined || activeNeighborhood.has(node.id) ? 1 : 0.2,
          labelOpacity: activeNeighborhood === undefined || activeNeighborhood.has(node.id) ? 1 : 0.2,
          showLabel: prior?.showLabel !== false && !suppressAdaptiveLabel,
          labelFontSize: 14 + radius / 4,
          labelAlwaysVisible: prior?.labelAlwaysVisible || isActive || selected || node.id === state.viewState.focusedNodeId,
          ...(selected || pinned ? {
            strokeColor: this.palette.colors.nodeOutline,
            strokeWidth: pinned ? 2 : 1,
          } : {}),
        }];
      }));
    const edgeContributions = Object.fromEntries(visibleEdges.map((edge) => {
      const prior = state.edgeContributions[edge.id];
      const incident = activeIds.has(edge.sourceId) || activeIds.has(edge.targetId);
      return [edge.id, {
        ...prior,
        thickness: positive(prior?.baseThicknessScale, 1) * positive(prior?.thicknessScale, 1),
        opacity: activeIds.size === 0 || incident ? 1 : 0.2,
        arrowColor: this.palette.colors.arrow,
        arrowOpacity: activeIds.size === 0 || incident ? 1 : 0.2,
        ...(incident ? { color: this.palette.colors.highlightedNode } : {}),
      }];
    }));
    return {
      nodeContributions,
      edgeContributions,
      presentationPolicy: {
        ...(state.presentationPolicy ?? {}),
        nodeScaleMode: 'sqrt-orthographic',
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

function positive(value: JsonValue | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
