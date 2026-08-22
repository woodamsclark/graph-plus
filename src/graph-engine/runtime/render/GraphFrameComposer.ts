import type { GraphDocumentV1, GraphViewStateV1 } from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import {
  DEFAULT_GRAPH_RENDER_THEME_V1,
  type GraphRenderFrameV1,
  type GraphRenderThemeV1,
} from './GraphRenderTypes.ts';

export function composeGraphRenderFrameV1(options: {
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly selection: GraphFilterSelectionV1;
  readonly theme?: GraphRenderThemeV1;
}): GraphRenderFrameV1 {
  const selected = new Set(options.viewState.selectedNodeIds);
  return {
    nodes: options.document.nodes
      .filter((node) => options.selection.nodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        label: node.label ?? node.id,
        position: options.viewState.positions[node.id] ?? { x: 0, y: 0, z: 0 },
        radius: 7,
        selected: selected.has(node.id),
        focused: options.viewState.focusedNodeId === node.id,
      })),
    edges: options.document.edges
      .filter((edge) => options.selection.edgeIds.has(edge.id))
      .map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        directed: edge.directed ?? false,
        thickness: Math.max(0.5, Math.min(6, Math.abs(edge.weight ?? 1))),
      })),
    theme: options.theme ?? DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}
