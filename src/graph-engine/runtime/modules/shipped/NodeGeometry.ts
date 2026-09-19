import type { GraphNodeRenderContributionV1 } from '../../render/index.ts';

/** Resolve Anima's structural world-space radius from visible topology and prior form/render scales. */
export function resolveAnimaNodeRadiusV1(
  visibleDegree: number,
  contribution: GraphNodeRenderContributionV1 | undefined,
): number {
  return positive(contribution?.baseRadiusScale, 1)
    * clamp(3 * Math.sqrt(Math.max(0, visibleDegree) + 1), 8, 30)
    * positive(contribution?.radiusScale, 1);
}

/** Match GraphFrameComposer's final world-space radius fallback exactly. */
export function resolveRenderedNodeRadiusV1(
  contribution: GraphNodeRenderContributionV1 | undefined,
): number {
  return positive(contribution?.radius, 7 * positive(contribution?.radiusScale, 1));
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
