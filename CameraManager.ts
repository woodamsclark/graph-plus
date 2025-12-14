import type { CameraState, CameraSettings } from './utilities/interfaces.ts';
import { getSettings, updateSettings } from './utilities/settingsStore.ts';

const MIN_DISTANCE = 100;
const MAX_DISTANCE = 5000;
const MIN_PITCH    = -Math.PI / 2 + 0.05;
const MAX_PITCH    =  Math.PI / 2 - 0.05;

export class CameraManager {
    private cameraSettings : CameraSettings;
    private cameraState    : CameraState;
    //private renderer       : Renderer;
    private cameraSnapShot : CameraState                                                | null = null;
    //private worldAnchor    : { screenX: number; screenY: number; screenZ: number }      | null = null;
    private worldAnchor    : { x: number; y: number; z: number } | null = null;
    private screenAnchor   : { screenX: number; screenY: number                  }      | null = null;
    private viewport       : { width  : number; height : number; offsetX: number; offsetY: number } = { width: 0, height: 0, offsetX: 0, offsetY: 0 };

    constructor(initialState: CameraState) {
        this.cameraState     = { ...initialState };
        this.cameraSettings  = getSettings().camera;
        //this.renderer        = renderer;
    }

    getState(): CameraState {
        return { ...this.cameraState };
    }

    /** Directly overwrite full state (e.g. when loading from saved camera state) */
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

    /** Reset to initial pose, clearing momentum */
    resetCamera() {
        this.cameraState = { ...getSettings().camera.state };
        this.clearMomentum();
    }

    /** Projects a world point to screen coordinates */
    worldToScreen(node: { x: number; y: number; z: number }): { x: number; y: number; depth: number } {
        const { yaw, pitch, distance, targetX, targetY, targetZ } = this.cameraState;
        const { offsetX, offsetY } = this.viewport;

        // 1. Translate world to camera target
        const wx = (node.x || 0) - targetX;
        const wy = (node.y || 0) - targetY;
        const wz = (node.z || 0) - targetZ;

        // 2. Rotate (Yaw then Pitch)
        const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
        const xz = wx * cosYaw - wz * sinYaw;
        const zz = wx * sinYaw + wz * cosYaw;

        const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
        const yz = wy * cosP - zz * sinP;
        const zz2 = wy * sinP + zz * cosP;

        // 3. Project
        const camZ = distance;
        const dz   = camZ - zz2; // distance from camera lens to point
        const safeDz = Math.max(0.0001, dz);
        const focal = 800; 
        const perspective = focal / safeDz;

        return {
            x: xz * perspective + offsetX,
            y: yz * perspective + offsetY,
            depth: dz
        };
    }

    setViewport(width: number, height: number) {
        this.viewport.width   = width;
        this.viewport.height  = height;
        this.viewport.offsetX = width / 2;
        this.viewport.offsetY = height / 2;
    }

    /** Unprojects screen coords to world coords on a plane at camera-distance (for panning) */
    screenToWorld(screenX: number, screenY: number, depthFromCamera: number): { x: number; y: number; z: number } {
        const { yaw, pitch, targetX, targetY, targetZ } = this.cameraState;
        const { offsetX, offsetY } = this.viewport;

        const focal = 800;
        const px = screenX - offsetX;
        const py = screenY - offsetY;
        
        // Reverse Projection
        const perspective = focal / depthFromCamera;
        const xCam = px / perspective;
        const yCam = py / perspective;
        
        // Un-Rotate
        const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
        const wy = yCam * cosP + depthFromCamera * sinP;
        const wz1 = -yCam * sinP + depthFromCamera * cosP;

        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const wx = xCam * cosY + wz1 * sinY;
        const wz = -xCam * sinY + wz1 * cosY;

        return { x: wx + targetX, y: wy + targetY, z: wz + targetZ };
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
    }

    updateHover(screenX: number, screenY: number) {
    }

  /**
   * Step forward in time for momentum-based smoothing.
   * dtMs is elapsed milliseconds since last frame.
   */
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
