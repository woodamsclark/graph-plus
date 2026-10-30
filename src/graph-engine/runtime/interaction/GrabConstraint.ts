import type { GraphDimensionsV1, Vec3 } from '../../contracts/v1/index.ts';

/** Experimental runtime policy. Never persisted in profiles or view snapshots. */
export type GrabPolicy =
  | { readonly mode: 'exact' | 'off' }
  | { readonly mode: 'elastic'; readonly stiffness: number; readonly damping: number; readonly maxForce: number | null };

export type GrabConstraint = GrabPolicy & { readonly nodeId: string; readonly target: Vec3 };

export const EXPERIMENTAL_ELASTIC_GRAB: GrabPolicy = Object.freeze({
  mode: 'elastic', stiffness: 0.15, damping: 0.6, maxForce: 12,
});

export function validateGrabPolicy(policy: GrabPolicy): void {
  if (policy.mode === 'exact' || policy.mode === 'off') return;
  if (policy.mode !== 'elastic' || ![policy.stiffness, policy.damping].every(nonNegative)
    || (policy.maxForce !== null && !nonNegative(policy.maxForce))) {
    throw new Error('Grab coefficients must be finite and nonnegative; maxForce may be null.');
  }
}

/** Clamp the combined spring/damper force, using the physical pre-step velocity. */
export function elasticGrabForce(grab: GrabConstraint, position: Vec3, velocity: Vec3, dimensions: GraphDimensionsV1): Vec3 {
  if (grab.mode !== 'elastic') return { x: 0, y: 0, z: 0 };
  validateGrabPolicy(grab);
  const force = {
    x: grab.stiffness * (grab.target.x - position.x) - grab.damping * velocity.x,
    y: grab.stiffness * (grab.target.y - position.y) - grab.damping * velocity.y,
    z: dimensions === '2d' ? 0 : grab.stiffness * (grab.target.z - position.z) - grab.damping * velocity.z,
  };
  // Reject overflow rather than feeding nonfinite values into the shared solver.
  if (![force.x, force.y, force.z].every(Number.isFinite)) return { x: 0, y: 0, z: 0 };
  const magnitude = Math.hypot(force.x, force.y, force.z);
  const scale = grab.maxForce !== null && magnitude > grab.maxForce ? grab.maxForce / magnitude : 1;
  return { x: force.x * scale, y: force.y * scale, z: force.z * scale };
}

/** World-space lifecycle usable by any input adapter; end never edits position or velocity. */
export class GrabController {
  private constraint: GrabConstraint | undefined;
  private offset: Vec3 = { x: 0, y: 0, z: 0 };

  begin(nodeId: string, position: Vec3, contact: Vec3, policy: GrabPolicy): void {
    validateGrabPolicy(policy);
    this.offset = { x: position.x - contact.x, y: position.y - contact.y, z: position.z - contact.z };
    this.constraint = { ...policy, nodeId, target: { ...position } };
  }

  update(contact: Vec3): void {
    if (!this.constraint || ![contact.x, contact.y, contact.z].every(Number.isFinite)) return;
    this.constraint = { ...this.constraint, target: {
      x: contact.x + this.offset.x, y: contact.y + this.offset.y, z: contact.z + this.offset.z,
    } };
  }

  get current(): GrabConstraint | undefined { return this.constraint; }
  end(): void { this.constraint = undefined; }
}

function nonNegative(value: number): boolean { return Number.isFinite(value) && value >= 0; }
