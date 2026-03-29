import { ModuleWithSettings, SettingsFor } from '../../types/index.ts';
import type {
  CameraState,
  WorldTransform,
} from '../../types/domain/camera.ts';
import type { Vec3 } from '../../types/domain/math.ts';
import type { CameraModuleSettings } from '../../types/settings/scopedSettings.ts';
import {
  worldToScreen,
  screenToWorld,
  screenToWorld2D,
  screenToWorld3D,
  clamp,
  type Viewport,
} from './CameraProjection.ts';

export class CameraController implements ModuleWithSettings<'camera'> {
  private settings      : SettingsFor<'camera'>
  private cameraState   : CameraState;
  private cameraSnapShot: CameraState | null = null;
  private worldAnchor   : Vec3        | null = null;
  private screenAnchor  : { screenX: number; screenY: number } | null = null;

  private viewport: Viewport = {
    width   : 0,
    height  : 0,
    offsetX : 0,
    offsetY : 0,
  };

  private worldTransform: WorldTransform | null = null;

  constructor(settings: CameraModuleSettings) {
    this.settings = settings;
    this.cameraState = { ...settings.camera.initialState };
  }

  getState(): CameraState {
    return { ...this.cameraState };
  }

  setState(next: CameraState) {
    this.cameraState = { ...next };
  }

  patchState(partial: Partial<CameraState>) {
    this.cameraState = { ...this.cameraState, ...partial };
  }

  updateSettings(settings: CameraModuleSettings) {
    this.settings = settings;
  }

  resetCamera() {
    const currentDistance = this.cameraState.distance;

    this.cameraState = {
      ...this.settings.camera.initialState,
      distance: currentDistance,
    };

    this.clearMomentum();
    this.clearInteractionAnchors();
  }

  setWorldTransform(transform: WorldTransform | null) {
    this.worldTransform = transform;
  }

  getWorldTransform(): WorldTransform | null {
    return this.worldTransform;
  }

  setViewport(width: number, height: number) {
    this.viewport.width = width;
    this.viewport.height = height;
    this.viewport.offsetX = width / 2;
    this.viewport.offsetY = height / 2;
  }

  getViewport(): Viewport {
    return { ...this.viewport };
  }

  worldToScreen(world: Vec3): { x: number; y: number; depth: number; scale: number } {
    return worldToScreen(this.getProjectionContext(), world);
  }

  screenToWorld(screenX: number, screenY: number, depthFromCamera: number): Vec3 {
    return screenToWorld(
      this.getProjectionContext(),
      screenX,
      screenY,
      depthFromCamera,
    );
  }

  screenToWorld3D(screenX: number, screenY: number, depthFromCamera: number): Vec3 {
    return screenToWorld3D(
      this.getProjectionContext(),
      screenX,
      screenY,
      depthFromCamera,
    );
  }

  screenToWorld2D(screenX: number, screenY: number): { x: number; y: number } {
    return screenToWorld2D(this.getProjectionContext(), screenX, screenY);
  }

  startPan(screenX: number, screenY: number) {
    const cam = this.cameraState;
    this.screenAnchor = { screenX, screenY };
    this.worldAnchor = this.screenToWorld(screenX, screenY, cam.distance);
  }

  updatePan(screenX: number, screenY: number) {
    if (!this.worldAnchor) return;

    const cam = this.cameraState;
    const current = this.screenToWorld(screenX, screenY, cam.distance);

    const dx = current.x - this.worldAnchor.x;
    const dy = current.y - this.worldAnchor.y;
    const dz = current.z - this.worldAnchor.z;

    cam.targetX -= dx;
    cam.targetY -= dy;
    cam.targetZ -= dz;

    // Keep the anchor sliding with the drag
    this.worldAnchor = this.screenToWorld(screenX, screenY, cam.distance);
  }

  endPan() {
    this.screenAnchor = null;
    this.worldAnchor = null;
  }

  startRotate(screenX: number, screenY: number) {
    this.screenAnchor = { screenX, screenY };
    this.cameraSnapShot = { ...this.cameraState };
  }

  updateRotate(screenX: number, screenY: number) {
    if (!this.screenAnchor || !this.cameraSnapShot) return;

    const dx = screenX - this.screenAnchor.screenX;
    const dy = screenY - this.screenAnchor.screenY;

    let yaw = this.cameraSnapShot.yaw - dx * this.settings.camera.rotateSensitivityX;
    let pitch = this.cameraSnapShot.pitch - dy * this.settings.camera.rotateSensitivityY;

    const maxPitch = this.settings.camera.maxPitch;
    const minPitch = this.settings.camera.minPitch;

    if (pitch > maxPitch) pitch = maxPitch;
    if (pitch < minPitch) pitch = minPitch;

    this.cameraState.yaw = yaw;
    this.cameraState.pitch = pitch;
  }

  endRotate() {
    this.screenAnchor = null;
    this.cameraSnapShot = null;
  }

  updateZoom(_screenX: number, _screenY: number, delta: number) {
    this.cameraState.distance += delta * this.settings.camera.zoomSensitivity;
    this.cameraState.distance = clamp(
      this.cameraState.distance,
      this.settings.camera.minDistance,
      this.settings.camera.maxDistance,
    );
  }

  updateHover(_screenX: number, _screenY: number) {
    // Intentionally empty for now.
    // Hover hit-testing should likely live outside camera projection/controller.
  }

  private clearMomentum() {
    this.cameraState.rotateVelX = 0;
    this.cameraState.rotateVelY = 0;
    this.cameraState.panVelX = 0;
    this.cameraState.panVelY = 0;
    this.cameraState.zoomVel = 0;
  }

  private clearInteractionAnchors() {
    this.cameraSnapShot = null;
    this.worldAnchor = null;
    this.screenAnchor = null;
  }

  private getProjectionContext() {
    return {
      cameraState   : this.cameraState,
      cameraSettings: this.settings.camera,
      viewport      : this.viewport,
      worldTransform: this.worldTransform,
    };
  }
}