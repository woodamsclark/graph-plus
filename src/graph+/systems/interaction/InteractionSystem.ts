import type { Node, GraphData, Tickable, InteractionSystem, InteractionEvent, InteractionState, InputEvent } from "../../grammar/interfaces.ts";
import type { CameraController } from "../CameraController.ts"; // adjust path to wherever CameraController lives
import type { CursorCss } from "./input/cursor_selector.ts";   // adjust path
import { InputManager } from "../../systems/interaction/input/InputManager.ts";
import { InputBuffer } from "../../systems/interaction/input/InputBuffer.ts";


export type InteractionDeps = {
  getGraph: () => GraphData | null;
  getCamera: () => CameraController | null;
  getCanvas: () => HTMLCanvasElement;
};

export class Interaction implements InteractionSystem {
  private dragWorldOffset: { x: number; y: number; z: number } | null = null;
  private dragDepthFromCamera = 0;

  private pinnedNodes: Set<string> = new Set();
  private events: InteractionEvent[] = [];

  private state: InteractionState = {
    gravityCenter : null,
    hoveredNodeId : null,
    followedNodeId: null,
    draggedNodeId : null,
    isPanning     : false,
    isRotating    : false,
  };
  private input: InputManager;
  private inputBuffer: InputBuffer;


  constructor(private deps: InteractionDeps) {
    this.inputBuffer = new InputBuffer();

    this.input = new InputManager(deps.getCanvas(), {
      onRotateStart: (x, y) => this.inputBuffer.push({ type: "ROTATE_START", x, y }),
      onRotateMove:  (x, y) => this.inputBuffer.push({ type: "ROTATE_MOVE", x, y }),
      onRotateEnd:   ()     => this.inputBuffer.push({ type: "ROTATE_END" }),

      onPanStart:    (x, y) => this.inputBuffer.push({ type: "PAN_START", x, y }),
      onPanMove:     (x, y) => this.inputBuffer.push({ type: "PAN_MOVE", x, y }),
      onPanEnd:      ()     => this.inputBuffer.push({ type: "PAN_END" }),

      onOpenNode:    (x, y) => this.inputBuffer.push({ type: "OPEN_NODE", x, y }),
      onMouseMove:   (x, y) => this.inputBuffer.push({ type: "MOUSE_MOVE", x, y }),

      onDragStart:   (id, x, y) => this.inputBuffer.push({ type: "DRAG_START", nodeId: id, x, y }),
      onDragMove:    (x, y)     => this.inputBuffer.push({ type: "DRAG_MOVE", x, y }),
      onDragEnd:     ()         => this.inputBuffer.push({ type: "DRAG_END" }),

      // IMPORTANT: use delta field name consistently
      onZoom:        (x, y, d)  => this.inputBuffer.push({ type: "ZOOM", x, y, delta: d }),

      onFollowStart: (id)       => this.inputBuffer.push({ type: "FOLLOW_START", nodeId: id }),
      onFollowEnd:   ()         => this.inputBuffer.push({ type: "FOLLOW_END" }),

      resetCamera:   ()         => this.inputBuffer.push({ type: "RESET_CAMERA" }),

      getClickedNode:(x, y)     => this.getClickedNodeIdLabel(x, y),
    });

  }

