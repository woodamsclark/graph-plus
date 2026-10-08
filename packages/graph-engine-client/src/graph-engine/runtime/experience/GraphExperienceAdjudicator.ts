import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
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
  // Cleanup remains necessary if the experience changed during a gesture.
  if (options.command.type === 'cancel-input'
    || (options.command.type === 'drag-end' && options.command.cancelled)) {
    return { status: 'accepted', directive: options.command };
  }
  const capability = commandCapability(options.command);
  if (!options.experience.permittedInteractions.includes(capability)) {
    return { status: 'rejected', reason: `interaction-not-permitted:${capability}` };
  }
  const command = options.command;
  if (command.type === 'direct-attention') {
    if (command.focusNodeId !== undefined && !options.experience.permittedInteractions.includes('direct-focus')) {
      return { status: 'rejected', reason: 'interaction-not-permitted:direct-focus' };
    }
    const nodeIds = constrainAttentionNodeIdsV1(
      command.nodeIds,
      options.experience.attention,
      command.subjectNodeId,
    );
    if (nodeIds.length === 0 && command.viewMode === 'overview'
      && !options.experience.allowedStates.includes('overview')
      && options.experience.allowedStates.includes('explore')) {
      return { status: 'adjusted', directive: { ...command, nodeIds,
        clearFocus: true, focusNodeId: undefined, viewMode: 'explore' } };
    }
    const intendedState = command.viewMode ?? (command.focusNodeId !== undefined
      ? 'focus'
      : command.clearFocus && options.currentState === 'focus'
        ? 'explore'
        : options.currentState);
    if (options.experience.allowedStates.includes(intendedState)) {
      return sameIds(nodeIds, command.nodeIds)
        ? { status: 'accepted', directive: command }
        : { status: 'adjusted', directive: { ...command, nodeIds } };
    }
    if (nodeIds.length > 0 && options.experience.allowedStates.includes('focus')
      && options.experience.permittedInteractions.includes('direct-focus')) {
      return {
        status: 'adjusted',
        directive: {
          ...command,
          nodeIds,
          clearFocus: false,
          viewMode: 'focus',
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
  if (command.type === 'enter-focus' || command.type === 'transition-focus') {
    return options.attentionNodeIds.length > 0 && options.experience.allowedStates.includes('focus')
      ? { status: 'accepted', directive: command }
      : { status: 'rejected', reason: 'state-not-permitted:focus' };
  }
  if (command.type === 'activate-background') {
    const bindings = GRAPH_VIEW_DEFINITIONS_V1[options.currentState].interactions;
    const intendedState = command.back ? bindings.escapeActivation : bindings.backgroundActivation;
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
    case 'reconcile-interaction-state':
    case 'activate-background':
    case 'activate-view':
      return 'direct-attention';
    case 'set-focus':
    case 'enter-focus':
    case 'transition-focus':
      return 'direct-focus';
    case 'activate-node':
      return 'activate-subject';
    case 'selection-presentation-changed':
    case 'cancel-input':
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
