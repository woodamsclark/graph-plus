import type {
  Node,
  UserInputEvent,
  Vec3,
  InteractionInterpreterSystem as UIInterpreterSystem,
  DrainableBuffer,
  GraphModule,
  GraphPlusSettings,
  UIModuleSettings,
  LayoutSettings,
  SettingsAwareSystem,
} from "../../grammar/interfaces.ts";

import type { CameraController }      from "../5. Render/CameraController.ts";
import type { CursorCss }             from "../../CursorController.ts";
import type { Command }               from "../3. Module Commander/Commander.ts";
import      { UIStateStore }          from "./UIStateStore.ts";
import type { UISettings }            from "../../grammar/interfaces.ts";

import { PointerRec, twoFingerRead, wrapAngleDelta, distSq } from "../helpers.ts";
import { HitTester } from "./HitTester.ts";

type UIInterpreterDeps = {
  getGraph:             () => GraphModule;
  getCamera:            () => CameraController    | null;
  getCanvas:            () => HTMLCanvasElement;
  getInputBuffer:       () => DrainableBuffer<UserInputEvent>;
  getCommands:          () => DrainableBuffer<Command>;
  getInteractionState:  () => UIStateStore;
  getHitTester:         () => HitTester;
};


type PressMode = {
  kind:           "press";
  pointerId:      number;
  downTimeMs:     number;
  rightIntent:    boolean;
  longPressFired: boolean;
  downNode:       { id: string; label: string } | null;
  downScreen:     { x: number;      y: number };
};

type Mode =
  | { kind: "idle" }
  | PressMode
  | { kind: "drag-node";  pointerId: number;  nodeId: string }
  | { kind: "pan";        pointerId: number }
  | { kind: "rotate";     pointerId: number }
  | {
      kind: "touch-gesture";
      pointerA: number;
      pointerB: number;
      lastCentroid: { x: number; y: number };
      lastDist: number;
      lastAngle: number;
      rotateStarted: boolean;
    };


export class UIInterpreter implements SettingsAwareSystem<UIModuleSettings> {
  private mode: Mode = { kind: "idle" };
  private pointers = new Map<number, PointerRec>();

  // Ephemeral interpreter-local drag math
  private dragWorldOffset: Vec3 | null = null;
  private dragDepthFromCamera = 0;

  // Ephemeral click timing
  private lastClick: { nodeId: string | null; timeMs: number } | null = null;

  constructor(private settings: UIModuleSettings, private deps: UIInterpreterDeps) {
    this.settings = settings;
  }

  public updateSettings(settings: UIModuleSettings): void {
      this.settings = settings;
  }
    
  public getCursorType(): CursorCss {
    const state = this.deps.getInteractionState().get();

    if (state.draggedNodeId || state.isPanning || state.isRotating) return "grabbing";
    if (state.hoveredNodeId) return "pointer";
    return "default";
  }

  public tick(_dt: number, _nowMs: number): void {
    const batch = this.deps.getInputBuffer().drain();
    for (const e of batch) this.ingestOne(e);

    this.updateFollow();
    this.updateHover();
  }

  public destroy(): void {
    // no-op
  }

  private ingestOne(e: UserInputEvent): void {
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

  private onPointerDown(e: Extract<UserInputEvent, { type: "POINTER_DOWN" }>) {
    this.upsertPointer(e.pointerId, e.kind, e.screen.x, e.screen.y);

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

      this.cmd({ type: "SetGravityCenter", point: { x: g.centroid.x, y: g.centroid.y } });
      return;
    }

    const isMouse = e.kind === "mouse";
    const isLeft = e.button === 0;
    const isRight = e.button === 2;

    const rightIntent = isMouse && ((isLeft && (e.ctrl || e.meta)) || isRight);
    const downHit = this.deps.getHitTester().getNodeIdLabelAtScreenPoint(
      this.deps.getGraph().get(),
      this.deps.getCamera(),
      e.screen.x,
      e.screen.y
    );

    this.mode = {
      kind: "press",
      pointerId: e.pointerId,
      downScreen: { x: e.screen.x, y: e.screen.y },
      downTimeMs: e.timeMs,
      downNode: downHit,
      rightIntent,
      longPressFired: false,
    };

    this.cmd({ type: "SetGravityCenter", point: { x: e.screen.x, y: e.screen.y } });
  }

