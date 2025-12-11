import type { CameraState, CameraSettings } from './utilities/interfaces.ts';
import { getSettings, updateSettings } from './utilities/settingsStore.ts';

const MIN_DISTANCE = 100;
const MAX_DISTANCE = 5000;
const MIN_PITCH    = -Math.PI / 2 + 0.05;
const MAX_PITCH    =  Math.PI / 2 - 0.05;

export class CameraManager {
    private cameraSettings: CameraSettings;
    private cameraState   : CameraState;
    private cameraSnapShot: CameraState                           | null = null;
    private renderer      : any;
    private worldAnchor   : { screenX: number; screenY: number; screenZ: number }   | null = null;
    private screenAnchor  : { screenX: number; screenY: number }  | null = null;

    constructor(initialState: CameraState, renderer: any) {
        this.cameraState     = { ...initialState };
        this.cameraSettings  = getSettings().camera;
        this.renderer        = renderer;
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
    reset(initial: CameraState) {
        this.cameraState = { ...initial };
        this.clearMomentum();
    }

    private clearMomentum() {
        this.cameraState.orbitVelX = 0;
        this.cameraState.orbitVelY = 0;
        this.cameraState.panVelX   = 0;
        this.cameraState.panVelY   = 0;
        this.cameraState.zoomVel   = 0;
    }


    startPan(screenX: number, screenY: number) {
        const cam                   = this.cameraState;
        this.screenAnchor           = { screenX, screenY };
        this.worldAnchor            = this.renderer.screenToWorld3D(screenX, screenY, cam.distance, cam);
    }

    updatePan(screenX: number, screenY: number) {

        if (!this.worldAnchor) return;

        const cam                   = this.cameraState;
        const current               = this.renderer.screenToWorld3D(screenX, screenY, cam.distance, cam);

        const dx                    = current.screenX - this.worldAnchor.screenX;
        const dy                    = current.screenY - this.worldAnchor.screenY;
        const dz                    = current.screenZ - this.worldAnchor.screenZ;

        cam.targetX                -= dx;
        cam.targetY                -= dy;
        cam.targetZ                -= dz;
        this.worldAnchor           = this.renderer.screenToWorld3D(screenX, screenY, cam.distance, cam);
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
      this.cameraState.yaw   += this.cameraState.orbitVelX;
      this.cameraState.pitch += this.cameraState.orbitVelY;
      this.cameraState.pitch  = clamp(this.cameraState.pitch, MIN_PITCH, MAX_PITCH);
      this.cameraState.orbitVelX   *= damping;
      this.cameraState.orbitVelY   *= damping;
    }

    // pan momentum
    if (Math.abs(this.cameraState.panVelX) > 1e-4 || Math.abs(this.cameraState.panVelY) > 1e-4) {
      this.cameraState.targetX += this.cameraState.panVelX;
      this.cameraState.targetY += this.cameraState.panVelY;
      this.cameraState.panVelX       *= damping;
      this.cameraState.panVelY       *= damping;
    }

    // zoom momentum
    if (Math.abs(this.cameraState.zoomVel) > 1e-4) {
      this.cameraState.distance = clamp(this.cameraState.distance + this.cameraState.zoomVel, MIN_DISTANCE, MAX_DISTANCE);
      this.cameraState.zoomVel       *= damping;
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}
