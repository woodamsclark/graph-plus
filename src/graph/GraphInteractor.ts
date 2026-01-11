import { GraphNode, GraphData } from '../shared/interfaces.ts';
import { GraphDependencies } from './GraphController.ts';
import { CursorCss } from './CursorController.ts';
import type { ScreenPt } from "../shared/interfaces.ts";

export type InteractionState = {
  mouseScreenPosition   : {x:number,y:number}   | null;
  hoveredId     : string                        | null;
  draggedId     : string                        | null;
  followedId    : string                        | null;
  isPanning     : boolean;
  isRotating    : boolean;
};

export class GraphInteractor {
    private dragWorldOffset     : { x: number; y: number; z: number } | null    = null;
    private dragDepthFromCamera : number                                        = 0;
    private pinnedNodes         : Set<string>                                   = new Set();
    private openNodeFile        : ((node: GraphNode) => void)               | null    = null;
    private state               : InteractionState;

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

    public getGravityCenter():ScreenPt | null {
        return this.state.mouseScreenPosition;
    }

    public updateGravityCenter (screenX: number, screenY: number) {
        if (screenX === -Infinity || screenY === -Infinity) {
            this.state.mouseScreenPosition = null; // off screen
        } else {
            this.state.mouseScreenPosition = { x: screenX, y: screenY };
        }
    }


    public startDrag (nodeId: string, screenX: number, screenY: number) {
        this.endFollow();
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
        x: node.location.x - underMouse.x,
        y: node.location.y - underMouse.y,
        z: (node.location.z || 0) - underMouse.z,
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

        node.location.x = underMouse.x + o.x;
        node.location.y = underMouse.y + o.y;
        node.location.z = underMouse.z + o.z;

        // Prevent slingshot on release
        node.velocity.vx = 0; node.velocity.vy = 0; node.velocity.vz = 0;
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
        this.endFollow();
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


    public startRotate (screenX: number, screenY: number) {
        this.state.isRotating = true;
        this.deps.getCamera()?.startRotate(screenX, screenY);
    }

    public updateRotate (screenX: number, screenY: number) {
        this.deps.getCamera()?.updateRotate(screenX, screenY);
    }

    public endRotate () {
        this.state.isRotating = false;
        this.deps.getCamera()?.endRotate();
    }


    public startFollow(nodeId: string) {
        this.state.followedId = nodeId;
        this.updateFollow();
    }


    private updateFollow(): void {
        const id = this.state.followedId;
        if (!id) return;

        const graph  = this.deps.getGraph();
        const camera = this.deps.getCamera();
        if (!graph || !camera) return;

        const node = graph.nodes.find(n => n.id === id);
        if (!node) {
            // Node no longer exists (rebuild, filter, etc.)
            this.state.followedId = null;
            return;
        }

        // Keep camera target glued to the node
        camera.patchState({
            targetX: node.location.x,
            targetY: node.location.y,
            targetZ: node.location.z,
        });
    }

    public endFollow() {
        this.state.followedId = null;
    }

   
    public updateZoom (screenX: number, screenY: number, delta: number) {
        this.deps.getCamera()?.updateZoom(screenX, screenY, delta);
    }


    public openNode(screenX: number, screenY: number) {
        const node = this.getClickedNode(screenX, screenY);
        if (!node) return;

        if (node.type.toLowerCase() === "tag") {
            void this.openTagSearch(node.id);
            return;
        }
        if (node.type.toLowerCase() === "note") {
            if (this.openNodeFile) {
                this.openNodeFile(node);
            }
        }
    }

    private async openTagSearch(tagID: string) {
        const app = this.deps.getApp();
        if (!app) return;

        const query = `tag:#${tagID}`;

        const leaf =
            app.workspace.getLeavesOfType("search")[0] ??
            app.workspace.getRightLeaf(false);

        if (!leaf) return;

        await leaf.setViewState(
            { type: "search", active: true, state: { query } },
            { focus: true }
        );

        app.workspace.revealLeaf(leaf);
    }


    public setOnNodeClick(handler: (node: GraphNode) => void): void {
        this.openNodeFile = handler; 
    }

    private doesIntersectNode(worldX: number, worldY: number, node: GraphNode): boolean {
        const dx = worldX - (node.location.x ?? 0);
        const dy = worldY - (node.location.y ?? 0);
        const r  = node.radius; // world units

        return (dx * dx + dy * dy) <= (r * r);
    }

    public getClickedNode(screenX: number, screenY: number): GraphNode | null {
        const graph  = this.deps.getGraph();
        const camera = this.deps.getCamera();
        if (!graph || !camera) return null;

        let best: GraphNode | null = null;
        let bestDistSq = Infinity;

        for (const node of graph.nodes) {
            const p = camera.worldToScreen(node); // {x,y,depth,scale}

            const dx = screenX - p.x;
            const dy = screenY - p.y;
            const distSq = dx * dx + dy * dy;

            const rWorld = node.radius;
            const rPx = rWorld * p.scale;

            if (distSq <= rPx * rPx && distSq < bestDistSq) {
            bestDistSq = distSq;
            best = node;
            }
        }

    return best;
    }


    public frame(){ // called each frame
        this.updateFollow();
        this.checkIfHovering(); // prepares cursor
    }

    public checkIfHovering() {
        if (!this.state.mouseScreenPosition) {
            this.state.hoveredId = null; 
            return;
        }

        const mouse = this.state.mouseScreenPosition;
        if(!mouse) return;
        
        const hit = this.getClickedNode(mouse.x, mouse.y);
        this.state.hoveredId = hit?.id ?? null;
    }

    public get hoveredNodeId() : string | null {
        return this.state.hoveredId;
    }

    public get followedNodeId() : string | null {
        return this.state.followedId;
    }
}