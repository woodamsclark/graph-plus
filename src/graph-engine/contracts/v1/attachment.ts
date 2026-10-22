/** Capability for node-owned attachment springs in the shipped 2D force layout. */
export const GRAPH_NODE_ATTACHMENT_CAPABILITY_V1 = 'node-attachment-2d';

/** Finite spring strengths, not hard position locks. */
export const GRAPH_ANGULAR_SPRING_PRESETS_V1 = Object.freeze({
  off: 0,
  soft: 0.08,
  firm: 0.3,
  stiff: 0.8,
});

/**
 * Intrinsic attachment preference carried by a graph node.
 * Count is dimension-independent: 2D uses a circle; future 3D support can use a sphere.
 * Missing attachment or count 1 means freely attaching. No global default is applied.
 */
export type GraphNodeAttachmentV1 = {
  /** Positive whole-number direction count. Defaults to 1 (unrestricted). */
  readonly count?: number;
  /** Full width of the preferred angular zone. Defaults to zero degrees. */
  readonly openingDegrees?: number;
  /** Zero through one, or a preset. Defaults to soft when count exceeds 1. */
  readonly stiffness?: number | keyof typeof GRAPH_ANGULAR_SPRING_PRESETS_V1;
};

/** Shared by document validation and transient per-node animation targets. */
export function isGraphNodeAttachmentV1(value: unknown): value is GraphNodeAttachmentV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const attachment = value as Record<string, unknown>;
  if (Object.keys(attachment).some(key => !['count', 'openingDegrees', 'stiffness'].includes(key))) return false;
  const count = attachment.count === undefined ? 1 : attachment.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) return false;
  const width = attachment.openingDegrees;
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width)
    || width < 0 || width > 360 / count)) return false;
  const stiffness = attachment.stiffness;
  return stiffness === undefined || (typeof stiffness === 'number'
    ? Number.isFinite(stiffness) && stiffness >= 0 && stiffness <= 1
    : typeof stiffness === 'string' && Object.prototype.hasOwnProperty.call(GRAPH_ANGULAR_SPRING_PRESETS_V1, stiffness));
}
