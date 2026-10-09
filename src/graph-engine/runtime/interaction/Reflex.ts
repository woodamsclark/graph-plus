import {
  decideInteractionReceiptV1,
  type InteractionReceiptDecisionV1,
  type InteractionReceiptV1,
} from './InteractionReceipt.ts';
import type { InputGraphIdentityV1 } from './GraphInteractionTypes.ts';

/**
 * Subject-local autonomic memory. A Reflex retains one short-lived receipt and
 * recognizes a later stimulus without owning the response that follows.
 */
export class Reflex<Receipt extends InteractionReceiptV1> {
  private current: Receipt | null = null;

  remember(receipt: Receipt): void {
    this.current = receipt;
  }

  forget(): void {
    this.current = null;
  }

  receipt(): Receipt | null {
    return this.current;
  }

  recognize<Candidate extends {
    readonly identity: InputGraphIdentityV1;
    readonly timestamp: number;
  }>(
    candidate: Candidate,
    matches: (receipt: Receipt, candidate: Candidate) => boolean,
  ): InteractionReceiptDecisionV1<Receipt> {
    return decideInteractionReceiptV1(this.current, candidate, matches);
  }
}
