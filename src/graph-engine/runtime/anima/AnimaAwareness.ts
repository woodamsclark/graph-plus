import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { GraphDocumentV1, GraphExperienceContractV1 } from '../../contracts/v1/index.ts';
import type {
  Attention,
  Awareness,
  ConsciousField,
  RememberedSubjects,
} from '../consciousness/index.ts';
import type { GraphInteractionContextV1, GraphUxStateV1 } from '../interaction/index.ts';
import { resolveOverviewConstellationV1 } from '../consciousness/Consciousness.ts';
import { previewGraphViewObjectActivationV1, type GraphViewObjectPreviewV1 } from '../anima/AnimaInteractionPreview.ts';

export type AnimaPresentationPhaseV1 = 'void' | 'dimmed' | 'standard' | 'highlighted';
/** @deprecated Use AnimaPresentationPhaseV1. */
export type AnimaPresentationRoleV1 = AnimaPresentationPhaseV1;
export type AnimaHighlightSourceV1 = 'awareness' | 'hover' | 'focus' | 'activity';

export interface AnimaHighlightSourcePolicyV1 {
  readonly enabled: boolean;
  readonly neighborhoodDepth: number;
}

export interface AnimaHighlightPolicyV1 {
  readonly sources: Readonly<Record<AnimaHighlightSourceV1, AnimaHighlightSourcePolicyV1>>;
  readonly highlightedRole: 'highlighted';
  readonly contextRole: Exclude<AnimaPresentationRoleV1, 'highlighted'>;
  readonly labels: 'delegate';
}

export interface AnimaHighlightPolicyOverrideV1 {
  readonly sources?: Readonly<Partial<Record<AnimaHighlightSourceV1, Partial<AnimaHighlightSourcePolicyV1>>>>;
  readonly contextRole?: AnimaHighlightPolicyV1['contextRole'];
}

export interface AnimaStatePresentationPolicyV1 {
  readonly renderScope: 'graph' | 'graph-with-awareness-emphasis' | 'focused-local-view';
  readonly highlightOverride?: AnimaHighlightPolicyOverrideV1;
}

export interface AnimaHighlightResultV1 {
  readonly policy: AnimaHighlightPolicyV1;
  readonly seedNodeIds: ReadonlySet<string>;
  readonly highlightedNodeIds: ReadonlySet<string>;
  readonly highlightedEdgeIds: ReadonlySet<string>;
  readonly hoverPathNodeIds: ReadonlySet<string>;
  readonly phaseByNodeId: Readonly<Record<string, AnimaPresentationPhaseV1>>;
  readonly phaseByEdgeId: Readonly<Record<string, AnimaPresentationPhaseV1>>;
}

export type AnimaLabelDispositionV1 = 'force' | 'favor' | 'raise' | 'suppress' | 'fallback';
export type AnimaConsciousnessClassV1 =
  | 'attended'
  | 'aware'
  | 'conscious-context'
  | 'unaware-context';

export interface AnimaConsciousnessClassesV1 {
  readonly byNodeId: Readonly<Record<string, AnimaConsciousnessClassV1>>;
  readonly attendedNodeIds: ReadonlySet<string>;
  readonly awareNodeIds: ReadonlySet<string>;
  readonly consciousContextNodeIds: ReadonlySet<string>;
  readonly unawareContextNodeIds: ReadonlySet<string>;
}

export type AnimaLabelReasonV1 =
  | 'hover' | 'hover-neighbor' | 'hover-path' | 'attended' | 'remembered' | 'aware' | 'dimmed' | 'slider';

export interface AnimaLabelDecisionV1 {
  readonly disposition: AnimaLabelDispositionV1;
  readonly reason: AnimaLabelReasonV1;
  readonly priority: number;
  readonly saliencyBoost?: number;
}

export interface AnimaLabelRaisingV1 {
  readonly byNodeId: Readonly<Record<string, AnimaLabelDecisionV1>>;
}

