import type {
  Node,
  GraphData,
  InteractionSystem,
  InteractionEvent,
  InteractionState,
  InputEvent,
} from "../../grammar/interfaces.ts";

import type { CameraController } from "../CameraController.ts";
import type { CursorCss } from "./input/cursor_selector.ts";

import { InputManager } from "../../systems/interaction/input/InputManager.ts";
import { InputBuffer } from "../../systems/interaction/input/InputBuffer.ts";
import { getSettings } from "../../../obsidian/settings/settingsStore.ts";

type InteractionDeps = {
  getGraph: () => GraphData | null;
  getCamera: () => CameraController | null;
  getCanvas: () => HTMLCanvasElement;
};

type PressMode = {
  kind: "press";
  pointerId: number;
  downScreen: { x: number; y: number };
  downTimeMs: number;
  downNode: { id: string; label: string } | null;
  rightIntent: boolean;
  longPressFired: boolean;
};

type Mode =
  | { kind: "idle" }
  | PressMode
  | { kind: "drag-node"; pointerId: number; nodeId: string }
  | { kind: "pan"; pointerId: number }
  | { kind: "rotate"; pointerId: number }
  | {
      kind: "touch-gesture";
      pointerA: number;
      pointerB: number;
      lastCentroid: { x: number; y: number };
      lastDist: number;
      lastAngle: number;
      rotateStarted: boolean;
    };

type PointerRec = { id: number; kind: "mouse" | "touch" | "pen"; x: number; y: number };

function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// Wrap angle delta into [-PI, PI] for stable twist detection
function wrapAngleDelta(d: number): number {
  const pi = Math.PI;
  while (d > pi) d -= 2 * pi;
  while (d < -pi) d += 2 * pi;
  return d;
}

function twoFingerRead(a: PointerRec, b: PointerRec) {
  const cx = (a.x + b.x) * 0.5;
  const cy = (a.y + b.y) * 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  return { centroid: { x: cx, y: cy }, dist, angle };
}

export class Interaction implements InteractionSystem {
  private inputBuffer: InputBuffer;
  private input: InputManager;

  private mode: Mode = { kind: "idle" };

  private pointers = new Map<number, PointerRec>();

  private dragWorldOffset: { x: number; y: number; z: number } | null = null;
  private dragDepthFromCamera = 0;

  private pinnedNodes: Set<string> = new Set();
  private events: InteractionEvent[] = [];

  private lastClick: { nodeId: string; timeMs: number } | null = null;

  private state: InteractionState = {
    gravityCenter: null,
    hoveredNodeId: null,
    followedNodeId: null,
    draggedNodeId: null,
    isPanning: false,
    isRotating: false,
  };

  private settings = getSettings();

  constructor(private deps: InteractionDeps) {
    this.inputBuffer = new InputBuffer();

    // InputManager is now a pure emitter into inputBuffer
    this.input = new InputManager(
      deps.getCanvas(),
      this.inputBuffer,
      () => getSettings(),
    );
  }

  // Orchestrator can call this if you want, but tick() already drains buffer.
  public ingest(events: InputEvent[]): void {
    for (const e of events) this.ingestOne(e);
  }

  /** Orchestrator drains these and routes to adapters/systems */
  public drainEvents(): InteractionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  public getState(): Readonly<InteractionState> {
    return this.state;
  }

  public getCursorType(): CursorCss {
    if (this.state.draggedNodeId || this.state.isPanning || this.state.isRotating) return "grabbing";
    if (this.state.hoveredNodeId) return "pointer";
    return "default";
  }

  public tick(_dt: number, _nowMs: number): void {
    this.settings = getSettings();

    // 1) consume raw input events for this frame
    const batch = this.inputBuffer.drain();
    this.ingest(batch);

    // 2) per-frame derived behavior
    this.updateFollow();
    this.updateHover();
  }

  public destroy(): void {
    this.input.destroy();
    // optional: this.inputBuffer.clear();
  }

  // ----------------------------------------------------------------------------
  // Raw input ingestion (facts only)
  // ----------------------------------------------------------------------------

  private ingestOne(e: InputEvent): void {
    switch (e.type) {
      case "POINTER_DOWN":
        this.onPointerDown(e);
        return;
      case "POINTER_MOVE":
        this.onPointerMove(e);
        return;
      case "POINTER_UP":
        this.onPointerUp(e);
        return;
      case "POINTER_CANCEL":
        this.onPointerCancel(e);
        return;
      case "WHEEL":
        this.onWheel(e);
        return;
      case "LONG_PRESS":
        this.onLongPress(e);
        return;
      default:
        return;
    }
  }

