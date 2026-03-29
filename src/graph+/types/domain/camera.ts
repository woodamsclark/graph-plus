import type { Vec3 } from "./math.ts";

export type CameraState = {
  yaw:        number;
  pitch:      number;
  distance:   number;
  targetX:    number;
  targetY:    number;
  targetZ:    number;
  offsetX:    number;
  offsetY:    number;
  offsetZ:    number;
  rotateVelX: number;
  rotateVelY: number;
  panVelX:    number;
  panVelY:    number;
  zoomVel:    number;
  worldAnchorPoint?: Vec3 | null;
};

export type WorldTransform = {
  rotationX: number;
  rotationY: number;
  scale: number;
};

export interface CameraAccessor {
  worldToScreen(world: Vec3): {
    x: number;
    y: number;
    depth: number;
    scale: number;
  };

  screenToWorld(screenX: number, screenY: number, depthFromCamera: number): Vec3;
  screenToWorld3D(screenX: number, screenY: number, depthFromCamera: number): Vec3;
  screenToWorld2D(screenX: number, screenY: number): { x: number; y: number };
  setViewport(width: number, height: number): void;
  patchState(partial: Partial<CameraState>): void;
  resetCamera(): void;
}