import type {
  CameraState,
  CameraSettings,
  WorldTransform,
  Vec3,
} from '../../grammar/interfaces.ts';

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
};

export type ProjectionContext = {
  cameraState: CameraState;
  cameraSettings: CameraSettings;
  viewport: Viewport;
  worldTransform: WorldTransform | null;
};

export function worldToScreen(
  ctx: ProjectionContext,
  world: Vec3,
): ScreenProjection {
  const {
    yaw,
    pitch,
    distance: cameraDistance,
    targetX,
    targetY,
    targetZ,
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
  const relX = worldX - targetX;
  const relY = worldY - targetY;
  const relZ = worldZ - targetZ;

  // 2) Rotate into camera view space
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const viewX = relX * cosYaw - relZ * sinYaw;
  const viewZAfterYaw = relX * sinYaw + relZ * cosYaw;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const viewY = relY * cosPitch - viewZAfterYaw * sinPitch;
  const viewZ = relY * sinPitch + viewZAfterYaw * cosPitch;

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
  };
}

export function screenToWorld(
  ctx: ProjectionContext,
  screenX: number,
  screenY: number,
  depthFromCamera: number,
): Vec3 {
  const {
    yaw,
    pitch,
    distance: camDistance,
    targetX,
    targetY,
    targetZ,
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

  // Inverse pitch
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const wy = yz * cosP + zz2 * sinP;
  const zz = -yz * sinP + zz2 * cosP;

  // Inverse yaw
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const wx = xz * cosY + zz * sinY;
  const wz = -xz * sinY + zz * cosY;

  let world: Vec3 = {
    x: wx + targetX,
    y: wy + targetY,
    z: wz + targetZ,
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
  cameraState: CameraState,
  cameraSettings: CameraSettings,
  viewport: Viewport,
): number {
  const d = cameraState.distance;
  const minD = cameraSettings.min_distance;
  const maxD = cameraSettings.max_distance;

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