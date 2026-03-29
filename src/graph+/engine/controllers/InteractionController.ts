

import type { Vec3 } from "../../types/domain/math.ts";

import { getSettings } from "../../../obsidian/settings/settingsStore.ts";
import { Physics } from "../../systems/4. Modules/Physics.ts";
import { CameraController } from "../../systems/5. Render/CameraController.ts";
import { UIStateStore } from "../../systems/2. UI Interpretation + State/UIStateStore.ts";

export class InteractionController {
  constructor(private deps: {
    physics:  Physics | null;
    camera:   CameraController | null;
    uiStateStore:UIStateStore;
  }) {}

  setMouseGravity(on: boolean): void {
    getSettings().physics.mouseGravityEnabled = on;
  }

  pinNode(nodeId: string): void {
    this.deps.physics?.pinNode(nodeId);
  }

  unpinNode(nodeId: string): void {
    this.deps.physics?.unpinNode(nodeId);
  }

  beginDrag(nodeId: string, targetWorld: Vec3): void {
    this.deps.physics?.beginDrag?.(nodeId, targetWorld);
  }

  updateDragTarget(targetWorld: Vec3): void {
    this.deps.physics?.updateDragTarget?.(targetWorld);
  }

  endDrag(): void {
    this.deps.physics?.endDrag?.();
  }

  resetCamera(): void {
    this.deps.camera?.resetCamera();
  }

  startPan(screen: { x: number; y: number }): void {
    this.deps.camera?.startPan(screen.x, screen.y);
  }

  updatePan(screen: { x: number; y: number }): void {
    this.deps.camera?.updatePan(screen.x, screen.y);
  }

  endPan(): void {
    this.deps.camera?.endPan();
  }

  startRotate(screen: { x: number; y: number }): void {
    this.deps.camera?.startRotate(screen.x, screen.y);
  }

  updateRotate(screen: { x: number; y: number }): void {
    this.deps.camera?.updateRotate(screen.x, screen.y);
  }

  endRotate(): void {
    this.deps.camera?.endRotate();
  }

  zoomCamera(screen: { x: number; y: number }, delta: number): void {
    this.deps.camera?.updateZoom(screen.x, screen.y, delta);
  }

  setGravityCenter(point: { x: number; y: number } | null): void {
    this.deps.uiStateStore.setGravityCenter(point);
  }

  setHoveredNode(nodeId: string | null): void {
    this.deps.uiStateStore.setHoveredNode(nodeId);
  }

  setFollowedNode(nodeId: string | null): void {
    this.deps.uiStateStore.setFollowedNode(nodeId);
  }

  setDraggedNode(nodeId: string | null): void {
    this.deps.uiStateStore.setDraggedNode(nodeId);
  }

  setPanning(on: boolean): void {
    this.deps.uiStateStore.setPanning(on);
  }

  setRotating(on: boolean): void {
    this.deps.uiStateStore.setRotating(on);
  }

  setCameraTarget(target: Vec3): void {
    this.deps.camera?.patchState({
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    });
  }
}