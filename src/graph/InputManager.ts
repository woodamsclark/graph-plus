import { ScreenPt, ClientPt } from '../shared/interfaces.ts';
import { TwoFingerGesture } from './TwoFingerGesture.ts';
import { WheelGestureSession } from './WheelGestureSession.ts';
import { PointerTracker } from './PointerTracker.ts';
import { distSq } from '../shared/distSq.ts';
import { wrapAngleDelta } from '../shared/wrapAngleDelta.ts';

type InputState =
  | { kind: 'idle' }
  | {
      kind: 'press';
      downClient: ClientPt;
      downScreen: ScreenPt;
      lastClient: ClientPt;
      clickedNodeId: string | null;
      pointerId: number;
      rightClickIntent: boolean; // “would orbit/follow/reset if released”
    }
  | { kind: 'drag-node'; nodeId: string; lastClient: ClientPt }
  | { kind: 'pan'; lastClient: ClientPt }
  | { kind: 'orbit'; lastClient: ClientPt }
  | {
      kind: 'touch-gesture';
      lastCentroid: ScreenPt;
      lastDist: number;
      lastAngle: number;
      panStarted: boolean;
      orbitStarted: boolean;
    };


export interface InputManagerCallbacks {
    // Camera Control
    onOrbitStart(screenX: number, screenY: number): void;
    onOrbitMove(screenX: number, screenY: number): void;
    onOrbitEnd(): void;

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
    detectClickedNode(
        screenX: number,
        screenY: number,
    ): { id: string; filePath?: string; label: string } | null;
}

export class InputManager {
    private state: InputState = { kind: 'idle' };
    private pointers = new PointerTracker();
    private gesture: TwoFingerGesture;
    private wheel: WheelGestureSession;

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
    }

/*    private getScreenFromClient = (clientX: number, clientY: number): ScreenPt => {
        const rect = this.canvas.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    };
*/
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

    // -----------------------------
    // Pointer events
    // -----------------------------

    private onPointerDown = (e: PointerEvent) => {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        this.pointers.upsert(e);

        const eScreen = this.getScreenFromClient(e.clientX, e.clientY);
        this.callback.onMouseMove(eScreen.x, eScreen.y);

        // If 2 pointers → enter touch gesture state (and end any single-pointer mode cleanly)
        if (this.pointers.size() === 2) {
            this.endSinglePointerIfNeeded();
            const pair = this.pointers.two();
            if (!pair) return;
            const g = this.gesture.read(pair);

            this.state = {
            kind: 'touch-gesture',
            lastCentroid: g.centroid,
            lastDist: g.dist,
            lastAngle: g.angle,
            panStarted: false,
            orbitStarted: false,
            };
            return;
        }

        // Single pointer press
        const isMouse = e.pointerType === 'mouse';
        const isLeft = e.button === 0;
        const isRight = e.button === 2;
        const rightClickIntent = isMouse && ((isLeft && (e.ctrlKey || e.metaKey)) || isRight);

        const clickedNodeId = this.callback.detectClickedNode(eScreen.x, eScreen.y)?.id ?? null;

        this.state = {
            kind: 'press',
            downClient: { x: e.clientX, y: e.clientY },
            downScreen: eScreen,
            lastClient: { x: e.clientX, y: e.clientY },
            clickedNodeId,
            pointerId: e.pointerId,
            rightClickIntent,
        };
    };


    private onPointerMove = (e: PointerEvent) => {
        this.pointers.upsert(e);

        const screen = this.getScreenFromClient(e.clientX, e.clientY);
        this.callback.onMouseMove(screen.x, screen.y);

        // 2-finger gesture
        if (this.state.kind === 'touch-gesture' && this.pointers.size() === 2) {
            e.preventDefault();
            const pair = this.pointers.two();
            if (!pair) return;

            const g = this.gesture.read(pair);

            // Pan start/move
            if (!this.state.panStarted && this.gesture.shouldStartPan(this.state.lastCentroid, g.centroid)) {
            this.state.panStarted = true;
            this.callback.onPanStart(g.centroid.x, g.centroid.y);
            }
            if (this.state.panStarted) this.callback.onPanMove(g.centroid.x, g.centroid.y);

            // Pinch zoom
            const distDelta = g.dist - this.state.lastDist;
            const pinchThreshold = 2;
            if (Math.abs(distDelta) >= pinchThreshold) {
            const dir = distDelta > 0 ? -1 : 1;
            this.callback.onZoom(g.centroid.x, g.centroid.y, dir);
            }

            // Twist orbit
            const dTheta = wrapAngleDelta(g.angle - this.state.lastAngle);
            const twistThreshold = 0.04;
            if (!this.state.orbitStarted && Math.abs(dTheta) > twistThreshold) {
            this.state.orbitStarted = true;
            this.callback.onOrbitStart(g.centroid.x, g.centroid.y);
            }
            if (this.state.orbitStarted) this.callback.onOrbitMove(g.centroid.x, g.centroid.y);

            this.state.lastCentroid = g.centroid;
            this.state.lastDist = g.dist;
            this.state.lastAngle = g.angle;
            return;
        }

        // Single-pointer modes
        switch (this.state.kind) {
            case 'press': {
            const thresholdSq = 5 * 5;
            const movedSq = distSq(screen, this.state.downScreen);

            const last = this.state.lastClient;
            this.state.lastClient = { x: e.clientX, y: e.clientY };

            if (movedSq <= thresholdSq) return;

            if (this.state.rightClickIntent) {
                // transition to orbit (after threshold)
                this.callback.onOrbitStart(screen.x, screen.y);
                this.state = { kind: 'orbit', lastClient: { x: e.clientX, y: e.clientY } };
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

            case 'orbit':
                this.callback.onOrbitMove(screen.x, screen.y);
            return;

            default:
            return;
        }
    };


    private onPointerUp = (e: PointerEvent) => {
        e.preventDefault();
        try { this.canvas.releasePointerCapture(e.pointerId); } catch {}

        const screen = this.getScreenFromClient(e.clientX, e.clientY);

        this.pointers.delete(e.pointerId);

    if (this.state.kind === 'touch-gesture' && this.pointers.size() < 2) {
        if (this.state.panStarted) this.callback.onPanEnd();
        if (this.state.orbitStarted) this.callback.onOrbitEnd();
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
            case 'orbit':
            this.callback.onOrbitEnd();
            break;
            case 'press':
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
        this.pointers.delete(e.pointerId);

        // end any active state
        switch (this.state.kind) {
            case 'drag-node':
            this.callback.onDragEnd();
            break;
            case 'pan':
            this.callback.onPanEnd();
            break;
            case 'orbit':
            this.callback.onOrbitEnd();
            break;
            case 'touch-gesture':
            if (this.state.panStarted) this.callback.onPanEnd();
            if (this.state.orbitStarted) this.callback.onOrbitEnd();
            break;
        }

        this.wheel.cancel();     // important: end any wheel pan session
        this.state = { kind: 'idle' };
    };


    private onPointerLeave = () => {
        // Clear hover state when leaving the canvas
        this.callback.onMouseMove(-Infinity, -Infinity);
    };

    // -----------------------------
    // Wheel (mouse wheel + trackpad)
    // -----------------------------
    private onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.wheel.handle(e);
    };

    private endSinglePointerIfNeeded() {
        switch (this.state.kind) {
            case 'drag-node': this.callback.onDragEnd(); break;
            case 'pan': this.callback.onPanEnd(); break;
            case 'orbit': this.callback.onOrbitEnd(); break;
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
