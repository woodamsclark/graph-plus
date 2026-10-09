import type { GraphPickFrame } from '../render/GraphRenderer.ts';
import type { GraphModulePresentationStateV1 } from '../modules/GraphModuleTypes.ts';
import type { GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';
import type { GraphExperienceContractV1 } from '../../contracts/v1/index.ts';
import type { AnimusSnapshotV1 } from '../animus/index.ts';
import type { ConsciousnessSnapshot } from '../consciousness/index.ts';
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
import { createAnimaConsciousnessPresentationV1, type AnimaPresentationPhaseV1,
  type AnimaConsciousnessPresentationV1 } from './AnimaAwareness.ts';

import { animaPhaseOpacity, animaMemoryColor } from './AnimaPresentationValues.ts';

/**
 * Renderer-facing compilation consumes the shared resolved Anima presentation.
 *
 * Animus supplies facts. Module contributions are unresolved Anima inputs. This
 * compiler normalizes renderer-facing color, opacity, width, font, and state
 * priority so render backends never need to understand graph interaction state.
 */
export function compileAnimaSceneV1(options: {
  readonly animaPresentation?: AnimaConsciousnessPresentationV1;
  readonly snapshot: AnimusSnapshotV1;
  readonly consciousness: ConsciousnessSnapshot;
  readonly experience?: GraphExperienceContractV1;
  readonly objectActivationPreview?: GraphInteractionPreviewV1 | null;
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
  const presentation = options.animaPresentation ?? createAnimaConsciousnessPresentationV1({
    ...options.consciousness, experience: options.experience,
    objectActivationPreview: options.objectActivationPreview, interaction, document: options.snapshot.document,
    visibleNodeIds: options.snapshot.displaySelection.nodeIds,
    visibleEdgeIds: options.snapshot.displaySelection.edgeIds,
  });
  const destination = presentation.objectPreview?.kind === 'view-transition'
    ? presentation.objectPreview.resultingState : undefined;
  const sceneView = destination?.viewId ?? interaction.state;
  const sceneFocus = destination ? destination.focusedNodeId : interaction.focusedNodeId;
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
        const attended = presentation.expressedAttentionNodeIds.has(node.id);
        const focused = presentation.focusEmphasisNodeIds.has(node.id);
        const hovered = interaction.hoveredNodeId === node.id;
        const phase = presentation.highlight.phaseByNodeId[node.id] ?? 'void';
        const opacity = Math.min(finiteOpacity(contribution?.opacity, 1), animaPhaseOpacity(phase, 'node'));
        const label = presentation.labelRaising.byNodeId[node.id];
        const suppressed = policy.labelMode === 'off' || label?.disposition === 'suppress';
        const forced = !suppressed && label?.disposition === 'force';
        const stroked = focused || attended || contribution?.strokeWidth !== undefined;
        return {
          id: node.id,
          label: node.label ?? node.id,
          position: options.snapshot.positions[node.id] ?? { x: 0, y: 0, z: 0 },
          radius: finitePositive(contribution?.radius, 7 * finitePositive(contribution?.radiusScale, 1)),
          ...(contribution?.nodeScaleExponent === undefined
            ? {}
            : { nodeScaleExponent: contribution.nodeScaleExponent }),
          finalColor: constrainedColor(presentation.constellationKindByNodeId[node.id] === 'memory'
            ? animaMemoryColor(
                theme.colors.memoryConstellation,
                presentation.memoryStrengthByNodeId[node.id] ?? 1,
              ) : contribution?.finalColor ?? (focused
            ? theme.colors.focusedNode
            : phase === 'highlighted'
              ? theme.colors.selectedNode
              : contribution?.color ?? theme.colors.node), theme),
          opacity,
          ...(stroked ? {
            strokeColor: constrainedColor(contribution?.strokeColor ?? theme.colors.label, theme),
            strokeWidth: contribution?.strokeWidth ?? (focused ? 2 : 1),
          } : {}),
          labelColor: constrainedColor(contribution?.labelColor ?? theme.colors.label, theme),
          labelOpacity: suppressed ? 0 : forced ? finiteOpacity(contribution?.labelOpacity, 1)
            : Math.min(finiteOpacity(contribution?.labelOpacity, opacity), opacity),
          labelFontSize: finitePositive(contribution?.labelFontSize, theme.labelFont.sizePx)
            * (sceneView === 'focus' && node.id !== sceneFocus && !hovered ? 0.5 : 1),
          ...(contribution?.labelOffset === undefined ? {} : { labelOffset: { ...contribution.labelOffset } }),
          ...(suppressed ? { showLabel: false } : forced ? { showLabel: true }
            : contribution?.showLabel === undefined ? {} : { showLabel: contribution.showLabel }),
          ...(forced ? { labelForceVisible: true } : suppressed ? { labelForceVisible: false }
            : contribution?.labelForceVisible === undefined ? {} : { labelForceVisible: contribution.labelForceVisible }),
          ...(contribution?.labelPriority === undefined ? {} : { labelPriority: contribution.labelPriority }),
          ...(forced ? { labelAlwaysVisible: true } : suppressed ? { labelAlwaysVisible: false }
            : contribution?.labelAlwaysVisible === undefined ? {} : { labelAlwaysVisible: contribution.labelAlwaysVisible }),
          ...(contribution?.labelSaliencyBoost === undefined
            ? {}
            : { labelSaliencyBoost: contribution.labelSaliencyBoost }),
          labelStatePriority: label?.priority ?? contribution?.labelStatePriority
            ?? (focused ? 4 : attended ? 3 : hovered ? 2 : 0),
        };
      }),
    edges: compileEdges(options.snapshot, options.edgeContributions, theme, policy, presentation.highlight.phaseByEdgeId,
      presentation.constellationKindByEdgeId, presentation.memoryStrengthByNodeId),
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
  phases: Readonly<Record<string, AnimaPresentationPhaseV1>>,
  constellationKinds: AnimaConsciousnessPresentationV1['constellationKindByEdgeId'],
  memoryStrengths: AnimaConsciousnessPresentationV1['memoryStrengthByNodeId'],
): readonly GraphRenderEdgeV1[] {
  const canonical: GraphRenderEdgeV1[] = snapshot.document.edges
    .filter((edge) => snapshot.displaySelection.edgeIds.has(edge.id))
    .map((edge) => {
      const contribution = contributions?.[edge.id];
      const memoryStrength = Math.min(memoryStrengths[edge.sourceId] ?? 1, memoryStrengths[edge.targetId] ?? 1);
      const memoryColor = animaMemoryColor(theme.colors.memoryConstellation, memoryStrength);
      const explicitColor = constellationKinds[edge.id] === 'memory' ? memoryColor : contribution?.color;
      const color = constrainedColor(explicitColor ?? theme.colors.edge, theme);
      const opacity = Math.min(finiteOpacity(contribution?.opacity, 1), animaPhaseOpacity(phases[edge.id] ?? 'void', 'edge'));
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
        arrowColor: constrainedColor(constellationKinds[edge.id] === 'memory' ? memoryColor
          : contribution?.arrowColor ?? explicitColor ?? theme.colors.arrow, theme),
        arrowOpacity: Math.min(finiteOpacity(contribution?.arrowOpacity, opacity), opacity),
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

/** The committed fallback needs only eligibility, world positions and exact hit shapes. */
export function compileAnimaPickFrame(input: GraphModulePresentationStateV1, geometryRevision: number): GraphPickFrame {
  const phases = input.animaPresentation!.highlight.phaseByNodeId;
  return { geometryRevision, policy: input.presentationPolicy,
    nodes: input.document.nodes.filter(node => input.renderSelection.nodeIds.has(node.id)).map(node => {
      const contribution = input.nodeContributions[node.id];
      return { id: node.id, position: input.positions[node.id] ?? { x: 0, y: 0, z: 0 },
        radius: finitePositive(contribution?.radius, 7 * finitePositive(contribution?.radiusScale, 1)),
        nodeScaleExponent: contribution?.nodeScaleExponent,
        opacity: Math.min(finiteOpacity(contribution?.opacity, 1), animaPhaseOpacity(phases[node.id] ?? 'void', 'node')) };
    }) };
}
