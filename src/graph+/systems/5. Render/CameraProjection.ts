import type {
  CameraState,
  WorldTransform,
} from '../../types/domain/camera.ts';

import type { Vec3 } from '../../types/domain/math.ts';
import type { CameraSettings } from '../../types/settings/appSettings.ts';

export type Viewport = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export type ScreenProjection = {
  x: number;
  y: number;
  depth: number;
  scale: number;
  viewZ: number;
};

export type ProjectionContext = {
  cameraState   : CameraState;
  cameraSettings: CameraSettings;
  viewport      : Viewport;
  worldTransform: WorldTransform | null;
};

export type CameraBasis = {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
};

export function worldToScreen(
  ctx: ProjectionContext,
  world: Vec3,
): ScreenProjection {
  const {
    distance: cameraDistance,
    targetX,
    targetY,
    targetZ,
    offsetX,
    offsetY,
    offsetZ,
  } = ctx.cameraState;

  const { offsetX: viewportCenterX, offsetY: viewportCenterY } = ctx.viewport;

  // 0) Start in world space
  let worldX = world.x;
  let worldY = world.y;
  let worldZ = world.z;

  // Optional "turntable world" transform (world moves, camera stays put)
  const worldXform = ctx.worldTransform;
  if (worldXform) {
    ({ x: worldX, y: worldY, z: worldZ } = applyWorldTransform(
      { x: worldX, y: worldY, z: worldZ },
      worldXform,
    ));
  }

  // 1) Move into camera-target-relative space
  const effectiveTargetX = targetX + offsetX;
  const effectiveTargetY = targetY + offsetY;
  const effectiveTargetZ = targetZ + offsetZ;

  const relX = worldX - effectiveTargetX;
  const relY = worldY - effectiveTargetY;
  const relZ = worldZ - effectiveTargetZ;

  // 2) Rotate into camera view space
  const basis = getCameraBasis(ctx.cameraState);
  const rel = { x: relX, y: relY, z: relZ };
  const viewX = dot3(rel, basis.right);
  const viewY = dot3(rel, basis.up);
  const viewZ = dot3(rel, basis.forward);

  // 3) Perspective projection
  const depthToCameraPlane = cameraDistance - viewZ;
  const depthForDivide = Math.max(0.0001, depthToCameraPlane);
  const focalLengthPx = getEffectiveFocalPx(ctx.cameraState, ctx.cameraSettings, ctx.viewport);

  const pixelsPerWorldUnit = focalLengthPx / depthForDivide;

  return {
    x: viewX * pixelsPerWorldUnit + viewportCenterX,
    y: viewY * pixelsPerWorldUnit + viewportCenterY,
    depth: depthToCameraPlane,
    scale: pixelsPerWorldUnit,
    viewZ,
  };
}

export function screenToWorld(
  ctx: ProjectionContext,
  screenX: number,
  screenY: number,
  depthFromCamera: number,
): Vec3 {
  const {
    distance: camDistance,
    targetX,
    targetY,
    targetZ,
    offsetX: targetOffsetX,
    offsetY: targetOffsetY,
    offsetZ: targetOffsetZ,
  } = ctx.cameraState;

  const { offsetX, offsetY } = ctx.viewport;

  const focal = getEffectiveFocalPx(ctx.cameraState, ctx.cameraSettings, ctx.viewport);
  const px = screenX - offsetX;
  const py = screenY - offsetY;

  // Reverse projection
  const perspective = focal / depthFromCamera;
  const xz = px / perspective;
  const yz = py / perspective;

  // Convert depth back to camera-rotated Z coordinate
  const zz2 = camDistance - depthFromCamera;
  const basis = getCameraBasis(ctx.cameraState);
  const rel = add3(
    scale3(basis.right, xz),
    add3(
      scale3(basis.up, yz),
      scale3(basis.forward, zz2),
    ),
  );

  let world: Vec3 = {
    x: rel.x + targetX + targetOffsetX,
    y: rel.y + targetY + targetOffsetY,
    z: rel.z + targetZ + targetOffsetZ,
  };

  if (ctx.worldTransform) {
    world = applyInverseWorldTransform(world, ctx.worldTransform);
  }

  return world;
}

export function screenToWorld3D(
  ctx: ProjectionContext,
  screenX: number,
  screenY: number,
  depthFromCamera: number,
): Vec3 {
  return screenToWorld(ctx, screenX, screenY, depthFromCamera);
}

export function screenToWorld2D(
  ctx: ProjectionContext,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const world = screenToWorld(ctx, screenX, screenY, ctx.cameraState.distance);
  return { x: world.x, y: world.y };
}

export function getEffectiveFocalPx(
  cameraState   : CameraState,
  cameraSettings: CameraSettings,
  viewport      : Viewport,
): number {
  const d = cameraState.distance;
  const minD = cameraSettings.minDistance;
  const maxD = cameraSettings.maxDistance;

  let t = (d - minD) / Math.max(0.0001, maxD - minD);
  t = clamp01(t);
  t = smoothstep(t);

  // Preserved from current behavior:
  // min distance -> tele, max distance -> wide
  const wideMm = 18;
  const teleMm = 120;
  const focalMm = lerp(teleMm, wideMm, t);

  return focalMmToPx(focalMm, viewport);
}

export function focalMmToPx(
  focalMm: number,
  viewport: Viewport,
  sensorHeightMm = 24,
): number {
  const vh = Math.max(1, viewport.height);
  return (vh * focalMm) / sensorHeightMm;
}

