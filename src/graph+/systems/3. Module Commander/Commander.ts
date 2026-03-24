// Commander.ts
// Drains commands and routes them through a registry.
// Modules register handlers for the command types they care about.

import type { CommandSystem, DrainableBuffer, Vec3 } from "../../grammar/interfaces.ts";
import { CommandBuffer } from "./CommandBuffer.ts";

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


export class CommandRegistry {
  private handlers = new Map<Command["type"], Array<(command: Command) => void>>();

  public register<K extends Command["type"]>(
    type: K,
    handler: CommandHandler<K>
  ): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (command: Command) => void);
    this.handlers.set(type, list);
  }

  public dispatch(command: Command): void {
    const list = this.handlers.get(command.type) ?? [];
    for (const handler of list) {
      handler(command);
    }
  }
}

export type CommandSystemDeps = {
  getQueue: () => DrainableBuffer<Command>;
  registry: CommandRegistry;
  observers?: CommandObserver[];
};




export class Commander implements CommandSystem {
  constructor(private deps: CommandSystemDeps) {}

  tick(): void {
    const commands: Command[] = this.deps.getQueue().drain();
    if (commands.length === 0) return;

    for (const command of commands) {
      this.deps.registry.dispatch(command);

      for (const observer of this.deps.observers ?? []) {
        observer.afterCommandApplied?.(command);
      }
    }
  }
}