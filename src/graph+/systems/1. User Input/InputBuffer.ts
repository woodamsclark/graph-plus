// InputBuffer.ts
import type { DrainableBuffer, UserInputEvent } from "../../grammar/interfaces.ts";

export class InputBuffer implements DrainableBuffer<UserInputEvent> {
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
