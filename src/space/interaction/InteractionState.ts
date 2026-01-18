export type Vec2 = { x: number; y: number };

export type InteractionState = {
  gravityCenter: Vec2 | null;
  hoveredNodeId: string | null;
  followedNodeId: string | null;
  draggedNodeId: string | null;
  isPanning: boolean;
  isRotating: boolean;
};
