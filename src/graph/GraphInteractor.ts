import { GraphNode, GraphData } from '../shared/interfaces.ts';
import { GraphDependencies } from './GraphController.ts';
import { CursorCss } from './CursorController.ts';

export type InteractionState = {
  mouseScreenPosition   : {x:number,y:number}   | null;
  hoveredId     : string                        | null;
  draggedId     : string                        | null;
  followedId    : string                        | null;
  isPanning     : boolean;
  isRotating    : boolean;
};

export class GraphInteractor {
    private dragWorldOffset             : { x: number; y: number; z: number } | null  = null;
    private openNodeFile                : ((node: any) => void)               | null  = null;
    private dragDepthFromCamera         : number                                      = 0;
    private pinnedNodes                 : Set<string>                                 = new Set();
    private state                       : InteractionState;

    constructor(private deps: GraphDependencies) {

        this.state  = {
            mouseScreenPosition   : null,
            hoveredId     : null,
            draggedId     : null,
            followedId    : null,
            isPanning     : false,
            isRotating    : false,
        };
    }

    public get cursorType() : CursorCss {
        if (this.state.draggedId || this.state.isPanning || this.state.isRotating) {
            return "grabbing";
        }

        if (this.state.hoveredId) {
            return "pointer";
        }

        return "default";
    }

    public getMouseScreenPosition() {
        return this.state.mouseScreenPosition;
    }

    public updateMouse (screenX: number, screenY: number) {
        if (screenX === -Infinity || screenY === -Infinity) {
            this.state.mouseScreenPosition = null; // off screen
        } else {
            this.state.mouseScreenPosition = { x: screenX, y: screenY };
        }
    }


    public startDrag (nodeId: string, screenX: number, screenY: number) {
        const graph = this.deps.getGraph();
        const camera = this.deps.getCamera();
        if (!graph || !camera) return;

        this.deps.enableMouseGravity(false);

        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Depth from camera so we can unproject mouse onto the same plane in view-space
        const projected           = camera.worldToScreen(node);
        this.dragDepthFromCamera  = Math.max(0.0001, projected.depth);

        // Pin while dragging
        this.state.draggedId = nodeId;
        this.pinnedNodes.add(nodeId);
        this.deps.setPinnedNodes(this.pinnedNodes);

        // World-space offset so we don’t snap the node center to the cursor
        const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
        this.dragWorldOffset = {
        x: node.x - underMouse.x,
        y: node.y - underMouse.y,
        z: (node.z || 0) - underMouse.z,
        };
        return;
    }
 
    public updateDrag (screenX: number, screenY: number) {
        const camera    = this.deps.getCamera();
        const graph     = this.deps.getGraph();
        if (!graph || !camera) return;
        if (!this.state.draggedId) return;

        const node = graph.nodes.find(n => n.id === this.state.draggedId);
        if (!node) return;

        const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
        const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };

        node.x = underMouse.x + o.x;
        node.y = underMouse.y + o.y;
        node.z = underMouse.z + o.z;

        // Prevent slingshot on release
        node.vx = 0; node.vy = 0; node.vz = 0;
        return;
    }

    public endDrag () {
        if (!this.state.draggedId) return;

        this.pinnedNodes.delete(this.state.draggedId);
        this.deps.setPinnedNodes(this.pinnedNodes);

        this.state.draggedId = null;
        this.dragWorldOffset = null;
        this.deps.enableMouseGravity(true);

        return;
    }


    public startPan (screenX: number, screenY: number) {
        this.state.isPanning = true;
        this.deps.getCamera()?.startPan(screenX, screenY);
    } 

    public updatePan (screenX: number, screenY: number) {
        this.deps.getCamera()?.updatePan(screenX, screenY);
    }

    public endPan(){
        this.state.isPanning = false;
        this.deps.getCamera()?.endPan();
    }


    public startOrbit (screenX: number, screenY: number) {
        this.state.isRotating = true;
        this.deps.getCamera()?.startOrbit(screenX, screenY);
    }

    public updateOrbit (screenX: number, screenY: number) {
        this.deps.getCamera()?.updateOrbit(screenX, screenY);
    }

    public endOrbit () {
        this.state.isRotating = false;
        this.deps.getCamera()?.endOrbit();
    }


    public startFollow(nodeId: string) {
        this.state.followedId = nodeId;
    }

    public endFollow() {
        this.state.followedId = null;
    }

   
    public updateZoom (screenX: number, screenY: number, delta: number) {
        this.deps.getCamera()?.updateZoom(screenX, screenY, delta);
    }


    public openNode (screenX: number, screenY: number) {
        const node = this.nodeClicked(screenX, screenY);
        if (node && this.openNodeFile) { 
        this.openNodeFile(node); 
        }
    }

    public setOnNodeClick(handler: (node: any) => void): void {
        this.openNodeFile = handler; 
    }

    public nodeClicked(screenX: number, screenY: number) {
        const graph     = this.deps.getGraph();
        const camera    = this.deps.getCamera()
        if ( !graph || !camera)  return null;

        let closest: GraphNode | null    = null;
        let closestDist     = Infinity;
        const hitPadding    = 0; // extra padding for easier clicking
        //const scale         = this.deps.getCamera() ? this.deps.getCamera().getState().distance : 1;

        for (const node of graph.nodes) {
            const projected         = camera.worldToScreen(node);
            if (!projected) continue;
            const nodeRadius        = node.radius;
            const hitR              = nodeRadius /** Math.max(0.0001, scale)*/ + hitPadding;
            const dx                = screenX - projected.x; 
            const dy                = screenY - projected.y; 
            const distSq            = dx*dx + dy*dy;
                if (distSq <= hitR*hitR && distSq < closestDist) { 
                    closestDist     = distSq;
                    closest         = node;
                }
        }
        return closest;
    }

    public frame(){ // called each frame
        this.checkIfHovering(); // prepares cursor
    }

    public checkIfHovering() {
        if (!this.state.mouseScreenPosition) {
            this.state.hoveredId = null; 
            return;
        }

        const mouse = this.state.mouseScreenPosition;
        if(!mouse) return;
        
        const hit = this.nodeClicked(mouse.x, mouse.y);
        this.state.hoveredId = hit?.id ?? null;
    }

    public get hoveredNodeId() : string | null {
        return this.state.hoveredId;
    }
}