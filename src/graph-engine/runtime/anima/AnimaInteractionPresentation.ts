import {
  EGO_UI_STATE_CONTRACTS_V1,
  type EgoPresentationRoleV1,
  type EgoUiStateV1,
} from '../ego/index.ts';

/** @deprecated Presentation roles are semantic Ego output; Anima realizes them. */
export type AnimaPresentationRoleV1 = EgoPresentationRoleV1;

export interface AnimaInteractionPresentationV1 {
  readonly selection: AnimaPresentationRoleV1;
  readonly selectionNeighborhood: AnimaPresentationRoleV1;
  readonly focusedNeighborhood: AnimaPresentationRoleV1;
  readonly graphContext: AnimaPresentationRoleV1;
}

/** @deprecated Compatibility projection of Ego's state-scoped highlight contracts. */
export const ANIMA_INTERACTION_PRESENTATION_V1: Readonly<Record<EgoUiStateV1, AnimaInteractionPresentationV1>> = {
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
    graphContext: EGO_UI_STATE_CONTRACTS_V1.explore.highlightOverride?.contextRole ?? 'normal',
  },
  focus: {
    selection: 'highlighted',
    selectionNeighborhood: 'hidden',
    focusedNeighborhood: 'highlighted',
    graphContext: EGO_UI_STATE_CONTRACTS_V1.focus.highlightOverride?.contextRole ?? 'normal',
  },
};
