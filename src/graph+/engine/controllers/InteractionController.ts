

import type { Vec3 } from "../../types/domain/math.ts";

import { getSettings } from "../../../obsidian/settings/settingsStore.ts";
import { Physics } from "../../systems/4. Modules/Physics.ts";
import { CameraController } from "../../systems/5. Render/CameraController.ts";
import { UIStateStore } from "../../systems/2. UI Interpretation + State/UIStateStore.ts";

export class InteractionController {
  constructor(private deps: {
    getPhysics: ()      => Physics | null;
    getCamera: ()       => CameraController | null;
    getUIStateStore: () => UIStateStore;
  }) {}

  setMouseGravity(on: boolean): void {
    getSettings().physics.mouseGravityEnabled = on;
  }

  pinNode(nodeId: string): void {
    this.deps.getPhysics()?.pinNode(nodeId);
  }

  unpinNode(nodeId: string): void {
    this.deps.getPhysics()?.unpinNode(nodeId);
  }

  beginDrag(nodeId: string, targetWorld: Vec3): void {
    this.deps.getPhysics()?.beginDrag?.(nodeId, targetWorld);
  }

  updateDragTarget(targetWorld: Vec3): void {
    this.deps.getPhysics()?.updateDragTarget?.(targetWorld);
  }

  endDrag(): void {
    this.deps.getPhysics()?.endDrag?.();
  }

  resetCamera(): void {
    this.deps.getCamera()?.resetCamera();
  }

  startPan(screen: { x: number; y: number }): void {
    this.deps.getCamera()?.startPan(screen.x, screen.y);
  }

  updatePan(screen: { x: number; y: number }): void {
    this.deps.getCamera()?.updatePan(screen.x, screen.y);
  }

  endPan(): void {
    this.deps.getCamera()?.endPan();
  }

  startRotate(screen: { x: number; y: number }): void {
    this.deps.getCamera()?.startRotate(screen.x, screen.y);
  }

  updateRotate(screen: { x: number; y: number }): void {
    this.deps.getCamera()?.updateRotate(screen.x, screen.y);
  }

  endRotate(): void {
    this.deps.getCamera()?.endRotate();
  }

  zoomCamera(screen: { x: number; y: number }, delta: number): void {
    this.deps.getCamera()?.updateZoom(screen.x, screen.y, delta);
  }

  setGravityCenter(point: { x: number; y: number } | null): void {
    this.deps.getUIStateStore().setGravityCenter(point);
  }

  setHoveredNode(nodeId: string | null): void {
    this.deps.getUIStateStore().setHoveredNode(nodeId);
  }

  setFollowedNode(nodeId: string | null): void {
    this.deps.getUIStateStore().setFollowedNode(nodeId);
  }

  setDraggedNode(nodeId: string | null): void {
    this.deps.getUIStateStore().setDraggedNode(nodeId);
  }

  setPanning(on: boolean): void {
    this.deps.getUIStateStore().setPanning(on);
  }

  setRotating(on: boolean): void {
    this.deps.getUIStateStore().setRotating(on);
  }

  setCameraTarget(target: Vec3): void {
    this.deps.getCamera()?.patchState({
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    });
  }
}