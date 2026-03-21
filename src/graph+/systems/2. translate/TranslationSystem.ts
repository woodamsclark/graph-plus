// Translator.ts
import type {
  Node,
  GraphData,
  TranslationSystem,
  TranslationState,
  InputEvent,
  Vec3,
  Command,
} from "../../grammar/interfaces.ts";

import type { Camera } from "../5. render/Camera.ts";
import type { CursorCss } from "../1. receive/cursor_selector.ts";
import type { InputBuffer } from "../1. receive/InputBuffer.ts";
import type { CommandBuffer } from "../3. execute/CommandBuffer.ts";


type CameraSettings = {
  dragThresholdPx?: number;
  doubleClickMs?: number;
};

type TranslatorDeps = {
  getGraph: () => GraphData | null;
  getCamera: () => Camera | null;
  getCanvas: () => HTMLCanvasElement;
  getBuffer: () => InputBuffer;
  getCommands: () => CommandBuffer;
  // Narrow settings reader: keep Translator out of global settings.
  getCameraSettings: () => CameraSettings;
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

export class Translator implements TranslationSystem {
  private mode: Mode = { kind: "idle" };
  private pointers = new Map<number, PointerRec>();

  // Drag intent computation
  private dragWorldOffset: Vec3 | null = null;
  private dragDepthFromCamera = 0;

  // Local interaction-only pinned set (what user is holding)
  // We still emit pin commands so the "world" can own the authoritative pin set.
  private pinnedNodes: Set<string> = new Set();

  private lastClick: { nodeId: string | null; timeMs: number } | null = null;

  private state: TranslationState = {
    gravityCenter: null,
    hoveredNodeId: null,
    followedNodeId: null,
    draggedNodeId: null,
    isPanning: false,
    isRotating: false,
  };

  constructor(private deps: TranslatorDeps) {}

  public getState(): Readonly<TranslationState> {
    return this.state;
  }

  public getCursorType(): CursorCss {
    if (this.state.draggedNodeId || this.state.isPanning || this.state.isRotating) return "grabbing";
    if (this.state.hoveredNodeId) return "pointer";
    return "default";
  }

  public tick(_dt: number, _nowMs: number): void {
    // 1) Receive: consume raw input events for this frame
    const batch = this.deps.getBuffer().drain();
    for (const e of batch) this.ingestOne(e);

    // 2) Interpret: per-frame derived behavior
    this.updateFollow();
    this.updateHover();
  }

  public destroy(): void {
    // no-op
  }

  // ----------------------------------------------------------------------------
  // Receive → Interpret (raw input ingestion + semantic transitions)
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

    // If 2 pointers are down, enter touch gesture mode
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

      // gravity center for hover/mouse gravity semantics
      this.state.gravityCenter = { x: g.centroid.x, y: g.centroid.y };
      return;
    }

    // Single pointer press state
    const isMouse = e.kind === "mouse";
    const isLeft = e.button === 0;
    const isRight = e.button === 2;

    // right intent definition lives here (semantic)
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

    this.state.gravityCenter = { x: e.screen.x, y: e.screen.y };
  }

  private onPointerMove(e: Extract<InputEvent, { type: "POINTER_MOVE" }>) {
    this.upsertPointer(e.pointerId, e.kind, e.screen.x, e.screen.y);

    // Update gravity center always for hover/mouse gravity
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
      const cameraCfg = this.deps.getCameraSettings();
      const threshold = cameraCfg.dragThresholdPx ?? 6;

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

    // Touch gesture end
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

    // Click release
    if (this.mode.kind === "press" && this.mode.pointerId === e.pointerId) {
      const press = this.mode;
      this.mode = { kind: "idle" };

      if (press.longPressFired) return;
      if (press.rightIntent) {
        this.deps.getCamera()?.resetCamera();
        return;
      }

      const nodeId = press.downNode?.id;
      if (!nodeId) return;

      this.handleSingleOrDoubleClick(nodeId, e.timeMs);
      return;
    }

    this.mode = { kind: "idle" };
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
    const camera = this.deps.getCamera();
    if (!camera) return;

    const screenX = e.screen.x;
    const screenY = e.screen.y;

    // Trackpad pinch often arrives as wheel + ctrl/meta on macOS.
    const zoom = e.ctrl || e.meta;
    if (zoom) {
      const direction = e.deltaY > 0 ? 1 : -1;
      this.updateZoom(screenX, screenY, direction);
      return;
    }

    // Otherwise treat as pan-like scroll.
    camera.startPan(screenX, screenY);
    camera.updatePan(screenX - e.deltaX, screenY - e.deltaY);
    camera.endPan();
  }

  private onLongPress(e: Extract<InputEvent, { type: "LONG_PRESS" }>) {
    if (this.mode.kind !== "press") return;
    if (this.mode.pointerId !== e.pointerId) return;

    this.mode.longPressFired = true;

    if (this.mode.downNode?.id) {
      this.cmd({ type: "FollowNode", nodeId: this.mode.downNode.id });
    } else {
      this.deps.getCamera()?.resetCamera();
    }
  }

  // ----------------------------------------------------------------------------
  // Communicate intent (Commands)
  // ----------------------------------------------------------------------------

  private cmd(c: Command): void {
    this.deps.getCommands().push(c);
  }

  private replacePinnedSet(): void {
    this.cmd({ type: "ReplacePinnedSet", ids: new Set(this.pinnedNodes) });
  }

  // ----------------------------------------------------------------------------
  // Hover + follow (still local, camera-side effects remain here for now)
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

  public setFollowedNode(nodeId: string | null): void {
    this.state.followedNodeId = nodeId;
  }

  private endFollow() {
    this.state.followedNodeId = null;
  }

  private handleSingleOrDoubleClick(nodeId: string | null, timeMs: number) {
    const cameraCfg = this.deps.getCameraSettings();
    const doubleMs = cameraCfg.doubleClickMs ?? 300;

    const prev = this.lastClick;
    const isDouble = !!prev && prev.nodeId === nodeId && (timeMs - prev.timeMs) <= doubleMs;

    this.lastClick = { nodeId, timeMs };

    if (isDouble && nodeId !== null) {
      this.cmd({ type: "RequestOpenNode", nodeId });
      return;
    }

    if (this.state.followedNodeId === nodeId && nodeId !== null) {
      this.cmd({ type: "RequestOpenNode", nodeId });
      return;
    }

    this.cmd({ type: "FollowNode", nodeId });
  }

  // ----------------------------------------------------------------------------
  // Dragging nodes (semantic → commands; NO direct node mutation)
  // ----------------------------------------------------------------------------

  private startDrag(nodeId: string, screenX: number, screenY: number) {
    this.endFollow();

    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) return;

    // Communicate intent: disable mouse gravity while dragging
    this.cmd({ type: "SetMouseGravity", on: false });

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const projected = camera.worldToScreen(node);
    this.dragDepthFromCamera = Math.max(0.0001, projected.depth);

    this.state.draggedNodeId = nodeId;

    // Pin while dragging (intent)
    this.pinnedNodes.add(nodeId);
    this.replacePinnedSet();

    // Compute drag offset (so node stays under cursor)
    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    this.dragWorldOffset = {
      x: node.location.x - underMouse.x,
      y: node.location.y - underMouse.y,
      z: (node.location.z || 0) - underMouse.z,
    };

    // Tell downstream we began dragging (optional, useful for constraints)
    this.cmd({ type: "BeginDrag", nodeId });

    // Emit first target immediately
    const targetWorld = {
      x: underMouse.x + this.dragWorldOffset.x,
      y: underMouse.y + this.dragWorldOffset.y,
      z: underMouse.z + this.dragWorldOffset.z,
    };
    this.cmd({ type: "DragTarget", nodeId, targetWorld });
  }

  private updateDrag(screenX: number, screenY: number) {
    const camera = this.deps.getCamera();
    if (!camera) return;

    const draggedId = this.state.draggedNodeId;
    if (!draggedId) return;

    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };

    const targetWorld = {
      x: underMouse.x + o.x,
      y: underMouse.y + o.y,
      z: underMouse.z + o.z,
    };

    // Communicate intent: physics should satisfy this constraint
    this.cmd({ type: "DragTarget", nodeId: draggedId, targetWorld });
  }

  private endDrag() {
    const draggedId = this.state.draggedNodeId;
    if (!draggedId) return;

    // Unpin (intent)
    this.pinnedNodes.delete(draggedId);
    this.replacePinnedSet();

    this.state.draggedNodeId = null;
    this.dragWorldOffset = null;

    // Drag ended (optional)
    this.cmd({ type: "EndDrag", nodeId: draggedId });

    // Re-enable mouse gravity after drag
    this.cmd({ type: "SetMouseGravity", on: true });
  }

  // ----------------------------------------------------------------------------
  // Camera pan/rotate/zoom (kept local for now)
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
  // Hit testing
  // ----------------------------------------------------------------------------

  private getClickedNodeIdLabel(screenX: number, screenY: number): { id: string; label: string } | null {
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
