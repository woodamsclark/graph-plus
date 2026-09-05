import type { Vec3 } from '../../contracts/v1/index.ts';

export interface GraphRenderNodeV1 {
  readonly id: string;
  readonly label: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly hovered: boolean;
  /** An authoritative presentation color that wins over renderer interaction fallbacks. */
  readonly finalColor?: string;
  readonly color?: string;
  readonly opacity?: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly labelColor?: string;
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
  readonly color?: string;
  readonly opacity?: number;
  readonly arrowAtSource?: boolean;
  readonly arrowAtTarget?: boolean;
  readonly arrowColor?: string;
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
  readonly color: string;
  readonly padding: number;
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly strokeColor?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
}

export interface GraphNodeRenderContributionV1 {
  /** An authoritative presentation color that wins over renderer interaction fallbacks. */
  readonly finalColor?: string;
  readonly color?: string;
  /** Final world-space radius. When present this wins over the legacy radiusScale. */
  readonly radius?: number;
  readonly radiusScale?: number;
  /** Graph-wide multiplier kept separate so structural role scales can compose. */
  readonly baseRadiusScale?: number;
  readonly opacity?: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly labelColor?: string;
  readonly labelOpacity?: number;
  readonly labelFontSize?: number;
  readonly labelOffset?: { readonly x: number; readonly y: number };
  readonly showLabel?: boolean;
  readonly labelPriority?: number;
  readonly labelAlwaysVisible?: boolean;
}

export interface GraphEdgeRenderContributionV1 {
  readonly color?: string;
  /** Final screen-space width. When present this wins over the legacy thicknessScale. */
  readonly thickness?: number;
  readonly thicknessScale?: number;
  /** Graph-wide multiplier kept separate so structural role scales can compose. */
  readonly baseThicknessScale?: number;
  readonly opacity?: number;
  readonly dashed?: boolean;
  readonly arrowAtSource?: boolean;
  readonly arrowAtTarget?: boolean;
  readonly arrowColor?: string;
  readonly arrowOpacity?: number;
}

export interface GraphRenderThemeV1 {
  readonly backgroundColor: string;
  readonly nodeColor: string;
  readonly tagNodeColor?: string;
  readonly highlightNodeColor?: string;
  readonly nodeOutlineColor?: string;
  readonly selectedNodeColor: string;
  readonly focusedNodeColor: string;
  readonly edgeColor: string;
  readonly arrowColor?: string;
  readonly labelColor: string;
  readonly labelFont: string;
  readonly labelMode?: 'adaptive' | 'all' | 'off';
  readonly labelPosition?: 'above' | 'below';
  readonly nodeScaleMode?: 'linear' | 'sqrt-orthographic';
  readonly labelScaleMode?: 'fixed' | 'sqrt-orthographic';
  /** New-mode perspective floor for the visible node disc, in CSS pixels. */
  readonly minimumPerspectiveNodeRadius?: number;
  /** Perspective-only finger hit radius; it does not enlarge the visible disc. */
  readonly minimumPerspectiveTouchHitRadius?: number;
  readonly edgeAggregation?: 'canonical' | 'unordered-pair';
  readonly showArrows?: boolean;
}

export interface GraphRenderFrameV1 {
  readonly regions: readonly GraphRenderRegionV1[];
  readonly nodes: readonly GraphRenderNodeV1[];
  readonly edges: readonly GraphRenderEdgeV1[];
  readonly theme: GraphRenderThemeV1;
}

export const DEFAULT_GRAPH_RENDER_THEME_V1: GraphRenderThemeV1 = {
  backgroundColor: 'transparent',
  nodeColor: '#7aa2f7',
  selectedNodeColor: '#bb9af7',
  focusedNodeColor: '#e0af68',
  tagNodeColor: '#a78bfa',
  highlightNodeColor: '#e0af68',
  nodeOutlineColor: '#cdd6f4',
  edgeColor: '#7f849c',
  arrowColor: '#7f849c',
  labelColor: '#cdd6f4',
  labelFont: '12px sans-serif',
  labelMode: 'adaptive',
  labelPosition: 'below',
  nodeScaleMode: 'linear',
  labelScaleMode: 'fixed',
  edgeAggregation: 'canonical',
  showArrows: true,
};
