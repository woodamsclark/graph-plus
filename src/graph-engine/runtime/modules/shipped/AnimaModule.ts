import type { JsonValue } from '../../../contracts/v1/index.ts';
import { desaturateGraphColorV2, type GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1, GraphModulePresentationPatchV1 } from '../GraphModuleTypes.ts';
import { GraphLabelManager, type GraphLabelRequestV1 } from './GraphLabelManager.ts';
import {
  createAnimaConsciousnessPresentationV1,
} from '../../anima/AnimaAwareness.ts';
import { animaPhaseOpacity, animaMemoryColor } from '../../anima/AnimaPresentationValues.ts';
import { createGraphInteractionContextV1 } from '../../interaction/index.ts';

type PresentationState = Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0];

export class AnimaModule implements GraphModuleInstanceV1 {
  readonly geometryIndependentPresentation = true;
  private structuralBuilds = 0;
  private presentationBuilds = 0;
  private presentationCache?: { state: PresentationState; key: string; patch: GraphModulePresentationPatchV1 };
  private structuralCache?: { state: PresentationState;
    nodes: readonly { node: PresentationState['document']['nodes'][number]; prior: PresentationState['nodeContributions'][string]; radius: number }[];
    edges: readonly { edge: PresentationState['document']['edges'][number]; prior: PresentationState['edgeContributions'][string]; thickness: number }[];
    smallestRadius: number; largestRadius: number;
  };
  getPresentationCacheDiagnostics() { return { structuralBuilds: this.structuralBuilds, presentationBuilds: this.presentationBuilds }; }
  private readonly labels: GraphLabelManager;
  private topologyCache?: {
    readonly document: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document'];
    readonly nodeIds: ReadonlySet<string>;
    readonly edgeIds: ReadonlySet<string>;
    readonly visibleEdges: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]['document']['edges'];
    readonly degree: ReadonlyMap<string, number>;
  };

  private cursorGravity: 'soft' | 'clingy' | 'off' = 'clingy';

  constructor(
    private palette: GraphVisualThemeV2,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.labels = new GraphLabelManager(settings);
    this.updateSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.presentationCache = undefined;
    this.labels.updateSettings(settings);
    this.cursorGravity = settings.cursorGravity === 'soft' || settings.cursorGravity === 'off' ? settings.cursorGravity : 'clingy';
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
    const key = JSON.stringify([state.viewState.dimensions, state.viewState.viewMode, state.viewState.focusedNodeId,
      state.viewState.pinnedNodeIds, state.hoveredNodeId, state.draggedNodeId,
      state.previewedNodeId, state.selectionPresentationSuspended, state.selectionNeighborRevealActive, state.objectActivationPreview]);
    const cached = this.presentationCache;
    if (cached && cached.key === key && sameStructuralInputs(cached.state, state)
      && cached.state.consciousness === state.consciousness && cached.state.experience === state.experience
      && cached.state.presentationPolicy === state.presentationPolicy
      && cached.state.animaPresentation === state.animaPresentation) return cached.patch;
    this.presentationBuilds += 1;
    const hoveredId = state.hoveredNodeId;
    const consciousness = state.consciousness;
    const interaction = createGraphInteractionContextV1({
      viewState: state.viewState,
      ...(hoveredId === undefined ? {} : { hoveredNodeId: hoveredId }),
      ...(state.draggedNodeId === undefined ? {} : { draggedNodeId: state.draggedNodeId }),
      ...(state.previewedNodeId === undefined ? {} : { previewedNodeId: state.previewedNodeId }),
      selectionPresentationSuspended: state.selectionPresentationSuspended,
      selectionNeighborRevealActive: state.selectionNeighborRevealActive,
    });
    const presentation = state.animaPresentation ?? createAnimaConsciousnessPresentationV1({
      attention: consciousness.attention,
      awareness: consciousness.awareness,
      consciousField: consciousness.consciousField,
      remembered: consciousness.remembered,
      interaction,
      experience: state.experience,
      objectActivationPreview: state.objectActivationPreview,
      document: state.document,
      visibleNodeIds: state.renderSelection.nodeIds,
      visibleEdgeIds: state.renderSelection.edgeIds,
    });
    const { nodes: nodesWithRadius, edges: edgesWithThickness, smallestRadius, largestRadius } = this.structuralPresentation(state);
    // Fixed former 100% contrast: smallest nodes respond gently, largest most strongly.
    const maximumScaleExponent = 2;
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
        const role = presentation.highlight.phaseByNodeId[node.id] ?? 'void';
        const ordinaryColor = prior?.color
          ?? (node.tokens?.includes('kind:tag') ? this.palette.colors.tagNode : undefined)
          ?? this.palette.colors.node;
        const memory = presentation.constellationKindByNodeId[node.id] === 'memory';
        const color = memory ? animaMemoryColor(
          this.palette.colors.memoryConstellation,
          presentation.memoryStrengthByNodeId[node.id] ?? 1,
        ) : role === 'highlighted'
          ? this.palette.colors.animaAccent
          : role === 'dimmed'
            ? desaturateGraphColorV2(ordinaryColor, 0.8)
            : ordinaryColor;
        const selected = presentation.expressedAttentionNodeIds.has(node.id);
        const focused = presentation.focusEmphasisNodeIds.has(node.id);
        const pinned = state.viewState.pinnedNodeIds.includes(node.id);
        const opacity = animaPhaseOpacity(role, 'node');
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
          ...(selected || pinned || focused ? {
            strokeColor: this.palette.colors.nodeOutline,
            strokeWidth: focused ? 3 : pinned ? 2 : 1,
          } : {}),
        }];
      }));
    const edgeContributions = Object.fromEntries(edgesWithThickness.map(({ edge, prior, thickness }) => {
      const kind = presentation.constellationKindByEdgeId[edge.id];
      const lit = presentation.highlight.highlightedEdgeIds.has(edge.id) && kind === 'ego';
      const memory = kind === 'memory';
      const memoryStrength = Math.min(
        presentation.memoryStrengthByNodeId[edge.sourceId] ?? 1,
        presentation.memoryStrengthByNodeId[edge.targetId] ?? 1,
      );
      const role = presentation.highlight.phaseByEdgeId[edge.id] ?? 'void';
      const opacity = animaPhaseOpacity(role, 'edge');
      const ordinaryColor = prior?.color ?? this.palette.colors.edge;
      const ordinaryArrowColor = prior?.arrowColor ?? this.palette.colors.arrow;
      return [edge.id, {
        ...prior,
        thickness,
        opacity,
        color: memory ? animaMemoryColor(this.palette.colors.memoryConstellation, memoryStrength) : lit
          ? this.palette.colors.highlightedNode
          : role === 'dimmed'
            ? desaturateGraphColorV2(ordinaryColor, 0.8)
            : ordinaryColor,
        arrowColor: memory ? animaMemoryColor(this.palette.colors.memoryConstellation, memoryStrength) : role === 'dimmed'
          ? desaturateGraphColorV2(ordinaryArrowColor, 0.8)
          : ordinaryArrowColor,
        arrowOpacity: opacity,
      }];
    }));
    const patch: GraphModulePresentationPatchV1 = {
      nodeContributions,
      edgeContributions,
      presentationPolicy: {
        ...(state.presentationPolicy ?? {}),
        ...this.labels.policy(state.viewState.dimensions),
        cursorAttractionRadiusPx: this.cursorGravity === 'off' ? 0 : 16,
        cursorAttractionMode: this.cursorGravity,
        nodeScaleMode: 'sqrt-orthographic',
        nodeScaleExponent: 0.5,
        minimumPerspectiveNodeRadius: 4,
        minimumPerspectiveNodeScale: 0.5,
        minimumPerspectiveTouchHitRadius: 22,
        edgeAggregation: 'unordered-pair',
        showArrows: state.presentationPolicy?.showArrows === true,
      },
    };
    this.presentationCache = { state, key, patch };
    return patch;
  }

  onThemeChanged(theme: GraphVisualThemeV2): void {
    this.presentationCache = undefined;
    this.structuralCache = undefined;
    this.palette = theme;
  }

  private structuralPresentation(state: PresentationState): NonNullable<AnimaModule['structuralCache']> {
    if (this.structuralCache && sameStructuralInputs(this.structuralCache.state, state)) return this.structuralCache;
    this.structuralBuilds += 1;
    const visibleNodes = state.renderSelection.nodeIds;
    const { visibleEdges, degree } = this.presentationTopology(state);
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
    const edges = visibleEdges.map(edge => {
      const prior = state.edgeContributions[edge.id];
      return { edge, prior, thickness: positive(prior?.baseThicknessScale, 1) * positive(prior?.thicknessScale, 1) };
    });
    return this.structuralCache = { state, nodes: nodesWithRadius, edges, smallestRadius, largestRadius };
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
    const degreeKeys = new Map<string, Set<string>>();
    for (const nodeId of visibleNodes) {
      degreeKeys.set(nodeId, new Set());
    }
    for (const edge of visibleEdges) {
      if (edge.sourceId === edge.targetId) continue;
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
      degree: new Map([...degreeKeys].map(([id, keys]) => [id, keys.size])),
    };
    this.topologyCache = next;
    return next;
  }
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

function sameStructuralInputs(a: PresentationState, b: PresentationState): boolean {
  return a.document === b.document && a.renderSelection.nodeIds === b.renderSelection.nodeIds
    && a.renderSelection.edgeIds === b.renderSelection.edgeIds && a.nodeContributions === b.nodeContributions
    && a.edgeContributions === b.edgeContributions && a.theme === b.theme;
}
