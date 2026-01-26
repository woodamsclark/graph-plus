// CommandSystem.ts
// "Apply Intent" stage: drains commands and applies them via injected handlers.
// This stays boring on purpose.

import type { Command } from "./Command.ts";
import { CommandQueue } from "./Command.ts";

export type CommandHandlers = {
  // World / settings mutation
  setMouseGravity?: (on: boolean) => void;
  setPinned?: (nodeId: string, on: boolean) => void;
  replacePinnedSet?: (ids: Set<string>) => void;

  // External actions
  openNode?: (nodeId: string) => void;

  // Drag constraint plumbing (optional):
  // If you keep a world.dragConstraint object, you can update it here instead of in Physics.
  beginDrag?: (nodeId: string) => void;
  dragTarget?: (nodeId: string, targetWorld: { x: number; y: number; z: number }) => void;
  endDrag?: (nodeId: string) => void;
};

export type CommandSystemDeps = {
  getQueue: () => CommandQueue;
  handlers: CommandHandlers;
};

export class CommandSystem {
  constructor(private deps: CommandSystemDeps) {}

  tick(): void {
    const cmds = this.deps.getQueue().drain();
    if (cmds.length === 0) return;

    const h = this.deps.handlers;

    for (const cmd of cmds) {
      switch (cmd.type) {
        case "RequestOpenNode":
          h.openNode?.(cmd.nodeId);
          break;

        case "SetMouseGravity":
          h.setMouseGravity?.(cmd.on);
          break;

        case "SetPinned":
          h.setPinned?.(cmd.nodeId, cmd.on);
          break;

        case "PinSetReplace":
          h.replacePinnedSet?.(cmd.ids);
          break;

        case "BeginDrag":
          h.beginDrag?.(cmd.nodeId);
          break;

        case "DragTarget":
          h.dragTarget?.(cmd.nodeId, cmd.targetWorld);
          break;

        case "EndDrag":
          h.endDrag?.(cmd.nodeId);
          break;

        default:
          // Exhaustiveness check for future commands
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _never: never = cmd;
          break;
      }
    }
  }
}
