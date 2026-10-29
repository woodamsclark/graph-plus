import type { GraphAttachmentRotationV1 as Rotation, Vec3 } from '../../../contracts/v1/index.ts';

export const identityRotation3D: Rotation = { x: 0, y: 0, z: 0, w: 1 };
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subtract3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export function normalize3(a: Vec3): Vec3 {
  const length = Math.hypot(a.x, a.y, a.z);
  return length > 1e-12 ? scale3(a, 1 / length) : { x: 1, y: 0, z: 0 };
}
export function angle3(a: Vec3, b: Vec3): number {
  const cross = cross3(a, b);
  return Math.atan2(Math.hypot(cross.x, cross.y, cross.z), dot3(a, b));
}

export { graphAttachmentSlotDirection3DV1 as attachmentSlotDirection3D } from '../../../contracts/v1/index.ts';

/** Bound automatic searches for hostile counts; explicit indices always remain addressable. */
export function attachmentCandidateSlots3D(count: number, localDirection: Vec3): number[] {
  if (count <= 4096) return Array.from({ length: count }, (_, i) => i);
  const center = Math.round((1 - localDirection.z) * count / 2 - 0.5);
  const candidates = new Set<number>();
  for (let i = 0; i < 512; i++) {
    candidates.add(Math.min(count - 1, Math.floor(i * count / 512)));
    candidates.add(Math.max(0, Math.min(count - 1, center + i - 256)));
  }
  return [...candidates];
}

export function rotate3(q: Rotation, v: Vec3): Vec3 {
  const u = { x: q.x, y: q.y, z: q.z };
  return add3(v, add3(scale3(cross3(u, v), 2 * q.w), scale3(cross3(u, cross3(u, v)), 2)));
}
export const inverseRotation3D = (q: Rotation): Rotation => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function normalizeRotation3D(q: Rotation): Rotation {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return length > 1e-12 ? { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length } : identityRotation3D;
}
export function validRotation3D(value: unknown): value is Rotation {
  if (!value || typeof value !== 'object') return false;
  const q = value as Rotation;
  return [q.x, q.y, q.z, q.w].every(Number.isFinite) && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) <= 1e-6;
}
export function interpolateRotation3D(a: Rotation, b: Rotation, amount: number): Rotation {
  let cosine = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = cosine < 0 ? -1 : 1; cosine = Math.min(1, Math.abs(cosine));
  const angle = Math.acos(cosine), sine = Math.sin(angle);
  const left = sine > 1e-8 ? Math.sin((1 - amount) * angle) / sine : 1 - amount;
  const right = (sine > 1e-8 ? Math.sin(amount * angle) / sine : amount) * sign;
  return normalizeRotation3D({ x: a.x * left + b.x * right, y: a.y * left + b.y * right, z: a.z * left + b.z * right, w: a.w * left + b.w * right });
}

/** Minimal swing; a deterministic tangent also handles a precisely opposite direction. */
export function tangentToward3D(from: Vec3, to: Vec3): Vec3 {
  const tangent = subtract3(to, scale3(from, dot3(from, to)));
  if (Math.hypot(tangent.x, tangent.y, tangent.z) > 1e-10) return normalize3(tangent);
  if (dot3(from, to) >= 0) return { x: 0, y: 0, z: 0 };
  return normalize3(cross3(from, Math.abs(from.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
}

/** Wahba fit via the largest eigenvector of Davenport's symmetric quaternion matrix. */
export function fitAttachmentRotation3D(pairs: readonly { local: Vec3; world: Vec3 }[], fallback: Rotation): Rotation {
  if (!pairs.length) return fallback;
  const b = Array.from({ length: 3 }, () => [0, 0, 0]);
  // Tiny prior selects the nearest pose when one axis leaves twist underdetermined.
  const axes = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const samples = pairs.map(pair => ({ ...pair, weight: 1 })).concat(axes.map(local => ({ local, world: rotate3(fallback, local), weight: 1e-9 })));
  for (const { local, world, weight } of samples) {
    const a = [local.x, local.y, local.z], c = [world.x, world.y, world.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b[i][j] += a[i] * c[j] * weight;
  }
  const trace = b[0][0] + b[1][1] + b[2][2];
  const z = [b[1][2] - b[2][1], b[2][0] - b[0][2], b[0][1] - b[1][0]];
  const matrix = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) =>
    i === 3 ? j === 3 ? trace : z[j] : j === 3 ? z[i] : b[i][j] + b[j][i] - (i === j ? trace : 0)));
  const vectors: number[][] = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j ? 1 : 0));
  for (let iteration = 0; iteration < 64; iteration++) {
    let p = 0, q = 1;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (Math.abs(matrix[i][j]) > Math.abs(matrix[p][q])) { p = i; q = j; }
    if (Math.abs(matrix[p][q]) < 1e-14) break;
    const theta = 0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);
    const app = matrix[p][p], aqq = matrix[q][q], apq = matrix[p][q];
    for (let i = 0; i < 4; i++) if (i !== p && i !== q) {
      const aip = matrix[i][p], aiq = matrix[i][q];
      matrix[i][p] = matrix[p][i] = c * aip - s * aiq;
      matrix[i][q] = matrix[q][i] = s * aip + c * aiq;
    }
    matrix[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    matrix[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq; matrix[p][q] = matrix[q][p] = 0;
    for (let i = 0; i < 4; i++) { const a = vectors[i][p], b = vectors[i][q]; vectors[i][p] = c * a - s * b; vectors[i][q] = s * a + c * b; }
  }
  let best = 0; for (let i = 1; i < 4; i++) if (matrix[i][i] > matrix[best][best]) best = i;
  return normalizeRotation3D({ x: vectors[0][best], y: vectors[1][best], z: vectors[2][best], w: vectors[3][best] });
}

/** Least-squares collective angular velocity; the regularizer handles collinear patterns. */
export function attachmentAngularVelocity3D(samples: readonly { direction: Vec3; velocity: Vec3; radius: number }[]): Vec3 {
  const matrix = Array.from({ length: 3 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j ? 1e-10 : 0));
  for (const { direction: u, velocity, radius } of samples) {
    const components = [u.x, u.y, u.z], rhs = scale3(cross3(u, velocity), 1 / Math.max(radius, 1e-6));
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) matrix[i][j] += (i === j ? 1 : 0) - components[i] * components[j]; matrix[i][3] += [rhs.x, rhs.y, rhs.z][i]; }
  }
  for (let pivot = 0; pivot < 3; pivot++) {
    let best = pivot; for (let i = pivot + 1; i < 3; i++) if (Math.abs(matrix[i][pivot]) > Math.abs(matrix[best][pivot])) best = i;
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    const divisor = matrix[pivot][pivot]; for (let j = pivot; j < 4; j++) matrix[pivot][j] /= divisor;
    for (let i = 0; i < 3; i++) if (i !== pivot) { const scale = matrix[i][pivot]; for (let j = pivot; j < 4; j++) matrix[i][j] -= scale * matrix[pivot][j]; }
  }
  return { x: matrix[0][3], y: matrix[1][3], z: matrix[2][3] };
}