  public ingest(events: InputEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case "MOUSE_MOVE":
          this.updateGravityCenter(e.x, e.y);
          break;

        case "OPEN_NODE":
          this.openNode(e.x, e.y);
          break;

        case "DRAG_START":
          this.startDrag(e.nodeId, e.x, e.y);
          break;

        case "DRAG_MOVE":
          this.updateDrag(e.x, e.y);
          break;

        case "DRAG_END":
          this.endDrag();
          break;

        case "PAN_START":
          this.startPan(e.x, e.y);
          break;

        case "PAN_MOVE":
          this.updatePan(e.x, e.y);
          break;

        case "PAN_END":
          this.endPan();
          break;

        case "ROTATE_START":
          this.startRotate(e.x, e.y);
          break;

        case "ROTATE_MOVE":
          this.updateRotate(e.x, e.y);
          break;

        case "ROTATE_END":
          this.endRotate();
          break;

        case "ZOOM":
          this.updateZoom(e.x, e.y, e.delta);
          break;

        case "FOLLOW_START":
          this.startFollow(e.nodeId);
          break;

        case "FOLLOW_END":
          this.endFollow();
          break;

        case "RESET_CAMERA":
          this.deps.getCamera()?.resetCamera();
          break;
      }
    }
  }

   /** Orchestrator drains these and routes to adapters/systems */
  public drainEvents(): InteractionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Derived presentation detail (not stored in state)
  getCursorType(): CursorCss {
    if (this.state.draggedNodeId || this.state.isPanning || this.state.isRotating) return "grabbing";
    if (this.state.hoveredNodeId) return "pointer";
    return "default";
  }

  // --- Outputs ---------------------------------------------------------------

  public getState(): Readonly<InteractionState> {
    return this.state;
  }

  private emit(e: InteractionEvent): void {
    this.events.push(e);
  }

  private emitPinned(): void {
    // new Set so downstream can’t mutate our internal Set by reference
    this.emit({ type: "PINNED_SET", ids: new Set(this.pinnedNodes) });
  }

  // --- Input entry points (called by InputManager) ---------------------------

  public updateGravityCenter(screenX: number, screenY: number) {
    if (screenX === -Infinity || screenY === -Infinity) {
      this.state.gravityCenter = null;
    } else {
      this.state.gravityCenter = { x: screenX, y: screenY };
    }
  }

  public startDrag(nodeId: string, screenX: number, screenY: number) {
    this.endFollow();

    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) return;

    // mouse gravity off while dragging
    this.emit({ type: "MOUSE_GRAVITY_SET", on: false });

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const projected = camera.worldToScreen(node);
    this.dragDepthFromCamera = Math.max(0.0001, projected.depth);

    this.state.draggedNodeId = nodeId;
    this.pinnedNodes.add(nodeId);
    this.emitPinned();

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

    const draggedId = this.state.draggedNodeId;
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
    const draggedId = this.state.draggedNodeId;
    if (!draggedId) return;

    this.pinnedNodes.delete(draggedId);
    this.emitPinned();

    this.state.draggedNodeId = null;
    this.dragWorldOffset = null;

    // mouse gravity back on after drag
    this.emit({ type: "MOUSE_GRAVITY_SET", on: true });
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

  public endFollow() {
    this.state.followedNodeId = null;
  }

  public updateZoom(screenX: number, screenY: number, delta: number) {
    this.deps.getCamera()?.updateZoom(screenX, screenY, delta);
  }

  public openNode(screenX: number, screenY: number) {
    const node = this.getClickedNode(screenX, screenY);
    if (!node) return;

    // No Obsidian calls here. Emit intent.
    this.emit({ type: "OPEN_NODE_REQUESTED", node });
  }

  // --- Tick / per-frame ------------------------------------------------------
  public tick(_dt: number, _nowMs: number): void {
    // 1) consume raw input events for this frame
    const batch = this.inputBuffer.drain();
    this.ingest(batch);

    // 2) per-frame derived behavior
    this.updateFollow();
    this.checkIfHovering();

  }

  // --- Internals -------------------------------------------------------------

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

  private checkIfHovering() {
    const mouse = this.state.gravityCenter;
    if (!mouse) {
      this.state.hoveredNodeId = null;
      return;
    }

    const hit = this.getClickedNode(mouse.x, mouse.y);
    this.state.hoveredNodeId = hit?.id ?? null;
  }

  public getClickedNodeIdLabel(screenX: number, screenY: number): { id: string; label: string } | null {
    const node = this.getClickedNode(screenX, screenY);
    if (!node) return null;
    return { id: node.id, label: node.label };
  }

  private getClickedNode(screenX: number, screenY: number): Node | null {
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
  public destroy(): void {
    this.input.destroy();
    // optional: this.inputBuffer.clear();
  }
}
