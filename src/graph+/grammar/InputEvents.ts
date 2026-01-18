export type InputEvent =
  | { type: "MOUSE_MOVE"; x: number; y: number }
  | { type: "DRAG_START"; nodeId: string; x: number; y: number }
  | { type: "DRAG_MOVE"; x: number; y: number }
  | { type: "DRAG_END" }
  | { type: "PAN_START"; x: number; y: number }
  | { type: "PAN_MOVE"; x: number; y: number }
  | { type: "PAN_END" }
  | { type: "ROTATE_START"; x: number; y: number }
  | { type: "ROTATE_MOVE"; x: number; y: number }
  | { type: "ROTATE_END" }
  | { type: "ZOOM"; x: number; y: number; delta: number }
  | { type: "OPEN_NODE"; x: number; y: number }
  | { type: "FOLLOW_START"; nodeId: string }
  | { type: "FOLLOW_END" }
  | { type: "RESET_CAMERA" };