import { DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1 } from '../../contracts/v1/index.ts';
import type { GraphExperienceContractV1, GraphViewIdV1 } from '../../contracts/v1/index.ts';
import { resolveEgoInteractionPlanV1, type EgoInteractionPlanV1, type EgoInteractionStateV1 } from '../consciousness/EgoInteractionPlan.ts';
import type { GraphHoverPathOptionsV1 } from '../interaction/GraphViewObjectActivation.ts';
import type { InputGraphIdentityV1 } from '../interaction/GraphInteractionTypes.ts';

interface GraphInteractionPreviewBaseV1 {
  readonly activation: 'primary' | 'remove-membership' | 'toggle-membership';
  readonly addedNodeIds: readonly string[];
  readonly removedNodeIds: readonly string[];
  /** Local emphasis; only the separate View-transition state chooses scene context. */
  readonly focusNodeId?: string;
  readonly hoverPathNodeIds: readonly string[];
}

/** Object admission and deliberate View entry are separate presentation avenues. */
export type GraphInteractionPreviewV1 = GraphInteractionPreviewBaseV1 & (
  | { readonly kind: 'objects' }
  | { readonly kind: 'view-transition'; readonly resultingState: EgoInteractionStateV1 }
);

/** Derive an object preview or an explicit View-entry preview from admitted Will. */
export function presentEgoInteractionPlanV1(plan: EgoInteractionPlanV1): GraphInteractionPreviewV1 | undefined {
  if (plan.outcome === 'rejected' || plan.input.target.kind !== 'node') return undefined;
  return {
    ...((plan.action === 'choose-constellation' || plan.action === 'focus-member' || plan.action === 'admit-member')
      && (plan.resultingState.viewId !== plan.before.viewId || plan.resultingState.focusedNodeId !== plan.before.focusedNodeId)
      ? { kind: 'view-transition' as const, resultingState: plan.resultingState } : { kind: 'objects' as const }),
    activation: plan.input.membershipAction === 'toggle' ? 'toggle-membership'
      : plan.input.modifiers.ctrl ? 'remove-membership' : 'primary',
    addedNodeIds: plan.resultingState.attentionNodeIds.filter((id) => !plan.before.attentionNodeIds.includes(id)),
    removedNodeIds: plan.before.attentionNodeIds.filter((id) => !plan.resultingState.attentionNodeIds.includes(id)),
    focusNodeId: plan.resultingState.focusedNodeId !== plan.before.focusedNodeId
      ? plan.resultingState.focusedNodeId : undefined,
    // The preview must express the route Ego actually admitted. Recomputing a
    // presentation-only route can target passive Memory and promise nodes that
    // activation will not select.
    hoverPathNodeIds: plan.constellationPathNodeIds,
  };
}

/** Pure presentation callers use the same Ego planner as a live session. */
export function previewGraphObjectInteractionV1(options: {
  readonly viewId: GraphViewIdV1;
  readonly nodeId: string;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly ctrl?: boolean;
  readonly getConstellation: (nodeId: string) => readonly string[];
  readonly identity: InputGraphIdentityV1;
  readonly experience?: GraphExperienceContractV1;
  readonly rememberedNodeIds?: ReadonlySet<string>;
  readonly hoverPath?: GraphHoverPathOptionsV1;
}): GraphInteractionPreviewV1 | undefined {
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
    rememberedNodeIds: options.rememberedNodeIds,
    getConstellation: options.getConstellation,
  });
  return presentEgoInteractionPlanV1(plan);
}
