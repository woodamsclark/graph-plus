import type { CameraState, CameraSettings, WorldTransform } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';

const MIN_DISTANCE = 100;
const MAX_DISTANCE = 5000;
const MIN_PITCH    = -Math.PI / 2 + 0.05;
const MAX_PITCH    =  Math.PI / 2 - 0.05;

export class CameraManager {
  private cameraSettings  : CameraSettings;
  private cameraState     : CameraState;
  //private renderer       : Renderer;
  private cameraSnapShot  : CameraState                                                 | null  = null;
//private worldAnchor     : { screenX: number; screenY: number; screenZ: number }       | null  = null;
  private worldAnchor     : { x: number; y: number; z: number }                         | null  = null;
  private screenAnchor    : { screenX: number; screenY: number                  }       | null  = null;
  private viewport: { width  : number; height : number; offsetX: number; offsetY: number }      = { width: 0, height: 0, offsetX: 0, offsetY: 0 };

  private worldTransform: WorldTransform | null = null;

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

  worldToScreen(node: { x: number; y: number; z: number }): { x: number; y: number; depth: number } {
  const { yaw, pitch, distance, targetX, targetY, targetZ } = this.cameraState;
  const { offsetX, offsetY } = this.viewport;

  // Read raw world coords
  let wx0 = (node.x || 0);
  let wy0 = (node.y || 0);
  let wz0 = (node.z || 0);

  // Apply "Turntable World" transform BEFORE camera target/rotation/projection
  // (camera stays “still”; world rotates/scales)
  const wt = this.worldTransform;
  if (wt) {
    // scale
    wx0 *= wt.scale;
    wy0 *= wt.scale;
    wz0 *= wt.scale;

    // rotate around Y (yaw)
    const cy = Math.cos(wt.rotationY), sy = Math.sin(wt.rotationY);
    const x1 = wx0 * cy - wz0 * sy;
    const z1 = wx0 * sy + wz0 * cy;
    wx0 = x1;
    wz0 = z1;

    // rotate around X (pitch)
    const cx = Math.cos(wt.rotationX), sx = Math.sin(wt.rotationX);
    const y2 = wy0 * cx - wz0 * sx;
    const z2 = wy0 * sx + wz0 * cx;
    wy0 = y2;
    wz0 = z2;
  }

  // 1) Translate world to camera target
  const wx = wx0 - targetX;
  const wy = wy0 - targetY;
  const wz = wz0 - targetZ;

  // 2) Camera rotate (Yaw then Pitch) — existing logic
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const xz = wx * cosYaw - wz * sinYaw;
  const zz = wx * sinYaw + wz * cosYaw;

  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const yz = wy * cosP - zz * sinP;
  const zz2 = wy * sinP + zz * cosP;

  // 3) Project — existing logic
  const camZ = distance;
  const dz   = camZ - zz2;
  const safeDz = Math.max(0.0001, dz);
  const focal = 800;
  const perspective = focal / safeDz;

  return {
    x: xz * perspective + offsetX,
    y: yz * perspective + offsetY,
    depth: dz
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

    const focal       = 800;
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
    this.cameraState.orbitVelX    = 0;
    this.cameraState.orbitVelY    = 0;
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

  startOrbit(screenX: number, screenY: number) {
    this.screenAnchor       = { screenX, screenY    };
    this.cameraSnapShot     = { ...this.cameraState };
  }

  updateOrbit(screenX: number, screenY: number) {
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

  endOrbit(){
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
  }

  updateHover(screenX: number, screenY: number) {
  }

  // Step forward in time for momentum-based smoothing.
  // dtMs is elapsed milliseconds since last frame.
  step(dtMs: number) {
    const t = dtMs / 16.67; // normalize relative to 60fps
    const damping = Math.pow(1 - this.cameraSettings.momentumScale, t);

    // orbit momentum
    if (Math.abs(this.cameraState.orbitVelX) > 1e-4 || Math.abs(this.cameraState.orbitVelY) > 1e-4) {
      this.cameraState.yaw          += this.cameraState.orbitVelX;
      this.cameraState.pitch        += this.cameraState.orbitVelY;
      this.cameraState.pitch         = clamp(this.cameraState.pitch, MIN_PITCH, MAX_PITCH);
      this.cameraState.orbitVelX    *= damping;
      this.cameraState.orbitVelY    *= damping;
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
      this.cameraState.distance     = clamp(this.cameraState.distance + this.cameraState.zoomVel, MIN_DISTANCE, MAX_DISTANCE);
      this.cameraState.zoomVel     *= damping;
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}
