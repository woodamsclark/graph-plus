import type { GraphDocumentV1, GraphViewStateV1, Vec3 } from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import {
  DEFAULT_GRAPH_RENDER_THEME_V1,
  type GraphRenderFrameV1,
  type GraphEdgeRenderContributionV1,
  type GraphNodeRenderContributionV1,
  type GraphRenderThemeV1,
} from './GraphRenderTypes.ts';

export function composeGraphRenderFrameV1(options: {
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly selection: GraphFilterSelectionV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly theme?: GraphRenderThemeV1;
}): GraphRenderFrameV1 {
  const selected = new Set(options.viewState.selectedNodeIds);
  return {
    nodes: options.document.nodes
      .filter((node) => options.selection.nodeIds.has(node.id))
      .map((node) => {
        const contribution = options.nodeContributions?.[node.id];
        return {
          id: node.id,
          label: node.label ?? node.id,
          position: options.positions?.[node.id] ?? options.viewState.positions[node.id] ?? { x: 0, y: 0, z: 0 },
          radius: 7 * finitePositive(contribution?.radiusScale, 1),
          selected: selected.has(node.id),
          focused: options.viewState.focusedNodeId === node.id,
          ...(contribution?.color === undefined ? {} : { color: contribution.color }),
        };
      }),
    edges: options.document.edges
      .filter((edge) => options.selection.edgeIds.has(edge.id))
      .map((edge) => {
        const contribution = options.edgeContributions?.[edge.id];
        return {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          directed: edge.directed ?? false,
          thickness: Math.max(0.5, Math.min(6, Math.abs(edge.weight ?? 1) * finitePositive(contribution?.thicknessScale, 1))),
          ...(contribution?.color === undefined ? {} : { color: contribution.color }),
          ...(contribution?.dashed === undefined ? {} : { dashed: contribution.dashed }),
        };
      }),
    theme: options.theme ?? DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