  private onPointerDown(e: Extract<InputEvent, { type: "POINTER_DOWN" }>) {
    this.upsertPointer(e.pointerId, e.kind, e.screen.x, e.screen.y);

    // If 2 pointers are down, enter touch gesture mode (and end any single-pointer mode)
    if (this.pointers.size === 2) {
      this.endSinglePointerModeIfNeeded();

      const [a, b] = this.firstTwoPointers();
      if (!a || !b) return;

      const g = twoFingerRead(a, b);

      this.mode = {
        kind: "touch-gesture",
        pointerA: a.id,
        pointerB: b.id,
        lastCentroid: g.centroid,
        lastDist: g.dist,
        lastAngle: g.angle,
        rotateStarted: false,
      };

      // Optionally set gravity center to centroid for hover semantics
      this.state.gravityCenter = { x: g.centroid.x, y: g.centroid.y };
      return;
    }

    // Single pointer press state
    const isMouse = e.kind === "mouse";
    const isLeft = e.button === 0;
    const isRight = e.button === 2;

    // "right intent" definition lives here (semantic)
    const rightIntent = isMouse && ((isLeft && (e.ctrl || e.meta)) || isRight);

    const downHit = this.getClickedNodeIdLabel(e.screen.x, e.screen.y);

    this.mode = {
      kind: "press",
      pointerId: e.pointerId,
      downScreen: { x: e.screen.x, y: e.screen.y },
      downTimeMs: e.timeMs,
      downNode: downHit,
      rightIntent,
      longPressFired: false,
    };

    // update gravity center for hover/mouse gravity
    this.state.gravityCenter = { x: e.screen.x, y: e.screen.y };
  }

  private onPointerMove(e: Extract<InputEvent, { type: "POINTER_MOVE" }>) {
    this.upsertPointer(e.pointerId, e.kind, e.screen.x, e.screen.y);

    // Update gravity center always for hover and mouse gravity
    this.state.gravityCenter = { x: e.screen.x, y: e.screen.y };

    // Two-finger gesture
    if (this.mode.kind === "touch-gesture") {
      if (this.pointers.size !== 2) return;

      const a = this.pointers.get(this.mode.pointerA);
      const b = this.pointers.get(this.mode.pointerB);
      if (!a || !b) return;

      const g = twoFingerRead(a, b);

      // Pinch zoom: interpret dist delta
      const distDelta = g.dist - this.mode.lastDist;
      const pinchThreshold = 2;
      if (Math.abs(distDelta) >= pinchThreshold) {
        const direction = distDelta > 0 ? -1 : 1;
        this.updateZoom(g.centroid.x, g.centroid.y, direction);
      }

      // Twist rotate
      const dTheta = wrapAngleDelta(g.angle - this.mode.lastAngle);
      const rotateThreshold = 0.0;
      if (!this.mode.rotateStarted && Math.abs(dTheta) > rotateThreshold) {
        this.mode.rotateStarted = true;
        this.startRotate(g.centroid.x, g.centroid.y);
      }
      if (this.mode.rotateStarted) this.updateRotate(g.centroid.x, g.centroid.y);

      this.mode.lastCentroid = g.centroid;
      this.mode.lastDist = g.dist;
      this.mode.lastAngle = g.angle;
      return;
    }

    // Single pointer semantic transitions
    if (this.mode.kind === "press" && this.mode.pointerId === e.pointerId) {
      const threshold = this.settings?.camera?.dragThreshold ?? 6;
      const movedSq = distSq({ x: e.screen.x, y: e.screen.y }, this.mode.downScreen);
      if (movedSq <= threshold * threshold) return;

      // crossed drag threshold, choose a mode
      if (this.mode.rightIntent) {
        this.startRotate(e.screen.x, e.screen.y);
        this.mode = { kind: "rotate", pointerId: e.pointerId };
        return;
      }

      if (this.mode.downNode?.id) {
        this.startDrag(this.mode.downNode.id, e.screen.x, e.screen.y);
        this.mode = { kind: "drag-node", pointerId: e.pointerId, nodeId: this.mode.downNode.id };
        return;
      }

      this.startPan(e.screen.x, e.screen.y);
      this.mode = { kind: "pan", pointerId: e.pointerId };
      return;
    }

    if (this.mode.kind === "drag-node" && this.mode.pointerId === e.pointerId) {
      this.updateDrag(e.screen.x, e.screen.y);
      return;
    }

    if (this.mode.kind === "pan" && this.mode.pointerId === e.pointerId) {
      this.updatePan(e.screen.x, e.screen.y);
      return;
    }

    if (this.mode.kind === "rotate" && this.mode.pointerId === e.pointerId) {
      this.updateRotate(e.screen.x, e.screen.y);
      return;
    }
  }

