import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { GraphEdgeV1, GraphExperienceContractV1, GraphViewIdV1 } from '../../contracts/v1/index.ts';
import type { GraphTopologyIndex } from '../../core/document/GraphTopologyIndex.ts';
import { adjudicateGraphExperienceCommandV1 } from '../experience/GraphExperienceAdjudicator.ts';
import { planGraphViewObjectActivationV1, resolveGraphHoverPathV1 } from '../interaction/GraphViewObjectActivation.ts';
import type { GraphRuntimeCommandV1, InputGraphIdentityV1 } from '../interaction/GraphInteractionTypes.ts';
import { DEFAULT_EGO_JUDGEMENT_V1, type Judgement } from './Judgement.ts';

/** Interpreted input: physical coordinates and gesture recognition stay in Input/Reflex. */
export interface EgoInteractionInputV1 {
  readonly phase: 'hover' | 'activate';
  readonly target: { readonly kind: 'node'; readonly nodeId: string } | { readonly kind: 'background' };
  readonly modality: 'mouse' | 'touch' | 'pen' | 'keyboard';
  readonly modifiers: { readonly ctrl: boolean; readonly meta: boolean; readonly shift: boolean; readonly alt: boolean };
  /** Explicit menu intent is distinct from Ctrl's idempotent removal gesture. */
  readonly membershipAction?: 'toggle';
  /** Explicit control actions preserve their meaning across physical modalities. */
  readonly objectAction?: 'focus';
  readonly navigationAction?: 'back' | 'overview' | 'clear-constellation';
}

export interface EgoInteractionStateV1 {
  readonly viewId: GraphViewIdV1;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
}

export interface EgoInteractionContextV1 {
  readonly identity: InputGraphIdentityV1;
  /** Compact revision for graph-wide planning inputs supplied by their runtime owner. */
  readonly planningRevision?: number | string;
  readonly state: EgoInteractionStateV1;
  readonly experience: GraphExperienceContractV1;
  readonly judgement?: Judgement;
  readonly availableNodeIds: ReadonlySet<string>;
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly visibleEdgeIds: ReadonlySet<string>;
  readonly edges?: readonly GraphEdgeV1[];
  readonly topology?: GraphTopologyIndex;
  readonly awarenessNodeIds: ReadonlySet<string>;
  readonly rememberedNodeIds?: ReadonlySet<string>;
  readonly getConstellation: (nodeId: string) => readonly string[];
}

export type EgoViewDirectiveV1 = Extract<GraphRuntimeCommandV1, { type: 'direct-attention' | 'activate-background' }>;
export type EgoInteractionEffectV1 =
  | { readonly type: 'clear-presentation' }
  | { readonly type: 'recenter-focus'; readonly nodeId: string };

interface EgoInteractionPlanBaseV1 {
  readonly input: EgoInteractionInputV1;
  readonly identity: InputGraphIdentityV1;
  /** Semantic basis only: camera and layout changes do not alter the intended transition. */
  readonly contextKey: string;
  readonly before: EgoInteractionStateV1;
  readonly action: 'choose-constellation' | 'admit-member' | 'remove-member' | 'focus-member' | 'back' | 'overview' | 'clear-constellation' | 'enter-constellation' | 'none';
  readonly resultingState: EgoInteractionStateV1;
  /** Admitted connecting route, captured once for both hover and activation. */
  readonly constellationPathNodeIds: readonly string[];
  readonly effects: readonly EgoInteractionEffectV1[];
}

export type EgoInteractionPlanV1 = EgoInteractionPlanBaseV1 & (
  | { readonly outcome: 'accepted' | 'adjusted'; readonly directive: EgoViewDirectiveV1 }
  | { readonly outcome: 'rejected'; readonly reason: string }
);