export interface AnimaConsciousnessPresentationV1 {
  /** Prospective presentation facts, never written back to View or Consciousness. */
  readonly objectPreview?: GraphViewObjectPreviewV1;
  readonly sceneInteraction: GraphInteractionContextV1;
  readonly statePolicy: AnimaStatePresentationPolicyV1;
  readonly consciousnessClasses: AnimaConsciousnessClassesV1;
  readonly highlight: AnimaHighlightResultV1;
  readonly labelRaising: AnimaLabelRaisingV1;
}

/** @deprecated Use AnimaConsciousnessPresentationV1. */
export type AnimaAwarenessPresentationV1 = AnimaConsciousnessPresentationV1;

export const ANIMA_HIGHLIGHT_POLICY_V1: AnimaHighlightPolicyV1 = Object.freeze({
  sources: Object.freeze({
    awareness: Object.freeze({ enabled: true, neighborhoodDepth: 0 }),
    hover: Object.freeze({ enabled: true, neighborhoodDepth: 0 }),
    focus: Object.freeze({ enabled: true, neighborhoodDepth: 1 }),
    activity: Object.freeze({ enabled: true, neighborhoodDepth: 1 }),
  }),
  highlightedRole: 'highlighted',
  contextRole: 'standard',
  labels: 'delegate',
});

export const ANIMA_STATE_PRESENTATION_POLICIES_V1: Readonly<
  Record<GraphUxStateV1, AnimaStatePresentationPolicyV1>
> = {
  overview: {
    renderScope: 'graph',
    highlightOverride: {
      sources: { focus: { enabled: false }, hover: { enabled: false } },
      contextRole: 'standard',
    },
  },
  explore: {
    renderScope: 'graph-with-awareness-emphasis',
    highlightOverride: {
      sources: {
        awareness: { neighborhoodDepth: 0 },
        focus: { enabled: false },
        hover: { enabled: false },
        activity: { enabled: false },
      },
      contextRole: 'dimmed',
    },
  },
  focus: {
    renderScope: 'focused-local-view',
    highlightOverride: {
      sources: {
        awareness: { neighborhoodDepth: 0 },
        hover: { enabled: false },
        focus: { neighborhoodDepth: 0 },
        activity: { enabled: false },
      },
      contextRole: 'void',
    },
  },
};

