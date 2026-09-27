import type {
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphViewStateV1,
  Vec3,
} from '../../contracts/v1/index.ts';
import { EGO_HIGHLIGHT_POLICY_V1 } from './GraphHighlightPolicy.ts';

export type EgoUiStateV1 = 'overview' | 'explore' | 'focus';
export type EgoPresentationRoleV1 = 'normal' | 'highlighted' | 'dimmed' | 'hidden';
export type EgoHighlightEdgeModeV1 = 'incident' | 'between-seeds' | 'none';
export type EgoHighlightSourceV1 = 'selection' | 'hover' | 'focus' | 'activity';

export interface EgoHighlightSourcePolicyV1 {
  readonly enabled: boolean;
  readonly neighborhoodDepth: number;
  readonly edgeMode: EgoHighlightEdgeModeV1;
}

export interface EgoHighlightPolicyV1 {
  readonly sources: Readonly<Record<EgoHighlightSourceV1, EgoHighlightSourcePolicyV1>>;
  readonly highlightedRole: 'highlighted';
  readonly contextRole: Exclude<EgoPresentationRoleV1, 'highlighted'>;
  /** Labels are resolved by the label manager, never as a side effect of highlight. */
  readonly labels: 'delegate';
}

export interface EgoHighlightPolicyOverrideV1 {
  readonly sources?: Readonly<Partial<Record<EgoHighlightSourceV1, Partial<EgoHighlightSourcePolicyV1>>>>;
  readonly contextRole?: EgoHighlightPolicyV1['contextRole'];
}

export interface EgoUiContextV1 {
  readonly state: EgoUiStateV1;
  /** @deprecated Compatibility spelling for legacy interaction readers. */
  readonly mode: EgoUiStateV1;
  readonly dimensions: GraphDimensionsV1;
  readonly selectedNodeIds: ReadonlySet<string>;
  readonly pinnedNodeIds: ReadonlySet<string>;
  readonly focusedNodeId?: string;
  readonly hoveredNodeId?: string;
  readonly draggedNodeId?: string;
  readonly previewedNodeId?: string;
  readonly selectionPresentationSuspended: boolean;
  readonly selectionNeighborRevealActive: boolean;
}

export interface EgoUiStateContractV1 {
  readonly state: EgoUiStateV1;
  readonly attentionTarget: 'none' | 'selection-centroid';
  readonly fitTarget: 'graph' | 'selection' | 'focused-neighborhood';
  readonly fitCenter: 'centroid' | 'focused-node';
  readonly renderScope: 'graph' | 'graph-with-selection-emphasis' | 'focused-local-view';
  readonly primaryDrag: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly mobilePrimaryDrag: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly wheel: Readonly<Record<GraphDimensionsV1, 'pan' | 'rotate' | 'elastic-pan'>>;
  readonly secondaryDrag: 'rotate' | 'radial-zoom';
  readonly mobileTwoFingerDrag: Readonly<Record<GraphDimensionsV1, 'pan-and-zoom' | 'rotate-and-zoom'>>;
  /** This override exists only while this state contract is active. */
  readonly highlightOverride?: EgoHighlightPolicyOverrideV1;
}

export interface EgoHighlightResultV1 {
  readonly policy: EgoHighlightPolicyV1;
  readonly seedNodeIds: ReadonlySet<string>;
  readonly highlightedNodeIds: ReadonlySet<string>;
  readonly highlightedEdgeIds: ReadonlySet<string>;
}

export type EgoLabelDispositionV1 = 'force' | 'favor' | 'raise' | 'suppress' | 'fallback';
export type EgoLabelReasonV1 = 'hover' | 'hover-neighbor' | 'selected' | 'dimmed' | 'slider';

export interface EgoLabelDecisionV1 {
  readonly disposition: EgoLabelDispositionV1;
  readonly reason: EgoLabelReasonV1;
  readonly priority: number;
  /** Fraction by which the adaptive Saliency threshold is reduced for this node. */
  readonly saliencyBoost?: number;
}

export interface EgoLabelRaisingV1 {
  readonly byNodeId: Readonly<Record<string, EgoLabelDecisionV1>>;
}

