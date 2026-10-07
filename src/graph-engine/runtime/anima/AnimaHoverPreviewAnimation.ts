import type { GraphInteractionPreviewV1 } from './AnimaInteractionPreview.ts';
import type { GraphRenderFrameV1 } from '../render/GraphRenderTypes.ts';
import type { GraphColorV2 } from '../theme/index.ts';

const DELAY_MS = 200;
const FADE_MS = 500;

interface PreviewVisit {
  readonly key: string;
  readonly preview: GraphInteractionPreviewV1;
  readonly hoveredNodeId: string;
  readonly enteredAt: number;
}

export interface AnimaPreviewLayerV1 {
  readonly key: string;
  readonly preview: GraphInteractionPreviewV1;
  readonly hoveredNodeId: string;
  readonly strength: number;
}

/** Anima owns transient hover timing. The session supplies its clock and wakeups. */
export class AnimaHoverPreviewAnimationV1 {
  private context?: string;
  private sampledAt = 0;
  private visit?: PreviewVisit;
  private leaving?: { readonly visit: PreviewVisit; readonly strength: number; readonly leftAt: number };

  update(input: {
    readonly context: string;
    readonly preview: GraphInteractionPreviewV1 | null | undefined;
    readonly hoveredNodeId?: string;
    readonly committed: boolean;
    readonly now: number;
  }): readonly AnimaPreviewLayerV1[] {
    if (this.context !== input.context || input.committed) this.clear();
    this.context = input.context;
    this.sampledAt = input.now;
    const key = input.preview && input.hoveredNodeId
      ? JSON.stringify([input.hoveredNodeId, input.preview]) : undefined;
    if (key !== this.visit?.key) {
      if (this.visit) {
        const strength = this.enterStrength(this.visit, input.now);
        if (strength > 0) this.leaving = { visit: this.visit, strength, leftAt: input.now };
      }
      this.visit = key && input.preview && input.hoveredNodeId ? {
        key, preview: input.preview, hoveredNodeId: input.hoveredNodeId,
        enteredAt: input.committed ? input.now - DELAY_MS - FADE_MS : input.now,
      } : undefined;
    }
    const layers: AnimaPreviewLayerV1[] = [];
    if (this.leaving) {
      const strength = this.leaving.strength * Math.max(0, 1 - (input.now - this.leaving.leftAt) / FADE_MS);
      if (strength > 0) layers.push({ ...this.leaving.visit, strength });
      else this.leaving = undefined;
    }
    if (this.visit) {
      const strength = this.enterStrength(this.visit, input.now);
      if (strength > 0) layers.push({ ...this.visit, strength });
    }
    return layers;
  }

  nextFrameDelayMs(now: number): number | undefined {
    if (this.leaving) return 0;
    // Keep requesting work until the terminal visual has actually been sampled.
    if (!this.visit || this.enterStrength(this.visit, this.sampledAt) >= 1) return undefined;
    return Math.max(0, this.visit.enteredAt + DELAY_MS - now);
  }

  clear(): void {
    this.visit = undefined;
    this.leaving = undefined;
    this.context = undefined;
  }

  private enterStrength(visit: PreviewVisit, now: number): number {
    return Math.max(0, Math.min(1, (now - visit.enteredAt - DELAY_MS) / FADE_MS));
  }
}

/** Blend resolved visuals, never graph membership, camera, geometry or View state. */
export function blendAnimaPreviewFrameV1(
  baseline: GraphRenderFrameV1, preview: GraphRenderFrameV1, strength: number,
): GraphRenderFrameV1 {
  const t = Math.max(0, Math.min(1, strength));
  if (t <= 0) return baseline;
  const nodes = new Map(preview.nodes.map(node => [node.id, node]));
  const edges = new Map(preview.edges.map(edge => [edge.id, edge]));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const color = (a: GraphColorV2, b: GraphColorV2): GraphColorV2 => ({
    r: lerp(a.r, b.r), g: lerp(a.g, b.g), b: lerp(a.b, b.b), a: lerp(a.a, b.a),
  });
  return {
    ...baseline,
    nodes: baseline.nodes.map(node => {
      const target = nodes.get(node.id);
      if (!target) return node;
      const strokeWidth = lerp(node.strokeWidth ?? 0, target.strokeWidth ?? 0);
      return {
        ...node,
        finalColor: color(node.finalColor, target.finalColor),
        opacity: lerp(node.opacity, target.opacity),
        strokeColor: strokeWidth > 0
          ? color(node.strokeColor ?? node.finalColor, target.strokeColor ?? target.finalColor) : undefined,
        strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
        labelColor: color(node.labelColor, target.labelColor),
        labelOpacity: lerp(node.labelOpacity, target.labelOpacity),
        labelFontSize: lerp(node.labelFontSize, target.labelFontSize),
        showLabel: node.showLabel !== false || target.showLabel !== false,
        labelForceVisible: node.labelForceVisible === true || target.labelForceVisible === true,
        labelAlwaysVisible: node.labelAlwaysVisible === true || target.labelAlwaysVisible === true,
        labelStatePriority: lerp(node.labelStatePriority ?? 0, target.labelStatePriority ?? 0),
        labelSaliencyBoost: lerp(node.labelSaliencyBoost ?? 0, target.labelSaliencyBoost ?? 0),
      };
    }),
    edges: baseline.edges.map(edge => {
      const target = edges.get(edge.id);
      return target ? { ...edge, color: color(edge.color, target.color),
        opacity: lerp(edge.opacity, target.opacity), arrowColor: color(edge.arrowColor, target.arrowColor),
        arrowOpacity: lerp(edge.arrowOpacity, target.arrowOpacity) } : edge;
    }),
  };
}
