import {
  ANIMA_STATE_PRESENTATION_POLICIES_V1,
  type AnimaPresentationRoleV1,
} from './AnimaAwareness.ts';
import type { GraphUxStateV1 } from '../interaction/index.ts';

export interface AnimaInteractionPresentationV1 {
  readonly selection: AnimaPresentationRoleV1;
  readonly selectionNeighborhood: AnimaPresentationRoleV1;
  readonly focusedNeighborhood: AnimaPresentationRoleV1;
  readonly graphContext: AnimaPresentationRoleV1;
}

/** @deprecated Compatibility projection of Anima's state-scoped presentation policy. */
export const ANIMA_INTERACTION_PRESENTATION_V1: Readonly<Record<GraphUxStateV1, AnimaInteractionPresentationV1>> = {
  overview: {
    selection: 'normal',
    selectionNeighborhood: 'normal',
    focusedNeighborhood: 'normal',
    graphContext: 'normal',
  },
  explore: {
    selection: 'highlighted',
    selectionNeighborhood: 'highlighted',
    focusedNeighborhood: 'normal',
    graphContext: ANIMA_STATE_PRESENTATION_POLICIES_V1.explore.highlightOverride?.contextRole ?? 'normal',
  },
  focus: {
    selection: 'highlighted',
    selectionNeighborhood: 'hidden',
    focusedNeighborhood: 'highlighted',
    graphContext: ANIMA_STATE_PRESENTATION_POLICIES_V1.focus.highlightOverride?.contextRole ?? 'normal',
  },
};
