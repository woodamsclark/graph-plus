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
  readonly regionContributions?: GraphRenderFrameV1['regions'];
  readonly theme?: GraphRenderThemeV1;
  readonly hoveredNodeId?: string;
  readonly geometryRevision?: number;
}): GraphRenderFrameV1 {
  const selected = new Set(options.viewState.selectedNodeIds);
  return {
    geometryRevision: options.geometryRevision,
    regions: options.regionContributions ?? [],
    nodes: options.document.nodes
      .filter((node) => options.selection.nodeIds.has(node.id))
      .map((node) => {
        const contribution = options.nodeContributions?.[node.id];
        return {
          id: node.id,
          label: node.label ?? node.id,
          position: options.positions?.[node.id] ?? options.viewState.positions[node.id] ?? { x: 0, y: 0, z: 0 },
          radius: finitePositive(contribution?.radius, 7 * finitePositive(contribution?.radiusScale, 1)),
          selected: selected.has(node.id),
          focused: options.viewState.focusedNodeId === node.id,
          hovered: options.hoveredNodeId === node.id,
          ...(contribution?.finalColor === undefined ? {} : { finalColor: contribution.finalColor }),
          ...(contribution?.color === undefined ? {} : { color: contribution.color }),
          ...(contribution?.opacity === undefined ? {} : { opacity: contribution.opacity }),
          ...(contribution?.strokeColor === undefined ? {} : { strokeColor: contribution.strokeColor }),
          ...(contribution?.strokeWidth === undefined ? {} : { strokeWidth: contribution.strokeWidth }),
          ...(contribution?.labelColor === undefined ? {} : { labelColor: contribution.labelColor }),
          ...(contribution?.labelOpacity === undefined ? {} : { labelOpacity: contribution.labelOpacity }),
          ...(contribution?.labelFontSize === undefined ? {} : { labelFontSize: contribution.labelFontSize }),
          ...(contribution?.labelOffset === undefined ? {} : { labelOffset: { ...contribution.labelOffset } }),
          ...(contribution?.showLabel === undefined ? {} : { showLabel: contribution.showLabel }),
          ...(contribution?.labelPriority === undefined ? {} : { labelPriority: contribution.labelPriority }),
          ...(contribution?.labelAlwaysVisible === undefined ? {} : { labelAlwaysVisible: contribution.labelAlwaysVisible }),
        };
      }),
    edges: composeEdges(options),
    theme: options.theme ?? DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}

function composeEdges(options: Parameters<typeof composeGraphRenderFrameV1>[0]): GraphRenderFrameV1['edges'] {
  const theme = options.theme ?? DEFAULT_GRAPH_RENDER_THEME_V1;
  const edges = options.document.edges.filter((edge) => options.selection.edgeIds.has(edge.id));
  const canonical = edges.map((edge) => {
        const contribution = options.edgeContributions?.[edge.id];
        return {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          directed: edge.directed ?? false,
          thickness: finitePositive(contribution?.thickness,
            Math.max(0.5, Math.min(6, Math.abs(edge.weight ?? 1) * finitePositive(contribution?.thicknessScale, 1)))),
          ...(contribution?.color === undefined ? {} : { color: contribution.color }),
          ...(contribution?.opacity === undefined ? {} : { opacity: contribution.opacity }),
          ...(contribution?.dashed === undefined ? {} : { dashed: contribution.dashed }),
          arrowAtSource: theme.showArrows === false ? false : contribution?.arrowAtSource ?? false,
          arrowAtTarget: theme.showArrows === false
            ? false
            : contribution?.arrowAtTarget ?? (edge.directed ?? false),
          ...(contribution?.arrowColor === undefined ? {} : { arrowColor: contribution.arrowColor }),
          ...(contribution?.arrowOpacity === undefined ? {} : { arrowOpacity: contribution.arrowOpacity }),
        };
      });
  if (theme.edgeAggregation !== 'unordered-pair') return canonical;
  const groups = new Map<string, typeof canonical>();
  for (const edge of canonical) {
    const key = edge.sourceId < edge.targetId
      ? `${edge.sourceId}\u0000${edge.targetId}`
      : `${edge.targetId}\u0000${edge.sourceId}`;
    const values = groups.get(key);
    if (values) values.push(edge);
    else groups.set(key, [edge]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [sourceId, targetId] = key.split('\u0000');
    const arrowAtTarget = values.some((edge) =>
      (edge.targetId === targetId && edge.arrowAtTarget) || (edge.sourceId === targetId && edge.arrowAtSource));
    const arrowAtSource = values.some((edge) =>
      (edge.sourceId === sourceId && edge.arrowAtSource) || (edge.targetId === sourceId && edge.arrowAtTarget));
    const strongest = [...values].sort((a, b) => b.thickness - a.thickness || a.id.localeCompare(b.id))[0];
    return {
      id: `pair:${key}`,
      sourceId,
      targetId,
      directed: false,
      thickness: strongest.thickness,
      ...(strongest.color === undefined ? {} : { color: strongest.color }),
      ...(strongest.opacity === undefined ? {} : { opacity: strongest.opacity }),
      ...(values.some((edge) => edge.dashed) ? { dashed: true } : {}),
      arrowAtSource,
      arrowAtTarget,
      ...(strongest.arrowColor === undefined ? {} : { arrowColor: strongest.arrowColor }),
      ...(strongest.arrowOpacity === undefined ? {} : { arrowOpacity: strongest.arrowOpacity }),
    };
  });
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
