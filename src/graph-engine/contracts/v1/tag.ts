import type { GraphAttributeValue, Vec3 } from './values.ts';

export interface GraphTagDefinitionV1 {
  readonly nodeId: string;
  readonly label?: string;
  readonly parentTagNodeIds?: readonly string[];
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
  readonly positionHint?: Vec3;
}

export interface GraphTagMembershipV1 {
  readonly tagNodeId: string;
  readonly memberNodeId: string;
  readonly weight?: number;
}

/** Consumer-normalized tag data. The engine does not discover or parse tags. */
export interface GraphTagProjectionInputV1 {
  readonly version: 1;
  readonly tags: readonly GraphTagDefinitionV1[];
  readonly memberships: readonly GraphTagMembershipV1[];
}

export class InvalidGraphTagProjectionErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGraphTagProjectionErrorV1';
  }
}
