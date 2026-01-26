// Command.ts
// Discrete intent messages that cross system boundaries.
// Translator emits these; CommandSystem applies them.

export type Vec3 = { x: number; y: number; z: number };

export type Command =
  | { type: "RequestOpenNode"; nodeId: string }
  | { type: "SetMouseGravity"; on: boolean }
  | { type: "PinSetReplace"; ids: Set<string> }
  | { type: "PinSetReplace"; ids: Set<string> }
  | { type: "BeginDrag"; nodeId: string }
  | { type: "DragTarget"; nodeId: string; targetWorld: Vec3 }
  | { type: "EndDrag"; nodeId: string };

export class CommandQueue {
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