/** One state realization used by both prospective plans and legacy Attention effectors. */
export function realizeEgoViewDirectiveV1(
  directive: EgoViewDirectiveV1,
  state: EgoInteractionStateV1,
  availableNodeIds: ReadonlySet<string>,
  experience?: GraphExperienceContractV1,
): EgoInteractionStateV1 {
  if (directive.type === 'activate-background') {
    const bindings = GRAPH_VIEW_DEFINITIONS_V1[state.viewId].interactions;
    const viewId = directive.back ? bindings.escapeActivation : bindings.backgroundActivation;
    return freezeState(viewId === state.viewId ? state : { ...state, viewId, focusedNodeId: undefined,
      ...(viewId === 'overview' && experience?.attention.clearOnOverviewEntry ? { attentionNodeIds: [] } : {}),
    });
  }
  const attentionNodeIds = [...new Set(directive.nodeIds)].filter((id) => availableNodeIds.has(id));
  const focusedNodeId = attentionNodeIds.length === 0 || directive.clearFocus
    || (directive.focusNodeId === undefined && state.focusedNodeId !== undefined && !attentionNodeIds.includes(state.focusedNodeId))
    ? undefined : directive.focusNodeId ?? state.focusedNodeId;
  const viewId = attentionNodeIds.length === 0 ? directive.viewMode === 'explore' ? 'explore' : 'overview'
    : directive.viewMode ?? (focusedNodeId !== undefined ? 'focus' : state.viewId === 'focus' ? 'explore' : state.viewId);
  return freezeState({ viewId, attentionNodeIds: viewId === 'overview' && state.viewId !== 'overview'
    && experience?.attention.clearOnOverviewEntry ? [] : attentionNodeIds, focusedNodeId });
}

/** Evaluates a proposal without observing it in Memory or performing any effect. */
export function resolveEgoInteractionPlanV1(
  input: EgoInteractionInputV1,
  context: EgoInteractionContextV1,
): EgoInteractionPlanV1 {
  const capturedInput = freezeInput(input);
  const before = freezeState(context.state);
  const nodeId = input.target.kind === 'node' ? input.target.nodeId : undefined;
  const isMember = nodeId !== undefined && before.attentionNodeIds.includes(nodeId);
  const membershipAction = input.membershipAction ?? (input.modifiers.ctrl ? 'remove' : undefined);
  const action: EgoInteractionPlanV1['action'] = input.navigationAction ?? (nodeId === undefined
    ? before.viewId === 'overview' && input.modality !== 'keyboard' ? 'enter-constellation' : 'back'
    : input.objectAction === 'focus' ? 'focus-member'
    : membershipAction === 'remove' ? isMember ? 'remove-member' : 'none'
    : membershipAction === 'toggle' ? isMember ? 'remove-member' : 'admit-member'
    : before.viewId === 'focus' && nodeId === before.focusedNodeId ? 'none'
    : before.viewId === 'overview' ? context.awarenessNodeIds.has(nodeId) || isMember ? 'choose-constellation' : 'admit-member'
    : before.viewId === 'explore' && !before.attentionNodeIds.includes(nodeId) ? 'admit-member' : 'focus-member');
  const addsMember = nodeId !== undefined && !before.attentionNodeIds.includes(nodeId)
    && membershipAction !== 'remove' && action !== 'choose-constellation';
  const constellationPathNodeIds = addsMember
    && GRAPH_VIEW_DEFINITIONS_V1[before.viewId].interactions.membershipAddition === 'candidate-and-nearest-path'
    ? resolveGraphHoverPathV1(nodeId, { edges: context.edges ?? [],
      visibleNodeIds: context.visibleNodeIds, visibleEdgeIds: context.visibleEdgeIds,
      topology: context.topology,
      targetNodeIds: new Set(before.attentionNodeIds) }) : [];
  const basis = { input: capturedInput, identity: Object.freeze({ ...context.identity }),
    contextKey: egoInteractionContextKeyV1(context), before, action,
    constellationPathNodeIds: Object.freeze(constellationPathNodeIds) };
  const reject = (reason: string): EgoInteractionPlanV1 => Object.freeze({
    ...basis, outcome: 'rejected', reason, resultingState: before, effects: Object.freeze([]),
  });
  if (nodeId !== undefined && !context.visibleNodeIds.has(nodeId)) return reject('target-not-visible');
  // No mutation is proposed: keep even an empty Constellation intact, with no effects.
  const proposal = action === 'none' ? { type: 'direct-attention' as const,
      nodeIds: before.attentionNodeIds, viewMode: before.viewId }
    : input.navigationAction === 'overview' || input.navigationAction === 'clear-constellation'
      ? { type: 'direct-attention' as const,
        nodeIds: input.navigationAction === 'clear-constellation' ? [] : before.attentionNodeIds,
        clearFocus: true, viewMode: 'overview' as const }
    : nodeId === undefined ? { type: 'activate-background' as const, back: input.navigationAction === 'back' || input.modality === 'keyboard' }
    : planGraphViewObjectActivationV1({ ...before, nodeId, ctrl: input.modifiers.ctrl, membershipAction,
      objectAction: input.objectAction,
      highlightedNodeIds: new Set([...before.attentionNodeIds, ...context.awarenessNodeIds]),
      getConstellation: context.getConstellation, constellationPathNodeIds });
  if (!proposal) return reject('target-not-selectable');
  const outcome = (context.judgement ?? DEFAULT_EGO_JUDGEMENT_V1).consider<GraphRuntimeCommandV1>({
    source: 'endogenous', directive: { ...proposal, identity: context.identity, timestamp: 0 },
  }, (intent) => adjudicateGraphExperienceCommandV1({
    command: intent.directive,
    experience: context.experience, currentState: before.viewId,
    attentionNodeIds: before.attentionNodeIds, focusedNodeId: before.focusedNodeId,
  }));
  if (outcome.status === 'rejected') return reject(outcome.reason);
  const directive = freezeDirective(outcome.directive as EgoViewDirectiveV1);
  const resultingState = action === 'none' ? before : realizeEgoViewDirectiveV1(directive, before, context.availableNodeIds, context.experience);
  const effects: EgoInteractionEffectV1[] = [];
  const focusChanged = resultingState.focusedNodeId !== before.focusedNodeId;
  if (directive.type === 'activate-background' || input.navigationAction !== undefined || focusChanged) effects.push(Object.freeze({ type: 'clear-presentation' }));
  if (directive.type === 'direct-attention' && focusChanged && resultingState.focusedNodeId !== undefined
    && context.experience.framing.focus.entry !== 'preserve') {
    effects.push(Object.freeze({ type: 'recenter-focus', nodeId: resultingState.focusedNodeId }));
  }
  return Object.freeze({ ...basis, outcome: outcome.status, directive, resultingState,
    constellationPathNodeIds: Object.freeze(constellationPathNodeIds.every((id) => resultingState.attentionNodeIds.includes(id))
      ? constellationPathNodeIds : []), effects: Object.freeze(effects) });
}