  private onPointerUp(e: Extract<InputEvent, { type: "POINTER_UP" }>) {
    this.pointers.delete(e.pointerId);

    // If we were in touch gesture and now dropped below 2 pointers, end rotate if started.
    if (this.mode.kind === "touch-gesture") {
      if (this.pointers.size < 2) {
        if (this.mode.rotateStarted) this.endRotate();
        this.mode = { kind: "idle" };
      }
      return;
    }

    // End modes
    if (this.mode.kind === "drag-node" && this.mode.pointerId === e.pointerId) {
      this.endDrag();
      this.mode = { kind: "idle" };
      return;
    }
    if (this.mode.kind === "pan" && this.mode.pointerId === e.pointerId) {
      this.endPan();
      this.mode = { kind: "idle" };
      return;
    }
    if (this.mode.kind === "rotate" && this.mode.pointerId === e.pointerId) {
      this.endRotate();
      this.mode = { kind: "idle" };
      return;
    }

    // If still in press, interpret as a click release
    if (this.mode.kind === "press" && this.mode.pointerId === e.pointerId) {
      const press = this.mode;
      this.mode = { kind: "idle" };

      if (press.longPressFired) return;
      if (press.rightIntent) {
        this.deps.getCamera()?.resetCamera();
        return;
      }

      const nodeId = press.downNode?.id; // if you stored {id,label}
      if (!nodeId) return;

      this.handleClickNode(nodeId);
      return;
    }

    this.mode = { kind: "idle" };
  }

  private handleClickNode(nodeId: string) {
    // If already following this node, open it
    if (this.state.followedNodeId === nodeId) {
      const node = this.getNodeIdLabel(nodeId);
      if (!node) return;
      this.emit({ type: "OPEN_NODE_REQUESTED", node }); // or node: {id,label} depending on your event type
      return;
    }

    // Otherwise, follow it
    this.startFollow(nodeId);
  }


  private onPointerCancel(e: Extract<InputEvent, { type: "POINTER_CANCEL" }>) {
    this.pointers.delete(e.pointerId);

    if (this.mode.kind === "touch-gesture") {
      if (this.mode.rotateStarted) this.endRotate();
      this.mode = { kind: "idle" };
      return;
    }

    if (this.mode.kind === "drag-node") this.endDrag();
    if (this.mode.kind === "pan") this.endPan();
    if (this.mode.kind === "rotate") this.endRotate();

    this.mode = { kind: "idle" };
  }

  private onWheel(e: Extract<InputEvent, { type: "WHEEL" }>) {
    // Interpret wheel here (semantic)
    const camera = this.deps.getCamera();
    if (!camera) return;

    const screenX = e.screen.x;
    const screenY = e.screen.y;

    // Trackpad pinch commonly arrives as wheel with ctrlKey on macOS.
    // If ctrl/meta is held, treat as zoom.
    const zoom = e.ctrl || e.meta;
    if (zoom) {
      const direction = e.deltaY > 0 ? 1 : -1;
      this.updateZoom(screenX, screenY, direction);
      return;
    }

    // Otherwise treat as "pan-like" scroll.
    // If your camera has a dedicated wheel pan session, hook it up here.
    camera.startPan(screenX, screenY);
    camera.updatePan(screenX - e.deltaX, screenY - e.deltaY);
    camera.endPan();
  }

  private onLongPress(e: Extract<InputEvent, { type: "LONG_PRESS" }>) {
    // Long press is a fact. We interpret it only if we're still in press with same pointer.
    if (this.mode.kind !== "press") return;
    if (this.mode.pointerId !== e.pointerId) return;

    // mark fired to suppress click-on-release
    this.mode.longPressFired = true;

    // Define long press as "focus node if touched, else reset camera"
    if (this.mode.downNode?.id) {
      this.startFollow(this.mode.downNode.id);
    } else {
      this.deps.getCamera()?.resetCamera();
    }
  }

  // ----------------------------------------------------------------------------
  // Semantic click behavior
  // ----------------------------------------------------------------------------

  private handleSingleOrDoubleClick(nodeId: string, timeMs: number) {
    //const doubleMs = this.settings?.camera?.doubleClickMs ?? 300; // fix this some day
    const doubleMs = 300; // fix this some day

    const prev = this.lastClick;
    const isDouble =
      !!prev &&
      prev.nodeId === nodeId &&
      (timeMs - prev.timeMs) <= doubleMs;

    // record this click
    this.lastClick = { nodeId, timeMs };

    if (isDouble) {
      const node = this.getNodeIdLabel(nodeId);
      if (!node) return;
      this.emit({ type: "OPEN_NODE_REQUESTED", node });
      return;
    }

    this.startFollow(nodeId);
  }

