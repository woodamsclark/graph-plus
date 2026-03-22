import type { TranslationState } from "../../grammar/interfaces.ts";

export class InteractionStateStore {
  private state: TranslationState = {
    gravityCenter: null,
    hoveredNodeId: null,
    followedNodeId: null,
    draggedNodeId: null,
    isPanning: false,
    isRotating: false,
  };

  public get(): Readonly<TranslationState> {
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