export function createAnimaConsciousnessPresentationV1(options: {
  readonly attention: Attention;
  readonly awareness: Awareness;
  readonly consciousField?: ConsciousField;
  readonly remembered?: RememberedSubjects;
  readonly interaction: GraphInteractionContextV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly experience?: GraphExperienceContractV1;
  readonly ctrlHover?: boolean;
  /** Session admission result; null means no admitted preview. Pure callers may omit it. */
  readonly objectActivationPreview?: GraphViewObjectPreviewV1 | null;
}): AnimaConsciousnessPresentationV1 {
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const getConstellation = (id: string): readonly string[] => {
    const relationships = new Map<string, Set<string>>();
    for (const id of visibleNodeIds) relationships.set(id, new Set());
    for (const edge of options.document.edges) {
      if (options.visibleEdgeIds && !options.visibleEdgeIds.has(edge.id)) continue;
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) continue;
      relationships.get(edge.sourceId)?.add(edge.targetId);
      relationships.get(edge.targetId)?.add(edge.sourceId);
    }
    return resolveOverviewConstellationV1(id, visibleNodeIds,
      options.awareness.nodeIds, relationships)?.nodeIds ?? [];
  };
  const hovered = options.interaction.hoveredNodeId;
  const objectPreview = options.objectActivationPreview !== undefined
    ? options.objectActivationPreview ?? undefined
    : hovered !== undefined && visibleNodeIds.has(hovered)
    ? previewGraphViewObjectActivationV1({
      viewId: options.interaction.state, nodeId: hovered, ctrl: options.ctrlHover,
      attentionNodeIds: [...options.attention.nodeIds], focusedNodeId: options.interaction.focusedNodeId,
      getConstellation,
      hoverPath: { edges: options.document.edges, visibleNodeIds,
        visibleEdgeIds: options.visibleEdgeIds ?? new Set(options.document.edges.map((edge) => edge.id)),
        targetNodeIds: options.interaction.state === 'overview' ? options.awareness.nodeIds : options.attention.nodeIds },
      identity: { documentId: options.document.documentId, documentRevision: options.document.revision },
      experience: options.experience,
    }) : undefined;
  const preserveOverview = GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.hoverContext === 'preserve-overview';
  const sceneInteraction: GraphInteractionContextV1 = objectPreview ? {
    ...options.interaction, state: preserveOverview ? 'overview' : objectPreview.viewId,
    mode: preserveOverview ? 'overview' : objectPreview.viewId,
    selectedNodeIds: new Set(objectPreview.attentionNodeIds), focusedNodeId: objectPreview.focusedNodeId,
  } : options.interaction;
  const sceneOptions = {
    ...options, interaction: sceneInteraction,
    attention: objectPreview ? { nodeIds: new Set(objectPreview.attentionNodeIds) } : options.attention,
    awareness: objectPreview?.activation === 'toggle-membership'
      ? { nodeIds: new Set([...(options.remembered?.nodeIds ?? []), ...objectPreview.attentionNodeIds]) }
      : objectPreview && preserveOverview
        ? { nodeIds: new Set([...options.awareness.nodeIds, ...objectPreview.attentionNodeIds]) }
        : options.awareness,
  };
  const statePolicy = ANIMA_STATE_PRESENTATION_POLICIES_V1[sceneInteraction.state];
  // Classification describes realized truth; only its visual expression is previewed.
  const consciousnessClasses = classifyAnimaConsciousnessV1({
    attention: options.attention, awareness: options.awareness,
    consciousField: options.consciousField, projectedNodeIds: visibleNodeIds,
  });
  const highlight = resolveAnimaHighlightV1({ ...sceneOptions, statePolicy,
    hoverPathNodeIds: new Set(objectPreview?.hoverPathNodeIds ?? []) });
  const removedMemberId = objectPreview?.activation === 'toggle-membership' && hovered !== undefined
    && options.attention.nodeIds.has(hovered) && !objectPreview.attentionNodeIds.includes(hovered) ? hovered : undefined;
  return {
    objectPreview, sceneInteraction, statePolicy, consciousnessClasses, highlight,
    labelRaising: resolveAnimaLabelRaisingV1({ ...sceneOptions, consciousnessClasses, highlight, removedMemberId }),
  };
}

/** @deprecated Use createAnimaConsciousnessPresentationV1. */
export const createAnimaAwarenessPresentationV1 = createAnimaConsciousnessPresentationV1;

/** Classifies every projected subject before Anima assigns any visual expression. */
export function classifyAnimaConsciousnessV1(options: {
  readonly attention: Attention;
  readonly awareness: Awareness;
  readonly consciousField?: ConsciousField;
  readonly projectedNodeIds: ReadonlySet<string>;
}): AnimaConsciousnessClassesV1 {
  const attendedNodeIds = new Set<string>();
  const awareNodeIds = new Set<string>();
  const consciousContextNodeIds = new Set<string>();
  const unawareContextNodeIds = new Set<string>();
  const byNodeId: Record<string, AnimaConsciousnessClassV1> = {};
  for (const nodeId of options.projectedNodeIds) {
    const classification: AnimaConsciousnessClassV1 = options.attention.nodeIds.has(nodeId)
      ? 'attended'
      : options.awareness.nodeIds.has(nodeId)
        ? 'aware'
        : options.consciousField?.nodeIds.has(nodeId)
          ? 'conscious-context'
          : 'unaware-context';
    byNodeId[nodeId] = classification;
    if (classification === 'attended') attendedNodeIds.add(nodeId);
    else if (classification === 'aware') awareNodeIds.add(nodeId);
    else if (classification === 'conscious-context') consciousContextNodeIds.add(nodeId);
    else unawareContextNodeIds.add(nodeId);
  }
  return {
    byNodeId,
    attendedNodeIds,
    awareNodeIds,
    consciousContextNodeIds,
    unawareContextNodeIds,
  };
}

