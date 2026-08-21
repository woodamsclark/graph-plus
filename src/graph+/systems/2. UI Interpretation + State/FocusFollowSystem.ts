import type { GraphAccessor } from "../../types/domain/graph.ts";
import type { CameraController } from "../5. Render/CameraController.ts";
import type { UIStateStore } from "./UIStateStore.ts";

/**
 * Keeps the camera target attached to the focused node after commands apply.
 *
 * This deliberately runs after Commander. A camera reset can therefore clear
 * focus atomically without an already-queued follow command restoring the old
 * target later in the same frame.
 */
export class FocusFollowSystem {
  constructor(private deps: {
    graph: GraphAccessor;
    camera: CameraController;
    uiStateStore: UIStateStore;
  }) {}

  tick(_dt: number): void {
    const id = this.deps.uiStateStore.get().followedNodeId;
    if (!id) return;

    const node = this.deps.graph.get()?.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      this.deps.uiStateStore.setFocusedNode(null);
      return;
    }

    this.deps.camera.patchState({
      targetX: node.location.x,
      targetY: node.location.y,
      targetZ: node.location.z,
    });
  }
}
