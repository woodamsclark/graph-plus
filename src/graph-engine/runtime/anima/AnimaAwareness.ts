import type { GraphDocumentV1 } from '../../contracts/v1/index.ts';
import type { Awareness } from '../ego/index.ts';
import type { GraphInteractionContextV1, GraphUxStateV1 } from '../interaction/index.ts';

export type AnimaPresentationRoleV1 = 'normal' | 'highlighted' | 'dimmed' | 'hidden';
export type AnimaHighlightEdgeModeV1 = 'incident' | 'between-seeds' | 'none';
export type AnimaHighlightSourceV1 = 'awareness' | 'hover' | 'focus' | 'activity';

export interface AnimaHighlightSourcePolicyV1 {
  readonly enabled: boolean;
  readonly neighborhoodDepth: number;
  readonly edgeMode: AnimaHighlightEdgeModeV1;
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
}

export type AnimaLabelDispositionV1 = 'force' | 'favor' | 'raise' | 'suppress' | 'fallback';
export type AnimaLabelReasonV1 = 'hover' | 'hover-neighbor' | 'aware' | 'dimmed' | 'slider';

export interface AnimaLabelDecisionV1 {
  readonly disposition: AnimaLabelDispositionV1;
  readonly reason: AnimaLabelReasonV1;
  readonly priority: number;
  readonly saliencyBoost?: number;
}

export interface AnimaLabelRaisingV1 {
  readonly byNodeId: Readonly<Record<string, AnimaLabelDecisionV1>>;
}

export interface AnimaAwarenessPresentationV1 {
  readonly statePolicy: AnimaStatePresentationPolicyV1;
  readonly highlight: AnimaHighlightResultV1;
  readonly labelRaising: AnimaLabelRaisingV1;
}

export const ANIMA_HIGHLIGHT_POLICY_V1: AnimaHighlightPolicyV1 = Object.freeze({
  sources: Object.freeze({
    awareness: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    hover: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    focus: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    activity: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
  }),
  highlightedRole: 'highlighted',
  contextRole: 'normal',
  labels: 'delegate',
});

export const ANIMA_STATE_PRESENTATION_POLICIES_V1: Readonly<
  Record<GraphUxStateV1, AnimaStatePresentationPolicyV1>
> = {
  overview: {
    renderScope: 'graph',
    highlightOverride: {
      sources: { awareness: { enabled: false }, focus: { enabled: false } },
      contextRole: 'normal',
    },
  },
  explore: {
    renderScope: 'graph-with-awareness-emphasis',
    highlightOverride: {
      sources: {
        awareness: { neighborhoodDepth: 0, edgeMode: 'between-seeds' },
        focus: { enabled: false },
        activity: { enabled: false },
      },
      contextRole: 'dimmed',
    },
  },
  focus: {
    renderScope: 'focused-local-view',
    highlightOverride: {
      sources: {
        awareness: { neighborhoodDepth: 0, edgeMode: 'between-seeds' },
        hover: { enabled: false },
        activity: { enabled: false },
      },
      contextRole: 'hidden',
    },
  },
};

export function createAnimaAwarenessPresentationV1(options: {
  readonly awareness: Awareness;
  readonly interaction: GraphInteractionContextV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
}): AnimaAwarenessPresentationV1 {
  const statePolicy = ANIMA_STATE_PRESENTATION_POLICIES_V1[options.interaction.state];
  const highlight = resolveAnimaHighlightV1({ ...options, statePolicy });
  return {
    statePolicy,
    highlight,
    labelRaising: resolveAnimaLabelRaisingV1({ ...options, highlight }),
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
    contextRole: interaction.selectionPresentationSuspended
      ? 'normal'
      : override?.contextRole ?? globalPolicy.contextRole,
    labels: globalPolicy.labels,
  };
}

function resolveAnimaHighlightV1(options: {
  readonly awareness: Awareness;
  readonly interaction: GraphInteractionContextV1;
  readonly statePolicy: AnimaStatePresentationPolicyV1;
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
    awareness: new Set([...options.awareness.nodeIds].filter((id) => visibleNodeIds.has(id))),
    hover: singleton(options.interaction.hoveredNodeId, visibleNodeIds),
    focus: singleton(options.interaction.focusedNodeId, visibleNodeIds),
    activity: new Set([options.interaction.draggedNodeId, options.interaction.previewedNodeId]
      .filter((id): id is string => id !== undefined && visibleNodeIds.has(id))),
  };
  const seedNodeIds = new Set<string>();
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  for (const sourceName of ['awareness', 'hover', 'focus', 'activity'] as const) {
    const sourcePolicy = policy.sources[sourceName];
    if (!sourcePolicy.enabled) continue;
    const seeds = sourceSeeds[sourceName];
    for (const seed of seeds) seedNodeIds.add(seed);
    expandNeighborhood(seeds, sourcePolicy.neighborhoodDepth, relationships, highlightedNodeIds);
    if (sourcePolicy.edgeMode === 'none') continue;
    for (const edge of visibleEdges) {
      const matches = sourcePolicy.edgeMode === 'incident'
        ? seeds.has(edge.sourceId) || seeds.has(edge.targetId)
        : seeds.has(edge.sourceId) && seeds.has(edge.targetId);
      if (matches) highlightedEdgeIds.add(edge.id);
    }
  }
  return { policy, seedNodeIds, highlightedNodeIds, highlightedEdgeIds };
}

function resolveAnimaLabelRaisingV1(options: {
  readonly awareness: Awareness;
  readonly interaction: GraphInteractionContextV1;
  readonly highlight: AnimaHighlightResultV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
}): AnimaLabelRaisingV1 {
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const hoverNeighbors = new Set<string>();
  if (options.interaction.hoveredNodeId !== undefined) {
    for (const edge of options.document.edges) {
      if (options.visibleEdgeIds !== undefined && !options.visibleEdgeIds.has(edge.id)) continue;
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) continue;
      if (edge.sourceId === options.interaction.hoveredNodeId) hoverNeighbors.add(edge.targetId);
      if (edge.targetId === options.interaction.hoveredNodeId) hoverNeighbors.add(edge.sourceId);
    }
  }
  const suppresses = options.highlight.policy.contextRole === 'dimmed'
    || options.highlight.policy.contextRole === 'hidden';
  return { byNodeId: Object.fromEntries([...visibleNodeIds].map((nodeId): [string, AnimaLabelDecisionV1] => {
    if (nodeId === options.interaction.hoveredNodeId) {
      return [nodeId, { disposition: 'force', reason: 'hover', priority: 5 }];
    }
    if (hoverNeighbors.has(nodeId)) {
      return [nodeId, { disposition: 'favor', reason: 'hover-neighbor', priority: 4, saliencyBoost: 0.5 }];
    }
    if (options.awareness.nodeIds.has(nodeId) || nodeId === options.interaction.focusedNodeId) {
      return [nodeId, { disposition: 'raise', reason: 'aware', priority: 3 }];
    }
    if (suppresses && !options.highlight.highlightedNodeIds.has(nodeId)) {
      return [nodeId, { disposition: 'suppress', reason: 'dimmed', priority: 2 }];
    }
    return [nodeId, { disposition: 'fallback', reason: 'slider', priority: 1 }];
  })) };
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
