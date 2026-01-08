import type { CameraState, CameraSettings, WorldTransform } from '../shared/interfaces.ts';
import type { GraphNode } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';



export class CameraController {
  private cameraSettings  : CameraSettings;
  private cameraState     : CameraState;
  private cameraSnapShot  : CameraState                                                 | null  = null;
  private worldAnchor     : { x: number; y: number; z: number }                         | null  = null;
  private screenAnchor    : { screenX: number; screenY: number                  }       | null  = null;
  private viewport        : { width  : number; height : number; offsetX: number; offsetY: number }      = { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  private worldTransform: WorldTransform | null = null;

  // Camera/worldToScreen outputs in viewport space
  // Mouse/touch must be converted into viewport space

  constructor(initialState: CameraState) {
    this.cameraState     = { ...initialState };
    this.cameraSettings  = getSettings().camera;
    //this.renderer        = renderer;
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

  /** If user changes camera settings in UI */
  updateSettings(settings: CameraSettings) {
    this.cameraSettings = { ...settings }; // update settins tab callback?
  }

  resetCamera() {
    this.cameraState = { ...getSettings().camera.state };
    this.clearMomentum();
  }

  worldToScreen(node: GraphNode): { x: number; y: number; depth: number; scale: number } {
    const {
      yaw,
      pitch,
      distance: cameraDistance,
      targetX,
      targetY,
      targetZ,
    } = this.cameraState;

    const { offsetX: viewportCenterX, offsetY: viewportCenterY } = this.viewport;

    // 0) Start in world space
    let worldX = node.location.x ?? 0;
    let worldY = node.location.y ?? 0;
    let worldZ = node.location.z ?? 0;

    // Optional "turntable world" transform (world moves, camera stays put)
    const worldXform = this.worldTransform;
    if (worldXform) {
      // scale world
      worldX *= worldXform.scale;
      worldY *= worldXform.scale;
      worldZ *= worldXform.scale;

      // rotate world around Y (world yaw)
      {
        const cosY = Math.cos(worldXform.rotationY);
        const sinY = Math.sin(worldXform.rotationY);
        const rotatedX = worldX * cosY - worldZ * sinY;
        const rotatedZ = worldX * sinY + worldZ * cosY;
        worldX = rotatedX;
        worldZ = rotatedZ;
      }

      // rotate world around X (world pitch)
      {
        const cosX = Math.cos(worldXform.rotationX);
        const sinX = Math.sin(worldXform.rotationX);
        const rotatedY = worldY * cosX - worldZ * sinX;
        const rotatedZ = worldY * sinX + worldZ * cosX;
        worldY = rotatedY;
        worldZ = rotatedZ;
      }
    }

    // 1) Move into camera-target-relative space (world relative to camera target)
    const relX = worldX - targetX;
    const relY = worldY - targetY;
    const relZ = worldZ - targetZ;

    // 2) Rotate into camera view space (apply camera yaw then pitch)
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const viewX = relX * cosYaw - relZ * sinYaw;
    const viewZ_afterYaw = relX * sinYaw + relZ * cosYaw;

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const viewY = relY * cosPitch - viewZ_afterYaw * sinPitch;
    const viewZ = relY * sinPitch + viewZ_afterYaw * cosPitch;

    // 3) Perspective projection
    // "depthToCameraPlane" is how far in front of the camera the point is (in view space)
    const depthToCameraPlane  = cameraDistance - viewZ;
    const depthForDivide      = Math.max(0.0001, depthToCameraPlane); // Avoid divide-by-zero
    const focalLengthPx       = this.cameraSettings.focalLengthPx;

    // Pixels-per-world-unit at this depth
    const pixelsPerWorldUnit  = focalLengthPx / depthForDivide;

    return {
      x: viewX * pixelsPerWorldUnit + viewportCenterX,
      y: viewY * pixelsPerWorldUnit + viewportCenterY,
      depth: depthToCameraPlane,
      scale: pixelsPerWorldUnit,
    };
  }


  setWorldTransform(t: WorldTransform | null) {
    this.worldTransform = t;
  }

  setViewport(width: number, height: number) {
    this.viewport.width   = width;
    this.viewport.height  = height;
    this.viewport.offsetX = width / 2;
    this.viewport.offsetY = height / 2;
  }

  // Unprojects screen coords to world coords on a plane at camera-distance (for panning)
  screenToWorld(screenX: number, screenY: number, dz: number): { x: number; y: number; z: number } {
    const { yaw, pitch, distance: camZ, targetX, targetY, targetZ } = this.cameraState;
    const { offsetX, offsetY } = this.viewport;

    const focal       = this.cameraSettings.focalLengthPx;
    const px          = screenX - offsetX;
    const py          = screenY - offsetY;

    // Reverse projection (dz is what worldToScreen() returned as "depth")
    const perspective = focal / dz;
    const xz          = px / perspective;
    const yz          = py / perspective;

    // Convert dz back to camera-rotated Z coordinate (zz2)
    const zz2         = camZ - dz;

    // Inverse pitch
    const cosP        = Math.cos(pitch), sinP = Math.sin(pitch);
    const wy          = yz * cosP + zz2 * sinP;
    const zz          = -yz * sinP + zz2 * cosP;

    // Inverse yaw
    const cosY        = Math.cos(yaw), sinY = Math.sin(yaw);
    const wx          = xz * cosY + zz * sinY;
    const wz          = -xz * sinY + zz * cosY;

    let world         = { x: wx + targetX, y: wy + targetY, z: wz + targetZ };

    const wt    = this.worldTransform;
    if (wt) {
      // inverse rotate around X
      const cx  = Math.cos(-wt.rotationX), sx = Math.sin(-wt.rotationX);
      const y1  = world.y * cx - world.z * sx;
      const z1  = world.y * sx + world.z * cx;
      world.y   = y1;
      world.z   = z1;

      // inverse rotate around Y
      const cy  = Math.cos(-wt.rotationY), sy = Math.sin(-wt.rotationY);
      const x2  = world.x * cy - world.z * sy;
      const z2  = world.x * sy + world.z * cy;
      world.x   = x2;
      world.z   = z2;

      // inverse scale
      const s   = (wt.scale === 0) ? 1 : wt.scale;
      world.x  /= s;
      world.y  /= s;
      world.z  /= s;
    }
    return world;
  }

  screenToWorld3D(screenX: number, screenY: number, depthFromCamera: number) {
    return this.screenToWorld(screenX, screenY, depthFromCamera);
  }

  screenToWorld2D(screenX: number, screenY: number) {
    const cam   = this.cameraState;
    const world = this.screenToWorld(screenX, screenY, cam.distance);
    return { x: world.x, y: world.y };
  }

  private clearMomentum() {
    this.cameraState.rotateVelX    = 0;
    this.cameraState.rotateVelY    = 0;
    this.cameraState.panVelX      = 0;
    this.cameraState.panVelY      = 0;
    this.cameraState.zoomVel      = 0;
  }

  startPan(screenX: number, screenY: number) {
    const cam             = this.cameraState;
    this.screenAnchor     = { screenX, screenY };
    // world-space anchor at the plane in front of the camera
    this.worldAnchor      = this.screenToWorld(screenX, screenY, cam.distance);
  }

  updatePan(screenX: number, screenY: number) {
    if (!this.worldAnchor) return;

    const cam     = this.cameraState;
    const current = this.screenToWorld(screenX, screenY, cam.distance);

    const dx = current.x - this.worldAnchor.x;
    const dy = current.y - this.worldAnchor.y;
    const dz = current.z - this.worldAnchor.z;

    cam.targetX -= dx;
    cam.targetY -= dy;
    cam.targetZ -= dz;

    // keep anchor sliding along with the drag
    this.worldAnchor = this.screenToWorld(screenX, screenY, cam.distance);
  }

  endPan() {
    this.screenAnchor      = null;
    this.worldAnchor       = null;
  }

  startRotate(screenX: number, screenY: number) {
    this.screenAnchor       = { screenX, screenY    };
    this.cameraSnapShot     = { ...this.cameraState };
  }

  updateRotate(screenX: number, screenY: number) {
    const rotateSensitivityX    = this.cameraSettings.rotateSensitivityX;
    const rotateSensitivityY    = this.cameraSettings.rotateSensitivityY;
    const zoomSensitivity       = this.cameraSettings.zoomSensitivity;
    const dx                    = screenX - this.screenAnchor!.screenX;
    const dy                    = screenY - this.screenAnchor!.screenY;

    let yaw                     = this.cameraSnapShot!.yaw   - dx * rotateSensitivityX;
    let pitch                   = this.cameraSnapShot!.pitch - dy * rotateSensitivityY;
    const maxPitch              = Math.PI / 2;// - 0.05;
    const minPitch              = -maxPitch;
    if (pitch > maxPitch) pitch = maxPitch;
    if (pitch < minPitch) pitch = minPitch;

    this.cameraState.yaw        = yaw;
    this.cameraState.pitch      = pitch;
  }

  endRotate(){
    this.screenAnchor           = null;
    this.cameraSnapShot         = null;
  }

  startDrag(nodeId: string, screenX: number, screenY: number){
  }

  updateDrag(screenX: number, screenY: number) {
  }

  endDrag(){
  }

  updateZoom(screenX: number, screenY: number, delta: number) {
    this.cameraState.distance += delta * this.cameraSettings.zoomSensitivity;
    this.cameraState.distance = clamp(this.cameraState.distance, this.cameraSettings.min_distance, this.cameraSettings.max_distance);
  }

  updateHover(screenX: number, screenY: number) {
  }

  // Step forward in time for momentum-based smoothing.
  // dtMs is elapsed milliseconds since last frame.
  step(dtMs: number) {
    const t = dtMs / 16.67; // normalize relative to 60fps
    const damping = Math.pow(1 - this.cameraSettings.momentumScale, t);

    // rotate momentum
    if (Math.abs(this.cameraState.rotateVelX) > 1e-4 || Math.abs(this.cameraState.rotateVelY) > 1e-4) {
      this.cameraState.yaw          += this.cameraState.rotateVelX;
      this.cameraState.pitch        += this.cameraState.rotateVelY;
      this.cameraState.pitch         = clamp(this.cameraState.pitch, this.cameraSettings.min_pitch, this.cameraSettings.max_pitch);
      this.cameraState.rotateVelX    *= damping;
      this.cameraState.rotateVelY    *= damping;
    }

    // pan momentum
    if (Math.abs(this.cameraState.panVelX) > 1e-4 || Math.abs(this.cameraState.panVelY) > 1e-4) {
      this.cameraState.targetX     += this.cameraState.panVelX;
      this.cameraState.targetY     += this.cameraState.panVelY;
      this.cameraState.panVelX     *= damping;
      this.cameraState.panVelY     *= damping;
    }

    // zoom momentum
    if (Math.abs(this.cameraState.zoomVel) > 1e-4) {
      this.cameraState.distance     = clamp(this.cameraState.distance + this.cameraState.zoomVel, this.cameraSettings.min_distance, this.cameraSettings.max_distance);
      this.cameraState.zoomVel     *= damping;
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}
