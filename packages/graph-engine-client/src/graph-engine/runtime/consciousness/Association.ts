import type { GraphAssociationCriteriaV1 } from '../../contracts/v1/index.ts';
import type { ConsciousObservationV1 } from './Memory.ts';

export interface AssociationMatchV1 {
  readonly before: number;
  readonly after: number;
}

/** Pure association recognition over memory counts before and after one observation. */
export function recognizeAssociationV1(
  criteria: GraphAssociationCriteriaV1,
  observation: ConsciousObservationV1,
  before: number,
  after: number,
): AssociationMatchV1 | null {
  if (criteria.observation !== observation.type) return null;
  const threshold = criteria.occurrences;
  const recognized = criteria.repeat
    ? Math.floor(before / threshold) < Math.floor(after / threshold)
    : before < threshold && after >= threshold;
  return recognized ? { before, after } : null;
}
