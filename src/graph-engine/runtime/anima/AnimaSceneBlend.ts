import type { GraphRenderFrameV1 } from '../render/index.ts';
import type { GraphColorV2 } from '../theme/index.ts';

/** Blend resolved scene expression, never graph state, geometry, or camera. */
export function blendAnimaScenesV1(
  baseline: GraphRenderFrameV1,
  preview: GraphRenderFrameV1,
  strength: number,
): GraphRenderFrameV1 {
  const amount = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  if (amount === 0) return baseline;
  if (amount === 1) return preview;
  const mix = (from: number, to: number) => from + (to - from) * amount;
  const color = (from: GraphColorV2, to: GraphColorV2): GraphColorV2 => ({
    r: mix(from.r, to.r), g: mix(from.g, to.g), b: mix(from.b, to.b), a: mix(from.a, to.a),
  });
  const baselineNodes = new Map(baseline.nodes.map(node => [node.id, node]));
  const baselineEdges = new Map(baseline.edges.map(edge => [edge.id, edge]));
  return {
    ...baseline,
    nodes: preview.nodes.map(node => {
      const base = baselineNodes.get(node.id);
      if (!base) return node;
      // Newly forced destination labels fade in from zero; existing forced labels
      // retain their baseline. Proximity reveal remains an independent renderer input.
      const baseLabelOpacity = base.showLabel === false
        || (node.labelForceVisible && !base.labelForceVisible) ? 0 : base.labelOpacity;
      return {
        ...base,
        finalColor: color(base.finalColor, node.finalColor),
        opacity: mix(base.opacity, node.opacity),
        strokeWidth: mix(base.strokeWidth ?? 0, node.strokeWidth ?? 0),
        strokeColor: color(base.strokeColor ?? base.labelColor, node.strokeColor ?? node.labelColor),
        labelColor: color(base.labelColor, node.labelColor),
        labelOpacity: mix(baseLabelOpacity, node.showLabel === false ? 0 : node.labelOpacity),
        showLabel: base.showLabel !== false || node.showLabel !== false,
        labelForceVisible: base.labelForceVisible === true || node.labelForceVisible === true,
        labelAlwaysVisible: base.labelAlwaysVisible === true || node.labelAlwaysVisible === true,
        labelStatePriority: mix(base.labelStatePriority, node.labelStatePriority),
        labelSaliencyBoost: mix(base.labelSaliencyBoost ?? 0, node.labelSaliencyBoost ?? 0),
      };
    }),
    edges: preview.edges.map(edge => {
      const base = baselineEdges.get(edge.id);
      return base ? { ...base,
        opacity: mix(base.opacity, edge.opacity), color: color(base.color, edge.color),
        arrowOpacity: mix(base.arrowOpacity ?? base.opacity, edge.arrowOpacity ?? edge.opacity),
        arrowColor: color(base.arrowColor, edge.arrowColor),
      } : edge;
    }),
  };
}
