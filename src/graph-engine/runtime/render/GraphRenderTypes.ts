import type { Vec3 } from '../../contracts/v1/index.ts';

export interface GraphRenderNodeV1 {
  readonly id: string;
  readonly label: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly color?: string;
  readonly showLabel?: boolean;
}

export interface GraphRenderEdgeV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly directed: boolean;
  readonly thickness: number;
  readonly color?: string;
  readonly dashed?: boolean;
}

export interface GraphNodeRenderContributionV1 {
  readonly color?: string;
  readonly radiusScale?: number;
  readonly showLabel?: boolean;
}

export interface GraphEdgeRenderContributionV1 {
  readonly color?: string;
  readonly thicknessScale?: number;
  readonly dashed?: boolean;
}

export interface GraphRenderThemeV1 {
  readonly backgroundColor: string;
  readonly nodeColor: string;
  readonly selectedNodeColor: string;
  readonly focusedNodeColor: string;
  readonly edgeColor: string;
  readonly labelColor: string;
  readonly labelFont: string;
}

export interface GraphRenderFrameV1 {
  readonly nodes: readonly GraphRenderNodeV1[];
  readonly edges: readonly GraphRenderEdgeV1[];
  readonly theme: GraphRenderThemeV1;
}

export const DEFAULT_GRAPH_RENDER_THEME_V1: GraphRenderThemeV1 = {
  backgroundColor: 'transparent',
  nodeColor: '#7aa2f7',
  selectedNodeColor: '#bb9af7',
  focusedNodeColor: '#e0af68',
  edgeColor: '#7f849c',
  labelColor: '#cdd6f4',
  labelFont: '12px sans-serif',
};
