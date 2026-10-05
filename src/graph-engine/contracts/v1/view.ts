import type { GraphExperienceStateV1 } from './experience.ts';
import { GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 } from './ui.ts';

/** `explore` is the persisted compatibility spelling of Constellation. */
export type GraphViewIdV1 = GraphExperienceStateV1;

export type GraphActiveViewV1 =
  | { readonly id: 'overview' }
  | { readonly id: 'explore' }
  | { readonly id: 'focus'; readonly subjectNodeId: string };

/** UI disclosure only; setting values remain owned by their respective subsystems. */
export interface GraphViewUiStateV1 {
  readonly quickSettingsOpen: boolean;
  readonly expandedSectionIds: readonly string[];
}

export interface GraphViewDefinitionV1 {
  readonly id: GraphViewIdV1;
  readonly title: string;
  readonly purpose: 'discover' | 'build' | 'focus';
  readonly interactions: {
    readonly objectActivation: 'highlight-or-choose-constellation' | 'admit-or-present-object' | 'present-object';
    readonly backgroundActivation: GraphViewIdV1;
    readonly escapeActivation: GraphViewIdV1;
    readonly spaceActivation: 'clear-constellation' | 'preserve-scene';
    readonly modifiedObjectActivation: 'remove-membership';
    /** Any visible, hittable node can be moved without admitting it to the constellation. */
    readonly nodeDrag: 'all-visible' | 'constellation-members';
    readonly membershipAddition: 'candidate-and-nearest-path';
  };
  readonly framing: {
    readonly interest: 'none' | 'constellation' | 'focused-node';
    readonly zoomAnchor: 'pointer' | 'tracked-subject';
    readonly focusEntry: 'recenter-preserve-scale';
    readonly back: 'preserve';
    readonly exitInterest: 'preserve-intent' | 'retain-focal-point';
  };
  readonly scene: {
    readonly membership: 'attention';
    readonly context: 'standard' | 'dimmed' | 'focused-neighbors';
    readonly hover: 'proximity-preview-view-entry' | 'preview-admission-or-view-entry';
    readonly hoverPath: 'nearest-constellation';
    readonly modifiedHoverPath: 'none';
    readonly hoverContext: 'committed-unless-view-entry';
    /** A transient presentation lift, independent of committed Consciousness and Will. */
    readonly hoverAwareness: { readonly phaseSteps: 1; readonly neighborhoodDepth: 0 | 1; readonly links: 'none' | 'incident' };
    readonly dragHighlights: 'preserve-scene';
    /** Reveal eligibility; adaptive layout, budgets and typography remain renderer settings. */
    readonly labels: {
      readonly focused: 'force';
      readonly hovered: 'force';
      readonly highlighted: 'force';
      readonly dimmed: 'suppress';
      readonly void: 'suppress';
      readonly standard: 'fallback';
      readonly removedMember: 'suppress';
    };
  };
  readonly controls: {
    readonly quickSettingsSectionIds: readonly string[];
    readonly navigationActions: readonly ('back' | 'overview' | 'clear-constellation')[];
  };
}

const controls = Object.freeze({
  quickSettingsSectionIds: Object.freeze(Object.values(GRAPH_QUICK_SETTINGS_SECTION_IDS_V1)),
  navigationActions: Object.freeze(['back', 'overview', 'clear-constellation'] as const),
});

function defineView(
  id: GraphViewIdV1,
  title: string,
  purpose: GraphViewDefinitionV1['purpose'],
  interest: GraphViewDefinitionV1['framing']['interest'],
  context: GraphViewDefinitionV1['scene']['context'],
  back: GraphViewIdV1,
): GraphViewDefinitionV1 {
  return Object.freeze({
    id, title, purpose,
    interactions: Object.freeze({
      objectActivation: id === 'overview' ? 'highlight-or-choose-constellation'
        : id === 'explore' ? 'admit-or-present-object' : 'present-object',
      backgroundActivation: id === 'overview' ? 'explore' : back,
      escapeActivation: back,
      spaceActivation: id === 'overview' ? 'clear-constellation' : 'preserve-scene',
      modifiedObjectActivation: 'remove-membership',
      nodeDrag: 'all-visible', membershipAddition: 'candidate-and-nearest-path',
    }),
    framing: Object.freeze({
      interest, zoomAnchor: id === 'overview' ? 'pointer' : 'tracked-subject',
      focusEntry: 'recenter-preserve-scale', back: 'preserve',
      exitInterest: id === 'focus' ? 'retain-focal-point' : 'preserve-intent',
    }),
    scene: Object.freeze({ membership: 'attention', context, hover: id === 'overview' ? 'proximity-preview-view-entry' : 'preview-admission-or-view-entry', hoverPath: 'nearest-constellation', modifiedHoverPath: 'none',
      hoverContext: 'committed-unless-view-entry',
      hoverAwareness: Object.freeze({ phaseSteps: 1, neighborhoodDepth: id === 'overview' ? 0 : 1,
        links: id === 'overview' ? 'none' : 'incident' }),
      dragHighlights: 'preserve-scene',
      labels: Object.freeze({ focused: 'force', hovered: 'force', highlighted: 'force',
        dimmed: 'suppress', void: 'suppress', standard: 'fallback', removedMember: 'suppress' }) }),
    controls,
  });
}

export const GRAPH_VIEW_DEFINITIONS_V1: Readonly<Record<GraphViewIdV1, GraphViewDefinitionV1>> = Object.freeze({
  overview: defineView('overview', 'Overview', 'discover', 'none', 'standard', 'overview'),
  explore: defineView('explore', 'Constellation', 'build', 'constellation', 'dimmed', 'overview'),
  focus: defineView('focus', 'Focus', 'focus', 'focused-node', 'focused-neighbors', 'explore'),
});
