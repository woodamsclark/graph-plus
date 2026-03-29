// Command.ts
// Discrete intent messages that cross system boundaries.
// Translator emits these; CommandSystem applies them.
import type { Command } from "../../types/domain/commands.ts";
import type { DrainableBuffer } from "../../types/domain/ui.ts";

export class CommandBuffer implements DrainableBuffer<Command> {
  private q: Command[] = [];

  push(cmd: Command): void {
    this.q.push(cmd);
  }

  pushMany(cmds: readonly Command[]): void {
    for (const c of cmds) this.q.push(c);
  }

  drain(): Command[] {
    if (this.q.length === 0) return [];
    const out = this.q;
    this.q = [];
    return out;
  }

  clear(): void {
    this.q = [];
  }

  get size(): number {
    return this.q.length;
  }
}
