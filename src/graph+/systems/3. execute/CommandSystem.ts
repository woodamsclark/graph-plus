// CommandSystem.ts
// "Apply Intent" stage: drains commands and applies them via injected handlers.
// This stays boring on purpose.

import type { Command, CommandSystem } from "../../grammar/interfaces.ts";
import { CommandBuffer } from "./CommandBuffer.ts";

export type CommandHandlers = {
  // World / settings mutation
  setMouseGravity?: (on: boolean) => void;
  setPinned?:       (nodeId: Set<string>) => void;
  replacePinnedSet?:(ids: Set<string>) => void;

  openNode?:        (nodeId: string) => void;
  // Drag constraint plumbing (optional):
  // If you keep a world.dragConstraint object, you can update it here instead of in Physics.
  beginDrag?:       (nodeId: string) => void;
  dragTarget?:      (nodeId: string, targetWorld: { x: number; y: number; z: number }) => void;
  endDrag?:         (nodeId: string) => void;
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
          break;

        case "SetMouseGravity":
          handlers.setMouseGravity?.(command.on);
          break;

        case "PinSetReplace":
          handlers.setPinned?.(command.ids);
          break;

        case "PinSetReplace":
          handlers.replacePinnedSet?.(command.ids);
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

        default:
          // Exhaustiveness check for future commands
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _never: never = command;
          break;
      }
    }
  }
}
