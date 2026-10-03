import type {
  GraphExperienceContractV1,
  GraphExternalInfluenceResultV1,
  GraphExternalInfluenceV1,
} from '../../contracts/v1/index.ts';
import { constrainAttentionNodeIdsV1 } from './GraphExperienceContract.ts';

export interface ResolvedGraphExternalInfluenceV1 {
  readonly result: GraphExternalInfluenceResultV1;
  readonly attentionNodeIds?: readonly string[];
  readonly focusedNodeId?: string;
  readonly rememberedNodeIds?: readonly string[];
}

/** Resolve host-translated truth against neutral experience invariants without consulting Ego. */
export function resolveGraphExternalInfluenceV1(options: {
  readonly influence: GraphExternalInfluenceV1;
  readonly experience: GraphExperienceContractV1;
  readonly availableNodeIds: ReadonlySet<string>;
}): ResolvedGraphExternalInfluenceV1 {
  if (options.influence.schemaVersion !== 1) {
    return { result: { status: 'rejected', reason: 'unsupported-external-influence-version' } };
  }
  if (options.influence.type === 'replace-remembered-subjects') {
    const requestedNodeIds = [...new Set(options.influence.nodeIds)];
    const rememberedNodeIds = requestedNodeIds
      .filter((nodeId) => options.availableNodeIds.has(nodeId));
    const status = rememberedNodeIds.length === requestedNodeIds.length ? 'accepted' : 'adjusted';
    return {
      result: { status, rememberedNodeIds },
      rememberedNodeIds,
    };
  }
  const requestedNodeIds = [...new Set(options.influence.nodeIds)];
  const knownNodeIds = requestedNodeIds.filter((nodeId) => options.availableNodeIds.has(nodeId));
  const requestedFocusNodeId = options.influence.focusNodeId;
  const attentionNodeIds = constrainAttentionNodeIdsV1(
    knownNodeIds,
    options.experience.attention,
    requestedFocusNodeId,
  );
  const unknownRemoved = knownNodeIds.length !== requestedNodeIds.length;
  const cardinalityAdjusted = attentionNodeIds.length !== knownNodeIds.length;
  if (requestedFocusNodeId !== undefined && !options.availableNodeIds.has(requestedFocusNodeId)) {
    return { result: { status: 'rejected', reason: 'unknown-focus-subject' } };
  }
  if (attentionNodeIds.length === 0) {
    if (options.availableNodeIds.size > 0 && !options.experience.allowedStates.includes('overview')) {
      return { result: { status: 'rejected', reason: 'state-not-permitted:overview' } };
    }
    const status = unknownRemoved || requestedFocusNodeId !== undefined ? 'adjusted' : 'accepted';
    return {
      result: { status, attentionNodeIds: [] },
      attentionNodeIds: [],
    };
  }
  let focusedNodeId = requestedFocusNodeId;
  let stateAdjusted = false;
  if (focusedNodeId !== undefined && !attentionNodeIds.includes(focusedNodeId)) {
    focusedNodeId = undefined;
    stateAdjusted = true;
  }
  if (focusedNodeId !== undefined && !options.experience.allowedStates.includes('focus')) {
    if (!options.experience.allowedStates.includes('explore')) {
      return { result: { status: 'rejected', reason: 'state-not-permitted:focus' } };
    }
    focusedNodeId = undefined;
    stateAdjusted = true;
  }
  if (focusedNodeId === undefined && !options.experience.allowedStates.includes('explore')) {
    if (!options.experience.allowedStates.includes('focus')) {
      return { result: { status: 'rejected', reason: 'state-not-permitted:explore' } };
    }
    focusedNodeId = attentionNodeIds[attentionNodeIds.length - 1];
    stateAdjusted = true;
  }
  const status = unknownRemoved || cardinalityAdjusted || stateAdjusted ? 'adjusted' : 'accepted';
  const result: GraphExternalInfluenceResultV1 = {
    status,
    attentionNodeIds,
    ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
  };
  return {
    result,
    attentionNodeIds,
    ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
  };
}