  // ----------------------------------------------------------------------------
  // Outputs + helpers
  // ----------------------------------------------------------------------------

  private emit(e: InteractionEvent): void {
    this.events.push(e);
  }

  private emitPinned(): void {
    this.emit({ type: "PINNED_SET", ids: new Set(this.pinnedNodes) });
  }

  // ----------------------------------------------------------------------------
  // Hover + follow
  // ----------------------------------------------------------------------------

  private updateHover() {
    const mouse = this.state.gravityCenter;
    if (!mouse) {
      this.state.hoveredNodeId = null;
      return;
    }

    const hit = this.getClickedNode(mouse.x, mouse.y);
    this.state.hoveredNodeId = hit?.id ?? null;
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

  private startFollow(nodeId: string) {
    this.state.followedNodeId = nodeId;
    // Follow updates each tick via updateFollow()
  }

  private endFollow() {
    this.state.followedNodeId = null;
  }

  // ----------------------------------------------------------------------------
  // Dragging nodes (semantic)
  // ----------------------------------------------------------------------------

  private startDrag(nodeId: string, screenX: number, screenY: number) {
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

  private updateDrag(screenX: number, screenY: number) {
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

    node.velocity.vx = 0;
    node.velocity.vy = 0;
    node.velocity.vz = 0;
  }

  private endDrag() {
    const draggedId = this.state.draggedNodeId;
    if (!draggedId) return;

    this.pinnedNodes.delete(draggedId);
    this.emitPinned();

    this.state.draggedNodeId = null;
    this.dragWorldOffset = null;

    // mouse gravity back on after drag
    this.emit({ type: "MOUSE_GRAVITY_SET", on: true });
  }

  // ----------------------------------------------------------------------------
  // Camera pan/rotate/zoom (semantic)
  // ----------------------------------------------------------------------------

  private startPan(screenX: number, screenY: number) {
    this.endFollow();
    this.state.isPanning = true;
    this.deps.getCamera()?.startPan(screenX, screenY);
  }

  private updatePan(screenX: number, screenY: number) {
    this.deps.getCamera()?.updatePan(screenX, screenY);
  }

  private endPan() {
    this.state.isPanning = false;
    this.deps.getCamera()?.endPan();
  }

  private startRotate(screenX: number, screenY: number) {
    this.state.isRotating = true;
    this.deps.getCamera()?.startRotate(screenX, screenY);
  }

  private updateRotate(screenX: number, screenY: number) {
    this.deps.getCamera()?.updateRotate(screenX, screenY);
  }

  private endRotate() {
    this.state.isRotating = false;
    this.deps.getCamera()?.endRotate();
  }

  private updateZoom(screenX: number, screenY: number, delta: number) {
    this.deps.getCamera()?.updateZoom(screenX, screenY, delta);
  }

  // ----------------------------------------------------------------------------
  // Node open (semantic event)
  // ----------------------------------------------------------------------------

  private getNodeIdLabel(nodeId: string): { id: string; label: string, type: string } | null {
    const graph = this.deps.getGraph();
    if (!graph) return null;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    return { id: node.id, label: node.label, type: node.type };
  }

  // ----------------------------------------------------------------------------
  // Hit testing (Interaction owns this)
  // ----------------------------------------------------------------------------

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
      const d2 = dx * dx + dy * dy;

      const rPx = node.radius * p.scale;

      if (d2 <= rPx * rPx && d2 < bestDistSq) {
        bestDistSq = d2;
        best = node;
      }
    }

    return best;
  }

  private hitTestNode(screenX: number, screenY: number): Node | null {
    return this.getClickedNode(screenX, screenY);
  }

  // ----------------------------------------------------------------------------
  // Pointer bookkeeping
  // ----------------------------------------------------------------------------

  private upsertPointer(id: number, kind: "mouse" | "touch" | "pen", x: number, y: number) {
    this.pointers.set(id, { id, kind, x, y });
  }

  private firstTwoPointers(): [PointerRec | null, PointerRec | null] {
    let a: PointerRec | null = null;
    let b: PointerRec | null = null;
    for (const p of this.pointers.values()) {
      if (!a) a = p;
      else {
        b = p;
        break;
      }
    }
    return [a, b];
  }

  private endSinglePointerModeIfNeeded() {
    if (this.mode.kind === "drag-node") this.endDrag();
    if (this.mode.kind === "pan") this.endPan();
    if (this.mode.kind === "rotate") this.endRotate();
    this.mode = { kind: "idle" };
  }
}
