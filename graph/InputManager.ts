import { InputManagerCallbacks, PointerMode } from '../types/interfaces.ts';

// This class manages user input (mouse events) on the graph canvas
// and reports mouse positions and actions back to the GraphManager via callbacks.
export class InputManager {
    private canvas              : HTMLCanvasElement;
    private callback            : InputManagerCallbacks;
    private draggedNodeId       : string | null     = null;
    private lastClientX         : number            = 0;        // ((Client Space))
    private lastClientY         : number            = 0;        // ((Client Space))
    private downClickX          : number            = 0;        // [[Canvas Space]
    private downClickY          : number            = 0;        // [[Canvas Space]
    private dragThreshold       : number            = 5;        // Drag starts after 5 pixels of movement
    private pointerMode         : PointerMode       = PointerMode.Idle;

    constructor(canvas: HTMLCanvasElement, callbacks: InputManagerCallbacks) {
        this.canvas   = canvas;
        this.callback = callbacks;
        this.attachListeners();
    }

    private attachListeners() {
        // Use document listeners for mousemove/mouseup to allow dragging outside the canvas
        this.canvas.addEventListener('mousedown'    ,   this.onMouseDown        );
        this.canvas.addEventListener('wheel'        ,   this.onWheel            );
        this.canvas.addEventListener('mousemove'    ,   this.onMouseMove        ); // For hover state
        this.canvas.addEventListener('mouseleave'   ,   this.onMouseLeave       ); 
        document.addEventListener   ('mousemove'    ,   this.onGlobalMouseMove  ); // For drag/orbit
        document.addEventListener   ('mouseup'      ,   this.onGlobalMouseUp    ); // For drag/orbit end
    }

    private onMouseDown = (e: MouseEvent) => {
        const canvas        = this.canvas.getBoundingClientRect();
        this.downClickX     = e.clientX - canvas.left;
        this.downClickY     = e.clientY - canvas.top;
        this.lastClientX    = e.clientX;
        this.lastClientY    = e.clientY;
        const isLeft        = e.button === 0;
        const isMiddle      = e.button === 1;
        const isRight       = e.button === 2;
        this.draggedNodeId  = this.callback.detectClickedNode(this.downClickX, this.downClickY)?.id || null;

        // Right Click + drag = Orbit, Right Click no drag = zoom-follow
        if ((isLeft && e.ctrlKey) || (isLeft && e.metaKey) || isRight) {
            this.pointerMode = PointerMode.RightClick;
            return;
        }

        // Left click: either clicking on a node or empty space
        this.pointerMode = PointerMode.Click;
    };
  
    private onGlobalMouseMove = (e: MouseEvent) => {
        const clientX       = e.clientX;
        const clientY       = e.clientY;
        const rect          = this.canvas.getBoundingClientRect();
        const screenX       = clientX - rect.left;
        const screenY       = clientY - rect.top;
        const dx            = clientX - this.lastClientX;
        const dy            = clientY - this.lastClientY;
        this.lastClientX     = clientX;
        this.lastClientY     = clientY;

        const dxScr         = screenX - this.downClickX;
        const dyScr         = screenY - this.downClickY;
        const distSq        = dxScr*dxScr + dyScr*dyScr;
        const thresholdSq   = this.dragThreshold*this.dragThreshold;

        switch (this.pointerMode) {
            case PointerMode.Idle:
            case PointerMode.Hover:
            // Do nothing here. Hover updates happen in canvas mousemove.
            return;
            // ------------------------------------------------------
            case PointerMode.Click:
            // Check for threshold exceed → promote to DragNode or Pan
            if (distSq > thresholdSq) {
                if (this.draggedNodeId != null) {
                this.pointerMode        = PointerMode.DragNode;
                this.callback.onDragStart(this.draggedNodeId, screenX, screenY);
                } else {
                this.pointerMode        = PointerMode.Pan;
                this.callback.onPanStart(screenX, screenY);
                }
            }
            return;// ------------------------------------------------------
            case PointerMode.DragNode:
                this.callback.onDragMove(screenX, screenY);
            return;
            // ------------------------------------------------------
            case PointerMode.Pan:
                this.callback.onPanMove(screenX, screenY);
            return;
            // ------------------------------------------------------
            case PointerMode.RightClick:
                // Check for threshold exceed → promote to DragNode or Pan
                if (distSq > thresholdSq) {
                    this.pointerMode = PointerMode.Orbit;
                    this.callback.onOrbitStart(screenX, screenY);
                } // else on mouse up, we zoom-follow the node
            return;
            case PointerMode.Orbit:
                this.callback.onOrbitMove(screenX, screenY);
            return;
        }
    };

    private onGlobalMouseUp = (e: MouseEvent) => {
        const rect    = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
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
                    this.callback.onFollowStart(this.draggedNodeId!);
                } else { // empty space click
                    // reset camera to center
                    this.callback.resetCamera();
                }
                break;
        }

    this.pointerMode    = PointerMode.Idle;
    this.draggedNodeId  = null;
    };

    private onMouseMove = (e: MouseEvent) => {
        // the not global mouse move is only for hover state
    }

    private onMouseLeave = () => {
        // Clear hover state when leaving the canvas
        // This prevents the graph from thinking the mouse is still over it
        this.callback.onHover(-Infinity, -Infinity); 
    }

    private onWheel = (e: WheelEvent) => {
        // Change this to go to GM
        e.preventDefault();
        this.callback.onZoom(e.offsetX, e.offsetY, Math.sign(e.deltaY));
    }

    public destroy() {
        this.canvas.removeEventListener('mousemove' ,   this.onMouseMove        );
        this.canvas.removeEventListener('mousedown' ,   this.onMouseDown        );
        this.canvas.removeEventListener('wheel'     ,   this.onWheel            );
        this.canvas.removeEventListener('mouseleave',   this.onMouseLeave       );
        document.removeEventListener   ('mousemove' ,   this.onGlobalMouseMove  );
        document.removeEventListener   ('mouseup'   ,   this.onGlobalMouseUp    );
    }
}