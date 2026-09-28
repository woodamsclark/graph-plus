export type GraphPlusExperienceModeV1 = 'global' | 'local';
export type GraphPlusInteractionStateV1 = 'overview' | 'explore' | 'focus';

export interface GraphPlusExperiencePolicyV1 {
  readonly mode: GraphPlusExperienceModeV1;
  readonly documentScope: 'vault' | 'root-neighborhood';
  readonly subjectOwnership: 'user' | 'active-note';
  readonly allowedInteractionStates: readonly GraphPlusInteractionStateV1[];
  readonly persistence: 'checkpoint' | 'ephemeral';
  readonly followActiveNote: boolean;
  readonly rootInvariant: 'none' | 'selected-focused-pinned';
}

export const GRAPH_PLUS_EXPERIENCE_POLICIES_V1: Readonly<
  Record<GraphPlusExperienceModeV1, GraphPlusExperiencePolicyV1>
> = {
  global: {
    mode: 'global',
    documentScope: 'vault',
    subjectOwnership: 'user',
    allowedInteractionStates: ['overview', 'explore', 'focus'],
    persistence: 'checkpoint',
    followActiveNote: false,
    rootInvariant: 'none',
  },
  local: {
    mode: 'local',
    documentScope: 'root-neighborhood',
    subjectOwnership: 'active-note',
    allowedInteractionStates: ['focus'],
    persistence: 'ephemeral',
    followActiveNote: true,
    rootInvariant: 'selected-focused-pinned',
  },
};

export function graphPlusExperiencePolicyV1(
  mode: GraphPlusExperienceModeV1,
): GraphPlusExperiencePolicyV1 {
  return GRAPH_PLUS_EXPERIENCE_POLICIES_V1[mode];
}
