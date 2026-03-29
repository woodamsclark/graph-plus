// Commander.ts
// Drains commands and routes them through a registry.
// Modules register handlers for the command types they care about.

import type { Command, CommandHandler } from "../../types/domain/commands.ts";
import type { CommandSystemDeps } from "../../deps/commands.deps.ts";
import { Tickable } from "../../types/index.ts";

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

export class Commander implements Tickable {
  constructor(private deps: CommandSystemDeps) {}

  tick(): void {
    const commands: Command[] = this.deps.queue.drain();
    if (commands.length === 0) return;

    for (const command of commands) {
      this.deps.registry.dispatch(command);

      for (const observer of this.deps.observers ?? []) {
        observer.afterCommandApplied?.(command);
      }
    }
  }
}