import type { Vec3 } from './values.ts';

/** Capability for node-owned attachment springs in the shipped 2D force layout. */
export const GRAPH_ATTACHMENT_ASSIGNMENT_POLICY_CAPABILITY_V1 = 'attachment-assignment-policy';
export const GRAPH_UPDATE_API_CAPABILITY_V1 = 'graph-update-api';

export const GRAPH_NODE_ATTACHMENT_CAPABILITY_V1 = 'node-attachment-2d';

export const GRAPH_NODE_ATTACHMENT_SLOTS_CAPABILITY_V1 = 'node-attachment-slots-2d';
export const GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_CAPABILITY_V1 = 'edge-attachment-assignments-2d';
export const GRAPH_NODE_ATTACHMENT_SLOTS_3D_CAPABILITY_V1 = 'node-attachment-slots-3d';
export const GRAPH_EDGE_ATTACHMENT_ASSIGNMENTS_3D_CAPABILITY_V1 = 'edge-attachment-assignments-3d';

/** Endpoint-specific slot requests on a graph edge. Slot indices start at zero. */
export type GraphEdgeAttachmentV1 = {
  /** Slot on sourceId's pattern; omitted is automatic, null explicitly leaves it unbound. */
  readonly sourceSlot?: number | null;
  /** Slot on targetId's pattern, independently from the source endpoint. */
  readonly targetSlot?: number | null;
};

export function isGraphEdgeAttachmentV1(value: unknown): value is GraphEdgeAttachmentV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const attachment = value as Record<string, unknown>;
  return Object.keys(attachment).every(key => (key === 'sourceSlot' || key === 'targetSlot')
    && (attachment[key] === undefined || attachment[key] === null
      || typeof attachment[key] === 'number' && Number.isSafeInteger(attachment[key]) && attachment[key] >= 0));
}

/** Finite spring strengths, not hard position locks. */
export const GRAPH_ANGULAR_SPRING_PRESETS_V1 = Object.freeze({
  off: 0,
  soft: 0.08,
  firm: 0.3,
  stiff: 0.8,
});

/** Unit quaternion in graph/world coordinates, shared by 2D and 3D patterns. */
export type GraphAttachmentRotationV1 = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };

export type GraphAttachmentOrientationV1 =
  | { readonly mode: 'free' }
  | { readonly mode: 'spring'; readonly rotation: GraphAttachmentRotationV1; readonly stiffness?: number }
  | { readonly mode: 'locked'; readonly rotation: GraphAttachmentRotationV1 };

/** Counterclockwise degrees from world +X; camera rotation does not change this orientation. */
export function graphAttachmentRotation2DV1(degrees: number): GraphAttachmentRotationV1 {
  if (!Number.isFinite(degrees)) throw new Error('Attachment rotation must be finite.');
  const halfAngle = (degrees % 360) * Math.PI / 360;
  return { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) };
}

export type GraphAttachmentBindingV1 = {
  readonly neighborId: string;
  readonly slot: number;
  /** Parallel links share one physical binding between their endpoint nodes. */
  readonly edgeIds?: readonly string[];
};
export type GraphAttachmentAssignmentV1 = { readonly neighborId: string; readonly edgeId: string; readonly slot: number | null };
export type GraphEdgeAttachmentStatusV1 = {
  readonly edgeId: string;
  readonly endpoint: 'source' | 'target';
  readonly ownerId: string;
  readonly neighborId: string;
  readonly requestedSlot: number | null;
  readonly status: 'bound' | 'unbound' | 'occupied' | 'out-of-range' | 'inactive' | 'free' | 'conflicting';
};
/** Occupants and pattern pose are saved in force-layout module state, separately from node declarations. */
export type GraphAttachmentSlotsStateV1 = {
  readonly version: 1;
  /** Omitted on legacy 2D snapshots. Spatial slot indices use a different pattern. */
  readonly dimensions?: '2d' | '3d';
  readonly requests?: readonly GraphEdgeAttachmentStatusV1[];
  readonly owners: Readonly<Record<string, {
    readonly count: number;
    readonly phaseRadians: number;
    /** Full runtime pattern pose for 3D snapshots. */
    readonly rotation?: GraphAttachmentRotationV1;
    readonly bindings: readonly GraphAttachmentBindingV1[];
    readonly assignments?: readonly GraphAttachmentAssignmentV1[];
  }>>;
};

/**
 * Intrinsic attachment preference carried by a graph node.
 * Count is dimension-independent: 2D uses a circle; 3D uses indexed spherical directions.
 * Disabled by default; enabled nodes default to loose assignment. Count 1 has no indexed pattern.
 */
