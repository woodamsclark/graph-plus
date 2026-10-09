export const GRAPH_CONSCIOUS_REACTIONS_CAPABILITY_V1 = 'conscious-reactions';

export type GraphConsciousObservationTypeV1 =
  | 'node-activated'
  | 'node-selected'
  | 'node-focused'
  | 'node-drag-ended';

export interface GraphAssociationCriteriaV1 {
  readonly observation: GraphConsciousObservationTypeV1;
  /** Number of matching observations required before the association is recognized. */
  readonly occurrences: number;
  /** Optional sliding temporal window. Omit to associate across retained memory. */
  readonly withinMs?: number;
  /** Recognize each new multiple of occurrences instead of only the first crossing. */
  readonly repeat?: boolean;
}

export interface GraphReactionRegistrationV1 {
  readonly id: string;
  readonly association: GraphAssociationCriteriaV1;
  /** Reactions may invoke only an action already registered by the same consumer lease. */
  readonly reaction: {
    readonly type: 'invoke-node-action';
    readonly actionId: string;
  };
}
