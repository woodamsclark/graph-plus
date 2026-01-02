import { PointerMode } from '../shared/interfaces.ts';

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

type ActivePointer = {
    id: number;
    pointerType: 'mouse' | 'touch' | 'pen';
    clientX: number;
    clientY: number;
    startClientX: number;
    startClientY: number;
    buttons: number;
    button: number;
};

type GestureState = {
    active: boolean;
    startCentroidX: number;
    startCentroidY: number;
    lastCentroidX: number;
    lastCentroidY: number;
    startDist: number;
    lastDist: number;
    startAngle: number;
    lastAngle: number;
    panStarted: boolean;
    orbitStarted: boolean;
};

export class InputManager {
    private canvas: HTMLCanvasElement;
    private callback: InputManagerCallbacks;

    private draggedNodeId: string | null = null;

    private lastClientX: number = 0; // (( Client Space ))
    private lastClientY: number = 0; // (( Client Space ))

    private downClickX: number = 0; // [[ Canvas Space ]]
    private downClickY: number = 0; // [[ Canvas Space ]]

    private dragThreshold: number = 5;
    private pointerMode: PointerMode = PointerMode.Idle;

    private pointers = new Map<number, ActivePointer>();
        

    private wheelGestureMode: 'pan' | 'zoom' | null = null;
    private wheelGestureEndTimer: number | null = null;
    private wheelPanning: boolean = false;
    private wheelPanX: number = 0;
    private wheelPanY: number = 0;
    private wheelPanEndTimer: number | null = null;

    private gesture: GestureState = {
        active: false,
        startCentroidX: 0,
        startCentroidY: 0,
        lastCentroidX: 0,
        lastCentroidY: 0,
        startDist: 0,
        lastDist: 0,
        startAngle: 0,
        lastAngle: 0,
        panStarted: false,
        orbitStarted: false,
    };