export type GraphNodeAttachmentV1 = {
  /** Attachment mechanics are disabled unless explicitly enabled. */
  readonly enabled?: boolean;
  /** Loose permits connections without a point; strict rejects graph edits that cannot assign every endpoint. */
  readonly assignment?: 'loose' | 'strict';
  /** Positive whole-number direction count. Defaults to 1 (unrestricted). */
  readonly count?: number;
  /** Spring bindings can release; locked bindings retain their slot until explicitly unlocked/reconfigured. */
  readonly rigidity?: 'spring' | 'locked';
  readonly orientation?: GraphAttachmentOrientationV1;
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
  if (Object.keys(attachment).some(key => !['enabled', 'assignment', 'count', 'openingDegrees', 'stiffness', 'rigidity', 'orientation'].includes(key))) return false;
  if (attachment.enabled !== undefined && typeof attachment.enabled !== 'boolean') return false;
  if (attachment.assignment !== undefined && attachment.assignment !== 'loose' && attachment.assignment !== 'strict') return false;
  const count = attachment.count === undefined ? 1 : attachment.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) return false;
  if (attachment.rigidity !== undefined && attachment.rigidity !== 'spring' && attachment.rigidity !== 'locked') return false;
  if (attachment.orientation !== undefined && !validOrientation(attachment.orientation)) return false;
  const width = attachment.openingDegrees;
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width)
    || width < 0 || width > 360 / count)) return false;
  const stiffness = attachment.stiffness;
  return stiffness === undefined || (typeof stiffness === 'number'
    ? Number.isFinite(stiffness) && stiffness >= 0 && stiffness <= 1
    : typeof stiffness === 'string' && Object.prototype.hasOwnProperty.call(GRAPH_ANGULAR_SPRING_PRESETS_V1, stiffness));
}

function validOrientation(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const orientation = value as Record<string, unknown>;
  if (orientation.mode === 'free') return Object.keys(orientation).every(key => key === 'mode');
  if (orientation.mode !== 'spring' && orientation.mode !== 'locked') return false;
  if (Object.keys(orientation).some(key => !['mode', 'rotation', ...(orientation.mode === 'spring' ? ['stiffness'] : [])].includes(key))) return false;
  const rotation = orientation.rotation;
  if (rotation === null || typeof rotation !== 'object' || Array.isArray(rotation)) return false;
  const q = rotation as Record<string, unknown>;
  if (Object.keys(q).length !== 4 || !['x', 'y', 'z', 'w'].every(key => typeof q[key] === 'number' && Number.isFinite(q[key]))) return false;
  if (Math.abs(Math.hypot(q.x as number, q.y as number, q.z as number, q.w as number) - 1) > 1e-6) return false;
  const stiffness = orientation.stiffness;
  return stiffness === undefined || (typeof stiffness === 'number' && Number.isFinite(stiffness) && stiffness >= 0 && stiffness <= 1);
}

/** Stable indexed patterns. Changing count intentionally reconfigures the pattern. */
export function graphAttachmentSlotDirection3DV1(count: number, slot: number): Vec3 {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(slot) || slot < 0 || slot >= count) throw new Error('Attachment slot requires a positive count and an index within its pattern.');
  if (count === 1) return { x: 1, y: 0, z: 0 };
  if (count === 2) return { x: slot === 0 ? 1 : -1, y: 0, z: 0 };
  if (count === 3) return { x: Math.cos(slot * Math.PI * 2 / 3), y: Math.sin(slot * Math.PI * 2 / 3), z: 0 };
  if (count === 4) return unitDirection([
    { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: -1 }, { x: -1, y: 1, z: -1 }, { x: -1, y: -1, z: 1 },
  ][slot]);
  if (count === 6) return [
    { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 },
  ][slot];
  if (count === 8) return unitDirection({ x: slot & 4 ? -1 : 1, y: slot & 2 ? -1 : 1, z: slot & 1 ? -1 : 1 });
  if (count === 12) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const a = slot & 1 ? -1 : 1, b = slot & 2 ? -phi : phi;
    return unitDirection(slot < 4 ? { x: 0, y: a, z: b } : slot < 8 ? { x: a, y: b, z: 0 } : { x: b, y: 0, z: a });
  }
  const z = 1 - 2 * (slot + 0.5) / count;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  const angle = slot * Math.PI * (3 - Math.sqrt(5));
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z };
}


function unitDirection(value: Vec3): Vec3 { const r = Math.hypot(value.x, value.y, value.z); return { x: value.x / r, y: value.y / r, z: value.z / r }; }

/** Structured failure for an enabled strict owner's unsatisfied endpoint. */
export interface GraphAttachmentAssignmentFailureV1 {
  readonly edgeId: string;
  readonly endpoint: 'source' | 'target';
  readonly ownerId: string;
  readonly neighborId: string;
  readonly requestedSlot?: number | null;
  readonly reason: 'occupied' | 'out-of-range' | 'inactive' | 'free' | 'conflicting' | 'unbound' | 'layout-unavailable';
  readonly message: string;
}

/** Legacy replacement/session creation throw this typed error for strict admission failures. */
export class GraphAttachmentAssignmentErrorV1 extends Error {
  readonly code = 'attachment-assignment' as const;
  constructor(readonly failures: readonly GraphAttachmentAssignmentFailureV1[]) {
    super(failures.map(failure => failure.message).join('; '));
    this.name = 'GraphAttachmentAssignmentErrorV1';
  }
}
