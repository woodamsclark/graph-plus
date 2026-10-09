export type GraphExperienceStateV1 = 'overview' | 'explore' | 'focus';

export type GraphEndogenousCapabilityV1 =
  | 'navigate-camera'
  | 'direct-attention'
  | 'direct-focus'
  | 'activate-subject'
  | 'inspect-subject'
  | 'move-subject'
  | 'request-subject-actions';

export interface GraphExperienceAttentionPolicyV1 {
  /** Omit for constellation-style Attention without a cardinality cap. */
  readonly maximumNodeCount?: number;
  /** When a cap is exceeded, preserve the subject that originated the intent. */
  readonly overflow: 'preserve-intent-subject';
  /** Clear deliberate membership when returning from another View to Overview. */
  readonly clearOnOverviewEntry?: boolean;
}

export interface GraphExperienceAwarenessPolicyV1 {
  /** Number of graph-neighborhood steps contributed by each attended node. */
  readonly attentionNeighborhoodDepth: number;
}

export interface GraphExperienceFramingPolicyV1 {
  readonly target: 'graph' | 'attention' | 'focused-neighborhood';
  readonly center: 'centroid' | 'focused-node';
  /** Automatic Focus entry/hop framing; omitted retains legacy recentering. */
  readonly entry?: 'preserve' | 'recenter';
}

/** Host-neutral constraints for one Graph Engine presentation session. */
export interface GraphExperienceContractV1 {
  readonly contractVersion: 1;
  readonly allowedStates: readonly GraphExperienceStateV1[];
  readonly attention: GraphExperienceAttentionPolicyV1;
  readonly awareness: GraphExperienceAwarenessPolicyV1;
  readonly permittedInteractions: readonly GraphEndogenousCapabilityV1[];
  readonly framing: Readonly<Record<GraphExperienceStateV1, GraphExperienceFramingPolicyV1>>;
}

export const ALL_GRAPH_ENDOGENOUS_CAPABILITIES_V1: readonly GraphEndogenousCapabilityV1[] = Object.freeze([
  'navigate-camera',
  'direct-attention',
  'direct-focus',
  'activate-subject',
  'inspect-subject',
  'move-subject',
  'request-subject-actions',
]);

export const DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1: GraphExperienceContractV1 = Object.freeze({
  contractVersion: 1,
  allowedStates: Object.freeze(['overview', 'explore', 'focus'] as const),
  attention: Object.freeze({ overflow: 'preserve-intent-subject' }),
  awareness: Object.freeze({ attentionNeighborhoodDepth: 0 }),
  permittedInteractions: ALL_GRAPH_ENDOGENOUS_CAPABILITIES_V1,
  framing: Object.freeze({
    overview: Object.freeze({ target: 'graph', center: 'centroid' }),
    explore: Object.freeze({ target: 'attention', center: 'centroid' }),
    focus: Object.freeze({ target: 'focused-neighborhood', center: 'focused-node' }),
  }),
});
