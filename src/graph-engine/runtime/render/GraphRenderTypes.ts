import type { Vec3 } from '../../contracts/v1/index.ts';
import { DEFAULT_GRAPH_VISUAL_THEME_V2, type GraphColorV2, type GraphVisualThemeV2 } from '../theme/index.ts';

export interface GraphRenderNodeV1 {
  readonly id: string;
  readonly label: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly hovered: boolean;
  /** An authoritative presentation color that wins over renderer interaction fallbacks. */
  readonly finalColor?: GraphColorV2;
  readonly color?: GraphColorV2;
  readonly opacity?: number;
  readonly strokeColor?: GraphColorV2;
  readonly strokeWidth?: number;
  readonly labelColor?: GraphColorV2;
  readonly labelOpacity?: number;
  readonly labelFontSize?: number;
  /** Final screen-space offset from the normal centered label anchor. */
  readonly labelOffset?: { readonly x: number; readonly y: number };
  readonly showLabel?: boolean;
  readonly labelPriority?: number;
  readonly labelAlwaysVisible?: boolean;
}

export interface GraphRenderEdgeV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly directed: boolean;
  readonly thickness: number;
  readonly color?: GraphColorV2;
  readonly opacity?: number;
  readonly arrowAtSource?: boolean;
  readonly arrowAtTarget?: boolean;
  readonly arrowColor?: GraphColorV2;
  readonly arrowOpacity?: number;
  readonly dashed?: boolean;
}

export interface GraphRenderRegionV1 {
  readonly id: string;
  readonly regionNodeId: string;
  readonly memberNodeIds: readonly string[];
  readonly directMemberNodeIds: readonly string[];
  readonly connections: readonly {
    readonly sourceId: string;
    readonly targetId: string;
  }[];
  readonly color: GraphColorV2;
  readonly padding: number;
  readonly fillColor?: GraphColorV2;
  readonly fillOpacity?: number;
  readonly strokeColor?: GraphColorV2;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
}

export interface GraphNodeRenderContributionV1 {
  /** An authoritative presentation color that wins over renderer interaction fallbacks. */
  readonly finalColor?: GraphColorV2;
  readonly color?: GraphColorV2;
  /** Final world-space radius. When present this wins over the legacy radiusScale. */
  readonly radius?: number;
  readonly radiusScale?: number;
  /** Graph-wide multiplier kept separate so structural role scales can compose. */
  readonly baseRadiusScale?: number;
  readonly opacity?: number;
  readonly strokeColor?: GraphColorV2;
  readonly strokeWidth?: number;
  readonly labelColor?: GraphColorV2;
  readonly labelOpacity?: number;
  readonly labelFontSize?: number;
  readonly labelOffset?: { readonly x: number; readonly y: number };
  readonly showLabel?: boolean;
  readonly labelPriority?: number;
  readonly labelAlwaysVisible?: boolean;
}

export interface GraphEdgeRenderContributionV1 {
  readonly color?: GraphColorV2;
  /** Final screen-space width. When present this wins over the legacy thicknessScale. */
  readonly thickness?: number;
  readonly thicknessScale?: number;
  /** Graph-wide multiplier kept separate so structural role scales can compose. */
  readonly baseThicknessScale?: number;
  readonly opacity?: number;
  readonly dashed?: boolean;
  readonly arrowAtSource?: boolean;
  readonly arrowAtTarget?: boolean;
  readonly arrowColor?: GraphColorV2;
  readonly arrowOpacity?: number;
}

export interface GraphPresentationPolicyV2 {
  readonly labelMode?: 'adaptive' | 'all' | 'off';
  readonly labelPosition?: 'above' | 'below';
  /** Higher values delay ordinary adaptive labels; interaction-required labels remain visible. */
  readonly adaptiveLabelThreshold?: number;
  readonly nodeScaleMode?: 'linear' | 'sqrt-orthographic';
  /** Orthographic node scaling blend: 0 is balanced (sqrt zoom), 1 is true world space (linear zoom). */
  readonly nodeWorldScaleBlend?: number;
  readonly labelScaleMode?: 'fixed' | 'sqrt-orthographic';
  /** New-mode perspective floor for the visible node disc, in CSS pixels. */
  readonly minimumPerspectiveNodeRadius?: number;
  /** Perspective-only minimum fraction of the node's resolved world radius. */
  readonly minimumPerspectiveNodeScale?: number;
  /** Perspective-only finger hit radius; it does not enlarge the visible disc. */
  readonly minimumPerspectiveTouchHitRadius?: number;
  readonly edgeAggregation?: 'canonical' | 'unordered-pair';
  readonly showArrows?: boolean;
}

export interface GraphRenderFrameV1 {
  /** Internal revision used to reuse screen projection across presentation-only frames. */
  readonly geometryRevision?: number;
  readonly regions: readonly GraphRenderRegionV1[];
  readonly nodes: readonly GraphRenderNodeV1[];
  readonly edges: readonly GraphRenderEdgeV1[];
  readonly theme: GraphVisualThemeV2;
  readonly policy?: GraphPresentationPolicyV2;
}

export const DEFAULT_GRAPH_PRESENTATION_POLICY_V2: GraphPresentationPolicyV2 = {
  labelMode: 'adaptive',
  labelPosition: 'below',
  nodeScaleMode: 'linear',
  labelScaleMode: 'fixed',
  edgeAggregation: 'canonical',
  showArrows: true,
};

/** @deprecated Internal V1 compatibility while V2 scene callers migrate. */
export type GraphRenderThemeV1 = GraphVisualThemeV2 & GraphPresentationPolicyV2;

/** @deprecated Use separate visual theme and presentation policy values. */
export const DEFAULT_GRAPH_RENDER_THEME_V1: GraphRenderThemeV1 = {
  ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  ...DEFAULT_GRAPH_VISUAL_THEME_V2,
};
