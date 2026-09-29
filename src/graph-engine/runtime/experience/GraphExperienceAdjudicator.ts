import type {
  GraphEndogenousCapabilityV1,
  GraphExperienceContractV1,
  GraphExperienceStateV1,
} from '../../contracts/v1/index.ts';
import type { EgoIntentOutcome } from '../consciousness/index.ts';
import type { GraphRuntimeCommandV1 } from '../interaction/GraphInteractionTypes.ts';
import { constrainAttentionNodeIdsV1 } from './GraphExperienceContract.ts';

export function adjudicateGraphExperienceCommandV1(options: {
  readonly command: GraphRuntimeCommandV1;
  readonly experience: GraphExperienceContractV1;
  readonly currentState: GraphExperienceStateV1;
  readonly attentionNodeIds: readonly string[];
  readonly focusedNodeId?: string;
}): EgoIntentOutcome<GraphRuntimeCommandV1> {
  const capability = commandCapability(options.command);
  if (!options.experience.permittedInteractions.includes(capability)) {
    return { status: 'rejected', reason: `interaction-not-permitted:${capability}` };
  }
  const command = options.command;
  if (command.type === 'direct-attention') {
    const nodeIds = constrainAttentionNodeIdsV1(
      command.nodeIds,
      options.experience.attention,
      command.subjectNodeId,
    );
    const intendedState = nodeIds.length === 0
      ? 'overview'
      : command.clearFocus || options.focusedNodeId === undefined
        ? 'explore'
        : 'focus';
    if (options.experience.allowedStates.includes(intendedState)) {
      return sameIds(nodeIds, command.nodeIds)
        ? { status: 'accepted', directive: command }
        : { status: 'adjusted', directive: { ...command, nodeIds } };
    }
    if (nodeIds.length > 0 && options.experience.allowedStates.includes('focus')) {
      return {
        status: 'adjusted',
        directive: {
          ...command,
          nodeIds,
          clearFocus: false,
          focusNodeId: command.subjectNodeId ?? nodeIds[nodeIds.length - 1],
        },
      };
    }
    return { status: 'rejected', reason: `state-not-permitted:${intendedState}` };
  }
  if (command.type === 'set-focus') {
    const intendedState = command.nodeId === undefined
      ? options.attentionNodeIds.length > 0 ? 'explore' : 'overview'
      : options.attentionNodeIds.length > 0 ? 'focus' : 'overview';
    return options.experience.allowedStates.includes(intendedState)
      ? { status: 'accepted', directive: command }
      : { status: 'rejected', reason: `state-not-permitted:${intendedState}` };
  }
  if (command.type === 'enter-focus') {
    return options.attentionNodeIds.length > 0 && options.experience.allowedStates.includes('focus')
      ? { status: 'accepted', directive: command }
      : { status: 'rejected', reason: 'state-not-permitted:focus' };
  }
  if (command.type === 'activate-background') {
    const intendedState = options.currentState === 'focus' && options.attentionNodeIds.length > 1
      ? 'explore'
      : 'overview';
    return options.experience.allowedStates.includes(intendedState)
      ? { status: 'accepted', directive: command }
      : { status: 'rejected', reason: `state-not-permitted:${intendedState}` };
  }
  return { status: 'accepted', directive: command };
}

function commandCapability(command: GraphRuntimeCommandV1): GraphEndogenousCapabilityV1 {
  switch (command.type) {
    case 'pan-by':
    case 'elastic-pan-by':
    case 'orbit-by':
    case 'zoom-by':
    case 'center-camera':
    case 'center-and-fit-camera':
    case 'reset-camera':
    case 'fit-camera':
      return 'navigate-camera';
    case 'direct-attention':
    case 'activate-background':
      return 'direct-attention';
    case 'set-focus':
    case 'enter-focus':
      return 'direct-focus';
    case 'activate-node':
      return 'activate-subject';
    case 'selection-presentation-changed':
    case 'set-hover':
    case 'set-preview-hover':
      return 'inspect-subject';
    case 'drag-start':
    case 'drag-update':
    case 'drag-end':
      return 'move-subject';
    case 'request-node-context':
      return 'request-subject-actions';
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