export interface Attention {
  readonly nodeIds: ReadonlySet<string>;
  readonly point?: Vec3;
}

export interface Ego {
  readonly context: EgoUiContextV1;
  readonly contract: EgoUiStateContractV1;
  readonly attention: Attention;
  readonly highlight: EgoHighlightResultV1;
  readonly labelRaising: EgoLabelRaisingV1;
}

/** @deprecated Compatibility name. Runtime code should use Ego. */
export type EgoAwarenessV1 = Ego;

/**
 * Ego is the single semantic UI-state contract. Animus supplies facts to it;
 * Anima consumes its resolved awareness and owns only concrete presentation.
 */
export const EGO_UI_STATE_CONTRACTS_V1: Readonly<Record<EgoUiStateV1, EgoUiStateContractV1>> = {
  overview: {
    state: 'overview',
    attentionTarget: 'none',
    fitTarget: 'graph',
    fitCenter: 'centroid',
    renderScope: 'graph',
    primaryDrag: { '2d': 'pan', '3d': 'pan' },
    mobilePrimaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'pan' },
    secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
    highlightOverride: {
      sources: {
        selection: { enabled: false },
        focus: { enabled: false },
      },
      contextRole: 'normal',
    },
  },
  explore: {
    state: 'explore',
    attentionTarget: 'selection-centroid',
    fitTarget: 'selection',
    fitCenter: 'centroid',
    renderScope: 'graph-with-selection-emphasis',
    primaryDrag: { '2d': 'pan', '3d': 'pan' },
    mobilePrimaryDrag: { '2d': 'pan', '3d': 'pan' },
    wheel: { '2d': 'pan', '3d': 'rotate' },
    secondaryDrag: 'rotate',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
    highlightOverride: {
      sources: {
        selection: { neighborhoodDepth: 0, edgeMode: 'between-seeds' },
        focus: { enabled: false },
        activity: { enabled: false },
      },
      contextRole: 'dimmed',
    },
  },
  focus: {
    state: 'focus',
    attentionTarget: 'selection-centroid',
    fitTarget: 'focused-neighborhood',
    fitCenter: 'focused-node',
    renderScope: 'focused-local-view',
    primaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    mobilePrimaryDrag: { '2d': 'elastic-pan', '3d': 'rotate' },
    wheel: { '2d': 'elastic-pan', '3d': 'rotate' },
    secondaryDrag: 'radial-zoom',
    mobileTwoFingerDrag: { '2d': 'pan-and-zoom', '3d': 'rotate-and-zoom' },
    highlightOverride: {
      sources: {
        selection: { neighborhoodDepth: 0, edgeMode: 'between-seeds' },
        hover: { enabled: false },
        activity: { enabled: false },
      },
      contextRole: 'hidden',
    },
  },
};

export function resolveEgoUiStateV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): EgoUiStateV1 {
  if (viewState.focusedNodeId !== undefined && viewState.selectedNodeIds.length > 0) return 'focus';
  if (viewState.selectedNodeIds.length > 0) return 'explore';
  return 'overview';
}

export function createEgoUiContextV1(options: {
  readonly viewState: Pick<
    GraphViewStateV1,
    'dimensions' | 'selectedNodeIds' | 'pinnedNodeIds' | 'focusedNodeId'
  >;
  readonly hoveredNodeId?: string;
  readonly draggedNodeId?: string;
  readonly previewedNodeId?: string;
  readonly selectionPresentationSuspended?: boolean;
  readonly selectionNeighborRevealActive?: boolean;
}): EgoUiContextV1 {
  const state = resolveEgoUiStateV1(options.viewState);
  return {
    state,
    mode: state,
    dimensions: options.viewState.dimensions,
    selectedNodeIds: new Set(options.viewState.selectedNodeIds),
    pinnedNodeIds: new Set(options.viewState.pinnedNodeIds),
    ...(options.viewState.focusedNodeId === undefined ? {} : { focusedNodeId: options.viewState.focusedNodeId }),
    ...(options.hoveredNodeId === undefined ? {} : { hoveredNodeId: options.hoveredNodeId }),
    ...(options.draggedNodeId === undefined ? {} : { draggedNodeId: options.draggedNodeId }),
    ...(options.previewedNodeId === undefined ? {} : { previewedNodeId: options.previewedNodeId }),
    selectionPresentationSuspended: options.selectionPresentationSuspended === true,
    selectionNeighborRevealActive: options.selectionNeighborRevealActive === true,
  };
}

