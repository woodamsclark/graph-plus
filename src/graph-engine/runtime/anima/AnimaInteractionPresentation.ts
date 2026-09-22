import type { GraphUxStateV1 } from '../interaction/index.ts';

export type AnimaPresentationRoleV1 = 'normal' | 'highlighted' | 'dimmed' | 'hidden';

export interface AnimaInteractionPresentationV1 {
  readonly selection: AnimaPresentationRoleV1;
  readonly focusedNeighborhood: AnimaPresentationRoleV1;
  readonly graphContext: AnimaPresentationRoleV1;
}

/** Visual interpretation belongs to Anima, not the Animus interaction policy. */
export const ANIMA_INTERACTION_PRESENTATION_V1: Readonly<Record<GraphUxStateV1, AnimaInteractionPresentationV1>> = {
  overview: { selection: 'normal', focusedNeighborhood: 'normal', graphContext: 'normal' },
  explore: { selection: 'highlighted', focusedNeighborhood: 'normal', graphContext: 'dimmed' },
  focus: { selection: 'highlighted', focusedNeighborhood: 'highlighted', graphContext: 'hidden' },
};
