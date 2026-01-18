import type { Node } from "../../shared/interfaces.ts";
import type { GraphDependencies } from "./GraphDirector.ts";
import type { CursorCss } from "./input/CursorController.ts";
import type { ScreenPt } from "../../shared/interfaces.ts";
import type { InteractionState } from "../../space/interaction/InteractionState.ts";



export class GraphInteractor {
  private dragWorldOffset: { x: number; y: number; z: number } | null = null;
  private dragDepthFromCamera: number = 0;

  private pinnedNodes: Set<string> = new Set();
  private openNodeFile: ((node: Node) => void) | null = null;

  // Single source of truth for interaction output
  private state: InteractionState = {
    gravityCenter   : null,
    hoveredNodeId   : null,
    followedNodeId  : null,
    draggedId       : null,
    draggedNodeId   : null,
    isPanning       : false,
    isRotating      : false,
  };

  constructor(private deps: GraphDependencies) {}

  public getState(): Readonly<InteractionState> {
    return this.state;
  }

  public get cursorType(): CursorCss {
    if (this.state.draggedId || this.state.isPanning || this.state.isRotating) return "grabbing";
    if (this.state.hoveredNodeId) return "pointer";
    return "default";
  }

  // Back-compat (keep for now; later you can delete these and read getState())
  public getGravityCenter(): ScreenPt | null {
    return this.state.gravityCenter;
  }
  public get hoveredNodeId(): string | null {
    return this.state.hoveredNodeId;
  }
  public get followedNodeId(): string | null {
    return this.state.followedNodeId;
  }

  public updateGravityCenter(screenX: number, screenY: number) {
    if (screenX === -Infinity || screenY === -Infinity) {
      this.state.gravityCenter = null; // off screen
    } else {
      this.state.gravityCenter = { x: screenX, y: screenY };
    }
  }

  public startDrag(nodeId: string, screenX: number, screenY: number) {
    this.endFollow();

    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) return;

    this.deps.enableMouseGravity(false);

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const projected = camera.worldToScreen(node);
    this.dragDepthFromCamera = Math.max(0.0001, projected.depth);

    this.state.draggedId = nodeId;
    this.pinnedNodes.add(nodeId);
    this.deps.setPinnedNodes(this.pinnedNodes);

    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    this.dragWorldOffset = {
      x: node.location.x - underMouse.x,
      y: node.location.y - underMouse.y,
      z: (node.location.z || 0) - underMouse.z,
    };
  }

  public updateDrag(screenX: number, screenY: number) {
    const camera = this.deps.getCamera();
    const graph = this.deps.getGraph();
    if (!graph || !camera) return;

    const draggedId = this.state.draggedId;
    if (!draggedId) return;

    const node = graph.nodes.find(n => n.id === draggedId);
    if (!node) return;

    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };

    node.location.x = underMouse.x + o.x;
    node.location.y = underMouse.y + o.y;
    node.location.z = underMouse.z + o.z;

    node.velocity.vx = 0; node.velocity.vy = 0; node.velocity.vz = 0;
  }

  public endDrag() {
    const draggedId = this.state.draggedId;
    if (!draggedId) return;

    this.pinnedNodes.delete(draggedId);
    this.deps.setPinnedNodes(this.pinnedNodes);

    this.state.draggedId = null;
    this.dragWorldOffset = null;

    this.deps.enableMouseGravity(true);
  }

  public startPan(screenX: number, screenY: number) {
    this.endFollow();
    this.state.isPanning = true;
    this.deps.getCamera()?.startPan(screenX, screenY);
  }

  public updatePan(screenX: number, screenY: number) {
    this.deps.getCamera()?.updatePan(screenX, screenY);
  }

  public endPan() {
    this.state.isPanning = false;
    this.deps.getCamera()?.endPan();
  }

  public startRotate(screenX: number, screenY: number) {
    this.state.isRotating = true;
    this.deps.getCamera()?.startRotate(screenX, screenY);
  }

  public updateRotate(screenX: number, screenY: number) {
    this.deps.getCamera()?.updateRotate(screenX, screenY);
  }

  public endRotate() {
    this.state.isRotating = false;
    this.deps.getCamera()?.endRotate();
  }

  public startFollow(nodeId: string) {
    this.state.followedNodeId = nodeId;
    this.updateFollow();
  }

  private updateFollow(): void {
    const id = this.state.followedNodeId;
    if (!id) return;

    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) return;

    const node = graph.nodes.find(n => n.id === id);
    if (!node) {
      this.state.followedNodeId = null;
      return;
    }

    camera.patchState({
      targetX: node.location.x,
      targetY: node.location.y,
      targetZ: node.location.z,
    });
  }

  public endFollow() {
    this.state.followedNodeId = null;
  }

  public updateZoom(screenX: number, screenY: number, delta: number) {
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
      this.openNodeFile?.(node);
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

  public setOnNodeClick(handler: (node: Node) => void): void {
    this.openNodeFile = handler;
  }

  public getClickedNode(screenX: number, screenY: number): Node | null {
    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) return null;

    let best: Node | null = null;
    let bestDistSq = Infinity;

    for (const node of graph.nodes) {
      const p = camera.worldToScreen(node);

      const dx = screenX - p.x;
      const dy = screenY - p.y;
      const distSq = dx * dx + dy * dy;

      const rPx = node.radius * p.scale;

      if (distSq <= rPx * rPx && distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }

    return best;
  }

  /** Called each frame by whoever owns Time */
  public frame() {
    this.updateFollow();
    this.checkIfHovering();
  }

  private checkIfHovering() {
    const mouse = this.state.gravityCenter;
    if (!mouse) {
      this.state.hoveredNodeId = null;
      return;
    }

    const hit = this.getClickedNode(mouse.x, mouse.y);
    this.state.hoveredNodeId = hit?.id ?? null;
  }
}