export function egoUiStateContractV1(
  viewState: Pick<GraphViewStateV1, 'selectedNodeIds' | 'focusedNodeId'>,
): EgoUiStateContractV1 {
  return EGO_UI_STATE_CONTRACTS_V1[resolveEgoUiStateV1(viewState)];
}

export function resolveEgoHighlightPolicyV1(
  context: EgoUiContextV1,
  contract: EgoUiStateContractV1 = EGO_UI_STATE_CONTRACTS_V1[context.state],
  globalPolicy: EgoHighlightPolicyV1 = EGO_HIGHLIGHT_POLICY_V1,
): EgoHighlightPolicyV1 {
  const override = contract.highlightOverride;
  const source = (name: EgoHighlightSourceV1): EgoHighlightSourcePolicyV1 => ({
    ...globalPolicy.sources[name],
    ...(override?.sources?.[name] ?? {}),
  });
  return {
    sources: {
      selection: source('selection'),
      hover: source('hover'),
      focus: source('focus'),
      activity: source('activity'),
    },
    highlightedRole: globalPolicy.highlightedRole,
    contextRole: context.selectionPresentationSuspended
      ? 'normal'
      : override?.contextRole ?? globalPolicy.contextRole,
    labels: globalPolicy.labels,
  };
}

export function resolveEgoHighlightV1(options: {
  readonly context: EgoUiContextV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly globalPolicy?: EgoHighlightPolicyV1;
}): EgoHighlightResultV1 {
  const contract = EGO_UI_STATE_CONTRACTS_V1[options.context.state];
  const policy = resolveEgoHighlightPolicyV1(options.context, contract, options.globalPolicy);
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const visibleEdges = options.document.edges.filter((edge) => (
    (options.visibleEdgeIds === undefined || options.visibleEdgeIds.has(edge.id))
    && visibleNodeIds.has(edge.sourceId)
    && visibleNodeIds.has(edge.targetId)
  ));
  const relationships = new Map<string, Set<string>>();
  for (const nodeId of visibleNodeIds) relationships.set(nodeId, new Set());
  for (const edge of visibleEdges) {
    relationships.get(edge.sourceId)?.add(edge.targetId);
    relationships.get(edge.targetId)?.add(edge.sourceId);
  }

  const sourceSeeds: Readonly<Record<EgoHighlightSourceV1, ReadonlySet<string>>> = {
    selection: new Set([...options.context.selectedNodeIds].filter((id) => visibleNodeIds.has(id))),
    hover: new Set(options.context.hoveredNodeId !== undefined && visibleNodeIds.has(options.context.hoveredNodeId)
      ? [options.context.hoveredNodeId] : []),
    focus: new Set(options.context.focusedNodeId !== undefined && visibleNodeIds.has(options.context.focusedNodeId)
      ? [options.context.focusedNodeId] : []),
    activity: new Set([
      options.context.draggedNodeId,
      options.context.previewedNodeId,
    ].filter((id): id is string => id !== undefined && visibleNodeIds.has(id))),
  };
  const seedNodeIds = new Set<string>();
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();

  for (const sourceName of ['selection', 'hover', 'focus', 'activity'] as const) {
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

export function resolveAttention(options: {
  readonly viewState: Pick<GraphViewStateV1, 'selectedNodeIds'>;
  readonly positions: Readonly<Record<string, Vec3>>;
}): Attention {
  const nodeIds = new Set(options.viewState.selectedNodeIds.filter((nodeId) => options.positions[nodeId] !== undefined));
  const selectedPositions = [...nodeIds].map((nodeId) => options.positions[nodeId] as Vec3);
  if (selectedPositions.length === 0) return { nodeIds };
  const total = selectedPositions.reduce((sum, position) => ({
    x: sum.x + position.x,
    y: sum.y + position.y,
    z: sum.z + position.z,
  }), { x: 0, y: 0, z: 0 });
  return {
    nodeIds,
    point: {
      x: total.x / selectedPositions.length,
      y: total.y / selectedPositions.length,
      z: total.z / selectedPositions.length,
    },
  };
}

export function createEgo(options: Parameters<typeof createEgoUiContextV1>[0] & {
  readonly document: GraphDocumentV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
  readonly globalHighlightPolicy?: EgoHighlightPolicyV1;
}): Ego {
  const context = createEgoUiContextV1(options);
  const contract = EGO_UI_STATE_CONTRACTS_V1[context.state];
  const highlight = resolveEgoHighlightV1({
    context,
    document: options.document,
    ...(options.visibleNodeIds === undefined ? {} : { visibleNodeIds: options.visibleNodeIds }),
    ...(options.visibleEdgeIds === undefined ? {} : { visibleEdgeIds: options.visibleEdgeIds }),
    ...(options.globalHighlightPolicy === undefined ? {} : { globalPolicy: options.globalHighlightPolicy }),
  });
  return {
    context,
    contract,
    attention: resolveAttention({
      viewState: options.viewState,
      positions: options.positions ?? {},
    }),
    highlight,
    labelRaising: resolveEgoLabelRaisingV1({
      context,
      highlight,
      document: options.document,
      ...(options.visibleNodeIds === undefined ? {} : { visibleNodeIds: options.visibleNodeIds }),
      ...(options.visibleEdgeIds === undefined ? {} : { visibleEdgeIds: options.visibleEdgeIds }),
    }),
  };
}

/** @deprecated Compatibility constructor. Runtime code should use createEgo. */
export const createEgoAwarenessV1 = createEgo;

export function resolveEgoLabelRaisingV1(options: {
  readonly context: EgoUiContextV1;
  readonly highlight: EgoHighlightResultV1;
  readonly document: GraphDocumentV1;
  readonly visibleNodeIds?: ReadonlySet<string>;
  readonly visibleEdgeIds?: ReadonlySet<string>;
}): EgoLabelRaisingV1 {
  const visibleNodeIds = options.visibleNodeIds ?? new Set(options.document.nodes.map((node) => node.id));
  const hoverNeighbors = new Set<string>();
  if (options.context.hoveredNodeId !== undefined) {
    for (const edge of options.document.edges) {
      if (options.visibleEdgeIds !== undefined && !options.visibleEdgeIds.has(edge.id)) continue;
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) continue;
      if (edge.sourceId === options.context.hoveredNodeId) hoverNeighbors.add(edge.targetId);
      if (edge.targetId === options.context.hoveredNodeId) hoverNeighbors.add(edge.sourceId);
    }
  }
  const contextSuppressesLabels = options.highlight.policy.contextRole === 'dimmed'
    || options.highlight.policy.contextRole === 'hidden';
  const byNodeId = Object.fromEntries([...visibleNodeIds].map((nodeId): [string, EgoLabelDecisionV1] => {
    if (nodeId === options.context.hoveredNodeId) {
      return [nodeId, { disposition: 'force', reason: 'hover', priority: 5 }];
    }
    if (hoverNeighbors.has(nodeId)) {
      return [nodeId, {
        disposition: 'favor',
        reason: 'hover-neighbor',
        priority: 4,
        saliencyBoost: 0.5,
      }];
    }
    if (options.context.selectedNodeIds.has(nodeId) || nodeId === options.context.focusedNodeId) {
      return [nodeId, { disposition: 'raise', reason: 'selected', priority: 3 }];
    }
    if (contextSuppressesLabels && !options.highlight.highlightedNodeIds.has(nodeId)) {
      return [nodeId, { disposition: 'suppress', reason: 'dimmed', priority: 2 }];
    }
    return [nodeId, { disposition: 'fallback', reason: 'slider', priority: 1 }];
  }));
  return { byNodeId };
}

function expandNeighborhood(
  seeds: ReadonlySet<string>,
  depth: number,
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
  target: Set<string>,
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
