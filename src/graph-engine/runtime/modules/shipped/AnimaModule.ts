import type { JsonValue } from '../../../contracts/v1/index.ts';
import { desaturateGraphColorV2, type GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1, GraphModulePresentationPatchV1 } from '../GraphModuleTypes.ts';
import { GraphLabelManager, type GraphLabelRequestV1 } from './GraphLabelManager.ts';
import {
  createAnimaConsciousnessPresentationV1,
  type AnimaPresentationRoleV1,
} from '../../anima/AnimaAwareness.ts';
import { createGraphInteractionContextV1 } from '../../interaction/index.ts';

const PRESENTATION_ROLE_OPACITY: Readonly<Record<
  AnimaPresentationRoleV1,
  Readonly<{ node: number; edge: number }>
>> = {
  normal: { node: 1, edge: 1 },
  highlighted: { node: 1, edge: 1 },
  dimmed: { node: 0.24, edge: 0.6 },
  hidden: { node: 0, edge: 0 },
};

export class AnimaModule implements GraphModuleInstanceV1 {
  private nodeZoomContrast: number;
  private readonly labels: GraphLabelManager;
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
    this.labels = new GraphLabelManager(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.nodeZoomContrast = readUnitInterval(settings.nodeWorldScaleBlend, 0);
    this.labels.updateSettings(settings);
  }

  restoreState(state: JsonValue): void {
    if (state !== null) throw new Error('Anima V1 state must be null.');
  }

  exportState(): JsonValue {
    return null;
  }

  contributeFrame(
    state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0],
  ): GraphModulePresentationPatchV1 | void {
    const visibleNodes = state.renderSelection.nodeIds;
    const { visibleEdges, relationships, degree } = this.presentationTopology(state);
    const hoveredId = state.hoveredNodeId;
    const transientId = state.draggedNodeId ?? state.previewedNodeId;
    const transientNeighborhood = transientId === undefined
      ? undefined
      : new Set([transientId, ...(relationships.get(transientId) ?? [])]);
    const consciousness = state.consciousness;
    const interaction = createGraphInteractionContextV1({
      viewState: state.viewState,
      ...(hoveredId === undefined ? {} : { hoveredNodeId: hoveredId }),
      ...(state.draggedNodeId === undefined ? {} : { draggedNodeId: state.draggedNodeId }),
      ...(state.previewedNodeId === undefined ? {} : { previewedNodeId: state.previewedNodeId }),
      selectionPresentationSuspended: state.selectionPresentationSuspended,
      selectionNeighborRevealActive: state.selectionNeighborRevealActive,
    });
    const presentation = createAnimaConsciousnessPresentationV1({
      attention: consciousness.attention,
      awareness: consciousness.awareness,
      interaction,
      document: state.document,
      visibleNodeIds: state.renderSelection.nodeIds,
      visibleEdgeIds: state.renderSelection.edgeIds,
    });
    const localFocusActive = presentation.statePolicy.renderScope === 'focused-local-view';
    const awarenessEmphasisActive = presentation.statePolicy.renderScope === 'graph-with-awareness-emphasis';
    const exploreActive = awarenessEmphasisActive
      && state.selectionPresentationSuspended !== true;
    const visibleIds = localFocusActive
      ? presentation.highlight.highlightedNodeIds
      : awarenessEmphasisActive
        ? exploreActive
          ? new Set([
            ...presentation.consciousnessClasses.attendedNodeIds,
            ...presentation.consciousnessClasses.peripherallyAwareNodeIds,
          ])
          : undefined
        : transientNeighborhood;
    const litNodeIds = presentation.highlight.highlightedNodeIds;
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
    const labelRequests: GraphLabelRequestV1[] = Object.entries(presentation.labelRaising.byNodeId)
      .filter(([, decision]) => decision.disposition === 'force'
        || decision.disposition === 'favor'
        || decision.disposition === 'raise')
      .map(([nodeId, decision]) => ({
        nodeId,
        forceVisible: decision.disposition === 'force',
        alwaysVisible: decision.disposition === 'force' || decision.disposition === 'raise',
        statePriority: decision.priority,
        saliencyBoost: decision.saliencyBoost,
      }));
    const labelContributions = this.labels.resolve(nodesWithRadius.map(({ node, prior, radius }) => ({
      nodeId: node.id,
      radius,
      prior,
    })), labelRequests);
    const nodeContributions = Object.fromEntries(nodesWithRadius
      .map(({ node, prior, radius }) => {
        const isLit = litNodeIds.has(node.id);
        const visible = visibleIds === undefined || visibleIds.has(node.id);
        const role = isLit
          ? presentation.highlight.policy.highlightedRole
          : visible
            ? 'normal'
            : presentation.highlight.policy.contextRole;
        const ordinaryColor = prior?.color
          ?? (node.tokens?.includes('kind:tag') ? this.palette.colors.tagNode : undefined)
          ?? this.palette.colors.node;
        const color = role === 'highlighted'
          ? this.palette.colors.animaAccent
          : role === 'dimmed'
            ? desaturateGraphColorV2(ordinaryColor, 0.8)
            : ordinaryColor;
        const selected = presentation.consciousnessClasses.byNodeId[node.id] === 'attended';
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        const opacity = PRESENTATION_ROLE_OPACITY[role].node;
        const labelDecision = presentation.labelRaising.byNodeId[node.id];
        return [node.id, {
          ...prior,
          ...labelContributions[node.id],
          radius,
          nodeScaleExponent: lerp(0.5, maximumScaleExponent,
            normalize(radius, smallestRadius, largestRadius)),
          finalColor: color,
          opacity,
          ...(labelDecision?.disposition === 'suppress' ? { showLabel: false, labelOpacity: 0 } : {}),
          ...(selected || pinned ? {
            strokeColor: this.palette.colors.nodeOutline,
            strokeWidth: pinned ? 2 : 1,
          } : {}),
        }];
      }));
    const edgeContributions = Object.fromEntries(visibleEdges.map((edge) => {
      const prior = state.edgeContributions[edge.id];
      const lit = presentation.highlight.highlightedEdgeIds.has(edge.id);
      const visible = localFocusActive
        ? lit
        : visibleIds === undefined || lit;
      const role = lit
        ? presentation.highlight.policy.highlightedRole
        : visible
          ? 'normal'
          : presentation.highlight.policy.contextRole;
      const opacity = PRESENTATION_ROLE_OPACITY[role].edge;
      return [edge.id, {
        ...prior,
        thickness: positive(prior?.baseThicknessScale, 1) * positive(prior?.thicknessScale, 1),
        opacity,
        arrowColor: this.palette.colors.arrow,
        arrowOpacity: opacity,
        ...(lit ? { color: this.palette.colors.highlightedNode } : {}),
      }];
    }));
    return {
      nodeContributions,
      edgeContributions,
      presentationPolicy: {
        ...(state.presentationPolicy ?? {}),
        ...this.labels.policy(state.viewState.dimensions),
        nodeScaleMode: 'sqrt-orthographic',
        nodeScaleExponent: 0.5,
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

function positive(value: JsonValue | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
