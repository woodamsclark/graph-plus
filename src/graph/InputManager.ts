import { ScreenPt, ClientPt } from '../shared/interfaces.ts';
import { TwoFingerGesture } from './TwoFingerGesture.ts';
import { WheelGestureSession } from './WheelGestureSession.ts';
import { PointerTracker } from './PointerTracker.ts';
import { distSq } from '../shared/distSq.ts';
import { wrapAngleDelta } from '../shared/wrapAngleDelta.ts';
import { getSettings } from '../settings/settingsStore.ts';

type InputState =
  | { kind: 'idle' }
  | { // waiting to see if press turns into drag/pan/rotate
      kind: 'press';
      downClient: ClientPt;
      downScreen: ScreenPt;
      lastClient: ClientPt;
      clickedNodeId: string | null;
      pointerId: number;
      rightClickIntent: boolean; // “would rotate/follow/reset if released”
      longPressFired: boolean;
    }
  | { kind: 'drag-node'; nodeId: string; lastClient: ClientPt }
  | { kind: 'pan'; lastClient: ClientPt }
  | { kind: 'rotate'; lastClient: ClientPt }
  | { // multi-touch gesture
      kind: 'touch-gesture';
      lastCentroid: ScreenPt;
      lastDist: number;
      lastAngle: number;
//      panStarted: boolean;
      rotateStarted: boolean;
    };


export interface InputManagerCallbacks {
    // Camera Control
    onRotateStart(screenX: number, screenY: number): void;
    onRotateMove(screenX: number, screenY: number): void;
    onRotateEnd(): void;

    onPanStart(screenX: number, screenY: number): void;
    onPanMove(screenX: number, screenY: number): void;
    onPanEnd(): void;

    onZoom(screenX: number, screenY: number, delta: number): void;

    onFollowStart(nodeId: string): void;
    onFollowEnd(): void;
    resetCamera(): void;

    // Node Interaction
    onMouseMove(screenX: number, screenY: number): void;
    onOpenNode(screenX: number, screenY: number): void;

    // Node Dragging
    onDragStart(nodeId: string, screenX: number, screenY: number): void;
    onDragMove(screenX: number, screenY: number): void;
    onDragEnd(): void;

    // Utility
    getClickedNode(
        screenX: number,
        screenY: number,
    ): { id: string; label: string } | null;
}

export class InputManager {
    private state   : InputState    = { kind: 'idle' };
    private pointers                = new PointerTracker();
    private gesture : TwoFingerGesture;
    private wheel   : WheelGestureSession;
    settings                        = getSettings();
    private longPressTimer: number | null = null;
    private longPressPointerId: number | null = null;

    private clearLongPress() {
        if (this.longPressTimer !== null) {
        window.clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        }
        this.longPressPointerId = null;
    }

    constructor(private canvas: HTMLCanvasElement, private callback: InputManagerCallbacks) {
        this.canvas.style.touchAction = 'none';

        this.gesture = new TwoFingerGesture(this.getScreenFromClient, 5);

        this.wheel = new WheelGestureSession(
            (x, y) => this.callback.onPanStart(x, y),
            (x, y) => this.callback.onPanMove(x, y),
            () => this.callback.onPanEnd(),
            (x, y, d) => this.callback.onZoom(x, y, d),
            120,
        );

        this.attachListeners();
        this.settings = getSettings();
    }

