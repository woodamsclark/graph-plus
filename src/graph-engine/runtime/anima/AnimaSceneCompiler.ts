import type { AnimusSnapshotV1 } from '../animus/index.ts';
import {
  DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  type GraphEdgeRenderContributionV1,
  type GraphNodeRenderContributionV1,
  type GraphPresentationPolicyV2,
  type GraphRegionRenderContributionV1,
  type GraphRenderEdgeV1,
  type GraphRenderFrameV1,
} from '../render/GraphRenderTypes.ts';
import {
  DEFAULT_GRAPH_VISUAL_THEME_V2,
  graphColorV2,
  type GraphColorV2,
  type GraphVisualThemeV2,
} from '../theme/index.ts';

/**
 * The sole semantic-to-visual compilation boundary.
 *
 * Animus supplies facts. Module contributions are unresolved Anima inputs. This
 * compiler resolves every renderer-facing color, opacity, width, font, and state
 * priority so render backends never need to understand graph interaction state.
 */
export function compileAnimaSceneV1(options: {
  readonly snapshot: AnimusSnapshotV1;
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionContributions?: readonly GraphRegionRenderContributionV1[];
  readonly theme?: GraphVisualThemeV2;
  readonly presentationPolicy?: GraphPresentationPolicyV2;
  readonly geometryRevision?: number;
}): GraphRenderFrameV1 {
  const theme = options.theme ?? DEFAULT_GRAPH_VISUAL_THEME_V2;
  const policy = options.presentationPolicy ?? DEFAULT_GRAPH_PRESENTATION_POLICY_V2;
  const interaction = options.snapshot.interaction;
  return {
    geometryRevision: options.geometryRevision,
    regions: (options.regionContributions ?? []).map((region) => ({
      id: region.id,
      regionNodeId: region.regionNodeId,
      memberNodeIds: region.memberNodeIds,
      directMemberNodeIds: region.directMemberNodeIds,
      connections: region.connections,
      padding: region.padding,
      fillColor: constrainedColor(region.fillColor ?? region.color, theme),
      fillOpacity: finiteOpacity(region.fillOpacity, 0.12),
      strokeColor: constrainedColor(region.strokeColor ?? region.color, theme),
      strokeOpacity: finiteOpacity(region.strokeOpacity, 0.52),
      strokeWidth: finitePositive(region.strokeWidth, 1.5),
    })),
    nodes: options.snapshot.document.nodes
      .filter((node) => options.snapshot.displaySelection.nodeIds.has(node.id))
      .map((node) => {
        const contribution = options.nodeContributions?.[node.id];
        const selected = interaction.selectedNodeIds.has(node.id);
        const focused = interaction.focusedNodeId === node.id;
        const hovered = interaction.hoveredNodeId === node.id;
        const opacity = finiteOpacity(contribution?.opacity, 1);
        const stroked = focused || selected || contribution?.strokeWidth !== undefined;
        return {
          id: node.id,
          label: node.label ?? node.id,
          position: options.snapshot.positions[node.id] ?? { x: 0, y: 0, z: 0 },
          radius: finitePositive(contribution?.radius, 7 * finitePositive(contribution?.radiusScale, 1)),
          ...(contribution?.nodeScaleExponent === undefined
            ? {}
            : { nodeScaleExponent: contribution.nodeScaleExponent }),
          finalColor: constrainedColor(contribution?.finalColor ?? (focused
            ? theme.colors.focusedNode
            : selected
              ? theme.colors.selectedNode
              : contribution?.color ?? theme.colors.node), theme),
          opacity,
          ...(stroked ? {
            strokeColor: constrainedColor(contribution?.strokeColor ?? theme.colors.label, theme),
            strokeWidth: contribution?.strokeWidth ?? (focused ? 2 : 1),
          } : {}),
          labelColor: constrainedColor(contribution?.labelColor ?? theme.colors.label, theme),
          labelOpacity: finiteOpacity(contribution?.labelOpacity, opacity),
          labelFontSize: finitePositive(contribution?.labelFontSize, theme.labelFont.sizePx),
          ...(contribution?.labelOffset === undefined ? {} : { labelOffset: { ...contribution.labelOffset } }),
          ...(contribution?.showLabel === undefined ? {} : { showLabel: contribution.showLabel }),
          ...(contribution?.labelForceVisible === undefined
            ? {}
            : { labelForceVisible: contribution.labelForceVisible }),
          ...(contribution?.labelPriority === undefined ? {} : { labelPriority: contribution.labelPriority }),
          ...(contribution?.labelAlwaysVisible === undefined
            ? {}
            : { labelAlwaysVisible: contribution.labelAlwaysVisible }),
          ...(contribution?.labelSaliencyBoost === undefined
            ? {}
            : { labelSaliencyBoost: contribution.labelSaliencyBoost }),
          labelStatePriority: contribution?.labelStatePriority
            ?? (focused ? 4 : selected ? 3 : hovered ? 2
              : contribution?.labelAlwaysVisible === true ? 1 : 0),
        };
      }),
    edges: compileEdges(options.snapshot, options.edgeContributions, theme, policy),
    backgroundColor: constrainedColor(theme.colors.background, theme),
    labelFont: theme.labelFont,
    policy,
  };
}

