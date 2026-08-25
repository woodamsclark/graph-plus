import type { GraphSessionV1 } from './session.ts';

export interface GraphNodeActionRegistrationV1 {
  readonly id: string;
  readonly label: string | ((context: GraphNodeActionContextV1) => string);
  readonly icon?: string;
  readonly isAvailable?: (context: GraphNodeActionContextV1) => boolean;
  readonly run: (context: GraphNodeActionContextV1) => void | Promise<void>;
}

export interface GraphNodeActionContextV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly session: GraphSessionV1;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly nodeId: string;
  readonly selectedNodeIds: readonly string[];
  readonly focusedNodeId?: string;
}

export interface GraphInteractionProfileV1 {
  readonly activationActionIds?: readonly string[];
  readonly contextActionIds?: readonly string[];
}