export function getCameraBasis(
  cameraState: Pick<CameraState, "yaw" | "pitch" | "roll">,
): CameraBasis {
  const yaw = cameraState.yaw;
  const pitch = cameraState.pitch;
  const roll = cameraState.roll ?? 0;

  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);

  const baseRight: Vec3 = {
    x: cosY,
    y: 0,
    z: -sinY,
  };
  const baseUp: Vec3 = {
    x: -sinP * sinY,
    y: cosP,
    z: -sinP * cosY,
  };
  const forward: Vec3 = {
    x: cosP * sinY,
    y: sinP,
    z: cosP * cosY,
  };

  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);

  const right = add3(
    scale3(baseRight, cosR),
    scale3(baseUp, -sinR),
  );
  const up = add3(
    scale3(baseRight, sinR),
    scale3(baseUp, cosR),
  );

  return orthonormalizeCameraBasis({ right, up, forward });
}

export function rotateCameraLocally(
  cameraState: Pick<CameraState, "yaw" | "pitch" | "roll">,
  yawDelta: number,
  pitchDelta: number,
  minPitch: number,
  maxPitch: number,
): { yaw: number; pitch: number; roll: number } {
  let basis = getCameraBasis(cameraState);

  if (yawDelta !== 0) {
    basis = orthonormalizeCameraBasis({
      right: rotateVecAroundAxis(basis.right, basis.up, yawDelta),
      up: basis.up,
      forward: rotateVecAroundAxis(basis.forward, basis.up, yawDelta),
    });
  }

  if (pitchDelta !== 0) {
    basis = orthonormalizeCameraBasis({
      right: basis.right,
      up: rotateVecAroundAxis(basis.up, basis.right, pitchDelta),
      forward: rotateVecAroundAxis(basis.forward, basis.right, pitchDelta),
    });
  }

  const orientation = cameraBasisToOrientation(basis);
  orientation.pitch = clamp(orientation.pitch, minPitch, maxPitch);
  return orientation;
}

export function applyWorldTransform(world: Vec3, transform: WorldTransform): Vec3 {
  let x = world.x * transform.scale;
  let y = world.y * transform.scale;
  let z = world.z * transform.scale;

  // rotate around Y
  {
    const cosY = Math.cos(transform.rotationY);
    const sinY = Math.sin(transform.rotationY);
    const rotatedX = x * cosY - z * sinY;
    const rotatedZ = x * sinY + z * cosY;
    x = rotatedX;
    z = rotatedZ;
  }

  // rotate around X
  {
    const cosX = Math.cos(transform.rotationX);
    const sinX = Math.sin(transform.rotationX);
    const rotatedY = y * cosX - z * sinX;
    const rotatedZ = y * sinX + z * cosX;
    y = rotatedY;
    z = rotatedZ;
  }

  return { x, y, z };
}

export function applyInverseWorldTransform(world: Vec3, transform: WorldTransform): Vec3 {
  let x = world.x;
  let y = world.y;
  let z = world.z;

  // inverse rotate around X
  {
    const cx = Math.cos(-transform.rotationX);
    const sx = Math.sin(-transform.rotationX);
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    y = y1;
    z = z1;
  }

  // inverse rotate around Y
  {
    const cy = Math.cos(-transform.rotationY);
    const sy = Math.sin(-transform.rotationY);
    const x2 = x * cy - z * sy;
    const z2 = x * sy + z * cy;
    x = x2;
    z = z2;
  }

  // inverse scale
  const s = transform.scale === 0 ? 1 : transform.scale;
  x /= s;
  y /= s;
  z /= s;

  return { x, y, z };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function cameraBasisToOrientation(
  basis: CameraBasis,
): { yaw: number; pitch: number; roll: number } {
  const normalized = orthonormalizeCameraBasis(basis);
  const pitch = Math.asin(clamp(normalized.forward.y, -1, 1));
  const yaw = Math.atan2(normalized.forward.x, normalized.forward.z);
  const noRollBasis = getCameraBasis({ yaw, pitch, roll: 0 });
  const roll = Math.atan2(
    dot3(normalized.up, noRollBasis.right),
    dot3(normalized.up, noRollBasis.up),
  );

  return {
    yaw,
    pitch,
    roll: normalizeAngle(roll),
  };
}

function orthonormalizeCameraBasis(basis: CameraBasis): CameraBasis {
  const forward = normalizeVec3(basis.forward);
  let right = cross3(basis.up, forward);
  if (lengthSq3(right) <= 1e-12) {
    right = basis.right;
  }
  right = normalizeVec3(right);
  const up = normalizeVec3(cross3(forward, right));

  return { right, up, forward };
}

function rotateVecAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const unitAxis = normalizeVec3(axis);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  return add3(
    add3(
      scale3(v, cosA),
      scale3(cross3(unitAxis, v), sinA),
    ),
    scale3(unitAxis, dot3(unitAxis, v) * (1 - cosA)),
  );
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale3(v: Vec3, scalar: number): Vec3 {
  return {
    x: v.x * scalar,
    y: v.y * scalar,
    z: v.z * scalar,
  };
}

function lengthSq3(v: Vec3): number {
  return dot3(v, v);
}

function normalizeVec3(v: Vec3): Vec3 {
  const lengthSq = lengthSq3(v);
  if (lengthSq <= 1e-12) {
    return { x: 0, y: 0, z: 0 };
  }

  const invLength = 1 / Math.sqrt(lengthSq);
  return {
    x: v.x * invLength,
    y: v.y * invLength,
    z: v.z * invLength,
  };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