export function isEgoInteractionPlanCurrentV1(plan: EgoInteractionPlanV1, context: EgoInteractionContextV1): boolean {
  return plan.contextKey === egoInteractionContextKeyV1(context);
}

/** A new gesture phase can reuse an admitted outcome; its physical input is still captured. */
export function sameEgoInteractionV1(a: EgoInteractionInputV1, b: EgoInteractionInputV1): boolean {
  return a.target.kind === b.target.kind
    && (a.target.kind !== 'node' || (b.target.kind === 'node' && a.target.nodeId === b.target.nodeId))
    && a.modality === b.modality && a.modifiers.ctrl === b.modifiers.ctrl
    && a.membershipAction === b.membershipAction
    && a.objectAction === b.objectAction && a.navigationAction === b.navigationAction
    && a.modifiers.meta === b.modifiers.meta && a.modifiers.shift === b.modifiers.shift && a.modifiers.alt === b.modifiers.alt;
}

export function captureEgoInteractionPhaseV1(plan: EgoInteractionPlanV1, input: EgoInteractionInputV1): EgoInteractionPlanV1 {
  return Object.freeze({ ...plan, input: freezeInput(input) });
}

function egoInteractionContextKeyV1(context: EgoInteractionContextV1): string {
  return JSON.stringify([context.identity, context.state.viewId, context.state.attentionNodeIds,
    context.state.focusedNodeId, context.planningRevision ?? [
      [...context.availableNodeIds].sort(), [...context.visibleNodeIds].sort(), [...context.visibleEdgeIds].sort(),
    ], [...context.awarenessNodeIds].sort(),
    [...(context.rememberedNodeIds ?? [])].sort(), context.experience,
    (context.judgement ?? DEFAULT_EGO_JUDGEMENT_V1).revision]);
}

function freezeInput(input: EgoInteractionInputV1): EgoInteractionInputV1 {
  return Object.freeze({ ...input, target: Object.freeze({ ...input.target }), modifiers: Object.freeze({ ...input.modifiers }) });
}

function freezeState(state: EgoInteractionStateV1): EgoInteractionStateV1 {
  return Object.freeze({ ...state, attentionNodeIds: Object.freeze([...state.attentionNodeIds]) });
}

function freezeDirective(directive: EgoViewDirectiveV1): EgoViewDirectiveV1 {
  return Object.freeze({ ...directive, identity: Object.freeze({ ...directive.identity }),
    ...(directive.type === 'direct-attention' ? { nodeIds: Object.freeze([...directive.nodeIds]) } : {}),
  });
}
