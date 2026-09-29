import {
  ALL_GRAPH_ENDOGENOUS_CAPABILITIES_V1,
  DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  type GraphEndogenousCapabilityV1,
  type GraphExperienceAttentionPolicyV1,
  type GraphExperienceContractV1,
  type GraphExperienceStateV1,
} from '../../contracts/v1/index.ts';

const STATES: readonly GraphExperienceStateV1[] = ['overview', 'explore', 'focus'];
const CAPABILITIES = new Set<GraphEndogenousCapabilityV1>(ALL_GRAPH_ENDOGENOUS_CAPABILITIES_V1);

export function resolveGraphExperienceContractV1(
  requested: GraphExperienceContractV1 | undefined,
): GraphExperienceContractV1 {
  const source = requested ?? DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1;
  if (source.contractVersion !== 1) throw new Error('Graph experience contract version must be 1.');
  const allowedStates = unique(source.allowedStates);
  if (allowedStates.length === 0 || allowedStates.some((state) => !STATES.includes(state))) {
    throw new Error('Graph experience contract must allow at least one recognized state.');
  }
  const maximumNodeCount = source.attention.maximumNodeCount;
  if (maximumNodeCount !== undefined
    && (!Number.isInteger(maximumNodeCount) || maximumNodeCount < 1)) {
    throw new Error('Graph experience Attention maximum must be a positive integer.');
  }
  if (source.attention.overflow !== 'preserve-intent-subject') {
    throw new Error('Graph experience Attention overflow policy is unsupported.');
  }
  const depth = source.awareness.attentionNeighborhoodDepth;
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) {
    throw new Error('Graph experience Awareness depth must be an integer from 0 through 8.');
  }
  const permittedInteractions = unique(source.permittedInteractions);
  if (permittedInteractions.some((capability) => !CAPABILITIES.has(capability))) {
    throw new Error('Graph experience contract contains an unsupported interaction capability.');
  }
  for (const state of STATES) {
    const framing = source.framing[state];
    if (!framing) throw new Error(`Graph experience contract is missing ${state} framing.`);
  }
  return {
    contractVersion: 1,
    allowedStates,
    attention: {
      ...(maximumNodeCount === undefined ? {} : { maximumNodeCount }),
      overflow: 'preserve-intent-subject',
    },
    awareness: { attentionNeighborhoodDepth: depth },
    permittedInteractions,
    framing: {
      overview: { ...source.framing.overview },
      explore: { ...source.framing.explore },
      focus: { ...source.framing.focus },
    },
  };
}

export function constrainAttentionNodeIdsV1(
  nodeIds: Iterable<string>,
  policy: GraphExperienceAttentionPolicyV1,
  intentSubjectNodeId?: string,
): string[] {
  const uniqueNodeIds = unique(nodeIds);
  const maximum = policy.maximumNodeCount;
  if (maximum === undefined || uniqueNodeIds.length <= maximum) return uniqueNodeIds;
  if (intentSubjectNodeId !== undefined && uniqueNodeIds.includes(intentSubjectNodeId)) {
    const remaining = maximum - 1;
    return [
      ...(remaining === 0
        ? []
        : uniqueNodeIds.filter((nodeId) => nodeId !== intentSubjectNodeId).slice(-remaining)),
      intentSubjectNodeId,
    ];
  }
  return uniqueNodeIds.slice(-maximum);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}