    constructor(canvas: HTMLCanvasElement, callbacks: InputManagerCallbacks) {
        this.canvas = canvas;
        this.callback = callbacks;

        // Critical: allow us to handle touch gestures ourselves.
        // Without this, browser may scroll/zoom the page instead.
        this.canvas.style.touchAction = 'none';

        this.attachListeners();
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

    // -----------------------------
    // Helpers
    // -----------------------------

    private getScreenXYFromClient(clientX: number, clientY: number) {
        const rect = this.canvas.getBoundingClientRect();
        return { screenX: clientX - rect.left, screenY: clientY - rect.top };
    }

    private setPointerRecord(e: PointerEvent) {
        const pointerType =
        (e.pointerType === 'touch' || e.pointerType === 'pen' || e.pointerType === 'mouse'
            ? e.pointerType
            : 'mouse') as ActivePointer['pointerType'];

        const existing = this.pointers.get(e.pointerId);

        const record: ActivePointer = existing ?? {
        id: e.pointerId,
        pointerType,
        clientX: e.clientX,
        clientY: e.clientY,
        startClientX: e.clientX,
        startClientY: e.clientY,
        buttons: e.buttons,
        button: e.button,
        };

        record.clientX = e.clientX;
        record.clientY = e.clientY;
        record.buttons = e.buttons;
        record.button = e.button;

        this.pointers.set(e.pointerId, record);
    }

    private getTwoPointers(): [ActivePointer, ActivePointer] | null {
        if (this.pointers.size !== 2) return null;
        const arr = Array.from(this.pointers.values());
        return [arr[0], arr[1]];
    }

    private computeGestureFromTwoPointers() {
        const pair = this.getTwoPointers();
        if (!pair) return null;

        const [a, b] = pair;
        const A = this.getScreenXYFromClient(a.clientX, a.clientY);
        const B = this.getScreenXYFromClient(b.clientX, b.clientY);

        const centroidX = (A.screenX + B.screenX) * 0.5;
        const centroidY = (A.screenY + B.screenY) * 0.5;

        const dx = B.screenX - A.screenX;
        const dy = B.screenY - A.screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        return { centroidX, centroidY, dist, angle };
    }

    private wrapAngleDelta(d: number) {
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }

    // -----------------------------
    // Pointer events
    // -----------------------------

    private onPointerDown = (e: PointerEvent) => {
        e.preventDefault();

        // Capture means we keep receiving move/up even if pointer leaves canvas
        this.canvas.setPointerCapture(e.pointerId);

        this.setPointerRecord(e);

        // Hover reporting (useful even for touch/pen, won't hurt)
        const { screenX, screenY } = this.getScreenXYFromClient(e.clientX, e.clientY);
        this.callback.onMouseMove(screenX, screenY);

        // If we now have 2 pointers, start a gesture immediately
        if (this.pointers.size === 2) {
        // Cancel any single-pointer mode cleanly
        if (this.pointerMode === PointerMode.DragNode) this.callback.onDragEnd();
        if (this.pointerMode === PointerMode.Pan) this.callback.onPanEnd();
        if (this.pointerMode === PointerMode.Orbit) this.callback.onOrbitEnd();

        this.pointerMode = PointerMode.Idle;
        this.draggedNodeId = null;

        const g = this.computeGestureFromTwoPointers();
        if (!g) return;

        this.gesture.active = true;
        this.gesture.startCentroidX = g.centroidX;
        this.gesture.startCentroidY = g.centroidY;
        this.gesture.lastCentroidX = g.centroidX;
        this.gesture.lastCentroidY = g.centroidY;
        this.gesture.startDist = g.dist;
        this.gesture.lastDist = g.dist;
        this.gesture.startAngle = g.angle;
        this.gesture.lastAngle = g.angle;
        this.gesture.panStarted = false;
        this.gesture.orbitStarted = false;
        return;
        }

        // Single-pointer setup
        const rect = this.canvas.getBoundingClientRect();
        this.downClickX = e.clientX - rect.left;
        this.downClickY = e.clientY - rect.top;

        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        const isMouse = e.pointerType === 'mouse';
        const isLeft = e.button === 0;
        const isRight = e.button === 2;

        this.draggedNodeId = this.callback.detectClickedNode(this.downClickX, this.downClickY)?.id || null;

        // Preserve your right-click / ctrl-meta behavior, but only for mouse/pen-like contexts.
        // Touch has no right button; touch orbit handled by 2-finger twist below.
        if (isMouse && ((isLeft && (e.ctrlKey || e.metaKey)) || isRight)) {
        this.pointerMode = PointerMode.RightClick;
        return;
        }

        // Touch/pen/mouse primary = click -> maybe drag
        this.pointerMode = PointerMode.Click;
    };

    private onPointerMove = (e: PointerEvent) => {
        this.setPointerRecord(e);

        // Always update hover position relative to canvas (your highlighting + gravity)
        const { screenX, screenY } = this.getScreenXYFromClient(e.clientX, e.clientY);
        this.callback.onMouseMove(screenX, screenY);

        // Two-pointer gesture path
        if (this.gesture.active && this.pointers.size === 2) {
        e.preventDefault();

        const g = this.computeGestureFromTwoPointers();
        if (!g) return;

        const dxC = g.centroidX - this.gesture.lastCentroidX;
        const dyC = g.centroidY - this.gesture.lastCentroidY;
        const movedCentroidSq = dxC * dxC + dyC * dyC;

        // Pan: start once movement exceeds threshold
        const thresholdSq = this.dragThreshold * this.dragThreshold;
        if (!this.gesture.panStarted && movedCentroidSq > thresholdSq) {
            this.gesture.panStarted = true;
            this.callback.onPanStart(g.centroidX, g.centroidY);
        }
        if (this.gesture.panStarted) {
            this.callback.onPanMove(g.centroidX, g.centroidY);
        }

        // Pinch zoom: convert dist change into +/- zoom steps
        // Your zoom callback expects delta sign. We'll emit discrete steps.
        const distDelta = g.dist - this.gesture.lastDist;
        const pinchThreshold = 2; // px; tune
        if (Math.abs(distDelta) >= pinchThreshold) {
            const dir = distDelta > 0 ? -1 : 1; // expanding fingers usually means zoom IN; your sign might be inverted
            this.callback.onZoom(g.centroidX, g.centroidY, dir);
        }

        // Optional: two-finger twist -> orbit
        const dTheta = this.wrapAngleDelta(g.angle - this.gesture.lastAngle);
        const twistThreshold = 0.04; // radians; tune
        if (!this.gesture.orbitStarted && Math.abs(dTheta) > twistThreshold) {
            this.gesture.orbitStarted = true;
            this.callback.onOrbitStart(g.centroidX, g.centroidY);
        }
        if (this.gesture.orbitStarted) {
            // We don't have a “rotate by delta” callback; your orbit uses positions.
            // Feeding centroid works well: the camera controller can interpret movement.
            this.callback.onOrbitMove(g.centroidX, g.centroidY);
        }

        this.gesture.lastCentroidX = g.centroidX;
        this.gesture.lastCentroidY = g.centroidY;
        this.gesture.lastDist = g.dist;
        this.gesture.lastAngle = g.angle;
        return;
        }

        // Single-pointer path (basically your old onGlobalMouseMove logic, but capture makes it local)
        const clientX = e.clientX;
        const clientY = e.clientY;

        const dx = clientX - this.lastClientX;
        const dy = clientY - this.lastClientY;
        this.lastClientX = clientX;
        this.lastClientY = clientY;

        const dxScr = screenX - this.downClickX;
        const dyScr = screenY - this.downClickY;
        const distSq = dxScr * dxScr + dyScr * dyScr;
        const thresholdSq = this.dragThreshold * this.dragThreshold;

        switch (this.pointerMode) {
        case PointerMode.Idle:
        case PointerMode.Hover:
            return;

        case PointerMode.Click:
            if (distSq > thresholdSq) {
            if (this.draggedNodeId != null) {
                this.pointerMode = PointerMode.DragNode;
                this.callback.onDragStart(this.draggedNodeId, screenX, screenY);
            } else {
                this.pointerMode = PointerMode.Pan;
                this.callback.onPanStart(screenX, screenY);
            }
            }
            return;

        case PointerMode.DragNode:
            this.callback.onDragMove(screenX, screenY);
            return;

        case PointerMode.Pan:
            this.callback.onPanMove(screenX, screenY);
            return;

        case PointerMode.RightClick:
            if (distSq > thresholdSq) {
            this.pointerMode = PointerMode.Orbit;
            this.callback.onOrbitStart(screenX, screenY);
            }
            return;

        case PointerMode.Orbit:
            this.callback.onOrbitMove(screenX, screenY);
            return;
        }
    };

    private onPointerUp = (e: PointerEvent) => {
        e.preventDefault();

        // Release capture
        try {
        this.canvas.releasePointerCapture(e.pointerId);
        } catch {
        // ignore (can throw if not captured)
        }

        const { screenX, screenY } = this.getScreenXYFromClient(e.clientX, e.clientY);

        const wasTwoPointer = this.gesture.active;

        // Remove pointer from map first
        this.pointers.delete(e.pointerId);

        // End gesture if we dropped below 2 pointers
        if (wasTwoPointer && this.pointers.size < 2) {
        if (this.gesture.panStarted) this.callback.onPanEnd();
        if (this.gesture.orbitStarted) this.callback.onOrbitEnd();

        this.gesture.active = false;
        this.gesture.panStarted = false;
        this.gesture.orbitStarted = false;

        // Re-baseline remaining pointer so single-finger continuing doesn't jump
        const remaining = Array.from(this.pointers.values())[0];
        if (remaining) {
            remaining.startClientX = remaining.clientX;
            remaining.startClientY = remaining.clientY;
            this.lastClientX = remaining.clientX;
            this.lastClientY = remaining.clientY;

            const pxy = this.getScreenXYFromClient(remaining.clientX, remaining.clientY);
            this.downClickX = pxy.screenX;
            this.downClickY = pxy.screenY;
        }

        this.pointerMode = PointerMode.Idle;
        this.draggedNodeId = null;
        return;
        }

        // Single-pointer finalize (your old onGlobalMouseUp)
        switch (this.pointerMode) {
        case PointerMode.DragNode:
            this.callback.onDragEnd();
            break;

        case PointerMode.Pan:
            this.callback.onPanEnd();
            break;

        case PointerMode.Orbit:
            this.callback.onOrbitEnd();
            break;

        case PointerMode.Click:
            this.callback.onOpenNode(screenX, screenY);
            break;

        case PointerMode.RightClick:
            if (this.draggedNodeId != null) {
            this.callback.onFollowStart(this.draggedNodeId);
            } else {
            this.callback.resetCamera();
            }
            break;
        }

        this.pointerMode = PointerMode.Idle;
        this.draggedNodeId = null;
    };

    private onPointerCancel = (e: PointerEvent) => {
        e.preventDefault();

        this.pointers.delete(e.pointerId);

        // Cancel any active modes cleanly
        if (this.pointerMode === PointerMode.DragNode) this.callback.onDragEnd();
        if (this.pointerMode === PointerMode.Pan) this.callback.onPanEnd();
        if (this.pointerMode === PointerMode.Orbit) this.callback.onOrbitEnd();

        if (this.gesture.active) {
        if (this.gesture.panStarted) this.callback.onPanEnd();
        if (this.gesture.orbitStarted) this.callback.onOrbitEnd();
        }

        this.gesture.active = false;
        this.gesture.panStarted = false;
        this.gesture.orbitStarted = false;

        this.pointerMode = PointerMode.Idle;
        this.draggedNodeId = null;
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

        const x = e.offsetX;
        const y = e.offsetY;

        // (1) Start / continue a wheel gesture session
        // If this is the first wheel event of a gesture, decide mode ONCE.
        if (this.wheelGestureMode == null) {
            // Decide mode based on modifiers at gesture START only
            this.wheelGestureMode = (e.ctrlKey || e.metaKey) ? 'zoom' : 'pan';

            // If we’re entering pan mode, start a pan session
            if (this.wheelGestureMode === 'pan') {
            this.wheelPanning = true;
            this.wheelPanX = x;
            this.wheelPanY = y;
            this.callback.onPanStart(this.wheelPanX, this.wheelPanY);
            }
        }

        // (2) Execute locked mode
        if (this.wheelGestureMode === 'zoom') {
            // Zoom uses the current pointer position
            this.callback.onZoom(x, y, Math.sign(e.deltaY));
        } else {
            // Pan: move a virtual cursor by wheel deltas
            // If direction feels backwards, flip signs.
            this.wheelPanX -= e.deltaX;
            this.wheelPanY -= e.deltaY;

            this.callback.onPanMove(this.wheelPanX, this.wheelPanY);
        }

        // (3) End gesture after inactivity; only then allow mode changes
        if (this.wheelGestureEndTimer != null) window.clearTimeout(this.wheelGestureEndTimer);
        this.wheelGestureEndTimer = window.setTimeout(() => {
            if (this.wheelGestureMode === 'pan' && this.wheelPanning) {
            this.callback.onPanEnd();
            }

            this.wheelPanning = false;
            this.wheelGestureMode = null;

            this.wheelGestureEndTimer = null;
        }, 120);
    };



    public destroy() {
        this.canvas.removeEventListener('pointerdown', this.onPointerDown as any);
        this.canvas.removeEventListener('pointermove', this.onPointerMove as any);
        this.canvas.removeEventListener('pointerup', this.onPointerUp as any);
        this.canvas.removeEventListener('pointercancel', this.onPointerCancel as any);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave as any);
        this.canvas.removeEventListener('wheel', this.onWheel as any);
        if (this.wheelPanEndTimer != null) {
            window.clearTimeout(this.wheelPanEndTimer);
            this.wheelPanEndTimer = null;
        }
    }
}