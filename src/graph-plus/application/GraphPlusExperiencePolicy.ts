import {
  DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  type GraphExperienceContractV1,
} from '../../graph-engine/contracts/v1/index.ts';

export type GraphPlusExperienceModeV1 = 'global' | 'local';
export type GraphPlusInteractionStateV1 = 'overview' | 'explore' | 'focus';

export interface GraphPlusExperiencePolicyV1 {
  readonly mode: GraphPlusExperienceModeV1;
  readonly documentScope: 'vault';
  readonly subjectSources: readonly ('ego' | 'active-note')[];
  readonly allowedInteractionStates: readonly GraphPlusInteractionStateV1[];
  readonly attentionCardinality: 'constellation' | 'single-subject';
  readonly attentionAwarenessDepth: number;
  readonly persistence: 'checkpoint' | 'ephemeral';
  readonly followActiveNote: boolean;
  /** Whether recent workspace subjects are projected as visible Memory constellations. */
  readonly memoryConstellations: 'enabled' | 'disabled';
  readonly canonicalRootState: 'none' | 'session-constellation-focused-root';
}

export const GRAPH_PLUS_EXPERIENCE_POLICIES_V1: Readonly<
  Record<GraphPlusExperienceModeV1, GraphPlusExperiencePolicyV1>
> = {
  global: {
    mode: 'global',
    documentScope: 'vault',
    subjectSources: ['ego', 'active-note'],
    allowedInteractionStates: ['overview', 'explore', 'focus'],
    attentionCardinality: 'constellation',
    attentionAwarenessDepth: 0,
    persistence: 'checkpoint',
    followActiveNote: false,
    memoryConstellations: 'disabled',
    canonicalRootState: 'none',
  },
  local: {
    mode: 'local',
    documentScope: 'vault',
    subjectSources: ['ego', 'active-note'],
    allowedInteractionStates: ['focus'],
    attentionCardinality: 'constellation',
    attentionAwarenessDepth: 0,
    persistence: 'ephemeral',
    followActiveNote: true,
    memoryConstellations: 'disabled',
    canonicalRootState: 'session-constellation-focused-root',
  },
};

export function graphPlusExperiencePolicyV1(
  mode: GraphPlusExperienceModeV1,
): GraphPlusExperiencePolicyV1 {
  return GRAPH_PLUS_EXPERIENCE_POLICIES_V1[mode];
}

/** Translate Graph+ product policy into the host-neutral contract consumed by Graph Engine. */
export function graphPlusEngineExperienceContractV1(
  policy: GraphPlusExperiencePolicyV1,
): GraphExperienceContractV1 {
  return {
    ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    allowedStates: [...policy.allowedInteractionStates],
    attention: {
      ...(policy.attentionCardinality === 'single-subject' ? { maximumNodeCount: 1 } : {}),
      overflow: 'preserve-intent-subject',
      clearOnOverviewEntry: true,
    },
    awareness: { attentionNeighborhoodDepth: policy.attentionAwarenessDepth },
    permittedInteractions: [...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.permittedInteractions],
    framing: {
      overview: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.framing.overview },
      explore: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.framing.explore },
      focus: { ...DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1.framing.focus, entry: 'recenter' },
    },
  };
}
