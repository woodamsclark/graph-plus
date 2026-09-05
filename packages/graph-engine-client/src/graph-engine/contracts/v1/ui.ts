import type { GraphSessionV1 } from './session.ts';
import type { Disposable } from './values.ts';

export type GraphUiVisibilityV1 = 'shown' | 'collapsed' | 'hidden';
export type GraphUiControlVisibilityV1 = 'shown' | 'hidden';

export const GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 = Object.freeze({
  filter: 'filter',
  form: 'form',
  display: 'display',
  camera: 'camera',
  forces: 'forces',
  regions: 'regions',
} as const);

export const GRAPH_QUICK_SETTINGS_CONTROL_IDS_V1 = Object.freeze({
  clearFilter: 'filter.clear',
  mindMap: 'form.mind-map',
  formDirection: 'form.direction',
  formDepth: 'form.depth',
  formBranchColors: 'form.branch-colors',
  formCrossLinks: 'form.cross-links',
  formDisconnected: 'form.disconnected',
  labels: 'display.labels',
  labelPosition: 'display.label-position',
  nodeSize: 'display.node-size',
  linkThickness: 'display.link-thickness',
  showArrows: 'display.show-arrows',
  resetCamera: 'camera.reset',
  centerForce: 'forces.center',
  radialForce: 'forces.radial',
  weightingMode: 'force-layout.weighting-mode',
  linkForce: 'forces.link',
  linkDistance: 'forces.link-distance',
  regionAttraction: 'node-regions.attraction',
  regionBoundaries: 'node-regions.boundaries-visible',
} as const);

export const GRAPH_CORE_CONTEXT_ACTION_IDS_V1 = Object.freeze({
  focusNode: 'focus-node',
  mindMapNode: 'mind-map-node',
  togglePin: 'toggle-pin',
} as const);

export interface GraphSessionUiOptionsV1 {
  readonly quickSettings?: GraphQuickSettingsOptionsV1;
  readonly contextMenu?: GraphContextMenuOptionsV1;
  readonly hostOcclusions?: readonly GraphUiOcclusionV1[];
}

export interface GraphQuickSettingsOptionsV1 {
  readonly visibility?: GraphUiVisibilityV1;
  readonly sections?: Readonly<Record<string, GraphQuickSettingsSectionOptionsV1>>;
  readonly contributions?: readonly GraphQuickSettingsContributionV1[];
}

export interface GraphQuickSettingsSectionOptionsV1 {
  readonly visibility?: GraphUiControlVisibilityV1;
  readonly controls?: Readonly<Record<string, GraphUiControlVisibilityV1>>;
}

export interface GraphContextMenuOptionsV1 {
  readonly enabled?: boolean;
  readonly coreActions?: Readonly<Record<string, GraphUiControlVisibilityV1>>;
}

export interface GraphUiOcclusionV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GraphQuickSettingsContributionV1 {
  readonly id: string;
  readonly sectionId: string;
  readonly order?: number;
  readonly mount: (
    container: HTMLElement,
    context: GraphUiContributionContextV1,
  ) => void | Disposable;
}

export interface GraphUiContributionContextV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly session: GraphSessionV1;
}

export interface GraphProfileUiDefaultsV1 {
  readonly quickSettingsVisibility?: GraphUiVisibilityV1;
  readonly quickSettingsSections?: Readonly<
    Record<string, GraphQuickSettingsSectionOptionsV1>
  >;
  readonly contextMenuEnabled?: boolean;
  readonly coreContextActions?: Readonly<
    Record<string, GraphUiControlVisibilityV1>
  >;
  readonly dimensionControlVisible?: boolean;
}
