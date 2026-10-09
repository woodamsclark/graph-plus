import type { InputGraphIdentityV1 } from './GraphInteractionTypes.ts';

/**
 * Immutable evidence that an interaction has already been committed and may be
 * reconciled by a later related interaction. Receipts describe history; they do
 * not defer, undo, or prescribe effects themselves.
 */
export interface InteractionReceiptV1<Kind extends string = string, Payload = unknown> {
  readonly schemaVersion: 1;
  readonly kind: Kind;
  readonly identity: InputGraphIdentityV1;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly events: readonly InteractionReceiptEventV1[];
  readonly payload: Payload;
}

/** One timestamped fact in the bounded interaction history carried by a receipt. */
export interface InteractionReceiptEventV1<
  Phase extends string = string,
  Payload = unknown,
> {
  readonly phase: Phase;
  readonly timestamp: number;
  readonly payload: Payload;
}

export type InteractionReceiptDecisionV1<Receipt> =
  | { readonly status: 'empty' }
  | { readonly status: 'expired'; readonly receipt: Receipt }
  | { readonly status: 'unmatched'; readonly receipt: Receipt }
  | { readonly status: 'matched'; readonly receipt: Receipt };

/** Pure receipt adjudication: the caller owns storage and all resulting effects. */
export function decideInteractionReceiptV1<
  Receipt extends InteractionReceiptV1,
  Candidate extends { readonly identity: InputGraphIdentityV1; readonly timestamp: number },
>(
  receipt: Receipt | null | undefined,
  candidate: Candidate,
  matches: (receipt: Receipt, candidate: Candidate) => boolean,
): InteractionReceiptDecisionV1<Receipt> {
  if (!receipt) return { status: 'empty' };
  if (!sameIdentity(receipt.identity, candidate.identity)
    || candidate.timestamp < receipt.issuedAt
    || candidate.timestamp > receipt.expiresAt) {
    return { status: 'expired', receipt };
  }
  return matches(receipt, candidate)
    ? { status: 'matched', receipt }
    : { status: 'unmatched', receipt };
}

/** Purely extends a receipt's evidence log without mutating prior history. */
export function appendInteractionReceiptEventV1<Receipt extends InteractionReceiptV1>(
  receipt: Receipt,
  event: InteractionReceiptEventV1,
): Receipt {
  return {
    ...receipt,
    events: [...receipt.events, event],
  };
}

function sameIdentity(a: InputGraphIdentityV1, b: InputGraphIdentityV1): boolean {
  return a.documentId === b.documentId && a.documentRevision === b.documentRevision;
}
