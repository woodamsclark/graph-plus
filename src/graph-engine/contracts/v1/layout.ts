export const GRAPH_LINEAR_BUILD_DIRECTIONS_V1 = [
  'up',
  'down',
  'left',
  'right',
  'in',
  'out',
] as const;

export type GraphLinearBuildDirectionV1 = typeof GRAPH_LINEAR_BUILD_DIRECTIONS_V1[number];

/** Public settings accepted by the shipped `linear-layout` module. */
export interface GraphLinearBuildOutLayoutSettingsV1 {
  /** Axis followed by increasing directed depth. `in` and `out` require 3D. */
  readonly buildDirection: GraphLinearBuildDirectionV1;
  /** Distance between successive directed depth layers. */
  readonly layerSpacing?: number;
  /** Distance between siblings within one depth layer. */
  readonly branchSpacing?: number;
  /** Separation between disconnected graph components. */
  readonly componentSpacing?: number;
}
