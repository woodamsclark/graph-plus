// CommandSystem.ts
// "Apply Intent" stage: drains commands and applies them via injected handlers.
// This stays boring on purpose.

import type { Command, CommandSystem } from "../../grammar/interfaces.ts";
import { CommandBuffer } from "./CommandBuffer.ts";

export type CommandHandlers = {
  // World / settings mutation
  setMouseGravity?      : (on: boolean) => void;
  pinNode?              : (nodeId: string) => void;
  unpinNode?            : (nodeId: string) => void;
  openNode?             : (nodeId: string) => void;
  beginDrag?            : (nodeId: string) => void;
  dragTarget?           : (nodeId: string, targetWorld: { x: number; y: number; z: number }) => void;
  endDrag?              : (nodeId: string) => void;
  followNode?           : (nodeId: string | null) => void;
  onNodeCommandExecuted?: (nodeId: string | null, commandType: Command["type"]) => void;
  resetCamera?          : () => void;
  startPanCamera?       : (screen: { x: number; y: number }) => void;
  updatePanCamera?      : (screen: { x: number; y: number }) => void;
  endPanCamera?         : () => void;
  startRotateCamera?    : (screen: { x: number; y: number }) => void;
  updateRotateCamera?   : (screen: { x: number; y: number }) => void;
  endRotateCamera?      : () => void;
  zoomCamera?           : (screen: { x: number; y: number }, delta: number) => void;
};

export type CommandSystemDeps = {
  getQueue: () => CommandBuffer;
  handlers: CommandHandlers;
};

export class Commander implements CommandSystem {
  constructor(private deps: CommandSystemDeps) {}

  tick(): void {
    const commands:Command[] = this.deps.getQueue().drain();
    if (commands.length === 0) return;

    const handlers = this.deps.handlers;

    for (const command of commands) {
      switch (command.type) {
        case "RequestOpenNode":
          handlers.openNode?.(command.nodeId);
            handlers.onNodeCommandExecuted?.(command.nodeId, command.type);
          break;

        case "SetMouseGravity":
          handlers.setMouseGravity?.(command.on);
          break;

        case "PinNode":
          handlers.pinNode?.(command.nodeId);
          break;

        case "UnpinNode":
          handlers.unpinNode?.(command.nodeId);
          break;

        case "BeginDrag":
          handlers.beginDrag?.(command.nodeId);
          break;

        case "DragTarget":
          handlers.dragTarget?.(command.nodeId, command.targetWorld);
          break;

        case "EndDrag":
          handlers.endDrag?.(command.nodeId);
          break;

        case "FollowNode":
          handlers.followNode?.(command.nodeId);
          handlers.onNodeCommandExecuted?.(command.nodeId, command.type);
          break;

        case "ResetCamera":
          handlers.resetCamera?.();
          break;

        case "StartPanCamera":
          handlers.startPanCamera?.(command.screen);
          break;

        case "UpdatePanCamera":
          handlers.updatePanCamera?.(command.screen);
          break;

        case "EndPanCamera":
          handlers.endPanCamera?.();
          break;

        case "StartRotateCamera":
          handlers.startRotateCamera?.(command.screen);
          break;

        case "UpdateRotateCamera":
          handlers.updateRotateCamera?.(command.screen);
          break;

        case "EndRotateCamera":
          handlers.endRotateCamera?.();
          break;

        case "ZoomCamera":
          handlers.zoomCamera?.(command.screen, command.delta);
          break;

        default:
          // Exhaustiveness check for future commands
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          //const _never: never = command;
          break;
      }
    }
  }
}
