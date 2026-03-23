import type { Store, UIState } from "../../grammar/interfaces.ts";

export class UIStateStore implements Store<UIState> {
  private state: UIState = {
    gravityCenter: null,
    hoveredNodeId: null,
    followedNodeId: null,
    draggedNodeId: null,
    isPanning: false,
    isRotating: false,
  };

  public get(): Readonly<UIState> {
    return this.state;
  }

  public setGravityCenter(point: { x: number; y: number } | null): void {
    this.state.gravityCenter = point;
  }

  public setHoveredNode(nodeId: string | null): void {
    this.state.hoveredNodeId = nodeId;
  }

  public setFollowedNode(nodeId: string | null): void {
    this.state.followedNodeId = nodeId;
  }

  public setDraggedNode(nodeId: string | null): void {
    this.state.draggedNodeId = nodeId;
  }

  public setPanning(on: boolean): void {
    this.state.isPanning = on;
  }

  public setRotating(on: boolean): void {
    this.state.isRotating = on;
  }
}