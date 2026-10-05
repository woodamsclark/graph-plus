import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { GraphDocumentV1, GraphExperienceContractV1 } from '../../contracts/v1/index.ts';
import type {
  Attention,
  Awareness,
  ConsciousField,
  RememberedSubjects,
  Constellation,
} from '../consciousness/index.ts';
import type { GraphInteractionContextV1, GraphUxStateV1 } from '../interaction/index.ts';
import { resolveOverviewConstellationFromSourcesV1 } from '../consciousness/Consciousness.ts';
import { previewGraphObjectInteractionV1, type GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';

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
  readonly objectPreview?: GraphInteractionPreviewV1;
  /** Committed interaction: preview cannot substitute a View or Focus subject. */
  readonly interaction: GraphInteractionContextV1;
  readonly expressedAttentionNodeIds: ReadonlySet<string>;
  readonly focusEmphasisNodeIds: ReadonlySet<string>;
  readonly statePolicy: AnimaStatePresentationPolicyV1;
  readonly consciousnessClasses: AnimaConsciousnessClassesV1;
  /** Source identity is independent of highlight phase and never inferred from color. */
  readonly constellationKindByNodeId: Readonly<Record<string, Constellation['kind']>>;
  readonly constellationKindByEdgeId: Readonly<Record<string, Constellation['kind']>>;
  /** Oldest-to-newest Memory order resolves to 25%, 50%, and 100% color strength. */
  readonly memoryStrengthByNodeId: Readonly<Record<string, number>>;
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
      // Note-content inspection must not relight a Ctrl no-change/removal target.
      sources: { focus: { enabled: false }, hover: { enabled: false }, activity: { enabled: false } },
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
  readonly objectActivationPreview?: GraphInteractionPreviewV1 | null;
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
    return resolveOverviewConstellationFromSourcesV1(id, visibleNodeIds, {
      attention: options.attention.nodeIds, remembered: options.remembered?.nodeIds ?? new Set(),
    }, relationships)?.nodeIds ?? [];
  };
  const hovered = options.interaction.hoveredNodeId;
  const objectPreview = options.objectActivationPreview !== undefined
    ? options.objectActivationPreview ?? undefined
    : hovered !== undefined && visibleNodeIds.has(hovered)
    ? previewGraphObjectInteractionV1({
      viewId: options.interaction.state, nodeId: hovered, ctrl: options.ctrlHover,
      attentionNodeIds: [...options.attention.nodeIds], focusedNodeId: options.interaction.focusedNodeId,
      getConstellation,
      hoverPath: { edges: options.document.edges, visibleNodeIds,
        visibleEdgeIds: options.visibleEdgeIds ?? new Set(options.document.edges.map((edge) => edge.id)),
        targetNodeIds: options.attention.nodeIds },
      identity: { documentId: options.document.documentId, documentRevision: options.document.revision },
      experience: options.experience,
      rememberedNodeIds: options.remembered?.nodeIds,
    }) : undefined;
  // Overview expresses a local neighborhood, independently of the admitted
  // click destination. Will still owns Constellation entry on activation.
  const overviewNeighborReveal = options.interaction.state === 'overview'
    && hovered !== undefined && !options.ctrlHover && objectPreview?.activation === 'primary';
  const presentationPreview = overviewNeighborReveal ? undefined : objectPreview;
  const removedNodeIds = new Set(presentationPreview?.removedNodeIds ?? []);
  const expressedAttentionNodeIds = new Set([...options.attention.nodeIds].filter((id) => !removedNodeIds.has(id)));
  for (const id of presentationPreview?.addedNodeIds ?? []) expressedAttentionNodeIds.add(id);
  const viewTransition = presentationPreview?.kind === 'view-transition' ? presentationPreview.resultingState : undefined;
  const sceneInteraction: GraphInteractionContextV1 = viewTransition ? {
    ...options.interaction, state: viewTransition.viewId, mode: viewTransition.viewId,
    focusedNodeId: viewTransition.focusedNodeId, selectedNodeIds: new Set(viewTransition.attentionNodeIds),
  } : options.interaction;
  const focusEmphasisNodeIds = new Set<string>();
  if (sceneInteraction.focusedNodeId !== undefined && !removedNodeIds.has(sceneInteraction.focusedNodeId)) {
    focusEmphasisNodeIds.add(sceneInteraction.focusedNodeId);
  }
  if (presentationPreview?.focusNodeId !== undefined) focusEmphasisNodeIds.add(presentationPreview.focusNodeId);
  const statePolicy = ANIMA_STATE_PRESENTATION_POLICIES_V1[sceneInteraction.state];
  // Classification always describes committed truth; only explicit View-entry preview borrows a scene.
  const consciousnessClasses = classifyAnimaConsciousnessV1({
    attention: options.attention, awareness: options.awareness,
    consciousField: options.consciousField, projectedNodeIds: visibleNodeIds,
  });
  const highlight = resolveAnimaHighlightV1({ ...options, interaction: sceneInteraction,
    hoverViewId: options.interaction.state,
    attention: viewTransition ? { nodeIds: expressedAttentionNodeIds } : options.attention,
    statePolicy, objectPreview: presentationPreview, overviewNeighborReveal,
    hoverPathNodeIds: new Set(presentationPreview?.hoverPathNodeIds ?? []) });
  const constellationKindByNodeId: Record<string, Constellation['kind']> = {};
  for (const id of visibleNodeIds) {
    if (expressedAttentionNodeIds.has(id) || highlight.hoverPathNodeIds.has(id)) {
      constellationKindByNodeId[id] = 'ego';
    } else if (options.remembered?.nodeIds.has(id)) {
      constellationKindByNodeId[id] = 'memory';
    }
  }
  const constellationKindByEdgeId: Record<string, Constellation['kind']> = {};
  for (const edge of options.document.edges) {
    if (options.visibleEdgeIds && !options.visibleEdgeIds.has(edge.id)) continue;
    const kind = constellationKindByNodeId[edge.sourceId];
    if (kind && kind === constellationKindByNodeId[edge.targetId]) constellationKindByEdgeId[edge.id] = kind;
  }
  const memoryStrengthByNodeId = resolveMemoryStrengths(options.remembered);
  return {
    objectPreview, interaction: options.interaction, expressedAttentionNodeIds, focusEmphasisNodeIds,
    statePolicy, consciousnessClasses, highlight,
    constellationKindByNodeId, constellationKindByEdgeId, memoryStrengthByNodeId,
    labelRaising: resolveAnimaLabelRaisingV1({ ...options, interaction: sceneInteraction,
      hoverViewId: options.interaction.state,
      attention: { nodeIds: expressedAttentionNodeIds },
      consciousnessClasses, highlight,
      suppressHover: presentationPreview?.activation === 'remove-membership'
        || presentationPreview?.kind === 'view-transition' }),
  };
}

