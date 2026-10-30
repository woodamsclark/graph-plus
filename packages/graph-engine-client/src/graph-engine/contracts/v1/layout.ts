/** Constant, live-updatable world-space force components in force-layout settings. */
export const GRAPH_UNIFORM_FORCE_CAPABILITY_V1 = 'force-layout-uniform-force';

/** Optional `force-layout` settings. Existing alpha, damping and speed limits still apply. */
export interface GraphUniformForceSettingsV1 {
  /** Defaults to false; disabling preserves component values. */
  readonly gravityEnabled?: boolean;
  /** Signed world-space components in solver units, each clamped to -100..100; default zero. */
  readonly gravityX?: number;
  readonly gravityY?: number;
  /** Retained in 2D settings but only applied in 3D. */
  readonly gravityZ?: number;
}

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

export interface GraphEvidenceGrowthPolicyV1 {
  readonly curve: 'none' | 'log2';
  readonly coefficient: number;
}

export interface GraphSpringMappingPolicyV1 {
  readonly strengthExponent: number;
  readonly lengthExponent: number;
  readonly minimumStrengthScale: number;
  readonly maximumStrengthScale: number;
  readonly minimumLengthScale: number;
  readonly maximumLengthScale: number;
  readonly strengthScale: number;
  readonly targetLengthScale: number;
}

export interface GraphRecursiveRegionSpacingPolicyV1 {
  readonly mode: 'off' | 'target-region-closure';
}

/** Declarative pair policy used by topology analysis and force layout. */
export interface GraphTopologyPairPolicyV1 {
  readonly minimumAffinity: number;
  readonly maximumAffinity: number;
  readonly evidenceGrowth: GraphEvidenceGrowthPolicyV1;
  readonly reciprocalBoost: number;
  readonly hubDiscountExponent: number;
  readonly spring: GraphSpringMappingPolicyV1;
  readonly recursiveRegionSpacing: GraphRecursiveRegionSpacingPolicyV1;
}

export interface GraphTopologyPairPolicyOverrideV1 {
  readonly minimumAffinity?: number;
  readonly maximumAffinity?: number;
  readonly evidenceGrowth?: Partial<GraphEvidenceGrowthPolicyV1>;
  readonly reciprocalBoost?: number;
  readonly hubDiscountExponent?: number;
  readonly spring?: Partial<GraphSpringMappingPolicyV1>;
  readonly recursiveRegionSpacing?: Partial<GraphRecursiveRegionSpacingPolicyV1>;
}

export interface GraphRelationPolicyOverrideV1 {
  readonly id: string;
  /** Exact edge token, for example `relation:tag-parent`. */
  readonly edgeToken: string;
  readonly priority: number;
  readonly override: GraphTopologyPairPolicyOverrideV1;
}

/** JSON-serializable universal topology policy. Later matching overrides win by priority then ID. */
export interface GraphTopologyLayoutPolicyV1 {
  readonly version: 1;
  readonly defaultPairPolicy: GraphTopologyPairPolicyV1;
  readonly relationOverrides: readonly GraphRelationPolicyOverrideV1[];
}