  private onPointerMove(e: Extract<UserInputEvent, { type: "POINTER_MOVE" }>) {
    this.upsertPointer(e.pointerId, e.kind, e.screen.x, e.screen.y);
    this.cmd({ type: "SetGravityCenter", point: { x: e.screen.x, y: e.screen.y } });

    if (this.mode.kind === "touch-gesture") {
      if (this.pointers.size !== 2) return;

      const a = this.pointers.get(this.mode.pointerA);
      const b = this.pointers.get(this.mode.pointerB);
      if (!a || !b) return;

      const g = twoFingerRead(a, b);

      const distDelta = g.dist - this.mode.lastDist;
      const tuning = this.settings.tuning;
      const pinchThreshold = tuning.pinchThresholdPx;
      if (Math.abs(distDelta) >= pinchThreshold) {
        const direction = distDelta > 0 ? -1 : 1;
        this.updateZoom(g.centroid.x, g.centroid.y, direction);
      }

      const dTheta = wrapAngleDelta(g.angle - this.mode.lastAngle);
      const rotateThreshold = tuning.rotateThresholdRad;
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

    if (this.mode.kind === "press" && this.mode.pointerId === e.pointerId) {
      const uiCfg = this.settings.ui;
      const threshold = uiCfg.dragThresholdPx;

      const movedSq = distSq({ x: e.screen.x, y: e.screen.y }, this.mode.downScreen);
      if (movedSq <= threshold * threshold) return;

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

  private onPointerUp(e: Extract<UserInputEvent, { type: "POINTER_UP" }>) {
    this.pointers.delete(e.pointerId);

    if (this.mode.kind === "touch-gesture") {
      if (this.pointers.size < 2) {
        if (this.mode.rotateStarted) this.endRotate();
        this.mode = { kind: "idle" };
      }
      return;
    }

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

    if (this.mode.kind === "press" && this.mode.pointerId === e.pointerId) {
      const press = this.mode;
      this.mode = { kind: "idle" };

      if (press.longPressFired) return;

      if (press.rightIntent) {
        this.cmd({ type: "ResetCamera" });
        return;
      }

      const nodeId = press.downNode?.id ?? null;
      this.handleSingleOrDoubleClick(nodeId, e.timeMs);
      return;
    }

    this.mode = { kind: "idle" };
  }

  private onPointerCancel(e: Extract<UserInputEvent, { type: "POINTER_CANCEL" }>) {
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

  private onWheel(e: Extract<UserInputEvent, { type: "WHEEL" }>) {
    const screenX = e.screen.x;
    const screenY = e.screen.y;

    const zoom = e.ctrl || e.meta;
    if (zoom) {
      const direction = e.deltaY > 0 ? 1 : -1;
      this.cmd({
        type: "ZoomCamera",
        screen: { x: screenX, y: screenY },
        delta: direction,
      });
      return;
    }

    this.cmd({ type: "StartPanCamera", screen: { x: screenX, y: screenY } });
    this.cmd({ type: "UpdatePanCamera", screen: { x: screenX - e.deltaX, y: screenY - e.deltaY } });
    this.cmd({ type: "EndPanCamera" });
  }

  private onLongPress(e: Extract<UserInputEvent, { type: "LONG_PRESS" }>) {
    if (this.mode.kind !== "press") return;
    if (this.mode.pointerId !== e.pointerId) return;

    this.mode.longPressFired = true;

    if (this.mode.downNode?.id) {
      this.cmd({ type: "SetFollowedNode", nodeId: this.mode.downNode.id });
    } else {
      this.cmd({ type: "ResetCamera" });
    }
  }

  private cmd(c: Command): void {
    this.deps.getCommands().push(c);
  }

  private updateHover() {
    const mouse = this.deps.getInteractionState().get().gravityCenter;
    if (!mouse) {
      this.cmd({ type: "SetHoveredNode", nodeId: null });
      return;
    }

    const hit = this.deps.getHitTester().getNodeAtScreenPoint(
      this.deps.getGraph().get(),
      this.deps.getCamera(),
      mouse.x,
      mouse.y
    );
    this.cmd({ type: "SetHoveredNode", nodeId: hit?.id ?? null });
  }

  private updateFollow(): void {
    const id = this.deps.getInteractionState().get().followedNodeId;
    if (!id) return;

    const graph = this.deps.getGraph().get();
    if (!graph) return;

    const node = graph.nodes.find(n => n.id === id);
    if (!node) {
      this.cmd({ type: "SetFollowedNode", nodeId: null });
      return;
    }

    this.cmd({
      type: "SetCameraTarget",
      target: {
        x: node.location.x,
        y: node.location.y,
        z: node.location.z,
      },
    });
  }

  private handleSingleOrDoubleClick(nodeId: string | null, timeMs: number) {
    const uiCfg = this.settings.ui;
    const doubleMs = uiCfg.doubleClickMs;

    const prev = this.lastClick;
    const isDouble = !!prev && prev.nodeId === nodeId && (timeMs - prev.timeMs) <= doubleMs;

    this.lastClick = { nodeId, timeMs };

    if (isDouble && nodeId !== null) {
      this.cmd({ type: "OpenNode", nodeId });
      return;
    }

    const followedNodeId = this.deps.getInteractionState().get().followedNodeId;
    if (followedNodeId === nodeId && nodeId !== null) {
      this.cmd({ type: "OpenNode", nodeId });
      return;
    }

    this.cmd({ type: "SetFollowedNode", nodeId });
  }

  private startDrag(nodeId: string, screenX: number, screenY: number) {
    this.cmd({ type: "SetFollowedNode", nodeId: null });

    const graph   = this.deps.getGraph().get();
    const camera  = this.deps.getCamera();
    if (!graph || !camera) return;

    this.cmd({ type: "SetMouseGravity", on: false });

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const projected           = camera.worldToScreen(node.location);
    this.dragDepthFromCamera  = Math.max(0.0001, projected.depth);

    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    this.dragWorldOffset = {
      x: node.location.x - underMouse.x,
      y: node.location.y - underMouse.y,
      z: (node.location.z || 0) - underMouse.z,
    };

    this.cmd({ type: "SetDraggedNode",  nodeId });
    this.cmd({ type: "BeginDrag",       nodeId,     targetWorld: node.location });

    const targetWorld = {
      x: underMouse.x + this.dragWorldOffset.x,
      y: underMouse.y + this.dragWorldOffset.y,
      z: underMouse.z + this.dragWorldOffset.z,
    };
    this.cmd({ type: "UpdateDragTarget", targetWorld });
  }

  private updateDrag(screenX: number, screenY: number) {
    const camera = this.deps.getCamera();
    if (!camera) return;

    const draggedId = this.deps.getInteractionState().get().draggedNodeId;
    if (!draggedId) return;

    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };

    const targetWorld = {
      x: underMouse.x + o.x,
      y: underMouse.y + o.y,
      z: underMouse.z + o.z,
    };

    this.cmd({ type: "UpdateDragTarget", targetWorld });
  }

  private endDrag() {
    const draggedId = this.deps.getInteractionState().get().draggedNodeId;
    if (!draggedId) return;

    this.dragWorldOffset = null;

    this.cmd({ type: "EndDrag" });
    this.cmd({ type: "SetDraggedNode",  nodeId:null });
    this.cmd({ type: "SetMouseGravity",     on: true      });
  }

  private startPan(screenX: number, screenY: number) {
    this.cmd({ type: "SetFollowedNode", nodeId: null });
    this.cmd({ type: "SetPanning", on: true });
    this.cmd({ type: "StartPanCamera", screen: { x: screenX, y: screenY } });
  }

  private updatePan(screenX: number, screenY: number) {
    this.cmd({ type: "UpdatePanCamera", screen: { x: screenX, y: screenY } });
  }

  private endPan() {
    this.cmd({ type: "SetPanning", on: false });
    this.cmd({ type: "EndPanCamera" });
  }

  private startRotate(screenX: number, screenY: number) {
    this.cmd({ type: "SetRotating", on: true });
    this.cmd({ type: "StartRotateCamera", screen: { x: screenX, y: screenY } });
  }

  private updateRotate(screenX: number, screenY: number) {
    this.cmd({ type: "UpdateRotateCamera", screen: { x: screenX, y: screenY } });
  }

  private endRotate() {
    this.cmd({ type: "SetRotating", on: false });
    this.cmd({ type: "EndRotateCamera"        });
  }

  private updateZoom(screenX: number, screenY: number, delta: number) {
    this.cmd({ type: "ZoomCamera", screen: { x: screenX, y: screenY }, delta });
  }

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