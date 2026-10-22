import { GRAPH_ANGULAR_SPRING_PRESETS_V1, type GraphNodeAttachmentV1 } from '../../../contracts/v1/index.ts';

export function angularSpringStiffnessV1(pattern: GraphNodeAttachmentV1): number {
  const stiffness = pattern.stiffness ?? 'soft';
  return typeof stiffness === 'number' ? stiffness : GRAPH_ANGULAR_SPRING_PRESETS_V1[stiffness];
}

/** Signed distance to the nearest repeated direction, in radians. */
function wrap(angle: number, spacing: number): number {
  return ((angle + spacing / 2) % spacing + spacing) % spacing - spacing / 2;
}

/**
 * Fit a freely turning pattern and return spring errors outside its zones.
 * A circular harmonic supplies the seed; relaxation balances signed errors so
 * the pattern does not introduce an absolute orientation. Ties use the first
 * neighbor (callers provide stable ID order), never a graph/camera axis.
 */
export function connectionAngleErrorsV1(
  angles: readonly number[],
  pattern: GraphNodeAttachmentV1,
): readonly number[] {
  if ((pattern.count ?? 1) === 1 || angles.length < 2) return angles.map(() => 0);
  const count = pattern.count ?? 1;
  const spacing = Math.PI * 2 / count;
  const halfOpening = (pattern.openingDegrees ?? 0) * Math.PI / 360;
  if (halfOpening >= spacing / 2 - 1e-12) return angles.map(() => 0);
  // Relative angles preserve rotation equivariance even for cancelling harmonics.
  const anchor = angles[0];
  const relative = angles.map(angle => wrap(angle - anchor, Math.PI * 2));
  let x = 0, y = 0;
  for (const angle of relative) {
    x += Math.cos(count * angle);
    y += Math.sin(count * angle);
  }
  let phase = Math.hypot(x, y) > angles.length * 1e-10 ? Math.atan2(y, x) / count : 0;
  const errors = relative.map(() => 0);
  for (let iteration = 0; iteration < 32; iteration++) {
    let sum = 0;
    let active = 0;
    for (let i = 0; i < relative.length; i++) {
      const delta = wrap(relative[i] - phase, spacing);
      const error = Math.sign(delta) * Math.max(0, Math.abs(delta) - halfOpening);
      errors[i] = error;
      sum += error;
      if (error !== 0) active++;
    }
    if (Math.abs(sum) < 1e-10 || !active) break;
    phase += sum / active;
  }
  // Re-evaluate after the final phase update.
  return relative.map(angle => {
    const delta = wrap(angle - phase, spacing);
    return Math.sign(delta) * Math.max(0, Math.abs(delta) - halfOpening);
  });
}
