import type { Vec3 } from "./math.ts";

export type Command =
| { type: "OpenNode";                 nodeId: string }
| { type: "SetMouseGravity";              on: boolean }
| { type: "PinNode";                  nodeId: string }
| { type: "UnpinNode";                nodeId: string }
| { type: "SetDraggedNode";           nodeId: string | null }
| { type: "BeginDrag";                nodeId: string; targetWorld: Vec3 }
| { type: "UpdateDragTarget";         targetWorld: Vec3 }
| { type: "EndDrag"; }
| { type: "StartPanCamera";           screen: { x: number; y: number } }
| { type: "UpdatePanCamera";          screen: { x: number; y: number } }
| { type: "EndPanCamera" }
| { type: "StartRotateCamera";        screen: { x: number; y: number } }
| { type: "UpdateRotateCamera";       screen: { x: number; y: number } }
| { type: "EndRotateCamera" }
| { type: "ResetCamera" }
| { type: "ZoomCamera";               screen: { x: number; y: number }; delta: number }
| { type: "SetGravityCenter";          point: { x: number; y: number } | null }
| { type: "SetHoveredNode";           nodeId: string | null }
| { type: "SetFollowedNode";          nodeId: string | null }
| { type: "SetPanning";                   on: boolean }
| { type: "SetRotating";                  on: boolean }
| { type: "SetCameraTarget";          target: { x: number; y: number; z: number } }

export type CommandHandler<K extends Command["type"]> = (
  command: Extract<Command, { type: K }>
) => void;

export type CommandObserver = {
  afterCommandApplied?: (command: Command) => void;
};