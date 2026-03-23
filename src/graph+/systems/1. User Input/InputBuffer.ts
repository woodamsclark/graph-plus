// InputBuffer.ts
import type { DrainableQueue, UserInputEvent } from "../../grammar/interfaces.ts";

export class InputBuffer implements DrainableQueue<UserInputEvent> {
  private buf: UserInputEvent[] = [];

  push(e: UserInputEvent) {
    this.buf.push(e);
  }

  drain(): UserInputEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  clear() {
    this.buf = [];
  }
}
