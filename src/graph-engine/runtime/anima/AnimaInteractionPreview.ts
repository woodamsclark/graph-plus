import { DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1 } from '../../contracts/v1/index.ts';
import type { GraphExperienceContractV1, GraphViewIdV1 } from '../../contracts/v1/index.ts';
import { resolveEgoInteractionPlanV1, type EgoInteractionPlanV1 } from '../consciousness/EgoInteractionPlan.ts';
import { resolveGraphHoverPathV1, type GraphHoverPathOptionsV1 } from '../interaction/GraphViewObjectActivation.ts';
import type { InputGraphIdentityV1 } from '../interaction/GraphInteractionTypes.ts';

export interface GraphViewObjectPreviewV1 {
  readonly activation: 'primary' | 'toggle-membership';
  readonly viewId: GraphViewIdV1;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly hoverPathNodeIds: readonly string[];
}

/** Anima expresses an admitted will; it never reconstructs the transition. */
export function presentEgoInteractionPlanV1(
  plan: EgoInteractionPlanV1, hoverPath?: GraphHoverPathOptionsV1,
): GraphViewObjectPreviewV1 | undefined {
  if (plan.outcome === 'rejected' || plan.input.target.kind !== 'node') return undefined;
  return {
    activation: plan.input.modifiers.ctrl ? 'toggle-membership' : 'primary',
    ...plan.resultingState,
    hoverPathNodeIds: plan.constellationPathNodeIds.length > 0 ? plan.constellationPathNodeIds
      : plan.input.modifiers.ctrl || !hoverPath ? [] : resolveGraphHoverPathV1(plan.input.target.nodeId, hoverPath),
  };
}

/** Pure presentation callers use the same Ego planner as a live session. */
export function previewGraphViewObjectActivationV1(options: {
  readonly viewId: GraphViewIdV1;
  readonly nodeId: string;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly ctrl?: boolean;
  readonly getConstellation: (nodeId: string) => readonly string[];
  readonly identity: InputGraphIdentityV1;
  readonly experience?: GraphExperienceContractV1;
  readonly hoverPath?: GraphHoverPathOptionsV1;
}): GraphViewObjectPreviewV1 | undefined {
  // Without a projection, collect all possible results rather than truncating the looked-up group.
  const available = options.hoverPath?.visibleNodeIds ?? new Set([
    ...options.attentionNodeIds, options.nodeId, ...options.getConstellation(options.nodeId),
  ]);
  const plan = resolveEgoInteractionPlanV1({ phase: 'hover', target: { kind: 'node', nodeId: options.nodeId },
    modality: 'mouse', modifiers: { ctrl: options.ctrl === true, meta: false, shift: false, alt: false },
  }, {
    identity: options.identity, state: options, experience: options.experience ?? DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    availableNodeIds: available, visibleNodeIds: available,
    visibleEdgeIds: options.hoverPath?.visibleEdgeIds ?? new Set(),
    edges: options.hoverPath?.edges,
    awarenessNodeIds: options.hoverPath?.targetNodeIds ?? new Set(options.attentionNodeIds),
    getConstellation: options.getConstellation,
  });
  return presentEgoInteractionPlanV1(plan, options.hoverPath);
}
