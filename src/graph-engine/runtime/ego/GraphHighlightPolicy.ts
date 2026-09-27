import type { EgoHighlightPolicyV1 } from './GraphEgo.ts';

/**
 * Application-wide highlight truth, deliberately external to every UI state.
 * Ego may resolve a state-scoped override over this immutable policy but never
 * installs that override here.
 */
export const EGO_HIGHLIGHT_POLICY_V1: EgoHighlightPolicyV1 = Object.freeze({
  sources: Object.freeze({
    selection: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    hover: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    focus: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
    activity: Object.freeze({ enabled: true, neighborhoodDepth: 1, edgeMode: 'incident' }),
  }),
  highlightedRole: 'highlighted',
  contextRole: 'normal',
  labels: 'delegate',
});