function compileEdges(
  snapshot: AnimusSnapshotV1,
  contributions: Readonly<Record<string, GraphEdgeRenderContributionV1>> | undefined,
  theme: GraphVisualThemeV2,
  policy: GraphPresentationPolicyV2,
): readonly GraphRenderEdgeV1[] {
  const canonical: GraphRenderEdgeV1[] = snapshot.document.edges
    .filter((edge) => snapshot.displaySelection.edgeIds.has(edge.id))
    .map((edge) => {
      const contribution = contributions?.[edge.id];
      const explicitColor = contribution?.color;
      const color = constrainedColor(explicitColor ?? theme.colors.edge, theme);
      const opacity = finiteOpacity(contribution?.opacity, 1);
      return {
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        directed: edge.directed ?? false,
        thickness: finitePositive(contribution?.thickness,
          Math.max(0.5, Math.min(6, Math.abs(edge.weight ?? 1) * finitePositive(contribution?.thicknessScale, 1)))),
        color,
        opacity,
        ...(contribution?.dashed === undefined ? {} : { dashed: contribution.dashed }),
        arrowAtSource: policy.showArrows === false ? false : contribution?.arrowAtSource ?? false,
        arrowAtTarget: policy.showArrows === false
          ? false
          : contribution?.arrowAtTarget ?? (edge.directed ?? false),
        arrowColor: constrainedColor(contribution?.arrowColor ?? explicitColor ?? theme.colors.arrow, theme),
        arrowOpacity: finiteOpacity(contribution?.arrowOpacity, opacity),
      };
    });
  if (policy.edgeAggregation !== 'unordered-pair') return canonical;
  const groups = new Map<string, GraphRenderEdgeV1[]>();
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
    const strongest = [...values].sort((a, b) => b.thickness - a.thickness || a.id.localeCompare(b.id))[0];
    return {
      ...strongest,
      id: `pair:${key}`,
      sourceId,
      targetId,
      directed: false,
      dashed: values.some((edge) => edge.dashed),
      arrowAtTarget: values.some((edge) =>
        (edge.targetId === targetId && edge.arrowAtTarget) || (edge.sourceId === targetId && edge.arrowAtSource)),
      arrowAtSource: values.some((edge) =>
        (edge.sourceId === sourceId && edge.arrowAtSource) || (edge.targetId === sourceId && edge.arrowAtTarget)),
    };
  });
}

function constrainedColor(color: GraphColorV2, theme: GraphVisualThemeV2): GraphColorV2 {
  if (theme.colorConstraint !== 'red-green') return color;
  return color.g > color.r
    ? graphColorV2(0, 1, 0, color.a)
    : graphColorV2(1, 0, 0, color.a);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOpacity(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