export function resolveAnimaHighlightPolicyV1(
  interaction: GraphInteractionContextV1,
  statePolicy: AnimaStatePresentationPolicyV1 = ANIMA_STATE_PRESENTATION_POLICIES_V1[interaction.state],
  globalPolicy: AnimaHighlightPolicyV1 = ANIMA_HIGHLIGHT_POLICY_V1,
): AnimaHighlightPolicyV1 {
  const override = statePolicy.highlightOverride;
  const source = (name: AnimaHighlightSourceV1): AnimaHighlightSourcePolicyV1 => ({
    ...globalPolicy.sources[name],
    ...(override?.sources?.[name] ?? {}),
  });
  return {
    sources: {
      awareness: source('awareness'), hover: source('hover'),
      focus: source('focus'), activity: source('activity'),
    },
    highlightedRole: globalPolicy.highlightedRole,
    contextRole: override?.contextRole ?? globalPolicy.contextRole,
    labels: globalPolicy.labels,
  };
}

function resolveAnimaHighlightV1(options: {
  readonly attention: Attention;
  readonly awareness: Awareness;
  readonly consciousField?: ConsciousField;
  readonly remembered?: RememberedSubjects;
  readonly interaction: GraphInteractionContextV1;
  readonly statePolicy: AnimaStatePresentationPolicyV1;
  readonly hoverPathNodeIds: ReadonlySet<string>;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
}): AnimaHighlightResultV1 {
  const policy = resolveAnimaHighlightPolicyV1(options.interaction, options.statePolicy);
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const visibleEdges = options.document.edges.filter((edge) => (
    (options.visibleEdgeIds === undefined || options.visibleEdgeIds.has(edge.id))
      && visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)
  ));
  const relationships = new Map<string, Set<string>>();
  for (const nodeId of visibleNodeIds) relationships.set(nodeId, new Set());
  for (const edge of visibleEdges) {
    relationships.get(edge.sourceId)?.add(edge.targetId);
    relationships.get(edge.targetId)?.add(edge.sourceId);
  }
  const sourceSeeds: Readonly<Record<AnimaHighlightSourceV1, ReadonlySet<string>>> = {
    awareness: new Set([...(options.interaction.state === 'overview'
      ? options.awareness.nodeIds : options.attention.nodeIds)].filter((id) => visibleNodeIds.has(id))),
    hover: singleton(options.interaction.hoveredNodeId, visibleNodeIds),
    focus: singleton(options.interaction.focusedNodeId, visibleNodeIds),
    activity: new Set([...(GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.dragHighlights === 'preserve-scene'
      ? [] : [options.interaction.draggedNodeId]), options.interaction.previewedNodeId]
      .filter((id): id is string => id !== undefined && visibleNodeIds.has(id))),
  };
  const seedNodeIds = new Set<string>();
  const highlightedNodeIds = new Set<string>();
  for (const sourceName of ['awareness', 'hover', 'focus', 'activity'] as const) {
    const sourcePolicy = policy.sources[sourceName];
    if (!sourcePolicy.enabled) continue;
    const seeds = sourceSeeds[sourceName];
    for (const seed of seeds) seedNodeIds.add(seed);
    expandNeighborhood(seeds, sourcePolicy.neighborhoodDepth, relationships, highlightedNodeIds);
  }
  const focusScopeNodeIds = new Set(sourceSeeds.awareness);
  if (options.interaction.focusedNodeId !== undefined) {
    for (const neighbor of relationships.get(options.interaction.focusedNodeId) ?? []) {
      focusScopeNodeIds.add(neighbor);
    }
  }
  const hoverPathNodeIds = new Set([...options.hoverPathNodeIds].filter((id) => visibleNodeIds.has(id)));
  for (const id of hoverPathNodeIds) highlightedNodeIds.add(id);
  const context = GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.context;
  const baseNodePhase: AnimaPresentationPhaseV1 = context === 'standard'
    ? 'standard' : context === 'dimmed' ? 'dimmed' : 'void';
  const phaseByNodeId = Object.fromEntries([...visibleNodeIds].map((nodeId) => {
    let phase: AnimaPresentationPhaseV1 = baseNodePhase;
    if (options.interaction.state === 'focus' && focusScopeNodeIds.has(nodeId)) phase = 'dimmed';
    if (highlightedNodeIds.has(nodeId)) phase = 'highlighted';
    return [nodeId, phase];
  })) as Record<string, AnimaPresentationPhaseV1>;
  const phaseByEdgeId = Object.fromEntries(visibleEdges.map((edge) => [
    edge.id,
    weakerPhase(phaseByNodeId[edge.sourceId] ?? 'void', phaseByNodeId[edge.targetId] ?? 'void'),
  ])) as Record<string, AnimaPresentationPhaseV1>;
  const highlightedEdgeIds = new Set(visibleEdges
    .filter((edge) => phaseByEdgeId[edge.id] === 'highlighted')
    .map((edge) => edge.id));
  return {
    policy, seedNodeIds, highlightedNodeIds, highlightedEdgeIds, hoverPathNodeIds,
    phaseByNodeId, phaseByEdgeId,
  };
}