function resolveMemoryStrengths(remembered: RememberedSubjects | undefined): Readonly<Record<string, number>> {
  const newestFirst = [...(remembered?.nodeIds ?? [])].reverse();
  const strengths = [1, 0.5, 0.25] as const;
  return Object.fromEntries(newestFirst.map((nodeId, index) => [
    nodeId,
    strengths[Math.min(index, strengths.length - 1)],
  ]));
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
  readonly hoverViewId: GraphUxStateV1;
  readonly overviewNeighborReveal?: boolean;
  readonly statePolicy: AnimaStatePresentationPolicyV1;
  readonly hoverPathNodeIds: ReadonlySet<string>;
  readonly objectPreview?: GraphInteractionPreviewV1;
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
  // Memory remains independently visible in every View. It never becomes
  // Attention, seeds Focus context expansion, or owns camera interest.
  for (const id of options.remembered?.nodeIds ?? []) {
    if (visibleNodeIds.has(id)) highlightedNodeIds.add(id);
  }
  const removedNodeIds = new Set(options.objectPreview?.removedNodeIds ?? []);
  for (const id of removedNodeIds) {
    if (!options.remembered?.nodeIds.has(id)) {
      highlightedNodeIds.delete(id);
      seedNodeIds.delete(id);
    }
  }
  // Object deltas retain context; explicit View transitions supply their admitted subject.
  const focusScopeNodeIds = new Set([...sourceSeeds.awareness].filter((id) => !removedNodeIds.has(id)));
  if (options.interaction.focusedNodeId !== undefined) {
    focusScopeNodeIds.add(options.interaction.focusedNodeId);
    for (const neighbor of relationships.get(options.interaction.focusedNodeId) ?? []) {
      focusScopeNodeIds.add(neighbor);
    }
  }
  const hoverPathNodeIds = new Set([...options.hoverPathNodeIds].filter((id) => visibleNodeIds.has(id)));
  for (const id of options.objectPreview?.addedNodeIds ?? []) {
    if (visibleNodeIds.has(id)) highlightedNodeIds.add(id);
  }
  if (options.objectPreview?.focusNodeId !== undefined && visibleNodeIds.has(options.objectPreview.focusNodeId)) {
    highlightedNodeIds.add(options.objectPreview.focusNodeId);
  }
  for (const id of hoverPathNodeIds) highlightedNodeIds.add(id);
  const context = GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.context;
  const baseNodePhase: AnimaPresentationPhaseV1 = context === 'standard'
    ? 'standard' : context === 'dimmed' ? 'dimmed' : 'void';
  const phaseByNodeId = Object.fromEntries([...visibleNodeIds].map((nodeId) => {
    let phase: AnimaPresentationPhaseV1 = baseNodePhase;
    // Focus keeps its immediate neighborhood visible but subdued. Dimmed labels
    // remain suppressed; only unrelated context becomes void.
    if (options.interaction.state === 'focus' && focusScopeNodeIds.has(nodeId)) phase = 'dimmed';
    if (highlightedNodeIds.has(nodeId)) phase = 'highlighted';
    // Removal presentation lowers the object phase instead of overriding label
    // policy. Independent Memory stays highlighted when deliberate membership
    // is withdrawn.
    if (removedNodeIds.has(nodeId) && !options.remembered?.nodeIds.has(nodeId)) phase = 'dimmed';
    return [nodeId, phase];
  })) as Record<string, AnimaPresentationPhaseV1>;
  if (options.overviewNeighborReveal && options.interaction.hoveredNodeId !== undefined) {
    const hovered = options.interaction.hoveredNodeId;
    const neighbors = relationships.get(hovered) ?? new Set<string>();
    for (const id of visibleNodeIds) {
      if (id === hovered) phaseByNodeId[id] = 'highlighted';
      else if (phaseByNodeId[id] !== 'highlighted') phaseByNodeId[id] = neighbors.has(id) ? 'standard' : 'dimmed';
    }
  }
  const phaseByEdgeId = Object.fromEntries(visibleEdges.map((edge) => [
    edge.id,
    weakerPhase(phaseByNodeId[edge.sourceId] ?? 'void', phaseByNodeId[edge.targetId] ?? 'void'),
  ])) as Record<string, AnimaPresentationPhaseV1>;
  // Resolve the scene first, then lift each affected object exactly once. Deriving
  // edges after node promotion would also lift unrelated neighbor-to-neighbor links.
  if (options.objectPreview?.kind === 'objects' && options.objectPreview.activation === 'primary'
    && options.interaction.hoveredNodeId !== undefined) {
    const hovered = options.interaction.hoveredNodeId;
    const hoverPolicy = GRAPH_VIEW_DEFINITIONS_V1[options.hoverViewId].scene.hoverAwareness;
    const raisedNodes = new Set<string>();
    expandNeighborhood(sourceSeeds.hover, hoverPolicy.neighborhoodDepth, relationships, raisedNodes);
    for (const id of raisedNodes) phaseByNodeId[id] = raiseAnimaAwarenessPhaseV1(phaseByNodeId[id]);
    for (const edge of visibleEdges) {
      if (hoverPolicy.links === 'incident' && (edge.sourceId === hovered || edge.targetId === hovered)) {
        phaseByEdgeId[edge.id] = raiseAnimaAwarenessPhaseV1(phaseByEdgeId[edge.id]);
      }
    }
  }
  highlightedNodeIds.clear();
  for (const [id, phase] of Object.entries(phaseByNodeId)) {
    if (phase === 'highlighted') highlightedNodeIds.add(id);
  }
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
  readonly hoverViewId: GraphUxStateV1;
  readonly consciousnessClasses: AnimaConsciousnessClassesV1;
  readonly remembered?: RememberedSubjects;
  readonly highlight: AnimaHighlightResultV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly suppressHover?: boolean;
}): AnimaLabelRaisingV1 {
  const policy = GRAPH_VIEW_DEFINITIONS_V1[options.interaction.state].scene.labels;
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const hoverNeighbors = new Set<string>();
  if (!options.suppressHover
    && options.interaction.hoveredNodeId !== undefined) {
    for (const edge of options.document.edges) {
      if (options.visibleEdgeIds && !options.visibleEdgeIds.has(edge.id)) continue;
      if (edge.sourceId === options.interaction.hoveredNodeId) hoverNeighbors.add(edge.targetId);
      if (edge.targetId === options.interaction.hoveredNodeId) hoverNeighbors.add(edge.sourceId);
    }
  }
  return { byNodeId: Object.fromEntries([...visibleNodeIds].map((nodeId): [string, AnimaLabelDecisionV1] => {
    const phase = options.highlight.phaseByNodeId[nodeId] ?? 'void';
    if (phase === 'highlighted') {
      const reason: AnimaLabelReasonV1 = !options.suppressHover && nodeId === options.interaction.hoveredNodeId
        ? 'hover'
        : options.attention.nodeIds.has(nodeId)
          ? 'attended'
          : options.remembered?.nodeIds.has(nodeId)
            ? 'remembered'
            : options.awareness.nodeIds.has(nodeId)
              ? 'aware'
              : options.highlight.hoverPathNodeIds.has(nodeId)
                ? 'hover-path'
                : 'aware';
      // Memory remains visible in Focus, but its label competes normally with
      // the focused neighborhood instead of bypassing the adaptive budget.
      if (options.interaction.state === 'focus' && reason === 'remembered') {
        return [nodeId, { disposition: 'fallback', reason, priority: 1 }];
      }
      return [nodeId, {
        disposition: policy.highlighted,
        reason,
        priority: 5,
      }];
    }
    if (phase === 'dimmed' || phase === 'void') {
      return [nodeId, { disposition: policy[phase], reason: 'dimmed', priority: 2 }];
    }
    if (!options.suppressHover
      && !options.attention.nodeIds.has(nodeId)
      && !options.remembered?.nodeIds.has(nodeId)
      && hoverNeighbors.has(nodeId)) {
      return [nodeId, { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 }];
    }
    return [nodeId, { disposition: policy.standard, reason: 'slider', priority: 1 }];
  })) };
}

/** Raise one presentation degree without accumulating hover state or changing membership. */
export function raiseAnimaAwarenessPhaseV1(phase: AnimaPresentationPhaseV1): AnimaPresentationPhaseV1 {
  return phase === 'void' ? 'dimmed' : phase === 'dimmed' ? 'standard' : 'highlighted';
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