    private getScreenFromClient = (clientX: number, clientY: number): ScreenPt => {
        const rect  = this.canvas.getBoundingClientRect();
        const dpr   = window.devicePixelRatio || 1;

        // The renderer scales the context by DPR, so the "logical" coordinate system
        // has a width of (physical_width / dpr).
        const logicalWidth  = this.canvas.width / dpr;
        const logicalHeight = this.canvas.height / dpr;

        // Calculate scale factors to map visual pixels (rect) to logical pixels (camera/context)
        const scaleX = logicalWidth / rect.width;
        const scaleY = logicalHeight / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    private startLongPress(e: PointerEvent) {
        this.clearLongPress();

        const longPressMs = this.settings?.camera?.longPressMs;

        this.longPressPointerId = e.pointerId;
        this.longPressTimer = window.setTimeout(() => {
        // Only trigger if we’re still in a single-pointer press with same pointer
        if (
            this.state.kind === 'press' &&
            this.state.pointerId === e.pointerId &&
            this.pointers.size() === 1 &&
            !this.state.rightClickIntent
        ) {
            // mark + treat as “right click intent”
            this.state.rightClickIntent = true;
            this.state.longPressFired   = true;

            // ✅ IMMEDIATE focus/reset
            if (this.state.clickedNodeId) this.callback.onFollowStart(this.state.clickedNodeId);
            else this.callback.resetCamera();

            // optional haptic (works on some devices)
            // navigator.vibrate?.(10);
        }
        }, longPressMs);
    }

    private attachListeners() {
        // Pointer events unify mouse/touch/pen.
        this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
        this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: false });
        this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
        this.canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
        this.canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: false });

        // Keep wheel: mouse wheel + trackpad scroll + (often) trackpad pinch (ctrlKey on macOS)
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

        // If you use right-click, kill the browser context menu on the canvas.
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ------------ Pointer events -----------------

    private onPointerDown = (e: PointerEvent) => {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        this.pointers.upsert(e);

        const eScreen = this.getScreenFromClient(e.clientX, e.clientY);
        //this.callback.onMouseMove(eScreen.x, eScreen.y);

        // If 2 pointers → enter touch gesture state (and end any single-pointer mode cleanly)
        if (this.pointers.size() === 2) {
            this.clearLongPress();
            this.endSinglePointerIfNeeded();
            const pair = this.pointers.two();
            if (!pair) return;
            const gesture = this.gesture.read(pair);

            this.state = {
                kind: 'touch-gesture',
                lastCentroid: gesture.centroid,
                lastDist: gesture.dist,
                lastAngle: gesture.angle,
                rotateStarted: false,
            };
            return;
        }

        // Single pointer press
        const isMouse = e.pointerType === 'mouse';
        const isLeft = e.button === 0;
        const isRight = e.button === 2;
        const rightClickIntent = isMouse && ((isLeft && (e.ctrlKey || e.metaKey)) || isRight);

        this.callback.onMouseMove(eScreen.x, eScreen.y);
        const clickedNodeId = this.callback.getClickedNode(eScreen.x, eScreen.y)?.id ?? null;
            

        this.state = {
            kind: 'press',
            downClient: { x: e.clientX, y: e.clientY },
            downScreen: eScreen,
            lastClient: { x: e.clientX, y: e.clientY },
            clickedNodeId,
            pointerId: e.pointerId,
            rightClickIntent,
            longPressFired: false,
        };
        
        if (!isMouse && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
          this.startLongPress(e);
        }
    };


    private onPointerMove = (e: PointerEvent) => {
        this.pointers.upsert(e);

        const screen = this.getScreenFromClient(e.clientX, e.clientY);
        //this.callback.onMouseMove(screen.x, screen.y);

        // 2-finger gesture
        if (this.state.kind === 'touch-gesture' && this.pointers.size() === 2) {
            e.preventDefault();
            const pair = this.pointers.two();
            if (!pair) return;

            const gesture = this.gesture.read(pair);

            // Pan start/move
/*            if (!this.state.panStarted && this.gesture.shouldStartPan(this.state.lastCentroid, gesture.centroid)) {
                this.state.panStarted = true;
                this.callback.onPanStart(gesture.centroid.x, gesture.centroid.y);
            }
            if (this.state.panStarted) this.callback.onPanMove(gesture.centroid.x, gesture.centroid.y);
*/
            // Pinch zoom
            const distDelta = gesture.dist - this.state.lastDist;
            const pinchThreshold = 2;
            if (Math.abs(distDelta) >= pinchThreshold) {
            const direction = distDelta > 0 ? -1 : 1;
            this.callback.onZoom(gesture.centroid.x, gesture.centroid.y, direction);
            }

            // Twist rotate
            const dTheta = wrapAngleDelta(gesture.angle - this.state.lastAngle);
            const rotateThreshhold = 0.00;
            if (!this.state.rotateStarted && Math.abs(dTheta) > rotateThreshhold) {
                this.state.rotateStarted = true;
                this.callback.onRotateStart(gesture.centroid.x, gesture.centroid.y);
            }
            if (this.state.rotateStarted) this.callback.onRotateMove(gesture.centroid.x, gesture.centroid.y);

            this.state.lastCentroid = gesture.centroid;
            this.state.lastDist     = gesture.dist;
            this.state.lastAngle    = gesture.angle;
            return;
        }

        // Single-pointer modes
        this.callback.onMouseMove(screen.x, screen.y);
        switch (this.state.kind) {
            case 'press': {
                const threshhold = this.settings.camera.dragThreshold;
                const threshholdSq = threshhold * threshhold;
                const movedSq = distSq(screen, this.state.downScreen);

                const last = this.state.lastClient;
                this.state.lastClient = { x: e.clientX, y: e.clientY };

                if (movedSq <= threshholdSq) return;
                this.clearLongPress();

                if (this.state.rightClickIntent) {
                    // transition to rotate (after threshold)
                    this.callback.onRotateStart(screen.x, screen.y);
                    this.state = { kind: 'rotate', lastClient: { x: e.clientX, y: e.clientY } };
                    return;
                }

                if (this.state.clickedNodeId) {
                    this.callback.onDragStart(this.state.clickedNodeId, screen.x, screen.y);
                    this.state = {
                        kind: 'drag-node',
                        nodeId: this.state.clickedNodeId,
                        lastClient: { x: e.clientX, y: e.clientY },
                    };
                } else {
                    this.callback.onPanStart(screen.x, screen.y);
                    this.state = { kind: 'pan', lastClient: { x: e.clientX, y: e.clientY } };
                }
                return;
            }

            case 'drag-node':
                this.callback.onDragMove(screen.x, screen.y);
            return;

            case 'pan':
                this.callback.onPanMove(screen.x, screen.y);
            return;

            case 'rotate':
                this.callback.onRotateMove(screen.x, screen.y);
            return;

            default:
            return;
        }
    };


    private onPointerUp = (e: PointerEvent) => {
        e.preventDefault();
        this.clearLongPress();
        try { this.canvas.releasePointerCapture(e.pointerId); } catch {}

        const screen = this.getScreenFromClient(e.clientX, e.clientY);

        this.pointers.delete(e.pointerId);

    if (this.state.kind === 'touch-gesture' && this.pointers.size() < 2) {
//        if (this.state.panStarted) this.callback.onPanEnd();
        if (this.state.rotateStarted) this.callback.onRotateEnd();
        this.state = { kind: 'idle' };
        this.rebaselineRemainingPointerForContinuity();
        return;
    }

        switch (this.state.kind) {
            case 'drag-node':
            this.callback.onDragEnd();
            break;
            case 'pan':
            this.callback.onPanEnd();
            break;
            case 'rotate':
            this.callback.onRotateEnd();
            break;
            case 'press':
                 if (this.state.longPressFired) {
                    break;
                }
                if (this.state.rightClickIntent) {
                    if (this.state.clickedNodeId) this.callback.onFollowStart(this.state.clickedNodeId);
                    else this.callback.resetCamera();
                } else {
                    this.callback.onOpenNode(screen.x, screen.y);
                }
                break;
        }
        this.state = { kind: 'idle' };
    };


    private onPointerCancel = (e: PointerEvent) => {
        e.preventDefault();
        this.clearLongPress();
        this.pointers.delete(e.pointerId);

        // end any active state
        switch (this.state.kind) {
            case 'drag-node':
                this.callback.onDragEnd();
                break;
            case 'pan':
                this.callback.onPanEnd();
                break;
                case 'rotate':
                this.callback.onRotateEnd();
                break;
            case 'touch-gesture':
 //               if (this.state.panStarted) this.callback.onPanEnd();
                if (this.state.rotateStarted) this.callback.onRotateEnd();
                break;
        }

        this.wheel.cancel();     // important: end any wheel pan session
        this.state = { kind: 'idle' };
    };


    private onPointerLeave = () => {
        // Clear hover state when leaving the canvas
        this.callback.onMouseMove(-Infinity, -Infinity);
    };

    // Wheel (mouse wheel + trackpad)
    private onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.wheel.handle(e);
    };

    private endSinglePointerIfNeeded() {
        switch (this.state.kind) {
            case 'drag-node': this.callback.onDragEnd(); break;
            case 'pan': this.callback.onPanEnd(); break;
            case 'rotate': this.callback.onRotateEnd(); break;
        }
        this.state = { kind: 'idle' };
    }

    private rebaselineRemainingPointerForContinuity() {
        const remaining = this.pointers.first();
        if (!remaining) return;
        // you can optionally set lastClient/downScreen here if you want continuation behavior
    }

    public destroy() {
        this.canvas.removeEventListener('pointerdown', this.onPointerDown as any);
        this.canvas.removeEventListener('pointermove', this.onPointerMove as any);
        this.canvas.removeEventListener('pointerup', this.onPointerUp as any);
        this.canvas.removeEventListener('pointercancel', this.onPointerCancel as any);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave as any);
        this.canvas.removeEventListener('wheel', this.onWheel as any);
    }
}