function resolveAnimaLabelRaisingV1(options: {
  readonly attention: Attention;
  readonly awareness: Awareness;
  readonly interaction: GraphInteractionContextV1;
  readonly consciousnessClasses: AnimaConsciousnessClassesV1;
  readonly remembered?: RememberedSubjects;
  readonly highlight: AnimaHighlightResultV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly removedMemberId?: string;
}): AnimaLabelRaisingV1 {
  const policy = GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.labels;
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  return { byNodeId: Object.fromEntries([...visibleNodeIds].map((nodeId): [string, AnimaLabelDecisionV1] => {
    const phase = options.highlight.phaseByNodeId[nodeId] ?? 'void';
    if (nodeId === options.removedMemberId) {
      return [nodeId, { disposition: policy.removedMember, reason: 'dimmed', priority: 2 }];
    }
    if (phase !== 'void' && nodeId === options.interaction.focusedNodeId) {
      return [nodeId, { disposition: policy.focused, reason: 'attended', priority: 7 }];
    }
    if (phase !== 'void' && nodeId === options.interaction.hoveredNodeId) {
      return [nodeId, { disposition: policy.hovered, reason: 'hover', priority: 6 }];
    }
    if (phase === 'highlighted') {
      return [nodeId, {
        disposition: policy.highlighted,
        reason: nodeId === options.interaction.hoveredNodeId
          ? 'hover'
          : options.remembered?.nodeIds.has(nodeId)
            ? 'remembered'
            : options.attention.nodeIds.has(nodeId)
              ? 'attended'
              : options.awareness.nodeIds.has(nodeId)
                ? 'aware'
                : options.highlight.hoverPathNodeIds.has(nodeId)
                  ? 'hover-path'
                  : 'aware',
        priority: 5,
      }];
    }
    if (phase === 'dimmed' || phase === 'void') {
      return [nodeId, { disposition: policy[phase], reason: 'dimmed', priority: 2 }];
    }
    return [nodeId, { disposition: policy.standard, reason: 'slider', priority: 1 }];
  })) };
}

function phaseRank(phase: AnimaPresentationPhaseV1): number {
  return phase === 'void' ? 0 : phase === 'dimmed' ? 1 : phase === 'standard' ? 2 : 3;
}

function weakerPhase(
  left: AnimaPresentationPhaseV1,
  right: AnimaPresentationPhaseV1,
): AnimaPresentationPhaseV1 {
  return phaseRank(left) <= phaseRank(right) ? left : right;
}

function singleton(nodeId: string | undefined, visible: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(nodeId !== undefined && visible.has(nodeId) ? [nodeId] : []);
}

function expandNeighborhood(
  seeds: ReadonlySet<string>, depth: number,
  relationships: ReadonlyMap<string, ReadonlySet<string>>, target: Set<string>,
): void {
  let frontier = new Set(seeds);
  for (const seed of seeds) target.add(seed);
  for (let step = 0; step < Math.max(0, Math.floor(depth)); step += 1) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      for (const neighborId of relationships.get(nodeId) ?? []) {
        if (!target.has(neighborId)) next.add(neighborId);
        target.add(neighborId);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
}
