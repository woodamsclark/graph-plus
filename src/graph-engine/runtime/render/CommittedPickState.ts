import type { GraphPickFrame } from './GraphRenderer.ts';

/** Retains committed eligibility and hit shapes, without drawing records or styling. */
export class CommittedPickState {
  private value: GraphPickFrame | null = null;
  get(): GraphPickFrame | null { return this.value; }
  set(frame: GraphPickFrame | null): void {
    this.value = frame && {
      geometryRevision: frame.geometryRevision,
      nodes: frame.nodes.map(({ id, position, radius, opacity, nodeScaleExponent }) => ({ id, position, radius, opacity, nodeScaleExponent })),
      policy: {
        nodeScaleMode: frame.policy?.nodeScaleMode,
        nodeScaleExponent: frame.policy?.nodeScaleExponent,
        minimumPerspectiveNodeRadius: frame.policy?.minimumPerspectiveNodeRadius,
        minimumPerspectiveNodeScale: frame.policy?.minimumPerspectiveNodeScale,
        minimumPerspectiveTouchHitRadius: frame.policy?.minimumPerspectiveTouchHitRadius,
      },
    };
  }
}
